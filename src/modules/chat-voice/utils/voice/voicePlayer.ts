import { synthesizeVoice, voiceConfigSignature } from '@/shared/api';
import type { VoicePlayState, VoiceSnapshot } from '@/shared/types';
import { createBoundedLru, createExternalStore } from '@/shared/utils';

// A single app-level audio player for read-aloud. It owns one <audio> element, lives
// outside the React tree, and caches generated audio by content. Because playback is not
// tied to a component, switching chats or re-rendering a message can't revoke the blob URL
// out from under it (the cause of mid-play cutoffs). v1 plays one message at a time
// (a new play replaces the current one); the design leaves room for a queue later.


const IDLE: VoiceSnapshot = { state: 'idle', error: null };
const CACHE_MAX = 24;
const CLIENT_TIMEOUT_MS = 330000; // backstop; the server proxy already times out at 5 min

/** The whole player reading; a per-utterance `getSnapshot` derives from it by id. */
type VoicePlayerReading = {
  currentId: string | null;
  state: VoicePlayState;
  errorId: string | null;
  errorMsg: string | null;
};

const IDLE_READING: VoicePlayerReading = {
  currentId: null,
  state: 'idle',
  errorId: null,
  errorMsg: null,
};

// Stable id / cache key from the text and voice settings that affect its audio (djb2).
export function voiceId(content: string, signature = voiceConfigSignature()): string {
  const input = JSON.stringify([content, signature]);
  let h = 5381;
  for (let i = 0; i < input.length; i++) h = (((h << 5) + h) + input.charCodeAt(i)) | 0;
  return (h >>> 0).toString(36);
}

class VoicePlayer {
  private audio: HTMLAudioElement | null = null;
  private unlocked = false;
  private cache = createBoundedLru<string, string>(CACHE_MAX); // id -> blob URL
  private readonly store = createExternalStore<VoicePlayerReading>(IDLE_READING);
  private token = 0; // bumps to ignore stale in-flight results
  private activeController: AbortController | null = null; // aborts the in-flight TTS fetch
  private errorTimer: ReturnType<typeof setTimeout> | null = null;

  subscribe(listener: () => void): () => void {
    return this.store.subscribe(listener);
  }

  /** Applies the reading fields one command changed; subscribers are notified once. */
  private patch(reading: Partial<VoicePlayerReading>): void {
    this.store.update((current) => ({ ...current, ...reading }));
  }

  getSnapshot(id: string): VoiceSnapshot {
    const reading = this.store.getSnapshot();
    const state = reading.currentId === id ? reading.state : 'idle';
    const error = reading.errorId === id ? reading.errorMsg : null;
    if (state === 'idle' && error === null) return IDLE;
    return { state, error };
  }

  /**
   * Whether any read-aloud is loading or playing. Callers that own another audio
   * source (the composer's recording clip) use this to yield the speakers: the
   * per-utterance `getSnapshot` cannot answer it, because they do not know the id.
   */
  isBusy(): boolean {
    const { state } = this.store.getSnapshot();
    return state === 'loading' || state === 'playing';
  }

  private ensureAudio(): HTMLAudioElement {
    if (!this.audio) {
      const audio = new Audio();
      audio.addEventListener('ended', () => this.onEnded());
      audio.addEventListener('error', () => {
        // Only meaningful while we believe we're playing.
        if (this.store.getSnapshot().state === 'playing') this.onEnded();
      });
      this.audio = audio;
    }
    return this.audio;
  }

  // Call synchronously from the click handler so iOS grants the (reused) element playback.
  unlock() {
    if (this.unlocked) return;
    const audio = this.ensureAudio();
    try {
      const p = audio.play();
      if (p && typeof p.catch === 'function') p.catch(() => {});
      audio.pause();
    } catch {
      /* priming attempt; ignore */
    }
    this.unlocked = true;
  }

  toggle(content: string) {
    const id = voiceId(content);
    const { currentId, state } = this.store.getSnapshot();
    if (currentId === id && (state === 'playing' || state === 'loading')) {
      this.stop();
      return;
    }
    void this.play(id, content);
  }

  stop() {
    this.token++; // ignore any stale in-flight result
    this.abortActive(); // and actually cancel the network request
    if (this.audio) this.audio.pause();
    this.patch({ state: 'idle', currentId: null });
  }

  private abortActive() {
    if (this.activeController) {
      this.activeController.abort();
      this.activeController = null;
    }
  }

  private onEnded() {
    this.patch({ state: 'idle', currentId: null });
    // (queue auto-advance would hook in here)
  }

  private setError(id: string, msg: string) {
    this.patch({ state: 'idle', currentId: id, errorId: id, errorMsg: msg });
    if (this.errorTimer) clearTimeout(this.errorTimer);
    this.errorTimer = setTimeout(() => {
      if (this.store.getSnapshot().errorId !== id) return;
      this.patch({
        errorId: null,
        errorMsg: null,
        ...(this.store.getSnapshot().currentId === id ? { currentId: null } : {}),
      });
    }, 6000);
  }

  private async play(id: string, content: string) {
    const audio = this.ensureAudio();
    audio.pause();
    this.patch({ currentId: id, errorId: null, errorMsg: null, state: 'loading' });

    const myToken = ++this.token;
    this.abortActive(); // cancel any request this play supersedes

    try {
      let url = this.cache.get(id);
      if (!url) {
        const controller = new AbortController();
        this.activeController = controller;
        const timer = setTimeout(() => controller.abort(), CLIENT_TIMEOUT_MS);
        const res = await synthesizeVoice(content, controller.signal).finally(() => {
          clearTimeout(timer);
          if (this.activeController === controller) this.activeController = null;
        });
        if (myToken !== this.token) return; // superseded by another play/stop
        if (!res.ok) {
          let msg = `Read-aloud failed (${res.status})`;
          try {
            const j = await res.json();
            if (j?.error) msg = String(j.error);
          } catch {
            /* non-JSON error body */
          }
          throw new Error(msg);
        }
        const blob = await res.blob();
        if (myToken !== this.token) return;
        url = URL.createObjectURL(blob);
        this.cacheSet(id, url);
      }
      if (myToken !== this.token) return;
      audio.src = url;
      audio.load();
      await audio.play();
      if (myToken !== this.token) return;
      this.patch({ state: 'playing' });
    } catch (e) {
      if (myToken !== this.token) return;
      const aborted = e instanceof Error && e.name === 'AbortError';
      this.setError(id, aborted ? 'Read-aloud timed out.' : e instanceof Error ? e.message : 'Read-aloud failed');
    }
  }

  private cacheSet(id: string, url: string) {
    const evicted = this.cache.set(id, url);
    // The evicted blob URL is no longer reachable from the cache; release it unless
    // the audio element is still playing it.
    if (evicted !== undefined && evicted !== this.audio?.src) {
      URL.revokeObjectURL(evicted);
    }
  }
}

export const voicePlayer = new VoicePlayer();

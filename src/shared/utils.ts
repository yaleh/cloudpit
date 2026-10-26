import { clsx, type ClassValue } from 'clsx';
import { twMerge } from 'tailwind-merge';

import type { Clock, Project, ProjectSession, SessionHostLease, SessionHostsSnapshot, VoiceClientAssetPaths } from '@/shared/types';

//----------------- DEPLOYMENT MODE ------------

/**
 * Indicates whether the app runs in Platform mode (hosted) or OSS mode (self-hosted).
 * Read it to hide or gate features that only exist in one of the two deployments.
 */
export const IS_PLATFORM = import.meta.env?.VITE_IS_PLATFORM === 'true';

// ---------------------------

//----------------- TAILWIND CLASS COMPOSITION ------------

/**
 * Merges conditional class names and resolves conflicting Tailwind utilities so the
 * last-specified utility wins. Use it for every className built from props or state.
 */
export function cn(...inputs: ClassValue[]) {
  return twMerge(clsx(inputs));
}

// ---------------------------

//----------------- CLIPBOARD ------------

/**
 * Copies text with `document.execCommand`, the only path that works in browsers or
 * contexts where the async Clipboard API is unavailable. Private to `copyTextToClipboard`.
 */
function fallbackCopyToClipboard(text: string): boolean {
  if (!text || typeof document === 'undefined') {
    return false;
  }

  const textarea = document.createElement('textarea');
  textarea.value = text;
  textarea.setAttribute('readonly', '');
  textarea.style.position = 'fixed';
  textarea.style.opacity = '0';
  textarea.style.pointerEvents = 'none';

  document.body.appendChild(textarea);
  textarea.focus();
  textarea.select();

  let copied = false;
  try {
    copied = document.execCommand('copy');
  } catch {
    copied = false;
  } finally {
    document.body.removeChild(textarea);
  }

  return copied;
}

/**
 * Copies text to the clipboard, falling back to a hidden textarea when the Clipboard API
 * is blocked. Resolves to whether the copy succeeded so callers can show copied feedback.
 */
export async function copyTextToClipboard(text: string): Promise<boolean> {
  if (!text) {
    return false;
  }

  let copied = false;

  try {
    if (typeof navigator !== 'undefined' && navigator.clipboard?.writeText) {
      await navigator.clipboard.writeText(text);
      copied = true;
    }
  } catch {
    copied = false;
  }

  if (!copied) {
    copied = fallbackCopyToClipboard(text);
  }

  return copied;
}

// ---------------------------

//----------------- NOTIFICATION SOUND ------------

/** localStorage key holding the user's completion-sound preference. Private to the sound helpers. */
const NOTIFICATION_SOUND_ENABLED_STORAGE_KEY = 'notificationSoundEnabled';

/** The browser's AudioContext constructor, including the webkit-prefixed fallback; undefined outside a browser. */
const AudioContextConstructor =
  typeof window !== 'undefined'
    ? window.AudioContext || (window as typeof window & { webkitAudioContext?: typeof AudioContext }).webkitAudioContext
    : undefined;

/** Lazily created and reused, because browsers cap how many AudioContexts a page may open. */
let audioContext: AudioContext | null = null;

/** Reports whether the user has left completion sounds on; defaults to on when unset. */
export const isNotificationSoundEnabled = (): boolean => {
  if (typeof localStorage === 'undefined') {
    return true;
  }

  return localStorage.getItem(NOTIFICATION_SOUND_ENABLED_STORAGE_KEY) !== 'false';
};

/** Persists the user's completion-sound preference; call it from settings toggles. */
export const setNotificationSoundEnabled = (enabled: boolean): void => {
  if (typeof localStorage === 'undefined') {
    return;
  }

  localStorage.setItem(NOTIFICATION_SOUND_ENABLED_STORAGE_KEY, String(enabled));
};

/** Returns the shared AudioContext, creating it on first use. Private to the sound helpers. */
const getAudioContext = (): AudioContext | null => {
  if (!AudioContextConstructor) {
    return null;
  }

  if (!audioContext) {
    audioContext = new AudioContextConstructor();
  }

  return audioContext;
};

/** Schedules one synthesized sine tone on the shared context. Private to `playNotificationSound`. */
const playTone = (
  context: AudioContext,
  frequency: number,
  startsAt: number,
  duration: number,
  peakVolume: number,
): void => {
  const oscillator = context.createOscillator();
  const gain = context.createGain();

  oscillator.type = 'sine';
  oscillator.frequency.setValueAtTime(frequency, startsAt);

  // Shape the volume so the synthesized tone starts and stops cleanly.
  gain.gain.setValueAtTime(0.0001, startsAt);
  gain.gain.exponentialRampToValueAtTime(peakVolume, startsAt + 0.015);
  gain.gain.exponentialRampToValueAtTime(0.0001, startsAt + duration);

  oscillator.connect(gain);
  gain.connect(context.destination);
  oscillator.start(startsAt);
  oscillator.stop(startsAt + duration + 0.02);
};

/**
 * Plays the two-tone notification chime, honouring the user's preference unless `force`
 * is set (settings previews pass `force` so the user can hear the sound while it is off).
 */
export const playNotificationSound = async ({ force = false } = {}): Promise<void> => {
  if (!force && !isNotificationSoundEnabled()) {
    return;
  }

  const context = getAudioContext();
  if (!context) {
    return;
  }

  try {
    if (context.state === 'suspended') {
      await context.resume();
    }

    const now = context.currentTime;
    playTone(context, 740, now, 0.12, 0.075);
    playTone(context, 988, now + 0.11, 0.16, 0.06);
  } catch (error) {
    // Browsers may block audio until the page receives a user gesture.
    console.warn('Unable to play notification sound:', error);
  }
};

/** Plays the chime for a finished assistant turn; named for the chat call site it serves. */
export const playChatCompletionSound = (options = {}): Promise<void> => playNotificationSound(options);

// ---------------------------

//----------------- DOCUMENT TITLE ------------

/** Browser tab title shown when no project or session is selected. Private to the title helpers. */
const DEFAULT_PAGE_TITLE = 'CloudCLI UI';

/**
 * Resolves the human-readable label for a session, accounting for Cursor sessions that
 * carry a `name` instead of the summary the other providers return.
 */
export const getSessionTitle = (session: ProjectSession): string => {
  if (session.__provider === 'cursor') {
    return (session.name as string) || 'Untitled Session';
  }

  return (session.summary as string) || 'New Session';
};

/**
 * Builds the browser tab title for the current selection: the session title when one is
 * open, otherwise the project name, otherwise the app name.
 */
export const getPageTitle = (
  selectedProject: Project | null,
  selectedSession: ProjectSession | null,
): string => {
  if (selectedSession) {
    return getSessionTitle(selectedSession);
  }

  const displayName = selectedProject?.displayName?.trim();
  return displayName ? `${displayName} - ${DEFAULT_PAGE_TITLE}` : DEFAULT_PAGE_TITLE;
};

// ---------------------------

//----------------- SESSION HOST HELD WORK ------------

/**
 * The held-work leases on one session's live host, in listing order.
 *
 * "Held work" is the two lease kinds that outlive the turn that started them —
 * a background task and a monitor — and is the whole set the resident pill
 * counts. It used to be what the transcript's background-task strip drew, but
 * that surface is retired: the activity dock's panel reads the session's own
 * task table, which is a different source, so the pill is the one reader left.
 * Derived from the `snapshot` argument rather than a hook so the reader does not
 * add an export to the hook module (a second export there would red every test
 * that mocks the hook wholesale). Read off the *listing*, not the transcript: the
 * work is a fact about the process the host layer holds, and the transcript only
 * knows it if a model happened to write it down.
 *
 * A session with no live host — or no session at all — has no held work and
 * answers with an empty list, not null: the caller's next question is always
 * "how many", and "no host" and "a host holding nothing" answer it the same way.
 */
export function findBackgroundTaskLeases(
  snapshot: SessionHostsSnapshot | null,
  appSessionId: string | null,
): Array<Extract<SessionHostLease, { kind: 'background-task' | 'monitor' }>> {
  if (!snapshot || !appSessionId) {
    return [];
  }
  for (const host of snapshot.hosts) {
    // A closed host keeps its bindings as the record of who it was serving, so
    // treating one as live would report work no process is holding any more.
    if (host.state === 'closed') {
      continue;
    }
    const binding = host.bindings.find((candidate) => candidate.appSessionId === appSessionId);
    if (binding) {
      return binding.leases.filter(
        (lease): lease is Extract<SessionHostLease, { kind: 'background-task' | 'monitor' }> =>
          lease.kind === 'background-task' || lease.kind === 'monitor',
      );
    }
  }
  return [];
}

//----------------- VOICE CLIENT ASSET PATHS ------------

/** The model-directory file names the server whitelists; the browser asks for exactly these two. */
const VOICE_CLIENT_MODEL_FILE = 'model.int8.onnx';
const VOICE_CLIENT_TOKENS_FILE = 'tokens.txt';

/**
 * Normalises Vite's `BASE_URL` into a leading-and-trailing-slash prefix, so concatenating a path onto
 * it can neither drop nor double a separator: `/`, `/sub/` and a bare `sub` all come out safe.
 */
function voiceClientBasePrefix(baseUrl: string | undefined): string {
  const raw = typeof baseUrl === 'string' ? baseUrl.trim() : '';
  if (raw === '' || raw === '/') return '/';
  return `${raw.startsWith('/') ? '' : '/'}${raw.replace(/\/+$/, '')}/`;
}

/**
 * The same-origin URLs the browser recogniser loads, all under one `BASE_URL` prefix.
 *
 * Use it wherever the client ASR path needs the model, the token list or the runtime: the server
 * serves the model directory at `/voice-client/model` and the `onnxruntime-web` distribution at
 * `/voice-client/ort`, and deriving both from `import.meta.env.BASE_URL` is what keeps a sub-path
 * deployment (`docs/nginx-subpath-template.conf`) working. Pass the raw `import.meta.env.BASE_URL`; a
 * missing or blank value is treated as the site root rather than producing a protocol-relative URL.
 */
export function voiceClientAssetPaths(baseUrl: string | undefined): VoiceClientAssetPaths {
  const prefix = voiceClientBasePrefix(baseUrl);
  return {
    modelUrl: `${prefix}voice-client/model/${VOICE_CLIENT_MODEL_FILE}`,
    tokensUrl: `${prefix}voice-client/model/${VOICE_CLIENT_TOKENS_FILE}`,
    ortScriptUrl: `${prefix}voice-client/ort/ort.wasm.min.mjs`,
    ortWasmPaths: `${prefix}voice-client/ort/`,
  };
}

// ---------------------------

//----------------- TIMESTAMP FORMATTING ------------

/**
 * Renders an ISO timestamp as a locale-aware relative reading ("3 hours ago").
 *
 * Use it wherever an absolute instant would make the reader do the arithmetic — the architecture
 * panel's analysis time and the mention hits' message times. `locale` is the INTERFACE language
 * (`i18n.language`), not the browser's, so the reading matches the surrounding labels. An
 * unparseable or missing timestamp reads `unknown` rather than throwing.
 */
export function formatRelativeTime(iso: string | null, locale: string): string {
  if (iso === null) return 'unknown';
  const analysed = Date.parse(iso);
  if (Number.isNaN(analysed)) return 'unknown';
  const seconds = Math.round((analysed - Date.now()) / 1000);
  const steps: readonly [Intl.RelativeTimeFormatUnit, number][] = [
    ['year', 31536000],
    ['month', 2592000],
    ['day', 86400],
    ['hour', 3600],
    ['minute', 60],
    ['second', 1],
  ];
  const formatter = new Intl.RelativeTimeFormat(locale, { numeric: 'auto' });
  for (const [unit, size] of steps) {
    if (Math.abs(seconds) >= size || unit === 'second') {
      return formatter.format(Math.round(seconds / size), unit);
    }
  }
  return formatter.format(seconds, 'second');
}

/**
 * The precise local instant behind a relative reading, for a `<time>` element's title attribute.
 *
 * Returns `undefined` for a missing or unparseable timestamp so callers can omit the attribute.
 */
export function formatAbsoluteTime(iso: string | null, locale: string): string | undefined {
  if (iso === null) return undefined;
  const parsed = new Date(iso);
  return Number.isNaN(parsed.getTime()) ? undefined : parsed.toLocaleString(locale);
}

// ---------------------------

//----------------- INJECTABLE CLOCK ------------

/**
 * The browser's real clock, matching {@link Clock}.
 *
 * Use it as the fallback in a controller's dependency seam: production gets this
 * object, and a test injects a fake with the same five members instead.
 */
export const defaultClock: Clock = {
  setTimeout: (callback, milliseconds) => globalThis.setTimeout(callback, milliseconds),
  clearTimeout: (handle) => globalThis.clearTimeout(handle as ReturnType<typeof setTimeout>),
  setInterval: (callback, milliseconds) => globalThis.setInterval(callback, milliseconds),
  clearInterval: (handle) => globalThis.clearInterval(handle as ReturnType<typeof setInterval>),
  now: () => Date.now(),
};

// ---------------------------

//----------------- TYPE GUARD / ERROR RENDERING UTILITIES ------------

/**
 * Narrows an unknown value to a plain object record.
 *
 * `null`, arrays and every non-object are NOT records: channel payloads and
 * persisted JSON are walked only after this guard, so an array must never answer
 * as a record by accident. It replaces the private copies the architecture and
 * settings modules each carried.
 *
 * Consumers: the architecture and settings modules.
 */
export function isRecord(value: unknown): value is Record<string, unknown> {
  return value !== null && typeof value === 'object' && !Array.isArray(value);
}

/**
 * Renders a thrown value as the sentence a panel or log line shows.
 *
 * An `Error` contributes its own message; any other thrown value is stringified.
 * Pass `fallback` when an EMPTY or whitespace-only message must not reach the
 * reader — it is used for a blank `Error.message` and for every non-`Error`
 * value. Omit it for the raw reading.
 *
 * Consumers: the architecture and settings modules.
 */
export function errorMessage(failure: unknown, fallback?: string): string {
  if (failure instanceof Error) {
    return failure.message.trim() !== '' ? failure.message : fallback ?? failure.message;
  }
  return fallback ?? String(failure);
}

// ---------------------------

//----------------- EXTERNAL STORES ------------

/**
 * The subscription surface of a store that lives outside React.
 *
 * A module-level store or a React-free controller returns this beside its own
 * commands; a component reads `getSnapshot` through `useSyncExternalStore` and
 * calls `subscribe` as its subscribe callback. `set`/`update` notify every
 * listener only when the value's identity actually changed.
 */
export type ExternalStore<T> = {
  subscribe: (listener: () => void) => () => void;
  getSnapshot: () => T;
  set: (next: T) => void;
  update: (updater: (current: T) => T) => void;
};

/** Lifecycle hooks for a store whose work should run only while it has readers. */
export type ExternalStoreOptions = {
  /** Runs when the first listener subscribes, so the store can start its poller. */
  onFirstSubscriber?: () => void;
  /** Runs when the last listener unsubscribes, so the store can stop its poller. */
  onLastUnsubscriber?: () => void;
};

/**
 * Creates a store whose value React reads through `useSyncExternalStore`.
 *
 * Replaces the hand-written `listeners = new Set` + `forEach` pattern: `set` and
 * `update` are the only writers, they skip notification when the value is
 * identical (`Object.is`), and listeners are notified over a snapshot of the set
 * so one listener may unsubscribe while being called.
 */
export function createExternalStore<T>(
  initial: T,
  options: ExternalStoreOptions = {},
): ExternalStore<T> {
  let snapshot = initial;
  const listeners = new Set<() => void>();

  const commit = (next: T): void => {
    if (Object.is(next, snapshot)) return;
    snapshot = next;
    for (const listener of [...listeners]) listener();
  };

  return {
    subscribe(listener) {
      listeners.add(listener);
      if (listeners.size === 1) options.onFirstSubscriber?.();
      return () => {
        // A caller that runs its unsubscribe twice must not make the store report
        // the last reader leaving for a listener that was already gone.
        if (!listeners.delete(listener)) return;
        if (listeners.size === 0) options.onLastUnsubscriber?.();
      };
    },
    getSnapshot: () => snapshot,
    set: commit,
    update: (updater) => commit(updater(snapshot)),
  };
}

// ---------------------------

//----------------- BOUNDED LRU CACHE ------------

/** A fixed-capacity least-recently-used cache; the oldest key is evicted first. */
export type BoundedLru<K, V> = {
  /** Answers the value and marks the key most recently used. */
  get: (key: K) => V | undefined;
  /**
   * Stores the value as the most recently used, evicting the oldest key over
   * capacity. Returns the value that was evicted, so a caller holding a resource
   * (a blob URL) can release it; `undefined` when nothing was evicted.
   */
  set: (key: K, value: V) => V | undefined;
  /** Drops one key; returns whether it was present. */
  delete: (key: K) => boolean;
  /** Drops every key. */
  clear: () => void;
  /** How many keys are currently held. */
  readonly size: number;
};

/**
 * Creates a bounded cache in which both `get` and `set` refresh a key's
 * recency, and inserting past `capacity` evicts the least recently used key.
 *
 * Replaces the hand-written `Map` dance (delete-then-set on write, bump the
 * oldest key on overflow) that four modules each repeated; using `get` as a
 * recency signal is the behaviour those copies were reaching for.
 */
export function createBoundedLru<K, V>(capacity: number): BoundedLru<K, V> {
  if (!Number.isInteger(capacity) || capacity < 1) {
    throw new RangeError(`createBoundedLru capacity must be a positive integer, got ${capacity}`);
  }

  const entries = new Map<K, V>();

  return {
    get(key) {
      if (!entries.has(key)) return undefined;
      const value = entries.get(key) as V;
      // Re-insert so map insertion order stays the recency order.
      entries.delete(key);
      entries.set(key, value);
      return value;
    },
    set(key, value) {
      entries.delete(key);
      entries.set(key, value);
      let evicted: V | undefined;
      while (entries.size > capacity) {
        const oldest = entries.keys().next();
        if (oldest.done === true) break;
        evicted = entries.get(oldest.value);
        entries.delete(oldest.value);
      }
      return evicted;
    },
    delete: (key) => entries.delete(key),
    clear: () => entries.clear(),
    get size() {
      return entries.size;
    },
  };
}

// ---------------------------

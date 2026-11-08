import assert from 'node:assert/strict';

import { act, cleanup, renderHook, waitFor } from '@testing-library/react';
import { afterEach, beforeEach, test, vi } from 'vitest';

import { createFakeVoiceCapture } from '@/modules/chat/tests/voiceCaptureTestHarness';
import type { FakeVoiceCapture } from '@/modules/chat/tests/voiceCaptureTestHarness';
import type * as SharedApi from '@/shared/api';
import type * as AudioDecode from '@/shared/voice/audioDecode';

/**
 * AC-5: the user's VAD switch, read through the real dictation path.
 *
 * THE TWO ARMS ARE THE SAME LISTEN WITH ONE PREFERENCE CHANGED. Every case below drives the
 * shipping hook with the fake capture engine, and reads what the recogniser stand-in received:
 * how many requests, and how long each uploaded WAV is. The capture, the mode resolution, the
 * splitter, the trim and the request builder are the shipping modules; only the recogniser and the
 * decoder are stand-ins.
 *
 * WHY THE MODULE IS RE-IMPORTED PER CASE. `voiceDebug` resolves its flags ONCE, when the module is
 * first evaluated — that is the behaviour that keeps a route change from unsetting a switch — so a
 * case that wants `voiceDebug=1&voiceVad=off` has to state it before the module loads. `resetModules`
 * plus a dynamic import is that statement; the preference is seeded through the same localStorage
 * mirror the app restores from at load, so both halves come from the state a real page would have.
 */

const { transcribeVoice, decoded } = vi.hoisted(() => ({
  transcribeVoice: vi.fn(),
  decoded: { samples: new Float32Array(0) as Float32Array<ArrayBufferLike>, sampleRate: 16_000 },
}));

vi.mock('@/shared/api', async (importOriginal) => {
  const actual = await importOriginal<typeof SharedApi>();
  return {
    transcribeVoice,
    // The raw-corpus upload fired after a listen; doubled so the whole-module mock stays complete.
    captureRawVoice: vi.fn(),
    // No published voice profile: nothing turns the trim's capability decision on, so the shipped
    // gap filter answer ("keep the pause") is what the VAD arm runs against.
    effectivePauseCuesDeclaration: () => null,
    // The recogniser's answer is parsed by the shipping parser, not a second copy of it.
    parseTranscriptionResponse: actual.parseTranscriptionResponse,
    voiceConfigSignature: () => 'test-signature',
    synthesizeVoice: vi.fn(),
  };
});

vi.mock('@/shared/voice/audioDecode', async (importOriginal) => ({
  ...(await importOriginal<typeof AudioDecode>()),
  // jsdom has no audio stack; the file entry is handed the PCM a decoder would have produced.
  decodeVoiceBlob: async () => ({ samples: decoded.samples, sampleRate: decoded.sampleRate }),
}));

const RATE = 16_000;
const WAV_HEADER = 44;

/** Seeds the preference store's mirror, which the app restores from at module load. */
const setPreference = (voiceVadEnabled: boolean): void => {
  localStorage.setItem(
    'user-preferences',
    JSON.stringify({ uiPreferences: { voiceEnabled: true, voiceVadEnabled } }),
  );
};

/** States the debug switches (or clears them) for the next module load. */
const setDebugFlags = (flags: Record<string, string> | null): void => {
  if (flags === null) localStorage.removeItem('voiceDebugFlags');
  else localStorage.setItem('voiceDebugFlags', JSON.stringify(flags));
};

/** A fresh hook module, so `voiceDebug` resolves the flags this case set. */
const loadUseVoiceInput = async () => {
  vi.resetModules();
  const chatVoice = await import('@/modules/chat-voice');
  return chatVoice.useVoiceInput;
};

/**
 * One microphone press over `drive`, returning once the listen has committed and gone idle.
 * `voiceVadEnabled=false` keeps speech plus a long pause plus a silent tail in ONE buffer, so the
 * uploaded durations say directly whether anything was cut or trimmed.
 */
const runMic = async (drive: (capture: FakeVoiceCapture) => void): Promise<void> => {
  const useVoiceInput = await loadUseVoiceInput();
  const capture = createFakeVoiceCapture();
  const view = renderHook(() => useVoiceInput(vi.fn(), vi.fn(), { captureEngine: capture.engine }));
  await act(async () => {
    view.result.current.toggle();
  });
  await act(async () => {
    drive(capture);
  });
  await act(async () => {
    view.result.current.stop();
  });
  await waitFor(() => assert.equal(view.result.current.state, 'idle'));
  view.unmount();
};

/** One chosen file through the same hook, decoded to the PCM the case supplies. */
const runFile = async (samples: Float32Array, sampleRate = RATE): Promise<void> => {
  const useVoiceInput = await loadUseVoiceInput();
  decoded.samples = samples;
  decoded.sampleRate = sampleRate;
  const view = renderHook(() => useVoiceInput(vi.fn(), vi.fn()));
  await act(async () => {
    view.result.current.transcribeFile(new File([new Uint8Array(8)], 'take.webm', { type: 'audio/webm' }));
  });
  await waitFor(() => assert.equal(view.result.current.state, 'idle'));
  view.unmount();
};

/** The durations of every WAV the recogniser stand-in was handed, in seconds. */
const uploadedSec = (): number[] =>
  transcribeVoice.mock.calls.map((call) => ((call[0] as Blob).size - WAV_HEADER) / 2 / RATE);

const sum = (values: number[]): number => values.reduce((total, value) => total + value, 0);

beforeEach(() => {
  localStorage.clear();
  transcribeVoice.mockReset();
  transcribeVoice.mockResolvedValue({ ok: true, json: async () => ({ text: 'hello' }) });
  decoded.samples = new Float32Array(0);
  decoded.sampleRate = RATE;
  Object.defineProperty(navigator, 'mediaDevices', {
    configurable: true,
    value: { getUserMedia: async () => ({ getTracks: () => [{ stop: () => undefined }] }) },
  });
  // jsdom implements neither object-URL function, and a finished listen builds its replay slot.
  URL.createObjectURL = vi.fn(() => 'blob:voice-vad-preference') as unknown as typeof URL.createObjectURL;
  URL.revokeObjectURL = vi.fn();
});

afterEach(() => {
  cleanup();
});

/**
 * The reference listen: 2 s speech, a 12 s pause, 2 s speech, a 3 s silent tail (19.04 s total —
 * the two `speechEnd` frames are each 20 ms of audio). A `speechStart` alone would leave the VAD's
 * frame flags at "speech" through the pause, so the end transitions are what make the pause a
 * pause rather than continuous speech.
 */
const speechPauseSpeech = (capture: FakeVoiceCapture): void => {
  capture.speak(2);
  capture.endSpeech();
  capture.push(12);
  capture.speak(2);
  capture.endSpeech();
  capture.push(3);
};

/** The reference listen's exact length, in samples. */
const REFERENCE_SAMPLES = Math.round(19.04 * RATE);

test('with VAD on, the shipping segmenter still cuts the listen (positive control)', async () => {
  setPreference(true);
  setDebugFlags(null);

  await runMic(speechPauseSpeech);

  const durations = uploadedSec();
  assert.equal(durations.length, 2, 'VAD on must still cut this listen into the segments it always did');
  assert.ok(sum(durations) < 19, `the long pause must not be uploaded when VAD is on (sent ${sum(durations)}s)`);
});

test('with the user switch off, the recording is kept whole and uploaded once', async () => {
  setPreference(false);
  setDebugFlags(null);

  await runMic(speechPauseSpeech);

  const durations = uploadedSec();
  assert.equal(durations.length, 1, 'the no-VAD mode must not create a VAD boundary');
  assert.equal(
    Math.round(durations[0] * RATE),
    REFERENCE_SAMPLES,
    'the uploaded audio must be the whole recording, edges and internal pause included',
  );
});

test('with the user switch off, a 125 s input is split at the request ceiling alone', async () => {
  setPreference(false);
  setDebugFlags(null);

  await runMic((capture) => {
    capture.speak(2);
    capture.push(123);
  });

  const durations = uploadedSec();
  // 125 s = 60 + 60 + 5. The AC's "2 pieces" counts cut points; ceil(125 / 60) = 3 requests, and
  // each piece is at or under the 60 s ceiling. The unit criterion (voiceLiveSegmenter.test.ts)
  // reads the same partition sample-exactly.
  assert.deepEqual(durations, [60, 60, 5], 'the cap alone must partition the recording');
  assert.equal(sum(durations), 125, 'the pieces must concatenate to the recording');
});

test('a stale voiceVad flag is disarmed while voiceDebug is off', async () => {
  // The old A/B left `voiceVad=off` in storage. With `voiceDebug` off it must not apply; the
  // preference (on) decides, so this is the shipping VAD arm.
  setPreference(true);
  setDebugFlags({ voiceVad: 'off' });

  await runMic(speechPauseSpeech);

  assert.equal(uploadedSec().length, 2, 'a remembered debug arm must not turn VAD off for a normal user');
});

test('the debug override still owns the A/B arms while it is on', async () => {
  setPreference(true);
  setDebugFlags({ voiceDebug: '1', voiceVad: 'off' });
  await runMic(speechPauseSpeech);
  assert.equal(uploadedSec().length, 1, 'voiceDebug=1&voiceVad=off must send the whole input, as before');

  // The other direction: the debug value wins over the user's off switch.
  setPreference(false);
  setDebugFlags({ voiceDebug: '1', voiceVad: '1' });
  transcribeVoice.mockClear();
  await runMic(speechPauseSpeech);
  assert.equal(uploadedSec().length, 2, 'voiceDebug=1&voiceVad=1 must keep the VAD arm even with the preference off');
});

test('the file entry resolves the same mode as the microphone', async () => {
  setPreference(false);
  setDebugFlags(null);

  // Two seconds of tone, then 23 s of silence — a tail a trim would remove, so an unchanged
  // 25 s upload proves the file entry travelled the same no-VAD, no-trim path as the mic.
  const samples = new Float32Array(25 * RATE);
  for (let i = 0; i < 2 * RATE; i += 1) samples[i] = 0.4;

  await runFile(samples);
  const fromFile = uploadedSec();
  assert.deepEqual(fromFile, [25], 'the file entry must upload the recording whole');

  transcribeVoice.mockClear();
  await runMic((capture) => {
    capture.speak(2);
    capture.push(23);
  });
  assert.deepEqual(uploadedSec(), fromFile, 'the microphone and the file entry must use the same mode');
});

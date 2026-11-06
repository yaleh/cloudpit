import assert from 'node:assert/strict';

import { act, fireEvent, render } from '@testing-library/react';
import i18next from 'i18next';
import React from 'react';
import { initReactI18next } from 'react-i18next';
import { afterEach, beforeEach, test, vi } from 'vitest';

import { ChatComposer } from '@/modules/chat-composer';
import { createFakeVoiceCapture } from '@/modules/chat/tests/voiceCaptureTestHarness';
import enChat from '@/modules/i18n/locales/en/chat.json';
// Type-only, so it is erased before vi.mock's hoisted factory runs.
import type * as SharedApi from '@/shared/api';

/**
 * A transient refusal must not cost the whole dictation.
 *
 * THE READING THE 2026-11-06 CAPTURE DID NOT HAVE. `audio-16741o3rwu-2` was 12.12 s of real speech;
 * its first upload was answered 502 `UPSTREAM_UNAVAILABLE` at 1.02 s, and the listen produced ONE
 * `voice.transcribe` line — the client remembered the gateway's refusal as the recogniser's answer
 * and its two pipeline retries rethrew it without uploading. This file drives the shipped composer
 * and the shipped hook end to end (only the speech endpoint is doubled) and reads the upload count:
 * a refusal that is only a transport failure must reach the endpoint on the next attempt, while a
 * refusal that IS an answer about the clip must not.
 *
 * Three readings, one polarity each:
 *
 *   · 502 twice, then 200 ⇒ `transcribeVoice` called 3 times and the text lands in the composer;
 *   · 422 `NO_SPEECH_DETECTED` ⇒ called exactly once (the definitive face is unchanged);
 *   · 502 forever ⇒ 3 attempts, and the notice's technical detail still names 502 and
 *     `UPSTREAM_UNAVAILABLE` for the segment that was lost.
 *
 * AND THE TWO ARMS THAT TELL A NAMED ANSWER FROM A GATEWAY NUMBER. The route answers an upstream
 * refusal with the code its adapter classified and the status `PROVIDER_ERROR_STATUS` maps that code
 * to — `UNAUTHORIZED` is a 502 and `NOT_CONFIGURED` is a 503. Neither is a lost upload, so each must
 * cost exactly one attempt; a classifier that looked at the status first would retry both and print
 * the same 3 as the genuinely transient `UPSTREAM_UNAVAILABLE` 502 above. The two 502 arms sharing a
 * status are the point: only the code can separate them.
 */

const { transcribeVoice } = vi.hoisted(() => ({ transcribeVoice: vi.fn() }));

vi.mock('@/shared/api', async (importOriginal) => {
  const actual = await importOriginal<typeof SharedApi>();
  return {
    transcribeVoice,
    // The raw-corpus upload the hook fires after a listen; doubled so this whole-module mock stays
    // complete. It is never awaited, so its absence cannot affect a reading.
    captureRawVoice: vi.fn(),
    synthesizeVoice: vi.fn(),
    voiceConfigSignature: () => 'test-signature',
    // The recogniser's answer is read through the shipping parse; only the endpoint is cut.
    parseTranscriptionResponse: actual.parseTranscriptionResponse,
    effectivePauseCuesDeclaration: () => actual.effectivePauseCuesDeclaration(),
  };
});

// The mic button only renders when the backend says a voice provider is configured.
vi.mock('@/modules/chat-support/hooks/useVoiceAvailable', () => ({ useVoiceAvailable: () => true }));

// The shipped defaults: debug off, trim off, VAD on, no silence/inactivity overrides.
vi.mock('@/shared/voice/voiceDebug', () => ({
  isVoiceDebugEnabled: () => false,
  isVoiceTrimEnabled: () => false,
  isVoiceVadEnabled: () => true,
  voiceDebugFlushSilenceSec: () => undefined,
  voiceDebugMinSegmentSec: () => undefined,
  voiceDebugIdleSec: () => undefined,
  voiceDebugOriginalCapSec: () => undefined,
}));

await i18next.use(initReactI18next).init({
  lng: 'en',
  fallbackLng: 'en',
  ns: ['chat'],
  defaultNS: 'chat',
  resources: { en: { chat: enChat } },
  interpolation: { escapeValue: false },
  react: { useSuspense: false },
});

/* ─── The recogniser, answered by hand ─────────────────────────────── */

/**
 * A successful answer in the shape the hook reads: one envelope for the transcript parse and one
 * clone for the record id the same answer carries.
 */
function answered(text: string): Response {
  const body = { text };
  return {
    ok: true,
    status: 200,
    json: async () => body,
    text: async () => JSON.stringify(body),
    clone: () => ({ json: async () => body }),
  } as unknown as Response;
}

/** A refusal: the status the route answered with and the semantic code its body carries. */
function refused(status: number, code: string): Response {
  const body = { code };
  return {
    ok: false,
    status,
    json: async () => body,
    text: async () => JSON.stringify(body),
    clone: () => ({ json: async () => body }),
  } as unknown as Response;
}

/* ─── The capture, faked ───────────────────────────────────────────── */

const fakeStream = { getTracks: () => [{ stop: () => undefined }] };
let capture = createFakeVoiceCapture();
let objectUrlCount = 0;

beforeEach(() => {
  vi.useFakeTimers();
  vi.setSystemTime(new Date('2026-01-01T00:00:00.000Z'));
  capture = createFakeVoiceCapture();
  Object.defineProperty(navigator, 'mediaDevices', {
    configurable: true,
    value: { getUserMedia: async () => fakeStream },
  });
  objectUrlCount = 0;
  URL.createObjectURL = (() => `blob:transient-${++objectUrlCount}`) as unknown as typeof URL.createObjectURL;
  URL.revokeObjectURL = (() => undefined) as unknown as typeof URL.revokeObjectURL;
  transcribeVoice.mockReset();
});

afterEach(() => {
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
  vi.useRealTimers();
});

/* ─── The composer, driven ─────────────────────────────────────────── */

/**
 * Every prop `ChatComposer` requires except the three the harness supplies per render. Repeated
 * rather than imported from a sibling test, so a fixture that moved there does not move this
 * file's reading with it.
 */
const composerProps: Omit<
  React.ComponentProps<typeof ChatComposer>,
  'input' | 'onInputChange' | 'onVoiceTranscript'
> = {
  pendingPermissionRequests: [],
  handlePermissionDecision: () => undefined,
  handleGrantToolPermission: () => ({ success: true }),
  activity: null,
  isLoading: false,
  onAbortSession: () => undefined,
  permissionMode: 'default',
  availablePermissionModes: ['default'],
  onSelectPermissionMode: () => undefined,
  providerLabel: 'Claude',
  effort: 'medium',
  availableEffortOptions: [],
  onSelectEffort: () => undefined,
  model: 'test-model',
  availableModelOptions: [],
  onSelectModel: () => undefined,
  modelsLoading: false,
  tokenBudget: null,
  onShowTokenUsage: () => undefined,
  slashCommandsCount: 0,
  onToggleCommandMenu: () => undefined,
  hasInput: false,
  onClearInput: () => undefined,
  onSubmit: () => undefined,
  isDragActive: false,
  queuedDraft: null,
  isEditingSentMessage: false,
  onCancelEditMessage: () => undefined,
  scheduledMessages: [],
  onScheduleMessage: () => undefined,
  onCancelScheduledMessage: () => undefined,
  onEditQueuedDraft: () => undefined,
  onDeleteQueuedDraft: () => undefined,
  attachedFiles: [],
  onRemoveAttachment: () => undefined,
  fileErrors: new Map<string, string>(),
  showFileDropdown: false,
  filteredFiles: [],
  selectedFileIndex: 0,
  onSelectFile: () => undefined,
  filteredCommands: [],
  selectedCommandIndex: 0,
  onCommandSelect: () => undefined,
  onCloseCommandMenu: () => undefined,
  isCommandMenuOpen: false,
  frequentCommands: [],
  getRootProps: () => ({}),
  getInputProps: () => ({}),
  openAttachmentPicker: () => undefined,
  inputHighlightRef: { current: null },
  renderInputWithMentions: () => null,
  textareaRef: { current: null },
  scope: 'session-a',
  projectId: null,
  isActive: true,
  onTextareaClick: () => undefined,
  onTextareaKeyDown: () => undefined,
  onTextareaPaste: () => undefined,
  onTextareaScrollSync: () => undefined,
  onTextareaInput: () => undefined,
  placeholder: 'Ask anything',
  isTextareaExpanded: false,
};

const ComposerHarness = ({ onVoiceTranscript }: {
  onVoiceTranscript: (text: string, send?: boolean) => void;
}) => {
  const [input, setInput] = React.useState('');
  return React.createElement(ChatComposer, {
    ...composerProps,
    voiceCaptureEngine: capture.engine,
    input,
    onInputChange: (event: { target: { value: string } }) => setInput(event.target.value),
    onVoiceTranscript: (text, send) => {
      onVoiceTranscript(text, send);
      setInput(text);
    },
  });
};

const TEXTAREA = '[data-slot="prompt-input-textarea"]';

/**
 * One listen through the composer's own buttons: three seconds of speech (below the segment
 * minimum, so the stop flushes one trailing segment), then the stop, then the clock advanced past
 * the pipeline's own backoff (250 ms + 500 ms) so a segment that retries really gets to.
 */
const recordOnce = async (view: ReturnType<typeof render>): Promise<void> => {
  await act(async () => {
    view.getByRole('button', { name: 'Voice input' }).click();
  });
  await act(async () => {
    capture.speak(3);
  });
  await act(async () => {
    view.getByRole('button', { name: 'Stop recording' }).click();
  });
  await act(async () => {
    await vi.advanceTimersByTimeAsync(1_000);
  });
};

const renderComposer = () =>
  render(React.createElement(ComposerHarness, { onVoiceTranscript: () => undefined }));

/* ─── AC1: transient refusals are re-uploaded; definitive ones are not ──────────────────────── */

test('AC1 a 502 twice then a 200 reaches the endpoint three times and the text lands', async () => {
  transcribeVoice
    .mockResolvedValueOnce(refused(502, 'UPSTREAM_UNAVAILABLE'))
    .mockResolvedValueOnce(refused(502, 'UPSTREAM_UNAVAILABLE'))
    .mockResolvedValueOnce(answered('k-transient-recovered'));

  const view = renderComposer();
  await recordOnce(view);

  const textarea = view.container.querySelector<HTMLTextAreaElement>(TEXTAREA);
  const calls = transcribeVoice.mock.calls.length;
  const committed = textarea?.value ?? '';

  console.log(
    `voice-transient-refusal retry=502,502,200 transcribeVoice-calls=${calls} ` +
      `composer=${JSON.stringify(committed)}`,
  );

  assert.equal(calls, 3, 'two transient refusals must be followed by a third real upload');
  assert.equal(committed, 'k-transient-recovered', 'the segment that recovered must reach the composer');
  view.unmount();
});

test('AC2 a 422 NO_SPEECH_DETECTED is definitive and costs exactly one upload', async () => {
  transcribeVoice.mockResolvedValue(refused(422, 'NO_SPEECH_DETECTED'));

  const view = renderComposer();
  await recordOnce(view);

  const calls = transcribeVoice.mock.calls.length;
  console.log(`voice-transient-refusal definitive=422,NO_SPEECH_DETECTED transcribeVoice-calls=${calls}`);

  assert.equal(calls, 1, 'an answer about this clip must not be re-uploaded');
  view.unmount();
});

test('AC1 a named UNAUTHORIZED refusal on a 502 is definitive and costs exactly one upload', async () => {
  transcribeVoice.mockResolvedValue(refused(502, 'UNAUTHORIZED'));

  const view = renderComposer();
  await recordOnce(view);

  const calls = transcribeVoice.mock.calls.length;
  // Same status as the persistent arm below, opposite verdict: the code, not the number, decides.
  console.log(`voice-transient-refusal definitive=502,UNAUTHORIZED transcribeVoice-calls=${calls}`);

  assert.equal(calls, 1, 'a refusal that names a semantic code is an answer, even when the proxy said 502');
  view.unmount();
});

test('AC2 a named NOT_CONFIGURED refusal on a 503 is definitive and costs exactly one upload', async () => {
  transcribeVoice.mockResolvedValue(refused(503, 'NOT_CONFIGURED'));

  const view = renderComposer();
  await recordOnce(view);

  const calls = transcribeVoice.mock.calls.length;
  console.log(`voice-transient-refusal definitive=503,NOT_CONFIGURED transcribeVoice-calls=${calls}`);

  assert.equal(calls, 1, '503 is not unconditionally transient: the named code takes precedence');
  view.unmount();
});

test('AC1 a persistent 502 is retried three times and the notice still names 502/UPSTREAM_UNAVAILABLE', async () => {
  transcribeVoice.mockResolvedValue(refused(502, 'UPSTREAM_UNAVAILABLE'));

  const view = renderComposer();
  await recordOnce(view);

  const calls = transcribeVoice.mock.calls.length;
  const notice = view.container.querySelector('[data-testid="voice-error-notice"]');
  const details = view.container.querySelector<HTMLDetailsElement>('[data-testid="voice-error-details"]');
  // The technical fold mounts its `<pre>` only while open; jsdom does not toggle `<details>` on a
  // summary click, so the component's own `onToggle` is driven with the event the browser sends.
  let technical = '';
  if (details) {
    details.open = true;
    await act(async () => {
      fireEvent(details, new Event('toggle'));
    });
    technical = view.container.querySelector('[data-testid="voice-error-technical"]')?.textContent ?? '';
  }

  console.log(
    `voice-transient-refusal persistent=502,UPSTREAM_UNAVAILABLE transcribeVoice-calls=${calls} ` +
      `notice=${notice !== null} technical=${JSON.stringify(technical)}`,
  );

  assert.equal(calls, 3, 'a transient refusal exhausted the pipeline budget and never short-circuited');
  assert.ok(notice !== null, 'the lost segment is still reported');
  assert.ok(technical.includes('502'), 'the technical detail names the status the upstream answered');
  assert.ok(technical.includes('UPSTREAM_UNAVAILABLE'), 'the technical detail names the semantic code');
  view.unmount();
});

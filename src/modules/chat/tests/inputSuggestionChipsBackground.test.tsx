import assert from 'node:assert/strict';

import { fireEvent, render } from '@testing-library/react';
import i18next from 'i18next';
import React from 'react';
import { initReactI18next } from 'react-i18next';
import { afterEach, beforeEach, describe, it, vi } from 'vitest';

import { ChatComposer } from '@/modules/chat-composer';
import { InputSuggestionChips } from '@/modules/chat-composer';
import { buildSuggestionChips } from '@/modules/chat-support';
import enChat from '@/modules/i18n/locales/en/chat.json';
import type { ComposerChipStrip } from '@/shared/types';

/**
 * The suggestion strip's background is NOT a click target: the strip lies over the
 * textarea, so every press that is not on a chip must reach the box underneath. The
 * listbox used to be `flex-1` (then `pointer-events-auto` with a routed
 * `onBackgroundPress`), which stretched it over the textarea and ate presses. jsdom
 * has no hit-testing, so the geometry half lives in the real-page DoD; here one leg
 * per contract:
 *
 * (a) a press on a chip is still cancelled (it neither moves the caret nor steals focus),
 * (b) clicking a chip accepts exactly that chip,
 * (c) the listbox takes no pointer itself and each chip does: that is what routes a
 *     press on the gaps, the spacer or the row end to the textarea,
 * (d) the listbox no longer carries `flex-1`, the root cause's class.
 */
vi.mock('@/shared/api', () => {
  const okJson = (data: unknown) => Promise.resolve({ ok: true, json: async () => data });
  return {
    api: {
      user: {
        drafts: () => okJson({ success: true, drafts: [] }),
        saveDraft: () => okJson({ success: true }),
        deleteDraft: () => okJson({ success: true }),
        preferences: () => okJson({ success: true, preferences: {} }),
        savePreferences: () => okJson({ success: true, preferences: {} }),
      },
      commands: { list: () => okJson({ success: true, commands: [] }) },
      files: { search: () => okJson({ success: true, files: [] }) },
      providers: {
        createSession: () => okJson({
          success: true,
          data: { sessionId: 'created-session', sessionName: 'created' },
        }),
        setSessionLifecycleMode: () => okJson({ success: true }),
        skills: () => okJson({ success: true, data: { skills: [] } }),
      },
    },
  };
});

vi.mock('@/modules/chat-support/hooks/useVoiceAvailable', () => ({ useVoiceAvailable: () => true }));

vi.mock('@/shared/voice/voiceDebug', () => ({
  isVoiceDebugEnabled: () => false,
  isVoiceTrimEnabled: () => false,
  isVoiceVadEnabled: () => true,
  voiceDebugFlushSilenceSec: () => undefined,
}));

vi.mock('@/modules/chat-voice/hooks/useVoiceInput', () => ({
  useVoiceInput: () => ({
    state: 'idle',
    toggle: () => undefined,
    stop: () => undefined,
    transcribeFile: () => undefined,
    clipSlot: null,
    clipPlayState: { original: 'idle', trimmed: 'idle' },
    toggleClipPlayback: () => undefined,
  }),
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

/** A real, cancelable mousedown so `defaultPrevented` is readable afterwards. */
const press = () => new MouseEvent('mousedown', { bubbles: true, cancelable: true });

const habitChips = () => buildSuggestionChips({ habitChips: ['第一', '第二'] });

const renderChips = (
  overrides: Partial<React.ComponentProps<typeof InputSuggestionChips>> = {},
) => render(React.createElement(InputSuggestionChips, {
  listId: 'suggestion-list',
  chips: habitChips(),
  selectedIndex: null,
  onAccept: () => undefined,
  ...overrides,
}));

beforeEach(() => {
  localStorage.clear();
});

afterEach(() => {
  vi.restoreAllMocks();
});

// ---------------------------------------------------------------------------
// The strip on its own — one leg per contract line
// ---------------------------------------------------------------------------

describe('suggestion strip background press', () => {
  it('(a) cancels a press on a chip', () => {
    const view = renderChips();

    const chip = view.getByRole('option', { name: '第一' });
    const mouseDown = press();
    chip.dispatchEvent(mouseDown);

    assert.equal(mouseDown.defaultPrevented, true);
  });

  it('(b) accepts the clicked chip with exactly that chip', () => {
    const onAccept = vi.fn();
    const view = renderChips({ onAccept });

    fireEvent.click(view.getByRole('option', { name: '第二' }));

    assert.deepEqual(
      onAccept.mock.calls.map(([chip]) => (chip as { text: string }).text),
      ['第二'],
    );
  });

  it('(c) takes no pointer on the listbox, only on each chip', () => {
    const view = renderChips();

    const tokens = (element: Element) => element.className.split(/\s+/).filter(Boolean);
    const listbox = view.getByRole('listbox');
    assert.equal(tokens(listbox).includes('pointer-events-none'), true);
    assert.equal(tokens(listbox).includes('pointer-events-auto'), false);
    for (const chip of view.getAllByRole('option')) {
      assert.equal(tokens(chip).includes('pointer-events-auto'), true);
    }
  });

  it('(d) keeps `flex-1` off the listbox, the class that stretched it over the textarea', () => {
    const view = renderChips();

    const listbox = view.getByRole('listbox');
    const tokens = listbox.className.split(/\s+/).filter(Boolean);
    assert.equal(tokens.includes('flex-1'), false);
  });
});

// ---------------------------------------------------------------------------
// Through the real composer: the routed press is what restores focus
// ---------------------------------------------------------------------------

const composerBaseProps = (): Record<string, unknown> => ({
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
  availableEffortOptions: [{ value: 'low' }, { value: 'medium' }, { value: 'high' }],
  onSelectEffort: () => undefined,
  model: 'test-model',
  availableModelOptions: [{ value: 'test-model', label: 'test-model' }],
  onSelectModel: () => undefined,
  modelsLoading: false,
  tokenBudget: null,
  onShowTokenUsage: vi.fn(),
  slashCommandsCount: 0,
  onToggleCommandMenu: vi.fn(),
  hasInput: false,
  onClearInput: () => undefined,
  onSubmit: () => undefined,
  isDragActive: false,
  queuedDraft: null,
  isEditingSentMessage: false,
  onCancelEditMessage: () => undefined,
  scheduledMessages: [],
  onScheduleMessage: vi.fn(),
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
  input: '',
  onVoiceTranscript: () => undefined,
  scope: 'session-a',
  projectId: null,
  isActive: true,
  onInputChange: () => undefined,
  onTextareaClick: () => undefined,
  onTextareaKeyDown: () => undefined,
  onTextareaPaste: () => undefined,
  onTextareaScrollSync: () => undefined,
  onTextareaInput: () => undefined,
  placeholder: 'Ask anything',
  isTextareaExpanded: false,
  chipStrip: baseChipStrip(),
});

/**
 * The one chip prop the composer takes. The default draws the two habit chips so
 * the strip has a real listbox; individual cases narrow it.
 */
function baseChipStrip(overrides: Partial<ComposerChipStrip> = {}): ComposerChipStrip {
  return {
    visible: true,
    selectedIndex: null,
    listId: 'suggestion-list',
    chips: buildSuggestionChips({ habitChips: ['检查进展', '提交'] }),
    onAccept: () => undefined,
    suggestionsEnabled: true,
    suggestionsLoading: false,
    onRequestSuggestions: () => undefined,
    expansionChips: [],
    onAcceptExpansionChip: () => undefined,
    ...overrides,
  };
}

describe('composer wiring', () => {
  it('(e) draws the strip in the textarea\'s own cell with nothing but the chips taking the pointer', () => {
    const textareaRef = React.createRef<HTMLTextAreaElement>();
    const view = render(React.createElement(ChatComposer, {
      ...composerBaseProps(),
      textareaRef,
    } as unknown as React.ComponentProps<typeof ChatComposer>));

    const textarea = view.container.querySelector('textarea');
    assert.ok(textarea, 'the composer must render a textarea');
    // Compare booleans, not the elements: a failing `assert.equal` on two DOM
    // nodes serialises them, and the message alone can exhaust the worker.
    assert.equal(textareaRef.current === textarea, true, 'the composer binds the ref to its own textarea');

    const strip = view.container.querySelector<HTMLElement>('[data-slot="input-suggestion-chips"]');
    assert.ok(strip, 'the strip is drawn over the empty box');
    assert.equal(strip.style.gridArea, textarea.style.gridArea, 'the strip names the textarea\'s own cell');
    const tokens = (element: Element) => element.className.split(/\s+/).filter(Boolean);
    assert.equal(tokens(strip).includes('pointer-events-none'), true, 'the wrapper takes no pointer');
    assert.equal(tokens(view.getByRole('listbox')).includes('pointer-events-none'), true, 'the listbox takes no pointer');
  });
});

// ---------------------------------------------------------------------------
// A quoted chip is NOT drawn in the composer any more
// ---------------------------------------------------------------------------

/**
 * The inline chip mode is retired: a live transcript selection is drawn by the
 * transcript's own floating action, not by the composer. The quoted chip may
 * still be present in the strip DATA — the floating action uses the one
 * acceptance entry — but the composer draws nothing for it, never switches the
 * textarea/mirror layers, and never lets it switch the empty box into the
 * shared-line strip on its own.
 */
const RETIRED_INLINE_CHIP_SELECTOR = '[data-slot="inline-quote-chip"]';
const RETIRED_INLINE_SPACER_SELECTOR = '[data-slot="inline-quote-chip-spacer"]';

const quotedChips = () => buildSuggestionChips({ quotedText: '选中的原文' });

const renderComposerOverStrip = (overrides: Record<string, unknown> = {}) => render(React.createElement(
  ChatComposer,
  {
    ...composerBaseProps(),
    chipStrip: baseChipStrip({ chips: quotedChips() }),
    ...overrides,
  } as unknown as React.ComponentProps<typeof ChatComposer>,
));

describe('a quoted chip over a non-empty box', () => {
  it('(a) draws no inline chip and does not switch the visible text layer', () => {
    const view = renderComposerOverStrip({ input: '选中的原文\n\n' });

    const textarea = view.container.querySelector('textarea');
    assert.ok(textarea, 'the composer must render a textarea');
    assert.equal(
      view.container.querySelector(RETIRED_INLINE_CHIP_SELECTOR) === null,
      true,
      'the retired inline chip must not be drawn',
    );
    assert.equal(
      view.container.querySelector(RETIRED_INLINE_SPACER_SELECTOR) === null,
      true,
      'the mirror must carry no chip placeholder',
    );
    assert.equal(textarea.getAttribute('data-inline-chip-mode'), null);
    const mirror = view.container.querySelector('div.chat-input-placeholder');
    assert.ok(mirror);
    assert.ok(mirror.className.includes('text-transparent'), 'the mirror stays the invisible layer');
  });

  it('(b) leaves the empty-box layout unchanged', () => {
    const view = renderComposerOverStrip({
      input: '',
      chipStrip: baseChipStrip({ chips: buildSuggestionChips({ habitChips: ['检查进展'] }) }),
    });

    const textarea = view.container.querySelector('textarea');
    assert.ok(textarea);
    assert.equal(
      view.container.querySelector(RETIRED_INLINE_CHIP_SELECTOR) === null,
      true,
      'the empty box has no inline chip',
    );
    assert.ok(view.getByRole('listbox'), 'the empty box keeps the chip row');
  });

  it('(c) never moves into the text flow as the box gains text', () => {
    // A quoted chip alone no longer lights up the drawn strip: that switch was
    // what changed the textarea's rows (and therefore its height) on selection.
    const view = renderComposerOverStrip({ input: '' });
    assert.equal(view.queryByRole('listbox'), null, 'a selection alone draws no composer strip');
    assert.equal(view.container.querySelector(RETIRED_INLINE_CHIP_SELECTOR) === null, true);

    view.rerender(React.createElement(ChatComposer, {
      ...composerBaseProps(),
      input: '选中的原文\n\n',
      chipStrip: baseChipStrip({ chips: quotedChips() }),
    } as unknown as React.ComponentProps<typeof ChatComposer>));

    assert.equal(
      view.container.querySelector(RETIRED_INLINE_CHIP_SELECTOR) === null,
      true,
      'the filled box draws no inline chip either',
    );
    assert.equal(view.container.querySelector(RETIRED_INLINE_SPACER_SELECTOR) === null, true);
  });
});

// ---------------------------------------------------------------------------
// Deleting the reserved 48px row must not change the empty-box layout at all
// ---------------------------------------------------------------------------

describe('empty-box layout', () => {
  it('keeps the textarea and mirror class lists byte-for-byte unchanged', () => {
    const view = renderComposerOverStrip({ input: '' });

    const textarea = view.container.querySelector('textarea');
    assert.ok(textarea);
    const mirror = view.container.querySelector('div.chat-input-placeholder');
    assert.ok(mirror);

    assert.equal(
      textarea.className,
      'chat-input-placeholder block max-h-[40vh] w-full resize-none overflow-y-auto bg-transparent px-4 py-2 text-sm leading-6 text-foreground placeholder-muted-foreground/50 focus:outline-none sm:max-h-[min(300px,45vh)]',
    );
    assert.equal(
      mirror.className,
      'chat-input-placeholder block w-full whitespace-pre-wrap break-words px-4 py-2 text-sm leading-6 text-transparent',
    );
  });
});

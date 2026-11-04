import assert from 'node:assert/strict';

import { act, fireEvent, render } from '@testing-library/react';
import i18next from 'i18next';
import { useCallback, useEffect, useRef, useState } from 'react';
import { initReactI18next } from 'react-i18next';
import { afterEach, beforeEach, describe, it, vi } from 'vitest';

import { useSuggestionChips } from '@/modules/chat-composer';
import type { UseSuggestionChipsResult } from '@/modules/chat-composer';
import type { SuggestionDisplayConditions } from '@/modules/chat-support';
import { TranscriptSelectionAction } from '@/modules/chat/transcript/TranscriptSelectionAction';
import enChat from '@/modules/i18n/locales/en/chat.json';
import zhChat from '@/modules/i18n/locales/zh-CN/chat.json';

/**
 * The transcript's floating selection action, one rule per case.
 *
 * jsdom lays nothing out, so the selection's rectangle and the pane's rectangle
 * are stubbed; everything else is real — a real DOM Range, a real Selection, real
 * listeners and the real composer acceptance hook. That keeps the tests about
 * this module's rules (anchor, clamp, hide, press, accept) rather than about
 * jsdom's geometry.
 */

vi.mock('@/modules/chat-composer/hooks/useReplySuggestions', () => ({
  REPLY_SUGGESTIONS_MAX_EXPANSION_DEPTH: 5,
  useReplySuggestions: () => ({
    enabled: false,
    status: null,
    firstDraw: { chips: [], draw: 0, loading: false, redraw: async () => true },
    expansion: {
      enabled: false,
      chips: [],
      source: null,
      loading: false,
      depth: 0,
      canExpand: false,
      request: () => undefined,
      clear: () => undefined,
    },
    reportEvent: () => undefined,
  }),
}));

await i18next.use(initReactI18next).init({
  lng: 'en',
  fallbackLng: 'en',
  ns: ['chat'],
  defaultNS: 'chat',
  resources: {
    en: { chat: enChat },
    'zh-CN': { chat: zhChat },
  },
  interpolation: { escapeValue: false },
  react: { useSuspense: false },
});

type TestRect = {
  left: number;
  top: number;
  right: number;
  bottom: number;
  width: number;
  height: number;
};

const rect = (left: number, top: number, width: number, height: number): TestRect => ({
  left,
  top,
  right: left + width,
  bottom: top + height,
  width,
  height,
});

/** Mutable geometry the stubs read, so one case can move the anchor or the pane. */
const geometry = {
  selection: rect(100, 200, 120, 20),
  pane: rect(0, 0, 800, 600),
  viewportWidth: 1280,
  viewportHeight: 800,
};

/** Applies the next geometry the tests read back. */
const setGeometry = (next: Partial<typeof geometry>) => {
  Object.assign(geometry, next);
};

const setViewport = (width: number, height: number) => {
  geometry.viewportWidth = width;
  geometry.viewportHeight = height;
  Object.defineProperty(window, 'innerWidth', { configurable: true, value: width });
  Object.defineProperty(window, 'innerHeight', { configurable: true, value: height });
};

/** Attaches the stubbed pane rectangle; runs during commit, before layout effects. */
const attachPane = (node: HTMLDivElement | null) => {
  if (node === null) {
    return;
  }
  Object.defineProperty(node, 'getBoundingClientRect', {
    configurable: true,
    value: () => geometry.pane as unknown as DOMRect,
  });
};

/** Selects the whole text of the transcript paragraph — a real DOM Range. */
const selectPassage = (length: number) => {
  const paragraph = document.querySelector('[data-transcript-content] p');
  assert.ok(paragraph, 'the harness must render a transcript paragraph');
  const textNode = paragraph.firstChild;
  assert.ok(textNode, 'the paragraph must carry a text node');
  const range = document.createRange();
  range.setStart(textNode, 0);
  range.setEnd(textNode, Math.min(length, textNode.textContent?.length ?? length));
  const selection = window.getSelection();
  assert.ok(selection, 'jsdom must expose a Selection');
  selection.removeAllRanges();
  selection.addRange(range);
  document.dispatchEvent(new Event('selectionchange'));
};

const collapseSelection = () => {
  const selection = window.getSelection();
  selection?.removeAllRanges();
  act(() => {
    document.dispatchEvent(new Event('selectionchange'));
  });
};

const dispatchScroll = () => {
  act(() => {
    window.dispatchEvent(new Event('scroll'));
  });
};

const dispatchResize = () => {
  act(() => {
    window.dispatchEvent(new Event('resize'));
  });
};

const buttonOf = (container: HTMLElement): HTMLButtonElement | null =>
  container.querySelector<HTMLButtonElement>('[data-slot="transcript-selection-action"]');

type ActionHarnessProps = {
  selectionText: string | null;
  passage: string;
  onAccept: (selectionText: string) => void;
};

/** The action over a real transcript column, with the pane rectangle stubbed. */
function ActionHarness({ selectionText, passage, onAccept }: ActionHarnessProps) {
  const scrollRef = useRef<HTMLDivElement | null>(null);
  const attach = useCallback((node: HTMLDivElement | null) => {
    scrollRef.current = node;
    attachPane(node);
  }, []);
  return (
    <div ref={attach}>
      <div data-transcript-content>
        <p>{passage}</p>
      </div>
      <TranscriptSelectionAction
        selectionText={selectionText}
        scrollContainerRef={scrollRef}
        onAccept={onAccept}
      />
    </div>
  );
}

/**
 * Mounts the action with a live selection: first render (no recorded passage),
 * select the real Range, then render the recorded passage so the action mounts
 * and measures — exactly the order `useTranscriptSelection` commits in.
 */
const showAction = (options: {
  passage?: string;
  selectionLength?: number;
  onAccept?: (selectionText: string) => void;
} = {}) => {
  const passage = options.passage ?? '选中的原文';
  const onAccept = options.onAccept ?? vi.fn();
  const view = render(
    <ActionHarness selectionText={null} passage={passage} onAccept={onAccept} />,
  );
  selectPassage(options.selectionLength ?? passage.length);
  view.rerender(
    <ActionHarness selectionText={passage} passage={passage} onAccept={onAccept} />,
  );
  return { view, onAccept, passage };
};

beforeEach(() => {
  geometry.selection = rect(100, 200, 120, 20);
  geometry.pane = rect(0, 0, 800, 600);
  setViewport(1280, 800);
  // Browsers implement this on Range; jsdom's is a zero box. The stub is the
  // test's layout engine.
  Object.defineProperty(Range.prototype, 'getBoundingClientRect', {
    configurable: true,
    writable: true,
    value: () => geometry.selection as unknown as DOMRect,
  });
});

afterEach(async () => {
  vi.restoreAllMocks();
  window.getSelection()?.removeAllRanges();
  document.body.innerHTML = '';
  await i18next.changeLanguage('en');
});

// ---------------------------------------------------------------------------
// (1) a real, fixed-width, accessible button anchored to the passage
// ---------------------------------------------------------------------------

describe('fixed-width anchored action', () => {
  it('renders a real button whose width does not depend on the copy or the passage', async () => {
    const en = showAction({ passage: 'First selected passage' });
    const enButton = buttonOf(en.view.container);
    assert.ok(enButton, 'the action must be drawn for a live transcript selection');
    assert.equal(enButton.tagName, 'BUTTON');
    assert.equal(enButton.getAttribute('type'), 'button');
    assert.equal(enButton.style.width, '160px', 'the width is fixed, not content-sized');
    assert.equal(enButton.getAttribute('title'), en.passage, 'the complete passage is in the tooltip');
    assert.equal(
      enButton.textContent?.trim(),
      i18next.t('input.suggestions.suggestForSelection'),
      'the visible copy is the existing selection wording',
    );

    // The same fixed box under a different locale and a different passage length.
    await act(async () => {
      await i18next.changeLanguage('zh-CN');
    });
    en.view.rerender(
      <ActionHarness
        selectionText={en.passage}
        passage={en.passage}
        onAccept={en.onAccept}
      />,
    );
    const zhButton = buttonOf(en.view.container);
    assert.ok(zhButton);
    assert.equal(zhButton.style.width, '160px', 'the Chinese copy reads the same width');
    assert.equal(
      zhButton.textContent?.trim(),
      i18next.t('input.suggestions.suggestForSelection'),
    );
    en.view.unmount();

    const longer = showAction({ passage: '这是一段明显更长的、被选中的助手回答文字' });
    const longerButton = buttonOf(longer.view.container);
    assert.ok(longerButton);
    assert.equal(longerButton.style.width, '160px', 'a longer passage reads the same width');
  });

  it('sits above the passage, and drops below it near the top of the viewport', () => {
    const { view } = showAction();
    const button = buttonOf(view.container);
    assert.ok(button);
    // selection: left 100, width 120, top 200 → centred at 160, 8px above with a 32px box.
    assert.equal(button.style.left, '80px');
    assert.equal(button.style.top, '160px');

    setGeometry({ selection: rect(100, 4, 120, 20) });
    dispatchScroll();
    assert.equal(button.style.top, '32px', 'no room above: the action drops below the passage');
    assert.equal(button.style.left, '80px');
  });

  it('clamps into the viewport on both axes', () => {
    setViewport(400, 300);
    setGeometry({ selection: rect(360, 240, 30, 20) });
    const { view } = showAction();
    const button = buttonOf(view.container);
    assert.ok(button);
    // max left = 400 - 160 - 8 = 232; max top = 300 - 32 - 8 = 260 (above the selection).
    assert.equal(button.style.left, '232px', 'the right edge stays inside the viewport');
    assert.equal(button.style.top, '200px', 'the box sits above the passage and inside the viewport');
    const left = Number.parseFloat(button.style.left);
    const top = Number.parseFloat(button.style.top);
    assert.ok(left + 160 <= 400 - 8, 'the box never crosses the right margin');
    assert.ok(top >= 8 && top + 32 <= 300 - 8, 'the box never crosses a vertical margin');
  });
});

// ---------------------------------------------------------------------------
// (2) the action follows the anchor and disappears when it cannot
// ---------------------------------------------------------------------------

describe('anchor tracking and invalidation', () => {
  it('re-anchors on transcript scroll and on window resize', () => {
    const { view } = showAction();
    const button = buttonOf(view.container);
    assert.ok(button);
    assert.equal(button.style.top, '160px');

    setGeometry({ selection: rect(100, 320, 120, 20) });
    dispatchScroll();
    assert.equal(button.style.top, '280px', 'a scrolled transcript moves the anchor');

    setViewport(400, 300);
    setGeometry({ selection: rect(360, 200, 30, 20) });
    dispatchResize();
    assert.equal(button.style.left, '232px', 'a resize re-clamps the anchor');
  });

  it('hides when no passage is recorded', () => {
    const view = render(
      <ActionHarness selectionText={null} passage="选中的原文" onAccept={() => undefined} />,
    );
    selectPassage(5);
    view.rerender(
      <ActionHarness selectionText={null} passage="选中的原文" onAccept={() => undefined} />,
    );
    assert.equal(buttonOf(view.container) === null, true, 'no recorded passage means no action');
  });

  it('hides for a collapsed selection even while a passage is still recorded', () => {
    const { view } = showAction();
    assert.ok(buttonOf(view.container));

    collapseSelection();
    assert.equal(buttonOf(view.container) === null, true, 'a collapsed selection leaves no button');
  });

  it('hides for a selection outside the transcript', () => {
    const outside = document.createElement('div');
    outside.textContent = '输入框或侧栏里的字';
    document.body.appendChild(outside);

    const view = render(
      <ActionHarness selectionText="选中的原文" passage="选中的原文" onAccept={() => undefined} />,
    );
    const textNode = outside.firstChild;
    assert.ok(textNode);
    const range = document.createRange();
    range.setStart(textNode, 0);
    range.setEnd(textNode, 5);
    const selection = window.getSelection();
    selection?.removeAllRanges();
    selection?.addRange(range);
    act(() => {
      document.dispatchEvent(new Event('selectionchange'));
    });
    assert.equal(buttonOf(view.container) === null, true, 'a selection outside the transcript draws no action');
  });

  it('hides when the anchor node unmounts', () => {
    const { view } = showAction();
    assert.ok(buttonOf(view.container));

    const content = view.container.querySelector('[data-transcript-content]');
    assert.ok(content);
    act(() => {
      content.remove();
      // Node removal does not fire selectionchange in every engine; the action
      // also watches the DOM, but the assertion is that either path ends hidden.
      document.dispatchEvent(new Event('selectionchange'));
    });
    assert.equal(buttonOf(view.container) === null, true, 'an unmounted anchor leaves no button');
  });

  it('hides once the passage scrolls out of the transcript pane', () => {
    const { view } = showAction();
    assert.ok(buttonOf(view.container));

    // The pane now shows the top 100px; the selection lives at y=200.
    setGeometry({ pane: rect(0, 0, 800, 100) });
    dispatchScroll();
    assert.equal(buttonOf(view.container) === null, true, 'a selection outside the pane draws nothing');
  });
});

// ---------------------------------------------------------------------------
// (3) press keeps the selection; click accepts exactly once
// ---------------------------------------------------------------------------

describe('press and click', () => {
  it('cancels pointer and mouse down so the native selection survives the press', () => {
    const { view, passage } = showAction();
    const button = buttonOf(view.container);
    assert.ok(button);

    const mouseDown = new MouseEvent('mousedown', { bubbles: true, cancelable: true });
    button.dispatchEvent(mouseDown);
    assert.equal(mouseDown.defaultPrevented, true);

    const pointerDown = new Event('pointerdown', { bubbles: true, cancelable: true });
    button.dispatchEvent(pointerDown);
    assert.equal(pointerDown.defaultPrevented, true);

    assert.equal(window.getSelection()?.toString(), passage, 'the selection is still there for the click');
  });

  it('calls the acceptance entry exactly once per click', () => {
    const onAccept = vi.fn();
    const { view, passage } = showAction({ onAccept });
    const button = buttonOf(view.container);
    assert.ok(button);

    fireEvent.click(button);

    assert.equal(onAccept.mock.calls.length, 1);
    assert.deepEqual(onAccept.mock.calls[0], [passage]);
  });
});

// ---------------------------------------------------------------------------
// (4) the real acceptance entry: fill, focus, caret, never send
// ---------------------------------------------------------------------------

const idleConditions = (): SuggestionDisplayConditions => ({
  isLoading: false,
  isOccupied: false,
  isCommandMenuOpen: false,
  isFileMenuOpen: false,
  hasQueuedDraft: false,
  hasAttachments: false,
});

const frames: FrameRequestCallback[] = [];
const flushFrames = () => {
  act(() => {
    frames.splice(0).forEach((callback) => callback(0));
  });
};

type AcceptanceHarnessProps = {
  passage: string;
  selectionText: string | null;
  setInputFromHistory: (value: string) => void;
  submit: () => void;
  apiRef: { current: UseSuggestionChipsResult | null };
};

/** The real chip hook + a real textarea + the real action, wired like ChatInterface. */
function AcceptanceHarness({
  passage,
  selectionText,
  setInputFromHistory,
  submit,
  apiRef,
}: AcceptanceHarnessProps) {
  const [input, setInput] = useState('');
  const inputValueRef = useRef('');
  const textareaRef = useRef<HTMLTextAreaElement>(null);
  const scrollRef = useRef<HTMLDivElement | null>(null);
  const write = useCallback((value: string) => {
    setInput(value);
    inputValueRef.current = value;
    setInputFromHistory(value);
  }, [setInputFromHistory]);
  const chipState = useSuggestionChips({
    input,
    inputValueRef,
    textareaRef,
    setInputFromHistory: write,
    submit,
    conditions: idleConditions(),
    draftScope: 'session-a',
    sessionId: 'session-a',
    lastAssistantMessageId: 'assistant-1',
    quotedSelection: selectionText,
  });
  useEffect(() => {
    apiRef.current = chipState;
  });
  // The same synthetic chip ChatInterface builds for the floating action.
  const acceptChip = chipState.chipStrip.onAccept;
  const accept = useCallback((text: string) => {
    acceptChip({ id: 'quoted-0', text, source: 'quoted', index: 0 });
  }, [acceptChip]);
  const attach = useCallback((node: HTMLDivElement | null) => {
    scrollRef.current = node;
    attachPane(node);
  }, []);
  return (
    <div ref={attach}>
      <div data-transcript-content>
        <p>{passage}</p>
      </div>
      <textarea
        ref={textareaRef}
        aria-label="composer"
        value={input}
        onChange={(event) => write(event.target.value)}
      />
      <TranscriptSelectionAction
        selectionText={selectionText}
        scrollContainerRef={scrollRef}
        onAccept={accept}
      />
    </div>
  );
}

describe('the quoted acceptance entry', () => {
  beforeEach(() => {
    frames.length = 0;
    vi.stubGlobal('requestAnimationFrame', (callback: FrameRequestCallback) => {
      frames.push(callback);
      return frames.length;
    });
  });

  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it('inserts the passage, focuses the caret after it, accepts once and never sends', () => {
    const setInputFromHistory = vi.fn();
    const submit = vi.fn();
    const apiRef: { current: UseSuggestionChipsResult | null } = { current: null };
    const passage = '选中的原文';

    const view = render(
      <AcceptanceHarness
        passage={passage}
        selectionText={null}
        setInputFromHistory={setInputFromHistory}
        submit={submit}
        apiRef={apiRef}
      />,
    );
    selectPassage(passage.length);
    view.rerender(
      <AcceptanceHarness
        passage={passage}
        selectionText={passage}
        setInputFromHistory={setInputFromHistory}
        submit={submit}
        apiRef={apiRef}
      />,
    );

    const textarea = view.getByRole('textbox', { name: 'composer' }) as HTMLTextAreaElement;
    const button = buttonOf(view.container);
    assert.ok(button, 'the action is drawn for the live selection');

    fireEvent.click(button);
    flushFrames();

    assert.equal(setInputFromHistory.mock.calls.length, 1, 'the acceptance entry ran exactly once');
    assert.equal(setInputFromHistory.mock.calls[0]?.[0], passage);
    assert.equal(textarea.value, passage);
    assert.equal(document.activeElement, textarea, 'the composer takes focus');
    assert.equal(textarea.selectionStart, passage.length, 'the caret sits after the passage');
    assert.equal(textarea.selectionEnd, passage.length);
    assert.equal(submit.mock.calls.length, 0, 'accepting a quotation never sends');
  });
});

// ---------------------------------------------------------------------------
// (5) the selection is not a composer strip chip
// ---------------------------------------------------------------------------

describe('no automatic quoted chip in the composer', () => {
  it('keeps the quoted source out of the strip while still advertising the selection', () => {
    const apiRef: { current: UseSuggestionChipsResult | null } = { current: null };
    render(
      <AcceptanceHarness
        passage="选中的原文"
        selectionText="选中的原文"
        setInputFromHistory={() => undefined}
        submit={() => undefined}
        apiRef={apiRef}
      />,
    );

    const strip = apiRef.current?.chipStrip;
    assert.ok(strip, 'the chip hook must have rendered');
    assert.equal(
      strip.chips.some((chip) => chip.source === 'quoted'),
      false,
      'a live selection no longer draws a quoted chip in the composer',
    );
    assert.equal(strip.hasTranscriptSelection, true, 'the Suggest affordance still knows about it');
  });
});

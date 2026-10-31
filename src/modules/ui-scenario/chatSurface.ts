/**
 * The transcript and composer readings a chat scenario asserts.
 *
 * A chat scenario is about what a person SEES after an edit — which turns are still in
 * the conversation and which one the composer is about to resend — so the reading is the
 * rendered transcript itself, not a second copy of the message list. The rows are found by
 * the attributes the transcript already draws (`data-message-style` on every row), the body
 * text is the node the bubble renders its Markdown into, and the composer is the product's
 * own textarea slot. Nothing here is a test-only mirror that could disagree with the page.
 *
 * Editing is driven the way a person does it: find the user row whose visible text names the
 * turn, press that row's edit control, and let the product's own `onEditMessage` fill the
 * composer. The scenario then reads `composerText` — the value the next send would submit.
 */

/** One rendered turn: the row's role and the text a reader can see. */
export type ScenarioChatMessage = {
  /** `user`, `assistant`, or the row type the transcript drew (e.g. `tool`). */
  role: string;
  /** The row's rendered body text, whitespace-normalised. */
  text: string;
};

/** The transcript + composer reading, taken from the rendered page. */
export type ScenarioChatReading = {
  /** Non-empty message rows in the order the transcript draws them. */
  messages: ScenarioChatMessage[];
  /**
   * The composer textarea's current value.
   *
   * `''` both when the composer holds nothing and when no composer is mounted. A scenario that
   * has just asked the page to edit a turn asserts a non-empty value, so the two cannot be
   * confused where it matters.
   */
  composerText: string;
};

/** The transcript pane the rows live in; the same selector the scroll criteria use. */
const PANE_SELECTOR = '.chat-messages-pane';
/** The composer's textarea, named by the product's own slot rather than a placeholder. */
const COMPOSER_SELECTOR = '[data-slot="prompt-input-textarea"]';
/** Every transcript row carries this; its value is `user` or the message type. */
const ROW_SELECTOR = '[data-message-style]';
/** The user bubble's Markdown root — the timestamp and controls sit outside it. */
const USER_BODY_SELECTOR = '[dir="auto"]';
/** The assistant bubble's Markdown root. */
const ASSISTANT_BODY_SELECTOR = '.prose';

/** Collapses the whitespace Markdown rendering introduces, so a scenario matches one sentence. */
function normalise(text: string | null | undefined): string {
  return (text ?? '').replace(/\s+/g, ' ').trim();
}

/** The node whose text is the row's body, or the row itself when the shape is unknown. */
function bodyNode(row: Element, role: string): Element | null {
  if (role === 'user') {
    return row.querySelector(USER_BODY_SELECTOR) ?? row;
  }
  if (role === 'assistant') {
    return row.querySelector(ASSISTANT_BODY_SELECTOR) ?? row;
  }
  return row;
}

/**
 * Reads the transcript and composer as they are drawn now.
 *
 * Only non-empty rows are reported: a pending placeholder or a divider is not a turn, and a
 * count assertion over them would say less than it appears to. A page with no transcript pane
 * answers an empty reading rather than throwing, which is what lets a scenario assert the
 * conversation after navigating back to it.
 */
export function readChatReading(): ScenarioChatReading {
  if (typeof document === 'undefined') {
    return { messages: [], composerText: '' };
  }

  const pane = document.querySelector(PANE_SELECTOR);
  const messages: ScenarioChatMessage[] = [];
  if (pane instanceof HTMLElement) {
    for (const row of Array.from(pane.querySelectorAll(ROW_SELECTOR))) {
      const role = row.getAttribute('data-message-style') ?? '';
      const text = normalise(bodyNode(row, role)?.textContent);
      if (text !== '') {
        messages.push({ role, text });
      }
    }
  }

  const composer = document.querySelector(COMPOSER_SELECTOR);
  const composerText = composer instanceof HTMLTextAreaElement ? composer.value : '';

  return { messages, composerText };
}

/**
 * Presses the edit control of the first user row whose visible text contains `text`.
 *
 * The control is the row's first button: the transcript renders "edit and resend" before the
 * copy affordance, and selecting by position keeps the verb working under any UI language —
 * the product's own `aria-label` is localised, the row's structure is not. A row without an
 * edit control is one the app does not offer to edit (no transcript anchor), which is an
 * honest `false` rather than a simulated edit the product never performed.
 */
export function startEditingMessage(text: string): boolean {
  if (typeof document === 'undefined') {
    return false;
  }
  const pane = document.querySelector(PANE_SELECTOR);
  if (!(pane instanceof HTMLElement)) {
    return false;
  }
  const wanted = normalise(text);
  for (const row of Array.from(pane.querySelectorAll(`${ROW_SELECTOR}[data-message-style="user"]`))) {
    if (!normalise(bodyNode(row, 'user')?.textContent).includes(wanted)) {
      continue;
    }
    const button = row.querySelector('button');
    if (!(button instanceof HTMLButtonElement)) {
      return false;
    }
    button.click();
    return true;
  }
  return false;
}

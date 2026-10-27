/**
 * The cockpit cards view's reading and the `cockpitCard.*` drive verbs.
 *
 * WHY THIS IS A SIBLING FILE. The cards contract is a self-contained slice of the scenario
 * surface — a reading taken from the list's own `data-cockpit-cards` declaration, and five verbs
 * that press the controls a person presses. The surface's own criterion caps every source file at
 * 800 lines, so the slice lives here and `scenarioSurface` imports it; nothing else does (the
 * module's `index.ts` barrel re-exports the two public types, so the frontend boundary rule still
 * has one cross-module import path).
 *
 * THE READING IS THE LIST'S OWN DECLARATION. `CockpitCardReading` is what `cockpit-card-ui-core`
 * publishes — visible ids in order, the selection, each card's shown option and confirm target,
 * and the open Details card. The open CONFIRM card is a sibling panel the list draws, naming its
 * card in `data-card-id`; joining that declaration here reads the page rather than inferring "a
 * confirmation is open" from a class or a rendered sentence.
 *
 * THE CARDS ARE DRIVEN THROUGH THE CONTROLS A PERSON PRESSES. The `cockpitCard.*` verbs locate the
 * card's own buttons and textarea and dispatch the same events a press/typing produces; they never
 * write the list's published reading. That is why a scenario can assert a card reading changed
 * only because the product's controller handled the press — a verb that faked the reading would
 * leave the page's real state where it was.
 *
 * A card step IS TWO PRESSES. React 18 commits a discrete event's update after the handler
 * returns, so the option button / own-reply editor / confirm card a first press renders does not
 * exist yet in `drive`. `drive` presses the trigger and hands the rest to `settle`, which the
 * runner awaits after every step ({@link settleCardStep}). Both halves are still real DOM presses.
 */
import type { CockpitCardReading } from '@/modules/cockpit/contract';

/**
 * The payload of one card command: the card it addresses, plus what the command types or chooses.
 * A card is named by the provider id the list publishes (`data-cockpit-card-id`), never by index —
 * the visible order can change under a filter, and an index would then name a different card.
 */
export type ScenarioCockpitCardTarget = {
  cardId: string;
};

/** The cards view's reading: the list's own declaration plus the open confirm card. */
export type ScenarioCockpitCardsReading = CockpitCardReading & {
  /** The card whose confirm panel is open, or `null` when no confirmation is open. */
  confirmOpenCardId: string | null;
};

/**
 * The rest of a card step: presses that only exist after the first press's commit has landed.
 *
 * `drive` stays synchronous, so it returns this function instead of awaiting; the surface's
 * `settle` runs it after crossing a task boundary.
 */
export type CardContinuation = () => Promise<void>;

/** True when `value` is a string or `null` — the shape every one of the reading's id fields takes. */
function isIdOrNull(value: unknown): boolean {
  return value === null || typeof value === 'string';
}

/**
 * Parses a `data-cockpit-cards` attribute; anything missing or malformed reads as `null`.
 *
 * THE SHAPE IS CHECKED, NOT CAST. The attribute is JSON written by another module, so a partial
 * or hand-edited value is a real possibility; returning it as a reading would make a scenario
 * assert on fields that were never published. Every field this surface exposes is validated, and
 * an object that does not match answers `null` — 「不猜」.
 */
function parseCardsReading(raw: string | null): CockpitCardReading | null {
  if (raw === null) {
    return null;
  }
  let parsed: unknown;
  try {
    parsed = JSON.parse(raw);
  } catch {
    return null;
  }
  if (parsed === null || typeof parsed !== 'object' || Array.isArray(parsed)) {
    return null;
  }
  const record = parsed as Record<string, unknown>;
  const visibleIds = record.visibleCardIds;
  if (!Array.isArray(visibleIds) || !visibleIds.every((id) => typeof id === 'string')) {
    return null;
  }
  if (!isIdOrNull(record.selectedCardId) || !isIdOrNull(record.detailsOpenCardId)) {
    return null;
  }
  if (!isIdOrNull(record.projectFilter)) {
    return null;
  }
  if (typeof record.density !== 'string' || typeof record.typeFilter !== 'string') {
    return null;
  }
  const cards = record.cards;
  if (!Array.isArray(cards)) {
    return null;
  }
  const cardsValid = cards.every((entry) => {
    if (entry === null || typeof entry !== 'object' || Array.isArray(entry)) {
      return false;
    }
    const card = entry as Record<string, unknown>;
    return (
      typeof card.id === 'string'
      && isIdOrNull(card.shownOptionId)
      && typeof card.ownReply === 'boolean'
      && isIdOrNull(card.confirmOptionId)
      && isIdOrNull(card.confirmLabel)
    );
  });
  return cardsValid ? (parsed as CockpitCardReading) : null;
}

/**
 * The card whose confirm panel is open, read from the panel's own `data-card-id`.
 *
 * WHY THIS IS NOT IN THE ATTRIBUTE: `data-cockpit-cards` describes the list's cards, and the
 * open confirm card is a sibling panel the list draws (one at a time). It carries its card id
 * for exactly this kind of consumer, so this joins the two declarations the page already draws.
 */
function readConfirmOpenCardId(): string | null {
  if (typeof document === 'undefined') {
    return null;
  }
  const panel = document.querySelector('[data-testid="cockpit-card-confirm-panel"]');
  return panel instanceof HTMLElement ? panel.getAttribute('data-card-id') : null;
}

/** Reads the cards list the page drew, or `null` when its declaration is absent or malformed. */
export function readCockpitCardsReading(list: HTMLElement): ScenarioCockpitCardsReading | null {
  const published = parseCardsReading(list.getAttribute('data-cockpit-cards'));
  return published === null ? null : { ...published, confirmOpenCardId: readConfirmOpenCardId() };
}

// ── The cards view's controls ────────────────────────────────────────────────
//
// Every helper below finds an element the product draws and dispatches the same event a person
// produces. None of them touch `data-cockpit-cards`: the reading changes only because the
// product's controller handled the press, which is what makes the drive verbs honest.

/** The cards list's root as the page drew it, or `null` when the cards view is not mounted. */
function cardsRoot(): HTMLElement | null {
  if (typeof document === 'undefined') {
    return null;
  }
  const list = document.querySelector('[data-cockpit-cards]');
  return list instanceof HTMLElement ? list : null;
}

/** The one control under `scope` whose `data-testid` is exactly `testId`, or `null`. */
function controlWithTestId(scope: ParentNode, testId: string): HTMLElement | null {
  for (const candidate of Array.from(scope.querySelectorAll('[data-testid]'))) {
    if (candidate instanceof HTMLElement && candidate.getAttribute('data-testid') === testId) {
      return candidate;
    }
  }
  return null;
}

/**
 * The card article the step addresses.
 *
 * Matched by the card id the list publishes, not by position: the visible order changes with the
 * filters, so an index would silently address another card after a filter change.
 */
function cardElement(cardId: string): HTMLElement | null {
  const root = cardsRoot();
  if (root === null) {
    return null;
  }
  for (const candidate of Array.from(root.querySelectorAll('[data-cockpit-card-id]'))) {
    if (
      candidate instanceof HTMLElement
      && candidate.getAttribute('data-cockpit-card-id') === cardId
    ) {
      return candidate;
    }
  }
  return null;
}

/** Presses a control, when the page drew it. */
function press(element: HTMLElement | null): boolean {
  if (element === null) {
    return false;
  }
  element.click();
  return true;
}

/**
 * The selection gesture: a press on the card body.
 *
 * The product selects on `pointerdown` (`onPointerDown` in `CockpitCard`), which is the first
 * event a real click produces. Dispatching the pointerdown itself is what a person's press does
 * to this card; a bare `click` would only reach the zone that opens Details.
 */
export function pressCardToSelect(cardId: string): boolean {
  const card = cardElement(cardId);
  if (card === null) {
    return false;
  }
  const init: MouseEventInit = { bubbles: true, cancelable: true };
  const event = typeof PointerEvent === 'function'
    ? new PointerEvent('pointerdown', init)
    : new MouseEvent('pointerdown', init);
  card.dispatchEvent(event);
  return true;
}

/** Opens the card's option dropdown when it is closed (pressing the trigger again would close it). */
function openCardDropdown(card: HTMLElement): void {
  const trigger = controlWithTestId(card, 'cockpit-card-option-trigger');
  if (trigger !== null && trigger.getAttribute('aria-expanded') !== 'true') {
    trigger.click();
  }
}

/** Writes into a textarea the way typing does: the native setter, then the `input` event React reads. */
function typeIntoTextarea(field: HTMLTextAreaElement, value: string): void {
  const setter = Object.getOwnPropertyDescriptor(HTMLTextAreaElement.prototype, 'value')?.set;
  if (setter === undefined) {
    return;
  }
  setter.call(field, value);
  field.dispatchEvent(new Event('input', { bubbles: true }));
}

/** How long a step waits for a control that a previous press was supposed to render. */
const CONTROL_WAIT_TIMEOUT_MS = 5_000;

/** A delay that also yields to the page's own work (the confirmation request's promise chain). */
function delay(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

/** Polls for one control under `scope`; `null` only after the deadline passes. */
async function waitForControl(
  scope: ParentNode,
  testId: string,
  timeout = CONTROL_WAIT_TIMEOUT_MS,
): Promise<HTMLElement | null> {
  const deadline = Date.now() + timeout;
  for (;;) {
    const control = controlWithTestId(scope, testId);
    if (control !== null) {
      return control;
    }
    if (Date.now() >= deadline) {
      return null;
    }
    await delay(10);
  }
}

/** Polls until one control leaves the DOM; `null` timeout just means it stayed. */
async function waitForControlToLeave(
  scope: ParentNode,
  testId: string,
  timeout = CONTROL_WAIT_TIMEOUT_MS,
): Promise<void> {
  const deadline = Date.now() + timeout;
  while (controlWithTestId(scope, testId) !== null) {
    if (Date.now() >= deadline) {
      return;
    }
    await delay(10);
  }
}

/** The confirm card currently open for `cardId`, or `null`. */
function confirmPanelFor(cardId: string): HTMLElement | null {
  const root = cardsRoot();
  if (root === null) {
    return null;
  }
  for (const candidate of Array.from(
    root.querySelectorAll('[data-testid="cockpit-card-confirm-panel"]'),
  )) {
    if (candidate instanceof HTMLElement && candidate.getAttribute('data-card-id') === cardId) {
      return candidate;
    }
  }
  return null;
}

/** Polls for the confirm card `cardId` opens; `null` when the press did not open one. */
async function waitForConfirmPanel(cardId: string): Promise<HTMLElement | null> {
  const deadline = Date.now() + CONTROL_WAIT_TIMEOUT_MS;
  for (;;) {
    const panel = confirmPanelFor(cardId);
    if (panel !== null) {
      return panel;
    }
    if (Date.now() >= deadline) {
      return null;
    }
    await delay(10);
  }
}

/**
 * Chooses one option: open the dropdown now, press the option's own button once it is committed.
 *
 * The second press cannot ride in the same task as the first: the option button is rendered by
 * the trigger's update, which React commits after this function returns.
 */
export function startShowingCardOption(cardId: string, optionId: string): CardContinuation | null {
  const card = cardElement(cardId);
  if (card === null) {
    return null;
  }
  openCardDropdown(card);
  return async () => {
    press(await waitForControl(card, `cockpit-card-option-${optionId}`));
  };
}

/** Switches the card to its own-reply editor, then types the reply into the body editor. */
export function startWritingCardOwnReply(cardId: string, text: string): CardContinuation | null {
  const card = cardElement(cardId);
  if (card === null) {
    return null;
  }
  openCardDropdown(card);
  return async () => {
    const trigger = await waitForControl(card, 'cockpit-card-own-reply-trigger');
    if (!press(trigger)) {
      return;
    }
    // The editor is also drawn inside the open dropdown; wait for that dropdown to close so the
    // typing lands in the body editor a person would use, not in the copy being unmounted.
    await waitForControlToLeave(card, 'cockpit-card-option-list');
    const editor = controlWithTestId(card, 'cockpit-card-own-reply-input');
    if (editor instanceof HTMLTextAreaElement) {
      typeIntoTextarea(editor, text);
    }
  };
}

/**
 * Requests a confirmation and sends it: the confirm bar's first press opens the confirm card,
 * and the card's own send button is the one that leaves the request.
 *
 * Returns `null` when the card is absent, or when its bar is absent or disabled — the card has
 * nothing to confirm, so no request may be synthesized. The panel is rendered as a sibling of the
 * cards and matched by its `data-card-id`, so a second card's panel is never pressed by mistake.
 */
export function startConfirmingCard(cardId: string): CardContinuation | null {
  const card = cardElement(cardId);
  if (card === null) {
    return null;
  }
  const bar = controlWithTestId(card, 'cockpit-card-confirm');
  if (bar === null || (bar instanceof HTMLButtonElement && bar.disabled)) {
    return null;
  }
  press(bar);
  return async () => {
    const panel = await waitForConfirmPanel(cardId);
    if (panel !== null) {
      press(controlWithTestId(panel, 'cockpit-card-confirm-send'));
    }
    await waitForConfirmToSettle();
  };
}

/** Opens the card's Details drawer: the whole upper body is the affordance. */
export function openCardDetails(cardId: string): boolean {
  const card = cardElement(cardId);
  return card === null ? false : press(controlWithTestId(card, 'cockpit-card-zone-a'));
}

/** How long `settle` waits for a card confirmation's request before letting the caller read. */
const CONFIRM_SETTLE_TIMEOUT_MS = 15_000;

/**
 * Waits until no confirm panel is open.
 *
 * The panel is the visible half of one confirmation: it opens on the first press and closes when
 * the request answers (success or failure). Nothing is in flight when no panel is open, so the
 * wait costs one DOM query in the common case.
 */
async function waitForConfirmToSettle(): Promise<void> {
  if (typeof document === 'undefined') {
    return;
  }
  const deadline = Date.now() + CONFIRM_SETTLE_TIMEOUT_MS;
  while (document.querySelector('[data-testid="cockpit-card-confirm-panel"]') !== null) {
    if (Date.now() >= deadline) {
      return;
    }
    await delay(25);
  }
}

/**
 * Completes the step a drive just started.
 *
 * The first press's update is committed in a microtask, so crossing a macrotask boundary is what
 * makes its rendered controls (and its own reading change) observable. The continuation then
 * presses those controls; the second boundary lets its commit land before the caller reads. A
 * confirmation already in flight is awaited too, so a scenario never exits under it.
 */
export async function settleCardStep(continuation: CardContinuation | null): Promise<void> {
  await delay(0);
  if (continuation !== null) {
    await continuation();
  }
  await delay(0);
  await waitForConfirmToSettle();
}

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
 * and the open Details card. The open CONFIRM state is not a separate panel: a card's own confirm
 * bar (or the Details drawer's bar for the same card) draws it in place and marks itself with
 * `data-confirm-pending="true"` plus `data-card-id`, so joining that bar reads the page rather
 * than inferring "a confirmation is open" from a class or a rendered sentence.
 *
 * THE CARDS ARE DRIVEN THROUGH THE CONTROLS A PERSON PRESSES. The `cockpitCard.*` verbs locate the
 * card's own buttons and textarea and dispatch the same events a press/typing produces; they never
 * write the list's published reading. That is why a scenario can assert a card reading changed
 * only because the product's controller handled the press — a verb that faked the reading would
 * leave the page's real state where it was.
 *
 * A card step IS TWO PRESSES. React 18 commits a discrete event's update after the handler
 * returns, so the option button / own-reply editor / confirm state a first press renders does not
 * exist yet in `drive`. `drive` presses the trigger and hands the rest to `settle`, which the
 * runner awaits after every step ({@link settleCardStep}). Both halves are still real DOM presses.
 */
import type { CockpitCardReading } from '@/modules/cockpit-contract';

/**
 * The payload of one card command: the card it addresses, plus what the command types or chooses.
 * A card is named by the provider id the list publishes (`data-cockpit-card-id`), never by index —
 * the visible order can change under a filter, and an index would then name a different card.
 */
export type ScenarioCockpitCardTarget = {
  cardId: string;
};

/** The cards view's reading: the list's own declaration plus the two list-level answers. */
export type ScenarioCockpitCardsReading = CockpitCardReading & {
  /** The card whose confirm bar is in its confirm state, or `null` when none is. */
  confirmOpenCardId: string | null;
  /**
   * The card whose dismiss bar is in its confirmation state, or `null` when none is.
   *
   * Drawn by the SAME control on the card row and in the Details drawer, so a scenario can prove
   * the drawer's first press opened the confirmation without inferring it from a label.
   */
  dismissOpenCardId: string | null;
  /**
   * The last dismiss answer's outcome, or `null` when there is no answer.
   *
   * A successful dismissal usually removes the card in the same read, so this list-level line is
   * the only reading that outlives the row it was pressed on.
   */
  dismissNoticeOk: boolean | null;
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
      && isIdOrNull(card.knowledgeState ?? null)
      && isIdOrNull(card.knowledgeVerificationState ?? null)
    );
  });
  return cardsValid ? (parsed as CockpitCardReading) : null;
}

/**
 * The card whose confirm bar is in its confirm state, read from that bar's own `data-card-id`.
 *
 * WHY THIS IS NOT IN THE ATTRIBUTE: `data-cockpit-cards` describes the list's cards, and the
 * confirm state is a property of ONE card's bar (the card's own, or the Details drawer's for the
 * same card) rather than of the list. The bar carries its card id and `data-confirm-pending` for
 * exactly this kind of consumer, so this joins the two declarations the page already draws.
 */
function readConfirmOpenCardId(): string | null {
  if (typeof document === 'undefined') {
    return null;
  }
  const bar = document.querySelector('[data-confirm-pending="true"]');
  return bar instanceof HTMLElement ? bar.getAttribute('data-card-id') : null;
}

/**
 * The last dismiss answer, read from the list-level line that survives the dismissed card.
 *
 * A notice is drawn only after a dismiss attempt; before that there is no answer to read, which
 * is `null` — distinct from a failed answer (`false`).
 */
function readDismissNoticeOk(): boolean | null {
  if (typeof document === 'undefined') {
    return null;
  }
  const notice = document.querySelector('[data-testid="cockpit-card-dismiss-notice"]');
  return notice instanceof HTMLElement ? notice.getAttribute('data-ok') === 'true' : null;
}

/**
 * The card whose dismiss bar is in its confirmation state, read from that bar's own
 * `data-card-id`.
 *
 * Both the card row's bar and the Details drawer's bar carry the same attributes, so this joins
 * the two declarations and reports one card — whichever surface the person pressed.
 */
function readDismissOpenCardId(): string | null {
  if (typeof document === 'undefined') {
    return null;
  }
  const bar = document.querySelector('[data-dismiss-pending="true"]');
  return bar instanceof HTMLElement ? bar.getAttribute('data-card-id') : null;
}

/** Reads the cards list the page drew, or `null` when its declaration is absent or malformed. */
export function readCockpitCardsReading(list: HTMLElement): ScenarioCockpitCardsReading | null {
  const published = parseCardsReading(list.getAttribute('data-cockpit-cards'));
  return published === null
    ? null
    : {
        ...published,
        confirmOpenCardId: readConfirmOpenCardId(),
        dismissOpenCardId: readDismissOpenCardId(),
        dismissNoticeOk: readDismissNoticeOk(),
      };
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

/** The confirm bar currently in its confirm state for `cardId`, or `null`. */
function pendingBarFor(cardId: string): HTMLElement | null {
  if (typeof document === 'undefined') {
    return null;
  }
  for (const candidate of Array.from(
    document.querySelectorAll('[data-confirm-pending="true"]'),
  )) {
    if (candidate instanceof HTMLElement && candidate.getAttribute('data-card-id') === cardId) {
      return candidate;
    }
  }
  return null;
}

/** Polls for the bar `cardId` turned into its confirm state; `null` when the press did not. */
async function waitForPendingBar(cardId: string): Promise<HTMLElement | null> {
  const deadline = Date.now() + CONTROL_WAIT_TIMEOUT_MS;
  for (;;) {
    const bar = pendingBarFor(cardId);
    if (bar !== null) {
      return bar;
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
 * Requests a confirmation and waits for it to leave: the bar's button is pressed, then the SEND
 * happens on its own.
 *
 * The first press turns the card's own confirm bar into one of two states IN PLACE — the button
 * keeps its element and position and only changes label/handler:
 *
 *   - A REVERSIBLE option starts the five second countdown (`data-confirm-mode="cancel"`); the
 *     verb presses nothing else and `settle` waits until the countdown expires and the request
 *     answers.
 *   - An IRREVERSIBLE option turns the button into 「confirm and send」 (`data-confirm-mode="send"`);
 *     the verb presses that SAME button again, exactly as a person confirming does.
 *
 * Nothing is drawn at list level, so there is no sibling panel to find.
 *
 * Returns `null` when the card is absent, or when its bar is absent or disabled — the card has
 * nothing to confirm, so no request may be synthesized.
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
    const pending = await waitForPendingBar(cardId);
    if (pending === null) {
      return;
    }
    // The SAME button: the card's own bar swaps its label and handler in place. Only the
    // irreversible state still needs a second press; a running countdown sends (or is cancelled)
    // by itself, so this verb leaves it alone.
    const send = controlWithTestId(card, 'cockpit-card-confirm');
    if (
      send !== null
      && send.getAttribute('data-confirm-mode') === 'send'
      && !(send instanceof HTMLButtonElement && send.disabled)
    ) {
      press(send);
    }
    await waitForConfirmToSettle();
  };
}

/** Opens the card's Details drawer: the whole upper body is the affordance. */
export function openCardDetails(cardId: string): boolean {
  const card = cardElement(cardId);
  return card === null ? false : press(controlWithTestId(card, 'cockpit-card-zone-a'));
}

/** The dismiss bar currently in its confirm state for `cardId`, or `null`. */
function dismissBarFor(cardId: string): HTMLElement | null {
  if (typeof document === 'undefined') {
    return null;
  }
  for (const candidate of Array.from(
    document.querySelectorAll('[data-dismiss-pending="true"]'),
  )) {
    if (candidate instanceof HTMLElement && candidate.getAttribute('data-card-id') === cardId) {
      return candidate;
    }
  }
  return null;
}

/** Polls for the dismiss bar `cardId` turned into its confirm state; `null` when it did not. */
async function waitForDismissBar(cardId: string): Promise<HTMLElement | null> {
  const deadline = Date.now() + CONTROL_WAIT_TIMEOUT_MS;
  for (;;) {
    const bar = dismissBarFor(cardId);
    if (bar !== null) {
      return bar;
    }
    if (Date.now() >= deadline) {
      return null;
    }
    await delay(10);
  }
}

/**
 * Polls until the card has left the list.
 *
 * A successful dismissal settles the provider's item, so the re-read that follows removes the
 * card. Waiting for that removal is what makes the step's own reading the settled one; a refusal
 * leaves the card in place and this wait simply expires (the step's visible-set assertion then
 * reports the truth).
 */
async function waitForCardToLeave(cardId: string): Promise<void> {
  const deadline = Date.now() + CONTROL_WAIT_TIMEOUT_MS;
  while (cardElement(cardId) !== null) {
    if (Date.now() >= deadline) {
      return;
    }
    await delay(10);
  }
}

/**
 * Discards a card and completes the confirmation: the first press opens the in-place dismiss
 * confirmation, the second presses 「Confirm discard」, and the step ends once the card has left
 * the list.
 *
 * This verb never presses the action/confirm bar: dismissing is the third choice, and the point
 * of the business scenario is that the card settles without answering it.
 *
 * Returns `null` when the card or its dismiss control is absent — a card that is not a
 * session-ask, or one locked while its feedback is pending, must not get a synthesized request.
 */
export function startDismissingCard(cardId: string): CardContinuation | null {
  const card = cardElement(cardId);
  if (card === null) {
    return null;
  }
  const trigger = controlWithTestId(card, 'cockpit-card-dismiss');
  if (trigger === null || (trigger instanceof HTMLButtonElement && trigger.disabled)) {
    return null;
  }
  press(trigger);
  return async () => {
    const bar = await waitForDismissBar(cardId);
    if (bar === null) {
      return;
    }
    const confirm = controlWithTestId(bar, 'cockpit-card-dismiss-confirm');
    if (confirm !== null && confirm instanceof HTMLButtonElement && confirm.disabled) {
      return;
    }
    press(confirm);
    await waitForCardToLeave(cardId);
  };
}

/**
 * The mounted Details drawer showing `cardId`, or `null`.
 *
 * The drawer declares the card it reads (`data-cockpit-card-details-id`), so a step addresses
 * the drawer that is actually showing the named card rather than whichever one was opened last.
 */
function detailsElement(cardId: string): HTMLElement | null {
  if (typeof document === 'undefined') {
    return null;
  }
  const details = document.querySelector('[data-testid="cockpit-card-details"]');
  return details instanceof HTMLElement
    && details.getAttribute('data-cockpit-card-details-id') === cardId
    ? details
    : null;
}

/**
 * Polls for one control INSIDE the drawer showing `cardId`; `null` when it never appeared.
 *
 * The lookup is scoped to the drawer on purpose: a floating drawer sits over a still-mounted
 * list whose card row draws the same dismiss confirmation, so a document-wide query would return
 * the ROW's button and the step would pass without the drawer offering one.
 */
async function waitForDetailsControl(
  cardId: string,
  testId: string,
): Promise<HTMLElement | null> {
  const deadline = Date.now() + CONTROL_WAIT_TIMEOUT_MS;
  for (;;) {
    const details = detailsElement(cardId);
    const control = details === null ? null : controlWithTestId(details, testId);
    if (control !== null) {
      return control;
    }
    if (Date.now() >= deadline) {
      return null;
    }
    await delay(10);
  }
}

/**
 * Opens the Details drawer's own dismiss confirmation — the first press, which sends nothing.
 *
 * Returns `null` when the drawer is not showing this card, or when it draws no dismiss control —
 * a card that is not a session-ask, a drawer opened without a dismiss transport, or a card whose
 * feedback already ran. A scenario must not synthesize a request the page does not offer.
 *
 * The step is deliberately split from the two second presses below: a single verb that pressed
 * 「confirm」 itself would pass on a page whose drawer never drew the confirmation at all.
 */
export function startOpeningDismissFromDetails(cardId: string): CardContinuation | null {
  const details = detailsElement(cardId);
  if (details === null) {
    return null;
  }
  const trigger = controlWithTestId(details, 'cockpit-card-details-dismiss');
  if (trigger === null || (trigger instanceof HTMLButtonElement && trigger.disabled)) {
    return null;
  }
  press(trigger);
  return async () => {
    await waitForDetailsControl(cardId, 'cockpit-card-details-dismiss-confirm');
  };
}

/**
 * Presses 「Confirm discard」 in the drawer's open confirmation and waits for the card to leave.
 *
 * Scoped to the drawer: a floating drawer sits over a still-mounted list whose row draws the
 * same confirmation, so a document-wide lookup could press the ROW's button and pass even if the
 * drawer offered no discard entry.
 */
export function startConfirmingDismissFromDetails(cardId: string): CardContinuation | null {
  const details = detailsElement(cardId);
  if (details === null) {
    return null;
  }
  const confirm = controlWithTestId(details, 'cockpit-card-details-dismiss-confirm');
  if (confirm === null || (confirm instanceof HTMLButtonElement && confirm.disabled)) {
    return null;
  }
  press(confirm);
  return async () => {
    await waitForCardToLeave(cardId);
  };
}

/**
 * Presses 「Cancel」 in the drawer's open confirmation — the leg that proves the first press
 * sends nothing and leaves the card, its shown option and its draft untouched.
 */
export function startCancellingDismissFromDetails(cardId: string): CardContinuation | null {
  const details = detailsElement(cardId);
  if (details === null) {
    return null;
  }
  const cancel = controlWithTestId(details, 'cockpit-card-details-dismiss-cancel');
  if (cancel === null || (cancel instanceof HTMLButtonElement && cancel.disabled)) {
    return null;
  }
  press(cancel);
  return async () => {
    await delay(0);
  };
}

/** One cards-view drive step: each step carries exactly one card command. */
export type CockpitCardDriveStep =
  | { 'cockpitCard.select': string }
  | { 'cockpitCard.showOption': ScenarioCockpitCardTarget & { optionId: string } }
  | { 'cockpitCard.ownReply': ScenarioCockpitCardTarget & { text: string } }
  | { 'cockpitCard.confirm': string }
  | { 'cockpitCard.openDetails': string }
  | { 'cockpitCard.dismiss': string }
  | { 'cockpitCard.openDismissFromDetails': string }
  | { 'cockpitCard.confirmDismissFromDetails': string }
  | { 'cockpitCard.cancelDismissFromDetails': string };

/**
 * Runs one cards-view step's first press and reports what the surface must finish.
 *
 * The dispatch lives here rather than in `scenarioSurface` so every `cockpitCard.*` verb — its
 * control lookup, its continuation and its action name — is declared in the same slice as the
 * reading, and the surface file stays under its 800-line criterion.
 */
export function dispatchCockpitCardStep(step: CockpitCardDriveStep): {
  action: string;
  pendingCardAction: CardContinuation | null;
} {
  if ('cockpitCard.select' in step) {
    pressCardToSelect(step['cockpitCard.select']);
    return { action: 'cockpitCard.select', pendingCardAction: null };
  }
  if ('cockpitCard.showOption' in step) {
    const { cardId, optionId } = step['cockpitCard.showOption'];
    return {
      action: 'cockpitCard.showOption',
      pendingCardAction: startShowingCardOption(cardId, optionId),
    };
  }
  if ('cockpitCard.ownReply' in step) {
    const { cardId, text } = step['cockpitCard.ownReply'];
    return {
      action: 'cockpitCard.ownReply',
      pendingCardAction: startWritingCardOwnReply(cardId, text),
    };
  }
  if ('cockpitCard.confirm' in step) {
    return {
      action: 'cockpitCard.confirm',
      pendingCardAction: startConfirmingCard(step['cockpitCard.confirm']),
    };
  }
  if ('cockpitCard.dismiss' in step) {
    return {
      action: 'cockpitCard.dismiss',
      pendingCardAction: startDismissingCard(step['cockpitCard.dismiss']),
    };
  }
  if ('cockpitCard.openDismissFromDetails' in step) {
    return {
      action: 'cockpitCard.openDismissFromDetails',
      pendingCardAction: startOpeningDismissFromDetails(
        step['cockpitCard.openDismissFromDetails'],
      ),
    };
  }
  if ('cockpitCard.cancelDismissFromDetails' in step) {
    return {
      action: 'cockpitCard.cancelDismissFromDetails',
      pendingCardAction: startCancellingDismissFromDetails(
        step['cockpitCard.cancelDismissFromDetails'],
      ),
    };
  }
  if ('cockpitCard.confirmDismissFromDetails' in step) {
    return {
      action: 'cockpitCard.confirmDismissFromDetails',
      pendingCardAction: startConfirmingDismissFromDetails(
        step['cockpitCard.confirmDismissFromDetails'],
      ),
    };
  }
  openCardDetails(step['cockpitCard.openDetails']);
  return { action: 'cockpitCard.openDetails', pendingCardAction: null };
}

/** How long `settle` waits for a card confirmation's request before letting the caller read. */
const CONFIRM_SETTLE_TIMEOUT_MS = 15_000;

/**
 * Waits until no confirm bar is in its confirm state.
 *
 * The pending bar is the visible half of one confirmation: it appears on the first press and
 * leaves when the request answers (success or failure) or the retreat clears it. Nothing is in
 * flight once no bar is pending, so the wait costs one DOM query in the common case.
 */
async function waitForConfirmToSettle(): Promise<void> {
  if (typeof document === 'undefined') {
    return;
  }
  const deadline = Date.now() + CONFIRM_SETTLE_TIMEOUT_MS;
  while (document.querySelector('[data-confirm-pending="true"]') !== null) {
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

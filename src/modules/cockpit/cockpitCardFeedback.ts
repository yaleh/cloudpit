/**
 * The card feedback lifecycle's client reading: when a sent card becomes 「未确认收到」, which
 * cards are locked, and how many are waiting for the provider's receipt.
 *
 * WHY THIS IS A SEPARATE MODULE. The controller owns the snapshot; the card and the list's
 * header both need the SAME derivation of "has the 2-minute window passed", and the criterion
 * needs to state it with an injected clock instead of waiting. One pure function read by all
 * three is what keeps the button, the status line and the header count from disagreeing.
 *
 * THE TIME IS THE INJECTED CLOCK'S. `sentAt` is the server's timestamp (persisted with the
 * overlay), and the comparison is against the controller's `now` — a component never runs its
 * own timer.
 */
import type { CockpitCard, CockpitCardFeedback } from '@/shared/types';

/** How long a sent feedback waits for the provider's receipt before offering a resend. */
export const FEEDBACK_RECEIPT_TIMEOUT_MS = 120_000;

/** The two readings before a receipt: still waiting, or past the 2-minute window. */
export type CockpitCardFeedbackPhase = 'sent' | 'unconfirmed';

/** The reason a card's options and confirm bar are locked while its feedback is unconfirmed. */
export const FEEDBACK_LOCKED_REASON = '等待 fleet 确认收到（已发出）';

/** Which phase one overlay reads at `now`. */
export function feedbackPhaseOf(
  feedback: CockpitCardFeedback,
  now: number,
): CockpitCardFeedbackPhase {
  const sentAt = Date.parse(feedback.sentAt);
  if (!Number.isFinite(sentAt)) return 'sent';
  return now - sentAt >= FEEDBACK_RECEIPT_TIMEOUT_MS ? 'unconfirmed' : 'sent';
}

/** Every card still waiting for a receipt, mapped to its phase at `now`. */
export function feedbackPhasesOf(
  cards: readonly CockpitCard[],
  now: number,
): Record<string, CockpitCardFeedbackPhase> {
  const phases: Record<string, CockpitCardFeedbackPhase> = {};
  for (const card of cards) {
    if (card.feedback !== undefined) phases[card.id] = feedbackPhaseOf(card.feedback, now);
  }
  return phases;
}

/** How many cards are waiting for the provider's receipt (the header's second number). */
export function awaitingFeedbackCount(cards: readonly CockpitCard[]): number {
  return cards.reduce((count, card) => (card.feedback === undefined ? count : count + 1), 0);
}

/**
 * Whether the resend control is offered at `now`. Only after the window, and only when the
 * provider declared a feedback executor — a provider without one states why instead.
 */
export function canResendFeedback(card: CockpitCard, now: number): boolean {
  if (card.feedback === undefined || !card.feedback.canResend) return false;
  return feedbackPhaseOf(card.feedback, now) === 'unconfirmed';
}

/** Whether a card's options and confirm bar are locked by its feedback overlay. */
export function isFeedbackLocked(card: CockpitCard): boolean {
  return card.feedback !== undefined;
}

import type { CockpitCard } from '@/shared/types';

/**
 * Folding cards that ask the SAME question in the SAME session into one visible card.
 *
 * WHY THIS EXISTS. The provider (the fleet) opens one attention entry per
 * 「project + category + session:message」, so an assistant that asks the same question twice —
 * two message ids, two entries — draws two identical cards. Until the provider's dedup key is the
 * session plus the question's text, the cockpit's own fallback is to keep one card in place and
 * state honestly that the question was asked N times, with the earlier cards one press away.
 * Folding happens with the current list — no second list, no second page.
 *
 * WHAT COUNTS AS THE SAME QUESTION. The subject's session id plus the normalized ask text:
 * leading/trailing whitespace dropped, every run of whitespace collapsed to one space, and the
 * sentence-final punctuation stripped, so 「…staging directory?」 and 「…staging directory」 are
 * one question. `ask` is the question; a card whose digest did not resolve falls back to
 * `situation`.
 *
 * WHEN NO CARD STATES A QUESTION. Two different asks that both failed to resolve are DIFFERENT
 * questions, so the wording is not the only identity available: the fleet opens one entry per
 * 「session:message」 and writes that message id into `contentRef.ref` as `sessionId#messageId`.
 * A questionless card is therefore grouped by that message id — two entries naming the same
 * message are the same ask, two message ids are two asks. A card whose contentRef is absent or
 * carries no `#messageId` has no stated identity and stands alone: the fold never guesses one by
 * session alone, which would merge unrelated asks into one card saying 「asked N times」.
 *
 * WHAT IS KEPT. The card whose `surfacedAt` is latest — it is the newest statement of the same
 * question, and its age is the one the person has not seen yet; ties keep the card earlier in the
 * provider's order. The folded cards stay in provider order, so an expansion draws them where
 * they already were rather than appending them.
 *
 * The module is pure: no React, no clock, no transport. The controller applies the grouping in
 * `normalize`; a criterion can group any list without a browser.
 */

/**
 * The cards folded behind one kept card.
 *
 * `hidden` is in provider order (the order the person would have seen them), and `count` is the
 * number of times the question was asked (`hidden.length + 1`), which is what the card states.
 */
export type CockpitCardDuplicateGroup = {
  /** The grouping key: the session id plus the normalized question or the content's message id. */
  key: string;
  /** The normalized question, or `null` for a group of cards that state no wording. */
  question: string | null;
  /** The card left in the list: latest `surfacedAt`, provider order breaking a tie. */
  keep: string;
  /** The folded cards, in provider order. */
  hidden: string[];
  /** How many times the question was asked: `hidden.length + 1`. */
  count: number;
};

/** The sentence-final punctuation stripped before two questions are compared. */
const SENTENCE_END = /[.!?。！？…]+$/u;

/**
 * The question text two cards must share to fold: whitespace normalized and sentence-final
 * punctuation dropped. An empty result is 「no question」 — the same reading as an absent field,
 * because a provider that sends only punctuation has not stated a question either.
 */
export function normalizeCockpitCardQuestion(text: string): string {
  return text
    .trim()
    .replace(/\s+/gu, ' ')
    .replace(SENTENCE_END, '')
    .trim();
}

/**
 * The question a card states, or `null` when it states none.
 *
 * `ask` wins; `situation` is the fallback for a card whose ask digest never resolved. Both are
 * read only for their words — the card's kind, facts and options never decide a fold.
 */
export function cockpitCardQuestionOf(card: CockpitCard): string | null {
  const ask = card.ask === undefined ? '' : normalizeCockpitCardQuestion(card.ask);
  if (ask !== '') return ask;
  const situation =
    card.situation === undefined ? '' : normalizeCockpitCardQuestion(card.situation);
  return situation === '' ? null : situation;
}

/** `surfacedAt` as a comparable instant; an unparseable date sorts as the oldest reading. */
function surfacedAtOf(card: CockpitCard): number {
  const parsed = Date.parse(card.surfacedAt);
  return Number.isNaN(parsed) ? Number.NEGATIVE_INFINITY : parsed;
}

/**
 * The message id a card's `contentRef` names, or `null` when it names none.
 *
 * The wire shape is `ref = sessionId[#messageId]` (the fleet's own `session:message` entry
 * identity, projected by the server). Only the id after the `#` is the ask's identity: a ref that
 * is a bare session id says which conversation, not which question, and an absent ref says
 * nothing at all. Both return `null`, so the caller keeps such a card out of every fold.
 */
export function cockpitCardContentIdentity(card: CockpitCard): string | null {
  const ref = card.contentRef?.ref?.trim() ?? '';
  const separator = ref.indexOf('#');
  if (separator < 0) return null;
  const messageId = ref.slice(separator + 1).trim();
  return messageId === '' ? null : messageId;
}

/**
 * The identity a card shares with another card of the same session, within one namespace:
 * `q:` a normalized question, `m:` a contentRef message id, `id:` the card's own id (a group of
 * one). The prefixes keep the namespaces apart, so a question that happens to read like a message
 * id can never fold onto that message's cards.
 */
function cardIdentityOf(card: CockpitCard, question: string | null): string {
  if (question !== null) return `q:${question}`;
  const messageId = cockpitCardContentIdentity(card);
  return messageId === null ? `id:${card.id}` : `m:${messageId}`;
}

/**
 * Groups the cards that ask the same question in the same session, returning only the groups
 * that actually fold something. A group needs a session id: two cards with no session have no
 * shared subject, so they are never folded on their wording alone.
 *
 * A card that states a question is identified by that question. A questionless card is
 * identified by its contentRef message id; one that names no message id is grouped under its own
 * id, so it can never fold — there is no identity to share.
 *
 * The returned groups follow the order in which their KEPT card appears in `cards`, so a caller
 * that applies them in order never reorders the list.
 */
export function cockpitCardDuplicateGroups(
  cards: readonly CockpitCard[],
): CockpitCardDuplicateGroup[] {
  const byKey = new Map<string, CockpitCard[]>();
  const keyOrder: string[] = [];
  const questions = new Map<string, string | null>();

  for (const card of cards) {
    const sessionId = card.subject.sessionId?.trim() ?? '';
    if (sessionId === '') continue;
    const question = cockpitCardQuestionOf(card);
    // A stated question wins and keeps the existing behaviour (same wording folds even across
    // message ids); the fallbacks identify a card whose wording never resolved without ever
    // folding two different asks.
    const key = `${sessionId}\u0000${cardIdentityOf(card, question)}`;
    const members = byKey.get(key);
    if (members === undefined) {
      byKey.set(key, [card]);
      keyOrder.push(key);
      questions.set(key, question);
    } else {
      members.push(card);
    }
  }

  const folds: CockpitCardDuplicateGroup[] = [];
  for (const key of keyOrder) {
    const members = byKey.get(key)!;
    if (members.length < 2) continue;
    // The latest surfacing wins; a tie keeps the card that came first in provider order.
    let keepIndex = 0;
    for (let index = 1; index < members.length; index += 1) {
      if (surfacedAtOf(members[index]!) > surfacedAtOf(members[keepIndex]!)) keepIndex = index;
    }
    const keep = members[keepIndex]!;
    const hidden = members.filter((_, index) => index !== keepIndex).map((card) => card.id);
    folds.push({
      key,
      question: questions.get(key) ?? null,
      keep: keep.id,
      hidden,
      count: hidden.length + 1,
    });
  }

  // A fold's position is the kept card's provider position, so two groups always keep the order
  // the list already draws.
  const position = new Map(cards.map((card, index) => [card.id, index]));
  return folds.sort(
    (left, right) => (position.get(left.keep) ?? 0) - (position.get(right.keep) ?? 0),
  );
}

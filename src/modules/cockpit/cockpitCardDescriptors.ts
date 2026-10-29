import type { TFunction } from 'i18next';

import type {
  CockpitCard,
  CockpitCardFact,
  CockpitCardKind,
  CockpitCardOptionSource,
  CockpitCardVizKind,
} from '@/shared/types';

// The viz vocabulary lives on the wire (`src/shared/types.ts`) because a provider states the
// shape it wants; the descriptor table is the client-side authority on which kind may draw one.
// Re-exported here so the table and its consumers keep one import site for the vocabulary.
export type { CockpitCardVizKind } from '@/shared/types';

/**
 * What the cockpit knows about a card kind without asking the provider: the short badge drawn in
 * the header with its scarce colour, and the one small visualization the card's A zone may draw.
 *
 * WHY A TABLE AND NOT A BRANCH. `CockpitCard.kind` is an open string, so a provider may ship a
 * kind this build has never heard of. Rendering looks the kind up here and falls back to
 * {@link DEFAULT_COCKPIT_CARD_DESCRIPTOR} — the fallback is the point, not an afterthought: an
 * unknown kind must draw as an ordinary card with its facts and options, never throw and never
 * lose the confirmation path. Adding a kind is one row; no provider name appears anywhere.
 *
 * COLOUR IS SCARCE (INTERACTION-PRINCIPLES D.11): a tone is drawn on the kind badge only. The
 * irreversible confirmation style is the other colour user, and it is not a kind.
 */

/** The scarce colour vocabulary the badge draws with. */
export type CockpitCardTone = 'ask' | 'multi' | 'need' | 'stuck' | 'fix' | 'decision' | 'other';

export type CockpitCardDescriptor = {
  /** The i18n key of the badge drawn in the card header. The kind label, translated. */
  labelKey: string;
  /** The i18n key of the short uppercase type mark (ASK, STK, FIX…) in the header. */
  badgeKey: string;
  /** Which scarce tone the badge wears. */
  tone: CockpitCardTone;
  /** The small visualization this kind draws, or `null` when it draws none. */
  viz: CockpitCardVizKind | null;
};

/**
 * The badge's colour classes, one static entry per tone so Tailwind keeps every class.
 * Light and dark variants are paired; only the badge (and the irreversible bar) use colour.
 */
const TONE_CLASSES: Record<CockpitCardTone, string> = {
  ask: 'bg-amber-100 text-amber-800 dark:bg-amber-900/40 dark:text-amber-200',
  multi: 'bg-sky-100 text-sky-800 dark:bg-sky-900/40 dark:text-sky-200',
  need: 'bg-teal-100 text-teal-800 dark:bg-teal-900/40 dark:text-teal-200',
  stuck: 'bg-red-100 text-red-800 dark:bg-red-900/40 dark:text-red-200',
  fix: 'bg-violet-100 text-violet-800 dark:bg-violet-900/40 dark:text-violet-200',
  decision: 'bg-emerald-100 text-emerald-800 dark:bg-emerald-900/40 dark:text-emerald-200',
  other: 'bg-muted text-muted-foreground',
};

/** The badge's colour classes for a tone. */
export function cockpitCardToneClass(tone: CockpitCardTone): string {
  return TONE_CLASSES[tone];
}

/**
 * Every kind this build renders, each with the reading it is best summarized by.
 *
 * The visualization vocabulary is deliberately narrow: only a stalled session and a proposed
 * repair carry an `attempts` reading (the dots of what has already been tried). The other kinds
 * draw none — a reading the provider did not state is not invented here.
 */
const DESCRIPTORS: Record<CockpitCardKind, CockpitCardDescriptor> = {
  ask: { labelKey: 'cockpit.cardKindAsk', badgeKey: 'cockpit.cardBadgeAsk', tone: 'ask', viz: null },
  multi: { labelKey: 'cockpit.cardKindMulti', badgeKey: 'cockpit.cardBadgeMulti', tone: 'multi', viz: null },
  need: { labelKey: 'cockpit.cardKindNeed', badgeKey: 'cockpit.cardBadgeNeed', tone: 'need', viz: null },
  stuck: { labelKey: 'cockpit.cardKindStuck', badgeKey: 'cockpit.cardBadgeStuck', tone: 'stuck', viz: 'attempts' },
  fix: { labelKey: 'cockpit.cardKindFix', badgeKey: 'cockpit.cardBadgeFix', tone: 'fix', viz: 'attempts' },
  decision: { labelKey: 'cockpit.cardKindDecision', badgeKey: 'cockpit.cardBadgeDecision', tone: 'decision', viz: null },
};

/** The shape an unknown kind draws: a plain card, a generic badge, no viz. */
export const DEFAULT_COCKPIT_CARD_DESCRIPTOR: CockpitCardDescriptor = {
  labelKey: 'cockpit.cardKindOther',
  badgeKey: 'cockpit.cardBadgeOther',
  tone: 'other',
  viz: null,
};

/**
 * The descriptor for a kind, known or not.
 *
 * `hasOwnProperty` rather than a bare lookup: a provider naming its kind `constructor` or
 * `toString` would otherwise receive a function from `Object.prototype` and the badge would
 * render as source code. The fallback is the same row an unknown kind gets.
 */
export function cockpitCardDescriptor(kind: string): CockpitCardDescriptor {
  if (!Object.prototype.hasOwnProperty.call(DESCRIPTORS, kind)) {
    return DEFAULT_COCKPIT_CARD_DESCRIPTOR;
  }
  return DESCRIPTORS[kind as CockpitCardKind];
}

/**
 * Where an option's recommendation came from, as the row states it (D.13, D.14): the assistant's
 * own recommendation is the mechanical default (●), a judge's is a suggestion (○), and a
 * provider-stated option carries no marker because it is neither.
 */
export const COCKPIT_SOURCE_LABEL_KEY: Record<CockpitCardOptionSource, string> = {
  assistant: 'cockpit.cardSourceAssistant',
  judge: 'cockpit.cardSourceJudge',
  provider: 'cockpit.cardSourceProvider',
};

/**
 * The glyph an option's consequence tag draws, by the tag's fixed-vocabulary kind.
 *
 * The table is the authority so no component branches on a tag string. A kind this build does
 * not know (including `fit`, whose own text is the word 「适合」) draws no glyph: the provider's
 * text stays readable as it is.
 */
const TAG_ICONS: Record<string, string> = {
  undo: '↺',
  cost: '◷',
  irreversible: '⚠',
  // The pre-vocabulary name for an irreversible consequence; kept so an older provider's cards
  // still carry the warning glyph.
  warn: '⚠',
};

/** The glyph for a tag kind, or `null` when the kind draws none. */
export function cockpitTagIcon(kind: string): string | null {
  return Object.prototype.hasOwnProperty.call(TAG_ICONS, kind) ? TAG_ICONS[kind] : null;
}

/** The short session reading used in the waiting title: the first eight id characters. */
function shortSessionId(sessionId: string): string {
  return sessionId.slice(0, 8);
}

/**
 * The name of the thing the card is about, for the header: the subject's own title when a
 * provider stated one, else the task id, else the shortened session id. `null` when the subject
 * names none of them — the header then simply omits it.
 */
export function cockpitCardSubjectName(card: CockpitCard): string | null {
  const title = card.subject.title?.trim() ?? '';
  if (title !== '') return title;
  const taskId = card.subject.taskId?.trim() ?? '';
  if (taskId !== '') return taskId;
  const sessionId = card.subject.sessionId?.trim() ?? '';
  if (sessionId !== '') return shortSessionId(sessionId);
  return null;
}

/**
 * The card's headline, derived from its content rather than from the provider.
 *
 * A card always states an `ask` when its content was resolved. When it did not, the fallback
 * chain names what the card is about in a person's words — the session it is waiting on, the
 * task it concerns, the first measured fact — and only then the machine URI. The session copy
 * is the one case where the card is ABOUT the conversation: a session-ask card whose content
 * could not be filled says which session is waiting instead of showing `quay://…`.
 *
 * Used by `CockpitCard` (the list row) and `CockpitCardDetails` (the drawer heading).
 */
export function cockpitCardTitle(card: CockpitCard, t: TFunction): string {
  if (card.ask !== undefined && card.ask.trim() !== '') return card.ask;

  const sessionId = card.subject.sessionId?.trim() ?? '';
  if (card.contentUnavailable !== undefined && sessionId !== '') {
    return t('cockpit.cardSessionWaiting', { id: shortSessionId(sessionId) });
  }

  const taskId = card.subject.taskId?.trim() ?? '';
  if (taskId !== '') return taskId;

  const firstFact = card.facts[0]?.text.trim() ?? '';
  if (firstFact !== '') return firstFact;

  return card.subject.uri;
}

/**
 * `9h` / `18m` / `3d` — the compact age of one card's wait, read through the cockpit's own copy.
 *
 * ONE FORMATTER FOR BOTH READINGS. The list row's age chip and the Details header state the same
 * `waitingSince`; deriving them from different helpers let the two say `11.2h` and `11 h ago`
 * about one card.
 *
 * Used by `CockpitCard` (the list row) and `CockpitCardDetails` (the drawer header).
 */
export function cockpitCardAge(t: TFunction, now: number, waitingSince: string): string {
  const since = Date.parse(waitingSince);
  const milliseconds = Number.isNaN(since) ? 0 : Math.max(0, now - since);
  const minutes = Math.floor(milliseconds / 60_000);
  if (minutes < 1) return t('cockpit.cardAgeNow');
  if (minutes < 60) return t('cockpit.cardAgeMinutes', { n: minutes });
  const hours = minutes / 60;
  if (hours < 24) {
    const rounded = Math.round(hours * 10) / 10;
    return t('cockpit.cardAgeHours', {
      n: Number.isInteger(rounded) ? String(rounded) : rounded.toFixed(1),
    });
  }
  return t('cockpit.cardAgeDays', { n: Math.floor(hours / 24) });
}

/* ─── Facts: the pills the card body draws ───────────────────────── */

/** `a  b` and `A b` compare equal: whitespace and case are formatting, not meaning. */
function normalizeFactText(value: string): string {
  return value.replace(/\s+/g, ' ').trim().toLowerCase();
}

/**
 * The facts the card's body should draw as pills.
 *
 * A card's situation and its facts come from different layers of the same reading, so a fact
 * often RESTATES the situation word for word — the fleet's 「需要人」 card carries
 * `recovery-window-expired (6h) without landing — recorded and raised` as both its situation and
 * its first fact. A pill repeating the sentence printed directly above it is noise, not a
 * reading. A fact is therefore dropped when the situation already says it (equality or
 * containment after normalisation). Every remaining fact keeps its full text in Details, which is
 * where the untruncated reading belongs.
 *
 * Provider-agnostic by construction: the rule reads only the card's own stated text, never the
 * `provider` field.
 */
export function cockpitCardFactsBeyondSituation(card: CockpitCard): CockpitCardFact[] {
  const situation = normalizeFactText(card.situation ?? '');
  if (situation === '') return card.facts;
  return card.facts.filter((fact) => {
    const text = normalizeFactText(fact.text);
    return text === '' || !situation.includes(text);
  });
}

/** The pill's character budget; the full text stays in the title attribute and in Details. */
export const COCKPIT_FACT_PILL_MAX_CHARS = 48;

/**
 * One fact's short form for a pill: a single line, capped at
 * {@link COCKPIT_FACT_PILL_MAX_CHARS}, cut at a word boundary and marked with an ellipsis when it
 * was shortened. Details renders the fact's own `text` unchanged.
 */
export function cockpitFactShortForm(text: string): string {
  const singleLine = text.replace(/\s+/g, ' ').trim();
  if (singleLine.length <= COCKPIT_FACT_PILL_MAX_CHARS) return singleLine;
  const cut = singleLine.slice(0, COCKPIT_FACT_PILL_MAX_CHARS - 1);
  const lastSpace = cut.lastIndexOf(' ');
  // Only break at a space when it is not so early that the pill loses most of its reading.
  const trimmed = (lastSpace > 24 ? cut.slice(0, lastSpace) : cut).replace(/[\s,;:.，、。；：]+$/, '');
  return `${trimmed}…`;
}

/* ─── The assistant's own words inside the summary ───────────────── */

/** The quote pairs the observation layer's sentence may use around quoted speech. */
const QUOTE_PAIRS: readonly (readonly [string, string])[] = [
  ['「', '」'],
  ['『', '』'],
  ['“', '”'],
  ['"', '"'],
];

/**
 * The assistant's original words carried by the card's summary, or `null` when it quotes none.
 *
 * THE WIRE HAS NO DEDICATED QUOTE FIELD (the card contract states the situation and facts only),
 * so the summary's own convention is the reading: the observation layer writes the assistant's
 * sentence inside a quotation pair when it restates one — `对话里只有“继续”，没有 diff 内容。`.
 * The first quoted segment of the situation (then of the question) is therefore that sentence.
 * A card that quotes nothing draws no quote; nothing is invented from unquoted prose.
 *
 * Used by `CockpitCardDetails` (the phone drawer's quote and its 「in session」 link).
 */
export function cockpitAssistantQuote(card: CockpitCard): string | null {
  for (const source of [card.situation, card.ask]) {
    if (source === undefined || source === '') continue;
    for (const [open, close] of QUOTE_PAIRS) {
      const start = source.indexOf(open);
      if (start === -1) continue;
      const end = source.indexOf(close, start + open.length);
      if (end === -1) continue;
      const quote = source.slice(start + open.length, end).trim();
      if (quote !== '') return quote;
    }
  }
  return null;
}

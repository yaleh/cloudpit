import type { CockpitCardOptionSource, CockpitCardTag } from './cockpit-cards.js';

// ---------------------------
//----------------- SESSION ASK DECISION DIGEST ------------

/**
 * One option the assistant's question offers, restated by the T1 decision digest.
 *
 * This is the subset of `CockpitCardOption` the observation layer fills on its own: `id`,
 * `label` and `does` restate the assistant's own words, `tags` are consequence labels, and
 * `source` records where the option came from. `suggested` is true for exactly one option: the
 * assistant's own recommendation when its text carries one (`source: 'assistant'`), otherwise
 * the judge's pick from the SAME summarising call (`source: 'judge'`). `why` carries the judge's
 * one-line reason and is present exactly on a judge-sourced suggestion.
 */
export type SessionAskDecisionOption = {
  id: string;
  label: string;
  does: string;
  tags: CockpitCardTag[];
  suggested: boolean;
  source: CockpitCardOptionSource;
  /** The judge's one-line reason; present only on the judge-sourced suggestion. */
  why?: string;
};

/**
 * The structured decision digest for one question a session is waiting on (T1 content).
 *
 * `askId` is the deduplication key agreed with quay-fleet: `<sessionId>:<assistantMessageId>`,
 * where the message id is the FIRST asking message since the last user prompt. A re-ask before
 * the user answers keeps the same `askId`, bumps `revision`, and names the new message in the
 * event. `ask`/`situation`/`options` are the model's restatement of the assistant's own words —
 * semantic content, never a verbatim excerpt. `incomplete` is true when the question depends on
 * context outside the turns that were sent; an incomplete digest never claims a suggestion.
 */
export type SessionAskDecision = {
  askId: string;
  revision: number;
  ask: string;
  situation: string;
  options: SessionAskDecisionOption[];
  incomplete: boolean;
  /**
   * One short VERBATIM fragment of the assistant's asking message (the question's paragraph,
   * length-capped). The card shows it as a quote beside the restated question; it is optional
   * because digests written before this field existed carry none.
   */
  quote?: string;
};

/**
 * One ask digest reading, with the same loud-failure discipline as every observation reading.
 *
 * `evaluated` carries the digest plus the token counts the upstream reported, so the spend stays
 * auditable. `skipped` is a deliberate non-call (the tier is switched off). `unevaluated` means
 * the model answered something the schema does not accept — the producer then attaches NO `ask`
 * rather than passing the assistant's last sentence off as a restatement.
 *
 * `originalAsk` is the asking message's OWN words, kept verbatim so a card whose summary never
 * materialised can still say what is being asked. It is a READ FROM THE TRANSCRIPT, not a digest
 * field: the producer/reader attach it as a fallback for the `skipped`/`unevaluated` states (an
 * `evaluated` reading already restates the question), and the projection caps it for display.
 * It is never presented as the model's restatement; the card's own copy marks it as the original.
 *
 * `isAsking` is the T1 summary's EXPLICIT semantic verdict — the one field the producer gates the
 * `session.asking` event and the observation object on. It is:
 *   · `true` on an `evaluated` reading (the model restated a real question);
 *   · `false` on the `unevaluated` reading the summariser returns when the message is NOT a
 *     question — a definitive non-ask that must produce no event and no object;
 *   · absent/`undefined` when the tier was disabled or the call failed: the producer then falls
 *     back to the mechanical prefilter's candidate and shows this reading's `reason` on the card,
 *     because a briefly visible candidate is better than silently dropping a real question.
 * Readers written before this field existed leave it absent; only a literal `false` suppresses.
 */
export type SessionAskDecisionReading =
  | ({
      state: 'evaluated';
      inputTokens: number | null;
      outputTokens: number | null;
      originalAsk?: string;
      isAsking?: boolean;
    } & SessionAskDecision)
  | { state: 'skipped'; reason: string; originalAsk?: string; isAsking?: boolean }
  | { state: 'unevaluated'; reason: string; originalAsk?: string; isAsking?: boolean };

/**
 * The context-event kinds a session ask produces; the fleet schema pins the first two names.
 *
 * `session.asking.retracted` withdraws a mis-stated ask (`data` = `{askId, messageId}`). It is
 * stated by this host ahead of the installed fleet schema — the fleet reader tolerates an
 * unknown kind — so a wrong card leaves the wall the day the detector is fixed.
 */
export type SessionAskEventKind = 'session.asking' | 'session.answered' | 'session.asking.retracted';

/**
 * One `session.asking`/`session.answered`/`session.asking.retracted` event as the observation
 * layer states it.
 *
 * The envelope mirrors quay-fleet's context-event stream: `session` and `project` are top-level
 * identities, `at` is ISO-8601, and `refs` names the assistant message the question came from.
 * The real stream writer is injected only after the fleet's schema carries the asking/answered
 * kinds (待外部); until then the producer's event writer is a test/memory implementation. A
 * `session.asking.retracted` row is the one kind written AHEAD of the installed schema (see
 * `context-event-writer.ts`), because the fleet reader tolerates an unknown kind.
 *
 * `data` is kind-specific and stays OPEN by contract. A `session.asking` row carries
 * `askId`/`messageId`/`revision`/`contentRef` plus `questionText`: the asking message's own
 * text, the UNTRUNCATED full text, omitted when the text is blank. `questionText`
 * exists ONLY so fleet can dedup by 「session + normalised question text」 (it hashes that text
 * into the key, falling back to the old askId key when absent). It is NOT a display field: the
 * cockpit renders the question from its own card/`contentRef` resolution, and no Cloudpit UI
 * reads `questionText`. Do NOT truncate it for size — a cut merges distinct questions into one key.
 */
export type SessionAskEvent = {
  kind: SessionAskEventKind;
  session: string;
  project: string;
  at: string;
  refs?: string[];
  data: Record<string, unknown>;
};

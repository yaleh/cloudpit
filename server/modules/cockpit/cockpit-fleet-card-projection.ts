/**
 * The quay-fleet card projection: one `quay-fleet cockpit cards --json` JSONL line in, one
 * `CockpitCard` out, plus the local content completion a session-ask card needs.
 *
 * WHY IT IS SEPARATE FROM THE PROVIDER. The provider owns the CLI invocation, its short TTL
 * cache and the diagnostic it reports; this file owns the tolerant reading of the fleet's
 * document and the one place the observation layer's T1 decision digest is folded into a card.
 * Splitting there keeps each concern under this repo's service-file ratchet and lets a
 * criterion drive the projection with fixtures without a child process.
 *
 * TWO RULES ARE LOAD-BEARING:
 *
 *   1. A malformed line is SKIPPED AND COUNTED, never fatal. One bad row may not hide the
 *      other things waiting for the person, so the provider returns every card it could read
 *      and reports `skippedLines` in its diagnostic.
 *   2. The projection INVENTIONS NOTHING. Fleet fields pass through verbatim; the only local
 *      additions are the session-ask content (`ask`, `situation`, content options) and the
 *      `contentUnavailable` reason when that content is not ready. A session-ask default option
 *      is whichever content option the observation layer marked `suggested` — the assistant's
 *      own recommendation (`source: 'assistant'`) or, when it gave none, the same call's judge
 *      pick (`source: 'judge'`, with its `why`). The projection passes that decision through but
 *      never invents one: no marked option means no default.
 *
 * Consumers: `cockpit-fleet-card-provider.ts` (the only caller) and its criterion.
 */
import type {
  CockpitCard,
  CockpitCardAction,
  CockpitCardContentRef,
  CockpitCardFact,
  CockpitCardOption,
  CockpitCardOptionSource,
  CockpitCardReceipt,
  CockpitCardState,
  CockpitCardSubject,
  SessionAskDecisionOption,
  SessionAskDecisionReading,
} from '@/shared/types.js';
import { isRecord } from '@/shared/utils.js';

import { COCKPIT_FLEET_LOG_EXECUTOR_ID } from './cockpit-fleet-executor.js';
import { COCKPIT_SESSION_SEND_EXECUTOR_ID } from './cockpit-session-send.executor.js';

/** The content resolver a fleet session-ask card names; the only resolver handled here. */
const SESSION_ASK_RESOLVER = 'cloudcli.session-ask';

/**
 * How much of the asking message's own words a card shows when its summary is missing.
 *
 * THIS IS THE ORIGINAL-TEXT FALLBACK, NOT THE SUMMARY. When the digest has no decision for a
 * card's ask, the card still has to say what is being asked; the transcript's own words are
 * used verbatim (never passed off as the model's restatement) and capped to this length. The
 * question lives at the END of an assistant message, so the TAIL is kept and a leading `…` marks
 * the cut — cutting the tail would behead the very sentence the person has to answer.
 */
export const SESSION_ASK_ORIGINAL_MAX_CHARS = 600;

/** The asking message's own words, capped for the fallback question; `''` when unreadable. */
function originalAskFallback(text: string): string {
  const trimmed = text.trim();
  if (trimmed === '') return '';
  return trimmed.length <= SESSION_ASK_ORIGINAL_MAX_CHARS
    ? trimmed
    : `…${trimmed.slice(trimmed.length - SESSION_ASK_ORIGINAL_MAX_CHARS)}`;
}

/** The one reading the content completion needs: the T1 digest for a session/message pair. */
export type CockpitFleetContentReader = (
  sessionId: string,
  messageId: string,
) => SessionAskDecisionReading | null;

/** What one JSONL batch projected into. */
export type CockpitFleetProjectionResult = {
  /** Every well-formed card, `resolved`/`expired` included (the registry owns visibility). */
  cards: CockpitCard[];
  /** Non-empty lines that were not a readable card. */
  skippedLines: number;
};

/** The projection's public surface. */
export type CockpitFleetProjection = {
  /**
   * One stdout pass to cards.
   *
   * `retracted` overrides the injected reading for THIS pass: the provider reads the set through
   * an async seam and hands it in, while a criterion can pass one directly without any seam.
   */
  project(stdout: string, options?: { retracted?: ReadonlySet<string> }): CockpitFleetProjectionResult;
};

/** The address a contentRef names, kept beside its projected wire form. */
type ContentAddress = {
  cardRef: CockpitCardContentRef;
  sessionId: string;
  messageId: string;
};

function text(value: unknown): string {
  return typeof value === 'string' ? value : '';
}

function finiteNumber(value: unknown, fallback: number): number {
  return typeof value === 'number' && Number.isFinite(value) ? value : fallback;
}

function list(value: unknown): unknown[] {
  return Array.isArray(value) ? value : [];
}

function cardState(value: unknown): CockpitCardState | null {
  return value === 'open' || value === 'resolved' || value === 'expired' ? value : null;
}

function optionSource(value: unknown): CockpitCardOptionSource {
  return value === 'assistant' || value === 'judge' ? value : 'provider';
}

/** One consequential tag; malformed entries are dropped rather than failing the option. */
function mapTags(raw: unknown): CockpitCardOption['tags'] {
  const tags: NonNullable<CockpitCardOption['tags']> = [];
  for (const entry of list(raw)) {
    if (!isRecord(entry) || text(entry.kind) === '' || text(entry.text) === '') continue;
    tags.push({ kind: text(entry.kind), text: text(entry.text) });
  }
  return tags;
}

/** One declared action; an option without a readable executor id is not confirmable and is dropped. */
function mapAction(raw: unknown): CockpitCardAction | null {
  if (!isRecord(raw)) return null;
  const executor = text(raw.executor);
  if (executor === '') return null;
  return { executor, params: isRecord(raw.params) ? { ...raw.params } : {} };
}

/** One option, all fields passed through. `suggested` is the fleet's own statement here. */
function mapOption(raw: unknown): CockpitCardOption | null {
  if (!isRecord(raw)) return null;
  const id = text(raw.id);
  const label = text(raw.label);
  if (id === '' || label === '') return null;
  const action = mapAction(raw.action);
  if (action === null) return null;
  const why = text(raw.why);
  const warn = text(raw.warn);
  const undo = text(raw.undo);
  const when = text(raw.when);
  return {
    id,
    label,
    does: text(raw.does),
    suggested: raw.suggested === true,
    source: optionSource(raw.source),
    action,
    ...(why === '' ? {} : { why }),
    ...(warn === '' ? {} : { warn }),
    ...(undo === '' ? {} : { undo }),
    ...(when === '' ? {} : { when }),
    ...(Array.isArray(raw.tags) ? { tags: mapTags(raw.tags) } : {}),
  };
}

/** One fact; an entry with no text or a non-boolean `mechanical` is dropped. */
function mapFact(raw: unknown): CockpitCardFact | null {
  if (!isRecord(raw) || text(raw.text) === '' || typeof raw.mechanical !== 'boolean') return null;
  const ref = text(raw.ref);
  const observedAt = text(raw.observedAt);
  return {
    text: text(raw.text),
    mechanical: raw.mechanical,
    ...(ref === '' ? {} : { ref }),
    ...(observedAt === '' ? {} : { observedAt }),
  };
}

/** The card's subject; `uri` is mandatory because it is the card's cockpit address. */
function mapSubject(raw: unknown): CockpitCardSubject | null {
  if (!isRecord(raw)) return null;
  const uri = text(raw.uri);
  if (uri === '') return null;
  const project = text(raw.project);
  const sessionId = text(raw.sessionId);
  const taskId = text(raw.taskId);
  return {
    uri,
    ...(project === '' ? {} : { project }),
    ...(sessionId === '' ? {} : { sessionId }),
    ...(taskId === '' ? {} : { taskId }),
  };
}

/**
 * Reads a contentRef and projects it to the wire shape the card module already understands
 * (`ref` = `sessionId[#messageId]`), while keeping the fleet's own address fields for the
 * local digest lookup.
 */
function mapContentRef(raw: unknown): ContentAddress | null {
  if (!isRecord(raw)) return null;
  const resolver = text(raw.resolver);
  if (resolver === '') return null;
  const sessionId = text(raw.sessionId);
  const messageId = text(raw.messageId);
  const explicitRef = text(raw.ref);
  const ref =
    explicitRef !== ''
      ? explicitRef
      : sessionId === ''
        ? ''
        : messageId === ''
          ? sessionId
          : `${sessionId}#${messageId}`;
  return {
    cardRef: { resolver, ...(ref === '' ? {} : { ref }) },
    sessionId,
    messageId,
  };
}

/**
 * The text a content option sends back into its session: the option's own words, plus one line
 * saying what choosing it does. A digest option with nothing to add sends its label alone.
 */
function contentOptionText(raw: SessionAskDecisionOption): string {
  const does = raw.does.trim();
  return does === '' ? raw.label : `${raw.label} — ${does}`;
}

/**
 * One content option. The observation layer already decided WHICH option is the default and
 * whether it came from the assistant or the judge; this projection only bounds it to one and
 * passes the judge's `why` through so the card can show the reason.
 *
 * SELECTING AN OPTION IS ANSWERING THE ASSISTANT, so the option's action is the ordinary
 * `session.send` executor writing back into the very session the card is about. It stays behind
 * the confirmation channel like every other action; the option's params carry the address and
 * the text, and the channel passes them through verbatim. `sessionId` is non-empty here: a card
 * with no conversation address never reaches content completion (see `withSessionAskContent`).
 */
function contentOption(
  raw: SessionAskDecisionOption,
  sessionId: string,
  allowSuggestion: boolean,
): CockpitCardOption {
  const why = raw.why?.trim() ?? '';
  // ONE READING OF THE SENT TEXT: the option carries it for the 「✎ 编辑」 shortcut, and the
  // action's `text` param is the same string — never a second copy that could drift.
  const sendText = contentOptionText(raw);
  return {
    id: raw.id,
    label: raw.label,
    does: raw.does,
    suggested: allowSuggestion && raw.suggested === true,
    source: raw.source,
    ...(why === '' ? {} : { why }),
    tags: raw.tags.map((tag) => ({ kind: tag.kind, text: tag.text })),
    sendText,
    action: {
      executor: COCKPIT_SESSION_SEND_EXECUTOR_ID,
      params: { sessionId, text: sendText },
    },
  };
}

/** Fleet options on a session-ask card keep their words/actions but never claim the default. */
function withoutSuggestion(options: readonly CockpitCardOption[]): CockpitCardOption[] {
  return options.map((option) => ({ ...option, suggested: false }));
}

/**
 * Folds the T1 digest into a session-ask card.
 *
 * THE CONTENT IS THE CARD'S OWN ASK'S. The reader is handed the card's `contentRef.messageId`
 * and answers that ask's decision; a session's other asks are not consulted, and a missing
 * decision is never filled from the session's latest one.
 *
 * A missing, skipped or unreadable digest leaves the card visible with `contentUnavailable`, no
 * model options and — when the reader could read the asking message — its verbatim words as the
 * fallback `ask` (capped by {@link SESSION_ASK_ORIGINAL_MAX_CHARS}). A ready digest fills
 * `ask`/`situation` and appends its options; at most one is suggested, whichever source
 * (assistant or judge) the observation layer marked. An incomplete digest keeps the reason and
 * no default option.
 *
 * AN EVALUATED DIGEST ALSO SETS `contentRevision`. The fleet item's own `revision` describes the
 * provider's content only; it does not move when the local digest is recomputed, so the display
 * has no way to tell that this card's question/options were replaced. `contentRevision` is the
 * digest reading's own revision — the same number the observation store carries for that ask —
 * and moves whenever the summary does.
 */
function withSessionAskContent(
  card: CockpitCard,
  address: ContentAddress,
  readSessionAsk: CockpitFleetContentReader,
): CockpitCard {
  const sessionId = address.sessionId !== '' ? address.sessionId : (card.subject.sessionId ?? '');
  const options = withoutSuggestion(card.options);
  if (sessionId === '') {
    return { ...card, options, contentUnavailable: '提问卡没有会话地址，本地无法补全内容' };
  }

  const reading = readSessionAsk(sessionId, address.messageId);
  if (reading === null) {
    return { ...card, options, contentUnavailable: '提问决策摘要尚未生成' };
  }
  if (reading.state !== 'evaluated') {
    // No digest for THIS ask. The card stays visible with the reason and, when the asking
    // message's own words were readable, that verbatim fallback — but the model's options are
    // absent, so the card cannot offer a choice it does not have.
    const fallbackAsk = originalAskFallback(reading.originalAsk ?? '');
    return {
      ...card,
      options,
      ...(fallbackAsk === '' ? {} : { ask: fallbackAsk }),
      contentUnavailable:
        reading.state === 'skipped'
          ? `提问决策摘要未启用：${reading.reason}`
          : `提问决策摘要不可用：${reading.reason}`,
    };
  }
  if (reading.incomplete) {
    return {
      ...card,
      options,
      contentRevision: reading.revision,
      contentUnavailable: '提问决策摘要不完整，未设默认选项',
    };
  }

  let suggestionUsed = false;
  const contentOptions = reading.options.map((option) => {
    const allowSuggestion = !suggestionUsed && option.suggested === true;
    if (allowSuggestion) suggestionUsed = true;
    return contentOption(option, sessionId, allowSuggestion);
  });
  const existing = new Set(options.map((option) => option.id));

  return {
    ...card,
    contentRevision: reading.revision,
    ...(reading.ask === '' ? {} : { ask: reading.ask }),
    ...(reading.situation === '' ? {} : { situation: reading.situation }),
    ...(reading.quote === undefined || reading.quote === '' ? {} : { assistantQuote: reading.quote }),
    options: [...options, ...contentOptions.filter((option) => !existing.has(option.id))],
  };
}

/**
 * The provider's own-reply declaration for a card that names NO session.
 *
 * A fleet card without `subject.sessionId` is about something (a task, a project, an attention
 * entry), not a conversation, so the person's own words are recorded with `fleet.log` rather
 * than sent anywhere. This is a PROVIDER declaration: it wins over the registry's content
 * default (which would try to start a conversation in `subject.project`). A card that names a
 * session is left alone, so the registry's `session.send` default applies unchanged.
 *
 * The params carry only the addressing fields the card actually has; `text` is joined by the
 * action channel at confirmation time (the channel, not this projection, knows the typed text).
 */
function withFleetOwnReply(card: CockpitCard): CockpitCard {
  if (card.ownReply !== undefined) return card;
  if ((card.subject.sessionId ?? '').trim() !== '') return card;

  const params: Record<string, unknown> = { attentionId: card.id };
  const taskId = (card.subject.taskId ?? '').trim();
  const projectId = (card.subject.project ?? '').trim();
  if (taskId !== '') params.taskId = taskId;
  if (projectId !== '') params.projectId = projectId;
  return {
    ...card,
    ownReply: { executor: COCKPIT_FLEET_LOG_EXECUTOR_ID, params },
  };
}

/**
 * The provider's receipt, when the fleet echoes one on the item. Tolerant like every other
 * reading: a malformed receipt is ignored (the overlay then simply waits), never fatal.
 */
function mapReceipt(raw: unknown): CockpitCardReceipt | null {
  if (!isRecord(raw)) return null;
  const feedbackId = text(raw.feedbackId);
  const disposition = text(raw.disposition);
  if (
    feedbackId === '' ||
    (disposition !== 'closed' && disposition !== 'kept' && disposition !== 'rejected')
  ) {
    return null;
  }
  const reason = text(raw.reason);
  return {
    feedbackId,
    at: text(raw.at),
    disposition,
    ...(reason === '' ? {} : { reason }),
  };
}

/** One JSONL object as a card, or `null` when it is missing a field the contract requires. */
function mapCard(
  raw: unknown,
  readSessionAsk: CockpitFleetContentReader,
): { card: CockpitCard; content: ContentAddress | null } | null {
  if (!isRecord(raw)) return null;
  const id = text(raw.id);
  const kind = text(raw.kind);
  const state = cardState(raw.state);
  const subject = mapSubject(raw.subject);
  if (id === '' || kind === '' || state === null || subject === null) return null;

  const facts: CockpitCardFact[] = [];
  for (const entry of list(raw.facts)) {
    const fact = mapFact(entry);
    if (fact !== null) facts.push(fact);
  }
  const options: CockpitCardOption[] = [];
  for (const entry of list(raw.options)) {
    const option = mapOption(entry);
    if (option !== null) options.push(option);
  }

  const content = mapContentRef(raw.contentRef);
  const ask = text(raw.ask);
  const situation = text(raw.situation);
  const group = text(raw.group);
  const waitingSince = text(raw.waitingSince);
  const surfacedAt = text(raw.surfacedAt);
  const notifyRaw = isRecord(raw.notify) ? raw.notify : null;
  const notify =
    notifyRaw !== null && typeof notifyRaw.system === 'boolean' && text(notifyRaw.reason) !== ''
      ? { system: notifyRaw.system, reason: text(notifyRaw.reason) }
      : undefined;
  const receipt = mapReceipt(raw.receipt);

  const card: CockpitCard = {
    id,
    // The provider id is this adapter's, not whatever the fleet document claims.
    provider: 'quay-fleet',
    // The fleet's revision is 0 for an item whose content never changed; a missing field still
    // defaults to 1. Clamping to 1 would make this projection disagree with the fleet's own
    // reading and every later dismissal would be refused as a stale revision.
    revision: Math.max(0, Math.trunc(finiteNumber(raw.revision, 1))),
    kind,
    group: group === '' ? 'ruling' : group,
    rank: finiteNumber(raw.rank, 0),
    state,
    waitingSince,
    surfacedAt,
    subject:
      content !== null && subject.sessionId === undefined && content.sessionId !== ''
        ? { ...subject, sessionId: content.sessionId }
        : subject,
    facts,
    options,
    ...(content === null ? {} : { contentRef: content.cardRef }),
    ...(ask === '' ? {} : { ask }),
    ...(situation === '' ? {} : { situation }),
    ...(notify === undefined ? {} : { notify }),
    ...(receipt === null ? {} : { receipt }),
  };

  const projected =
    content !== null && content.cardRef.resolver === SESSION_ASK_RESOLVER
      ? withSessionAskContent(card, content, readSessionAsk)
      : card;
  return { card: withFleetOwnReply(projected), content };
}

/**
 * Builds a projection over the one outside reading it needs.
 *
 * The withdrawal set is not a reading of this function's own: it arrives per call through
 * {@link CockpitFleetProjection.project} (`options.retracted`), because its real source is an
 * async stream. A card whose `contentRef.messageId` is in that set is not put on the wall at all
 * — it is not malformed, so it does not count as a skipped line.
 */
export function createCockpitFleetProjection(deps: {
  readSessionAsk: CockpitFleetContentReader;
}): CockpitFleetProjection {
  return {
    project(stdout, options) {
      const cards: CockpitCard[] = [];
      let skippedLines = 0;
      const retracted: ReadonlySet<string> = options?.retracted ?? new Set<string>();
      for (const line of stdout.split('\n')) {
        if (line.trim() === '') continue;
        let parsed: unknown;
        try {
          parsed = JSON.parse(line);
        } catch {
          skippedLines += 1;
          continue;
        }
        const mapped = mapCard(parsed, deps.readSessionAsk);
        if (mapped === null) {
          skippedLines += 1;
          continue;
        }
        // THE WITHDRAWN CARD IS DROPPED, not marked resolved: a question that was never a
        // question has no answer to show, and the wall must stop offering it.
        const messageId = mapped.content?.messageId ?? '';
        if (messageId !== '' && retracted.has(messageId)) continue;
        cards.push(mapped.card);
      }
      return { cards, skippedLines };
    },
  };
}

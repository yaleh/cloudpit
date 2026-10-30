/**
 * The quay-fleet card projection: one `quay-fleet cockpit cards --json` JSONL line in, one
 * `CockpitCard` out, plus the local content completion a session-ask or digest card needs.
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
 *   2. The projection INVENTIONS NOTHING. Fleet fields pass through verbatim; the local
 *      additions are content completions the fleet leaves to this side: the session-ask content
 *      (`ask`, `situation`, content options) with its `contentUnavailable` reason, and the digest
 *      reading's headline/row text plus one disposal option. A session-ask default option is
 *      whichever content option the observation layer marked `suggested` — the assistant's own
 *      recommendation (`source: 'assistant'`) or, when it gave none, the same call's judge pick
 *      (`source: 'judge'`, with its `why`). The projection passes that decision through but never
 *      invents one: no marked option means no default. The digest completion reads only the
 *      entry's own evidence and the fleet's executor declaration, never a fact of its own.
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

import {
  COCKPIT_FLEET_LOG_EXECUTOR_ID,
  type CockpitFleetExecutorDeclaration,
} from './cockpit-fleet-executor.js';
import { COCKPIT_SESSION_SEND_EXECUTOR_ID } from './cockpit-session-send.executor.js';

/** The content resolver a fleet session-ask card names; the only resolver handled here. */
const SESSION_ASK_RESOLVER = 'cloudcli.session-ask';

/**
 * The card kind the fleet gives a cross-project digest entry (its category is `digest`, which is
 * not in the fleet's kind table, so the open `kind` string carries the category itself).
 */
const DIGEST_KIND = 'digest';

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
   *
   * `declarations` is the fleet's executor declaration document for this pass. A digest card with
   * no options of its own gets one disposal option built FROM that document (so no fleet executor
   * id is hard-coded here); with no readable declaration it gets none.
   */
  project(
    stdout: string,
    options?: {
      retracted?: ReadonlySet<string>;
      declarations?: readonly CockpitFleetExecutorDeclaration[];
    },
  ): CockpitFleetProjectionResult;
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

/** One fact plus the evidence words the fleet kept in `detail` (the short `text` is a rendering). */
type MappedFact = {
  fact: CockpitCardFact;
  /** The evidence's original sentence, or `''` when the fleet kept none. */
  detail: string;
};

/** One fact; an entry with no text or a non-boolean `mechanical` is dropped. */
function mapFact(raw: unknown): MappedFact | null {
  if (!isRecord(raw) || text(raw.text) === '' || typeof raw.mechanical !== 'boolean') return null;
  const ref = text(raw.ref);
  const observedAt = text(raw.observedAt);
  return {
    fact: {
      text: text(raw.text),
      mechanical: raw.mechanical,
      ...(ref === '' ? {} : { ref }),
      ...(observedAt === '' ? {} : { observedAt }),
    },
    detail: text(raw.detail),
  };
}

/**
 * The fleet's digest evidence sentence: `<rule> <window>: <status>`.
 *
 * A digest fact's `text` is the fleet's humanised rendering (`读数：plan.digest.v0 … +2 error`),
 * and its `detail` is the evidence sentence verbatim. Both rows of one digest share every prefix
 * — the rule and the window — and differ only in the status tail (`+2 error` vs `+2 ok`), so a
 * display that shortens from the start renders them identically. Reading the tail out here is
 * what lets each row state its own status.
 */
const DIGEST_EVIDENCE_RE = /^plan\.digest\.[\w.-]+\s+(\S+):\s*(.+)$/;

/** One digest reading: its status tail, the window it summarises, and when it was observed. */
type DigestReading = {
  /** The digest window the evidence belongs to (the fleet's `2026-10-30T11`). */
  window: string;
  /** The reading itself (`claudecodeui: +2 error`). */
  status: string;
  /** `observedAt` in epoch ms; `0` when it is missing or unreadable (sorts last). */
  at: number;
};

/** One evidence row as a digest reading, or `null` when the row is not a digest sentence. */
function digestReadingOf(mapped: MappedFact): DigestReading | null {
  const raw = (mapped.detail !== '' ? mapped.detail : mapped.fact.text)
    .replace(/^读数：/, '')
    .trim();
  const match = DIGEST_EVIDENCE_RE.exec(raw);
  if (match === null) return null;
  const observedAt = Date.parse(mapped.fact.observedAt ?? '');
  return {
    window: (match[1] ?? '').trim(),
    status: (match[2] ?? '').trim(),
    at: Number.isFinite(observedAt) ? observedAt : 0,
  };
}

/** Whether one reading's status names a failure (`+2 error`). */
function isErrorReading(reading: DigestReading): boolean {
  return /\berror\b/i.test(reading.status);
}

/** Whether one reading's status names a recovery (`+2 ok`). */
function isOkReading(reading: DigestReading): boolean {
  return /\bok\b/i.test(reading.status);
}

/**
 * Whether the digest has healed since its last error: an `ok` reading was observed AFTER the
 * newest `error` reading. Two digests for one dedup key merge into one attention entry whose
 * evidence accumulates, so this is the entry's own history, not a second store.
 */
function digestRecovered(readings: readonly DigestReading[]): boolean {
  const newestErrorAt = readings
    .filter(isErrorReading)
    .reduce((newest, reading) => Math.max(newest, reading.at), -Infinity);
  const newestOkAt = readings
    .filter(isOkReading)
    .reduce((newest, reading) => Math.max(newest, reading.at), -Infinity);
  return Number.isFinite(newestErrorAt) && Number.isFinite(newestOkAt) && newestOkAt > newestErrorAt;
}

/**
 * The fact's displayed sentence, STATUS FIRST.
 *
 * The fleet's own sentence keeps the status at the tail, after the rule and the window shared by
 * every row; the client's pill shortens from the front, which is exactly why the two rows read
 * the same. Moving the status to the front keeps the reading and the window (verbatim from the
 * evidence) while making the rows distinguishable long before any shortening.
 */
function digestFactText(reading: DigestReading): string {
  return `读数：${reading.status}（${reading.window}）`;
}

/** The headline status of a digest card: its newest reading, named as recovered when it is. */
function digestHeadline(latest: DigestReading, recovered: boolean): string {
  return `${recovered ? '摘要已恢复' : '摘要'}：${latest.status}（${latest.window} 窗）`;
}

/** The disposal actions a digest card offers, most decisive first (dismiss over ack). */
const DIGEST_DISPOSAL_ACTIONS = ['park', 'hold'] as const;

/**
 * The one clickable disposal option a digest card gets when the fleet declared none.
 *
 * WHICH EXECUTOR IS THE FLEET'S STATEMENT, NOT OURS. `rescue executors --json` is read by the
 * provider and its declaration arrives per projection pass; this function picks a declaration by
 * its ACTION (`park` closes the card, `hold` acknowledges and keeps it), so no fleet executor id
 * is named by this repo. A deck with no readable declaration yields no option: the projection
 * never invents an action the fleet cannot run.
 */
function digestDisposalOption(
  card: CockpitCard,
  declarations: readonly CockpitFleetExecutorDeclaration[],
): CockpitCardOption | null {
  for (const action of DIGEST_DISPOSAL_ACTIONS) {
    const declaration = declarations.find((entry) => entry.action === action);
    if (declaration === undefined) continue;
    const closing = action === 'park';
    return {
      id: closing ? 'dismiss' : 'ack',
      label: closing ? '知道了，结束这条摘要' : '知道了，先留着这条摘要',
      does: closing ? '结束这条摘要提醒，不再显示' : '确认收到，保留这条摘要提醒',
      suggested: false,
      source: 'provider',
      action: { executor: declaration.id, params: { attentionId: card.id } },
    };
  }
  return null;
}

/**
 * The digest card's own reading, completed locally.
 *
 * THREE DEFECTS THIS COMPLETES, all observed on a real digest entry (`att_2d86bc040462`):
 *
 *   1. the fleet states no options for a digest, so the card rendered a dropdown over an empty
 *      list and a confirm bar promising 「Choose an option」 — nothing to click. One declared
 *      disposal option (dismiss/ack) is added, so the card can always be settled.
 *   2. the headline came from `facts[0]`, i.e. the OLDEST evidence, so a card whose `+2 error`
 *      had been followed by `+2 ok` still showed the stale error. Readings are ordered NEWEST
 *      FIRST and the card's `ask` states the newest status, naming it recovered when it is.
 *   3. every evidence row rendered the same prefix (rule + window) while the difference sat at
 *      the tail; each row now leads with its own status.
 *
 * The projection still invents nothing: the status and window are read from the evidence, and the
 * disposal executor comes from the fleet's declaration document.
 */
function withDigestReading(
  card: CockpitCard,
  facts: readonly MappedFact[],
  declarations: readonly CockpitFleetExecutorDeclaration[],
): CockpitCard {
  if (card.kind !== DIGEST_KIND) return card;

  const readings = facts
    .map(digestReadingOf)
    .filter((reading): reading is DigestReading => reading !== null);
  if (readings.length === 0) return card;

  // Newest first: the card's headline (its `facts[0]` fallback) and the list both read the
  // latest state, never the trigger that started the episode.
  const newestFirst = [...readings].sort((a, b) => b.at - a.at);
  const latest = newestFirst[0] as DigestReading;
  const ordered = [...facts].sort((a, b) => {
    const left = a.fact.observedAt === undefined ? 0 : Date.parse(a.fact.observedAt);
    const right = b.fact.observedAt === undefined ? 0 : Date.parse(b.fact.observedAt);
    return (Number.isFinite(right) ? right : 0) - (Number.isFinite(left) ? left : 0);
  });
  const rewritten = ordered.map((mapped) => {
    const reading = digestReadingOf(mapped);
    return reading === null ? mapped.fact : { ...mapped.fact, text: digestFactText(reading) };
  });

  const disposal = card.options.length === 0 ? digestDisposalOption(card, declarations) : null;
  return {
    ...card,
    facts: rewritten,
    ...(card.ask === undefined || card.ask === ''
      ? { ask: digestHeadline(latest, digestRecovered(readings)) }
      : {}),
    ...(disposal === null ? {} : { options: [disposal] }),
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
  declarations: readonly CockpitFleetExecutorDeclaration[],
): { card: CockpitCard; content: ContentAddress | null } | null {
  if (!isRecord(raw)) return null;
  const id = text(raw.id);
  const kind = text(raw.kind);
  const state = cardState(raw.state);
  const subject = mapSubject(raw.subject);
  if (id === '' || kind === '' || state === null || subject === null) return null;

  const mappedFacts: MappedFact[] = [];
  for (const entry of list(raw.facts)) {
    const fact = mapFact(entry);
    if (fact !== null) mappedFacts.push(fact);
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
    facts: mappedFacts.map((mapped) => mapped.fact),
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
  return { card: withFleetOwnReply(withDigestReading(projected, mappedFacts, declarations)), content };
}

/**
 * Builds a projection over the one outside reading it needs.
 *
 * The withdrawal set is not a reading of this function's own: it arrives per call through
 * {@link CockpitFleetProjection.project} (`options.retracted`), because its real source is an
 * async stream. A card whose `contentRef.messageId` is in that set is not put on the wall at all
 * — it is not malformed, so it does not count as a skipped line. The executor declarations arrive
 * the same way (per pass), so a digest card's disposal option names a declared id.
 */
export function createCockpitFleetProjection(deps: {
  readSessionAsk: CockpitFleetContentReader;
}): CockpitFleetProjection {
  return {
    project(stdout, options) {
      const cards: CockpitCard[] = [];
      let skippedLines = 0;
      const retracted: ReadonlySet<string> = options?.retracted ?? new Set<string>();
      const declarations = options?.declarations ?? [];
      for (const line of stdout.split('\n')) {
        if (line.trim() === '') continue;
        let parsed: unknown;
        try {
          parsed = JSON.parse(line);
        } catch {
          skippedLines += 1;
          continue;
        }
        const mapped = mapCard(parsed, deps.readSessionAsk, declarations);
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

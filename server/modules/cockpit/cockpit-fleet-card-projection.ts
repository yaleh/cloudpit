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
 *      `contentUnavailable` reason when that content is not ready. A session-ask default
 *      option is the assistant's OWN recommendation (`source: 'assistant'`) and nothing else:
 *      when the digest names no such option, no option is suggested.
 *
 * Consumers: `cockpit-fleet-card-provider.ts` (the only caller) and its criterion.
 */
import { isRecord } from '@/shared/utils.js';
import type {
  CockpitCard,
  CockpitCardAction,
  CockpitCardContentRef,
  CockpitCardFact,
  CockpitCardOption,
  CockpitCardOptionSource,
  CockpitCardState,
  CockpitCardSubject,
  SessionAskDecisionOption,
  SessionAskDecisionReading,
} from '@/shared/types.js';

/** The content resolver a fleet session-ask card names; the only resolver handled here. */
const SESSION_ASK_RESOLVER = 'cloudcli.session-ask';

/**
 * The executor a locally-derived ask option names.
 *
 * It is deliberately NOT declared by the provider (fleet's disposal actions land in a later
 * task), so the option is readable and selecting it reaches the confirmation channel's
 * `EXECUTOR_NOT_DECLARED` refusal with a readable reason instead of running something.
 */
export const COCKPIT_FLEET_ASK_OPTION_EXECUTOR = 'fleet.cockpit.session-ask-option';

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
  project(stdout: string): CockpitFleetProjectionResult;
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

/** One content option, with the E1 rule applied: only an assistant recommendation is suggested. */
function contentOption(
  raw: SessionAskDecisionOption,
  cardId: string,
  askId: string,
  allowSuggestion: boolean,
): CockpitCardOption {
  return {
    id: raw.id,
    label: raw.label,
    does: raw.does,
    suggested: allowSuggestion && raw.suggested === true && raw.source === 'assistant',
    source: raw.source,
    tags: raw.tags.map((tag) => ({ kind: tag.kind, text: tag.text })),
    action: {
      executor: COCKPIT_FLEET_ASK_OPTION_EXECUTOR,
      params: { cardId, askId, optionId: raw.id },
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
 * A missing, skipped, unreadable or incomplete digest leaves the card visible with
 * `contentUnavailable` and NO default option. A ready digest fills `ask`/`situation` and
 * appends its options; at most one is suggested, and only when its `source` is `assistant`.
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
    return {
      ...card,
      options,
      contentUnavailable:
        reading.state === 'skipped'
          ? `提问决策摘要未启用：${reading.reason}`
          : `提问决策摘要不可用：${reading.reason}`,
    };
  }
  if (reading.incomplete) {
    return { ...card, options, contentUnavailable: '提问决策摘要不完整，未设默认选项' };
  }

  let suggestionUsed = false;
  const contentOptions = reading.options.map((option) => {
    const allowSuggestion = !suggestionUsed && option.suggested === true && option.source === 'assistant';
    if (allowSuggestion) suggestionUsed = true;
    return contentOption(option, card.id, reading.askId, allowSuggestion);
  });
  const existing = new Set(options.map((option) => option.id));

  return {
    ...card,
    ...(reading.ask === '' ? {} : { ask: reading.ask }),
    ...(reading.situation === '' ? {} : { situation: reading.situation }),
    options: [...options, ...contentOptions.filter((option) => !existing.has(option.id))],
  };
}

/** One JSONL object as a card, or `null` when it is missing a field the contract requires. */
function mapCard(raw: unknown, readSessionAsk: CockpitFleetContentReader): CockpitCard | null {
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

  const card: CockpitCard = {
    id,
    // The provider id is this adapter's, not whatever the fleet document claims.
    provider: 'quay-fleet',
    revision: Math.max(1, Math.trunc(finiteNumber(raw.revision, 1))),
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
  };

  return content !== null && content.cardRef.resolver === SESSION_ASK_RESOLVER
    ? withSessionAskContent(card, content, readSessionAsk)
    : card;
}

/** Builds a projection over the one outside reading it needs. */
export function createCockpitFleetProjection(deps: {
  readSessionAsk: CockpitFleetContentReader;
}): CockpitFleetProjection {
  return {
    project(stdout) {
      const cards: CockpitCard[] = [];
      let skippedLines = 0;
      for (const line of stdout.split('\n')) {
        if (line.trim() === '') continue;
        let parsed: unknown;
        try {
          parsed = JSON.parse(line);
        } catch {
          skippedLines += 1;
          continue;
        }
        const card = mapCard(parsed, deps.readSessionAsk);
        if (card === null) {
          skippedLines += 1;
          continue;
        }
        cards.push(card);
      }
      return { cards, skippedLines };
    },
  };
}

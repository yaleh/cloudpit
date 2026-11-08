/**
 * The brief reading's shape and the small arithmetic every result shares.
 *
 * WHY A SEPARATE FILE. The service file owns the round loop and the two ledgers; this file owns
 * the values those produce — the identity fields, the result union, the fallback builder and the
 * token sum. Splitting here keeps each file under the module line ratchet without splitting any
 * single concern, and it lets the criterion build a stub reading without constructing a service.
 *
 * THE TOKEN SUM IS THE CONTRACT. Both caps count input + output + cache-read + cache-creation.
 * `addTokens` is the ONE place that adds them, so a change to "what counts" cannot leave one
 * budget counting a different total from the other.
 *
 * Consumers: `cockpit-brief.service.ts`, `cockpit.module.ts` (the route returns this shape) and
 * `tests/cockpit-brief.test.ts`.
 */

import type { BriefDocument } from './cockpit-brief-core.js';
import { defaultBrief } from './cockpit-brief-spec.js';

/** One card's brief request, already narrowed by the route. */
export type CockpitBriefInput = {
  cardId: string;
  sessionId: string;
  /** From the card's content ref, when it names one; the transcript's ask id stays authoritative. */
  messageId?: string;
};

/** What the observation reading must supply: the current ask and the bounded context. */
export type CockpitBriefAsk = {
  current: { askId: string; messageId: string; revision: number; assistantText: string } | null;
  context: string;
};

/** Every token class that counts against both caps. */
export type CockpitBriefTokens = {
  input: number;
  output: number;
  cacheRead: number;
  cacheCreation: number;
  total: number;
};

/** The token fields a completion may report; cache fields are optional for hand-built stubs. */
export type CockpitBriefTokenReading = {
  inputTokens: number | null;
  outputTokens: number | null;
  cacheReadInputTokens?: number | null;
  cacheCreationInputTokens?: number | null;
};

/** One rejected round, kept verbatim. `raw` is the model's own answer, not a reconstruction. */
export type CockpitBriefFailure = {
  round: number;
  rules: string[];
  raw: string;
  reason: string;
};

/** The identity fields a result carries whatever its status. */
export type CockpitBriefIdentity = {
  cardId: string;
  sessionId: string;
  askId: string | null;
  revision: number | null;
  messageId: string | null;
  question: string | null;
  itemRef: string;
};

/** The route's answer: a generated brief or the deterministic default, always with a reason. */
export type CockpitBriefResult = {
  cardId: string;
  sessionId: string;
  askId: string | null;
  revision: number | null;
  messageId: string | null;
  status: 'generated' | 'fallback';
  reason: string | null;
  cached: boolean;
  question: string | null;
  rounds: number;
  failures: CockpitBriefFailure[];
  tokens: CockpitBriefTokens;
  durationMs: number;
  brief: BriefDocument;
};

/** Zeroed token reading. */
export function noTokens(): CockpitBriefTokens {
  return { input: 0, output: 0, cacheRead: 0, cacheCreation: 0, total: 0 };
}

/**
 * Add one completion's counts to `target` and return what it spent.
 *
 * A missing count is zero, never NaN: an upstream that reports nothing must not poison the
 * daily ledger. Cache reads and creations count exactly like ordinary input and output.
 */
export function addTokens(target: CockpitBriefTokens, reading: CockpitBriefTokenReading): number {
  const input = reading.inputTokens ?? 0;
  const output = reading.outputTokens ?? 0;
  const cacheRead = reading.cacheReadInputTokens ?? 0;
  const cacheCreation = reading.cacheCreationInputTokens ?? 0;
  target.input += input;
  target.output += output;
  target.cacheRead += cacheRead;
  target.cacheCreation += cacheCreation;
  const spent = input + output + cacheRead + cacheCreation;
  target.total += spent;
  return spent;
}

/** The identity fields, with the transcript's ask winning over the content ref's message id. */
export function identityOf(input: CockpitBriefInput, ask: CockpitBriefAsk | null): CockpitBriefIdentity {
  const anchor = input.messageId ?? ask?.current?.messageId ?? null;
  const itemRef =
    anchor === null ? `cloudcli://session/${input.sessionId}` : `cloudcli://session/${input.sessionId}#${anchor}`;
  return {
    cardId: input.cardId,
    sessionId: input.sessionId,
    askId: ask?.current?.askId ?? null,
    revision: ask?.current?.revision ?? null,
    messageId: ask?.current?.messageId ?? input.messageId ?? null,
    question: ask?.current?.assistantText ?? null,
    itemRef,
  };
}

/**
 * Every non-generated outcome. The brief is `defaultBrief`, so the renderer always has a valid
 * document and the reading always says which rule prevented a model brief.
 */
export function fallbackResult(args: {
  identity: CockpitBriefIdentity;
  reason: string;
  rounds: number;
  failures: CockpitBriefFailure[];
  tokens: CockpitBriefTokens;
  durationMs: number;
}): CockpitBriefResult {
  return {
    ...args.identity,
    status: 'fallback',
    reason: args.reason,
    cached: false,
    rounds: args.rounds,
    failures: args.failures,
    tokens: args.tokens,
    durationMs: args.durationMs,
    brief: defaultBrief({ itemRef: args.identity.itemRef, question: args.identity.question ?? undefined }),
  };
}

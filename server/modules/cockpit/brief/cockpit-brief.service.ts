/**
 * The cockpit brief service: one card surface in, one BriefSpec (or the deterministic default)
 * out, with the spend capped and every failure named.
 *
 * WHY A CLASS. The service owns state that outlives a single request — the per-(askId, revision)
 * cache and the UTC-day token ledger — so it is a lifecycle owner (`dispose()`), not a bag of
 * free functions over module scope. The composition root builds ONE instance and the card router
 * calls `briefFor`; a second instance would keep a second daily ledger and defeat the cap.
 *
 * THE DEPENDENCY SEAM. `server/modules/cockpit` is a LEAF for AC-394: it may import
 * `server/shared/**` and itself, never a sibling feature directory. The gateway client, the
 * transcript reader, the session lookup and the observation ask reading therefore arrive as
 * injected functions from `server/index.ts` — the same convention `createCockpitModule` already
 * uses for its fleet/send seams. The service imports no peer module.
 *
 * THE ROUNDS. A model answer is checked mechanically. A failure is fed back with the raw answer
 * and the errors, up to `MAX_ITERATIONS` (3). A third failure is not passed off as a brief: the
 * result is `defaultBrief`, and the failure rules plus the RAW output are kept so the next
 * investigation has the text E2's `unparseable-json` failures lacked.
 *
 * THE QUESTION. It is the LAST assistant message's text, read from the transcript. The
 * observation reading's context is background only; its old `askingYou` excerpt is deliberately
 * not part of this seam (the experiment measured it naming the previous turn in 2 of 8 sessions).
 *
 * Consumers: `cockpit.module.ts` (the `GET /api/cockpit/cards/:id/brief` route) and
 * `tests/cockpit-brief.test.ts`.
 */

import { MAX_ITERATIONS } from './cockpit-brief-core.js';
import { BRIEF_SYSTEM_PROMPT, buildBriefRepairPrompt, buildBriefUserPrompt, parseBriefAnswer } from './cockpit-brief-prompt.js';
import {
  addTokens,
  fallbackResult,
  identityOf,
  noTokens,
  type CockpitBriefAsk,
  type CockpitBriefFailure,
  type CockpitBriefInput,
  type CockpitBriefResult,
  type CockpitBriefTokenReading,
  type CockpitBriefTokens,
} from './cockpit-brief-result.js';
import { createCockpitBriefSettingsSource, type CockpitBriefSettings, type CockpitBriefSettingsSource } from './cockpit-brief-settings.js';
import { checkBrief, expandBrief } from './cockpit-brief-spec.js';

export type {
  CockpitBriefAsk,
  CockpitBriefFailure,
  CockpitBriefInput,
  CockpitBriefResult,
  CockpitBriefTokens,
} from './cockpit-brief-result.js';

/** The two wire dialects the gateway leaf speaks; spelled locally to keep the module a leaf. */
export type CockpitBriefProtocol = 'anthropic' | 'openai';
/** How the key travels; the empty string means the protocol's default. */
export type CockpitBriefAuthScheme = '' | 'x-api-key' | 'bearer';

/**
 * Everything one completion needs to reach the gateway. `apiKey` is the resolved secret; it is
 * never logged, never returned over HTTP, and never placed in a failure record.
 */
export type CockpitBriefGateway = {
  protocol: CockpitBriefProtocol;
  baseUrl: string;
  model: string;
  authScheme: CockpitBriefAuthScheme;
  apiKey: string;
  disableThinking: boolean;
  timeoutMs: number;
  temperature: number;
  maxOutputTokens: number;
};

/** One completion request: the resolved gateway, the fixed system prompt and the user turn. */
export type CockpitBriefCompletionRequest = {
  gateway: CockpitBriefGateway;
  system: string;
  user: string;
};

/** The answer text plus every token count the upstream reported, cache reads included. */
export type CockpitBriefCompletion = CockpitBriefTokenReading & { text: string };

/** The completion seam. Production wires the gateway leaf; the criterion stubs it. */
export type CockpitBriefComplete = (request: CockpitBriefCompletionRequest) => Promise<CockpitBriefCompletion>;

/** What `server/index.ts` injects. Missing seams produce a named fallback, never a throw. */
export type CockpitBriefDeps = {
  readSettings?: () => CockpitBriefSettings;
  /** The reply-suggestions gateway reading; null when no usable gateway is configured. */
  readGateway?: () => CockpitBriefGateway | null;
  /** `readSessionAsk` from the observation barrel, structurally. */
  readAsk?: (raw: string, sessionId: string) => CockpitBriefAsk;
  resolveSession?: (sessionId: string) => { jsonlPath: string | null } | null;
  readTranscript?: (jsonlPath: string) => string;
  complete?: CockpitBriefComplete;
  now?: () => number;
};

/** The service surface the card module holds. */
export type CockpitBrief = {
  briefFor(input: CockpitBriefInput): Promise<CockpitBriefResult>;
  dispose(): void;
};

/** Builds the process-wide brief service over its injected world. */
export function createCockpitBriefService(deps: CockpitBriefDeps = {}): CockpitBrief {
  return new CockpitBriefServiceImpl(deps);
}

/** The stateless error shape fed back to the model when the answer was not JSON at all. */
const UNPARSEABLE = [
  {
    path: '$',
    rule: 'unparseable-json',
    message: 'the answer was not a JSON object',
    fix: 'output only the JSON object, with no prose and no code fence',
  },
];

/** The lifecycle owner: cache, day ledger, and the round loop live here. */
class CockpitBriefServiceImpl implements CockpitBrief {
  private readonly cache = new Map<string, CockpitBriefResult>();
  private readonly settingsSource: CockpitBriefSettingsSource;
  private readonly deps: CockpitBriefDeps;
  private dayKey = '';
  private dayTokens = 0;

  constructor(deps: CockpitBriefDeps) {
    this.deps = deps;
    this.settingsSource = createCockpitBriefSettingsSource();
  }

  /** Drops the cache and the day ledger. The process normally keeps one instance for its life. */
  dispose(): void {
    this.cache.clear();
    this.dayKey = '';
    this.dayTokens = 0;
  }

  async briefFor(input: CockpitBriefInput): Promise<CockpitBriefResult> {
    const startedAt = this.deps.now?.() ?? Date.now();
    const settings = (this.deps.readSettings ?? (() => this.settingsSource.read()))();
    if (!settings.enabled) return this.fallback(input, 'disabled', null, [], noTokens(), startedAt, 0);

    const gateway = this.deps.readGateway?.() ?? null;
    if (gateway === null) return this.fallback(input, 'gateway-unavailable', null, [], noTokens(), startedAt, 0);

    const { readAsk, resolveSession, readTranscript, complete } = this.deps;
    if (readAsk === undefined || resolveSession === undefined || readTranscript === undefined || complete === undefined) {
      return this.fallback(input, 'unconfigured', null, [], noTokens(), startedAt, 0);
    }

    const session = resolveSession(input.sessionId);
    if (session === null || session.jsonlPath === null || session.jsonlPath === '') {
      return this.fallback(input, 'session-not-found', null, [], noTokens(), startedAt, 0);
    }

    let raw: string;
    let ask: CockpitBriefAsk;
    try {
      raw = readTranscript(session.jsonlPath);
      ask = readAsk(raw, input.sessionId);
    } catch {
      return this.fallback(input, 'transcript-unreadable', null, [], noTokens(), startedAt, 0);
    }
    if (ask.current === null) return this.fallback(input, 'no-asking-message', ask, [], noTokens(), startedAt, 0);

    const question = ask.current.assistantText;
    const cacheKey = `${ask.current.askId}#${ask.current.revision}`;
    const cached = this.cache.get(cacheKey);
    if (cached !== undefined) return { ...cached, cached: true };

    this.rollDay(startedAt);
    if (this.dayTokens >= settings.dailyTokenCap) {
      return this.fallback(input, 'daily-token-cap-reached', ask, [], noTokens(), startedAt, 0);
    }

    const tokens = noTokens();
    const failures: CockpitBriefFailure[] = [];
    const itemRef = identityOf(input, ask).itemRef;
    let user = buildBriefUserPrompt({ itemRef, question, context: ask.context });
    let rounds = 0;

    while (rounds < MAX_ITERATIONS) {
      // Both caps are checked BEFORE a call, so a cap can never be crossed by "one more round".
      if (tokens.total >= settings.perBriefTokenCap) {
        return this.fallback(input, 'per-brief-token-cap-reached', ask, failures, tokens, startedAt, rounds);
      }
      if (this.dayTokens >= settings.dailyTokenCap) {
        return this.fallback(input, 'daily-token-cap-reached', ask, failures, tokens, startedAt, rounds);
      }
      rounds += 1;

      let completion: CockpitBriefCompletion;
      try {
        completion = await complete({ gateway, system: BRIEF_SYSTEM_PROMPT, user });
      } catch {
        return this.fallback(input, 'model-call-failed', ask, failures, tokens, startedAt, rounds);
      }
      this.dayTokens += addTokens(tokens, completion);

      // THE CAP IS A CEILING, NOT A TARGET: a round that spends past it stops the brief even if
      // its answer would have passed. This is what makes the per-brief case discriminate.
      if (tokens.total > settings.perBriefTokenCap) {
        return this.fallback(input, 'per-brief-token-cap-reached', ask, failures, tokens, startedAt, rounds);
      }

      const parsed = parseBriefAnswer(completion.text);
      if (parsed === null) {
        failures.push({ round: rounds, rules: ['unparseable-json'], raw: completion.text, reason: 'answer was not a JSON object' });
        user = buildBriefRepairPrompt(completion.text, UNPARSEABLE);
        continue;
      }

      const expanded = expandBrief(parsed);
      const checked = checkBrief(expanded);
      if (checked.ok && expanded !== null) {
        const result: CockpitBriefResult = {
          ...identityOf(input, ask),
          status: 'generated',
          reason: null,
          cached: false,
          rounds,
          failures,
          tokens,
          durationMs: (this.deps.now?.() ?? Date.now()) - startedAt,
          brief: expanded,
        };
        this.cache.set(cacheKey, result);
        return result;
      }

      failures.push({
        round: rounds,
        rules: checked.errors.map((entry) => entry.rule),
        raw: completion.text,
        reason: 'host check failed',
      });
      user = buildBriefRepairPrompt(completion.text, checked.errors);
    }

    // Three rejected rounds: fall back, keep the raw answers, and remember this ask so the same
    // card does not spend another three rounds on the next read.
    const result = fallbackResult({
      identity: identityOf(input, ask),
      reason: 'check-failed-after-3-rounds',
      rounds,
      failures,
      tokens,
      durationMs: (this.deps.now?.() ?? Date.now()) - startedAt,
    });
    this.cache.set(cacheKey, result);
    return result;
  }

  /** Every non-generated outcome, with the deterministic default brief. */
  private fallback(
    input: CockpitBriefInput,
    reason: string,
    ask: CockpitBriefAsk | null,
    failures: CockpitBriefFailure[],
    tokens: CockpitBriefTokens,
    startedAt: number,
    rounds: number,
  ): CockpitBriefResult {
    return fallbackResult({
      identity: identityOf(input, ask),
      reason,
      rounds,
      failures,
      tokens,
      durationMs: (this.deps.now?.() ?? Date.now()) - startedAt,
    });
  }

  /** Reset the day ledger when the UTC date changes. */
  private rollDay(at: number): void {
    const key = new Date(at).toISOString().slice(0, 10);
    if (key !== this.dayKey) {
      this.dayKey = key;
      this.dayTokens = 0;
    }
  }
}

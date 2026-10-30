/**
 * The quay-fleet card provider: the cockpit's adapter over the fleet's card read port.
 *
 * WHY IT IS THIS THIN. Whether a thing becomes a card, when it ends, whether it notifies and
 * in what order it belongs are the fleet's judgements; this adapter only runs the read port,
 * projects each JSONL line (`cockpit-fleet-card-projection.ts`), and reports what happened.
 * The cockpit's registry therefore stays ignorant of fleet semantics, and adding another
 * provider remains one implementation plus one registration.
 *
 * THE CACHE IS A SHORT TTL, NOT A SECOND MODEL. Every display poll may ask for cards, and the
 * fleet CLI is a child process; within `ttlMs` (default 5 s) repeated reads return the same
 * batch and run the CLI once. An edit reaches the next window without a push channel, which
 * is the honest shape until the fleet exposes one. OUR OWN WRITES ARE THE EXCEPTION: a disposal
 * executor built here (`rescue exec …`) drops the batch on the way out, because that batch
 * predates the write and the caller re-reads immediately — answering it would keep showing the
 * card as open right after it was discarded (see `runExecutor`).
 *
 * FAILURE IS A READING, NOT A THROW. A missing CLI, a non-zero exit, or a child that never
 * spawned all answer an empty list plus a readable `reason` on the diagnostic the card route
 * exposes. One malformed JSONL line is counted and skipped; it never hides its neighbours.
 *
 * THE SWITCH. `cockpit.fleetCards.enabled` (shipped off) is honoured here as well as at the
 * composition root: with it off this provider runs no child process at all and reports why.
 *
 * Consumers: `server/cockpit-fleet-wiring.ts` (the composition seam), `cockpit.module.ts`
 * (which registers the provider) and the provider's criterion.
 */
import type { ICockpitCardProvider } from '@/shared/interfaces.js';
import type { CockpitCard, SessionAskDecisionReading } from '@/shared/types.js';

import type { CockpitExecutorResolver } from './cockpit-card-actions.js';
import type {
  CockpitCardProviderDiagnostic,
  ICockpitCardProviderWithDiagnostics,
} from './cockpit-card-registry.js';
import {
  createCockpitFleetProjection,
  type CockpitFleetContentReader,
} from './cockpit-fleet-card-projection.js';
import {
  COCKPIT_FLEET_EXECUTORS_ARGS,
  CockpitFleetExecutor,
  readCockpitFleetExecutors,
  type CockpitFleetCommandResult,
  type CockpitFleetExecutorReading,
} from './cockpit-fleet-executor.js';

/** This adapter's stable provider id; every projected card carries it. */
export const COCKPIT_FLEET_PROVIDER_ID = 'quay-fleet';

/** The shipped read cache window. `cockpit.fleetCards.ttlMs` overrides it per boot. */
export const DEFAULT_COCKPIT_FLEET_CARDS_TTL_MS = 5_000;

/**
 * The longest an executor declaration is trusted. The set changes only when the fleet is
 * installed/upgraded, so a one-hour window keeps the startup read while making a refresh at most
 * hourly — not once per card poll.
 */
export const DEFAULT_COCKPIT_FLEET_EXECUTORS_TTL_MS = 3_600_000;

/** The fleet read port's argv, before the optional filters. */
const BASE_ARGS = ['cockpit', 'cards', '--json'] as const;

/** What one child call answered; defined beside the executor and re-exported for this seam. */
export type { CockpitFleetCommandResult } from './cockpit-fleet-executor.js';

/** Optional filters from the fleet read port; the registry calls the no-argument form. */
export type CockpitFleetReadOptions = {
  project?: string;
  state?: 'open' | 'resolved' | 'expired';
  /** Include already-ended cards (the read port's `--include-resolved`). */
  includeResolved?: boolean;
  /** Lower bound for included resolved cards, ISO-8601. */
  since?: string;
};

/** Everything the provider needs from outside; every reading is injected. */
export type CockpitFleetCardProviderDeps = {
  runCards(args: readonly string[]): Promise<CockpitFleetCommandResult>;
  /**
   * The executor declaration port (`rescue executors --json`) and the executor runner. One
   * function serves both because both are the same child seam; omitted only by a criterion that
   * does not exercise disposal (the reading then says so).
   */
  runExecutors?(args: readonly string[]): Promise<CockpitFleetCommandResult>;
  /** The observation layer's T1 digest for one session/message pair; `null` when absent. */
  readSessionAsk: CockpitFleetContentReader;
  /**
   * The assistant message ids this host has WITHDRAWN as mis-stated asks. A fleet card whose
   * `contentRef.messageId` is in the set is dropped from the visible list. The real reading is
   * async (the shared event stream); a criterion may supply a plain set. Absent means no local
   * suppression.
   */
  readRetractedMessageIds?: () => Promise<ReadonlySet<string>> | ReadonlySet<string>;
  /** The settings switch; defaults to true for a direct construction. */
  enabled?: boolean;
  /** Cache window; `0` disables caching. Defaults to {@link DEFAULT_COCKPIT_FLEET_CARDS_TTL_MS}. */
  ttlMs?: number;
  /**
   * The executor-declaration window; `0` re-reads on every card-cache miss. Defaults to one
   * hour ({@link DEFAULT_COCKPIT_FLEET_EXECUTORS_TTL_MS}).
   */
  executorTtlMs?: number;
  /** Clock seam so a criterion can advance past either TTL without sleeping. */
  now?: () => number;
};

/** The provider plus the diagnosis of its last read. */
export type CockpitFleetCardProvider = {
  provider: ICockpitCardProvider & {
    /** Resolved lazily from the CURRENT declaration reading (see the module doc). */
    resolveExecutor: CockpitExecutorResolver;
    /** The declaration whose action is `feedback`, or null when the fleet declares none. */
    feedbackExecutor(): string | null;
  };
  /**
   * The same read the provider exposes, with the port's optional filters. The card contract's
   * `listCards()` takes no arguments, so resolved-history reads are a fleet-specific entry
   * point rather than a widened provider contract.
   */
  listCards(options?: CockpitFleetReadOptions): Promise<CockpitCard[]>;
  /** One entry, always: what the most recent `listCards` read (or why it did not). */
  diagnostics(): readonly CockpitCardProviderDiagnostic[];
  /**
   * The current executor declaration reading, awaiting a stale read. The cockpit's card route
   * does not surface this (its diagnostic describes the card read); the fleet wiring and the
   * criterion read it to explain an empty `declaredExecutors()`.
   */
  executorReading(): Promise<CockpitFleetExecutorReading>;
};

/** One TTL entry: the batch and the diagnosis it produced. */
type CacheEntry = {
  at: number;
  cards: CockpitCard[];
  diagnostic: CockpitCardProviderDiagnostic;
};

/** Builds the fleet read port's argv, filters included, in a deterministic order. */
function readArgs(options: CockpitFleetReadOptions): string[] {
  const args: string[] = [...BASE_ARGS];
  if (options.project !== undefined && options.project !== '') args.push('--project', options.project);
  if (options.state !== undefined) args.push('--state', options.state);
  if (options.includeResolved === true) args.push('--include-resolved');
  if (options.since !== undefined && options.since !== '') args.push('--since', options.since);
  return args;
}

/**
 * The readable line of a child's complaint.
 *
 * The real CLI answers an unknown command with its full usage text (tens of kB); pasting that
 * whole thing into one diagnostic field helps nobody. The first non-empty line names the error,
 * and the cap keeps a pathological single line from filling the response.
 */
function firstLine(text: string): string {
  const line = text.split('\n').find((entry) => entry.trim() !== '')?.trim() ?? '';
  return line.length > 300 ? `${line.slice(0, 297)}...` : line;
}

/**
 * Why one invocation produced no cards.
 *
 * The child's own first stderr line wins: the seam's `error` sentence for a non-zero exit is
 * generic ("Command failed: …") and would hide the sentence that names the cause. A spawn
 * failure has no stderr, so the seam's sentence is the fallback, then the bare status.
 */
function failureReason(result: CockpitFleetCommandResult): string {
  const stderr = firstLine(result.stderr);
  if (stderr !== '') return stderr;
  const seamReason = firstLine(result.error?.trim() ?? '');
  if (seamReason !== '') return seamReason;
  return `quay-fleet cockpit cards exited ${result.exitCode === null ? 'without a status' : String(result.exitCode)}`;
}

/**
 * Builds the provider over its injected CLI and digest readings.
 *
 * Nothing here is module-level state: the cache, the last diagnosis and the projection belong
 * to this instance's closure, so two providers in one process are independent.
 */
export function createCockpitFleetCardProvider(
  deps: CockpitFleetCardProviderDeps,
): CockpitFleetCardProvider {
  const enabled = deps.enabled ?? true;
  const ttlMs = deps.ttlMs ?? DEFAULT_COCKPIT_FLEET_CARDS_TTL_MS;
  const executorTtlMs = deps.executorTtlMs ?? DEFAULT_COCKPIT_FLEET_EXECUTORS_TTL_MS;
  const now = deps.now ?? Date.now;
  const projection = createCockpitFleetProjection({ readSessionAsk: deps.readSessionAsk });
  const cache = new Map<string, CacheEntry>();

  // The executor declaration is a SECOND reading with its own, much longer window. It is kept
  // here (not on the module) so two providers in one process are independent, and it is read
  // lazily: the constructor starts the first read, a card-cache miss refreshes it once hourly.
  const runExecutors: CockpitFleetCardProviderDeps['runExecutors'] = deps.runExecutors;
  /**
   * The runner every executor this provider builds is handed.
   *
   * A disposal call (`rescue exec …`) writes to the fleet, so any batch in `cache` was read
   * BEFORE that write. Dropping it on the way out — success or refusal — is what makes the
   * caller's immediate re-read after a dismiss run the CLI instead of answering a batch that
   * still names the discarded card for up to another `ttlMs` (the card then reappears in its
   * pre-dismiss state before the next poll removes it). The declaration read is not a write and
   * keeps the card cache intact.
   */
  const runExecutor =
    (run: NonNullable<CockpitFleetCardProviderDeps['runExecutors']>) =>
    async (args: readonly string[]): Promise<CockpitFleetCommandResult> => {
      const writes = args[0] === 'rescue' && args[1] === 'exec';
      try {
        return await run(args);
      } finally {
        if (writes) cache.clear();
      }
    };
  let executorState: CockpitFleetExecutorReading & { at: number; read: boolean } = {
    declarations: [],
    reason: enabled ? 'rescue executors have not been read yet' : 'cockpit.fleetCards.enabled is off',
    at: 0,
    read: false,
  };
  let executorRead: Promise<CockpitFleetExecutorReading> | null = null;

  const readExecutors = (): Promise<CockpitFleetExecutorReading> => {
    if (executorRead !== null) return executorRead;
    const at = now();
    executorRead = (async () => {
      let reading: CockpitFleetExecutorReading;
      if (runExecutors === undefined) {
        reading = {
          declarations: [],
          reason: 'no quay-fleet executor runner was injected',
        };
      } else {
        try {
          reading = readCockpitFleetExecutors(await runExecutors(COCKPIT_FLEET_EXECUTORS_ARGS));
        } catch (failure) {
          reading = {
            declarations: [],
            reason: `quay-fleet rescue executors failed: ${
              failure instanceof Error ? failure.message : String(failure)
            }`,
          };
        }
      }
      executorState = { ...reading, at, read: true };
      return reading;
    })().finally(() => {
      executorRead = null;
    });
    return executorRead;
  };

  const ensureExecutors = async (): Promise<CockpitFleetExecutorReading> => {
    if (!enabled) {
      return { declarations: [], reason: 'cockpit.fleetCards.enabled is off' };
    }
    if (executorState.read && now() - executorState.at < executorTtlMs) {
      return { declarations: executorState.declarations, reason: executorState.reason };
    }
    return readExecutors();
  };

  // `启动时`: the first declaration read starts with the provider, not with the first confirm.
  // It never rejects (failures are readings), so no unhandled rejection can escape.
  void ensureExecutors();

  let last: CockpitCardProviderDiagnostic = {
    provider: COCKPIT_FLEET_PROVIDER_ID,
    ok: false,
    reason: enabled ? 'no card read yet' : 'cockpit.fleetCards.enabled is off',
    cards: 0,
    skippedLines: 0,
    cached: false,
  };

  const listCards = async (options: CockpitFleetReadOptions = {}): Promise<CockpitCard[]> => {
    if (!enabled) {
      last = {
        provider: COCKPIT_FLEET_PROVIDER_ID,
        ok: false,
        reason: 'cockpit.fleetCards.enabled is off',
        cards: 0,
        skippedLines: 0,
        cached: false,
      };
      return [];
    }

    const args = readArgs(options);
    const key = args.join('\u0000');
    const at = now();
    const cached = cache.get(key);
    if (cached !== undefined && ttlMs > 0 && at - cached.at < ttlMs) {
      last = { ...cached.diagnostic, cached: true };
      return cached.cards.map((card) => structuredClone(card));
    }

    // A card-cache miss is also the executor-declaration refresh point (at most hourly). The
    // declaration reading is awaited here too because a digest card's disposal option is built
    // FROM it (`fleet.park`/`fleet.hold` by action) — the projection never names a fleet id.
    const [result, executors] = await Promise.all([deps.runCards(args), ensureExecutors()]);
    if (result.exitCode !== 0 || result.error !== undefined) {
      last = {
        provider: COCKPIT_FLEET_PROVIDER_ID,
        ok: false,
        reason: failureReason(result),
        cards: 0,
        skippedLines: 0,
        cached: false,
      };
      cache.set(key, { at, cards: [], diagnostic: last });
      return [];
    }

    // The withdrawal set is read per pass and BEFORE projecting, so a card the stream has
    // withdrawn never reaches the list. A failing read suppresses nothing (fail open): the wall
    // showing one extra card is a smaller harm than an empty wall.
    let retracted: ReadonlySet<string> | undefined;
    try {
      retracted = await deps.readRetractedMessageIds?.();
    } catch {
      retracted = undefined;
    }
    const projected = projection.project(result.stdout, {
      ...(retracted === undefined ? {} : { retracted }),
      declarations: executors.declarations,
    });
    last = {
      provider: COCKPIT_FLEET_PROVIDER_ID,
      ok: true,
      reason:
        projected.skippedLines === 0
          ? null
          : `${projected.skippedLines} malformed card line(s) skipped`,
      cards: projected.cards.length,
      skippedLines: projected.skippedLines,
      cached: false,
    };
    cache.set(key, { at, cards: projected.cards, diagnostic: last });
    return projected.cards.map((card) => structuredClone(card));
  };

  // The declaration set is what makes every disposal option CONFIRMABLE: the action channel
  // refuses an executor no provider declared, and this is the provider's statement of the fleet's
  // surface. An empty set means the CLI did not answer (the reason rides on `executorReading`).
  const declaredExecutors = (): readonly string[] =>
    executorState.declarations.map((declaration) => declaration.id);

  // The implementation is resolved LAZILY, because the declaration arrives after construction
  // (the CLI is an async child). The cockpit module discovers this capability structurally from
  // the provider object it registers; the action channel asks it only for an id it just found
  // declared, so an undeclared id never reaches here.
  const resolveExecutor: CockpitExecutorResolver = async (id) => {
    const reading = await ensureExecutors();
    const declaration = reading.declarations.find((entry) => entry.id === id);
    if (declaration === undefined || runExecutors === undefined) return null;
    return new CockpitFleetExecutor(declaration, { runFleet: runExecutor(runExecutors) });
  };

  // The diagnostic rides ON the provider, not only on this wrapper: the registry discovers the
  // capability structurally from the object it registers, and `server/index.ts` registers the
  // provider. Keeping it here is what lets `/api/cockpit/cards` explain an empty list.
  const feedbackExecutor = (): string | null => {
    const declaration = executorState.declarations.find((entry) => entry.action === 'feedback');
    return declaration === undefined ? null : declaration.id;
  };

  const provider: ICockpitCardProviderWithDiagnostics & {
    resolveExecutor: CockpitExecutorResolver;
    feedbackExecutor(): string | null;
  } = {
    id: COCKPIT_FLEET_PROVIDER_ID,
    listCards,
    declaredExecutors,
    resolveExecutor,
    feedbackExecutor,
    diagnostics: () => [last],
  };

  return {
    provider,
    listCards,
    diagnostics: () => provider.diagnostics(),
    executorReading: () => ensureExecutors(),
  };
}

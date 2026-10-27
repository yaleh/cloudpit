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
 * is the honest shape until the fleet exposes one.
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

import type {
  CockpitCardProviderDiagnostic,
  ICockpitCardProviderWithDiagnostics,
} from './cockpit-card-registry.js';
import {
  createCockpitFleetProjection,
  type CockpitFleetContentReader,
} from './cockpit-fleet-card-projection.js';

/** This adapter's stable provider id; every projected card carries it. */
export const COCKPIT_FLEET_PROVIDER_ID = 'quay-fleet';

/** The shipped read cache window. `cockpit.fleetCards.ttlMs` overrides it per boot. */
export const DEFAULT_COCKPIT_FLEET_CARDS_TTL_MS = 5_000;

/** The fleet read port's argv, before the optional filters. */
const BASE_ARGS = ['cockpit', 'cards', '--json'] as const;

/** What one `runCards` call answered; the child seam's own classification reduced to this. */
export type CockpitFleetCommandResult = {
  /** `0` for success; the child's status, or `null` when it never ran. */
  exitCode: number | null;
  stdout: string;
  stderr: string;
  /** Why the child could not be run, when the seam knows (a missing binary, a timeout). */
  error?: string;
};

/** Optional filters from the fleet read port; the registry calls the no-argument form. */
export type CockpitFleetReadOptions = {
  project?: string;
  state?: 'open' | 'resolved' | 'expired';
  /** Include already-ended cards (the read port's `--include-resolved`). */
  includeResolved?: boolean;
  /** Lower bound for included resolved cards, ISO-8601. */
  since?: string;
};

/** Everything the provider needs from outside; both readings are injected. */
export type CockpitFleetCardProviderDeps = {
  runCards(args: readonly string[]): Promise<CockpitFleetCommandResult>;
  /** The observation layer's T1 digest for one session/message pair; `null` when absent. */
  readSessionAsk: CockpitFleetContentReader;
  /** The settings switch; defaults to true for a direct construction. */
  enabled?: boolean;
  /** Cache window; `0` disables caching. Defaults to {@link DEFAULT_COCKPIT_FLEET_CARDS_TTL_MS}. */
  ttlMs?: number;
  /** Clock seam so a criterion can advance past the TTL without sleeping. */
  now?: () => number;
};

/** The provider plus the diagnosis of its last read. */
export type CockpitFleetCardProvider = {
  provider: ICockpitCardProvider;
  /**
   * The same read the provider exposes, with the port's optional filters. The card contract's
   * `listCards()` takes no arguments, so resolved-history reads are a fleet-specific entry
   * point rather than a widened provider contract.
   */
  listCards(options?: CockpitFleetReadOptions): Promise<CockpitCard[]>;
  /** One entry, always: what the most recent `listCards` read (or why it did not). */
  diagnostics(): readonly CockpitCardProviderDiagnostic[];
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
  const now = deps.now ?? Date.now;
  const projection = createCockpitFleetProjection({ readSessionAsk: deps.readSessionAsk });
  const cache = new Map<string, CacheEntry>();
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

    const result = await deps.runCards(args);
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

    const projected = projection.project(result.stdout);
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

  // The diagnostic rides ON the provider, not only on this wrapper: the registry discovers the
  // capability structurally from the object it registers, and `server/index.ts` registers the
  // provider. Keeping it here is what lets `/api/cockpit/cards` explain an empty list.
  const provider: ICockpitCardProviderWithDiagnostics = {
    id: COCKPIT_FLEET_PROVIDER_ID,
    listCards,
    // Fleet disposal executors are delivered by a later task. Declaring none is what makes a
    // card option readable but its confirmation refuse with a readable "not declared" reason.
    declaredExecutors: () => [],
    diagnostics: () => [last],
  };

  return { provider, listCards, diagnostics: () => provider.diagnostics() };
}

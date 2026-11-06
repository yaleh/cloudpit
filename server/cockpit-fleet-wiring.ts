/**
 * The quay-fleet card provider's composition seam: the one place that turns the fleet CLI and
 * the observation layer's T1 digest into the injected readings the leaf cockpit module needs.
 *
 * WHY BESIDE THE COMPOSITION ROOT. `server/modules/cockpit` is a leaf for AC-394: it may import
 * `server/shared/**` and itself only. The fleet adapter therefore takes its world as functions,
 * and this file is where the root binds them — the CLI through the SAME locator and child
 * runner every other fleet reader uses, and the digest through the observation store's public
 * `getObject`. Keeping the binding here rather than inline in `server/index.ts` also keeps that
 * already-oversize file from growing by more than the one constructor call.
 *
 * THE DIGEST LOOKUP IS BY SESSION, NOT BY THE FLEET'S messageId. The producer rewrites the
 * session object's `askDecision` on every asking turn, and its `askId` names the FIRST asking
 * message in the span (a re-ask keeps that id and bumps `revision`); the fleet's contentRef
 * names the current asking message. Requiring an exact message match would therefore report
 * "content not ready" for every re-ask. The reader answers the session's latest digest and the
 * provider states whether it was usable. That reader also repairs a digest stored while the
 * tier was switched off, so the cockpit itself never decides whether content is stale.
 *
 * Consumers: `server/index.ts`, which passes the provider to `createCockpitCardsModule`.
 */
import type { SessionAskDecisionReading } from '@/shared/types.js';

import {
  createCockpitFleetCardProvider,
  type CockpitFleetCardProvider,
  type CockpitFleetCommandResult,
} from './modules/cockpit/index.js';
import { readRetractedSessionAskMessageIds } from './modules/context-events/index.js';
import {
  createObservationStore,
  createSessionAskDecisionReader,
  type SessionAskDecisionReader,
} from './modules/observation/index.js';
import { createQuayFleetRunner, locateQuayFleetCli } from './modules/quay/index.js';
import type { QuayFleetRunner, QuayFleetRunnerOptions } from './modules/quay/index.js';

/** The settings-file reading this seam consumes; `server/index.ts` supplies it. */
export type CockpitFleetWiringOptions = {
  /** `cockpit.fleetCards.enabled`; with it off no child process is spawned. */
  enabled: boolean;
  /** `cockpit.fleetCards.ttlMs`; the read cache window. */
  ttlMs?: number;
};

/**
 * Reads one session's T1 ask digest through the observation layer's reader.
 *
 * The reader owns both halves: the stored reading (the three states passed through so the
 * provider can name exactly why content is not ready) and the read-time repair of a reading
 * stored while the tier was switched off. The cockpit therefore decides nothing here.
 */
function readAskDecision(
  reader: SessionAskDecisionReader,
  sessionId: string,
  messageId: string,
): SessionAskDecisionReading | null {
  // The fleet's contentRef names the assistant message this card is about. Pass it through: by
  // the time a card is read the conversation may have advanced past that message, and a reader
  // that only looked at the session's LAST message would never find the ask.
  return reader.read(sessionId, messageId);
}

/**
 * The stdout bound for the cockpit's card read: 8 MiB.
 *
 * WHY THIS IS NOT THE SHARED 1 MiB DEFAULT. `cockpit cards --json` is the one fleet read whose
 * document grows with the number of OPEN cards, and it already reached 1,079,812 B with 67 cards
 * on 2026-11-06. At the shared default that read was killed by `execFile` with
 * `ERR_CHILD_PROCESS_STDIO_MAXBUFFER`, and the provider — unable to tell a truncated stdout from
 * a failure with no output — dropped the whole batch and answered an empty list. The bound is
 * sized for a few hundred open cards; every OTHER fleet reader keeps the 1 MiB default.
 */
export const COCKPIT_FLEET_CARDS_MAX_OUTPUT_BYTES = 8 * 1024 * 1024;

/** The seams the cockpit card-read runner accepts; production supplies neither. */
export type CockpitFleetRunnerFactoryOptions = {
  /** The binary to spawn; defaults to the shared locator (`QUAY_FLEET_BIN` → PATH → home). */
  resolveBinPath?: () => string | null;
  /**
   * The child-process seam. A criterion injects one to observe the `maxBuffer` the runner hands
   * `execFile` (and to answer a deterministic batch without a fleet installation).
   */
  exec?: NonNullable<QuayFleetRunnerOptions['exec']>;
};

/**
 * Builds the cockpit's card-read runner over the 8 MiB bound and the shared child pipeline.
 *
 * Exported as a factory, not inlined at the boot site, so a criterion can drive the REAL bound
 * through an injected `exec` — the failure this task fixes lived in the composition seam, not in
 * the provider, and a test that constructed its own runner would not see it.
 */
export function createCockpitFleetRunner(
  options: CockpitFleetRunnerFactoryOptions = {},
): QuayFleetRunner {
  return createQuayFleetRunner({
    resolveBinPath: options.resolveBinPath ?? (() => locateQuayFleetCli().binPath),
    maxOutputBytes: COCKPIT_FLEET_CARDS_MAX_OUTPUT_BYTES,
    ...(options.exec === undefined ? {} : { exec: options.exec }),
  });
}

/** One child answer projected into the leaf module's narrower result shape. */
function toCommandResult(answer: Awaited<ReturnType<QuayFleetRunner>>): CockpitFleetCommandResult {
  return {
    exitCode: answer.ok ? 0 : answer.code,
    stdout: answer.stdout,
    stderr: answer.stderr,
    ...(answer.error === undefined ? {} : { error: answer.error }),
    // Additive and optional: the leaf provider branches on it only to salvage a maxBuffer-truncated
    // batch; every existing consumer of this seam reads `exitCode`/`error` exactly as before.
    ...(answer.errorCode === undefined ? {} : { errorCode: answer.errorCode }),
  };
}

/**
 * Builds the fleet card provider over the process's real fleet CLI and observation store.
 *
 * Consumers: `server/index.ts` and, for the DoD, an isolated instance's boot (the same
 * composition root). A criterion injects `runCards`/`readSessionAsk` directly instead.
 */
export function createCockpitFleetProvider(
  options: CockpitFleetWiringOptions,
): CockpitFleetCardProvider {
  const run = createCockpitFleetRunner();
  const store = createObservationStore();
  // One reader per provider instance: its in-flight guard, attempted set and sliding hour are
  // exactly the state that makes "one repair per ask" hold across successive card reads.
  const askReader = createSessionAskDecisionReader({ store });

  return createCockpitFleetCardProvider({
    enabled: options.enabled,
    ...(options.ttlMs === undefined ? {} : { ttlMs: options.ttlMs }),
    runCards: async (args) => toCommandResult(await run(args)),
    // The SAME child seam reads the executor declarations and runs them: `rescue executors
    // --json` and `rescue exec`. Keeping one runner means the locator and its failure wording
    // cannot drift between the read and the write surface.
    runExecutors: async (args) => toCommandResult(await run(args)),
    readSessionAsk: (sessionId, messageId) => readAskDecision(askReader, sessionId, messageId),
    // LOCAL SUPPRESSION, read from the shared stream rather than from the observation store: a
    // session whose digest revision never landed has no object at all, and its withdrawn card
    // must still stop showing. The reader is cheap and bounded to the lookback window; it is
    // called once per projected stdout pass, never per card.
    readRetractedMessageIds: () => readRetractedSessionAskMessageIds(),
  });
}

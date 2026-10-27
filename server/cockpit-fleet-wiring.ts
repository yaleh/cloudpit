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
} from './modules/cockpit/index.js';
import {
  createObservationStore,
  createSessionAskDecisionReader,
  type SessionAskDecisionReader,
} from './modules/observation/index.js';
import { createQuayFleetRunner, locateQuayFleetCli } from './modules/quay/index.js';

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
 * Builds the fleet card provider over the process's real fleet CLI and observation store.
 *
 * Consumers: `server/index.ts` and, for the DoD, an isolated instance's boot (the same
 * composition root). A criterion injects `runCards`/`readSessionAsk` directly instead.
 */
export function createCockpitFleetProvider(
  options: CockpitFleetWiringOptions,
): CockpitFleetCardProvider {
  const run = createQuayFleetRunner({ resolveBinPath: () => locateQuayFleetCli().binPath });
  const store = createObservationStore();
  // One reader per provider instance: its in-flight guard, attempted set and sliding hour are
  // exactly the state that makes "one repair per ask" hold across successive card reads.
  const askReader = createSessionAskDecisionReader({ store });

  return createCockpitFleetCardProvider({
    enabled: options.enabled,
    ...(options.ttlMs === undefined ? {} : { ttlMs: options.ttlMs }),
    runCards: async (args) => {
      const answer = await run(args);
      return {
        exitCode: answer.ok ? 0 : answer.code,
        stdout: answer.stdout,
        stderr: answer.stderr,
        ...(answer.error === undefined ? {} : { error: answer.error }),
      };
    },
    // The SAME child seam reads the executor declarations and runs them: `rescue executors
    // --json` and `rescue exec`. Keeping one runner means the locator and its failure wording
    // cannot drift between the read and the write surface.
    runExecutors: async (args) => {
      const answer = await run(args);
      return {
        exitCode: answer.ok ? 0 : answer.code,
        stdout: answer.stdout,
        stderr: answer.stderr,
        ...(answer.error === undefined ? {} : { error: answer.error }),
      };
    },
    readSessionAsk: (sessionId, messageId) => readAskDecision(askReader, sessionId, messageId),
  });
}

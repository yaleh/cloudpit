/**
 * The producer batch verb — refresh many targets through one producer, in order.
 *
 * Both observation producers (`architecture-delta` and `project-truth`) expose a `refreshAll`
 * that walks a target list, calls their single-target `refreshProject` and keeps only the
 * revisions that were actually written. The loop was identical in both files apart from the loop
 * variable's name, so it lives here once.
 *
 * SEQUENTIAL ON PURPOSE. The single-target verbs run analysis or a deploy check per target; a
 * `Promise.all` fan-out would turn one refresh into an analysis/subprocess storm. `null` from the
 * single-target verb means there was nowhere to record the reading (an unaddressable target or a
 * store failure), so that target is omitted from the answer rather than represented as a hole.
 *
 * Consumers: `architecture-delta.producer.ts` and `project-truth.producer.ts`.
 */
import type { ObservedObject } from '../core/index.js';

/**
 * Refreshes every target through `refreshOne`, one at a time, and answers the revisions that
 * were written. A `null` reading is skipped, so the result can be shorter than `targets`.
 */
export async function refreshAllOf<Target>(
  refreshOne: (target: Target) => Promise<ObservedObject | null>,
  targets: readonly Target[],
): Promise<ObservedObject[]> {
  const written: ObservedObject[] = [];
  for (const target of targets) {
    const object = await refreshOne(target);
    if (object !== null) written.push(object);
  }
  return written;
}

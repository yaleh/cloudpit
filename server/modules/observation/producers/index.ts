/**
 * Observation producers subpackage — barrel.
 *
 * The two project-level producers that write revisions through the observation store on their
 * own clocks: project truth (`createProjectTruthProducer`, `buildProjectTruth`) and the
 * architecture structural delta (`createArchitectureDeltaProducer`,
 * `diffArchitectureStructures`).
 *
 * Consumers: `modules/observation`'s root barrel and the composition root, which starts each
 * producer on its refresh interval; `observation-wall-ui` renders their readings. Both import
 * only the observation `core` subpackage and `server/shared/**`, so the subpackage is a sink
 * in the module's dependency graph. `producer-batch.ts` stays internal: it is the shared
 * refresh loop and has no cross-package consumer.
 */
export * from './project-truth.js';
export * from './project-truth.producer.js';
export * from './architecture-delta.js';
export * from './architecture-delta.producer.js';

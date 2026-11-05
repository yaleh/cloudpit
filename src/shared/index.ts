/**
 * The shared layer's public surface for consumers outside `src/shared`.
 *
 * The root used to be one flat grab bag of voice, settings and API modules; the
 * concerns now live in their own packages (`api/`, `settings/`, `voice/`,
 * `voice-asr/`) and are imported from those barrels. Nothing exported here may
 * import a feature module — that is what keeps `shared` loadable on its own (see
 * `src/shared/tests/sharedLayerIsolation.test.tsx`).
 *
 * Kept as a module (rather than deleted) so `import * as shared from '@/shared'`
 * remains a live, empty-surface probe of the root package.
 */
export {};

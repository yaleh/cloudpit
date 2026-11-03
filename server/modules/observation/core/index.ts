/**
 * Observation core — barrel.
 *
 * The primitives every observation pipeline shares: the observed-object model and its
 * append-only store, the URI formatter/parser, the producer-liveness reading, the
 * deterministic transcript digest builder, the digest LLM tier's settings reader, and the
 * blind-spot declarations the store merges into a digest.
 *
 * Consumers: `modules/observation`'s router/wall files, and the `session-digest`,
 * `session-ask` and `producers` subpackages. These files import only `server/shared/**`,
 * `server/modules/database`, `server/modules/reply-suggestions` and `server/modules/llm-gateway`;
 * nothing here imports a sibling subpackage, which is what keeps the split acyclic.
 */
export * from './observation-store.js';
export * from './observation-uri.js';
export * from './producer-liveness.js';
export * from './session-digest.js';
export * from './session-digest-llm-settings.js';
export * from './blind-spots.js';

/**
 * Compatibility barrel — the implementation now lives in `lifecycle/claude-shell.provider.ts`.
 *
 * Kept at the historical path so every existing consumer (the providers
 * barrel, the criteria and the composition root) resolves unchanged. The
 * declaration itself is in the lifecycle subpackage, so this file adds no
 * entity to the `modules/providers/list/claude` package.
 */
export * from './lifecycle/claude-shell.provider.js';

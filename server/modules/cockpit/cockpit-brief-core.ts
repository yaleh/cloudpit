/**
 * The shared vocabulary of BriefSpec v0: version, limits, the error/result shapes every part of
 * the checker speaks, and the small value helpers the preset checkers share.
 *
 * WHY A SEPARATE FILE. The spec is split by concern so no single implementation file crosses the
 * repository's ~260-line ratchet: this file owns the vocabulary, `cockpit-brief-radar-preset.ts`
 * owns the radar (the one preset with its own semantic builder), `cockpit-brief-presets.ts` owns
 * the remaining presets and the registry, and `cockpit-brief-spec.ts` owns the document-level
 * check plus the `radarSemantic` expansion. The chain is core ← presets ← spec, with no cycle.
 *
 * Consumers: `cockpit-brief-radar-preset.ts`, `cockpit-brief-presets.ts`, `cockpit-brief-spec.ts`,
 * `cockpit-brief.service.ts` (the version and iteration ceiling reach the prompt) and
 * `tests/cockpit-brief-spec.test.ts`.
 */

import { isRecord } from '@/shared/utils.js';

/** The BriefSpec version this module writes and accepts. */
export const BRIEF_VERSION = 0;

/** How many model rounds the host allows before it gives up and shows the default card. */
export const MAX_ITERATIONS = 3;

/** Layout/size limits shared by the prompt, the checker and the default card. */
export const LIMITS = {
  headline: 80,
  why: 140,
  blocks: 6,
  options: 5,
  bytes: 24_000,
} as const;

/** Comparable axes every radar must carry, so two items can be read on the same scale. */
export const UNIVERSAL_AXES = ['rev', 'evid'] as const;

/** One reason a brief cannot be rendered. Every error names a path and a concrete fix. */
export type BriefError = {
  path: string;
  rule: string;
  message: string;
  fix: string;
};

/** The checker's answer. `iterationsAllowed` is repeated so a caller does not re-spell it. */
export type BriefCheckResult = {
  ok: boolean;
  errors: BriefError[];
  iterationsAllowed: number;
};

/** A brief document as the model writes it (loosely typed on purpose: this is untrusted input). */
export type BriefDocument = Record<string, unknown>;

/** The preset block types v0 knows. `canvas` is deliberately absent. */
export type BriefPresetName =
  | 'radar'
  | 'compare-table'
  | 'diffstat'
  | 'checklist'
  | 'timeline'
  | 'graph'
  | 'callout';

/** What a preset check needs from the enclosing document. */
export type BriefCheckContext = {
  optionIds: string[];
  evidenceIds: Set<string>;
  mechanicalEvidence: Set<string>;
};

/** One preset: its prompt description, an example of its semantic input, a builder, a checker. */
export type BriefPreset = {
  describe: string;
  example: Record<string, unknown>;
  build(semantic: Record<string, unknown>, doc?: Record<string, unknown>): Record<string, unknown>;
  check(block: Record<string, unknown>, context: BriefCheckContext, path: string): BriefError[];
};

/** Build one checker error. */
export function briefError(path: string, rule: string, message: string, fix: string): BriefError {
  return { path, rule, message, fix };
}

/** Display width: CJK/full-width code points count two cells, everything else one. */
export function displayWidth(text: string): number {
  let width = 0;
  for (const char of text) {
    width += /[⺀-鿿＀-￯]/.test(char) ? 2 : 1;
  }
  return width;
}

/** A non-empty string: the minimum is measured in display cells, the maximum in characters. */
export function isBriefString(
  value: unknown,
  minimum = 1,
  maximum = Number.POSITIVE_INFINITY,
): value is string {
  return typeof value === 'string' && displayWidth(value.trim()) >= minimum && value.length <= maximum;
}

/** A score is an integer 0–100, never a float and never NaN. */
export function isInteger0to100(value: unknown): boolean {
  return Number.isInteger(value) && (value as number) >= 0 && (value as number) <= 100;
}

/** Read an object as a record, treating anything else as empty. */
export function asRecord(value: unknown): Record<string, unknown> {
  return isRecord(value) ? value : {};
}

/** Read an array, treating anything else as empty. */
export function asArray(value: unknown): unknown[] {
  return Array.isArray(value) ? value : [];
}

/** Read a string, treating anything else as empty. */
export function asString(value: unknown): string {
  return typeof value === 'string' ? value : '';
}

/** Read the string members of an array, dropping everything else. */
export function asStringArray(value: unknown): string[] {
  return asArray(value).filter((entry): entry is string => typeof entry === 'string');
}

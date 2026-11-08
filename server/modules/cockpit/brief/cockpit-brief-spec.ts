/**
 * BriefSpec v0 — the document-level checker: every field, every reference, every block, and the
 * `radarSemantic` shorthand the host expands before checking.
 *
 * PORTED FROM THE E2 EXPERIMENT. `experiments/cockpit-briefing/brief-check.mjs` proved the format
 * over eight real asking sessions (8/8 passed inside three host-checked rounds); this module is
 * the server-side form of that same checker. The differences are deliberate:
 *
 *   · `canvas` is NOT ported in v0 — neither arm of E2 ever produced one, so a temporary SVG form
 *     has no measured use yet and would only widen the attack surface;
 *   · `checklist.items[].done` is OPTIONAL and defaults to false — E2's only first-round failure
 *     histogram was four `checklist-items` reds caused by requiring a completion flag on a list
 *     that is, by construction, "things to check before confirming".
 *
 * The split into `cockpit-brief-core.ts`, `cockpit-brief-radar-preset.ts` and
 * `cockpit-brief-presets.ts` is by concern so no implementation file crosses the module line
 * ratchet; the dependency chain is core ← presets ← this file.
 *
 * Consumers: `cockpit-brief.service.ts` (expands and checks every model round) and
 * `tests/cockpit-brief-spec.test.ts`.
 */

import {
  BRIEF_VERSION,
  LIMITS,
  MAX_ITERATIONS,
  asArray,
  asRecord,
  asString,
  asStringArray,
  briefError,
  isBriefString,
  type BriefCheckContext,
  type BriefCheckResult,
  type BriefDocument,
  type BriefError,
  type BriefPresetName,
} from './cockpit-brief-core.js';
import { PRESETS, radarPreset } from './cockpit-brief-presets.js';

/**
 * Expand the semantic shorthand used by the prompt: a top-level `radarSemantic` is built into a
 * radar block through the real builder and removed.
 *
 * WHY IT IS A HOST STEP. E2's CLI silently ignored the shorthand while the host expanded it, so a
 * radar missing the mandatory `evid` axis passed a CLI check and reddened the host. Both paths now
 * call this one function, so there is no second expansion rule to drift.
 */
export function expandBrief(input: unknown): Record<string, unknown> | null {
  if (input === null || typeof input !== 'object' || Array.isArray(input)) return null;
  const doc: Record<string, unknown> = { ...input };
  if (doc.radarSemantic !== null && typeof doc.radarSemantic === 'object' && !Array.isArray(doc.radarSemantic)) {
    doc.blocks = [...asArray(doc.blocks), radarPreset.build(asRecord(doc.radarSemantic), doc)];
    delete doc.radarSemantic;
  }
  return doc;
}

/** The document-level check: every field, every preset, every reference. */
export function checkBrief(input: unknown): BriefCheckResult {
  if (input === null || typeof input !== 'object' || Array.isArray(input)) {
    return {
      ok: false,
      errors: [briefError('$', 'not-an-object', 'brief must be a JSON object', 'write a JSON object')],
      iterationsAllowed: MAX_ITERATIONS,
    };
  }
  const doc = input as Record<string, unknown>;
  const errors: BriefError[] = [];

  const size = JSON.stringify(doc).length;
  if (size > LIMITS.bytes) {
    errors.push(
      briefError('$', 'too-large', `brief is ${size} bytes, limit ${LIMITS.bytes}`, 'drop blocks or shorten text'),
    );
  }
  if (doc.v !== BRIEF_VERSION) {
    errors.push(briefError('$.v', 'version', `v must be ${BRIEF_VERSION}`, 'set v: 0'));
  }
  if (!isBriefString(doc.itemRef, 3, 200)) {
    errors.push(briefError('$.itemRef', 'item-ref', 'itemRef is required', 'copy it from the job input'));
  }
  if (!isBriefString(doc.headline, 1, LIMITS.headline)) {
    errors.push(
      briefError(
        '$.headline',
        'headline',
        `headline must be 1–${LIMITS.headline} chars`,
        'say in one line what is being asked',
      ),
    );
  }

  const options = asArray(doc.options).map(asRecord);
  if (options.length < 2 || options.length > LIMITS.options) {
    errors.push(
      briefError(
        '$.options',
        'option-count',
        `need 2–${LIMITS.options} options, got ${options.length}`,
        'list the real alternatives',
      ),
    );
  }
  const optionIds = options.map((option) => asString(option.id));
  if (new Set(optionIds).size !== optionIds.length) {
    errors.push(briefError('$.options', 'option-unique', 'option ids must be unique', 'rename'));
  }

  const evidence = asArray(doc.evidence).map(asRecord);
  const evidenceIds = new Set(evidence.map((entry) => asString(entry.id)));
  const mechanicalEvidence = new Set(
    evidence.filter((entry) => entry.mechanical === true).map((entry) => asString(entry.id)),
  );
  if (evidenceIds.size !== evidence.length) {
    errors.push(briefError('$.evidence', 'evidence-unique', 'evidence ids must be unique', 'rename'));
  }
  evidence.forEach((entry, index) => {
    if (!isBriefString(entry.id, 1, 40) || !isBriefString(entry.label, 1, 120)) {
      errors.push(briefError(`$.evidence[${index}]`, 'evidence-shape', 'evidence needs id and label', 'fix'));
    }
    if (
      entry.mechanical === true &&
      (!isBriefString(entry.ref, 1, 200) || !Number.isFinite(Date.parse(asString(entry.observedAt))))
    ) {
      errors.push(
        briefError(
          `$.evidence[${index}]`,
          'evidence-mechanical-needs-ref',
          'mechanical evidence needs a ref (command, file:line, sha) and an observedAt date',
          'record how it was observed or mark it mechanical:false',
        ),
      );
    }
  });

  options.forEach((option, index) => {
    if (
      !isBriefString(option.id, 1, 30) ||
      !isBriefString(option.label, 1, 60) ||
      !isBriefString(option.does, 1, 200)
    ) {
      errors.push(
        briefError(
          `$.options[${index}]`,
          'option-shape',
          'option needs id, label (<=60) and does (<=200: what happens if chosen)',
          'fix',
        ),
      );
    }
    const consequences = asArray(option.consequence).map(asRecord);
    const validConsequences =
      consequences.length >= 1 &&
      consequences.every(
        (consequence) =>
          ['reversible', 'irreversible', 'costs', 'blocks', 'no-effect'].includes(asString(consequence.kind)) &&
          isBriefString(consequence.text, 1, 80),
      );
    if (!validConsequences) {
      errors.push(
        briefError(
          `$.options[${index}].consequence`,
          'option-consequence',
          'each option needs 1+ consequence tags {kind: reversible|irreversible|costs|blocks|no-effect, text<=80}',
          'add the tags the developer decides on',
        ),
      );
    }
    for (const ref of asStringArray(option.evidenceRefs)) {
      if (!evidenceIds.has(ref)) {
        errors.push(
          briefError(
            `$.options[${index}].evidenceRefs`,
            'unknown-evidence',
            `evidence "${ref}" does not exist`,
            'fix id',
          ),
        );
      }
    }
  });

  const recommendation = asRecord(doc.recommendation);
  const recommendedId = asString(recommendation.optionId);
  if (!optionIds.includes(recommendedId)) {
    errors.push(
      briefError(
        '$.recommendation.optionId',
        'recommendation',
        'recommendation.optionId must be one of the options',
        'pick the option you suggest',
      ),
    );
  } else {
    const why = asArray(recommendation.why);
    if (why.length < 1 || why.length > 3 || !why.every((reason) => isBriefString(reason, 1, LIMITS.why))) {
      errors.push(
        briefError(
          '$.recommendation.why',
          'recommendation-why',
          `why must be 1–3 reasons of <=${LIMITS.why} chars`,
          'give the reasons',
        ),
      );
    }
  }

  const blocks = asArray(doc.blocks).map(asRecord);
  if (blocks.length > LIMITS.blocks) {
    errors.push(
      briefError(
        '$.blocks',
        'block-count',
        `at most ${LIMITS.blocks} blocks, got ${blocks.length}`,
        'keep the ones that change the decision',
      ),
    );
  }
  const context: BriefCheckContext = { optionIds, evidenceIds, mechanicalEvidence };
  const blockIds = new Set<string>();
  blocks.forEach((block, index) => {
    const path = `$.blocks[${index}]`;
    const id = asString(block.id);
    if (blockIds.has(id)) {
      errors.push(briefError(`${path}.id`, 'block-unique', `block id "${id}" repeats`, 'rename'));
    }
    blockIds.add(id);
    const type = asString(block.type);
    const preset = PRESETS[type as BriefPresetName];
    if (preset === undefined) {
      errors.push(
        briefError(
          `${path}.type`,
          'block-type',
          `unknown block type "${type}"`,
          `use one of: ${Object.keys(PRESETS).join(', ')}`,
        ),
      );
      return;
    }
    errors.push(...preset.check(block, context, path));
  });

  return { ok: errors.length === 0, errors, iterationsAllowed: MAX_ITERATIONS };
}

/**
 * The deterministic default card: what the cockpit shows when there is no brief or it never
 * passed the check. It is a valid BriefSpec shape with no options and no blocks, marked
 * `fallback: true` so the renderer and the reading can say why it is empty.
 *
 * Consumers: `cockpit-brief.service.ts` (every fallback path) and `tests/cockpit-brief.test.ts`.
 */
export function defaultBrief(input: { itemRef: string; headline?: string; question?: string }): BriefDocument {
  const headline = (input.headline ?? input.question ?? '').slice(0, LIMITS.headline);
  return {
    v: BRIEF_VERSION,
    itemRef: input.itemRef,
    headline,
    fallback: true,
    options: [],
    blocks: [],
    evidence: [],
  };
}

/**
 * The radar preset: the one brief block whose semantic shorthand (axes + scores + notes) the host
 * expands itself, because it is the block that carries the comparison every decision needs.
 *
 * WHY RADAR IS ALONE. It is the only preset with a meaningful `radarSemantic` shorthand — the
 * prompt lets a model write axes/scores as data and the host builds the block, so the mandatory
 * universal axes (`rev`, `evid`) are enforced in one place. Keeping the preset in its own file
 * keeps the registry file under the module's line ratchet without splitting any single concern.
 *
 * Consumers: `cockpit-brief-presets.ts` (registry entry) and `cockpit-brief-spec.ts` (the
 * `radarSemantic` expansion builds through `build`, so the CLI and the server cannot drift).
 */

import {
  UNIVERSAL_AXES,
  asArray,
  asRecord,
  asString,
  asStringArray,
  briefError,
  isBriefString,
  isInteger0to100,
  type BriefCheckContext,
  type BriefError,
  type BriefPreset,
} from './cockpit-brief-core.js';

export const radarPreset: BriefPreset = {
  describe:
    'Compare options on 3–8 axes. Axes are yours per item, but `rev` (reversibility) and `evid` (evidence strength) are mandatory so items stay comparable. Scores are 0–100, higher is better for the developer.',
  example: {
    title: 'Consequences',
    axes: [
      {
        id: 'rev',
        label: 'Reversible',
        definition: 'How cheaply the change can be undone',
        basis: 'mechanical',
        evidenceRefs: ['e1'],
      },
      {
        id: 'evid',
        label: 'Evidence',
        definition: 'How well tests and a repro back the option',
        basis: 'mechanical',
        evidenceRefs: ['e2'],
      },
      {
        id: 'scope',
        label: 'Scope covered',
        definition: 'Share of the known defects the option fixes',
        basis: 'llm',
      },
    ],
    scores: {
      a: { rev: 95, evid: 62, scope: 92 },
      b: { rev: 95, evid: 62, scope: 45 },
    },
  },
  build(semantic, doc) {
    const title = asString(semantic.title) || 'Consequences';
    const axes = asArray(semantic.axes).map(asRecord);
    const scores = asRecord(semantic.scores);
    const notes = asRecord(semantic.notes);
    const optionIds = asArray(doc?.options)
      .map(asRecord)
      .map((option) => asString(option.id));
    const seriesIds = optionIds.length > 0 ? optionIds : Object.keys(scores);
    return {
      id: `radar-${axes
        .map((axis) => asString(axis.id))
        .join('-')
        .slice(0, 24)}`,
      type: 'radar',
      title,
      axes: axes.map((axis) => ({
        id: asString(axis.id),
        label: asString(axis.label),
        definition: asString(axis.definition),
        basis: asString(axis.basis),
        ...(Array.isArray(axis.evidenceRefs) ? { evidenceRefs: asStringArray(axis.evidenceRefs) } : {}),
      })),
      series: seriesIds.map((optionId) => ({
        optionId,
        values: Object.fromEntries(
          axes.map((axis) => [asString(axis.id), asRecord(scores[optionId])[asString(axis.id)]]),
        ),
        ...(notes[optionId] !== undefined && notes[optionId] !== null ? { notes: notes[optionId] } : {}),
      })),
    };
  },
  check(block, context: BriefCheckContext, path): BriefError[] {
    const errors: BriefError[] = [];
    const axes = asArray(block.axes);
    if (axes.length < 3 || axes.length > 8) {
      return [
        briefError(
          `${path}.axes`,
          'radar-axis-count',
          `radar needs 3–8 axes, got ${Array.isArray(block.axes) ? axes.length : 'none'}`,
          'add or remove axes',
        ),
      ];
    }
    const axisRecords = axes.map(asRecord);
    const ids = axisRecords.map((axis) => asString(axis.id));
    if (new Set(ids).size !== ids.length) {
      errors.push(briefError(`${path}.axes`, 'radar-axis-unique', 'axis ids must be unique', 'rename duplicates'));
    }
    for (const universal of UNIVERSAL_AXES) {
      if (!ids.includes(universal)) {
        errors.push(
          briefError(
            `${path}.axes`,
            'radar-universal-axes',
            `missing universal axis "${universal}"`,
            `add axis {id:"${universal}", …} so this item stays comparable with the others`,
          ),
        );
      }
    }
    axisRecords.forEach((axis, index) => {
      if (!isBriefString(axis.label, 1, 24)) {
        errors.push(
          briefError(
            `${path}.axes[${index}].label`,
            'radar-axis-label',
            'label must be 1–24 chars',
            'shorten the label',
          ),
        );
      }
      if (!isBriefString(axis.definition, 12, 160)) {
        errors.push(
          briefError(
            `${path}.axes[${index}].definition`,
            'radar-axis-definition',
            'definition must be 12–160 chars: say what high and low mean',
            'write what a high score means',
          ),
        );
      }
      if (axis.basis !== 'mechanical' && axis.basis !== 'llm') {
        errors.push(
          briefError(
            `${path}.axes[${index}].basis`,
            'radar-axis-basis',
            'basis must be "mechanical" or "llm"',
            'mechanical = backed by an evidence item, llm = your judgement',
          ),
        );
      }
      if (axis.basis === 'mechanical') {
        const refs = asStringArray(axis.evidenceRefs);
        if (refs.length === 0) {
          errors.push(
            briefError(
              `${path}.axes[${index}].evidenceRefs`,
              'radar-mechanical-needs-evidence',
              `mechanical axis "${asString(axis.id)}" cites no evidence`,
              'cite an evidence id or set basis to "llm"',
            ),
          );
        }
        for (const ref of refs) {
          if (!context.evidenceIds.has(ref)) {
            errors.push(
              briefError(
                `${path}.axes[${index}].evidenceRefs`,
                'unknown-evidence',
                `evidence "${ref}" does not exist`,
                'add it to doc.evidence or fix the id',
              ),
            );
          }
        }
        for (const ref of refs) {
          if (context.evidenceIds.has(ref) && !context.mechanicalEvidence.has(ref)) {
            errors.push(
              briefError(
                `${path}.axes[${index}].evidenceRefs`,
                'radar-mechanical-uses-llm-evidence',
                `axis "${asString(axis.id)}" is mechanical but "${ref}" is not mechanical evidence`,
                'use probe-backed evidence or switch the axis to "llm"',
              ),
            );
          }
        }
      }
    });
    const series = asArray(block.series).map(asRecord);
    const have = series.map((entry) => asString(entry.optionId));
    for (const optionId of context.optionIds) {
      if (!have.includes(optionId)) {
        errors.push(
          briefError(
            `${path}.series`,
            'radar-series-missing-option',
            `no series for option "${optionId}"`,
            'every option needs a score on every axis',
          ),
        );
      }
    }
    series.forEach((entry, index) => {
      const optionId = asString(entry.optionId);
      if (!context.optionIds.includes(optionId)) {
        errors.push(
          briefError(
            `${path}.series[${index}].optionId`,
            'unknown-option',
            `option "${optionId}" does not exist`,
            'use an id from doc.options',
          ),
        );
      }
      const values = asRecord(entry.values);
      for (const id of ids) {
        if (!isInteger0to100(values[id])) {
          errors.push(
            briefError(
              `${path}.series[${index}].values.${id}`,
              'radar-value-range',
              `score for axis "${id}" must be an integer 0–100, got ${JSON.stringify(values[id])}`,
              'give every option an integer score on every axis',
            ),
          );
        }
      }
    });
    return errors;
  },
};

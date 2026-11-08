/**
 * The BriefSpec preset registry: the seven block types v0 can render (radar comes from its own
 * sibling file) with their prompt descriptions, semantic-input examples, builders and checkers.
 *
 * WHY THIS SHAPE. A model writes SEMANTICS, never layout: it names an option id and a score, and
 * `build` turns that into the block the renderer draws. `check` then judges the built block, which
 * is why the host must run the same `build` the renderer does (see the `radarSemantic` note in
 * `cockpit-brief-spec.ts`). `canvas` is deliberately not a preset in v0 — neither E2 arm produced
 * one, so there is no measured use for it yet.
 *
 * Consumers: `cockpit-brief-spec.ts` (document check walks every block through this registry) and
 * `tests/cockpit-brief-spec.test.ts`.
 */

import {
  asArray,
  asRecord,
  asString,
  asStringArray,
  briefError,
  isBriefString,
  type BriefCheckContext,
  type BriefError,
  type BriefPreset,
  type BriefPresetName,
} from './cockpit-brief-core.js';
import { radarPreset } from './cockpit-brief-radar-preset.js';

/** compare-table: rows of facts per option, for facts that do not fit a 0–100 axis. */
const compareTablePreset: BriefPreset = {
  describe: 'Rows of facts per option. Use for facts that do not fit a 0–100 axis.',
  example: {
    title: 'Compared',
    rows: [{ label: 'Files touched', cells: { a: '2 + test', b: '1' }, basis: 'mechanical' }],
  },
  build(semantic, doc) {
    return {
      id: 'table',
      type: 'compare-table',
      title: asString(semantic.title) || 'Compared',
      columns: asArray(doc?.options)
        .map(asRecord)
        .map((option) => asString(option.id)),
      rows: asArray(semantic.rows),
    };
  },
  check(block, context, path) {
    const errors: BriefError[] = [];
    const rows = asArray(block.rows);
    if (rows.length < 1 || rows.length > 8) {
      return [briefError(`${path}.rows`, 'table-row-count', 'table needs 1–8 rows', 'trim or add rows')];
    }
    const columns = asStringArray(block.columns);
    rows.map(asRecord).forEach((row, index) => {
      if (!isBriefString(row.label, 1, 40)) {
        errors.push(
          briefError(`${path}.rows[${index}].label`, 'table-row-label', 'row label must be 1–40 chars', 'shorten'),
        );
      }
      const cells = asRecord(row.cells);
      for (const optionId of columns) {
        if (!isBriefString(String(cells[optionId] ?? ''), 1, 80)) {
          errors.push(
            briefError(
              `${path}.rows[${index}].cells.${optionId}`,
              'table-cell',
              `row "${asString(row.label)}" has no value for option "${optionId}"`,
              'fill every column (use "—" when not applicable)',
            ),
          );
        }
      }
    });
    for (const optionId of columns) {
      if (!context.optionIds.includes(optionId)) {
        errors.push(
          briefError(
            `${path}.columns`,
            'unknown-option',
            `column "${optionId}" is not an option`,
            'use ids from doc.options',
          ),
        );
      }
    }
    return errors;
  },
};

/** diffstat: the files a change touches and how much of each. */
const diffstatPreset: BriefPreset = {
  describe: 'Files changed with additions/deletions.',
  example: { title: 'Change size', files: [{ path: 'src/a.ts', add: 34, del: 6 }] },
  build(semantic) {
    return {
      id: 'diffstat',
      type: 'diffstat',
      title: asString(semantic.title) || 'Change size',
      files: asArray(semantic.files),
    };
  },
  check(block, _context, path) {
    const files = asArray(block.files);
    const valid =
      files.length >= 1 &&
      files.length <= 30 &&
      files.map(asRecord).every(
        (file) =>
          isBriefString(file.path, 1, 200) &&
          Number.isInteger(file.add) &&
          Number.isInteger(file.del) &&
          (file.add as number) >= 0 &&
          (file.del as number) >= 0,
      );
    return valid
      ? []
      : [
          briefError(
            `${path}.files`,
            'diffstat-files',
            'files must be 1–30 items {path, add>=0, del>=0 (integers)}',
            'fix the item shapes',
          ),
        ];
  },
};

/**
 * checklist: open questions or steps. `done` is OPTIONAL and defaults to false — E2's four
 * first-round reds were all a mandatory `done` on a list of things not yet ticked.
 */
const checklistPreset: BriefPreset = {
  describe: 'Open questions or steps the developer should tick through. `done` is optional.',
  example: { title: 'Open questions', items: [{ text: 'Who owns the draft on conflict?' }] },
  build(semantic) {
    return {
      id: 'checklist',
      type: 'checklist',
      title: asString(semantic.title) || 'Open questions',
      items: asArray(semantic.items).map((item) => {
        const record = asRecord(item);
        return { ...record, done: typeof record.done === 'boolean' ? record.done : false };
      }),
    };
  },
  check(block, _context, path) {
    const items = asArray(block.items);
    const valid =
      items.length >= 1 &&
      items.length <= 10 &&
      items.map(asRecord).every(
        (item) => isBriefString(item.text, 1, 160) && (item.done === undefined || typeof item.done === 'boolean'),
      );
    return valid
      ? []
      : [
          briefError(
            `${path}.items`,
            'checklist-items',
            'items must be 1–10 {text<=160, done?:boolean}',
            'fix the item shapes',
          ),
        ];
  },
};

/** timeline: ordered events, e.g. the failed attempts of a worker. */
const timelinePreset: BriefPreset = {
  describe: 'Ordered events, e.g. failed attempts of a worker.',
  example: {
    title: 'Attempts',
    events: [{ at: '2026-10-26T01:00:00Z', label: 'attempt 1 · suite red', state: 'bad' }],
  },
  build(semantic) {
    return {
      id: 'timeline',
      type: 'timeline',
      title: asString(semantic.title) || 'Timeline',
      events: asArray(semantic.events),
    };
  },
  check(block, _context, path) {
    const events = asArray(block.events);
    const valid =
      events.length >= 1 &&
      events.length <= 12 &&
      events.map(asRecord).every(
        (event) =>
          Number.isFinite(Date.parse(asString(event.at))) &&
          isBriefString(event.label, 1, 100) &&
          ['ok', 'bad', 'neutral'].includes(asString(event.state)),
      );
    return valid
      ? []
      : [
          briefError(
            `${path}.events`,
            'timeline-events',
            'events must be 1–12 {at: ISO date, label<=100, state: ok|bad|neutral}',
            'fix the event shapes',
          ),
        ];
  },
};

/** graph: a small dependency/impact graph. */
const graphPreset: BriefPreset = {
  describe: 'A small dependency/impact graph (≤12 nodes).',
  example: {
    title: 'Where it lands',
    nodes: [
      { id: 'cockpit', label: 'cockpit', state: 'changed' },
      { id: 'hub', label: 'hub', state: 'same' },
    ],
    edges: [{ from: 'cockpit', to: 'hub', kind: 'new' }],
  },
  build(semantic) {
    return {
      id: 'graph',
      type: 'graph',
      title: asString(semantic.title) || 'Impact',
      nodes: asArray(semantic.nodes),
      edges: asArray(semantic.edges),
    };
  },
  check(block, _context, path) {
    const errors: BriefError[] = [];
    const nodes = asArray(block.nodes);
    if (nodes.length < 2 || nodes.length > 12) {
      return [briefError(`${path}.nodes`, 'graph-node-count', 'graph needs 2–12 nodes', 'trim or add nodes')];
    }
    const nodeRecords = nodes.map(asRecord);
    const ids = new Set(nodeRecords.map((node) => asString(node.id)));
    nodeRecords.forEach((node, index) => {
      const validNode =
        isBriefString(node.id, 1, 40) &&
        isBriefString(node.label, 1, 40) &&
        ['changed', 'same', 'new', 'bad'].includes(asString(node.state));
      if (!validNode) {
        errors.push(
          briefError(
            `${path}.nodes[${index}]`,
            'graph-node',
            'node needs {id, label, state: changed|same|new|bad}',
            'fix the node',
          ),
        );
      }
    });
    asArray(block.edges)
      .map(asRecord)
      .forEach((edge, index) => {
        if (!ids.has(asString(edge.from)) || !ids.has(asString(edge.to))) {
          errors.push(
            briefError(`${path}.edges[${index}]`, 'graph-edge-ref', 'edge endpoints must be node ids', 'fix the edge'),
          );
        }
      });
    return errors;
  },
};

/** callout: one short note. */
const calloutPreset: BriefPreset = {
  describe: 'One short note, tone info|warn.',
  example: { text: 'The repro only fails on the live build.', tone: 'warn' },
  build(semantic) {
    return {
      id: 'callout',
      type: 'callout',
      text: asString(semantic.text),
      tone: asString(semantic.tone) || 'info',
    };
  },
  check(block, _context, path) {
    return isBriefString(block.text, 1, 200) && ['info', 'warn'].includes(asString(block.tone))
      ? []
      : [briefError(path, 'callout', 'callout needs text<=200 and tone info|warn', 'shorten or fix tone')];
  },
};

/** Every block type v0 accepts, keyed by the `type` a document names. */
export const PRESETS: Record<BriefPresetName, BriefPreset> = {
  radar: radarPreset,
  'compare-table': compareTablePreset,
  diffstat: diffstatPreset,
  checklist: checklistPreset,
  timeline: timelinePreset,
  graph: graphPreset,
  callout: calloutPreset,
};

/** `radarSemantic` is expanded through the same builder the renderer uses. */
export { radarPreset };

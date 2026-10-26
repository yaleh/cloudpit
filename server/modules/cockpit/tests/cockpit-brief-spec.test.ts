/**
 * BriefSpec v0's criterion: the port of the E2 experiment's `brief-check.test.mjs`.
 *
 * WHAT IS PORTED. Fifteen of the experiment's eighteen cases, one-to-one, with the same
 * fixtures and the same rule names. The three canvas cases are DELIBERATELY EXCLUDED because v0
 * does not ship canvas at all (neither E2 arm ever produced one):
 *
 *   · "canvas: a clean temporary form passes"
 *   · "canvas: script, handler, external url and bad elements are rejected"
 *   · "canvas without alt/rationale is rejected"
 *
 * ONE CASE IS ADDED, from the experiment's own recommendation: a checklist item without `done`
 * passes and is defaulted to false by the builder. E2's only four first-round failures were this
 * mandatory flag.
 *
 * The one non-mechanical-sounding case ("the cli expands the radarSemantic shorthand") drives
 * `expandBrief` directly instead of spawning the experiment's CLI: the server has no CLI, and
 * `expandBrief` IS the host step the CLI used to duplicate.
 *
 * Run directly:
 *   npx tsx --tsconfig server/tsconfig.json --test \
 *     server/modules/cockpit/tests/cockpit-brief-spec.test.ts
 */
import assert from 'node:assert/strict';
import test from 'node:test';

import { PRESETS } from '@/modules/cockpit/cockpit-brief-presets.js';
import { checkBrief, expandBrief } from '@/modules/cockpit/cockpit-brief-spec.js';

/* The experiment's fixtures are mutated in place (a field is deleted or a value changed), so the
 * document is deliberately loose. The checker under test is the thing being typed. */
type Loose = any;

const base = (): Loose => {
  const doc: Loose = {
    v: 0,
    itemRef: 'cloudcli://session/e7aa#3',
    headline: '要我按 A + C 实现吗？',
    recommendation: { optionId: 'ac', why: ['两个缺陷同根'] },
    options: [
      {
        id: 'ac',
        label: 'A + C',
        does: '同时修复清空与跳动',
        consequence: [{ kind: 'reversible', text: 'branch only' }],
        evidenceRefs: ['e1'],
      },
      {
        id: 'c',
        label: 'Only C',
        does: '只修跳动',
        consequence: [{ kind: 'reversible', text: 'branch only' }],
      },
    ],
    evidence: [
      {
        id: 'e1',
        kind: 'test',
        label: 'tests green',
        ref: 'npm test -- transcript',
        observedAt: '2026-10-26T05:00:00Z',
        mechanical: true,
      },
      { id: 'e2', kind: 'transcript', label: 'session says repro on live', mechanical: false },
    ],
    blocks: [],
  };
  doc.blocks.push(
    PRESETS.radar.build(
      {
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
            definition: 'How well tests back the option',
            basis: 'mechanical',
            evidenceRefs: ['e1'],
          },
          { id: 'scope', label: 'Scope', definition: 'Share of known defects fixed', basis: 'llm' },
        ],
        scores: { ac: { rev: 95, evid: 62, scope: 92 }, c: { rev: 95, evid: 62, scope: 45 } },
      },
      doc,
    ),
  );
  return doc;
};

const rules = (result: ReturnType<typeof checkBrief>): string[] => result.errors.map((entry) => entry.rule);

test('a well-formed brief passes', () => {
  assert.deepEqual(checkBrief(base()), { ok: true, errors: [], iterationsAllowed: 3 });
});

test('the builder fills a series for every option', () => {
  assert.equal(base().blocks[0].series.length, 2);
});

test('missing universal axis is named', () => {
  const doc = base();
  doc.blocks[0].axes[0].id = 'spd';
  assert.ok(rules(checkBrief(doc)).includes('radar-universal-axes'));
});

test('radar score out of range', () => {
  const doc = base();
  doc.blocks[0].series[0].values.scope = 140;
  const result = checkBrief(doc);
  assert.ok(rules(result).includes('radar-value-range'));
  assert.match(
    result.errors.find((entry) => entry.rule === 'radar-value-range')?.path ?? '',
    /series\[0\]\.values\.scope/,
  );
});

test('radar series missing an option', () => {
  const doc = base();
  doc.blocks[0].series.pop();
  assert.ok(rules(checkBrief(doc)).includes('radar-series-missing-option'));
});

test('mechanical axis must cite mechanical evidence', () => {
  const doc = base();
  doc.blocks[0].axes[0].evidenceRefs = ['e2'];
  assert.ok(rules(checkBrief(doc)).includes('radar-mechanical-uses-llm-evidence'));
});

test('mechanical axis without evidence', () => {
  const doc = base();
  delete doc.blocks[0].axes[1].evidenceRefs;
  assert.ok(rules(checkBrief(doc)).includes('radar-mechanical-needs-evidence'));
});

test('mechanical evidence needs ref and date', () => {
  const doc = base();
  delete doc.evidence[0].observedAt;
  assert.ok(rules(checkBrief(doc)).includes('evidence-mechanical-needs-ref'));
});

test('recommendation must name an option', () => {
  const doc = base();
  doc.recommendation.optionId = 'zzz';
  assert.ok(rules(checkBrief(doc)).includes('recommendation'));
});

test('every option needs consequence tags', () => {
  const doc = base();
  doc.options[1].consequence = [];
  assert.ok(rules(checkBrief(doc)).includes('option-consequence'));
});

test('unknown block type lists the allowed ones', () => {
  const doc = base();
  doc.blocks.push({ id: 'x', type: 'pie' });
  const failure = checkBrief(doc).errors.find((entry) => entry.rule === 'block-type');
  assert.match(failure?.fix ?? '', /radar/);
});

test('too many blocks', () => {
  const doc = base();
  for (let index = 0; index < 6; index += 1) {
    doc.blocks.push({ id: `c${index}`, type: 'callout', text: 'n', tone: 'info' });
  }
  assert.ok(rules(checkBrief(doc)).includes('block-count'));
});

test('errors always carry a path and a fix', () => {
  const doc = base();
  doc.headline = '';
  doc.options = [];
  for (const failure of checkBrief(doc).errors) {
    assert.ok(failure.path && failure.rule && failure.message && failure.fix, JSON.stringify(failure));
  }
});

test('minimum lengths use display width: a short Chinese definition is accepted', () => {
  const doc = base();
  doc.blocks[0].axes[2].definition = '改动文件越少越高';
  assert.equal(checkBrief(doc).ok, true);
  doc.blocks[0].axes[2].definition = '太短';
  assert.ok(rules(checkBrief(doc)).includes('radar-axis-definition'));
});

test('the host expands the radarSemantic shorthand the way the CLI did', () => {
  const doc = base();
  const radar = doc.blocks.pop();
  doc.radarSemantic = {
    axes: radar.axes,
    scores: { ac: { rev: 95, evid: 62, scope: 92 }, c: { rev: 95, evid: 62, scope: 45 } },
  };
  // Without expansion the shorthand was silently ignored, so a radar missing the mandatory
  // `evid` axis passed. The host step is what closes that hole.
  assert.equal(checkBrief(expandBrief(doc)).ok, true, JSON.stringify(checkBrief(expandBrief(doc)).errors));
  doc.radarSemantic.axes = doc.radarSemantic.axes.filter((axis: Loose) => axis.id !== 'evid');
  assert.equal(checkBrief(expandBrief(doc)).ok, false);
});

test('a checklist item without `done` passes and defaults to false', () => {
  const doc = base();
  doc.blocks.push({ id: 'todo', type: 'checklist', title: 'Before confirming', items: [{ text: '另有备份' }] });
  const result = checkBrief(doc);
  assert.equal(result.ok, true, JSON.stringify(result.errors));
  const built = PRESETS.checklist.build({ title: 'Before confirming', items: [{ text: '另有备份' }] });
  assert.equal((built.items as Loose)[0].done, false);
});

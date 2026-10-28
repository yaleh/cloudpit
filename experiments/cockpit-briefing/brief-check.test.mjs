import test from 'node:test';
import assert from 'node:assert/strict';
import { checkBrief, PRESETS } from './brief-check.mjs';

const base = () => {
  const doc = {
    v: 0, itemRef: 'cloudcli://session/e7aa#3', headline: '要我按 A + C 实现吗？', recommendation: { optionId: 'ac', why: ['两个缺陷同根'] },
    options: [
      { id: 'ac', label: 'A + C', does: '同时修复清空与跳动', consequence: [{ kind: 'reversible', text: 'branch only' }], evidenceRefs: ['e1'] },
      { id: 'c', label: 'Only C', does: '只修跳动', consequence: [{ kind: 'reversible', text: 'branch only' }] },
    ],
    evidence: [{ id: 'e1', kind: 'test', label: 'tests green', ref: 'npm test -- transcript', observedAt: '2026-10-26T05:00:00Z', mechanical: true }, { id: 'e2', kind: 'transcript', label: 'session says repro on live', mechanical: false }],
    blocks: [],
  };
  doc.blocks.push(PRESETS.radar.build({ axes: [
    { id: 'rev', label: 'Reversible', definition: 'How cheaply the change can be undone', basis: 'mechanical', evidenceRefs: ['e1'] },
    { id: 'evid', label: 'Evidence', definition: 'How well tests back the option', basis: 'mechanical', evidenceRefs: ['e1'] },
    { id: 'scope', label: 'Scope', definition: 'Share of known defects fixed', basis: 'llm' }],
    scores: { ac: { rev: 95, evid: 62, scope: 92 }, c: { rev: 95, evid: 62, scope: 45 } } }, doc));
  return doc;
};
const rules = (r) => r.errors.map((e) => e.rule);

test('a well-formed brief passes', () => assert.deepEqual(checkBrief(base()), { ok: true, errors: [], iterationsAllowed: 3 }));
test('the builder fills a series for every option', () => assert.equal(base().blocks[0].series.length, 2));
test('missing universal axis is named', () => { const d = base(); d.blocks[0].axes[0].id = 'spd'; assert.ok(rules(checkBrief(d)).includes('radar-universal-axes')); });
test('radar score out of range', () => { const d = base(); d.blocks[0].series[0].values.scope = 140; const r = checkBrief(d); assert.ok(rules(r).includes('radar-value-range')); assert.match(r.errors.find((e) => e.rule === 'radar-value-range').path, /series\[0\]\.values\.scope/); });
test('radar series missing an option', () => { const d = base(); d.blocks[0].series.pop(); assert.ok(rules(checkBrief(d)).includes('radar-series-missing-option')); });
test('mechanical axis must cite mechanical evidence', () => { const d = base(); d.blocks[0].axes[0].evidenceRefs = ['e2']; assert.ok(rules(checkBrief(d)).includes('radar-mechanical-uses-llm-evidence')); });
test('mechanical axis without evidence', () => { const d = base(); delete d.blocks[0].axes[1].evidenceRefs; assert.ok(rules(checkBrief(d)).includes('radar-mechanical-needs-evidence')); });
test('mechanical evidence needs ref and date', () => { const d = base(); delete d.evidence[0].observedAt; assert.ok(rules(checkBrief(d)).includes('evidence-mechanical-needs-ref')); });
test('recommendation must name an option', () => { const d = base(); d.recommendation.optionId = 'zzz'; assert.ok(rules(checkBrief(d)).includes('recommendation')); });
test('every option needs consequence tags', () => { const d = base(); d.options[1].consequence = []; assert.ok(rules(checkBrief(d)).includes('option-consequence')); });
test('unknown block type lists the allowed ones', () => { const d = base(); d.blocks.push({ id: 'x', type: 'pie' }); const e = checkBrief(d).errors.find((x) => x.rule === 'block-type'); assert.match(e.fix, /radar/); });
test('too many blocks', () => { const d = base(); for (let i = 0; i < 6; i++) d.blocks.push({ id: `c${i}`, type: 'callout', text: 'n', tone: 'info' }); assert.ok(rules(checkBrief(d)).includes('block-count')); });
test('canvas: a clean temporary form passes', () => { const d = base(); d.blocks.push({ id: 'cv', type: 'canvas', viewBox: [200, 80], svg: '<g><rect x="4" y="4" width="60" height="20" fill="none" stroke="#999"/><text x="10" y="18">A</text></g>', alt: 'Two boxes joined by an arrow', rationale: 'dependency shape is not a preset graph' }); assert.equal(checkBrief(d).ok, true); });
test('canvas: script, handler, external url and bad elements are rejected', () => {
  for (const svg of ['<script>1</script>', '<rect onclick="x()"/>', '<rect fill="url(http://evil/x)"/>', '<image href="x"/>', '<div>hi</div>', '<a href="x"><text>t</text></a>']) {
    const d = base(); d.blocks.push({ id: 'cv', type: 'canvas', viewBox: [200, 80], svg, alt: 'something drawn here', rationale: 'no preset fits this shape' });
    assert.equal(checkBrief(d).ok, false, svg);
  }
});
test('canvas without alt/rationale is rejected', () => { const d = base(); d.blocks.push({ id: 'cv', type: 'canvas', viewBox: [200, 80], svg: '<g/>' }); const r = rules(checkBrief(d)); assert.ok(r.includes('canvas-alt') && r.includes('canvas-rationale')); });
test('errors always carry a path and a fix', () => { const d = base(); d.headline = ''; d.options = []; for (const e of checkBrief(d).errors) { assert.ok(e.path && e.rule && e.message && e.fix, JSON.stringify(e)); } });
test('minimum lengths use display width: a short Chinese definition is accepted', () => { const d = base(); d.blocks[0].axes[2].definition = '改动文件越少越高'; assert.equal(checkBrief(d).ok, true); d.blocks[0].axes[2].definition = '太短'; assert.ok(rules(checkBrief(d)).includes('radar-axis-definition')); });
test('cli check expands the radarSemantic shorthand like the host does', async () => {
  const { execFileSync } = await import('node:child_process');
  const d = base(); const r = d.blocks.pop();
  d.radarSemantic = { axes: r.axes, scores: { ac: { rev: 95, evid: 62, scope: 92 }, c: { rev: 95, evid: 62, scope: 45 } } };
  const cli = (doc) => { try { return JSON.parse(execFileSync('node', [new URL('./brief-cli.mjs', import.meta.url).pathname, 'check', '-'], { input: JSON.stringify(doc), stdio: ['pipe', 'pipe', 'ignore'] }).toString()); } catch (e) { return JSON.parse(e.stdout.toString()); } };
  assert.equal(cli(d).ok, true, JSON.stringify(cli(d).errors));
  // Without expansion the shorthand was silently ignored, so a radar missing the mandatory `evid` axis passed.
  d.radarSemantic.axes = d.radarSemantic.axes.filter((a) => a.id !== 'evid');
  assert.equal(cli(d).ok, false);
});

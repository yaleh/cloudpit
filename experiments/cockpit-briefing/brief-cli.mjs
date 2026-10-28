#!/usr/bin/env node
// CLI the briefing session calls from Bash. Semantics in, validated structure out.
//   brief-cli.mjs schema [type]                 list presets / print one preset with an example
//   brief-cli.mjs skeleton                      print an empty brief to fill in
//   brief-cli.mjs build <type> --doc <file>     read semantic JSON on stdin, print the block (needs doc.options for series)
//   brief-cli.mjs check <file|->                mechanical format check (- = stdin); exit 0 ok, 2 errors (JSON on stdout)
//   brief-cli.mjs submit <file> --out <dir>     check, then write <dir>/brief.json; refuses after MAX_ITERATIONS failed submits
import fs from 'node:fs';
import path from 'node:path';
import { PRESETS, LIMITS, MAX_ITERATIONS, UNIVERSAL_AXES, checkBrief } from './brief-check.mjs';

const [cmd, ...rest] = process.argv.slice(2);
const flag = (n) => { const i = rest.indexOf(n); return i >= 0 ? rest[i + 1] : undefined; };
const out = (v, code = 0) => { process.stdout.write(JSON.stringify(v, null, 2) + '\n'); process.exit(code); };
// Semantic shorthand: `radarSemantic` ({axes, scores}) is expanded by the radar builder, same as the E2 host does.
const expand = (doc) => { if (doc && doc.radarSemantic) { doc.blocks = [...(doc.blocks ?? []), PRESETS.radar.build(doc.radarSemantic, doc)]; delete doc.radarSemantic; } return doc; };
const readJson = (p) => expand(JSON.parse(fs.readFileSync(p === '-' ? 0 : p, 'utf8')));

if (cmd === 'schema') {
  const t = rest[0];
  if (t) { if (t === 'canvas') out({ type: 'canvas', describe: 'Temporary form: restricted SVG you design when no preset fits.', fields: { viewBox: '[w,h] 40..800', svg: 'inner markup, allowed elements only', alt: 'text alternative 12..300', rationale: 'why no preset fits 12..200' }, limits: { svgChars: LIMITS.canvasBytes } }); if (!PRESETS[t]) out({ error: `unknown type ${t}`, types: Object.keys(PRESETS) }, 1); out({ type: t, describe: PRESETS[t].describe, semanticInput: PRESETS[t].example }); }
  out({ limits: LIMITS, maxIterations: MAX_ITERATIONS, universalRadarAxes: UNIVERSAL_AXES, presets: Object.fromEntries(Object.entries(PRESETS).map(([k, v]) => [k, v.describe])), temporary: 'canvas (restricted SVG, needs alt + rationale)' });
}
if (cmd === 'skeleton') out({ v: 0, itemRef: '<copy from job>', headline: '<one line: what is asked>', recommendation: { optionId: '<id>', why: ['<reason>'] }, options: [{ id: 'a', label: '<label>', does: '<what happens if chosen>', consequence: [{ kind: 'reversible', text: '<tag>' }] }, { id: 'b', label: '<label>', does: '<…>', consequence: [{ kind: 'no-effect', text: '<tag>' }] }], blocks: [], evidence: [{ id: 'e1', kind: 'probe', label: '<what you observed>', ref: '<command | file:line | sha>', observedAt: '<ISO date>', mechanical: true }] });
if (cmd === 'build') {
  const type = rest[0]; const preset = PRESETS[type];
  if (!preset) out({ error: `unknown type ${type}`, types: Object.keys(PRESETS) }, 1);
  const doc = flag('--doc') ? readJson(flag('--doc')) : undefined;
  out(preset.build(JSON.parse(fs.readFileSync(0, 'utf8')), doc));
}
if (cmd === 'check') { const r = checkBrief(readJson(rest[0])); out(r, r.ok ? 0 : 2); }
if (cmd === 'submit') {
  const dir = flag('--out'); if (!dir) out({ error: '--out required' }, 1);
  fs.mkdirSync(dir, { recursive: true });
  const counter = path.join(dir, '.submits'); const n = (fs.existsSync(counter) ? Number(fs.readFileSync(counter, 'utf8')) : 0) + 1;
  fs.writeFileSync(counter, String(n));
  const r = checkBrief(readJson(rest[0]));
  if (r.ok) { fs.copyFileSync(rest[0], path.join(dir, 'brief.json')); out({ ok: true, submits: n }); }
  out({ ...r, submits: n, giveUp: n >= MAX_ITERATIONS }, 2);
}
out({ error: 'usage: schema|skeleton|build|check|submit', cmd }, 1);

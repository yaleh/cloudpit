// BriefSpec v0 — the declarative format a briefing session produces, the preset registry that lets the
// session write SEMANTICS only (axes, scores, notes), and the mechanical checker that decides whether a
// brief can be rendered. Pure ESM, no dependencies: the same module can later be lifted into
// server/modules/ and shared with the renderer.
//
// Contract with the session: build blocks with the builders, run `check`, fix what it names, repeat
// (the host allows MAX_ITERATIONS rounds), then submit. The host re-runs this checker on submit; a brief
// that still fails is replaced by the deterministic default card and the failure reasons are recorded.

export const BRIEF_VERSION = 0;
export const MAX_ITERATIONS = 3;
export const LIMITS = { headline: 80, why: 140, blocks: 6, options: 5, bytes: 24_000, canvasBytes: 6_000 };
export const UNIVERSAL_AXES = ['rev', 'evid']; // comparable across items; every radar must carry them

const err = (path, rule, message, fix) => ({ path, rule, message, fix });
// Minimum lengths are in display width (CJK counts 2) so "say what high means" is not harder to satisfy in Chinese
// than in English; maximum lengths stay raw character counts (they protect layout).
const width = (s) => [...s].reduce((n, ch) => n + (/[\u2E80-\u9FFF\uFF00-\uFFEF]/.test(ch) ? 2 : 1), 0);
const isStr = (v, min = 1, max = Infinity) => typeof v === 'string' && width(v.trim()) >= min && v.length <= max;
const isInt0to100 = (v) => Number.isInteger(v) && v >= 0 && v <= 100;

// ── presets: each owns its builder (semantic input → block) and its checker ───────────────────────
export const PRESETS = {
  radar: {
    describe: 'Compare options on 3–8 axes. Axes are yours per item, but `rev` (reversibility) and `evid` (evidence strength) are mandatory so items stay comparable. Scores are 0–100, higher is better for the developer.',
    example: {
      title: 'Consequences', axes: [
        { id: 'rev', label: 'Reversible', definition: 'How cheaply the change can be undone', basis: 'mechanical', evidenceRefs: ['e1'] },
        { id: 'evid', label: 'Evidence', definition: 'How well tests and a repro back the option', basis: 'mechanical', evidenceRefs: ['e2'] },
        { id: 'scope', label: 'Scope covered', definition: 'Share of the known defects the option fixes', basis: 'llm' }],
      scores: { a: { rev: 95, evid: 62, scope: 92 }, b: { rev: 95, evid: 62, scope: 45 } },
    },
    build({ title = 'Consequences', axes, scores, notes = {} }, doc) {
      const optionIds = (doc?.options ?? []).map((o) => o.id);
      return {
        id: `radar-${axes.map((a) => a.id).join('-').slice(0, 24)}`, type: 'radar', title,
        axes: axes.map((a) => ({ id: a.id, label: a.label, definition: a.definition, basis: a.basis, ...(a.evidenceRefs ? { evidenceRefs: a.evidenceRefs } : {}) })),
        series: (optionIds.length ? optionIds : Object.keys(scores)).map((optionId) => ({ optionId, values: Object.fromEntries(axes.map((a) => [a.id, scores[optionId]?.[a.id]])), ...(notes[optionId] ? { notes: notes[optionId] } : {}) })),
      };
    },
    check(b, ctx, p) {
      const out = [];
      if (!Array.isArray(b.axes) || b.axes.length < 3 || b.axes.length > 8) return [err(`${p}.axes`, 'radar-axis-count', `radar needs 3–8 axes, got ${Array.isArray(b.axes) ? b.axes.length : 'none'}`, 'add or remove axes')];
      const ids = b.axes.map((a) => a?.id);
      if (new Set(ids).size !== ids.length) out.push(err(`${p}.axes`, 'radar-axis-unique', 'axis ids must be unique', 'rename duplicates'));
      for (const u of UNIVERSAL_AXES) if (!ids.includes(u)) out.push(err(`${p}.axes`, 'radar-universal-axes', `missing universal axis "${u}"`, `add axis {id:"${u}", …} so this item stays comparable with the others`));
      b.axes.forEach((a, i) => {
        if (!isStr(a?.label, 1, 24)) out.push(err(`${p}.axes[${i}].label`, 'radar-axis-label', 'label must be 1–24 chars', 'shorten the label'));
        if (!isStr(a?.definition, 12, 160)) out.push(err(`${p}.axes[${i}].definition`, 'radar-axis-definition', 'definition must be 12–160 chars: say what high and low mean', 'write what a high score means'));
        if (a?.basis !== 'mechanical' && a?.basis !== 'llm') out.push(err(`${p}.axes[${i}].basis`, 'radar-axis-basis', 'basis must be "mechanical" or "llm"', 'mechanical = backed by an evidence item, llm = your judgement'));
        if (a?.basis === 'mechanical') {
          const refs = a.evidenceRefs ?? [];
          if (!refs.length) out.push(err(`${p}.axes[${i}].evidenceRefs`, 'radar-mechanical-needs-evidence', `mechanical axis "${a.id}" cites no evidence`, 'cite an evidence id or set basis to "llm"'));
          for (const r of refs) if (!ctx.evidenceIds.has(r)) out.push(err(`${p}.axes[${i}].evidenceRefs`, 'unknown-evidence', `evidence "${r}" does not exist`, 'add it to doc.evidence or fix the id'));
          for (const r of refs) if (ctx.evidenceIds.has(r) && !ctx.mechanicalEvidence.has(r)) out.push(err(`${p}.axes[${i}].evidenceRefs`, 'radar-mechanical-uses-llm-evidence', `axis "${a.id}" is mechanical but "${r}" is not mechanical evidence`, 'use probe-backed evidence or switch the axis to "llm"'));
        }
      });
      const need = ctx.optionIds;
      const have = (b.series ?? []).map((s) => s?.optionId);
      for (const o of need) if (!have.includes(o)) out.push(err(`${p}.series`, 'radar-series-missing-option', `no series for option "${o}"`, 'every option needs a score on every axis'));
      (b.series ?? []).forEach((s, i) => {
        if (!need.includes(s?.optionId)) out.push(err(`${p}.series[${i}].optionId`, 'unknown-option', `option "${s?.optionId}" does not exist`, 'use an id from doc.options'));
        for (const id of ids) if (!isInt0to100(s?.values?.[id])) out.push(err(`${p}.series[${i}].values.${id}`, 'radar-value-range', `score for axis "${id}" must be an integer 0–100, got ${JSON.stringify(s?.values?.[id])}`, 'give every option an integer score on every axis'));
      });
      return out;
    },
  },
  'compare-table': {
    describe: 'Rows of facts per option. Use for facts that do not fit a 0–100 axis.',
    example: { title: 'Compared', rows: [{ label: 'Files touched', cells: { a: '2 + test', b: '1' }, basis: 'mechanical' }] },
    build: ({ title = 'Compared', rows }, doc) => ({ id: 'table', type: 'compare-table', title, columns: (doc?.options ?? []).map((o) => o.id), rows }),
    check(b, ctx, p) {
      const out = [];
      if (!Array.isArray(b.rows) || b.rows.length < 1 || b.rows.length > 8) return [err(`${p}.rows`, 'table-row-count', 'table needs 1–8 rows', 'trim or add rows')];
      b.rows.forEach((r, i) => {
        if (!isStr(r?.label, 1, 40)) out.push(err(`${p}.rows[${i}].label`, 'table-row-label', 'row label must be 1–40 chars', 'shorten'));
        for (const o of b.columns ?? []) if (!isStr(String(r?.cells?.[o] ?? ''), 1, 80)) out.push(err(`${p}.rows[${i}].cells.${o}`, 'table-cell', `row "${r?.label}" has no value for option "${o}"`, 'fill every column (use "—" when not applicable)'));
      });
      for (const o of b.columns ?? []) if (!ctx.optionIds.includes(o)) out.push(err(`${p}.columns`, 'unknown-option', `column "${o}" is not an option`, 'use ids from doc.options'));
      return out;
    },
  },
  diffstat: {
    describe: 'Files changed with additions/deletions.',
    example: { title: 'Change size', files: [{ path: 'src/a.ts', add: 34, del: 6 }] },
    build: ({ title = 'Change size', files }) => ({ id: 'diffstat', type: 'diffstat', title, files }),
    check: (b, _c, p) => (Array.isArray(b.files) && b.files.length >= 1 && b.files.length <= 30 && b.files.every((f) => isStr(f?.path, 1, 200) && Number.isInteger(f?.add) && Number.isInteger(f?.del) && f.add >= 0 && f.del >= 0)) ? [] : [err(`${p}.files`, 'diffstat-files', 'files must be 1–30 items {path, add>=0, del>=0 (integers)}', 'fix the item shapes')],
  },
  checklist: {
    describe: 'Open questions or steps the developer should tick through.',
    example: { title: 'Open questions', items: [{ text: 'Who owns the draft on conflict?', done: false }] },
    build: ({ title = 'Open questions', items }) => ({ id: 'checklist', type: 'checklist', title, items }),
    check: (b, _c, p) => (Array.isArray(b.items) && b.items.length >= 1 && b.items.length <= 10 && b.items.every((i) => isStr(i?.text, 1, 160) && typeof i?.done === 'boolean')) ? [] : [err(`${p}.items`, 'checklist-items', 'items must be 1–10 {text<=160, done:boolean}', 'fix the item shapes')],
  },
  timeline: {
    describe: 'Ordered events, e.g. failed attempts of a worker.',
    example: { title: 'Attempts', events: [{ at: '2026-10-26T01:00:00Z', label: 'attempt 1 · suite red', state: 'bad' }] },
    build: ({ title = 'Timeline', events }) => ({ id: 'timeline', type: 'timeline', title, events }),
    check: (b, _c, p) => (Array.isArray(b.events) && b.events.length >= 1 && b.events.length <= 12 && b.events.every((e) => Number.isFinite(Date.parse(e?.at)) && isStr(e?.label, 1, 100) && ['ok', 'bad', 'neutral'].includes(e?.state))) ? [] : [err(`${p}.events`, 'timeline-events', 'events must be 1–12 {at: ISO date, label<=100, state: ok|bad|neutral}', 'fix the event shapes')],
  },
  graph: {
    describe: 'A small dependency/impact graph (≤12 nodes).',
    example: { title: 'Where it lands', nodes: [{ id: 'cockpit', label: 'cockpit', state: 'changed' }, { id: 'hub', label: 'hub', state: 'same' }], edges: [{ from: 'cockpit', to: 'hub', kind: 'new' }] },
    build: ({ title = 'Impact', nodes, edges }) => ({ id: 'graph', type: 'graph', title, nodes, edges }),
    check(b, _c, p) {
      const out = [];
      if (!Array.isArray(b.nodes) || b.nodes.length < 2 || b.nodes.length > 12) return [err(`${p}.nodes`, 'graph-node-count', 'graph needs 2–12 nodes', 'trim or add nodes')];
      const ids = new Set(b.nodes.map((n) => n?.id));
      b.nodes.forEach((n, i) => { if (!isStr(n?.id, 1, 40) || !isStr(n?.label, 1, 40) || !['changed', 'same', 'new', 'bad'].includes(n?.state)) out.push(err(`${p}.nodes[${i}]`, 'graph-node', 'node needs {id, label, state: changed|same|new|bad}', 'fix the node')); });
      (b.edges ?? []).forEach((e, i) => { if (!ids.has(e?.from) || !ids.has(e?.to)) out.push(err(`${p}.edges[${i}]`, 'graph-edge-ref', 'edge endpoints must be node ids', 'fix the edge')); });
      return out;
    },
  },
  callout: {
    describe: 'One short note, tone info|warn.',
    example: { text: 'The repro only fails on the live build.', tone: 'warn' },
    build: ({ text, tone = 'info' }) => ({ id: 'callout', type: 'callout', text, tone }),
    check: (b, _c, p) => (isStr(b.text, 1, 200) && ['info', 'warn'].includes(b.tone)) ? [] : [err(`${p}`, 'callout', 'callout needs text<=200 and tone info|warn', 'shorten or fix tone')],
  },
};

// ── temporary form: a restricted SVG the session designs itself when no preset fits ───────────────
const SVG_ELEMENTS = new Set(['svg', 'g', 'rect', 'circle', 'ellipse', 'line', 'polyline', 'polygon', 'path', 'text', 'tspan', 'title', 'desc', 'defs', 'lineargradient', 'stop']);
const SVG_FORBIDDEN = [['script', /<script/i], ['event handler (on*=)', /\son[a-z]+\s*=/i], ['link (href/xlink)', /href\s*=|xlink/i], ['external url()', /url\s*\(\s*['"]?(?!#)/i], ['foreignObject', /foreignobject/i], ['<image>', /<image/i], ['<use>', /<use\b/i], ['@import', /@import/i], ['javascript:', /javascript:/i], ['<iframe>', /<iframe/i]];
export function checkCanvas(b, p) {
  const out = [];
  if (!isStr(b.alt, 12, 300)) out.push(err(`${p}.alt`, 'canvas-alt', 'canvas needs a text alternative of 12–300 chars', 'describe what the picture shows; it is the fallback and the accessible name'));
  if (!isStr(b.rationale, 12, 200)) out.push(err(`${p}.rationale`, 'canvas-rationale', 'say why no preset fits (12–200 chars)', 'explain; repeated reasons are how new presets get promoted'));
  if (!Array.isArray(b.viewBox) || b.viewBox.length !== 2 || !b.viewBox.every((n) => Number.isFinite(n) && n >= 40 && n <= 800)) out.push(err(`${p}.viewBox`, 'canvas-viewbox', 'viewBox must be [width, height], each 40–800', 'set a size'));
  if (typeof b.svg !== 'string' || !b.svg.trim()) return [...out, err(`${p}.svg`, 'canvas-svg', 'svg fragment missing', 'provide the inner SVG markup')];
  if (b.svg.length > LIMITS.canvasBytes) out.push(err(`${p}.svg`, 'canvas-size', `svg is ${b.svg.length} chars, limit ${LIMITS.canvasBytes}`, 'simplify'));
  const hits = SVG_FORBIDDEN.filter(([, re]) => re.test(b.svg)).map(([name]) => name);
  if (hits.length) out.push(err(`${p}.svg`, 'canvas-forbidden', `svg contains forbidden constructs: ${hits.join(', ')}`, 'remove them; only drawing elements and local #fragment references are allowed'));
  for (const m of b.svg.matchAll(/<\/?\s*([a-zA-Z][\w:-]*)/g)) if (!SVG_ELEMENTS.has(m[1].toLowerCase())) { out.push(err(`${p}.svg`, 'canvas-element', `element <${m[1]}> is not allowed`, `allowed: ${[...SVG_ELEMENTS].join(', ')}`)); break; }
  return out;
}

// ── the document check ─────────────────────────────────────────────────────────────────────────────
export function checkBrief(doc) {
  const errors = [];
  if (doc === null || typeof doc !== 'object') return { ok: false, errors: [err('$', 'not-an-object', 'brief must be a JSON object', 'write a JSON object')] };
  const size = JSON.stringify(doc).length;
  if (size > LIMITS.bytes) errors.push(err('$', 'too-large', `brief is ${size} bytes, limit ${LIMITS.bytes}`, 'drop blocks or shorten text'));
  if (doc.v !== BRIEF_VERSION) errors.push(err('$.v', 'version', `v must be ${BRIEF_VERSION}`, 'set v: 0'));
  if (!isStr(doc.itemRef, 3, 200)) errors.push(err('$.itemRef', 'item-ref', 'itemRef is required', 'copy it from the job input'));
  if (!isStr(doc.headline, 1, LIMITS.headline)) errors.push(err('$.headline', 'headline', `headline must be 1–${LIMITS.headline} chars`, 'say in one line what is being asked'));
  const options = Array.isArray(doc.options) ? doc.options : [];
  if (options.length < 2 || options.length > LIMITS.options) errors.push(err('$.options', 'option-count', `need 2–${LIMITS.options} options, got ${options.length}`, 'list the real alternatives'));
  const optionIds = options.map((o) => o?.id);
  if (new Set(optionIds).size !== optionIds.length) errors.push(err('$.options', 'option-unique', 'option ids must be unique', 'rename'));
  const evidence = Array.isArray(doc.evidence) ? doc.evidence : [];
  const evidenceIds = new Set(evidence.map((e) => e?.id));
  const mechanicalEvidence = new Set(evidence.filter((e) => e?.mechanical === true).map((e) => e.id));
  if (evidenceIds.size !== evidence.length) errors.push(err('$.evidence', 'evidence-unique', 'evidence ids must be unique', 'rename'));
  evidence.forEach((e, i) => {
    if (!isStr(e?.id, 1, 40) || !isStr(e?.label, 1, 120)) errors.push(err(`$.evidence[${i}]`, 'evidence-shape', 'evidence needs id and label', 'fix'));
    if (e?.mechanical === true && (!isStr(e.ref, 1, 200) || !Number.isFinite(Date.parse(e.observedAt)))) errors.push(err(`$.evidence[${i}]`, 'evidence-mechanical-needs-ref', 'mechanical evidence needs a ref (command, file:line, sha) and an observedAt date', 'record how it was observed or mark it mechanical:false'));
  });
  options.forEach((o, i) => {
    if (!isStr(o?.id, 1, 30) || !isStr(o?.label, 1, 60) || !isStr(o?.does, 1, 200)) errors.push(err(`$.options[${i}]`, 'option-shape', 'option needs id, label (<=60) and does (<=200: what happens if chosen)', 'fix'));
    if (!Array.isArray(o?.consequence) || o.consequence.length < 1 || !o.consequence.every((c) => ['reversible', 'irreversible', 'costs', 'blocks', 'no-effect'].includes(c?.kind) && isStr(c?.text, 1, 80))) errors.push(err(`$.options[${i}].consequence`, 'option-consequence', 'each option needs 1+ consequence tags {kind: reversible|irreversible|costs|blocks|no-effect, text<=80}', 'add the tags the developer decides on'));
    for (const r of o?.evidenceRefs ?? []) if (!evidenceIds.has(r)) errors.push(err(`$.options[${i}].evidenceRefs`, 'unknown-evidence', `evidence "${r}" does not exist`, 'fix id'));
  });
  const rec = doc.recommendation;
  if (!rec || !optionIds.includes(rec.optionId)) errors.push(err('$.recommendation.optionId', 'recommendation', 'recommendation.optionId must be one of the options', 'pick the option you suggest'));
  else if (!Array.isArray(rec.why) || rec.why.length < 1 || rec.why.length > 3 || !rec.why.every((w) => isStr(w, 1, LIMITS.why))) errors.push(err('$.recommendation.why', 'recommendation-why', `why must be 1–3 reasons of <=${LIMITS.why} chars`, 'give the reasons'));
  const blocks = Array.isArray(doc.blocks) ? doc.blocks : [];
  if (blocks.length > LIMITS.blocks) errors.push(err('$.blocks', 'block-count', `at most ${LIMITS.blocks} blocks, got ${blocks.length}`, 'keep the ones that change the decision'));
  const ctx = { optionIds, evidenceIds, mechanicalEvidence };
  const blockIds = new Set();
  blocks.forEach((b, i) => {
    const p = `$.blocks[${i}]`;
    if (blockIds.has(b?.id)) errors.push(err(`${p}.id`, 'block-unique', `block id "${b?.id}" repeats`, 'rename')); blockIds.add(b?.id);
    if (b?.type === 'canvas') { errors.push(...checkCanvas(b, p)); return; }
    const preset = PRESETS[b?.type];
    if (!preset) { errors.push(err(`${p}.type`, 'block-type', `unknown block type "${b?.type}"`, `use one of: ${Object.keys(PRESETS).join(', ')}, or canvas`)); return; }
    errors.push(...preset.check(b, ctx, p));
  });
  return { ok: errors.length === 0, errors, iterationsAllowed: MAX_ITERATIONS };
}

// Deterministic default card: what the cockpit shows when there is no brief or it never passed the check.
export function defaultBrief({ itemRef, headline, question }) {
  return { v: BRIEF_VERSION, itemRef, headline: (headline ?? question ?? '').slice(0, LIMITS.headline), fallback: true, options: [], blocks: [], evidence: [] };
}

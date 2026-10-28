// Builds three sample briefs through the real builders and runs the real checker on them, plus the
// failing first attempts the check loop would have seen. Output: tmp/cockpit-briefing/briefs.json.
// Content is illustrative except where marked (R): the timeline in the rescue brief is the real driver log.
import fs from 'node:fs';
import { PRESETS, checkBrief } from './brief-check.mjs';

const T = (iso) => new Date(iso).toISOString();
const radar = (doc, spec) => PRESETS.radar.build(spec, doc);

// ── 1. go / no-go with a real choice: item-specific axes ───────────────────────────────────────────
const ac = {
  v: 0, itemRef: 'cloudcli://session/40728d71-e583-4664-a184-f52803e1a99f#2', headline: '要我按 A + C 实现吗？还是只做 C？',
  recommendation: { optionId: 'ac', why: ['A、C 同根：重渲染时清空选区与拖选中途跳动都来自懒加载行重挂载', '只做 C 之后清空缺陷仍可在线上构建复现'] },
  options: [
    { id: 'ac', label: 'A + C — 两个都修', does: '修复重渲染清空选区，并稳定拖选锚点；先写失败测试，再提交、构建、安全重启。', consequence: [{ kind: 'reversible', text: '仅落在任务分支' }, { kind: 'costs', text: '约 5 分钟' }], evidenceRefs: ['e1', 'e2'] },
    { id: 'c', label: '只做 C', does: '只压住拖选中途的跳动；重渲染时选区仍会被清空。', consequence: [{ kind: 'reversible', text: '1 个文件' }, { kind: 'costs', text: '约 2 分钟' }], evidenceRefs: ['e2'] },
    { id: 'n', label: '先不改，继续取证', does: '让会话在线上构建上先给出两个缺陷的复现步骤再回来问。', consequence: [{ kind: 'no-effect', text: '不改任何代码' }, { kind: 'costs', text: '约 5 分钟' }] },
  ],
  evidence: [
    { id: 'e1', kind: 'test', label: '已有失败用例覆盖 A', ref: 'npm test -- transcript-selection', observedAt: T('2026-10-26T05:10:00Z'), mechanical: true },
    { id: 'e2', kind: 'diff', label: '两个方案触及文件数', ref: 'git diff --stat task/transcript-selection', observedAt: T('2026-10-26T05:11:00Z'), mechanical: true },
    { id: 'e3', kind: 'transcript', label: '会话称两个缺陷在线上构建均可复现', mechanical: false },
  ],
  blocks: [],
};
ac.blocks.push(radar(ac, {
  title: '这件事的后果（轴按本事项定制）', axes: [
    { id: 'rev', label: '可逆', definition: '出错后撤销的代价：仅落在任务分支、无迁移，则很高', basis: 'mechanical', evidenceRefs: ['e2'] },
    { id: 'evid', label: '证据', definition: '测试与复现对该方案的支撑程度', basis: 'mechanical', evidenceRefs: ['e1'] },
    { id: 'clear', label: '根治清空', definition: '重渲染时选区不再被清空', basis: 'llm' },
    { id: 'jump', label: '根治跳动', definition: '拖选过程中锚点不再跳动', basis: 'llm' },
    { id: 'small', label: '改动小', definition: '涉及文件与行数越少越高', basis: 'mechanical', evidenceRefs: ['e2'] },
  ],
  scores: { ac: { rev: 95, evid: 70, clear: 92, jump: 88, small: 60 }, c: { rev: 95, evid: 62, clear: 10, jump: 85, small: 92 }, n: { rev: 100, evid: 40, clear: 0, jump: 0, small: 100 } },
}));
ac.blocks.push(PRESETS['compare-table'].build({ rows: [
  { label: '触及文件', cells: { ac: '2 + 测试', c: '1', n: '0' }, basis: 'mechanical' },
  { label: '需要新测试', cells: { ac: '是', c: '否', n: '—' }, basis: 'llm' },
  { label: '要重启服务', cells: { ac: '是', c: '是', n: '否' }, basis: 'mechanical' },
] }, ac));
ac.blocks.push(PRESETS.diffstat.build({ title: '预计改动（方案 A + C）', files: [{ path: 'src/modules/chat/transcript/useTranscriptSelection.ts', add: 34, del: 6 }, { path: 'src/modules/chat/transcript/TranscriptRow.tsx', add: 12, del: 3 }, { path: 'src/modules/chat/transcript/tests/selection.test.tsx', add: 48, del: 0 }] }));

// ── 2. rescue: real driver-log timeline (R) ───────────────────────────────────────────────────────
const rs = {
  v: 0, itemRef: 'quay://claudecodeui/task/gap-architecture-compact-chrome-and-tab-tooltip', headline: '任务已连续 4 次在 suite 失败：先等阻塞项修好再重派',
  recommendation: { optionId: 'hold', why: ['4 次红都在 fan-in 的 suite 一步，且 3 次是「# fail 0」——不是用例失败，是整套 suite 被中止', '阻塞项（develop 的 15 文件红集）已有任务在处理；现在重派大概率第 5 次同样红'] },
  options: [
    { id: 'hold', label: '等阻塞项修好后自动重派', does: '挂起这个任务，等 gap-server-suite-red-set-15-files 落地后重派一次。', consequence: [{ kind: 'reversible', text: '随时可取消' }, { kind: 'costs', text: '不消耗 worker' }], evidenceRefs: ['e1', 'e2'] },
    { id: 'now', label: '现在就重派', does: '立刻再派一次；上一轮的同一步 suite 红还没有被修复。', consequence: [{ kind: 'costs', text: '约 20–130 分钟 worker 时间' }, { kind: 'reversible', text: '可撤销' }], evidenceRefs: ['e1'] },
    { id: 'park', label: '停放，交给人', does: '标成 needs-human，不再消耗；之后由你决定。', consequence: [{ kind: 'blocks', text: '任务停在队列外' }, { kind: 'reversible', text: '可恢复' }] },
  ],
  evidence: [
    { id: 'e1', kind: 'log', label: '该任务 4 次尝试（均 exited-not-landed）', ref: 'quay driver log --task gap-architecture-compact-chrome-and-tab-tooltip', observedAt: T('2026-10-26T07:30:00Z'), mechanical: true },
    { id: 'e2', kind: 'task', label: '阻塞项任务 gap-server-suite-red-set-15-files 为 ready', ref: 'quay task get gap-server-suite-red-set-15-files', observedAt: T('2026-10-26T07:30:00Z'), mechanical: true },
  ],
  blocks: [],
};
rs.blocks.push(PRESETS.timeline.build({ title: '尝试记录（R：driver log，截至第 4 次）', events: [
  { at: '2026-10-25T16:28:48Z', label: '尝试 1 · 红 · mcp-session-lifecycle 用例失败 · 130 分钟', state: 'bad' },
  { at: '2026-10-25T20:14:03Z', label: '尝试 2 · 红 · suite「# fail 0」· 45 分钟', state: 'bad' },
  { at: '2026-10-25T20:37:25Z', label: '尝试 3 · 红 · suite「# fail 0」· 18 分钟', state: 'bad' },
  { at: '2026-10-25T23:06:36Z', label: '尝试 4 · 红 · suite「# fail 0」· 29 分钟', state: 'bad' },
] }));
rs.blocks.push(PRESETS.callout.build({ text: '「# fail 0」意味着没有任何用例失败却判红：是泄漏进程或整套 suite 被中止，重派不会改变它。', tone: 'warn' }));
rs.blocks.push(radar(rs, {
  title: '三个处置的后果', axes: [
    { id: 'rev', label: '可逆', definition: '处置之后能否撤回，不留副作用', basis: 'mechanical', evidenceRefs: ['e1'] },
    { id: 'evid', label: '证据', definition: '日志对该处置的支撑程度', basis: 'mechanical', evidenceRefs: ['e1', 'e2'] },
    { id: 'spend', label: '省 worker', definition: '少耗 worker 时间，越省越高', basis: 'mechanical', evidenceRefs: ['e1'] },
    { id: 'land', label: '能落地', definition: '该处置下任务最终落地的可能性', basis: 'llm' },
    { id: 'you', label: '少打扰你', definition: '需要你再次介入的可能性越低越高', basis: 'llm' },
  ],
  scores: { hold: { rev: 98, evid: 78, spend: 96, land: 90, you: 90 }, now: { rev: 95, evid: 78, spend: 15, land: 25, you: 40 }, park: { rev: 90, evid: 60, spend: 100, land: 5, you: 20 } },
}));

// ── 3. design ruling: a checklist, a graph, and a TEMPORARY form (canvas) ─────────────────────────
const ds = {
  v: 0, itemRef: 'cloudcli://session/1321a176-e502-45ff-a37e-9562c758cb3e#4', headline: '先写 agent 与中枢的契约，还是你先对第 7 节表态？',
  recommendation: { optionId: 'discuss', why: ['这取决于你对第 7 节的立场，是设计裁定，不是是/否', '契约会定下 4 个事件与冲突规则；第 7 节若变，事件集要重来'] },
  options: [
    { id: 'discuss', label: '在会话里讨论第 7 节', does: '打开会话并附上上下文包：问题、上一轮、3 个待决点。', consequence: [{ kind: 'costs', text: '约 5–30 分钟' }, { kind: 'no-effect', text: '不改任何文件' }], evidenceRefs: ['e1'] },
    { id: 'contract', label: '现在就写契约', does: '纯文档，不写代码；风险是第 7 节之后事件集要改。', consequence: [{ kind: 'reversible', text: '纯文档' }, { kind: 'costs', text: '约 10 分钟' }] },
    { id: 'stance', label: '我来先表态第 7 节', does: '会话等你回复；你在会话里直接写。', consequence: [{ kind: 'blocks', text: '会话等待你' }] },
  ],
  evidence: [{ id: 'e1', kind: 'transcript', label: '会话提出 4 个草稿事件与 3 个待决点', mechanical: false }],
  blocks: [],
};
ds.blocks.push(PRESETS.checklist.build({ title: '契约要定的三件事 + 你的立场', items: [
  { text: '事件集：draft.set / draft.append / draft.clear / confirm{rev}', done: false },
  { text: '草稿所有权与冲突规则（两台设备同时编辑）', done: false },
  { text: '目标固定规则（重连后目标会话是否保持）', done: false },
  { text: '你对第 7 节的立场', done: false },
] }));
ds.blocks.push(PRESETS.graph.build({ title: '契约落在哪', nodes: [
  { id: 'agent', label: '会话 agent', state: 'same' }, { id: 'hub', label: '驾驶舱中枢', state: 'changed' }, { id: 'composer', label: '编辑框', state: 'changed' }, { id: 'send', label: 'session-send', state: 'same' },
], edges: [{ from: 'agent', to: 'hub', kind: 'new' }, { from: 'hub', to: 'composer', kind: 'same' }, { from: 'composer', to: 'send', kind: 'same' }] }));
// A temporary form: a draft-ownership state machine — no preset fits it.
ds.blocks.push({ id: 'cv-states', type: 'canvas', viewBox: [520, 120],
  alt: '草稿所有权状态机：空闲 → 设备 A 起草 → 确认(rev) → 已发送；设备 B 在 A 起草期间编辑会进入冲突。',
  rationale: '状态机带冲突分支，预置的图不能表达带标签的转移。',
  svg: '<g font-size="12" fill="currentColor"><rect x="8" y="40" width="80" height="36" rx="8" fill="none" stroke="currentColor"/><text x="48" y="62" text-anchor="middle">空闲</text>'
    + '<rect x="150" y="40" width="110" height="36" rx="8" fill="none" stroke="#b45309" stroke-width="2"/><text x="205" y="62" text-anchor="middle">设备 A 起草</text>'
    + '<rect x="320" y="40" width="90" height="36" rx="8" fill="none" stroke="currentColor"/><text x="365" y="62" text-anchor="middle">确认(rev)</text>'
    + '<rect x="440" y="40" width="72" height="36" rx="8" fill="none" stroke="currentColor"/><text x="476" y="62" text-anchor="middle">已发送</text>'
    + '<path d="M88 58 L150 58" stroke="currentColor"/><polygon points="150,58 142,54 142,62"/><text x="119" y="52" text-anchor="middle" font-size="10">set</text>'
    + '<path d="M260 58 L320 58" stroke="currentColor"/><polygon points="320,58 312,54 312,62"/><text x="290" y="52" text-anchor="middle" font-size="10">confirm</text>'
    + '<path d="M410 58 L440 58" stroke="currentColor"/><polygon points="440,58 432,54 432,62"/>'
    + '<path d="M205 76 L205 104" stroke="#ef4444" stroke-dasharray="4 3"/><polygon points="205,104 201,96 209,96" fill="#ef4444"/><text x="215" y="102" font-size="11" fill="#ef4444">设备 B 同时编辑 → 冲突规则?</text></g>' });
ds.blocks.push(radar(ds, {
  title: '三个处置的后果', axes: [
    { id: 'rev', label: '可逆', definition: '之后能否无痛改回', basis: 'llm' },
    { id: 'evid', label: '证据', definition: '现有材料对该做法的支撑程度', basis: 'llm' },
    { id: 'rework', label: '少返工', definition: '第 7 节改变时需要推翻的工作越少越高', basis: 'llm' },
    { id: 'speed', label: '推进快', definition: '多快能让下一步有东西可做', basis: 'llm' },
  ],
  scores: { discuss: { rev: 100, evid: 55, rework: 90, speed: 40 }, contract: { rev: 85, evid: 55, rework: 35, speed: 85 }, stance: { rev: 100, evid: 55, rework: 90, speed: 25 } },
}));

const docs = { ac, rs, ds };
const results = Object.fromEntries(Object.entries(docs).map(([k, d]) => [k, checkBrief(d)]));
for (const [k, r] of Object.entries(results)) if (!r.ok) { console.error(k, JSON.stringify(r.errors, null, 1)); process.exit(1); }

// ── the check loop: what attempt 1 looked like, as the real checker reports it ────────────────────
const bad = structuredClone(ds);
bad.blocks.find((b) => b.type === 'radar').axes = bad.blocks.find((b) => b.type === 'radar').axes.filter((a) => a.id !== 'evid').concat([{ id: 'x', label: 'x', definition: 'x', basis: 'llm' }]);
bad.blocks.find((b) => b.type === 'radar').series[0].values.speed = 140;
bad.blocks.find((b) => b.type === 'canvas').svg += '<image href="http://x/y.png"/>';
const attempt1 = checkBrief(bad);

fs.mkdirSync(new URL('../../tmp/cockpit-briefing/', import.meta.url), { recursive: true });
fs.writeFileSync(new URL('../../tmp/cockpit-briefing/briefs.json', import.meta.url), JSON.stringify({ docs, attempt1 }, null, 1));
console.log('checked ok:', Object.keys(docs).join(', '), '| attempt-1 errors:', attempt1.errors.length, attempt1.errors.map((e) => e.rule).join(', '));

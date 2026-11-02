---
id: gap-cockpit-knowledge-details-section
title: cockpit 详情抽屉补知识正文段：knowledge.title/statement 完整显示（列表只截两行，详情给全文）
status: ready
labels:
  - gap
  - defect
  - cockpit
parent: null
children: []
extra:
  schema: execution
---
## Proposal

**结论：详情抽屉补一个 knowledge Section（放在 situation 之后、facts 之前），渲染 `card.knowledge.title` + `card.knowledge.statement` 完整不截断；列表页保持现状（截两行）。**

### 现状（已核实 file:line）

- 列表页 `src/modules/cockpit/cards/CockpitCard.tsx:385-400` 渲染了 `card.knowledge.title`（truncate）与 `card.knowledge.statement`（**`line-clamp-2`**），全文在元素 `title` 属性里——所以列表只显示两行。
- 详情抽屉 `src/modules/cockpit/cards/CockpitCardDetails.tsx` 里 `knowledge` **零引用**——它渲染的 Section 是 situation / assistantQuote / facts / brief / options / conversation，没有知识标题/正文这一段。
- 实测：用户在 cockpit 列表能看见 statement 但被截断，详情页完全没有 statement。companion `gap-cockpit-knowledge-title-statement-on-card`（done）的前端只做了一半——列表卡渲染了，Details 抽屉漏了。

### 修复

只改一处：`CockpitCardDetails.tsx` 加一个 Section（建议 situation 之后、facts 之前），渲染 `card.knowledge.title` + `card.knowledge.statement` **完整不截断**（`whitespace-pre-line`、不加 clamp、不加 line-clamp）；`card.knowledge` 缺失或两字段都没有时不画这个 Section。列表页 `CockpitCard.tsx` 的 clamp **不动**。

### 不弱化

- 非 knowledge 卡（或 knowledge 卡缺 title 与 statement）不出现该 Section。
- 不动列表页、不动契约、不动 server 读侧与投影。

## AC

- [x] `npx vitest run src/modules/cockpit/tests/CockpitCard.test.tsx` 退出码 0，且新增/扩展用例断言：带 `title`+`statement` 的 knowledge 卡打开 Details 抽屉时出现 `cockpit-card-details-knowledge-title` / `cockpit-card-details-knowledge-statement` 两个节点，文本与原文逐字相等、无 clamp；非 knowledge 卡不出现该 Section；knowledge 卡缺两字段时不出现该 Section。
- [x] `npx oxlint src/modules/cockpit/cards/CockpitCardDetails.tsx src/modules/cockpit/tests/CockpitCard.test.tsx` 与 `npx tsc --noEmit -p tsconfig.json` 退出码 0。
- [x] 只读复核：`git diff -- src/modules/cockpit/cards/CockpitCard.tsx` 为空（列表 clamp 未动）；`git grep -n "knowledge" src/modules/cockpit/cards/CockpitCardDetails.tsx` 只命中新加的 knowledge Section；`git diff` 显示只新增 Details 的 knowledge Section 与测试。

## DoD

`CockpitCardDetails` 对知识卡在 situation 之后渲染 title+statement 全文（`whitespace-pre-line`、不截断），非知识卡与缺字段的知识卡不渲染；列表页 clamp 保持不变。真实对象已被操作：浏览器打开知识卡 `att_d6edb0a3400e`（fleet companion `gap-knowledge-card-knowledge-content` 已补 title/statement）的 Details 抽屉，截图显示标题与正文全文可见、无两行截断；非知识 need 卡 Details 无此 Section，截图存 `tmp/`。fleet 未落地时用含 title/statement 的 fixture 卡在隔离实例或 vite dev 证明；端到端「详情显示知识全文」与对方 `gap-knowledge-card-knowledge-content` 的 AC4 联合闭合。

## Evidence

- `npx vitest run src/modules/cockpit/tests/CockpitCard.test.tsx` → 96 passed（含新增 3 个用例：逐字全文/无 clamp/位置顺序；非知识卡不画；缺两字段不画）。
- `npx oxlint src/modules/cockpit/cards/CockpitCardDetails.tsx src/modules/cockpit/tests/CockpitCard.test.tsx` → EXIT 0；`npx tsc --noEmit -p tsconfig.json` → EXIT 0。
- 只读复核：`git diff -- src/modules/cockpit/cards/CockpitCard.tsx` 为空；`git grep -n knowledge` 在 `CockpitCardDetails.tsx` 只命中新 Section 及其可见性推导；实现 commit `aa6885a7a` 只含该 Section 与测试。
- 真实页面（worktree Vite dev `:5199` 代理线上 `:3001`）：线上真实知识卡 `att_d297f675192f` 的 Details 抽屉在 SITUATION 之后、FACTS 之前显示「知识」段，title 与 354 字 statement 逐字相等、`whitespace-pre-line`、无 clamp；同一卡在列表仍 `line-clamp-2`。非知识卡 `att_000b2facce07` 的 Details 无该 Section。截图 `tmp/knowledge-details-dod/01-cards-list-knowledge-clamped.png`、`02-details-knowledge.png`、`03-details-plain.png`；读数 `tmp/knowledge-details-dod/report.json`（8 checks all ok）。任务原文点名的 `att_d6edb0a3400e` 当前不在线上卡片集，改用当下线上已带 title/statement 的真实知识卡完成同一真实对象操作。
- 场景运行器回归：`node scripts/ui-scenario.mjs e2e/scenarios/cockpit-mode-switch.json --base-url http://127.0.0.1:5199 … --out tmp/scenario-cockpit-mode-switch` → passed (3 steps, 3 checkpoint(s))。
- 该轴仍暗,理由:本任务只改 cockpit 前端详情抽屉的渲染，架构图层未变，无实测数值。

## Touches

- src/modules/cockpit/cards/CockpitCardDetails.tsx
- src/modules/cockpit/tests/CockpitCard.test.tsx
- tasks/gap-cockpit-knowledge-details-section.md
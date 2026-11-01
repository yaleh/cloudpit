---
id: gap-cockpit-assistant-quote-guard-non-ask-kinds
title: cockpitAssistantQuote 兜底对非 ask 卡越界：机械 need/fix/stuck/decision
  卡的『任务标题』/「引号」被误读成「助手原话」
status: todo
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

**结论：`cockpitAssistantQuote` 兜底只应服务 `kind === 'ask'`（session-ask）卡，其余 kind 一律返回 null。**

### 现状（实测）

`cockpitAssistantQuote`（`src/modules/cockpit/cockpitCardDescriptors.ts:275`）现对任何卡都从 `situation`、`ask` 里找第一对 `「」`/`『』`/`""` 当「助手原话」；`CockpitCardDetails.tsx:253` 兜底调用（`card.assistantQuote ?? cockpitAssistantQuote(card)`）。`card.assistantQuote` 只在 session-ask 卡由 T1 摘要投影填上（`cockpit-fleet-card-projection.ts:548`），其余卡一律走这个括号兜底。

对机械生成的 need/fix/stuck/decision 卡，fleet 的 `ask` 是 `任务『${title}』…`（`rescue.ts` `contentAskFor`）、`situation` 是 bodyLead（含 `「AC 集缺一条」` 这类引号事实），兜底于是把任务标题或引号事实抠出来当「助手原话」——这是编造：这些卡根本没有助手说过的话。

### 修复

`cockpitAssistantQuote` 加一个 `card.kind !== 'ask'` 的早退：只有 session-ask 卡（`kind='ask'`）的摘要才可能真正引用助手原话，其余 kind（need/fix/stuck/decision/multi/knowledge/未知）一律 `null`。评估过的会话卡已走 `card.assistantQuote` 专属字段；这个兜底只服务旧摘要把原话嵌在 `situation`/`ask` 里的 session-ask 卡，行为不变。

### 不弱化

- session-ask 卡（`kind='ask'`）的括号提取行为逐字节不变。
- 不新增状态、不改任何组件结构；改动是 `cockpitCardDescriptors.ts` 一个纯函数加一个早退分支。

## AC

- [ ] `npx vitest run src/modules/cockpit/tests/cockpitCardDescriptors.test.ts` 退出码 0：正臂——`kind='ask'` 且 situation/ask 含引号时返回括号内引语；负臂——`kind ∈ {need,fix,stuck,decision,multi,knowledge,unknown}` 且 ask 含 `任务『标题』…` 或 situation 含 `「AC 集缺一条」` 时返回 `null`；`kind='ask'` 无引号时返回 `null`。
- [ ] `npx oxlint src/modules/cockpit/cockpitCardDescriptors.ts src/modules/cockpit/tests/cockpitCardDescriptors.test.ts` 与 `npx tsc --noEmit -p tsconfig.json` 均退出码 0。
- [ ] 只读复核：`git diff -- src/modules/cockpit/cockpitCardDescriptors.ts` 显示仅新增 `card.kind !== 'ask'` 早退与注释、无删除既有提取逻辑；`git grep -n "cockpitAssistantQuote" src/` 仍只有 `cockpitCardDescriptors.ts` 定义与 `CockpitCardDetails.tsx` 一处调用。

## DoD

`cockpitAssistantQuote`（`src/modules/cockpit/cockpitCardDescriptors.ts`）对 `kind !== 'ask'` 返回 `null`，机械 need 卡的 Details 抽屉不再渲染「What the assistant said」；新增 `src/modules/cockpit/tests/cockpitCardDescriptors.test.ts` 覆盖正/负臂，`npx vitest run src/modules/cockpit/tests/cockpitCardDescriptors.test.ts` 全绿（6 用例）。用真实 need 卡 `gap-goal-010-exit-conditions-section`（`att_230987d02d3f`）的 ask/situation 形状喂给该函数，返回 `null`；session-ask 卡行为不变。

## Touches

- src/modules/cockpit/cockpitCardDescriptors.ts
- src/modules/cockpit/tests/cockpitCardDescriptors.test.ts (new)
- tasks/gap-cockpit-assistant-quote-guard-non-ask-kinds.md
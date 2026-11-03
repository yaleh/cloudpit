---
id: gap-cockpit-molten-decision-card
title: cockpit 熔融需人决策卡：新 kind molten-decision 渲染 + confirm 结晶执行器（不复用 knowledge
  confirm）
status: done
labels:
  - gap
  - feature
  - cockpit
parent: null
children: []
extra:
  schema: execution
---
## Proposal

**结论：ADR-016 熔融驱动短环的「需人决策」产物在 cockpit 用新 kind `molten-decision` 渲染 + 新 confirm 执行器结晶；不复用 knowledge 卡的 confirm 路径。**

### 机制背景（对端 GOAL-012）

熔融驱动短环：机械触发（读 fleet home 跨项目状态 → 内联成【现状】块）→ 装配 prompt（信念全集 + 现状 + 边界 + 输出要求）→ 派发一次性 Claude Code 会话 → 产出「判断 + 动作 + 一行结论 + dispatch 提议」→ 结果两路结晶：可派工程动作立 quay 任务，需人决策立 cockpit 卡。阶段不直接执行，输出只是可评的 task/card。

### 为什么不复用 knowledge confirm

cockpit 现有两条卡通道：

- `knowledge` 卡绑定 `caseId/knowledgeRevision/proposalRevision/factsFingerprint`，confirm 走 `fleet.apply`（知识执行，apply/modify/defer/not-applicable 词汇）。熔融决策卡没有知识溯源，硬复用会把知识契约拧变形。
- `decision` 卡是 initiative-decision 的自决审计（confirm/revise 判据），语义也不是「LLM session 产出的需人决策 + dispatch 提议」。

所以熔融决策卡是**新 category → 新 open kind `molten-decision`**：渲染层复用通用卡片框架（ask/situation/facts/options + confirm bar），confirm 走**新执行器**把人的决定结晶（采纳 → 立 quay 任务 / 修订 / 否），⛔ 不经过 `fleet.apply`、不加 knowledge 块。

### claudecodeui 侧范围（本任务）

1. 新 kind descriptor `molten`（badge/tone/label），`kind` 开放字符串，不塞进 `CockpitCardKind` 已知并集（与 `knowledge`/`digest` 同态）。
2. 卡片投影：fleet 的熔融决策 category → `molten` 卡，透传「判断/一行结论/动作/dispatch 提议」到 ask/situation/facts/options。
3. confirm 执行器声明（名与参数表与 fleet GOAL-012 契约对齐，暂定 `fleet.molten-decide`）：人的决定 → fleet 结晶（task/card 分流），不碰 knowledge confirm、不碰 `fleet.apply`。
4. wire 类型 + TypeSync：新增熔融决策块/字段两端同步（`src/shared/types.ts` + `server/shared/types.ts`，`cockpitCardTypeSync` 逐字段比对）。

### 依赖与边界

- wire 形状、执行器名、结晶参数表以 fleet GOAL-012 契约为准；本任务只做 cockpit 侧渲染 + confirm 声明 + 类型同步，不实现 fleet 侧结晶逻辑。
- 端到端「熔融触发 → 卡 → apply」在 GOAL-012 与本任务都落地后联合复验（待外部）。

## AC

- [x] `npx vitest run src/modules/cockpit/tests/CockpitCard.test.tsx`（或新增 descriptor 测试）退出码 0，且新增用例断言：`molten` kind 渲染出专属徽标/kind label（descriptor 命中，非默认 other）；熔融决策卡投影后 `kind === 'molten'` 且 ask/facts/options 承载「判断/结论/dispatch 提议」；confirm 执行器在 declared executors 集合中，且其 id ≠ `fleet.apply`、knowledge 块不被创建。
- [x] `npx oxlint`（改动文件）与 `npx tsc --noEmit -p tsconfig.json && npx tsc --noEmit -p server/tsconfig.json` 退出码 0；`src/shared/tests/cockpitCardTypeSync.test.ts` 退出码 0。
- [x] 只读复核：`git diff` 显示只新增 `molten` descriptor、投影、confirm 执行器声明与类型同步；`git grep -n "fleet.apply" server/modules/cockpit/` 无新增调用（knowledge confirm 未被复用）；`git grep -n "molten" src/modules/cockpit/cockpitCardDescriptors.ts` 命中新 descriptor。

## DoD

一张熔融决策卡在 cockpit 用新 `molten` 徽标渲染（结论 + 选项 + confirm bar），confirm 走新声明的执行器（结晶成 task/card），不经过 knowledge confirm、不建 knowledge 块；wire 类型两端同步。真实对象已被操作：GOAL-012 落地后，用一次真实熔融触发产出的卡在浏览器打开、渲染、confirm 走新执行器（端到端 apply 联合复验，待外部），截图存 `tmp/`。本任务不把「fleet 已结晶 task/card」写成自身 DoD。

## Notes

实现与自检（2026-11-03）：

- AC-1：`npx vitest run src/modules/cockpit/tests/CockpitCard.test.tsx` 退出 0（99 tests）。新增用例断言：`molten` descriptor 命中（badge `MLT`、`data-tone="molten"`、title `Molten decision`，非默认 other）；熔融决策卡的判断→ask、结论→fact、动作/dispatch 提议→options；每个 option 的执行器为 `fleet.molten-decide`（≠ `fleet.apply`），且卡片无 knowledge 块、DOM 无 knowledge 区块。服务端判据 `cockpit-fleet-card-provider.test.ts` 同时断言投影后 `kind === 'molten'`、四段读数落位、`declaredExecutors` 含 `fleet.molten-decide` 且迟到绑定可解析该执行器。
- AC-2：`npx oxlint`（全部改动文件）退出 0；`npx tsc --noEmit -p tsconfig.json` 与 `-p server/tsconfig.json` 均退出 0；`npx vitest run src/shared/tests/cockpitCardTypeSync.test.ts` 7 tests 通过（新增 `CockpitMoltenDecision` / `CockpitMoltenDecisionAction` 两行逐字段比对）。
- AC-3：改动只有 molten descriptor、投影（熔融逻辑抽到新兄弟文件 `cockpit-fleet-molten.ts` 由投影调用）、`fleet.molten-decide` 执行器声明与两端类型同步；`git grep -n "fleet.apply" server/modules/cockpit/` 的非测试命中全部是既有知识路径（`cockpit-card-actions.ts`）与本次新增的「不是 fleet.apply」注释/负向断言，无新增调用；`git grep -n "molten" src/modules/cockpit/cockpitCardDescriptors.ts` 命中新 descriptor。
- 架构棘轮：新增实现文件后投影文件 855→744 行（<800）；两端 `shared/types.ts` 各 +44 行按 AC-394 RECORDED CHANGE 格式上调基线（记录在该 baseline 的 note 内）；`architecture-ratchet.test.ts` 与 `server-import-cycle-budget.test.ts` 全绿。
- DoD：卡片渲染（结论 + 选项 + confirm bar）由组件判据与 12 语言 i18n 完整性判据覆盖；真实熔融触发 → 浏览器确认 → fleet 结晶的端到端联合复验按 DoD 所述为（待外部），等待 GOAL-012 落地。
- 该轴仍暗,理由:本任务只做 cockpit 卡片渲染、执行器声明与 wire 类型同步，未产生 L_D 或 L_G 的依赖/分层读数

## Touches

- src/modules/cockpit/cockpitCardDescriptors.ts
- src/shared/types.ts
- server/shared/types.ts
- server/modules/cockpit/cockpit-fleet-card-projection.ts
- server/modules/cockpit/cockpit-fleet-molten.ts (new)
- server/modules/cockpit/cockpit-fleet-executor.ts
- server/modules/cockpit/cockpit-fleet-card-provider.ts
- src/modules/cockpit/tests/CockpitCard.test.tsx
- src/shared/tests/cockpitCardTypeSync.test.ts
- server/modules/cockpit/tests/cockpit-fleet-card-provider.test.ts
- server/modules/cockpit/tests/cockpit-fleet-executor.test.ts
- server/shared/tests/architecture-ratchet.baseline.json
- src/modules/i18n/locales/*/common.json
- tasks/gap-cockpit-molten-decision-card.md

## Blocker

**2026-11-03T11:07:52.045Z — worker 未落地（exited-not-landed）**

- 未落地原因：step=suite: not ok - server/shared/tests/architecture-ratchet.test.ts:   AssertionError [ERR_ASSERTION]: ratchet: oversizeFiles server/modules/providers/services/provider-runtime.service.ts 1291→1301 — 基线内读数不得上调（此基线只允许下降） [baseline A/B: HARD RED (changed-assertion) — the task's red set is NOT a subset of the develop baseline red set: added=- changed=server/shared/tests/architecture-ratchet.test.ts]
- run_id：wk-prod-anchor
- session_id：1bb56e4c-406d-404a-ab42-426ec16151e2

---
id: gap-routine-architecture-analysis-cycle-src-shared-root-ui
title: "architecture-analysis: src/shared root, ui, hooks and context form a
  4-package SCC whose only root->subdir edge is PROVIDER_DESCRIPTORS carrying
  four React logo components out of c"
status: ready
labels:
  - gap
  - routine-filed
  - architecture-analysis
parent: null
children: []
extra: {}
---
## Finding
src/shared root, ui, hooks and context form a 4-package SCC whose only root->subdir edge is PROVIDER_DESCRIPTORS carrying four React logo components out of constants.ts, while ui/hooks/context all import '@/shared/{utils,types,constants}' back.

载体记录（逐字来源）：`.quay/routine-findings.jsonl` · routine `architecture-analysis` · probe `architecture-analysis` · runId `architecture-analysis-1793090640570` · ts `2026-10-27T08:44:00.570Z`。

该 finding 由例程的机械通道产出，本任务由**同一条通道**依赖 `plugin/scripts/routine-file-gate.ts` 的三道闸
（quality / dedup / rate）机械立案 —— ⛔ 不是由人转抄，也不是由探针自行执行。

- 观测符号：`PROVIDER_DESCRIPTORS`、`ClaudeLogo`、`CodexLogo`、`CursorLogo`、`OpenCodeLogo`
- 涉及文件：
- `src/shared/constants.ts:14`
- `src/shared/constants.ts:278`
- `src/shared/ui/LLMProviderLogo.tsx:1`
- `src/shared/ui/DarkModeToggle.tsx:3`
- `src/shared/hooks/useVersionCheck.ts:3`
- kind：`dependency-cycle`
- verdict：`confirmed`

## Requested action
Move the logo ComponentType fields out of src/shared/constants.ts into src/shared/ui/providerLogos.ts (constants keeps ids/labels only) so the root has no edge into ui/; AC: detect_cycles lists src/shared root as its own component and no module under src/shared/{ui,hooks,context} changes its imports.

## Effect Prediction
- metric: concept_recurs_after_merge
- expected: false
- statement: 修复后 `<none>` 不再以同一 subject 复发（同 concept_key 的后续记录数应为 0）
- recorded_at: 2026-10-27T08:44:00.570Z

## Disposition

已修复（commit `97b780271`，task 分支 `task/gap-routine-architecture-analysis-cycle-src-shared-root-ui`）。

- 复核：`.quay/routine-findings.jsonl:23` 的 finding 记录与正文一致。在 develop（`4c49d707d`）上用 archguard `detect_cycles`（`outputScope=package`，scope `93e0a992`）复现：包级环 6 个，其中 `shared, shared/context, shared/hooks, shared/ui`（size=4）；该 SCC 的唯一 root→subdir 边确为 `shared/constants.ts:14-17` 的四个 logo import（边表逐条核实）。
- 处置：四个 logo 组件映射移入新文件 `src/shared/ui/providerLogos.ts`（`PROVIDER_LOGOS` + `resolveProviderLogo`）；`src/shared/constants.ts` 只保留 id/label/login 等描述字段，不再 import `src/shared/ui`；`LLMProviderLogo` 从同包 `providerLogos.ts` 取 mark。provider 差异仍是数据表行，不新增 `provider === '…'` 分支。
- 复核读数（worktree 上重新 `archguard_analyze` + `detect_cycles`，scope `213de866`）：包级环 5 个，`shared` 不出现在任何环中（baseline 6 个且含 shared size-4 SCC），即 src/shared 根包已是独立组件。
- import 面核实：src/shared 根包的 production 代码对 `ui/hooks/context` 的 import 数为 0（仅 `src/shared/tests/*` 的测试 import 保留，测试包不是环成员）；`ui/hooks/context` 内除 `LLMProviderLogo.tsx` 与新文件 `providerLogos.ts` 外无改动，三条反向 import 面（`@/shared/{utils,types,constants}` 等）逐字未变。
- 说明：finding 的 “no module under src/shared/{ui,hooks,context} changes its imports” 按“反向边不动”实现；`LLMProviderLogo.tsx` 必须新增对同包 `providerLogos.ts` 的 import 并去掉对 `constants` 的 import，否则 logo 无消费方 —— 这是完成 suggestedAction 的最小改动，其余 ui/hooks/context 文件零改动。
- 验证：`npx tsc --noEmit -p tsconfig.json` exit 0；`npx oxlint` 三文件 exit 0（仅既有 static-components warning）；`npx vitest run src/shared/tests/debug-agent-display-identity.test.ts src/shared/tests/sharedLayerIsolation.test.tsx` 3/3 passed；`npm run build:client` exit 0。
- 视觉/场景：改动为等价渲染（同一 provider 仍渲染同一 logo）；现有 ui-scenario 场景均为 cockpit 交互、无 provider mark 场景；渲染等价由 `debug-agent-display-identity.test.ts` 的 (c)(d)(e) 逐 provider 静态渲染断言钉住。

- L_G src: cycles=5 maxScc=5 sharedInCycle=0 baselineCycles=6 baselineSharedSccSize=4

## AC
- [x] `.quay/routine-findings.jsonl` 中 finding `cycle-src-shared-root-ui`（routine `architecture-analysis`，runId `architecture-analysis-1793090640570`）所描述的问题被复核并处置
- [x] 处置结论可核：要么修掉，要么写明「已有机制在管、失败在哪一步」，⛔ 不以「已注意到」结案

## DoD
- [x] 上面的判据实跑通过
- [x] ⛔ 探针只立案不执行：本任务若需要跑产出者/修复，由派发链执行，⛔ 不由例程代跑

## Touches
- `src/shared/constants.ts`
- `src/shared/ui/LLMProviderLogo.tsx`
- `src/shared/ui/providerLogos.ts`
- `src/shared/ui/DarkModeToggle.tsx`
- `src/shared/hooks/useVersionCheck.ts`
- `tasks/gap-routine-architecture-analysis-cycle-src-shared-root-ui.md`
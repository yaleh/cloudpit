---
id: gap-routine-architecture-analysis-dup-cockpit-iseditabletarget
title: "architecture-analysis: Byte-identical keyboard-target predicate (10
  lines) duplicated inside the same module — the two call sites and the module's
  own parent<->hooks cycle are the "
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
Byte-identical keyboard-target predicate (10 lines) duplicated inside the same module — the two call sites and the module's own parent<->hooks cycle are the same boundary leak.

载体记录（逐字来源）：`.quay/routine-findings.jsonl` · routine `architecture-analysis` · probe `architecture-analysis` · runId `architecture-analysis-1793208251918` · ts `2026-10-28T17:24:11.918Z`。

该 finding 由例程的机械通道产出，本任务由**同一条通道**依赖 `plugin/scripts/routine-file-gate.ts` 的三道闸
（quality / dedup / rate）机械立案 —— ⛔ 不是由人转抄，也不是由探针自行执行。

- 观测符号：`isEditableTarget`
- 涉及文件：
- `src/modules/cockpit/CockpitPage.tsx:200`
- `src/modules/cockpit/hooks/useCockpitPushToTalk.ts:52`
- kind：`duplicate`
- verdict：`confirmed`

## Requested action
Extract to `src/shared/utils.ts` (which already hosts `clamp`) or a cockpit leaf module, and import it from both; AC: one definition of `isEditableTarget` under `src/`.

## Effect Prediction
- metric: concept_recurs_after_merge
- expected: false
- statement: 修复后 `<none>` 不再以同一 subject 复发（同 concept_key 的后续记录数应为 0）
- recorded_at: 2026-10-28T17:24:11.918Z

## AC
- [x] `.quay/routine-findings.jsonl` 中 finding `dup-cockpit-iseditabletarget`（routine `architecture-analysis`，runId `architecture-analysis-1793208251918`）所描述的问题被复核并处置
- [x] 处置结论可核：要么修掉，要么写明「已有机制在管、失败在哪一步」，⛔ 不以「已注意到」结案

## DoD
- [x] 上面的判据实跑通过
- [x] ⛔ 探针只立案不执行：本任务若需要跑产出者/修复，由派发链执行，⛔ 不由例程代跑

## 处置
复核：finding 记录存在于 `.quay/routine-findings.jsonl`（runId `architecture-analysis-1793208251918`，ts `2026-10-28T17:24:11.918Z`，verdict `confirmed`），且在 develop 起点上属实 —— 修复前 `git show develop:src/modules/cockpit/CockpitPage.tsx | grep -n 'function isEditableTarget'` 读到 `200:`，`git show develop:src/modules/cockpit/hooks/useCockpitPushToTalk.ts | grep -n 'function isEditableTarget'` 读到 `52:`，两处字节相同。

处置：修掉。把谓词提取为 `src/shared/utils.ts` 的 `isEditableTarget`（前端模块标准：两个及以上文件使用的工具放 `src/shared/utils.ts`），`CockpitPage` 与 `useCockpitPushToTalk` 改为从 `@/shared/utils` 导入，两处私有副本删除。

复核读数（工作树内实跑）：
- `grep -rn "function isEditableTarget" src/` → 仅 `src/shared/utils.ts:99` 一处定义（修复前为 2 处）。
- `npx vitest run src/shared/tests/sharedUtilsHelpers.test.ts` → 4 passed。
- `npx vitest run src/modules/cockpit/tests/CockpitPushToTalk.test.tsx` → 5 passed。
- `npx tsc --noEmit -p tsconfig.json` → exit 0。
- `npx oxlint src/shared/utils.ts src/modules/cockpit/CockpitPage.tsx src/modules/cockpit/hooks/useCockpitPushToTalk.ts src/shared/tests/sharedUtilsHelpers.test.ts` → 无 error（仅既有的 warning）。

该轴仍暗,理由:本任务是同一模块内键鼠目标谓词的去重提取,判据是 src/ 下定义数与两处调用点行为,没有可记的 L_D/L_G 量化读数。

## Touches
- `src/modules/cockpit/CockpitPage.tsx`
- `src/modules/cockpit/hooks/useCockpitPushToTalk.ts`
- `src/shared/utils.ts`
- `src/shared/tests/sharedUtilsHelpers.test.ts`
- `tasks/gap-routine-architecture-analysis-dup-cockpit-iseditabletarget.md`
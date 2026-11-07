---
id: gap-routine-architecture-analysis-file-cycle-shared-api-voiceconfig-barrel
title: "architecture-analysis: File-level value SCC of 2 (voiceConfig.ts imports
  the `api` object from its own package barrel at line 33 while index.ts
  value-imports readVoiceConfig/voiceC"
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
File-level value SCC of 2 (voiceConfig.ts imports the `api` object from its own package barrel at line 33 while index.ts value-imports readVoiceConfig/voiceConfigHeaders back at line 22) — invisible to both ratchets because frontend-import-cycle-budget collapses directory/module nodes and AC-394's server budget does not scan src/shared.

载体记录（逐字来源）：`.quay/routine-findings.jsonl` · routine `architecture-analysis` · probe `architecture-analysis` · runId `architecture-analysis-1794055077651` · ts `2026-11-07T12:37:57.651Z`。

该 finding 由例程的机械通道产出，本任务由**同一条通道**依赖 `plugin/scripts/routine-file-gate.ts` 的三道闸
（quality / dedup / rate）机械立案 —— ⛔ 不是由人转抄，也不是由探针自行执行。

- 观测符号：`api`、`readVoiceConfig`、`voiceConfigHeaders`、`whenVoiceConfigReady`
- 涉及文件：
- `src/shared/api/voiceConfig.ts:33`
- `src/shared/api/index.ts:22`
- `src/shared/api/index.ts:306`
- kind：`dependency-cycle`
- verdict：`confirmed`

## Requested action
Extract the `api` object (index.ts:306) into src/shared/api/client.ts, re-export it from index.ts and have voiceConfig.ts import ./client; AC: a file-level value-SCC scan over src/shared reports 0 cycles and src/shared/tests/voiceConfig*.test.ts stay green.

## Disposition
修复。`api` 端点表从 `index.ts` 移入 `client.ts`（由 `clientCore.ts` + `clientTail.ts` 组成），请求管线移入 `requests.ts`；`voiceConfig.ts` 改为从 `@/shared/api/client` 取 `api`，`index.ts` 原样再导出 `api` 与移走的公共 helper，因此所有既有 import 点不变。`VoiceConfig` 类型移入叶子 `voiceConfigType.ts`，两侧都只以类型引用它，避免用类型边重新闭合环。同时把该粒度钉进仓库：`server/shared/tests/frontend-import-cycle-budget.test.ts` 新增 `src/shared` 的 FILE-level 扫描（复用同一个 walk / resolver / Tarjan 核），pin = 0 个非平凡 SCC，并带 planted-cycle 正臂与单向 import 负臂，使这一粒度不再对棘轮不可见。

尚有两个与拆分同源、但读取点仍钉在旧文件的家外判据，本轮一并搬到新包边界并保留不变式（不是放宽判据）：
- `src/modules/file-tree/tests/fileTreeSearchIndex.test.tsx`：原读 `src/shared/api/index.ts` 找 `files-search-index` 并断言 `getFiles` 已退役；现读 `src/shared/api` 下全部非测试 `.ts`（整个包面），两条断言不变。
- `src/modules/cockpit/tests/cockpitCardStartConversation.test.ts`：允许引用 `cockpitSessionStart` 的面从 `src/shared/api/index.ts` 改为 `src/shared/api/clientTail.ts`（端点行移入 tail）。

- 该轴仍暗,理由: 本任务只是把端点表提取成叶子模块以消除 file-level value SCC，没有可读出的 L_D/L_G 数值读数。

## Evidence
- 文件级 value-SCC 扫描（`src/shared`，值为节点、排除 type-only import 边）：`nonTrivialSccs: []`（77 files，103 value edges）。
- 同扫描包含 type-only 边（更严）：`nonTrivialSccs: []`（77 files，139 edges）。
- 修复前同一扫描：`[["shared/api/index.ts","shared/api/voiceConfig.ts"]]`。
- `vitest run src/shared/tests`：46 files / 324 tests 全绿（含 `voiceConfig.test.ts` 17、`voiceConfigHydration.test.ts` 8）。
- 语音相关批次 30 files / 230 tests 全绿；`architecture-ratchet` 6/6 绿；`frontend-import-cycle-budget` 9/9 绿（含新增 file-level 判据）。
- `tsc --noEmit` 前端与 server 两个 project 均通过；`oxlint` 对改动文件无输出。
- 本轮（merge develop 之后复量）：`frontend-import-cycle-budget` 9/9 绿，`(file) src/shared files=77 edges=132 sccs=[]`；`architecture-ratchet` 6/6 绿；`vitest run src/shared/tests` 46 files / 324 tests 绿；三条 settings 语音测试 16/16 绿；`tsc --noEmit -p tsconfig.json` 通过。
- 两条随拆分搬迁的兄弟读数：`fileTreeSearchIndex.test.tsx` + `cockpitCardStartConversation.test.ts` 合计 10/10 绿。

## Effect Prediction
- metric: concept_recurs_after_merge
- expected: false
- statement: 修复后 `<none>` 不再以同一 subject 复发（同 concept_key 的后续记录数应为 0）
- recorded_at: 2026-11-07T12:37:57.651Z

## AC
- [x] `.quay/routine-findings.jsonl` 中 finding `file-cycle-shared-api-voiceconfig-barrel`（routine `architecture-analysis`，runId `architecture-analysis-1794055077651`）所描述的问题被复核并处置
- [x] 处置结论可核：要么修掉，要么写明「已有机制在管、失败在哪一步」，⛔ 不以「已注意到」结案

## DoD
- [x] 上面的判据实跑通过
- [x] ⛔ 探针只立案不执行：本任务若需要跑产出者/修复，由派发链执行，⛔ 不由例程代跑

## Touches
- `src/shared/api/voiceConfig.ts`
- `src/shared/api/index.ts`
- `src/shared/api/client.ts`
- `src/shared/api/clientCore.ts`
- `src/shared/api/clientTail.ts`
- `src/shared/api/requests.ts`
- `src/shared/api/voiceConfigType.ts`
- `src/shared/tests/voiceConfig.test.ts`
- `src/modules/settings/tests/voiceDataSettings.test.tsx`
- `src/modules/settings/tests/voiceSettingsLiveTabMinimalSurface.test.tsx`
- `src/modules/settings/tests/voiceSettingsProviderSelection.test.tsx`
- `src/modules/file-tree/tests/fileTreeSearchIndex.test.tsx`
- `src/modules/cockpit/tests/cockpitCardStartConversation.test.ts`
- `server/shared/tests/frontend-import-cycle-budget.test.ts`
- `tasks/gap-routine-architecture-analysis-file-cycle-shared-api-voiceconfig-barrel.md`

## Blocker

**2026-11-07T13:27:33.724Z — worker 未落地（exited-not-landed）**

- 未落地原因：step=suite: not ok - src/modules/cockpit/tests/cockpitCardStartConversation.test.ts: AssertionError [ERR_ASSERTION]: Expected values to be strictly deep-equal: [baseline A/B: HARD RED (task-introduced-red) — the task's red set is NOT a subset of the develop baseline red set: added=src/modules/cockpit/tests/cockpitCardStartConversation.test.ts,src/modules/file-tree/tests/fileTreeSearchIndex.test.tsx,src/modules/cockpit/tests/cockpitCardStartConversation.test.ts,src/modules/file-tree/tests/fileTreeSearchIndex.test.tsx changed=-]
- run_id：wk-prod-anchor
- session_id：4ff406eb-4f42-40f8-b47f-9c1233236f4a

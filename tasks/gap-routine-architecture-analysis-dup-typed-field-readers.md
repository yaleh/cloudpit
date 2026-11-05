---
id: gap-routine-architecture-analysis-dup-typed-field-readers
title: "architecture-analysis: archguard_detect_duplicates(scope=server) groups
  7d2b457cd8c4f750 (70 tokens / 14 lines) and f6a44c5ab6a5e692 (56 tokens / 6
  lines): the same undefined/wrong"
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
archguard_detect_duplicates(scope=server) groups 7d2b457cd8c4f750 (70 tokens / 14 lines) and f6a44c5ab6a5e692 (56 tokens / 6 lines): the same undefined/wrong-type/fallback ladder is written once per field type and once per error style across two files.

载体记录（逐字来源）：`.quay/routine-findings.jsonl` · routine `architecture-analysis` · probe `architecture-analysis` · runId `architecture-analysis-1793882215773` · ts `2026-11-05T12:36:55.773Z`。

该 finding 由例程的机械通道产出，本任务由**同一条通道**依赖 `plugin/scripts/routine-file-gate.ts` 的三道闸
（quality / dedup / rate）机械立案 —— ⛔ 不是由人转抄，也不是由探针自行执行。

- 观测符号：`readBoolean`、`readString`、`optionalBooleanField`、`optionalStringField`
- 涉及文件：
- `server/shared/settings-file.ts:168`
- `server/shared/settings-file.ts:188`
- `server/modules/reply-suggestions/reply-suggestions.routes.ts:51`
- `server/modules/reply-suggestions/reply-suggestions.routes.ts:78`
- kind：`duplication`
- verdict：`confirmed`

## Requested action
Add one generic readField<T>(record, key, fallback, typeName, guard, onProblem) in server/shared/settings-file.ts and route reply-suggestions optional*Field through it; AC: both groups are gone from archguard_detect_duplicates(scope=server) and server/shared/tests/settings-file.test.ts plus server/modules/reply-suggestions/tests/reply-suggestions-routes.test.ts stay green.

## Effect Prediction
- metric: concept_recurs_after_merge
- expected: false
- statement: 修复后 `<none>` 不再以同一 subject 复发（同 concept_key 的后续记录数应为 0）
- recorded_at: 2026-11-05T12:36:55.773Z

## Verification
- 修复（commit `14b1385d4`）：`server/shared/settings-file.ts` 新增 `readField<T>(record, key, fallback, typeName, guard, onProblem)` 与共享谓词 `isBooleanValue` / `isStringValue`；`readBoolean` / `readString` 以及 `reply-suggestions.routes.ts` 的 `optionalBooleanField` / `optionalStringField` 各退化为一次 `readField` 调用。措辞仍由调用方拥有：settings 侧把问题追加进 `problems`，routes 侧抛 400 `INVALID_REQUEST`（对外的 message 逐字未变）。
- 复测使用与 `archguard_detect_duplicates` 相同的检测器（`@yalehwang/archguard/dist/analysis/duplicates/group.js`，默认 floor minStatements=6 / minTokens=50，scope=server）：
  - develop 基线：`totalGroups=3`，`groupsTouchingOurFiles` 命中 `7d2b457cd8c4f750`（70 tokens / 14 lines / 2 members）与 `f6a44c5ab6a5e692`（56 tokens / 6 lines / 2 members）。
  - 本工作树：`totalGroups=1`，`targetGroupsPresent=[]`，`groupsTouchingOurFiles=[]` —— 两个组都已消失，且这两份文件没有落入新组。
- 判据实跑：`server/shared/tests/settings-file.test.ts` 15/15 pass（含新增的直接用例 `readField is the one fallback ladder: absent, wrong type, accepted`）；`server/modules/reply-suggestions/tests/reply-suggestions-routes.test.ts` 15/15 pass；`tsc --noEmit -p server/tsconfig.json` exit 0。
- L_D implementation diff (code only, tasks/*.md excluded): docLines=0 codeLines=94 ratio=0 → PASS
- collateral（2026-11-05 续做轮）：develop 的 `39966e6c7` 给 `server/modules/cockpit/cockpit-card-actions.ts` 增加 4 行注释（797→801），越过 800 行 ratchet 且该文件不在 committed baseline ⇒ develop 自身 suite 红（本工作树复现同一读数 `oversizeFiles … 基线外→801`）。本轮把该 4 行 source 词表注释压成 2 行（纯注释，`source: option?.source ?? 'provider'` 未动）→ 799 行；`bash scripts/with-memory-cap.sh npx tsx --tsconfig server/tsconfig.json --test server/shared/tests/architecture-ratchet.test.ts` → 6/6 pass。

## AC
- [x] `.quay/routine-findings.jsonl` 中 finding `dup-typed-field-readers`（routine `architecture-analysis`，runId `architecture-analysis-1793882215773`）所描述的问题被复核并处置
- [x] 处置结论可核：要么修掉，要么写明「已有机制在管、失败在哪一步」，⛔ 不以「已注意到」结案

## DoD
- [x] 上面的判据实跑通过
- [x] ⛔ 探针只立案不执行：本任务若需要跑产出者/修复，由派发链执行，⛔ 不由例程代跑

## Touches
- `server/shared/settings-file.ts`
- `server/modules/reply-suggestions/reply-suggestions.routes.ts`
- `server/shared/tests/settings-file.test.ts`
- `tasks/gap-routine-architecture-analysis-dup-typed-field-readers.md`
- `server/modules/cockpit/cockpit-card-actions.ts` (collateral: condense develop 39966e6c7's 4-line source-vocabulary comment to 2 lines, restoring the 800-line ratchet; comment-only, no behaviour change)

## Blocker

**2026-11-05T13:01:13.006Z — worker 未落地（exited-not-landed）**

- 未落地原因：step=suite: not ok - server/shared/tests/architecture-ratchet.test.ts:   AssertionError [ERR_ASSERTION]: ratchet: oversizeFiles server/modules/cockpit/cockpit-card-actions.ts 基线外→801 — 基线外的文件不得超过 800 行 [baseline A/B: HARD RED (changed-assertion) — the task's red set is NOT a subset of the develop baseline red set: added=- changed=server/shared/tests/architecture-ratchet.test.ts]
- run_id：wk-prod-anchor
- session_id：4c9fa465-bdeb-42bc-b4b6-77015be60a6b
- 续做轮处置：上面的 suite 红已在本分支消除（见 Verification 的 collateral 条目，读数 799 ≤ 800，ratchet 6/6 pass）。
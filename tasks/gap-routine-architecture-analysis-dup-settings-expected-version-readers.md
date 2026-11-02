---
id: gap-routine-architecture-analysis-dup-settings-expected-version-readers
title: "architecture-analysis: Fresh archguard duplicate group 1be6c2743c82f132
  (scope server): readExpectedVersion (lines 27-46) and
  readCockpitSessionStartVersion (lines 315-334) are byt"
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
Fresh archguard duplicate group 1be6c2743c82f132 (scope server): readExpectedVersion (lines 27-46) and readCockpitSessionStartVersion (lines 315-334) are byte-identical 20-line / 138-token bodies — same INVALID_VERSION / VERSION_REQUIRED AppErrors and same body-or-If-Match fallback — so the save-precondition contract is implemented twice in one feature module.

载体记录（逐字来源）：`.quay/routine-findings.jsonl` · routine `architecture-analysis` · probe `architecture-analysis` · runId `architecture-analysis-1793622946064` · ts `2026-11-02T12:35:46.064Z`。

该 finding 由例程的机械通道产出，本任务由**同一条通道**依赖 `plugin/scripts/routine-file-gate.ts` 的三道闸
（quality / dedup / rate）机械立案 —— ⛔ 不是由人转抄，也不是由探针自行执行。

- 观测符号：`readExpectedVersion`、`readCockpitSessionStartVersion`
- 涉及文件：
- `server/modules/settings/codex-model-providers.service.ts:27`
- `server/modules/settings/settings.service.ts:315`
- kind：`duplication`
- verdict：`confirmed`

## Requested action
Extract one readExpectedVersion(body, headerVersion) into server/shared/settings-file.ts and import it from both services; AC: archguard_detect_duplicates(scope=server) no longer reports hash 1be6c2743c82f132 and the existing settings version-conflict tests keep both error codes covered.

## Effect Prediction
- metric: concept_recurs_after_merge
- expected: false
- statement: 修复后 `<none>` 不再以同一 subject 复发（同 concept_key 的后续记录数应为 0）
- recorded_at: 2026-11-02T12:35:46.064Z

## AC
- [ ] `.quay/routine-findings.jsonl` 中 finding `dup-settings-expected-version-readers`（routine `architecture-analysis`，runId `architecture-analysis-1793622946064`）所描述的问题被复核并处置
- [ ] 处置结论可核：要么修掉，要么写明「已有机制在管、失败在哪一步」，⛔ 不以「已注意到」结案

## DoD
- [ ] 上面的判据实跑通过
- [ ] ⛔ 探针只立案不执行：本任务若需要跑产出者/修复，由派发链执行，⛔ 不由例程代跑

## Touches
- `server/modules/settings/codex-model-providers.service.ts`
- `server/modules/settings/settings.service.ts`
- `tasks/gap-routine-architecture-analysis-dup-settings-expected-version-readers.md`
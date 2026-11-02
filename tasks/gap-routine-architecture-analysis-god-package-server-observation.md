---
id: gap-routine-architecture-analysis-god-package-server-observation
title: "architecture-analysis: Fresh archguard reading (2026-11-02, scope server
  bcc56acf) flags modules/observation on all four god-package thresholds — fanIn
  18, fanOut 195 relations, 24"
status: todo
labels:
  - gap
  - routine-filed
  - architecture-analysis
parent: null
children: []
extra: {}
---
## Finding
Fresh archguard reading (2026-11-02, scope server bcc56acf) flags modules/observation on all four god-package thresholds — fanIn 18, fanOut 195 relations, 24 files, 64 entities — and its barrel exports four unrelated pipelines: observation wall/store + view events, session digest (producer/LLM/settings), session-ask ledger/decision/recovery/retraction, and architecture/project-truth producers.

载体记录（逐字来源）：`.quay/routine-findings.jsonl` · routine `architecture-analysis` · probe `architecture-analysis` · runId `architecture-analysis-1793622946064` · ts `2026-11-02T12:35:46.064Z`。

该 finding 由例程的机械通道产出，本任务由**同一条通道**依赖 `plugin/scripts/routine-file-gate.ts` 的三道闸
（quality / dedup / rate）机械立案 —— ⛔ 不是由人转抄，也不是由探针自行执行。

- 观测符号：`createObservationModule`、`createObservationStore`、`createSessionDigestProducer`、`readSessionAskEventLedger`、`createViewEventService`
- 涉及文件：
- `server/modules/observation/observation.module.ts:1`
- `server/modules/observation/observation-store.ts:1`
- `server/modules/observation/session-digest.ts:1`
- `server/modules/observation/session-ask-ledger.ts:1`
- `server/modules/observation/architecture-delta.ts:1`
- kind：`god-package`
- verdict：`confirmed`

## Requested action
Split into observation (store/routes/wall), session-digest, session-ask and producers, with the existing barrel re-exporting the same names; AC: archguard_detect_god_packages reports each new package below minFiles 20 / minEntities 50, modules/observation stays a leaf in AC-394's directory manifest (no new cycle), and the observation + session-digest tests stay green.

## Effect Prediction
- metric: concept_recurs_after_merge
- expected: false
- statement: 修复后 `<none>` 不再以同一 subject 复发（同 concept_key 的后续记录数应为 0）
- recorded_at: 2026-11-02T12:35:46.064Z

## AC
- [ ] `.quay/routine-findings.jsonl` 中 finding `god-package-server-observation`（routine `architecture-analysis`，runId `architecture-analysis-1793622946064`）所描述的问题被复核并处置
- [ ] 处置结论可核：要么修掉，要么写明「已有机制在管、失败在哪一步」，⛔ 不以「已注意到」结案

## DoD
- [ ] 上面的判据实跑通过
- [ ] ⛔ 探针只立案不执行：本任务若需要跑产出者/修复，由派发链执行，⛔ 不由例程代跑

## Touches
- `server/modules/observation/observation.module.ts`
- `server/modules/observation/observation-store.ts`
- `server/modules/observation/session-digest.ts`
- `server/modules/observation/session-ask-ledger.ts`
- `server/modules/observation/architecture-delta.ts`
- `tasks/gap-routine-architecture-analysis-god-package-server-observation.md`
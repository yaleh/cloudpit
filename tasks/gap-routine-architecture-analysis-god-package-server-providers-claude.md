---
id: gap-routine-architecture-analysis-god-package-server-providers-claude
title: "architecture-analysis: archguard god-package:
  modules/providers/list/claude = 19 files / 73 entities, fanIn 6, fanOut 432;
  ClaudeResidentHostDriver alone has 86 methods, fanIn 130 "
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
archguard god-package: modules/providers/list/claude = 19 files / 73 entities, fanIn 6, fanOut 432; ClaudeResidentHostDriver alone has 86 methods, fanIn 130 and outDegree 192, and claude-host-driver.provider.ts is 5896 lines.

载体记录（逐字来源）：`.quay/routine-findings.jsonl` · routine `architecture-analysis` · probe `architecture-analysis` · runId `architecture-analysis-1793709366225` · ts `2026-11-03T12:36:06.225Z`。

该 finding 由例程的机械通道产出，本任务由**同一条通道**依赖 `plugin/scripts/routine-file-gate.ts` 的三道闸
（quality / dedup / rate）机械立案 —— ⛔ 不是由人转抄，也不是由探针自行执行。

- 观测符号：`ClaudeResidentHostDriver`、`ClaudePerRunHostDriver`、`ClaudeSessionSynchronizer`
- 涉及文件：
- `server/modules/providers/list/claude/claude-host-driver.provider.ts:2983`
- `server/modules/providers/list/claude/claude-runtime.provider.ts:1`
- `server/modules/providers/list/claude/claude-sessions.provider.ts:1`
- kind：`god-package`
- verdict：`confirmed`

## Requested action
Extract the driver's turn/lifecycle collaborator entities into a lifecycle/ subdirectory; AC: archguard_detect_god_packages(scope=server) reports fileCount<=24 and entityCount<=50 for this package (fanOut recorded as residual, not claimed reducible), claude-host-driver.provider.ts<=2500 lines, G1 cycle pin unchanged-or-shrunk, and the new directory recorded in cloudpit-goal-exit-gate pin+JSON and AC-394 MANIFEST_PIN+baseline in the same commit.

## Effect Prediction
- metric: concept_recurs_after_merge
- expected: false
- statement: 修复后 `<none>` 不再以同一 subject 复发（同 concept_key 的后续记录数应为 0）
- recorded_at: 2026-11-03T12:36:06.225Z

## AC
- [ ] `.quay/routine-findings.jsonl` 中 finding `god-package-server-providers-claude`（routine `architecture-analysis`，runId `architecture-analysis-1793709366225`）所描述的问题被复核并处置
- [ ] 处置结论可核：要么修掉，要么写明「已有机制在管、失败在哪一步」，⛔ 不以「已注意到」结案

## DoD
- [ ] 上面的判据实跑通过
- [ ] ⛔ 探针只立案不执行：本任务若需要跑产出者/修复，由派发链执行，⛔ 不由例程代跑

## Touches
- `server/modules/providers/list/claude/claude-host-driver.provider.ts`
- `server/modules/providers/list/claude/claude-runtime.provider.ts`
- `server/modules/providers/list/claude/claude-sessions.provider.ts`
- `tasks/gap-routine-architecture-analysis-god-package-server-providers-claude.md`
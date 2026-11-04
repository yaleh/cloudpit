---
id: gap-routine-architecture-analysis-god-package-server-mcp-gateway
title: "architecture-analysis: archguard scope server flags modules/mcp-gateway
  on all four thresholds: 49 files / 137 entities (fresh CLI package-stats) with
  fanIn 32 / fanOut 393 and 17,"
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
archguard scope server flags modules/mcp-gateway on all four thresholds: 49 files / 137 entities (fresh CLI package-stats) with fanIn 32 / fanOut 393 and 17,764 LOC; the earlier mcp-tools-read/write extraction was superseded and reverted, so this remains the largest server package.

载体记录（逐字来源）：`.quay/routine-findings.jsonl` · routine `architecture-analysis` · probe `architecture-analysis` · runId `architecture-analysis-1793795809080` · ts `2026-11-04T12:36:49.080Z`。

该 finding 由例程的机械通道产出，本任务由**同一条通道**依赖 `plugin/scripts/routine-file-gate.ts` 的三道闸
（quality / dedup / rate）机械立案 —— ⛔ 不是由人转抄，也不是由探针自行执行。

- 观测符号：`registerMcpReadTools`、`registerMcpWriteTools`
- 涉及文件：
- `server/modules/mcp-gateway/index.ts:1`
- `server/modules/mcp-gateway/mcp-changes.ts:1`
- `server/modules/mcp-gateway/mcp-read-tools-registry.ts:140`
- `server/modules/mcp-gateway/mcp-gateway.write-tools.ts:375`
- kind：`god-package`
- verdict：`confirmed`

## Requested action
Implement docs/proposals/mcp-gateway-tool-architecture.md (mcp-contract leaf + domain tool packages + ToolRegistry) or group tool families into tools/ subdirs behind the existing seam; AC: fileCount<=30, entityCount<=80, register* outDegree<=20 each, new dirs recorded in the AC-455 pin+JSON and AC-394 MANIFEST_PIN+baseline, G1 unchanged, MCP gateway tests green.

## Effect Prediction
- metric: concept_recurs_after_merge
- expected: false
- statement: 修复后 `<none>` 不再以同一 subject 复发（同 concept_key 的后续记录数应为 0）
- recorded_at: 2026-11-04T12:36:49.080Z

## AC
- [ ] `.quay/routine-findings.jsonl` 中 finding `god-package-server-mcp-gateway`（routine `architecture-analysis`，runId `architecture-analysis-1793795809080`）所描述的问题被复核并处置
- [ ] 处置结论可核：要么修掉，要么写明「已有机制在管、失败在哪一步」，⛔ 不以「已注意到」结案

## DoD
- [ ] 上面的判据实跑通过
- [ ] ⛔ 探针只立案不执行：本任务若需要跑产出者/修复，由派发链执行，⛔ 不由例程代跑

## Touches
- `server/modules/mcp-gateway/index.ts`
- `server/modules/mcp-gateway/mcp-changes.ts`
- `server/modules/mcp-gateway/mcp-read-tools-registry.ts`
- `server/modules/mcp-gateway/mcp-gateway.write-tools.ts`
- `tasks/gap-routine-architecture-analysis-god-package-server-mcp-gateway.md`
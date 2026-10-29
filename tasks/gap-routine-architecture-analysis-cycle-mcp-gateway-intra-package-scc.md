---
id: gap-routine-architecture-analysis-cycle-mcp-gateway-intra-package-scc
title: "architecture-analysis: A 23-file SCC carrying 30 runtime (value) import
  edges of 83 inside one package - read-tools registers run-get/ui tools that
  import formatMcpTime and constan"
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
A 23-file SCC carrying 30 runtime (value) import edges of 83 inside one package - read-tools registers run-get/ui tools that import formatMcpTime and constants back out of read-tools - and AC-394's ratchet only counts cross-directory edges, so no committed pin sees it (package fan-in 32 / fan-out 354, 42 files, 132 entities).

载体记录（逐字来源）：`.quay/routine-findings.jsonl` · routine `architecture-analysis` · probe `architecture-analysis` · runId `architecture-analysis-1793294690736` · ts `2026-10-29T17:24:50.736Z`。

该 finding 由例程的机械通道产出，本任务由**同一条通道**依赖 `plugin/scripts/routine-file-gate.ts` 的三道闸
（quality / dedup / rate）机械立案 —— ⛔ 不是由人转抄，也不是由探针自行执行。

- 观测符号：`formatMcpTime`、`MCP_TOOL_NOT_IMPLEMENTED_CODE`、`MCP_RUN_GET_MAX_WAIT_SECONDS`、`registerMcpRunGetTool`、`registerMcpUiTools`
- 涉及文件：
- `server/modules/mcp-gateway/mcp-gateway.read-tools.ts:78`
- `server/modules/mcp-gateway/mcp-run-get.ts:74`
- `server/modules/mcp-gateway/mcp-session-send.ts:75`
- `server/modules/mcp-gateway/mcp-gateway.write-tools.ts:62`
- `server/modules/mcp-gateway/mcp-ui-navigation.ts:36`
- kind：`cycle`
- verdict：`confirmed`

## Requested action
Move the shared vocabulary (formatMcpTime, MCP_TOOL_NOT_IMPLEMENTED_CODE, run-get limits, schema constants) into a leaf under shared/mcp-contract and have the tool modules depend downward, per docs/proposals/mcp-gateway-tool-architecture.md stage 2; AC: a file-level SCC scan of server/modules/mcp-gateway reports no component larger than 1 file.

## Effect Prediction
- metric: concept_recurs_after_merge
- expected: false
- statement: 修复后 `<none>` 不再以同一 subject 复发（同 concept_key 的后续记录数应为 0）
- recorded_at: 2026-10-29T17:24:50.736Z

## AC
- [ ] `.quay/routine-findings.jsonl` 中 finding `cycle-mcp-gateway-intra-package-scc`（routine `architecture-analysis`，runId `architecture-analysis-1793294690736`）所描述的问题被复核并处置
- [ ] 处置结论可核：要么修掉，要么写明「已有机制在管、失败在哪一步」，⛔ 不以「已注意到」结案

## DoD
- [ ] 上面的判据实跑通过
- [ ] ⛔ 探针只立案不执行：本任务若需要跑产出者/修复，由派发链执行，⛔ 不由例程代跑

## Touches
- `server/modules/mcp-gateway/mcp-gateway.read-tools.ts`
- `server/modules/mcp-gateway/mcp-run-get.ts`
- `server/modules/mcp-gateway/mcp-session-send.ts`
- `server/modules/mcp-gateway/mcp-gateway.write-tools.ts`
- `server/modules/mcp-gateway/mcp-ui-navigation.ts`
- `tasks/gap-routine-architecture-analysis-cycle-mcp-gateway-intra-package-scc.md`
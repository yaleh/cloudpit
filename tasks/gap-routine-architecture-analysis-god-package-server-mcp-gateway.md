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

## Evidence
- 复核（拆分前，fresh CLI，develop tip f9566d20a）：`node /data/home/yale/work/archguard/dist/cli/index.js analyze -s server --lang typescript --work-dir /tmp/ag-mcp-before --no-cache -f json`，再以 MCP `archguard_detect_god_packages`（thresholds 1）读同一 scope → `modules/mcp-gateway`：**fanIn=32, fanOut=393, fileCount=49, entityCount=137**，reasons=[highFanIn, highFanOut, tooManyFiles, tooManyEntities]；`registerMcpReadTools` outDegree=18，`registerMcpWriteTools` outDegree=**22**（>20）。
- 处置：按 proposal 的「工具族下沉到 tools/ 子包、root 只留 host/registrar」执行，而不是恢复已被撤销的 mcp-tools-read/write read/write 切法。34 个实现/helper 文件移入六个子包 `tools/{read,sessions,ui,shared,approvals,cockpit}`；root 只保留 transport/auth 之外的 audit/gate/oauth-metadata/registrars/resolve-self-target/annotations/error-codes/write-notification，`index.ts` barrel 原样再导出（对消费者无感）。
- 拆分后（同一 analyze + 同一 detect_god_packages）：
  - `modules/mcp-gateway`：**fileCount=15, entityCount=25, fanIn=20, fanOut=227**（AC：files<=30 ✓、entities<=80 ✓；fanIn/fanOut 是跨包 relation 计数，见 Residual）
  - 六个新包：`tools/read` 10/39、`tools/sessions` 9/34、`tools/ui` 6/23、`tools/shared` 8/7、`tools/approvals` 1/4、`tools/cockpit` 1/6（每个包 files<=30、entities<=80）
  - `registerMcpReadTools` outDegree=**18**（不变），`registerMcpWriteTools` outDegree=**15**（四个 `ui_*` navigation 工具收进一个 `registerMcpUiNavigationTools` 聚合；AC：<=20 each ✓）
- 新目录登记（同一提交）：AC-394 `server-import-cycle-budget.test.ts` 的 `MANIFEST_PIN` + 其 `.baseline.json`（nodeCount 65→71，FIFTEENTH RECORDED CHANGE）；AC-455 `cloudpit-goal-exit-gate.test.ts` 的 `GATE_DIRECTORY_PIN` + 其 `.baseline.json`（FOURTH RECORDED CHANGE）。
- 结构判据实跑：`server-import-cycle-budget.test.ts` + `cloudpit-goal-exit-gate.test.ts` + `architecture-ratchet.test.ts` → **21 pass / 0 fail**，读数：`[ac394] nodes=71`、G1 仍为 3 成员（`modules/providers`、`modules/providers/list/claude`、`modules/providers/services`），G2/G3 空、无新目录 SCC；`[ac455] directory arm: measured=71 frozen=71 extra=[] missing=[]`；architecture-ratchet 的三个维度按新路径重键（mcp-changes 1375、mcp-gateway.read-tools 1766、mcp-session-search 826；mutable-state/provider-branch 计数不变，读数字节未上调）。
- 测试实跑：mcp-gateway 全部 57 个测试文件（含 `oauth-flow.e2e.test.ts`）→ **358 pass / 0 fail**（e2e 1 pass）；9 个跨模块消费者测试（oauth ×3、providers ×2、websocket、debug-agent、cloudpit-runtime-flip、server-composition-startup）→ **62 pass / 0 fail**；architecture 7 个测试文件 → **101 pass / 0 fail**。
- 静态门：`npm run typecheck`（tsconfig + server/tsconfig + scripts/tsconfig）→ 0 error；`npx oxlint server/modules/mcp-gateway server/shared/tests server/modules/architecture` → exit 0（仅既有 import-order warning）。
- Residual（如实记录，不假绿）：root 包的 fanIn=20 / fanOut=227 仍高于 detect_god_packages 的默认耦合阈值（5/20）——这是跨包 **relation 计数**（拆分把原本包内关系变成跨包关系），不是规模维度；本任务 Requested action 只把 fileCount/entityCount/outDegree 写成 AC，三项均已达标。新 `tools/read` 自身的 fanIn=60/fanOut=211 同理由，其规模读数为 10 files / 39 entities。
- 导出面对拍：所有 MCP gateway 测试与 9 个消费者测试都经 `@/modules/mcp-gateway/index.js` 导入并通过，证明 barrel 再导出完整；`mcp-english-only` 与 `mcp-gateway-wiring` 两个源扫描判据改为递归扫描 `tools/**`（非递归会静默漏扫 34 个文件）。
- L_D archguard: mcpGatewayFileCount=15 (develop 49), mcpGatewayEntityCount=25 (develop 137), mcpGatewayFanOut=227 (develop 393)
- L_G archguard: directoryCycleGroups=3 (pinned G1=3,G2=0,G3=0), newCycleGroups=0, newNodeCount=71 (develop 65)

## AC
- [x] `.quay/routine-findings.jsonl` 中 finding `god-package-server-mcp-gateway`（routine `architecture-analysis`，runId `architecture-analysis-1793795809080`）所描述的问题被复核并处置
- [x] 处置结论可核：要么修掉，要么写明「已有机制在管、失败在哪一步」，⛔ 不以「已注意到」结案

## DoD
- [x] 上面的判据实跑通过
- [x] ⛔ 探针只立案不执行：本任务若需要跑产出者/修复，由派发链执行，⛔ 不由例程代跑

## Touches
- `server/modules/mcp-gateway/**`
- `server/modules/architecture/index.ts`
- `server/modules/architecture/service.ts`
- `server/shared/mcp-contract/approvals.ts`
- `server/shared/mcp-contract/principal.ts`
- `server/shared/mcp-contract/types.ts`
- `server/shared/tests/server-import-cycle-budget.test.ts`
- `server/shared/tests/server-import-cycle-budget.baseline.json`
- `server/shared/tests/cloudpit-goal-exit-gate.test.ts`
- `server/shared/tests/cloudpit-goal-exit-gate.baseline.json`
- `server/shared/tests/architecture-ratchet.baseline.json`
- `tasks/gap-routine-architecture-analysis-god-package-server-mcp-gateway.md`

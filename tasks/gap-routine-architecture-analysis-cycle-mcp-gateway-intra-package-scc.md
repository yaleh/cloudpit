---
id: gap-routine-architecture-analysis-cycle-mcp-gateway-intra-package-scc
title: "architecture-analysis: A 23-file SCC carrying 30 runtime (value) import
  edges of 83 inside one package - read-tools registers run-get/ui tools that
  import formatMcpTime and constan"
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
- [x] `.quay/routine-findings.jsonl` 中 finding `cycle-mcp-gateway-intra-package-scc`（routine `architecture-analysis`，runId `architecture-analysis-1793294690736`）所描述的问题被复核并处置
- [x] 处置结论可核：要么修掉，要么写明「已有机制在管、失败在哪一步」，⛔ 不以「已注意到」结案

## DoD
- [x] 上面的判据实跑通过
- [x] ⛔ 探针只立案不执行：本任务若需要跑产出者/修复，由派发链执行，⛔ 不由例程代跑

## Evidence

**复核（立案时的读数在真实树上复现）。** 用与 AC-394 同一套 TypeScript 语法树扫描器的文件级版本（`server/shared/import-graph.ts` 的 `scanFileImportGraph`）对 `server/modules/mcp-gateway` 非测试源码求文件级 Tarjan：

- 修复前：`files=42 nonTrivialSccCount=1`，唯一非平凡分量 **23 个文件**，成员与 finding 列出的完全一致（`mcp-gateway.read-tools.ts` 与 `mcp-run-get.ts` / `mcp-ui-tools.ts` / `mcp-changes.ts` / `mcp-session-search.ts` / `mcp-ui-visible-context.ts` / `mcp-ui-clients-list.ts` 等互为入边；write 半边是 `mcp-gateway.write-tools.ts` ↔ `mcp-draft.ts` / `mcp-ui-navigation.ts` / 四个 `mcp-ui-*-` 工具，全由 `import type` 成环）。
- 根因两处：(1) 共享词汇（`formatMcpTime` / `readTimeField` / `MCP_TOOL_NOT_IMPLEMENTED_CODE` / run-get 与 session-search 限额）住在 **registrar** `mcp-gateway.read-tools.ts` 里，工具实现要读它就得回头 import registrar；(2) registrar 同时 import 每个实现 → 聚合边反向。AC-394 的棘轮是**目录级**的，这条环整个落在一个目录内，任何已提交的 pin 都看不见它 —— finding 的这一半属实。

**处置（修掉，按 proposal stage 2）。**

- 词汇下沉到叶子：`server/shared/mcp-contract/time.ts`（`formatMcpTime` / `readTimeField` / `McpTime`）、`server/shared/mcp-contract/tool-vocabulary.ts`（`MCP_TOOL_NOT_IMPLEMENTED_CODE`、`MCP_RUN_GET_MAX_WAIT_SECONDS`、session-search 默认/上限），并从 `server/shared/mcp-contract/index.ts` 导出。
- 包内新增四个叶子：`mcp-read-contract.ts`（读侧 deps/seam/reading 类型 + `McpReadToolDepsBase`）、`mcp-write-contract.ts`（写侧 registration/seam）、`mcp-client-name.ts`（`resolveClientName` 及标签常量）、`mcp-tool-schemas.ts`（`overviewOutputSchema`）。
- 聚合边反转：`registerMcpReadTools` 与完整 `McpReadToolDeps` 搬到**包内最上层**的 `mcp-read-tools-registry.ts`；它 import 表与各实现，而实现不再 import 它。`index.ts` / `mcp-gateway.transport.ts`（包外消费者）改从 hub 取。
- 各 feature 的 `isXWired` 闸改为对「它真正探测的 deps 包」的泛型谓词（`<D extends object>`），实现模块因此不必知道整包 deps 的形状。
- `mcp-ui-navigation.ts` 不再经 `mcp-write-notification.ts` 取 `resolveClientName`，改直连 `mcp-client-name.ts`（切断 notification → annotations → 写工具的第三处回边）。
- 8 个工具模块的 `McpToolInputSchema` 改从 `@/shared/mcp-contract` 取，不再经 `mcp-gateway.audit.ts`。

**处置后读数（同一扫描器，同一口径）。** `files=47 intraPackageEdges=177 sccs=[]` —— 非平凡分量 **0**，最大分量成员数 1。

**已提交的 pin（finding 缺的那一半）。** `server/shared/import-graph.ts` 新增 `scanFileImportGraph`（与目录级扫描器共用 `resolveSpecifier` / `strongComponents`，不复制机制）；`server/shared/tests/server-import-cycle-budget.test.ts` 新增 case `(j)`：先以合成夹具证明扫描器**有判别力**（`a.ts` ↔ `b.ts` 报出 `[['pkg/a.ts','pkg/b.ts']]`，单向 import 不报），再断言 `server/modules/mcp-gateway` 的 `nonTrivialSccs` 为空，并设 ≥10 条包内边的防空转下限（实测 177）。

**实跑记录（全部在本 worktree）。**

- `bash scripts/with-memory-cap.sh npx tsx --tsconfig server/tsconfig.json --import ./scripts/undici-blocked-ports-preload.mjs --test server/shared/tests/server-import-cycle-budget.test.ts` → tests 12 / pass 12 / fail 0，含 `[file-scc] files=47 intraPackageEdges=177 sccs=[]`。
- `… --test --test-concurrency=6 server/modules/mcp-gateway/tests/*.test.ts`（53 个文件）→ tests 323 / pass 323 / fail 0，exit 0。过程中唯一红的是 `mcp-english-only.test.ts (d)`：`resolveClientName` 的两个中文产品标签随实现搬进 `mcp-client-name.ts`，扫描器的排除名单原按文件名只排除 `mcp-write-notification.ts`；改为 `EXCLUDED_SOURCES` 同时排除该叶子（同一理由、同一字段集），复跑 10/10 绿。
- `node_modules/.bin/tsc --noEmit -p server/tsconfig.json` → exit 0；`node_modules/.bin/tsc --noEmit -p tsconfig.json` → exit 0；`node_modules/.bin/oxlint server/modules/mcp-gateway/ server/shared/mcp-contract/` → exit 0（仅既有 warning）。
- `… --test server/shared/tests/architecture-ratchet.test.ts` → 6/6 绿。首跑红过一次 `oversizeFiles mcp-session-search.ts 826→827`（改 import 块净 +1 行），把该 import 收成一行后 823 行，复跑绿 —— 棘轮只许下降，没有上调基线。
- 预合并：`git merge --no-edit develop` fast-forward 到 `fa4cac69d`，无冲突。

## ADR-007

- L_D: files=47 intra-package-file-edges=177 file-scc-max-files=1（case (j) 的实测读数；修复前同口径为单个 23 文件分量）
- L_G 该轴仍暗，理由：本任务不改 goal 判据的产生与达成，只收敛 `server/modules/mcp-gateway` 的文件级依赖图，goal 面没有本轮可记的量化读数。

## Touches
- `server/modules/mcp-gateway/index.ts`
- `server/modules/mcp-gateway/mcp-changes.ts`
- `server/modules/mcp-gateway/mcp-client-name.ts`
- `server/modules/mcp-gateway/mcp-draft.ts`
- `server/modules/mcp-gateway/mcp-gateway.read-tools.ts`
- `server/modules/mcp-gateway/mcp-gateway.transport.ts`
- `server/modules/mcp-gateway/mcp-gateway.write-tools.ts`
- `server/modules/mcp-gateway/mcp-overview-tools.ts`
- `server/modules/mcp-gateway/mcp-read-contract.ts`
- `server/modules/mcp-gateway/mcp-read-tools-registry.ts`
- `server/modules/mcp-gateway/mcp-run-get.ts`
- `server/modules/mcp-gateway/mcp-session-search.ts`
- `server/modules/mcp-gateway/mcp-session-send.ts`
- `server/modules/mcp-gateway/mcp-tool-schemas.ts`
- `server/modules/mcp-gateway/mcp-ui-clients-list.ts`
- `server/modules/mcp-gateway/mcp-ui-focus-turn.ts`
- `server/modules/mcp-gateway/mcp-ui-navigation.ts`
- `server/modules/mcp-gateway/mcp-ui-open-session.ts`
- `server/modules/mcp-gateway/mcp-ui-open-task.ts`
- `server/modules/mcp-gateway/mcp-ui-show-diff.ts`
- `server/modules/mcp-gateway/mcp-ui-tools.ts`
- `server/modules/mcp-gateway/mcp-ui-visible-context.ts`
- `server/modules/mcp-gateway/mcp-write-contract.ts`
- `server/modules/mcp-gateway/mcp-write-notification.ts`
- `server/modules/mcp-gateway/tests/mcp-english-only.test.ts`
- `server/shared/import-graph.ts`
- `server/shared/mcp-contract/index.ts`
- `server/shared/mcp-contract/time.ts`
- `server/shared/mcp-contract/tool-vocabulary.ts`
- `server/shared/tests/server-import-cycle-budget.test.ts`
- `tasks/gap-routine-architecture-analysis-cycle-mcp-gateway-intra-package-scc.md`

---
id: gap-routine-architecture-analysis-god-package-server-codex
title: "architecture-analysis: archguard 0.1.45 fresh run 2026-11-06 (scope
  server, defaults minFiles 20 / minEntities 50): modules/providers/list/codex =
  32 source files / 10,337 LOC / 73"
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
archguard 0.1.45 fresh run 2026-11-06 (scope server, defaults minFiles 20 / minEntities 50): modules/providers/list/codex = 32 source files / 10,337 LOC / 73 entities, fanOut 346 (maximum in the server scope); codex-sessions.provider.ts alone is 2,333 lines and codex-app-server.connection.ts 22 KB.

载体记录（逐字来源）：`.quay/routine-findings.jsonl` · routine `architecture-analysis` · probe `architecture-analysis` · runId `architecture-analysis-1793968645263` · ts `2026-11-06T12:37:25.263Z`。

该 finding 由例程的机械通道产出，本任务由**同一条通道**依赖 `plugin/scripts/routine-file-gate.ts` 的三道闸
（quality / dedup / rate）机械立案 —— ⛔ 不是由人转抄，也不是由探针自行执行。

- 观测符号：`CodexSessionsProvider`、`CodexHostDriver`、`CodexAppServerConnection`、`collectModelPages`
- 涉及文件：
- `server/modules/providers/list/codex/codex-sessions.provider.ts:1829`
- `server/modules/providers/list/codex/codex-host-driver.provider.ts:89`
- `server/modules/providers/list/codex/codex-app-server.connection.ts:133`
- kind：`god-package`
- verdict：`confirmed`

## Requested action
Split into codex/sessions, codex/host and codex/app-server subpackages behind barrels, registering each new directory in server-import-cycle-budget.baseline.json and the cloudpit-goal-exit-gate GATE_DIRECTORY_PIN in the same change; AC: archguard_detect_god_packages(scope=server) no longer lists modules/providers/list/codex for tooManyFiles/tooManyEntities, no new directory SCC appears, typecheck exit 0.

## Disposition

复核与处置均已完成（2026-11-06）。测量用同一件仪器（archguard 0.1.45，`--lang typescript --no-cache`，package stats + `archguard_detect_god_packages` 默认阈值 minFiles 20 / minEntities 50）在 develop 与本分支上各取一次读数：

- 修前 — `modules/providers/list/codex`：files=32 entities=73 fanIn=3 fanOut=346，reasons=[highFanOut, tooManyFiles, tooManyEntities]（与 finding 逐字一致；10,337 LOC）。
- 修后 — `modules/providers/list/codex`：files=6 entities=6 fanIn=0 fanOut=54，reasons=[highFanOut]。
  三个子包：`codex/app-server` files=4 entities=9 fanIn=39 fanOut=41；`codex/host` files=13 entities=29 fanIn=1 fanOut=183；`codex/sessions` files=12 entities=29 fanIn=4 fanOut=109。

处置方式 = 按 Requested action 拆包（不是「已注意到」）：

- 26 个实现文件移入 `codex/app-server/`、`codex/host/`、`codex/sessions/`，每个子包一个 `index.ts` barrel；根目录只留 6 个 provider facet 类。依赖方向单向：root → 各子包、host → sessions、host → app-server、sessions → app-server（app-server 是 sink）。
- Requested AC 逐条实跑：`archguard_detect_god_packages(scope=server)` 不再给 `modules/providers/list/codex` 报 tooManyFiles / tooManyEntities（两条 reason 均消失）；无新增目录 SCC（AC-394 `scanImportGraph` 的 G1 仍是原三成员，static-only 与 static+literal-dynamic 读数仍逐成员一致）；`tsc --noEmit -p server/tsconfig.json` 退出 0，oxlint 退出 0。
- 同一次改动内登记新目录：`server-import-cycle-budget.baseline.json` + `MANIFEST_PIN`（nodeCount 71 → 74）与 `cloudpit-goal-exit-gate.baseline.json` + `GATE_DIRECTORY_PIN`（AC-455 recorded-change 契约）。
- 架构棘轮：4 条搬移文件的 oversize / moduleMutableState 条目按新路径 re-key（数值不变，未上调）。
- 测试：22 个被改的 provider 测试文件共 213 个用例全绿（其中 `codex-resident-background-leases.test.ts` 的一处源码路径字符串同步改到 `host/`）；`architecture-ratchet`、AC-394 `server-import-cycle-budget`、AC-455 `cloudpit-goal-exit-gate`、`composition-root-wiring` 均绿。

诚实的残留（⛔ 不声称关系阈值转绿）：关系阈值（minFanIn 5 / minFanOut 20）仍会列根包与三个子包——拆包把关系跨过新边界，本来就不能消除耦合，而 finding 的 AC 只点名 tooManyFiles / tooManyEntities。`codex-sessions.provider.ts` 仍是 2,333 行；单文件再拆是本 finding 之外的独立事项，本任务只把它的 oversize 条目 re-key 到 `codex/sessions/`，未上调。

## Effect Prediction
- metric: concept_recurs_after_merge
- expected: false
- statement: 修复后 `<none>` 不再以同一 subject 复发（同 concept_key 的后续记录数应为 0）
- recorded_at: 2026-11-06T12:37:25.263Z

## AC
- [x] `.quay/routine-findings.jsonl` 中 finding `god-package-server-codex`（routine `architecture-analysis`，runId `architecture-analysis-1793968645263`）所描述的问题被复核并处置
- [x] 处置结论可核：要么修掉，要么写明「已有机制在管、失败在哪一步」，⛔ 不以「已注意到」结案

## DoD
- [x] 上面的判据实跑通过
- [x] ⛔ 探针只立案不执行：本任务若需要跑产出者/修复，由派发链执行，⛔ 不由例程代跑

## Dark axis (ADR-007)
- L_G 该轴仍暗,理由:指定仪器 archguard-runner 的六个 scope 全为 not-evaluated（该 runner 面向 quay 自仓库），本仓结构读数改由 AC-394 的 scanImportGraph 提供，G1 仍三成员、无新增目录 SCC。

## Touches
- `server/modules/providers/list/codex/**`
- `server/modules/providers/index.ts`
- `server/modules/providers/services/session-conversations-search.service.ts`
- `server/modules/providers/tests/**`
- `server/shared/tests/architecture-ratchet.baseline.json`
- `server/shared/tests/cloudpit-goal-exit-gate.baseline.json`
- `server/shared/tests/cloudpit-goal-exit-gate.test.ts`
- `server/shared/tests/server-import-cycle-budget.baseline.json`
- `server/shared/tests/server-import-cycle-budget.test.ts`
- `tasks/gap-routine-architecture-analysis-god-package-server-codex.md`

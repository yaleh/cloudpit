---
id: gap-routine-architecture-analysis-server-cockpit-god-package
title: "architecture-analysis: archguard 2026-11-08 (scope server):
  modules/cockpit = 24 files / 53 entities, fanIn 12 / fanOut 242 — all four
  thresholds; re-confirmed from the 2026-11-06 "
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
archguard 2026-11-08 (scope server): modules/cockpit = 24 files / 53 entities, fanIn 12 / fanOut 242 — all four thresholds; re-confirmed from the 2026-11-06 finding (god-package-server-cockpit) and still has no covering task (only a leaf registration in the AC-394 budget).

载体记录（逐字来源）：`.quay/routine-findings.jsonl` · routine `architecture-analysis` · probe `architecture-analysis` · runId `architecture-analysis-1794141478281` · ts `2026-11-08T12:37:58.281Z`。

该 finding 由例程的机械通道产出，本任务由**同一条通道**依赖 `plugin/scripts/routine-file-gate.ts` 的三道闸
（quality / dedup / rate）机械立案 —— ⛔ 不是由人转抄，也不是由探针自行执行。

- 观测符号：`createCockpitBriefService`、`createCockpitCardActions`、`CockpitFleetExecutor`、`createCockpitBriefSettingsSource`
- 涉及文件：
- `server/modules/cockpit/cockpit-brief.service.ts:1`
- `server/modules/cockpit/cockpit-card-actions.ts:321`
- `server/modules/cockpit/cockpit-fleet-executor.ts:1`
- `server/modules/cockpit/cockpit-fleet-card-projection.ts:712`
- kind：`god-package`
- verdict：`confirmed`

## Requested action
Split into cockpit/{brief,cards,fleet} subpackages behind barrels (brief already is 8 files, fleet 4, cards 4); AC: fileCount<20 and entityCount<50, no new SCC, cockpit HTTP/MCP tests and typecheck green.

## Effect Prediction
- metric: concept_recurs_after_merge
- expected: false
- statement: 修复后 `<none>` 不再以同一 subject 复发（同 concept_key 的后续记录数应为 0）
- recorded_at: 2026-11-08T12:37:58.281Z

## AC
- [x] `.quay/routine-findings.jsonl` 中 finding `server-cockpit-god-package`（routine `architecture-analysis`，runId `architecture-analysis-1794141478281`）所描述的问题被复核并处置
- [x] 处置结论可核：要么修掉，要么写明「已有机制在管、失败在哪一步」，⛔ 不以「已注意到」结案

## DoD
- [x] 上面的判据实跑通过
- [x] ⛔ 探针只立案不执行：本任务若需要跑产出者/修复，由派发链执行，⛔ 不由例程代跑

## Evidence
复核与处置（由本派发链实现并实跑，探针未代跑）：

- 复核 finding 读数：用 archguard 的 TS 解析器（`/data/home/yale/work/archguard/dist/parser/typescript-parser.js`，entity = class + interface + enum + exported function，含非导出 class）在 `server/modules/cockpit` 根目录实测 **24 files / 53 entities**，与 finding 逐位一致（其中 `CockpitBriefServiceImpl` 是非导出 class，仍计入实体）。
- 修复后同口径：根包 **4 files / 7 entities**（`cockpit-hub.service.ts` 1、`cockpit.module.ts` 2、`cockpit.reducer.ts` 4、`index.ts` 0）—— fileCount<20 与 entityCount<50 两条阈值均满足。
- 子包读数：`brief/` 9 files / 21 entities（8 个搬入文件 + barrel）、`cards/` 9 / 18、`fleet/` 5 / 7。
- 无新 SCC：`server/shared/import-graph.ts` 扫描全仓，目录 SCC 仍只有 `[modules/providers, modules/providers/list/claude, modules/providers/services]`（G1；G2/G3 空），cockpit 目录内文件级 SCC 为空。目录边方向 root → {brief,cards,fleet}、cards → brief、fleet → cards，`brief` 是 sink。
- 三个新子目录按 AC-394 (c) 的逃生舱登记：`server/shared/tests/server-import-cycle-budget.test.ts` 的 `MANIFEST_PIN` 与 `server-import-cycle-budget.baseline.json` 的 `directoryManifest`/`nodeCount` 同步 74→77，并在 baseline note 追加第十七条 RECORDED CHANGE。
- 实跑门：`npx tsc --noEmit -p server/tsconfig.json` → exit 0；`server/modules/cockpit/tests/*.test.ts`（ cockpit HTTP/card/fleet/session/brief 面）→ **154 pass / 0 fail**；`server-import-cycle-budget.test.ts` → **12 pass / 0 fail**；`cloudpit-runtime-flip.test.ts` + `architecture-ratchet.test.ts` + `mcp-gateway/tests/mcp-cockpit-tools.test.ts` + `settings/tests/cockpit-session-start-settings.routes.test.ts` → **27 pass / 0 fail**。

ADR-007 轴读数：
- L_D archguard: fileCount=4 entityCount=7 (拆分前 fileCount=24 entityCount=53) — 目标包体积阈值 fileCount<20 / entityCount<50 均满足。
- L_G archguard: directoryCycleGroups=3 newCycleGroups=0 dirNodes=77 — 目录图无新 SCC，G1 仍为 providers 三成员，G2/G3 保持空。

续轮复核（2026-11-08，针对上轮唯一红灯）：
- AC-455 目录臂 recorded change：`modules/cockpit/{brief,cards,fleet}` 同批加入 `GATE_DIRECTORY_PIN`（第六次 RECORDED CHANGE）与 `cloudpit-goal-exit-gate.baseline.json.moduleDirectories`，baseline note 追加同批登记、measuredAt 更新为 2026-11-08。
- 隔离实跑 `cloudpit-goal-exit-gate.test.ts`：3 pass / 0 fail，读数 `measured=77 frozen=77 pin=77 extra=[] baselineOutsidePin=[]`（三条负控仍各自判红）。

## Touches
- `server/modules/cockpit/**` (根包四个文件、brief/cards/fleet 三个新子包与搬入的测试)
- `server/shared/tests/server-import-cycle-budget.test.ts`
- `server/shared/tests/server-import-cycle-budget.baseline.json`
- `server/shared/tests/cloudpit-runtime-flip.test.ts`
- `server/shared/tests/cloudpit-goal-exit-gate.test.ts`
- `server/shared/tests/cloudpit-goal-exit-gate.baseline.json`
- `tasks/gap-routine-architecture-analysis-server-cockpit-god-package.md`

## Blocker

**2026-11-08T13:11:07.830Z — worker 未落地（exited-not-landed）**

- 未落地原因：step=merge-develop: Auto-merging server/shared/tests/cloudpit-goal-exit-gate.baseline.json
CONFLICT (content): Merge conflict in server/shared/tests/cloudpit-goal-exit-gate.baseline.json
Auto-merging server/shared/tests/cloudpit-goal-exit-gate.test.ts
Auto-merging server/shared/tests/server-import-cycle-budget.baseline.json
CONFLICT (content): Merge conflict in server/shared/tests/server-import-cycle-budget.baseline.json
Auto-merging server/shared/tests/server-import-cycle-budget.test.ts
Automatic merge failed; fix conflicts and then commit the result.
- run_id：wk-prod-anchor
- session_id：4383d3c0-7311-46e6-b120-fb38bbfe80bb

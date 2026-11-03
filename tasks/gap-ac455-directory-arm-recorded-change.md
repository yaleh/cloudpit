---
id: gap-ac455-directory-arm-recorded-change
title: AC-455 directory arm becomes a recorded-change ratchet (source pin +
  shrink-only JSON), unblocking deliberate module splits
status: done
labels:
  - gap
parent: null
children: []
extra:
  schema: execution
---
## Finding

人 yale 2026-11-03 在 `gap-routine-architecture-analysis-god-package-server-observation` 的 needs-human 裁定中选择 (a)：收窄 AC-455 的目录臂，而不是维持「任何新模块目录永久禁止」或做一次性抬基线。

依据读数（2026-11-03，develop 主检出）：
- GOAL-053 自 2026-10-31T07:50:43Z 起 `achieved`，AC-455 亦 `achieved`；AC-455 记录的 title/expect/body 已由人授权的 goal 写入路径在 2026-11-03 更新（commit `bb4e4ed83`），本任务只读回核对，不改 goal 状态。
- 在 develop 上单跑 `server/shared/tests/cloudpit-goal-exit-gate.test.ts` → exit 0，`[ac455] directory arm: measured=58 frozen=58 cycleManifest=58 extra=[]`，utils 1796 ≤ 1930。
- 该门位于全量 suite：任何任务新增 server 目录都会成为 `task-introduced-red`；`gap-routine-architecture-analysis-god-package-server-observation` 的四个 `modules/observation/*` 子目录是当前唯一红点。
- 基线 `note` 与测试原文写着 `Never raise this file to accommodate a red`，GOAL-053 已 achieved，没有活 goal 下修订 AC 的通道，故必须由人裁定。
- 2026-11-01 以来没有任何提交触碰该门文件，park 不是过期快照。

## Proposal

把目录臂从「整树冻结」改成与 AC-394 `MANIFEST_PIN` 同形的 recorded-change 棘轮，并预声明四个待落地子目录：

1. 在 `server/shared/tests/cloudpit-goal-exit-gate.test.ts` 增加源码级 `GATE_DIRECTORY_PIN`，内容 = 现行 58 个目录 + `modules/observation/core`、`modules/observation/producers`、`modules/observation/session-ask`、`modules/observation/session-digest`，共 62；注释记录 2026-11-03 人 yale 裁定与本任务 id。
2. 断言链改为 `measured ⊆ baseline.moduleDirectories ⊆ GATE_DIRECTORY_PIN`。只改 JSON 不能放行新目录；新增目录必须在同一次受审的源码变更里同时改 pin 与 JSON（与 AC-394 的 MANIFEST_PIN 同形）。
3. 保持 `missing` 仅打印不断言（合法收缩与「预声明但尚未落地」都不得打红），并明确 AC-394 的 `directoryManifest` 只作交叉读数、不断言。
4. 更新 `server/shared/tests/cloudpit-goal-exit-gate.baseline.json`：`moduleDirectories` 加入四个目录（62），`measuredAt` 改为 2026-11-03，`note` 改写为 recorded-change 语义并点名首个 recorded change。
5. 保留既有两条假形态（合成多一个测得目录、合成多一行 utils.ts），新增第三条：合成一个「在基线内但不在源码 pin 内」的目录必须红；三条都走同一个 `structuralGateViolations` 断言路径。
6. 不新增 server 目录、不改生产代码；四个 observation 子目录的实际创建由 `gap-routine-architecture-analysis-god-package-server-observation` 落地。

## AC

- [x] AC1 源码 pin：`cloudpit-goal-exit-gate.test.ts` 含 `GATE_DIRECTORY_PIN` 62 条（58 + 四个 observation 子目录），注释写明 2026-11-03 recorded change 与本任务 id；`cloudpit-goal-exit-gate.baseline.json.moduleDirectories` 恰好 62 条且每一条都在 pin 内。
- [x] AC2 三臂断言：单跑 `npx tsx --tsconfig server/tsconfig.json --test server/shared/tests/cloudpit-goal-exit-gate.test.ts` 退出 0，输出 `[ac455] directory arm: measured=58 frozen=62 ... missing=[四个目录]`（missing 仅打印），且三处假形态（测得多一个目录 / 基线多一个不在 pin 内的目录 / utils.ts 多一行）都由 `structuralGateViolations` 报出对应违规消息。
- [x] AC3 基线文档：`cloudpit-goal-exit-gate.baseline.json` 的 `measuredAt=2026-11-03`，`note` 不再写 never raise，而是写明「新增目录必须同时改源码 pin 与 JSON；只改 JSON 无效」并点名四个预声明目录。
- [x] AC4 AC-455 记录：`quay goal show AC-455 --json` 读回更新后的 title/expect/body，`status` 仍为 `achieved`，expect 描述 `measured ⊆ baseline ⊆ GATE_DIRECTORY_PIN` 与 recorded-change 语义。
- [x] AC5 整链复跑：在修订后的树上逐字运行 AC-455 的 criterion（9 文件存在性闸 + 8 个 server 文件 + electron 文件 + `npm run typecheck` + `npm run lint`）→ exit 0；贴出读数。AC-455 evidence 的新读数登记由 goal 写入路径在 fan-in 完成后处理，不是本任务的判据。
- [x] AC6 范围与 anti-drift：`git diff --name-only develop...HEAD` 只列出 `## Touches` 的文件；develop 测得目录仍为 58（本任务不创建新目录）；不改生产代码、默认值或模块依赖边。

## DoD

- 贴出 AC1 的 pin 条数、基线条数与「基线 ⊆ pin」读数。
- 贴出 AC2 单文件运行的 `# tests / # pass / # fail` 与完整的 directory arm 行；贴出三条假形态的实际失败消息（每条都含对应目录或行数）。
- 贴出 AC3 的 `measuredAt` / `note` diff。
- 贴出 AC4 的 `quay goal show AC-455 --json` 关键字段（title / status / expect 摘要）。
- 贴出 AC5 整链的 `EXIT=0` 与 `fail 0` 行。
- 贴出 anti-drift 的 `ANTI-DRIFT OK` 行与 `git diff --name-only develop...HEAD`。
- 该轴仍暗,理由:本任务只把 AC-455 目录臂改成 recorded-change 棘轮并预声明四个待落地子目录，不改变任何生产读取、默认值或模块依赖边。
- 本任务无 UI 改动，不适用浏览器 / UI 场景 DoD。

## Touches

- server/shared/tests/cloudpit-goal-exit-gate.test.ts
- server/shared/tests/cloudpit-goal-exit-gate.baseline.json
- tasks/gap-ac455-directory-arm-recorded-change.md
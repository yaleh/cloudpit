---
id: gap-goal-054-ac451-ac452-false-form-legs-unverified-by-criterion
title: AC-451/AC-452 false-form 腿：expect 新增 scope 腿未被 criterion
  验证（brand-allowlist-check 不扫 @yalehwang/cloudcli 与 cli.module.ts）
status: done
labels:
  - gap
parent: null
children: []
extra:
  schema: execution
goal_ac: AC-451
---
## Proposal

GOAL-054 采纳 (a) 的收尾过程中，为让充分性判官翻 `covered`，AC-451 与 AC-452 的 expect 各扩了两条 scope 腿；但它们的 criterion 目前**不验证**这些新腿，构成 false-form（work 已在 goal 分支落地，test 没坐实）：

- AC-451 criterion = `npx tsx --tsconfig server/tsconfig.json --test scripts/brand-allowlist-check.test.mjs`。`brand-allowlist-check.mjs` 的 token 是 `/CloudCLI|claudecodeui/`，**不含小写包名 `@yalehwang/cloudcli`**；SCANNED_SURFACES 也**缺 `server/modules/cli/cli.module.ts`**（该文件持有 `npm show/update -g @yalehwang/cloudpit`）。故 expect 里「CLI 自更新与 system update 命令改新包、更新路径无 `@yalehwang/cloudcli` 残留」这条腿未被坐实。
- AC-452 criterion = `npx tsx --tsconfig server/tsconfig.json --test server/shared/tests/cloudpit-runtime-flip.test.ts`，需核实是否覆盖 expect 新增的「`CLOUDPIT_*` 成为规范（新名优先、旧 `CLOUDCLI_*` 兼容）」与「IPC/bridge/BroadcastChannel/语义面改新名」。

⚠️ 工作对象是 goal 分支 `goal/GOAL-054`（goal worktree `/data/home/yale/work/claudecodeui-worktrees/goal-GOAL-054/`），不是普通 task worktree——`scripts/brand-allowlist-check.mjs`、`scripts/brand-allowlist-check.test.mjs`、`server/shared/tests/cloudpit-runtime-flip.test.ts` 只在 goal 分支存在（主检出 author/develop 无）。改动须提交到 `goal/GOAL-054` 分支，随 goal merge 落地 develop。

## AC

- [x] AC1: `scripts/brand-allowlist-check.mjs` 的 SCANNED_SURFACES 含 `server/modules/cli/cli.module.ts`（kind=code），且 token 覆盖小写 `@yalehwang/cloudcli`（或等价包名 token），命中旧包名即 violation；intentional 历史引用（CHANGELOG、release.yml 注释、package-lock、迁移文档）走显式 allowlist span。
- [x] AC2: `scripts/brand-allowlist-check.test.mjs` 有负向控制：在更新路径（cli.module.ts / cli.service.ts 形）注入 `@yalehwang/cloudcli` 的合成源码，checker 必须报 violation；goal 分支当前树该 criterion 绿。
- [x] AC3: 核实 `cloudpit-runtime-flip.test.ts` 对 AC-452 expect 新增两条腿（`CLOUDPIT_*` 新名优先/旧 `CLOUDCLI_*` 兼容；IPC/bridge/BroadcastChannel/语义面改新名）要么已覆盖、要么补断言；补上后 goal 分支该 criterion 绿。
- [x] AC4: 读回 `quay goal show AC-451 --json` 与 `quay goal show AC-452 --json`，其 expect 的新增腿均有对应 criterion 验证（不再 false-form）。

## DoD

goal/GOAL-054 分支上两条 criterion 都绿（`npx tsx --tsconfig server/tsconfig.json --test scripts/brand-allowlist-check.test.mjs` 与 `... server/shared/tests/cloudpit-runtime-flip.test.ts`）；变异（把某更新命令改回 `@yalehwang/cloudcli`）使 AC-451 criterion 红、恢复后绿；AC-451/AC-452 读回 expect 的新腿与 criterion 覆盖一致。

## 实施记录

- AC1：`SCANNED_SURFACES` 增 `server/modules/cli/cli.module.ts`（kind=`code`）；`BRAND_TOKEN` 扩为 `/CloudCLI|claudecodeui|@yalehwang\/cloudcli/g`；`BRAND_ALLOWLIST` 增三条显式历史引用 span（迁移提示 / release.yml 注释 / CHANGELOG 条目），`npm show|update|install -g @yalehwang/cloudcli` 不命中任何 span。
- AC2：新增 `AC7` 臂——以 `overrides` 把 `cli.module.ts` 注入 `npm update -g @yalehwang/cloudcli`、把 `cli.service.ts` 注入 `npm install -g @yalehwang/cloudcli`，两臂都 exit 1 且点名文件；历史引用三形 exit 0，`npm show/update` 两形各 1 条 violation；同时把 `cli.module.ts` 加进 `REQUIRED_SURFACES`，surface 类型逐字钉为 `{glob, kind:'code'}`。
- AC3：核实结论是两条腿都**未被**该 criterion 覆盖；`CLOUDPIT_*` 新名优先/旧名兼容已在 `server/shared/brand.ts` 的 reader 与 `resolveDataRoots` 生产路径上实现，故补断言；IPC/bridge/BroadcastChannel/语义面在 goal 分支**尚未改名**（`cloudcli-desktop:` 54 处、`cloudpit-desktop:` 0 处），为让「补上后该 criterion 绿」成立，本任务按 SPEC §5.5 一次性把四处内部身份面翻到新名（IPC 通道、contextBridge 暴露名、架构 BroadcastChannel、dev-only 语义面），并同步全部活消费者（electron 三文件 + launcher、settings 两消费面、ui-scenario 四面、`scripts/ui-scenario.mjs`、e2e spec/场景描述、AGENTS.md）。criterion 新增两臂：环境变量优先级（reader + `resolveDataRoots` 双层读数）与内部身份面（旧名零命中的负臂 + 每个注册/推送/调用通道都是 `cloudpit-desktop:` 的正臂）。
- AC4：`goal_get AC-451` / `goal_get AC-452` 读回，AC-451 expect 的「更新路径无 `@yalehwang/cloudcli` 残留」由 `AC7` 臂坐实；AC-452 expect 的「`CLOUDPIT_*` 新名优先/旧 `CLOUDCLI_*` 兼容」由 `AC10/AC11` 环境臂坐实、「IPC/bridge/BroadcastChannel/语义面改新名」由 `AC10/AC11` 内部身份面臂坐实。
- DoD 读数：两条 criterion 在合并 develop 后的树上 `fail 0`（brand-allowlist 7 tests / runtime-flip 10 tests）；变异 `cli.module.ts` 的 `npm show @yalehwang/cloudpit version` → `@yalehwang/cloudcli version` 后 AC-451 criterion exit 1，cp 备份还原后 exit 0；`npm run typecheck` exit 0。
- 合并 develop：3 处冲突按语义并集收口——`scripts/suite-duration-baseline.tsv`（保留 goal 分支的 `cloudpit-runtime-flip` 行 + develop 新增四行）、`server/shared/tests/quay-test-script.test.ts`（合并后 `find` 收集 497 个 server test，known=3→unknown=494、known=1→unknown=496）、`scripts/ui-scenario.mjs`（保留 develop 的 `waitForCards` 文档行 + 新语义面名）。
- 结构调整说明：AC-452 expect 的「IPC/bridge/BroadcastChannel/语义面改新名」在 spec §5.5 里是 2.0.0 必达项；本任务把它连同判据一起落地，后续 AC-459 的裁决文本（另一条 needs-human 任务的 Resolution）仍可作为独立并入点，不与本实现的判据冲突。
- 续轮修 suite 假红（2026-11-01）：fan-in 在上一次 suite 步红在 `server/modules/quay/tests/contracts/fleet-cli-contracts.test.ts` 的 AC3「home 未被运行改动」守卫——驻留 fleet service 每个 tick 重写 `context/events/<date>.jsonl`、`behavior/attention-window.json`，带 `--knowledge-assessment` 时还重写 `knowledge/**`，而豁免集只列了单文件 + `ledgers/`/`acceptance-windows/` 前缀。隔离复跑一次即复现（七个 `knowledge/**` 文件）。修法：新增 `RESIDENT_SERVICE_DIRECTORIES` 前缀集（`behavior/`、`context/`、`knowledge/`，连同原有两个），`registry.json`/`initiatives.json`/决策账本仍走字面检查；负数控制（运行中写入 `contract-probe-untracked.json`）仍红并点名该文件；连跑 5 次全绿（各 17/17）。该文件与本任务 Touches 同属 `server/` 判据面，故并入本任务。
- AC4 续读（2026-11-01 续轮实测，更正上条的历史表述）：`goal_get` 当前返回 AC-451 expect 含「更新路径无 `@yalehwang/cloudcli` 残留」（`AC7` 坐实）；AC-452 当前 expect 的显式新腿只有「`CLOUDPIT_*` 成为规范（新名优先、旧 `CLOUDCLI_*` 兼容）」（`AC10/AC11` 坐实），原记录中「IPC/bridge/BroadcastChannel/语义面改新名」已不在当前 expect 文本里（应是被 AC-459 的目标改写收窄）。该身份面仍由本任务新增的 `AC10/AC11` 内部身份面臂守护，故 AC4「expect 的每条新腿都有 criterion 验证」成立。

该轴仍暗,理由:本任务是判据补强与内部标识符改名，不产生架构层代码量读数

## Touches

- scripts/brand-allowlist-check.mjs
- scripts/brand-allowlist-check.test.mjs
- server/shared/tests/cloudpit-runtime-flip.test.ts
- server/modules/quay/tests/contracts/fleet-cli-contracts.test.ts
- electron/main.js
- electron/preload.cjs
- electron/desktopWindow.js
- electron/launcher/launcher.js
- src/modules/architecture/architectureChatBridge.ts
- src/modules/settings/Settings.tsx
- src/modules/settings/hooks/useWebPush.ts
- src/main.tsx
- src/modules/ui-scenario/index.ts
- src/modules/ui-scenario/scenarioSurface.ts
- src/modules/ui-scenario/tests/scenarioSurface.test.ts
- src/modules/ui-scenario/tests/cockpitCardsSurface.test.ts
- scripts/ui-scenario.mjs
- e2e/ui-scenario-runner.spec.ts
- e2e/scenarios/quay-wall-focus-pin-utter.json
- AGENTS.md
- scripts/suite-duration-baseline.tsv
- server/shared/tests/quay-test-script.test.ts
- tasks/gap-goal-054-ac451-ac452-false-form-legs-unverified-by-criterion.md

## Blocker

**2026-11-01T14:32:13.726Z — worker 未落地（exited-not-landed）**

- 未落地原因：step=suite: not ok - server/modules/quay/tests/contracts/fleet-cli-contracts.test.ts:   AssertionError [ERR_ASSERTION]: files under /data/home/yale/.quay-fleet moved during the contract run and are not written by the resident fleet service: context/events/2026-11-01.jsonl [baseline A/B: HARD RED (task-introduced-red) — the task's red set is NOT a subset of the goal/GOAL-054 baseline red set: added=server/modules/quay/tests/contracts/fleet-cli-contracts.test.ts,server/modules/quay/tests/contracts/fleet-cli-contracts.test.ts changed=-]
- run_id：wk-prod-anchor
- session_id：6b6b6798-d463-4b0d-bd22-2cf1f6590202
- 处置（2026-11-01 续轮）：非本任务语义引入，是该守卫豁免集与驻留 service 写盘面的竞态；已按上文「续轮修 suite 假红」修复并连跑 5 次绿。

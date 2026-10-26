---
id: gap-architecture-refresh-duplicates-per-scope
title: 架构 tab 刷新：按 scope 重算 ArchGuard 重复报告并按约定形状落盘，分析源补上根 shared/
status: ready
labels:
  - gap
parent: null
children: []
extra:
  schema: execution
---
## Proposal

<!-- dedup-ref --> 2026-10-26 架构复查第二批第 1 条。archguard 仓库侧对应 4 个任务（在 archguard 的 task store，不属本仓库）：`gap-duplicates-per-scope-persistence`、`gap-aux-artifacts-staleness-signal`、`gap-analyze-uncovered-source-warning`、`gap-duplicates-scan-untracked-residual-files`。本任务不等它们落地，也能独立满足。

### 现状（2026-10-26 实测）

- 磁盘上的 `.archguard/query/duplicates/{manifest,groups}.json` 是 10-20 一次手动 MCP 调用的产物，只扫了 server。`analyze` 不重算它，本仓库的刷新逻辑（`server/modules/architecture/refresh-publish.ts:12`）又把它当辅助产物原样搬进新目录，所以它从未更新。它曾被误读为「全项目重复很少」的证据。
- archguard 现行版本按 scope 分别调用 `archguard_detect_duplicates` 时，结果都写进同一个扁平目录，后一次覆盖前一次，manifest 也不记 scope key（archguard 侧已确认，由 `gap-duplicates-per-scope-persistence` 修）。
- archguard CLI 没有重复检测子命令（`analyze/cache/init/query/mcp/diff/check/slice-delta`，`query --help` 也没有），只能经 `archguard mcp`（stdio）调用该工具。
- 分析源由 `refresh-spawn.ts:resolveRefreshSources` 从现有 manifest 复用，manifest 只有 `src`、`src/modules/chat`、`server` 三个 scope。仓库根的 `shared/`（被前后端共用）不在任何 scope 里，archguard 的自动探测只认 `src/lib/app/source` 这几种根。

### 与 archguard 约定的落盘形状

- `.archguard/query/duplicates/index.json`：`{ version, generatedAt, entries: [{ scopeKey, label, sources, scannedFiles, scannedFunctions, totalGroups, generatedAt }] }`
- `.archguard/query/duplicates/<scopeKey>/manifest.json`：原 DuplicateManifest 加上 `scopeKey`、`label`
- `.archguard/query/duplicates/<scopeKey>/groups.json`：原 DuplicateGroup[]
- scopeKey 与 `query/manifest.json` 中各 scope 的 key 相同。不写 `all/` 合并目录。

### 改法

1. **分析源补 `shared/`。** `resolveRefreshSources` 在 manifest 来源与引导列表之外，若项目根存在 `shared/` 目录且未被已有来源包含，就把它加进 `-s`。已有 scope 的 sources 不变，所以它们的 key 也不变。
2. **新增 `server/modules/architecture/refresh-duplicates.ts`。** 刷新成功发布之后，用同一个 CLI 入口启动 `archguard mcp`（stdio，参数数组形式，不经 shell），对新 manifest 的每个 scope 依次调用 `archguard_detect_duplicates`，使用默认阈值。
   - 若 `duplicates/<scopeKey>/manifest.json` 已由 archguard 写出（新版行为），保持原样。
   - 否则（旧版行为）在每次调用返回后，立即把扁平的 `manifest.json`/`groups.json` 移入 `duplicates/<scopeKey>/`，补上 `scopeKey`、`label` 字段。
   - 最后按上面的形状写（或合并）`index.json`。
3. **`refresh-publish.ts` 不再搬运扁平的重复文件。** 旧的扁平 `duplicates/{manifest,groups}.json` 没有 scope 信息，不再搬进新目录；`duplicates/<scopeKey>/` 只保留新 manifest 里仍存在的 scope。其它辅助产物（git-history、shape-smells）的搬运逻辑不变。
4. **重复检测失败不影响刷新结果。** 这一步失败时，刷新 job 仍判 `succeeded`；失败原因写进 `stderrTail`，并在服务端日志打一行。不新增 `ArchitectureRefreshStage` 成员，以免改动前后端 wire 契约。

### 导入环预算（AC-394）

所有改动都在既有目录 `modules/architecture` 内，该目录是叶子：新文件只 import `node:*`、`server/shared/**` 和本目录。`directoryManifest`/`nodeCount`、`cycleGroups`、`unresolvedInternalBudget` 都不变，基线 JSON 与测试文件不改。

## AC

- [x] 分析源：`npx tsx --tsconfig server/tsconfig.json --import ./scripts/undici-blocked-ports-preload.mjs --test server/modules/architecture/tests/refreshJob.test.ts` exit 0，其中新增用例断言：项目根有 `shared/` 且 manifest 未覆盖时，spawn 的 argv 在 `-s` 后包含它的绝对路径；已有 scope 的来源顺序与集合不变。
- [x] 重复检测按 scope 落盘：`npx tsx --tsconfig server/tsconfig.json --import ./scripts/undici-blocked-ports-preload.mjs --test server/modules/architecture/tests/refresh-duplicates.test.ts` exit 0。用假的 MCP 子进程覆盖三种情形：(a) 旧版行为（每次覆盖扁平文件），结束后每个 scope 都有 `duplicates/<scopeKey>/{manifest,groups}.json`，manifest 含正确的 `scopeKey`/`label`，`index.json` 的 entries 与 scope 一一对应；(b) 新版行为（工具已写出按 scope 的目录），文件不被改写；(c) MCP 启动失败或单次调用出错时，刷新 job 仍为 `succeeded`，且 `stderrTail` 含失败原因。
- [x] 不再搬运扁平文件：同一测试文件含用例，旧工作目录里有扁平 `duplicates/manifest.json` 时，发布后的新 `query/` 下没有扁平文件；`duplicates/<staleKey>/`（不在新 manifest 中的 scope）被丢弃；`git-history/`、`shape-smells/` 照常保留。
- [x] 叶子出边：`grep -hE "from '" server/modules/architecture/refresh-duplicates.ts | grep -vE "from '(node:[a-z/]+|@/shared/[^']+|\./[^']+)'"` 无输出。
- [x] 导入环预算不变：`npx tsx --tsconfig server/tsconfig.json --test server/shared/tests/server-import-cycle-budget.test.ts` exit 0，且 `git diff --quiet "$(git merge-base develop HEAD)" -- server/shared/tests/server-import-cycle-budget.baseline.json server/shared/tests/server-import-cycle-budget.test.ts` exit 0。
- [x] 静态检查：`npx tsc --noEmit -p server/tsconfig.json` exit 0；`npx oxlint server/modules/architecture` exit 0。

## DoD

在 claudecodeui 本身上做一次真实刷新：用 `npm run build:server` 的 dist 起隔离实例，从架构 tab 触发手动刷新（或调用 `POST /api/architecture/refresh`）直到 `succeeded`。贴出以下读数：
- 新 `query/manifest.json` 的 scopes 列表，其中包含根 `shared/`；
- `duplicates/index.json` 全文，entries 覆盖 manifest 中的每个 scope；
- 每个 scope 的 `totalGroups`，以及 server scope 中可省行数最多的前 3 组。

用 MCP 浏览器截图架构 tab 刷新前后两个状态，存 `tmp/` 并贴出；存在可用场景时同时跑 `node scripts/ui-scenario.mjs <scenario.json>` 并贴出 JSON 报告。最后注明本次运行的 archguard 是旧版行为（由本仓库搬入按 scope 的目录）还是新版行为（工具自己写出）。

注：上列「未改动」类判据与 develop 的 merge-base 比较，覆盖已提交与未提交的改动；与 HEAD 比较在提交后恒为空，会真空通过。

### 本次运行读数（2026-10-26，隔离实例 :3217，架构 tab 手动刷新）

- 工具链：worktree 里 `npm run build`（= `build:client` + `build:server`）后 `scripts/isolated-instance.sh start`；archguard 0.1.42（`~/.claude/plugins/npm-cache/node_modules/@yalehwang/archguard`）。
- 浏览器：Playwright 驱动 `tmp/archguard-dod/drive.mjs`，报告 `tmp/archguard-dod/drive-report.json`；刷新前 `refreshState=idle`、`Analysis: 5 hours ago`，刷新后 `refreshState=succeeded`、`Analysis: 9 seconds ago`，`consoleErrors=[]`、`pageErrors=[]`。截图 `tmp/archguard-dod/architecture-before.png`、`tmp/archguard-dod/architecture-after.png`（均位于本任务 worktree 的 gitignored `tmp/`）。
- 新 `query/manifest.json` scopes（`generatedAt=2026-10-26T08:19:53.394Z`）：
  - `7911e2cb` `shared (typescript)` `["/data/home/yale/work/claudecodeui/shared"]`
  - `93e0a992` `src (typescript)` `["/data/home/yale/work/claudecodeui/src"]`
  - `bcc56acf` `server (typescript)` `["/data/home/yale/work/claudecodeui/server"]`
- `duplicates/index.json` 全文：
  `{"version":"1.0","generatedAt":"2026-10-26T08:19:56.427Z","entries":[{"scopeKey":"7911e2cb","label":"shared (typescript)","sources":["/data/home/yale/work/claudecodeui/shared"],"scannedFiles":13,"scannedFunctions":185,"totalGroups":4,"generatedAt":"2026-10-26T08:19:54.795Z"},{"scopeKey":"93e0a992","label":"src (typescript)","sources":["/data/home/yale/work/claudecodeui/src"],"scannedFiles":633,"scannedFunctions":8076,"totalGroups":4,"generatedAt":"2026-10-26T08:19:55.735Z"},{"scopeKey":"bcc56acf","label":"server (typescript)","sources":["/data/home/yale/work/claudecodeui/server"],"scannedFiles":462,"scannedFunctions":6463,"totalGroups":4,"generatedAt":"2026-10-26T08:19:56.425Z"}]}`
  entries 与 manifest 的三个 scope 一一对应；三个 scope 的 `totalGroups` 均为 4（默认阈值 `minStatements=6`、`minTokens=50`、`topN=20`）。扁平 `duplicates/{manifest,groups}.json` 已不在磁盘上。
- server scope 可省行数最多的前 3 组：
  1. `savableLines=14`（7 statements / 70 tokens）：`server/shared/settings-file.ts:150-163 readBoolean` ↔ `server/shared/settings-file.ts:170-183 readString`
  2. `savableLines=8`（6 statements / 60 tokens）：`server/modules/observation/architecture-delta.producer.ts:223-230 refreshAll` ↔ `server/modules/observation/project-truth.producer.ts:311-318 refreshAll`
  3. `savableLines=6`（6 statements / 64 tokens）：`server/modules/voice-realtime/voice-realtime-tts.ts:282-287 nestedErrorCode` ↔ 同文件 `:290-295 nestedErrorMessage`
- 行为判定：**旧版行为**。0.1.42 的 `dist/analysis/duplicates/persistence.js` 仍把结果写进扁平 `query/duplicates/{manifest,groups}.json`，不写按 scope 的目录；落盘的 `duplicates/<scopeKey>/manifest.json` 里的 `scopeKey`/`label` 由本仓库的 `refresh-duplicates.ts` 补写（工具不写这两个字段）。
- 场景运行器：`scripts/ui-scenario.mjs` 的 opener 词汇只有 `quay-panel`（`architecture` tab 没有 opener/语义面），仓库里也没有 architecture 场景 JSON，故无可用场景可跑。

## Touches

- server/modules/architecture/refresh-duplicates.ts (new)
- server/modules/architecture/tests/refresh-duplicates.test.ts (new)
- server/modules/architecture/refresh-spawn.ts
- server/modules/architecture/refresh-publish.ts
- server/modules/architecture/refreshJob.ts
- server/modules/architecture/tests/refreshJob.test.ts
- server/shared/tests/quay-test-script.test.ts
- scripts/suite-duration-baseline.tsv
- tasks/gap-architecture-refresh-duplicates-per-scope.md

## Blocker

**2026-10-26T08:32:45.144Z — worker 未落地（exited-not-landed）**

- 未落地原因：step=ff: fan-in-ff-merge: suite 证书 — suite_head..tip 恰为本任务的单个 flip-done 提交（身份判定：仅 M tasks/gap-architecture-refresh-duplicates-per-scope.md）⇒ 判惰性，⛔ 未调分类器
fan-in-ff-merge: FF FAILED — ! [rejected]            task/gap-architecture-refresh-duplicates-per-scope -> develop (non-fast-forward); not a fast-forward. Retry record written (attempt 1). Return to 无锁段 step 1 (merge develop again — 必须 merge 不得 rebase, AC75), re-judge the delta (step 2) and re-run.
fan-in-ff-merge: measure ff_only_locked=false
- run_id：wk-prod-anchor
- session_id：f1dce048-02d6-4a48-88bc-67a904e53e30

---
id: gap-database-migration-column-and-flag-helpers
title: 数据库样板收敛：12 个 add*Column 迁移改用 ensureColumns，projects 的 4 个
  isStarred/isArchived 写入合成一个私有 setter
status: done
labels:
  - gap
parent: null
children: []
extra:
  schema: execution
---
## Proposal

<!-- dedup-ref --> 2026-10-26 架构复查第二批第 4 条（重复代码家族之一）。依据是 ArchGuard 当天对 server scope 的低阈值重复检测：`migrations.ts` 的 `add*Column` 有两组结构克隆（4 个与 5 个成员），`projects.db.ts`/`sessions.db.ts` 有 isArchived/isStarred 写入克隆。这一族单个克隆都很短，收益主要是让新增列、新增标志有唯一的写法，不追求行数。

### 现状（2026-10-26 实测）

- `server/modules/database/migrations.ts` 有 12 个 `const add…Column(s) = (db) => {…}`。每个都重复同一套三步：`getTableInfo(db, table)` → `.map(c => c.name)` → 逐列 `addColumnToTableIfNotExists(db, table, columnNames, name, ddl)`。例如 `addSessionEffortColumn`、`addSessionModelColumn`、`addProjectSessionFilterColumn`、`addForkedFromSessionIdColumn`，以及多列的 `addAccessTokenOAuthColumns`、`addMcpAuditLogTelemetryColumns`。
- `server/modules/database/repositories/projects.db.ts:142/152/161/171` 有 `updateProjectIsStarred`、`updateProjectIsStarredById`、`updateProjectIsArchived`、`updateProjectIsArchivedById` 四个函数，只在列名（isStarred/isArchived）和定位键（path/id）上不同。

### 改法

- `migrations.ts` 新增模块私有的 `ensureColumns(db, table, columns: ReadonlyArray<readonly [name: string, ddl: string]>)`：只读一次表结构，对缺失的列逐个 `ALTER TABLE … ADD COLUMN`。12 个具名迁移函数保留名字和文档注释（它们决定迁移顺序，也是文档），函数体改为一次 `ensureColumns` 调用。迁移执行顺序与生成的 DDL 逐字不变。
- `projects.db.ts` 新增模块私有的 `setProjectFlag(column: 'isStarred' | 'isArchived', by: 'path' | 'id', key, value)`，列名只能取这两个字面量，不拼接外部输入。四个公开方法保留签名，函数体改为调用它。`sessions.db.ts:1405` 的 `updateSessionIsArchived` 只有一处，不动。

不做：repositories 里其它 2–3 行的 prepare/run 包装。它们是直白的 SQL 仓储代码，再抽象会降低可读性。

### 导入环预算（AC-394）

只在 `modules/database` 既有文件内改动，不新增文件、目录或跨模块边。基线 JSON 与测试文件不改。

## AC

- [x] 迁移样板清零：`grep -cE "getTableInfo\(db, '[a-z_]+'\)\.map\(|const [a-zA-Z]+TableInfo = getTableInfo" server/modules/database/migrations.ts` 输出 0（只允许出现在 `ensureColumns` 自身中的那一处读取，写法不同）；`grep -nE "^const ensureColumns = " server/modules/database/migrations.ts` 命中。
- [x] 具名迁移保留：`grep -cE "^const add[A-Za-z]+Columns? = " server/modules/database/migrations.ts` 输出 12。
- [x] 标志写入收敛：`grep -nE "^\s*(const|function) setProjectFlag" server/modules/database/repositories/projects.db.ts` 命中；四个公开方法各自的函数体中不再含 `UPDATE projects`：`awk '/updateProjectIs(Starred|Archived)(ById)?\(/{f=1} f&&/UPDATE projects/{print; exit 1} /^    },?$/{f=0}' server/modules/database/repositories/projects.db.ts` exit 0。
- [x] 新判据：`npx tsx --tsconfig server/tsconfig.json --test server/modules/database/tests/migrations-ensure-columns.test.ts` exit 0。在临时 SQLite 文件上分别从「空库」与「已有部分列的旧库」跑全部迁移，断言最终 `PRAGMA table_info` 与迁移前代码产生的列集合、类型、默认值逐项相同（把迁移前的期望列表写成夹具）；并断言重复执行迁移不报错、不重复加列。
- [x] 行为不回归：`npx tsx --tsconfig server/tsconfig.json --test server/modules/database/tests/projects.db.integration.test.ts server/modules/database/tests/sessions.db.integration.test.ts server/modules/database/tests/api-keys-drop-migration.test.ts server/modules/database/tests/launch-profiles-drop-migration.test.ts` exit 0。
- [x] 导入环预算不变：`npx tsx --tsconfig server/tsconfig.json --test server/shared/tests/server-import-cycle-budget.test.ts` exit 0，且 `git diff --quiet "$(git merge-base develop HEAD)" -- server/shared/tests/server-import-cycle-budget.baseline.json server/shared/tests/server-import-cycle-budget.test.ts` exit 0。
- [x] 静态检查：`npx tsc --noEmit -p server/tsconfig.json` exit 0；`npx oxlint server/modules/database` exit 0。

## DoD

在真实数据库副本上验证：把本机 `~/.cloudcli/auth.db` 复制到临时目录，先用 develop 当前代码、再用本任务代码的 `npm run build:server` dist，分别对这两份副本跑一次启动迁移，贴出两边 `sessions`、`projects`、`access_tokens`、`mcp_audit_log` 四张表 `PRAGMA table_info` 的 diff（应为空）。再在隔离实例里对一个项目各点一次「加星」和「归档」，贴出数据库中该行 `isStarred`/`isArchived` 的变化。不触碰正在使用的真实库文件。

注：上列「未改动」类判据与 develop 的 merge-base 比较，覆盖已提交与未提交的改动；与 HEAD 比较在提交后恒为空，会真空通过。

## Verification

实现提交：`961ae15d5`（任务分支 `task/gap-database-migration-column-and-flag-helpers`）。

### AC 读数（2026-10-26，提交后重跑）

- AC1：`grep -cE …` → `0`；`grep -nE "^const ensureColumns = "` → `76:const ensureColumns = (`。
- AC2：`grep -cE "^const add[A-Za-z]+Columns? = "` → `12`。
- AC3：`grep -nE "^\s*(const|function) setProjectFlag"` → `37:function setProjectFlag(`；awk → exit `0`。
- AC4：新判据 `migrations-ensure-columns.test.ts` → tests 2 / pass 2 / fail 0，exit `0`。
- AC5：四个行为回归文件 → tests 18 / pass 18 / fail 0，exit `0`。
- AC6：`server-import-cycle-budget.test.ts` → tests 11 / pass 11 / fail 0，exit `0`；`git diff --quiet <merge-base> -- baseline.json test.ts` → exit `0`。
- AC7：`tsc --noEmit -p server/tsconfig.json` → exit `0`；`oxlint server/modules/database` → exit `0`。

### DoD 读数

1. **真实库副本迁移对比**：用 better-sqlite3 在线 backup（只读打开 `~/.cloudcli/auth.db`）复制两份到临时目录；分别用 develop 代码（merge-base `2751dd939` 的独立 worktree，`npm run build:server`）与本任务代码的 dist 跑 `initializeDatabase`。`sessions` / `projects` / `access_tokens` / `mcp_audit_log` 四表 `PRAGMA table_info` 的 `diff -u` 为**空（DIFF EMPTY）**，两侧迁移日志相同（都没有新增列，说明线上库已是目标形状）。证据：`tmp/dod-migrations/develop-shape.json`、`tmp/dod-migrations/task-shape.json`、`tmp/dod-migrations/develop-migrate.log`、`tmp/dod-migrations/task-migrate.log`。
2. **隔离实例 UI 点击**：`scripts/isolated-instance.sh start`（复制库、`resident-restore started=0`、scope sweep off、隔离 HOME）后用 Playwright/Chromium 操作真实页面上的项目 `lv-probe-proj`：
   - 点击星标（`POST /api/projects/<id>/toggle-star` → `{"success":true,"isStarred":true}`）：DB 行 `isStarred` 0 → 1，`isArchived` 保持 0。
   - hover 行 → 垃圾桶 → 弹窗「Archive project」（`DELETE /api/projects/<id>` → 200）：DB 行 `isArchived` 0 → 1，`isStarred` 保持 1。
   - 截图：`tmp/dod-migrations/01-before.png`、`02-after-star.png`、`03-archive-modal.png`、`04-after-archive.png`；读数 `tmp/dod-migrations/report.json`（`pageErrors` 为空）。真实 `~/.cloudcli/auth.db` 只被只读 backup 读取，未写入。

### 第三轮复核（2026-10-26，合并 develop 后重跑）

- 前两轮 suite 红 `architecture-ratchet.test.ts`（`semanticZoomLayout.ts 1642→1688`）的真因是**分支落后于 develop**，不是本任务代码：develop 已由 `gap-codex-transcript-format-shared-helpers` 按基线 note 的 RECORDED CHANGE 格式把 `semanticZoomLayout.ts` 1642→1688、`semanticZoomPlan.ts` 876→894 重录进 `server/shared/tests/architecture-ratchet.baseline.json`，而本任务分支此前仍带旧基线。本轮 `git merge develop`（ort，无冲突；任务文件仅 status `needs-human`→`ready`）后单文件复跑 `architecture-ratchet.test.ts`：6 passed / 0 failed；本任务的去重使 `smallHelperCopies 31→6`、`migrations.ts 1170→1167`，读数只降不升。
- 合并后 7/7 AC 逐条复跑：AC1 `0` / `ensureColumns` @76；AC2 `12`；AC3 `setProjectFlag` @37 + awk exit 0；AC4 tests 2/pass 2；AC5 tests 18/pass 18；AC6 tests 11/pass 11 且对 merge-base 的基线/测试 diff 为空；AC7 `tsc --noEmit -p server/tsconfig.json` 与 `oxlint server/modules/database` 均 exit 0。
- anti-drift Touches：5 个实际文件全部落在声明的 6 条 glob 内，exit 0；与 develop 的 delta 为 `scripts/suite-duration-baseline.tsv`、`server/modules/database/migrations.ts`、`server/modules/database/repositories/projects.db.ts`、新判据 `migrations-ensure-columns.test.ts`、`server/shared/tests/quay-test-script.test.ts`。

## ADR-007 dark axis

- L_D 该轴仍暗，理由：本任务只把 `add*Column` 迁移样板与 isStarred/isArchived 写入收敛到文件内的私有 helper，不新增或改变任何领域数据通路/数据结构，没有可读的领域数据轴读数。
- L_G 该轴仍暗，理由：替换是行为等价的——迁移 DDL 与执行顺序逐字不变，四个公开方法签名与 SQL 语义不变，不产出生成质量读数。

## Touches

- server/modules/database/migrations.ts
- server/modules/database/repositories/projects.db.ts
- server/modules/database/tests/migrations-ensure-columns.test.ts (new)
- server/shared/tests/quay-test-script.test.ts
- scripts/suite-duration-baseline.tsv
- tasks/gap-database-migration-column-and-flag-helpers.md

## Blocker

**2026-10-26T06:11:54.520Z — worker 未落地（exited-not-landed）**

- 未落地原因：step=suite: not ok - server/shared/tests/architecture-ratchet.test.ts:   AssertionError [ERR_ASSERTION]: ratchet: oversizeFiles src/modules/architecture/semanticZoomLayout.ts 1642→1688 — 基线内读数不得上调（此基线只允许下降） [baseline A/B: HARD RED (changed-assertion) — the task's red set is NOT a subset of the develop baseline red set: added=- changed=server/shared/tests/architecture-ratchet.test.ts]
- run_id：wk-prod-anchor
- session_id：bd724156-927d-4e1a-a516-eb8a4ee4eed4

**2026-10-26T07:03:57Z — 本轮复核（worker；未新增代码改动，仅记录判读）**

- 合并 develop 后逐条复核 7/7 AC 全绿：AC1 `0` / `ensureColumns` @76；AC2 `12`；AC3 `setProjectFlag` @37 + awk exit 0；AC4 tests 2/pass 2；AC5 tests 18/pass 18；AC6 tests 11/pass 11 + merge-base diff empty；AC7 `tsc --noEmit -p server/tsconfig.json` 与 `oxlint server/modules/database` 均 exit 0。anti-drift-touches-check exit 0（5 个实际文件全在 Touches 内）。
- 本轮 suite 红的归因（三分）：**不是本任务引入，是 develop 全局红**。打红读数 `semanticZoomLayout.ts 1642→1688`（单文件复跑还有 `semanticZoomPlan.ts 876→894`）来自 develop 提交 `3f1b1ea23`（2026-10-26 13:53:44），晚于基线落盘（`f7d20cdcb`，13:42:54），而该提交没有按 ratchet 自己的规则记录上调。证据：测试文件、基线 JSON、两个源文件在 HEAD 与 develop 上 blob 逐字节相同；驱动自己的 develop 基线腿日志 `fan-in-suite-…~baseline-1792995096459-4e4caf.log` 逐字打印同一条断言（`passed=false`）。
- `changed-assertion` 是结构性假阳性：`baselineEquivalence.changed[0].taskText=""`、`added=[]`。全量 suite 日志把 `not ok -` 攒到末尾（本任务日志第 789 行），而 `__PERFILE__` 在第 97 行，8 行 lookahead 取不到 marker；基线单文件日志里两者相邻，于是 marker 文本非空。两侧 tap 文本逐字相同。
- 真因收口（在 `src/modules/architecture/**` 与基线 JSON，**不在本任务 Touches**，本轮未动）：由架构侧按 `architecture-ratchet.baseline.json` 的 `note` 规定的“RECORDED CHANGE”格式，为 `3f1b1ea23` 记录的 1642→1688 / 876→894 上调写一段带日期的理由，再用 `ARCHITECTURE_RATCHET_WRITE_BASELINE=1` 重生成该基线；或把两个文件缩回基线。注意 `gap-architecture-orientation-policy-compares-pre-reclaim-geometry` 正在改 `semanticZoomLayout.ts`，修后需复量。

## Needs-Human

**执行 2026-10-26T07:10:17.416Z — 停派终止（失败无法归因，⛔ 不再重派）**

- 阻碍原因：LOOP DEADLOCK: task gap-database-migration-column-and-flag-helpers has been blocked by the SAME pre-existing red set for 3 consecutive fan-in rounds (signature unchanged across rounds). Blocked red points: server/shared/tests/architecture-ratchet.test.ts. No other task in the carrier shares this signature yet — if more arrive, they are mutually landing gates. Suggested resolution: land ANY ONE of them first (each one's own fix is outside the blocked set, so the red set does not grow); the others' blocked sets then shrink by that red point and they land in turn. If a landing still makes it worse, a human must decide the order. ⛔ The gates were NOT relaxed: every new/changed red point still hard-fails this task (baseline-equivalence exemption never covers a red the task introduced). — 停止自动重派（电路断路器：同一既存红签名连续 3 轮未变）。⛔ 判据未放宽：本次新增 / 断言文本变化的红点仍然硬红（既存红等价豁免只覆盖「不变差」的方向）。
- 失败步/判词：step=suite: not ok - server/shared/tests/architecture-ratchet.test.ts:   AssertionError [ERR_ASSERTION]: ratchet: oversizeFiles src/modules/architecture/semanticZoomLayout.ts 1642→1688 — 基线内读数不得上调（此基线只允许下降） [baseline A/B: HARD RED (changed-assertion) — the task's red set is NOT a subset of the develop baseline red set: added=- changed=server/shared/tests/architecture-ratchet.test.ts]
- run_id：wk-prod-anchor
- session_id：86f3cef9-f1a6-4cda-ad0d-1085c8d8c307
- suite 日志：/data/home/yale/work/claudecodeui/.quay/fan-in-suite-gap-database-migration-column-and-flag-helpers~wk-prod-anchor~1792998257198-ce314c.log
- fan-in 日志：/data/home/yale/work/claudecodeui/.quay/fan-in-gap-database-migration-column-and-flag-helpers-wk-prod-anchor.log

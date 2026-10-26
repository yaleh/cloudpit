---
id: gap-database-migration-column-and-flag-helpers
title: 数据库样板收敛：12 个 add*Column 迁移改用 ensureColumns，projects 的 4 个
  isStarred/isArchived 写入合成一个私有 setter
status: ready
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

## Touches

- server/modules/database/migrations.ts
- server/modules/database/repositories/projects.db.ts
- server/modules/database/tests/migrations-ensure-columns.test.ts (new)
- server/shared/tests/quay-test-script.test.ts
- scripts/suite-duration-baseline.tsv
- tasks/gap-database-migration-column-and-flag-helpers.md
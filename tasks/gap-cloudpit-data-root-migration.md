---
id: gap-cloudpit-data-root-migration
title: Cloudpit A2：数据根解析与旧布局迁移（默认仍 ~/.cloudcli，显式 CLOUDPIT_HOME 才走新根）
status: done
labels:
  - gap
parent: null
children: []
extra:
  schema: execution
goal_ac: AC-449
---
## Proposal

GOAL-053 的第二条暗管道任务（A2）。把「数据根解析 + 旧布局迁移」做成一个可独立验证、默认行为不变的纯函数，供 GOAL-054 接线；本任务不接任何生产入口。AC-449 的判据文件就是本任务要新增的 `server/shared/tests/cloudpit-data-root.test.ts`。

### 语义（默认不变）

`server/shared/data-root.ts` 导出 `resolveDataRoots(options?: { env?, homeDir?, fs?, backupDatabase? })`，返回 `ResolvedDataRoots`：

| 场景 | activeRoot | 迁移 | reason |
|---|---|---|---|
| 未设 `CLOUDPIT_HOME` / `CLOUDCLI_HOME` | `<home>/.cloudcli` | 不迁移 | `default-legacy` |
| 显式设置 + 旧根存在 + 新根无标记 | 显式根 | 迁移 | `explicit-migrated` |
| 显式设置 + 新根已有 `.migrated-from-cloudcli` | 显式根 | 跳过 | `explicit-already-migrated` |
| 显式设置 + 新根已存在且非空、无标记 | 显式根（不覆盖） | 跳过 | `explicit-user-root` |
| 显式设置 + 旧根不存在 | 显式根 | 不迁移 | `explicit-no-legacy` |
| 迁移任一步失败（含 SQLite 备份抛错 / BUSY） | `<home>/.cloudcli` | 回滚 | `fallback-after-failure` |

显式根取 `env.CLOUDPIT_HOME`，为空再回退 `env.CLOUDCLI_HOME`（SPEC §4.1），`~` 用 `server/shared/settings-file.ts` 已有的 `expandHome` 展开。返回对象同时给出 `authDatabasePath`、`voiceDataDir`、`cockpitCardFeedbackPath`、`replySuggestionsUsagePath`、`settingsPath`、`legacySettingsPath`，全部由 activeRoot/home 推导：默认模式 `settingsPath` 仍是 `<home>/.config/claudecodeui/server.settings.json`，显式模式为 `<home>/.config/cloudpit/server.settings.json`（配置根独立于数据根，遵循 SPEC §4.4）。

### 迁移实现（`server/shared/data-root-migration.ts`）

- 迁移顺序固定：先做 SQLite 一致性备份（`VACUUM INTO`，不裸 `cp`；源库以 readonly 打开，拿不到一致快照就抛错），再复制 `voice-data/`、`cockpit-card-feedback.json`、`reply-suggestions-usage.jsonl`，再复制旧 `server.settings.json` 到新配置根，最后写 `.migrated-from-cloudcli`（JSON：`source` / `at` / `version`）。标记最后写，保证「有标记 == 迁移完整」。
- 只在目标不存在时写入；旧根只读，不 rename、不 unlink、不做 checkpoint。
- 失败回滚：本次自己创建的显式根目录与已复制的新设置文件一并删除，返回旧根，旧根不动，因此不会留下半套新根。
- 备份默认实现用 better-sqlite3（仓库已有依赖）：`new Database(source, { readonly: true, fileMustExist: true })` 后 `VACUUM INTO '<转义后的目标路径>'`。旧库被占用 / WAL 下拿不到一致快照时该调用抛错，正是回退臂；测试用注入的 `backupDatabase` 抛 `SQLITE_BUSY` 覆盖同一路径。
- 不迁移 `assets`（属于 AC-450）。

### 约束

- 不新增目录；新文件都在既有 `server/shared/` 下，AC-394 的 leaf-dir manifest 不需要动。
- 不碰 `server/shared/utils.ts`、`server/shared/types.ts`（oversize 棘轮只降不升）：公共返回类型定义在 `data-root.ts`，迁移函数的入参类型定义在迁移文件内。
- 不接线：`server/load-env.ts`、`server/modules/cli/cli.module.ts`、`server/index.ts`、`server/modules/voice/*`、`server/modules/reply-suggestions/*` 一律不改，默认路径逐字不变；GOAL-054 才调用。
- 无模块级可变状态；所有 IO / SQLite 经参数注入，决策逻辑可复跑。
- 新增 server 测试文件会把 collected 数 +1。当前 `scripts/suite-duration-baseline.tsv` 覆盖 434/482 = 90.04%，再 +1 就会跌破测试里的 90% 覆盖下限，所以必须给新测试文件补一行实测时长（见 AC9）。

<!-- dedup-ref --> 相关但不同：`gap-cloudpit-brand-env-fallback` 做的是通用 `CLOUDPIT_*` → `CLOUDCLI_*` reader；本任务只做数据根解析与迁移，不 import 它、不复用其状态。granularity：`task-granularity-advice` 对本任务 Touches 返回 `peers: []`、`mentions: []`，无合并候选。

## AC

- [x] AC1 `npx tsx --tsconfig server/tsconfig.json --test server/shared/tests/cloudpit-data-root.test.ts` 退出 0；输出含 `# fail 0`。
- [x] AC2 默认臂：`resolveDataRoots({ env: {}, homeDir })` 返回 `activeRoot === path.join(homeDir, '.cloudcli')`、`reason === 'default-legacy'`、`migrated === false`，且 `<homeDir>/.cloudpit` 不存在；测试里同时断言「默认若返回 `~/.cloudpit` 即红」。
- [x] AC3 迁移臂：显式 `CLOUDPIT_HOME=<tmp>/new-root` 且旧布局夹具存在时，`reason='explicit-migrated'`、`migrated=true`；`newRoot/auth.db` 用 better-sqlite3 打开后能读到夹具写入的行；`voice-data`、`cockpit-card-feedback.json`、`reply-suggestions-usage.jsonl` 逐字节等于旧根；`<home>/.config/cloudpit/server.settings.json` 存在且内容等于旧设置文件。
- [x] AC4 旧根逐字未改：迁移前后对旧根（含 `<home>/.config/claudecodeui/`）递归取「相对路径 → SHA256」集合，两个集合完全相等（文件增删或内容变化即红）。
- [x] AC5 新写入落新根：在 `plan.replySuggestionsUsagePath` 追加一行后新根文件增长而旧根同名字节不变；`plan.voiceDataDir === path.join(plan.activeRoot, 'voice-data')`、`plan.authDatabasePath === path.join(plan.activeRoot, 'auth.db')`。
- [x] AC6 可重入：第一次迁移后改写 `newRoot/reply-suggestions-usage.jsonl` 的哨兵内容，再次 `resolveDataRoots` 返回 `migrated=false`、`reason='explicit-already-migrated'`，哨兵仍在（没有被重新复制覆盖）；`newRoot/.migrated-from-cloudcli` 的 JSON `source` 等于旧根。
- [x] AC7 安全臂：新根已存在且非空、无标记时返回 `reason='explicit-user-root'` 且不删除 / 不覆盖既有文件；旧根不存在时返回 `reason='explicit-no-legacy'`、`activeRoot===显式根`、不创建空迁移标记。
- [x] AC8 失败回退：注入 `backupDatabase` 抛 `SQLITE_BUSY` 时返回 `activeRoot===<home>/.cloudcli`、`reason='fallback-after-failure'`、`settingsPath===<home>/.config/claudecodeui/server.settings.json`；`newRoot` 目录不存在（或本次创建的部分已被删除）、新设置文件不存在、没有迁移标记。
- [x] AC9 钉子与覆盖：用 `find server -name '*.test.ts' -o -name '*.test.js' | grep -v node_modules | wc -l` 测得 N；`server/shared/tests/quay-test-script.test.ts` 两处钉子更新为 `known=3 unknown=<N-3>` 与 `known=1 unknown=<N-1>`，`npx tsx --tsconfig server/tsconfig.json --test server/shared/tests/quay-test-script.test.ts` 退出 0；`scripts/suite-duration-baseline.tsv` 增加 `<实测ms>\tserver/shared/tests/cloudpit-data-root.test.ts` 一行。
- [x] AC10 没有生产接线：`git grep -n 'resolveDataRoots' -- server src electron` 只命中 `server/shared/data-root.ts` 与测试文件；`git diff develop...HEAD -- server/load-env.ts server/modules/cli/cli.module.ts server/index.ts server/shared/utils.ts server/shared/types.ts` 为空。
- [x] AC11 `npm run typecheck` 退出 0；`npx oxlint server/shared/data-root.ts server/shared/data-root-migration.ts server/shared/tests/cloudpit-data-root.test.ts server/shared/tests/quay-test-script.test.ts` 退出 0；两个新源文件各 ≤260 行。

## DoD

- 真实运行 AC1 的命令并贴出 `# tests` / `# pass` / `# fail` 三行，不是只声称通过。
- 逐条贴出 AC2–AC8 的读数：默认 activeRoot/reason、迁移后从新库读出的行、五个夹具的目标路径与字节比较结果、迁移前后旧根 SHA256 集合（完整列表）、二次启动的 reason 与哨兵、失败臂的 activeRoot 与 newRoot 是否存在。
- 贴出 `.migrated-from-cloudcli` 的 JSON 原文与 `stat` 的 mtime，说明标记是最后写入的。
- 贴出 N 的测量命令与输出、两处钉子 diff、baseline 新行；贴出 `quay-test-script.test.ts` 的末行。
- 贴出 `git grep -n 'resolveDataRoots'` 完整结果与 `git diff --name-only develop...HEAD`，后者只允许 Touches 文件。
- 贴出 `npm run typecheck`、`npx oxlint ...` 的退出码与两个新源文件的 `wc -l`。
- 不新增目录；不改默认数据根 / 设置路径；不迁移 assets。
- anti-drift：`git diff --name-only develop...HEAD` 只列出 `## Touches` 的文件（含本任务文件）。

## Touches

- server/shared/data-root.ts (new)
- server/shared/data-root-migration.ts (new)
- server/shared/tests/cloudpit-data-root.test.ts (new, AC-449 criterion)
- server/shared/tests/quay-test-script.test.ts (collateral: collected server test-file count pins N-3 / N-1)
- scripts/suite-duration-baseline.tsv (collateral: one measured row for the new criterion keeps 434/482-shaped coverage above the 90% floor)
- tasks/gap-cloudpit-data-root-migration.md

## Verification（DoD 读数，2026-10-31，worktree `gap-cloudpit-data-root-migration`）

### AC1 真实运行

`npx tsx --tsconfig server/tsconfig.json --test server/shared/tests/cloudpit-data-root.test.ts` → exit 0

```
ℹ tests 9
ℹ pass 9
ℹ fail 0
```

### AC2 默认臂

```json
{ "activeRoot": "/tmp/cloudpit-dod-C6nmAr/home-ac2/.cloudcli", "reason": "default-legacy", "migrated": false, "dotCloudpitExists": false, "settingsPath": "/tmp/cloudpit-dod-C6nmAr/home-ac2/.config/claudecodeui/server.settings.json" }
```

测试另外断言 `plan.activeRoot !== path.join(homeDir, '.cloudpit')`（默认若返回 `~/.cloudpit` 即红）。

### AC3 迁移臂

```json
{
  "activeRoot": "/tmp/cloudpit-dod-C6nmAr/new-root",
  "reason": "explicit-migrated",
  "migrated": true,
  "rows": [{ "id": 1, "label": "legacy-row" }],
  "byteChecks": [
    { "rel": "voice-data/recording-1.wav", "equal": true },
    { "rel": "voice-data/manifest.json", "equal": true },
    { "rel": "cockpit-card-feedback.json", "equal": true },
    { "rel": "reply-suggestions-usage.jsonl", "equal": true }
  ],
  "settingsEqual": true
}
```

五个夹具的目标路径：`new-root/auth.db`（新库读出 `{id:1,label:'legacy-row'}`）、`new-root/voice-data/*`、`new-root/cockpit-card-feedback.json`、`new-root/reply-suggestions-usage.jsonl`、`<home>/.config/cloudpit/server.settings.json`（内容逐字节等于旧设置）。

### `.migrated-from-cloudcli` 原文与 mtime

```json
{
  "source": "/tmp/cloudpit-dod-C6nmAr/home/.cloudcli",
  "at": "2026-10-31T06:46:05.632Z",
  "version": "probe"
}
```

`stat.mtimeMs = 1793429165632.1257`；被复制源文件的最新 mtime = `1793429165622.1257`，`markerWrittenLast: true`——标记是最后写入的。

### AC4 迁移前后旧根 SHA256 集合（完整）

迁移前 = 迁移后：

```
data/auth.db                                f6c25d136a9c164f381e0d229767faf1e60ac31ea6368bc8f9a124210e510f10
data/cockpit-card-feedback.json             76d2c22192b34e7587fd9ce81edcbe74ff6ad33abb825f58b8afbefb5cedfd05
data/reply-suggestions-usage.jsonl          edf26e2bdad50b10225b2d2eb9472db1ad13416b4351c8c162ad13bf3c254102
data/voice-data/manifest.json               5921df11c55ea5e46b8b5fcc52b43ef20a44110d72ba74cf692cfccfa96c1960
data/voice-data/recording-1.wav             35b9e86fb00cf111c910f841acf06dd80c9567a809bcf1807f20f20910311b7f
config/server.settings.json                 242b6d5bf2ebab60c46bd6147660271b43bb502aabc85d0b000dd82aa0dd469d
```

### AC5 新写入落新根

```json
{ "replySuggestionsUsagePath": "/tmp/cloudpit-dod-C6nmAr/new-root/reply-suggestions-usage.jsonl", "voiceDataDir": "/tmp/cloudpit-dod-C6nmAr/new-root/voice-data", "authDatabasePath": "/tmp/cloudpit-dod-C6nmAr/new-root/auth.db", "newSizeBefore": 26, "newSizeAfter": 41, "legacyUnchanged": true }
```

### AC6 二次启动

```json
{ "reason": "explicit-already-migrated", "migrated": false, "sentinel": "{\"id\":\"sentinel\"}", "markerSource": "/tmp/cloudpit-dod-C6nmAr/home/.cloudcli", "legacyRoot": "/tmp/cloudpit-dod-C6nmAr/home/.cloudcli" }
```

### AC7 两个安全臂

```json
{ "reason": "explicit-user-root", "migrated": false, "activeRoot": "/tmp/cloudpit-dod-C6nmAr/user-root", "userFile": "do not touch", "markerExists": false }
{ "reason": "explicit-no-legacy", "migrated": false, "activeRoot": "/tmp/cloudpit-dod-C6nmAr/no-legacy-new", "expectedRoot": "/tmp/cloudpit-dod-C6nmAr/no-legacy-new", "markerExists": false }
```

### AC8 失败回退（独立 home，备份注入 `SQLITE_BUSY`）

```json
{ "activeRoot": "/tmp/cloudpit-dod-FiANt3/home-fail/.cloudcli", "expectedLegacyRoot": "/tmp/cloudpit-dod-FiANt3/home-fail/.cloudcli", "reason": "fallback-after-failure", "migrated": false, "settingsPath": "/tmp/cloudpit-dod-FiANt3/home-fail/.config/claudecodeui/server.settings.json", "newRootExists": false, "newSettingsExists": false, "markerExists": false }
```

### AC9 钉子与覆盖

测量：`find server -name '*.test.ts' -o -name '*.test.js' | grep -v node_modules | wc -l` → `485`。

两处钉子 diff：

```
-    // server test files). This fixture names 3 known files, so 484 - 3 = 481.
-    assert.match(lines[0], /^test\.sh: server dispatch order=longest-first source=.* known=3 unknown=481$/);
+    // server test files). Then gap-cloudpit-data-root-migration added its criterion
+    // server/shared/tests/cloudpit-data-root.test.ts (484 + 1 = 485 collected
+    // server test files). This fixture names 3 known files, so 485 - 3 = 482.
+    assert.match(lines[0], /^test\.sh: server dispatch order=longest-first source=.* known=3 unknown=482$/);
-    assert.match(vl[0], /^test\.sh: server dispatch order=longest-first source=.* known=1 unknown=483$/);
+    assert.match(vl[0], /^test\.sh: server dispatch order=longest-first source=.* known=1 unknown=484$/);
```

`npx tsx --tsconfig server/tsconfig.json --test server/shared/tests/quay-test-script.test.ts` → exit 0，末行 `ℹ fail 0`（14 tests / 14 pass）。

baseline 新行：

```
2180	server/shared/tests/cloudpit-data-root.test.ts
```

覆盖：436/484 原为 90.08%，新增判据后 437/485 = 90.10%（≥ 90%）。

### AC10 无生产接线

`git grep -n 'resolveDataRoots' -- server src electron` 完整结果：

```
server/shared/data-root.ts:11,25,65,146
server/shared/tests/cloudpit-data-root.test.ts:30,127,144,185,198,207,226,232,250,266,282
```

`git diff develop...HEAD -- server/load-env.ts server/modules/cli/cli.module.ts server/index.ts server/shared/utils.ts server/shared/types.ts` → 空。

### AC11 类型/静态检查与行数

- `npm run typecheck` → exit 0。
- `npx oxlint server/shared/data-root.ts server/shared/data-root-migration.ts server/shared/tests/cloudpit-data-root.test.ts server/shared/tests/quay-test-script.test.ts` → exit 0。
- `wc -l server/shared/data-root.ts` → 191；`wc -l server/shared/data-root-migration.ts` → 232（均 ≤ 260）。

### anti-drift

`anti-drift-touches-check.js --task gap-cloudpit-data-root-migration --merge-target develop` → `ANTI-DRIFT OK: 5 actual file(s), all within declared Touches (6 glob(s))`。

## 暗轴记录

该轴仍暗,理由:本任务只新增未接线的纯函数与判据，未接入任何生产入口，数据根调用点仍全部走旧路径，无可测的亮/暗读数。

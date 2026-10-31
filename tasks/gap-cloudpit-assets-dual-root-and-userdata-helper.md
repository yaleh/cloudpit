---
id: gap-cloudpit-assets-dual-root-and-userdata-helper
title: Cloudpit A3：附件双根与桌面 userData 迁移 helper（默认仍写旧根，helper 不自动执行）
status: ready
labels:
  - gap
parent: null
children: []
extra:
  schema: execution
goal_ac: AC-450
---
## Proposal

GOAL-053 的第三条暗管道任务（A3）：附件双根读取 + 桌面 userData 迁移 helper。判据文件就是本任务新增的 `server/modules/assets/tests/cloudpit-assets-dual-root.test.ts` 与 `electron/tests/cloudpit-userdata-migration.test.mjs`。默认行为必须逐字不变：新上传仍写 `~/.cloudcli/assets`，`APP_NAME` 仍是 `CloudCLI`，helper 不接线。去重/粒度：store 内没有任何任务以顶层 `goal_ac: AC-450` 承载本判据；`task-granularity-advice` 对下列 Touches 返回 `peers: []`，故独立立案。

### 附件双根（默认写旧根，读双根）

`server/shared/image-attachments.ts` 增加纯函数（可注入 `{ env, homeDir }`，便于测试离开真实 home）：

```text
legacyRoot = <homeDir>/.cloudcli/assets
explicit   = env.CLOUDPIT_HOME?.trim() || env.CLOUDCLI_HOME?.trim()   // 空串视同未设置
newRoot    = explicit ? <explicit>/assets : <homeDir>/.cloudpit/assets
writeRoot  = explicit ? newRoot : legacyRoot                          // 默认写旧根
readRoots  = 去重([newRoot, legacyRoot])                              // 新根优先（SPEC §4.3）
```

导出 `getImageAssetsRoots(options?)`、`getImageAssetsWriteDir(options?)`、`getImageAssetsReadDirs(options?)`；`getGlobalImageAssetsDir()` 保持返回旧根（现有调用方与测试的默认读数不变）。`isAllowedImageSourcePath` 的允许根从单根改为 `readRoots ∪ cwd`，仍保留 realpath 变体。

`server/modules/assets/services/image-assets.service.ts`：

- `ensureImageAssetsDir(options?)` 与 `buildStoredImageRecords(files, options?)` 用 `getImageAssetsWriteDir(options)`；单参数调用行为不变。
- 抽出 `resolveImageAssetFileInRoot(filename, root)`（纯函数，保留现有「空串 / `/` / `\` / `..` / 非直接子文件」防护），`resolveImageAssetFile(filename)` 默认仍只作用于旧根，保持既有断言。
- 新增 `findStoredAttachmentAsset(filename, options?: { roots? })`：按 `readRoots` 顺序逐个走同一防护并 `fs.access`，返回第一个存在的绝对路径，找不到返回 null。`openStoredAttachmentAsset` 改用它，因此旧根附件按文件名路由仍可读、新根同样可读；两段防护是同一个函数分别作用于两个根，不是放宽成任意路径。
- 同名文件两臂：新根优先。

`server/modules/websocket/services/chat-websocket.service.ts`：`filterAttachmentsToUploadStore(attachments, assetsRootOverride?)` 在**没有 override** 时接受任一 `readRoots` 的直接子文件（重发历史旧附件不被丢弃）；显式 override 保持单根语义，既有测试不动。`filterImagesToUploadStore` 随动。

### 桌面 userData helper（实现但不接线）

新增 `electron/userDataMigration.js`（ESM，与 `electron/main.js` 同风格，只 import node 内置模块）：

- `DESKTOP_USER_DATA_FILES = ['cloud-account.json', 'desktop-settings.json', 'desktop-notifications-settings.json']`。
- `migrateDesktopUserData({ appDataDir, oldUserDataDir?, newUserDataDir?, fs? })`：默认旧目录 `<appDataDir>/CloudCLI`、新目录 `<appDataDir>/Cloudpit`；新目录不存在且旧目录存在时创建新目录，**只复制这三个文件**（源存在且目标不存在才复制；缓存等其它文件一律不碰）；返回 `{ migrated, copied, skipped }`，可重入。
- `maybeMigrateDesktopUserData({ appName, ...same })`：`appName === 'CloudCLI'` 时直接返回 `{ migrated: false, reason: 'app-name-not-flipped' }`，不创建目录、不复制；其它名字才转调 `migrateDesktopUserData`。这是给 GOAL-054 翻转后接线的闸门。
- 模块顶层无副作用；`electron/main.js` 不 import、不调用该 helper，`APP_NAME` 保持 `CloudCLI`。

### 附带影响

- 新增一个 server 测试文件会把 `collected server test files` 计数 +1：按**最终合并树**重测两处 `known/unknown` 钉子（`server/shared/tests/quay-test-script.test.ts` 当前 482 收集 ⇒ `known=3 unknown=479` 与 `known=1 unknown=481`；每个新增文件两处 unknown 各 +1）。兄弟任务也会各加文件，不能抄它的数字，合并后以 `find server -name '*.test.ts' -o -name '*.test.js' | grep -v node_modules | wc -l` 实测值重算。
- 给 `scripts/suite-duration-baseline.tsv` 追加本判据文件的实测时长行与来源说明（惯例，AC7 只校验格式）。
- `electron/tests/` 不在 server 收集范围、也不在 oxlint / 两套 tsc include 内，故不影响其它闸门。
- 不新增模块目录；不往 `server/shared/utils.ts` 加行；不改任何生产默认值。

## AC

- [x] AC1 `npx tsx --tsconfig server/tsconfig.json --test server/modules/assets/tests/cloudpit-assets-dual-root.test.ts && npx tsx --tsconfig server/tsconfig.json --test electron/tests/cloudpit-userdata-migration.test.mjs` 退出 0，且两个文件的输出均为 `fail 0`。
- [x] AC2 旧根可读：附件判据文件的「旧根可读」用例通过——临时 legacy root 放 `old-shot.png`、new root 不放，双根查找返回 legacy 下的绝对路径；同一文件的负向控制「把旧根移走后同一查找返回 null」也通过（证明测试真的读了旧根）。
- [x] AC3 默认写旧根 / opt-in 写新根：默认臂 `getImageAssetsWriteDir({ env: {}, homeDir: tmp })` 等于 `<tmp>/.cloudcli/assets`，`buildStoredImageRecords` 的 path 以该根开头；opt-in 臂 `env.CLOUDPIT_HOME=<tmp>/new-data` 时 write dir 为 `<tmp>/new-data/assets`、records 路径以它开头，且旧根未被创建或修改。两臂在同一测试文件通过。
- [x] AC4 双根穿越防护：对 legacy 与 new 两个根分别断言 `../x`、`a/b`、`a\\b`、`..`、空串、绝对路径、子目录文件均返回 null，普通文件名返回该根下的路径；两个根各一组、同一测试文件通过。
- [x] AC5 重发旧附件不被过滤：`filterAttachmentsToUploadStore` 无 override 时接受旧根与新根的直接子文件、拒绝两根之外的路径；`isAllowedImageSourcePath` 同样接受两个根。`npx tsx --tsconfig server/tsconfig.json --test server/modules/websocket/tests/chat-attachment-filter.test.ts` 与 `npx tsx --tsconfig server/tsconfig.json --test server/shared/tests/image-attachments.test.ts` 均退出 0。
- [x] AC6 桌面 helper 复制恰 3 个文件：`electron/tests/cloudpit-userdata-migration.test.mjs` 的复制臂通过——旧 userData 放三个 JSON 与一个 `cache.bin`，新目录得到恰好三个 JSON、无 `cache.bin`；第二次调用幂等且不覆盖已修改的目标文件。
- [x] AC7 APP_NAME 未翻转不得自动执行：同一测试的 guard 臂通过——`maybeMigrateDesktopUserData({ appName: 'CloudCLI', ... })` 返回 skipped 且不创建新目录，`appName: 'Cloudpit'` 才复制；并断言 `electron/main.js` 源码不含 `migrateDesktopUserData` / `maybeMigrateDesktopUserData` 的 import 或调用，且仍有 `const APP_NAME = 'CloudCLI';`。
- [x] AC8 `server/shared/tests/quay-test-script.test.ts` 两处 `known/unknown` 钉子已按最终合并树重测并更新，`npx tsx --tsconfig server/tsconfig.json --test server/shared/tests/quay-test-script.test.ts` 退出 0。
- [x] AC9 `npm run typecheck` 退出 0；`npx oxlint server/shared/image-attachments.ts server/modules/assets/services/image-assets.service.ts server/modules/websocket/services/chat-websocket.service.ts server/modules/assets/tests/cloudpit-assets-dual-root.test.ts server/shared/tests/quay-test-script.test.ts` 退出 0。
- [x] AC10 默认行为未翻转：`npx tsx --tsconfig server/tsconfig.json --test server/modules/assets/tests/image-assets.service.test.ts`、`server/shared/tests/image-attachments.test.ts`、`server/modules/websocket/tests/chat-attachment-filter.test.ts` 各自退出 0；`git grep -n "getGlobalImageAssetsDir" -- server | grep -v test` 中默认根仍为 `~/.cloudcli/assets`；`git grep -n "APP_NAME = 'CloudCLI'" -- electron/main.js` 命中。

## DoD

- 贴出 AC1 两条命令的完整 `tests / pass / fail` 行，不是只声称通过。
- 贴出附件判据文件逐条臂的读数：旧根命中路径、默认写根、opt-in 写根、两个根的穿越拒绝清单、负向控制（移走旧根后的 null）、同名时新根优先。
- 贴出桌面判据的复制清单（三个文件名）、`cache.bin` 未复制的证据、二次调用幂等读数、`appName` 两臂的 reason。
- 贴出 `electron/main.js` 的源码扫描行（无 helper 引用、`APP_NAME` 仍为 CloudCLI）与 `readFileSync` 断言所在的测试名。
- 贴出 `quay-test-script.test.ts` 钉子 diff（两处 unknown 的实测前后值 + 新增注释）与该文件单文件运行末行；贴出 `scripts/suite-duration-baseline.tsv` 的追加 diff。
- 贴出 `npm run typecheck`、`npx oxlint ...`、以及 AC10 三个既有测试文件的退出码。
- anti-drift：`git diff --name-only develop...HEAD` 只列出 `## Touches` 的文件（含本任务文件；任务文件本身按 task_write 落点说明）。
- 提交范围只含 Touches；不新增模块目录；不往 `server/shared/utils.ts` 加行；不改任何生产默认值。
- 本任务无 UI 改动，不适用浏览器 / UI 场景 DoD。
- 该轴仍暗,理由:本任务只新增未接线的附件双根解析与桌面 userData helper，不改变任何模块依赖边，默认写入根与 APP_NAME 均未翻转。

## Verification

实现提交：`5fbbf01da`（task 分支）。所有读数在合并 develop 后的 worktree 上取得。

- AC1（完整行）：附件判据 `tests 8 / pass 8 / fail 0`，exit 0；桌面判据 `tests 4 / pass 4 / fail 0`，exit 0。
- AC2：旧根 `old-shot.png` 命中 `<tmp>/.cloudcli/assets/old-shot.png`（new root 不存在）；`rm` 该文件后同一查找返回 `null`；两根同名时返回新根路径（`AC2: the same filename resolves from the new root first`）。
- AC3：默认写根 `<tmp>/.cloudcli/assets`，`buildStoredImageRecords` 的 path 以它开头；opt-in `CLOUDPIT_HOME=<tmp>/new-data` 时写根 `<tmp>/new-data/assets`，旧根与 `~/.cloudpit` 均未被创建；`CLOUDCLI_HOME` 回退臂通过；空串/空白 env 视同未设置。
- AC4：两个根各自拒绝 `''`、`'   '`、`'../x.png'`、`'a/b.png'`、`'a\\b.png'`、`'..'`、`'/etc/passwd'`、绝对子目录文件、相对子目录文件；普通名 `shot.png` 在两个根下各自解析为该根下的路径。
- AC5：无 override 时接受旧根 `old-resend.png`、新根 `new-send.png`、裸文件名 `bare-filename.png`；拒绝 `/etc/passwd`、根外路径、两根下的 `nested/deep.png`。`isAllowedImageSourcePath` 对两个根与 cwd 为 true，对 `/etc/passwd`、根外路径、根本身（目录）为 false。既有 `chat-attachment-filter.test.ts` 5/5、`image-attachments.test.ts` 20/20 通过。
- AC6：复制清单恰为 `cloud-account.json`、`desktop-settings.json`、`desktop-notifications-settings.json`；目标目录 listing 就是这三个（无 `cache.bin`）；二次调用 `{migrated:false, copied:[], skipped:[三文件]}`，且手工改过的目标文件字节不变。
- AC7：guard 臂 `{migrated:false, reason:'app-name-not-flipped'}` 且不创建目标目录；`appName:'Cloudpit'` 才复制。源码扫描在测试 `AC7: electron/main.js does not reference the helper and still declares APP_NAME = CloudCLI` 中用 `readFileSync` 读取 `electron/main.js`：不含 `migrateDesktopUserData`、`maybeMigrateDesktopUserData`、`userDataMigration`，且仍匹配 `const APP_NAME = 'CloudCLI';`（第 14 行）。
- AC8：最终合并树收集数实测 486（`find server -name '*.test.ts' -o -name '*.test.js' | grep -v node_modules | wc -l`）；钉子 `known=3 unknown=482 → 483`、`known=1 unknown=484 → 485`；单文件运行 `tests 14 / pass 14 / fail 0`。
- AC9：`npm run typecheck` exit 0；`npx oxlint`（含 `server/modules/websocket/index.ts`）exit 0。
- AC10：`image-assets.service.test.ts` 6/6、`image-attachments.test.ts` 20/20、`chat-attachment-filter.test.ts` 5/5，均 exit 0；`getGlobalImageAssetsDir()` 仍为 `path.join(os.homedir(), '.cloudcli', 'assets')`；`git grep "APP_NAME = 'CloudCLI'" -- electron/main.js` 命中第 14 行。
- 附带 Touches：`server/modules/websocket/index.ts` —— 判据文件位于 assets 模块，`boundaries/dependencies` 禁止跨模块 deep import `chat-websocket.service.ts`，故在 websocket barrel 发布 `filterAttachmentsToUploadStore` / `filterImagesToUploadStore` 两个既有导出（未新增模块依赖边：barrel 原先已 import 同一 service）。
- 时长基线追加 `6634	server/modules/assets/tests/cloudpit-assets-dual-root.test.ts`，附来源命令与 486 收集数说明。

## Touches

- server/shared/image-attachments.ts
- server/modules/assets/services/image-assets.service.ts
- server/modules/websocket/services/chat-websocket.service.ts
- server/modules/websocket/index.ts (collateral: barrel export for the cross-module dual-root criterion)
- electron/userDataMigration.js (new)
- server/modules/assets/tests/cloudpit-assets-dual-root.test.ts (new)
- electron/tests/cloudpit-userdata-migration.test.mjs (new)
- server/shared/tests/quay-test-script.test.ts (collateral: collected server test-file count pins)
- scripts/suite-duration-baseline.tsv (collateral: duration row for the new criterion file)
- tasks/gap-cloudpit-assets-dual-root-and-userdata-helper.md

## Blocker

**2026-10-31T07:08:19.580Z — worker 未落地（exited-not-landed）**

- 未落地原因：step=suite: not ok - server/shared/tests/architecture-ratchet.test.ts:   AssertionError [ERR_ASSERTION]: ratchet: oversizeFiles server/modules/websocket/services/chat-websocket.service.ts 1970→1974 — 基线内读数不得上调（此基线只允许下降） [baseline A/B: HARD RED (task-introduced-red) — the task's red set is NOT a subset of the develop baseline red set: added=server/shared/tests/architecture-ratchet.test.ts,server/modules/quay/tests/contracts/fleet-cli-contracts.test.ts,server/shared/tests/architecture-ratchet.test.ts,server/modules/quay/tests/contracts/fleet-cli-contracts.test.ts changed=-]
- run_id：wk-prod-anchor
- session_id：86cd2a65-71e5-407f-ba0d-40a0d358302c

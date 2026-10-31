---
id: gap-cloudpit-desktop-identity-migration
title: Cloudpit B3：桌面身份迁移（APP_NAME/productName=Cloudpit、旧 userData/server
  缓存/marker 迁移、双 scheme 注册、appId 与云回调不变）
status: done
labels:
  - gap
parent: null
children: []
extra:
  schema: execution
goal_ac: AC-453
---
## Proposal

AC-453 的缺口承载任务：把 Cloudpit 的**桌面身份**从 GOAL-053 的暗管道翻到生产读取面——`APP_NAME`/`productName` 变 Cloudpit，首次启动复制旧 userData 的三个 JSON，`~/.cloudcli/server` 缓存可移动（失败则重下），`local-server.json` 新路径优先 + 旧路径回退，`cloudcli` 与 `cloudpit` 两个 scheme 都注册；同时**钉死不变项**：`appId` 仍 `ai.cloudcli.desktop`，云端登录仍 `cloudcli://auth/callback` + `app_surface=cloudcli_desktop`。AC-453 的判据文件就是本任务新增的 `electron/tests/cloudpit-desktop-identity.test.mjs`，执行结束时 `npx tsx --tsconfig server/tsconfig.json --test electron/tests/cloudpit-desktop-identity.test.mjs` 必须真实退出 0。

现状（2026-10-31 在 goal worktree `029e3bba8` 逐文件复核，非推断）：

- `electron/main.js:14` 仍 `const APP_NAME = 'CloudCLI';`；同文件 `APP_USER_MODEL_ID = 'ai.cloudcli.desktop'`、`CALLBACK_PROTOCOL = 'cloudcli'`、`CALLBACK_URL = \`${CALLBACK_PROTOCOL}://auth/callback\``。`registerProtocolHandler()`（:714-720）只对 `CALLBACK_PROTOCOL` 调 `setAsDefaultProtocolClient`。
- `electron/userDataMigration.js` 的 `migrateDesktopUserData` / `maybeMigrateDesktopUserData` 已落地但**未接线**（文件头注释明写「deliberately UNWIRED」，`electron/tests/cloudpit-userdata-migration.test.mjs` 的 AC7 还断言 `main.js` 不引用它、`APP_NAME` 仍是 CloudCLI）。
- `electron/localServer.js:16` 的 `SERVER_MARKER_PATH` 只指 `~/.cloudcli/local-server.json`；`readServerMarkerUrl` 只读这一个路径。
- `server/index.ts:2564` 的 `LOCAL_SERVER_MARKER_PATH` 也只指 `~/.cloudcli/local-server.json`，`writeLocalServerMarker` / `removeLocalServerMarker` 都用它。
- `electron/serverInstaller.js:16` 的 `DEFAULT_INSTALL_ROOT` 只指 `~/.cloudcli/server`，没有从旧根搬当前版本目录的逻辑。
- `package.json`：`build.appId` = `ai.cloudcli.desktop`（保持），`productName` = `CloudCLI`，`build.protocols` 只有 `cloudcli`，mac `CFBundleURLSchemes` 只有 `cloudcli`。
- `electron/cloud.js:247` 的 `app_surface` 已是 `cloudcli_desktop`（保持）。

AC-453 的判据当前为 `not-evaluated`（capability）：`electron/tests/cloudpit-desktop-identity.test.mjs` 不存在，goal gate 在 2026-10-31T15:06:55Z 明确拒绝预执行。缺口真实存在。

<!-- dedup-ref -->机制去重：`grep -rl '^goal_ac: *AC-453' tasks/` 为空，`task_list --search AC-453` 也只命中正文提到「AC-453 由后续任务承载」的 `gap-cloudpit-visible-identity-flip`（goal_ac=AC-451）与 `gap-cloudpit-runtime-default-flip`（goal_ac=AC-452）。以本任务 Touches 跑 `task-granularity-advice --root /data/home/yale/work/claudecodeui`，open peers 为 `gap-cloudpit-runtime-default-flip`（共享 `electron/main.js` / `package.json` / `server/index.ts`）、`gap-cloudpit-visible-identity-flip`（共享 `electron/main.js` / `electron/localServer.js` / `package.json` / `server/index.ts`）与 `gap-codex-resident-blocked-context-events`（只共享通用 `server/index.ts`）；机制不同（桌面迁移/桌面协议 vs 可见文案 vs 运行时默认值 vs Codex 重启），判定 **separate**：各自独立验收，调度器按 Touches 串行。边界：可见文案的批量翻转（翻译、CLI banner、`copyright`、错误弹窗、`localServer` 的 “Local CloudCLI” 标签）归 AC-451；数据根/settings/附件/scope/MCP/SW 归 AC-452。本任务只碰桌面身份与它们直接改红的钉子。

## Plan

1. `electron/main.js`：`const APP_NAME = 'Cloudpit';`；新增 `import { maybeMigrateDesktopUserData } from './userDataMigration.js';`；在 `bootstrap()` 里 `app.name/app.setName/process.title` 设好之后、`await app.whenReady()` 之前调用 `maybeMigrateDesktopUserData({ appName: APP_NAME, appDataDir: app.getPath('appData') })`，保证任何 `app.getPath('userData')` 读取（`getStorePath()` / settings 路径）都落在迁移后的新目录。`APP_USER_MODEL_ID`、`CALLBACK_PROTOCOL`、`CALLBACK_URL` 与 `cloud.js` 的 `app_surface` 逐字不动。
2. `electron/main.js` 协议注册：新增 `const DEEP_LINK_SCHEMES = ['cloudcli', 'cloudpit'];`，`registerProtocolHandler()` 对两个 scheme 走同一分支（dev 带 `[appEntry]`、packaged 不带），保留 `CALLBACK_PROTOCOL='cloudcli'` 作为云端回调专用协议。
3. `electron/localServer.js`：导出 `SERVER_MARKER_PATHS = [~/.cloudpit/local-server.json, ~/.cloudcli/local-server.json]`（新在前）；把 `readServerMarkerUrl` 改成接受 `{ markerPaths = SERVER_MARKER_PATHS, fsImpl = fs }`，按顺序尝试，解析出 url 就返回，全部失败返回 `null`。这样旧本地服务（只写旧 marker）仍能被读到。
4. `server/index.ts`：`LOCAL_SERVER_MARKER_PATH` 改为 `~/.cloudpit/local-server.json`；写与删都只对这条新路径操作（`mkdir` 已 recursive）。`server/modules/session-hosts/tests/resident-server-restart.test.ts:611` 的夹具 `markerPath` 同步为新路径。
5. `electron/serverInstaller.js`：`DEFAULT_INSTALL_ROOT` 改 `~/.cloudpit/server`，新增并导出 `LEGACY_INSTALL_ROOT = ~/.cloudcli/server`；新增导出 `migrateLegacyVersionDir({ legacyVersionDir, versionDir, fs: fsImpl = fs })`：目标已存在 → `{migrated:false, reason:'already-installed'}`；旧目录不存在 → `{migrated:false, reason:'legacy-missing'}`；否则 `mkdir` 新根后 `rename`，成功 → `{migrated:true, reason:'moved'}`；`rename` 抛错（跨文件系统等）→ 清掉可能残留的目标目录并返回 `{migrated:false, reason:'rename-failed'}`，由 `ensureInstalled()` 继续走下载。`ensureInstalled()` 开头调用它（仅当 `installRoot` 是默认根，显式 `CLOUDPIT_SERVER_DIR`/`CLOUDCLI_SERVER_DIR` 时不搬）。
6. `package.json`：`productName` 与 `build.productName` 翻 `Cloudpit`（若 AC-451 的任务已落成同值则保持）；`build.protocols` 保留 `{name:'CloudCLI', schemes:['cloudcli']}` 并新增 `{name:'Cloudpit', schemes:['cloudpit']}`；mac `CFBundleURLTypes[0].CFBundleURLSchemes` 同时列 `cloudcli` 与 `cloudpit`。`build.appId` 与 `build.artifactName` 不动（artifactName 归 AC-451）。
7. `electron/userDataMigration.js`：只更新头部过期注释（不再说 UNWIRED / APP_NAME 仍是 CloudCLI），实现逻辑不动。
8. `electron/tests/cloudpit-userdata-migration.test.mjs`：AC7 的源码扫描从「main.js 不引用 helper、APP_NAME=CloudCLI」翻成「main.js 导入并调用 `maybeMigrateDesktopUserData`、`APP_NAME='Cloudpit'`」；保留 guard 臂（传 `appName:'CloudCLI'` 仍 no-op，证明旧守卫没被删）。
9. 新增判据 `electron/tests/cloudpit-desktop-identity.test.mjs`（`node:test` + `node:assert/strict`，真实读写 tmp 目录，不 mock 被测路径）：
   - 源码扫描 `main.js`：`APP_NAME='Cloudpit'`、`APP_USER_MODEL_ID='ai.cloudcli.desktop'`、`CALLBACK_PROTOCOL='cloudcli'`、`CALLBACK_URL` 为 `cloudcli://auth/callback`、导入并调用 `maybeMigrateDesktopUserData`；`DEEP_LINK_SCHEMES` 含两个 scheme 且注册循环对每个调用 `setAsDefaultProtocolClient`。
   - 源码扫描 `cloud.js`：`app_surface` 仍为 `cloudcli_desktop`；`electron/main.js` + `electron/cloud.js` 全文不得出现 `cloudpit://auth/callback`（假形态「云回调改用 cloudpit://」即红）。
   - `package.json`：`build.appId==='ai.cloudcli.desktop'`、`productName`/`build.productName==='Cloudpit'`、protocols 的 scheme 并集含两个、mac `CFBundleURLSchemes` 并集含两个。
   - userData 运行时臂：tmp `appDataDir` 下建 `CloudCLI/` 放 3 个 JSON + 一个 `cache.bin`，调 `maybeMigrateDesktopUserData({appName:'Cloudpit', appDataDir})`，断言 `copied` 恰为三个声明文件、`Cloudpit/` 下只有这三个、`cache.bin` 不在；再调一次断言零复制、已编辑目标不被覆盖（假形态「旧 userData 未迁移」即红）。
   - server 缓存臂：tmp 下旧根 `<tmp>/.cloudcli/server/<version>` 放 `dist-server/server/index.js` + `.installed.json`，调 `migrateLegacyVersionDir` 断言 `migrated:true` 且新根出现该 version 目录、旧目录消失；注入 `rename` 抛错臂断言 `migrated:false, reason:'rename-failed'` 且目标目录不存在（可重下）；断言 `DEFAULT_INSTALL_ROOT` 以 `.cloudpit/server` 结尾、`LEGACY_INSTALL_ROOT` 以 `.cloudcli/server` 结尾。
   - marker 臂：用 `readServerMarkerUrl({markerPaths:[新建, 旧建], fsImpl})` 喂 tmp 文件——仅旧文件有 → 返回旧 url（假形态「marker 只读新路径」即红）；两者都有且 url 不同 → 返回新 url；两者都无 → `null`。断言 `SERVER_MARKER_PATHS[0]` 以 `.cloudpit/local-server.json` 结尾、`[1]` 以 `.cloudcli/local-server.json` 结尾。
10. 自检与 collateral：跑新判据、旧 userData 判据、`resident-server-restart` 与 `npx oxlint electron/ server/index.ts server/modules/session-hosts/tests/resident-server-restart.test.ts`、`npm run typecheck`。新增的是 electron 测试文件，`scripts/test.sh` 只收集 `server/**/*.test.ts|js`、`quay-test-script.test.ts` 的收集计数只数 server 文件，故不需要改 suite 收集钉；实现时以实跑读数确认。
11. 合入前把 develop merge 进本任务 worktree 并复跑判据；会话内不跑全量 suite（AGENTS.md 的内存上限规则）。

## AC

- [x] AC1 判据文件真实通过：`npx tsx --tsconfig server/tsconfig.json --test electron/tests/cloudpit-desktop-identity.test.mjs` 退出 0，输出含 `fail 0`；文件已落地。
- [x] AC2 桌面显示身份：同一判据断言 `electron/main.js` 有 `const APP_NAME = 'Cloudpit';`、`package.json` 的 `productName === 'Cloudpit'` 且 `build.productName === 'Cloudpit'`。
- [x] AC3 userData 首次迁移：同一判据的 tmp 夹具（旧 `CloudCLI/` 三个 JSON + `cache.bin`）经 `maybeMigrateDesktopUserData({appName:'Cloudpit'})` 后 `copied` 恰为 `cloud-account.json` / `desktop-settings.json` / `desktop-notifications-settings.json`，新 `Cloudpit/` 目录只含这三个文件，`cache.bin` 未被复制，二次调用零复制且不覆盖用户编辑；源码臂断言 `main.js` 导入并在 `bootstrap()` 调用 `maybeMigrateDesktopUserData` 且传入 `appName: APP_NAME`。
- [x] AC4 server 缓存可移动或重下：同一判据断言 `DEFAULT_INSTALL_ROOT` 以 `.cloudpit/server` 结尾、`LEGACY_INSTALL_ROOT` 以 `.cloudcli/server` 结尾；tmp 旧版本目录经 `migrateLegacyVersionDir` 被 rename 到新根且返回 `{migrated:true, reason:'moved'}`；注入 `rename` 失败的臂返回 `{migrated:false, reason:'rename-failed'}` 且新版本目录不存在（留给 `ensureInstalled()` 下载）。
- [x] AC5 marker 新路径优先、旧路径回退：同一判据断言 `SERVER_MARKER_PATHS[0]` 以 `.cloudpit/local-server.json` 结尾、`[1]` 以 `.cloudcli/local-server.json` 结尾；仅旧文件存在时 `readServerMarkerUrl` 返回旧 marker 的 url，两者都存在时返回新路径的 url，两者都不存在时返回 `null`；源码臂断言 `server/index.ts` 的 `LOCAL_SERVER_MARKER_PATH` 指向 `.cloudpit/local-server.json`。
- [x] AC6 双 scheme 注册：同一判据断言 `package.json` 的 `build.protocols` scheme 并集同时含 `cloudcli` 与 `cloudpit`、mac `CFBundleURLSchemes` 并集同；`electron/main.js` 的 `DEEP_LINK_SCHEMES` 同时含两者且注册循环对每个 scheme 调用 `setAsDefaultProtocolClient`（dev 与 packaged 两分支）。
- [x] AC7 appId 与云端回调不变：同一判据断言 `package.json` 的 `build.appId === 'ai.cloudcli.desktop'`、`main.js` 的 `APP_USER_MODEL_ID === 'ai.cloudcli.desktop'`、`CALLBACK_PROTOCOL === 'cloudcli'`、`CALLBACK_URL` 为 `cloudcli://auth/callback`、`cloud.js` 的 `app_surface` 为 `cloudcli_desktop`；并断言 `main.js` 与 `cloud.js` 全文不含 `cloudpit://auth/callback`（假形态「云回调改用 cloudpit://」即红）。
- [x] AC8 collateral 钉子：`npx tsx --tsconfig server/tsconfig.json --test electron/tests/cloudpit-userdata-migration.test.mjs` 退出 0 且含 `fail 0`（其 AC7 已翻成新接线断言）；`npx tsx --tsconfig server/tsconfig.json --test server/modules/session-hosts/tests/resident-server-restart.test.ts` 退出 0（marker 夹具已改新路径）；`npx oxlint electron/ server/index.ts server/modules/session-hosts/tests/resident-server-restart.test.ts` 退出 0；`npm run typecheck` 退出 0。

## DoD

- 贴出 AC1 的完整 `tests N / pass N / fail 0` 末行、退出码与耗时，不是只声称通过。
- 逐条贴读数：AC3 的 `copied`/`skipped` 数组与 `Cloudpit/` 目录清单；AC4 的 `migrateLegacyVersionDir` 两个 reason 与迁移前后目录树；AC5 三种 marker 夹具各自的返回值与 `SERVER_MARKER_PATHS` 两条绝对路径；AC6 的 protocols/CFBundleURLSchemes 实际 JSON；AC7 的 appId、`APP_USER_MODEL_ID`、`CALLBACK_URL`、`app_surface` 原文行。
- 贴假形态负控实测（改源码→跑判据→看红→还原）：把 `APP_USER_MODEL_ID` 或 `build.appId` 改成 `ai.cloudpit.desktop` ⇒ AC7 红；把 `CALLBACK_URL` 改成 `cloudpit://auth/callback` ⇒ AC7 红；把 `readServerMarkerUrl` 的 `markerPaths` 只留新路径 ⇒ AC5 红；删掉 `main.js` 里的 `maybeMigrateDesktopUserData` 调用 ⇒ AC3 源码臂红；把 `DEFAULT_INSTALL_ROOT` 改回 `.cloudcli/server` ⇒ AC4 红。每项贴红/绿两次读数，不用「应该会红」代替。还原后 `git status` 干净。
- 贴 AC8 三个命令的退出码与末行输出（两个 `node:test` 文件各贴 `fail 0`）。
- 贴 `package.json` 的 `productName` / `build.productName` / `build.protocols` / `build.appId` 与 mac `CFBundleURLSchemes` 的 JSON 片段。
- 说明真实桌面升级路径：本任务不执行 Electron GUI 构建/安装（无显示环境，且发布动作在 goal 之外）；用判据的 tmp 文件系统夹具替代对 `migrateLegacyVersionDir` / `maybeMigrateDesktopUserData` 的真实文件操作，并贴出实际目录树证明文件真的被复制/移动。
- anti-drift：`git diff --name-only develop...HEAD` 只列出 `## Touches` 的文件；不改 `appId`、`cloudcli://auth/callback`、`app_surface=cloudcli_desktop`；不改可见文案的批量翻转（AC-451）与运行时默认值（AC-452）。
- 不跑全量 suite（会话 cgroup 8G 上限）；只跑上述有界文件，全量走 fan-in。

## Touches

- tasks/gap-cloudpit-desktop-identity-migration.md
- electron/tests/cloudpit-desktop-identity.test.mjs (new, AC-453 criterion)
- electron/main.js (APP_NAME 翻转 + userData 迁移接线 + 双 scheme 注册)
- electron/userDataMigration.js (仅更新过期注释)
- electron/localServer.js (marker 双路径读)
- electron/serverInstaller.js (新默认根 + migrateLegacyVersionDir)
- electron/tests/cloudpit-userdata-migration.test.mjs (collateral: AC7 源码扫描翻新)
- package.json (productName/build.productName、protocols、mac CFBundleURLSchemes)
- server/index.ts (local-server marker 写新路径)
- server/modules/session-hosts/tests/resident-server-restart.test.ts (collateral: marker 夹具路径)

## Verification (worker, 2026-11-01)

### AC1 判据实跑

- 命令：`npx tsx --tsconfig server/tsconfig.json --test electron/tests/cloudpit-desktop-identity.test.mjs`
- merge develop 后复跑末段：`ℹ tests 12` / `ℹ pass 12` / `ℹ fail 0` / `ℹ cancelled 0` / `ℹ skipped 0` / `ℹ todo 0`，`duration_ms 1906.63625`，退出码 0（wall ≈ 2.8s，pre-merge 一次为 `duration_ms 1994.232924`）。

### AC3 userData 迁移读数

- first = `{"migrated":true,"copied":["cloud-account.json","desktop-settings.json","desktop-notifications-settings.json"],"skipped":[]}`
- `Cloudpit/` 清单 = `["cloud-account.json","desktop-notifications-settings.json","desktop-settings.json"]`
- second = `{"migrated":false,"copied":[],"skipped":["cloud-account.json","desktop-settings.json","desktop-notifications-settings.json"]}`
- 二次调用后用户编辑保留：`{"edited":true}`
- 实际 tmp 目录树：`CloudCLI/` 下 `cache.bin` + 三个 JSON；`Cloudpit/` 下只有三个 JSON（`cache.bin` 未被复制）。
- 源码臂：`main.js` 导入 `maybeMigrateDesktopUserData`，在 `bootstrap()` 的 `process.title = APP_NAME` 之后、`await app.whenReady()` 之前以 `appName: APP_NAME, appDataDir: app.getPath('appData')` 调用。

### AC4 server 缓存迁移读数

- `DEFAULT_INSTALL_ROOT = /data/home/yale/.cloudpit/server`
- `LEGACY_INSTALL_ROOT = /data/home/yale/.cloudcli/server`
- move = `{"migrated":true,"reason":"moved"}`；迁移前 `.cloudcli/server/9.9.9/{.installed.json,dist-server/server/index.js}`；迁移后 `.cloudcli/server/` 为空、`.cloudpit/server/9.9.9/{.installed.json,dist-server/server/index.js}`。
- rename 失败臂 = `{"migrated":false,"reason":"rename-failed"}`，目标目录不存在、旧目录仍在（留给 `ensureInstalled()` 重下）。

### AC5 marker 读数

- `SERVER_MARKER_PATHS = ["/data/home/yale/.cloudpit/local-server.json","/data/home/yale/.cloudcli/local-server.json"]`
- 仅旧 marker → `"http://127.0.0.1:4001"`；新旧都有 → `"http://127.0.0.1:4002"`（新路径优先）；都没有 → `null`。
- `server/index.ts:2573`：`const LOCAL_SERVER_MARKER_PATH = path.join(os.homedir(), '.cloudpit', 'local-server.json');`
- 源码臂：`readServerMarkerUrl` 的默认值仍为 `SERVER_MARKER_PATHS`（负控改成 `[SERVER_MARKER_PATHS[0]]` 即 AC5 红）。

### AC6 双 scheme 读数

- `build.protocols` = `[{"name":"CloudCLI","schemes":["cloudcli"]},{"name":"Cloudpit","schemes":["cloudpit"]}]`
- mac `CFBundleURLTypes` = `[{"CFBundleURLName":"CloudCLI","CFBundleURLSchemes":["cloudcli","cloudpit"]}]`
- `main.js`：`const DEEP_LINK_SCHEMES = ['cloudcli', 'cloudpit'];`；`registerProtocolHandler()` 对每个 scheme 调 `setAsDefaultProtocolClient(scheme, process.execPath, [appEntry])`（dev）与 `setAsDefaultProtocolClient(scheme)`（packaged）。

### AC7 不变项读数

- `build.appId=ai.cloudcli.desktop`、`productName=Cloudpit`、`build.productName=Cloudpit`
- `electron/main.js:15-18`：`APP_NAME = 'Cloudpit'`、`APP_USER_MODEL_ID = 'ai.cloudcli.desktop'`、`CALLBACK_PROTOCOL = 'cloudcli'`、`CALLBACK_URL = `${CALLBACK_PROTOCOL}://auth/callback``
- `electron/cloud.js:247`：`connectUrl.searchParams.set('app_surface', 'cloudcli_desktop');`
- `main.js` 与 `cloud.js` 全文均不含 `cloudpit://auth/callback`。

### AC8 collateral 读数

- `cloudpit-userdata-migration.test.mjs`：`ℹ tests 4` / `pass 4` / `fail 0`，退出码 0。
- `resident-server-restart.test.ts`：`ℹ tests 5` / `pass 5` / `fail 0`，退出码 0（wall ≈ 38.4s）。
- `npx oxlint electron/ server/index.ts server/modules/session-hosts/tests/resident-server-restart.test.ts`：退出码 0。
- `npm run typecheck`（根 + server + scripts 三个 tsconfig）：退出码 0，wall ≈ 29.3s。

### 假形态负控（改源码 → 跑判据 → 红 → 还原）

- `build.appId` → `ai.cloudpit.desktop`：AC7 红（`tests 11 / pass 10 / fail 1`，exit 1）。
- `CALLBACK_URL` → `cloudpit://auth/callback`：AC2/AC7 与 AC7 红（`tests 11 / pass 9 / fail 2`，exit 1）。
- `readServerMarkerUrl` 默认 `markerPaths` 只留新路径：AC5 红（`tests 12 / pass 11 / fail 1`，exit 1）。
- 删掉 `main.js` 的 `maybeMigrateDesktopUserData({` 调用：AC3 源码臂红（`tests 11 / pass 10 / fail 1`，exit 1）。
- `DEFAULT_INSTALL_ROOT` 改回 `.cloudcli/server`：AC4 红（`tests 11 / pass 10 / fail 1`，exit 1）。
- 每项均以 `git -C <worktree> checkout -- <file>` 还原，还原后 `git status --short` 为空（改动已提交）。

### 真实桌面升级路径

本任务不执行 Electron GUI 构建/安装（无显示环境，且发布动作在 goal 之外）。判据用 tmp 文件系统夹具真实执行 `migrateLegacyVersionDir` 与 `maybeMigrateDesktopUserData`，上面贴出的目录树即文件真的被复制/移动的证据。

### anti-drift

- `node --no-warnings .../anti-drift-touches-check.js --task gap-cloudpit-desktop-identity-migration --worktree <worktree> --merge-target goal/GOAL-054` → `ANTI-DRIFT OK: task gap-cloudpit-desktop-identity-migration — 9 actual file(s), all within declared Touches (10 glob(s))`，exit 0。
- 本任务相对 `goal/GOAL-054` 的增量恰为上述 9 个 Touches 文件；在 goal-rooted 分支上 `git diff --name-only develop...HEAD` 还会列出 goal 分支自 develop 分叉以来继承的兄弟任务文件（非本任务改动），反漂移以 merge-target=`goal/GOAL-054` 的机械判定为准。
- 未改 `appId`、`cloudcli://auth/callback`、`app_surface=cloudcli_desktop`；未碰 AC-451 的可见文案批量翻转与 AC-452 的运行时默认值。

该轴仍暗,理由:本任务只改 electron/ 身份接线与 server/index.ts 的 marker 路径常量,未改 src/ 或 server/ 的 import 依赖图

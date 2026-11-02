---
id: gap-cloudpit-v30-appid-switch-migration
title: Cloudpit v3.0：appId 切换到 ai.cloudpit.desktop + 一次性安装迁移器
status: done
labels:
  - gap
parent: null
children: []
extra:
  schema: execution
depends_on:
  - gap-cloudpit-v30-env-data-settings-removal
  - gap-cloudpit-v30-identity-contract-removal
---
## Proposal

P3 退场计划的 v3.0 第三批：把 Electron appId 从 `ai.cloudcli.desktop` 切到 `ai.cloudpit.desktop`，并交付一次性安装迁移器。这是 3.0 唯一改变桌面应用身份的动作，必须保留旧安装与旧 userData 的回滚路径。

范围：

1. **appId**：`package.json` 的 `build.appId` 改为 `ai.cloudpit.desktop`；`electron/main.js` 的 `APP_USER_MODEL_ID` 同步，并确保 `app.setAppUserModelId(APP_USER_MODEL_ID)` 在 ready 前/后按现有顺序调用；`scripts/release/prepare-desktop-app.js` 继续从 package.json 读取，不硬编码。
2. **userData 迁移**：沿用 `electron/userDataMigration.js` 的 `DESKTOP_USER_DATA_FILES`（3 个 JSON）与 `maybeMigrateDesktopUserData`；3.0 安装器首次启动对旧 appId/旧 userData 目录做一次幂等复制，不覆盖用户已编辑的新文件。
3. **安装迁移**：
   - Windows：NSIS 卸载注册表项、开始菜单/任务栏固定、AppUserModelId；新 appId 首次启动检测旧 appId 安装并复制凭据，保留旧安装，不自动卸载；失败回退旧安装。
   - macOS：CFBundleIdentifier 跟随 appId；钥匙串条目按旧 bundle id 读取一次并迁移/复制；失败保留旧条目。
   - Linux：`.desktop` 文件的 `StartupWMClass`/app id 更新；旧 `.desktop` 保留。
   实现放在一个可测试的纯迁移模块（建议 `electron/appIdMigration.js`，注入 fs/paths，不直接碰真实注册表），由 `electron/main.js` 在首次启动调用。
4. **保留**：`cloudcli://auth/callback` 与 `app_surface=cloudcli_desktop` 不变；旧安装包/旧 appId 注册项不删除；R14 brief/reply itemRef 不受影响。

## AC

- [x] `package.json` 的 `build.appId` 逐字 `ai.cloudpit.desktop`；`electron/main.js` 的 `APP_USER_MODEL_ID` 同值，并仍调用 `app.setAppUserModelId`；`prepare-desktop-app.js` 无硬编码 appId。
- [x] `electron/appIdMigration.js` 提供纯函数/工厂（注入 fs、路径、平台），返回 `{migrated, copied, skipped, error, backupPath}` 之类可读结果；同一输入二次运行幂等，不覆盖新文件，失败时旧安装/旧 userData 保持可用。
- [x] userData 三文件迁移：旧 `CloudCLI` 目录的 `cloud-account.json`、`desktop-settings.json`、`desktop-notifications-settings.json` 首次复制到新 `Cloudpit` 目录；已有新文件不覆盖；旧目录不删除。
- [x] 安装迁移判据（每个平台一条）：Windows 注册表/开始菜单/任务栏、macOS bundle id/钥匙串、Linux `.desktop` 的目标值正确；旧安装项保留；失败回退读数正确；测试用注入的 fake fs/registry/keychain，不写真实宿主。
- [x] 云端契约不变：`cloudcli://auth/callback` 仍解析，`app_surface=cloudcli_desktop` 仍在 `electron/cloud.js`；`cloudpit-desktop-identity.test.mjs` 的 appId 断言改为新值、云回调断言不变。
- [x] 测试与静态检查：新增 `electron/tests/cloudpit-appid-migration.test.mjs`；更新 `electron/tests/cloudpit-desktop-identity.test.mjs`、`electron/tests/cloudpit-userdata-migration.test.mjs`；`npm run typecheck`、`npx oxlint` 对改动文件退出 0。
- [x] anti-drift：`git diff --name-only develop...HEAD` 只列出 `## Touches` 的文件。

## DoD

**appId 新旧对照**

```
OLD develop  package.json:76  "appId": "ai.cloudcli.desktop"
OLD develop  electron/main.js:17  const APP_USER_MODEL_ID = 'ai.cloudcli.desktop';
NEW worktree package.json:76  "appId": "ai.cloudpit.desktop"
NEW worktree electron/main.js:17  const APP_USER_MODEL_ID = 'ai.cloudpit.desktop';
NEW worktree electron/main.js:35  app.setAppUserModelId(APP_USER_MODEL_ID);
prepare-desktop-app.js:75  appId: packageJson.build.appId,   (ai.cloudcli.desktop 0 hits / ai.cloudpit.desktop 0 hits)
```

**三平台夹具读数（注入 fake fs/registry/keychain，不写真实宿主）**

```
WIN first  {"platform":"win32","migrated":true,"copied":["windows-start-menu","windows-taskbar","windows-registry"],"skipped":[],"error":null,"backupPath":null}
WIN target {"DisplayName":"Cloudpit","DisplayVersion":"3.0.0","InstallLocation":"C:\\Program Files\\Cloudpit","AppUserModelId":"ai.cloudpit.desktop","StartMenuShortcut":".../Start Menu/Programs/Cloudpit.lnk","TaskbarPinnedShortcut":".../User Pinned/TaskBar/Cloudpit.lnk","LegacyAppUserModelId":"ai.cloudcli.desktop"}
WIN legacy {"DisplayName":"CloudCLI","AppUserModelId":"ai.cloudcli.desktop","InstallLocation":"C:\\Program Files\\CloudCLI"} legacy shortcuts kept: true
WIN second {"migrated":false,"copied":[],"skipped":["windows-start-menu:already-migrated","windows-taskbar:already-migrated","windows-registry:already-migrated"],"error":null}
WIN fail   {"migrated":true,"copied":["windows-start-menu","windows-taskbar"],"error":{"artifact":"windows-registry","code":"EACCES","message":"registry write denied"}} newKey=null legacy=<unchanged>
MAC first  {"platform":"darwin","migrated":true,"copied":["macos-keychain"],"skipped":[],"error":null,"backupPath":null}
MAC new    {"service":"ai.cloudpit.desktop","account":"yale@example.com","password":"legacy-secret"}
MAC legacy {"account":"yale@example.com","password":"legacy-secret"}   (kept)
MAC second {"migrated":false,"copied":[],"skipped":["macos-keychain:already-migrated"]}
MAC fail   {"migrated":false,"error":{"artifact":"macos-keychain","code":"EACCES","message":"keychain write denied"}} legacy=<unchanged>
LINUX first  {"platform":"linux","migrated":true,"copied":["linux-desktop-entry"],"skipped":[],"error":null}
LINUX target Name=Cloudpit / StartupWMClass=Cloudpit / X-Cloudpit-AppId=ai.cloudpit.desktop / Exec=/opt/cloudpit/cloudpit-desktop %U
LINUX legacy kept: true
LINUX second {"migrated":false,"skipped":["linux-desktop-entry:already-migrated"]} content=user-edited (not overwritten)
LINUX fail   {"migrated":false,"error":{"artifact":"linux-desktop-entry","code":"EACCES"}} legacy kept: true
```

macOS bundle id：`MACOS_BUNDLE_IDENTIFIER === package.json build.appId === ai.cloudpit.desktop`，且 `build.mac.extendInfo` 无 `CFBundleIdentifier` 覆盖（electron-builder 由 appId 派生）。

**userData 三文件迁移前后目录清单**

```
before legacy CloudCLI: ["cache.bin","cloud-account.json","desktop-notifications-settings.json","desktop-settings.json"]
first   copied=["user-data:cloud-account.json","user-data:desktop-settings.json","user-data:desktop-notifications-settings.json"] backupPath=.../CloudCLI
after  target Cloudpit: ["cloud-account.json","desktop-notifications-settings.json","desktop-settings.json"]   (cache.bin 未复制)
after  legacy CloudCLI: 四个文件仍在（旧目录不删除）
second  copied=[] skipped=[三个 user-data:...] cloud-account.json={"email":"new@example.com"}   (用户编辑未被覆盖)
```

**云端契约 grep**

```
electron/main.js:18  const CALLBACK_PROTOCOL = 'cloudcli';
electron/main.js:19  const CALLBACK_URL = `${CALLBACK_PROTOCOL}://auth/callback`;
electron/main.js:307 if (parsed.protocol !== `${CALLBACK_PROTOCOL}:` || parsed.hostname !== 'auth')
electron/cloud.js:247 connectUrl.searchParams.set('app_surface', 'cloudcli_desktop');
electron/ 中 cloudpit://auth/callback 仅出现在测试的「不得存在」断言里（0 条活代码命中）
```

**测试与静态检查**

```
electron/tests/cloudpit-appid-migration.test.mjs        tests 16 / pass 16 / fail 0   exit 0
electron/tests/cloudpit-desktop-identity.test.mjs       tests 12 / pass 12 / fail 0   exit 0
electron/tests/cloudpit-userdata-migration.test.mjs     tests  4 / pass  4 / fail 0   exit 0
npm run typecheck                                        exit 0
npx oxlint <changed files>                               exit 0
```

说明：为了让 AC-459 的已达成判据不再把旧 appId 当活代码不变项，本任务还更新了 `electron/tests/cloudpit-runtime-identity-surfaces.test.mjs` 的那条 live pin（已加入 Touches）。该文件仍有一条 develop 上就存在、与本任务无关的既红断言（`src/modules/cockpit-contract/observationUri.ts` 的 dual-read 正则）；在 develop 主干同样 9 pass / 1 fail，本任务前后读数一致。

**安装迁移边界**：Windows/macOS 的 registry/keychain 宿主适配器只在 `maybeMigrateDesktopAppId`（main.js 调用）里构造，核心 `migrateAppId` 全程使用注入的接口；判据文件使用内存 fake，不读写宿主注册表/钥匙串。

该轴仍暗，理由：本任务只切桌面 appId 并复制旧安装身份，不新增领域数据能力，也没有代码/文档行数比或结构漂移的可比读数；三平台读数是布尔目标值与幂等/回退读数，不是 L_D/L_G 量。

## Touches

- package.json
- electron/main.js
- electron/userDataMigration.js
- electron/appIdMigration.js (new)
- electron/tests/cloudpit-appid-migration.test.mjs (new)
- electron/tests/cloudpit-desktop-identity.test.mjs
- electron/tests/cloudpit-userdata-migration.test.mjs
- electron/tests/cloudpit-runtime-identity-surfaces.test.mjs
- scripts/release/prepare-desktop-app.js
- tasks/gap-cloudpit-v30-appid-switch-migration.md

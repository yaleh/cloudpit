---
id: gap-cloudpit-v30-appid-switch-migration
title: Cloudpit v3.0：appId 切换到 ai.cloudpit.desktop + 一次性安装迁移器
status: todo
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

- [ ] `package.json` 的 `build.appId` 逐字 `ai.cloudpit.desktop`；`electron/main.js` 的 `APP_USER_MODEL_ID` 同值，并仍调用 `app.setAppUserModelId`；`prepare-desktop-app.js` 无硬编码 appId。
- [ ] `electron/appIdMigration.js` 提供纯函数/工厂（注入 fs、路径、平台），返回 `{migrated, copied, skipped, error, backupPath}` 之类可读结果；同一输入二次运行幂等，不覆盖新文件，失败时旧安装/旧 userData 保持可用。
- [ ] userData 三文件迁移：旧 `CloudCLI` 目录的 `cloud-account.json`、`desktop-settings.json`、`desktop-notifications-settings.json` 首次复制到新 `Cloudpit` 目录；已有新文件不覆盖；旧目录不删除。
- [ ] 安装迁移判据（每个平台一条）：Windows 注册表/开始菜单/任务栏、macOS bundle id/钥匙串、Linux `.desktop` 的目标值正确；旧安装项保留；失败回退读数正确；测试用注入的 fake fs/registry/keychain，不写真实宿主。
- [ ] 云端契约不变：`cloudcli://auth/callback` 仍解析，`app_surface=cloudcli_desktop` 仍在 `electron/cloud.js`；`cloudpit-desktop-identity.test.mjs` 的 appId 断言改为新值、云回调断言不变。
- [ ] 测试与静态检查：新增 `electron/tests/cloudpit-appid-migration.test.mjs`；更新 `electron/tests/cloudpit-desktop-identity.test.mjs`、`electron/tests/cloudpit-userdata-migration.test.mjs`；`npm run typecheck`、`npx oxlint` 对改动文件退出 0。
- [ ] anti-drift：`git diff --name-only develop...HEAD` 只列出 `## Touches` 的文件。

## DoD

- 贴出 `package.json`、`electron/main.js`、`prepare-desktop-app.js` 的 appId 读数（新旧对照）。
- 贴出 `appIdMigration` 的三平台夹具读数：目标值、旧安装保留、幂等二次运行、失败回退。
- 贴出 userData 三文件迁移的前后目录清单与「新文件不被覆盖」读数。
- 贴出云回调 `cloudcli://auth/callback` 与 `app_surface` 仍存在的 grep 读数。
- 贴出相关测试的 `tests/pass/fail` 末行与 typecheck/oxlint 退出码。
- 这是安装器/Electron 面，不需要 MCP 浏览器；若改了可见 UI 才按 AGENTS.md 补。

## Touches

- package.json
- electron/main.js
- electron/userDataMigration.js
- electron/appIdMigration.js (new)
- electron/tests/cloudpit-appid-migration.test.mjs (new)
- electron/tests/cloudpit-desktop-identity.test.mjs
- electron/tests/cloudpit-userdata-migration.test.mjs
- scripts/release/prepare-desktop-app.js
- tasks/gap-cloudpit-v30-appid-switch-migration.md

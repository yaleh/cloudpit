# Cloudpit 改名 SPEC：品牌、分发与运行时标识的全量迁移

状态：**草案（方向已裁定；兼容细节与少量标识符待实现前确认）**
日期：2026-10-31
参与：yale 与 agent
关系：本文把 `Cloudpit` 改名讨论中已达成的四个决定展开成可执行规格。本文**不实现任何代码**，也不改变任何现有 GOAL/任务的验收范围。

---

## 0. 读法

### 0.1 已裁定的事项（实现中不得静默改口）

| # | 决定 |
|---|---|
| D1 | 改名深度 = **品牌 + 分发 + 运行时全量**，并且带兼容层。 |
| D2 | `CloudCLI` 与 `ClaudeCodeUI` 保留，作为**第三方 / 本项目历史**标注；不得再用作本产品的名字。 |
| D3 | 分发使用 `@yalehwang/cloudpit` + bin `cloudpit`，**不保留 `cloudcli` 别名**；GitHub 仓库改名为 `yaleh/cloudpit`。 |
| D4 | Logo 的其他版本后续由 yale 提供；本文只定义资产规格、占位策略和发布闸门。 |

### 0.2 本文展开的内容

- 兼容矩阵：哪些标识符 2.0.0 就改、哪些新旧双读、哪些是第三方契约不能改；
- 服务端 / 桌面端的数据与配置迁移算法；
- npm、GitHub、release 资产、桌面 Local 模式的发布顺序；
- 品牌资产规格与生成链；
- 代码落点、任务拆分、验收标准、测试计划、风险与回滚、退场时间表。

### 0.3 非目标

- 不修改上游 `siteboon/claudecodeui`、`@cloudcli-ai/*`、`cloudcli.ai`、`docker.io/cloudcliai/*`；
- **不批量改写历史账本**：`tasks/`、`goals/`、`adr/`、`experiments/`、`docs/proposals/`、`CHANGELOG.md` 冻结；
- 不在本 SPEC 内执行本机部署（systemd unit、目录改名、重启）；
- 不设计最终 logo；只定义它必须满足的形状与尺寸约束。

### 0.4 事实复核（2026-10-31）

本文引用的现状读数在写作前重新核对过：

- 当前身份：`package.json:2` = `@yalehwang/cloudcli`，`package.json:7` = `CloudCLI`，`package.json:11-13` = bin `cloudcli`，`package.json:75-78` = appId `ai.cloudcli.desktop` / artifact `cloudcli-desktop-*`，版本 `1.41.0`。
- 非测试源码 / 脚本 / 配置中，`cloudcli|claudecodeui` 命中 **278 个文件 / 1202 行**；测试文件 993 个中有 **198 个**命中，其中 **78 行**是硬身份断言。
- 12 个语言包共约 **281 处**品牌文案。
- 历史账本（tasks/goals/adr/experiments/proposals/CHANGELOG）约 **1074 个文件 / 5741 行**，不改写。
- 附图在原尺寸 512 渲染下，亮部 bbox 为 **441×132**，宽高比 **3.34:1**；内容只占画布高度的 **26%**、面积的 **22%**。
- npm `cloudpit` 与 `@yalehwang/cloudpit` 在 2026-10-31 查询均为 **404（未占用）**；发布前必须再查一次。

---

## 1. 现状与约束

### 1.1 当前身份的四个层面

| 层面 | 当前值 | 位置 |
|---|---|---|
| 产品名 / UI | `CloudCLI` / `CloudCLI UI` | `index.html:8`、`src/shared/utils.ts:218`、`src/modules/i18n/locales/*/sidebar.json` |
| npm 包 | `@yalehwang/cloudcli` v1.41.0 | `package.json:2` |
| bin | `cloudcli` | `package.json:11-13` |
| 桌面应用 | productName `CloudCLI`，appId `ai.cloudcli.desktop`，协议 `cloudcli://` | `package.json:75-78,95-100`、`electron/main.js:14-18` |
| 仓库 | `yaleh/claudecodeui`（fork 自 `siteboon/claudecodeui`） | `package.json:24-31`、`README.md:7-13` |
| 上游 / 第三方 | `cloudcli.ai`、`@cloudcli-ai/cloudcli`、`docker.io/cloudcliai/sandbox`、`plugins/starter` submodule | `electron/main.js:18`、`docker/*`、`.gitmodules` |

品牌目前**没有单一源**：`APP_NAME` 在 Electron、`DEFAULT_PAGE_TITLE` 在前端、`CLOUDCLI_WORDMARK_FONT_FAMILY` 在常量、manifest / index / README 又各写一份。改名必须先收敛这一点，否则一定会留下半改状态。

### 1.2 许可证约束

`LICENSE:666-700` 的 Section 7 附加条款要求：

1. 所有修改版在文档 / README / Appropriate Legal Notices 中**保留**醒目声明：
   `CloudCLI UI (https://github.com/siteboon/claudecodeui)`；
2. 修改版必须清楚标明是修改版，**不得冒充原版 CloudCLI UI**；
3. 未经许可不得用 `CloudCLI` / `Siteboon` 做推广；
4. 不授予 `CloudCLI` / `CloudCLI UI` / `Siteboon` 商标权，只允许描述来源。

`NOTICE` 同样必须保留。改名为 Cloudpit 正好满足「不得冒充原版」，但 **LICENSE、NOTICE、上游归属说明不能删、不能藏**。

### 1.3 第三方契约（改名权不在本项目）

| 契约 | 位置 | 为什么不能单方面改 |
|---|---|---|
| 云端登录回调 | `electron/main.js:16-17`、`electron/cloud.js:244-249` | `callback_url` 与 `app_surface=cloudcli_desktop` 是 `cloudcli.ai` 服务端契约 |
| Cloud 控制平面域名 | `electron/main.js:18,199,435-441` | `cloudcli.ai` 及其 cookie / ssh 子域属于上游服务 |
| 已发放的 OAuth scope | `cloudcli:read` 等，见 `src/modules/i18n/locales/en/settings.json:929-935` | 已存于授权与 token，外部客户端也会请求旧值 |
| 上游包 / 镜像 / 插件模板 | `@cloudcli-ai/cloudcli`、`docker.io/cloudcliai/*`、`plugins/starter` | 由其他维护者发布 |
| 上游 Docker 镜像内的命令 | `server/modules/cli/sandbox.service.ts:288,390` 执行 `cloudcli start` | 容器内装的是上游包，bin 叫 `cloudcli` |

这些条目在本文中一律标为 **K（保留）**，并在用户可见处标注为第三方。

---

## 2. 命名与第三方标注规则

### 2.1 产品名

- 产品名：**Cloudpit**（一个词，首字母大写）。
- 代码 / npm / 仓库 / bin 使用小写：`cloudpit`、`@yalehwang/cloudpit`、`yaleh/cloudpit`。
- `CloudPit` 写法不在本 SPEC 采用；如后续要改，只影响展示字符串，不影响包名。

### 2.2 `CloudCLI` / `claudecodeui` 允许出现的位置

只允许在以下五类位置出现：

1. `LICENSE`、`NOTICE` 的归属与再许可说明；
2. README 的「本项目是 CloudCLI UI 的 fork」段、About 页的「Based on CloudCLI UI」链接；
3. 外部服务名称与文案：`CloudCLI Cloud`、`cloudcli.ai`；
4. 上游包 / 镜像 / 插件 / 文档 URL 与命令：`@cloudcli-ai/*`、`docker.io/cloudcliai/*`、`siteboon/claudecodeui`；
5. 历史账本与历史文档（tasks/goals/adr/experiments/proposals/CHANGELOG）。

禁止出现的位置：产品标题、浏览器标题、PWA manifest 的 name/short_name、CLI banner、窗口标题、通知标题、安装包 productName、About 页的产品名、语言包中的产品名。`claudecodeui` 还允许出现在未改名的本地目录名与旧 URL 中。

### 2.3 机器检查

新增 `scripts/brand-allowlist-check.mjs`（或放在既有 scripts 检查体系中）：

- 扫描**用户可见字符串**：`src/modules/i18n/locales/**/*.json` 的值、`index.html`、`public/manifest.json`、`README.md` 的安装块、About 文案、Electron `APP_NAME` / 菜单 / 通知；
- 发现 `CloudCLI` / `claudecodeui` 时，只接受 allowlist 中的文件或行；
- 检查器自己要有 false-form：注入一条违规字符串必须让检查变红，否则判据是空的。

注释、历史文档、上游 URL 不在扫描面内，避免把 `server/modules/cockpit` 注释里的「CloudCLI project id」也当成产品名。

---

## 3. 兼容矩阵（v2.0.0）

标记：**R** = 直接改名 + 旧值回退；**A** = 新值上线，旧值继续作为规范值；**K** = 保留旧值（第三方）。

| # | 标识符 | 旧 | 新 | 2.0.0 行为 | 退场 |
|---|---|---|---|---|---|
| 1 | npm 包 | `@yalehwang/cloudcli` | `@yalehwang/cloudpit` | R；旧包 deprecate + 最终版迁移提示 | 旧包永久保留 |
| 2 | bin | `cloudcli` | `cloudpit` | R；新包**不提供** `cloudcli` | — |
| 3 | CLI 自更新 | `npm show/update @yalehwang/cloudcli` | `@yalehwang/cloudpit` | R | — |
| 4 | 环境变量 | `CLOUDCLI_*` | `CLOUDPIT_*` | R：新名优先，旧名回退并打一次 deprecation 日志 | v3 |
| 5 | 数据根 | `~/.cloudcli` | `~/.cloudpit` | R：小状态迁移；旧根保留只读回退 | v3 |
| 6 | 设置 | `~/.config/claudecodeui/server.settings.json` | `~/.config/cloudpit/server.settings.json` | R：新路径优先，读旧路径；写新路径 | v3 |
| 7 | SQLite | `~/.cloudcli/auth.db` | `~/.cloudpit/auth.db` | R：一致性备份迁移 | v3 |
| 8 | 聊天附件 | `~/.cloudcli/assets` | `~/.cloudpit/assets` | R：新上传写新根，旧根永久可读 | 不删 |
| 9 | 桌面 userData | `appData/CloudCLI/*.json` | `appData/Cloudpit/*.json` | R：首次启动复制 3 个 JSON | v3 |
| 10 | 桌面 runtime 缓存 | `~/.cloudcli/server` | `~/.cloudpit/server` | R：移动或重新下载 | v3 |
| 11 | Electron appId | `ai.cloudcli.desktop` | `ai.cloudpit.desktop` | **A：2.0.0 保留旧 appId** | v3 |
| 12 | 云端登录协议 | `cloudcli://auth/callback` | 不变 | **K**：云端契约 | — |
| 13 | 本地 deep link | `cloudcli://` | `cloudpit://` | A：两个 scheme 都注册 | v3 |
| 14 | 内部观测 URI | `cloudcli://session/<id>`、`cloudcli://architecture/<id>` | `cloudpit://...` | A：双读；2.0.0 仍写旧值 | v3 |
| 15 | MCP server 名 | `cloudcli-browser` | `cloudpit-browser` | R：新名 emit + 旧名进 legacy 名单 | v3 |
| 16 | OAuth scope | `cloudcli:read` 等 | `cloudpit:read` 等 | A：metadata 双列，校验双接受；新授权写新 scope | v3 |
| 17 | PAT 前缀 | `ccp_` | 建议保留 | **K**：不透明标识，改名零收益 | — |
| 18 | IPC / bridge | `cloudcli-desktop:*` | `cloudpit-desktop:*` | R：随包同发，无兼容 | 2.0.0 即完成 |
| 19 | BroadcastChannel | `cloudcli-architecture` | `cloudpit-architecture` | R：随包同发，无兼容 | 2.0.0 即完成 |
| 20 | 语义面全局 | `window.__cloudcliScenario` | `window.__cloudpitScenario` | R：dev-only + e2e 同步 | 2.0.0 即完成 |
| 21 | SW 缓存 | `claude-ui-*` | `cloudpit-*` | R：清理列表同时包含两个前缀 | 2.0.0 即完成 |
| 22 | systemd unit | `claudecodeui-server.service` | `cloudpit-server.service` | R：本机 runbook，不自动替换 | 本机部署 |
| 23 | release tag / 资产 | `cloudcli-local-server-*`、`cloudcli-desktop-*` | `cloudpit-*` | R：新旧 tag 双发一版 | v3 |
| 24 | GitHub 仓库 | `yaleh/claudecodeui` | `yaleh/cloudpit` | R：GitHub 重定向，更新 remote/URL | — |
| 25 | Docker 镜像 | `docker.io/cloudcliai/sandbox` | 无 | **K**：上游镜像，标注第三方 | 另起项目 |

### 3.1 兼容矩阵的三条硬规则

1. **新值优先，旧值回退**只用于我们自己拥有的标识符；第三方契约（#12、#17、#25）不改。
2. **写新读旧**：2.0.0 起新数据写新值；旧值读取支持至少保留到 3.0。观测 URI 因已落盘，写入切换再晚一个版本。
3. **旧根永不自动删除**。用户确认数据完整后手工删除；迁移失败必须回退到旧根而不是留下半套新根。

---

## 4. 数据与配置迁移

### 4.1 服务端启动顺序

在打开数据库之前解析数据根。建议抽成 `server/shared/brand.ts`（新文件，不新建模块目录，原因见 §8）：

```text
resolveDataRoots():
  explicit = env(CLOUDPIT_HOME) ?? env(CLOUDCLI_HOME)
  if explicit: return explicit as newRoot, [] as legacyRoots

  newRoot = ~/.cloudpit
  oldRoot = ~/.cloudcli

  if exists(newRoot) and hasMigrationMarker(newRoot):
      return newRoot, legacyRoots=[oldRoot if exists]
  if exists(newRoot) and not empty(newRoot):
      return newRoot, legacyRoots=[oldRoot if exists]   # 用户手工建过
  if exists(oldRoot):
      runMigration(oldRoot, newRoot)                    # 失败则返回 oldRoot
      return newRoot, legacyRoots=[oldRoot]
  return newRoot, legacyRoots=[]
```

### 4.2 SQLite 迁移

- 用 SQLite 的一致性备份（`VACUUM INTO` 或 backup API），**不要裸 `cp`**：旧库可能有 `-wal` / `-shm`。
- 目标路径不存在才写；已存在则跳过并读新库。
- 迁移前尝试确认没有另一个旧实例在写。无法确认时仍可用 backup API 取得一致快照；如果备份失败，**本次进程回退到旧根**并告警，不创建半成品。
- 旧库保留只读备份；新进程不再写旧库。

### 4.3 聊天附件：双根读取

附件路由按**文件名**查找，不按绝对路径（`server/modules/assets/services/image-assets.service.ts:82`）。因此：

- 新上传写 `~/.cloudpit/assets`；
- 旧 `~/.cloudcli/assets` **不搬、不删**，继续可读；
- `resolveImageAssetFile` 在 `[新根, 旧根]` 中按顺序查找；
- `filterAttachmentsToUploadStore`（`server/modules/websocket/services/chat-websocket.service.ts:77`）的允许根也包含旧根，否则「重新发送一条带旧附件的消息」会被过滤；
- 历史消息里的绝对路径（`~/.cloudcli/assets/...`）继续有效，因为旧文件没动；
- 两个根的路径穿越防护都要保留，不能因为加了第二个根就放宽成任意路径。

这比「整体搬目录 + 重写历史消息路径」风险低得多：不碰转录、不碰 DB 里的绝对路径、可回滚。

### 4.4 设置、voice、日志

| 状态 | 迁移方式 |
|---|---|
| `~/.config/claudecodeui/server.settings.json` | 新路径优先；不存在时读旧路径；保存写新路径；启动日志提示旧路径 |
| `voice-data` | 跟随 DB 父目录（`server/modules/voice/voice-data.ts:235-237`）；迁移 DB 时复制到新根 |
| `voice-capture` / `voice-realtime-*` | 显式路径优先；默认值改新根；旧文件保留 |
| `reply-suggestions-usage.jsonl` | `server/modules/reply-suggestions/reply-suggestions-usage-log.ts:204` 改新根；旧文件只读 |
| `cockpit-card-feedback.json` | 迁移到新根；URI 双读 |
| `ui-view-events.jsonl` | 配置里的显式路径优先；示例配置改新根 |

### 4.5 桌面端

1. `app.name` / `app.setName` 改为 `Cloudpit` 之前，先计算：
   - `newUserData = app.getPath('userData')`（改名后是 `appData/Cloudpit`）；
   - `oldUserData = path.join(app.getPath('appData'), 'CloudCLI')`；
   - 若新目录不存在且旧目录存在，复制 `cloud-account.json`、`desktop-settings.json`、`desktop-notifications-settings.json`。只复制这三个，不复制缓存。
2. `~/.cloudcli/server/<version>` → `~/.cloudpit/server/<version>`：同文件系统用 rename；失败则让桌面重新下载当前版本。
3. `~/.cloudcli/local-server.json`：新路径优先，旧路径回退；升级时旧本地服务可能还在跑，必须能读到旧 marker。
4. **appId 在 2.0.0 保持 `ai.cloudcli.desktop`**；否则安装并存、更新链、注册表/钥匙串/卸载项全部变化。appId 切换放 v3.0，配一次迁移安装器。
5. 协议注册 `cloudcli` + `cloudpit` 两个 scheme；云端登录仍用 `cloudcli://auth/callback`。

### 4.6 失败、回退与幂等

- 迁移写入 `.migrated-from-cloudcli` 标记（时间、源路径、版本）。
- 迁移可重入：新根已有完整 DB + 标记 → 直接使用；新根存在但无标记 → 不覆盖，提示人工处理。
- 任何一步失败 → 本次进程使用旧根，**不删除任何东西**，日志给出明确原因。
- 回滚：保留旧 npm 包、旧 systemd unit、旧数据根至少一个版本周期。

### 4.7 迁移夹具

必须有一个可重复的旧布局夹具：

```text
<tmp-home>/.cloudcli/
  auth.db                 # 含可识别的 project/session 行
  assets/old-shot.png     # 历史消息里以绝对路径引用
  voice-data/...
  cockpit-card-feedback.json   # 含 cloudcli:// URI
  reply-suggestions-usage.jsonl
<tmp-home>/.config/claudecodeui/server.settings.json
```

验收：启动 Cloudpit 后 DB 行可见、旧图片可显示、设置生效、新上传落新根、旧根未被修改、二次启动不重复迁移。

---

## 5. 运行时契约实施

### 5.1 环境变量

- 新前缀 `CLOUDPIT_*`；旧 `CLOUDCLI_*` 回退。
- 统一入口：`readBrandEnv(name)`，每个 key 只警告一次，避免刷屏。
- 受影响的实际读取点约 20 个，主要集中在 Electron（`CLOUDCLI_CONTROL_PLANE_URL`、`CLOUDCLI_SERVER_*`、`CLOUDCLI_USE_INSTALLED_SERVER`、browser-use 变量）与 workflow（`CLOUDCLI_SEMANTICS_BUILD_REQUIRED` 等）。
- `SERVER_*` / `DATABASE_PATH` / `SERVER_SETTINGS_PATH` 不改名。
- systemd drop-in 是仓库外状态：旧变量必须继续被读到，文档给出迁移命令，但不能假设用户会立刻改。

### 5.2 协议与 URI

拆分两个用途：

| 用途 | 2.0.0 行为 |
|---|---|
| 云端 OAuth 回调 | 继续 `cloudcli://auth/callback`；`app_surface=cloudcli_desktop` 不变；这是 `cloudcli.ai` 的契约 |
| 本地 / 内部 deep link | 注册 `cloudpit://`；解析器同时接受两个 scheme |
| 观测 URI（`cloudcli://session|architecture`） | 解析器双接受；2.0.0 仍写旧值；2.1 起写新值 |
| `quay://` | 不变（另一个项目的命名空间） |

观测 URI 已落盘在 `cockpit-card-feedback.json` 与卡片记录里（`server/modules/observation/observation-store.ts:324`），所以「写新值」必须晚于「所有读取方都会双读」。

### 5.3 OAuth scope 与 PAT

- scope 注册表增加新名 `cloudpit:*`，保留旧名 `cloudcli:*` 作为 alias：
  - metadata 同时列出新旧；
  - 授权请求两种都接受；
  - 新授权写新 scope；
  - 校验时把旧 scope 映射到新；
  - 已发放的 token / grant 不迁移、不失效。
- PAT 前缀 `ccp_` **建议保留**（`server/modules/mcp-gateway/mcp-gateway.auth.ts:98`）。它是路由提示，不是品牌可见物；改前缀只会增加旧 token 兼容分支。若坚持改，新增 `cpt_` 并双接受。

### 5.4 MCP server 名

- 新名 `cloudpit-browser`；
- `cloudcli-browser` 与 `cloudcli-browser-use` 进入 legacy 名单（沿用 `server/modules/browser-use/browser-use.service.ts:84-85` 的既有模式）；
- 清理时新旧都清，注册时只写新名。

### 5.5 IPC、bridge、BroadcastChannel、语义面

这些只在同一次发布内自洽，不需要跨版本兼容：

- `cloudcli-desktop:*` → `cloudpit-desktop:*`；
- `window.cloudcliDesktop` / `cloudcliDesktopNotifications` → `cloudpitDesktop` / `cloudpitDesktopNotifications`；
- `cloudcli-architecture` → `cloudpit-architecture`；
- `window.__cloudcliScenario` → `window.__cloudpitScenario`（dev-only；e2e / `scripts/ui-scenario.mjs` 同步）。

### 5.6 Service Worker

- `CACHE_PREFIX` 改 `cloudpit-`，`CACHE_NAME` 改 `cloudpit-v1`；
- 清理列表同时包含 `cloudpit-` 与 `claude-ui-`，否则老缓存永久残留；
- 首次更新后必须重新拉取新 HTML / 图标，不能从旧缓存拼出半新半旧页面。

### 5.7 systemd（本机部署）

- 仓库模板改 `scripts/systemd/cloudpit-server.service`；
- 安装脚本检测旧 unit，打印迁移步骤，不自动 disable；
- 本机迁移放维护窗口：停 driver/server → 改目录与 unit → `daemon-reload` → 启新 unit；
- **重启会杀掉 resident sessions，包括执行本次操作的这个会话**。

---

## 6. 分发与发布

### 6.1 npm 新包

- `package.json`：`name` = `@yalehwang/cloudpit`，`bin` 只保留 `{ "cloudpit": "dist-server/server/modules/cli/cli.js" }`，`productName` = `Cloudpit`，description / keywords / author / homepage / repository / bugs 同步。
- CLI：
  - `server/modules/cli/cli.module.ts:77,82` 的版本检查与自更新改为新包；
  - `server/modules/system/system.service.ts:39` 的全局升级命令改为新包；
  - `server/modules/cli/cli.service.ts` 的 banner / status / help / update 文案改 Cloudpit；
  - 12 个语言包的 `npmUpgradeCommand` 改 `npm install -g @yalehwang/cloudpit@latest`。
- 新包**不提供** `cloudcli` bin（D3）。

### 6.2 旧包最终版

在仓库改名**之前**发布 `@yalehwang/cloudcli@1.42.0`：

- npm deprecate 文案指向 `@yalehwang/cloudpit`；
- CLI 在 `--version` / 启动时打印一次迁移提示：
  `CloudCLI has been renamed to Cloudpit. Install @yalehwang/cloudpit and uninstall @yalehwang/cloudcli.`
- 不代理、不保留别名；旧包只是退出通道。
- 必须在改名之前发，因为旧包的 npm trusted publishing 绑定在旧仓库名上。

如果决定省掉这次发布，退路是 `npm deprecate` 现有 1.41.0；代价是用户没有命令行提示。

### 6.3 仓库改名与 OIDC 顺序

1. 发旧包 1.42.0（若采用）；
2. GitHub 仓库 `yaleh/claudecodeui` → `yaleh/cloudpit`；
3. 更新本地 remote（`yaleh` 这个名字可以保留，只换 URL）、`package.json` URL、README、workflow 注释、`electron/serverInstaller.js:17`；
4. 在 npm 为新包配置 Trusted Publishing（仓库 `yaleh/cloudpit` + `.github/workflows/release.yml`）；
5. 发布新包 2.0.0。

顺序反了会卡在「旧包 OIDC 失效 / 新包 trust 未配置」之间。

### 6.4 Release tag、资产与桌面

- 新 tag / 资产前缀：`cloudpit-desktop-*`、`cloudpit-local-server-*`；
- `.release-it.json` 的 `releaseName`、CHANGELOG header 改 Cloudpit（旧 CHANGELOG 不改写）；
- `.github/workflows/desktop-*.yml` 的 artifact name、server bundle tag、prerelease 名称同步；
- 桌面端按自己的版本号找 runtime（`electron/serverInstaller.js:61-66`），旧桌面 1.x 不需要新 tag；
- 为回滚方便，可在 2.0.0 同时发一份 `cloudcli-local-server-v2.0.0-*` 别名；v2.1 起停。
- macOS / Windows 的 `build.protocols`、`CFBundleURLSchemes` 同时列两个 scheme。

### 6.5 Docker 与上游

- `docker.io/cloudcliai/sandbox:*` 是上游命名空间，本 fork 目前不发布自己的镜像；
- Docker 文档、`docker/shared/*`、sandbox 命令标注为**上游第三方**；
- `server/modules/cli/sandbox.service.ts` 在容器内仍执行 `cloudcli start`（上游 bin），不要改成 `cloudpit`，否则镜像内找不到命令；
- 如果以后要发布 Cloudpit 镜像，另起任务、另建命名空间，不在本次改名范围。

### 6.6 文档、About、版本检查

- README：产品名改 Cloudpit；保留「fork of CloudCLI UI」、LICENSE/NOTICE 归属、上游链接；
- 7 份翻译 README：至少替换产品名与安装命令；无法完整翻译的部分保留「上游翻译」提示；
- `AboutTab`：
  - 产品名改 Cloudpit；
  - 项目链接指 `yaleh/cloudpit`；
  - 另起一行「Based on CloudCLI UI」指 `siteboon/claudecodeui`；
  - `useVersionCheck('siteboon','claudecodeui')` 改为 fork 仓库，否则 Cloudpit 会显示上游版本的更新；
- `GitHubStarBadge` / `SidebarFooter` / `SidebarCollapsed` / `AuthScreenLayout` 的链接按「项目入口 → fork、归属 → 上游」拆分；
- `CHANGELOG.md` 只新增 2.0.0 条目，不改历史。

---

## 7. 品牌资产规格

### 7.1 附图实测

| 项 | 读数 | 影响 |
|---|---|---|
| 画布 | 1248×1248 | 名义正方形 |
| 亮部 bbox（512 渲染） | 441×132 | 3.34:1，占高 26%、面积 22% |
| 32px favicon | 约 28×8 px | 不可辨识 |
| maskable 安全圆 | 左右尖端越界 | 圆形 / 自适应图标裁掉两端 |
| 背景 | 深色径向渐变已烘焙 | 浅色 UI 上是黑方块，需要浅色变体或统一深色底板 |
| SVG 渐变 id | `bg/upper/cloud/...` 通用名 | 内联多次会冲突 |
| `objectBoundingBox="true"` | 非合法属性 | 应改 `gradientUnits="objectBoundingBox"` |

渲染样张（未提交，供设计讨论）：`tmp/cloudpit-logo-check/logo-512.png`、`logo-32.png`、`logo-512-maskable-overlay.png`。

### 7.2 必须交付的资产

1. **方形 app icon**：内容在 80% 安全圆内；16/32px 仍能读出主形状；深色底板 + 浅色底板两版。
2. **宽版 lockup**：现有 3.34:1 翼形适合 README / 登录页 hero / 桌面启动器横排。
3. **字标**：`Cloudpit` 文本 lockup；如后续有定制字形，替换 `CLOUDCLI_WORDMARK_FONT_FAMILY` 所在常量。
4. **单色剪影**：favicon、通知图标、浅色主题。
5. **完整尺寸链**：16/32/48 favicon；PWA 72/96/128/144/152/192/384/512 + maskable；Apple 180；macOS `.icns`；Windows `.ico`；README / social preview。
6. **生成器**：`public/generate-icons.js` 目前是用代码画 MessageSquare，必须改成从源 SVG 用 sharp 生成；`public/convert-icons.md` 同步更新或删除。

### 7.3 技术规则

- 渐变 id 全部加 `cloudpit-` 前缀；
- 修正 `objectBoundingBox` → `gradientUnits`；
- 加 `<title>` / `<desc>`（现有 `aria-label` 可保留）；
- 不引用外部字体 / 图片；
- 输出确定：同一源 SVG 生成同一组 PNG（便于 diff 和 CI 校验）。

### 7.4 发布闸门

D4 说 logo 版本后续提供。因此：

- 代码改名与 T1–T6 可以先落 `develop`；
- **2.0.0 公开发布必须等最终资产到位**，避免以旧 logo + 新名字发布；
- 在资产到位前，UI 可使用文本字标作为占位，但不得把旧 MessageSquare 图标当成 Cloudpit 的正式图标发布。

---

## 8. 代码结构与约束

### 8.1 前端

- 品牌常量放 `src/shared/constants.ts` 的 BRANDING 段（该文件当前 482 行，未触及 800 行棘轮）；
- 不在 `src/modules/*` 下新建 `constants.ts`；
- 需要跨模块共享的字符串 / URL 一律走 `src/shared/constants.ts`；
- 改 `src/shared/utils.ts` 的 `DEFAULT_PAGE_TITLE` 时同步 `pageTitleNotification.ts:93`。

### 8.2 后端

- 兼容与品牌解析放 `server/shared/brand.ts`（**新文件，不是新目录**），避免：
  - 触发 AC-394 的新 leaf 目录 manifest + pin；
  - 往 `server/shared/utils.ts`（当前 1930 行，已在 oversize 基线里）加行，触发 oversize 棘轮；
- 类型放 `server/shared/types.ts`，按既有分组注释；
- 若某个解析器被两个以上模块使用，才进 `server/shared/brand.ts`；单模块使用的留在模块内；
- 不新建 `server/modules/<feature>/`。

### 8.3 兼容层边界

- 一个 `readBrandEnv(name)`；
- 一个 `resolveDataRoots()`；
- 一个 `resolveBrandPath(kind)`；
- 一个 `resolveAssetRoots()`（附件双根）；
- 一个 scope alias 表；
- 一个 URI 双解析器；
- 这些函数集中在 `server/shared/brand.ts`，避免兼容逻辑散落到各模块。

### 8.4 禁止

- 不对 `tasks/`、`goals/`、`adr/`、`experiments/`、`docs/proposals/`、`CHANGELOG.md` 做批量替换；
- 不用全库 `sed` 改 `cloudcli`（会打中测试夹具、外部包名、上游 URL）；
- 不把 `@cloudcli-ai/*`、`docker.io/cloudcliai/*`、`cloudcli.ai` 改成 Cloudpit。

---

## 9. 工作拆分

每个 T 可以单独成为 quay task；T1/T2/T3/T4/T6 在品牌常量落地后可并行，T7 依赖全部前置，T8 独立于发布但必须等 T7。

| 任务 | 内容 | 主要产出 | 依赖 |
|---|---|---|---|
| **T1 品牌基座 + 展示层** | 品牌常量、UI 文案、12 语言包、index/manifest、README/文档、CLI banner | 可见面全部 Cloudpit；品牌 allowlist 检查器 | 无（最终 logo 后补） |
| **T2 运行时兼容核** | env 回退、数据根、DB/设置迁移、assets 双根、voice/logs | `server/shared/brand.ts`、迁移夹具、回退单测 | T1 的常量 |
| **T3 Electron 身份** | `APP_NAME`、userData 迁移、server 缓存、协议双注册、IPC/bridge、installer 根 | 桌面升级不丢登录/设置 | T2 |
| **T4 分发** | 新包名/bin、CLI 更新、旧包最终版、workflow/tag/资产、仓库 URL | npm + GitHub + release 配置 | T1、T2 |
| **T5 第三方标注** | About/版本检查归 fork、CloudCLI Cloud 标注、Docker/submodule 说明、归属段 | 合规且不再冒充原版 | T1 |
| **T6 测试与闸门** | 迁移夹具、回退测试、分发静态测试、品牌 allowlist、UI e2e | 可重复的红/绿证据 | T2、T3、T4 |
| **T7 发布执行** | 旧包 1.42 → 仓库改名 → npm trust → 2.0.0 → 桌面 | 真实发布 | T4、T6 |
| **T8 本机部署** | systemd unit、目录、数据迁移、重启窗口 | 本机实例切到 Cloudpit | T7 |

---

## 10. 验收标准（作为后续 task 的输入）

> 本节是 SPEC 级 AC，供拆任务时裁剪；具体 task 仍需把每条改写成可运行判据。AC 未验证不得勾选。

### 10.1 正向

| AC | 判据 | 验证方式 |
|---|---|---|
| AC1 品牌可见面 | 产品标题、manifest、CLI banner、About、窗口/通知标题均为 Cloudpit | 构建后 grep + 浏览器截图 |
| AC2 npm 身份 | `package.json` name/bin 正确；`npm pack` 产物中**没有** `cloudcli` bin | `npm pack --dry-run` + tarball 检查 |
| AC3 旧包退出 | 旧包已 deprecate；最终版 CLI 打印迁移提示 | `npm view` + 运行旧包 CLI |
| AC4 env 回退 | 只设 `CLOUDCLI_*` 时功能正常并告警一次；同时设置时新名胜出 | 单测 + 手工启动 |
| AC5 数据迁移 | 旧布局夹具迁移后 DB 行可见；新写入落新根；旧根未被修改；二次启动幂等 | 集成测试 |
| AC6 附件双根 | 历史绝对路径仍可读；新上传落新根；两段路径穿越仍被拒 | 路由测试 + 手工 |
| AC7 设置回退 | 旧 `server.settings.json` 生效；保存写新路径 | 单测 |
| AC8 桌面迁移 | 3 个 JSON 被复制；server 缓存可移动/重下；local-server marker 可读旧路径；appId 仍为旧值 | Electron 手工升级 |
| AC9 协议/URI | 云端登录用旧 scheme 成功；`cloudpit://` 已注册；观测 URI 双读；旧卡片可读 | 桌面 + 单测 |
| AC10 OAuth/MCP | 旧 scope 仍被接受；新授权写新 scope；旧 MCP 名被接受、新名被写出 | 网关测试 |
| AC11 分发 | 仓库 URL、homepage/repository/bugs、installer 基址均指向 `yaleh/cloudpit`；新包经 OIDC 发布成功 | 静态测试 + dry-run |
| AC12 SW/资产 | 新缓存前缀；旧缓存被清；图标由新 SVG 生成；maskable 不裁切；32px 可辨识 | 浏览器 + 视觉检查 |
| AC13 合规 | LICENSE/NOTICE 保留；README 有 fork 归属；`CloudCLI` 只出现在 allowlist | allowlist 检查器 + 人工 |
| AC14 回归 | 相关单测 / 集成 / UI 场景全绿；typecheck/lint 通过 | 按仓库 runner 规则 |

### 10.2 反向臂（false-form / 防假绿）

每条正向判据都要有一个能把它打红的对照：

- **allowlist 检查器**：注入一条不在 allowlist 的 `CloudCLI` → 必须红；
- **env 回退**：只设新名、不设旧名 → 正常；同时设置 → 断言新名胜出；旧名格式错误 → 不得被当成新名；
- **迁移**：旧根不存在 → 不创建空迁移标记；新根已有 DB → 不覆盖；备份失败 → 回退旧根；
- **附件**：把旧根移走 → 历史附件读取必须失败（证明测试真的在读旧根）；
- **协议**：只注册 `cloudpit`、不注册 `cloudcli` → 云端回调测试必须失败（证明旧 scheme 是必要的）；
- **npm bin**：在 tarball 中人为塞入 `cloudcli` bin → AC2 必须红；
- **SW**：保留一个 `claude-ui-` 缓存 → 更新后必须被清掉。

### 10.3 DoD

- 服务端 / 脚本改动：按 `AGENTS.md` 跑相关测试，**不在会话内跑全量 suite**；全量走 quay fan-in。
- UI 改动：MCP 浏览器实际操作 + 截图存 `tmp/`；有场景时跑 `node scripts/ui-scenario.mjs <scenario.json> …` 并贴 JSON 报告与检查点截图。
- 桌面改动：真实构建 + 旧版本 → 新版本手工升级路径。
- 发布改动：`npm pack --dry-run`、workflow 静态测试、release dry-run；真实发布由 T7 执行。
- 文档：README / About / NOTICE / LICENSE 四处一致。

---

## 11. 测试计划

### 11.1 新增或改写的测试

| 测试 | 覆盖 |
|---|---|
| `server/shared/tests/brand-env.test.ts` | 新名优先、旧名回退、警告只一次、非法值 |
| `server/shared/tests/data-root-migration.test.ts` | 旧布局夹具、幂等、失败回退、旧根只读 |
| `server/modules/assets/tests/assets-dual-root.test.ts` | 双根读取、新写、穿越防护 |
| `server/modules/mcp-gateway/tests/scope-alias.test.ts` | 旧 scope 接受、新 scope 发出 |
| `server/modules/observation/tests/observation-uri-compat.test.ts` | 双 scheme 解析、旧 URI 可读 |
| `scripts/brand-allowlist-check.test.mjs` | 注入违规必须红 |
| `scripts/release/tests/fork-release-workflows.test.mjs` | 改为新包名 / 新仓库 / 新 tag；旧值只出现在 allowlist |
| `scripts/release/tests/server-installer-bundle-url.test.mjs` | 新 tag / 新基址；旧 tag 仍可解析 |
| `server/modules/cli/tests/browser-use-mcp-entry.test.ts` | 新 DB 默认路径 + 新 MCP 名 + 旧名 legacy |
| `server/modules/system/tests/system.service.test.ts` | 新升级命令 |
| `src/modules/settings/tests/aboutTabCommunityLinks.test.tsx` | fork 入口 + 上游归属拆分 |

### 11.2 测试注意事项

- **新增 server 测试文件会改变 suite 时长基线与 coverage floor**：优先把新用例并入既有文件，必须新增时同步更新 `scripts/suite-duration-baseline.tsv` 与相关 pin。
- 新增 `scripts/**/*.test.mjs` 会被 `scripts/list-script-tests.mjs` 与 quay 的 test-script pin 看见，需同步。
- 12 语言包只改值、不改 key，避免 locale key-set digest 红灯；若必须新增 key，同步 digest pin。
- 不新增模块目录，避免 AC-394 的 import-cycle manifest / pin。
- 不向 `server/shared/utils.ts` 加行，避免 oversize 棘轮；新逻辑放 `server/shared/brand.ts`。

---

## 12. 风险与回滚

| 风险 | 触发 | 缓解 |
|---|---|---|
| 老用户升级后像「数据没了」 | DB 默认路径换新但未迁移 | 启动迁移 + 失败回退 + 旧根保留 |
| 历史图片打不开 | 只 `mv` assets | 旧根永久可读 + 双根路由 |
| systemd drop-in 的旧 env 被忽略 | 只读新前缀 | `CLOUDCLI_*` 回退 + 启动告警 |
| 桌面登出 / 设置丢失 | `app.name` 换新导致 userData 换目录 | 首次启动复制 3 个 JSON |
| 云端登录失效 | 改了 `cloudcli://` 或 `app_surface` | 保留云端契约；新 scheme 只做别名 |
| 外部 OAuth 客户端断 | scope 硬切 | 双列 + 双接受 + 旧 token 不失效 |
| npm 发布断链 | 先改仓库名 / OIDC 未配置 | 先发旧包 → 改名 → 配 trust → 发新包 |
| 旧桌面 Local 模式断 | runtime tag 硬切 | 2.0.0 双发 tag 别名；旧桌面按自身版本找旧 tag |
| SW 半新半旧 | 缓存前缀硬切但未清旧 | 清理列表包含两个前缀 |
| 测试大面积红 | 78 行硬身份断言 | 预期内；优先改断言值，不改判据语义 |
| 本机会话被杀 | 重启 systemd | 维护窗口；不与代码发布同批 |
| 合规风险 | 删除/隐藏 NOTICE | LICENSE/NOTICE 不动；README 保留 fork 归属 |

回滚顺序：回退 npm dist-tag → 恢复旧 systemd unit → 指向旧数据根 → 旧桌面版本。旧根与旧包在 3.0 前始终保留。

---

## 13. 退场时间表

| 版本 | 内容 |
|---|---|
| `@yalehwang/cloudcli@1.42.0` | 最终旧包：deprecate + CLI 迁移提示 |
| `@yalehwang/cloudpit@2.0.0` | 品牌 + 分发 + 运行时新名；旧值全部回退；appId 仍旧；观测 URI 仍写旧 |
| `2.1.0` | 观测 URI 改新写；旧 runtime tag 别名停止；旧值仍读 |
| `3.0.0` | 移除 `CLOUDCLI_*` / `~/.cloudcli` / `~/.config/claudecodeui` / 旧 scope / 旧 MCP 名 / 旧观测 URI 的兼容；切换 appId 并配迁移安装器 |

`~/.cloudcli/assets` 的只读支持建议长期保留，因为历史消息里是绝对路径；是否在 3.0 提供一次性 `cloudpit migrate-assets --rewrite` 工具，另立任务。

---

## 14. 待实现前确认的条目（本 SPEC 的默认值）

| # | 条目 | 本 SPEC 默认 | 备选 |
|---|---|---|---|
| 1 | appId | 2.0.0 保留 `ai.cloudcli.desktop` | 2.0.0 直接切 `ai.cloudpit.desktop` |
| 2 | OAuth scope | 双列 + 新授权写 `cloudpit:*` + 旧 token 不失效 | 先保持 `cloudcli:*`，3.0 再切 |
| 3 | PAT 前缀 | 保留 `ccp_` | 新增 `cpt_` 双接受 |
| 4 | 云端登录 scheme | 保留 `cloudcli://`；新增 `cloudpit://` 别名 | 要求云端同时支持新 scheme |
| 5 | Docker | 标注上游第三方，不发布 Cloudpit 镜像 | 新建 Cloudpit 镜像命名空间 |
| 6 | 旧包最终版 | 发 1.42.0 带迁移提示 | 只 `npm deprecate` 1.41.0 |
| 7 | 新包起始版本 | `2.0.0` | 延续 `1.42.0` |
| 8 | 翻译 README | 机械替换产品名 + 安装命令，保留上游翻译提示 | 只保留英文，其余指向英文 |
| 9 | 本机目录 / systemd | 发布后单独维护窗口迁移 | 与代码发布同批 |

---

## 附录 A：关键文件清单

| 主题 | 文件 |
|---|---|
| 包身份 | `package.json`、`package-lock.json`、`.release-it.json`、`NOTICE`、`LICENSE` |
| 前端品牌 | `index.html`、`public/manifest.json`、`public/logo.svg`、`public/favicon.*`、`public/icons/*`、`public/generate-icons.js`、`src/shared/constants.ts`、`src/shared/utils.ts` |
| 前端 UI | `src/modules/auth/AuthLoadingScreen.tsx`、`AuthScreenLayout.tsx`、`src/modules/sidebar/SidebarHeader.tsx`、`GitHubStarBadge.tsx`、`SidebarFooter.tsx`、`SidebarCollapsed.tsx`、`src/modules/settings/tabs/AboutTab.tsx`、`src/modules/i18n/locales/*/` |
| CLI | `server/modules/cli/cli.module.ts`、`cli.service.ts`、`sandbox.service.ts`、`server/modules/system/system.service.ts` |
| 数据与兼容 | `server/shared/brand.ts`（新）、`server/shared/types.ts`、`server/modules/cli/cli.module.ts`、`server/modules/database/core/index.ts`、`server/modules/assets/services/image-assets.service.ts`、`server/modules/assets/assets.routes.ts`、`server/modules/websocket/services/chat-websocket.service.ts`、`server/modules/voice/voice-data.ts`、`voice-capture.ts`、`server/modules/reply-suggestions/reply-suggestions-usage-log.ts` |
| 设置路径 | `server/modules/settings/server-settings.ts`、`server/modules/architecture/refresh-settings.ts`、`server/modules/cockpit/cockpit-brief-settings.ts`、`server/modules/observation/session-digest-llm-settings.ts` |
| 契约 | `server/modules/mcp-gateway/mcp-gateway.auth.ts`、`server/modules/browser-use/browser-use.service.ts`、`server/modules/observation/observation-store.ts`、`src/modules/cockpit/contract/observationUri.ts` |
| Electron | `electron/main.js`、`electron/preload.cjs`、`electron/cloud.js`、`electron/localServer.js`、`electron/serverInstaller.js`、`electron/launcher/launcher.js`、`electron/desktopWindow.js`、`electron/desktopNotifications.js` |
| 发布 | `.github/workflows/release.yml`、`desktop-*.yml`、`docker.yml`、`scripts/release/build-server-bundle.js`、`scripts/release/prepare-desktop-app.js` |
| 本机部署 | `scripts/systemd/claudecodeui-server.service`、`scripts/install-server-unit.sh`、`docs/operations/process-isolation-and-memory-caps.md` |
| 文档 | `README.md`、`CONTRIBUTING.md`、`docs/README.*.md`、`docs/operations/*`、`CHANGELOG.md`（只追加） |

## 附录 B：兼容矩阵速查

```text
改名并回退（R）: npm 包 / bin / env / 数据根 / 设置 / DB / 附件新根 / userData / 缓存 /
                 MCP 名 / IPC / BroadcastChannel / 语义面 / SW / systemd / tag / 仓库
新增 + 旧值规范（A）: appId(2.0 保留) / cloudpit:// 别名 / 观测 URI 双读 / OAuth scope 双列
保留（K）: cloudcli.ai 契约 / ccp_ 前缀 / 上游包镜像插件
```

## 附录 C：发布前复核命令（只读）

```bash
npm view @yalehwang/cloudpit version        # 必须仍为 404 才能创建
npm view @yalehwang/cloudcli version        # 旧包当前位置
git remote -v                               # 确认 yaleh remote 指向新仓库
node -e "require('./package.json')"         # name / bin / productName / appId
```

---

*本文只定义计划与判据，不实现代码。实现按 §9 的任务拆分另行发起，并在每个 task 内把 §10 的 AC 改写成可运行判据。*

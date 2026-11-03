# Cloudpit 兼容退场计划（v2.1 / v3.0）

状态：草案，待 human review。本任务只写计划与判据映射，**不删除任何兼容代码**。
日期：2026-11-02
上游：`docs/proposals/cloudpit-rename-SPEC.md`（下称 SPEC；其 §13 退场时间表是本计划的输入）
任务：`tasks/gap-cloudpit-compat-retirement-plan.md`

## 0. 读法与边界

- 本文的「退场」只指**运行时兼容代码的移除**，不指用户数据删除；所有旧数据根、旧附件、旧安装一律不自动删除。
- Cloudpit 2.0.0 的兼容层是「新值优先、旧值回退」。本计划把每一行的旧值、新值、2.0 行为、退场版本、验证判据、回滚写死；执行由后续任务按矩阵逐项完成。
- 版本门只有两个：**2.1** 与 **3.0**。矩阵的「退场版本」列只取 `2.1` 或 `3.0`。
- SPEC 自身把 `docs/proposals/` 列为冻结账本（SPEC §0.3），因此「回写 SPEC 的差异说明」以本文「与 SPEC 差异」一节交付，不直接编辑 SPEC 文件。

## 1. 现状核实（2026-11-02，读自 develop 的 2.0.0 树）

- 身份已切到 `@yalehwang/cloudpit@2.0.0`（`package.json:2-3`），`productName` 为 `Cloudpit`（`package.json:7`）；appId 仍是 `ai.cloudcli.desktop`（`package.json:76`）。
- 兼容读取集中在 `server/shared/`：`brand.ts`（环境变量）、`data-root.ts` 与 `data-root-migration.ts`（数据根/DB/voice-data/cockpit feedback/usage log）、`settings-file.ts` 与 `server/modules/settings/server-settings-file.ts`（设置）、`image-attachments.ts`（附件双根）。
- 观测 URI 语法在服务端与前端各有一份：`server/modules/observation/observation-uri.ts` 与 `src/modules/cockpit-contract/observationUri.ts`；两份的接受 scheme 正则行必须逐字一致（`server/shared/tests/cloudpit-runtime-flip.test.ts` AC6 用行文本对拍）。
- `server/shared/brand.ts` 目前是**未接线模块**（`brand.ts:5-8` 自述；唯一消费者是测试）。生产读取点仍直接读 `CLOUDCLI_*`：`electron/main.js:22`、`electron/localServer.js:24-30,391`、`electron/serverInstaller.js:88-103`、`server/modules/browser-use/browser-use.service.ts:23-24,359,551-552`、`server/modules/cli/browser-use-mcp.ts:45-47`。
- 2.0 的发布工作流只产出 `cloudpit-*` tag/资产，未见旧 tag 双发：`.github/workflows/desktop-release.yml:49`、`scripts/release/build-server-bundle.js:112`、`package.json:79`。
- 当前系统性覆盖这些兼容面的判据是 `server/shared/tests/cloudpit-runtime-flip.test.ts`（AC2-AC11）与 `server/shared/tests/cloudpit-data-root.test.ts`（AC2-AC8），另有按主题拆分的测试；逐行映射见「验证映射」。

## 矩阵

| 旧值（项目） | 新值 | 2.0 行为 | 退场版本 | 验证测试 | 回滚 |
|---|---|---|---|---|---|
| **R1** 环境变量 `CLOUDCLI_*` | `CLOUDPIT_*` | 读取器新名优先、旧名回退、每 key 告警一次（`server/shared/brand.ts:55-78`）；但该模块目前未接线，生产读取点（`electron/main.js:22`、`electron/localServer.js:24-30,391`、`electron/serverInstaller.js:88-103`、`server/modules/browser-use/browser-use.service.ts:23-24,359,551-552`）仍直读旧名 | 3.0 | `server/shared/tests/cloudpit-brand-env.test.ts`；`server/shared/tests/cloudpit-runtime-flip.test.ts` AC10 | 让所有读取点改回旧名，或保留 `CLOUDCLI_*` 别名；无数据迁移 |
| **R2** 数据根 `~/.cloudcli`（auth.db、voice-data、cockpit-card-feedback.json、reply-suggestions-usage.jsonl） | `~/.cloudpit` | 新根默认；旧布局一次性迁移（SQLite `VACUUM INTO`、`.migrated-from-cloudcli` 标记、失败回退旧根只读）；`defaultRoot:'legacy'` 仍可选（`server/shared/data-root.ts:100-114,144-150,212-270`；`server/shared/data-root-migration.ts:104-114,133-137,220-245`） | 3.0 | `server/shared/tests/cloudpit-data-root.test.ts` AC2-AC8；`server/shared/tests/cloudpit-runtime-flip.test.ts` AC2/AC11；`server/modules/voice/tests/voice-data.test.ts`；`server/modules/reply-suggestions/tests/reply-suggestions-usage-log.test.ts` | 旧根永不删除；回退旧二进制后继续读 `~/.cloudcli`；把新根手工拷回旧根即可 |
| **R3** 设置 `~/.config/claudecodeui/server.settings.json` | `~/.config/cloudpit/server.settings.json` | 新路径优先；新文件缺失时读旧路径；保存始终写新路径（`server/shared/settings-file.ts:120,128-130`；`server/modules/settings/server-settings-file.ts:69-94`） | 3.0 | `server/shared/tests/cloudpit-runtime-flip.test.ts` AC4/AC11；`server/shared/tests/settings-file.test.ts` | 把新文件复制回旧路径，或设 `SERVER_SETTINGS_PATH` 显式指向旧文件（显式路径读写同一文件） |
| **R4** 附件旧根 `~/.cloudcli/assets` | 新写根 `~/.cloudpit/assets` | 新上传写新根；读取按新根、旧根顺序；旧根不搬不删；允许来源双根校验（`server/shared/image-attachments.ts:84-94`；`server/modules/assets/services/image-assets.service.ts:119-128,142,163`） | 3.0 | `server/modules/assets/tests/cloudpit-assets-dual-root.test.ts` AC2-AC5；`server/modules/assets/tests/image-assets.service.test.ts` | 旧根文件保留；新根可手工拷回；显式 `CLOUDPIT_HOME`/`CLOUDCLI_HOME` 指向旧根 |
| **R5** 本地 deep link alias `cloudcli://` | `cloudpit://` | 两个 scheme 都注册（`electron/main.js:21,719-725`；`package.json:96-109`）；云端登录回调固定 `cloudcli://auth/callback`，是第三方契约、不属于本行退场范围（`electron/main.js:17-18,301`） | 3.0 | `electron/tests/cloudpit-desktop-identity.test.mjs` AC6/AC7；`server/shared/tests/cloudpit-runtime-flip.test.ts` AC6 | 恢复注册旧 scheme；云端回调始终保留 |
| **R6** 观测 URI 写入 `cloudcli://session` 或 `cloudcli://architecture` | `cloudpit://session` 或 `cloudpit://architecture` | 解析器双读，但 canonical 与落盘仍写旧值（`server/modules/observation/observation-uri.ts:49,55-63,101-103`；前端副本 `src/modules/cockpit-contract/observationUri.ts:47,52-60,89-94`） | 2.1 | `server/shared/tests/cloudpit-runtime-flip.test.ts` AC6（2.1 执行时把「写旧」断言改为「写新」）；`server/modules/observation/tests/observation-store.test.ts`；`server/modules/observation/tests/observation-routes.test.ts`（执行时改判据） | 把两份 formatter 回退为旧拼写；双读仍在，已落盘旧键不变；键归一化失败则从备份恢复 |
| **R7** 观测 URI 旧拼写读取 `cloudcli://...` | 归一到 canonical | 两种拼写都解析；2.1 起写入新值但读取兼容保留；DB key/去重仍按 canonical（`server/modules/observation/observation-uri.ts:49,97-103`；`src/modules/cockpit-contract/observationUri.ts:47,89-94`） | 3.0 | `server/modules/observation/tests/observation-routes.test.ts`；`server/modules/observation/tests/observation-store.test.ts`；`src/modules/cockpit/tests/observationUri.test.ts` | 保持双读；回滚 = 恢复旧写并保留双读 |
| **R8** MCP server 名 `cloudcli-browser`、`cloudcli-browser-use` | `cloudpit-browser` | 注册只写新名；清理列表含新旧（`server/modules/browser-use/mcp-server-names.ts:15-22`）；stdio initialize 的 `serverInfo.name` 为新名（`server/modules/cli/browser-use-mcp.ts:314`） | 3.0 | `server/shared/tests/cloudpit-runtime-flip.test.ts` AC7；`server/modules/cli/tests/browser-use-mcp-entry.test.ts` | 保留 legacy 名单并注册旧名；provider 侧按名卸载旧注册 |
| **R9** OAuth scope `cloudcli:*`（8 个，含 `cloudcli:cockpit:act`） | `cloudpit:*` | AS metadata 双列（`server/modules/mcp-gateway/oauth-metadata.gate.ts:186`）；签发双接受（`server/shared/mcp-contract/types.ts:115-118`）；比较经 `canonicalScope` 归一到旧拼写（`types.ts:125-128`）；旧 token 不失效 | 3.0 | `server/shared/tests/cloudpit-runtime-flip.test.ts` AC8/AC11；`server/modules/oauth/tests/access-tokens.service.test.ts` | 停发新拼写、继续接受旧 token；已发新拼写 token 仍由 `canonicalScope` 接受 |
| **R10** PAT 前缀 `ccp_` | 保留 `ccp_`（不引入 `cpt_`） | `ccp_` 前缀路由到 PAT 服务，非 `ccp_` 走 OAuth seam（`server/modules/mcp-gateway/mcp-gateway.auth.ts:98,159`）；本行是 K 类保留项，3.0 只复核不删除 | 3.0 | `server/modules/oauth/tests/access-tokens.service.test.ts`（`^ccp_[0-9a-f]{64}$`）；`server/modules/mcp-gateway/tests/mcp-auth.test.ts` | 无需迁移；回滚 = 继续接受 `ccp_` |
| **R11** SW 缓存前缀 `claude-ui-*` | `cloudpit-*` | 激活时同时删除 `cloudpit-*` 旧缓存与 `claude-ui-*` 家族，保留 speech model 等无关缓存（`public/sw.js:4,7,9,114-132`） | 3.0 | `server/shared/tests/cloudpit-runtime-flip.test.ts` AC9；`server/modules/static-assets/tests/service-worker-transient-failure.test.ts` | 恢复 `LEGACY_CACHE_PREFIX` 清理；被删旧缓存只会重新下载 |
| **R12** 旧 release tag / runtime 资产 `cloudcli-local-server-*`、`cloudcli-desktop-*` | `cloudpit-local-server-*`、`cloudpit-desktop-*` | 现状核实：工作流与打包脚本只产新名（`.github/workflows/desktop-release.yml:49`；`scripts/release/build-server-bundle.js:112`；`package.json:79`），2.0 未双发旧 tag 别名；安装器只迁移旧安装目录，不解析旧 tag（`electron/serverInstaller.js:19-21,39-59`） | 2.1 | `scripts/release/tests/fork-release-workflows.test.mjs`；`scripts/cloudpit-distribution-check.test.mjs`；「workflow 中无旧 tag 前缀」负向判据本任务不新增，执行时新增 | 若某渠道仍引用旧 tag，补发一次旧 tag 别名；旧桌面按自身版本找 tag 的兼容不变 |
| **R13** Electron appId `ai.cloudcli.desktop` | `ai.cloudpit.desktop` | appId 保持旧值（`package.json:76`；`electron/main.js:16`）；app name/productName 已是 Cloudpit，首次启动由 `maybeMigrateDesktopUserData` 复制 3 个 userData JSON（`electron/main.js:895-903`；`electron/userDataMigration.js:17-48`）；安装、注册表、钥匙串、卸载项仍属旧 appId。3.0 切换 appId 并配一次性安装迁移 | 3.0 | `electron/tests/cloudpit-desktop-identity.test.mjs` AC7；`electron/tests/cloudpit-userdata-migration.test.mjs` AC6/AC7；appId 安装器迁移判据本任务不新增，执行时新增 | 保留旧 appId 安装包与旧卸载项；迁移安装器失败则回退旧安装；userData 旧目录不删除 |
| **R14** brief/reply itemRef 契约 `cloudcli://session/<id>`、`cloudcli://session/<id>/msg/<messageId>#item-<n>` | 保留旧拼写（K 类，不进入观测 URI 的 R6/R7 退场） | 这是**独立于观测 URI 语法**的 item 寻址契约：`cockpit-brief-result.ts:117` 生成 brief `itemRef`，`replyItems.ts:124` 生成回复项 URI；两者随消息/卡片持久化，下游按旧拼写解析。2.1 的观测 URI 新写不覆盖这两处 | 3.0 | `src/modules/chat/utils/tests/replyItems.test.ts`；`server/modules/cockpit/tests/cockpit-brief.test.ts`；`server/modules/cockpit/tests/cockpit-brief-spec.test.ts`；3.0 执行时补「批量删除 `cloudcli://` 不得命中这两个 formatter」的负向判据 | 无需迁移；保持旧写。若未来产品要求改名，必须另立任务并同时提供双读、持久化键归一化与 UI deep-link 兼容，禁止随 3.0 的 blanket 删除一起清掉 |

## v2.1 门

### 门内动作

1. **观测 URI 改新写（R6）**：服务端与前端两份 formatter 同时改为 `cloudpit://session/<id>` 与 `cloudpit://architecture/<id>`；解析器继续双读（R7 不撤）。
2. **停止旧 runtime tag 别名（R12）**：2.0 未双发旧 tag；2.1 的发布检查确认没有 `cloudcli-local-server-*` / `cloudcli-desktop-*` 资产或 workflow 分支。如果某发布通道在 2.0 实际补发过旧 tag，2.1 停止补发，但已发布的 tag 不删除。

### 前置条件

- 2.0.0 已面向用户发布至少一个发布周期，所有 URI 读取方都已双读（否则 2.1 新写会让旧客户端读不到）。
- R6 的落盘键切换需要一次幂等的数据键归一化：`cockpit-card-feedback.json` 与卡片记录里的 URI 键从 `cloudcli://` 归一到 `cloudpit://`，写前备份，失败回退。SPEC §5.2 只写了「2.1 起写新值」，没有写这个键迁移；这是本计划补的门内前置。
- 两处 URI 语法文件的接受 scheme 正则行保持逐字一致（现有 AC6 已钉）。

### 版本门判据（2.1 发布前必须全绿）

- `server/shared/tests/cloudpit-runtime-flip.test.ts` AC6 的「写旧」断言改为「写新」，并新增「旧拼写仍可读」臂。
- 观测模块的 store/routes 判据在旧键与新键混合数据上通过（执行时改判据或新增夹具）。
- release 检查：workflow 与 release 资产中无旧 tag 前缀；有则记录停止补发的 commit。
- 其余所有旧值回退仍读（R1-R5、R7-R13 的行为在 2.1 不变）。

### 回滚

- URI 写切换：把两份 formatter 回退为旧拼写；双读未撤，已落盘旧键仍可读；键归一化失败则从备份恢复，不保留半套键。
- tag：恢复补发一次旧 tag 即可，不阻塞 2.1 其余内容。

## v3.0 门

v3.0 是**兼容删除版**。总原则：删除的是「运行时回退」，不是用户数据；一次性迁移器可以保留，但不得在每次启动时回退到旧位置。

1. **R1 环境变量**：删除 `CLOUDCLI_*` 回退。前置：先把 `createBrandEnvReader` 接到所有生产读取点（Electron、server、CLI、browser-use），并在 2.x 至少一个版本对旧名打 deprecation 日志；systemd drop-in 的迁移命令写进 release notes。判据：树内非账本、非测试的 `process.env.CLOUDCLI_` 命中为 0；env 判据改为「旧名不再生效」。回滚：恢复旧名回退读取器。
2. **R2 数据根/DB/voice-data/feedback/usage log**：删除「迁移失败时回退旧根」与 `defaultRoot:'legacy'` 的运行时兼容；保留一次性迁移（直接升级到 3.0 的机器仍可把 `~/.cloudcli` 快照到 `~/.cloudpit`），旧根文件永不删除。前置：2.x 用户已写入 `.migrated-from-cloudcli` 标记。判据：`cloudpit-data-root.test.ts` 的 fallback 臂改为「失败即失败并告警」，直接 1.x 到 3.0 的升级夹具仍能完成一次迁移。回滚：恢复旧根回退；标记文件保留。
3. **R3 设置**：删除「新文件缺失时读旧文件」；保留首次启动把旧文件复制到新路径的一次性迁移。前置：2.x 已有写入。判据：`settings-file.test.ts` 与 runtime-flip AC4 改为「不回退读，只迁移」。回滚：把新文件复制回旧路径或显式 `SERVER_SETTINGS_PATH`。
4. **R4 附件双根**：删除旧根读取与双根允许列表。前置：先交付 SPEC §13 提到的 `cloudpit migrate-assets --rewrite`（另立任务），或确认历史消息中的绝对路径不再需要按文件名回退。若前置未交付，本行顺延到 4.0，v3.0 不阻塞其余行。判据：`cloudpit-assets-dual-root.test.ts` 改为只读新根；旧文件仍在盘上，绝对路径可访问。回滚：恢复 `readRoots` 双根。
5. **R5 本地 deep link**：从 `DEEP_LINK_SCHEMES` 删除 `cloudcli`。云端登录回调 `cloudcli://auth/callback` 与 `app_surface=cloudcli_desktop` 是第三方契约，永久保留，不属于本行。判据：`cloudpit-desktop-identity.test.mjs` 的 scheme 判据改为只注册 `cloudpit`，且 `cloudcli://auth/callback` 仍被解析。回滚：恢复两个 scheme。
6. **R6/R7 观测 URI**：R7 删除旧拼写读取；R6 在 2.1 已切新写，3.0 把 canonical/DB 键固定为新拼写。判据：`parseObservationUri('cloudcli://session/x')` 返回 null；旧数据键的读取依赖 2.1 已完成的归一化。回滚：恢复双读正则与旧 canonical。
7. **R8 MCP 名**：删除 legacy 名单与「同时清理旧名」。判据：`mcpServerNamesToRemove()` 只含 `cloudpit-browser`；旧注册由 2.x 卸载路径清理完毕。回滚：恢复 legacy 名单。
8. **R9 OAuth scope**：删除 `cloudcli:*` 的接受与 metadata 双列。前置：旧 token 的 refresh TTL 已过或已迁移；否则本行顺延到 4.0。判据：`ACCEPTED_ACCESS_TOKEN_SCOPES` 只剩 `cloudpit:*`；旧 scope 请求被拒；已发旧 token 的失效策略在 release notes 说明。回滚：恢复双列与 `canonicalScope` 旧映射。
9. **R10 PAT 前缀**：不删除、不切换；3.0 只复核并正式标注 `ccp_` 为永久契约。判据：`access-tokens.service.test.ts` 的 `^ccp_[0-9a-f]{64}$` 与 `mcp-auth.test.ts` 的 `ccp_` 路由仍绿。
10. **R11 SW 缓存**：删除 `claude-ui-*` 清理。前置：确认不再支持 1.x 直升 3.x（release notes 要求经 2.x 升级）；否则顺延到 4.0，保留双前缀清理。判据：activation 只删 `cloudpit-*`；无关缓存仍保留。回滚：恢复 `LEGACY_CACHE_PREFIX`。
11. **R12 release tag**：2.1 已完成；3.0 无动作，只确认没有重新引入旧 tag。
12. **R13 appId**：切换为 `ai.cloudpit.desktop` 并配一次性迁移安装器。
    - userData：2.0 已因 app name 改为 `Cloudpit`，由 `electron/userDataMigration.js` 首次启动复制 3 个 JSON；3.0 的安装器必须验证该迁移对已升级用户是幂等的，不得覆盖用户编辑。
    - 安装迁移：Windows 的 NSIS 卸载注册表项、开始菜单与任务栏固定、`app.setAppUserModelId`；macOS 的 bundle identifier 与钥匙串条目；Linux 的 `.desktop` 文件。安装新 appId 后首次启动检测旧 appId 安装，复制凭据（钥匙串/注册表）并保留旧安装，不自动卸载；失败时回退旧安装。
    - 判据：`cloudpit-desktop-identity.test.mjs` AC7 改为断言新 appId；新增安装器迁移判据（本任务不新增，执行时新增）。
    - 回滚：保留 2.x 安装包与旧 appId 注册项；用户可卸载新 app 重装旧版。
13. **R14 brief/reply itemRef 契约**：**3.0 不清洗、不删除**。`cockpit-brief-result.ts:117` 的 brief `itemRef` 与 `replyItems.ts:124` 的回复项 URI 继续写 `cloudcli://session/...`；这是独立于观测 URI 的 item 寻址语法，不在 R6/R7 的退场范围。任何「批量删除 `cloudcli://`」的 3.0 清理都必须显式排除这两处 formatter，并保留双读。判据：`replyItems.test.ts`、`cockpit-brief.test.ts`、`cockpit-brief-spec.test.ts` 对旧拼写的 round-trip 仍绿；新增「blanket 删除不得命中这两个 formatter」的负向判据（执行时新增）。若未来产品要求把 itemRef 也改为 `cloudpit://`，另立任务，必须同时交付双读、持久化键归一化与 UI deep-link 兼容，不得搭 3.0 的车。回滚：无需迁移；保持旧写。

### 发布顺序

`2.0.0` 到（至少一个发布周期，所有读取方双读）到 `2.1.0`（URI 新写、tag 别名停止）到（键归一化验证、附件迁移工具、token TTL 等前置逐项满足）到 `3.0.0`（本门）。

### v3.0 总回滚

- 每个删除项都按上面的「回滚」逐项恢复；旧数据根、旧附件、旧 userData 目录在整个 3.x 周期不自动删除。
- 发布前保留 `2.1.x` 的 dist-tag 与安装包，作为整体回滚目标。

## 与 SPEC 差异

对拍对象：SPEC §13「退场时间表」（`docs/proposals/cloudpit-rename-SPEC.md:570-579`）。逐项结论：

- **§13 `2.1.0`「观测 URI 改新写」**：一致（矩阵 R6 退场版本 `2.1`）。本计划补充了 SPEC 未写的落盘键归一化前置（见 R6/R7 与 v2.1 门）。
- **§13 `2.1.0`「旧 runtime tag 别名停止」**：与 SPEC §3 第 23 行的「新旧 tag 双发一版、v3 退场」冲突；以本计划为准，定为 `2.1`。现状核实 2.0 未双发旧 tag，所以 2.1 的判定是「无别名可停」。差异在此声明。
- **§13 `3.0.0`「移除 CLOUDCLI_* / ~/.cloudcli / ~/.config/claudecodeui / 旧 scope / 旧 MCP 名 / 旧观测 URI」**：一致（R1-R3、R7-R9）。本计划补充两项：env 回退在生产读取点的接线前置（SPEC §5.1 的 `readBrandEnv` 当前未接线）；数据根删除的是运行时回退，一次性迁移器保留到 4.0。
- **§13 `3.0.0`「切换 appId 并配迁移安装器」**：一致（R13）。本计划把 userData 与安装/注册表/钥匙串迁移拆成可验证的子项。
- **SPEC §3 第 8 行（附件「不删」）与 §13 末段（`~/.cloudcli/assets` 只读支持建议长期保留）**：本计划把 R4 的**代码双读**定为 `3.0` 可退场，但以 `migrate-assets --rewrite` 任务为前置；数据文件永不删除。这是对 SPEC「长期保留」的收窄：退场的是查找回退，不是数据。冲突以本计划为准。
- **SPEC §3 第 21 行（SW 缓存「2.0.0 即完成」）**：本计划把 `claude-ui-*` 清理的删除定为 `3.0`，并加「不支持 1.x 直升 3.x」的前置。SPEC 的「即完成」指 2.0 已经开始清理，不是指清理代码可以立刻删除。
- **SPEC §3 第 17 行（PAT `ccp_` 保留，K 类）**：一致；本计划 R10 的 `3.0` 是复核门，不是删除动作。
- **SPEC §5.2（内部观测 URI 双读/写切换）**：SPEC 只覆盖观测 URI 语法；本计划新增 R14，把 brief/reply itemRef 作为**独立契约**在 3.0 保留，明确它不属于 R6/R7 的退场范围。这是对 SPEC 未区分两种 `cloudcli://` 语法的补充，不是冲突。
- **SPEC §0.3 / 冻结账本**：SPEC 把 `docs/proposals/` 列为冻结；因此 SPEC §13 要求的「回写差异说明」以本节交付，不直接改 SPEC 文件。执行 2.1/3.0 的任务若需要更新 SPEC，必须另立任务并显式解冻。

## 验证映射

每个矩阵行至少映射一个判据；路径状态在 2026-11-02 用 `test -e` 在当前 worktree 读得。凡标注「本任务不新增，执行时新增」的，本文不声称已验证。

- R1：`server/shared/tests/cloudpit-brand-env.test.ts`（存在；新/旧/空值/warn-once）、`server/shared/tests/cloudpit-runtime-flip.test.ts`（存在；AC10/AC11）。3.0 执行时需把 env 判据改为覆盖生产读取点。
- R2：`server/shared/tests/cloudpit-data-root.test.ts`（存在；AC2-AC8）、`server/shared/tests/cloudpit-runtime-flip.test.ts`（存在；AC2/AC11）、`server/modules/voice/tests/voice-data.test.ts`（存在）、`server/modules/reply-suggestions/tests/reply-suggestions-usage-log.test.ts`（存在）。
- R3：`server/shared/tests/cloudpit-runtime-flip.test.ts`（存在；AC4/AC11）、`server/shared/tests/settings-file.test.ts`（存在；默认路径）。
- R4：`server/modules/assets/tests/cloudpit-assets-dual-root.test.ts`（存在；AC2-AC5）、`server/modules/assets/tests/image-assets.service.test.ts`（存在）。
- R5：`electron/tests/cloudpit-desktop-identity.test.mjs`（存在；AC6/AC7）、`server/shared/tests/cloudpit-runtime-flip.test.ts`（存在；AC6）。
- R6：`server/shared/tests/cloudpit-runtime-flip.test.ts`（存在；AC6 目前断言「写旧」，2.1 执行时改判据）、`server/modules/observation/tests/observation-store.test.ts`（存在）、`server/modules/observation/tests/observation-routes.test.ts`（存在）、`src/modules/cockpit/tests/observationUri.test.ts`（存在）。键归一化判据：本任务不新增，执行时新增。
- R7：`server/modules/observation/tests/observation-routes.test.ts`（存在）、`server/modules/observation/tests/observation-store.test.ts`（存在）、`src/modules/cockpit/tests/observationUri.test.ts`（存在）、`server/shared/tests/cloudpit-runtime-flip.test.ts`（存在；AC6）。
- R8：`server/shared/tests/cloudpit-runtime-flip.test.ts`（存在；AC7）、`server/modules/cli/tests/browser-use-mcp-entry.test.ts`（存在）。
- R9：`server/shared/tests/cloudpit-runtime-flip.test.ts`（存在；AC8/AC11）、`server/modules/oauth/tests/access-tokens.service.test.ts`（存在）。
- R10：`server/modules/oauth/tests/access-tokens.service.test.ts`（存在；`^ccp_[0-9a-f]{64}$`）、`server/modules/mcp-gateway/tests/mcp-auth.test.ts`（存在；`ccp_` 路由）。
- R11：`server/shared/tests/cloudpit-runtime-flip.test.ts`（存在；AC9）、`server/modules/static-assets/tests/service-worker-transient-failure.test.ts`（存在）。
- R12：`scripts/release/tests/fork-release-workflows.test.mjs`（存在）、`scripts/cloudpit-distribution-check.test.mjs`（存在）。「workflow 中无旧 tag 前缀」的负向判据：本任务不新增，执行时新增。
- R13：`electron/tests/cloudpit-desktop-identity.test.mjs`（存在；AC7）、`electron/tests/cloudpit-userdata-migration.test.mjs`（存在；AC6/AC7）。appId 安装器迁移判据：本任务不新增，执行时新增。
- R14：`src/modules/chat/utils/tests/replyItems.test.ts`（存在；回复项 URI round-trip）、`server/modules/cockpit/tests/cockpit-brief.test.ts`（存在；brief `itemRef`）、`server/modules/cockpit/tests/cockpit-brief-spec.test.ts`（存在；spec 检查）。「blanket 删除不得命中 brief/reply formatter」的负向判据：本任务不新增，执行时新增。

### 机械校验

- 矩阵列数：每行（含表头）按 `|` 切分后去掉首尾空段必须恰好 6 个单元格，且无空单元格。
- 行数：矩阵数据行 14 行。R1–R13 覆盖 Proposal 列出的 11 项（观测 URI 拆成写入与双读两行，另含本地 deep link 与 appId 两行）；R14 是 2.1 完成后补入的独立 brief/reply itemRef 契约行。
- 版本列：每行只取 `2.1` 或 `3.0`；R6 为 `2.1`，R13 为 `3.0` 且写明 userData 与安装迁移，R14 为 `3.0` 的「复核、不删除」契约。
- 文件内唯一的 markdown 表格就是矩阵，因此 `grep -c '^|'` 的读数可直接用于矩阵行数核对（等于表头 1 行 + 分隔行 1 行 + 数据行 14 行 = 16）。

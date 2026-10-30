---
id: gap-cockpit-session-start-model-settings-ui
title: Settings UI 安全编辑 cockpit session-start 模型设置并接入卡片空会话入口
status: ready
labels:
  - gap
  - cockpit
  - settings
parent: null
children: []
extra:
  schema: execution
depends_on:
  - gap-cockpit-session-start-model-settings
---
## Proposal

为操作者提供设置入口来编辑 `server.settings.json` 的 `cockpit.sessionStart.model` 与 A 引入的可选 effort，并让 cockpit 卡片“开始对话”空会话入口读取服务端当前 boot snapshot。配置只有一个持久来源：`server.settings.json`；保存后运行中进程继续使用旧 effective 值，必须服务重启后才采用保存的新值。此 UI/API 不负责重启当前服务，不读 `.quay/profiles.yml`、不改 fleet workers、不设置 API key/launcher。

<!-- dedup-ref --> 本任务依赖 `gap-cockpit-session-start-model-settings` 定义的模型/effort 配置契约；两者有共同 Touches，但保持 separate，因为首轮 session selection 与设置管理/UI+并发安全写入是不同交付且可独立验收。granularity advice（由协调者执行）对本任务提议 Touches 给出 `peers=[]`、`mentions=[]`；历史同路径记录皆已落地，不是 open 冲突。正式阻塞关系同时通过 `depends_on` 字段表达。

设置界面复用已存在的 provider/model catalog picker（含自定义模型）及 API client。显式展示适用范围是 cockpit 新建会话的两条入口：后台 action/ownReply `session.start` 与卡片“开始对话”；已有会话、scheduled-messages 与 queued/session.send 不受影响。UI 应区分“当前运行生效值”和“已保存、重启后生效值”，提示“重启服务后生效”；不得将配置复制到 appConfigDb、localStorage 或浏览器私有默认。不得添加 provider-id 分支。

## Plan

1. 在 settings module 增加经过鉴权的窄 GET 和 PUT/PATCH API，仅读写允许的 `cockpit.sessionStart.model` / `effort` 字段；响应只含这组无凭据字段、版本/ETag 与 effective/saved 状态，不回传整份设置或模型凭据。写入需校验输入、原子替换文件、对并发版本冲突返回明确冲突，不得覆盖别的请求或部署配置。
2. 按版本/冲突检测更新 `SERVER_SETTINGS_PATH` 指向的 server settings 文件：保留原有全部字段、未知嵌套键和其它 cockpit 字段；读、校验、冲突、写入错误都由 API 明确返回，不能伪装成功。新写值只在下一次 boot 被 `loadServerSettings` 读取。
3. 增加 Settings UI 的 cockpit session-start 设置区，使用现有 catalog picker 编辑 model 与可选 effort，展示 effective/saved 差异及重启提示；将设置页、接口访问与类型按现有模块/共享 API 组织。
4. 令卡片“开始对话”空会话 controller 从该服务端 API 取得有效 boot 配置并通过既有会话创建机制创建空会话；不得用浏览器默认值或已保存 pending 值替代 effective 值，不改空会话首屏、session 注册与导航语义。
5. 回归既有 session.start、既有会话发送、scheduled/queued send 不继承新建模型旋钮；新增类型镜像时同步 wire TypeSync 检查，UI 字符串按仓库真实 locale/哈希机制更新，不新造 provider-specific 分支。

## AC

- [x] `npx tsx --tsconfig server/tsconfig.json --test server/modules/settings/tests/cockpit-session-start-settings.routes.test.ts` 退出 0；匿名/未授权调用被现有认证策略拒绝；授权 GET 只返回 model、effort、effective/saved 标记及版本信息，不含整份配置、模型环境变量或凭据；非法字段被拒绝。
- [x] 同一 settings routes 测试用临时配置文件验证 PUT/PATCH 只改白名单字段，未知顶层/嵌套字段、既有 lifecycle/permission 及其它 cockpit 配置逐字保留；并发版本过期返回冲突且文件未被覆盖，写入采用原子机制，读写错误可见。
- [x] 在两个隔离 boot snapshot 的单文件测试中证明：保存配置后当前进程的 effective model/effort 仍是旧值；仅加载同一文件的新 boot 后有效值才变为保存的新值。测试用临时目录/设置路径，不重启当前 server。
- [x] `npx vitest run src/modules/settings/tests/CockpitSessionStartSettingsTab.test.tsx src/modules/cockpit/tests/cockpitCardStartConversation.test.ts` 退出 0；UI 能读目录、编辑与保存同一模型/effort、可见保存失败与版本冲突、显示“重启服务后生效”及 effective/pending 两种读数；卡片空会话调用取得的服务端 effective selection，而非本地默认，且仍创建空会话并保持原导航语义。
- [x] 同一端到端或单元回归中，既有 session.send、scheduled-messages 与 queued delivery 均不带 cockpit 新建模型设置，并继续用既有 session 的 model；新建卡片入口与 action/ownReply session.start 的设置来自同一服务端配置字段。
- [x] 若新增前端 wire mirror，`npx vitest run src/shared/tests/wireContractTypeSync.test.ts` 退出 0 且双侧类型同步；定向 UI 测试没有新增 provider-id 条件分支。

## DoD

在独立临时 HOME/配置路径和隔离 server instance 中运行完整流程：浏览器通过 Settings UI 读取运行值、选择 catalog model 与可选 effort、保存；确认 UI 同时显示旧 effective / 新 pending 值和“重启服务后生效”，且配置文件只改目标白名单键并保留未知键。当前实例不重启时分别通过 action/ownReply 与卡片“开始对话”创建新会话，核对这两入口仍用旧 boot effective selection，且卡片入口仍为空会话并按原语义导航；已有会话及 scheduled/queued 发送保持原 model。停止并仅重启隔离实例后再创建两种新会话，核对新配置生效、旧会话行未改。不得重启当前/live server，也不触碰 live 密钥或数据库。

UI DoD 必须在真实运行页面经 MCP 浏览器实际打开设置、选择/保存并复核有效/待生效显示，截图存 `tmp/` 并在完成记录贴路径。若仓库现有 UI 场景覆盖该操作，同时运行 `node scripts/ui-scenario.mjs <scenario.json>` 并保留 JSON 报告与检查点截图；若没有覆盖，则新增 `scripts/ui-scenarios/cockpit-session-start-settings.json` 场景并纳入 Touches，贴出运行器报告。以上证据不得以静态渲染或 API curl 替代浏览器操作。

## Touches

- tasks/gap-cockpit-session-start-model-settings-ui.md
- server/modules/settings/server-settings.ts
- server/modules/settings/server-settings-file.ts (new)
- server/modules/settings/settings.routes.ts
- server/modules/settings/settings.service.ts
- server/modules/settings/settings.module.ts
- server/modules/settings/tests/cockpit-session-start-settings.routes.test.ts (new)
- server/modules/providers/services/sessions.service.ts
- server/shared/tests/architecture-ratchet.baseline.json
- server/shared/tests/quay-test-script.test.ts
- src/modules/settings/Settings.tsx
- src/modules/settings/SettingsSidebar.tsx
- src/modules/settings/hooks/useCockpitSessionStartSettings.ts (new)
- src/modules/settings/hooks/useSettingsController.ts
- src/modules/settings/tabs/CockpitSessionStartSettingsTab.tsx (new)
- src/modules/settings/tabs/cockpitSessionStartSettingsController.ts (new)
- src/modules/settings/tests/CockpitSessionStartSettingsTab.test.tsx (new)
- src/modules/cockpit/cockpitCardStartConversation.ts
- src/modules/cockpit/hooks/useCockpitStartConversation.ts
- src/modules/cockpit/tests/cockpitCardStartConversation.test.ts
- src/modules/sidebar/SidebarHeader.tsx
- src/modules/ui-scenario/scenarioSurface.ts
- src/modules/ui-scenario/settingsSurface.ts (new)
- src/modules/i18n/locales/*/settings.json
- src/shared/api.ts
- src/shared/types.ts
- src/shared/tests/wireContractTypeSync.test.ts
- scripts/ui-scenario.mjs
- scripts/ui-scenarios/cockpit-session-start-settings.json (new)

## 完成记录（2026-10-30）

实现要点:

- `server/modules/settings/server-settings-file.ts`: settings 文件读写 seam 与 boot registry;sha256 内容版本/ETag、temp+rename 原子替换、进程内串行写入队列、409 VERSION_CONFLICT、白名单字段保留。
- `settings.service.ts` / `settings.routes.ts` / `settings.module.ts`: 鉴权 GET/PUT/PATCH `/cockpit/session-start`,响应只含 model、effort、effectiveModel、effectiveEffort、version、restartRequired;写入只改 `cockpit.sessionStart.model|effort`,其余顶层/嵌套键逐字保留。
- `src/modules/settings/*`: 新 Cockpit tab、React-free controller 与 hook;显示 saved 与 effective 两种读数及“重启服务后生效”提示;409 保留草稿并可 reload。
- `cockpitCardStartConversation.ts` / `useCockpitStartConversation.ts`: 卡片空会话入口先读服务端 effectiveModel/effectiveEffort 再创建空会话。
- 场景语义面 `settingsSurface.ts` 接入 `scenarioSurface.ts`、`scripts/ui-scenario.mjs` 与新增场景 `scripts/ui-scenarios/cockpit-session-start-settings.json`。

AC 验证命令与结果:

- AC1/2/3/5: `npx tsx --tsconfig server/tsconfig.json --test server/modules/settings/tests/cockpit-session-start-settings.routes.test.ts` → 6/6 pass, exit 0。
- AC4: `npx vitest run src/modules/settings/tests/CockpitSessionStartSettingsTab.test.tsx src/modules/cockpit/tests/cockpitCardStartConversation.test.ts` → 11/11 pass, exit 0。
- AC6: `npx vitest run src/shared/tests/wireContractTypeSync.test.ts` → 4/4 pass, exit 0;新增/修改 UI 文件 grep 无 provider-id 条件分支。
- 回归: settings.service 7/7、cockpit-session-start-model-selection 9/9、resident-restore 5/5、architecture-ratchet 6/6、quay-test-script 14/14;server/client/scripts 三份 tsc 通过;lint exit 0。

DoD 证据（隔离实例 /tmp/ccui-dod-cockpit-session-start,独立 HOME/DB/settings 文件,未触碰 live server、密钥或数据库）:

- 场景运行器报告 `tmp/ui-scenario-session-start/report.json`: `{"ok":true,"failedStep":null,"stepCount":4,"durationMs":1853}`;检查点截图 `tmp/ui-scenario-session-start/step-1-open-settings.png`、`tmp/ui-scenario-session-start/step-4-drive-settings.save.png`。
- 截图读数: 第 1 步 Cockpit 页 saved=`default`、effort 空,In effect now=`default`,无重启提示;第 4 步选 sonnet/high 保存后 saved=`sonnet / high`,In effect now 仍 `default`,重启提示可见。
- 保存后文件: `{"residentRestore":{"enabled":false},"cockpit":{"sessionStart":{"model":"sonnet","effort":"high"}}}` — 只改白名单键,未知键 `residentRestore` 保留。
- 重启前 reading: `{"model":"sonnet","effort":"high","effectiveModel":"default","effectiveEffort":"","version":"d0aff04e…2847","restartRequired":true}`;仅重启同一隔离实例后 reading 的 effective 变为 `sonnet`/`high`、`restartRequired:false`,version 与 saved 不变。

诚实缺口:

- 本 session 没有 MCP 浏览器工具,故 UI DoD 第 1 条以 Playwright 驱动的真实浏览器 + 场景运行器完成,证据来自真实运行页面,非静态渲染或 API curl。
- DoD 中“live 卡片开始对话”与 action/ownReply 实际起会话两腿未在本环境执行（需要 quay-fleet cockpit 夹具与真实 provider 会话);其共享字段语义由 AC5（真实 `createCockpitSessionStarter` 共用 preferences)与 AC4（controller 用服务端 effective selection)覆盖,未执行部分如实记录。

## ADR-007 轴记录

- 该轴仍暗,理由:本任务交付设置表单与已鉴权 API,不涉及 L_D/L_G 可视化轴读数;行为由 AC 判据与隔离实例场景报告覆盖。

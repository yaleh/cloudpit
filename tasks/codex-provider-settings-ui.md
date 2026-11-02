---
id: codex-provider-settings-ui
title: Settings → Agents → Codex 服务商设置 UI：CRUD + 模型编辑器 provider 区
status: ready
labels:
  - feature
parent: null
children: []
extra: {}
depends_on:
  - codex-provider-config-surface
  - codex-resident-provider-injection
  - codex-perrun-provider-injection
goal_ac: AC-465
---
<!-- dedup-ref --> 机制去重：无 Codex 服务商设置 UI 任务。model-library UI 既有任务只管 env 行编辑器；本条是 provider 表单 + 模型编辑器 provider 区。

## Proposal

**现状**：ModelLibraryPanel 对非 opencode provider 一律渲染 ModelEnvEditor（ModelLibraryPanel.tsx:399-407），showGatewayTemplate 只在 claude；Codex 无 provider 选择器。

**范围**：
1. Settings → Agents → Codex 增加服务商设置（provider CRUD：providerId/baseUrl/envKey/tokenFile/wire_api 固定 responses），secret 掩码、未知字段告警、Responses-only 提示。
2. 模型编辑器对 codex 显示 provider 选择器（数据来自 settings 路由），替代 Claude env 编辑器。
3. 前端不写 provider === 'codex' 分支：差异走 PROVIDER_DESCRIPTORS 数据（新增上游配置类别字段）。
4. 复用 controller 模式（useCockpitSessionStartSettings + controller 的版本冲突先例）。

## Touches

- tasks/codex-provider-settings-ui.md
- src/shared/ui/ModelLibraryPanel.tsx
- src/shared/constants.ts
- src/shared/api.ts
- src/shared/types.ts
- src/modules/settings/tabs/agents-settings/sections/content/CodexProvidersContent.tsx（新）
- src/modules/settings/tabs/agents-settings/sections/content/ModelsContent.tsx
- src/modules/settings/tabs/agents-settings/sections/AgentCategoryContentSection.tsx
- src/modules/settings/tabs/agents-settings/sections/AgentCategoryTabsSection.tsx
- src/modules/settings/tabs/agents-settings/sections/AgentSelectorSection.tsx
- src/modules/settings/utils/codexProvidersController.ts（新）
- src/modules/settings/hooks/useCodexProviders.ts（新）
- src/modules/settings/tests/codexProviderSettings.test.tsx（新）
- src/modules/ui-scenario/codexProvidersSurface.ts（新）
- src/modules/ui-scenario/scenarioSurface.ts
- scripts/ui-scenario.mjs
- scripts/ui-scenarios/codex-provider-settings.json（新）

## AC

- [x] AC-465 判据绿：npx vitest run src/modules/settings/tests/codexProviderSettings.test.tsx 退出 0。
- [x] 负臂：secret 掩码、未知字段告警、Responses-only 提示；假形态（分支绕过 PROVIDER_DESCRIPTORS）红。

## DoD

MCP 浏览器实际操作 + 截图存 tmp/（建 provider、绑模型、发送）；scripts/ui-scenario.mjs 场景报告 + 检查点截图；pageErrors=[]。真实页面走一遍，不是只组件测试。

Evidence（2026-11-03；隔离实例 :3217，worktree vite :5217，CODEX_SETTINGS_PATH 指向 tmp/iso-codex-ui/codex.settings.json，未触碰真实 ~/.config/cloudpit）：

- 场景运行器：`node scripts/ui-scenario.mjs scripts/ui-scenarios/codex-provider-settings.json --base-url http://127.0.0.1:5217 …` → `passed (13 steps, 4 checkpoints)`；报告 `tmp/dod-codex/report.json`，checkpoint 截图 `tmp/dod-codex/step-1-open-settings-agents-codex.png`、`tmp/dod-codex/step-8-drive-codexProvider.fill.png`、`tmp/dod-codex/step-9-drive-codexProvider.save.png`、`tmp/dod-codex/step-13-drive-modelLibrary.save.png`。
- 浏览器实际操作（一次性 Playwright 驱动，本会话无 MCP 浏览器工具时的等价路径）：读回已保存 provider、secret 仅以 password 输入 + tokenSet 呈现（页面与 reading 均无明文）、wire_api 锁定 responses、改 baseUrl 后落盘、模型编辑器出现 provider 选择器且无 env 编辑器、清除绑定后目录标签由 `Scenario Codex Model · bob` 回到 `Scenario Codex Model`。报告 `tmp/dod-codex-browser/report.json`，截图 `tmp/dod-codex-browser/01-provider-read.png`…`04-binding-cleared.png`；pageErrors=[]，unhandledRejections=[]（仅一条与本次无关的 SidebarProjectMenu validateDOMNesting console 警告）。
- 服务端落盘读数：`tmp/iso-codex-ui/codex.settings.json` 与 `/tmp/cloudpit-dod-bob.token` 均为 0600；unknown-field 告警、Responses-only 文案与 provider 行由场景断言覆盖。

ADR-007：

- L_D 该轴仍暗,理由:本任务是 Codex 服务商设置 UI 与模型编辑器 provider 区，读数是 AC 判据、场景运行器 13 步与浏览器探针，没有可量化的领域数据轴读数。
- L_G 该轴仍暗,理由:本任务不新增 goal 判据；目标层读数由 GOAL-055 的 AC-465 自己承担，本任务不另立目标质量指标。

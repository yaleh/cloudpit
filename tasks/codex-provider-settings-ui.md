---
id: codex-provider-settings-ui
title: Settings → Agents → Codex 服务商设置 UI：CRUD + 模型编辑器 provider 区
status: todo
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
- src/modules/settings/tabs/agents-settings/sections/content/CodexProvidersContent.tsx（新）
- src/modules/settings/tabs/agents-settings/sections/AgentCategoryContentSection.tsx（分发）
- src/shared/constants.ts（PROVIDER_DESCRIPTORS 增数据字段）
- src/modules/settings/tests/codexProviderSettings.test.tsx（新 vitest）

## AC

- [ ] AC-465 判据绿：npx vitest run src/modules/settings/tests/codexProviderSettings.test.tsx 退出 0。
- [ ] 负臂：secret 掩码、未知字段告警、Responses-only 提示；假形态（分支绕过 PROVIDER_DESCRIPTORS）红。

## DoD

MCP 浏览器实际操作 + 截图存 tmp/（建 provider、绑模型、发送）；scripts/ui-scenario.mjs 场景报告 + 检查点截图；pageErrors=[]。真实页面走一遍，不是只组件测试。
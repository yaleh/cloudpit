---
id: codex-model-provider-settings-hint
title: 设置页 Codex providers/模型库提示 provider 变体语义
status: todo
labels:
  - feature
parent: null
children: []
extra: {}
goal_ac: AC-471
---
<!-- dedup-ref --> 机制去重：设置页 Codex 服务商 UI 已有 codex-provider-settings-ui（CRUD + 模型编辑器 provider 区）；本条只加提示文案与 built-in · N provider variants 显示，不新增表单。

## Proposal

**现状**：CodexProvidersContent 的 provider 卡片没有说明 provider 在 composer/新建会话选择器里如何出现；模型库内置模型行不显示 provider 变体数。

**范围**：
1. Codex providers 卡片说明每个 provider 以 (provider) 变体出现在 composer 与新建会话选择器（后缀=provider id）。
2. 模型库内置模型行显示 built-in · N provider variants（N=注册 provider 数，来自 provider 注册表读数）。

## Touches

- tasks/codex-model-provider-settings-hint.md
- src/modules/settings/tabs/agents-settings/sections/content/CodexProvidersContent.tsx
- src/shared/ui/ModelLibraryPanel.tsx
- src/modules/settings/tests/codexProviderSettings.test.tsx

## AC

- [ ] AC-471 判据绿：npx vitest run src/modules/settings/tests/codexProviderSettings.test.tsx 退出 0。
- [ ] 正臂：provider 卡片含变体提示；模型库内置模型行显示 built-in · N provider variants 且 N=注册 provider 数。
- [ ] 负臂：无注册 provider 时 N=0 或行不显示变体数。
- [ ] 假形态：硬编码 provider 名或写死 N 红。

## DoD

MCP 浏览器实际操作 + 截图存 tmp/（设置页看 provider 卡片提示与模型库变体数）；vitest 单文件绿 + npm run typecheck + lint。

## ADR-007

- L_D 该轴仍暗,理由:本任务是设置页提示文案，读数是 AC 判据与浏览器截图，没有可量化的领域数据轴读数。
- L_G 该轴仍暗,理由:本任务不新增 goal 判据；目标层读数由 GOAL-056 的 AC-471 承担。
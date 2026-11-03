---
id: codex-provider-import-ui-wiring
title: Codex 导入 provider 的父级接线：挂到设置页 + 一键绑定到模型编辑器的 codexProviderId
status: ready
labels:
  - feature
parent: null
children: []
extra: {}
depends_on:
  - codex-provider-settings-ui
  - codex-provider-import-user-profile
---
<!-- dedup-ref --> 机制去重：codex-provider-import-user-profile（done）交付了只读解析 + CodexProviderImport.tsx 组件本体，但「挂到设置页 + 接模型编辑器 codexProviderId」的父级接线被该任务显式排除在 Touches 外（其实现说明逐字写明）。本条是那条 UI 接线的补全，机制是 DOM 挂载与绑定流，不是 TOML 解析。

## Proposal

**现状**：CodexProviderImport.tsx 已交付（reading + onBind(providerId) 契约、逐行未知字段告警、bindable/不可绑定原因），但没有任何父组件挂载它；模型编辑器的 provider 选择器也收不到它的 onBind。用户无法从设置页「一键绑定」导入的 provider 到模型条目。

**范围**：
1. 把 CodexProviderImport 挂到 Settings → Agents → Codex 的服务商设置区（CodexProvidersContent），列出只读导入的 provider 与 bindable 状态。
2. onBind(providerId) 接到模型编辑器的 codexProviderId：点「绑定」即把该 provider 设为当前编辑模型条目的 provider 选择值，保存后落库。
3. 复用既有 useCodexProviders / codexProvidersController，不新写状态机；provider 差异继续走 PROVIDER_DESCRIPTORS 数据，不写 provider === 'codex' 分支。

## Touches

- src/modules/settings/tabs/agents-settings/sections/content/CodexProvidersContent.tsx
- src/modules/settings/tabs/agents-settings/sections/content/CodexProviderImport.tsx
- src/shared/ui/ModelLibraryPanel.tsx
- src/modules/settings/tabs/agents-settings/sections/content/ModelsContent.tsx
- src/modules/settings/tests/codexProviderImportWiring.test.tsx（新判据，红先行）
- tasks/codex-provider-import-ui-wiring.md

## AC

- [ ] 判据绿：npx vitest run src/modules/settings/tests/codexProviderImportWiring.test.tsx 退出 0、fail 0。
- [ ] 负臂：绑定动作把 codexProviderId 写进模型条目（保存后回读一致）；bindable=false 的导入行「绑定」禁用；未挂载/未接线时必红。

## DoD

真实浏览器走一遍（场景运行器 + 一次性 Playwright 驱动，截图存 tmp/）：设置页看到导入的 bob provider（bindable + 未知字段告警），点「绑定」后模型编辑器 provider 选择器选中 bob 并可保存；pageErrors=[]。
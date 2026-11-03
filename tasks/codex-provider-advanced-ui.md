---
id: codex-provider-advanced-ui
title: Codex 高级表单 UI：高级字段编辑 + 连接测试按钮（补齐 scoped-out 的 CodexProviderAdvanced.tsx）
status: todo
labels:
  - feature
parent: null
children: []
extra: {}
depends_on:
  - codex-provider-settings-ui
  - codex-provider-advanced-capabilities
---
<!-- dedup-ref --> 机制去重：codex-provider-advanced-capabilities（done）交付了服务端高级字段 schema/注入/连接测试与 effort·窗口，但 CodexProviderAdvanced.tsx 只声明在 Touches、表单本体未建（其 Verification 逐字写明「表单未在本任务改动」）。本条是那个高级表单 UI，机制是表单与连接测试交互，不是服务端机制。

## Proposal

**现状**：服务端已能存/读/编译 http_headers、env_http_headers、query_params、request_max_retries、stream_max_retries、stream_idle_timeout_ms、model_catalog_url、effort/窗口，且有连接测试端点（六种结局 + billable 提示）。但前端没有编辑这些字段的表单（CodexProviderAdvanced.tsx 未建），用户只能手改 settings 文件。

**范围**：
1. CodexProviderAdvanced.tsx：高级字段表单（headers 键值对、query_params、retries/timeout、model_catalog_url）+ 连接测试按钮（展示六种结局之一 + billable 提示）。
2. 复用/扩展 useCodexProviders / codexProvidersController 接 settings 路由（版本冲突沿用既有语义）；不新写状态机。
3. provider 差异走 PROVIDER_DESCRIPTORS 数据，不写 provider === 'codex' 分支。

## Touches

- src/modules/settings/tabs/agents-settings/sections/content/CodexProviderAdvanced.tsx（新）
- src/modules/settings/tabs/agents-settings/sections/content/CodexProvidersContent.tsx（挂载）
- src/modules/settings/utils/codexProvidersController.ts
- src/modules/settings/hooks/useCodexProviders.ts
- src/shared/api.ts
- src/modules/settings/tests/codexProviderAdvancedUi.test.tsx（新判据，红先行）
- tasks/codex-provider-advanced-ui.md

## AC

- [ ] 判据绿：npx vitest run src/modules/settings/tests/codexProviderAdvancedUi.test.tsx 退出 0、fail 0。
- [ ] 负臂：高级字段表单保存后回读一致；连接测试按钮展示 billable 提示与结局；未渲染/未接线时必红。

## DoD

真实浏览器走一遍（截图存 tmp/）：编辑 headers/query_params/retries 保存回读一致；点连接测试出结局之一（本地 mock，不发真实计费请求）；pageErrors=[]。
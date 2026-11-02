---
id: codex-provider-advanced-capabilities
title: 连接测试 + 高级字段：headers/query_params/retries/model_catalog_url/effort/上下文窗口
status: todo
labels:
  - feature
parent: null
children: []
extra: {}
depends_on:
  - codex-provider-config-surface
  - codex-provider-settings-ui
goal_ac: AC-467
---
<!-- dedup-ref --> 机制去重：无 Codex provider 高级字段/连接测试任务。本条是 P2 明确延期范围，机制独立于 codex-provider-config-surface 与 UI 之外。

## Proposal

**现状**：provider 高级字段（http_headers/env_http_headers/query_params/retries/timeouts/model_catalog_url）与连接测试、effort/上下文窗口均未实现；0.166.0 实测 http_headers/query_params 经 -c 注入会打到 wire。

**范围**：
1. 连接测试：向 base_url 发最小请求，区分 DNS/401/404/非 Responses 端点，显式标注计费。
2. 高级字段透传：http_headers/env_http_headers/query_params/request_max_retries/stream_max_retries/stream_idle_timeout_ms/model_catalog_url 经 -c 注入。
3. 自定义模型 effort 元数据与 model_context_window/model_auto_compact_token_limit 由条目解析并生效（对齐 Claude 的上下文窗口事实源）。

## Touches

- server/modules/settings/codex-model-providers.settings.ts（高级字段 + 连接测试）
- server/modules/settings/tests/codex-provider-advanced.test.ts（新判据，撞 pin 则上调）
- server/modules/providers/list/codex/codex-models.provider.ts（effort/窗口）
- src/modules/settings/tabs/agents-settings/sections/content/CodexProviderAdvanced.tsx（高级表单，跟随 codex-provider-settings-ui）
- tasks/codex-provider-advanced-capabilities.md（self-touch）

## AC

- [ ] AC-467 判据绿：npx tsx --tsconfig server/tsconfig.json --test server/modules/settings/tests/codex-provider-advanced.test.ts 退出 0、fail 0。

## DoD

连接测试对本地 mock 区分四种结局；高级字段经 -c 打到 wire（mock 读 header/query）；判据逐字 tests/pass/fail；新 test.ts 撞 pin 则等量上调并注明。
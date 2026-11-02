---
id: AC-467
title: 连接测试 + 高级字段：headers/query_params/retries/model_catalog_url/effort/上下文窗口
status: draft
kind: criterion
goal: GOAL-055
criterion: npx tsx --tsconfig server/tsconfig.json --test
  server/modules/settings/tests/codex-provider-advanced.test.ts
expect: 连接测试（向 base_url 发最小请求，区分 DNS/401/404/非 Responses
  端点）；http_headers/env_http_headers/query_params/request_max_retries/stream_max_retries/stream_idle_timeout_ms/model_catalog_url
  通过 -c 注入并打到 wire；自定义模型的 effort 元数据与
  model_context_window/model_auto_compact_token_limit 由条目解析并生效。
origin: 人 yale 2026-11-02：P2 明确延期范围，但列为本 goal 退出条件，由
  codex-provider-advanced-capabilities 落地。
---

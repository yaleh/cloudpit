---
id: codex-provider-advanced-capabilities
title: 连接测试 + 高级字段：headers/query_params/retries/model_catalog_url/effort/上下文窗口
status: done
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
- server/modules/settings/codex-model-providers.schema.ts（高级字段解析与校验）
- server/modules/settings/tests/codex-provider-advanced.test.ts（新判据，撞 pin 则上调）
- server/modules/providers/list/codex/codex-models.provider.ts（effort/窗口）
- server/modules/providers/list/codex/codex-provider-injection.ts（-c 与 SDK config 编译）
- server/modules/providers/list/codex/codex-app-server.client.ts（catalog 条目窗口字段）
- server/modules/providers/list/codex/codex-runtime.provider.ts（选中条目的窗口生效）
- server/modules/providers/index.ts（跨模块判据经 barrel）
- server/shared/ports/codex-provider-registry.port.ts（resolve 后的高级字段）
- server/shared/types.ts
- src/shared/types.ts
- server/shared/tests/quay-test-script.test.ts（unknown pin 等量上调）
- server/shared/tests/architecture-ratchet.baseline.json（RECORDED CHANGE）
- scripts/suite-duration-baseline.tsv（时长基线行）
- src/modules/settings/tabs/agents-settings/sections/content/CodexProviderAdvanced.tsx（高级表单，跟随 codex-provider-settings-ui）
- tasks/codex-provider-advanced-capabilities.md（self-touch）

## AC

- [x] AC-467 判据绿：npx tsx --tsconfig server/tsconfig.json --test server/modules/settings/tests/codex-provider-advanced.test.ts 退出 0、fail 0。

## DoD

连接测试对本地 mock 区分四种结局；高级字段经 -c 打到 wire（mock 读 header/query）；判据逐字 tests/pass/fail；新 test.ts 撞 pin 则等量上调并注明。

## Verification

- 判据逐字：`npx tsx --tsconfig server/tsconfig.json --test server/modules/settings/tests/codex-provider-advanced.test.ts` → `tests 5` / `pass 5` / `fail 0`，退出 0（2026-11-03，worktree codex-provider-advanced-capabilities）。
- 五种结局逐条：mock 上 `200 {object:"response"}` → `ok`；`401` → `unauthorized`；`404` → `not-found`；`200 {object:"chat.completion"}` → `not-responses`；`5xx` → `server-error`；`http://codex-advanced.invalid/v1` 实测 `getaddrinfo ENOTFOUND` → `dns`。每次读数均带 `billable:true` 与逐字计费提示 `This connection test sends one real request to your upstream provider; the provider may bill it.`
- 高级字段打到 wire（真实打包 CLI 0.166.0，非注入 transport）：mock 收到 `/v1/responses?api-version=2026-01-01&tenant=acme`，`x-advanced: yes`，`authorization: Bearer <tokenFile secret>`；同一次读数证明 `query_params` 与 `http_headers` 经 `-c` 真正生效。
- resident `-c` 读数：`codexProviderSpawnArgs` 输出含 `http_headers = { "X-Advanced" = "yes" }`、`env_http_headers`、`query_params`、`request_max_retries = 1`、`stream_max_retries = 2`、`stream_idle_timeout_ms = 3000`、`model_catalog_url = "https://catalog.example.test/models.json"`，以及顶层 `model_context_window=123456` / `model_auto_compact_token_limit=100000`；argv 不含 secret。
- effort/窗口由条目解析并生效：catalog 条目 `supportedReasoningEfforts[].description` 映射到选项；条目 `modelContextWindow=258400` / `modelAutoCompactTokenLimit=200000` 覆盖 provider 条目默认（100000/50000），runtime 编译进 `config.model_context_window` / `model_auto_compact_token_limit`；`effort:"high"` 经条目 `effort.values` 校验后成为 `modelReasoningEffort`。
- 负臂：写路径拒绝非字符串 header、非法 env 变量名、负数 retries、0 timeout、非绝对 catalog URL、0 窗口与两种拼写不一致；手改文件的坏可选字段只告警并丢弃该字段、provider 仍可读。
- pin 等量上调：`server/shared/tests/quay-test-script.test.ts` unknown 502→503 / 504→505（并注明 506 collected）；`scripts/suite-duration-baseline.tsv` 加本判据行；`server/shared/tests/architecture-ratchet.baseline.json` 两个手工同形 types.ts 5572→5595 / 4935→4958 以 RECORDED CHANGE 写明。
- 邻面回归：codex-model-providers-settings / codex-provider-import / provider-models.service / codex-app-server-protocol / codex-runtime-provider-injection / codex-resident-provider-injection / architecture-ratchet / server-import-cycle-budget / quay-test-script 全绿；server 与 client typecheck 通过、oxlint 无输出。
- 范围说明：本落地实现服务端机制（schema/settings/injection/models/connection test）；`CodexProviderAdvanced.tsx` 表单未在本任务改动（AC/DoD 均只钉服务端判据），Touches 保留该声明给后续 UI 面。

ADR-007:

- 该轴仍暗,理由:本任务只扩展 Codex provider 的设置字段、注入编译与判据，未改变模块边界或依赖图，未产出 ArchGuard 领域量化读数。
- 该轴仍暗,理由:本任务不新增 goal 判据；目标层读数由 GOAL-055 的 AC-467 自己承担，本任务不另立目标质量指标。
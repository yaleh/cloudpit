---
id: codex-provider-advanced-ui
title: Codex 高级表单 UI：高级字段编辑 + 连接测试按钮（补齐 scoped-out 的 CodexProviderAdvanced.tsx）
status: ready
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

## Plan

- 表单状态落在既有 `codexProvidersController` 的 draft 上（高级字段以行列表 + 字符串数字框编辑），`draftToWrite` 是把草稿转成 wire 的唯一出口；空行/空数字不写成 `{}`/0，避免覆盖 Codex 自身默认。
- 连接测试走 controller 的新命令 `testConnection(providerId)`，只发送 SAVED provider 的 id；服务端用 `resolve(id)` 取条目与 token file secret 后调用已交付的 `probeCodexProviderConnection`，浏览器全程不接触 secret。
- 服务端新增 `POST /api/settings/codex/model-providers/test`（`codex-model-providers.connection.ts` 承担 transport 校验，`codex-model-providers.service.ts` 委托，`settings.module.ts` 接 resolve→probe），因为提案里说的「连接测试端点」此前只有函数、没有 transport —— 不补这一层，按钮只能对着 404 假接线。
- billable 句由页面在按钮旁先渲染（与 probe reading 的 `billingNote` 同一句），再按 outcome 数据表渲染七种结局标签。

## Touches

- src/modules/settings/tabs/agents-settings/sections/content/CodexProviderAdvanced.tsx（新）
- src/modules/settings/tabs/agents-settings/sections/content/CodexProvidersContent.tsx（挂载）
- src/modules/settings/utils/codexProvidersController.ts
- src/modules/settings/hooks/useCodexProviders.ts
- src/shared/api.ts
- src/modules/settings/tests/codexProviderAdvancedUi.test.tsx（新判据，红先行）
- server/modules/settings/codex-model-providers.connection.ts（新：连接测试 transport 校验）
- server/modules/settings/codex-model-providers.service.ts（探针操作）
- server/modules/settings/settings.routes.ts（POST .../model-providers/test）
- server/modules/settings/settings.module.ts（resolve → probe 接线）
- server/modules/settings/tests/codex-provider-advanced.test.ts（探针动作判据）
- tasks/codex-provider-advanced-ui.md

## AC

- [x] 判据绿：npx vitest run src/modules/settings/tests/codexProviderAdvancedUi.test.tsx 退出 0、fail 0。
- [x] 负臂：高级字段表单保存后回读一致；连接测试按钮展示 billable 提示与结局；未渲染/未接线时必红。

## DoD

真实浏览器走一遍（截图存 tmp/）：编辑 headers/query_params/retries 保存回读一致；点连接测试出结局之一（本地 mock，不发真实计费请求）；pageErrors=[]。

## Verification

- 判据逐字：`npx vitest run src/modules/settings/tests/codexProviderAdvancedUi.test.tsx` → `Test Files 1 passed` / `Tests 4 passed`，退出 0（2026-11-03，worktree codex-provider-advanced-ui）。四条读数：表单按 reading 渲染全部高级字段且按钮旁先有 billable 句；保存的 PUT 带高级字段、真实 reload 后从 GET reading 回读一致；探测 POST 只带 `{id:"bob"}` 并渲染服务端 outcome（unauthorized→ok 两态）；未保存行探测按钮禁用且空表单不写任何高级键。
- 服务端动作判据：`bash scripts/with-memory-cap.sh npx tsx --tsconfig server/tsconfig.json --test server/modules/settings/tests/codex-provider-advanced.test.ts` → `tests 6` / `pass 6` / `fail 0`（新增一例：探针动作只转发 saved id，拒绝未知字段/空 id/未配置 port，且拒绝的请求到不了 probe seam）。
- 浏览器 DoD（隔离实例 :15847 由本 worktree 构建的 dist-server 启动，Vite :15173；探针路由用 Playwright route 本地 mock，未发真实计费请求）：读取 `report.json` — persisted `httpHeaders {"X-Advanced":"yes"}`、`envHttpHeaders {"X-Tenant":"TENANT_ENV"}`、`queryParams {"api-version":"2026-01-01"}`、retries 1/2、idle 3000、catalog `https://catalog.example.test/models.json`；真实 reload 后 readBack 逐值相同；按钮旁 billable 句逐字可见；点按后 `probeBodies=[{"id":"bob"}]`、`data-outcome=ok`、页面显示 `Connected — the endpoint answered like a Responses API` + `HTTP 200`；`pageErrors=[]`、`unhandledRejections=[]`、console 无其它 error。截图：`tmp/codex-provider-advanced-ui/advanced-form-filled.png`、`advanced-form-reloaded.png`、`connection-test-outcome.png`；读数 `tmp/codex-provider-advanced-ui/report.json`。
- 场景运行器回归：`node scripts/ui-scenario.mjs scripts/ui-scenarios/codex-provider-settings.json --base-url http://127.0.0.1:15173 --auth-token <token> --project claudecodeui --session unused` → `ok:true`、13 steps、4 checkpoints、4101ms；报告 `tmp/ui-scenarios/codex-provider-advanced-ui-regression/report.json`。该场景覆盖既有 provider CRUD/模型绑定，未含高级字段动词；高级字段的交互证据由上一条真实浏览器 DoD 承担。
- typecheck：`tsc --noEmit -p tsconfig.json` 与 `tsc --noEmit -p server/tsconfig.json` 均通过；oxlint 对全部改动文件无输出。
- Touches 扩展理由：提案中的「连接测试端点」在基线里只有 `probeCodexProviderConnection` 函数、没有 HTTP transport；按钮要真接线必须新增 route/service/port，故把五个 server 文件按 ABI 补进 Touches（不是顺手改动）。

ADR-007:

- 该轴仍暗,理由:本任务只新增 Codex provider 高级表单与既有连接探针的传输接线，未改变模块边界或依赖图，未产出 ArchGuard 领域量化读数。
- 该轴仍暗,理由:本任务不新增 goal 判据；目标层读数由既有 GOAL-055/AC-467 承担，本任务不另立目标质量指标。
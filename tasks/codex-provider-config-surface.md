---
id: codex-provider-config-surface
title: Codex 上游 provider 配置面：settings 文件 + 0600 + tokenFile secret + 读写路由与校验
status: ready
labels:
  - feature
parent: null
children: []
extra: {}
goal_ac: AC-460
---
<!-- dedup-ref --> 机制去重（2026-11-02）：`grep -rliE 'model_providers|codexProvider|上游 provider|自定义服务商' tasks/` 无同机制任务；codex 既有任务均为 resident/catalog/transcript，不涉及项目级 provider 配置。settings 先例：codex.mcpGateway（codex-mcp-gateway.settings.ts）+ per-feature settings 文件（reply-suggestions / voice-realtime）。

## Proposal

**现状**：Codex 无项目级 provider 配置。模型库 config.env 是 Claude 专用白名单（server/modules/providers/services/launch-spec.service.ts:23-40），OPENAI_*/CODEX_*/任意 env_key 都 400；Codex runtime 从不消费 config.env。换端点只能手改 ~/.codex/config.toml，全实例共用。codex.mcpGateway 已有 settings 块 + tokenFile 先例（token 不进 argv、0600、每 spawn 解析）。

**范围**：
1. 新建项目自有 settings 文件（per-feature 惯例，如 ~/.config/claudecodeui/codex.settings.json，0600），含 codex.modelProviders 注册表；loader resolveCodexModelProvider(id) 在 spawn 时读（非 boot-only），单测可注入。
2. settings 路由 GET（secret→isSet）/ PUT（expectedVersion 冲突、保留 id openai/ollama/lmstudio 拒绝、wire_api 仅 responses、未知字段如 api 告警）。
3. secret 用 tokenFile（每 provider 一个 0600 文件），沿用 codex.mcpGateway.tokenFile 语义：只读、缺失即缺 secret、不进 JSON、不进 argv。

## Touches

- server/modules/settings/codex-model-providers.settings.ts (new)
- server/modules/settings/codex-model-providers.schema.ts (new)
- server/modules/settings/codex-model-providers.store.ts (new)
- server/modules/settings/codex-model-providers.service.ts (new)
- server/modules/settings/settings.routes.ts
- server/modules/settings/settings.service.ts
- server/modules/settings/settings.module.ts
- server/modules/settings/index.ts
- server/modules/settings/server-settings-file.ts
- server/modules/settings/tests/codex-model-providers-settings.test.ts (new)
- server/shared/settings-file.ts
- server/shared/types.ts
- src/shared/types.ts
- src/shared/tests/wireContractTypeSync.test.ts
- server/shared/tests/quay-test-script.test.ts
- server/shared/tests/architecture-ratchet.baseline.json
- scripts/suite-duration-baseline.tsv
- config/codex.settings.example.json (new)
- tasks/codex-provider-config-surface.md

## Plan

落点为 `server/modules/settings/` 内的四个新文件，按后端模块标准拆开：`-schema.ts`（provider 条目校验与 camelCase/snake_case 别名）、`-store.ts`（路径、内容哈希版本、原子 0600 写、token 文件读/写）、`-settings.ts`（source 工厂：`read` / `resolve(id)` / `write`）、`-service.ts`（路由输入校验，compose 进 `createSettingsService`）。`settings.module.ts` 建一个生产 source 注入端口；`index.ts` 导出 source 与 resolve 类型给 resident/per-run 注入任务。共享原子写从 `server-settings-file.ts` 抽到 `server/shared/settings-file.ts`，两处 writer 复用。前端只加两端同形的 wire 类型 + TypeSync 行。

## AC

红先行，落 AC-460。

- [x] AC-460 判据绿：npx tsx --tsconfig server/tsconfig.json --test server/modules/settings/tests/codex-model-providers-settings.test.ts 退出 0、fail 0。
- [x] 负臂：保留 id / wire_api=chat / 空 baseUrl 拒绝；未知字段告警；secret GET 只回 isSet；文件 0600；版本冲突可读——各自假形态红。

## Verification

- 判据逐字：`npx tsx --tsconfig server/tsconfig.json --test server/modules/settings/tests/codex-model-providers-settings.test.ts` → `tests 9` / `pass 9` / `fail 0`，退出 0。
- 负臂逐条：`CODEX_PROVIDER_ID_RESERVED`（openai / OLLAMA / lmstudio）、`CODEX_PROVIDER_WIRE_API_UNSUPPORTED`（wire_api=chat）、`CODEX_PROVIDER_BASE_URL_REQUIRED`（空 baseUrl）、`CODEX_PROVIDER_BASE_URL_INVALID`；未知字段 `api` 在 PUT 与手写文件两条读法都告警且不落盘。
- 0600 实测：判据内 `statSync(file).mode & 0o777 === 0o600`（预置 0644 的 settings 文件写入后也变 0600；token 文件同为 0600）。
- secret 只写：PUT `token` 写入 tokenFile；PUT/GET 响应文本逐字不含 secret，项目 JSON 不含 secret 也不含 `"token"` 字段；GET 只回 `tokenSet`。
- 缺失可读：`resolve('bob')` 无 token 文件 → `no usable secret: token file … is missing`；未知 id → `"nobody" is not configured`；从不回落 openai。
- 版本冲突：旧 `expectedVersion` → 409 `VERSION_CONFLICT` + `reload and save again`，文件字节不变；`If-Match` 亦接受。
- pin 等量上调：`server/shared/tests/quay-test-script.test.ts` unknown 495→496 / 497→498；`scripts/suite-duration-baseline.tsv` 加本判据 2206ms 行（覆盖地板）；`server/shared/tests/architecture-ratchet.baseline.json` 的 oversizeFiles 两处 types.ts 以 RECORDED CHANGE 记录（契约两端同形，增加即交付）。

## DoD

真实文件 0600（ls -l 实测）、secret 读回不可见、tokenFile 缺失给可读缺 secret、版本冲突不静默覆盖；判据逐字 tests/pass/fail；新 test.ts 若撞 quay-test-script pin / 时长基线，同任务等量上调并注明。

## ADR-007

- 该轴仍暗,理由:本任务只新增 settings 叶内文件与两端同形类型，未改动模块边界或依赖图，未产出 ArchGuard 读数。

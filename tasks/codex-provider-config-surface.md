---
id: codex-provider-config-surface
title: Codex 上游 provider 配置面：settings 文件 + 0600 + tokenFile secret + 读写路由与校验
status: todo
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

- server/modules/settings/codex-model-providers.settings.ts (new)（新 loader）
- server/modules/settings/settings.routes.ts（读写路由 + 版本冲突）
- server/modules/settings/settings.service.ts（读写路由 + 版本冲突）
- server/modules/settings/tests/codex-model-providers-settings.test.ts (new)（新判据，撞 pin 则等量上调）
- config/codex.settings.example.json (new)（示例 + _comment）
- server/shared/types.ts（CodexModelProvider 类型 + TypeSync）
- src/shared/types.ts（CodexModelProvider 类型 + TypeSync）
- tasks/codex-provider-config-surface.md

## AC

红先行，落 AC-460。

- [ ] AC-460 判据绿：npx tsx --tsconfig server/tsconfig.json --test server/modules/settings/tests/codex-model-providers-settings.test.ts 退出 0、fail 0。
- [ ] 负臂：保留 id / wire_api=chat / 空 baseUrl 拒绝；未知字段告警；secret GET 只回 isSet；文件 0600；版本冲突可读——各自假形态红。

## DoD

真实文件 0600（ls -l 实测）、secret 读回不可见、tokenFile 缺失给可读缺 secret、版本冲突不静默覆盖；判据逐字 tests/pass/fail；新 test.ts 若撞 quay-test-script pin / 时长基线，同任务等量上调并注明。
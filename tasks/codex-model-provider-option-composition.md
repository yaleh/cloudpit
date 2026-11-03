---
id: codex-model-provider-option-composition
title: Codex 模型目录 model×provider 选项 + 会话模型写路径接受显式 provider id
status: done
labels:
  - feature
parent: null
children: []
extra: {}
goal_ac: AC-468
---
<!-- dedup-ref --> 机制去重：GOAL-055 的 codex-model-entry-provider-binding（模型条目挂 codexProviderId）与 codex-session-provider-id-binding（会话记录 model_provider_id）已落地；本条把「选项身份 = model + provider id」做成端到端（目录返回 modelProviderId + 写路径接受显式 id），不重复 provider 注册表/会话绑定。

## Proposal

**现状**：getProviderModels('codex') 返回内置模型（动态发现）+ 自定义模型（config.codexProviderId），但 OPTIONS 项没有 modelProviderId 字段，内置模型只有裸名；resolveModelProviderId 只从自定义模型目录派生 provider id（session-provider-binding.ts:71-78），内置模型永远继承 Codex 默认 openai。setSessionModel(provider, sessionId, model) 只收 model，requestedProviderId 一律由 resolveModelProviderId 派生（provider-models.service.ts:586）。

**范围**：
1. getProviderModels('codex') 对每个内置模型展开为裸名（modelProviderId 缺省）+ 每个注册 provider 的变体（modelProviderId=provider id），自定义模型单条带其 codexProviderId；选项 value 仍是 model id，modelProviderId 是独立字段。
2. setSessionModel 与 setSessionActiveModel 路由接受显式 modelProviderId（内置模型路由到非默认 provider），沿用 assertProviderSwitchAllowed/assertProviderAvailable 校验；显式 id 与派生 id 冲突时以显式 id 为准并校验。
3. 目录 DEFAULT 仍是 codex 默认（裸名），不因展开变体改变。

## Touches

- tasks/codex-model-provider-option-composition.md
- server/modules/providers/services/provider-models.service.ts
- server/modules/providers/services/session-provider-binding.ts
- server/modules/providers/list/codex/codex-models.provider.ts
- server/modules/providers/provider.routes.ts
- server/modules/providers/tests/codex-model-provider-option.test.ts（新）
- server/shared/types.ts
- server/shared/interfaces.ts
- server/shared/tests/architecture-ratchet.baseline.json
- server/shared/tests/quay-test-script.test.ts
- scripts/suite-duration-baseline.tsv

## AC

- [x] AC-468 判据绿：npx tsx --tsconfig server/tsconfig.json --test server/modules/providers/tests/codex-model-provider-option.test.ts 退出 0。
- [x] 正臂：getProviderModels('codex') 内置模型展开裸名+每个注册 provider 变体、自定义模型单条带 codexProviderId；setSessionModel 显式 modelProviderId 落库 model_provider_id。
- [x] 负臂：换 provider 拒绝（SESSION_PROVIDER_MISMATCH）、未知 provider 拒绝（SESSION_PROVIDER_UNKNOWN）；显式 id 与既有会话绑定冲突拒绝。
- [x] 假形态：目录不展开（只裸名）或 setSessionModel 忽略显式 id 时判据红。

## DoD

tsc --noEmit -p server/tsconfig.json 通过；tsx --test 单文件绿；新增 server 测试文件后更新 quay test script unknown-pin 基线与时长基线（coverage floor）。

## ADR-007

- L_D 该轴仍暗,理由:本任务是目录/写路径机制，读数是 AC 判据，没有可量化的领域数据轴读数。
- L_G 该轴仍暗,理由:本任务不新增 goal 判据；目标层读数由 GOAL-056 的 AC-468 承担。

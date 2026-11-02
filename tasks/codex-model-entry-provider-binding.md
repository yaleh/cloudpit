---
id: codex-model-entry-provider-binding
title: Codex 模型条目挂 codexProviderId：绑定与校验、目录显示 model · provider
status: todo
labels:
  - feature
parent: null
children: []
extra: {}
depends_on:
  - codex-provider-config-surface
goal_ac: AC-461
---
<!-- dedup-ref --> 机制去重：`grep -rliE 'codexProviderId|模型条目.*provider|挂 provider' tasks/` 无同机制任务。与 codex-provider-config-surface（配置面）机制不同：本条是模型条目引用 providerId 的绑定与校验。

## Proposal

**现状**：ProviderModelConfig 只有 { env: [...] }（server/shared/types.ts:542），provider_models.config_json 存 env 行；Codex 模型条目与 Claude 共用 env 编辑器，Codex 端点无法表达。

**范围**：
1. ProviderModelConfig 增 codexProviderId（可选；未声明 = 继承 Codex 全局）。
2. provider-models.service.ts 校验：声明不存在/已删 provider → 可读 409/404（含 provider id），不落库；provider.routes.ts parseModelConfigPayload 透传。
3. 删除/改名 provider 时检查引用（codex-session-provider-id-binding 之前先给可读错误）。
4. 目录合并后自定义模型行带 provider 显示（model · provider），供 UI 区分同名模型。

## Touches

- server/shared/types.ts + src/shared/types.ts（ProviderModelConfig.codexProviderId + TypeSync）
- server/modules/providers/services/provider-models.service.ts
- server/modules/providers/provider.routes.ts
- server/modules/providers/tests/codex-provider-model-binding.test.ts（新判据，撞 pin 则上调）

## AC（红先行，落 AC-461）

- [ ] AC-461 判据绿：npx tsx --tsconfig server/tsconfig.json --test server/modules/providers/tests/codex-provider-model-binding.test.ts 退出 0、fail 0。
- [ ] 负臂：声明不存在 provider / 已删 provider 拒绝；未声明沿用现行为（passthrough 基线不红）。

## DoD

判据逐字 tests/pass/fail；新 test.ts 撞 quay pin / 时长基线则等量上调并注明；typecheck 绿。
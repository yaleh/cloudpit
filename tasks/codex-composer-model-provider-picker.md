---
id: codex-composer-model-provider-picker
title: composer 模型菜单渲染 model×provider 单选择项并发送 model + provider id
status: ready
labels:
  - feature
parent: null
children: []
extra: {}
goal_ac: AC-469
---
<!-- dedup-ref --> 机制去重：composer 模型菜单已有 ComposerModelMenu + useChatProviderState.selectProviderModel；本条只把选项身份从 model 扩成 model+modelProviderId，不新开 provider 下拉框。

## Proposal

**现状**：ComposerModelMenu 渲染 modelOptions（ProviderModelOption[]），key=option.value，onSelectModel(option.value)；useChatProviderState 以 providerModels[provider] 存单字符串 model，selectProviderModel 只发 model（useChatProviderState.ts:630-680）。ProviderModelOption 无 modelProviderId 字段。

**范围**：
1. src/shared/types.ts 给 ProviderModelOption 加 modelProviderId?: string|null（wire 镜像，同步 wireContractTypeSync）。
2. useChatProviderState：选项身份改为 (value, modelProviderId)；选中变体时 selectProviderModel 携带 model + modelProviderId（裸名 modelProviderId=null）；存储按 provider 记 (model, modelProviderId)。
3. ComposerModelMenu 按 model 分组渲染内置模型（裸名 + 每个 (provider) 变体）与自定义模型（单条）；收起态按钮显示合成标签 gpt-5.6-terra (fjdac)。
4. 前端不写 provider === 'codex' 分支：分组/变体来自目录数据。

## Touches

- tasks/codex-composer-model-provider-picker.md
- src/modules/chat-composer/composer/ComposerModelMenu.tsx
- src/modules/chat-session/hooks/useChatProviderState.ts
- src/shared/types.ts
- src/shared/api.ts
- src/shared/tests/wireContractTypeSync.test.ts
- src/modules/chat/tests/composerModelProviderOption.test.tsx（新）

## AC

- [ ] AC-469 判据绿：npx vitest run src/modules/chat/tests/composerModelProviderOption.test.tsx 退出 0。
- [ ] 正臂：内置模型展开裸名+每个 (provider) 变体、自定义模型单条；选中变体 selectProviderModel 携带 model+modelProviderId；收起态按钮显示 gpt-5.6-terra (fjdac)。
- [ ] 负臂：裸名选择不带 modelProviderId；未知/已删 provider 变体不渲染。
- [ ] 假形态：仍按 provider 分组或两个下拉框红；provider === 'codex' 分支红。

## DoD

MCP 浏览器实际操作 + 截图存 tmp/（composer 选 gpt-5.6-terra (fjdac) 并发送）；scripts/ui-scenario.mjs 场景报告 + 检查点截图；pageErrors=[]。vitest 单文件绿 + npm run typecheck + lint。

## ADR-007

- L_D 该轴仍暗,理由:本任务是 composer 选择器 UI，读数是 AC 判据与场景运行器，没有可量化的领域数据轴读数。
- L_G 该轴仍暗,理由:本任务不新增 goal 判据；目标层读数由 GOAL-056 的 AC-469 承担。
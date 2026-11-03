---
id: codex-new-session-model-provider-picker
title: 新建会话 Model Selector 渲染 model×provider 单选择项
status: ready
labels:
  - feature
parent: null
children: []
extra: {}
goal_ac: AC-470
---
<!-- dedup-ref --> 机制去重：新建会话选择器已有 ProviderSelectionEmptyState + ModelGroupList；本条把分组从 provider 改成 model、选项身份扩成 model+modelProviderId，不新开对话框。

## Proposal

**现状**：ProviderSelectionEmptyState 的 Model Selector 用 ModelGroupList 按 provider 分组（PROVIDER_META 四组），handleModelSelect(provider, model) 只传 model（ProviderSelectionEmptyState.tsx:186-195）；ModelGroup 类型 { key, provider, name, models } 与 onSelect(provider, model) 只支持 provider 分支。

**范围**：
1. ModelGroupList 支持按 model 分组的组（key 区分模型与 provider 变体），选项渲染 (provider) 后缀，onSelect 传 (provider, model, modelProviderId)。
2. ProviderSelectionEmptyState 对 codex 按 model 分组（内置模型裸名+变体、自定义单条），其余 provider 保持现状；选中变体写 provider + model + modelProviderId。
3. 收起态卡片显示合成标签（当前 provider · model (provider)）。

## Touches

- tasks/codex-new-session-model-provider-picker.md
- src/modules/chat/transcript/ProviderSelectionEmptyState.tsx
- src/modules/chat-support/components/ModelGroupList.tsx
- src/modules/chat/tests/newSessionModelProviderOption.test.tsx（新）

## AC

- [ ] AC-470 判据绿：npx vitest run src/modules/chat/tests/newSessionModelProviderOption.test.tsx 退出 0。
- [ ] 正臂：codex 按 model 分组渲染内置模型裸名+变体、自定义单条；选中变体写 provider+model+modelProviderId；收起态卡片显示合成标签。
- [ ] 负臂：其余 provider 分组不变；未知 provider 变体不渲染。
- [ ] 假形态：codex 仍按 provider 分组或两个下拉框红。

## DoD

MCP 浏览器实际操作 + 截图存 tmp/（新建会话选 gpt-5.6-terra (fjdac) 并发送）；scripts/ui-scenario.mjs 场景报告 + 检查点截图；pageErrors=[]。vitest 单文件绿 + npm run typecheck + lint。

## ADR-007

- L_D 该轴仍暗,理由:本任务是新建会话选择器 UI，读数是 AC 判据与场景运行器，没有可量化的领域数据轴读数。
- L_G 该轴仍暗,理由:本任务不新增 goal 判据；目标层读数由 GOAL-056 的 AC-470 承担。
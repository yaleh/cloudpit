---
id: AC-470
title: 新建会话 Model Selector 渲染 model×provider 单选择项
status: draft
kind: criterion
goal: GOAL-056
criterion: npx vitest run src/modules/chat/tests/newSessionModelProviderOption.test.tsx
expect: 新建会话 Model Selector 按 model 分组渲染内置模型（裸名 + 每个 (provider)
  变体）与自定义模型（单条）；选中变体写 provider + model + modelProviderId；收起态卡片显示合成标签。
origin: 人 yale 2026-11-03 裁定：单选择项 = model + provider id 组合，后缀用 provider
  id，内置模型展开、自定义模型不展开。
---

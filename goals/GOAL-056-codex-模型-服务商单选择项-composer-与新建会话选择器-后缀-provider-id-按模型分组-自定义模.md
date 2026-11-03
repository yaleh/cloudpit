---
id: GOAL-056
title: Codex 模型×服务商单选择项：composer 与新建会话选择器（后缀=provider id、按模型分组、自定义模型不展开）
status: active
kind: goal
origin: 人 yale 2026-11-03 会话裁定：composer 与新建会话都为 codex 提供 provider+model 单选择项；4
  点确认：单选择项、后缀用 provider id、按 model 分组、自定义模型不展开。
activatedAt: 2026-11-03T12:55:36.305Z
statusLog:
  - at: 2026-11-03T12:55:36.305Z
    from: draft
    to: active
    actor: goal-cli
    reason: ""
---
## 背景

Codex 自定义 provider 已是一等设置（GOAL-055：注册表 + tokenFile + 会话 model_provider_id + resident 注入）。但 composer 与新建会话的模型选择器仍把「模型」与「服务商」当两个维度：内置模型只有裸名（继承 Codex 默认 openai），没有「用哪个 provider 跑同一个内置模型」的入口。本 goal 把模型与服务商合并成一条选择项：gpt-5.6-terra（裸名=继承默认）与 gpt-5.6-terra (fjdac)（显式路由）。

## 范围

- 后端：Codex 模型目录返回 model×provider 选项（modelProviderId 缺省=继承默认）；内置模型按注册 provider 展开，自定义模型单条（绑定其 codexProviderId）。会话模型写路径接受显式 modelProviderId（内置模型路由到非默认 provider），沿用换 provider 拒绝 + 未知 provider 拒绝。
- composer 模型菜单按 model 分组渲染单选择项，选中发送 model + modelProviderId。
- 新建会话 Model Selector 同款选择器。
- 设置页提示 provider 变体语义（built-in · N provider variants）。

## 非目标（本期）

- 项目级默认 provider（本次明确不做）。
- model 与 provider 两个下拉框。
- 自定义模型展开成多 provider 变体（自定义模型绑定单一 provider）。
- 后缀显示名（用 provider id）。

## 退出条件

- AC-468 目录/写路径：getProviderModels('codex') 内置模型展开裸名+每个注册 provider 变体、自定义模型单条带 codexProviderId；setSessionModel 接受显式 modelProviderId 并落库，换 provider 拒绝、未知 provider 拒绝。
- AC-469 composer：按 model 分组渲染单选择项，选中发 model + modelProviderId，收起态显示合成标签。
- AC-470 新建会话：Model Selector 同款选择器。
- AC-471 设置页：provider 变体提示 + built-in · N provider variants。

## 关键约束（已实测，任务 DoD 必须遵守）

- 单选择项 = model + provider id 组合，标签合成仅展示用；value 仍是 model id，modelProviderId 是独立字段。
- 裸名 = 继承 Codex 默认（openai），后缀 = provider id（非显示名）。
- 按 model 分组；内置模型展开，自定义模型不展开。
- 架构红线：后端 provider-id 分支不新增到 server/modules/providers/list/ 之外；前端 provider 差异走数据（目录/PROVIDER_DESCRIPTORS），不写 provider === 'codex'。
- 新 server 测试撞时长基线/未知 pin：优先扩既有测试文件。
- UI DoD：MCP 浏览器实际操作 + 截图 + scripts/ui-scenario.mjs 场景报告。

## 任务映射

- AC-468 ← codex-model-provider-option-composition
- AC-469 ← codex-composer-model-provider-picker
- AC-470 ← codex-new-session-model-provider-picker
- AC-471 ← codex-model-provider-settings-hint
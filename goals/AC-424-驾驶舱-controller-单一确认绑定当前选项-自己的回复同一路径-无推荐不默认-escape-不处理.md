---
id: AC-424
title: 驾驶舱 controller：单一确认绑定当前选项、自己的回复同一路径、无推荐不默认、Escape 不处理
status: achieved
kind: criterion
goal: GOAL-050
criterion: npx vitest run src/modules/cockpit/tests/cockpitCardController.test.ts
expect: React 之外的驾驶舱 controller（create 工厂，依赖经注入）：管理选中卡片、类型与项目过滤、Cards 与 Compact
  密度、Details
  栈；每张卡片只有一个确认，绑定当前显示的选项，切换显示的选项即切换确认目标；自己的回复经同一确认路径；确认先进入确认卡状态，再次确认才向执行通道发出请求且恰好一次，取消则一次也不发；提供方没有给出
  suggested 时卡片默认不显示任何选项、确认不可用；controller 不处理
  Escape。取假形态：确认直接发出而不经确认卡、或同一次确认发出两次即红。当前必红：src/modules/cockpit/tests/cockpitCardController.test.ts
  不存在。
origin: 本会话 2026-10-26 至 10-27 手机与 PC 交互模型（INTERACTION-PRINCIPLES.md 第 9、14 条与
  G、H 节）；frontend-module-standards 要求业务规则与状态机放在 React 之外的 controller。
activatedAt: 2026-10-27T02:51:34.294Z
statusLog:
  - at: 2026-10-27T02:51:34.294Z
    from: draft
    to: active
    actor: claude-session-摄像头与阻塞项驾驶舱
    reason: 用户 2026-10-27 批准激活 GOAL-050（调整正文后）
  - at: 2026-10-27T03:03:46.253Z
    from: active
    to: achieved
    actor: goal-driver
    reason: "I2: criterion pass"
fidelity:
  verdict: faithful
  reason: "fidelity judge: faithful"
  at: 2026-10-27T02:51:34.293Z
---

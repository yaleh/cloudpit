---
id: AC-429
title: PC 右侧驾驶舱列：收起即今天的会话页，按宽度取挤压 / 覆盖 / 不显示，计数按钮，会话链接在左侧打开，焦点归属
status: achieved
kind: criterion
goal: GOAL-050
criterion: npx vitest run src/modules/cockpit/tests/cockpitColumnController.test.ts
expect: React 之外的驾驶舱列 controller：宽度不小于 1280 为挤压式常驻、900 到 1280 之间为覆盖式抽屉、小于 900
  不挂载列；展开状态与列宽按设备记住，重新创建 controller 后恢复；header 按钮的计数等于当前 open 卡片数，为 0
  时按钮淡化、无角标，超过 99 显示
  99+；覆盖式下点卡片里的会话链接会打开左侧会话并自动收起列，挤压式下不收起；当两个输入框都没有焦点时，上下键、数字键、E 与 Enter
  归驾驶舱列，焦点在会话输入框时这些键一个也不被驾驶舱处理；Escape
  从不处理。取假形态：覆盖式点会话链接后列仍展开即红；会话输入框有焦点时数字键被驾驶舱吃掉即红。当前必红：src/modules/cockpit/tests/cockpitColumnController.test.ts
  不存在。
origin: 本会话 2026-10-26 至 10-27 用户确认的 PC 模型（INTERACTION-PRINCIPLES.md H
  节）：驾驶舱为右侧常驻、可收起的列，收起时与现会话页一致；入口是 header
  右侧带计数的按钮；中等宽度用覆盖式抽屉；语音与键盘按焦点归属，都无焦点时给驾驶舱。
activatedAt: 2026-10-27T02:53:59.629Z
statusLog:
  - at: 2026-10-27T02:53:59.629Z
    from: draft
    to: active
    actor: claude-session-摄像头与阻塞项驾驶舱
    reason: 用户 2026-10-27 批准激活 GOAL-050（调整正文后）
  - at: 2026-10-27T03:04:35.081Z
    from: active
    to: achieved
    actor: goal-driver
    reason: "I2: criterion pass"
fidelity:
  verdict: faithful
  reason: "fidelity judge: faithful"
  at: 2026-10-27T02:53:59.629Z
---

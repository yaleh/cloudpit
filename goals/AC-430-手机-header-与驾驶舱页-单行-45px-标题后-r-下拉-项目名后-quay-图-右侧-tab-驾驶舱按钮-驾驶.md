---
id: AC-430
title: 手机 header 与驾驶舱页：单行 45px，标题后 R 下拉、项目名后 Quay 图、右侧 tab · ⋯ · 驾驶舱按钮，驾驶舱页返回保持原位
status: active
kind: criterion
goal: GOAL-050
criterion: npx vitest run
  src/modules/project-workspace/tests/mobileHeaderCockpitEntry.test.tsx
expect: 手机宽度渲染会话页 header：会话标题后是一个 R 下拉按钮，Resident 进程在跑时为绿色样式、不在跑时为灰色，没有圆点，点开仍是
  Resident 详情；项目名后是 Quay in-flight 图；右侧依次为 tab 下拉、⋯、驾驶舱按钮，驾驶舱按钮与 ⋯ 同尺寸，open
  卡片数以角标显示（超过 99 为 99+，为 0
  时按钮淡化无角标），点按进入驾驶舱卡片页；从驾驶舱页点会话链接进入会话再返回，驾驶舱页的选中卡片与滚动位置不变。桌面宽度 header 不出现 R
  下拉替换。当前必红：src/modules/project-workspace/tests/mobileHeaderCockpitEntry.test.tsx
  不存在。
origin: 本会话 2026-10-27 用户确认的手机 header（INTERACTION-PRINCIPLES.md G 节，效果图 140、141
  号）：保持单行 45px，标题变窄可接受、Quay 图 14px 高够用、保留 ▾。
activatedAt: 2026-10-27T02:54:45.449Z
statusLog:
  - at: 2026-10-27T02:54:45.449Z
    from: draft
    to: active
    actor: claude-session-摄像头与阻塞项驾驶舱
    reason: 用户 2026-10-27 批准激活 GOAL-050（调整正文后）
fidelity:
  verdict: faithful
  reason: "fidelity judge: faithful"
  at: 2026-10-27T02:54:45.448Z
---

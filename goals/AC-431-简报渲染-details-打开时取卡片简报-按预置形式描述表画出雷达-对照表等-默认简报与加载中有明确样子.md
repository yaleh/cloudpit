---
id: AC-431
title: 简报渲染：Details 打开时取卡片简报，按预置形式描述表画出雷达、对照表等，默认简报与加载中有明确样子
status: achieved
kind: criterion
goal: GOAL-050
criterion: npx vitest run src/modules/cockpit/tests/CockpitBriefView.test.tsx
expect: 以桩掉的简报读口：Details 打开时请求该卡片的简报恰好一次，关闭再打开同一 revision 不重复请求；generated
  简报按块渲染，radar、compare-table、diffstat、checklist、timeline、graph、callout
  七种预置各有渲染且雷达带 rev 与 evid 两条轴；渲染按描述表查找，未知块类型走默认渲染不报错；fallback
  简报显示原因且不画空图；请求中显示加载状态，失败显示可读错误且卡片其余部分照常可用。另在
  src/shared/tests/cockpitCardTypeSync.test.ts
  或同目录新判据里，简报线上类型两侧一致。当前必红：src/modules/cockpit/tests/CockpitBriefView.test.tsx
  不存在。
origin: 本会话 2026-10-27：简报服务（AC-427）已落地，读口 GET /api/cockpit/cards/:id/brief
  可用，但界面没有任何地方渲染它；E2 盲评用户认为简报「基本都可以接受」。
activatedAt: 2026-10-27T02:55:14.989Z
statusLog:
  - at: 2026-10-27T02:55:14.989Z
    from: draft
    to: active
    actor: claude-session-摄像头与阻塞项驾驶舱
    reason: 用户 2026-10-27 批准激活 GOAL-050（调整正文后）
  - at: 2026-10-27T03:05:05.031Z
    from: active
    to: achieved
    actor: goal-driver
    reason: "I2: criterion pass"
fidelity:
  verdict: faithful
  reason: "fidelity judge: faithful"
  at: 2026-10-27T02:55:14.988Z
---

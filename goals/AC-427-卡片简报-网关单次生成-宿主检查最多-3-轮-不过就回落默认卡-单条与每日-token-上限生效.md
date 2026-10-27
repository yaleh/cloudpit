---
id: AC-427
title: 卡片简报：网关单次生成 + 宿主检查最多 3 轮、不过就回落默认卡，单条与每日 token 上限生效
status: achieved
kind: criterion
goal: GOAL-050
criterion: npx tsx --tsconfig server/tsconfig.json --test
  server/modules/cockpit/tests/cockpit-brief.test.ts
expect: 以桩掉的网关客户端：一张带 cloudcli.session-ask 内容引用的卡片被浮出时生成一份简报，宿主检查通过即缓存（同一 askId
  与 revision 不再调用网关）；检查失败时把错误回给模型重试，第 3
  轮仍失败则返回默认简报并记录失败规则与原始输出；单条累计超过单条上限即停止并回落默认简报；当日累计达到每日上限后新卡片不再调用网关、直接回落默认简报；简报的问题取最后一条助手消息，不取
  digest 的 askingYou 摘录。取假形态：检查失败仍返回模型输出即红；第 4
  次调用网关即红；超过每日上限仍调用网关即红。当前必红：server/modules/cockpit/tests/cockpit-brief.test.ts
  不存在。
origin: 本会话 2026-10-27 简报实验 E2：网关单次 + 宿主检查 8/8 通过，p90 16 s，约 1.3 万 token/条；短
  Claude Code 会话约 11 倍成本且 6/8；用户看过盲评对照认为两者差异不大，确认产品化单次版本，单条 30k、每日 0.5M token
  上限。
activatedAt: 2026-10-27T02:53:12.708Z
statusLog:
  - at: 2026-10-27T02:53:12.708Z
    from: draft
    to: active
    actor: claude-session-摄像头与阻塞项驾驶舱
    reason: 用户 2026-10-27 批准激活 GOAL-050（调整正文后）
  - at: 2026-10-27T03:04:25.653Z
    from: active
    to: achieved
    actor: goal-driver
    reason: "I2: criterion pass"
fidelity:
  verdict: faithful
  reason: "fidelity judge: faithful"
  at: 2026-10-27T02:53:12.707Z
---

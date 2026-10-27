---
id: AC-428
title: 卡片执行器 session.send 与 session.start：确认后真的发进会话、真的开新会话；「自己的回复」按卡片主体给出默认执行器
status: achieved
kind: criterion
goal: GOAL-050
criterion: npx tsx --tsconfig server/tsconfig.json --test
  server/modules/cockpit/tests/cockpit-session-executors.test.ts
expect: 以注入的发送与建会话函数：确认一个绑定 session.send
  的选项后，发送函数恰好被调用一次，目标会话与文本等于选项声明（自己的回复时文本等于用户写的内容）；发送被拒时确认返回明确错误码，不报成功；确认一个绑定
  session.start 的选项后，建会话函数恰好被调用一次，项目与第一条消息等于声明，返回值带新会话 id；卡片未声明 ownReply 时，主体带
  sessionId 的卡片默认用 session.send 写回原会话，只带项目的卡片默认用 session.start
  在该项目开新会话，两者都没有的卡片没有自己的回复且原因可读。取假形态：确认后发送两次即红；发送被拒仍返回 ok
  即红；只带项目的卡片把自己的回复发向任意现有会话即红。当前必红：server/modules/cockpit/tests/cockpit-session-executors.test.ts
  不存在。
origin: 本会话 2026-10-27：K1 只交付了夹具执行器，确认后什么都不会真的发生；K5 实测「自己的回复」只在提供方声明 ownReply
  的卡片上出现，与用户确认的「下拉末项一律是自己的回复」不符。用户同意先立不依赖 fleet 的第二批任务。
activatedAt: 2026-10-27T02:53:40.552Z
statusLog:
  - at: 2026-10-27T02:53:40.552Z
    from: draft
    to: active
    actor: claude-session-摄像头与阻塞项驾驶舱
    reason: 用户 2026-10-27 批准激活 GOAL-050（调整正文后）
  - at: 2026-10-27T03:04:32.230Z
    from: active
    to: achieved
    actor: goal-driver
    reason: "I2: criterion pass"
fidelity:
  verdict: faithful
  reason: "fidelity judge: faithful"
  at: 2026-10-27T02:53:40.552Z
---

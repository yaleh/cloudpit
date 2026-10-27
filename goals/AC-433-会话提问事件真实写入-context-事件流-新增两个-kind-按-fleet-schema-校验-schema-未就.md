---
id: AC-433
title: 会话提问事件真实写入 context 事件流：新增两个 kind，按 fleet schema 校验，schema 未就绪时只记录不报错
status: draft
kind: criterion
goal: GOAL-050
criterion: npx tsx --tsconfig server/tsconfig.json --test
  server/modules/context-events/tests/session-ask-event-writer.test.ts
expect: 以临时目录里的 schema 文件：schema 含 session.asking 与 session.answered（version
  1）时，观察层发出的两种事件经真实 context 事件写入器各落盘恰好一行，source 为 cloudcli，顶层
  session、project、refs 与 data 的 askId、messageId 字段齐全且 askId 形如
  sessionId:assistantMessageId；schema 是不含这两个 kind 的 version 0 时，写入返回
  invalid-kind，不落盘、不抛异常、聊天与摘要照常；schema 文件不存在时返回 schema-unavailable
  且不落盘。同一提问重复触发不重复落盘。取假形态：schema 为 version 0
  时仍落盘即红；写入失败抛到观察层即红。当前必红：server/modules/context-events/tests/session-ask-event-writer.test.ts
  不存在。
origin: 本会话 2026-10-27：observation-session-ask-decision-digest 已交付
  session.asking 与 session.answered 的注入点，生产组合里写入器未绑定；quay-fleet 已立
  fleet-context-schema-session-ask-events，schema 将从 version 0 升到 1 并加入这两个
  kind（producer 为 cloudcli）。
---

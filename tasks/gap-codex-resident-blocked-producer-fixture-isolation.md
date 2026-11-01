---
id: gap-codex-resident-blocked-producer-fixture-isolation
title: 修复 producer fixture/DoD 场景把 session.blocked 合成事件写进真实 fleet home
status: ready
labels: []
parent: null
children: []
extra:
  schema: execution
---
## Proposal

F2 实现期间，producer 的 fixture/DoD 场景把合成会话 `dod-codex-blocked-1793458130445`（project=None）的 `session.blocked`/`session.blocked.resolved` 事件经真实 CloudCLI 上下文写者写进了生产 `~/.quay-fleet/context/events/2026-10-31.jsonl`，被 fleet 升级成 `session-blocked-failed/approval/interrupted` 三条幽灵卡（fleet attention/outbox/decisions 均无载体）。单元测试 `session-blocked-events.test.ts` 已用临时 home（正确），泄漏出在 DoD/验证/试运行路径把 fixture 事件写进了真实 fleet home。

## Plan

producer 的 fixture / DoD / 验证场景一律写隔离的临时 fleet home（与单测同纪律），绝不写真实 `~/.quay-fleet`。

## AC

- [ ] AC1 **fixture 隔离**：fixture 场景（合成会话 `dod-codex-blocked-*` 或等价）的 `session.blocked` 事件绝不落进真实 `~/.quay-fleet/context/events/`（隔离断言；正控：写真实 home 会失败）。
- [ ] AC2 **生产路径不回归**：真实生产路径的 `session.blocked` 事件照常落真实上下文流（回归不破坏）。

## DoD

真实 `~/.quay-fleet/context/events/` 里不再出现 `dod-codex-blocked-*` 合成会话的 `session.blocked`/`session.blocked.resolved` 事件（隔离断言 + 真实 home 读数为证）；AC1 正控（写真实 home 会失败）先红后绿；AC2 生产路径回归绿；`npm run typecheck` 退出 0。

## Touches

- server/modules/context-events/session-blocked-events.ts
- server/modules/context-events/tests/session-blocked-events.test.ts
- tasks/gap-codex-resident-blocked-producer-fixture-isolation.md
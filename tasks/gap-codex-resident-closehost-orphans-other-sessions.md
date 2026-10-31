---
id: gap-codex-resident-closehost-orphans-other-sessions
title: Codex resident 单例 driver 的 closeHost 清空全部 session，关一个 host 即孤儿化其它 resident 会话
status: ready
labels:
  - gap
  - defect
parent: null
children: []
extra:
  schema: execution
---
## Proposal

<!-- dedup-ref --> 机制去重（2026-10-31 实测）：`grep -rliE 'sessions\.clear|No Codex resident session is bound|孤儿' tasks/*.md` 命中 `gap-codex-resident-send-no-response-two-root-causes`（done），但那是 effort 'default' 透传致 turn/start 400，其边界段把 `No Codex resident session is bound` 当作单会话既有契约；本条是**另一机制**：单例 driver `closeHost` 用 `this.sessions.clear()` 清空**所有** session 却只关**一个** host 的 connection，关一个 codex host 即把其它 resident 会话孤儿化。granularity：`--touches codex-host-driver.provider.ts` peers=[]（立案时）；同区另一条 `gap-codex-resident-normalize-app-server-frames` 共享该文件、独立验收，separate。

**现状（生产实测）**：2026-10-31 :3001 三个 resident codex 会话共存（meta-cc `86d87df3`、claudecodeui `0f0cf753`/`4065b219`），各一个 app-server。`01:51:40Z` meta-cc 会话重启（旧 host 关）后，`01:54:45Z`/`01:55:43Z` 对后两者的 follow-up 连续报 `[Chat] Provider runtime "codex" failed — No Codex resident session is bound for "…"`，而这两个 app-server 进程仍存活（orphan）、DB `updated_at` 冻结 `01:51:13Z`。根因：`closeHost()` 里 `this.sessions.clear()` 抹掉单例名下**所有** session，却只 `this.connections.delete(host.hostId)`+`connection?.close()` 关被关的那一个；其余 host 的 manager 侧 binding 与进程仍在 ⇒ 它们的 follow-up 走到 `run()` 时 `liveHostFor` 从 manager snapshot 找到 host、跳过重新 bind，随后 `requireSession` 抛 `CODEX_SESSION_NOT_BOUND`，user message 送不到模型。

**修复方向**：`closeHost(host, reason)` 只移除由该 host 服务的 session（`this.sessions` 里 `hostId===host.hostId` 的条目）与其 connection，不动其它 host 的 session/connection；`this.closed` 不再代表「任意一个 host 被关」，其余 host 的 `connectionFor`/`liveConnectionFor` 保持可用。`unbind` 已是单 session 删除，不改。补多宿主回归测试：两个 session 各绑一个 host，关一个后另一个仍能 `requireSession` 成功并送出下一轮。

## AC

- [ ] AC1 判据入口为绿：`npx tsx --tsconfig server/tsconfig.json --test server/modules/providers/tests/codex-host-driver-multihost.test.ts` 退出 0、`fail 0`、`pass >= 3`。
- [ ] AC2 关一个 host 不动另一个：假 transport 开两个 host 各绑一个 session；`closeHost(hostA)` 后 `readSession(sessionB)` 不抛、`sessionB` 仍在 map；`hostA` 的 connection `close()` 恰 1 次、`hostB` 的 0 次；打印 `sessionBSurvives=true closeCalls=[1,0]`。
- [ ] AC3 幸存 session 能继续发：AC2 之后对 sessionB 再 `run()` 一轮，假 transport 收到新 `turn/start`（threadId 不变）、`requireSession` 不抛 `CODEX_SESSION_NOT_BOUND`；打印 `followupTurnStarted=true`。
- [ ] AC4 假形态承重：临时把 `closeHost` 改回 `this.sessions.clear()` ⇒ AC1 退出 1 且失败行含 sessionB 缺失；逐字记录后还原并复绿。
- [ ] AC5 typecheck 无回归：`npm run typecheck` 退出 0。

## DoD

在真实 app-server（非注入替身）上：起两个 resident codex 会话，重启/关闭其中一个（触发其 host close），对另一个再发一条消息能正常得到 assistant 回答（不再报 `No Codex resident session is bound`），且被关会话进程退出、幸存会话进程仍在。完成记录贴判据逐字 tests/pass/fail、假形态逐字失败行。新增 `*.test.ts` 若使 quay-test-script 的 collected/unknown 钉子或 suite-duration 覆盖率下限变红，须同任务内等量上调并注明。

## Touches

- server/modules/providers/list/codex/codex-host-driver.provider.ts
- server/modules/providers/tests/codex-host-driver-multihost.test.ts
- tasks/gap-codex-resident-closehost-orphans-other-sessions.md
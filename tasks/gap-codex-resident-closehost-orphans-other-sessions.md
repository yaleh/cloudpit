---
id: gap-codex-resident-closehost-orphans-other-sessions
title: Codex resident 单例 driver 的 closeHost 清空全部 session，关一个 host 即孤儿化其它 resident 会话
status: done
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

- [x] AC1 判据入口为绿：`npx tsx --tsconfig server/tsconfig.json --test server/modules/providers/tests/codex-host-driver-multihost.test.ts` 退出 0、`fail 0`、`pass >= 3`。
- [x] AC2 关一个 host 不动另一个：假 transport 开两个 host 各绑一个 session；`closeHost(hostA)` 后 `readSession(sessionB)` 不抛、`sessionB` 仍在 map；`hostA` 的 connection `close()` 恰 1 次、`hostB` 的 0 次；打印 `sessionBSurvives=true closeCalls=[1,0]`。
- [x] AC3 幸存 session 能继续发：AC2 之后对 sessionB 再 `run()` 一轮，假 transport 收到新 `turn/start`（threadId 不变）、`requireSession` 不抛 `CODEX_SESSION_NOT_BOUND`；打印 `followupTurnStarted=true`。
- [x] AC4 假形态承重：临时把 `closeHost` 改回 `this.sessions.clear()` ⇒ AC1 退出 1 且失败行含 sessionB 缺失；逐字记录后还原并复绿。
- [x] AC5 typecheck 无回归：`npm run typecheck` 退出 0。

## DoD

在真实 app-server（非注入替身）上：起两个 resident codex 会话，重启/关闭其中一个（触发其 host close），对另一个再发一条消息能正常得到 assistant 回答（不再报 `No Codex resident session is bound`），且被关会话进程退出、幸存会话进程仍在。完成记录贴判据逐字 tests/pass/fail、假形态逐字失败行。新增 `*.test.ts` 若使 quay-test-script 的 collected/unknown 钉子或 suite-duration 覆盖率下限变红，须同任务内等量上调并注明。

## 完成记录（2026-10-31）

实现（两个提交，均在 task 分支）：`codex resident: closeHost only forgets the closing host's sessions`、`tests: re-measure the server collection pins for the new codex criterion`。

`closeHost` 不再用实例级 `closed` 闩与全量 `sessions.clear()`：新增 `closedHostIds: Set<string>`，只删除 `session.hostId === host.hostId` 的 session 与其 connection；`connectionFor`/`liveConnectionFor`/`liveHostFor`/`experimentalApiAvailable`/`run` 的可用性判定都按 host 计。`unbind` 未改。

**AC1**（逐字）：`npx tsx --tsconfig server/tsconfig.json --test server/modules/providers/tests/codex-host-driver-multihost.test.ts`
```
# tests 3
# pass 3
# fail 0
```
exit 0（`tests 3 / pass 3 / fail 0`）。

**AC2**：用例打印 `sessionBSurvives=true closeCalls=[1,0] readError=`。

**AC3**：用例打印 `followupTurnStarted=true threadId=thread-424243-1 followupThreadId=thread-424243-1 error=`。

**AC4**（假形态承重）：临时把 `closeHost` 的宿主作用域删除改回 `this.sessions.clear()`，同一入口 exit 1、`fail 3`，逐字失败行：
```
AssertionError [ERR_ASSERTION]: sessionB must survive hostA's close: No Codex resident session is bound for "session-b".
```
还原后复跑同入口 `pass 3 / fail 0`。

**AC5**：`npm run typecheck` exit 0（三个 tsc project 全过）。

**DoD 真实 app-server**（默认 `CodexAppServerConnection` 传输，真 `codex app-server` 子进程，无注入替身，`CODEX_HOME` 为临时目录，model `gpt-6.1-sol`）：两个 resident host 各绑一个 session，session B 先跑一轮拿 `FIRST_OK`，`closeHost(hostA)` 后实测 `hostAExited: true`，再对 session B 发一轮：
```
firstAssistantText: "FIRST_OK"
followupAssistantText: "DOD_OK"
followupError: ""
threadIdBefore: "…", threadIdAfter: "…"  // sameThread: true
turnStatusAfter: "completed"
hostAExited: true, aliveB: true, noNotBoundError: true
```
脚本 exit 0。

**钉子上调（同任务内）**：新增 1 个 server 测试文件使 collected 480→481；`server/shared/tests/quay-test-script.test.ts` 两处 unknown/known 钉由 `477`→`478`、`479`→`480` 并补注释；`scripts/suite-duration-baseline.tsv` 追加该文件行（dur=2539ms）以守住 90% 覆盖率下限（433/481 = 90.02%）。改后同文件复跑 `tests 14 / pass 14 / fail 0`。

**行数棘轮**：`codex-host-driver.provider.ts` 835 行，等于 `architecture-ratchet.baseline.json` 的 835 上限（棘轮仅在 `now > was` 时红）。

该轴仍暗,理由:本任务是单例 resident driver 的多 host 隔离缺陷修复，不产出 L_D/L_G 文档/图轴读数。

## Touches

- server/modules/providers/list/codex/codex-host-driver.provider.ts
- server/modules/providers/tests/codex-host-driver-multihost.test.ts
- server/shared/tests/quay-test-script.test.ts
- scripts/suite-duration-baseline.tsv
- tasks/gap-codex-resident-closehost-orphans-other-sessions.md
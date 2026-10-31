---
id: gap-codex-resident-blocked-context-events
title: Codex resident 阻塞态发 session.blocked / session.blocked.resolved context
  事件（approval 门 + turn failed/interrupted）
status: todo
labels:
  - gap
parent: null
children: []
extra:
  schema: execution
---
<!-- dedup-ref --> 机制去重（立案时 grep tasks/*.md）：「codex 阻塞态 → 新 context 事件 kind」全库 0 命中；gap-cockpit-stuck-count-by-kind-and-ask-repair-silent-failure 是 cockpit 侧 stuck 计数 UI、gap-cockpit-asking-event-question-text 是 session.asking 的 questionText，均非本机制。与 gap-codex-resident-session-read-empty（ready，transcript 读空）机制不同、但同触 codex-host-driver.provider.ts，scheduler 按 Touches 串行，故 separate（独立验收，不合并）。

## Proposal

### 契约（与 quay-fleet 会话对齐，yale 裁定 2026-10-31，读口侧 task `fleet-session-blocked-card-source` 已立、契约锁定）

codex 会话的「阻塞/需要人」态不复用 `session.asking`，改发新 context 事件 kind，由 quay-fleet 读口投影成 stuck/fix/need 卡。单 kind + `data.reason` 判别；配对 `session.blocked.resolved` 清卡。读口侧派生层按 reason 落三个新类目：approval→need、failed→fix、interrupted→stuck。读口侧 task id 在对方 repo，非本 store 前置。

### 两个 kind 与 data 形状

- `session.blocked`（envelope 沿用 ContextEvent：`session`=app session id、`project`、`refs=[]`；writer 铸 v/id/at/source）：
```
{ reason: 'approval' | 'failed' | 'interrupted',
  blockId: string,   // <sessionId>:<requestId|turnId>，dedup/resolution key
  requestId?, toolName?, question?,   // approval 臂
  turnId?, errorMessage? }            // turn 臂（errorMessage 仅 failed）
```
- `session.blocked.resolved`：`{ blockId }`（对齐 asking/answered 的跨事件 link）。

### producer 事实源与触发点

- approval 臂：`codex-approval-broker.ts`（五类 server request）会话 park 等人时发 `session.blocked{reason:'approval', requestId, toolName, question?}`；allow 或 deny 都发 `session.blocked.resolved{blockId}`（deny 不发则 denied 卡永远挂着——读口侧明确要求）。
- turn 臂：`codex-host-driver.contract.ts:25` `CodexTurnStatus`；`settleTurn` 落 `failed`/`interrupted` 时发 `session.blocked{reason:'failed'|'interrupted', turnId, errorMessage?}`，`completed` 不发；turn 恢复（下一个 completed）或会话 close 时发 resolved。

### 实现落点

新 kind 挂进 `CLOUDCLI_CONTEXT_EVENT_KINDS` 闭集（`context-event-writer.ts`），新 adapter 走 `session-run-events.ts` 的模式（`context-event-writer.ts` 已贴 800 行棘轮，不往里塞第二个 feature 的词汇），经 `shared/ports/session-blocked-events.port.ts` 由 `server/index.ts` 装到组合根，codex provider 侧经 port 读取、不深引 context-events。

## AC
- [ ] AC1 契约形状：`session.blocked` / `session.blocked.resolved` 两个 kind 进 `CLOUDCLI_CONTEXT_EVENT_KINDS`；`session.blocked` 的 data 形状按上表（reason/blockId/requestId/toolName/question/turnId/errorMessage），读口不加字段。
- [ ] AC2 approval 臂：scripted codex resident 会话 park 在五类 approval 之一 ⇒ 产出一条 `session.blocked{reason:'approval', requestId, toolName}`；allow ⇒ 一条 `session.blocked.resolved{blockId}`，deny ⇒ 也一条 resolved（两个方向都发）。
- [ ] AC3 turn 臂：`settleTurn` 落 failed ⇒ `session.blocked{reason:'failed', turnId, errorMessage?}`；interrupted ⇒ `session.blocked{reason:'interrupted', turnId}`；completed ⇒ 0 条 blocked。
- [ ] AC4 取假形态：删掉 approval 的 resolved 发送（deny 臂）⇒ AC2 的 deny 腿红（resolved 缺失）；删掉 `CLOUDCLI_CONTEXT_EVENT_KINDS` 里的 kind ⇒ writer 拒 `invalid-kind`；还原恢复绿。
- [ ] AC5 兄弟判据与静态面：单文件跑 `server/modules/context-events/tests/session-blocked-events.test.ts`、`codex-resident-approvals.test.ts` 及其余被 Touches 波及的兄弟测试仍绿；`npm run typecheck` 退出 0；`npm run lint` 无 `: error `。

## DoD
真实落地判据（不是「测试存在」）：scripted resident 会话走过「approval park→allow」「approval park→deny」「turn failed」三段，`~/.quay-fleet/context/events/<date>.jsonl` 分别落出对应 `session.blocked` 与配对 `session.blocked.resolved` 行（blockId 一致、reason 正确、completed 不落 blocked）；删掉 deny 臂 resolved ⇒ 该段红。`git diff` 只含 Touches 声明的文件。

## Touches
- `server/modules/context-events/context-event-writer.ts` （两个 kind 进闭集 + data 类型 + verbatim 字段）
- `server/modules/context-events/session-blocked-events.ts` （新 adapter，走 session-run-events.ts 模式）
- `server/shared/ports/session-blocked-events.port.ts` （新 port，provider 经它读取、不深引 context-events）
- `server/modules/providers/list/codex/codex-approval-broker.ts` （approval park→blocked、allow/deny→resolved）
- `server/modules/providers/list/codex/codex-host-driver.provider.ts` （settleTurn failed/interrupted→blocked、恢复→resolved）
- `server/modules/context-events/tests/session-blocked-events.test.ts` （契约形状 + 取假形态）
- `server/modules/providers/tests/codex-resident-approvals.test.ts` （approval 两方向 emission）
- `server/index.ts` （组合根装 adapter 到 port）
- `tasks/gap-codex-resident-blocked-context-events.md` （自触）

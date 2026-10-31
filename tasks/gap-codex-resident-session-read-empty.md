---
id: gap-codex-resident-session-read-empty
title: Codex resident 会话 transcript 读空：session_read 只认 rollout
  jsonl_path，app-server 线程无 transcript 源
status: ready
labels:
  - gap
  - defect
parent: null
children: []
extra:
  schema: execution
---
<!-- dedup-ref --> 机制去重（立案时 grep tasks/*.md）：与 gap-codex-resident-normalize-app-server-frames（done，直播帧被 ChatSessionWriter 整体丢弃）、gap-codex-restart-sync-last-activity（done，重启 last-activity 重同步）、gap-codex-transcript-format-shared-helpers（done，解析去重）机制不同——本任务认领的是「resident 会话行无 jsonl_path ⇒ session_read 读空」，机制词「resident transcript 读空」全库 0 命中。separate。

## Finding

### 缺陷面

`session_read`（mode latest / outline / around）对 codex 会话的读路径最终都收敛到 `getCodexSessionMessages`（`server/modules/providers/list/codex/codex-sessions.provider.ts:1164`），它只读 `sessionsDb.getSessionById(sessionId)?.jsonl_path`；该字段缺失就直接返回 `{ messages: [], total: 0 }`（`codex-sessions.provider.ts:1165-1170`），`session_read` 于是渲染出空串 `content: ""`。`fetchOutline`/`fetchWindowAround`（`sessions.service.ts:854/947`）同样经 `fetchHistory` 走这条 jsonl_path 源。

per-run codex 会话有 rollout JSONL（`~/.codex/sessions/YYYY/MM/DD/rollout-*.jsonl`），`CodexSessionSynchronizer` 只索引这些 rollout 文件并把 `jsonl_path` 写进 session 行——所以 per-run codex 能读。

resident codex 会话走 app-server 的 `thread/*` 协议（`codex-app-server.client.ts` 只实现 `thread/fork` 和 `model/list`，没有任何 transcript 读取），transcript 由 app-server 持有，不在 `~/.codex/sessions` 的 rollout 里。resident 会话行只通过 `session_created`（`codex-host-driver.provider.ts:221-226`）记下 `provider_session_id`（thread id），从不写 `jsonl_path` ⇒ 读路径无源可读。`~/.codex/session_index.jsonl` 以 thread id（`01a…`）为 key，resident 的网关 UUID 在其中 0 命中，也印证了这一点。

quay-fleet 阶段 0 实测（对方会话提供，2026-10-31）：resident codex 会话 `86d87df3-9a4a-4487-908d-768acd32575c` 有 title、有 lastActivity，但 `session_read`（outline 与 latest）都返回 `content: ""`。

### 修法（本任务主方向）

让 resident 会话也有一个 transcript 源。主方向：resident 驱动（`CodexHostDriver.submit`）已把 app-server 帧归一化（`codex-resident-normalize.ts`），同一路径把归一化后的 turn 文本按会话追加写进一个 per-thread transcript 文件，并把该路径写进 session 行的 `jsonl_path`，让现有 `getCodexSessionMessages` 原样可读（session_read / session_search / outline 全通，不新写 reader）。持久化文件的位置必须避开 `CodexSessionSynchronizer` 扫描的 `~/.codex/sessions` 树，否则会被当成新 per-run 会话重复建档。备选（不做默认）：若实测 codex app-server 0.153.4 存在 thread transcript 读取 RPC，可给 reader 加 resident 分支直读 app-server；「unmeasured ⇒ unsupported」，默认走主方向。

### 落地注记

实现落在 `codex-resident-normalize.ts` 的 resident 帧中继（`createCodexResidentFrameRelay` 的 `transcript` 选项）：它是单次 resident turn 归一化后的唯一汇聚点，由 `codex-host-driver.provider.ts` 在 `run()` 里传入 `{ appSessionId, prompt }`（host driver 行数不变，避开 oversize 棘轮）。transcript 写到 `~/.cloudcli/codex-resident-transcripts/<threadId>.jsonl`（在 `~/.codex/sessions` 扫描树之外），内容为 rollout 同款 JSONL（`session_meta` / `task_started` / `user_message` / assistant `response_item` / `task_complete`），并经 `sessionBindingService.replaceBinding` 原子回写 `provider_session_id` + `jsonl_path`；行不属于该 thread 的陈旧 host 拒绝写入。`codex-sessions.provider.ts` 无需改 reader（jsonl_path 一写，原 reader 即通），故其仅有 Touches 声明而无改动。

### 顺带纠偏（同批改动）

`codex.provider.ts:47-51` 的注释仍写「Codex declares no `resident` lifecycle mode yet — that declaration is a later task」，但 `provider-capabilities.service.ts:224-245`（AC-441）早已声明 `lifecycleModes: ['per-run','resident']`、`defaultLifecycleMode: 'resident'`。同批把该注释改正为与能力声明一致。

## AC
- [x] AC1 红态基线（改动前先写判据）：在 codex-sessions 判据里构造一条 resident 形状的 codex session 行（`provider_session_id` 有值、`jsonl_path` 缺失），驱动 `CodexSessionsProvider.fetchHistory` ⇒ 现状返回 `messages: []` 且 `total: 0`（红；本任务要把它翻绿）。判据：`codex-sessions.test.ts` 的 "a resident-shaped Codex session with no persisted turn reads empty (red baseline)"。
- [x] AC2 主路径生效：同一 resident 形状会话经 resident turn 持久化后，session 行 `jsonl_path` 指向含该 turn 文本的文件，`fetchHistory` 返回该 turn 的 assistant 文本（非空）；`session_read({mode:'latest'})` 对其渲染非空 `content`。判据：同一文件 "a resident turn is persisted outside the scanned sessions tree and reads back"，含 `registerMcpReadTools` 注册后的真实 `session_read` latest 渲染。
- [x] AC3 反向对照：per-run codex（`jsonl_path` 指向真实 rollout）读法不变，仍返回原内容（零回归）。判据：同一文件 "a per-run Codex rollout still reads its own transcript unchanged"。
- [x] AC4 取假形态：删掉「resident turn 写 transcript / 写 jsonl_path」这一步 ⇒ AC2 的腿红（又读空）；还原恢复绿。判据：AC2 用例内删除已落盘 transcript 后 `fetchHistory` 复归空、写回后恢复非空。
- [x] AC5 兄弟判据与静态面：单文件跑 `server/modules/providers/tests/codex-sessions.test.ts` 及其余被 Touches 波及的兄弟测试仍绿；`npm run typecheck` 退出 0；`npm run lint` 无 `: error `。实测：codex-sessions 15/15、normalize+persistent+queue 23/23、settings/steer/multihost/approvals/background-leases 44/44，typecheck 0，lint 仅 warning 0 error。
- [x] AC6 注释纠偏：`grep -rn "declares no .*resident" server/modules/providers/list/codex/codex.provider.ts` 0 命中，注释改为与 `provider-capabilities.service.ts` 的 `lifecycleModes` 声明一致。

## DoD
真实落地判据（不是「测试存在」）：在交付树上驱动判据——resident 形状会话（无 jsonl_path）在 turn 持久化后 `fetchHistory` 返回非空 assistant 文本、`session_read` 渲染非空，删掉持久化步骤后该腿红，per-run 读法零回归；`codex.provider.ts` 过时注释 0 命中。`git diff` 只含 Touches 声明的文件（源文件、判据文件、本任务 task 文件）。

## Touches
- `server/modules/providers/list/codex/codex-sessions.provider.ts` （getCodexSessionMessages 读 resident transcript 源）
- `server/modules/providers/list/codex/codex-host-driver.provider.ts` （resident turn 持久化为 transcript 并写 jsonl_path）
- `server/modules/providers/list/codex/codex-session-synchronizer.provider.ts` （持久化位置避开 ~/.codex/sessions 扫描 / 必要时协调建档）
- `server/modules/providers/list/codex/codex-resident-normalize.ts` （resident 帧中继把归一化后的 turn 追加进 transcript 文件并经 binding service 回链 session 行）
- `server/modules/providers/list/codex/codex.provider.ts` （顺带纠偏过时 resident 声明注释）
- `server/modules/providers/tests/codex-sessions.test.ts` （红态基线 + 主路径 + 反向对照 + 取假形态）
- `tasks/gap-codex-resident-session-read-empty.md` （自触）

## ADR-007 dark axis
该轴仍暗,理由:本任务只修 Codex resident 会话的 transcript 读取链路与注释纠偏，未产生可度量的 L_D/L_G 架构轴读数。

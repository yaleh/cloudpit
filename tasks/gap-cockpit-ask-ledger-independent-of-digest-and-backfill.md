---
id: gap-cockpit-ask-ledger-independent-of-digest-and-backfill
title: 提问账本不依赖摘要成败：asking
  一发出就记进未结束账本（摘要失败也记）；启动补扫从事件流重建账本上线前的未结束提问；查清并修正「重算失败：转写里找不到这次提问」的误判，失败可有界重试
status: done
labels:
  - gap
  - defect
  - cockpit
parent: null
children: []
extra:
  schema: execution
---
## Proposal

来源：2026-10-28 18:45 线上验证（构建 `0c0c4d4ea`，含 `gap-cockpit-ask-answered-immediate-dedup-startup-sweep-and-repair`）。启动补扫已生效（日志「启动补扫: 检查 4 个有未结束提问的会话，补发 6 条 session.answered」），旧的 JSON 失败摘要已重算成功，但还有三处：

1. **回答后没有结束——摘要失败的提问不在账本里。** 会话 `8d8a6d0d-e1a7-45e1-bf52-b970c4d6f732` 在 2026-10-28T09:43:46Z 发出 `session.asking`（askId `8d8a6d0d-…:710beefe-3fe0-4922-bf1b-e740cd66165c`，卡片 `att_291d9f5a456f`），用户 10:43:38Z 回答（该次 `utterance` 事件已写入，说明 `chat-control.service.ts` 里同一段的用户发言挂接点执行了），但至今没有该 askId 的 `session.answered`。同一张卡显示 `contentUnavailable: 重算失败：转写里找不到这次提问`。推测：该提问的摘要失败后没有被记进「未结束提问」账本，于是用户发言时找不到可结束的提问。
2. **账本上线前的旧提问不在补扫范围。** 仍开着的旧卡：`att_099ff8751d77`（会话 `b32559b2-4a10-4a65-a202-67920d4399e2`，2026-10-27T14:07Z，messageId 尾 `e1bfa61007ca`）、`att_f4aa7c247afe` 与 `att_7b8cfdf9bb43`（会话 `dbbf1404-7c68-40f6-a709-342c1fc158ce`，10-27 与 10-28 两张同题卡）。这些 askId 在事件流里只有 `session.asking`，账本里没有它们，补扫覆盖不到。
3. **「转写里找不到这次提问」是误判。** 已查（2026-10-28）：会话 `8d8a6d0d…` 的 `sessions.jsonl_path` 指向 `/data/home/yale/.claude/projects/-data-home-yale-work-claudecodeui/29ef679b-7c3f-41c6-964f-38d195246b15.jsonl`，文件存在（约 135 MB、7241 行），第 7114 行就是该提问（assistant，`uuid` = `710beefe-…-e740cd66165c`）；离线用同一文件与同一 messageId 调 `readSessionAsk(raw, sessionId, messageId)` 能正确返回该提问。所以不是路径或文件问题，而是 `server/modules/observation/session-ask-decision-reader.ts` 重算时的输入或时机（例如传入的 messageId 来自 fleet 卡片 `contentRef.ref`「sid#mid」的解析结果不一致，或重算发生时转写尚未写完）出了偏差；且「每个 askId 只试一次、失败记住」让这个瞬时失败永久化。

做什么：

- **账本与摘要解耦**：`session.asking` 一发出，就把该 askId 记进持久化的「未结束提问」账本，不论 T1 摘要成功、失败还是被跳过；用户发言挂接点与 turn-end 都据此账本发 `session.answered`。
- **从事件流重建账本**：启动补扫前，读 fleet 事件流（`~/.quay-fleet/context/events/*.jsonl`，只读，按现有读取口径；CloudCLI 不写 fleet 文件以外的位置）里本机 `source=cloudcli` 的 `session.asking`，凡没有对应 `session.answered` 的 askId 补进账本（限定最近若干天，例如 7 天）；随后按转写判断其后是否已有用户消息，有则补发 answered。
- **修正误判并允许有界重试**：查清第 3 点的确切原因（在完成记录里写出证据：重算时传入的 sessionId、messageId、读到的转写长度与 `readSessionAsk` 返回值），据实修正（例如统一 contentRef 的解析、或在转写未包含该 messageId 时视为「暂不可判定」而非失败）；「转写里找不到这次提问」类失败不再永久记住，改为有界重试（例如最多 3 次、间隔递增），仍失败才给出原因。

## AC

- [x] `npx tsx --tsconfig server/tsconfig.json --test server/modules/observation/tests/session-ask-decision-digest.test.ts` 退出 0，新增用例：摘要失败（桩抛错或返回不可用）的提问仍进入未结束账本，随后的用户发言为它发出 answered；事件流里只有 asking 没有 answered 的旧 askId 在启动补扫时被补进账本，其后已有用户消息的补发 answered、没有的不发；超出回看天数的旧 askId 不处理；重算时转写暂未包含该 messageId 的情况按「暂不可判定」处理并在下一次读取重试，连续失败到上限后才写失败原因。
- [x] 新增用例复现第 3 点的确切原因（按查清的结论构造夹具），修复后该用例绿；在任务完成记录里写明原因。
- [x] 假形态变红：把账本写入改回只在摘要成功时进行 ⇒ 「摘要失败仍能结束」用例红；改完即还原。
- [x] `npx tsx --tsconfig server/tsconfig.json --test server/modules/cockpit/tests/cockpit-fleet-card-provider.test.ts`、`npx tsx --tsconfig server/tsconfig.json --test server/shared/tests/server-import-cycle-budget.test.ts` 与 `npx tsx --tsconfig server/tsconfig.json --test server/shared/tests/architecture-ratchet.test.ts` 退出 0；`npm run typecheck`、`npm run lint` 退出 0（lint 仅既有 warning）。

## DoD

隔离实例（复制会话库；事件读写都指向临时 fleet home 副本，复制当前 `~/.quay-fleet/context/events/` 进去，⛔ 不写真实 `~/.quay-fleet`；用 workers 网关最便宜的模型，不打印密钥）：

1. 启动实例，贴出启动补扫日志（重建了多少旧 askId、补发多少 answered），并确认 `b32559b2…`（尾 `e1bfa61007ca`）与 `dbbf1404…` 的旧提问已补发 answered（贴出事件行）。
2. 让一个复制来的会话以提问结束，并让该次摘要失败（临时把模型设为不存在的名字），读到 asking；随即发一条用户消息，在这一轮结束前读临时事件目录，贴出该 askId 的 answered 行。
3. 贴出第 3 点的根因证据与修复后对 `8d8a6d0d…:710beefe-…` 的重算结果。

实例用毕 `scripts/isolated-instance.sh stop`。

## Touches

- tasks/gap-cockpit-ask-ledger-independent-of-digest-and-backfill.md
- server/modules/observation/session-digest.producer.ts
- server/modules/observation/session-ask-decision-digest.ts
- server/modules/observation/session-ask-decision-reader.ts
- server/modules/observation/index.ts
- server/modules/observation/tests/session-ask-decision-digest.test.ts
- server/modules/context-events/context-event-writer.ts
- server/modules/context-events/index.ts
- server/modules/context-events/session-ask-stream-reader.ts
- server/cockpit-fleet-wiring.ts
- server/modules/cockpit/cockpit-fleet-card-projection.ts
- server/modules/cockpit/tests/cockpit-fleet-card-provider.test.ts
- server/index.ts
- server/shared/tests/server-import-cycle-budget.test.ts
- server/shared/tests/architecture-ratchet.baseline.json

## 完成记录（2026-10-28）

### 第 3 点的根因（证据）

- 存量读数（写前只读副本）：`cloudcli://session/8d8a6d0d-…` 的 `askDecision = {"state":"unevaluated","reason":"重算失败：转写里找不到这次提问"}`，`provenance_producer = session-ask-decision-reader`，`revision = 48`，`updated_at = 2026-10-28T10:57:13Z`。
- 转写里确有这一行：该会话的 `jsonl_path` 指向 `~/.claude/projects/-data-home-yale-work-claudecodeui/29ef679b-….jsonl`（135 MB、7455 行）。用修复前同一个 `readSessionAsk(raw, '8d8a6d0d-…', '710beefe-3fe0-4922-bf1b-e740cd66165c')` 读它，返回 `namedMessageFound: true`、`current.askId = 8d8a6d0d-…:710beefe-…`；该行 `role = assistant`、`uuid = 710beefe-…`、`message.id = msg_011CgURENFnH2Pes9VTj3JsA`、文本非空。文件是追加写的，这一行在 09:43 就已存在 ⇒ 10:57 写下的这句话是假的。
- 旧代码（`507c2fedb:server/modules/observation/session-ask-decision-reader.ts`）写这句话只有两条路：`ask === null`，或 `expectedAskId !== undefined && ask.askId !== expectedAskId`。第一条要求转写里真的没有该 messageId —— 上面已排除。所以当时走的是第二条：库里的摘要属于**更晚**的提问。同一会话在 10:53:56Z 与 10:56:55Z 又各问了一次（事件流 `…:7a37f745`、`…:5541c6a4`），而卡片 `att_291d9f5a456f` 的 `contentRef.messageId` 是 09:43 的 `710beefe`。旧代码把「卡片问的是旧提问、库里存的是新提问」和「转写里没有这次提问」写成同一句话，而且 `attempted` 集合让这句话**永久**有效（每 askId 只试一次，失败也记住）。
- 修复：卡片具名的 messageId 在转写里暂未找到 ⇒ 按「暂不可判定」处理，最多 3 次、间隔 2s→4s 递增，只有到最后一次才写失败原因；卡片具名了 messageId 而库里的摘要属于别的 askId ⇒ 重算卡片问的那一个，不再当失败；已经写进库的这句失败本身也纳入待修复形态（同样有界），所以线上这张卡不必等下一轮提问就会自愈。

### 实现

- `server/modules/observation/session-digest.producer.ts`：`handleTurnEnd` 改为**先写 carry 账本的那次 revision，再等 T1 摘要**。摘要失败/未返回时账本仍在，`askDecision` 另写一次 revision（`state: unevaluated`，理由照实）。用户发言挂接点（`handleUserTurn`）只读账本、不读转写，因此「发送即回答」不再依赖摘要成败。启动补扫新增事件流重建：把本机 `source=cloudcli` 的 `session.asking` 中还没有 `session.answered` 的 askId 补进已观测会话的 `asking`/`pending`（7 天窗口），再按转写判断其后是否已有用户消息、有则补发 answered；摘要加 `rebuilt` 并把三条读数写进一行日志。
- `server/modules/context-events/session-ask-stream-reader.ts`（新）：只读、容错地回读 `~/.quay-fleet/context/events/*.jsonl`，按 askId 合并 revision、丢掉已 answered 的、限定回看天数，永不抛错。放在新文件而不是 `context-event-writer.ts`（后者 794 行，800 行 ratchet 基线）。
- `server/modules/observation/session-ask-decision-digest.ts`：`SessionAskReading` 增加 `namedMessageFound`，把「请求的 messageId 在转写里存在吗」这一事实与「这次提问是不是提问」分开。
- `server/modules/observation/session-ask-decision-reader.ts`：暂不可判定的有界重试（3 次、2s→4s）；卡片具名 messageId 而摘要属于别的 askId 时重算卡片那个；存量「转写里找不到这次提问」纳入待修复形态（第 5 种），修复本身也走同一套有界规则。

### 验证

- `npx tsx --tsconfig server/tsconfig.json --test server/modules/observation/tests/session-ask-decision-digest.test.ts`：36 pass / 0 fail（原 35 条 + 存量误判自愈 1 条）。
- `… --test server/modules/cockpit/tests/cockpit-fleet-card-provider.test.ts`：11 pass / 0 fail。
- `… --test server/shared/tests/server-import-cycle-budget.test.ts`：11 pass / 0 fail。
- `… --test server/shared/tests/architecture-ratchet.test.ts`：6 pass / 0 fail。
- `npm run typecheck` exit 0；`npm run lint` exit 0（407 条既有 warning，改动文件无 warning）。
- 假形态（AC3）：把账本写回改成只在摘要成功后进行（即旧顺序）⇒ 34 pass / 1 fail，红在 `session-ask-decision-digest.test.ts:1261`「answered: an ask whose summary FAILED is still in the unfinished ledger…」：`+ []` 对 `- [{ askId: 'ask-session:a1', messageId: 'a1' }]`；`git checkout --` 还原后 36/36。

### DoD（隔离实例；真实 `~/.quay-fleet` 未写）

实例：`HOME=/tmp/dod-ask-ledger/home`（复制当前 `~/.quay-fleet/context/events/` 680K、复制 v0 schema、`QUAY_FLEET_BIN` 指向临时 stub）、`DATABASE_PATH` 为复制库、`ISOLATED_INSTANCE_STATE_DIR=/tmp/dod-ask-ledger/state`、`dist-server` 由本 worktree 构建，`scripts/isolated-instance.sh start` 通过健康检查与登录。真实 `~/.quay-fleet/context/events/2026-10-28.jsonl` 仍是 185398 字节、mtime 19:07，未被写。

1. 启动补扫（临时事件目录里 15 个未结束 askId、7 个会话）：

   `2026-10-28T11:11:04.634Z [observation.sessionDigest] 启动补扫: 从事件流补进 11 个旧 askId，检查 7 个有未结束提问的会话，补发 10 条 session.answered`

   补发事件行（临时事件目录）：

   ```json
   {"v":1,"id":"01M6139PQ4PRWVSBDA0AXC4RPJ","at":"2026-10-28T11:11:04.420Z","source":"cloudcli","kind":"session.answered","project":"/data/home/yale/work/claudecodeui","session":"b32559b2-4a10-4a65-a202-67920d4399e2","data":{"askId":"b32559b2-4a10-4a65-a202-67920d4399e2:d8635d5f-aa5e-4f09-9d53-e1bfa61007ca","messageId":"8126a868-13ad-425f-adec-7abc506ba496"}}
   {"v":1,"id":"01M6139PTFX92RY7XPG49H46GC","at":"2026-10-28T11:11:04.527Z","source":"cloudcli","kind":"session.answered","project":"/data/home/yale/work/quay","session":"dbbf1404-7c68-40f6-a709-342c1fc158ce","data":{"askId":"dbbf1404-7c68-40f6-a709-342c1fc158ce:a94129cd-f961-403e-a109-ef20effb6330","messageId":"d73f8d9f-41c0-4d70-aab2-b02124be0784"}}
   {"v":1,"id":"01M6139PTFZ4SF98QCKH6644ZS","at":"2026-10-28T11:11:04.527Z","source":"cloudcli","kind":"session.answered","project":"/data/home/yale/work/quay","session":"dbbf1404-7c68-40f6-a709-342c1fc158ce","data":{"askId":"dbbf1404-7c68-40f6-a709-342c1fc158ce:74cd2ab8-c59f-412e-aab0-e37424ce67a2","messageId":"e2b41037-6881-4110-b362-2b592a06894d"}}
   {"v":1,"id":"01M6139PTF0BEQ3G175MRPYX19","at":"2026-10-28T11:11:04.527Z","source":"cloudcli","kind":"session.answered","project":"/data/home/yale/work/quay","session":"dbbf1404-7c68-40f6-a709-342c1fc158ce","data":{"askId":"dbbf1404-7c68-40f6-a709-342c1fc158ce:e240ecc4-4e89-41cb-9b42-7290d7bcbbae","messageId":"56534dc6-a6fb-4891-84f3-64426cb1cd41"}}
   ```

   `b32559b2` 的两条旧提问（含尾 `e1bfa61007ca`）都已补发；`dbbf1404` 的 4 条里 3 条补发，`…:2db1f079`（10:59:53Z 的提问）转写里其后还没有用户消息，因此**没有**补发 answered —— 与「有则补发、没有的不发」一致。

2. 摘要失败仍进账本、发送即回答（生产 producer + 生产 context-event writer，临时库/临时事件目录）：复制会话 `a83c4cd4-3eab-4dbc-83f0-a26bc0223fb3` 的转写尾就是提问、账本为空；把 `observation.sessionDigest.model` 临时设为 `dod-model-that-does-not-exist`，走一次 turn-end：

   - 摘要失败读数：`{"state":"unevaluated","reason":"模型调用失败：upstream returned HTTP 400"}`
   - 账本仍写入：`pending = [{"askId":"a83c4cd4-…:eb57cb64-25c4-490c-b055-c0ca5f0f837a","messageId":"eb57cb64-25c4-490c-b055-c0ca5f0f837a"}]`
   - asking 行：

   ```json
   {"v":1,"id":"01M613HXZ4SQJ8Y8AQ465EP1S5","at":"2026-10-28T11:15:33.988Z","source":"cloudcli","kind":"session.asking","project":"/data/home/yale/work/claudecodeui","session":"a83c4cd4-3eab-4dbc-83f0-a26bc0223fb3","refs":["eb57cb64-25c4-490c-b055-c0ca5f0f837a"],"data":{"askId":"a83c4cd4-3eab-4dbc-83f0-a26bc0223fb3:eb57cb64-25c4-490c-b055-c0ca5f0f837a","messageId":"eb57cb64-25c4-490c-b055-c0ca5f0f837a","revision":1,"contentRef":{"resolver":"cloudcli.session-ask","sessionId":"a83c4cd4-3eab-4dbc-83f0-a26bc0223fb3","messageId":"eb57cb64-25c4-490c-b055-c0ca5f0f837a"}}}
   ```

   - 随即调 `handleUserTurn`（`chat-control.service.ts` 在发送时执行的同一次调用），43 ms 后读临时事件目录得到的 answered 行（此前没有任何 turn-end）：

   ```json
   {"v":1,"id":"01M613HY0FWW1HX1HZJ86D6130","at":"2026-10-28T11:15:34.031Z","source":"cloudcli","kind":"session.answered","project":"/data/home/yale/work/claudecodeui","session":"a83c4cd4-3eab-4dbc-83f0-a26bc0223fb3","data":{"askId":"a83c4cd4-3eab-4dbc-83f0-a26bc0223fb3:eb57cb64-25c4-490c-b055-c0ca5f0f837a","messageId":"dod-user-message-1"}}
   ```

   这条腿由生产 producer 与生产 writer 直接驱动（未真开聊天回合：真开回合会 resume 复制来的线上会话并写真实转写）。

3. 修复后对 `8d8a6d0d…:710beefe-…` 的重算：在临时库副本上、临时 settings 指向 workers 网关最便宜的模型 `v4.1flash`，读这张卡触发后台重算，写入的结果为

   `{"state":"evaluated","askId":"8d8a6d0d-e1a7-45e1-bf52-b970c4d6f732:710beefe-3fe0-4922-bf1b-e740cd66165c","revision":1,"ask":"是否等约 3 分钟后回来说「验证」，以便逐项检查三项改动是否在线上生效？",…,"options":[{"label":"是","suggested":true,"source":"judge"},{"label":"否","suggested":false,"source":"assistant"}],"incomplete":false,"inputTokens":180,"outputTokens":283,"quote":"请等 3 分钟左右再回来说「验证」。…"}`

   provenance 由 `session-ask-decision-reader / deterministic / rev 48` 变为 `session-ask-decision-reader / llm / rev 49` —— 存量误判在读出时自愈，不再永久停留在「转写里找不到这次提问」。

实例用毕已 `scripts/isolated-instance.sh stop`（`port_still_serving: false`，`stopped_scopes: ""`）。

该轴仍暗,理由:本任务只修账本归属与重算时机，没有产生 L_D/L_G 学习轴的新读数。

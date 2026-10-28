---
id: gap-cockpit-ask-ledger-independent-of-digest-and-backfill
title: 提问账本不依赖摘要成败：asking
  一发出就记进未结束账本（摘要失败也记）；启动补扫从事件流重建账本上线前的未结束提问；查清并修正「重算失败：转写里找不到这次提问」的误判，失败可有界重试
status: todo
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

- [ ] `npx tsx --tsconfig server/tsconfig.json --test server/modules/observation/tests/session-ask-decision-digest.test.ts` 退出 0，新增用例：摘要失败（桩抛错或返回不可用）的提问仍进入未结束账本，随后的用户发言为它发出 answered；事件流里只有 asking 没有 answered 的旧 askId 在启动补扫时被补进账本，其后已有用户消息的补发 answered、没有的不发；超出回看天数的旧 askId 不处理；重算时转写暂未包含该 messageId 的情况按「暂不可判定」处理并在下一次读取重试，连续失败到上限后才写失败原因。
- [ ] 新增用例复现第 3 点的确切原因（按查清的结论构造夹具），修复后该用例绿；在任务完成记录里写明原因。
- [ ] 假形态变红：把账本写入改回只在摘要成功时进行 ⇒ 「摘要失败仍能结束」用例红；改完即还原。
- [ ] `npx tsx --tsconfig server/tsconfig.json --test server/modules/cockpit/tests/cockpit-fleet-card-provider.test.ts`、`npx tsx --tsconfig server/tsconfig.json --test server/shared/tests/server-import-cycle-budget.test.ts` 与 `npx tsx --tsconfig server/tsconfig.json --test server/shared/tests/architecture-ratchet.test.ts` 退出 0；`npm run typecheck`、`npm run lint` 退出 0（lint 仅既有 warning）。

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
- server/cockpit-fleet-wiring.ts
- server/modules/cockpit/cockpit-fleet-card-projection.ts
- server/modules/cockpit/tests/cockpit-fleet-card-provider.test.ts
- server/index.ts
- server/shared/tests/server-import-cycle-budget.test.ts
- server/shared/tests/architecture-ratchet.baseline.json

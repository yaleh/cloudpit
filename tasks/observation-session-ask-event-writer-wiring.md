---
id: observation-session-ask-event-writer-wiring
title: 会话提问事件接上真实 context 事件写入器：CLOUDCLI_CONTEXT_EVENT_KINDS 加 session.asking /
  session.answered，按 fleet schema 校验，schema 未升到 v1 前只记录不报错
status: todo
labels:
  - feature
  - cockpit
parent: null
children: []
extra:
  schema: execution
goal_ac: AC-433
---
## Proposal

来源：本会话 2026-10-27。`observation-session-ask-decision-digest` 交付了 `session.asking` / `session.answered` 的注入点（`ISessionAskEventWriter`，`server/shared/interfaces.ts`），但生产组合里没有绑定：`server/modules/observation/session-digest-llm.ts` 构造进程级 `sessionDigestProducer` 时注释写明「事件写入器在 quay-fleet schema 加入这两个 kind 前不绑定」。quay-fleet 已立 `fleet-context-schema-session-ask-events`：`config/context-event.schema.v0.json` 的 version 0→1，加入两个 kind（producer 为 cloudcli），握手 `contracts.contextEvents` 会报 v1。

对齐的载荷（与 fleet 一致）：
- `session.asking`：顶层 `session`、`project`、`refs`（助手消息 id）；data 必填 `askId`（`<sessionId>:<assistantMessageId>`）与 `messageId`，可选 `contentRef { resolver: "cloudcli.session-ask", sessionId, messageId }`、`revision`。
- `session.answered`：顶层 `session`、`at`；data 必填 `askId`，可选用户消息 `messageId`。

现有写入器（`server/modules/context-events/context-event-writer.ts`）从 fleet 安装读 schema 校验：schema 缺失返回 `schema-unavailable`，kind 不在 schema 里返回 `invalid-kind`，都不抛异常。所以现在就可以接线：fleet 升到 v1 之前写入只会被拒并计数，升级后自动开始落盘，CloudCLI 不需要再改代码。

做什么：

- `server/modules/context-events/context-event-writer.ts` 的 `CLOUDCLI_CONTEXT_EVENT_KINDS` 加入 `session.asking` 与 `session.answered`；草稿类型补上这两种 data 形状。
- 写入器适配：一个实现 `ISessionAskEventWriter` 的适配器，把观察层事件转成上面的草稿交给现有 `contextEvents`；写入结果非 ok 时只计数与在调试日志里记一次原因，不抛到观察层。
- 绑定：观察层的进程级 producer 在 `modules/observation` 内构造，不能直接导入 `modules/context-events`（AC-394）。按现有端口做法（例如 `server/shared/ports/cockpit-enabled.port.ts` 的安装式端口）新增一个会话提问事件写入端口，组合根 `server/index.ts` 安装真实写入器，`session-digest-llm.ts` 经端口读取；未安装时等同不写。新端口文件若是新叶子目录下的文件，需同时登记 AC-394 清单与钉子。
- 不改 schema，不写 quay-fleet 的任何文件。

## AC

- [ ] `npx tsx --tsconfig server/tsconfig.json --test server/modules/context-events/tests/session-ask-event-writer.test.ts` 退出 0（AC-433 判据）：在临时目录写三份 schema（v1 含两个 kind；v0 不含；缺失），分别驱动「提问然后回答」；v1 时两种事件各落盘恰好一行且字段齐全、askId 格式正确；v0 时返回 invalid-kind、不落盘、不抛；缺失时 schema-unavailable、不落盘；同一提问重复触发不重复落盘。
- [ ] 假形态各自变红：v0 schema 下仍落盘 ⇒ 用例红；写入失败抛到观察层 ⇒ 用例红。每个假形态改完即还原。
- [ ] 现有判据不退：`npx tsx --tsconfig server/tsconfig.json --test server/modules/context-events/tests/context-event-writer.test.ts`、`npx tsx --tsconfig server/tsconfig.json --test server/modules/context-events/tests/production-wiring.test.ts`、`npx tsx --tsconfig server/tsconfig.json --test server/modules/observation/tests/session-ask-decision-digest.test.ts` 均退出 0。
- [ ] `npx tsx --tsconfig server/tsconfig.json --test server/shared/tests/server-import-cycle-budget.test.ts` 与 `npx tsx --tsconfig server/tsconfig.json --test server/shared/tests/architecture-ratchet.test.ts` 均退出 0。
- [ ] `npm run typecheck` 与 `npm run lint` 退出 0（lint 仅既有 warning）。

## DoD

在隔离实例里，把实例的 quay-fleet home 指向一个临时目录，放一份 v0 schema（复制当前 fleet 安装里的那份）：在一个复制来的会话上让助手以提问结束、再回答一次，读写入器状态，贴出两次 `invalid-kind` 计数且事件目录没有新行。再把临时目录里的 schema 换成加了这两个 kind 的 v1 副本（只在临时目录里改，不动真实 fleet 安装），重复一次，贴出事件目录新增的两行原文。真实 fleet 安装升到 v1 之后的线上落盘在 quay-fleet 的 `fleet-context-schema-session-ask-events` 落地后复核（待外部）

实例用毕 `scripts/isolated-instance.sh stop`。

## Touches

- tasks/observation-session-ask-event-writer-wiring.md
- server/modules/context-events/context-event-writer.ts
- server/modules/context-events/index.ts
- server/modules/context-events/tests/session-ask-event-writer.test.ts (new)
- server/modules/observation/session-digest-llm.ts
- server/shared/ports/session-ask-events.port.ts (new)
- server/index.ts
- server/shared/interfaces.ts
- server/shared/tests/architecture-ratchet.baseline.json
- server/shared/tests/server-import-cycle-budget.test.ts
- server/shared/tests/quay-test-script.test.ts
- scripts/suite-duration-baseline.tsv

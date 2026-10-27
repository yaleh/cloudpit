---
id: gap-context-event-writer-stamps-schema-version
title: context 事件写入器按 fleet schema 的 version 打 row.v：去掉硬编码的
  CONTEXT_EVENT_VERSION = 0，schema 升到 v1 后写出的行仍是 v0，违反 fleet「写入方必须 v ===
  version」
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

来源：2026-10-27 核对线上事件流。quay-fleet 已发布 release `25d1866`，其 `config/context-event.schema.v0.json` 的 `version` 为 1（新增 `session.asking` / `session.answered`）。CloudCLI 重启后真实写出的行（`~/.quay-fleet/context/events/2026-10-27.jsonl`）是 `"v":0`，因为 `server/modules/context-events/context-event-writer.ts` 硬编码 `export const CONTEXT_EVENT_VERSION = 0`（注释写「The fleet schema pins this value」，在 schema 升版后已不成立），写行处 `v: CONTEXT_EVENT_VERSION`。

fleet 的约定（quay-fleet `src/context-events.ts` 的读写校验）：读取端接受 `row.v <= schema.version`（所以 v0 行目前能读），但写入端必须严格 `row.v === schema.version`，不得以旧版本铸行。CloudCLI 写入器现在违反后一条；下次 fleet 若对写入方收紧或按版本区分载荷，就会静默丢行。

做什么：

- 写入器从它已经读取并用来校验的 schema 文档里取 `version`，写行时 `v` 等于它；不再导出或使用硬编码的版本常量（若有外部引用，改为读数函数）。
- schema 缺失时行为不变（`schema-unavailable`，不写）；schema 的 `version` 不是非负整数时按 schema 不可读处理，不写、不抛。
- 不改 fleet 的任何文件。

## AC

- [ ] `npx tsx --tsconfig server/tsconfig.json --test server/modules/context-events/tests/context-event-writer.test.ts` 退出 0，新增用例：临时目录 schema 的 version 为 1 时写出的行 `v === 1`；version 为 0 时 `v === 0`；version 缺失或为负数时不写且返回 schema 不可读的原因。
- [ ] 假形态变红：把写行改回固定 `v: 0` ⇒ version 1 的用例红；改完即还原。
- [ ] `npx tsx --tsconfig server/tsconfig.json --test server/modules/context-events/tests/session-ask-event-writer.test.ts` 与 `npx tsx --tsconfig server/tsconfig.json --test server/modules/context-events/tests/production-wiring.test.ts` 均退出 0。
- [ ] `grep -n "CONTEXT_EVENT_VERSION = 0" server/modules/context-events/context-event-writer.ts` 无命中。
- [ ] `npm run typecheck` 与 `npm run lint` 退出 0（lint 仅既有 warning）。

## DoD

在隔离实例里把 quay-fleet home 指向临时目录，放一份 version 1 的 schema 副本（复制自已安装 release 的 `config/context-event.schema.v0.json`），让一个复制来的会话以提问结束再回答，贴出事件目录新增两行原文，`v` 均为 1。⛔ 不改真实 fleet 安装，不重启线上服务。

## Touches

- tasks/gap-context-event-writer-stamps-schema-version.md
- server/modules/context-events/context-event-writer.ts
- server/modules/context-events/index.ts
- server/modules/context-events/tests/context-event-writer.test.ts

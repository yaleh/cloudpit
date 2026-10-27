---
id: gap-context-event-writer-stamps-schema-version
title: context 事件写入器按 fleet schema 的 version 打 row.v：去掉硬编码的
  CONTEXT_EVENT_VERSION = 0，schema 升到 v1 后写出的行仍是 v0，违反 fleet「写入方必须 v ===
  version」
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

来源：2026-10-27 核对线上事件流。quay-fleet 已发布 release `25d1866`，其 `config/context-event.schema.v0.json` 的 `version` 为 1（新增 `session.asking` / `session.answered`）。CloudCLI 重启后真实写出的行（`~/.quay-fleet/context/events/2026-10-27.jsonl`）是 `"v":0`，因为 `server/modules/context-events/context-event-writer.ts` 硬编码 `export const CONTEXT_EVENT_VERSION = 0`（注释写「The fleet schema pins this value」，在 schema 升版后已不成立），写行处 `v: CONTEXT_EVENT_VERSION`。

fleet 的约定（quay-fleet `src/context-events.ts` 的读写校验）：读取端接受 `row.v <= schema.version`（所以 v0 行目前能读），但写入端必须严格 `row.v === schema.version`，不得以旧版本铸行。CloudCLI 写入器现在违反后一条；下次 fleet 若对写入方收紧或按版本区分载荷，就会静默丢行。

做什么：

- 写入器从它已经读取并用来校验的 schema 文档里取 `version`，写行时 `v` 等于它；不再导出或使用硬编码的版本常量（若有外部引用，改为读数函数）。
- schema 缺失时行为不变（`schema-unavailable`，不写）；schema 的 `version` 不是非负整数时按 schema 不可读处理，不写、不抛。
- 不改 fleet 的任何文件。

## AC

- [x] `npx tsx --tsconfig server/tsconfig.json --test server/modules/context-events/tests/context-event-writer.test.ts` 退出 0，新增用例：临时目录 schema 的 version 为 1 时写出的行 `v === 1`；version 为 0 时 `v === 0`；version 缺失或为负数时不写且返回 schema 不可读的原因。
- [x] 假形态变红：把写行改回固定 `v: 0` ⇒ version 1 的用例红；改完即还原。
- [x] `npx tsx --tsconfig server/tsconfig.json --test server/modules/context-events/tests/session-ask-event-writer.test.ts` 与 `npx tsx --tsconfig server/tsconfig.json --test server/modules/context-events/tests/production-wiring.test.ts` 均退出 0。
- [x] `grep -n "CONTEXT_EVENT_VERSION = 0" server/modules/context-events/context-event-writer.ts` 无命中。
- [x] `npm run typecheck` 与 `npm run lint` 退出 0（lint 仅既有 warning）。

## DoD

在隔离实例里把 quay-fleet home 指向临时目录，放一份 version 1 的 schema 副本（复制自已安装 release 的 `config/context-event.schema.v0.json`），让一个复制来的会话以提问结束再回答，贴出事件目录新增两行原文，`v` 均为 1。⛔ 不改真实 fleet 安装，不重启线上服务。

## Touches

- tasks/gap-context-event-writer-stamps-schema-version.md
- server/modules/context-events/context-event-writer.ts
- server/modules/context-events/index.ts
- server/modules/context-events/tests/context-event-writer.test.ts
- server/modules/context-events/tests/session-ask-event-writer.test.ts

## Completion Notes

实现提交在任务分支 `e6c3d9f36`：

- `context-event-writer.ts`：删除 `CONTEXT_EVENT_VERSION` 常量；schema 缓存改为 `{ node, version }`，`append()` 用文档自身的 `version` 打 `v`。新增 `readSchemaVersion()`，只接受非负整数；缺失/负数/非整数时 `loadSchema()` 抛错并被既有 catch 收成 `schemaError`，`append()` 返回 `schema-unavailable`（零写入、不抛）。
- `tests/context-event-writer.test.ts`：fixture 改为 `fixtureSchema(version)`（`properties.v.const` 一并钉到该版本），新增 `schemaWithoutVersion()` 与 `withFixtureHome({ document })`，补 4 个用例：v1 ⇒ `v === 1`、v0 ⇒ `v === 0`、无 `version` / `version = -1` ⇒ 不写且原因含 `version`。
- `tests/session-ask-event-writer.test.ts`：v1 文档下不再断言 `row.v === 0`，改为断言 `row.v === 1`（写入器已按文档版本铸行）。这是本任务直接波及的兄弟夹具，已加入 Touches。

AC 证据：

- AC1 `npx tsx --tsconfig server/tsconfig.json --test server/modules/context-events/tests/context-event-writer.test.ts` → exit 0，9 tests / pass 9 / fail 0；输出含 `AC1(f/v1) schema_version=1 row_v=1`、`AC1(f/v0) schema_version=0 row_v=0`、`AC1(f/missing) state=schema-unavailable writes=0 reason=...version...`、`AC1(f/negative) state=schema-unavailable writes=0 reason=...version...`。
- AC2 假形态：把 `v: version` 改成 `v: 0` 后重跑同一文件 ⇒ 只有 version 1 用例红（`✖ AC1 (f): a document whose version is 1 mints rows with v === 1`，pass 8 / fail 1，exit 1）；随即还原为 `v: version` 并重跑全绿。
- AC3 `npx tsx --tsconfig server/tsconfig.json --test server/modules/context-events/tests/session-ask-event-writer.test.ts` → exit 0，4/4 通过（含 `AC-433(v1) lines=2 kinds=session.asking,session.answered`）；`... --test server/modules/context-events/tests/production-wiring.test.ts` → exit 0，6/6 通过。
- AC4 `grep -n "CONTEXT_EVENT_VERSION = 0" server/modules/context-events/context-event-writer.ts` → 无命中（exit 1）；`CONTEXT_EVENT_VERSION` 在仓库其余位置也无引用。
- AC5 `npm run typecheck` exit 0；`npm run lint` exit 0（仅既有 warning）。

DoD 证据（隔离实例，真实 fleet 安装未改，线上服务未重启）：

- 从 worktree 跑 `npm run build:server`（exit 0）。隔离实例环境：`HOME=/tmp/dod-context-version-3530582/home`（事件目录 `$HOME/.quay-fleet/context/events`）、`QUAY_FLEET_BIN=/tmp/dod-context-version-3530582/fleet/bin/quay-fleet`（指向 `releases/v1/bin/quay-fleet.mjs`）、独立 `DEBUG_AGENT_HOME` 与 `ISOLATED_INSTANCE_STATE_DIR`，端口 27395。
- schema 是已安装 release `25d1866` 的 `config/context-event.schema.v0.json` 副本，其中 `"version": 1`。
- 用 debug-agent 场景（scenario v1 / dialect claude / per-row-jsonl transcript）种入一个会话，clock 推进：先以助手提问结束，再以用户回答 + 助手回复结束。事件目录新增两行原文（`v` 均为 1）：

```
{"v":1,"id":"01M5YSD7F7SVSSD7H0CVHYPDBZ","at":"2026-10-27T13:39:45.255Z","source":"cloudcli","kind":"session.asking","project":"/tmp/dod-context-version-3530582/da/workspace","session":"dd8ccb5b-ca7b-4b6c-8b56-abd1819973ed","refs":["48242b39-fcc6-4b66-9101-3b27729b4d39"],"data":{"askId":"dd8ccb5b-ca7b-4b6c-8b56-abd1819973ed:48242b39-fcc6-4b66-9101-3b27729b4d39","messageId":"48242b39-fcc6-4b66-9101-3b27729b4d39","revision":1,"contentRef":{"resolver":"cloudcli.session-ask","sessionId":"dd8ccb5b-ca7b-4b6c-8b56-abd1819973ed","messageId":"48242b39-fcc6-4b66-9101-3b27729b4d39"}}}
{"v":1,"id":"01M5YSDBECXHQNB0GMJSA1T7M8","at":"2026-10-27T13:39:49.324Z","source":"cloudcli","kind":"session.answered","project":"/tmp/dod-context-version-3530582/da/workspace","session":"dd8ccb5b-ca7b-4b6c-8b56-abd1819973ed","data":{"askId":"dd8ccb5b-ca7b-4b6c-8b56-abd1819973ed:48242b39-fcc6-4b66-9101-3b27729b4d39","messageId":"13c02bb8-83ca-4cde-a02d-a3d9f07fd940"}}
```

- 原始证据保存在 worktree `tmp/gap-context-event-writer-stamps-schema-version-dod/EVIDENCE.md`（含 fleet schema 的版本行、场景读号与会话 transcript）。验证后 `bash scripts/isolated-instance.sh stop` 返回 `ok:true, port_still_serving:false`；`~/.quay-fleet` 与线上服务均未触碰。

- 该轴仍暗,理由:本任务只改事件写入器取 schema version，不改任何文档生成或模块依赖图，L_D/L_G 没有本任务产生的新读数；行为由上述判据、假形态红与隔离实例的两行 `v:1` 事件覆盖。

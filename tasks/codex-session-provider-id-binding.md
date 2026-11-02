---
id: codex-session-provider-id-binding
title: 会话记录 model_provider_id：首发送落库、换 provider 拒绝 + 一键 fork、删除/改名保护
status: ready
labels:
  - feature
parent: null
children: []
extra: {}
depends_on:
  - codex-model-entry-provider-binding
goal_ac: AC-462
---
<!-- dedup-ref --> 机制去重：无会话级 provider id 既有任务（codex resident 会话任务只管 threadId/pid，不管上游 provider）。本条是 sessions 列 + 首发送落库 + 切换/删除保护。

## Proposal

**现状**：sessions 有 model/effort/permission_mode（server/modules/database/schema.ts:177-178），无上游 provider id。resolveSessionModel 只按 model id 解析。Codex resume 要求同 provider id 配置仍在，换 provider 后 resume 必断（modelProviderMismatch）。

**范围**：
1. sessions 新列 model_provider_id（schema.ts + migrations.ts ensureColumns）。
2. 首发送落库所选模型的 provider id；resolveSessionModel/readRecordedSessionSelection 带出。
3. 换不同 provider id：拒绝 + 可读 fork/新会话动作（不静默改 model）。
4. 删除/改名被引用 provider：拒绝或显式标记（不静默把会话 model 改回默认）。

**落点（实现时的决定）**：
- 绑定规则放新叶子 `server/modules/providers/services/session-provider-binding.ts`（只 import `@/shared/*`，不形成 SCC）；`resolveSessionModel`/`resolveResumeModel` 拆到同目录 `session-model-resolver.ts` 工厂，`provider-models.service.ts` 765→737 行，避开 oversize 棘轮。
- `setSessionModel`（所有 send 的漏斗：chat.send / chat.edit-send / active-model 路由 / MCP reconfigure）在写行时拒绝换 provider；列本身 write-once（UPDATE 只匹配 NULL/空）。
- 发送前的拒绝放在 `dispatchRun` 入口（`startRun` 之前）：`setSessionModel` 在 `startRun` 之后，若在那里抛会留下一个没有进程的 running run。control 服务把该拒绝的 code 原样回传（不误标 RUN_IN_PROGRESS），MCP 侧映射到 `INVALID_ARGUMENT` 以保持 `MCP_ERROR_CODES` 规范词表。
- 删除/改名走「显式标记」支：registry 已不认识记录值时，`resolveSessionModel` 返回原 model + `modelProviderId` + 可读 `modelProviderProblem`（含 fork/新会话动作），绝不回退 catalog 默认；对已删 provider 的新绑定则直接拒绝（`SESSION_PROVIDER_UNKNOWN`）。
- NULL 语义：未记录绑定（未发过 / 未绑定 / 老行），可建立绑定；已记录值不会原地改。

## Touches

- server/modules/database/schema.ts
- server/modules/database/migrations.ts
- server/modules/database/repositories/sessions.db.ts
- server/modules/database/tests/migrations-ensure-columns.test.ts
- server/modules/mcp-gateway/mcp-session-send.ts
- server/modules/providers/provider.routes.ts
- server/modules/providers/services/provider-models.service.ts
- server/modules/providers/services/session-model-resolver.ts (new)
- server/modules/providers/services/session-provider-binding.ts (new)
- server/modules/providers/services/sessions.service.ts
- server/modules/providers/tests/codex-provider-model-binding.test.ts
- server/modules/providers/tests/codex-session-provider-binding.test.ts (new)（新判据，撞 pin 则上调）
- server/modules/providers/tests/provider-models.service.test.ts
- server/modules/websocket/services/chat-control.service.ts
- server/modules/websocket/services/chat-websocket.service.ts
- server/shared/tests/architecture-ratchet.baseline.json
- server/shared/tests/quay-test-script.test.ts
- server/shared/types.ts
- scripts/suite-duration-baseline.tsv
- tasks/codex-session-provider-id-binding.md

## AC

- [x] AC-462 判据绿：npx tsx --tsconfig server/tsconfig.json --test server/modules/providers/tests/codex-session-provider-binding.test.ts 退出 0、fail 0。
- [x] 负臂：换 provider 被拒；删除被引用 provider 不静默回退默认。

## DoD

判据逐字 tests/pass/fail；迁移对升级与全新安装结构一致；新 test.ts 撞 quay pin / 时长基线则等量上调并注明；migrations-ensure-columns.test.ts 补列断言。

## Verification

- 判据逐字：`npx tsx --tsconfig server/tsconfig.json --test server/modules/providers/tests/codex-session-provider-binding.test.ts` → `tests 8` / `pass 8` / `fail 0`，退出 0（duration_ms 6951.94，单次实测 6952ms 已写入时长基线）。
- 八条腿：①列存在 + 首发送记录 `bob`，resolveSessionModel 带出 `modelProviderId`；②未声明 provider 的模型不写列；③换到 `alice` 或未绑定模型 → 409 `SESSION_PROVIDER_MISMATCH`，消息含 `"bob"`/目标 provider/`fork this session`/`start a new one`，行未改；同 provider 换模型允许；④registry 改名/删除 `bob` 后 resolve 返回原 model（非 catalog 默认）+ `modelProviderProblem`，行未改；新会话绑定已删 provider → 409 `SESSION_PROVIDER_UNKNOWN` 且不写列；⑤NULL 绑定行仍可建立绑定；⑥HTTP `POST /active-model` 回 409 同 code/消息，`GET` 回 `modelProviderId: "bob"`；⑦fork 继承 `model_provider_id`；⑧`assertSessionProviderSwitch`（dispatchRun 入口调的同一个守卫）对首次发送放行、对换 provider 抛拒绝。
- 迁移：`migrations-ensure-columns.test.ts` 2/2 pass；升级库（DROP COLUMN 建旧表后跑 runMigrations）与全新库的 sessions 列集/类型/默认值一致，第二次迁移不重复 ALTER。
- 兄弟判据：`provider-models.service.test.ts` + `codex-provider-model-binding.test.ts` 40/40 pass；`session-fork.test.ts` + `provider.routes.test.ts` + `session-creation-selection.test.ts` 24/24 pass；`sessions.service.test.ts` + `chat-permission-mode.test.ts` 16/16 pass；`chat-control-wiring/send/busy` 12/12 pass；`chat-control-access/ownership/source` 12/12 pass；MCP `session-send`(+) / `session-send-delivery` / `error-envelope` / `error-vocabulary` 21/21 pass；`architecture-ratchet.test.ts` 6/6 pass；`server-import-cycle-budget.test.ts` 12/12 pass；`quay-test-script.test.ts` 14/14 pass。
- 连带 pin：`quay-test-script.test.ts` 两处 collected 数 502→503（known=3 unknown=499→500、known=1 unknown=501→502）并更新注释链；`scripts/suite-duration-baseline.tsv` 追加本判据 6952ms 行（454/503 = 90.3%，覆盖率地板 90% 仍满足）。
- oversize 棘轮：`architecture-ratchet.baseline.json` 按 RECORDED CHANGE 上调 migrations.ts 1167→1190、provider.routes.ts 1162→1173、sessions.service.ts 1390→1394、chat-control.service.ts 1116→1149、chat-websocket.service.ts 1970→1994、server/shared/types.ts 5552→5572，理由写进 baseline 的 note；`provider-models.service.ts` 765→737（拆分后低于 800，未进入 oversize 表）。
- typecheck：`npx tsc --noEmit -p server/tsconfig.json` 与 `-p tsconfig.json` 均退出 0。

## ADR-007

- 该轴仍暗,理由:本任务未运行 ArchGuard，未产出周期/分层实测读数；新增的 session-provider-binding.ts / session-model-resolver.ts 是 shared-imports-only 的同目录叶子文件，不新增目录、不进入 SCC，周期读数由 server-import-cycle-budget.test.ts 12/12 绿代替。

## Blocker

**2026-11-02T22:43:43.532Z — worker 未落地（exited-not-landed）**

- 未落地原因：step=suite: __PERFILE__ duration_ms=2334 server/modules/websocket/tests/chat-background-task.test.ts passed=false end_ms=1793659156131 [baseline A/B: HARD RED (task-introduced-red) — the task's red set is NOT a subset of the develop baseline red set: added=server/modules/websocket/tests/chat-background-task.test.ts,server/modules/websocket/tests/chat-stop-task.test.ts,server/modules/websocket/tests/chat-background-task.test.ts,server/modules/websocket/tests/chat-stop-task.test.ts changed=-]
- run_id：wk-prod-anchor
- session_id：365946b5-cfd7-47e2-a32a-0a6b0b77bb4f

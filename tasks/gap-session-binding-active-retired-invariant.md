---
id: gap-session-binding-active-retired-invariant
title: Codex 时间修复（二）：收口绑定写入，禁止当前线程与淘汰记录并存
status: ready
labels:
  - gap
  - defect
parent: null
children: []
extra:
  schema: execution
depends_on:
  - gap-codex-active-retired-session-data-recovery
---
## Proposal

第二步统一绑定规则，防止第一步已修数据再次损坏。真实异常是 session a0794390-8619-4c21-981b-faa702cf96f6 仍绑定 Codex线程01a190a1-a148-7e90-8461-2937533839e9，但线程同时被标淘汰且 jsonl_path=NULL。Codex同步器 processSessionFile 对该标记直接return null，更新时间永久停滞。

<!-- dedup-ref --> gap-session-binding-consistency（done）已有 sessionBindingService、confirmRunDiscoveredProviderSession、replaceBinding、clearSupersededForNewBinding 和迟到回写测试。应审计现有入口和遗留 assign/repoint/detach 写路径，补齐实际绕过与不变量，不能重新造同一服务；不预设此异常一定由当前版本代码新产生。先区分历史脏数据和现存可复现写路径。

## Plan

1. 追踪所有 provider_session_id/jsonl_path/superseded 写入及生产调用者，核对部署版本/已有证据，复现真实形态；无法证明历史触发路径时明确记录证据边界。
2. 收口到现有应用层绑定入口，分别表达首次登记/同线程确认、编辑分叉、首条重开、零回合恢复、明确旧线程恢复；仓储负责事务。
3. 当前绑定不得同时处于淘汰集合。普通运行发现不能恢复已淘汰ID；旧run/host不能覆盖后续编辑绑定。明确恢复须校验线程文件身份并原子清理该标记、维护旧绑定淘汰关系和正确路径。
4. 绑定、淘汰关系、重复索引合并、历史缓存失效与upsert通知协调；事务失败不广播成功、不留下半套状态。对历史冲突明确诊断，不让同步器静默清标记猜测恢复。
5. 保持公开能力/接口兼容并补窄范围行为测试与能击穿守卫的负对照。

## AC

- [x] 场景1“编辑后旧线程迟到上报”：通过实际run/host发现入口验证旧身份被拒绝，新线程/路径/淘汰关系不变，watcher不复活旧分支。
- [x] 场景2“恢复旧线程”：只有明确恢复入口能成功；恢复后当前绑定不在淘汰表，路径身份一致，旧绑定处理正确，重复恢复幂等且历史缓存不返回旧路径。
- [x] 首次登记、同线程确认、首条编辑重开、合法零回合恢复不被过度拒绝；绑定原子性、并发冲突与事务失败回滚通过。
- [x] 所有现存生产绑定写路径完成审计并收口或有清晰受约束职责；当前版本能复现的违规路径有回归，历史来源无法确认处如实记录。
- [x] 复原旧身份盲写/移除淘汰守卫的负对照必须使对应行为测试失败；测试经真实入口验证，非仅静态源码扫描。
- [x] 受影响数据库/provider/websocket窄范围测试、typecheck、lint通过；遵守模块/大小/依赖环约束。

## DoD

场景1、2有独立行为判据与读数。明确区分第一步已修真实数据与本步预防性代码；不把当前绑定冲突的静默自愈放进普通indexer。涉及UI行为时按AGENTS要求执行MCP浏览器截图与可用场景运行器报告。遵守 AGENTS.md；server/ 使用 backend-module-standards，src/ 使用 frontend-module-standards。测试单文件直接运行；多文件须用 scripts/with-memory-cap.sh 并钳制并发，会话内不跑完整 suite，全量交 quay fan-in。复用现有能力、barrel 与绑定服务，不创建另一套绑定实现。任务创建时所有 AC 未完成；执行后通过 task_check/task_write 记录实际结果。

## Dark axis

该轴仍暗,理由:本任务以真实入口的行为测试与负对照验收，无可测的 L_D/L_G 读数

## Verification

- `npx tsc --noEmit -p server/tsconfig.json` 通过；改动文件 `npx oxlint` 零告警。
- `session-binding-consistency.test.ts` 18/18 通过（场景1/2、原子回滚、零回合、幂等、旧盲写负对照）。
- `chat-run-registry.test.ts` 真实 `chatRunRegistry.startRun` + writer 入口 14/14 通过。
- `session-fork.test.ts` 10/10 通过（夹具改走 `createAppSession` + 受守卫的首次登记，不再依赖盲写）。
- 受影响的 assign 调用方有界批次：52 tests / 51 pass / 1 skipped / 0 fail；另两批 20/20、57/57 通过。
- 结构约束：architecture-ratchet、server-import-cycle-budget、quay-test-script 共 32/32 通过。
- 负对照实测：临时移除 `confirmRunDiscoveredProviderSession` 与 `replaceProviderSessionBinding` 的淘汰守卫后，同一测试文件 5 条行为测试转红，恢复后哈希回到原值并全绿。
- 历史数据（a0794390）与本步代码隔离：该行的时间戳显示淘汰记录与行写入是两次独立写入（06:25:00 与 06:27:15），当前单事务路径无法复现；证据边界已写入 `docs/operations/session-binding-recovery.md`。

## Touches

- server/modules/database/session-binding.service.ts
- server/modules/database/repositories/session-binding.db.ts
- server/modules/database/repositories/sessions.db.ts
- server/modules/database/index.ts
- server/modules/database/tests/*
- server/modules/providers/list/codex/*binding*
- server/modules/providers/list/codex/codex-host-driver*
- server/modules/providers/list/codex/codex-sessions.provider.ts
- server/modules/providers/list/codex/codex-session-synchronizer.provider.ts
- server/modules/providers/tests/session-binding-consistency.test.ts
- server/modules/providers/tests/session-fork.test.ts
- server/modules/providers/tests/codex-message-editing.test.ts
- server/modules/websocket/services/chat-run-registry.service.ts
- server/modules/websocket/services/chat-session-writer.service.ts
- server/modules/websocket/tests/chat-run-registry.test.ts
- server/modules/websocket/tests/*binding*
- scripts/repair-session-binding.mjs
- docs/operations/session-binding-recovery.md
- tasks/gap-session-binding-active-retired-invariant.md

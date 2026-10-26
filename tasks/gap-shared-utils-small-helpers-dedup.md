---
id: gap-shared-utils-small-helpers-dedup
title: 小工具归位：isRecord / errorMessage / expandHome 的 30 余份副本收进
  server/shared/utils 与 src/shared/utils
status: todo
labels:
  - gap
parent: null
children: []
extra:
  schema: execution
depends_on:
  - gap-settings-file-shared-reader
  - gap-frontend-external-store-lru-clock-primitives
---
## Proposal

<!-- dedup-ref --> 同批 6 条重构的第 5 条（2026-10-26 架构复查）。四个 settings 读取器里的副本由 `gap-settings-file-shared-reader` 收敛，本任务不再碰它们；`curationStore.ts` 与 `architectureRefreshController.ts` 同时被 `gap-frontend-external-store-lru-clock-primitives` 修改——两条都写进 depends_on 以串行。

### 现状（2026-10-26 实测）

后端标准与前端标准都要求「两处以上使用的工具函数放进 `shared/utils.ts`」，但：
- `isRecord` 有 17 份定义，`server/shared/utils.ts` 与 `src/shared/utils.ts` 均未导出；
- `errorMessage` / `messageOf` / `describeError`（`error instanceof Error ? error.message : String(error)`）有 15 份；
- `expandHome` 有 5 份。

扣除 settings 读取器与 `server/modules/voice/sensevoice-worker.ts`（该文件刻意只用类型导入，保持轻量，不在范围内）后，本任务处理：

后端 `isRecord`：`observation/view-events.service.ts`、`observation/session-digest.ts`、`observation/architecture-delta.ts`、`observation/architecture-delta.producer.ts`、`observation/observation-store.ts`、`architecture/refresh-publish.ts`、`architecture/refresh-spawn.ts`、`architecture/service.ts`、`quay/session-mentions.service.ts`、`quay/session-task-chain.service.ts`、`liaison/liaison-store.ts`。
后端 `errorMessage`：`session-hosts/resident-host.service.ts`、`session-hosts/resident-restore.service.ts`、`voice-realtime/voice-realtime-tts-local.ts`、`voice-realtime/voice-realtime-uplink-vad-arm-point.ts`、`voice-realtime/voice-realtime-uplink-vad.ts`、`voice-realtime/voice-realtime-speaker-seam.ts`、`architecture/refreshJob.ts`、`architecture/refresh-publish.ts`、`observation/architecture-delta.producer.ts`、`settings/server-settings.ts`。
后端 `expandHome`：`observation/view-events.service.ts` 改用 `server/shared/settings-file.ts` 的导出。
前端：`src/modules/architecture/architectureChatBridge.ts`、`src/modules/architecture/curationStore.ts`（isRecord），`src/modules/settings/hooks/useSpeakerModelStatus.ts`、`src/modules/architecture/architectureRefreshController.ts`（errorMessage）。

### 改法

`server/shared/utils.ts` 与 `src/shared/utils.ts` 各增加 `isRecord` 与 `errorMessage`（带分组注释与说明注释）；上述文件删除本地副本改为导入。语义与现有副本不同的变体（如空 message 回退到 `String(error)`）不得强行合并：要么作为 `errorMessage` 的可选参数，要么改成能说明差异的新名字。`server/shared/settings-file.ts` 中若有私有 `isRecord`，同样改为导入。

### 导入环预算（AC-394）

只在既有文件之间移动函数、新增指向 `server/shared/**` 的边，不新增目录：`directoryManifest`/`nodeCount`（56）、`cycleGroups`、`unresolvedInternalBudget`（19）全部不变，基线 JSON 与测试文件不得改动。

## AC

- [ ] 共享导出：`grep -nE "export function (isRecord|errorMessage)\(" server/shared/utils.ts src/shared/utils.ts` 命中 4 行。
- [ ] 后端副本清零：`grep -rnE "^function (isRecord|errorMessage|messageOf|describeError|expandHome)\(" server/modules server/shared --include='*.ts' | grep -v '/tests/' | grep -v 'server/modules/voice/sensevoice-worker.ts' | grep -v 'server/shared/utils.ts' | grep -v 'server/shared/settings-file.ts'` 无输出。
- [ ] 前端副本清零：`grep -nE "^function (isRecord|errorMessage|messageOf|describeError)\(" src/modules/architecture/architectureChatBridge.ts src/modules/architecture/curationStore.ts src/modules/settings/hooks/useSpeakerModelStatus.ts src/modules/architecture/architectureRefreshController.ts` 无输出。
- [ ] 新判据：`npx tsx --tsconfig server/tsconfig.json --test server/shared/tests/shared-utils-helpers.test.ts` exit 0 与 `npx vitest run src/shared/tests/sharedUtilsHelpers.test.ts` exit 0，覆盖普通对象/数组/null/类实例的 `isRecord` 读数与 Error/字符串/空 message 的 `errorMessage` 读数。
- [ ] 行为不回归：`npx tsx --tsconfig server/tsconfig.json --import ./scripts/undici-blocked-ports-preload.mjs --test server/modules/observation/tests/session-digest.test.ts server/modules/architecture/tests/refreshJob.test.ts server/modules/quay/tests/session-mentions.test.ts` exit 0；`npx vitest run src/modules/architecture/tests/curationStore.test.ts src/modules/architecture/tests/architectureRefreshController.test.ts` exit 0。
- [ ] 导入环预算不变：`npx tsx --tsconfig server/tsconfig.json --test server/shared/tests/server-import-cycle-budget.test.ts` exit 0，且 `git diff --quiet HEAD -- server/shared/tests/server-import-cycle-budget.baseline.json server/shared/tests/server-import-cycle-budget.test.ts` exit 0。
- [ ] 静态检查：`npm run typecheck` exit 0；`npx oxlint server/shared server/modules src/shared src/modules/architecture src/modules/settings` exit 0。

## DoD

用 `npm run build:server` 产出的 dist 起一个隔离实例，真实触发三个改动过的错误路径并贴出日志行：架构 tab 手动刷新指向一个不存在的 ArchGuard CLI（refreshJob 的 errorMessage）、观察墙读一份坏 JSON 的 view-events 文件（view-events 的 isRecord/expandHome）、resident 恢复一个已不存在的会话（resident-restore 的 errorMessage）。贴出的错误文本与迁移前同一操作的文本逐字一致，证明共享函数在真实路径上替换了副本。

## Touches

- server/shared/utils.ts
- src/shared/utils.ts
- server/shared/settings-file.ts
- server/shared/tests/shared-utils-helpers.test.ts (new)
- src/shared/tests/sharedUtilsHelpers.test.ts (new)
- server/modules/observation/view-events.service.ts
- server/modules/observation/session-digest.ts
- server/modules/observation/architecture-delta.ts
- server/modules/observation/architecture-delta.producer.ts
- server/modules/observation/observation-store.ts
- server/modules/architecture/refresh-publish.ts
- server/modules/architecture/refresh-spawn.ts
- server/modules/architecture/refreshJob.ts
- server/modules/architecture/service.ts
- server/modules/quay/session-mentions.service.ts
- server/modules/quay/session-task-chain.service.ts
- server/modules/liaison/liaison-store.ts
- server/modules/session-hosts/resident-host.service.ts
- server/modules/session-hosts/resident-restore.service.ts
- server/modules/voice-realtime/voice-realtime-tts-local.ts
- server/modules/voice-realtime/voice-realtime-uplink-vad-arm-point.ts
- server/modules/voice-realtime/voice-realtime-uplink-vad.ts
- server/modules/voice-realtime/voice-realtime-speaker-seam.ts
- server/modules/settings/server-settings.ts
- src/modules/architecture/architectureChatBridge.ts
- src/modules/architecture/curationStore.ts
- src/modules/settings/hooks/useSpeakerModelStatus.ts
- src/modules/architecture/architectureRefreshController.ts
- server/shared/tests/quay-test-script.test.ts
- scripts/suite-duration-baseline.tsv
- tasks/gap-shared-utils-small-helpers-dedup.md
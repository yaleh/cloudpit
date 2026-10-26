---
id: gap-frontend-external-store-lru-clock-primitives
title: 前端基础件：createExternalStore / BoundedLru / Clock 收敛 10 份手写 store、4 份手写 LRU
  与 2 个同构时钟类型
status: todo
labels:
  - gap
parent: null
children: []
extra:
  schema: execution
---
## Proposal

<!-- dedup-ref --> 同批 6 条重构的第 4 条（2026-10-26 架构复查）。刻意不碰 `src/shared/hooks/useServerFeatures.ts` 与 `src/modules/notices/useNotices.ts`：它们分别归 `gap-server-features-store-encapsulation`、`gap-notices-react-free-controller`（均 ready），那两条落地后可改用本任务的基础件，但不在本任务范围。

### 现状（2026-10-26 实测）

- **手写外部 store**：以下 10 个文件各自实现一遍 `listeners = new Set<() => void>()` + `subscribe` + `getSnapshot` + 逐个通知：`src/modules/chat/hooks/useSessionActivity.ts`、`src/modules/chat/utils/voice/voicePlayer.ts`、`src/modules/sidebar/hooks/useFleetTaskCounts.ts`、`src/modules/architecture/curationStore.ts`、`src/shared/userSettings.ts`、`src/shared/chatDrafts.ts`、`src/shared/hooks/useSessionHosts.ts`、`src/modules/cockpit/hooks/useObservationWall.ts`、`src/modules/chat/utils/replySuggestionsController.ts`、`src/modules/architecture/architectureRefreshController.ts`。
- **手写 LRU**（Map 删除后重新 set，`keys().next().value` 淘汰最旧）：`replySuggestionsController.ts`、`src/modules/chat/utils/transcript/messageTransforms.ts`、`src/modules/architecture/layoutOrientation.ts`、`voicePlayer.ts`。
- **同构时钟注入类型**：`ReplySuggestionsClock`（setTimeout/clearTimeout）与 `ArchitectureRefreshClock`（再加 setInterval/clearInterval/now）名字不同、形状重叠。`ExplosionLodScheduler` 是 request/cancel 语义，不同构，不在范围内。

### 改法

按前端标准的放置规则（两处以上使用的工具进 `src/shared/utils.ts`、类型进 `src/shared/types.ts`，不新建模块级 utils 文件）：
- `src/shared/utils.ts` 增加 `createExternalStore<T>(initial)`：返回 `{ subscribe, getSnapshot, set(next), update(fn) }`，`set` 在值身份不变时不通知；10 个文件改用它，各自的业务规则、生命周期方法与对外签名不变。
- `src/shared/utils.ts` 增加 `createBoundedLru<K, V>(capacity)`：`get` 刷新新近度、`set` 超容淘汰最旧；4 个文件改用它。
- `src/shared/types.ts` 增加 `Clock` 类型（setTimeout/clearTimeout/setInterval/clearInterval/now）与 `defaultClock`（放 utils）；两个 controller 的时钟类型改为 `Clock` 或其 `Pick`。

## AC

- [ ] 基础件落地：`grep -nE "export function (createExternalStore|createBoundedLru)" src/shared/utils.ts` 两个都命中，各带说明注释；`grep -n "export type Clock = " src/shared/types.ts` 命中。
- [ ] 手写 store 清零：`grep -nF "new Set<() => void>()" src/modules/chat/hooks/useSessionActivity.ts src/modules/chat/utils/voice/voicePlayer.ts src/modules/sidebar/hooks/useFleetTaskCounts.ts src/modules/architecture/curationStore.ts src/shared/userSettings.ts src/shared/chatDrafts.ts src/shared/hooks/useSessionHosts.ts src/modules/cockpit/hooks/useObservationWall.ts src/modules/chat/utils/replySuggestionsController.ts src/modules/architecture/architectureRefreshController.ts` 无输出。
- [ ] 手写 LRU 清零：`grep -nF "keys().next().value" src/modules/chat/utils/replySuggestionsController.ts src/modules/chat/utils/transcript/messageTransforms.ts src/modules/architecture/layoutOrientation.ts src/modules/chat/utils/voice/voicePlayer.ts` 无输出。
- [ ] 时钟类型收敛：`grep -nE "export type (ReplySuggestionsClock|ArchitectureRefreshClock) = \{" src/modules/chat/utils/replySuggestionsController.ts src/modules/architecture/architectureRefreshController.ts` 无输出（改为 `Clock` 或其 `Pick` 别名，或直接使用 `Clock`）。
- [ ] 新判据：`npx vitest run src/shared/tests/externalStoreAndLru.test.ts` exit 0，覆盖 store 订阅/退订、同值不通知、LRU 刷新新近度与超容淘汰顺序。
- [ ] 行为不回归：`npx vitest run src/shared/tests/chatDrafts.test.ts src/shared/tests/userSettings.test.ts src/shared/tests/sessionHostsRequests.test.ts src/modules/architecture/tests/curationStore.test.ts src/modules/cockpit/tests/ObservationWall.test.tsx src/modules/chat/tests/sessionActivityJoinRead.test.tsx src/modules/chat/tests/replySuggestionsController.test.ts src/modules/architecture/tests/architectureRefreshController.test.ts` exit 0。
- [ ] 静态检查：`npx tsc --noEmit -p tsconfig.json` exit 0；`npx oxlint src/shared src/modules/chat src/modules/architecture src/modules/sidebar src/modules/cockpit` exit 0。

## DoD

MCP 浏览器在隔离实例的真实页面上走一遍受影响的 store：在 composer 输入草稿后切走再切回会话（chatDrafts），改一个用户设置并刷新页面（userSettings），在架构 tab pin 一个实体后切走再切回（curationStore），观察侧栏会话宿主状态与驾驶舱观察墙随轮询更新（useSessionHosts / useObservationWall），并触发一次回复建议重抽（replySuggestionsController）。每步截图存 `tmp/` 并贴出；存在可用场景时同时跑 `node scripts/ui-scenario.mjs <scenario.json>` 并贴出 JSON 报告。

## Touches

- src/shared/utils.ts
- src/shared/types.ts
- src/shared/tests/externalStoreAndLru.test.ts (new)
- src/modules/chat/hooks/useSessionActivity.ts
- src/modules/chat/utils/voice/voicePlayer.ts
- src/modules/sidebar/hooks/useFleetTaskCounts.ts
- src/modules/architecture/curationStore.ts
- src/shared/userSettings.ts
- src/shared/chatDrafts.ts
- src/shared/hooks/useSessionHosts.ts
- src/modules/cockpit/hooks/useObservationWall.ts
- src/modules/chat/utils/replySuggestionsController.ts
- src/modules/architecture/architectureRefreshController.ts
- src/modules/chat/utils/transcript/messageTransforms.ts
- src/modules/architecture/layoutOrientation.ts
- tasks/gap-frontend-external-store-lru-clock-primitives.md
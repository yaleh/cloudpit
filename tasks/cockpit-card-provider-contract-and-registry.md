---
id: cockpit-card-provider-contract-and-registry
title: 驾驶舱卡片契约 v0 与提供方注册表：ICockpitCardProvider + 卡片投影 + 执行通道 + 夹具提供方（经
  server.settings.json 开关）
status: ready
labels:
  - feature
  - cockpit
parent: null
children: []
extra:
  schema: execution
goal_ac: AC-421
---
## Proposal

来源：本会话 2026-10-26 至 10-27 驾驶舱重设计，设计稿 `docs/architecture/cockpit-attention/CARD-PROVIDERS.md`（契约 v0、模块边界）与 `INTERACTION-PRINCIPLES.md`。用户确定三条原则：驾驶舱在本项目内封装；卡死、救援、等待、通知、结束等开发语义由 quay-fleet 提供；将来可接入别的卡片提供方。本任务只做后端骨架，用测试夹具提供方驱动，不接 fleet（fleet 读口仍在对齐）。

做什么：

- 共享类型：在 `server/shared/types.ts` 加 `CockpitCard`、`CockpitCardOption`、`CockpitCardFact`、`CockpitCardTag` 及字面量联合（kind 为开放字符串加已知集合 ask、multi、need、stuck、fix、decision；state 为 open、resolved、expired；source 为 assistant、judge、provider，冻结为枚举）。`src/shared/types.ts` 加镜像，并新增 TypeSync 判据 `src/shared/tests/cockpitCardTypeSync.test.ts`（AC-422，读两侧、任一侧增删字段或字面量即红，先例 `src/shared/tests/wireContractTypeSync.test.ts`）。
- 能力接口：`server/shared/interfaces.ts` 加 `ICockpitCardProvider`（listCards、subscribe、declaredExecutors）与 `ICockpitActionExecutor`（id、execute(params)）。
- 注册表与投影：`server/modules/cockpit/cockpit-card-registry.ts`。投影只合并各提供方 state 为 open 的卡片，排序完全取提供方的 group 与 rank，不自造排序或隐藏规则；revision 原样透传。
- 执行通道：`server/modules/cockpit/cockpit-card-actions.ts`，确认请求带 cardId、optionId（或自己的回复文本）、card revision；revision 过期返回明确冲突；执行器 id 未声明返回明确错误；同一确认只调用执行器一次。
- 路由：`GET /api/cockpit/cards` 与 `POST /api/cockpit/cards/confirm`，挂在现有 `server/modules/cockpit/cockpit.module.ts`，路由保持薄。
- 夹具提供方：`server/modules/cockpit/cockpit-fixture-card-provider.ts` 输出覆盖六种 kind 的卡片（含有推荐与无推荐两种），其执行器只把收到的确认记进内存列表供读数；由 `server/modules/settings/server-settings.ts` 的新开关 `cockpit.fixtureCards`（默认关）启用，供后续界面任务在隔离实例里做 DoD。新旋钮按约定进 server.settings.json，不用 env 或 drop-in。

与 quay-fleet 对齐中的点，本任务按 fleet 回复先这样取：ack 是执行器动作而不是 state；revision 只在内容或状态变化时递增，提醒时间类刷新不递增；`contentRef.resolver` 与执行器 id 都是声明集，不接受未声明值；`notify.reason` 取提供方规则 id；`load` 语义未定，v0 类型里不放。

不做：fleet 适配器、session.send 与 session.start 执行器、任何界面。现有 `cockpit-hub.service.ts` 与 reducer 不改行为。

## AC

- [x] `npx tsx --tsconfig server/tsconfig.json --test server/modules/cockpit/tests/cockpit-card-registry.test.ts` 退出 0（AC-421 判据）：用例覆盖 open 卡片按提供方 group 与 rank 原序返回；resolved 与 expired 不出现；测试内再注册第二个夹具提供方（只新增一个类与一行注册）后其卡片出现；确认某选项后该选项声明的执行器恰好被调用一次且参数等于声明的 params；未声明执行器 id 返回明确错误；revision 过期的确认返回冲突且执行器调用次数为 0。
- [x] `npx vitest run src/shared/tests/cockpitCardTypeSync.test.ts` 退出 0（AC-422 判据）；临时在 `src/shared/types.ts` 的 state 联合里删去 expired 后该命令退出非 0 且失败信息点名 src 侧与该字面量，随后改回。
- [x] 假形态各自变红：在投影里按 waitingSince 重排 ⇒ 排序用例红；把 state 过滤改为驾驶舱本地规则（例如按 kind 隐藏）⇒ 显隐用例红；让确认路径调用执行器两次 ⇒ 恰好一次用例红。每个假形态改完即还原。
- [x] 夹具开关：`server/modules/settings/server-settings.ts` 的开关默认关时 `GET /api/cockpit/cards` 返回空列表；开时返回夹具卡片，用例在同一测试文件内覆盖两种取值。
- [x] `npx tsx --tsconfig server/tsconfig.json --test server/shared/tests/server-import-cycle-budget.test.ts` 与 `npx tsx --tsconfig server/tsconfig.json --test server/shared/tests/architecture-ratchet.test.ts` 均退出 0。
- [x] `npm run typecheck` 与 `npm run lint` 退出 0（lint 仅既有 warning）。

## DoD

在隔离实例（`scripts/isolated-instance.sh start`，脚本已关闭 residentRestore）里把 `cockpit.fixtureCards` 打开后，用 curl 实际请求 `GET /api/cockpit/cards`，贴出返回体（六种 kind 都在、顺序等于夹具的 group 与 rank）；对一张有推荐的卡片 `POST /api/cockpit/cards/confirm` 一次，贴出响应与夹具执行器记下的那一条确认；再用旧 revision 重发一次，贴出冲突响应且执行器记录仍只有一条。关掉开关重启后同一请求返回空列表。实例用毕 `scripts/isolated-instance.sh stop`。

## Evidence（2026-10-27）

AC1 `npx tsx --tsconfig server/tsconfig.json --test server/modules/cockpit/tests/cockpit-card-registry.test.ts` ⇒ `EXIT=0`，`tests 7 / pass 7 / fail 0`。用例覆盖：投影按 group/rank（各卡 waitingSince 故意反序布置，按时钟排会得到 late/mid/early）；resolved 与 expired 不出现；第二提供方一个类加一行 `register` 后其卡片出现；确认一次只调用执行器一次且参数与声明 `deepEqual`；未声明执行器 `EXECUTOR_NOT_DECLARED` 且 0 次调用；旧 revision `REVISION_CONFLICT` 且 0 次调用；夹具开关两值在同一文件内覆盖。

AC2 `npx vitest run src/shared/tests/cockpitCardTypeSync.test.ts` ⇒ `EXIT=0`，5 tests passed。临时删掉 src 侧 `expired` ⇒ `EXIT=1`，失败信息：`AssertionError: CockpitCardState: src/shared/types.ts and server/shared/types.ts must name the same members; src-only: []; server-only: [expired]`；随后原样恢复（`git diff` 对 `src/shared/types.ts` 只剩本任务的类型新增）。

AC3 三个假形态各自红、均已还原：
- 投影改按 `waitingSince` 排序 ⇒ `AssertionError: open cards must follow the provider group then rank — not the clock`（夹具顺序用例同红）；
- 投影加本地 `kind !== 'decision'` 隐藏规则 ⇒ `AssertionError: every open card must be visible — no cockpit-local rule may hide one by kind`；
- 确认路径调用执行器两次 ⇒ `AssertionError: one confirmation must call the executor exactly once`。

AC4 夹具开关：见上条测试文件；真实 HTTP 读数见 DoD。

AC5 `server-import-cycle-budget.test.ts` ⇒ `EXIT=0`（11/11）；`architecture-ratchet.test.ts` ⇒ `EXIT=0`（6/6）。基线按文件自身 RECORDED CHANGE 格式记录了上调理由：`server/index.ts` 2754→2769（构建卡片模块并挂载路由的三条语句）、`server/shared/types.ts` 4629→4749 与 `src/shared/types.ts` 4123→4243（契约类型必须在两侧各写一次，TypeSync 判据逐字段比较）；同一次重录中其余读数只降。

AC6 `npm run typecheck` ⇒ `EXIT=0`（三段 tsc 全过）；`npm run lint` ⇒ `EXIT=0`，`: error` 计数 0（只有既有 warning）。

DoD（隔离实例，`scripts/isolated-instance.sh start`；启动入口先让脚本写入 `residentRestore.enabled=false`，再补 `cockpit` 开关，最后 import 真实 `dist-server/server/index.js`）：

开（`{"cockpit":{"enabled":true,"fixtureCards":true}}`）`GET /api/cockpit/cards` 返回 6 张卡，读数：

```
fixture:need | need | rescue 1 | rev 1 | options provide*,later
fixture:stuck | stuck | rescue 2 | rev 1 | options resume*,park
fixture:fix | fix | rescue 3 | rev 1 | options apply*,decline
fixture:ask | ask | ruling 1 | rev 1 | options delete*,keep
fixture:multi | multi | ruling 2 | rev 1 | options scope-small*,scope-full
fixture:decision | decision | ruling 3 | rev 1 | options stable,canary
kinds need,stuck,fix,ask,multi,decision
```

`POST /api/cockpit/cards/confirm` 一次（`{"cardId":"fixture:ask","optionId":"delete","revision":1}`）⇒ `HTTP=200`：

```
{"ok":true,"cardId":"fixture:ask","executor":"fixture.record","params":{"cardId":"fixture:ask","optionId":"delete"},"result":{"recorded":{"cardId":"fixture:ask","optionId":"delete","reply":null,"params":{"cardId":"fixture:ask","optionId":"delete"}},"total":1}}
```

同一请求（旧 revision）重发 ⇒ `HTTP=409`：

```
{"success":false,"error":{"code":"REVISION_CONFLICT","message":"card fixture:ask is at revision 2, not 1"}}
```

随后确认第二张卡（`fixture:fix` / `apply`，revision 1）读到的执行器记录是 `"total":2`；若旧 revision 那次被执行过，这里会是 3，因此记录仍只有第一条。

关（`{"cockpit":{"enabled":true,"fixtureCards":false}}`）重启后同一请求 ⇒ `HTTP=200`、`{"cards":[]}`。实例已 `scripts/isolated-instance.sh stop`（`ok:true`、`port_still_serving:false`）。

## ADR-007 轴记录

- 该轴仍暗,理由:本任务只做卡片契约的后端骨架与夹具提供方，未接 fleet、不做界面，L_D/L_G 两轴没有可测读数；契约行为由 AC-421 的服务端判据与隔离实例 curl 读数覆盖。

## Touches

- tasks/cockpit-card-provider-contract-and-registry.md
- server/index.ts（构建卡片模块并挂载认证路由；组合根本来就必须改）
- server/shared/types.ts
- server/shared/interfaces.ts
- src/shared/types.ts
- src/shared/tests/cockpitCardTypeSync.test.ts (new)
- server/modules/cockpit/cockpit-card-registry.ts (new)
- server/modules/cockpit/cockpit-card-actions.ts (new)
- server/modules/cockpit/cockpit-fixture-card-provider.ts (new)
- server/modules/cockpit/cockpit.module.ts
- server/modules/cockpit/index.ts
- server/modules/cockpit/tests/cockpit-card-registry.test.ts (new)
- server/modules/settings/server-settings.ts
- server/shared/tests/server-import-cycle-budget.test.ts
- server/shared/tests/quay-test-script.test.ts
- server/shared/tests/architecture-ratchet.baseline.json（契约类型与组合根的增长按 RECORDED CHANGE 记录，AC5 要求该判据退出 0）
- scripts/suite-duration-baseline.tsv

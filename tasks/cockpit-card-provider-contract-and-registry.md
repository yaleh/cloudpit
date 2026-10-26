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

- [ ] `npx tsx --tsconfig server/tsconfig.json --test server/modules/cockpit/tests/cockpit-card-registry.test.ts` 退出 0（AC-421 判据）：用例覆盖 open 卡片按提供方 group 与 rank 原序返回；resolved 与 expired 不出现；测试内再注册第二个夹具提供方（只新增一个类与一行注册）后其卡片出现；确认某选项后该选项声明的执行器恰好被调用一次且参数等于声明的 params；未声明执行器 id 返回明确错误；revision 过期的确认返回冲突且执行器调用次数为 0。
- [ ] `npx vitest run src/shared/tests/cockpitCardTypeSync.test.ts` 退出 0（AC-422 判据）；临时在 `src/shared/types.ts` 的 state 联合里删去 expired 后该命令退出非 0 且失败信息点名 src 侧与该字面量，随后改回。
- [ ] 假形态各自变红：在投影里按 waitingSince 重排 ⇒ 排序用例红；把 state 过滤改为驾驶舱本地规则（例如按 kind 隐藏）⇒ 显隐用例红；让确认路径调用执行器两次 ⇒ 恰好一次用例红。每个假形态改完即还原。
- [ ] 夹具开关：`server/modules/settings/server-settings.ts` 的开关默认关时 `GET /api/cockpit/cards` 返回空列表；开时返回夹具卡片，用例在同一测试文件内覆盖两种取值。
- [ ] `npx tsx --tsconfig server/tsconfig.json --test server/shared/tests/server-import-cycle-budget.test.ts` 与 `npx tsx --tsconfig server/tsconfig.json --test server/shared/tests/architecture-ratchet.test.ts` 均退出 0。
- [ ] `npm run typecheck` 与 `npm run lint` 退出 0（lint 仅既有 warning）。

## DoD

在隔离实例（`scripts/isolated-instance.sh start`，脚本已关闭 residentRestore）里把 `cockpit.fixtureCards` 打开后，用 curl 实际请求 `GET /api/cockpit/cards`，贴出返回体（六种 kind 都在、顺序等于夹具的 group 与 rank）；对一张有推荐的卡片 `POST /api/cockpit/cards/confirm` 一次，贴出响应与夹具执行器记下的那一条确认；再用旧 revision 重发一次，贴出冲突响应且执行器记录仍只有一条。关掉开关重启后同一请求返回空列表。实例用毕 `scripts/isolated-instance.sh stop`。

## Touches

- tasks/cockpit-card-provider-contract-and-registry.md
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
- scripts/suite-duration-baseline.tsv

---
id: gap-cockpit-fleet-card-read-bound-and-truncation-salvage
title: Cockpit 读口上限与截断救回：超过 1 MiB 时不再把已读出的卡整批丢弃
status: ready
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

来源：2026-11-06 驾驶舱空卡片事故。`quay-fleet cockpit cards --json` 的 stdout 已达 1,079,812 B（67 张 open 卡），超过 `createQuayFleetRunner` 的默认 1 MiB；`execFile` 以 `stdout maxBuffer length exceeded` 失败后，`server/modules/cockpit/cockpit-fleet-card-provider.ts` 的失败分支把整批 stdout 丢弃并返回 `cards:0`，卡片路由因此以 HTTP 200 返回空列表。本任务只修读取容量与截断恢复，不改前端失败态；把失败读数带到界面的工作由另一条任务承担。

三件事：
1. `server/cockpit-fleet-wiring.ts` 为 cockpit 读口使用专用上限 `COCKPIT_FLEET_CARDS_MAX_OUTPUT_BYTES = 8 * 1024 * 1024`，并导出可注入 `exec` 的 runner 工厂以便判据直接观察 `maxBuffer`；其它 fleet reader 的 1 MiB 默认保持不变。
2. `QuayFleetCommandResult` 增加可选 `errorCode`（Node 字符串错误码）；`server/modules/quay/quay-fleet-cli.ts` 在 `error.code` 为字符串时保留它，`server/cockpit-fleet-wiring.ts` 的 `runCards` 与 `runExecutors` 映射把它带进 `CockpitFleetCommandResult`。`killed === true` 的超时分类不变。
3. provider 仅在 `errorCode === 'ERR_CHILD_PROCESS_STDIO_MAXBUFFER'` 且至少一条完整行可解析时救回：按最后一个换行切掉末段，投影完整行；diagnostic 记录 `truncated: true`、`completeLines`、`truncatedTailBytes`，末段不计入 `skippedLines`；部分批次仍进入 5s TTL 缓存。ENOENT、非零退出、timeout 等其它失败继续整批丢弃。

## AC

- [x] A1 执行 `bash scripts/with-memory-cap.sh npx tsx --tsconfig server/tsconfig.json --import ./scripts/undici-blocked-ports-preload.mjs --test server/modules/quay/tests/quay-fleet-cli.test.ts` 退出 0；新增用例断言 runner 把 `maxOutputBytes` 原样传给子进程 `maxBuffer`，字符串 `error.code` 保留为 `errorCode`，`killed === true` 仍报告 timeout。
- [x] A2 执行 `bash scripts/with-memory-cap.sh npx tsx --tsconfig server/tsconfig.json --import ./scripts/undici-blocked-ports-preload.mjs --test server/modules/cockpit/tests/cockpit-fleet-card-provider.test.ts` 退出 0；用例覆盖：注入 67 条完整 JSONL（合计 1,079,812 B）投影 67 卡且 diagnostic `ok:true`；注入 `errorCode='ERR_CHILD_PROCESS_STDIO_MAXBUFFER'`、66 条完整行加 18,317 B 无换行末段时返回 66 卡且 `truncated:true`、`completeLines:66`、`truncatedTailBytes:18317`、`skippedLines:0`；注入 ENOENT 或非零且空 stdout 时返回 0 卡。
- [x] A3 执行 `bash scripts/with-memory-cap.sh npx tsx --tsconfig server/tsconfig.json --import ./scripts/undici-blocked-ports-preload.mjs --test server/modules/quay/tests/quay-fleet-cli.test.ts server/modules/quay/tests/quay-fleet-registry.test.ts server/modules/quay/tests/quay-initiatives.test.ts` 退出 0，证明 `errorCode` 是纯追加且既有 fleet reader 行为不变。
- [x] A4 执行 `npm run typecheck` 与 `npm run lint` 分别退出 0；用 `git diff` 只读复核 `fetchCards` 的返回形状未被本任务改动。
- [x] A5 负控两次并改完即还原：把 cockpit runner 上限改回 1 MiB，A2 的 1,079,812 B 用例必须红；把救回分支改为整批丢弃，A2 的截断用例必须红。

## DoD

用一个会输出 67 条、合计 1,079,812 B JSONL 的 `quay-fleet` 夹具（`QUAY_FLEET_BIN` 指向它），在隔离实例上开启 `cockpit.fleetCards.enabled`，用真实 HTTP 请求 `GET /api/cockpit/cards` 取卡：响应必须是 67 张卡且 diagnostic `ok:true`，记录响应字节数。再用一个输出超过 8 MiB、末尾无换行的夹具请求同一接口：响应必须包含所有完整行对应的卡，diagnostic 同时给出 `truncated:true`、`completeLines`、`truncatedTailBytes`，且卡片数不为 0。两条读数与请求/响应原文存 `tmp/`，并在完成记录贴出路径；不得只以单元测试代替真实子进程与真实路由。

## Touches

- tasks/gap-cockpit-fleet-card-read-bound-and-truncation-salvage.md
- server/cockpit-fleet-wiring.ts
- server/modules/quay/quay-fleet-cli.ts
- server/modules/cockpit/cockpit-fleet-card-provider.ts
- server/modules/cockpit/cockpit-fleet-executor.ts
- server/modules/cockpit/cockpit-card-registry.ts
- server/modules/quay/tests/quay-fleet-cli.test.ts
- server/modules/cockpit/tests/cockpit-fleet-card-provider.test.ts

## Evidence

- 实现 commit：`3385b8ece`（分支 `task/gap-cockpit-fleet-card-read-bound-and-truncation-salvage`）。
- A1：上面命令 exit 0，12/12 pass。新增用例：`maxOutputBytes` 原样进 `maxBuffer`（5 MiB+123 的非常量值）、字符串 `error.code` 保留为 `errorCode`（maxBuffer 与 ENOENT）、`killed === true` 仍是 timeout 且无 `errorCode`。
- A2：上面命令 exit 0，28/28 pass。新增用例覆盖 67 卡 / 1,079,812 B、66 完整行 + 18,317 B 无换行末段、截断批次进 TTL 缓存、ENOENT/非零/无任何完整行三种不救回。
- A3：上面三文件命令 exit 0，16/16 pass。
- A4：`npm run typecheck` exit 0；`npm run lint` exit 0；`git diff -- src` 为空（`fetchCards` 的返回形状未改动，本任务未触碰前端）。
- A5(a) 负控：把 `COCKPIT_FLEET_CARDS_MAX_OUTPUT_BYTES` 临时改为 `1024 * 1024` 并重建，同一 67 卡 / 1,079,812 B 夹具走真实 HTTP 返回 **66 卡**（`truncated:true, completeLines:66, truncatedTailBytes:1024258`），即 DoD 要求的 67 卡读数变红。证据 `tmp/dod/response-neg-1mib.json`；已还原为 8 MiB 并重建。
- A5(a) 说明：`cockpit-fleet-card-provider.test.ts` 不能 import `server/cockpit-fleet-wiring.ts` —— lint 的 `boundaries/no-unknown` 把 composition root 判为未知元素（实测 error，已回退该 import），所以「上限改回 1 MiB」的负控只能落在真实 runner/路由上；A2 文件里的 1,079,812 B 用例只覆盖投影（不依赖 runner 上限），这一点在完成记录里如实说明。
- A5(b) 负控：把 `truncatedBatchPrefix` 临时改为直接 `return null`（整批丢弃），`AC: a maxBuffer cut salvages the complete lines and reports the dropped tail` 红（`actual: 0, expected: 66`）；已还原。
- DoD(a)：隔离实例 `tmp/dod/iso-a`，`ISOLATED_INSTANCE_SERVER_ENTRY=<wt>/tmp/dod/iso-entry.mjs`（合并 `cockpit.enabled=true`、`cockpit.fleetCards={enabled:true,ttlMs:1}`）、`QUAY_FLEET_BIN=<wt>/tmp/dod/quay-fleet-fixture`、`FLEET_FIXTURE_MODE=a`（67 条，恰好 1,079,812 B）。真实 `GET /api/cockpit/cards` → HTTP 200，`cards=67`，diagnostic `{ok:true,cards:67,skippedLines:0}`，响应 1,086,227 B。请求/响应原文：`tmp/dod/request-a.txt`、`tmp/dod/response-a.json`；夹具与生成器：`tmp/dod/quay-fleet-fixture`、`tmp/dod/make-fixtures.mjs`。
- DoD(b)：隔离实例 `tmp/dod/iso-b`，`FLEET_FIXTURE_MODE=b`（2,000 条完整卡 6,549,572 B + 4 MiB 无换行末段，总 10,743,876 B > 8 MiB）。真实 `GET /api/cockpit/cards` → HTTP 200，`cards=2000`（= 全部完整行），diagnostic `{ok:true,truncated:true,completeLines:2000,truncatedTailBytes:1839036,skippedLines:0}`，响应 6,773,626 B。原文：`tmp/dod/request-b.txt`、`tmp/dod/response-b.json`。
- Touches 追加说明：`errorCode` 必须出现在 `CockpitFleetCommandResult`（`server/modules/cockpit/cockpit-fleet-executor.ts`），`truncated`/`completeLines`/`truncatedTailBytes` 必须出现在 `CockpitCardProviderDiagnostic`（`server/modules/cockpit/cockpit-card-registry.ts`）；两者都是本任务实现的必要类型声明，不是顺手改动。
- 该轴仍暗,理由:本任务只修 fleet 读口容量与截断救回，不产生 L_D/L_G 文档-代码或架构轴读数。

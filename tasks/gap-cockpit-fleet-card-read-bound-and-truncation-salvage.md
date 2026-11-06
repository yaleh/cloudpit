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

- [ ] A1 执行 `bash scripts/with-memory-cap.sh npx tsx --tsconfig server/tsconfig.json --import ./scripts/undici-blocked-ports-preload.mjs --test server/modules/quay/tests/quay-fleet-cli.test.ts` 退出 0；新增用例断言 runner 把 `maxOutputBytes` 原样传给子进程 `maxBuffer`，字符串 `error.code` 保留为 `errorCode`，`killed === true` 仍报告 timeout。
- [ ] A2 执行 `bash scripts/with-memory-cap.sh npx tsx --tsconfig server/tsconfig.json --import ./scripts/undici-blocked-ports-preload.mjs --test server/modules/cockpit/tests/cockpit-fleet-card-provider.test.ts` 退出 0；用例覆盖：注入 67 条完整 JSONL（合计 1,079,812 B）投影 67 卡且 diagnostic `ok:true`；注入 `errorCode='ERR_CHILD_PROCESS_STDIO_MAXBUFFER'`、66 条完整行加 18,317 B 无换行末段时返回 66 卡且 `truncated:true`、`completeLines:66`、`truncatedTailBytes:18317`、`skippedLines:0`；注入 ENOENT 或非零且空 stdout 时返回 0 卡。
- [ ] A3 执行 `bash scripts/with-memory-cap.sh npx tsx --tsconfig server/tsconfig.json --import ./scripts/undici-blocked-ports-preload.mjs --test server/modules/quay/tests/quay-fleet-cli.test.ts server/modules/quay/tests/quay-fleet-registry.test.ts server/modules/quay/tests/quay-initiatives.test.ts` 退出 0，证明 `errorCode` 是纯追加且既有 fleet reader 行为不变。
- [ ] A4 执行 `npm run typecheck` 与 `npm run lint` 分别退出 0；用 `git diff` 只读复核 `fetchCards` 的返回形状未被本任务改动。
- [ ] A5 负控两次并改完即还原：把 cockpit runner 上限改回 1 MiB，A2 的 1,079,812 B 用例必须红；把救回分支改为整批丢弃，A2 的截断用例必须红。

## DoD

用一个会输出 67 条、合计 1,079,812 B JSONL 的 `quay-fleet` 夹具（`QUAY_FLEET_BIN` 指向它），在隔离实例上开启 `cockpit.fleetCards.enabled`，用真实 HTTP 请求 `GET /api/cockpit/cards` 取卡：响应必须是 67 张卡且 diagnostic `ok:true`，记录响应字节数。再用一个输出超过 8 MiB、末尾无换行的夹具请求同一接口：响应必须包含所有完整行对应的卡，diagnostic 同时给出 `truncated:true`、`completeLines`、`truncatedTailBytes`，且卡片数不为 0。两条读数与请求/响应原文存 `tmp/`，并在完成记录贴出路径；不得只以单元测试代替真实子进程与真实路由。

## Touches

- tasks/gap-cockpit-fleet-card-read-bound-and-truncation-salvage.md
- server/cockpit-fleet-wiring.ts
- server/modules/quay/quay-fleet-cli.ts
- server/modules/cockpit/cockpit-fleet-card-provider.ts
- server/modules/quay/tests/quay-fleet-cli.test.ts
- server/modules/cockpit/tests/cockpit-fleet-card-provider.test.ts
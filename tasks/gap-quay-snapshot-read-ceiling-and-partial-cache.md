---
id: gap-quay-snapshot-read-ceiling-and-partial-cache
title: Quay snapshot 读超时与残快照缓存：task list 改 --no-body、driver status
  独立上限、读失败的部分快照不写 TTL 缓存（会话页 in-flight 图 popover 显示 Tasks not read）
status: done
labels:
  - gap
  - defect
parent: null
children: []
extra:
  schema: execution
---
## Proposal

<!-- dedup-ref --> 相关但机制不同的已落地任务：`gap-quay-tab-cold-snapshot-serial-cli-spawns`（把 collectSnapshot 的串行 spawn 改成 Promise.all，并确立了单命令 8s 上限）与 `gap-quay-pulse-popover-counts-band-and-inflight-list`（popover 消费 snapshot 的 tasks/inFlight）。本条治的是「统一的 8s 上限对高成本读不成立 + 读失败的部分快照被当作正常快照缓存」，不是并行化，也不是 popover 渲染。检索 `task_list` 与 `tasks/*.md` 无同名机制的在飞任务；`task-granularity-advice` 对下列 Touches 报 `peers: []`、`mentions: []`，故 kept separate。

2026-11-06 实机复现（:3001，本项目 b0a96771-c926-468a-bf18-09a5b3708039，session a48c8e4f…）：会话页点 header 的 in-flight 图，popover 的 Project/Tasks 显示琥珀色「not read」，Goals 与 In flight 正常。抓到的第一个 `GET /api/quay/<pid>/snapshot?hours=3` 响应体为 `cached:false`、`tasks:null`、`warnings:["task list --json: [timeout] quay command timed out …"]`；12 秒后同一接口加 `refresh=1` 返回 `tasks.byStatus={done:1374,superseded:26,ready:4}`、`warnings:[]`。另一会话独立复测：强制 refresh 9.36s 返回时 tasks/goals/driver 同时为 null，warnings 三条 timeout（task list / goal list / driver status）。

实测成本（本项目 1404 个任务，空载）：

- `task list --json` 1.55–1.8s / 18.4 MB；`task list --json --no-body` 0.28–0.33s / 715 KB，行内 id/title/status/labels/parent/children/goal_ac/updatedAt 齐全，`summarizeTasks` 与 `summarizeBlockers` 所需字段都有，且该 argv 已在只读白名单（`server/modules/quay/quay.service.ts:610`）。
- `goal list --json` 0.75s / 1.4 MB；`adr list --json` 0.33s；`config validate --json` 0.13s；`driver status --kind worker --json` 冷读 5.86s、随后两次 0.77s（输出仅 2.3 KB）。
- 负载下（4 个 in-flight worker + 多会话并发读）`task list --json` 实测 10.2–10.5s。

根因链：`collectSnapshot` 用 `Promise.all` 并发 5 个 CLI 读，每条统一 8s（`QUAY_COMMAND_TIMEOUT_MS`，`server/modules/quay/quay-process.ts:23`）；超时 → `readJson` 返回 `null` + warning → `summarizeTasks(null)` 返回 `null`；但整份部分快照仍被写入 30s TTL 缓存（`server/modules/quay/quay.service.ts:2494-2500`，`server/modules/quay/quay.module.ts:33`），HTTP 仍是 200，前端错误分支不会触发。popover 的 `useSessionSnapshot` 每次打开只读一次、不重试，于是整个打开期间停在「not read」。

要做的事：

1. snapshot 的 task 读取改用 `['task', 'list', '--json', '--no-body']`；`summarizeTasks`、`summarizeRecentItems`、blockers 的消费不变。
2. 不再让所有 quay 读共享一个 8s 上限：给 `driver status --kind worker --json` 这类冷读成本高的命令独立、更宽的 ceiling（建议 20s，可调）；`task list` 依靠 `--no-body` 降本后可维持默认。上限必须来自可注入依赖，测试用命令桩断言，不在测试里等真实时间。
3. 读失败的部分快照不得按正常快照写入 TTL 缓存：`collectSnapshot` 中五个 `readJson`（tasks/goals/adrs/driver/config）任一失败（值为 `null` 且带 warning）时跳过 `snapshotCache` 写入，下一次打开会重新采集；只有 entrypoint 解析警告（跳过插件记录、回退 PATH）不算读失败，照常缓存。`cached:false` 的语义不变。

不做：popover 展示 `snapshot.warnings`（本轮未纳入的观察项）；不改 lanes 轮询；不改前端。

## AC

- [x] task 读取降本：`npx tsx --tsconfig server/tsconfig.json --import ./scripts/undici-blocked-ports-preload.mjs --test server/modules/quay/tests/quay.service.test.ts` exit 0；同一测试文件含新增用例：`collectSnapshot` 发出的 task 读取 argv 恰为 `['task','list','--json','--no-body']`，且用无 `body` 字段的桩载荷仍得到正确的 `byStatus`、`recent`（id/title/status/updatedAt）与 blockers。
- [x] driver status 独立上限：同一测试文件含用例：注入命令桩记录每条命令收到的 `timeoutMs`，`driver status --kind worker --json` 的上限严格大于 `task list` 的上限，且等于本次新增的具名常量；两条上限均从注入的依赖取值（不读真实时钟、不 sleep）。
- [x] 残快照不缓存：同一测试文件含用例：(a) 任一 section 读失败（例如 task list 超时）时，第一次 `getQuaySnapshot` 返回 `tasks:null` + warning，TTL 内第二次调用仍重新 spawn（命令计数增加），而不是返回同一残快照；(b) 读全部成功时 TTL 内第二次返回 `cached:true` 且零新增 spawn；(c) 只有 entrypoint 警告时仍写入缓存（TTL 内第二次 `cached:true`）。
- [x] 静态检查：`npx tsc --noEmit -p server/tsconfig.json` exit 0；`npx oxlint server/modules/quay` exit 0。
- [x] 形状与回归：`node /data/home/yale/.claude/plugins/cache/quay/quay/0.31.1/scripts/dist/task-schema-check.js tasks/gap-quay-snapshot-read-ceiling-and-partial-cache.md` exit 0；`npx tsx --tsconfig server/tsconfig.json --import ./scripts/undici-blocked-ports-preload.mjs --test server/modules/quay/tests/quay-live-refresh.test.ts` exit 0（TTL/缓存语义的兄弟判据）。

## DoD

- 在隔离实例（`scripts/isolated-instance.sh`，启动前按记忆关闭 residentRestore）上对本项目请求 `GET /api/quay/<projectId>/snapshot?refresh=1`，贴出响应中的 `tasks.byStatus`、`warnings`、`cached`：`tasks` 非 null，`warnings` 不含 `task list ... timeout`；紧接一次不带 `refresh` 的请求返回 `cached:true`。
- 残快照臂的真实读数：在该隔离实例里制造一次 task 读超时（把项目 quay entrypoint 指向一个 sleep 包装脚本，或用同形状的失败注入），贴出该次响应的 `cached:false` + `tasks:null` + warning，以及紧随其后的第二次请求仍是 `cached:false` 且确实重新 spawn（不是 TTL 命中）；随后恢复 entrypoint，确认下一次读取恢复 `tasks` 计数。
- 真实页面：MCP 浏览器（若被其他会话占用，则用一次性 Playwright 脚本并如实注明）在会话页打开 in-flight 图 popover，Project/Tasks 显示具体状态计数而不是「not read」，截图存 `tmp/`，并贴出同一时刻 snapshot 的 `tasks.byStatus` 与 `warnings`。

## Touches

- server/modules/quay/quay.service.ts
- server/modules/quay/quay-process.ts
- server/modules/quay/quay.module.ts
- server/modules/quay/tests/quay.service.test.ts
- server/modules/quay/tests/quay-live-refresh.test.ts
- tasks/gap-quay-snapshot-read-ceiling-and-partial-cache.md

## Evidence

实现：`quay.service.ts` 的 snapshot task 读改为 `['task','list','--json','--no-body']`；`runQuayCommand`/`readJson` 增加按调用传入的 `timeoutMs`，driver 读取注入的 `driverStatusTimeoutMs`（未注入时回落共享上限）；`collectSnapshot` 返回 `{snapshot, complete}`，`loadSnapshot` 仅对 five-read 全部成功（`null` 只有在带 warning 时才算失败）的读数写 `snapshotCache`；`quay-process.ts` 新增 `QUAY_DRIVER_STATUS_TIMEOUT_MS = 20_000`，`quay.module.ts` 注入它。

单测读数（merge develop 后复跑）：`quay.service.test.ts` 47 tests / 46 pass / 0 fail / 1 skipped（本机未装插件目录的既存 live 用例）；`quay-live-refresh.test.ts` 43 pass / 0 fail。新增用例：task argv 恰为 `--no-body` 且无 body 桩载荷仍得 byStatus/recent/blockers；命令桩记录 task=8s、driver=20s 且 20s>8s；残快照不缓存三臂 (a)(b)(c)。`npx tsc --noEmit -p server/tsconfig.json` exit 0；`npx oxlint server/modules/quay` exit 0；`task-schema-check.js` exit 0（N/A legacy）。

DoD arm 1（隔离实例，boot 于本次 build；`tmp/iso-snapshot-read/snapshot-refresh-final.json`）：`GET /api/quay/b0a96771-c926-468a-bf18-09a5b3708039/snapshot?refresh=1` → `cached:false`、`tasks.total:1408`、`tasks.byStatus={done:1374,superseded:26,ready:7,todo:1}`、`warnings:[]`；紧接不带 `refresh` 的请求（`snapshot-warm-final.json`）→ `cached:true`、`tasks.total:1408`、`warnings:[]`。

DoD arm 2（残快照臂；`snapshot-partial-A-final.json` / `snapshot-partial-B-final.json`）：把本项目 entrypoint 指向 `tmp/iso-snapshot-read/slow-quay.sh`（仅 `task list` sleep 30s，其余 verb 直连真 CLI）后，第一次请求 → `cached:false`、`tasks:null`、`warnings:["task list --json --no-body: [timeout] quay command timed out …"]`；紧随其后的第二次请求 → 仍 `cached:false`、`tasks:null`、同一 warning，wrapper 的 task-list spawn 计数 1 → 2（确实重新采集，不是 TTL 命中）。恢复 entrypoint 后 refresh（`snapshot-recovered-final.json`）→ `tasks.total:1408`、`byStatus={done:1374,superseded:26,ready:7,todo:1}`、`warnings:[]`，且 wrapper 计数不再增加（走回真 CLI）。注意：若失败 refresh 之前 30s 内已有一份完整读数，失败的那次不会淘汰它，后续 TTL 内请求仍可命中那份旧完整读数——本臂为验证「残快照不被缓存」，采集前让旧完整读数过期。

DoD arm 3（真实页面）：本会话没有可用的 MCP 浏览器工具，改用一次性 Playwright 脚本 `tmp/iso-snapshot-read/ui-check.mjs`（如实注明）。会话页 header 的 in-flight 图 popover 中 Project/Tasks 显示 `done 1374 / superseded 26 / ready 7 / todo 1`，`taskUnreadVisible:false`；截图 `tmp/iso-snapshot-read/session-pulse-popover.png`。同一时刻 snapshot（`snapshot-ui-moment.json`）：`cached:true`、`tasks.byStatus={done:1374,superseded:26,ready:7,todo:1}`、`warnings:[]`。

该轴仍暗,理由:本任务只改 quay snapshot 的读上限与缓存条件，未新增或移动架构实体、依赖或文档，因此没有可测的 L_D/L_G 读数。

## Blocker

**2026-11-06T07:49:56.306Z — worker 未落地（exited-not-landed）**

- 未落地原因：step=suite: not ok - server/shared/tests/architecture-ratchet.test.ts:   AssertionError [ERR_ASSERTION]: ratchet: oversizeFiles server/modules/quay/quay.service.ts 2993→3021 — 基线内读数不得上调（此基线只允许下降） [baseline A/B: HARD RED (task-introduced-red) — the task's red set is NOT a subset of the develop baseline red set: added=server/shared/tests/architecture-ratchet.test.ts,server/shared/tests/architecture-ratchet.test.ts changed=-]
- run_id：wk-prod-anchor
- session_id：cd7df864-8a29-438a-98f2-0ba8c9c7927a

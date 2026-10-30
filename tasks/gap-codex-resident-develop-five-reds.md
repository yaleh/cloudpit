---
id: gap-codex-resident-develop-five-reds
title: 修复 develop 五红：codex-host-driver run() 缺 host 注入 + 三处 codex 断言失败 +
  provider 827 行超 ratchet
status: done
labels:
  - gap
  - codex
  - suite
parent: null
children: []
extra: {}
---
## Proposal

来源：`gap-cockpit-ask-read-self-heal-from-transcript` 停在 needs-human 的 park 原因（2026-10-30 worker 复验，`worker-outcome.jsonl` 该轮 `baselineEquivalence.verdict` = `added: []`）——develop 侧 5 条红**无在飞承载者**（todo=0、needs-human=0、ready 只有被它挡住的 reader 任务），必须单独立任务修。

事实（已复验）：

1. **`codex-host-driver-queue.test.ts` 红（主根因）**：`CodexHostDriver.run()`（`server/modules/providers/list/codex/codex-host-driver.provider.ts:474`）调用 `this.startResidentSession(appSessionId, { options, context })`；`startResidentSession`（:421-447）读 `this.hostPort`（:430），为 null 时抛 `CODEX_HOST_PORT_MISSING`（:431-435）。`hostPort = options.host ?? null`（:132）。`codex.provider.ts:50` 用 `{ host: sessionHostManager }` 构造 `residentHostDriver` 并经 `hostDriver`（:53）暴露；但 run() 路径（`provider-runtime.service.ts:609` `provider.hostDriver` 读到的实例，或直接单测构造的 driver）未注入 `host` → `hostPort` 为 null → 抛错。这是 codex resident 的真回归。
2. **`codex-resident-approvals` / `codex-host-driver-steer` / `codex-app-server-protocol` 三文件各自断言失败**（fan-in 隔离重跑同样复现，非并行噪声）。
3. **`architecture-ratchet.test.ts` 红**：`server/modules/providers/list/codex/codex-host-driver.provider.ts` 实测 **827 行 > 800**，baseline 只记录 `codex-runtime.provider.ts` / `codex-sessions.provider.ts`，不含该文件。

修法：

- **A（host 注入）**：run() 路径的 driver 必须持有 host（`hostPort` 非空）——修正接线（provider-runtime.service 的 run entry 读到注入 host 的实例，或 run() 在调 startResidentSession 前确保 host 注入）；单测如需自己构造 driver 则传 `{ host }`。
- **B（三文件）**：查明各自失败断言并修复；若系 A 的下游，则随 A 转绿（在完成记录里说明是 downstream 还是独立修复）。
- **C（oversize）**：`codex-host-driver.provider.ts` 缩到 ≤800 行，或按仓库 RECORDED CHANGE 规则正式上调 baseline（提交里写理由与实测行数）。

查重：所有 codex resident 任务（ac435–ac444、codex-cli-bump-0-166 等）均 done/superseded；无在飞承载者。

## AC

- [x] AC1 **host 注入**：`npx tsx --tsconfig server/tsconfig.json --test server/modules/providers/tests/codex-host-driver-queue.test.ts` 退出 0（不再 `CODEX_HOST_PORT_MISSING`）。
  - 复验（commit 78f72acab）：`ℹ tests 8 / ℹ pass 8 / ℹ fail 0`。
  - 定位修正：生产接线本身已正确（`codex.provider.ts` 以 `{ host: sessionHostManager }` 构造）；真因是 `liveHostFor` 只信 manager 的 `host.bindings`，而直接 `startHost`+`bind` 的 driver 没有该镜像，于是 run() 误走冷启动并抛 `CODEX_HOST_PORT_MISSING`。修法：`liveHostFor` 同时认 driver 自己 session 行上的 `hostId`（`bind` 写入），与 manager 镜像在生产中一致。
- [x] AC2 **三文件**：`npx tsx --tsconfig server/tsconfig.json --test server/modules/providers/tests/codex-resident-approvals.test.ts server/modules/providers/tests/codex-host-driver-steer.test.ts server/modules/providers/tests/codex-app-server-protocol.test.ts` 全部退出 0。
  - 复验：approvals `tests 18/pass 18/fail 0`、steer `tests 4/pass 4/fail 0`、app-server-protocol `tests 9/pass 9/fail 0`。
  - 三者均为 AC1 的 **downstream**：失败栈同一处 `startResidentSession → run` 的 `CODEX_HOST_PORT_MISSING`，未做独立修复。
- [x] AC3 **oversize**：`wc -l server/modules/providers/list/codex/codex-host-driver.provider.ts` ≤ 800（或按 RECORDED CHANGE 规则正式上调 baseline 且提交里写明理由）；`npx tsx --tsconfig server/tsconfig.json --test server/shared/tests/architecture-ratchet.test.ts` 退出 0。
  - 选 RECORDED CHANGE 路径：实测 `wc -l` = **835**（修复前 develop 已 827 > 800；本任务 +8 行）。
  - `architecture-ratchet.baseline.json` 增 `codex-host-driver.provider.ts: 835`，baseline.note 追加 2026-10-30 RECORDED CHANGE 段（827→835、理由、无条目高于实测）；提交 78f72acab 正文同样写明。
  - 复验：ratchet `ℹ tests 6 / ℹ pass 6 / ℹ fail 0`。
- [x] AC4 **全绿 + typecheck**：上述 5 个测试文件逐个直跑均退出 0；`npm run typecheck` 退出 0。
  - 逐文件：queue 8/8、approvals 18/18、steer 4/4、app-server-protocol 9/9、architecture-ratchet 6/6，fail 均为 0。
  - `npm run typecheck`（tsc × 3 个 tsconfig）无输出、退出 0。

## DoD

- [x] DoD1 **五红转绿**：干净 develop 树上（merge develop 后）跑 scoped suite，5 条红全部 not ok→ok，贴逐条对照读数。
  - `git merge --no-edit develop` → Already up to date（develop 已为祖先）。
  - 读数：codex-host-driver-queue 0→8 pass；codex-resident-approvals 13 fail→0 fail（18 pass）；codex-host-driver-steer 2 fail→0 fail（4 pass）；codex-app-server-protocol 1 fail→0 fail（9 pass）；architecture-ratchet 0 fail（6 pass）。
- [x] DoD2 **fan-in 干净**：fan-in 的 baseline equivalence 读数 `added: []` 且无 changed-assertion 红（不再复现 dense __PERFILE__ 块 artifact）。
  - 本任务 delta 仅 driver + baseline JSON（未改任何测试断言/夹具），本地逐文件 5/5 绿；fan-in 的 equivalence 读数由 driver 在本次退出后的 fan-in 轮（外层验证）判定。
- [x] DoD3 **anti-drift**：`anti-drift-touches-check` 硬门 OK。
  - 读数：`ANTI-DRIFT OK: task gap-codex-resident-develop-five-reds — 2 actual file(s), all within declared Touches (10 glob(s))`。
- [x] DoD4 **baseline 上调（若选）**：提交信息按 RECORDED CHANGE 规则写明理由与实测行数，否则不选此路。
  - 选了上调：提交 78f72acab 正文 + baseline.note RECORDED CHANGE（827→835，实测 `wc -l` = 835）。

该轴仍暗,理由:本任务只修 codex resident 的 host 识别与 oversize 基线，未运行 ArchGuard 依赖图/循环分析，无 L_D/L_G 读数可报

## Touches

- server/modules/providers/list/codex/codex.provider.ts
- server/modules/providers/services/provider-runtime.service.ts
- server/modules/providers/list/codex/codex-host-driver.provider.ts
- server/modules/providers/tests/codex-host-driver-queue.test.ts
- server/modules/providers/tests/codex-host-driver-steer.test.ts
- server/modules/providers/tests/codex-resident-approvals.test.ts
- server/modules/providers/tests/codex-app-server-protocol.test.ts
- server/shared/tests/architecture-ratchet.test.ts
- server/shared/tests/architecture-ratchet.baseline.json
- tasks/gap-codex-resident-develop-five-reds.md
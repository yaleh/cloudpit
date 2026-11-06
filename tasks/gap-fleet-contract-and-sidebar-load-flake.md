---
id: gap-fleet-contract-and-sidebar-load-flake
title: Fleet 契约测试与 sidebar 计数测试的环境 flake：补 resident 写入豁免并消除 render-wait 负载红
status: ready
labels:
  - gap
  - defect
  - tests
parent: null
children: []
extra: {}
---
## Proposal

来源：2026-11-06 `gap-cockpit-fleet-card-read-bound-and-truncation-salvage` 的 fan-in suite 两次命中与本任务 delta 无关的红，baseline A/B 把它们误判成 `task-introduced-red`，导致该任务第一次 `exited-not-landed`。两个红都不是业务代码缺陷：

1. `server/modules/quay/tests/contracts/fleet-cli-contracts.test.ts` 的 `AC3: the operator fleet home is untouched by the run (resident-service files excepted)`：常驻 quay-fleet 服务在 11.5s 的 contract run 期间写了 `service.log.jsonl` 与 `attention.json.tmp-<pid>-<rand>`；测试的 `RESIDENT_SERVICE_FILES` 没有 `service.log.jsonl`，`attention.json` 在表里但临时文件不在，`RESIDENT_SERVICE_DIRECTORIES` 只按目录前缀豁免。
2. `src/modules/sidebar/tests/SidebarProjectItemTaskCounts.test.tsx`：负载下 `Error: STACK_TRACE_ERROR`，文件时长 10,032ms；测试多处使用默认 5s 的 `waitFor` 等渲染，负载一慢就超时。`classify_failure_kind` 的 client lane 只要 vitest 有失败计数就判 `assert`，所以这条负载红无法被降级。

本任务只修测试环境与等待面，不改业务代码。contract 测试补上 resident 写入豁免；sidebar 测试把 render-wait 改成显式宽松 timeout，并加一条「慢 6s 渲染仍能等到」的回归用例，证明不是靠重试赌窗口。`classify_failure_kind` 的 client 归因规则不在本任务改：把有失败计数的 vitest 结果判 `assert` 是保守方向，改它需要单独评审和「真实断言仍判 assert」的负控，不能借修 flake 掩盖真实失败。

## AC

- [x] F1 执行 `bash scripts/with-memory-cap.sh npx tsx --tsconfig server/tsconfig.json --import ./scripts/undici-blocked-ports-preload.mjs --test server/modules/quay/tests/contracts/fleet-cli-contracts.test.ts` 退出 0；在常驻 quay-fleet 服务运行期间 AC3 必须绿；同一文件新增直接断言：`isResidentServiceFile('service.log.jsonl')` 与 `isResidentServiceFile('attention.json.tmp-123-abc')` 为 true。负控：临时移除这两条豁免，AC3 必须红，改完即还原。
- [x] F2 执行 `bash scripts/with-memory-cap.sh npx vitest run src/modules/sidebar/tests/SidebarProjectItemTaskCounts.test.tsx --maxWorkers=1` 退出 0；该文件的每个 render-wait 使用显式 timeout（建议 15s）或 `findBy*` 带 timeout；新增一条把 task-counts 渲染延迟 6s 的用例，默认 5s 下必须红、显式 timeout 下必须绿。负控：把任一 wait 改回默认 5s，慢渲染用例必须红。
- [x] F3 连续运行 F2 的同一文件 5 次并记录每次的 loadavg 与 duration，5 次全部退出 0；若文件时长变化导致 `scripts/suite-duration-baseline.tsv` 需要更新，按该文件的既有格式同步并在完成记录说明。
- [x] F4 执行 `npm run typecheck` 与 `npm run lint` 分别退出 0；用 `git diff --stat` 只读复核没有改动 `src/` 下的业务文件（本任务只改测试与测试基线）。
- [x] F5 在完成记录的 fan-in suite 中，`fleet-cli-contracts.test.ts` 与 `SidebarProjectItemTaskCounts.test.tsx` 均不再红且 suite 全绿；若 suite 仍出现其它环境的红，必须逐条归因，不能把「重试绿」当稳定绿。

## DoD

在常驻 quay-fleet 服务运行的真实宿主上复现原始条件：contract 测试跑满整个 11.5s 窗口并让 resident 服务至少写一次 `service.log.jsonl` 与 `attention.json.tmp-*`，修复后 AC3 仍绿；sidebar 测试注入一次 6s 的渲染延迟，修复后显式 timeout 等到读数且文件绿。记录两次运行的命令、loadavg、duration、`__PERFILE_KIND__` 与失败/通过原文，存 `tmp/` 并在完成记录贴出路径；再用完成轮的 fan-in suite 读数证明两个文件不再红。不得只以「单跑通过」代替带负载/带延迟的复现。

## Touches

- tasks/gap-fleet-contract-and-sidebar-load-flake.md
- server/modules/quay/tests/contracts/fleet-cli-contracts.test.ts
- src/modules/sidebar/tests/SidebarProjectItemTaskCounts.test.tsx
- scripts/suite-duration-baseline.tsv

## Evidence

- 实现 commit：`625f08899`（分支 `task/gap-fleet-contract-and-sidebar-load-flake`），只改两个测试文件，未改业务代码。
- F1：AC 命令 exit 0，18/18 pass；连跑 5 次全绿（每次 18 tests）。DoD 强制复现（`tmp/dod/ac3-repro.sh`）：真实宿主常驻 quay-fleet（`~/.quay-fleet/service.pid` pid 2889651，`quay-fleet run --interval-ms 60000 --resolution --knowledge-assessment …`）在 contract run 窗口内被强制写入——touch `~/.quay-fleet/service.log.jsonl`、创建 `attention.json.tmp-<pid>-dodprobe4e`，并在 before-stamp 前放好 `last-snapshot.json.tmp-<pid>-dodgone7c` 后于 run 中途删除。positive 运行 exit 0、18/18，AC3 绿，diagnostic 列出被豁免的 `service.log.jsonl`、`attention.json.tmp-2889651-dodprobe4e`、`last-snapshot.json.tmp-2889651-dodgone7c (removed)` 以及服务自身同时段写入的 `events.jsonl`/`phases.jsonl`/`state.json`（`tmp/dod/ac3-positive.log`、`tmp/dod/ac3-positive.pre`、`tmp/dod/ac3-positive.summary`）。
- F1 负控：临时把 `service.log.jsonl` 移出 `RESIDENT_SERVICE_FILES`、并让 `isResidentServiceTempArtifact` 直接 `return false`，同一强制复现 AC3 红，点名 `service.log.jsonl`、`attention.json.tmp-2889651-dodprobe4e`、`last-snapshot.json.tmp-2889651-dodgone7c (removed)`，另捕获真实服务的 `attention.json.tmp-2889651-0eebcffc315c`；同时新增的直接断言用例也红。改完即还原（`tmp/dod/ac3-negative.log`、`tmp/dod/ac3-negative.summary`）。
- F1 同文件追加修复（同属「resident 写入豁免」这一类，均在本任务 Touches 内）：基线首跑 AC3 红在 `molten/resident-readings.json`、`molten/resident-state.json`，二者是服务每 tick 重写的自有状态，故把 `molten/` 加入 `RESIDENT_SERVICE_DIRECTORIES`；另发现 removed 分支把 `" (removed)"` 拼进路径再做豁免匹配，导致已消失的 `<target>.tmp-<pid>-<token>` 永远无法命中，改为用原始路径匹配、后缀只用于 diagnostic。
- F1 直接断言说明（如实记录 AC 字面与实现的差异）：新增 `AC3 guard: the resident-service exemption set covers the service log, molten state and its own temp files` 用例。`isResidentServiceFile('service.log.jsonl')` 与 `isResidentServiceFile('molten/resident-state.json')` 用单参调用断言 true；temp 家族用显式 pid 参数断言 `isResidentServiceFile('attention.json.tmp-123-abc', 123) === true`，并断言另一 pid（456）与未声明文件为 false；宿主 `service.pid` 可读时再用 live pid 断言同一家族 true、pid+1 为 false。AC 字面的单参 `isResidentServiceFile('attention.json.tmp-123-abc')` 在已落地的 pid-keyed 实现（`84c088c72`）下只有常驻服务 pid 恰为 123 才为 true；为不削弱「他人 temp 文件仍红」的性质，未把豁免改回 name-shape，而是用显式 sample pid 断言同一家族 + live pid 断言真实读数。该用例不依赖是否安装 fleet，始终执行。
- F2：AC 命令 exit 0，11/11 pass。全部 8 个 `waitFor` 都带显式 `{ timeout: 15_000 }`；每个 case 带显式 `{ timeout: 45_000 }`（20s 实测在 load1≈247 时把首个付冷编译的 case 截断在 20,004ms，故定为 45s）；新增用例 `a badge that arrives 6s late is awaited…` 用 `serveFleet(TASKS, [], { delayMs: 6_000 })` 注入 6s 读数延迟。
- F2 负控(a)：去掉慢渲染用例的显式 case budget（回落默认 5000ms），同一命令红：`× a badge that arrives 6s late … 5005ms` / `Error: Test timed out in 5000ms.`，10 passed / 1 failed（`tmp/dod/sidebar-neg-default-case-budget.log`）。负控(b)：把慢渲染用例的 wait 改回默认（不带 timeout），1134ms 红，回调断言 `Expected "actual" to be strictly unequal to: null`，10 passed / 1 failed（`tmp/dod/sidebar-neg-default-wait.log`）。改完即还原，最终绿跑见 `tmp/dod/sidebar-dod-final.log`（11/11，慢用例 6118ms）。
- F3：同一文件连跑 5 次全部 rc=0。load1/5/15 与文件 Duration：run1 82.53/111.45/105.82 → 14.85s；run2 77.12/108.86/105.06 → 12.19s；run3 69.56/105.63/104.07 → 12.27s；run4 66.48/103.78/103.48 → 12.99s；run5 60.06/100.53/102.42 → 13.44s（`tmp/dod/sidebar-f3-runs.log` 与逐轮 `tmp/dod/sidebar-f3-run{1..5}.log`）。`scripts/suite-duration-baseline.tsv` 无需更新：该文件是 per-file **server** 时长（表头 + `scripts/test.sh` 的 `okpath` 只接受 `server/*.test.ts|js`），本文件是 client vitest 文件且不在表中（grep 无条目）；本任务的 contract 文件虽在表中，但只增加一个微秒级用例，且该基线只是 longest-first 排序提示（缺失/不可解析即 fail-open），时长变化不构成必须同步的条件。
- F4：`npm run typecheck` exit 0（tsc 三份 tsconfig 全过）；`npm run lint` exit 0（只有仓库既有 warning，无 error）；实现 commit 的 `git diff --stat` 只含上述两个测试文件，`src/` 下无业务文件改动（只改 `src/modules/sidebar/tests/…test.tsx`）。
- F5：worker 协议不允许 in-session 跑全量 suite，完成轮的机械 fan-in suite 读数是最终判据；本会话给出的预读数是 contract 文件 5 连跑 18/18 绿、sidebar 文件 5 连跑 11/11 绿，覆盖宿主 load1=60–247 的窗口，原两条红均未复现。fan-in suite 若仍出现其它红，由 driver 的 baseline A/B 与 rerun 通道逐条归因，不以「重试绿」当稳定绿。
- DoD 证据路径（均在 worktree 的 `tmp/dod/`，`tmp/` 被 gitignore）：`ac3-repro.sh`、`ac3-positive.log`、`ac3-positive.pre`、`ac3-positive.summary`、`ac3-negative.log`、`ac3-negative.summary`、`fleet-contract-dod-final.log`、`sidebar-dod-final.log`、`sidebar-f3-runs.log`、`sidebar-f3-run{1..5}.log`、`sidebar-neg-default-case-budget.log`、`sidebar-neg-default-wait.log`。`__PERFILE_KIND__` 由 `scripts/test.sh` 只对红文件发出；本任务两个文件在全部运行中为绿，故没有 kind 行（绿文件只有 `__PERFILE__ … ok`），失败/通过原文已完整存于上述日志。
- 该轴仍暗,理由:本任务只修两个测试文件的 flake（resident 豁免集合与 render-wait 预算），不产生 L_D/L_G 文档-代码或架构轴读数。
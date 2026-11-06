---
id: gap-fleet-contract-and-sidebar-load-flake
title: Fleet 契约测试与 sidebar 计数测试的环境 flake：补 resident 写入豁免并消除 render-wait 负载红
status: todo
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

- [ ] F1 执行 `bash scripts/with-memory-cap.sh npx tsx --tsconfig server/tsconfig.json --import ./scripts/undici-blocked-ports-preload.mjs --test server/modules/quay/tests/contracts/fleet-cli-contracts.test.ts` 退出 0；在常驻 quay-fleet 服务运行期间 AC3 必须绿；同一文件新增直接断言：`isResidentServiceFile('service.log.jsonl')` 与 `isResidentServiceFile('attention.json.tmp-123-abc')` 为 true。负控：临时移除这两条豁免，AC3 必须红，改完即还原。
- [ ] F2 执行 `bash scripts/with-memory-cap.sh npx vitest run src/modules/sidebar/tests/SidebarProjectItemTaskCounts.test.tsx --maxWorkers=1` 退出 0；该文件的每个 render-wait 使用显式 timeout（建议 15s）或 `findBy*` 带 timeout；新增一条把 task-counts 渲染延迟 6s 的用例，默认 5s 下必须红、显式 timeout 下必须绿。负控：把任一 wait 改回默认 5s，慢渲染用例必须红。
- [ ] F3 连续运行 F2 的同一文件 5 次并记录每次的 loadavg 与 duration，5 次全部退出 0；若文件时长变化导致 `scripts/suite-duration-baseline.tsv` 需要更新，按该文件的既有格式同步并在完成记录说明。
- [ ] F4 执行 `npm run typecheck` 与 `npm run lint` 分别退出 0；用 `git diff --stat` 只读复核没有改动 `src/` 下的业务文件（本任务只改测试与测试基线）。
- [ ] F5 在完成记录的 fan-in suite 中，`fleet-cli-contracts.test.ts` 与 `SidebarProjectItemTaskCounts.test.tsx` 均不再红且 suite 全绿；若 suite 仍出现其它环境的红，必须逐条归因，不能把「重试绿」当稳定绿。

## DoD

在常驻 quay-fleet 服务运行的真实宿主上复现原始条件：contract 测试跑满整个 11.5s 窗口并让 resident 服务至少写一次 `service.log.jsonl` 与 `attention.json.tmp-*`，修复后 AC3 仍绿；sidebar 测试注入一次 6s 的渲染延迟，修复后显式 timeout 等到读数且文件绿。记录两次运行的命令、loadavg、duration、`__PERFILE_KIND__` 与失败/通过原文，存 `tmp/` 并在完成记录贴出路径；再用完成轮的 fan-in suite 读数证明两个文件不再红。不得只以「单跑通过」代替带负载/带延迟的复现。

## Touches

- tasks/gap-fleet-contract-and-sidebar-load-flake.md
- server/modules/quay/tests/contracts/fleet-cli-contracts.test.ts
- src/modules/sidebar/tests/SidebarProjectItemTaskCounts.test.tsx
- scripts/suite-duration-baseline.tsv
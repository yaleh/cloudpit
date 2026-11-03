---
id: gap-quay-test-script-runner-self-overhead
title: 降低 Quay 测试脚本自测开销并刷新 suite duration 基线
status: todo
labels:
  - gap
parent: null
children: []
extra:
  schema: execution
---
## Proposal

最新记录显示，`quay-test-script.test.ts` 在 round 1924 用时 93.7s，最近 12 轮约 91.8–98.8s；它多次同步启动 `scripts/test.sh`，重复收集约 507 个 server 测试并重跑调度。真实 CLI 合约哨兵约 14–15.5s，来自四个真实场景和长工具进程清理，保留其合约与清理语义作为独立重型判据。此任务降低 Quay 自测自身开销，并刷新长任务调度数据。

<!-- dedup-ref -->相关但机制不同：`gap-suite-server-dispatch-longest-first-and-parallel-static-stages` 已落地生产调度；本任务优化该调度机制的自测成本和排序实现评估，不重复其功能。真实 CLI 清理已有 `gap-cli-contract-sentinel-sleep2-bash-child-leaks-into-suite-leak-sweep` 判据，本文不改 CLI 场景时长或等待语义。

## Plan

1. 合并 AC2/AC4 重复的完整排序与集合检查；AC3 多个 fail-open 案例共享一次预期文件列表计算，同时各自继续验证独立输入与输出。
2. 将大列表算法案例改为可注入的合成文件清单 fixture；真实 `find` 收集与 positional 参数只保留少量入口集成案例。fixture 注入只能在 order 测试接缝生效，普通测试运行仍从仓库收集文件。
3. 在相同的约 507 项输入上评估当前匹配/排序路径与候选实现，记录可复跑的耗时读数，并以排序结果逐字节一致为正确性门槛；采用有证据支持的实现，若没有稳定收益则保留当前实现并记录结论。
4. 从最新绿色 fan-in 的 `.quay/verification-round.jsonl` 重生成 `scripts/suite-duration-baseline.tsv`，校验来源轮次、覆盖率与长文件排名。不要调整真实 CLI 哨兵的超时、工具时长或清理逻辑。

## AC

- [ ] 执行 `npx tsx --tsconfig server/tsconfig.json --import ./scripts/undici-blocked-ports-preload.mjs --test server/shared/tests/quay-test-script.test.ts` 退出 0；合并检查后，AC2 的降序/未知文件保序/缺失路径断言与 AC4 的集合不变/positional 顺序断言仍全部执行。
- [ ] AC3 的缺失、空、不可解析、不可读（适用时）和有效 baseline 案例均逐项运行；测试只计算一次预期完整清单，且每个案例仍断言退出码、stderr 判词与 stdout 字节级结果。
- [ ] order 接缝下用合成清单运行大列表 fixture；同一 fixture 覆盖有效、失效 baseline 与重复/缺失路径边界，普通未设置 fixture 的 order 调用仍与仓库 `find server -name '*.test.ts' -o -name '*.test.js' | grep -v node_modules | sort` 结果一致，positional 文件仍按调用顺序输出。
- [ ] 对同一约 507 项输入至少各运行三次当前排序路径和候选路径；在任务验证记录中贴出可复跑命令、每次耗时、中位数和逐字节结果比较，并据此保留或替换实现；不可只凭代码复杂度推断更快。
- [ ] 从最新绿色 round 生成 duration baseline 后，执行文件内记载的再生成命令并与提交内容比较无 diff；`server/shared/tests/quay-test-script.test.ts` 中覆盖率、数据格式、来源轮次和 top-8 守卫通过。
- [ ] 执行 `npx tsx --tsconfig server/tsconfig.json --import ./scripts/undici-blocked-ports-preload.mjs --test server/modules/providers/tests/claude-resident-cli-contract.test.ts` 退出 0，四场景真实 CLI 轨迹与 tamper 自检仍通过，且测试内的 50 秒进程预算守卫未改。

## DoD

真实落地以本仓库一次绿色 Quay fan-in 为准：在最新 `.quay/verification-round.jsonl` 记录中核实更新后的 baseline 已实际驱动 server longest-first 派发，所有测试文件仍被执行且 per-file 结果完整；记录 Quay 自测文件耗时、server 阶段跨度与 suite 总墙钟耗时，并和改动前 round 1924 的 93.7s / 286.8s 对照。仅有 fixture、基线文件或单文件测试通过不算完成；若整套耗时受其他阶段或宿主负载影响，须同时贴出 per-file 区间和实际派发顺序，不能把相关性写成算法提速结论。

## Touches

- scripts/test.sh
- scripts/suite-duration-baseline.tsv
- server/shared/tests/quay-test-script.test.ts
- server/modules/providers/tests/claude-resident-cli-contract.test.ts
- tasks/gap-quay-test-script-runner-self-overhead.md
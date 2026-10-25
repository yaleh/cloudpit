---
id: gap-cli-contract-sentinel-sleep2-bash-child-leaks-into-suite-leak-sweep
title: 真 claude 契约哨兵的 in-flight Bash（sleep 2）在测试结束后留在套件进程组：761/761 全绿的轮被
  leaked-processes 判 aborted，12 个任务的 fan-in 轮反复打回
status: ready
labels:
  - gap
  - defect
parent: null
children: []
extra:
  schema: execution
---
## Proposal

2026-10-25 的只读读数：本仓库 `.quay/verification-round.jsonl` 里 `notEvaluated:"leaked-processes (1)"` 共 **20 轮、12 个不同任务**（2026-10-25T17:28Z–22:36Z），每一条的 `leakedProcesses[0].cmdline` 都逐字是 `sleep 2`，`cwd` 都是当轮任务的 worktree。这些轮本身并没有失败断言：以 `gap-composer-quote-insert-breaks-only-for-multiline` 的最后一轮（round 1570）为例，suite 日志 `.quay/fan-in-suite-gap-composer-quote-insert-breaks-only-for-multiline~wk-prod-anchor~1792967222276-86e8fd.log` 是 `# tests 761` / `# pass 761` / `# fail 0`，末行 `[full-suite-runner] SUITE-PLAN planned=441 terminal=761 missing=0 source=probe:test.sh --list-files plan_error=null completeness=not-evaluated oomKill=0 telemetry=ok laneCount=127`，驱动仍写 `# suite red aborted`。

同一轮的 `leakedProcesses` 原样读数：

```json
{"pid":704526,"ppid":319121,"startedAt":"2026-10-25T22:36:52.140Z","cmdline":"sleep 2","cwd":"/data/home/yale/work/claudecodeui-worktrees/gap-composer-quote-insert-breaks-only-for-multiline"}
```

**产生者。** 全库唯一的字面 `sleep 2` 命令在 `server/modules/providers/tests/claude-resident-cli-contract.test.ts:608`：

```ts
const IN_FLIGHT_BASH = 'sleep 2; echo CLI_CONTRACT_IN_FLIGHT_DONE';
```

AC-379 的任务正文也逐字记着「场景里唯一的 Bash 是 `sleep 2; echo CLI_CONTRACT_IN_FLIGHT_DONE`」。这个哨兵驱动真实 `claude` 二进制：mock 端点让它发一个前台 `Bash` 工具调用，把 `sleep 2` 跑起来，然后 interrupt。测试结束、`claude` 进程被回收之后，工具派生的 `sleep 2` 子进程被孤儿化（`ppid` 变成 1）却仍留在套件自己的进程组里。`full-suite-runner` 的 `reapLeakedSuiteProcesses()` 在 suite 子进程退出并等待 250ms 后按 pgid 枚举成员，扫到它就整轮写 `state:"red" reason:"aborted" notEvaluated:"leaked-processes (1)"`。`sleep 2` 只活 2 秒，所以只有该文件恰好在套件末尾跑完时才会被扫到——这正是它看起来「偶发」的原因。

**后果。** 判红时没有任何失败行，worker-driver 的 rerun / baseline-red 读到 `no-failing-lines-in-suite-log`，归因不出，任务被停成 needs-human。同一天已有 12 个不同的任务因此被反复打回。归因器在这里是**对的**（`fail 0` 时本来没有文件可归因），真正的缺陷是哨兵把工具子进程留在了套件进程组里。

## Plan

1. 复现：在隔离 worktree 里跑 `bash scripts/test.sh --for-task gap-cli-contract-sentinel-sleep2-bash-child-leaks-into-suite-leak-sweep`（Touches 只有一个测试文件，故它只解析到 `server/modules/providers/tests/claude-resident-cli-contract.test.ts`），跑之前记录该调用的 pgid，跑之后按 pgid 枚举成员，贴出 `sleep 2` 的 `pid/ppid/pgid/cwd`。
2. 修在测试侧（两选一，按实测选择）：(a) 把 `IN_FLIGHT_BASH` 换成一个不 fork 子进程、又能把 turn 挂住的 shell 内建（例如 `read`），保持四个场景的帧序不变；或 (b) 保留 `sleep 2`，在每个场景 teardown 里等到工具子进程退出（有界等待）再结束测试。
3. 不放宽检测：不改 `reapLeakedSuiteProcesses` / `listProcessGroupMembers`，不加容忍阈值、不跳过、不把 `leakedProcesses` 降级成告警。
4. 两个对照：修复前同一采样点残留 1 个 `sleep 2`，修复后为 0；另用一个真正的遗留进程（自己 detach 的 `sleep 30`）证明 `reapLeakedSuiteProcesses` 仍会报 `leaked>=1`，检测面没有变窄。

## AC

- [ ] AC1 复现读数：`bash scripts/test.sh --for-task gap-cli-contract-sentinel-sleep2-bash-child-leaks-into-suite-leak-sweep` 退出码 0；在跑之前记录该调用的 pgid，跑之后 `ps -eo pid,ppid,pgid,cmd | awk -v g=<pgid> '$3==g'` 的输出里贴出 `sleep 2` 那一行（含 pid/ppid/pgid），并贴出该行的 cwd。
- [ ] AC2 修复读数：同一命令、同一采样点，`sleep 2` 残留行数从 1 变为 0；`git diff` 只改 `server/modules/providers/tests/claude-resident-cli-contract.test.ts`；`grep -c "^test(" server/modules/providers/tests/claude-resident-cli-contract.test.ts` 与改动前相同（不删场景用例），断言不放宽。
- [ ] AC3 正控：临时探针里 spawn 一个 `sleep 30` 并让它留在探针自己的进程组，`reapLeakedSuiteProcesses` 报 `leaked.length >= 1` 且 `reaped=true`；同一探针对一个干净进程组报 `leaked.length === 0`。两个读数都贴出，证明泄漏检测没有被削弱。
- [ ] AC4 局部回归：`bash scripts/test.sh --for-task gap-cli-contract-sentinel-sleep2-bash-child-leaks-into-suite-leak-sweep` 退出码 0，四个场景的 `contract.<scenario>=ok` 仍全部打印；`npm run typecheck` 退出码 0；`npm run lint` 退出码 0（仅既有 warning）。
- [ ] AC5 改动边界：`bash scripts/test.sh --for-task gap-cli-contract-sentinel-sleep2-bash-child-leaks-into-suite-leak-sweep` 退出码 0；`node .quay/plugin/scripts/dist/anti-drift-touches-check.js --task gap-cli-contract-sentinel-sleep2-bash-child-leaks-into-suite-leak-sweep --worktree <wt> --merge-target develop` 输出 `ANTI-DRIFT OK`。

## DoD

- AC1–AC5 逐条贴出真实命令与原始输出片段（不是转述）。
- 检测面零改动：`git diff develop...HEAD` 里 `leakedProcesses`、`notEvaluated`、`reapLeakedSuiteProcesses`、`LEAK_SWEEP`、`tolerance` 的命中数为 0；改动集只有测试文件与任务文件。
- 不删场景用例、不放宽断言：`git diff --stat` 的删除行逐处说明原因。
- 不重启任何常驻服务，不触碰 :3001；局部验证只用隔离 worktree。

## Touches

- `server/modules/providers/tests/claude-resident-cli-contract.test.ts`
- `tasks/gap-cli-contract-sentinel-sleep2-bash-child-leaks-into-suite-leak-sweep.md`

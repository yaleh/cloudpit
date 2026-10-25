---
id: gap-cli-contract-sentinel-sleep2-bash-child-leaks-into-suite-leak-sweep
title: 真 claude 契约哨兵的 in-flight Bash（sleep 2）在测试结束后留在套件进程组：761/761 全绿的轮被
  leaked-processes 判 aborted，12 个任务的 fan-in 轮反复打回
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

2026-10-25 的只读读数：本仓库 `.quay/verification-round.jsonl` 里 `notEvaluated:"leaked-processes (1)"` 共 **20 轮、12 个不同任务**（2026-10-25T17:28Z–22:36Z），每一条的 `leakedProcesses[0].cmdline` 都逐字是 `sleep 2`，`cwd` 都是当轮任务的 worktree。这些轮本身并没有失败断言：以 `gap-composer-quote-insert-breaks-only-for-multiline` 的最后一轮（round 1570）为例，suite 日志 `.quay/fan-in-suite-gap-composer-quote-insert-breaks-only-for-multiline~wk-prod-anchor~1792967222276-86e8fd.log` 是 `# tests 761` / `# pass 761` / `# fail 0`，末行 `[full-suite-runner] SUITE-PLAN planned=441 terminal=761 missing=0 source=probe:test.sh --list-files plan_error=null completeness=not-evaluated oomKill=0 telemetry=ok laneCount=127`，驱动仍写 `# suite red aborted`。

同一轮的 `leakedProcesses` 原样读数：

```json
{"pid":704526,"ppid":319121,"startedAt":"2026-10-25T22:36:52.140Z","cmdline":"sleep 2","cwd":"/data/home/yale/work/claudecodeui-worktrees/gap-composer-quote-insert-breaks-only-for-multiline"}
```

**后果。** 判红时没有任何失败行，worker-driver 的 rerun / baseline-red 读到 `no-failing-lines-in-suite-log`，归因不出，任务被停成 needs-human。同一天已有 12 个不同的任务因此被反复打回。

**2026-10-26 实测修正：产生者不是契约测试，是 `scripts/test.sh` 的 watchdog 轮询。**

在隔离 worktree 里跑 `bash scripts/test.sh --for-task gap-cli-contract-sentinel-sleep2-bash-child-leaks-into-suite-leak-sweep`，退出码 0、`# fail 0`；跑完按该调用的 pgid 枚举成员，仍残留一行 `sleep 2`（AC1 的原始读数），该行 `cwd` 逐字是 worktree 根，**不是**契约测试的临时目录。判别实验：同一命令加 `QUAY_SUITE_WATCHDOG_POLL_SECS=7`，同一采样点的残留变成 `sleep 7`，`sleep 2` 计数为 0（AC2 的判别读数）——残留跟随 `WATCHDOG_POLL_SECS`，产生者是 `watchdog_loop` 的 `sleep "$WATCHDOG_POLL_SECS"`。

机制：`watchdog_stop()` 只把 TERM 发给 watchdog 的子 shell，而该 shell 正阻塞在外部的 `sleep` 上；子 shell 被 TERM 后，`sleep` 子进程被孤儿化（ppid 变 1 / systemd）却仍留在 suite 自己的进程组里。契约测试的 CLI 跑在 `os.tmpdir()` 的临时目录，它的工具子进程 cwd 不会是 worktree 根；台账里那行 `cwd` 是 worktree 根，与 `test.sh` 的 cwd 一致。

因此 develop 上已有的 `02b67b80d`（在契约测试 teardown 里等 3s）并没有消除该残留；它无害，本轮保留不动，但本条的修复点在 `scripts/test.sh`，不在测试文件。

## Plan

1. 复现：在隔离 worktree 里跑 `bash scripts/test.sh --for-task gap-cli-contract-sentinel-sleep2-bash-child-leaks-into-suite-leak-sweep`（Touches 里的测试文件只有一个，故它只解析到 `server/modules/providers/tests/claude-resident-cli-contract.test.ts`），跑之前记录该调用的 pgid，跑之后按 pgid 枚举成员，贴出 `sleep 2` 的 `pid/ppid/pgid/cwd`。
2. 判别产生者：同一命令加 `QUAY_SUITE_WATCHDOG_POLL_SECS=7` 重跑；残留若变成 `sleep 7` 即证明产生者是 watchdog 轮询。
3. 修在产生者侧：`watchdog_stop()` 先把 watchdog 的轮询子进程（外部 `sleep`）收掉，再结束 watchdog 子 shell，并在正常停止路径 `wait` 到它真正退出，使 test.sh 退出时其进程组里不再有孤儿 `sleep`；guard 已 fire 的路径不 `wait`，避免把 abort 报告堵在它自己的升级序列后面。
4. 不放宽检测：不改 `reapLeakedSuiteProcesses` / `listProcessGroupMembers`，不加容忍阈值、不跳过、不把 `leakedProcesses` 降级成告警。
5. 两个对照：修复前同一采样点残留 1 个 `sleep 2`，修复后为 0；另用 `sleep 30` 证明 `reapLeakedSuiteProcesses` 仍会报 `leaked>=1` 且 `reaped=true`，检测面没有变窄。

## AC

- [x] AC1 复现读数：`bash scripts/test.sh --for-task gap-cli-contract-sentinel-sleep2-bash-child-leaks-into-suite-leak-sweep` 退出码 0；在跑之前记录该调用的 pgid，跑之后 `ps -eo pid,ppid,pgid,cmd | awk -v g=<pgid> '$3==g'` 的输出里贴出 `sleep 2` 那一行（含 pid/ppid/pgid），并贴出该行的 cwd。
- [x] AC2 修复读数：同一命令、同一采样点，`sleep 2` 残留行数从 1 变为 0；`git diff develop...HEAD` 的代码改动只有产生者 `scripts/test.sh`；`grep -c "^test(" server/modules/providers/tests/claude-resident-cli-contract.test.ts` 与改动前相同（该文件未被改动，不删场景用例），断言不放宽。判别读数另附：`QUAY_SUITE_WATCHDOG_POLL_SECS=7` 时残留为 `sleep 7`、`sleep 2` 为 0。
- [x] AC3 正控：临时探针里 spawn 一个 `sleep 30` 并让它留在探针自己的进程组，`reapLeakedSuiteProcesses` 报 `leaked.length >= 1` 且 `reaped=true`；同一探针对一个干净进程组报 `leaked.length === 0`。两个读数都贴出，证明泄漏检测没有被削弱。
- [x] AC4 局部回归：`bash scripts/test.sh --for-task gap-cli-contract-sentinel-sleep2-bash-child-leaks-into-suite-leak-sweep` 退出码 0，四个场景的 `contract.<scenario>=ok` 仍全部打印；`npm run typecheck` 退出码 0；`npm run lint` 退出码 0（仅既有 warning）。
- [x] AC5 改动边界：`bash scripts/test.sh --for-task gap-cli-contract-sentinel-sleep2-bash-child-leaks-into-suite-leak-sweep` 退出码 0；`node .quay/plugin/scripts/dist/anti-drift-touches-check.js --task gap-cli-contract-sentinel-sleep2-bash-child-leaks-into-suite-leak-sweep --worktree <wt> --merge-target develop` 输出 `ANTI-DRIFT OK`。

## DoD

- AC1–AC5 逐条贴出真实命令与原始输出片段（不是转述）。
- 检测面零改动：`git diff develop...HEAD` 里 `leakedProcesses`、`notEvaluated`、`reapLeakedSuiteProcesses`、`LEAK_SWEEP`、`tolerance` 的命中数为 0；代码改动集只有 `scripts/test.sh`，外加任务文件（develop 上已有的 `02b67b80d` 测试文件改动不属于本轮 delta）。
- 不删场景用例、不放宽断言：`git diff --stat` 的删除行逐处说明原因（唯一删除行是旧的单行 `kill -s TERM`，被“先收子进程再 wait”的块替换）。
- 不重启任何常驻服务，不触碰 :3001；局部验证只用隔离 worktree。

## Evidence

AC1（修复前，develop tip + 已有 `02b67b80d`）：

```
RUN rc=0 pgid=2847862
--- ps -eo pid,ppid,pgid,stat,etimes,cmd --no-headers | awk -v g=2847862 '$3==g' ---
2876295  319121 2847862 S          1 sleep 2
--- cwd ---
pid=2876295 cwd=/data/home/yale/work/claudecodeui-worktrees/gap-cli-contract-sentinel-sleep2-bash-child-leaks-into-suite-leak-sweep
```

判别（`QUAY_SUITE_WATCHDOG_POLL_SECS=7`，同一采样点）：

```
RUN rc=0 pgid=2735348
2763376  319121 2735348 S    sleep 7
match sleep 2: 0
match sleep 7: 1
```

AC2（修复后，同一命令、同一采样点）：

```
RUN rc=0 pgid=2892089
--- pgid members after exit --- (none)
survivors=0
sleep2=0
```

`git diff develop...HEAD --stat`：

```
 scripts/test.sh | 24 +++++++++++++++++++++++-
 1 file changed, 23 insertions(+), 1 deletion(-)
```

`grep -c "^test(" server/modules/providers/tests/claude-resident-cli-contract.test.ts` = `2`（与改动前相同；该文件本轮未改）。

AC3（`tmp/ac3-probe.mjs`）：

```json
{"positive":{"leakedLength":1,"reaped":true,"leaked":[{"pid":2952549,"ppid":2952465,"cmdline":"sleep 30"}]},
 "clean":{"leakedLength":0,"reaped":true}}
```

AC4：直接跑测试文件（与 test.sh server 相位同一条命令）打印

```
contract.idle=ok
contract.later-drain=ok
contract.next-fold=ok
contract.interrupt=ok
```

`npm run typecheck` 退出 0；`npm run lint` 退出 0（仅既有 warning）。

AC5（最终一轮，已提交的 worktree 树）：

```
RUN rc=0 pgid=3104591
survivors=0 sleep2=0
__PERFILE__ duration_ms=19177 server/modules/providers/tests/claude-resident-cli-contract.test.ts passed=true
# tests 1 / # pass 1 / # fail 0
ANTI-DRIFT OK: task gap-cli-contract-sentinel-sleep2-bash-child-leaks-into-suite-leak-sweep — 1 actual file(s), all within declared Touches (3 glob(s))
```

## Touches

- `scripts/test.sh`
- `server/modules/providers/tests/claude-resident-cli-contract.test.ts`
- `tasks/gap-cli-contract-sentinel-sleep2-bash-child-leaks-into-suite-leak-sweep.md`

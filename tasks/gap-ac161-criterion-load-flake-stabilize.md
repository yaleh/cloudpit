---
id: gap-ac161-criterion-load-flake-stabilize
title: AC-161 判据在宿主负载下假红：claude-resident-process.test.ts 的假形态臂读不到活宿主，让判据稳定跑绿（载重读数一条不动）
status: done
labels:
  - gap
  - defect
parent: null
children: []
extra:
  schema: execution
goal_ac: AC-161
---
## Proposal

<!-- dedup-ref --> 机制去重读数（本轮立案时实测）：`grep -l '^goal_ac: *AC-161' tasks/*.md` 只命中 `tasks/gap-claude-resident-process-survival.md`，其 `status: done` —— 无 todo/ready/needs-human 的认领任务。粒度工具 `task-granularity-advice --touches server/modules/providers/tests/claude-resident-process.test.ts --touches tasks/gap-ac161-criterion-load-flake-stabilize.md --json` 读数 `peers: []`、`mentions: []`、`perFile[0].nLanded: 3`。前一条 done 任务修的是另一机制：判轮口径依赖环境的模型名（工人 shell 有 `ANTHROPIC_DEFAULT_HAIKU_MODEL`、anchor 没有），已改为按累计用户话轮识别（见该任务「第三轮」段）；本条不重开那个机制，也不改它的载重读数。

**现象（台账逐字读数）。** `.quay/gate-events.jsonl` 里 AC-161 在 2026-10-27 共 30 条 gate 事件、3 条 fail，且两组 fail 与 pass 落在**同一个 treeSha**：tree `6be59f6c` 上 `14:12:33 fail` → `14:13:34 pass`；tree `fe275134` 上 `15:41:24 pass`、`15:45:38 pass` → `15:50:33 fail`；另有 `15:23:02 fail`（tree `fd68bd41`）。本人在静默态按判据原命令直跑 **3 次全绿**：`tests 10 / pass 10 / fail 0`，`duration_ms` 分别 24767.4 / 29014.0 / 25968.0，每次都有 `[budget] budget=60000ms elapsed=… exit=0`；随后 `goal_gate AC-161` → `verdict: pass`（`15:53:51`，tree `21b2cb23`；与 `fe275134` 的差异只有 `tasks/cockpit-card-anatomy-matches-mockups.md`，`git diff --quiet fe275134 21b2cb23 -- server/` 为空）。⇒ 担保本身今天成立，红是判据的负载假红，不是代码回归。

**红落在哪（能拿到的证据）。** 三条 fail 的 reason 都被 gate 截断（5122/5146/5773 chars 省略），`.quay/` 与 `/tmp` 中未找到该次运行的完整 stdout 工件。仍可定位到腿：失败签名为 `code: 'ERR_ASSERTION', actual: undefined, expected: true, operator: '=='`（即 `assert.ok(undefined, …)`），调用帧为 `claude-resident-process.test.ts:501:5`（`withResidentHarness` 里的 `await run(...)`）→ `:685:5`（test (d) 的 `await withResidentHarness(...)`）。该文件里能产生 `assert.ok(undefined)` 的只有两处活宿主查找：`:332`（`liveResidentReading`，消息 `no live host serves session \"…\"`）与 `:698`（test (d) 的 `assert.ok(host, 'the round has a live host to close')`）。两处都在**假形态臂**里，不是载重断言。

**机制（本仓已记录的族）。** `claude-resident-process.test.ts` 起**真实 `claude` 二进制**；宿主并发高时子进程会以 `Claude Code process exited with code 1` 早退，假形态臂随即读不到活宿主而假红；单跑绿（记忆 `suite-red-claude-resident-process-real-binary-load-flake`、`claude-resident-process-neg-control-arms-flake-under-load`）。姊妹判据 `claude-resident-name-live-mirror.test.ts:132` 已有 `BOOT_ATTEMPTS = 3` 的启动重试先例。

**要建的东西（最小充分集）。** 给本判据的启动/轮次准备加**有界**重试：仅当一轮的 `complete` 带非 0 `exitCode`、或轮后找不到活宿主时，在 60 秒预算内重开这一轮的宿主并重发该轮；重试只覆盖「进程根本没起来」这一前提，**不覆盖** pid/hostId/存活/closeReason 的任何读数。载重断言逐字不动，60 秒进程级预算守卫与 `exit 3` 语义不动。

**非目标。** 不改常驻运行时行为；不弱化 `assertSameHostAcrossRounds` / `assertProcessSurvivesAbort`；不改 60 秒预算；不做额外并发压测（自然负载即可）；不重启服务；不碰其它判据文件。

## Plan

1. **先复现再定论**：在自然负载下连跑判据若干次，把每次完整 stdout 存到 `tmp/`，拿逐字的失败断言与行号（若仍不复现，就以本 Proposal 里的 gate 签名与 `:332`/`:698` 定位为准，并在 Evidence 登记「未复现」这一读数，不虚构日志）。
2. **有界启动重试**：在 `withResidentHarness`/轮次辅助里加 `LAUNCH_ATTEMPTS` 常量（照 `claude-resident-name-live-mirror.test.ts:132` 的 `BOOT_ATTEMPTS = 3`），只在「本轮没有活宿主 / `complete.exitCode !== 0`」时重开该轮；每次重试打印 `[resident] launch retry round=… attempt=… exitCode=…`；总耗时必须仍落在 `BUDGET_MS=60_000` 内（今天常绿读数约 20–29s）。
3. **证明重试是承重的（确定性注入）**：加一个测试专用 env（如 `CLAUDE_RESIDENT_FAIL_FIRST_LAUNCH=1`），让某个腿的第一次启动以同一瞬态形态失败；带重试 ⇒ exit 0，把 `LAUNCH_ATTEMPTS` 置 0/关闭重试 ⇒ exit 1 且红在同一条「no live host」断言上。
4. **载重读数逐字保留**：`assertSameHostAcrossRounds`、`assertProcessSurvivesAbort` 的函数体不改；两臂假形态仍由 `assert.throws(..., /must run on the round-1 pid/)` 与 `/must survive the abort/` 落实；60 秒预算守卫仍打印 `[budget] … exit=3`。
5. **稳定跑绿**：自然负载下连续 5 次 exit 0，逐次登记 `duration_ms` 与 `[budget] … exit=0`；若重试把常绿耗时推高到接近 60s，收窄重试的等待而不是抬预算。
6. **契约面**：`npm run typecheck`、`npm run lint` 退出 0；`git diff --name-only $(git merge-base develop HEAD) HEAD` 全部落在 `## Touches`。

## AC

- [x] AC1 红态基线逐字可查：`jq -r 'select(.item_id=="AC-161") | [.timestamp,.verdict,.payload.treeSha] | @tsv' .quay/gate-events.jsonl` 的输出里，tree `fe275134` 同时出现 `15:41:24 pass`、`15:45:38 pass`、`15:50:33 fail`，tree `6be59f6c` 同时出现 `14:12:33 fail` 与 `14:13:34 pass`；这两组同 tree 对照、以及本轮直跑 3 次绿（`tests 10 / pass 10 / fail 0`，24767.4 / 29014.0 / 25968.0ms）与 `goal_gate` pass（15:53:51）逐字写进 Evidence。
- [x] AC2 失败断言定位到假形态臂：`grep -n "assert.ok(host" server/modules/providers/tests/claude-resident-process.test.ts` 命中 ≥2（修前 `:332`、`:698`）；Evidence 里逐字写出失败签名 `actual: undefined, expected: true, operator: '=='` 与调用帧 `:501:5`→`:685:5`，并说明两处候选都在 test (d) 的假形态臂、不在载重断言。
- [x] AC3 有界重试存在且可见：`grep -nE "LAUNCH_ATTEMPTS|BOOT_ATTEMPTS" server/modules/providers/tests/claude-resident-process.test.ts` 命中 ≥1；重试循环有命名常量作上界，且重试日志行 `[resident] launch retry` 出现在注入运行的 stdout 里。
- [x] AC4 重试是承重的（确定性）：`CLAUDE_RESIDENT_FAIL_FIRST_LAUNCH=1 npx tsx --tsconfig server/tsconfig.json --test server/modules/providers/tests/claude-resident-process.test.ts` exit 0；关闭重试后（同一注入，`LAUNCH_ATTEMPTS=0` 或等价开关 `CLAUDE_RESIDENT_LAUNCH_ATTEMPTS=0`）同一命令 exit 1，失败断言逐字为活宿主缺失那条；两条命令与输出都在 Evidence 登记。
- [x] AC5 载重读数未弱化：`git diff develop -- server/modules/providers/tests/claude-resident-process.test.ts` 中 `assertSameHostAcrossRounds` 与 `assertProcessSurvivesAbort` 的函数体零改动；`grep -c "must run on the round-1 pid\|must survive the abort" server/modules/providers/tests/claude-resident-process.test.ts` = 4（立案时写 2 是误读：该模式同时命中两个读数函数内的模板消息两行与两臂 `assert.throws` 正则两行；develop 基线同为 4，判据意图「函数体零改动 + 两臂正则仍在」不变，故期望值就地更正为 4）；`grep -n "60_000" server/modules/providers/tests/claude-resident-process.test.ts` 仍命中预算默认值。
- [x] AC6 稳定跑绿：自然负载下连续 5 次执行判据原命令均 exit 0，逐次登记 `duration_ms` 与 `[budget] budget=60000ms elapsed=… exit=0`。
- [x] AC7 契约面：`npm run typecheck` 退出 0；`npm run lint` 退出 0；`git diff --name-only $(git merge-base develop HEAD) HEAD` 全部落在 `## Touches`。

## DoD

判据在被交付的树上、自然负载下连续 5 次真跑绿（每次 `[budget] … exit=0`，且耗时相对 60s 有明显余量）；启动重试在确定性注入下被证明承重——注入首启失败时带重试绿、关掉重试红在同一条活宿主断言上；载重读数（三轮同 pid/hostId、abort 不杀进程、close 经 stdin EOF 且 closeReason=user、两臂假形态各自红、60s 进程级守卫 exit 3）逐字未变；没有为了过闸放宽任何断言，也没有抬 60 秒预算。

## Evidence

（立案读数；worker 追加复现与修复后的逐字读数。）

- 判据命令（逐字，来自 AC 记录）：`npx tsx --tsconfig server/tsconfig.json --test server/modules/providers/tests/claude-resident-process.test.ts`。
- 同 tree 假红对照（`.quay/gate-events.jsonl`）：`2026-10-27T14:12:33Z fail @6be59f6c` → `2026-10-27T14:13:34Z pass @6be59f6c`；`2026-10-27T15:41:24Z pass @fe275134`、`15:45:38Z pass @fe275134` → `15:50:33Z fail @fe275134`；另 `15:23:02Z fail @fd68bd41`。
- worker 复核（2026-10-28）同日 `jq` 读数仍在：`2026-10-27T14:12:33.537Z fail 6be59f6c…`、`14:13:34.078Z pass 6be59f6c…`、`15:41:24.904Z pass fe275134…`、`15:45:38.080Z pass fe275134…`、`15:50:33.601Z fail fe275134…`；同一读数里另有 `16:05:37.270Z fail 3f6cb5e3…`（立案后又一轮，同样单跑可绿）。
- 本轮直跑（3 次，全绿）：`tests 10 / pass 10 / fail 0`，`duration_ms=24767.4 / 29014.0 / 25968.0`；`[budget] budget=60000ms elapsed=19552ms exit=0`（首次）等。
- `goal_gate AC-161`：`verdict: pass, reason: acceptance passed (exit 0), timestamp 2026-10-27T15:53:51.967Z`；该次 tree `21b2cb23` 与 `fe275134` 仅差 `tasks/cockpit-card-anatomy-matches-mockups.md`，`git diff --quiet fe275134 21b2cb23 -- server/` 为空。
- 失败签名（被 gate 截断后仍保留）：`code: 'ERR_ASSERTION', actual: undefined, expected: true, operator: '=='`；调用帧 `…/claude-resident-process.test.ts:501:5` → `TestContext.<anonymous> …:685:5`。完整 stdout（5122 chars）未留存，故不虚构其内容。
- 候选断言：`:332 assert.ok(host, \`no live host serves session \"${SESSION_ID}\"\`)`；`:698 assert.ok(host, 'the round has a live host to close')`。worker 在 develop 基线 `1f95507db` 上复核：`grep -n "assert.ok(host"` 命中 `:332`、`:698`；修后同一 grep 命中 `:382`（`liveResidentReading`）、`:831`（closed host readable）、`:859`（the round has a live host to close），行号因新增代码下移，两条候选断言本体未动。
- 已有族记忆：`suite-red-claude-resident-process-real-binary-load-flake`、`claude-resident-process-neg-control-arms-flake-under-load`；姊妹判据启动重试先例 `claude-resident-name-live-mirror.test.ts:132` 的 `BOOT_ATTEMPTS = 3`。

**worker 修复（2026-10-28，commit `0bd51cc75`）。**

- 有界重试：新增 `LAUNCH_ATTEMPTS`（默认 3，`CLAUDE_RESIDENT_LAUNCH_ATTEMPTS` 可覆盖）与 `sendResidentRound()`；主腿 (a)(b)(c)(d) 与 (e) 的普通轮都走它，两臂的故意变异轮（(e) 的 abort-close、(b)/(e) 的 hold 段）保持原 `sendRound`。
- 重试条件收敛为「`complete.exitCode !== 0` **且** 轮后无活宿主」，即「进程根本没起来」：`exitCode === 0` 但轮后宿主消失属于轮次读数，重发会把已送达的 turn 再发一次（test (a) 的 `turns.length === 3` 会被打成 4），故不重试；非 0 exit 但宿主仍存活是轮次自身失败，交回该腿原有断言判。失败尝试的帧从 fake socket 丢弃，使 `completesPerRound` 继续数「送达的轮」而不是启动尝试。
- 注入：`CLAUDE_RESIDENT_FAIL_FIRST_LAUNCH=1` 把生产解析读到的 `CLAUDE_CLI_PATH` 指向一次性 shim——首次调用打印 `Claude Code process exited with code 1` 并 exit 1，之后 exec 真 `claude`；`after` 钩子恢复 env 并删临时目录。
- AC4 读数（逐字，日志在 worktree `tmp/`）：
  - 带重试：`CLAUDE_RESIDENT_FAIL_FIRST_LAUNCH=1 npx tsx --tsconfig server/tsconfig.json --test server/modules/providers/tests/claude-resident-process.test.ts` → **exit 0**；stdout 含 `[resident] launch retry round=\"round one\" attempt=1 exitCode=1 hostUp=false`；`tests 10 / pass 10 / fail 0`、`duration_ms 31.4s`、`[budget] budget=60000ms elapsed=31433ms exit=0`（`tmp/ac4-retry-on.log`）。
  - 关重试：同一注入再加 `CLAUDE_RESIDENT_LAUNCH_ATTEMPTS=0` → **exit 1**；失败断言逐字 `AssertionError [ERR_ASSERTION]: no live host serves session \"claude-resident-process-session\"`，签名 `code: 'ERR_ASSERTION', actual: undefined, expected: true, operator: '=='`，帧 `liveResidentReading` ← `sendResidentRound` ← test (a)（`tmp/ac4-retry-off.log`）。
- AC6 读数（自然负载、判据原命令连跑 5 次，全部 exit 0）：`duration_ms` = 35177.6 / 31902.9 / 32699.1 / 30926.0 / 35590.6；`[budget] budget=60000ms elapsed=` 28064 / 24842 / 25305 / 23741 / 28721 ms，均 `exit=0`（`tmp/ac6-run-1..5.log`）。相对 60s 预算余量 ≥24s。
- AC5 复核：`git diff develop -U0 -- server/modules/providers/tests/claude-resident-process.test.ts` 中两个读数函数零命中（函数体未改）；`grep -c "must run on the round-1 pid\|must survive the abort"` = 4（同 AC5 说明）；`grep -n "60_000"` 仍命中 `:124 : 60_000;` 预算默认值。
- AC7：`npm run typecheck` exit 0；`npm run lint` exit 0（仅存量 warning）；`git diff --name-only $(git merge-base develop HEAD) HEAD` = `server/modules/providers/tests/claude-resident-process.test.ts`（唯一一条，在 `## Touches` 内）。
- 注：注入运行中另见一次真 CLI 以 `exit 127` 早退（自然负载瞬态），重试按同一前提重发后成功——这正是本条要吸收的形态，未放宽任何读数。

## Touches

- `server/modules/providers/tests/claude-resident-process.test.ts`
- `tasks/gap-ac161-criterion-load-flake-stabilize.md`（自触）

该轴仍暗,理由:仅判据测试文件的有界启动重试，无设计/文档增量，L_D 与 L_G 均无可测读数

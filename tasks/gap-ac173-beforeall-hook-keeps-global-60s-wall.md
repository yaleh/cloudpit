---
id: gap-ac173-beforeall-hook-keeps-global-60s-wall
title: AC-173 判据的 beforeAll 仍压着 project 的 60s 墙（describe.configure 只抬 test 不抬
  hook）：13:33:30Z 的红逐字为 "beforeAll" hook timeout of 60000ms exceeded，同树 6 分钟内
  pass/fail/pass——抬钩子墙并把钩子/用例/看门狗/闸四处预算调自洽，判据命令与断言逐字不动
status: ready
labels:
  - gap
  - defect
parent: null
children: []
extra:
  schema: execution
goal_ac: AC-173
---
## Proposal

来源：本轮 gap-filing 的**直接测量**（不是台账尾巴）。AC-173 `status: achieved`，其 GOAL-013 已 achieved 且不再活，且未声明 `long-term: true`；台账尾部 `2026-10-29T13:33:30.874Z` 记为 fail，故按 CURRENTLY FALSE 立案。

<!-- dedup-ref --> **机制去重（本轮立案实测，checkout `/data/home/yale/work/claudecodeui`，branch `author`，`git rev-parse HEAD` = `2481025603c87bdb33c4e991d5df48c0f9e885bf`，`HEAD^{tree}` = `fa8e1fcf20fcd06a4a4a03ab4703b8f3462ef7f6`，`date -u` = `Thu Oct 29 13:40:23 UTC 2026`，`uptime` load1 = `19.09`）**：`grep -rl '^goal_ac: *AC-173' tasks/` 命中 7 份，`status:` 逐字皆 **done** —— `gap-claude-resident-running-view`、`gap-resident-running-view-criterion-bounded-boot-guard`、`gap-ac173-badge-source-mismatch-after-dock-consolidation`、`gap-ac173-ledger-red-is-uncommitted-composer-wip`、`gap-ac173-ledger-red-is-boot-ceiling-crossed`、`gap-ac173-criterion-boot-crossing-unattributable`、`gap-ac173-criterion-run-ceiling-load-headroom`。在飞扫描（逐份读 `tasks/*.md` 的 `^status:` ∈ {todo, ready, needs-human}）全库只有 8 份（`gap-ac436/438/441/442` 四条 codex-resident、`gap-cockpit-column-workspace-width`、`gap-cockpit-entry-return-path`、`gap-cockpit-phone-cockpit-overlay`、`gap-goal-051-turn-steer-not-an-ac`），**无一认领 AC-173** ⇒ 无在飞认领者，本条不是重复。按「done 不是重复、是更早修法没兜住的证据」逐份核过，见下节。合并候选检查用仪器而非手搓：`node /data/home/yale/.claude/plugins/cache/quay/quay/0.24.0/scripts/dist/task-granularity-advice.js --touches e2e/resident-running-view.spec.ts --touches playwright.config.ts --touches goals/AC-173-真实浏览器里-running-视图分正在运行与常驻-空闲-两组-侧栏徽标只计正在运行的会话.md --json` ⇒ `peers: []`、`mentions: []`（`perFile`: `playwright.config.ts` nLanded=105、`e2e/resident-running-view.spec.ts` nLanded=4）⇒ **kept separate**，无合并对象。

**判据物（逐字取自 `goals/AC-173-真实浏览器里-running-视图分正在运行与常驻-空闲-两组-侧栏徽标只计正在运行的会话.md`）**：`criterion:` = `npx playwright test e2e/resident-running-view.spec.ts`；`expect:` 逐字「调试 agent 场景造出一个运行中的会话与两个空闲常驻会话：侧栏 Running 徽标读数为 1；Running 视图两组各列出对应会话，第二组每行有关闭按钮，点击后该会话宿主关闭、从该组消失。取假形态：徽标计入空闲常驻会话 ⇒ 读数 3，必须红。」记录当前 `timeoutMs: 118000`。

### 本轮直接测量（同一份代码，6 分钟内 pass / fail / pass）

- **红**：`2026-10-29T13:33:30.874Z`（`.quay/gate-events.jsonl`，`item_id=AC-173`、`gate=goal`、`verdict=fail`）：`acceptance failed (exit 1)`，尾部逐字 `1 failed e2e/resident-running-view.spec.ts:870:3 › resident running view › the badge and the two groups follow the turns in flight, and a row closes the process it belongs to` + `2 did not run`。该跑的数据目录仍在 `~/.cache/quay-e2e-tmp/quay-e2e-2Tvdyt/`。
- 该跑 `test-results/resident-running-view-resi-44a96-s-the-process-it-belongs-to/error-context.md` 的 `# Error details` 逐字为 **`"beforeAll" hook timeout of 60000ms exceeded.`** —— 不是任何一条断言。同目录 `watchdog-state.json` = `{"armed":true,"fired":false,"ceilingMs":110000,"detail":"boot completed at 17287ms (config-eval-ms=262), re-armed to 110000ms from the run start"}`；`.last-run.json` = `status:"failed"`。
- 同跑 `trace.zip`（`test.trace` + `0/2-trace.trace`）的请求时刻（相对 trace 起点）：`POST /api/auth/register` 13.841s→21.868s（**8.0s**）；`POST /api/user/complete-onboarding` 21.872s→60.209s（**38.3s**）；其后 5 次 `POST /api/debug-agent/scenarios` 60.401s→71.904s（**11.5s**，每次 1.6–3.0s）；`GET /api/session-hosts` 71.906s→72.385s（0.5s）；`warmClientStartup` 72.404s→72.491s；`page.goto('/')` 72.491s 开始，钩子在 ~75s 被 60s 墙打死。⇒ **准备阶段在 60s 墙前已花掉 46s 在两条认证/引导请求上**，其后还有导航与 `revealSession` 未完成。
- **绿**：`2026-10-29T13:29:10Z` goal `frozenRecheck` 对 AC-173 = `verdict:"pass"`、`acceptance passed (exit 0)`、`durationMs=40862`、`headSha=3fe06452…`、`load1=27.81`。本轮另直跑同一条判据 → **EXIT=0，`3 passed (38.5s)`**，spec 自报 `elapsed=38564ms`，读数 `badge.reading=1`、`group.running.count=1`、`group.residentIdle.count=2`、`close.request=200`、`hosts.beforeClose=2 hosts.afterClose=1`、`badge.afterExtra=2`、`shared.perBinding=1 shared.perHost=2`；该跑 `watchdog-state.json` = `fired:false, ceilingMs:110000, boot completed at 4011ms (config-eval-ms=667)`；跑前 `load1=26.01`。
- ⇒ 红既不是「担保为假」（同树两拍为绿），也不是上一轮已治的运行天花板/引导天花板：`watchdog-state.json` 明说看门狗未开火（`fired:false`）。它是 **`beforeAll` 自己的 60s 墙**在本机常态载荷下被越过，而这堵墙从未被上一轮修法移动。

### 机制：`beforeAll` 读的是 project 墙，`describe.configure` 抬不到它

- Playwright 的钩子超时取自 worker 默认 slot = **project timeout**：`node_modules/playwright/lib/worker/workerProcessEntry.js:897` `this._timeoutManager = new TimeoutManager(this.project.timeout)`；本树 `playwright.config.ts:3737` 是 `timeout: 60_000`。
- `test.describe.configure({ timeout })` 只把值写到 **suite**（`node_modules/playwright/lib/common/index.js:2321-2328`），而装载期只把这个值赋给 **Test**（同文件 `2030-2052`：`test.timeout = inheritedTimeout ?? project.project.timeout`）——钩子不读它。这正是「describe 写 110_000、失败文本仍报 60000」的原因。
- 改钩子墙只有一条路：在钩子体内调用 `test.setTimeout(...)` / `testInfo.setTimeout(...)`，它直接改当前 runnable 的 slot（`workerProcessEntry.js:444-446`）。Playwright 自己的文档也是这么写的（`node_modules/playwright/types/test.d.ts:5943-5950`，原文「Changing timeout for a `beforeAll` or `afterAll` hook. Note this affects the hook's timeout, not the test timeout. … `test.setTimeout(60000);`」）。

### 上一轮 `gap-ac173-criterion-run-ceiling-load-headroom` 为什么没兜住

它（done，commit `5f6d89565`）移了三道墙：`SPEC_BUDGET_MS['resident-running-view.spec.ts']` 55→110（看门狗 `RUN_CEILING_MS` 随之 =110）、spec 的 `test.describe.configure` 60→110、AC 记录 `timeoutMs` 60→118，并明确「不动 `SINGLE_SPEC_CEILING_MS`」。但它没动**第四道墙**——`beforeAll` 的 60s project 墙（正是本轮红落点），也没让四道墙相加后装得下：钩子 60 + 主用例 110 + 引导 20 > 看门狗 110 > 闸 118，任一先到就决定判据，而不是断言。它的验证是 3 次健康直跑 + 一次 `QUAY_E2E_CONFIG_EVAL_STALL_MS` 负控——该负控停在 **config 求值**阶段（config 文件里、worker 起来之前），永远压不到 `beforeAll`，所以它看不到这道墙。更早的 6 份 done 分别治引导段有界导航、40s 引导天花板、徽标读数源、承载视图本体的，与本墙无关。

### 修法（只动预算与准备阶段可观测性，判据语义逐字不动）

1. **抬钩子墙**：`test.beforeAll(async ({ browser }, testInfo) => { test.setTimeout(SETUP_BUDGET_MS); … })`，并把 `testInfo.timeout` 打印成 `setup.timeout=<n>`，让这堵墙的读数进入运行输出。
2. **整轮预算自洽**：`SETUP_BUDGET_MS` = `SPEC_BUDGET_MS['resident-running-view.spec.ts']` = `test.describe.configure({ timeout })` = 自检阈值 = **240_000**；AC-173 记录 `timeoutMs` 抬到 **260_000**（闸 > 看门狗 240s，留 20s 给看门狗越界时写状态并退出）。依据：本机健康整轮 53.2s/38.5s，但 60s 墙前的失败轮已做完 ~72s 的准备且导航未完成（估 ~85–90s），主用例健康 26.2s、同载荷可翻倍 ⇒ 上限约 140–170s；240_000 是其 1.4–1.7 倍、健康轮的 ~4.5 倍。`SINGLE_SPEC_CEILING_MS` 仍 `55_000`、全局 `timeout: 60_000` 逐字不动（别的 spec 不受影响）。
3. **准备阶段可归因**：给 `beforeAll` 各阶段（register / complete-onboarding / 5 次 armScenario / readHosts / warmClientStartup / 导航 / revealSession）打印 `setup.phase=<name> elapsed=<ms>`，并给这些请求显式 `timeout`；下一次载荷红必须指向具体阶段，而不是只剩一句 `hook timeout`（本轮那条 38.3s 单请求正因为没有阶段计时，只能靠 trace 反推）。
4. **不动**判据命令、`expect`、任何徽标/分组/关闭断言；不加 `retries` / `skip` / `only`；不收窄用例。

**判别性**：负控必须能把「墙真的抬了」与「阈值写大但没生效」分开。在钩子体内 `test.setTimeout(SETUP_BUDGET_MS)` **之后**注入 70s 睡眠：新代码下必须 exit 0 并跑完断言；只删掉 `test.setTimeout` 那一行（保留睡眠，退回 60s project 墙）后同一段睡眠必须 exit 1，错误逐字为 `"beforeAll" hook timeout of 60000ms exceeded`。若注入点放在 `test.setTimeout` 之前，负控会因默认 60s slot 假红，这一点必须照做。

## AC

- [x] AC1 判据直跑稳定绿：连续 3 次 `npx playwright test e2e/resident-running-view.spec.ts` 均 `EXIT=0`；每次贴 `N passed`、spec 自报 `elapsed=`、`setup.timeout=240000`、`badge.reading=1`、`group.running.count=1`、`group.residentIdle.count=2`、该跑 `watchdog-state.json` 的 `{fired, ceilingMs}`、以及跑前 `uptime` 的 load1；3 次 `elapsed` 的最大值 ≤ `180_000`，且任何一次输出都不含 `[e2e] watchdog:` 越界行。
- [x] AC2 预算自洽且逐点可读：`grep -n "'resident-running-view.spec.ts': 240_000" playwright.config.ts` 命中 1 行；该 spec 的 `test.describe.configure(...)` 含 `timeout: 240_000`；运行输出含 `setup.timeout=240000`；自检阈值逐字为 `toBeLessThan(240_000)`；`quay goal show AC-173 --json` 的 `timeoutMs` == `260000`；`grep -n '^  timeout: 60_000,$' playwright.config.ts` 仍命中全局那一行、`grep -n 'SINGLE_SPEC_CEILING_MS = ' playwright.config.ts` 仍逐字为 `55_000`。以上读数全部原文贴出。
- [x] AC3 判据语义未动：`quay goal show AC-173 --json` 的 `criterion` 逐字仍为 `npx playwright test e2e/resident-running-view.spec.ts`，`expect` 逐字仍为本 Proposal 引用那两行，`status == "achieved"`、`goal == "GOAL-013"`；`git diff $(git merge-base develop HEAD) -- e2e/resident-running-view.spec.ts | grep -cE 'readBadge\(|toBe\(1\)|toBe\(2\)|close\.request|group\.'` == 0；diff 新增行中，除钩子首句 `test.setTimeout(SETUP_BUDGET_MS)` 外，匹配 `test\.skip|test\.only|retries|\.setTimeout\(` 的条数为 0；`describe`/用例标题与用例顺序不变。
- [x] AC4 判别性负控（墙真的抬了）：在钩子体内 `test.setTimeout(SETUP_BUDGET_MS)` **之后**临时插入 `await new Promise((resolve) => setTimeout(resolve, 70_000));`：(a) 现行代码跑同一条判据 → `EXIT=0`、`3 passed`、输出含 `setup.timeout=240000`；(b) 只删掉 `test.setTimeout(SETUP_BUDGET_MS)` 一行（保留 70s 睡眠）重跑 → `EXIT=1`，失败文本逐字含 `"beforeAll" hook timeout of 60000ms exceeded`。两次原始输出（含各跑 load1 与 elapsed）都贴出；完成后全部回滚，`git diff` 里不残留 70s 睡眠。
- [x] AC5 非目标：`git diff --name-only $(git merge-base develop HEAD)` 只含 `e2e/resident-running-view.spec.ts`、`playwright.config.ts`、`goals/AC-173-真实浏览器里-running-视图分正在运行与常驻-空闲-两组-侧栏徽标只计正在运行的会话.md`（以及本任务文件）；`src/**`、`server/**` 无改动；`npm run typecheck` exit 0。

## DoD

- 真实浏览器证据来自判据本身（本任务不改产品 UI，AGENTS.md 的 MCP 浏览器截图那一条不适用；需要的是 spec 在真实浏览器里跑出的读数）：把 AC1 三次绿跑的 `badge.reading=1`、`group.running.count=1`、`group.residentIdle.count=2`、`close.request=200`、`hosts.beforeClose=2 hosts.afterClose=1`、`badge.afterExtra=2` 与 `setup.phase=` 计时逐行贴进 Evidence。
- Evidence 贴三张表：AC1 的 3 次直跑（命令 / rc / `N passed` / `elapsed` / `setup.timeout` / `load1` / watchdog 状态）、AC4 的两次负控（新预算 exit 0 / 退回 60s exit 1 及逐字错误）、AC2+AC3 的声明与未动读数。
- 完成时读一次主检出 `.quay/gate-events.jsonl` 里 AC-173 的最后一条，把该条原文贴出；若该轮尚未更新，如实写明并贴最近的读数，不作推断。
- `node --no-warnings /data/home/yale/.claude/plugins/cache/quay/quay/0.24.0/scripts/dist/anti-drift-touches-check.js --task gap-ac173-beforeall-hook-keeps-global-60s-wall --worktree <worktree> --merge-target develop` 通过（贴 `ANTI-DRIFT OK` 行）。
- `npm run typecheck` exit 0；worktree `git status --short` 在记录完成时为空。

## Evidence

### AC1 连续三次直跑（最终代码 commit `c2fbc2abf`；run5 在 merge develop 前、run6–7 在 merge develop `f6ebcbf1c` 后，本任务三文件不受该 merge 影响）

命令均为 `npx playwright test e2e/resident-running-view.spec.ts`（在 worktree 根目录、真实浏览器 + 真实 server 下直跑）。

| 跑 | rc | N passed | spec `elapsed` | `setup.timeout` | 跑前 load1 | `watchdog-state.json` |
| -- | -- | -------- | -------------- | --------------- | ---------- | --------------------- |
| 5 | 0 | `3 passed (37.3s)` | `37445ms` | `240000` | 41.13 | `fired:false, ceilingMs:240000` |
| 6 | 0 | `3 passed (37.8s)` | `39242ms` | `240000` | 25.02 | `fired:false, ceilingMs:240000` |
| 7 | 0 | `3 passed (37.4s)` | `38151ms` | `240000` | 30.84 | `fired:false, ceilingMs:240000` |

- 3 次 `elapsed` 最大值 = `39242ms` ≤ `180_000`。
- 3 次输出中 `^\[e2e\] watchdog:` 越界行计数均为 **0**。
- 补充（行为相同的更早轮次；run1 的最终差异只是日志标签）：run1–4 也均 `EXIT=0`，`3 passed`，`elapsed=42607/46852/37402/37415ms`，跑前 load1 = `38.65/151.89/176.25/102.73`；run2–4 的 `watchdog-state.json` 亦为 `fired:false, ceilingMs:240000`。

三次直跑实测读数形状相同（下列省略每次不同的会话 id）：

```
setup.timeout=240000 test.timeout=240000
hosts.running=1 hosts.residentIdle=2 hosts.total=2 badge.reading=1
group.running.count=1
group.residentIdle.count=2
close.before hosts.beforeClose=2 group.running.count=1 group.residentIdle.count.before=2 badge.reading=1
close.request=200
hosts.beforeClose=2 hosts.afterClose=1
badge.afterExtra=2 badge.reading=1 hosts.total=2
shared.perBinding=1 shared.perHost=2 badge.reading=1
```

run7 的 `setup.phase=` 计时（每阶段一行，准备阶段终于可归因）：

```
setup.phase=register elapsed=585ms
setup.phase=complete-onboarding elapsed=2168ms
setup.phase=armScenario.inFlight elapsed=1302ms
setup.phase=armScenario.control elapsed=77ms
setup.phase=armScenario.idleA elapsed=69ms
setup.phase=armScenario.idleB elapsed=333ms
setup.phase=armScenario.residentTurn elapsed=141ms
setup.phase=readHosts elapsed=180ms
setup.phase=warmClientStartup elapsed=2169ms
setup.phase=navigate elapsed=1951ms
setup.phase=revealSession elapsed=225ms
```

### AC4 判别性负控

(a) 在 `test.setTimeout(SETUP_BUDGET_MS)` **之后**插入 `await new Promise((resolve) => setTimeout(resolve, 70_000));`，现行代码重跑：

```
EXIT=0
setup.timeout=240000 test.timeout=240000
  3 passed (1.7m)
elapsed=101264ms
跑前 load average: 57.15, 69.99, 48.57
```

(b) 只删掉 `test.setTimeout(SETUP_BUDGET_MS);` 一行（保留 70s 睡眠）重跑：

```
EXIT=1
    "beforeAll" hook timeout of 60000ms exceeded.
  1 failed
  2 did not run
跑前 load average: 30.20, 56.43, 45.96
```

回滚：`grep -c "70_000" e2e/resident-running-view.spec.ts` = `0`；负控编辑未留在提交里（`git diff` 干净，最终 commit `c2fbc2abf`）。

### AC2 预算自洽读数（原文）

```
$ grep -n "'resident-running-view.spec.ts': 240_000" playwright.config.ts
790:  'resident-running-view.spec.ts': 240_000,

$ grep -n "test.describe.configure({ mode: 'serial', timeout: 240_000 })" e2e/resident-running-view.spec.ts
825:test.describe.configure({ mode: 'serial', timeout: 240_000 });

$ grep -n "toBeLessThan(240_000)" e2e/resident-running-view.spec.ts
1253:    expect(elapsed, 'the whole invocation, measured from the config’s own start').toBeLessThan(240_000);

运行输出：setup.timeout=240000 test.timeout=240000

$ grep -n '^  timeout: 60_000,$' playwright.config.ts
3743:  timeout: 60_000,

$ grep -n 'SINGLE_SPEC_CEILING_MS = ' playwright.config.ts
374:const SINGLE_SPEC_CEILING_MS = 55_000;
```

- `quay goal get AC-173 --json --store --root <worktree>` ⇒ `"timeoutMs": 260000`。
  说明：不带 `--store --root <worktree>` 的 `quay goal show AC-173 --json` 读的是主检出 store（`/data/home/yale/work/claudecodeui/goals`，当前分支 `author`），在本次改动 merge 进该检出之前仍报旧值 `118000`；本任务要改的正是 worktree 里这份 record，store 方言读出的 `260000` 才是对本次改动的读数。四道墙：hook 240s = `SPEC_BUDGET_MS` 240s = `describe.configure` 240s = 自检 240s，闸 260s 留 20s 给看门狗写越界线。

### AC3 判据语义未动

`quay goal get AC-173 --json --store --root <worktree>` 原文：

```
"status": "achieved"
"goal": "GOAL-013"
"criterion": "npx playwright test e2e/resident-running-view.spec.ts"
"expect": "调试 agent 场景造出一个运行中的会话与两个空闲常驻会话：侧栏 Running 徽标读数为 1；Running 视图两组各列出对应会话，第二组每行有关闭按钮，点击后该会话宿主关闭、从该组消失。取假形态：徽标计入空闲常驻会话 ⇒ 读数 3，必须红。"
```

- `git diff $(git merge-base develop HEAD) -- e2e/resident-running-view.spec.ts | grep -E '^\+' | grep -cE 'readBadge\(|toBe\(1\)|toBe\(2\)|close\.request|group\.'` = `0`。
- diff 新增行中匹配 `test\.skip|test\.only|retries|\.setTimeout\(` 的只有 `+    test.setTimeout(SETUP_BUDGET_MS);`（钩子首句，AC3 豁免），其余 = `0`。
- `test.describe(...)`/用例标题与顺序无 diff 行。

### AC5 非目标与类型

```
$ git diff --name-only $(git merge-base develop HEAD)
e2e/resident-running-view.spec.ts
goals/AC-173-真实浏览器里-running-视图分正在运行与常驻-空闲-两组-侧栏徽标只计正在运行的会话.md
playwright.config.ts
```

- （本任务文件 `tasks/gap-ac173-beforeall-hook-keeps-global-60s-wall.md` 由这次 task_write 单独提交，同样在 Touches 内。）
- `src/**`、`server/**` 无改动。
- `npm run typecheck` ⇒ `TYPECHECK_EXIT=0`（最终代码复跑）。

### DoD：主检出 AC-173 台账最后一条（原文）

```
{"id":"03c375b6-5b93-42df-a180-6a23e07047af","item_id":"AC-173","pipeline_id":"AC-173","gate":"goal","actor":"goal-cli","verdict":"pass","timestamp":"2026-10-29T13:58:54.864Z","payload":{"reason":"acceptance passed (exit 0)","evaluationRoot":"/data/home/yale/work/claudecodeui","treeSha":"ebdaf9e25e5c8b4f8e0ac2634c3cacf639a31f35"}}
```

如实说明：该条 `treeSha` 是主检出（`author`）的树，不是本 worktree 的修复树；它是同一条判据在旧代码上的又一次通过（本任务立案所依据的正是同树 6 分钟内 pass/fail/pass），不能当作本次修复的证据。本次修复的证据是上面的 AC1/AC4 直跑。

### 反漂移

退出前最终复跑（worktree `git status --short` 为空，`develop` 已是祖先）：`ANTI-DRIFT OK: task gap-ac173-beforeall-hook-keeps-global-60s-wall — 4 actual file(s), all within declared Touches (4 glob(s))`。四个文件 = 3 个实现文件 + 本任务文件；本任务文件的最新一次 task_write 是 self-only 提交，分支落地前不会出现在 `develop` 上，故按 `--merge-target develop` 比较计为第 4 个。

开发过程中另一次复跑（该 task_write 提交已被 develop 吸收时）为 `ANTI-DRIFT OK: task gap-ac173-beforeall-hook-keeps-global-60s-wall — 3 actual file(s), all within declared Touches (4 glob(s))`。计数在 3–4 之间只因 `tasks/<id>.md` 是否已随 develop 进入本分支；两次都没有 Touches 之外的改动。

## ADR-007 暗轴

该轴仍暗,理由:本任务只改 e2e 时间预算与准备阶段计时，未改产品代码或架构图，L_D/L_G 无测量对象（判据产物是运行输出而非代码图）。

## Touches

- e2e/resident-running-view.spec.ts
- playwright.config.ts
- goals/AC-173-真实浏览器里-running-视图分正在运行与常驻-空闲-两组-侧栏徽标只计正在运行的会话.md
- tasks/gap-ac173-beforeall-hook-keeps-global-60s-wall.md

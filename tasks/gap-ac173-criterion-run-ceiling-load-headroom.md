---
id: gap-ac173-criterion-run-ceiling-load-headroom
title: AC-173 判据反复撞上 55s 单 spec 运行天花板与 60s 闸 deadline 而假红（本树健康轮 elapsed=53157ms
  只剩 1843ms；同树近 30 分钟 10 拍 2 拍在 55005ms 红）：为这条三宿主真实浏览器判据声明运行预算并同步抬高记录
  deadline，判据命令与全部断言逐字不动
status: todo
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

<!-- dedup-ref --> **机制去重与粒度（本轮立案实测，2026-10-29T12:44Z，checkout `/data/home/yale/work/claudecodeui`，branch `author`，`git rev-parse HEAD` = `d3254887401c94a1903c169d5bbc4ec9751261ac`，`HEAD^{tree}` = `cb76f97cdf79fa840265a48f007fee8e11a35785`，`date -u` = `Thu Oct 29 12:44:51 UTC 2026`，`uptime` load1 = `40.82`）**：`grep -rl '^goal_ac: *AC-173' tasks/` 命中 6 份，`status:` 逐字皆 **done** —— `gap-claude-resident-running-view`、`gap-resident-running-view-criterion-bounded-boot-guard`、`gap-ac173-badge-source-mismatch-after-dock-consolidation`、`gap-ac173-ledger-red-is-uncommitted-composer-wip`、`gap-ac173-ledger-red-is-boot-ceiling-crossed`、`gap-ac173-criterion-boot-crossing-unattributable`。在飞扫描（逐份读 `tasks/*.md` 的 `^status:` ∈ {todo,ready,needs-human}）全库只有 7 份（`gap-ac436/437/438/441/442` 五条 codex-resident、`gap-cockpit-card-surface-polish`、`gap-goal-051-turn-steer-not-an-ac`），**无一认领 AC-173** ⇒ 无在飞认领者，本条不是重复。按「done 不是重复、是更早修法没兜住的证据」逐份核过，见下节。合并候选检查用仪器而非手搓：`node /data/home/yale/.claude/plugins/cache/quay/quay/0.24.0/scripts/dist/task-granularity-advice.js --touches playwright.config.ts --touches e2e/resident-running-view.spec.ts --json` ⇒ `peers: []`、`mentions: []`（`perFile`: `playwright.config.ts` nLanded=104 / medianFileChangedLines=20，`e2e/resident-running-view.spec.ts` nLanded=3 / medianFileChangedLines=242）⇒ **kept separate**，无合并对象。

**判据物（逐字取自 `goals/AC-173-真实浏览器里-running-视图分正在运行与常驻-空闲-两组-侧栏徽标只计正在运行的会话.md`）**：`criterion:` = `npx playwright test e2e/resident-running-view.spec.ts`；`expect:` 逐字「调试 agent 场景造出一个运行中的会话与两个空闲常驻会话：侧栏 Running 徽标读数为 1；Running 视图两组各列出对应会话，第二组每行有关闭按钮，点击后该会话宿主关闭、从该组消失。取假形态：徽标计入空闲常驻会话 ⇒ 读数 3，必须红。」该 AC `status: achieved`，其 GOAL-013 已 achieved 且不再活，未声明 `long-term: true`；记录当前**没有** `timeoutMs`。

### 本轮直接测量（不是台账尾巴）

**判据直跑（同一棵树、同一条逐字命令，无 `-g`、无 retries）**：`npx playwright test e2e/resident-running-view.spec.ts` → **EXIT=0**，`3 passed (43.1s)`；spec 自报 `elapsed=53157ms`，`/usr/bin/time -v` 墙钟 `54.70s`；`/data/home/yale/.cache/quay-e2e-tmp/quay-e2e-CqPhok/watchdog-state.json` = `{"armed":true,"fired":false,"ceilingMs":55000,"detail":"boot completed at 19147ms (config-eval-ms=10750), re-armed to 55000ms from the run start"}`。分阶段：vite-cache seed **10532ms**、boot 到 **19147ms**、主用例 **26.2s**、locale 用例 6ms、自检 0ms。健康轮离天花板只剩 **1843ms**。

**台账（`.quay/gate-events.jsonl`，2026-10-29 12:13–12:43Z 共 10 拍，同一条判据）**：8 pass、**2 fail**，两次 red 都停在同一个读数上 ——
- `12:27:25.338Z` tree `50ddb09b2a7fb601cdeaf3057b399d22f9f4577d`：`[e2e] watchdog: this run crossed its own 55000ms ceiling at 55005ms (config-eval-ms=934) and is ending here with exit 1 at 55009ms — stuck at stage "browser-launch-or-cases": observed past boot at 13988ms ... both webServers answered the 2000ms probe at the crossing.`
- `12:43:55.112Z` tree `cb76f97cdf79fa840265a48f007fee8e11a35785`（**= 本树 `HEAD^{tree}`**）：`... at 55005ms (config-eval-ms=1164) ... observed past boot at 4667ms ...`

⇒ 同一棵树、同一条命令：一次 exit 0（余量 1843ms），一次在 55005ms 被判据自己的看门狗**在任何断言之前**打死。绿与红都不反映担保，反映的是整轮墙钟是否漂过 55s 这条线。

### 机制：三道 60s 附近的墙都没有覆盖这条重场景

- **运行天花板**：单文件判据的 `RUN_CEILING_MS` 取 `SINGLE_SPEC_CEILING_MS`（`playwright.config.ts:374` = `55_000`），因为 `e2e/resident-running-view.spec.ts` **不在** `SPEC_BUDGET_MS`（`:376` 起）里。
- **闸 deadline**：AC-173 记录没有 `timeoutMs`，`resolveAcceptanceTimeout(rec.timeoutMs)` 落到 `source:"default"` 的 `60_000`。
- **per-test 墙**：`playwright.config.ts:3728` 的全局 `timeout: 60_000`；主用例健康轮已 26.2s，载荷一涨就会先撞 60s 的 `Test timeout`。
- 这条判据不是轻 spec：它要起**三宿主**（一个 per-run turn 宿主 + 一个复用的 resident 宿主）、驱动 3 个会话、4 次 `waitForBadge`（每次等页面自己的 5s 轮询）、多次宿主启停与关闭。本树健康轮 = config 求值 10.75s（含 seed 10.53s）+ boot 8.4s + 主用例 26.2s；两拍 red 的 boot 分别只用了 14.0s / 4.7s，越界发生在 boot 之后。
- spec 自己的第三条用例（`e2e/resident-running-view.spec.ts:1174`）把 `elapsed` 钉在 `toBeLessThan(55_000)`（`:1178`），与看门狗同一条线 ⇒ 即便看门狗不先开火，这条自检也会把 >55s 的健康轮判红。三道墙合起来使「担保为假」与「这条重场景在本机常态载荷下就是要 ~50s」不可区分。

### 前面 6 个 done 为什么没兜住（每一份治的都是别的界/别的读数源）

- `gap-resident-running-view-criterion-bounded-boot-guard`：治 spec 体内、`beforeAll` 之后的有界导航（`e963c8674`），预算仍是 55s 以内。
- `gap-ac173-criterion-boot-crossing-unattributable`：治 **40s boot 天花板**的起点与分类（boot 窗口从 config 求值末尾起算、加 stage 分类），其完成记录逐字写下 `RUN_CEILING_MS = SINGLE_SPEC_CEILING_MS = 55_000` 且当时 18 次绿跑最大 49.8s —— 它**没有**动运行预算，只是当时离 55s 还有 5s。
- `gap-ac173-ledger-red-is-boot-ceiling-crossed` 与 `gap-ac173-ledger-red-is-uncommitted-composer-wip`：verification-only 归因（前者是 40s boot 越界，后者是主检出 composer WIP 在判据运行期被 Vite HMR 推给页面）。
- `gap-ac173-badge-source-mismatch-after-dock-consolidation`：治徽标**数据源**（坞合并后改用 runningSessions 轮询）。
- `gap-claude-resident-running-view`：常驻 Running 视图本体。

⇒ 此前每一次 red 都被解释成另一个原因；本轮的成对读数（同树 53.2s 绿 / 55.0s 红）指向唯一剩下的机制：**三道墙都没有覆盖这条判据在本机常态载荷下的墙钟**。

### 修法（只动预算与 deadline，判据语义逐字不动）

按仓库成例（`chore(goals): declare timeoutMs ...`、AC-315/316/317/319、AC-323 的 `timeoutMs`）为这条重场景**声明**预算，而不是收窄判据去换 60s：
1. 在 `playwright.config.ts` 的 `SPEC_BUDGET_MS` 为 `resident-running-view.spec.ts` 声明 **`110_000`**（> 本机健康墙钟的 ~2 倍，且严格小于下面的 deadline），并按该表既有体例写一条说明注释（实测读数与余量）。
2. 在 AC-173 记录 frontmatter 声明 **`timeoutMs: 118000`**；`criterion` / `expect` / `status` / `goal` / `origin` 逐字不动。`quay goal gate` 的 `resolveAcceptanceTimeout(rec.timeoutMs)` 以记录优先（`vendor/quay-native/dist/quay-native.js` 的 `gate-run-options` 段），闸的 deadline 因此从 60000 变为 118000，判据能把自己的结论写出来。
3. 把 spec 的两处同线常量改成与新运行预算一致：`test.describe.configure({ mode: 'serial' })`（`:764`）加 `timeout: 110_000`，自检阈值改 `toBeLessThan(110_000)` 并让其用例名/消息不再声称 60s 是 kill 线。否则 per-test 墙与自检会各自把 >55s 的健康轮判红。
4. **不动** `SINGLE_SPEC_CEILING_MS`（仍 `55_000`，默认值留给其它 spec）、不动判据命令、不收窄/不删除任何徽标、分组、关闭断言、不加 `retries`/`skip`/`only`。

**为什么要带判别性读数**：单纯把阈值调大无法证明改动不是空转。用已出货的控制臂 `QUAY_E2E_CONFIG_EVAL_STALL_MS`（`scripts/e2e-run-ceilings.mjs` 的 `stallConfigEvaluation`，config 在 seed 之后同步停摆、只由 data-dir owner 支付；config 开头 `if (!process.env.QUAY_E2E_RUN_STARTED_AT)` 的 first-writer-wins 让 worker 继承同一 run 起点）把整轮人为拖过 55s：旧预算下这是必红的 `crossed its own 55000ms ceiling`，新预算下必须 exit 0 且 `elapsed` 落在 `(55000, 110000)`。

## AC

- [ ] AC1 判据直跑稳定绿：在本树连续 3 次 `npx playwright test e2e/resident-running-view.spec.ts` 均 `EXIT=0`；每次都贴 `N passed`、spec 自报 `elapsed=`、该跑 `watchdog-state.json` 的 `{fired, ceilingMs}`、以及跑前 `uptime` 的 load1；3 次 `elapsed` 的最大值 ≤ `82_500`（= 声明预算 `110_000` 的 75%），且 3 次输出都没有 `[e2e] watchdog:` 越界行。
- [ ] AC2 声明与次序：`playwright.config.ts` 的 `SPEC_BUDGET_MS` 含 `'resident-running-view.spec.ts'` 且值为 `110_000`；`e2e/resident-running-view.spec.ts` 的 `test.describe.configure(...)` 含 `timeout: 110_000`；`quay goal show AC-173 --json` 的 `timeoutMs` == `118000`；`grep -n 'SINGLE_SPEC_CEILING_MS = ' playwright.config.ts` 仍逐字为 `55_000`；`SPEC_BUDGET_MS` 里其它条目逐字未变。五条读数全部贴出。
- [ ] AC3 判别性负控（拖过旧线）：`QUAY_E2E_CONFIG_EVAL_STALL_MS=15000 npx playwright test e2e/resident-running-view.spec.ts` → `EXIT=0`，spec 自报 `elapsed` > `55000` 且 ≤ `110_000`，该跑 `watchdog-state.json` 为 `fired:false`、`ceilingMs: 110000`；并贴 `git show $(git merge-base develop HEAD):playwright.config.ts | grep -n 'SINGLE_SPEC_CEILING_MS = 55_000'` 与 `git show $(git merge-base develop HEAD):e2e/resident-running-view.spec.ts | grep -n 'toBeLessThan(55_000)'` 均非空，证明同一读数在基线必红。
- [ ] AC4 闸自证：`quay goal gate AC-173 --root <本任务 worktree> --json` exit 0，stdout 的 `verdict` == `"pass"`、`cause` == `null`、`timeoutMs` == `118000`、`event.payload.treeSha` == `git -C <worktree> rev-parse HEAD^{tree}`、`reason` 以 `acceptance passed (exit 0)` 开头；原文贴出。
- [ ] AC5 判据语义未动：`quay goal show AC-173 --json` 的 `criterion` 逐字仍为 `npx playwright test e2e/resident-running-view.spec.ts`，`expect` 逐字仍为本 Proposal 引用的那两行，`status` == `achieved`、`goal` == `GOAL-013`；`git diff $(git merge-base develop HEAD) -- goals/` 的增删行只有 `timeoutMs` 那一行（允许 YAML 引号/折行归一的空白差异，逐字段值不变）。
- [ ] AC6 spec 只动预算常量：`git diff $(git merge-base develop HEAD) -- e2e/resident-running-view.spec.ts` 只改 `test.describe.configure` 的 `timeout` 与自检用例的阈值/用例名/消息；diff 新增行匹配 `test\.skip|test\.only|retries|\.setTimeout\(` 的条数为 `0`；判据文件名、`describe` 标题、用例顺序不变。
- [ ] AC7 假形态仍必须红：spec 里那组判别断言逐字未动 —— 两个常驻 idle 被同一宿主持有时 `readBadge(...).reading ... toBe(0)`、一个 per-run turn 在飞时 `badge.reading` 为 `1` 且 `hosts.total` 为 `2`、第二个 turn 在飞时 `toBeGreaterThan(...)` 与 `toBe(2)`；`git diff $(git merge-base develop HEAD) -- e2e/resident-running-view.spec.ts | grep -cE 'readBadge|residentsOnly|hosts\.total'` == `0`。
- [ ] AC8 非目标：`goals/` 下除 AC-173 外无改动；`src/**`、`server/**` 无改动；`npm run typecheck` exit 0。

## DoD

- 真实浏览器证据来自判据本身（本任务不改产品 UI，故 AGENTS.md 的 MCP 浏览器 + 截图那一条不适用；需要的是 spec 在真实浏览器里跑出的读数）：把 AC1 三次绿跑的 `badge.reading=1`、`group.running.count=1`、`group.residentIdle.count=2`、`close.request=200`、`hosts.beforeClose=2 hosts.afterClose=1`、`badge.afterExtra=2` 逐行贴进 Evidence。
- Evidence 里贴三张表：AC1 的 3 次直跑（命令 / rc / `N passed` / `elapsed` / `load1` / watchdog 状态）、AC3 的 stall 跑（同上加 `QUAY_E2E_CONFIG_EVAL_STALL_MS=15000`）、AC4 的 gate JSON 原文；并贴 AC2 的五条声明读数。
- 完成时读一次主检出 `.quay/gate-events.jsonl` 里 AC-173 的最后一条，把该条原文贴出；若该轮尚未更新，如实写明并贴最近的读数，不作推断。
- `node --no-warnings /data/home/yale/.claude/plugins/cache/quay/quay/0.24.0/scripts/dist/anti-drift-touches-check.js --task gap-ac173-criterion-run-ceiling-load-headroom --worktree <worktree> --merge-target develop` 通过（贴 `ANTI-DRIFT OK` 行）。
- `npm run typecheck` exit 0；worktree `git status --short` 在记录完成时为空。

## Touches

- playwright.config.ts
- e2e/resident-running-view.spec.ts
- goals/AC-173-真实浏览器里-running-视图分正在运行与常驻-空闲-两组-侧栏徽标只计正在运行的会话.md
- tasks/gap-ac173-criterion-run-ceiling-load-headroom.md
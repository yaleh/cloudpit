---
id: gap-ac172-criterion-run-budget-below-cold-start-wall
title: AC-172 判据仍压在 55s 默认单文件预算上：冷轮 config-eval 7469ms、直至 22659ms 才越过 boot，比热轮多
  18835ms，同树 13:43:31Z pass / 13:47:44Z 在 55006ms 被看门狗杀掉；给 resident-status-bar
  声明 SPEC_BUDGET_MS 并把 describe/钩子/自检/闸四处预算调自洽，判据命令与断言逐字不动
status: ready
labels:
  - gap
  - defect
parent: null
children: []
extra:
  schema: execution
goal_ac: AC-172
---
## Proposal

来源：本轮 gap-filing 的**直接测量**（不是台账尾巴）。AC-172 `status: achieved`，其 GOAL-013 已 achieved 且不再活，且未声明 `long-term: true`；台账尾部 `2026-11-02T13:47:44.294Z` 记为 fail（exit 1），故按 CURRENTLY FALSE 立案。

<!-- dedup-ref --> **机制去重（本轮立案实测，checkout `/data/home/yale/work/claudecodeui`，`date -u` = Mon Nov 2 01:49 UTC 2026，`uptime` load1 = 138.16）**：`grep -rl '^goal_ac: *AC-172' tasks/*.md` 命中 7 份，`status:` 逐字皆 **done** —— `gap-claude-resident-status-bar`、`gap-resident-status-bar-criterion-bounded-boot-guard`、`gap-ac172-criterion-anchor-retired-by-dock-consolidation`、`gap-ac172-criterion-i18n-key-table-retired-counts`、`gap-ac172-criterion-reload-unbounded-net-churn`、`gap-ac172-reload-landing-races-absolute-walk-plateau`、`gap-ac172-session-row-locator-shadowed-by-mode-switch`。在飞扫描（`^status:` ∈ {todo, ready, needs-human} 的 `^goal_ac:` 集合）无一认领 AC-172 ⇒ **无在飞认领者**，本条不是重复；按「done 不是重复、是更早修法没兜住的证据」逐份核过，见下节。合并候选检查用仪器而非手搓：`node /data/home/yale/.claude/plugins/cache/quay/quay/0.31.1/scripts/dist/task-granularity-advice.js --touches playwright.config.ts --touches e2e/resident-status-bar.spec.ts --touches "goals/AC-172-真实浏览器里常驻会话的状态标记-状态条与关闭按钮反映宿主状态-无人轮带触发类型标签.md" --json` ⇒ `peers: []`、`mentions: []`（`perFile`: `playwright.config.ts` nLanded=108、`e2e/resident-status-bar.spec.ts` nLanded=9、该 goal 记录 nLanded=2）⇒ **kept separate**，无合并对象。

**判据物（逐字取自 `goals/AC-172-真实浏览器里常驻会话的状态标记-状态条与关闭按钮反映宿主状态-无人轮带触发类型标签.md`）**：`criterion:` = `npx playwright test e2e/resident-status-bar.spec.ts`；`expect:` 逐字「后端用调试 agent 的常驻场景驱动（不拉起 claude）：未运行、空闲、运行中、exited(oom) 四种状态下，侧栏图标与会话内状态条分别显示 proposal §15.1 规定的形态，状态条的定时任务与监视计数等于宿主保活理由的数目；popover 里能复制 SendMessage 地址并能关闭常驻进程；composer 的停止按钮只中止当前一轮、进程仍在；无人轮前有触发类型分隔标签，跨会话消息显示发送方，且不以用户消息样式显示。取假形态：(a) 状态条读本地状态而不读宿主接口 ⇒ 场景切换状态后读数必须红；(b) 无人轮以用户消息样式显示 ⇒ 必须红。」该记录当前**无** `timeoutMs` 字段（goal gate 按默认 60000ms 击杀）。

### 本轮直接测量（同一份代码，4 分钟内 pass / fail）

- **红**：`2026-11-02T13:47:44.294Z`（`.quay/gate-events.jsonl`，`item_id=AC-172`、`gate=goal`、`verdict=fail`、`treeSha=fc30bbf71f50c3495b9a0f27200bc34b94d611ec`），`payload.reason` 逐字：
  `acceptance failed (exit 1) — [e2e] watchdog: this run crossed its own 55000ms ceiling at 55006ms (config-eval-ms=7469) and is ending here with exit 1 at 55013ms — stuck at stage "browser-launch-or-cases": observed past boot at 22659ms, so this run was inside browser launch or a case; both webServers answered the 2000ms probe at the crossing.`
- **同树绿**：`2026-11-02T13:43:31.816Z`，同一 `treeSha=fc30bbf71f50c3495b9a0f27200bc34b94d611ec`，`verdict=pass`、`reason="acceptance passed (exit 0)"` ⇒ 4 分钟内同树 fail→pass，红不是产品回归。
- **本轮直跑**（`npx playwright test e2e/resident-status-bar.spec.ts`，真实浏览器 + 真实 server，EXIT=0）：
  - run1：`4 passed (34.9s)`，spec 自报 `elapsed=35612ms`；跑前 load1 = 138.16。
  - run2：`4 passed (35.7s)`，`elapsed=35261ms`；`[e2e] watchdog-armed: config-eval-ms=252`、`[e2e] boot: both webServers answered at 3572ms`；跑前 load1 = 37.62。
- **预算账（这次红是量具的预算，不是断言）**：失败轮 `config-eval-ms=7469`、`observed past boot at 22659ms`（该数从 run start 起算，已包含 config 求值）；热轮 pre-case 只花 `252 + 3572 = 3824ms`。冷/热差 = `22659 − 3824 = 18835ms`。健康整轮 35.3–35.6s 加上这段差 ⇒ ~54.1s，距 55_000ms 只剩 ~0.9s；实测这一跑在 `55006ms` 越界 6ms，看门狗在四条用例的断言完成之前 `process.exit(1)`，台账因此读到 fail。

### 机制：55s 默认单文件预算从未被这条判据声明

- `playwright.config.ts:374` `SINGLE_SPEC_CEILING_MS = 55_000`；`SPEC_BUDGET_MS` **没有** `resident-status-bar.spec.ts` 条目 ⇒ 本判据的单文件调用 `RUN_CEILING_MS = 55000`。
- spec 的 `beforeAll` 继承 project 的 `timeout: 60_000`（`playwright.config.ts:3877`）；`test.describe.configure` 只写 `mode`，抬不到钩子墙；末尾自检 test 把阈值硬编码为 `55_000`（`e2e/resident-status-bar.spec.ts:1227`）。
- AC-172 记录**无** `timeoutMs` ⇒ goal gate 按默认 60000ms 击杀，越界线与闸线只差 5s，看门狗来不及留下可读的越界证据。
- 同族兄弟 AC-173 已做过同一治理：`5f6d8956` 在 `SPEC_BUDGET_MS` 声明 110_000 并把 describe/自检/记录 `timeoutMs` 调自洽；`c2fbc2ab` 再抬到 240_000，并补 `test.setTimeout(SETUP_BUDGET_MS)`（钩子不吃 `describe.configure` 的 timeout）。AC-172 至今没有这一层。

### 上一轮 `gap-resident-status-bar-criterion-bounded-boot-guard` 为什么没兜住

它（done，commit `b57428a1`）把家族既有的有界预热（`warmClientStartup`）与有界启动探针（`navigateBounded`）搬进本 spec，治的是「无界等待被拖成 30s 夹具行超时」；它明确「60s 门限与 55s spec 上限不动」，AC4 实测 31.8–32.6s，当时 load1 只有 10.9–13.2。它改变的是**等待的响应方式**，没有改变**整轮可花的墙**。冷缓存 + 高负载把 config 求值 + boot 从 3.8s 抬到 22.7s 时，同一保证换了一堵墙被杀：这次是 `RUN_CEILING_MS`，不是夹具行断言。判据仍由量具的预算决定，而不是由四条产品断言决定。

### 修法（只动预算与自检阈值，判据语义逐字不动）

1. `playwright.config.ts` 的 `SPEC_BUDGET_MS` 增加 `'resident-status-bar.spec.ts': 240_000`，注释带上本轮读数（22659ms 冷轮越过 boot / 3824ms 热轮 / 35.3–35.6s 健康整轮 / 55006ms 越界）。240_000 与同族 `resident-running-view.spec.ts` 的已声明值一致，约 6.7× 健康整轮、10.6× 冷轮 pre-case。
2. `e2e/resident-status-bar.spec.ts` 增 `const SPEC_BUDGET_MS = 240_000;`，把同一个数接到**三面**：`test.describe.configure({ mode: 'serial', timeout: SPEC_BUDGET_MS })`；`beforeAll` 体内首句 `test.setTimeout(SPEC_BUDGET_MS)`（钩子墙，`describe.configure` 抬不到它）；末尾自检 test 更名 `the run ends inside its declared spec budget` 并断言 `elapsed < SPEC_BUDGET_MS`。
3. `goals/AC-172-…md` frontmatter 增 `timeoutMs: 260000`（闸 > 看门狗 240s，留 20s 让看门狗越界时写 `watchdog-state.json`、打印一行并退出，而不是被闸静默 SIGKILL）。
4. **明确不动**：`criterion:` 命令；`expect:` 全文；四条产品断言（四态行走、popover 地址与关闭、停止只中止一轮、无人轮分隔/发送方/非用户样式）与两条假形态臂；`SINGLE_SPEC_CEILING_MS = 55_000`（别的 spec 不受影响）；全局 `timeout: 60_000`；不加 `retries` / `skip` / `only`；不改产品 `src/**`、`server/**`。

**判别性**（必须把「预算真的被读」和「数字写大但没接线」分开）：
- 负控 A：把 config 里的 `240_000` 临时改成 `30_000`（低于已实测 35.3s 健康整轮），判据必须 exit 1 且看门狗行逐字含 `crossed its own 30000ms ceiling`；还原 240_000 后回到 exit 0。
- 负控 B：把 `beforeAll` 的 `test.setTimeout(SPEC_BUDGET_MS)` 临时改成 `test.setTimeout(1_000)`，判据必须 exit 1 且失败文本逐字含 `"beforeAll" hook timeout of 1000ms exceeded`；还原后回到 exit 0。

## AC

- [x] AC1 直跑稳定绿：连续 5 次 `npx playwright test e2e/resident-status-bar.spec.ts` 均 `EXIT=0`；每次贴 `N passed`、spec 自报 `elapsed=`、该跑 `watchdog-state.json` 的 `{fired, ceilingMs}`、跑前 `uptime` 的 load1；5 次 `elapsed` 的最大值 < `240_000`，且任何一次输出都不含 `[e2e] watchdog:` 越界行。其中至少一次跑前 load1 ≥ 60；若宿主当时给不出该负载，如实登记实际 load1，不得伪造。
- [x] AC2 预算自洽且逐点可读：`grep -n "'resident-status-bar.spec.ts': 240_000" playwright.config.ts` 命中 1 行；`grep -n "const SPEC_BUDGET_MS = 240_000" e2e/resident-status-bar.spec.ts` 命中 1 行；`test.describe.configure(...)` 含 `timeout: SPEC_BUDGET_MS`；`beforeAll` 体内含 `test.setTimeout(SPEC_BUDGET_MS)`；自检断言逐字为 `toBeLessThan(SPEC_BUDGET_MS)`；`quay goal get AC-172 --json --store --root <worktree>` 的 `timeoutMs` == `260000`（不带 `--store --root` 的 Provider 读法读主检出记录，改动 merge 前仍报无该字段，须用 store 方言读 worktree 里的记录）；`grep -n 'SINGLE_SPEC_CEILING_MS = ' playwright.config.ts` 仍逐字为 `55_000`；`grep -n '^  timeout: 60_000,$' playwright.config.ts` 仍命中全局那一行。以上读数全部原文贴出。
- [x] AC3 判据语义未动：`quay goal get AC-172 --json --store --root <worktree>` 的 `criterion` 逐字仍为 `npx playwright test e2e/resident-status-bar.spec.ts`，`expect` 逐字仍为本 Proposal 引用那一段，`status == "achieved"`、`goal == "GOAL-013"`；`git diff $(git merge-base develop HEAD) -- e2e/resident-status-bar.spec.ts | grep -c '^-.*expect('` == 0；四条产品断言仍逐字在文件中（`data-resident-state`、`ADDRESS`、`completedAborts`、`isUserStyle` 各命中行数 ≥ 1，且与 merge-base 的行数相同）；新增行中，除钩子首句 `test.setTimeout(SPEC_BUDGET_MS)` 外，匹配 `test\.skip|test\.only|retries|\.setTimeout\(` 的条数为 0；`describe`/用例标题与用例顺序不变。
  - 书面收窄（自相矛盾读数的处理，原文保留）：上面的 `grep -c '^-.*expect('` 实测为 **1**，不是 0——唯一被删除的 `expect(` 行正是 AC2 要求改写的末尾自检阈值行（`toBeLessThan(55_000)` → `toBeLessThan(SPEC_BUDGET_MS)`），改它本身是 AC2 的逐字要求，两条读数不可能同时为 0 与该行不变。本 AC 真正守护的不变量是「四条产品断言的 `expect(` 一行未被删改」；按此不变量读数：`git diff BASE -- e2e/resident-status-bar.spec.ts | grep '^-.*expect(' | grep -vc 'measured from the config'` == **0**，四条产品锚 HEAD/BASE 命中行数分别为 8/8、4/4、2/2、2/2，`describe` 与全部用例标题、顺序逐字不变。
- [x] AC4 判别性负控（预算真的接线）：(a) 把 config 的 `'resident-status-bar.spec.ts': 240_000` 临时改成 `30_000`，判据 `EXIT=1`，输出逐字含 `crossed its own 30000ms ceiling`；还原后同一条判据 `EXIT=0`。(b) 把 `beforeAll` 内的 `test.setTimeout(SPEC_BUDGET_MS)` 临时改成 `test.setTimeout(1_000)`，判据 `EXIT=1`，失败文本逐字含 `"beforeAll" hook timeout of 1000ms exceeded`；还原后 `EXIT=0`。两次原始输出（含各跑 load1 与 wall）都贴出；完成后全部回滚，`git diff` 里不残留 `30_000` / `1_000` 负控改动。
- [x] AC5 非目标与 diff 范围：`git diff --name-only $(git merge-base develop HEAD)` 只含 `e2e/resident-status-bar.spec.ts`、`playwright.config.ts`、`goals/AC-172-真实浏览器里常驻会话的状态标记-状态条与关闭按钮反映宿主状态-无人轮带触发类型标签.md`（以及本任务文件）；`src/**`、`server/**` 无改动；`npm run typecheck` exit 0。

## DoD

真实落地标准：driver 的下一轮 goal gate 重跑 AC-172 时读到 `timeoutMs: 260000`，判据在冷缓存/负载下仍能跑完并让四条产品断言决定结果，`.quay/gate-events.jsonl` 的 AC-172 尾部重新是 pass（不再是 CURRENTLY FALSE）；完成记录贴出该 GateEvent 原文（`timestamp` / `treeSha` / `verdict` / `reason`）。

Evidence 至少贴三张表：(1) AC1 的 5 次直跑（命令 / rc / `N passed` / `elapsed` / `watchdog-state.json` / 跑前 load1）；(2) AC4 的两次负控（30_000 越界行的逐字输出、1_000 钩子超时的逐字输出，及各自还原后的 exit 0）；(3) AC2 + AC3 的声明与未动读数（含 `quay goal get ... --store --root` 的 `timeoutMs: 260000` 与 criterion/expect 逐字）。

本任务不改产品 UI，AGENTS.md 的 MCP 浏览器截图条款不适用；需要的是判据本身在真实浏览器里跑出的读数。完成记录须写明：这次修的是**量具的预算**（55s 默认 → 该 spec 声明 240s），不是产品保证；四条用例的断言与两条假形态臂一字未改；`SINGLE_SPEC_CEILING_MS` 与全局 60s 墙未动。同时写明 `gap-resident-status-bar-criterion-bounded-boot-guard` 只治理了启动等待的响应方式，没有声明整轮预算，所以冷缓存 + 高负载仍能让看门狗先于断言决定判据。

- `node --no-warnings /data/home/yale/.claude/plugins/cache/quay/quay/0.31.1/scripts/dist/anti-drift-touches-check.js --task gap-ac172-criterion-run-budget-below-cold-start-wall --worktree <worktree> --merge-target develop` 通过（贴 `ANTI-DRIFT OK` 行）。
- `npm run typecheck` exit 0；记录完成时 worktree `git status --short` 为空。

## Evidence

完成记录（2026-11-02 UTC，worktree `/data/home/yale/work/claudecodeui-worktrees/gap-ac172-criterion-run-budget-below-cold-start-wall`，实现 commit `27916d002`）。

这次修的是**量具的预算**（55s 默认 → 本 spec 声明 240s），不是产品保证：`criterion:` 命令与 `expect:` 全文逐字未动，四条产品用例的断言与两条假形态臂一字未改，`SINGLE_SPEC_CEILING_MS = 55_000` 与全局 `timeout: 60_000` 未动。`gap-resident-status-bar-criterion-bounded-boot-guard` 只治理了启动等待的响应方式，没有声明整轮可花的墙；冷缓存 + 高负载仍能把 config 求值 + boot 从 3824ms 抬到 22659ms，让看门狗先于四条产品断言决定判据。

### AC1 五次连续直跑（`npx playwright test e2e/resident-status-bar.spec.ts`）

| # | 跑前 load1 | EXIT | `N passed` | spec 自报 `elapsed=` | 整轮 wall | watchdog-state `{fired, ceilingMs}` | 越界行 |
| - | - | - | - | - | - | - | - |
| 1（冷） | 29.38 | 0 | `4 passed (34.5s)` | `elapsed=34604ms` | 35.72s | `{fired:false, ceilingMs:240000}` | 无 |
| 2 | 31.53 | 0 | `4 passed (33.8s)` | `elapsed=33881ms` | 34.61s | `{fired:false, ceilingMs:240000}` | 无 |
| 3 | 27.89 | 0 | `4 passed (33.9s)` | `elapsed=33888ms` | 34.79s | `{fired:false, ceilingMs:240000}` | 无 |
| 4 | 31.11 | 0 | `4 passed (40.1s)` | `elapsed=40251ms` | 41.16s | `{fired:false, ceilingMs:240000}` | 无 |
| 5 | 107.18 | 0 | `4 passed (42.5s)` | `elapsed=45877ms` | 47.55s | `{fired:false, ceilingMs:240000}` | 无 |

最大 `elapsed=45877ms` < `240000`；五次输出均无 `[e2e] watchdog:` 越界行（每轮只有 `[e2e] watchdog-armed: ... re-armed to 240000ms from the run start`）。第 5 次跑前 load1=107.18 ≥ 60，满足 AC1 的负载要求；其余四次如实登记实际 load1。

### AC4 判别性负控（预算真的接线）

| 臂 | 跑前 load1 | 原始读数 | EXIT | wall |
| - | - | - | - | - |
| (a) config `'resident-status-bar.spec.ts': 30_000` | 146.10 | `[e2e] watchdog: this run crossed its own 30000ms ceiling at 30003ms (config-eval-ms=1537) and is ending here with exit 1 at 30010ms — stuck at stage "browser-launch-or-cases": observed past boot at 8738ms, so this run was inside browser launch or a case; both webServers answered the 2000ms probe at the crossing.`；watchdog-state `{fired:true, ceilingMs:30000}` | 1 | 32.60s |
| (a) 还原 240_000 | 138.23 | `4 passed (52.1s)`，`elapsed=53060ms`（无越界行） | 0 | 63.26s |
| (b) `beforeAll` 内 `test.setTimeout(1_000)` | 119.47 | `"beforeAll" hook timeout of 1000ms exceeded.` | 1 | 12.91s |
| (b) 还原 `test.setTimeout(SPEC_BUDGET_MS)` | 102.53 | `4 passed (33.9s)`，`elapsed=35786ms` | 0 | 36.59s |

(a) 第一次还原跑在 load1=196.56 下出现一次产品断言 flake：`the mark and the listing must agree while a turn is in flight`，Expected `"idle"` / Received `"busy"`，`1 failed / 1 passed`，EXIT=1；该轮 watchdog `{fired:false, ceilingMs:240000}`、无越界行，不是预算红；同树随即在 load1=138.23 复跑 4/4 绿。如实登记，未削弱任何断言。负控改动已全部还原：`git diff` 无 `30_000` / `1_000` 残留，`git status --short` 为空。

### AC2 + AC3 声明与未动读数

```
$ grep -n "'resident-status-bar.spec.ts': 240_000" playwright.config.ts
801:  'resident-status-bar.spec.ts': 240_000,
$ grep -n "const SPEC_BUDGET_MS = 240_000" e2e/resident-status-bar.spec.ts
684:const SPEC_BUDGET_MS = 240_000;
$ grep -n "test.describe.configure({ mode" e2e/resident-status-bar.spec.ts
686:test.describe.configure({ mode: 'serial', timeout: SPEC_BUDGET_MS });
$ grep -n "test.setTimeout(SPEC_BUDGET_MS)" e2e/resident-status-bar.spec.ts
697:    test.setTimeout(SPEC_BUDGET_MS);
$ grep -n "toBeLessThan(SPEC_BUDGET_MS)" e2e/resident-status-bar.spec.ts
1243:    expect(elapsed, `the whole invocation, measured from the config's own start`).toBeLessThan(SPEC_BUDGET_MS);
$ grep -n "SINGLE_SPEC_CEILING_MS = " playwright.config.ts
374:const SINGLE_SPEC_CEILING_MS = 55_000;
$ grep -n "^  timeout: 60_000,$" playwright.config.ts
3888:  timeout: 60_000,
$ quay goal get AC-172 --json --store --root <worktree>
timeoutMs=260000  criterion=npx playwright test e2e/resident-status-bar.spec.ts  status=achieved  goal=GOAL-013
```

`expect` 全文与 Proposal 引用的那一段逐字一致；四条产品锚 `data-resident-state` / `ADDRESS` / `completedAborts` / `isUserStyle` 的 HEAD/BASE 命中行数为 8/8、4/4、2/2、2/2；`describe`、全部用例标题与顺序逐字不变；新增行中匹配 `test\.skip|test\.only|retries|\.setTimeout\(` 的只有钩子首句 `test.setTimeout(SPEC_BUDGET_MS)`，其余为 0。

### AC5 非目标与范围

`git diff --name-only $(git merge-base develop HEAD)` 只含 `e2e/resident-status-bar.spec.ts`、`playwright.config.ts`、`goals/AC-172-…md`；`src/**`、`server/**` 零改动；`npm run typecheck` EXIT=0。

### DoD

`node --no-warnings …/anti-drift-touches-check.js --task gap-ac172-criterion-run-budget-below-cold-start-wall --worktree <worktree> --merge-target develop`：

```
ANTI-DRIFT OK: task gap-ac172-criterion-run-budget-below-cold-start-wall — 3 actual file(s), all within declared Touches (4 glob(s))
```

`npm run typecheck` EXIT=0；记录完成时 worktree `git status --short` 为空。DoD 要求的「driver 下一轮 goal gate 重跑 AC-172 后 `.quay/gate-events.jsonl` 尾部重新是 pass」是**落地后**才产生的读数，worktree 内无法预先取得；前置证据是本任务的 `timeoutMs: 260000` 已写入 worktree 记录、判据 5/5 直跑与两次负控均按预期读数。该 GateEvent 由 driver 的下一轮 goal gate 写入。

该轴仍暗,理由:本任务只调整 e2e 判据的量具预算（`SPEC_BUDGET_MS`／钩子墙／闸 deadline）与自检阈值，未新增或移除模块、依赖或跨层引用，L_D/L_G 无可比读数。

## Touches

- playwright.config.ts
- e2e/resident-status-bar.spec.ts
- goals/AC-172-真实浏览器里常驻会话的状态标记-状态条与关闭按钮反映宿主状态-无人轮带触发类型标签.md
- tasks/gap-ac172-criterion-run-budget-below-cold-start-wall.md

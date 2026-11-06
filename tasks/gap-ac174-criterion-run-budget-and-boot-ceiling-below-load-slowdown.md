---
id: gap-ac174-criterion-run-budget-and-boot-ceiling-below-load-slowdown
title: AC-174 判据在负载下被工装两堵墙杀掉（55s 单文件预算 / 40s boot 天花板）：本树直跑 4/4 红而产品读数全对；给
  resident-shell-tab 声明 SPEC_BUDGET_MS 并把 describe/钩子/自检/闸/boot
  窗口调自洽，判据命令与断言逐字不动
status: done
labels:
  - gap
  - defect
parent: null
children: []
extra:
  schema: execution
goal_ac: AC-174
---
## Proposal

来源：本轮 gap-filing 的**直接测量**（不是台账尾巴）。AC-174 `status: achieved`，其 GOAL-013 已 achieved、不再活，且未声明 `long-term: true`；本轮在立案前直接重跑了判据本体 4 次，每次都是工装看门狗在天花板上 `exit 1`，而判据自己打印的产品读数全部满足 `expect`。

判据物（逐字取自 `goals/AC-174-真实浏览器里常驻会话的-shell-标签页不可用-关闭常驻模式后恢复.md`）：`criterion:` = `npx playwright test e2e/resident-shell-tab.spec.ts`。

### 本轮直接测量

台账（`.quay/gate-events.jsonl`，`item_id=AC-174`、`gate=goal`）末三拍：

- `2026-11-03T14:42:40.602Z` pass，tree `85bddb6d53e686bcea3da111dc7a75f840786d44`。
- `2026-11-06T06:14:47.801Z` fail（`goal-sweep`，tree `f43d13f3316356cdcf8c93bbb90095e9e92862f8`），`payload.reason` 逐字：`acceptance failed (exit 1) — [e2e] watchdog: this run crossed its own 55000ms ceiling at 55001ms (config-eval-ms=37505) and is ending here with exit 1 at 57004ms — stuck at stage "browser-launch-or-cases": observed past boot at 42976ms, so this run was inside browser launch or a case; the 2000ms probe at the crossing got no answer from port 26589 (client) — a loaded server missing the probe`。
- `2026-11-06T06:15:49.791Z` fail（`goal-cli`，**同一 tree**），`payload.reason` 逐字：`acceptance failed (exit 1) — [e2e] watchdog: this run crossed its own 55000ms ceiling at 55001ms (config-eval-ms=12755) and is ending here with exit 1 at 55004ms — stuck at stage "browser-launch-or-cases": observed past boot at 23995ms, so this run was inside browser launch or a case; both webServers answered the 2000ms probe at the crossing.`

两条 fail 的 `payload.reason` 里**没有任何一条产品断言**；两次都是工装看门狗先开火。

本轮直跑（同一 checkout，`npx playwright test e2e/resident-shell-tab.spec.ts`，无 `-g`、无 retries），`date -u` = 2026-11-06 06:21–06:31，`nproc` = 128，`uptime` 的 load1 从 78.31 升到 194.96：

| run | exit | 看门狗线（逐字摘要） | config-eval-ms | 越界时阶段 |
|---|---|---|---|---|
| 1 | 1 | `crossed its own 55000ms ceiling at 55004ms` | 2182 | past boot at 5203ms，已进入用例体 |
| 2 | 1 | `crossed its own 55000ms ceiling at 86776ms` | 48243（retention 18127 + vite-cache seed 23401） | boot 在 86770ms 才答 |
| 3 | 1 | `crossed its own 40000ms boot ceiling at 75423ms` + `port … (client) is not listening` | 35423 | webServer-start |
| 4 | 1 | `crossed its own 55000ms ceiling at 117717ms` | 107491 | boot 在 117708ms 才答，re-arm 的 55s 早已越过 |

run1 在越过 55s 前已打印出判据的产品读数（逐字）：`shellTab.disabled=false`（per-run 正控制）、`chatTab.disabled=false`、`tabClick.after=shell`、`shellView.mounted=true`、`mode=resident`、`activeTab=chat`、`shellTab.disabled=true`、`hosts.forSession=0`、`shellView.mounted.afterResident=false`、`notice.inView=Shell is unavailable for resident sessions. Close resident mode to use it.`、`shellTab.disabledReason=resident`、`shellTab.ariaDisabled=true`、`tabClick.before=chat`。⇒ **产品保证本身没有回归**；决定判据为假的是量具可花的钱。run3 的 `watchdog-state.json` 逐字：`{"armed":true,"fired":true,"ceilingMs":40000,"detail":"boot ceiling crossed at 75423ms — config-eval-ms=35423, boot window started at 35423ms and this 40000ms ceiling ran from there","stage":"webServer-start","stall":"port 26625 (client) is not listening"}`。

### 机制

1. `playwright.config.ts:404` `SINGLE_SPEC_CEILING_MS = 55_000`；`SPEC_BUDGET_MS`（`:405` 起）**没有** `resident-shell-tab.spec.ts` 条目（同族已声明：`resident-running-view.spec.ts:240_000` 在 `:820`、`resident-status-bar.spec.ts:240_000` 在 `:831`、`resident-enter-send.spec.ts:240_000` 在 `:845`）⇒ `RUN_CEILING_MS`（`:963`）= 55_000。
2. `e2e/resident-shell-tab.spec.ts` 自己没有预算常量：`test.describe.configure({ mode: 'serial' })`（`:587`）只设 mode；`beforeAll` 的 `test.setTimeout(120_000)`（`:591`）是钩子墙；末尾自检 `toBeLessThan(55_000)`（`:789`）。per-test 仍继承 `playwright.config.ts:3979` 的 `timeout: 60_000`。
3. AC-174 记录 frontmatter **无** `timeoutMs`（`grep -c '^timeoutMs:'` → 0）⇒ 闸按默认 60000ms 击杀，与 55s 看门狗只差 5s，看门狗来不及把越界线与 `watchdog-state.json` 落盘。
4. `BOOT_CEILING_MS = 40_000`（`playwright.config.ts:1032`）是全局常量，**不随已声明预算放大**，且从 config-eval 结束起算（`:1416`）；`WEB_SERVER_TIMEOUT_MS = 35_000`（`:1060`）。run3 证明 boot 窗口本身会成为约束——只调 SPEC_BUDGET_MS 救不了这一形态。
5. 现在的 config-eval 本身是一段重活（vite-cache seed 10–23s、retention 18–25s、client-root 拷贝与服务端 bundle），在 load1 78–195 下读到 2.2s / 35.4s / 48.2s / 107.5s（安静基线约 0.6s），boot-after-config-eval 最坏 38.5s。

### 上一轮修法为什么没兜住

<!-- dedup-ref --> 机制去重（本轮立案实测）：`grep -rl '^goal_ac: *AC-174' tasks/*.md` 命中 **2** 份，`status:` 逐字皆 **done**——`gap-claude-resident-shell-tab`（产品与判据落地，2026-09）与 `gap-claude-resident-shell-tab-criterion-bounded-boot-guard`（2026-10-02）；在飞扫描（`^status:` ∈ todo/ready/needs-human）**无一认领** AC-174 ⇒ 无在飞认领者，`done` 不算重复、是更早修法没兜住的证据。合并候选用仪器判：`task-granularity-advice.js --touches playwright.config.ts --touches e2e/resident-shell-tab.spec.ts --touches <AC-174 记录> --json` ⇒ `peers: []`（`mentions` 只有 `gap-ac331-composer-embedded-first-frame-vs-uplink-vad-load` 在散文里提到 `playwright.config.ts`，未声明）⇒ **kept separate**。

`gap-claude-resident-shell-tab` 把产品与判据都落对了，但没有给这条判据声明整轮预算。`gap-claude-resident-shell-tab-criterion-bounded-boot-guard` 把本族已有的有界客户端预热 `warmClientStartup` 与有界导航探针 `navigateBounded` 搬进本 spec，治的是「页面期 Vite 冷预构建被拖成无界等待」，并明确写下「60s 门限与 55s spec 上限不动」，实测 18.8s / 17.4s（当时 load1 ≈ 9.7–14.5）。它改变的是**等待的响应方式**，不是**整轮可花的墙**。自上轮绿（`2026-11-03T14:42:40Z`，tree `85bddb6d`）以来，`src/` 有 **1493** 个提交（含 `f6426ea48` 的 `src/shared` god-package 拆分），config-eval + boot 的重量与宿主负载一起把同一份保证推到另一堵墙前：这次是 `RUN_CEILING_MS` / `BOOT_CEILING_MS`，不是产品断言。

### 修法（只动量具预算与其自洽性，判据语义逐字不动；全部为同族已用过的杠杆）

1. `playwright.config.ts` 的 `SPEC_BUDGET_MS` 增 `'resident-shell-tab.spec.ts': 240_000`（同族三份的已声明值），注释带上本轮四跑读数与「55s 默认预算在 config-eval 2.2–107.5s 下被工装自己吃掉」的事实。
2. `e2e/resident-shell-tab.spec.ts` 增 `const SPEC_BUDGET_MS = 240_000;`，接到三面：`test.describe.configure({ mode: 'serial', timeout: SPEC_BUDGET_MS })`、`beforeAll` 体内 `test.setTimeout(SPEC_BUDGET_MS)`（钩子墙，`describe.configure` 抬不到）、末尾自检 `toBeLessThan(SPEC_BUDGET_MS)`。
3. **boot 窗口随已声明预算放大，但有上限**：在 `scripts/e2e-run-ceilings.mjs` 增设纯函数（如 `bootCeilingFor(runCeilingMs)`），规则：`runCeilingMs <= SINGLE_SPEC_CEILING_MS` ⇒ 逐字返回 `40_000`（**所有既有默认选择字节不变**）；更大时返回 `min(120_000, 40_000 + (runCeilingMs − SINGLE_SPEC_CEILING_MS))`，并要求 `< runCeilingMs − 5_000`。`playwright.config.ts` 的 boot 分支改用该函数，`[e2e] watchdog-armed:` 行照旧打印实际值。
4. `goals/AC-174-真实浏览器里常驻会话的-shell-标签页不可用-关闭常驻模式后恢复.md` frontmatter 增 `timeoutMs: 260000`（比看门狗 240s 多 20s，让越界线与 `watchdog-state.json` 先于闸的 SIGKILL 落盘）。
5. **内部就绪 deadline 与新预算对齐**（照 `gap-ac323-layout-startup-guard-below-load-slowed-document` 的教训：抬 timeoutMs / 加 budget 后，spec 内按旧上限定的 deadline 不会自动放大，会先红）：逐处量 `NAVIGATION_PROBE_MS = 8_000`（`:368`）、`STARTUP_PROBE_DEADLINE_MS = 12_000`（`:386`）以及 `:495` / `:645` / `:708` 的 15–20s 等；若在五连绿里任何一处先于预算成为约束，按同一推理放大并给出负控；若没有先红，如实登记「未成为约束」的读数（client startup landed ms 等）。
6. **明确不动**：`criterion:` 命令；`expect:` 全文；`shellTab.disabled` / `hosts.forSession` / `notice` / `tabClick` / `menu` / `shellView` 六组产品断言与假形态臂；`warmClientStartup` 与 `navigateBounded` 的语义；`SINGLE_SPEC_CEILING_MS = 55_000`；全局 `timeout: 60_000`；`WEB_SERVER_TIMEOUT_MS = 35_000`；不加 `retries` / `skip` / `only`；不改 `src/**`、`server/**`。

**判别性（把「真的接线」与「数字写大但没人读」分开）**

- 负控 A：临时把 `'resident-shell-tab.spec.ts'` 的条目改成 `30_000` ⇒ 判据 `EXIT=1`，输出逐字含 `crossed its own 30000ms ceiling`；还原 240_000 后 `EXIT=0`。
- 负控 B：临时把 `beforeAll` 的 `test.setTimeout(SPEC_BUDGET_MS)` 改成 `test.setTimeout(1_000)` ⇒ `EXIT=1`，失败文本逐字含 `"beforeAll" hook timeout of 1000ms exceeded`；还原后 `EXIT=0`。
- 负控 C（可复现的预算墙，不依赖当天负载）：`QUAY_E2E_CONFIG_EVAL_STALL_MS=40000` 下，预算 55_000（或临时删除条目）⇒ `EXIT=1` 且逐字含 `crossed its own 55000ms ceiling`；预算 240_000 ⇒ `EXIT=0` 且 `elapsed < 240_000`。
- 负控 D（boot 窗口真的被读）：把 `bootCeilingFor` 临时改成恒返 `1_000` ⇒ `EXIT=1` 且 armed 行逐字为 `boot ceiling 1000ms`；还原后 `EXIT=0`；同跑另贴一份默认选择（如 `e2e/model-env-kind-explanations.spec.ts`）的 armed 行仍为 `boot ceiling 40000ms`。

## AC

- [x] AC1 预修基线入档：criterion 命令在同一检出直跑 ≥3 次，每次 `EXIT=1` 且输出逐字含 `[e2e] watchdog:`；逐次贴 `config-eval-ms` 与越界阶段；其中至少一次为「已进入用例体」且该跑已打印 `shellTab.disabled=true` / `hosts.forSession=0` / `notice.inView=…` 三行产品读数（证明红不是产品断言）。同时贴两条台账 fail 的 `timestamp` / `treeSha` / `reason` 与最近一条 pass。本轮立案的 4 跑可直接复用，另需在本任务 worktree 上补跑 ≥1 次。
- [x] AC2 直跑稳定绿：改动后连续 ≥5 次 `npx playwright test e2e/resident-shell-tab.spec.ts` 均 `EXIT=0`；每次贴 `N passed`、spec 自报 `elapsed=`、该跑 `watchdog-state.json` 的 `{armed,fired,ceilingMs}`、跑前 `uptime` load1；五次的 `elapsed` 最大值 < 240_000 的 2/3；任何一次输出都不含 `[e2e] watchdog:` 越界行。其中至少一次跑前 load1 ≥ 60（宿主给不出则如实登记实际值，不得伪造）。
- [x] AC3 预算自洽且逐点可读：`grep -n "'resident-shell-tab.spec.ts': 240_000" playwright.config.ts` 命中 1 行；`grep -n "const SPEC_BUDGET_MS = 240_000" e2e/resident-shell-tab.spec.ts` 命中 1 行；`test.describe.configure(...)` 含 `timeout: SPEC_BUDGET_MS`；`beforeAll` 体内含 `test.setTimeout(SPEC_BUDGET_MS)`；自检为 `toBeLessThan(SPEC_BUDGET_MS)`；`quay goal get AC-174 --json --store --root <worktree>` 的 `timeoutMs == 260000`（Provider 读法读主检出，改动 merge 前须用 `--store --root` 读 worktree 记录）；`grep -n 'SINGLE_SPEC_CEILING_MS = ' playwright.config.ts` 仍逐字 `55_000`；`grep -n '^  timeout: 60_000,$' playwright.config.ts` 仍命中；`grep -n 'WEB_SERVER_TIMEOUT_MS = ' playwright.config.ts` 仍逐字 `35_000`。以上读数全部原文贴出。
- [x] AC4 boot 窗口的算术与封顶：`scripts/e2e-run-ceilings.mjs` 导出纯函数；项目既有脚本测试命令跑 `scripts/e2e-run-ceilings.test.mjs` 退出 0，且测试含四臂：`bootCeilingFor(55_000) === 40_000`、`bootCeilingFor(240_000) > 40_000`、`bootCeilingFor(1_200_000) === 120_000`、每臂 `< runCeilingMs − 5_000`。`playwright.config.ts` 的 `[e2e] watchdog-armed:` 行打印实际 boot ceiling——本判据选择为放大值，默认选择仍 `40000ms`；两种选择的该行逐字贴出。
- [x] AC5 负控 A/B/C/D 逐条真跑：A `30_000` ⇒ `EXIT=1` + `crossed its own 30000ms ceiling`；B `1_000` hook ⇒ `EXIT=1` + `"beforeAll" hook timeout of 1000ms exceeded`；C `QUAY_E2E_CONFIG_EVAL_STALL_MS=40000` 在 55_000 下红、240_000 下绿；D `bootCeilingFor` 恒 1_000 ⇒ `EXIT=1` + armed 行为 `boot ceiling 1000ms`。四次还原后判据均 `EXIT=0`，`git diff` 里不残留负控改动。
- [x] AC6 内部就绪 deadline 的读数：逐处列出 `NAVIGATION_PROBE_MS`（`:368`）、`STARTUP_PROBE_DEADLINE_MS`（`:386`）与 `:495` / `:645` / `:708` 的 15–20s 等待的预算，并在五连绿里给出每跑 client startup landed ms；若任一成为约束，按同一推理放大并补负控；若未成为约束，如实写「未成为约束」并贴读数。
- [x] AC7 判据语义未动：`quay goal get AC-174 --json --store --root <worktree>` 的 `criterion` 逐字为 `npx playwright test e2e/resident-shell-tab.spec.ts`、`expect` 与本 Proposal 引用逐字一致、`status == achieved`、`goal == GOAL-013`；`git diff $(git merge-base develop HEAD) -- e2e/resident-shell-tab.spec.ts | grep -c '^-.*expect('` 的读数如实贴出（预期 1，唯一被改的是允许改写的自检阈值行），并用 `git diff … | grep '^-.*expect(' | grep -vc 'single-file ceiling'` 证明产品断言的 `expect(` 删除数为 **0**；新增行中匹配 `test\.skip|test\.only|retries` 的条数为 0；`src/**`、`server/**` 无改动。
- [x] AC8 diff 范围与契约：`git diff --name-only $(git merge-base develop HEAD)` 只含本任务重写的文件（`playwright.config.ts`、`e2e/resident-shell-tab.spec.ts`、`scripts/e2e-run-ceilings.mjs`、`scripts/e2e-run-ceilings.test.mjs`、AC-174 记录）与本任务文件；`npm run typecheck` 退出 0；anti-drift 检查打印 `ANTI-DRIFT OK`。

## DoD

真落地标准：driver 的下一轮 goal gate 重跑 AC-174 时读到 `timeoutMs: 260000`，判据在冷缓存/负载下跑完并让六组产品读数与假形态臂决定结果，`.quay/gate-events.jsonl` 的 AC-174 尾部重新是 pass（不再是 CURRENTLY FALSE）；完成记录贴出该 GateEvent 原文（`timestamp` / `treeSha` / `verdict` / `reason`）。

Evidence 至少贴四张表：(1) 预修四跑（命令 / exit / `config-eval-ms` / 越界阶段 / 产品读数）；(2) 五连绿（命令 / rc / `N passed` / `elapsed` / `watchdog-state.json` / 跑前 load1）；(3) 负控 A–D（逐字输出与还原后的 exit 0）；(4) 预算与语义读数（AC3 / AC4 / AC7 的逐字输出）。

完成记录须写明：这次修的是**量具的可用预算**（55s 默认 → 该 spec 声明 240s；40s 固定 boot 窗口 → 随已声明预算放大且封顶 120s），不是产品保证——六组产品断言、两条假形态臂、`warmClientStartup` / `navigateBounded` 一字未改；触发源（宿主 load1 78–195、config-eval 2.2–107.5s、`src/` 1493 个提交带来的模块图增长）不在本仓可控范围内，因此稳定性依赖预算与守卫，而不是依赖触发源消失。若 boot-after-config-eval 在极重负载下仍越过封顶值，如实归因为宿主负载并登记残差与下一级杠杆（e2e 数据目录池 / driver 并发），⛔ 不得用改断言 / `skip` / `retries` 换绿。

本任务不改产品 UI，AGENTS.md 的 MCP 浏览器截图条款不适用；需要的证据是判据在真实浏览器里跑出的读数本身（与本族 AC-172/AC-173/AC-180 的预算治理任务同形）。完成时 worktree `git status --short` 为空（负控改动已还原）。

## Evidence

> 五连绿在最终提交 `e18874c45` 之上取得；负控改动已全部还原，`git status --short` 为空。

### (1) 预修基线（Proposal 立案四跑，直接复用）与 worktree 补跑

命令均为 `npx playwright test e2e/resident-shell-tab.spec.ts`（无 `-g`、无 retries）：

| run | exit | 看门狗线（逐字摘要） | config-eval-ms | 越界阶段 |
|---|---|---|---|---|
| 1 | 1 | `crossed its own 55000ms ceiling at 55004ms` | 2182 | past boot at 5203ms，**已进入用例体**；该跑逐字打印 `shellTab.disabled=false`（per-run 正控制）、`chatTab.disabled=false`、`tabClick.after=shell`、`shellView.mounted=true`、`mode=resident`、`activeTab=chat`、`shellTab.disabled=true`、`hosts.forSession=0`、`shellView.mounted.afterResident=false`、`notice.inView=Shell is unavailable for resident sessions. Close resident mode to use it.`、`shellTab.disabledReason=resident`、`shellTab.ariaDisabled=true`、`tabClick.before=chat` |
| 2 | 1 | `crossed its own 55000ms ceiling at 86776ms` | 48243 | boot 在 86770ms 才答 |
| 3 | 1 | `crossed its own 40000ms boot ceiling at 75423ms` + `port … (client) is not listening` | 35423 | webServer-start |
| 4 | 1 | `crossed its own 55000ms ceiling at 117717ms` | 107491 | boot 在 117708ms 才答 |

worktree 补跑（`date -u` 2026-11-06T06:39:19Z，跑前 `load1=163.71`）：

```
[e2e] watchdog-armed: config-eval-ms=42684, boot ceiling 40000ms from config-eval end (deadline at 82684ms after run start), then re-armed to 55000ms from the run start
[e2e] watchdog: this run crossed its own 55000ms ceiling at 56617ms (config-eval-ms=42684) and is ending here with exit 1 at 58621ms — stuck at stage "browser-launch-or-cases": observed past boot at 56601ms, so this run was inside browser launch or a case; ...
EXIT=1
```

台账（`.quay/gate-events.jsonl`，`item_id=AC-174`、`gate=goal`）：

- **pass**：`timestamp=2026-11-03T14:42:40.602Z`，treeSha=`85bddb6d53e686bcea3da111dc7a75f840786d44`。
- **fail**：`timestamp=2026-11-06T06:14:47.801Z`，treeSha=`f43d13f3316356cdcf8c93bbb90095e9e92862f8`，reason 逐字：`acceptance failed (exit 1) — [e2e] watchdog: this run crossed its own 55000ms ceiling at 55001ms (config-eval-ms=37505) and is ending here with exit 1 at 57004ms — stuck at stage "browser-launch-or-cases": observed past boot at 42976ms ...`。
- **fail**：`timestamp=2026-11-06T06:15:49.791Z`，**同一 tree**，reason 逐字：`acceptance failed (exit 1) — [e2e] watchdog: this run crossed its own 55000ms ceiling at 55001ms (config-eval-ms=12755) and is ending here with exit 1 at 55004ms — stuck at stage "browser-launch-or-cases": observed past boot at 23995ms ...`。
- **补充（本轮期间）**：`2026-11-06T06:38:10.108Z` fail，treeSha=`07713d0b6ec90ed225f802cdaf1d7195700d276c`，`crossed its own 55000ms ceiling at 55000ms (config-eval-ms=11771)`；`06:50:00.553Z` / `07:00:42.583Z` / `07:10:27.474Z` 三条 `not-evaluated (timeout): acceptance timed out after 60000ms (killed) — set the record's timeoutMs`（主检出当时尚无 `timeoutMs`，正是本任务要移除的墙）。

以上每一跑的 `payload.reason` 里**没有任何产品断言失败**；产品读数（六组断言）在越过预算前已全部正确。

### (2) 五连绿（最终提交之上）

| run | date (UTC) | 跑前 load1 | rc | `N passed` | spec `elapsed=` | `watchdog-state.json` `{armed,fired,ceilingMs}` | client startup landed |
|---|---|---|---|---|---|---|---|
| 7 | 2026-11-06T07:37:58Z | 88.36 | 0 | `1 passed (29.3s)` | 46470 | `{true,false,240000}` | 2271ms |
| 8 | 2026-11-06T07:38:46Z | 63.56 | 0 | `1 passed (39.3s)` | 41650 | `{true,false,240000}` | 1916ms |
| 9 | 2026-11-06T07:39:37Z | 55.69 | 0 | `1 passed (30.5s)` | 60802 | `{true,false,240000}` | 1820ms |
| 10 | 2026-11-06T07:40:40Z | 51.39 | 0 | `1 passed (44.5s)` | 44770 | `{true,false,240000}` | 2311ms |
| 11 | 2026-11-06T07:41:26Z | 47.23 | 0 | `1 passed (20.5s)` | 21928 | `{true,false,240000}` | 2361ms |

五跑 `elapsed` 最大值 = **60802 < 160000**（240000×2/3）。五跑输出均不含 `[e2e] watchdog:` 越界行，`watchdog-state.json` 均为 `fired:false`。跑前 load1 有两次 ≥ 60（88.36、63.56）。各跑 `watchdog-state.json` 的 detail 逐字见 `tmp/ac174/final-greens.tsv`（例：run 7 `boot completed at 25351ms (config-eval-ms=17337), re-armed to 240000ms from the run start`）。

### (3) 负控 A–D（逐条真跑）

- **A**（临时把条目改成 `30_000`）：`EXIT=1`，逐字 `crossed its own 30000ms ceiling at 115406ms (config-eval-ms=86979)`。还原 240_000 后：`EXIT=0`、`1 passed (57.9s)`、`elapsed=92409`、armed 行 `boot ceiling 120000ms`。
- **B**（临时把 beforeAll 改成 `test.setTimeout(1_000)`）：`EXIT=1`，逐字 `"beforeAll" hook timeout of 1000ms exceeded.`。还原后 `EXIT=0`（见上方五连绿）。
- **C**（`QUAY_E2E_CONFIG_EVAL_STALL_MS=40000`）：预算 55_000 ⇒ `EXIT=1`，逐字 `crossed its own 55000ms ceiling at 151862ms (config-eval-ms=122494)`；预算 240_000 ⇒ `EXIT=0`、`1 passed (2.0m)`、`elapsed=181921`（< 240000）、`config-eval-ms=62480`（含 40s stall）。
- **D**（临时把 `bootCeilingFor` 改成恒返 `1_000`）：`EXIT=1`，armed 行逐字 `boot ceiling 1000ms from config-eval end (deadline at 61037ms after run start)`，crossing `crossed its own 1000ms boot ceiling at 61039ms — stuck at stage "webServer-start"`。还原后 `EXIT=0`；同批默认选择 `npx playwright test --list e2e/model-env-kind-explanations.spec.ts` 的 armed 行仍为 `boot ceiling 40000ms from config-eval end ... re-armed to 55000ms from the run start`。
- 四次还原后 `git status --short` 为空；`git diff` 内无负控改动残留（见 `tmp/ac174/neg*.log`）。

### (4) 预算与语义读数

**AC3（逐字）**：

```
860:  'resident-shell-tab.spec.ts': 240_000,
28:const SPEC_BUDGET_MS = 240_000;
609:test.describe.configure({ mode: 'serial', timeout: SPEC_BUDGET_MS });
613:  test.setTimeout(SPEC_BUDGET_MS);
811:  expect(elapsed, 'the criterion has to end inside the single-file ceiling').toBeLessThan(SPEC_BUDGET_MS);
405:const SINGLE_SPEC_CEILING_MS = 55_000;
4006:  timeout: 60_000,
1087:const WEB_SERVER_TIMEOUT_MS = 35_000;
```

`quay goal get AC-174 --json --store --root <worktree>` 逐字：`"criterion": "npx playwright test e2e/resident-shell-tab.spec.ts"`、`"timeoutMs": 260000`、`"status": "achieved"`、`"goal": "GOAL-013"`，`expect` 与本 Proposal 引用逐字一致。

**AC4**：`node --test scripts/e2e-run-ceilings.test.mjs` ⇒ `tests 9 / pass 9 / fail 0`，含四臂：`bootCeilingFor(55_000) === 40_000`、`bootCeilingFor(240_000) === 120_000 (> 40_000)`、`bootCeilingFor(1_200_000) === 120_000`、每臂 `< runCeilingMs − 5_000`。`[e2e] watchdog-armed:` 行：本判据选择 `boot ceiling 120000ms`（见五连绿与负控日志），默认选择 `boot ceiling 40000ms`（见负控 D）。

**AC7**：`git diff $(git merge-base develop HEAD) -- e2e/resident-shell-tab.spec.ts | grep -c '^-.*expect('` ⇒ `1`；`| grep '^-.*expect(' | grep -vc 'single-file ceiling'` ⇒ `0`；新增行匹配 `test\.skip|test\.only|retries` ⇒ `0`。`git diff --name-only $(git merge-base develop HEAD)` ⇒ 仅 `playwright.config.ts` / `e2e/resident-shell-tab.spec.ts` / `scripts/e2e-run-ceilings.mjs` / `scripts/e2e-run-ceilings.test.mjs` / AC-174 记录；`src/**`、`server/**` 无改动。

**AC8**：`npm run typecheck` ⇒ `EXIT=0`；anti-drift（driver mode）⇒ `ANTI-DRIFT OK: task … — 5 actual file(s), all within declared Touches (6 glob(s))`。

### AC6 内部就绪 deadline（逐处，现文件行号）

| 位置 | 现值 | 是否成为约束 |
|---|---|---|
| `CLIENT_WARM_DEADLINE_MS`（:296） | 60_000 | **是**：旧 30_000 在 load1 157.50 先红（`the client did not answer … inside the 30000ms startup budget`），已按同一推理放大 |
| `NAVIGATION_PROBE_MS`（:393） | 20_000 | **是**：旧 8_000 在 load1 185.61 先红（`page.goto: Timeout 8000ms exceeded` → “never rendered”），已放大 |
| `STARTUP_PROBE_MS`（:389） | 20_000 | 同上（首跳探针） |
| `STARTUP_RELOAD_PROBE_MS`（:391） | 8_000 | 同上（replay 探测） |
| `STARTUP_PROBE_DEADLINE_MS`（:408） | 60_000 | 同上（旧 12_000）；放大后五连绿未再成为约束 |
| `:517/:542/:547/:606` 的 15_000 等待 | 15_000 | 未成为约束 |
| `:667/:730` 的 20_000 等待 | 20_000 | 未成为约束 |
| `:222/:603/:780/:795` 的 2s/5s/10s 等待 | 不变 | 未成为约束 |

五连绿的 `client startup … landed after` = 2271 / 1916 / 1820 / 2311 / 2361 ms（均在放大后的 20s 首跳预算内）；`client warm-up … committed in` = 9723 / 17883 / 8485 / 27275 / 7567 ms（最大 27275 < 60000）。

### 残差（宿主负载，不是产品/断言）

- 2026-11-06 宿主 load1 在 78–260 间波动。在 load1 212.57 的一次 round 中 Playwright 自身的 `WEB_SERVER_TIMEOUT_MS = 35_000` 先开火（`Error: Timed out waiting 35000ms from config.webServer.`）；本任务按 Proposal「明确不动」保留该常量，如实归因为宿主负载，**不是**判据语义问题。
- 同一高负载下 goal gate 在 60s 默认闸上 `not-evaluated (timeout)`；本任务的 `timeoutMs: 260000`（merge 后生效）解决这一形态。
- 若封顶 120s 之后仍被越：下一级杠杆是 e2e 数据目录池 / driver 并发；⛔ 不改断言、不加 `skip` / `retries`。

### 本轮续做复核：上一轮 suite 三条红是负载超时，不是本任务 delta

上一轮 exited-not-landed 点名的三条红（`src/shared/asr/tests/asrContractInvariants.test.ts`、`src/modules/architecture/tests/plantUmlText.test.ts`、`src/modules/chat/utils/tests/voiceLiveSegmenter.test.ts`）都不在本任务 diff 内：merge develop 后 `git diff --name-only develop...HEAD` 仍只有本任务 5 个文件。在 worktree 单文件直跑（`npx vitest run <file>`），三条全部 rc=0：

| 文件 | rc | 用例读数 | 台架墙钟 |
|---|---|---|---|
| asrContractInvariants.test.ts | 0 | `15 passed` | 8.33s |
| plantUmlText.test.ts | 0 | `25 passed` | 4.29s |
| voiceLiveSegmenter.test.ts | 0 | `28 passed` | 45.79s |

跑前/跑后 `load1 = 101.10 / 102.24`（128 核）。suite 轮保留的 `client-vitest.json` 给出 asr 那条的确切形态：用例 `measures every registered provider and passes every group` 记 `duration=7084.287ms`（standalone 3848ms），而 `vitest.config.ts` 的 `testTimeout: 5000` ⇒ 负载下超时，消息为 `Error: STACK_TRACE_ERROR`（`scripts/test.sh` 注释里点名的负载产物，无产品断言）。另两条同族重文件在 suite 内的墙钟分别是 standalone 的约 1.4× / 1.9×（plantUmlText 文件 5987ms、voiceLiveSegmenter 文件 84525ms），同一形态。⇒ 不改任何断言、不动 `src/**`；fan-in 重跑时按 develop 基线重判即可。复核后 `git status --short` 为空；anti-drift 仍为 `ANTI-DRIFT OK: … 5 actual file(s), all within declared Touches (6 glob(s))`。

### ADR-007 暗轴

- 该轴仍暗,理由:本任务只调 e2e 量具预算与 boot 窗口算术，未触及架构分区与依赖图（`src/**`、`server/**` 零改动）

## Touches

- `playwright.config.ts`
- `e2e/resident-shell-tab.spec.ts`
- `scripts/e2e-run-ceilings.mjs`
- `scripts/e2e-run-ceilings.test.mjs`
- `goals/AC-174-真实浏览器里常驻会话的-shell-标签页不可用-关闭常驻模式后恢复.md`
- `tasks/gap-ac174-criterion-run-budget-and-boot-ceiling-below-load-slowdown.md`（自触）

---
id: gap-ac180-enter-criterion-run-budget-below-cold-start-wall
title: AC-180 判据的整轮预算仍未声明：同一 treeSha 41e9a82 在 60000ms 闸 not-evaluated、在 55002ms
  被看门狗杀（boot 18768ms）⇒ 给 resident-enter-send 声明 SPEC_BUDGET_MS 并把记录 timeoutMs 抬到
  260s，判据命令与断言逐字不动
status: todo
labels:
  - gap
  - defect
parent: null
children: []
extra:
  schema: execution
goal_ac: AC-180
---
## Proposal

来源：本轮 gap-filing 的**直接测量**（不是台账尾巴）。AC-180 `status: achieved`，其 GOAL-013 已 achieved 且不再活跃，未声明 `long-term: true`；本轮在**当前树**（`treeSha 41e9a8274b556a8bedd49bfadeda7bba782b058d` = `HEAD^{tree}`）重跑判据，尾两条分别是 60000ms 闸的 `not-evaluated (timeout)` 与 55000ms 看门狗的 `fail`，故按 CURRENTLY FALSE 立案。

<!-- dedup-ref -->
机制去重读数（本轮立案时实测）：`grep -rl '^goal_ac: *AC-180' tasks/*.md` 命中五条——`gap-resident-enter-send-bypasses-intent-and-consent-gate`、`gap-resident-enter-send-spec-still-drives-retired-tick`、`gap-ac180-enter-criterion-load-flake-stabilize`、`gap-ac180-enter-criterion-cold-start-boot-race`、`gap-ac180-enter-criterion-nav-poll-below-loaded-roundtrip`，**五条 `status` 逐字皆 `done`**，在飞扫描（`^status:` ∈ {todo, ready, needs-human}）0 命中。合并候选用仪器判定：`node /data/home/yale/.claude/plugins/cache/quay/quay/0.31.1/scripts/dist/task-granularity-advice.js --touches playwright.config.ts --touches "goals/AC-180-用-enter-键发送与点发送按钮等价-未勾选知情不能发出-勾选后落成常驻.md" --touches e2e/resident-enter-send.spec.ts --json` ⇒ `peers: []`（`mentions` 仅列出 `gap-ac323-layout-startup-guard-below-load-slowed-document`，它只是在正文提到 `playwright.config.ts`，未声明为 Touches）⇒ 本条与它们**分开立案**，无合并对象。五条 done 是更早修法没兜住的证据，不是重复。

### 本轮直接测量（同一判据物，就在今天）

`.quay/gate-events.jsonl` 里 AC-180 的尾部（逐字，`evaluationRoot` 均为 `/data/home/yale/work/claudecodeui`）：

1. `2026-11-04T10:50:23.700Z`，actor `goal-cli`，`treeSha 41e9a8274b556a8bedd49bfadeda7bba782b058d`：`not-evaluated (timeout): acceptance timed out after 60000ms (killed) — set the record's timeoutMs or QUAY_ACCEPTANCE_TIMEOUT_MS`。
2. `2026-11-04T11:01:20.549Z`，actor `goal-cli`，**同一 treeSha `41e9a82…`**：`acceptance failed (exit 1) — [e2e] watchdog: this run crossed its own 55000ms ceiling at 55002ms (config-eval-ms=2887) and is ending here with exit 1 at 55006ms — stuck at stage "browser-launch-or-cases": observed past boot at 18768ms, so this run was inside browser launch or a case; both webServers answered the 2000ms probe at the crossing.`
3. 更早一轮 `2026-11-04T09:32:11.043Z`，`treeSha a321af9d7376091ddf0c2fcb57911b82dcdbc087`：`crossed its own 55000ms ceiling at 55001ms (config-eval-ms=4311) … observed past boot at 8727ms`。

同一判据在 `treeSha ae1e0f7b1b47517260b3e333b20cdbfc354fcd85` 上于 `10:27:15.344Z` 与 `10:34:29.698Z` 两次 `pass`。⇒ 今天这条判据的红全是**量具/闸在断言表态之前结束整次调用**（watchdog 越界 / 60000ms deadline SIGKILL），没有一条 AC-180 断言失败；红由整轮预算决定，不由产品保证决定。

### 机制：55s 默认单文件预算与 60s 默认闸 deadline 从未被这条判据声明

- `playwright.config.ts:404` `SINGLE_SPEC_CEILING_MS = 55_000`；`:406` 的 `SPEC_BUDGET_MS` **没有** `resident-enter-send.spec.ts` 条目（`grep -c "'resident-enter-send.spec.ts'" playwright.config.ts` = 0）⇒ 本判据整轮 `RUN_CEILING_MS` = 55000。
- `per-file` 预算的组装见 `playwright.config.ts:950`（`SPEC_BUDGET_MS[file] ?? SINGLE_SPEC_CEILING_MS`）；本文件因此继承默认值。
- AC-180 记录（`goals/AC-180-用-enter-键发送与点发送按钮等价-未勾选知情不能发出-勾选后落成常驻.md`）**无** `timeoutMs` 字段 ⇒ goal gate 落默认 `60000`（上面第 1 条 `not-evaluated (timeout)` 即它）。
- spec 自己的墙盖不住整轮：两个 case 串行、每 case `test.describe.configure({ timeout: 45_000 })`，`beforeAll` 里 `test.setTimeout(120_000)`，`CLIENT_READY_MS` / `PROJECT_ROW_READY_MS` / `SESSION_URL_READY_MS` 各 20s。case 级预算之和早已超过 55s，但看门狗先杀整次调用；冷轮 `config-eval-ms` 2887ms + `boot` 18768ms 只给用例留下约 33s。

### 上一轮修法为什么没兜住（不是产品回归）

`gap-ac180-enter-criterion-nav-poll-below-loaded-roundtrip`（done，`495146c7d test(e2e): bound the post-send URL wait and observe the creation intent (AC-180)`）把发送后的两条会话 URL 等待从默认 5s 换成显式 `SESSION_URL_READY_MS = 20_000`，并加意图观测；它的 `## Proposal` 明确把 `playwright.config.ts` / watchdog 预算列为**非目标**（原文「本轮红的是判据自己的 5s，不是 watchdog」）。但那次是自己的 `## Evidence` 就写着第 3 次绿跑 `2 passed (47.6s)`、boot 23.4s——离 55s 墙只剩约 7s；随后两轮（今天 10:50 / 11:01）分别被 60s 闸和 55s 看门狗杀掉。更早四条 done 任务分别修 Enter 提交入口、判据设计、冷启动 boot 竞态、发送后 5s 轮询预算，**都没有声明整轮可花的墙、也没有抬 goal 记录的 deadline**。⇒ 同一保证被同一类「55s/60s 默认墙」反复打红。

### 修法（只动量具预算与闸 deadline，判据语义逐字不动）

1. `playwright.config.ts` 的 `SPEC_BUDGET_MS` 增加 `'resident-enter-send.spec.ts': 240_000`，注释带上本轮读数（同树 60000ms `not-evaluated`、55002ms 看门狗越界且 boot 18768ms；健康整轮 20.5/28.6/47.6s）。240_000 与同族 `resident-status-bar.spec.ts`、`resident-running-view.spec.ts`、`transcript-follow.spec.ts`、`voice-trim.spec.ts` 的已声明值一致，约 5× 最慢健康整轮。
2. `goals/AC-180-用-enter-键发送与点发送按钮等价-未勾选知情不能发出-勾选后落成常驻.md` frontmatter 在 `criterion:` 后增加 `timeoutMs: 260000`（与 AC-109/AC-120/AC-254 同位置同量级：闸 > 看门狗 240s，留 20s 让看门狗越界时写状态、打印一行再退出，而不是被闸静默 SIGKILL）。
3. **明确不动**：`criterion:` 命令（`npx playwright test e2e/resident-enter-send.spec.ts`）、`expect:` 全文、`e2e/resident-enter-send.spec.ts` 的任何断言/常量、`SINGLE_SPEC_CEILING_MS = 55_000`、`BOOT_CEILING_MS`、`WEB_SERVER_TIMEOUT_MS`、项目全局 `timeout: 60_000`；不加 `retries` / `repeat-each` / `skip` / `only` / `page.route(`；不改 `src/**`、`server/**`。

**判别性（必须把「预算真被读」与「数字写大但没接线」分开）**：
- 正读：判据自己的输出必须出现 `re-armed to 240000ms from the run start`，且整条输出不含 `[e2e] watchdog:` 越界行。
- 诱导对：用模块自带的同步控制臂 `QUAY_E2E_CONFIG_EVAL_STALL_MS=40000`（`scripts/e2e-run-ceilings.mjs`，clamp ≤120000）把 config 求值钉住 40s——条目在时整轮约 68s 仍 exit 0；临时删掉条目后同一构造在 55s 被看门狗杀掉、exit 1，输出含 `crossed its own 55000ms ceiling`。两次除条目外完全同构，证明 240_000 是承重的。

**已知残余（如实登记，不在本条扩张）**：文件预算也会覆盖本文件未来新增的判据；spec 自己的 45s case 墙保留不变；AC-180 的 `expect:` 文本逐字不动。

## Plan

1. **先取红态基线**：记录 `uptime` load1，`grep '"item_id":"AC-180"' .quay/gate-events.jsonl | tail -3` 与 `git rev-parse 'HEAD^{tree}'`，确认量具红（watchdog/timeout）而不是 AC 断言红。
2. **声明预算**：在 `playwright.config.ts` 的 `SPEC_BUDGET_MS` 增加 `'resident-enter-send.spec.ts': 240_000`，注释按同族条目格式写清本轮读数与倍数。
3. **抬闸 deadline**：在 AC-180 记录的 frontmatter `criterion:` 后加 `timeoutMs: 260000`；记录其余字段（`expect`、`origin`、`status`、`goal`）逐字不动。
4. **正读**：连续 3 次 `npx playwright test e2e/resident-enter-send.spec.ts`，每次登记 `EXIT`、wall、`[e2e] watchdog-armed` / `[e2e] boot` 两行、`2 passed (…)` 与两组读数（`session.lifecycle_mode=resident`、`host.resident.bindsSession=true`、`control.lifecycle_mode=per-run`）。
5. **诱导对（承重）**：条目在 + `QUAY_E2E_CONFIG_EVAL_STALL_MS=40000` ⇒ exit 0 且 wall > 55s 且有 `re-armed to 240000ms`；临时删条目 + 同一 stall ⇒ exit 1 且逐字含 `crossed its own 55000ms ceiling`；还原后复绿。
6. **闸读回**：`quay goal get AC-180 --json --store --root <worktree>` 读回 `timeoutMs: 260000`；`quay goal gate AC-180 --root <worktree> --json` 得 `verdict: pass`，并把 `.quay/gate-events.jsonl` 尾部原文登记。
7. **契约面**：`npm run lint`、`npm run typecheck` exit 0；diff 只落在 Touches 内；`e2e/resident-enter-send.spec.ts` 零改动（`git diff … -- e2e/resident-enter-send.spec.ts | wc -c` == 0）。

## AC

- [ ] AC1 直跑稳定绿：连续 3 次 `npx playwright test e2e/resident-enter-send.spec.ts` 均 `EXIT=0`；每次贴 `2 passed (…)`、整轮 wall、`[e2e] watchdog-armed` 与 `[e2e] boot` 两行、跑前 `uptime` load1；3 次输出均不含 `[e2e] watchdog:` 越界行，最大 wall < `240_000`。
- [ ] AC2 预算已声明且被本判据读到：`grep -n "'resident-enter-send.spec.ts': 240_000" playwright.config.ts` 命中 1 行；判据输出逐字含 `re-armed to 240000ms from the run start`；`grep -n 'SINGLE_SPEC_CEILING_MS = ' playwright.config.ts` 仍为 `55_000`；全局 `^  timeout: 60_000,$` 仍命中。
- [ ] AC3 预算承重（诱导对，除条目外完全同构）：(a) 条目在时 `QUAY_E2E_CONFIG_EVAL_STALL_MS=40000 npx playwright test e2e/resident-enter-send.spec.ts` ⇒ `EXIT=0`、wall > 55s、输出含 `[e2e] config-eval-stall:` 与 `re-armed to 240000ms`、无越界行；(b) 临时删掉条目、保留同一 40s stall ⇒ `EXIT=1`，输出逐字含 `[e2e] watchdog: this run crossed its own 55000ms ceiling`；(c) 还原条目后同一命令（不带 stall）回到 `EXIT=0`；原始输出与 wall 入档，`git diff` 无负控残留。
- [ ] AC4 闸 deadline 已抬且可读：`quay goal get AC-180 --json --store --root <worktree>` 的 `timeoutMs` == `260000`；`criterion` 逐字仍为 `npx playwright test e2e/resident-enter-send.spec.ts`、`status == "achieved"`、`goal == "GOAL-013"`；`quay goal gate AC-180 --root <worktree> --json` 的 `verdict` 为 `pass`（若 CLI 在 worktree 上仍报旧值，保留 gate 原始输出并以上述 store 读法取证）。
- [ ] AC5 判定面未弱化、diff 范围受控：`git diff --name-only $(git merge-base develop HEAD)` 只含 `playwright.config.ts`、`goals/AC-180-…md`、本任务文件；`git diff $(git merge-base develop HEAD) -- e2e/resident-enter-send.spec.ts | wc -c` == 0；`git diff … -- 'goals/**'` 只有新增的 `timeoutMs: 260000` 一行；新增行匹配 `retries|repeat-each|test\.skip|test\.only|page\.route\(` 的条数为 0；`npm run typecheck` 与 `npm run lint` exit 0。

## DoD

真实落地：driver 的下一轮 goal gate 重跑 AC-180 时读到记录里的 `timeoutMs: 260000`，判据在冷缓存/负载下跑完并由 AC-180 自己的 (a)(b) 断言（resident + 真宿主持有；per-run 正控制）决定结果，`.quay/gate-events.jsonl` 的 AC-180 尾部重新是 pass（不再是 CURRENTLY FALSE）。完成记录贴出该 GateEvent 原文（`timestamp` / `treeSha` / `verdict` / `reason`），并贴 AC1 的 3 行直跑读数、AC2/AC4 的声明与读回原文、AC3 的诱导对原始输出。

完成记录须写明：这次修的是**量具的整轮预算**（55s 默认 → 本 spec 声明 240s）与**闸的 deadline**（默认 60s → 260s），不是产品保证；`criterion:` 命令与 `expect:` 全文逐字未动，`e2e/resident-enter-send.spec.ts` 一个字节未改，`SINGLE_SPEC_CEILING_MS`、`BOOT_CEILING_MS`、`WEB_SERVER_TIMEOUT_MS` 与全局 60s 墙未动。并写明：此前五条 done 任务分别修 Enter 提交入口、判据设计、冷启动 boot 竞态、发送后 5s 轮询预算，均未声明整轮预算；上一轮 `495146c7d` 自己第 3 次绿跑已到 47.6s（boot 23.4s），只余约 7s；今天同一 treeSha 41e9a82 先被 60000ms 闸 `not-evaluated (timeout)`、再被 55002ms 看门狗杀，红轮 reason 里没有一条 AC-180 断言失败。

⛔ 不得用 `retries`、`repeat-each`、`test.skip`、`test.only`、`page.route(`、改判据命令、改任何 `expect` 或放宽判据常量换绿。若 AC1 在净检出上仍稳定红（即判据在产品面为假），停手上报置 `needs-human`，不得把量具红写成产品绿。

该轴仍暗,理由:本任务只调整 e2e 判据的量具预算与 goal 记录的 deadline，未新增或移除模块、依赖或跨层引用，L_D/L_G 无可比读数。

## Touches

- playwright.config.ts（`SPEC_BUDGET_MS` 增加 resident-enter-send 条目）
- goals/AC-180-用-enter-键发送与点发送按钮等价-未勾选知情不能发出-勾选后落成常驻.md（frontmatter 增加 `timeoutMs: 260000`）
- e2e/resident-enter-send.spec.ts（判据文件，必须零改动；声明为覆盖面 collateral）
- tasks/gap-ac180-enter-criterion-run-budget-below-cold-start-wall.md（自触）

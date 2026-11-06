---
id: gap-ac175-busy-send-criterion-run-budget-not-declared
title: AC-175 判据的整轮预算从未声明：同一 treeSha 0b5c9a5 先连记 4 次 pass、随后在 55001ms
  被看门狗杀（config-eval-ms=22320）⇒ 按 GOAL-013 兄弟锚式给 resident-busy-send 声明
  SPEC_BUDGET_MS=240_000 并把记录 timeoutMs 抬到 260000，判据命令与产品断言逐字不动
status: done
labels:
  - gap
  - defect
parent: null
children: []
extra:
  schema: execution
goal_ac: AC-175
---
## Proposal

来源：本轮 gap-filing 的**直接测量**（不是台账尾巴）。AC-175 `status: achieved`，其 GOAL-013 已 achieved 且不再活跃，未声明 `long-term: true`；判据命令逐字为 `npx playwright test e2e/resident-busy-send.spec.ts`。台账尾部 `2026-11-06T10:23:28.149Z` 记 fail，故按 CURRENTLY FALSE 立案。

### 本轮直接测量（同一棵树上的双向翻转）

`.quay/gate-events.jsonl` 里 AC-175 `gate=goal` 的末五拍（`evaluationRoot` 均为 `/data/home/yale/work/claudecodeui`，`treeSha` 逐字全为 `0b5c9a572266416a6ccd18ed56e584f6ca797578` = 当前 `HEAD^{tree}`）：

1. `2026-11-06T10:08:42.766Z` verdict `pass` — `acceptance passed (exit 0)`
2. `2026-11-06T10:11:54.840Z` verdict `pass` — `acceptance passed (exit 0)`
3. `2026-11-06T10:16:03.187Z` verdict `pass` — `acceptance passed (exit 0)`
4. `2026-11-06T10:19:20.303Z` verdict `pass` — `acceptance passed (exit 0)`
5. `2026-11-06T10:23:28.149Z` verdict `fail` — `acceptance failed (exit 1) — [e2e] watchdog: this run crossed its own 55000ms ceiling at 55001ms (config-eval-ms=22320) and is ending here with exit 1 at 55006ms — stuck at stage "browser-launch-or-cases": observed past boot at 25332ms, so this run was inside browser launch or a case; both webServers answered the 2000ms probe at the crossing.`

⇒ **同一棵树 15 分钟内 4 绿 1 红**。红落在整轮看门狗的 55000ms 天花板，那拍的 `payload.reason` 不含任何 `resident.` / `ui.` / `cancel` 产品读数 token ⇒ 判据本体一条断言都没跑到。这是**量具的整轮预算**被宿主负载越过，不是产品保证变假；判据的绿跑读数（同 treeSha，`gap-ac175-criterion-ledger-red-is-whole-run-watchdog-crossing` 的完成记录逐字留档）为：`resident.queuedCard=0`、`resident.row.annotation=Will be handled after this answer finishes`、`ui.withdrawnBeforeEvent=false`、`ui.withdrawnAfterEvent=true`、`row.presentAfter=false`、`turnsAfterWithdraw=0`、`cancelPayloads=1`、`cancelAckFrames=1`、`cancelVerdictSource=command_lifecycle`、`afterStarted.withdrawButton=0`、`afterStarted.label=Started processing`、`perRun.queuedCard=1`。

### 机制：55s 默认单文件预算与 60s 默认闸 deadline 从未被这条判据声明

- `playwright.config.ts` 的 `SINGLE_SPEC_CEILING_MS = 55_000`；`SPEC_BUDGET_MS` 表里 GOAL-013 的兄弟重判据逐条声明了 `240_000`——`resident-running-view.spec.ts`、`resident-status-bar.spec.ts`、`resident-enter-send.spec.ts`、`resident-shell-tab.spec.ts`——且它们对应的 AC 记录都带 `timeoutMs: 260000`；**唯独 `e2e/resident-busy-send.spec.ts` 没有条目**，于是判据的单文件调用继承 55000ms（`RUN_CEILING_MS = selectedSpecFiles().reduce(... SPEC_BUDGET_MS[file] ?? SINGLE_SPEC_CEILING_MS)`）。
- spec 自己的墙也盖不住整轮：`e2e/resident-busy-send.spec.ts:755` 只有 `test.describe.configure({ mode: 'serial' })`（无 `timeout`），`test.beforeAll`（`:766`）承担三次 arm、两次 resident host 启动、client 预热、首次导航与 reveal session 而无 `test.setTimeout`；项目全局 `timeout: 60_000` 是第三道墙；`:1076` 又硬编码 `expect(elapsed, ...).toBeLessThan(55_000)`。
- AC-175 记录（`goals/AC-175-真实浏览器里常驻会话忙时发送直接送达-不走前端本地排队-标注与-cli-实际归属一致.md`）**无** `timeoutMs` 字段 ⇒ goal gate 落默认 60000ms，而看门狗在 55000ms 先开火，所以红总是以「watchdog ceiling crossed」而不是「产品断言失败」的形态出现。

### 上一轮修法为什么没兜住（不是产品回归）

`gap-ac175-criterion-ledger-red-is-whole-run-watchdog-crossing`（done，2026-10-08）**逐字**把 remedy 推到「缩短整轮时长 / 降驱动并发 / 换有余量的运行目录」，并写明「属 e2e 基建 / 驱动负载族（`playwright.config.ts`、`scripts/e2e-data-dir-*`、driver 并发），**不在本条内夹带**」；它本身是 verification-only，未改一个字节。更早七条 done 任务分别修启动守卫、锚点退役、心跳控制帧、composer WIP、宿主配额启动死等——**没有一条**声明过这条判据的整轮预算或闸 deadline。⇒ 同一保证被同一类「55s/60s 默认墙」反复打红；本条接手那份被显式让位的预算支。

<!-- dedup-ref -->
机制去重读数（本轮立案实测，`/data/home/yale/work/claudecodeui`，`HEAD` = `0c133b309d7b753e610ff97f46b005a3a567479d`，`HEAD^{tree}` = `0b5c9a572266416a6ccd18ed56e584f6ca797578`）：`grep -l '^goal_ac: *AC-175' tasks/*.md` 命中 8 份，`status` 逐字皆 **done**（`gap-claude-resident-busy-send-ui`、`gap-activity-heartbeat-frame-crashes-realtime-merge`、`gap-ac175-criterion-{bounded-boot-guard,anchor-retired-by-dock-consolidation,red-is-uncommitted-composer-wip,red-is-mid-run-hmr-of-live-edited-main-checkout,ledger-red-is-host-boot-death,ledger-red-is-whole-run-watchdog-crossing}`）——按规则 done 不是重复，而是更早修法没兜住的证据。在飞扫描（`tasks/*.md` 的 `^status:` ∈ todo/ready/needs-human）实测只有 `gap-cockpit-provider-warning-for-truncated-reads` 与 `gap-fleet-contract-and-sidebar-load-flake`，**无一认领 AC-175**。合并候选用仪器判定：`node /data/home/yale/.claude/plugins/cache/quay/quay/0.31.1/scripts/dist/task-granularity-advice.js --root /data/home/yale/work/claudecodeui --touches playwright.config.ts --touches e2e/resident-busy-send.spec.ts --touches goals/AC-175-*.md --json` ⇒ `peers: []`、`mentions: []` ⇒ **separate**，无合并对象。

### 修法（只动量具预算、spec 自墙与闸 deadline，判据语义逐字不动）

1. `playwright.config.ts` 的 `SPEC_BUDGET_MS` 增加 `'resident-busy-send.spec.ts': 240_000`，注释按同族条目格式写清本轮读数（同 treeSha 4 pass / 1 fail；`config-eval-ms=22320`；`crossed its own 55000ms ceiling at 55001ms`）与「240_000 与 GOAL-013 兄弟重判据同值、260_000 门限留 20s 让看门狗先写跨越行」。
2. `e2e/resident-busy-send.spec.ts`：加 `const SPEC_BUDGET_MS = 240_000;`（注释指向 config 条目与三墙关系）；`test.describe.configure({ mode: 'serial' })` → `{ mode: 'serial', timeout: SPEC_BUDGET_MS }`；`test.beforeAll` 首行 `test.setTimeout(SPEC_BUDGET_MS);`；`:1076` 的 `toBeLessThan(55_000)` → `toBeLessThan(SPEC_BUDGET_MS)`。
3. `goals/AC-175-….md` frontmatter 在 `criterion:` 后增加 `timeoutMs: 260000`（与 AC-109 / AC-120 / AC-172 / AC-173 / AC-174 / AC-180 / AC-254 同位置同量级：闸 > 看门狗 240s，留 20s 让越界被写下来而不是被闸静默 SIGKILL）。
4. **明确不动**：`criterion:` 命令、`expect:` 全文、任何产品断言（`QueuedMessageCard` / 标注 / 撤回三态 / per-run 正控）、`SINGLE_SPEC_CEILING_MS = 55_000`、`BOOT_CEILING_MS`、`WEB_SERVER_TIMEOUT_MS`、项目全局 `timeout: 60_000`；不加 `retries` / `repeat-each` / `skip` / `only` / `page.route(`；不改 `src/**`、`server/**`。

**判别性（必须把「预算真被读」与「数字写大但没接线」分开）**：正读要求判据输出出现 `re-armed to 240000ms from the run start` 且无 `[e2e] watchdog:` 越界行；诱导对用模块自带的同步控制臂 `QUAY_E2E_CONFIG_EVAL_STALL_MS=40000`（`scripts/e2e-run-ceilings.mjs`，clamp ≤120000）复现本轮 `config-eval-ms=22320` 的形态：条目在时整轮 > 55s 仍 exit 0；临时删条目后同一构造在 55s 被看门狗杀掉、exit 1 且逐字含 `crossed its own 55000ms ceiling`。两次除条目外完全同构，证明 240_000 承重。

## Plan

1. **先取红态基线**：记录 `uptime` 的 load1、`grep '"item_id":"AC-175"' .quay/gate-events.jsonl | tail -5`、`git rev-parse 'HEAD^{tree}'`，确认红是量具（watchdog ceiling）而不是 AC-175 产品断言。
2. **声明整轮预算**：`playwright.config.ts` 的 `SPEC_BUDGET_MS` 增加 `'resident-busy-send.spec.ts': 240_000`，注释写清本轮读数与倍数。
3. **spec 三墙同值**：加 `const SPEC_BUDGET_MS = 240_000;`，改 `test.describe.configure({ mode: 'serial', timeout: SPEC_BUDGET_MS })`，`beforeAll` 首行 `test.setTimeout(SPEC_BUDGET_MS)`，`:1076` 改 `toBeLessThan(SPEC_BUDGET_MS)`。
4. **抬闸 deadline**：AC-175 记录 frontmatter 加 `timeoutMs: 260000`；`criterion:` / `expect:` / `status` / `goal` 逐字不动。
5. **正读**：在新树上连续跑 `npx playwright test e2e/resident-busy-send.spec.ts`（建议 2–3 次，至少一次 load1 > 50），登记每次 `EXIT`、wall、`[e2e] watchdog-armed` / `[e2e] boot` 两行、`3 passed (…)` 与全部产品读数。
6. **诱导对（承重）**：条目在 + `QUAY_E2E_CONFIG_EVAL_STALL_MS=40000` ⇒ exit 0 且 wall > 55s 且含 `re-armed to 240000ms`；临时删条目 + 同一 stall ⇒ exit 1 且逐字含 `crossed its own 55000ms ceiling`；还原后复绿。
7. **派生与不变量**：`node --input-type=module -e "import {bootCeilingFor} from './scripts/e2e-run-ceilings.mjs'; console.log(bootCeilingFor(240000), bootCeilingFor(55000))"` 输出 `120000 40000`；`node --test scripts/e2e-run-ceilings.test.mjs` exit 0。
8. **闸读回**：`quay goal get AC-175 --json --store --root <worktree>` 读回 `timeoutMs: 260000`；`quay goal gate AC-175 --root <worktree> --json` 得 `verdict: pass`，并登记 `.quay/gate-events.jsonl` 尾部原文。
9. **契约面**：`npm run lint`、`npm run typecheck` exit 0；diff 只落在 Touches 内。

## AC

- [x] AC1 整轮预算已声明且被本判据读到：`grep -n "'resident-busy-send.spec.ts': 240_000" playwright.config.ts` 命中 1 行；判据输出逐字含 `re-armed to 240000ms from the run start`；`grep -n 'const SINGLE_SPEC_CEILING_MS = ' playwright.config.ts` 仍为 `55_000`；项目全局 `^  timeout: 60_000,$` 仍命中。
- [x] AC2 spec 三墙同值：`grep -n 'const SPEC_BUDGET_MS = 240_000' e2e/resident-busy-send.spec.ts`、`grep -n 'test.describe.configure({ mode: .serial., timeout: SPEC_BUDGET_MS })' e2e/resident-busy-send.spec.ts`、`grep -n 'test.setTimeout(SPEC_BUDGET_MS)' e2e/resident-busy-send.spec.ts`、`grep -n 'toBeLessThan(SPEC_BUDGET_MS)' e2e/resident-busy-send.spec.ts` 四处均命中；`grep -c 'toBeLessThan(55_000)' e2e/resident-busy-send.spec.ts` 为 0。
- [x] AC3 闸 deadline 已抬且判据物逐字未变：`grep -n '^timeoutMs: 260000' goals/AC-175-*.md` 退出 0；`criterion:` 逐字仍为 `npx playwright test e2e/resident-busy-send.spec.ts`，`status == "achieved"`，`goal == "GOAL-013"`；`quay goal get AC-175 --json --store --root <worktree>` 的 `timeoutMs` == `260000`。
- [x] AC4 派生天花板与既有不变量：`node --input-type=module -e "import {bootCeilingFor} from './scripts/e2e-run-ceilings.mjs'; console.log(bootCeilingFor(240000), bootCeilingFor(55000))"` 输出 `120000 40000`；`node --test scripts/e2e-run-ceilings.test.mjs` exit 0。
- [x] AC5 判据直跑稳定绿：至少 2 次 `npx playwright test e2e/resident-busy-send.spec.ts` 均 `EXIT=0`；每次贴 `3 passed (…)`、整轮 wall、`[e2e] watchdog-armed` / `[e2e] boot` 两行、跑前 `uptime` load1，且输出不含 `[e2e] watchdog:` 越界行。完成记录逐字抄产品读数：`resident.queuedCard=0`、`resident.row.annotation=Will be handled after this answer finishes`、`ui.withdrawnBeforeEvent=false`、`ui.withdrawnAfterEvent=true`、`row.presentAfter=false`、`turnsAfterWithdraw=0`、`cancelPayloads=1`、`cancelAckFrames=1`、`cancelVerdictSource=command_lifecycle`、`afterStarted.withdrawButton=0`、`afterStarted.label=Started processing`、`perRun.queuedCard=1`、`elapsed=`。
- [x] AC6 预算承重（诱导对，除条目外完全同构）：(a) 条目在时 `QUAY_E2E_CONFIG_EVAL_STALL_MS=40000 npx playwright test e2e/resident-busy-send.spec.ts` ⇒ `EXIT=0`、wall > 55s、输出含 `[e2e] config-eval-stall:` 与 `re-armed to 240000ms`、无越界行；(b) 临时删掉条目、保留同一 40s stall ⇒ `EXIT=1`，输出逐字含 `[e2e] watchdog: this run crossed its own 55000ms ceiling`；(c) 还原条目后同一命令（不带 stall）回到 `EXIT=0`；原始输出与 wall 入档，`git status` 无负控残留。
- [x] AC7 判定面未弱化、diff 范围受控：`git diff --name-only $(git merge-base develop HEAD)` 只含 `playwright.config.ts`、`e2e/resident-busy-send.spec.ts`、`goals/AC-175-…md`、本任务文件；`git diff $(git merge-base develop HEAD) -- e2e/resident-busy-send.spec.ts` 的新增/删除行只涉及 `SPEC_BUDGET_MS` / `55_000` / `describe.configure` / `setTimeout`，不含任何删除 `QueuedMessageCard`、`cancel_async_message`、撤回判定或 per-run 正控的 `expect(` 行；新增行匹配 `retries|repeat-each|test\.skip|test\.only|page\.route\(` 的条数为 0；`npm run typecheck` 与 `npm run lint` exit 0。

## DoD

真实落地：driver 的下一轮 goal gate 重跑 AC-175 时读到记录里的 `timeoutMs: 260000`，判据在冷缓存/负载下跑完并由 AC-175 自己的 (1)(2)(3)(4) 断言（常驻不发 QueuedMessageCard + 标注；撤回以 `cancelled` 事件判 + 移除且不产生一轮；started 后按钮消失；per-run 正控）决定结果，`.quay/gate-events.jsonl` 的 AC-175 尾部重新是 pass（不再是 CURRENTLY FALSE）。完成记录贴出该 GateEvent 原文（`timestamp` / `treeSha` / `verdict` / `reason`），并贴 AC5 的直跑读数、AC1/AC3/AC4 的声明与读回原文、AC6 的诱导对原始输出。

完成记录须写明：这次修的是**量具的整轮预算**（55s 默认 → 本 spec 声明 240s）、**spec 自身的墙**（elapsed 断言、describe 与 beforeAll 的 per-test 超时）与**闸的 deadline**（默认 60s → 260s），不是产品保证；`criterion:` 命令与 `expect:` 全文逐字未动，所有产品断言逐条保留，`SINGLE_SPEC_CEILING_MS`、`BOOT_CEILING_MS`、`WEB_SERVER_TIMEOUT_MS` 与全局 60s 墙未动。并写明：此前八条 done 任务没有一条声明过整轮预算；`gap-ac175-criterion-ledger-red-is-whole-run-watchdog-crossing` 明确把该 remedy 让位给 e2e 基建族；本轮同一 treeSha `0b5c9a5` 先连记 4 次 pass、再在 `55001ms` 被看门狗杀，红轮 reason 里没有一条 AC-175 断言失败。

⛔ 不得用 `retries`、`repeat-each`、`test.skip`、`test.only`、`page.route(`、改判据命令、删/放宽任何产品断言来换绿；`toBeLessThan` 只允许从硬编码 `55_000` 改为同一声明的 `SPEC_BUDGET_MS`。若 AC5 在净检出上仍稳定红（即判据在产品面为假），停手上报置 `needs-human`，不得把量具红写成产品绿。

该轴仍暗,理由:本任务只调整 e2e 判据的量具预算、spec 自身超时与 goal 记录的 deadline，未新增或移除模块、依赖或跨层引用，L_D/L_G 无可比读数。

## 完成记录

实现提交：`12351dc21`（worktree `gap-ac175-busy-send-criterion-run-budget-not-declared`，实现树 `6649ff13715f77ea5d8ebbe4eb721afe5966c338`）。

### 改了什么（只动量具预算 / spec 自墙 / 闸 deadline）

- `playwright.config.ts`：`SPEC_BUDGET_MS` 新增 `'resident-busy-send.spec.ts': 240_000`（位于 GOAL-013 兄弟条目区；注释记本轮读数：同 treeSha `0b5c9a5…` 4 pass / 1 fail、`config-eval-ms=22320`、`crossed its own 55000ms ceiling at 55001ms`；240_000 与 GOAL-013 兄弟同值；260_000 门限留 20s 让看门狗先写跨越行）。
- `e2e/resident-busy-send.spec.ts`：新增 `const SPEC_BUDGET_MS = 240_000;`；`test.describe.configure({ mode: 'serial', timeout: SPEC_BUDGET_MS })`；`test.beforeAll` 首行 `test.setTimeout(SPEC_BUDGET_MS);`；elapsed 断言 `toBeLessThan(55_000)` → `toBeLessThan(SPEC_BUDGET_MS)`。
- `goals/AC-175-….md`：`criterion:` 后新增 `timeoutMs: 260000`。
- 未动：`criterion:` 命令、`expect:` 全文、任何产品断言（QueuedMessageCard / 标注 / 撤回三态 / per-run 正控）、`SINGLE_SPEC_CEILING_MS = 55_000`、`BOOT_CEILING_MS`、`WEB_SERVER_TIMEOUT_MS`、项目全局 `timeout: 60_000`；未加 `retries` / `repeat-each` / `skip` / `only` / `page.route(`；未改 `src/**`、`server/**`。

### AC1/AC2/AC3/AC4 声明与读回原文

```
$ grep -n "'resident-busy-send.spec.ts': 240_000" playwright.config.ts
892:  'resident-busy-send.spec.ts': 240_000,
$ grep -n 'const SINGLE_SPEC_CEILING_MS = ' playwright.config.ts
405:const SINGLE_SPEC_CEILING_MS = 55_000;
$ grep -n '^  timeout: 60_000,$' playwright.config.ts
4038:  timeout: 60_000,

$ grep -n 'const SPEC_BUDGET_MS = 240_000' e2e/resident-busy-send.spec.ts
767:const SPEC_BUDGET_MS = 240_000;
$ grep -nE "test\.describe\.configure\(\{ mode: 'serial', timeout: SPEC_BUDGET_MS \}\)" e2e/resident-busy-send.spec.ts
769:test.describe.configure({ mode: 'serial', timeout: SPEC_BUDGET_MS });
$ grep -n 'test.setTimeout(SPEC_BUDGET_MS)' e2e/resident-busy-send.spec.ts
781:    test.setTimeout(SPEC_BUDGET_MS);
$ grep -n 'toBeLessThan(SPEC_BUDGET_MS)' e2e/resident-busy-send.spec.ts
1091:    expect(elapsed, ...).toBeLessThan(SPEC_BUDGET_MS);
$ grep -c 'toBeLessThan(55_000)' e2e/resident-busy-send.spec.ts
0

$ grep -n '^timeoutMs: 260000' goals/AC-175-*.md
8:timeoutMs: 260000
$ grep -n '^criterion:\|^status:\|^goal:' goals/AC-175-*.md
7:criterion: npx playwright test e2e/resident-busy-send.spec.ts
4:status: achieved
6:goal: GOAL-013
$ quay goal get AC-175 --json --store --root <worktree>   # timeoutMs
10:  "timeoutMs": 260000,

$ node --input-type=module -e "import {bootCeilingFor} from './scripts/e2e-run-ceilings.mjs'; console.log(bootCeilingFor(240000), bootCeilingFor(55000))"
120000 40000
$ node --test scripts/e2e-run-ceilings.test.mjs
ℹ tests 9 / pass 9 / fail 0   (EXIT=0)
```

### AC5 判据直跑（两次，均 EXIT=0，无 `[e2e] watchdog:` 越界行）

轮 1（2026-11-06T10:33:33Z，跑前 load1 66.16）：
```
[e2e] watchdog-armed: config-eval-ms=282, boot ceiling 120000ms from config-eval end (deadline at 120282ms after run start), then re-armed to 240000ms from the run start
[e2e] boot: both webServers answered at 5698ms (config-eval-ms=282), re-armed to 240000ms from the run start
elapsed=39702ms
3 passed (39.6s)
EXIT=0  WALL=40.66
```
轮 2（10:34:22Z，load1 47.27）：
```
[e2e] watchdog-armed: config-eval-ms=321, boot ceiling 120000ms from config-eval end (deadline at 120321ms after run start), then re-armed to 240000ms from the run start
[e2e] boot: both webServers answered at 4567ms (config-eval-ms=321), re-armed to 240000ms from the run start
elapsed=40326ms
3 passed (40.2s)
EXIT=0  WALL=41.07
```
轮 1 产品读数逐字：
`resident.queuedCard=0`、`resident.row.annotation=Will be handled after this answer finishes`、`ui.withdrawnBeforeEvent=false`、`ui.withdrawnAfterEvent=true`、`row.presentAfter=false`、`turnsAfterWithdraw=0`、`cancelPayloads=1`、`cancelAckFrames=1`、`cancelVerdictSource=command_lifecycle`、`afterStarted.withdrawButton=0`、`afterStarted.label=Started processing`、`perRun.queuedCard=1`、`elapsed=39702ms`。

### AC6 诱导对（除条目外完全同构）

(a) 条目在 + `QUAY_E2E_CONFIG_EVAL_STALL_MS=40000`（2026-11-06T10:35:08Z，load1 37.06）：
```
[e2e] config-eval-stall: holding config evaluation for 40000ms (QUAY_E2E_CONFIG_EVAL_STALL_MS=40000)
[e2e] watchdog-armed: config-eval-ms=40773, boot ceiling 120000ms from config-eval end (deadline at 160773ms after run start), then re-armed to 240000ms from the run start
[e2e] boot: both webServers answered at 44231ms (config-eval-ms=40773), re-armed to 240000ms from the run start
elapsed=78578ms
3 passed (38.7s)
EXIT=0  WALL=80.40
```
无 `[e2e] watchdog:` 越界行；整轮 wall 80.40s > 55s。

(b) 临时删掉条目、保留同一 40s stall（10:36:43Z，load1 54.92）：
```
[e2e] config-eval-stall: holding config evaluation for 40000ms (QUAY_E2E_CONFIG_EVAL_STALL_MS=40000)
[e2e] watchdog-armed: config-eval-ms=42295, boot ceiling 40000ms from config-eval end (deadline at 82295ms after run start), then re-armed to 55000ms from the run start
[e2e] watchdog: this run crossed its own 55000ms ceiling at 62833ms (config-eval-ms=42295) and is ending here with exit 1 at 63004ms — stuck at stage "browser-launch-or-cases": observed past boot at 62830ms, so this run was inside browser launch or a case; both webServers answered the 2000ms probe at the crossing.
EXIT=1  WALL=64.09
```

(c) 还原条目、不带 stall（10:37:55Z，load1 125.54）：
```
[e2e] watchdog-armed: config-eval-ms=3161, boot ceiling 120000ms from config-eval end (deadline at 123161ms after run start), then re-armed to 240000ms from the run start
[e2e] boot: both webServers answered at 6847ms (config-eval-ms=3161), re-armed to 240000ms from the run start
elapsed=44495ms
3 passed (41.7s)
EXIT=0  WALL=45.89
```
还原后 `git status --short` 为空（无负控残留）。

### AC7 diff / 契约面

```
$ git diff --name-only $(git merge-base develop HEAD)
e2e/resident-busy-send.spec.ts
goals/AC-175-…md
playwright.config.ts
（合并 develop 后追加 tasks/gap-ac175-busy-send-criterion-run-budget-not-declared.md）
$ git diff <mb> -- e2e/resident-busy-send.spec.ts | 新增行匹配 retries|repeat-each|test\.skip|test\.only|page\.route\( : 0
$ npm run typecheck  → EXIT=0
$ npm run lint       → EXIT=0
```
spec diff 的新增/删除行只涉及 `SPEC_BUDGET_MS` / `55_000` / `describe.configure` / `setTimeout`；唯一被删的 `expect(` 行是 elapsed 断言本身（`55_000` → `SPEC_BUDGET_MS`），未删任何产品断言（`QueuedMessageCard` / `cancel_async_message` / 撤回判定 / per-run 正控）。

### GateEvent 原文（worktree 根，goal gate 读回）

```json
{"id":"c33c6d97-11d9-41cf-9ddf-f8f7ba2fbdf8","item_id":"AC-175","pipeline_id":"AC-175","gate":"goal","actor":"goal-cli","verdict":"pass","timestamp":"2026-11-06T10:41:12.262Z","payload":{"reason":"acceptance passed (exit 0)","evaluationRoot":"/data/home/yale/work/claudecodeui-worktrees/gap-ac175-busy-send-criterion-run-budget-not-declared","treeSha":"6649ff13715f77ea5d8ebbe4eb721afe5966c338"}}
```
`quay goal gate AC-175 --root <worktree> --json` ⇒ `verdict: pass`、`timeoutMs: 260000`、`reason: acceptance passed (exit 0)`、`cause: null`。

### 结论

这次修的是**量具的整轮预算**（55s 默认 → 本 spec 声明 240s）、**spec 自身的墙**（elapsed 断言、describe 与 beforeAll 的 per-test 超时）与**闸的 deadline**（默认 60s → 260s），不是产品保证；`criterion:` 命令与 `expect:` 全文逐字未动，所有产品断言逐条保留，`SINGLE_SPEC_CEILING_MS`、`BOOT_CEILING_MS`、`WEB_SERVER_TIMEOUT_MS` 与全局 60s 墙未动。此前八条 done 任务没有一条声明过整轮预算；`gap-ac175-criterion-ledger-red-is-whole-run-watchdog-crossing` 明确把该 remedy 让位给 e2e 基建族；本轮同一 treeSha `0b5c9a5` 先连记 4 次 pass、再在 `55001ms` 被看门狗杀，红轮 reason 里没有一条 AC-175 断言失败。修复后同一判据在本 worktree 上 4 次直跑（含 load1 125.54）全部 exit 0，产品读数与历史绿跑逐字一致。

## Touches

- tasks/gap-ac175-busy-send-criterion-run-budget-not-declared.md（自触）
- playwright.config.ts（`SPEC_BUDGET_MS` 增加 `resident-busy-send.spec.ts`: 240_000）
- e2e/resident-busy-send.spec.ts（预算常量 / describe 超时 / beforeAll setTimeout / elapsed 断言）
- goals/AC-175-真实浏览器里常驻会话忙时发送直接送达-不走前端本地排队-标注与-cli-实际归属一致.md（frontmatter 增加 `timeoutMs: 260000`）
- scripts/e2e-run-ceilings.mjs（只读：`bootCeilingFor` 派生读数）
- scripts/e2e-run-ceilings.test.mjs（只跑不改：40s/120s 派生不变量）
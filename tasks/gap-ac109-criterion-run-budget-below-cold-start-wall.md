---
id: gap-ac109-criterion-run-budget-below-cold-start-wall
title: AC-109 判据仍压在 55s 默认单文件预算上：冷轮 config-eval 6569–7122ms、至 17703–21672ms 才越过
  boot，红绿两树判据物逐字相同却在 55003/55005ms 两次被看门狗杀掉；给 transcript-follow 声明
  SPEC_BUDGET_MS 并把记录 timeoutMs 抬到 260s，判据命令与断言逐字不动
status: done
labels:
  - gap
  - defect
parent: null
children: []
extra:
  schema: execution
goal_ac: AC-109
---
## Proposal

来源：本轮 gap-filing 的**直接测量**（不是台账尾巴）。AC-109 `status: achieved`，其 GOAL-004 已 achieved 且不再活跃，未声明 `long-term: true`；台账尾部两次 fail，故按 CURRENTLY FALSE 立案。

<!-- dedup-ref --> **机制去重（本轮实测）**：`grep -rl '^goal_ac: *AC-109' tasks/*.md` 命中 3 份，`status:` 逐字皆 **done** —— `gap-transcript-follow-small-gesture-detaches`（落地判据与意图驱动脱离）、`gap-transcript-follow-key-detach-vs-commit-pin`（修 PageUp 键按下与 commit-time pin 的一帧竞态）、`gap-transcript-follow-ac109-window-baseline-race`（把窗口参照锚到手势的输入时刻）。done 不是重复，而是更早修法没兜住的证据；在飞扫描（`^status:` ∈ {todo, ready, needs-human} 且 `^goal_ac: *AC-109`）0 命中。合并候选用仪器判定：`node /data/home/yale/.claude/plugins/cache/quay/quay/0.31.1/scripts/dist/task-granularity-advice.js --touches playwright.config.ts --touches "goals/AC-109-流式期间向上的小幅手势立即脱离跟随且不被拉回-按钮可回到跟随.md" --touches e2e/transcript-follow.spec.ts --json` ⇒ `peers: []`、`mentions: []` ⇒ **kept separate**，无合并对象。

**判据物（逐字取自 `goals/AC-109-流式期间向上的小幅手势立即脱离跟随且不被拉回-按钮可回到跟随.md`）**：`criterion:` = `npx playwright test e2e/transcript-follow.spec.ts -g "AC-109"`；`expect:` 逐字「同 AC-108 的页内 wire double 慢速流式：夹具**不含任何模型/CLI/外部服务**（无 mock gateway、无 SSE、无 claude 子进程、无 ANTHROPIC_* 环境变量），帧只经 app 自己建立的 chat socket 的 message 事件进入。贴底开始，流式进行中 mouse.wheel 向上 deltaY=-30（小于 50px 阈值）：此后到流结束零次程序写入 scrollTop、scrollTop 不增大（±1），「Scroll to bottom」按钮可见。随后点击按钮 → 回到底部，剩余流式期间 gap ≤ 1px。另测键盘路径：聚焦 pane 后按 PageUp（只产生 scroll 事件，无 wheel/touch），同样脱离且不被拉回。gap = scrollHeight − scrollTop − clientHeight，采样点必须在布局与 ResizeObserver 回调之后（例如页面内一个后注册的 ResizeObserver，或 rAF 内再 setTimeout 0）；在 rAF 内直接读 scrollHeight 读到的是 pin 之前的状态，不得当作绘制态。取假形态：沿用单一 50px 距底阈值判定脱离、并在增长时 pin（30px 手势仍判为跟随 → 被拉回）时本条必须红；只监听 wheel/touchmove 不认键盘滚动时键盘半必须红。」该记录当前**无** `timeoutMs` 字段 ⇒ goal gate 按默认 60000ms 击杀。

### 本轮直接测量（同一判据物，红绿两树逐字相同）

两次 fail（`.quay/gate-events.jsonl`，`payload.treeSha` 均为 `56c5ba940c871502e3ebcbb5bf10588c45d6cf34`）：

1. `2026-11-02T22:14:58.294Z`，actor `goal-sweep`，`payload.reason` 逐字：
   `acceptance failed (exit 1) — [e2e] watchdog: this run crossed its own 55000ms ceiling at 55000ms (config-eval-ms=7122) and is ending here with exit 1 at 55003ms — stuck at stage "browser-launch-or-cases": observed past boot at 21672ms, so this run was inside browser launch or a case; both webServers answered the 2000ms probe at the crossing.`
2. `2026-11-02T22:16:17.945Z`，actor `goal-cli`，同一 `treeSha`，`payload.reason` 逐字：
   `acceptance failed (exit 1) — [e2e] watchdog: this run crossed its own 55001ms ceiling at 55001ms (config-eval-ms=6569) and is ending here with exit 1 at 55005ms — stuck at stage "browser-launch-or-cases": observed past boot at 17703ms, so this run was inside browser launch or a case; both webServers answered the 2000ms probe at the crossing.`

同判据此前 11 连绿：`2026-10-24T15:55:37.566Z` → `2026-11-02T10:27:01.983Z`，`criterionHash=679832c048a07b86`，trees `b5ffb8c5e` / `3548ce021` / `c87a87b0d` / `ebd923d83` / `2fc4add2e` / `24a69a21f` / `4a3eff6d0` / `e1d1e01e6` / `0d1b7fdb4` / `bcf3496e4`，全部 `verdict=pass`。

本轮直跑（判据命令逐字，EXIT=0）：
- `git rev-parse HEAD` = `809b28780d684218b17d760bd6a0891af4a69554`，`HEAD^{tree}` = `e8c52fbeb6d5f9f3a7523a7b1fb0ae0eab11c9eb`。
- `1 passed (28.4s)`，整条 invocation `wall=29.25s`。
- `[e2e] watchdog-armed: config-eval-ms=249, boot ceiling 40000ms from config-eval end (deadline at 40249ms after run start), then re-armed to 55000ms from the run start`
- `[e2e] boot: both webServers answered at 3514ms (config-eval-ms=249), re-armed to 55000ms from the run start`
- `AC-109 readings: [{"label":"wheel","movedUpBy":30,"highestOffsetDelta":0,"detachFrames":77,"growthsInWindow":5,"paneWrites":[],"pageWrites":[],"buttonVisible":true,"buttonAppearancesInWindow":1,"completionPresent":false,"pinnedFrames":198,"pinnedGrowths":11,"unpinned":[],"settledGap":0},{"label":"keyboard","movedUpBy":434,"highestOffsetDelta":0,"detachFrames":72,"growthsInWindow":5,"paneWrites":[],"pageWrites":[],"buttonVisible":true,"buttonAppearancesInWindow":1,"completionPresent":false,"pinnedFrames":308,"pinnedGrowths":19,"unpinned":[],"settledGap":0}]`

**红树与绿树的判据物逐字相同**：`git diff --stat 56c5ba940c871502e3ebcbb5bf10588c45d6cf34 HEAD -- src server shared e2e playwright.config.ts scripts package.json package-lock.json` 为空；`git diff --name-only 56c5ba940c871502e3ebcbb5bf10588c45d6cf34 HEAD` 只有 `tasks/codex-session-provider-id-binding.md` 与 `tasks/gap-cloudpit-v30-release.md` 两个 markdown。⇒ 红不是产品代码或判据代码的变化。

### 机制：55s 默认单文件预算从未被这条判据声明

- `playwright.config.ts:404` `SINGLE_SPEC_CEILING_MS = 55_000`；`:406` 的 `SPEC_BUDGET_MS` 没有 `transcript-follow.spec.ts` 条目（`grep -c "transcript-follow.spec.ts'" playwright.config.ts` = 0）⇒ `:910-912` 的 `RUN_CEILING_MS` 对本判据 = 55000。
- spec 自己的墙已经够宽：`e2e/transcript-follow.spec.ts:2034` `test.describe.configure({ mode: 'serial', timeout: 180_000 })`，`:2046` 的 `beforeAll` 首句 `test.setTimeout(180_000)`。所以 55s 看门狗（以及其后 60s 的闸）是唯一先于 AC-109 断言生效的墙。
- 冷/热差：红轮 `config-eval-ms` 6569–7122（本轮绿 249），`observed past boot` 17703–21672ms（本轮绿 3514ms）⇒ 用例开始前的固定开销多出约 14–18s，占掉 55s 预算的三分之一。红轮随后在 `browser-launch-or-cases` 阶段被看门狗从外部 `process.exit(1)`；**两次红都没有任何 AC-109 断言失败**（reason 只有 watchdog 行），即量具在断言表态之前决定了判据。
- 60s 闸同样在默认值上：AC 记录无 `timeoutMs`，`resolveAcceptanceTimeout` 落 60000；即使把看门狗抬过 55s，不抬记录 deadline 也会在 60s 被静默 SIGKILL。

### 上一轮修法为什么没兜住

`gap-transcript-follow-ac109-window-baseline-race`（done，`d2f44458f` + `ef6e51117`）把 AC-109 窗口的参照系从设桩前换到手势的输入时刻，10/10 绿是在 load1≈28 的窗口取得的；它的 DoD 写了「并发与宿主负载不再把它偶发打红」。但它只改**测量窗口**，没有声明**整轮可花的墙**：`SPEC_BUDGET_MS` 依旧没有本文件条目，记录也没有 `timeoutMs`。冷缓存/高负载把 config 求值 + boot 从 3.8s 抬到 17.7–21.7s 时，同一保证换了一堵墙被杀——这次是 `RUN_CEILING_MS`（随后是 60s 闸），不是窗口断言。同族 `gap-ac172-criterion-run-budget-below-cold-start-wall`（done，`27916d002`，2026-11-02）一天前刚为 AC-172 做过同一治理；本条把该治理补到 AC-109。

### 修法（只动预算与闸 deadline，判据语义逐字不动）

1. `playwright.config.ts` 的 `SPEC_BUDGET_MS` 增加 `'transcript-follow.spec.ts': 240_000`，注释带上本轮读数（红轮 6569–7122ms config-eval / 17703–21672ms past boot / 55000–55001ms 越界；绿轮 28.4s 整轮 / 3514ms boot）。240_000 与同族 `resident-status-bar.spec.ts`、`resident-running-view.spec.ts` 的已声明值一致，约 8.5× 健康整轮。
2. `goals/AC-109-流式期间向上的小幅手势立即脱离跟随且不被拉回-按钮可回到跟随.md` frontmatter 在 `criterion:` 后增加 `timeoutMs: 260000`（与 AC-172/AC-173 同位置同量级：闸 > 看门狗 240s，留 20s 让看门狗越界时写状态、打印一行再退出，而不是被闸静默 SIGKILL）。
3. **明确不动**：`criterion:` 命令、`expect:` 全文、`e2e/transcript-follow.spec.ts` 的任何断言/常量、`SINGLE_SPEC_CEILING_MS = 55_000`、`BOOT_CEILING_MS`、`WEB_SERVER_TIMEOUT_MS`、项目全局 `timeout: 60_000`；不加 `retries` / `repeat-each` / `skip` / `only`；不改 `src/**`、`server/**`。

**判别性（必须把「预算真被读」与「数字写大但没接线」分开）**：
- 正读：判据自己的输出必须出现 `re-armed to 240000ms from the run start`，且整条输出不含 `[e2e] watchdog:` 越界行。
- 诱导对：用模块自带的同步控制臂 `QUAY_E2E_CONFIG_EVAL_STALL_MS=40000`（`scripts/e2e-run-ceilings.mjs`，clamp ≤120000）把 config 求值钉住 40s —— 条目在时整轮约 68s 仍 exit 0；临时删掉条目后同一构造在 55s 被看门狗杀掉、exit 1，输出含 `crossed its own 55000ms ceiling`。两次除条目外完全同构，证明 240_000 是承重的，不是「跑得慢也没关系」。

**已知残余（如实登记，不在本条扩张）**：同一个文件预算也会把 `-g "AC-106/107/108/110/111"` 这些兄弟判据的看门狗抬到 240s，而它们的记录仍按默认 60s 由闸击杀。结果仍是 fail，但越界线由看门狗换成闸；这是各 AC 自己的 deadline 治理，本条不代改。

## AC

- [x] AC1 直跑稳定绿：连续 5 次 `npx playwright test e2e/transcript-follow.spec.ts -g "AC-109"` 均 `EXIT=0`；每次贴 `1 passed (…)`、整轮 wall、`[e2e] watchdog-armed` 与 `[e2e] boot` 两行、跑前 `uptime` load1；5 次输出均不含 `[e2e] watchdog:` 越界行，最大 wall < `240_000`。若宿主某轮给出 load1 ≥ 60，优先保留该轮；给不出就如实登记实际 load1。
- [x] AC2 预算已声明且被本判据读到：`grep -n "'transcript-follow.spec.ts': 240_000" playwright.config.ts` 命中 1 行；AC-109 判据输出逐字含 `re-armed to 240000ms from the run start`；`grep -n 'SINGLE_SPEC_CEILING_MS = ' playwright.config.ts` 仍为 `55_000`；`grep -n "^  timeout: 60_000,$" playwright.config.ts` 仍命中全局那一行。
- [x] AC3 预算承重（诱导对，除条目外完全同构）：(a) 条目在时 `QUAY_E2E_CONFIG_EVAL_STALL_MS=40000 npx playwright test e2e/transcript-follow.spec.ts -g "AC-109"` ⇒ `EXIT=0`、`1 passed`、wall > 55s，输出含 `[e2e] config-eval-stall: holding config evaluation for 40000ms` 且无越界行；(b) 临时从 `SPEC_BUDGET_MS` 删掉该条目、保留同一 40s stall ⇒ `EXIT=1`，输出逐字含 `[e2e] watchdog: this run crossed its own 55000ms ceiling`。(c) 还原条目后同一命令（不带 stall）回到 `EXIT=0`；原始输出与 wall 入档，`git diff` 无负控残留。
- [x] AC4 闸 deadline 已抬且可读：`quay goal get AC-109 --json --store --root <worktree>` 的 `timeoutMs` == `260000`（Provider 读法读主检出记录，merge 前读不到 worktree 的字段；必须用 store 方言）；`quay goal gate AC-109 --root <worktree> --json` 的输出/记录逐字含 `timeoutMs: 260000` 且 `verdict` 为 pass（若该 CLI 在 worktree 上仍报旧值，保留 gate 原始输出并以上述 store 读法取证，不得把读不到写成读到）。`criterion` 逐字仍为 `npx playwright test e2e/transcript-follow.spec.ts -g "AC-109"`，`expect` 全文与本 Proposal 引用一致，`status == "achieved"`、`goal == "GOAL-004"`。
- [x] AC5 判定面未弱化、diff 范围受控：`git diff --name-only $(git merge-base develop HEAD)` 只含 `playwright.config.ts`、`goals/AC-109-流式期间向上的小幅手势立即脱离跟随且不被拉回-按钮可回到跟随.md`、本任务文件（以及 Touches 里声明的判据文件）；`git diff $(git merge-base develop HEAD) -- e2e/transcript-follow.spec.ts | wc -c` == 0（判据文件一个字节未动）；`git diff $(git merge-base develop HEAD) -- 'goals/**'` 只有新增的 `timeoutMs: 260000` 一行、无其他删改；新增行匹配 `retries|repeat-each|test\.skip|test\.only|page\.route\(` 的条数为 0；`npm run typecheck` 与 `npm run lint` exit 0。

## DoD

真实落地：driver 的下一轮 goal gate 重跑 AC-109 时读到记录里的 `timeoutMs: 260000`、判据在冷缓存/负载下跑完并由 AC-109 自己的两条窗口断言（wheel 半与 keyboard 半）决定结果，`.quay/gate-events.jsonl` 的 AC-109 尾部重新是 pass（不再是 CURRENTLY FALSE）。完成记录贴出该 GateEvent 原文（`timestamp` / `treeSha` / `verdict` / `reason`），并贴 AC1 的 5 行直跑读数、AC2/AC4 的声明与读回原文、AC3 的诱导对原始输出。

完成记录须写明：这次修的是**量具的预算**（55s 默认 → 本 spec 声明 240s）与**闸的 deadline**（默认 60s → 260s），不是产品保证；`criterion:` 命令与 `expect:` 全文逐字未动，`e2e/transcript-follow.spec.ts` 一个字节未改，`SINGLE_SPEC_CEILING_MS`、`BOOT_CEILING_MS`、`WEB_SERVER_TIMEOUT_MS` 与全局 60s 墙未动。并写明：此前三个 done 任务分别修的是窗口参照系与键盘帧竞态，均未声明整轮预算；本轮两次红是看门狗在断言之前 `process.exit(1)`（reason 只有 watchdog 行，没有断言失败），红树与绿树的 `src/ server/ shared/ e2e/ playwright.config.ts scripts package.json package-lock.json` 逐字相同。

⛔ 不得用 `retries`、`repeat-each`、`test.skip`、`test.only`、`page.route(`、改判据命令、改任何 `expect` 或放宽 `AC109_*` 常量换绿。若 AC1 在净检出上仍稳定红（即判据在产品面为假），停手上报置 `needs-human`，不得把量具红写成产品绿。

该轴仍暗,理由:本任务只调整 e2e 判据的量具预算与 goal 记录的 deadline，未新增或移除模块、依赖或跨层引用，L_D/L_G 无可比读数。

## Evidence

完成记录（2026-11-02/03 UTC，worktree `/data/home/yale/work/claudecodeui-worktrees/gap-ac109-criterion-run-budget-below-cold-start-wall`，实现 commit `db121e9d6`，HEAD tree `50d0c8a94784afb8bb6bac5e95d16ee0b061af16`）。

这次修的是**量具的预算**（55s 默认 → 本 spec 在 `SPEC_BUDGET_MS` 声明 240s）与**闸的 deadline**（默认 60s → 记录 `timeoutMs: 260000`），不是产品保证：`criterion:` 命令与 `expect:` 全文逐字未动，`e2e/transcript-follow.spec.ts` 一个字节未改（`git diff BASE -- e2e/transcript-follow.spec.ts | wc -c` == 0），`SINGLE_SPEC_CEILING_MS = 55_000`、`BOOT_CEILING_MS`、`WEB_SERVER_TIMEOUT_MS` 与全局 `timeout: 60_000` 未动。此前三个 done 任务（`gap-transcript-follow-small-gesture-detaches`、`gap-transcript-follow-key-detach-vs-commit-pin`、`gap-transcript-follow-ac109-window-baseline-race`）分别修的是窗口参照系与键盘帧竞态，均未声明整轮预算；本轮两次红是看门狗在断言之前 `process.exit(1)`（reason 只有 watchdog 行，没有断言失败），且红树与绿树的 `src/ server/ shared/ e2e/ playwright.config.ts scripts package.json package-lock.json` 逐字相同。

### AC1 直跑（`npx playwright test e2e/transcript-follow.spec.ts -g "AC-109"`）

| # | 跑前 load1 | EXIT | `1 passed (…)` | 整轮 wall | 越界行 |
| - | - | - | - | - | - |
| 1 | 87.46 | 0 | `1 passed (32.7s)` | 37.75s | 无 |
| 2 | 58.63 | 0 | `1 passed (42.7s)` | 47.69s | 无 |
| 3 | 54.34 | 1 | —（客户端 warm-up 失败，见下） | 38.98s | 无 |
| 4 | 44.23 | 0 | `1 passed (1.5m)` | 99.22s | 无 |
| 5 | 78.62 | 0 | `1 passed (28.7s)` | 29.54s | 无 |
| 6 | 59.95 | 0 | `1 passed (28.7s)` | 30.38s | 无 |
| 7 | 48.39 | 0 | `1 passed (30.1s)` | 30.98s | 无 |
| 8 | 40.04 | 0 | `1 passed (28.3s)` | 29.38s | 无 |

AC1 的「连续 5 次 EXIT=0」由第 4–8 次构成，最大整轮 wall `99.22s` < `240_000`；5 次输出均不含 `[e2e] watchdog:` 越界行。第 1 次跑前 load1=87.46（≥60，本批最高负载轮）同样 EXIT=0；第 5 次 load1=78.62、第 6 次 load1=59.95，其余按实测登记。

八轮的 `[e2e] watchdog-armed` 与 `[e2e] boot` 原文（逐字）：

```
# run 1 (load1 87.46, EXIT=0)
[e2e] watchdog-armed: config-eval-ms=4123, boot ceiling 40000ms from config-eval end (deadline at 44123ms after run start), then re-armed to 240000ms from the run start
[e2e] boot: both webServers answered at 7549ms (config-eval-ms=4123), re-armed to 240000ms from the run start
# run 2 (load1 58.63, EXIT=0)
[e2e] watchdog-armed: config-eval-ms=4312, boot ceiling 40000ms from config-eval end (deadline at 44312ms after run start), then re-armed to 240000ms from the run start
[e2e] boot: both webServers answered at 16438ms (config-eval-ms=4312), re-armed to 240000ms from the run start
# run 3 (load1 54.34, EXIT=1 — client warm-up, not a criterion/watchdog red)
[e2e] watchdog-armed: config-eval-ms=349, boot ceiling 40000ms from config-eval end (deadline at 40349ms after run start), then re-armed to 240000ms from the run start
[e2e] boot: both webServers answered at 4789ms (config-eval-ms=349), re-armed to 240000ms from the run start
# run 4 (load1 44.23, EXIT=0)
[e2e] watchdog-armed: config-eval-ms=6783, boot ceiling 40000ms from config-eval end (deadline at 46783ms after run start), then re-armed to 240000ms from the run start
[e2e] boot: both webServers answered at 33831ms (config-eval-ms=6783), re-armed to 240000ms from the run start
# run 5 (load1 78.62, EXIT=0)
[e2e] watchdog-armed: config-eval-ms=250, boot ceiling 40000ms from config-eval end (deadline at 40250ms after run start), then re-armed to 240000ms from the run start
[e2e] boot: both webServers answered at 3859ms (config-eval-ms=250), re-armed to 240000ms from the run start
# run 6 (load1 59.95, EXIT=0)
[e2e] watchdog-armed: config-eval-ms=1102, boot ceiling 40000ms from config-eval end (deadline at 41102ms after run start), then re-armed to 240000ms from the run start
[e2e] boot: both webServers answered at 5510ms (config-eval-ms=1102), re-armed to 240000ms from the run start
# run 7 (load1 48.39, EXIT=0)
[e2e] watchdog-armed: config-eval-ms=259, boot ceiling 40000ms from config-eval end (deadline at 40259ms after run start), then re-armed to 240000ms from the run start
[e2e] boot: both webServers answered at 5788ms (config-eval-ms=259), re-armed to 240000ms from the run start
# run 8 (load1 40.04, EXIT=0)
[e2e] watchdog-armed: config-eval-ms=490, boot ceiling 40000ms from config-eval end (deadline at 40490ms after run start), then re-armed to 240000ms from the run start
[e2e] boot: both webServers answered at 3913ms (config-eval-ms=490), re-armed to 240000ms from the run start
```

第 3 次 EXIT=1 的原始失败逐字为：

```
Error: the client did not answer http://127.0.0.1:26643/@fs/data/home/yale/.cache/quay-e2e-tmp/quay-e2e-cUfKmp/vite-cache/deps/react_jsx-dev-runtime.js?v=d13493b2 inside the 30000ms startup budget (This operation was aborted)
    at fetchWithin (/data/home/yale/work/claudecodeui-worktrees/gap-ac109-criterion-run-budget-below-cold-start-wall/e2e/transcript-follow.spec.ts:1955:13)
    at warmClientStartup (/data/home/yale/work/claudecodeui-worktrees/gap-ac109-criterion-run-budget-below-cold-start-wall/e2e/transcript-follow.spec.ts:1981:17)
```

它在 `beforeAll` 的客户端 warm-up 上，是宿主 load1=54.34、67 个登录用户争用下 Vite 依赖预打包 URL 未在 30s 内应答；既不是 AC-109 的窗口断言失败，也不是看门狗越界（该轮 `re-armed to 240000ms`，无 `crossed its own`）。未做任何重试/弱化配置改动；连续计数从下一次重新开始（第 4–8 次即 5 连绿）。

### AC2 声明与读回

```
$ grep -n "'transcript-follow.spec.ts': 240_000" playwright.config.ts
842:  'transcript-follow.spec.ts': 240_000,
$ grep -n 'SINGLE_SPEC_CEILING_MS = ' playwright.config.ts
404:const SINGLE_SPEC_CEILING_MS = 55_000;
$ grep -n "^  timeout: 60_000,$" playwright.config.ts
3937:  timeout: 60_000,
```

判据自己的输出（八轮全部）逐字含 `then re-armed to 240000ms from the run start`（见 AC1 原文块）。

### AC3 预算承重（诱导对，除条目外完全同构）

| 臂 | `SPEC_BUDGET_MS` 条目 | stall | 跑前 load1 | EXIT | 原始读数 | wall |
| - | - | - | - | - | - | - |
| (a) 条目在 | `'transcript-follow.spec.ts': 240_000` | 40000ms | 36.86 | 0 | `1 passed (31.5s)`；`[e2e] config-eval-stall: holding config evaluation for 40000ms (QUAY_E2E_CONFIG_EVAL_STALL_MS=40000)`；`watchdog-armed: config-eval-ms=40297 … re-armed to 240000ms`；`boot: both webServers answered at 46996ms`；无 `[e2e] watchdog:` 越界行 | 72.47s |
| (b) 条目临时删除（只删该行，其余逐字不变） | — | 40000ms | 31.82 | 1 | `[e2e] watchdog: this run crossed its own 55000ms ceiling at 55000ms (config-eval-ms=43635) and is ending here with exit 1 at 55003ms — stuck at stage "browser-launch-or-cases": observed past boot at 46966ms, so this run was inside browser launch or a case; both webServers answered the 2000ms probe at the crossing.` | 55.96s |
| (c) 条目还原、无 stall | `'transcript-follow.spec.ts': 240_000` | — | 42.10 | 0 | `1 passed (37.4s)`；`watchdog-armed: config-eval-ms=371 … re-armed to 240000ms`；`boot: both webServers answered at 3812ms` | 38.61s |

(a) wall 72.47s > 55s 且 exit 0；(b) 在 55s 被看门狗杀死、exit 1，逐字含 `[e2e] watchdog: this run crossed its own 55000ms ceiling`。两次除条目外完全同构：同一 `QUAY_E2E_CONFIG_EVAL_STALL_MS=40000`，同一命令，只差 `SPEC_BUDGET_MS` 的那一行。还原用 `git -C <worktree> checkout -- playwright.config.ts`，随后 `git status --porcelain` 为空、`git diff --stat HEAD` 为空 ⇒ 无负控残留。

### AC4 闸 deadline 与记录逐字

`quay goal get AC-109 --json --store --root <worktree>`（store 方言，读 worktree 的 `goals/`）：

```json
{ "id": "AC-109", "status": "achieved", "kind": "criterion", "goal": "GOAL-004",
  "criterion": "npx playwright test e2e/transcript-follow.spec.ts -g \"AC-109\"",
  "timeoutMs": 260000, "longTerm": false, "branch": false }
```

`criterion` 逐字、`expect` 全文与 Proposal 引用一致（未改、未换行），`status == "achieved"`、`goal == "GOAL-004"`。

`quay goal gate AC-109 --root <worktree> --json`（在 worktree 内执行，`evaluationRoot` 即该 worktree）：

```json
{ "id": "AC-109", "verdict": "pass", "cause": null, "reason": "acceptance passed (exit 0)",
  "capabilityCode": null, "capabilityBypass": null, "timeoutMs": 260000,
  "timestamp": "2026-11-02T22:39:41.165Z", "dryRun": false }
```

该次 gate 写下的 GateEvent 原文（worktree `.quay/gate-events.jsonl`，AC-109 尾部）：

```json
{"id":"ca6183fe-eae5-44dc-9330-e9e94d5a4dd9","item_id":"AC-109","pipeline_id":"AC-109","gate":"goal","actor":"goal-cli","verdict":"pass","timestamp":"2026-11-02T22:39:41.165Z","payload":{"reason":"acceptance passed (exit 0)","evaluationRoot":"/data/home/yale/work/claudecodeui-worktrees/gap-ac109-criterion-run-budget-below-cold-start-wall","treeSha":"50d0c8a94784afb8bb6bac5e95d16ee0b061af16"}}
```

`treeSha` 等于本 worktree `git rev-parse HEAD^{tree}`；`timestamp` / `verdict` / `reason` 如上。

### AC5 判定面与 diff 范围

merge-base `2ced6055b0b1d3722a3894903f49f5215c8f7e40`：

```
$ git diff --name-only $(git merge-base develop HEAD)
"goals/AC-109-流式期间向上的小幅手势立即脱离跟随且不被拉回-按钮可回到跟随.md"
playwright.config.ts
$ git diff $(git merge-base develop HEAD) -- e2e/transcript-follow.spec.ts | wc -c
0
$ git diff $(git merge-base develop HEAD) -- 'goals/**'   # 仅一行新增
+timeoutMs: 260000
$ git diff $(git merge-base develop HEAD) | grep -E '^\+' | grep -E 'retries|repeat-each|test\.skip|test\.only|page\.route\(' | wc -l
0
$ npm run typecheck   # EXIT=0（tsc --noEmit × 3 全绿）
$ npm run lint        # EXIT=0（仅既有 importx / import 警告）
```

`src/**`、`server/**`、`shared/**`、`scripts/**` 零改动；`e2e/transcript-follow.spec.ts` 零字节。本任务文件由 `task_write` 在 ABI 上提交（不经本 worktree 的手工编辑）。

### DoD

```
$ node --no-warnings /data/home/yale/.claude/plugins/cache/quay/quay/0.30.1/scripts/dist/anti-drift-touches-check.js --task gap-ac109-criterion-run-budget-below-cold-start-wall --worktree /data/home/yale/work/claudecodeui-worktrees/gap-ac109-criterion-run-budget-below-cold-start-wall --merge-target develop
ANTI-DRIFT OK: task gap-ac109-criterion-run-budget-below-cold-start-wall — 2 actual file(s), all within declared Touches (4 glob(s))
```

`npm run typecheck` EXIT=0；`npm run lint` EXIT=0；记录完成时 worktree `git status --short` 为空。DoD 要求的「driver 下一轮 goal gate 重跑后 `.quay/gate-events.jsonl` 尾部重新是 pass」是**落地后**才产生的读数；本条在 worktree 内已取得同形的 GateEvent（`verdict: pass`、`timeoutMs: 260000`、`treeSha` = worktree HEAD 树），driver 的下一轮会以新的 treeSha 再写一条。

## Touches

- playwright.config.ts（`SPEC_BUDGET_MS` 增加 transcript-follow 条目）
- goals/AC-109-流式期间向上的小幅手势立即脱离跟随且不被拉回-按钮可回到跟随.md（frontmatter 增加 `timeoutMs: 260000`）
- e2e/transcript-follow.spec.ts（判据文件，必须零改动；声明为覆盖面 collateral）
- tasks/gap-ac109-criterion-run-budget-below-cold-start-wall.md（自触）
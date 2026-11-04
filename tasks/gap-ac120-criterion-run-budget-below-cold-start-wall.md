---
id: gap-ac120-criterion-run-budget-below-cold-start-wall
title: AC-120 判据仍压在 55s 默认单文件预算上：冷轮 config-eval 16267–21254ms、至 21875–53075ms
  才越过 boot，同一 treeSha 在 55000ms 被看门狗杀（另有两次 60000ms 闸击杀）⇒ 给 voice-trim 声明
  SPEC_BUDGET_MS 并把记录 timeoutMs 抬到 260s，判据命令与断言逐字不动
status: todo
labels:
  - gap
  - defect
parent: null
children: []
extra:
  schema: execution
goal_ac: AC-120
---
## Proposal

来源：本轮 gap-filing 的**直接测量**（不是台账尾巴）。AC-120 `status: achieved`，其 GOAL-006 已 achieved 且不再活跃，未声明 `long-term: true`；台账尾部最新一轮是 fail / not-evaluated，故按 CURRENTLY FALSE 立案。

<!-- dedup-ref --> **机制去重（本轮实测）**：`grep -rl '^goal_ac: AC-120' tasks/*.md` 命中 3 份，`status:` 逐字皆 **done** —— `gap-voice-file-upload-input`（实现开关控制的文件上传入口，走 `transcribeVoice`）、`gap-voice-upload-leg-unmeasured-under-shipped-recogniser`（修上传腿量不到音频、读数退回全 null）、`gap-ac120-upload-input-locator-ambiguous`（把 file input 定位锚到 `voice-upload-input` test id）。done 不是重复，而是更早修法没兜住的证据；在飞扫描（`^status:` ∈ {todo, ready, needs-human} 且 `^goal_ac: *AC-120`）0 命中。合并候选用仪器判定：`node /data/home/yale/.claude/plugins/cache/quay/quay/0.31.1/scripts/dist/task-granularity-advice.js --touches playwright.config.ts --touches "goals/AC-120-开关控制的音频文件上传入口走同一条转写链路.md" --touches e2e/voice-trim.spec.ts --touches tasks/gap-ac120-criterion-run-budget-below-cold-start-wall.md --json` ⇒ `peers: []`、`mentions: []` ⇒ **kept separate**，无合并对象。

**判据物（逐字取自 `goals/AC-120-开关控制的音频文件上传入口走同一条转写链路.md`）**：`criterion:` = `npx playwright test e2e/voice-trim.spec.ts -g "AC-120"`；`expect:` 全文「开关打开（URL ?voiceDebug=1）时 composer 出现音频文件上传入口；用 setInputFiles 提交入库 WAV fixture，断言 (1) 落到识别器端点上的请求体确实来自该文件（字节量级与容器魔力对得上，不是空体也不是固定体）；(2) composer 最终持有识别器返回的文本；(3) console 读数里 source === "file"；(4) 开关关闭时该入口不存在 —— 默认交互不变，用可见性断言，不是「设计上应该」。⛔ 入口必须复用 transcribeVoice 同一函数，不得旁路 onTranscript 直接塞固定文本。取假形态：入口走旁路（不经上传）使 (1) 红；开关关不掉使 (4) 红。当前必红：入口与 spec 均不存在。」该记录当前**无** `timeoutMs` 字段 ⇒ goal gate 按默认 60000ms 击杀。

### 本轮直接测量（同一判据物，就在今天）

`.quay/gate-events.jsonl` 里 AC-120 的尾部（逐字）：

1. `2026-11-04T08:29:22.231Z`，actor `goal-sweep`，`treeSha 7d0591457bbe70b9414269db8b7d817665e3e4da`：
   `acceptance failed (exit 1) — [e2e] watchdog: this run crossed its own 55000ms ceiling at 55000ms (config-eval-ms=16267) and is ending here with exit 1 at 55003ms — stuck at stage "browser-launch-or-cases": observed past boot at 21875ms, so this run was inside browser launch or a case; both webServers answered the 2000ms probe at the crossing.`
2. `2026-11-04T08:30:13.567Z`，actor `goal-cli`，**同一 treeSha `7d059145…`**：`acceptance passed (exit 0)` —— 相隔 51 秒，同树同判据，一次被杀一次通过 ⇒ 红不是产品保证变化。
3. `2026-11-04T08:38:05.283Z`，actor `goal-cli`，同一 treeSha：`not-evaluated (timeout): acceptance timed out after 60000ms (killed) — set the record's timeoutMs or QUAY_ACCEPTANCE_TIMEOUT_MS`。
4. `2026-11-04T09:07:22.771Z` 与 `2026-11-04T09:19:49.859Z`，actor `goal-cli`，`treeSha 84995af3cbf386795eab210227d443e78c5dfc98`：同样 `not-evaluated (timeout): acceptance timed out after 60000ms (killed)`。
5. `2026-11-04T09:31:14.124Z`，actor `goal-cli`，`treeSha a321af9d7376091ddf0c2fcb57911b82dcdbc087`：
   `acceptance failed (exit 1) — [e2e] watchdog: this run crossed its own 55000ms ceiling at 54999ms (config-eval-ms=21254) and is ending here with exit 1 at 56081ms — stuck at stage "browser-launch-or-cases": observed past boot at 53075ms, so this run was inside browser launch or a case; both webServers answered the 2000ms probe at the crossing.`

最尾部一条是 fail ⇒ 记录 CURRENTLY FALSE；两条 `not-evaluated (timeout)` 与两条 `55000/54999ms` 越界都不是 AC-120 断言失败，而是**量具/闸在断言表态之前结束整次调用**。

### 机制：55s 默认单文件预算与 60s 默认闸 deadline 从未被这条判据声明

- `playwright.config.ts:404` `SINGLE_SPEC_CEILING_MS = 55_000`；`:406` 的 `SPEC_BUDGET_MS` **没有** `voice-trim.spec.ts` 条目（`grep -c "voice-trim.spec.ts'" playwright.config.ts` = 0）⇒ 算出的 `RUN_CEILING_MS` 对本判据 = 55000。
- spec 自己的墙只盖测试体：`e2e/voice-trim.spec.ts:714` `test.setTimeout(35_000)`；`beforeAll`（开户向导 + 项目行）与浏览器启动、config 求值都在它之外。整条 invocation 健康时约 41–42s（`playwright.config.ts:401` 自己记录「voice-trim's ~42s against 55s」），冷轮固定开销一涨就顶到 55s。
- 冷/热差：今天红轮 `config-eval-ms` 16267–21254，`observed past boot` 21875–53075ms（绿轮 config-eval 常为数百 ms，boot 数秒）。用例开始前的固定开销占掉 55s 预算的三分之一到全部。
- 60s 闸同样在默认值：AC 记录无 `timeoutMs`，`resolveAcceptanceTimeout` 落 60000；即使把看门狗抬过 55s，不抬记录 deadline 也会在 60s 被静默 SIGKILL（上面两条 `not-evaluated (timeout)` 就是它）。

### 上一轮修法为什么没兜住

三个 done 任务分别修的是**入口本体**（`gap-voice-file-upload-input`）、**上传腿的测量**（`gap-voice-upload-leg-unmeasured-under-shipped-recogniser`）、**file input 定位二义**（`gap-ac120-upload-input-locator-ambiguous`，`0aad71dfa`），它们把判据从「入口与 spec 均不存在」推到能通过；但都只动产品/断言/定位，没有声明**整轮可花的墙**：`SPEC_BUDGET_MS` 依旧没有 `voice-trim.spec.ts` 条目，记录也没有 `timeoutMs`。于是同一保证换了一堵墙被杀——这次是 `RUN_CEILING_MS`（随后是 60s 闸），不是 AC-120 的四条断言。同族 `gap-ac109-criterion-run-budget-below-cold-start-wall`（done，`db121e9d6`）与 `gap-ac172-criterion-run-budget-below-cold-start-wall`（done，`27916d002`）已为兄弟判据做过同一治理；本条把该治理补到 AC-120。

### 修法（只动预算与闸 deadline，判据语义逐字不动）

1. `playwright.config.ts` 的 `SPEC_BUDGET_MS` 增加 `'voice-trim.spec.ts': 240_000`，注释带上本轮读数（红轮 config-eval 16267–21254ms / past boot 21875–53075ms / 55000–54999ms 越界；同树 51s 后 pass；健康整轮 ~42s）。240_000 与同族 `resident-status-bar.spec.ts`、`resident-running-view.spec.ts`、`transcript-follow.spec.ts` 的已声明值一致，约 5.7× 健康整轮。
2. `goals/AC-120-开关控制的音频文件上传入口走同一条转写链路.md` frontmatter 在 `criterion:` 后增加 `timeoutMs: 260000`（与 AC-109/AC-172/AC-173/AC-254 同位置同量级：闸 > 看门狗 240s，留 20s 让看门狗越界时写状态、打印一行再退出，而不是被闸静默 SIGKILL）。
3. **明确不动**：`criterion:` 命令、`expect:` 全文、`e2e/voice-trim.spec.ts` 的任何断言/常量、`SINGLE_SPEC_CEILING_MS = 55_000`、`BOOT_CEILING_MS`、`WEB_SERVER_TIMEOUT_MS`、项目全局 `timeout: 60_000`；不加 `retries` / `repeat-each` / `skip` / `only`；不改 `src/**`、`server/**`。

**判别性（必须把「预算真被读」与「数字写大但没接线」分开）**：
- 正读：判据自己的输出必须出现 `re-armed to 240000ms from the run start`，且整条输出不含 `[e2e] watchdog:` 越界行。
- 诱导对：用模块自带的同步控制臂 `QUAY_E2E_CONFIG_EVAL_STALL_MS=40000`（`scripts/e2e-run-ceilings.mjs`，clamp ≤120000）把 config 求值钉住 40s —— 条目在时整轮约 68s 仍 exit 0；临时删掉条目后同一构造在 55s 被看门狗杀掉、exit 1，输出含 `crossed its own 55000ms ceiling`。两次除条目外完全同构，证明 240_000 是承重的，不是「跑得慢也没关系」。

**已知残余（如实登记，不在本条扩张）**：
- 文件预算也会覆盖本文件未来新增的判据；今天 `-g "AC-120"` 选中的是本文件唯一测试（`grep -c "test('AC-" e2e/voice-trim.spec.ts` = 1）。
- AC-120 的 `expect:` 第 (3) 条仍逐字写着已退役的 `[voice:trim]` `source` 读数；AC 记录的 `origin` 已注明「文字未同步更新，留给人复核（未改 status / criterion）」。本条**不改** `expect:` 文本，只治理量具预算与闸 deadline。

## AC

- [ ] AC1 直跑稳定绿：连续 3 次 `npx playwright test e2e/voice-trim.spec.ts -g "AC-120"` 均 `EXIT=0`；每次贴 `1 passed (…)`、整轮 wall、`[e2e] watchdog-armed` 与 `[e2e] boot` 两行、跑前 `uptime` load1；3 次输出均不含 `[e2e] watchdog:` 越界行，最大 wall < `240_000`。若宿主某轮给出 load1 ≥ 60，优先保留该轮；给不出就如实登记实际 load1。
- [ ] AC2 预算已声明且被本判据读到：`grep -n "'voice-trim.spec.ts': 240_000" playwright.config.ts` 命中 1 行；AC-120 判据输出逐字含 `re-armed to 240000ms from the run start`；`grep -n 'SINGLE_SPEC_CEILING_MS = ' playwright.config.ts` 仍为 `55_000`；`grep -n "^  timeout: 60_000,$" playwright.config.ts` 仍命中全局那一行。
- [ ] AC3 预算承重（诱导对，除条目外完全同构）：(a) 条目在时 `QUAY_E2E_CONFIG_EVAL_STALL_MS=40000 npx playwright test e2e/voice-trim.spec.ts -g "AC-120"` ⇒ `EXIT=0`、`1 passed`、wall > 55s，输出含 `[e2e] config-eval-stall: holding config evaluation for 40000ms` 且无越界行；(b) 临时从 `SPEC_BUDGET_MS` 删掉该条目、保留同一 40s stall ⇒ `EXIT=1`，输出逐字含 `[e2e] watchdog: this run crossed its own 55000ms ceiling`；(c) 还原条目后同一命令（不带 stall）回到 `EXIT=0`；原始输出与 wall 入档，`git diff` 无负控残留。
- [ ] AC4 闸 deadline 已抬且可读：`quay goal get AC-120 --json --store --root <worktree>` 的 `timeoutMs` == `260000`（Provider 读法读主检出记录，merge 前读不到 worktree 的字段；必须用 store 方言）；`quay goal gate AC-120 --root <worktree> --json` 的输出/记录逐字含 `timeoutMs: 260000` 且 `verdict` 为 pass（若该 CLI 在 worktree 上仍报旧值，保留 gate 原始输出并以上述 store 读法取证，不得把读不到写成读到）。`criterion` 逐字仍为 `npx playwright test e2e/voice-trim.spec.ts -g "AC-120"`，`expect` 全文与本 Proposal 引用一致，`status == "achieved"`、`goal == "GOAL-006"`。
- [ ] AC5 判定面未弱化、diff 范围受控：`git diff --name-only $(git merge-base develop HEAD)` 只含 `playwright.config.ts`、`goals/AC-120-开关控制的音频文件上传入口走同一条转写链路.md`、本任务文件（以及 Touches 里声明的判据文件）；`git diff $(git merge-base develop HEAD) -- e2e/voice-trim.spec.ts | wc -c` == 0（判据文件一个字节未动）；`git diff $(git merge-base develop HEAD) -- 'goals/**'` 只有新增的 `timeoutMs: 260000` 一行、无其他删改；新增行匹配 `retries|repeat-each|test\.skip|test\.only|page\.route\(` 的条数为 0；`npm run typecheck` 与 `npm run lint` exit 0。

## DoD

真实落地：driver 的下一轮 goal gate 重跑 AC-120 时读到记录里的 `timeoutMs: 260000`、判据在冷缓存/负载下跑完并由 AC-120 自己的四条断言（上传请求体来自 fixture + composer 持有识别器文本 + 链内 fidelity 打印到达 + 开关关闭入口不存在）决定结果，`.quay/gate-events.jsonl` 的 AC-120 尾部重新是 pass（不再是 CURRENTLY FALSE）。完成记录贴出该 GateEvent 原文（`timestamp` / `treeSha` / `verdict` / `reason`），并贴 AC1 的 3 行直跑读数、AC2/AC4 的声明与读回原文、AC3 的诱导对原始输出。

完成记录须写明：这次修的是**量具的预算**（55s 默认 → 本 spec 声明 240s）与**闸的 deadline**（默认 60s → 260s），不是产品保证；`criterion:` 命令与 `expect:` 全文逐字未动，`e2e/voice-trim.spec.ts` 一个字节未改，`SINGLE_SPEC_CEILING_MS`、`BOOT_CEILING_MS`、`WEB_SERVER_TIMEOUT_MS` 与全局 60s 墙未动。并写明：此前三个 done 任务分别修的是入口本体、上传腿测量与 file input 定位，均未声明整轮预算；今天同一 treeSha 在 51 秒内先被 55000ms 看门狗杀、后 exit 0 通过，另有两轮被默认 60000ms 闸 `not-evaluated (timeout)`，红轮 reason 里只有 watchdog / timeout 行，没有任何 AC-120 断言失败。

⛔ 不得用 `retries`、`repeat-each`、`test.skip`、`test.only`、`page.route(`、改判据命令、改任何 `expect` 或放宽 `AC120_*` 常量换绿。若 AC1 在净检出上仍稳定红（即判据在产品面为假），停手上报置 `needs-human`，不得把量具红写成产品绿。

该轴仍暗,理由:本任务只调整 e2e 判据的量具预算与 goal 记录的 deadline，未新增或移除模块、依赖或跨层引用，L_D/L_G 无可比读数。

## Touches

- playwright.config.ts（`SPEC_BUDGET_MS` 增加 voice-trim 条目）
- goals/AC-120-开关控制的音频文件上传入口走同一条转写链路.md（frontmatter 增加 `timeoutMs: 260000`）
- e2e/voice-trim.spec.ts（判据文件，必须零改动；声明为覆盖面 collateral）
- tasks/gap-ac120-criterion-run-budget-below-cold-start-wall.md（自触）

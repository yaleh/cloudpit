---
id: gap-ac153-criterion-run-budget-under-host-load
title: AC-153 判据整轮成本在宿主负载下到 56.06s，同时越过自加 54s 守则与 55s 单文件看门狗（同一 error-context
  里既有 `Channel closed` 又有 `Received 56060`）——给 voice-error-messages 声明
  SPEC_BUDGET_MS、把守则与记录 timeoutMs 调自洽，判据命令与四条腿断言逐字不动
status: todo
labels:
  - gap
  - defect
parent: null
children: []
extra:
  schema: execution
goal_ac: AC-153
---
## Proposal

来源：本轮 gap-filing 的**直接测量**。AC-153 记录 `status: achieved`，其 GOAL-011 已 `achieved`、不再活，且未声明 `long-term: true`，故台账 `gate=goal` 尾部按 CURRENTLY FALSE 交办。判据物（逐字取自 `goals/AC-153-真实浏览器里各类失败显示各自的文案-提示持续显示到关闭-草稿保留-技术详情折叠.md`）：`npx playwright test e2e/voice-error-messages.spec.ts`。

### 一、本轮红的逐字读数：产品面已走完，红在墙钟；且两条墙同时越顶

`.quay/gate-events.jsonl` 两条 2026-11-06 的 goal 记账（本轮两跑，同一 criterionHash `5adc64011c3621fd`）：

- `goal-sweep` @ `2026-11-06T07:51:21.925Z`：`acceptance failed (exit 1) — [e2e] watchdog: this run crossed its own 55000ms ceiling at 55002ms (config-eval-ms=4297) and is ending here with exit 1 at 55006ms — stuck at stage "browser-launch-or-cases": observed past boot at 13533ms … both webServers answered the 2000ms probe at the crossing.`
- `goal-cli` @ `2026-11-06T07:52:55.890Z`：同形，`ceiling at 54999ms (config-eval-ms=1086)`、`observed past boot at 5482ms`。

存活 artifact（`/data/home/yale/.cache/quay-e2e-tmp/quay-e2e-K3gHZ4`，`watchdog-state.json` 逐字含 `"armed": true, "fired": true, "ceilingMs": 55000, "detail": "ceiling crossed at 54999ms — config-eval-ms=1086, this 55000ms ceiling ran from the run start"`）。其 `test-results/voice-error-messages-AC-15-542d2-ence-and-the-notice-behaves/error-context.md` 的 `# Error details` **同时**有两段：

```
Error: Channel closed
```
```
Error: the criterion exceeded its 54000ms budget

expect(received).toBeLessThan(expected)

Expected: < 54000
Received:   56060
```
（Location: `e2e/voice-error-messages.spec.ts:814:1`）

⇒ **用例体走完了**：整轮墙钟 `56_060ms` 被 afterAll 的自加守则读到并打印，随后（或同时）55s 看门狗 SIGKILL 成 `Channel closed`。artifact 里**没有**四条腿的产品断言红——与本条之前几轮的读数同形（四条腿绿，红在墙钟）。宿主侧读数：`uptime` = `load average: 85.63, 174.29, 172.81`（128 核），同窗口邻 spec 也有 `quay-e2e-HEEkqd`（55000ms，`resident-shell-tab`）与 `quay-e2e-Frx6CU`（55002ms）同形越顶 ⇒ **是宿主负载量级，不是本判据的产品面**。

### 二、机制：守则在 afterAll 才求值，天花板与守则必须一起抬，闸门第三堵墙也要跟着抬

1. `e2e/voice-error-messages.spec.ts` 有 `CRITERION_BUDGET_MS = 54_000`，但那条 `expect(criterionWallMs …).toBeLessThan(CRITERION_BUDGET_MS)` 在**afterAll 末尾**求值——只有在整轮跑完时才可能被读到。任何 `> 55_000` 的整轮成本都会先被看门狗 SIGKILL，守则连打印的机会都没有（本 artifact 的 `Channel closed` 与 `56060` 并存就是这一瞬间）。
2. `playwright.config.ts` 的 `RUN_CEILING_MS = selectedSpecFiles().reduce((t, f) => t + (SPEC_BUDGET_MS[f] ?? SINGLE_SPEC_CEILING_MS), 0)`；`SPEC_BUDGET_MS` **没有** `voice-error-messages.spec.ts` 条目 ⇒ 单文件选择下整轮上限就是 `SINGLE_SPEC_CEILING_MS = 55_000`。
3. AC-153 记录的 frontmatter **没有 `timeoutMs`** ⇒ goal gate 用默认 60s 截止。只抬看门狗而不抬记录截止，kill 只是从 55s 挪到 60s。

### 三、为什么上一条修复没守住

`gap-ac153-criterion-budget-rescale-unmerged`（done）把守则定为 `54_000`，规则是「在被报告 crossing 峰值（52_585）之上、`SINGLE_SPEC_CEILING_MS`（55_000）之下留 ≥1000ms 报告头部」，并在其 DoD 里**明确声明** `> 55000` 的尾部「任何值都不清、属声明外已知不等价点」（当时的负载臂是 20/24 路、`load1 ≤ 71.72`，quiet 最大 32_209）。

该声明现在被实测证伪：宿主包络已上移到 `load1` 85–175，整轮实测 `56_060`——**高于看门狗本身**。以 `SINGLE_SPEC_CEILING_MS − 1000` 为上限的任何定值按构造清不掉一个 `> SINGLE_SPEC_CEILING_MS` 的 crossing。⇒ 本条不是再调一次守则数字，而是承认「单文件 55s 这个天花板对 128 核共享宿主上的这条判据已经不够」，把**三堵墙**（spec 自加守则 / `SPEC_BUDGET_MS` 的整轮天花板 / AC 记录 `timeoutMs` 闸门）一起按实测包络重定，并保持可读性（越顶时要**被报告**，不是被 SIGKILL）。

### 四、要交付的事

1. **声明整轮预算**：在 `playwright.config.ts` 的 `SPEC_BUDGET_MS` 增加 `'voice-error-messages.spec.ts'` 条目，值与同族 voice spec 的既有条目一致（`240_000`；该文件安静臂 ~30s、负载臂实测 56s，240s 是失控守则而非性能目标），注释里写清本条的值来自本 Proposal 第一节的实测读数，而不是照抄。
2. **守则与新天花板自洽**：把 `CRITERION_BUDGET_MS` 抬到「实测负载臂最大整轮 × ≥1.5」且「≤ 新 `SPEC_BUDGET_MS` − 1000」的区间；注释改写为「低于新整轮天花板、留 ≥1000ms 报告头部」，并写清它在 afterAll 求值这一时序事实。三条读数（wall 预算断言、`watchdogLine === false`、`watchdog.armed === true`）**逐字保留**。
3. **抬高记录闸门**：给 `goals/AC-153-…md` frontmatter 增加 `timeoutMs`（新 `SPEC_BUDGET_MS` + 20_000，即 `260_000`，与 AC-180/AC-120/AC-109 先例同形），使看门狗越顶行先写出来而不是被 gate SIGKILL。`criterion:` / `expect:` / `status:` 逐字不动。
4. **同步登记串**：`src/modules/chat/tests/voiceErrorNoticePersistence.test.tsx:455` 的 `'55s watchdog and its 54s criterion budget'` 随新值更新（该登记串是变异测试的叙述，须与真实值一致）。
5. **实测两臂**：安静臂 ≥3 次全绿；负载臂在与红点同量级（`load1 ≥ 85`，或 ≥20 路并发兄弟 `npx playwright test`）下 ≥2 次全绿，且**至少一次 `criterion-wall-ms > 54_000`**（证明新预算确实吃到旧红读数），逐次入档 `criterion-wall-ms` / `watchdog-line` / `load1`。
6. **不弱化**：四条腿断言、三条取假形态、`goals/` 的 `criterion:`/`expect:` 全部不动；只改守则常量与注释、配置条目、记录 `timeoutMs`、登记串。

**非目标**：不改 AC-153 的产品面（四条腿文案、4 秒后仍可见、关闭、下次录音清除、草稿逐字保留、折叠技术详情、无拼接句）；不改 `SINGLE_SPEC_CEILING_MS`（它是别的判据共享的默认值，本条走 per-file 条目）；不重复 `gap-ac174-criterion-run-budget-and-boot-ceiling-below-load-slowdown` 的 boot 天花板杠杆；不重复 `gap-warmclientstartup-…` 的冷路径削减。

<!-- dedup-ref --> 机制去重读数（本轮）：`grep '^goal_ac: *AC-153' tasks/*.md` 命中 5 条，`status` 全为 `done`（`gap-voice-error-notice-browser-e2e`、`gap-ac153-ledger-red-is-host-quota`、`gap-e2e-data-dir-has-no-reclaimer`、`gap-ac153-criterion-wallclock-load-headroom`、`gap-ac153-criterion-budget-rescale-unmerged`）；**in-flight（todo/ready/needs-human）的 `goal_ac: AC-153` 认领者 = 0**，故本条不是重复。`task-granularity-advice.js`（Touches = 本条四项）报 `peers[] = [gap-ac174-criterion-run-budget-and-boot-ceiling-below-load-slowdown (ready, sharedFiles: playwright.config.ts)]`，`mentions[] = [gap-ac331-composer-embedded-first-frame-vs-uplink-vad-load (ready)]`。与 ac174 **kept separate**：它治的是 `BOOT_CEILING_MS` 不随 run budget 缩放（本 artifact `past boot at 5482ms`，boot 早已通过，不是本条机制）；本条治的是 per-file 整轮预算缺条目 + afterAll 守则 + 记录闸门三墙同抬。两者都触 `playwright.config.ts`，由调度器串行化即可。

## Plan

1. 建隔离 worktree（起点 = 开工时 `develop`），打印路径、`git rev-parse HEAD` 与 `HEAD^{tree}`，确认 `git status --porcelain` 空。
2. 机械复录红态：贴 `.quay/gate-events.jsonl` 两条 2026-11-06 记账、`quay-e2e-K3gHZ4` 的 `error-context.md` `# Error details` 两段与 `watchdog-state.json` 原文；写明 artifact 内四条腿无红。若 artifact 已被回收，改贴台账记录并声明回收。
3. 基线读数：`grep -n 'CRITERION_BUDGET_MS' e2e/voice-error-messages.spec.ts`、`grep -n 'voice-error-messages.spec.ts' playwright.config.ts`（应无命中）、`grep -n '^timeoutMs' goals/AC-153-*.md`（应无命中）、`grep -n '55s watchdog and its 54s criterion budget' src/modules/chat/tests/voiceErrorNoticePersistence.test.tsx`，逐字入档。
4. 实施：`SPEC_BUDGET_MS` 加条目 `240_000`；`CRITERION_BUDGET_MS` 按 Proposal 四.2 定值并改注释；AC-153 frontmatter 加 `timeoutMs: 260000`（经 goal ABI/记录写入路径，若 ABI 不能写该字段则用仓库既有先例的写法并说明）；登记串同步。
5. 安静臂：出货命令逐字跑 ≥3 次，全部 exit 0 且自印 `legs=4 passed=4 watchdog-line=false`，逐次入档 `criterion-wall-ms` 与 `load1`。
6. 负载臂：≥20 路并发兄弟 `npx playwright test`（或制造 `load1 ≥ 85`）下重跑出货命令 ≥2 次，入档每次 `criterion-wall-ms` / `watchdog-line` / `load1`；要求至少一次 `> 54_000` 且仍 exit 0。若该负载下仍出现「低于新守则却越看门狗」或「越新守则」的可复现 crossing：置 `needs-human`，附逐字读数与已排除项，🚫 不得把安静通过写成「已修」。
7. 未弱化与类型：`git diff <base>..HEAD -- goals/` 只含 `timeoutMs` 一行；`npx vitest run src/modules/chat/tests/voiceErrorNoticePersistence.test.tsx` exit 0；`npx tsc --noEmit -p tsconfig.json` exit 0。
8. 写完成记录，置终态。

## AC

- [ ] AC1 红态逐字入档：贴出 `.quay/gate-events.jsonl` 两条 2026-11-06 goal 记账（`54999`/`55002`ms、`config-eval-ms` 1086/4297、`stage "browser-launch-or-cases"`）与 `quay-e2e-K3gHZ4` 的 `# Error details` 两段（`Channel closed` + `Expected: < 54000` / `Received: 56060`，Location `e2e/voice-error-messages.spec.ts:814:1`）及 `watchdog-state.json` 原文；写明该 artifact 内四条腿无产品断言红。
- [ ] AC2 整轮预算已声明：`grep -n "voice-error-messages.spec.ts" playwright.config.ts` 命中 `SPEC_BUDGET_MS` 条目（值 `240_000`）；单跑一次后 `watchdog-state.json` 的 `ceilingMs` 读数 `= 240000`（或 `RUN_CEILING_MS` 打印值 ≥ 240000），逐字入档。
- [ ] AC3 守则与新天花板自洽：`grep -n 'CRITERION_BUDGET_MS' e2e/voice-error-messages.spec.ts` 打印新值；打印实测负载臂最大整轮 `W`，证明 `W × 1.5 ≤ 新值 ≤ 240_000 − 1000`；`expect(watchdogLine, …).toBe(false)` 与 `expect(watchdog.armed, …).toBe(true)` 逐字仍在。
- [ ] AC4 记录闸门已抬高：`grep -n '^timeoutMs' goals/AC-153-*.md` 输出 `timeoutMs: 260000`；`git diff <base>..HEAD -- goals/` 只含该行，`git diff <base>..HEAD -- goals/ | grep -E '^[+-](id|criterion|expect|status):'` 无输出。
- [ ] AC5 安静臂全绿：出货命令逐字跑 ≥3 次，全部 `exit 0` 且自印 `legs=4 passed=4 watchdog-line=false`，逐次入档 `criterion-wall-ms` 与 `load1`。
- [ ] AC6 负载臂实测：`load1 ≥ 85`（或 ≥20 路并发兄弟）下重跑出货命令 ≥2 次，入档每次 `criterion-wall-ms` / `watchdog-line` / `load1`；至少一次 `criterion-wall-ms > 54_000` 且 `exit 0`、`watchdog-line=false`。若该负载下出现可复现 crossing：置 `needs-human` 并逐字入档，🚫 不把安静通过写成「已修」。
- [ ] AC7 未弱化：`npx vitest run src/modules/chat/tests/voiceErrorNoticePersistence.test.tsx` exit 0（三条取假形态仍各自红）；`npx tsc --noEmit -p tsconfig.json` exit 0；该 spec 的 `git diff` 只触守则常量/注释与登记串，四条腿断言逐字未改（`git diff` 中无产品断言行变化）。

## DoD

真实落地：出货命令 `npx playwright test e2e/voice-error-messages.spec.ts` 逐字不变，在同一台宿主上以**不低于红点量级**的负载（`load1 ≥ 85`）≥2 次 `exit 0` 且自印 `legs=4 passed=4 watchdog-line=false`，并至少有一次读数落在旧守则之上（`criterion-wall-ms > 54_000`）——即末次那类红（56.06s、`Channel closed` 与守则越顶并存、四条腿全绿）在新三墙下为绿；由执行读数证明，不由段落文字声明。

承重性由三件读数证明：

(a) **红是墙钟红，不是判据为假**：artifact 的 `# Error details` 只有 `Channel closed` 与守则越顶两条，四条腿无产品断言红（AC1）。
(b) **不是「放宽 AC」**：`goals/AC-153-…md` 的 `criterion:` / `expect:` / `status:` 逐字未改，只加 `timeoutMs`（AC4）；四条腿断言与三条取假形态逐字未动（AC7）；守则仍存在且在 afterAll 报告越顶（AC3）。
(c) **不是重做上一条**：上一条把上限钉在 `SINGLE_SPEC_CEILING_MS − 1000` 并声明 `> 55000` 尾部为声明外；本条实测 `56_060` 正落在该声明外，故按实测包络抬三堵墙，而非再挪一次 54s。

**已知不等价点与逃逸**：抬预算只把「负载把整轮推过 55s」这类红清掉，不降低判据本身成本（~30s quiet）；若将来宿主包络再上移越过新守则，仍会红——那时按 AC6 的逃逸条款置 `needs-human`，附读数，⛔ 不得删守则、删读数或让看门狗先行 SIGKILL。

## Touches

- playwright.config.ts（`SPEC_BUDGET_MS` 增加 voice-error-messages 条目）
- e2e/voice-error-messages.spec.ts（`CRITERION_BUDGET_MS` 定值与注释）
- goals/AC-153-真实浏览器里各类失败显示各自的文案-提示持续显示到关闭-草稿保留-技术详情折叠.md（frontmatter 增加 `timeoutMs: 260000`）
- src/modules/chat/tests/voiceErrorNoticePersistence.test.tsx（变异测试登记串同步）
- tasks/gap-ac153-criterion-run-budget-under-host-load.md（自触）

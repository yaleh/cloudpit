---
id: gap-ac323-criterion-ledger-red-is-merge-race
title: AC-323 判据台账尾部红是 merge race：修复 23cbd70b2（09:18:29+08）只提交在 task 分支，主检出到
  09:34:30 才 ff 进含修复的树；gate 于 09:32 前后从主检出启动、读到修复前 spec（Location 1142 = 修复前行号，18
  例 vs 19 例）——当前树 CMD1 19 passed + 375px 腿 1 passed，verification-only 归因入档，不重新实现
status: ready
labels:
  - gap
parent: null
children: []
extra:
  schema: execution
goal_ac: AC-323
---
## Proposal

<!-- dedup-ref --> 机制去重读数（本轮立案实测）：`grep -E '^goal_ac: *AC-323' tasks/*.md` 命中 **12 条**任务，`status:` 逐字全部 **done**（`gap-live-voice-composer-embedded-dual-entry`、`gap-live-voice-composer-embedded-acceptance-spec`、`gap-ac323-375px-bar-horizontal-overflow`、`gap-ac323-vitest-stderr-masks-load-flake`、`gap-ac323-upload-fixture-delivered-row-carries-heard-pieces`、`gap-ac323-red-attributable-and-held-run-window`、`gap-ac323-live-session-bare-reload-and-loaded-criterion-budget`、`gap-ac323-late-final-caption-unclaimed-by-its-delivery`、`gap-ac323-gate-deadline-below-criterion-serial-time`、`gap-ac323-embedded-fake-audiocontext-missing-statechange-api`、`gap-ac323-composer-embedded-disconnect-draft-carry-hides-entry`、`gap-ac323-composer-embedded-arming-first-frame-and-criterion-deadline`）；在飞扫描（`status:` ∈ todo/ready/needs-human 且 `^goal_ac: *AC-323`）**0 命中** ⇒ 无在飞认领者，本条不是重复。同族先例 `gap-ac351-criterion-ledger-red-is-merge-race`、`gap-ac306-criterion-ledger-red-is-merge-race`、`gap-ac250-…`、`gap-ac249-…` 各为**另一条 AC**，仅归因机制相同（merge race）。`node .../task-granularity-advice.js --root /data/home/yale/work/claudecodeui --touches src/modules/chat/outline/InputOutlineDrawer.tsx --touches e2e/voice-realtime-upload-fixture.spec.ts …` 报 `peers: []`、`mentions: []`。

来源：本轮 gap-filing 的**直接测量**（不是台账尾巴）。GOAL-035 的 AC-323（`goals/AC-323-composer-内双语音入口-容器内-live-voice-紧凑栏-波形-时长-字幕-模型-mute-end-桌面与.md`，`status: achieved`）被判 CURRENTLY FALSE 交办。判据物逐字（取自该 goal 文件的 `criterion:`）：

```
npx playwright test e2e/voice-realtime-live-session-send.spec.ts e2e/voice-realtime-upload-fixture.spec.ts e2e/voice-realtime-composer-embedded.spec.ts && npx vitest run src/modules/chat/tests/composerCompactTier.test.tsx src/modules/chat/voice-realtime && npx playwright test e2e/mobile-workspace-composer-layout.spec.ts -g " idle "
```

### 本轮现测：判据失败的那条命令在当前树上已经绿

在 `/data/home/yale/work/claudecodeui`（branch `author`，HEAD `dd9db6a3c`，tree `9cc37c5`）直跑：

- CMD1（三条 spec，逐字）→ **exit 0**，`19 passed (3.1m)`。
- 375px 腿单独跑 → **exit 0**，`1 passed (31.1s)`；页面读数逐字 `[ac323-375-overflow] {"viewportWidth":375,"documentClientWidth":375,"documentScrollWidth":375,"bar":{"x":8,"width":359},…,"offenders":[]}`，会话列（`div.flex.min-h-0.min-w-[200px].flex-col`）`scrollLeft=0 scrollWidth=375 clientWidth=375`。

⇒ 被门禁判红的那条命令在当前树上已经满足；本条做 **verification-only 归因入档**，不重新实现任何修复。

### 红跑逐字

`.quay/gate-events.jsonl` 的 gate event `7f4da326-d724-4514-8c36-3ac5cb3bb0f5`：`item_id=AC-323`、`gate=goal`、`actor=goal-cli`、`verdict=fail`、`timestamp=2026-10-27T01:34:37.100Z`、`evaluationRoot=/data/home/yale/work/claudecodeui`、`treeSha=9cc37c5111e86c97c2e2e2763db9f662943012af`。理由逐字尾段：

```
1 failed e2e/voice-realtime-upload-fixture.spec.ts:1142:3 › voice realtime upload fixture ›
375px: the same injection gesture works with the bar inside the viewport
5 did not run
12 passed (2.1m)
```

trace 在 `.cache/quay-e2e-tmp/quay-e2e-tusb4s/test-results/voice-realtime-upload-fixt-a93a3-the-bar-inside-the-viewport/`，错误逐字 `Error: expect(received).toBeGreaterThanOrEqual(expected)\n\nExpected: >= 0\nReceived:    -139`。

### 机制：merge race（修复落地晚于判据测量），不是修复失效

1. **红跑读的是修复前的 spec。** trace 的 `Location: e2e/voice-realtime-upload-fixture.spec.ts:1142:3`；而 HEAD 上该用例在第 **1242** 行（修复 `23cbd70b2` 给该 spec 加了 100 行，含新增 390px 用例）。用例总数同向印证：红跑 `12 passed + 5 did not run + 1 failed = 18`，而 HEAD 的 CMD1 是 **19** 例。
   - `git show f20fd027c:e2e/voice-realtime-upload-fixture.spec.ts | grep -n "375px: the same injection gesture"` → `1142`；同一 grep 在 HEAD → `1242`。
   - `git show f20fd027c:src/modules/chat/outline/InputOutlineDrawer.tsx | grep -c data-input-outline-clip` → `0`；HEAD → `1`。
2. **主检出的 HEAD 在红跑期间是 `f20fd027c`（tree `67ec3785`），不含修复：** `git merge-base --is-ancestor 23cbd70b2 f20fd027c; echo $?` → `1`（而 `… dd9db6a3c` / `… develop` / `… HEAD` → `0`）。
3. **`git reflog` 逐字：** `dd9db6a3c HEAD@{2026-10-27 09:34:30 +0800}: merge develop: Fast-forward`，上一条 `f20fd027c HEAD@{2026-10-27 09:27:25 +0800}: commit: tasks: gap-ac323-375px-bar-horizontal-overflow task_write by cli:2324460`。即主检出从 `01:27:25Z` 到 `01:34:30Z` 一直是修复前的树。
4. **树 SHA 是落档时刻的树，不是被测的树。** 证据写 `treeSha=9cc37c5`（ff 后的树）、时刻 `01:34:37.100Z`，比 ff（`01:34:30Z`）晚 **7.1s**；而一次 `2.1m` 的跑在 ff 前约 2 分钟就已开始，Playwright 在 config evaluation 时就从 checkout 复制 client 树并读取 spec（`scripts/e2e-client-root.mjs`）⇒ 这一跑从头到尾跑的都是 `f20fd027c` 的源码。
5. **修复本身在源码相同的树上已被门禁判过 pass。** 该修复任务的 passing tree `801146314658e159e636606291de1e34dc324444` 与本轮证据 tree `9cc37c5` 的唯一差异是 `tasks/gap-ac323-375px-bar-horizontal-overflow.md`（`+125/−9`）：`git diff --stat 8011463… 9cc37c5…` 只列该文件 ⇒ 源码零差异。
6. **画面同向印证：** 红跑 trace 末帧 screencast 显示会话整体左移、右侧露出**闭合**抽屉的 “Your inputs” 面板——正是修复前 `absolute right-0 translate-x-full` 悬出 256px、把会话列 `scrollWidth` 撑到 631 的症状；修复后本轮读数为 `offenders=[]`。

**残留未钉死假设（如实登记）：**

1. 红跑没有留下 config evaluation 时刻的直接日志；「启动早于 ff」由 `2.1m` wall time、ff 时刻、证据时刻、修复前行号与 18 vs 19 例共同推出。
2. 主检出在 `01:28:21.886Z` 曾于**同一 pre-fix 树 `67ec3785`** 上 pass、`01:31:03.901Z` 同树 fail ⇒ 修复前的红是竞态性的；本条只用它证明「红拍被测树是 pre-fix」，**不**把那次 pass 当作修复有效的证据。
3. 本条只做归因与复测；AC-323 的语义（双入口、紧凑栏、断线重连）仍由该 AC 的原判据覆盖，本条不复述、不另立断言、不改判据。

## Plan

1. 建本条隔离 worktree（起点 = 开工时 `develop`），打印 worktree 路径、`git rev-parse HEAD`，确认 `git status --porcelain` 空。
2. 在净 worktree 里把 AC-323 的三条命令**逐字各跑一次**，记 exit code、wall time 与 `N passed` 原文。
3. 把 375px 腿单独连跑 3 次，3/3 exit 0，并抄每次 `[ac323-375-overflow]` 读数。
4. 机械复核 merge race 的 ancestry：`git merge-base --is-ancestor 23cbd70b2 <ref>` 对 `f20fd027c` / `dd9db6a3c` / `develop` / `HEAD`；`git reflog` 两条记录；`git diff --stat 8011463… 9cc37c5…`；pre-fix 与 HEAD 的 spec 行号、clip 层计数、CMD1 用例数 18 vs 19。
5. 从 `.quay/gate-events.jsonl` 抄 AC-323 `gate=goal` 的末四拍（含 `01:28:21.886Z pass`、`01:31:03.901Z fail`、`01:34:37.100Z fail` 与各自 `treeSha`/`evaluationRoot`/逐字理由），复算 `01:34:37.100 − 01:34:30 = 7.1s`。
6. 交付只落 `tasks/<本条 id>.md`。

## AC

- [ ] AC1 三条判据命令在净 worktree 里**逐字各跑一次**，均 exit 0；贴 CMD1 `19 passed`、CMD2 `Test Files / Tests`、CMD3 `6 passed` 原文与 wall time；CMD1 通过用例数须为 **19**（不是红跑的 18）。
- [ ] AC2 375px 腿单独连跑 **3 次，3/3 exit 0**，每次贴 `1 passed` 原文与 `[ac323-375-overflow]` 读数（`bar.x >= 0`、`documentScrollWidth <= 375`、`offenders=[]`）。
- [ ] AC3 ancestry 证据机械入档：`git merge-base --is-ancestor 23cbd70b2 f20fd027c; echo $?` → 非 0，`… dd9db6a3c` / `… develop` / `… HEAD` → 0；`git show f20fd027c:e2e/voice-realtime-upload-fixture.spec.ts | grep -n "375px: the same injection gesture"` → `1142`，HEAD 同 grep → `1242`；`git show f20fd027c:src/modules/chat/outline/InputOutlineDrawer.tsx | grep -c data-input-outline-clip` → `0`，HEAD → `1`；`git diff --stat 801146314658e159e636606291de1e34dc324444 9cc37c5111e86c97c2e2e2763db9f662943012af` 只列 `tasks/gap-ac323-375px-bar-horizontal-overflow.md`。命令与逐字输出入档。
- [ ] AC4 台账逐字入档：`.quay/gate-events.jsonl` 里 `item_id=AC-323`、`gate=goal` 的末四拍（`01:28:21.886Z` pass tree `67ec3785…`；`01:31:03.901Z` fail 同树；`01:34:37.100Z` fail tree `9cc37c5…`）及其逐字理由、`evaluationRoot`；`git reflog` 的 `09:34:30 +0800` ff 与 `09:27:25 +0800` 两条记录；复算证据时刻比 ff 晚 `7.1s`。
- [ ] AC5 承重面未被本条触碰：`git diff --name-only develop...HEAD -- src server goals scripts e2e` **为空**；`git diff --stat develop -- e2e/voice-realtime-upload-fixture.spec.ts src/modules/chat/outline/InputOutlineDrawer.tsx` 为空；`git status --porcelain` 与本条开工快照逐字相同（⛔ 未 stash / 未 `git checkout --` / 未编辑任何 `src/**`、`goals/**`、`e2e/**`）。
- [ ] AC6 如实登记：完成记录逐字写明「**被提交的树满足 AC-323**（净树三条命令 exit 0）」「台账红尾是主检出 ff 落地晚于 gate 启动的 merge race，红跑读的是修复前 spec（`Location 1142`、18 例、`data-input-outline-clip` 计数 0）」与残留假设；⛔ 不得用单测读数替代判据本体；若净树判据为红，本条必须停手上报 `needs-human` 并写明「归因不成立，应按缺陷任务重立」。

## DoD

- 在净检出上真实跑 `quay goal gate AC-323`（非 `--dry-run`）拿到 `verdict: "pass"` 的 GateEvent，贴该条原文（event id、timestamp、`treeSha`、`timeoutMs 480000`）。
- 三条判据命令各跑一次（不是只看 CMD1），记 exit code 与 wall time，贴 CMD1 `N passed`、CMD2 `Test Files / Tests`、CMD3 `N passed` 原文；375px 腿 3/3 的五条读数原文。
- merge race 的每条 ancestry 读数都能由任何人在同一 checkout 上复现（修复提交时刻、ff 时刻、证据时刻、pre-fix/HEAD 的 spec 行号与 clip 层计数、`merge-base --is-ancestor` 退出码、两树 diff 只有任务文件），命令与逐字输出写进完成记录。
- 完成记录明确写出判法：「修复 `23cbd70b2` 有效；台账 fail 尾部是机械 fan-in 的 ff 与门禁测量之间的竞态」，并给出残留未钉死假设。
- 交付物只动 `tasks/<本条 id>.md`：判据、实现、`goals/`、`e2e/`、工作树一个字节未动。
- 若净树直跑为**红**：置 `needs-human`，写明「判据在净检出上也是红的，本条归因不成立，应按缺陷任务重立」——⛔ 不得把环境红写成产品绿，也不得据此改断言或删/跳过用例。

## Touches

- tasks/gap-ac323-criterion-ledger-red-is-merge-race.md（自触）
- e2e/voice-realtime-upload-fixture.spec.ts（只跑不改：判据本体与 375px 腿）
- e2e/voice-realtime-live-session-send.spec.ts（只跑不改：CMD1 成员）
- e2e/voice-realtime-composer-embedded.spec.ts（只跑不改：CMD1 成员）
- src/modules/chat/tests/composerCompactTier.test.tsx（只跑不改：CMD2 成员）
- src/modules/chat/voice-realtime/VoiceRealtimeBar.tsx（只读不改：CMD2 成员的被测实现）
- src/modules/chat/voice-realtime/useVoiceRealtimeSession.ts（只读不改：CMD2 成员的被测实现）
- src/modules/chat/outline/InputOutlineDrawer.tsx（只读不改：本次修复本体）
- goals/AC-323-composer-内双语音入口-容器内-live-voice-紧凑栏-波形-时长-字幕-模型-mute-end-桌面与.md（只读：`criterion` / `expect` 逐字来源）

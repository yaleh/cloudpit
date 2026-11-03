---
id: gap-ac109-detach-window-liveness-before-gesture
title: AC-109 判据在负载下偶发假红（driver 本轮 `movedUpBy` 读到
  0）：脱离窗口的「回复仍在流式」前提只在窗口结束后才断言，手势落地也没有独立读数；把前提在窗口两端都构造出来并让失败信息带读数
status: ready
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

<!-- dedup-ref -->同机制关联（记给出处，不构成本任务的负担）：本条判据由 [[gap-transcript-follow-small-gesture-detaches]]（done，AC-109）建立——把「脱离」从单一 50px 距底阈值改成用户意图，并写出 wheel 与 PageUp 两个窗口；[[gap-transcript-follow-key-detach-vs-commit-pin]]（done，AC-109）修的是产品侧 PageUp 键已按下、浏览器尚未报 scroll 的那一帧里 commit-time 增长 pin 抢回视图；[[gap-transcript-follow-ac109-window-baseline-race]]（done，AC-109）把窗口的参照 offset 从设桩前挪到手势自己的输入时刻（`installAc109InputAnchor`）；[[gap-ac109-criterion-run-budget-below-cold-start-wall]]（done，AC-109）把单文件看门狗从 55s 默认抬到 240s、记录 `timeoutMs` 抬到 260s。四份 `status:` 逐字皆 **done**；在飞扫描（`^status:` ∈ {todo, ready, needs-human} 且 `^goal_ac: *AC-109`）**0 命中**。合并候选用仪器判定：`node /data/home/yale/.claude/plugins/cache/quay/quay/0.31.1/scripts/dist/task-granularity-advice.js --touches e2e/transcript-follow.spec.ts --touches tasks/gap-ac109-detach-window-liveness-before-gesture.md --json` ⇒ `peers: []`、`mentions: []` ⇒ **kept separate**，无合并对象。

**判据物（逐字取自 `goals/AC-109-流式期间向上的小幅手势立即脱离跟随且不被拉回-按钮可回到跟随.md`）**：`criterion:` = `npx playwright test e2e/transcript-follow.spec.ts -g "AC-109"`；`expect:` 逐字「同 AC-108 的页内 wire double 慢速流式：夹具**不含任何模型/CLI/外部服务**（无 mock gateway、无 SSE、无 claude 子进程、无 ANTHROPIC_* 环境变量），帧只经 app 自己建立的 chat socket 的 message 事件进入。贴底开始，流式进行中 mouse.wheel 向上 deltaY=-30（小于 50px 阈值）：此后到流结束零次程序写入 scrollTop、scrollTop 不增大（±1），「Scroll to bottom」按钮可见。随后点击按钮 → 回到底部，剩余流式期间 gap ≤ 1px。另测键盘路径：聚焦 pane 后按 PageUp（只产生 scroll 事件，无 wheel/touch），同样脱离且不被拉回。gap = scrollHeight − scrollTop − clientHeight，采样点必须在布局与 ResizeObserver 回调之后（例如页面内一个后注册的 ResizeObserver，或 rAF 内再 setTimeout 0）；在 rAF 内直接读 scrollHeight 读到的是 pin 之前的状态，不得当作绘制态。取假形态：沿用单一 50px 距底阈值判定脱离、并在增长时 pin（30px 手势仍判为跟随 → 被拉回）时本条必须红；只监听 wheel/touchmove 不认键盘滚动时键盘半必须红。」记录 `timeoutMs: 260000`、`status: achieved`、`goal: GOAL-004`、`longTerm: false`；GOAL 已 achieved 且不活跃，故本轮的 red 就是 CURRENTLY FALSE。

### 本轮直接测量（driver 轮，不是台账尾巴）

- `.quay/gate-events.jsonl` 的 AC-109 尾部：`2026-11-03T02:12:40.026Z`、`actor=goal-cli`、`verdict=fail`、`payload.treeSha=494d5f7b2b6592e3b146798ad99eebec58944809`。立案时 `git rev-parse HEAD^{tree}` 是**同一个** 494d5f7b…——红评的是当前树。
- 失败逐字：`1 failed e2e/transcript-follow.spec.ts:3064:3 › transcript follow in a real browser › AC-109 a small gesture still detaches, and the control comes back for the rest of the reply`。该轮 data-dir 是 `/data/home/yale/.cache/quay-e2e-tmp/quay-e2e-6keDN3`，`test-results/transcript-follow-transcri-41527-k-for-the-rest-of-the-reply/error-context.md` 的 Error details：
  `Error: wheel: the gesture has to have moved the viewport up, or "nothing wrote it back" is a statement about a pane the user never moved` / `expect(received).toBeGreaterThan(expected)` / `Expected: > 0` / `Received: 0`。
- **同一份现场快照里，回复已经流完**：pane 文本可见 `Delta 0 … Delta 23 … AC109WHEELDONE`（最后一条 delta 的完成标记），整份无障碍快照里 `Scroll to bottom` **零命中**。失败被报告的时刻是手势后 1.2s 的 `AC109_DETACH_WINDOW_MS` 窗口结束处——这个窗口已经不落在流式期间了。窗口自己的 liveness 断言（`completionPresent === false`、`stream.finished() === false`，spec:1693-1708）本来就该失败，但更早的 `movedUpBy > 0`（spec:1671-1674）先抛，把它报成「手势没移动视图」。
- 快照只能判「窗口结束时回复已完成」，**不能**判它是在手势前还是手势后的 1.2s 里完成的；本条要求实现者用读数把这两种时序分开，不得把快照读成已确证的时序。
- 稳定性：AC-109 在 `01:47:20`、`01:50:34`（tree `2f93067c`）、`01:59:22`（`bbabad82`）、`02:02:36`、`02:05:57`（`25c3707b`）连续 5 次 pass，`02:12:40` fail（`494d5f7b`）。`git diff --stat 25c3707b 494d5f7b` 只有 `e2e/mcp-settings.spec.ts`（另一条任务的判据）与两份 `tasks/*.md`，**没有** `src/ server/ shared/ e2e/transcript-follow.spec.ts playwright.config.ts` 的任何改动 ⇒ 红不是判据代码或产品代码的变化，是这条量具在负载下的偶发。
- 立案时宿主：`uptime` load1 **45.18**（128 核），`pgrep -fc 'playwright|chrome-linux'` = **55**，swap 31G 用满。同族上一轮（`gap-transcript-follow-ac109-window-baseline-race`）在 load1≈28 时已记录过 1/3 红。

### 机制：窗口的「仍在流式」前提没有在窗口两端都成立，且手势落地没有独立读数

`runAc109Window`（`e2e/transcript-follow.spec.ts:1567-1789`）的顺序是：

1. `startWireStream(...)` 起一个 24 条 delta、每 250ms 一条（名义 5.75s）的 pump（spec:219-237）；每条 delta 都是一次 `page.evaluate` 往 app 自己的 chat socket 派发。
2. 手势前 `expect.poll` 等 pane「可滚 ≥300px 且 gap ≤1」（spec:1585-1591）。
3. 接着是 5~6 次 CDP 往返：`readGeometry`（stubOffset）→ `installAc109PaneWriteCounter` → `installAc109InputAnchor` → `locator.count()` → `clearInstruments` → `startAc109Sampler` → `page.evaluate(performance.now)` → `pointAtPane` 的 `boundingBox` + `mouse.move`。
4. 手势 → `waitForTimeout(AC109_DETACH_WINDOW_MS)`（1.2s）→ 停采样 → 读 anchor/writes/button。
5. 此后才断言 liveness：`completionPresent === false`、`stream.finished() === false`、`growthsInWindow > 0`（spec:1693-1708）。

缺口有两个，彼此独立：

- **(a) 前提只在窗口结束后被检查，且没有任何构造阻止流先结束**：没有任何一步保证「手势发出时回复还剩至少一个 hold 窗口的量」，pump 也没有闸门。负载高时第 2 步的 poll 与第 3 步的往返可以把剩余 delta 吃光（pump 每条 delta 自己也要排队 CDP），窗口于是跨过 `stream_end`；此时 `movedUpBy` 与 liveness 断言测的都不是「流式期间用户夺走 pane」。
- **(b) 手势落地的读数没有独立证据**：`movedUpBy = anchorOffset − min(windowSamples.scrollTop)`（spec:1661），窗口样本来自主线程 `rAF → setTimeout(0)`；Chromium 的 wheel 滚动是动画，主线程一忙，这个采样就可能在整个 hold 内一次都没看到「手势后的 offset」，而 follow 在同一帧的写入又会把 offset 拉回 `anchorOffset`——读数是 `0`，但语义既可能是「窗口没落在流里」，也可能是「有程序写入」，两者在 gate 日志里无法区分：`movedUpBy` 的失败信息**没有** `describeAc109Window(...)`，而相邻三条断言都有。

### 上一轮/同族修法为什么没兜住

- `gap-transcript-follow-ac109-window-baseline-race` 只换了**参照系**（`anchorOffset = anchor!.scrollTop`），修的是「设桩间隙里落进一个 delta ⇒ −90」。它把**窗口的起点**挪对了，却没有约束**窗口的终点**必须落在流内；它的完成记录自己登记过：把 400ms 停顿放在「采样器启动之后、手势之前」时，红形态正是 `Received: 0`，并明确写了「本任务不认领其机制」。本轮 driver 得到的就是这个形态，而且多了一条当时没有的事实：失败现场里完成标记已经在屏。
- `gap-transcript-follow-key-detach-vs-commit-pin` 修的是产品侧 PageUp 与 commit-time pin 的一帧竞态；它只有在窗口确实落在流内、用户意图确实生效时才可被观测，管不到窗口跨出流。
- `gap-ac109-criterion-run-budget-below-cold-start-wall` 只抬了整轮的墙（240s/260s），让断言有机会表态；本轮断言确实表态了，红的是窗口语义。

### 要落地的不变式

1. **前提必须在手势之前成立，并保持到窗口关闭**：手势发出前，pane 文本不含本次的完成标记，且 pump 至少还留着 `AC109_DETACH_WINDOW_MS` + 余量的 delta；窗口关闭前，pump 不得投递最后一条 delta 与 `stream_end`。推荐做法是给 pump 一个显式的投递闸（先投足够填满并保持贴底的前缀 → 手势与窗口开始时保持 → 窗口关闭后再放行剩余 delta 与 `stream_end`），把「窗口落在流里」从负载运气变成构造保证。慢流式语义（≥20 条 delta、跨度 ≥5s、帧只经 app 自己的 chat socket 的 message 事件、无模型/CLI/外部服务）逐字保留。
2. **手势落地要有自己的读数**：在判定 hold 之前，用有界的 `expect.poll(readGeometry)` 确认 pane 真的被手势移动了（wheel 向上 ≥ `AC109_WHEEL_PX` 的数量级；PageUp ≥ 一页的量级），再读 hold 的上下界；`movedUpBy > 0` 断言保留。
3. **失败必须可归因**：`movedUpBy` 断言的失败信息里带上 `describeAc109Window(...)`（anchor、delivered/finished、采样、writes、button 出现时刻），使下一次红能直接区分 (a) 与 (b)，不必再翻 trace。
4. **不削弱判据**：`movedUpBy > 0`、`highestOffsetDelta ≤ AC109_GAP_PX`、`paneWrites == []`、`pageWrites == []`、`buttonAppearancesInWindow > 0`、`buttonVisible === true`、`completionPresent === false`、`stream.finished() === false`、`growthsInWindow > 0`、`pinnedGrowths > 0`、`unpinned == []`、`settledGap ≤ AC109_GAP_PX` 一条不删不松；`AC109_*` 常量不改；判据命令与 `expect:` 文本不动。

### 非目标

- 不改 `src/` 的跟随实现。若实现者的负控证明「窗口确实在流内且手势确实生效，仍有 `paneWrites`」，那是产品缺陷，回到本条报告并另立任务，不得顺手改产品代码。
- 不加 `retries` / `repeat-each` / `test.skip` / `test.only` / `test.fixme`；不放宽常量；不靠延长 hold 去赌流没结束。
- 不动 `playwright.config.ts` 的预算与 AC 记录的 `timeoutMs: 260000`（上一条 done 任务已治理）。
- 不新建 `e2e/*.ts` 文件（会踩 e2e 新文件的 lint 边界）。

## AC

- [ ] AC1 确定性负控（修前必须红，且与 driver 同形）：在 `runAc109Window` 的手势前注入一种「让窗口跨出流」的构造（例如等到 pump 的 `finished()` 为真，或等到 `AC109_*_COMPLETION_MARKER` 出现在 pane 文本里，再发手势），判据 `npx playwright test e2e/transcript-follow.spec.ts -g "AC-109"` **EXIT≠0**，失败逐字落在 `wheel: the gesture has to have moved the viewport up…` 且是 `Expected: > 0` / `Received: 0`；连跑 3 次同形态。若该构造不能稳定重现 `Received: 0`，换一种有读数支持的构造并写清为什么它才是 driver 那条红的机制；不得靠改断言/加等待把它做成红。注入用完 `cp` 还原，`git status --porcelain` 空。
- [ ] AC2 稳定绿：修后连续 **10** 次 `npx playwright test e2e/transcript-follow.spec.ts -g "AC-109"` 均 `EXIT=0`，且同一窗口内有别的 e2e lane 在跑；逐次记录 `exit=… wall=… self=[…]`、`git rev-parse HEAD`、该次自己的 `[e2e] server=… client=…` 与 data-dir、跑前 `uptime` load1。10 次的 `AC-109 readings:` 原文贴出；每次必须满足 `wheel movedUpBy > 0`（绿史恒为 30，给出 10 次最小/最大）、`keyboard movedUpBy > 0`、`highestOffsetDelta ≤ 1`、`paneWrites []`、`pageWrites []`、`buttonVisible true`、`buttonAppearancesInWindow > 0`、`completionPresent false`、`growthsInWindow > 0`、`pinnedGrowths > 0`、`unpinned []`、`settledGap ≤ 1`，`detachFrames`/`pinnedFrames > 0`。
- [ ] AC3 窗口确实落在流里（构造证明，不靠运气）：AC2 每次运行都记录「手势发出时 pump 的 `delivered()`」「窗口关闭时 `delivered()`/`finished()`」「pane 文本是否已含本次完成标记」；10/10 必须满足：手势时完成标记未出现、窗口关闭时 `finished() === false`、且窗口内 `delivered()` 至少增加 1（作为 `growthsInWindow > 0` 的独立读数）。若存在一次反例，AC2 不算达成。
- [ ] AC4 手势落地有独立读数：修后 `movedUpBy` 断言的失败信息包含 `describeAc109Window(...)` 的输出（含 `gesture.anchor`、`writes`、`sampled`、`inputs`）；用一条故意失败的自检（例如临时把该断言的基线抬高 1px）打印出一条带完整读数的失败信息并贴原文，之后还原。绿次里 wheel 与 keyboard 两半的 `movedUpBy` 均为正且与手势距离同量级（wheel 30 数量级，PageUp 一页 400 数量级），给出数值。
- [ ] AC5 正控：保留 AC1 的同一构造、同一棵树，只换成修后的窗口实现 ⇒ `EXIT=0`，且该次 `AC-109 readings:` 满足 AC2 的全部字段。AC1 与 AC5 一起证明红绿之差是「窗口是否落在流里/手势是否被观测」，不是把断言放宽或加长等待。
- [ ] AC6 抗假变体仍红（AC 记录自己的取法）：(i) 把脱离改回「单一 50px 距底阈值 + 增长时 pin」⇒ **wheel 半**必须红（`buttonAppearancesInWindow === 0` 或位移/hold 断言红）；(ii) 意图只由 wheel/touchmove 提供、不认键盘滚动键 ⇒ **键盘半**必须红。两条都贴退出码与失败原文，之后 `cp` 还原并用 `git diff -- src | wc -l` = 0 证明无残留。
- [ ] AC7 判据未被削弱、diff 范围受控：`git diff $(git merge-base develop HEAD) -- e2e/transcript-follow.spec.ts` 的删除行不含断言谓词（`git diff … | grep -E '^-' | grep -E 'toBeGreaterThan|toBeLessThanOrEqual|toEqual|\.toBe\(|toContain'` 为空）；`grep -E '^[-+].*const AC109_'` 为空；新增行匹配 `retries|repeat-each|test\.skip|test\.only|test\.fixme` 的条数为 0；判据命令与 `expect:` 文本未改；`git diff --name-only $(git merge-base develop HEAD)` 只含 `e2e/transcript-follow.spec.ts` 与本任务文件；`npm run lint` 与 `npm run typecheck` exit 0（如实登记 `e2e/` 不在 lint include，覆盖另由 AC2 的 10 次真实运行承担）。

## DoD

- **账本翻正**：driver 下一轮重跑 AC-109 的判据，`.quay/gate-events.jsonl` 的 AC-109 尾部由 `2026-11-03T02:12:40.026Z` 的 fail 转回 pass，并在其后连续多轮 frozenRecheck 中保持 pass（并发与宿主负载不再把它偶发打红）。完成记录贴出该 GateEvent 原文（`timestamp` / `treeSha` / `verdict` / `reason`）以及红轮那条原文。
- **真落地**：不是「把断言换个顺序」或「加等待碰运气」，而是窗口的两端都由构造保证——手势前已确认回复仍在流式且留有 hold 的余量，窗口关闭前 pump 不会流完，手势落地在判定 hold 前已被独立观测；证据是 AC1（确定性负控）、AC2/AC3（10 连绿 + 窗口在流内的读数）、AC5（同一构造的正控）。
- **读数原文**：AC2 的 10 行 `exit=… wall=… self=[…]` 与 `AC-109 readings:`；AC1 的 3 次失败原文与注入位置；AC5 的正控原文；AC6 的两条变体失败原文与还原证明；AC4 的自检失败信息原文。
- **前提与不可复现项如实登记**：必须写明本轮 driver 红只留下「`Received: 0` + 失败时完成标记已在屏 + 无 `Scroll to bottom`」这三个读数；**不得写成「已确证窗口在手势前就已流完」**（快照只能判窗口结束时已流完）。同时登记立案时的 load1 45.18、55 个 playwright/chromium 进程，以及 AC2 10 次运行时的实际 load1。若 AC1 最终找不到确定性重现，必须如实写明并说明最终按哪条不变式修（至少 AC3 必须成立）。
- **L_D = 0**。L_D 该轴仍暗，理由：本条只改 e2e 判据的窗口构造与读数，不新增领域数据能力，没有可读出的领域数据轴读数。
- **L_G = 0**。L_G 该轴仍暗，理由：读数是运行期退出码与几何读数，不是生成质量轴读数；目标层判据仍由 GOAL-004 的其余判据承担。

## Touches

- `e2e/transcript-follow.spec.ts`
- `tasks/gap-ac109-detach-window-liveness-before-gesture.md`

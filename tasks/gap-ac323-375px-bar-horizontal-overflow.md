---
id: gap-ac323-375px-bar-horizontal-overflow
title: 恢复 AC-323 判据绿：375px 进入 Live Voice 后会话区横向滚 139px、栏左缘读到 -139（闭合
  InputOutline 抽屉的 translate-x-full 悬出被算进 scrollWidth；06300c8f2 起）
status: done
labels:
  - gap
  - defect
parent: null
children: []
extra:
  schema: execution
goal_ac: AC-323
---
## Proposal

<!-- dedup-ref --> （去重 / 粒度）声明 `goal_ac: AC-323` 的 10 个任务全部是 `done`（`gap-live-voice-composer-embedded-acceptance-spec`、8 个 `gap-ac323-*`、以及 `gap-voice-realtime-composer-embedded-spec-red-under-default-segmented-mode`），仓内没有 todo/ready/needs-human 任务认领 AC-323 ⇒ 本任务为新案，不是重复。`task-granularity-advice --root <主检出> --touches src/modules/chat/outline/InputOutlineDrawer.tsx --touches src/modules/chat/ChatInterface.tsx --touches src/modules/project-workspace/WorkspaceMain.tsx --touches e2e/voice-realtime-upload-fixture.spec.ts` 报 `peers: []`、`mentions: []`。相关但机制不同的在办任务 `cockpit-mobile-header-and-page`（ready）只排 header 行内控件，Touches 不重叠，本任务不并入。

### 现象（2026-10-27 本轮直接重跑判据，不是台账尾巴）

AC-323 的三条命令里 CMD1 exit 1，失败唯一且确定停在同一行：

```
1 failed e2e/voice-realtime-upload-fixture.spec.ts:1142:3 › voice realtime upload fixture ›
  375px: the same injection gesture works with the bar inside the viewport
5 did not run
12 passed (2.2m)
```

断言位（`e2e/voice-realtime-upload-fixture.spec.ts:1157`）：

```
expect(box!.x).toBeGreaterThanOrEqual(0);
Expected: >= 0
Received:    -139
```

`box` 是 `getByTestId('voice-realtime-bar').boundingBox()`（`:1153`）。**两次失败的红跑读到的都是同一个 -139**（gate 事件 `2026-10-27T00:38:07.696Z` 与 `2026-10-27T00:46:16.909Z`，trace 分别在 `.cache/quay-e2e-tmp/quay-e2e-VnsmEE/` 与 `quay-e2e-Cmn3NH/`），不是随机小数。

### 证据链：移动的不只是栏，是整个会话区

两个红跑的 trace screencast 末帧一致：375px 下会话内容整体左移——消息气泡左缘被视口裁掉（首条只剩「…ser turn for the voice real-…」），底部 Live Voice 栏只剩右半截；右缘露出 **InputOutline 抽屉的左侧上边**「Your inputs」及其条目，而抽屉左侧手柄图标是 `ChevronLeft`（`InputOutlineHandle` 的 **closed** 图标，open 时是 `ChevronRight`）⇒ 抽屉并没有被打开，是会话区横向滚动了约 139px，把 `absolute right-0 translate-x-full` 的**闭合**面板连同 Live Voice 栏一起带离原位。页头（`☰`、标题、Chat ▾、⋯）没有移动，说明被横滚的是页头之下的会话容器，不是 window。

三条 gate 事件同一棵树 `treeSha 5b4aa3008a5f694d9d45297212f81ce37f73307d`（= 当前 `HEAD^{tree}`）依次 fail / **pass** / fail ⇒ 是判据窗口内的布局竞态，不是内容回归；单跑一次绿不能收案。

### 机制分析（首要嫌疑，需worker用读数证实后再下手）

- `06300c8f2 cockpit: PC right column on the session page (AC-429)`（2026-10-27 00:14 UTC 落地，已是 `HEAD` 祖先）把 `src/modules/chat/outline/InputOutlineDrawer.tsx` 的面板与遮罩从 `fixed` 改成 `absolute`，并给 `src/modules/chat/ChatInterface.tsx` 根节点加了 `relative`。
- 闭合面板仍是 `absolute right-0 top-0 w-64 … translate-x-full`：它在 ChatInterface 根（会话区）右侧**悬出 256px**。视觉上被会话宿主 `overflow-hidden`（`src/modules/project-workspace/WorkspaceMain.tsx:340` 的 `flex min-h-0 min-w-[200px] flex-col overflow-hidden flex-1`）裁掉，但 `overflow:hidden` 的容器仍会把这段悬出算进 `scrollWidth`，且可被程序化滚动（`scrollIntoView` / Playwright click 的 scroll-into-view / 触摸横拖）。
- 所以「375px 进入 Live Voice」这次点击所触发的滚动，一旦落在带 256px 横向可滚余量的会话容器上，就会把整条会话（含栏）左移；栏的左缘读数因此变成负值。139 是本次滚动落点，不一定是可滚上限（上限应约等于面板悬出量）。
- 用 `fixed` 时这段悬出不属于会话流，所以旧实现没这个问题；这是本次红跑与 `06300c8f2` 的因果链，但**必须用读数证实**：worker 先在被测页里打印 `window.scrollX`、栏的所有祖先的 `scrollLeft / scrollWidth / clientWidth`，以及 `document.documentElement.scrollWidth / innerWidth`，确认哪个容器是 scroller、余量是否为 256；不得只凭本文推断改代码。

### 为什么上一次修复没挺住

AC-323 于 `2026-10-26T08:44:45.369Z` 仍是 pass，今天 `00:42:06.613Z` 也 pass 过一次；此前 10 个 done 任务修的都是语音侧（arming 首帧、fake upstream call 预算、断线交接、gate deadline、spec 串行增长等），没有任务覆盖「会话页新布局给会话区引入横向可滚余量」这条路径。`06300c8f2` 直接把闭合抽屉从 `fixed` 搬进 `absolute` 流内，而 AC-323 的 375px 腿恰好读 `boundingBox().x >= 0`，于是被这次布局变更打红。

### 做法

1. **先取证**：在 `375px: the same injection gesture works with the bar inside the viewport` 里临时加读数（或用 `page.evaluate` 一次性打印上述 scroll 指标），跑 2–3 次，确认 scroller 与余量；把读数原文写进完成记录。若证实不是 drawer 悬出（例如是 bar 自身 min-content 或别的容器），按实测改，不要硬套本段假设。
2. **产品面修**：让闭合的 InputOutline 面板不再给会话区增加横向可滚宽度，同时保留滑入/滑出动画、遮罩、手柄拖动与「跳到条目」行为。首选把面板与遮罩包进会话区内的裁剪层（例如 `absolute inset-0 overflow-hidden pointer-events-none` + 面板 `pointer-events-auto`）；备选是给 ChatInterface 根加裁剪（注意 composer 的 `fixed` 浮层不受影响）。不得把面板改回 `fixed` 而破坏 `06300c8f2` 设计的「抽屉止于会话区右缘、不钻到 PC 驾驶舱列下面」。
3. **判据面加固**：在 375 用例里显式断言「无横向溢出」这一事实，而不是只断言栏的 x：进入 Live Voice 后读取 `document.documentElement.scrollWidth <= window.innerWidth`，并读取栏的每个祖先 `scrollWidth <= clientWidth`（或 `scrollLeft === 0`）；把这些读数做成 helper，失败时打印容器名与数值。现有的 `box.x >= 0` 一字不改。
4. **稳定性**：375 用例连跑 5 次必须 5/5 绿；整份 upload-fixture spec 与 AC-323 三条命令各跑一次全绿。

### 边界 / 不做

- ⛔ 不放宽/删除 `expect(box!.x).toBeGreaterThanOrEqual(0)`、`box.x + box.width <= 376`、`composer hidden` 等既有断言；不删/跳过任何 e2e 用例。
- ⛔ 不用「断言前 `window.scrollTo(0,0)` / 把容器 `scrollLeft = 0`」当唯一修法——那会把用户可见的横向溢出藏起来；必须让溢出不成立（`scrollWidth == clientWidth`）。若某个容器本来就有合法的横向滚动（如 composer 的 chip 行 `overflow-x-auto`），只要求栏的**祖先链上除它以外**无溢出，并在完成记录里点明例外。
- ⛔ 不改 `goals/AC-323-…md` 的 `criterion` / `expect` / `timeoutMs`，不改 GOAL-035 记录；不重开 GOAL-033。
- ⛔ 不改 PC 驾驶舱列的 squeeze/overlay/hidden 边界与抽屉「止于会话区」的设计；`src/modules/cockpit` 无源码改动（其单测只作回归）。
- e2e 从 Claude session 跑时必须按 AGENTS.md 缩放（单文件直跑即可；多文件用 `scripts/with-memory-cap.sh`，不要全量 fan-out）。

## AC

- [x] **AC1 读数归因落档**：在 375 用例进入 Live Voice 后读到 `document.documentElement.scrollWidth / innerWidth` 与栏每个祖先的 `scrollLeft / scrollWidth / clientWidth`，完成记录点名真正的 scroller 及数值；`grep -c "scrollWidth" e2e/voice-realtime-upload-fixture.spec.ts` ≥ 2，且该读数作为断言（不是只打印）。
- [x] **AC2 375 用例确定性绿**：`npx playwright test e2e/voice-realtime-upload-fixture.spec.ts -g "375px: the same injection gesture works with the bar inside the viewport"` 连跑 5 次，5/5 exit 0；每次贴 `1 passed`。
- [x] **AC3 整份 spec 绿**：`npx playwright test e2e/voice-realtime-upload-fixture.spec.ts` exit 0、0 failed，通过用例数不少于本轮红跑的 `12 passed`（若因 serial 首红少跑，修后必须整份跑）。
- [x] **AC4 判据三条命令绿**：按 AC-323 `criterion` 原样依次跑三条命令，全部 exit 0；贴 CMD1 的 `N passed`、CMD2 的 `Test Files / Tests`、CMD3 的 `N passed` 原文与 wall time。
- [x] **AC5 产品面修复可检**：375（并加测 390）宽度进入 Live Voice 后，`bar.boundingBox()` 的 `x >= 0` 且 `x + width <= viewport+1`；`document.documentElement.scrollWidth <= window.innerWidth`；栏的祖先链上无 `scrollWidth > clientWidth` 的容器（或只有完成记录里点名的既有横向滚动例外）。
- [x] **AC6 抽屉行为不退**：`npx vitest run src/modules/chat/tests/outlineHandleClamp.test.tsx src/modules/chat/tests/outlineHandleTouch.test.tsx src/modules/chat/voice-realtime src/modules/cockpit/tests` exit 0，既有用例数不减少；浏览器里 375px 点手柄仍能开/关抽屉并跳到一个条目（DoD 截图）。
- [x] **AC7 取假形态红**：临时把修复撤掉（或把面板改回无裁剪的 `absolute right-0 translate-x-full`）⇒ 新加的横向溢出断言在 375 用例里红（并记录 `scrollWidth`/`scrollLeft` 读数）；恢复后同命令绿。
- [x] **AC8 隔离性**：`git diff --stat develop HEAD` 只含 `src/modules/chat/outline/InputOutlineDrawer.tsx`（以及确有必要的 `src/modules/chat/ChatInterface.tsx` / `src/modules/project-workspace/WorkspaceMain.tsx`）、`e2e/voice-realtime-upload-fixture.spec.ts`、本任务文件；无 `goals/`、无 `src/modules/cockpit/` 源码改动。假形态恢复后 `git status --porcelain` 对这些路径为空。

## DoD

- 在带可写 `.quay/` 的根上真实跑 `quay goal gate AC-323`（非 `--dry-run`）拿到 `verdict: "pass"` 的 GateEvent，贴该条原文；AC-323 台账尾随之翻 pass。
- 三条判据命令各跑一次（不是只看 CMD1），记 wall time 与 exit code；贴 CMD1 的 `N passed`、CMD2 的 `Test Files / Tests`、CMD3 的 `N passed`，以及 375 用例 5/5 的 5 条 `1 passed`。
- 隔离实例（`scripts/isolated-instance.sh start`，按项目备忘关掉 residentRestore）在 375 与 390 宽度用 MCP 浏览器实际操作：进入 Live Voice 前后各读一次 `document.documentElement.scrollWidth/innerWidth`、栏的 `boundingBox()`、会话容器（栏与 transcript 的共同宿主）的 `scrollLeft/scrollWidth/clientWidth`；截图存 `tmp/` 并在完成记录贴出。再点 `InputOutline` 手柄开、关抽屉各一次，确认无横向溢出、条目跳转仍工作。
- 本仓 `e2e/scenarios/` 下没有 Live Voice 场景（已核）：在完成记录写明「无可用场景」，并用上面的浏览器读数 + e2e 代替；若有新增适配场景则跑 `node scripts/ui-scenario.mjs <scenario.json>` 并贴 JSON。
- 取假形态：撤掉修复 ⇒ 新断言红并记录读数；恢复 ⇒ 三条命令与 5/5 复绿。原始输出留档。
- 不放水：`box.x >= 0`、`box.x + width <= 376`、`composer hidden` 等断言原样；不删/跳过用例；不以「断言前清零 scrollLeft」代替产品面消除溢出；不改判据文本与 goal 记录。

## Evidence（完成记录 · 2026-10-27）

### 归因读数（AC1 / AC5：先取证，后改代码）

375 用例进入 Live Voice 后，新增的 `readHorizontalOverflow(page)` 读 document 与「栏 → html」整条祖先链，
该读数作为断言（失败信息带容器名与全部数值）。修复撤掉（develop 版抽屉）时的红跑原文
（`tmp/ac323/false-form-375.log`）：

- `documentElement.scrollWidth=375 / innerWidth=375`，栏 `x=-139 width=359`；
- **真正的 scroller**：`div.flex.min-h-0.min-w-[200px].flex-col`（WorkspaceMain 的会话列，
  `overflow-x:hidden`）`scrollLeft=147 scrollWidth=631 clientWidth=375`。
  631 − 375 = 256，正好是闭合面板 `w-64` 的悬出量；147 是本次 scroll-into-view 的落点，
  栏的 x = 8（composer 内边距）− 147 = −139；
- 带余量但 `overflow-x:visible` 的两层：`div.relative.flex.h-full.min-h-0`（ChatInterface 根）与
  `div.h-full.block`（会话 tab 容器），均 `scrollWidth=631 clientWidth=375 scrollLeft=0`；
- `html`/`body` 均 `scrollWidth=375 overflow-x:hidden` ⇒ 文档没有横滚，被横滚的是会话列，不是 window。

修复后同读数：`documentScrollWidth=375/375`，栏 `x=8 width=359`，祖先链 `offenders=[]`，
会话列 `scrollLeft=0 scrollWidth=375 clientWidth=375`。

### 产品面修复

`InputOutlineDrawer` 的闭合面板（`absolute right-0 translate-x-full`，悬出 256px）与打开时的遮罩现在包在
`absolute inset-0 overflow-hidden pointer-events-none` 的裁剪层里（`data-input-outline-clip`），面板与遮罩各自
`pointer-events-auto`。面板的包含块变成裁剪层，悬出部分被裁剪在会话区内，不再进入任何祖先的 scrollable
overflow；裁剪层保持 `absolute`（不回 `fixed`：抽屉仍止于会话区右缘，不钻到 PC 驾驶舱列下面），自身无
z-index/transform（面板 `z-[9999]` 仍压在 composer 之上）。滑入/滑出动画、遮罩、手柄拖动、条目跳转均未改动。

### 判据面加固

`e2e/voice-realtime-upload-fixture.spec.ts` 新增 `readHorizontalOverflow` / `expectNoHorizontalOverflow`
（`grep -c "scrollWidth" e2e/voice-realtime-upload-fixture.spec.ts` = 8）。375 用例在 `enterLiveVoice` 后立刻断言：
document `scrollWidth <= innerWidth`、栏 `x >= 0` 且 `x + width <= viewport + 1`、祖先链无
`scrollWidth > clientWidth + 1`；新增 390px 用例做同一读数。原有 `expect(box!.x).toBeGreaterThanOrEqual(0)`、
`box.x + box.width <= 376`、`composer hidden` 一字未改，未删除/跳过任何用例。

### AC2 375 用例 5/5（合并 develop 后重跑）

`tmp/ac323/postmerge-375-run-{1..5}.log`：
`run 1 exit=0 wall=38s / 1 passed (36.6s)`；`run 2 exit=0 wall=40s / 1 passed (39.2s)`；
`run 3 exit=0 wall=34s / 1 passed (33.8s)`；`run 4 exit=0 wall=31s / 1 passed (29.8s)`；
`run 5 exit=0 wall=38s / 1 passed (37.0s)`。
修复后、合并前同一 5 连跑亦全绿（`tmp/ac323/375-run-{1..5}.log`，wall 33/36/33/40/39s）。

### AC3 整份 spec

`npx playwright test e2e/voice-realtime-upload-fixture.spec.ts` → exit 0，`8 passed (1.2m)`
（`tmp/ac323/postmerge-full-spec.log`；合并前同命令 exit 0 `8 passed (1.3m)`）。
⚠️ 立案引用的 `12 passed` 是 AC-323 CMD1 **三文件一次调用**的合计（红跑 `1 failed / 5 did not run / 12 passed`），
本文件全量只有 8 个用例（原 7 + 本任务新增 390px 1 个），单文件不可能到 12；本 AC 的实质（整份跑、0 failed、
无跳过）已满足，按真实读数记录。

### AC4 AC-323 三条命令（原样，修复后合并前；日志 `tmp/ac323/cmd{1,2,3}.log`）

- CMD1 `npx playwright test e2e/voice-realtime-live-session-send.spec.ts e2e/voice-realtime-upload-fixture.spec.ts e2e/voice-realtime-composer-embedded.spec.ts` → exit 0，`19 passed (3.1m)`，wall 186s。
- CMD2 `npx vitest run src/modules/chat/tests/composerCompactTier.test.tsx src/modules/chat/voice-realtime` → exit 0，`Test Files 22 passed (22)` / `Tests 218 passed (218)`，wall 8s。
- CMD3 `npx playwright test e2e/mobile-workspace-composer-layout.spec.ts -g " idle "` → exit 0，`6 passed (33.9s)`，wall 36s。

合并 develop（`d43534747`，含 `cockpit-mobile-header-and-page` 落地）后，在干净的 worktree 上再跑真实
`quay goal gate AC-323`（非 dry-run）：`verdict: "pass"`，`event.id c40935d5-9882-4538-b34c-9d4a4a6b43b1`，
`timestamp 2026-10-27T01:26:38.799Z`，`timeoutMs 480000`，`evaluationRoot=<本 worktree>`，
`treeSha 801146314658e159e636606291de1e34dc324444`，wall 206s；该 gate 由 CMD1/CMD2/CMD3 原样执行得出，
AC-323 台账尾随之翻 pass。合并前另有一次 pass：event `df5e7c33-6bf7-478c-82ba-700f5ae8e4d9`，treeSha `724c1573…`。

### AC5 375 + 390 产品面读数

- e2e（合并后）：375 `viewportWidth=375 documentScrollWidth=375 bar={x:8,width:359}`、offenders=[]；
  390 `viewportWidth=390 documentScrollWidth=390 bar={x:8,width:374}`、offenders=[]。
- 隔离实例（`scripts/isolated-instance.sh start`，`resident_restore_started:0`，port 5671；无 MCP 浏览器，
  按项目备忘用一次性 Playwright driver 驱动真实页面）：375 进入 Live Voice 前 `doc 375/375`、offenders=[]；
  进入后 `bar={x:8,width:359,height:64}`、`doc 375/375`、offenders=[]、composerHidden=true。390 进入前
  `doc 390/390`；进入后 `bar={x:8,width:374,height:64}`、`doc 390/390`、offenders=[]。
  截图 `tmp/ac323/browser/{375,390}-{before,live-voice}.png`。

### AC6 抽屉行为不退

`npx vitest run src/modules/chat/tests/outlineHandleClamp.test.tsx src/modules/chat/tests/outlineHandleTouch.test.tsx src/modules/chat/voice-realtime src/modules/cockpit/tests`
→ exit 0，`Test Files 41 passed (41)` / `Tests 442 passed (442)`。浏览器 375px：点手柄打开抽屉
（panel `x=119 width=256`，doc 375/375，offenders=[]），点第一个条目后 panel 关闭、transcript `scrollTop 203→23`、
目标行 `[data-message-anchor-id=26fbcf7a-…]` 在视口内（top=34 bottom=702）；再点手柄位置关闭抽屉
（panel `aria-hidden=true`，x=375 完全移出，doc 375/375）。390px 同流程：`scrollTop 155→0`，目标行在视口内。
截图 `tmp/ac323/browser/{375,390}-drawer-{open,jump,closed}.png`。
说明：抽屉打开时遮罩（`z-[9998]`）盖在 `z-50` 的手柄之上是**既有**层叠（本次 diff 未改这两个 z 值），
Playwright strict click 因此判定遮罩拦截；按用户在屏幕上点手柄的位置点击，由遮罩的 `onClick` 关掉抽屉，
读数确认关闭——用户可见行为就是「点手柄位置关闭抽屉」。

### AC7 取假形态

把 `InputOutlineDrawer.tsx` 换回 develop 版（无裁剪层、`absolute right-0 translate-x-full`）⇒ 375 用例 exit 1，
新断言 `the bar must start inside the viewport` 红，读数 `bar={x:-139,width:359}`、会话列
`scrollWidth=631 clientWidth=375 scrollLeft=147`、`offenders` 列出上述三层（`tmp/ac323/false-form-375.log`）。
恢复修复文件后同命令 exit 0 `1 passed (28.1s)`（`tmp/ac323/restored-375.log`）。

### AC8 隔离性

合并后 `git diff --stat develop HEAD` 只有
`e2e/voice-realtime-upload-fixture.spec.ts`（+125）与 `src/modules/chat/outline/InputOutlineDrawer.tsx`（+99/−41）；
无 `goals/`、无 `src/modules/cockpit/` 源码改动；假形态恢复后 `git status --porcelain` 为空。

### 场景运行器

`e2e/scenarios/` 下没有 Live Voice 场景（现有 `cockpit-cards-confirm.json`、`cockpit-mode-switch.json`、
`quay-wall-focus-pin-utter.json`）⇒ **无可用场景**；按 AGENTS.md 用上面的 e2e 判据 + 隔离实例浏览器读数与
截图代替，未新增场景。

### 轴读数（ADR-007）

- L_D: 该轴仍暗,理由:本任务只改会话区抽屉的横向裁剪与 375/390px 判据，没有新增领域数据或文档比例读数
- L_G: 该轴仍暗,理由:目标层读数由 AC-323 的 goal gate（本轮 verdict=pass）承担，本任务不另立目标层指标

### 边界核对

`box.x >= 0`、`box.x + width <= 376`、`composer hidden` 等既有断言原样；未删除/跳过任何用例；未用
「断言前清零 scrollLeft」代替产品面消除溢出；未改 `goals/AC-323-…md` 的 criterion/expect/timeoutMs，
未改 GOAL-035，未重开 GOAL-033。

## Touches

- src/modules/chat/outline/InputOutlineDrawer.tsx
- src/modules/chat/ChatInterface.tsx
- src/modules/project-workspace/WorkspaceMain.tsx
- e2e/voice-realtime-upload-fixture.spec.ts
- tasks/gap-ac323-375px-bar-horizontal-overflow.md（self）

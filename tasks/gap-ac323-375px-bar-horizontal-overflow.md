---
id: gap-ac323-375px-bar-horizontal-overflow
title: 恢复 AC-323 判据绿：375px 进入 Live Voice 后会话区横向滚 139px、栏左缘读到 -139（闭合
  InputOutline 抽屉的 translate-x-full 悬出被算进 scrollWidth；06300c8f2 起）
status: todo
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

- [ ] **AC1 读数归因落档**：在 375 用例进入 Live Voice 后读到 `document.documentElement.scrollWidth / innerWidth` 与栏每个祖先的 `scrollLeft / scrollWidth / clientWidth`，完成记录点名真正的 scroller 及数值；`grep -c "scrollWidth" e2e/voice-realtime-upload-fixture.spec.ts` ≥ 2，且该读数作为断言（不是只打印）。
- [ ] **AC2 375 用例确定性绿**：`npx playwright test e2e/voice-realtime-upload-fixture.spec.ts -g "375px: the same injection gesture works with the bar inside the viewport"` 连跑 5 次，5/5 exit 0；每次贴 `1 passed`。
- [ ] **AC3 整份 spec 绿**：`npx playwright test e2e/voice-realtime-upload-fixture.spec.ts` exit 0、0 failed，通过用例数不少于本轮红跑的 `12 passed`（若因 serial 首红少跑，修后必须整份跑）。
- [ ] **AC4 判据三条命令绿**：按 AC-323 `criterion` 原样依次跑三条命令，全部 exit 0；贴 CMD1 的 `N passed`、CMD2 的 `Test Files / Tests`、CMD3 的 `N passed` 原文与 wall time。
- [ ] **AC5 产品面修复可检**：375（并加测 390）宽度进入 Live Voice 后，`bar.boundingBox()` 的 `x >= 0` 且 `x + width <= viewport+1`；`document.documentElement.scrollWidth <= window.innerWidth`；栏的祖先链上无 `scrollWidth > clientWidth` 的容器（或只有完成记录里点名的既有横向滚动例外）。
- [ ] **AC6 抽屉行为不退**：`npx vitest run src/modules/chat/tests/outlineHandleClamp.test.tsx src/modules/chat/tests/outlineHandleTouch.test.tsx src/modules/chat/voice-realtime src/modules/cockpit/tests` exit 0，既有用例数不减少；浏览器里 375px 点手柄仍能开/关抽屉并跳到一个条目（DoD 截图）。
- [ ] **AC7 取假形态红**：临时把修复撤掉（或把面板改回无裁剪的 `absolute right-0 translate-x-full`）⇒ 新加的横向溢出断言在 375 用例里红（并记录 `scrollWidth`/`scrollLeft` 读数）；恢复后同命令绿。
- [ ] **AC8 隔离性**：`git diff --stat develop HEAD` 只含 `src/modules/chat/outline/InputOutlineDrawer.tsx`（以及确有必要的 `src/modules/chat/ChatInterface.tsx` / `src/modules/project-workspace/WorkspaceMain.tsx`）、`e2e/voice-realtime-upload-fixture.spec.ts`、本任务文件；无 `goals/`、无 `src/modules/cockpit/` 源码改动。假形态恢复后 `git status --porcelain` 对这些路径为空。

## DoD

- 在带可写 `.quay/` 的根上真实跑 `quay goal gate AC-323`（非 `--dry-run`）拿到 `verdict: "pass"` 的 GateEvent，贴该条原文；AC-323 台账尾随之翻 pass。
- 三条判据命令各跑一次（不是只看 CMD1），记 wall time 与 exit code；贴 CMD1 的 `N passed`、CMD2 的 `Test Files / Tests`、CMD3 的 `N passed`，以及 375 用例 5/5 的 5 条 `1 passed`。
- 隔离实例（`scripts/isolated-instance.sh start`，按项目备忘关掉 residentRestore）在 375 与 390 宽度用 MCP 浏览器实际操作：进入 Live Voice 前后各读一次 `document.documentElement.scrollWidth/innerWidth`、栏的 `boundingBox()`、会话容器（栏与 transcript 的共同宿主）的 `scrollLeft/scrollWidth/clientWidth`；截图存 `tmp/` 并在完成记录贴出。再点 `InputOutline` 手柄开、关抽屉各一次，确认无横向溢出、条目跳转仍工作。
- 本仓 `e2e/scenarios/` 下没有 Live Voice 场景（已核）：在完成记录写明「无可用场景」，并用上面的浏览器读数 + e2e 代替；若有新增适配场景则跑 `node scripts/ui-scenario.mjs <scenario.json>` 并贴 JSON。
- 取假形态：撤掉修复 ⇒ 新断言红并记录读数；恢复 ⇒ 三条命令与 5/5 复绿。原始输出留档。
- 不放水：`box.x >= 0`、`box.x + width <= 376`、`composer hidden` 等断言原样；不删/跳过用例；不以「断言前清零 scrollLeft」代替产品面消除溢出；不改判据文本与 goal 记录。

## Touches

- src/modules/chat/outline/InputOutlineDrawer.tsx
- src/modules/chat/ChatInterface.tsx
- src/modules/project-workspace/WorkspaceMain.tsx
- e2e/voice-realtime-upload-fixture.spec.ts
- tasks/gap-ac323-375px-bar-horizontal-overflow.md（self）

---
id: gap-cockpit-column-workspace-width
title: PC 驾驶舱列按工作区可用宽度布局：侧栏展开时 1280 不再把会话挤到 591px，列宽自适应并保留最小可读会话宽度
status: ready
labels:
  - gap
  - cockpit
  - ui
parent: null
children: []
extra:
  schema: execution
---
## Proposal

来源：2026-10-29 实测。`createCockpitColumnController` 用 `window.innerWidth` 决定布局（`viewportWidth >= 1280` 挤压、`>= 900` 覆盖），但列与会话共享侧栏之外的工作区：侧栏展开 289px、列 400px 时，1440 的会话区只剩 751px，1280 只剩 591px；1280 正好是挤压的下界，于是会话被挤到 591 且 tab 条退化成图标。更窄的 1024 则进入覆盖式，列整块盖住会话。

本任务把布局输入从「视口宽度」改成「工作区可用宽度」：`useCockpitColumn` 用 ResizeObserver 观察 `[data-workspace-session-layout]`（或等价的会话区容器），把「工作区宽度 = 容器宽度 − 列自身宽度」喂给 controller；controller 先算列宽 `clamp(320, 工作区*0.34, 400)`（用户拖过的宽度优先），再只在 `工作区 − 列宽 >= 640` 时挤压，否则在 `工作区 >= 600` 时覆盖，再小则不挂载。这样 1440 仍是 400+751，1280 变成 320+671（而不是 400+591），1024 进入覆盖式。`cockpit-pc-right-column` 钉住的「视口 899/900/1279/1280」边界随之改为工作区轴，测试与完成记录写明这是有意取代；用户手动拖宽使会话低于 640 时，按覆盖式处理或把宽度夹到上限，二者选一并在完成记录说明。

约束：不改卡片、键盘归属与会话链接的既有规则；不改列的展开记忆（`cockpit.column.v1`）；`WorkspaceMain.tsx` 只负责提供容器或尺寸，不复制布局判断；布局判断仍只在 controller 里。

## AC

- [x] `npx vitest run src/modules/cockpit/tests/cockpitColumnController.test.ts` 退出 0：新增以工作区宽度为输入的三组读数（1151/991/735）与列宽 400/320，断言挤压时 `工作区 − 列宽 >= 640`、991 下得到 320+671、735 下为覆盖式；原有视口边界用例改成工作区语义，并在用例名或注释写明取代。
- [x] 同文件新增：controller 不再直接读 `window.innerWidth`（注入的 `readWorkspaceWidth` 是唯一来源；用一个会抛错的 `window.innerWidth` getter 或 spy 断言未被读取）。
- [x] `npx vitest run src/modules/cockpit/tests/CockpitColumn.test.tsx` 退出 0：用桩 ResizeObserver 把容器宽度从 1440 改到 1280，列宽从 400 夹到 320、会话区保持 ≥640；假形态改回视口输入 ⇒ 该用例红。
- [x] 同文件新增拖宽用例退出 0：用户拖到 720 且工作区 991 时会话只剩 271，断言不退化成挤压（覆盖式或宽度被夹住），且 `cockpit.column.v1` 的宽度记忆不被静默改写。
- [x] `npm run typecheck`、`npm run lint` 退出 0；若 `WorkspaceMain.tsx` 或 controller 越过基线，按 AC-394 RECORDED CHANGE 格式记录。

## DoD

真实页面（MCP 浏览器，真实数据；侧栏展开）：

1. 1440×900：读 `[data-workspace-session-area]`、`[data-testid="cockpit-column"]` 的宽度与 `data-cockpit-column-layout`，截图；会话区 ≥640。
2. 1280×900：同一组读数，断言会话区 ≥640（建议 671），tab 条仍可读或干净退到 overflow，截图。
3. 1024×900：断言进入覆盖式，截图；说明覆盖式下打开会话链接自动收起仍成立。
4. 拖动列宽到 720（1280 下）：读布局与会话区，确认不会把会话挤到 640 以下；截图。
5. 场景运行器 `cockpit-mode-switch.json` 与 `cockpit-cards-confirm.json` 各跑一次并贴 JSON；截图存 `tmp/`。

## 完成记录

### 布局轴的实现

- 观察对象是 `CockpitColumnRegion` 的共享行 `[data-workspace-session-layout]`：会话区与列是它的两个兄弟，所以行宽就是两者共享的宽度，不需要再减列宽，也不会形成反馈环（列在行内，列的伸缩不改行宽）。`useCockpitWorkspaceWidth` 先读一次 `clientWidth`，再用 ResizeObserver 把 `contentRect.width` 喂给 controller；离开页面时喂 0（未测量即不挂载）。
- controller 的依赖从 `readViewportWidth` 换成注入的 `readWorkspaceWidth`；默认读取器返回 0，不再回落到 window。`setWorkspaceWidth` 负责取整并重算帧。
- 帧规则收在一个纯函数 `cockpitColumnFrameFor(workspaceWidth, preferredWidth, hasOwnWidth)` 里：`工作区 − 640 >= 320`（即工作区 ≥ 960）挤压；600–959 覆盖；< 600 或未测量（≤ 0）不挂载。自动列宽 = 默认 400（只要 `工作区 − 400 >= 640`），否则退到最小值 320。用户拖过的宽度只夹「画出来的宽度」：`clamp(320, preferred, min(720, 工作区 − 640))`；`preferredWidth` 与 `cockpit.column.v1` 始终保留用户原值，工作区变宽后列回到那个值。
- snapshot 新增 `workspaceWidth` / `width`（画出来的）/ `preferredWidth`（记忆的）；列 aside 新增 `data-cockpit-column-workspace`，与既有 `data-cockpit-column-layout/-expanded/-width` 一起供读。
- `src/modules/cockpit/index.ts` 随契约改名导出 `cockpitColumnFrameFor`、`COCKPIT_COLUMN_MIN_SESSION_WIDTH`、`CockpitColumnFrame`。
- 未改 `WorkspaceMain.tsx`：行与列本来就在 `CockpitColumn.tsx` 的 region 里（`cockpit-pc-right-column` 已把它挂在 shell 内），本次只在 region 上加行 ref 与测量；`src/modules/project-workspace/tests/workspaceTabsResponsive.test.tsx` 也未改（既有响应式用例在工作区轴下仍绿）。架构基线未越线，`server/shared/tests/architecture-ratchet.baseline.json` 未动。

### AC 编号的一处不自洽，及取舍

- AC 1 把读数钉在 1151/991/735 三个工作区；AC 3 写「桩 ResizeObserver 把容器宽度从 1440 改到 1280，列宽从 400 夹到 320」。这两条不能同时落在同一个轴上：按 640 底线规则，工作区 1440 与 1280 都装得下 400（1440−640=800、1280−640=640），列宽会是 400→400。1440/1280 是**窗口**宽度，侧栏展开 289px 后对应的工作区正是 1151/991 —— 与 AC 1 是同一组数（实测行 `left = 289`）。
- 实现因此以 AC 1 的工作区读数为准；AC 3 的组件用例用桩 ResizeObserver 发 1151 → 991（而不是 1440 → 1280），读数列宽 400 → 320、会话 751 → 671（≥ 640）。
- Proposal 里的 `clamp(320, 工作区*0.34, 400)` 未被采用：1151*0.34=391、991*0.34=337，与 AC 1 钉死的 400/320 都对不上。实现改成「400 装得下就用 400，否则退到 320，仍不满足 640 就覆盖」，三组 AC 读数全部成立。

### 验收命令与读数

- `npx vitest run src/modules/cockpit/tests/cockpitColumnController.test.ts src/modules/cockpit/tests/CockpitColumn.test.tsx src/modules/project-workspace/tests/mobileHeaderCockpitEntry.test.tsx` → 3 files / 41 tests passed，退出 0（controller 16、组件 17、手机 header 8）。
- 既有用例不退：`src/modules/cockpit/tests` + `src/modules/project-workspace/tests` → 38 files / 505 tests passed；`src/modules/sidebar/tests` + `src/modules/chat/tests/outline*` → 21 files / 127 tests passed。
- 反证（改完立即还原；还原后文件里 `contentRect.width` 在、备份已删）：把 `last.contentRect.width` 换成 `window.innerWidth` ⇒ 组件用例 `takes the layout from the measured workspace row, not from the window` 红，`expected '1024' to be '991'`；还原后 17 passed。
- `npm run typecheck` 退出 0；`npm run lint` 退出 0（仅既有 warning）；`npx tsx --tsconfig server/tsconfig.json --test server/shared/tests/architecture-ratchet.test.ts` → 6 pass / 0 fail，基线未改。

### DoD（真实页面：worktree 的 vite :5199 代理运行中的 :3001，真实卡片、侧栏展开）

一次性 Playwright 驱动脚本 `tmp/dod-column-workspace.mjs`（不提交），报告 `tmp/dod-column-workspace/report.json`：

- 1440：行 1151、列 400、会话 751、`squeeze`（`tmp/dod-column-workspace/1440-expanded.png`）。
- 1280：行 991、列 320、会话 671、`squeeze`（`1280-expanded.png`）；改前同一窗口是 400+591。
- 1024：行 735、`overlay`、列 400 覆盖（`1024-overlay.png`）。
- 1280 拖到 720：画出的列 351、会话 640、布局仍是 `squeeze`，`cockpit.column.v1` 仍是 `{"expanded":true,"width":720}`（`1280-dragged-720.png`）。即宽度被夹到上限，记忆不被静默改写（Proposal 允许的两种处理中选了「夹住」）。
- 收起后无列、会话 991，存储 `{"expanded":false,"width":720}`（`1280-collapsed.png`）。
- 各宽度下 tab 条 `clientWidth === scrollWidth`（293 / 218 / 254 / 503），没有横向溢出。
- pageErrors 0；console 只有一条既有的 Sidebar ActionMenu `<button>` 嵌套告警，与本改动无关。
- 1024 覆盖式的会话链接自动收起仍成立：卡片里可点的 `cockpit-card-open-conversation` 有 3 个；点第一个后路由变为 `/session/c07db8d2-a162-41b4-821f-cb4e9e700f46`，DOM 里 `[data-testid="cockpit-column"]` 数量为 0（列自动收起），`cockpit.column.v1` 仍保留展开意图（覆盖式收起是一次访问内的行为，不是改写记忆）。报告 `tmp/dod-column-workspace/report-overlay-link.json`，截图 `1024-after-conversation-link.png`。
- 以上都是 DOM 读数（`data-cockpit-column-layout/-width/-workspace` 与 `getBoundingClientRect` 一致），截图只作视觉佐证。

### 场景运行器

- `cockpit-mode-switch.json`（真实 :3001 数据）：3/3 通过，4489ms，退出 0。摘要 `{"scenario":"cockpit-mode-switch","ok":true,"failedStep":null,"stepCount":3,"durationMs":4489}`；报告 `tmp/scenario-mode-switch/report.json`，checkpoint `tmp/scenario-mode-switch/step-{1,2,3}-*.png`（step 2 进 `/cockpit?view=board&project=claudecodeui`，step 3 回到同一 `/session/5b984a5f-…`）。
- `cockpit-cards-confirm.json`：需要 fixture 卡片，故用临时隔离实例（复制 auth.db；settings 写 `residentRestore.enabled=false`、`cockpit.fixtureCards=true`、`fixtureFeedback.mode="none"`；独立 HOME=`/tmp/dod-home-cards`、独立 JWT secret；vite :5199 以 `SERVER_PORT=3111` 代理该实例）。步骤 1–3 绿、5–6 绿，**步骤 4 红**：`cockpitCardConfirmTarget: expected {"optionId":"later"} read {"optionId":"provide"}`，`fixture:need` 仍在列表里。这是 develop `4af36cb6c` 起就存在的既有冲突，不是本改动的回归：fixture executor 每次确认都 `revision += 1`，controller 在 `(revision, contentRevision)` 变化时把 per-card shown 掉回默认选项；本改动没有触碰 `cockpitCardController.ts` 或 fixture provider（`git diff develop --stat` 只有本任务 Touches 列出的文件）。报告 `tmp/scenario-cards-confirm.report.json`，checkpoint `tmp/scenario-cards-confirm/step-{1..5}-*.png`。
- 干净复现的前提（已按此执行）：确认记录持久化在 `$HOME/.cloudcli/cockpit-card-feedback.json`；与 live 共用一个 HOME 时，第二次跑会让卡被 feedback 锁住、**步骤 3 就红**（第一次尝试正是这样），所以隔离实例用了独立 HOME 并先清掉该文件。

L_D 该轴仍暗,理由:本任务只改布局轴的宽度输入（window→实测工作区），没有新增可量的领域轴；DoD 读的是布局像素读数，不是领域能力读数。

## Touches

- tasks/gap-cockpit-column-workspace-width.md
- src/modules/cockpit/cockpitColumnController.ts
- src/modules/cockpit/hooks/useCockpitColumn.ts
- src/modules/cockpit/CockpitColumn.tsx
- src/modules/cockpit/index.ts
- src/modules/cockpit/tests/cockpitColumnController.test.ts
- src/modules/cockpit/tests/CockpitColumn.test.tsx
- src/modules/project-workspace/tests/mobileHeaderCockpitEntry.test.tsx
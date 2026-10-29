---
id: gap-cockpit-card-presentational-semantics
title: 按展示语义拆分 CockpitCard 的纯呈现组件
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

将 `src/modules/cockpit/CockpitCard.tsx` 内可独立命名的展示区块抽成职责清楚的纯呈现组件，使卡片 JSX 按展示语义组织。展示组件只接收已计算好的 props 并绘制 UI；规则、派生决策、交互状态与命令继续留在现有 controller，不在组件中复制业务规则或新增状态 owner。遵守 `frontend-module-standards`：应用源码使用 `@/` 导入，类型仅导入用 `import type`，不增加 interfaces，不把同 feature 组件挪到 shared。现有 `CockpitCardSituation.tsx` 仅在确实需要修改时纳入改动。

## AC

- [x] `npx vitest run src/modules/cockpit/tests/CockpitCard.test.tsx` 退出 0；卡片头部、问题/情境、事实、选项和确认显示的现有断言均保留且通过，未删除或放宽行为断言。
- [x] 新增的 presentational component tests（如组件文件需要独立测试）以 props 输入断言展示内容与可访问语义，退出 0；展示组件不创建 controller、不持有业务状态、不执行派生决策或 API 命令。
- [x] `npm run typecheck` 与 `npm run lint` 退出 0；本次新增的应用源码导入均使用 `@/`，无新增 frontend `interface`、冗余状态或不必要的 feature barrel export。

## DoD

在隔离 Cockpit 页面用真实浏览器操作 cards 页面，实际走访卡片展示涉及的展开/选项显示交互，分别在 390px 与桌面视口截图并保存到 `tmp/`；检查提取后的展示区块在两种尺寸下可见且交互仍由既有 controller 承接。另运行可用的 `node scripts/ui-scenario.mjs e2e/scenarios/cockpit-cards-confirm.json`，记录 JSON 报告与检查点截图；不得在真实线上卡片上执行确认。

## Touches

- tasks/gap-cockpit-card-presentational-semantics.md
- src/modules/cockpit/CockpitCard.tsx
- src/modules/cockpit/CockpitCardHeader.tsx (new)
- src/modules/cockpit/CockpitCardFacts.tsx (new)
- src/modules/cockpit/CockpitCardOptions.tsx (new)
- src/modules/cockpit/tests/CockpitCard.test.tsx

## 完成记录

实现（提交 `96326a7f6`，分支 `task/gap-cockpit-card-presentational-semantics`）：

- 新增 `CockpitCardHeader.tsx`（kind 徽标、项目、主题、年龄、负载单元格与 `›`）、`CockpitCardFacts.tsx`（事实 pill 与 `CockpitCardViz`）、`CockpitCardOptions.tsx`（空卡两条入口、选项触发框与说明、自家回复编辑器、radiogroup 列表）。三者的 DOM、`data-testid`、aria 与类名逐字保留，只接收已算好的 props。
- `CockpitCard.tsx` 保留全部读数与回调（descriptor、facts、shownOption、ownReply、各命令），把 `loadLabel` 等展示标签在 controller 内算好后传入；`OwnReplyEditor` 随选项区迁到 `CockpitCardOptions.tsx`，由 `CockpitCard.tsx` 再导出，`CockpitCardDetails` 的导入路径不变（无环）。
- 未改动 `CockpitCardSituation.tsx`；Touches 之外的文件零改动。

AC 验证：

- AC1：`npx vitest run src/modules/cockpit/tests/CockpitCard.test.tsx` → 86 passed，退出 0。该测试文件在提交里只有新增行（`git show` 无删除行），既有断言未删改。
- AC2：追加 6 个 prop 驱动用例（header props/aria 与负载标签、facts+viz 由 card prop 绘制、options 触发框由 props 绘制并转发 onToggleDropdown、radio 列表由 props 绘制、锁定/空卡无可操作面）。三个新区块 grep 无 `useState`/`useEffect`，不建 controller、不调 API。
- AC3：`npm run typecheck` 退出 0；`npm run lint` 退出 0（输出只有仓库既有 warning）。新文件导入全部为 `@/…`，无新增 `interface`、无新状态、无新 barrel；`OwnReplyEditor` 的再导出是既有导入路径所必需。

DoD：

- 真实浏览器（一次性 `e2e/cockpit-card-presentational-dod.spec.ts`，用后已删除；`playwright.config.ts` 的临时注册与临时服务端设置均已 `git checkout` 还原，工作树只剩任务提交）在 1440×900 与 390×844 走访 cards 页：桌面 7.5s、手机 2.2s 两例均通过。读数：headerVisible=true、kindBadge=NEED、factCount=2；`fixture:stuck` 的「Show more」→「Show less」且 `data-clamped` 由 true 变 false；打开选项下拉为 radiogroup（≥3 个 radio）；切到 Later 后 trigger 文本为 Later、`aria-expanded=false`、确认条仍可见。
- 截图（均在 `tmp/cockpit-card-presentational/`）：`desktop-1-cards.png`、`desktop-2-situation-expanded.png`、`desktop-3-options-open.png`、`desktop-4-option-switched.png`，以及 `phone-1..4` 同名四张。
- 场景运行器：`node scripts/ui-scenario.mjs e2e/scenarios/cockpit-cards-confirm.json` → `{"ok":false,"failedStep":4,"stepCount":6,"durationMs":12485,"checkpoints":5}`；完整报告 `tmp/cockpit-card-presentational/scenario/report.stdout.json`，检查点 `step-1-open-cockpit-cards.png` … `step-5-drive-cockpitCard.select.png` 五张均非空。步骤 1/2/3/5/6 均 ok。
  - 步骤 4 红如实记录：确认后 `fixture:need` 的 `cockpitCardConfirmTarget` 读回 `{"optionId":"provide","label":"Provide the credential"}`（期望 `later`），卡片本身仍在列表且 `awaitingFeedback` 读数随 arm 变化。原因：fixture 执行器在确认后递增 `card.revision`，控制器把该卡已显示选项复位为默认项。把 `CockpitCard.tsx` 临时还原为 develop 版本后用同一条命令复现同样读数（`expected later, read provide`），证明与本拆分无关，是既有行为；未宣称全绿。
  - 该次 e2e 服务的服务端设置把 `cockpit.fixtureFeedback.mode` 置为 `kept`（场景假定的不结算 arm；shipped 默认 `closed` 会直接让卡片离开列表）。该设置只存在于本会话临时的 `playwright.config.ts`，已还原。
- 未在真实线上卡片上执行确认；以上确认都发生在一次性 e2e 服务的 fixture 卡上。

- 该轴仍暗,理由:本任务只按展示语义拆分组件，没有 L_D/L_G 轴可测读数。
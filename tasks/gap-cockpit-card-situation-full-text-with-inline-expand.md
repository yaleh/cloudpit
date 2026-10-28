---
id: gap-cockpit-card-situation-full-text-with-inline-expand
title: 驾驶舱卡片情境不再截成 2 行：普通卡片模式完整显示情境与内容未就绪原因，超过约 6 行时卡片内原地「展开」（不跳 Details）；紧凑模式保留截断
status: ready
labels:
  - gap
  - cockpit
  - ui
parent: null
children: []
extra:
  schema: execution
depends_on:
  - cockpit-inline-confirm-zero-focus-jump
---
## Proposal

来源：2026-10-28 用户审阅线上顶部卡片：「其它信息基本满足期望，但问题的详情仅显示 2 行就以 `...` 结尾。」按设计原则（`docs/architecture/cockpit-attention/INTERACTION-PRINCIPLES.md` 第 2、5 条：行是决策单元，列表里的信息要让人对问题和缺省建议建立较完整的理解），情境是判断依据，不能被截掉。

根因：`src/modules/cockpit/CockpitCard.tsx` 约第 351 行（`cockpit-card-content-unavailable`）与约第 361 行（`cockpit-card-zone-a-situation`）在普通卡片模式下也加了 `line-clamp-2`（紧凑模式 `line-clamp-1`）。线上被截掉的恰是判断依据，例如：

- 需要人卡情境截在「useful-rate 这一项还需…」，后面的「已等 15 天，计划的最后一个时刻 2026-10-14T18:44:32Z 已过」看不到；
- 会话提问卡情境截在「ready-pool-check …」，后面的「四点需求与波及面已写进任务，源码未动」看不到。

效果图（`/data/home/yale/work/claudecodeui/tmp/cockpit-redesign/80-m-list-cards.png`、`150-pc-open.png`）里普通卡片的情境是完整显示的，只有紧凑模式截断。

做什么：

- 普通卡片模式（Cards）：情境与内容未就绪原因完整显示，不加行数截断。
- 防止个别超长情境把卡片撑得过高：渲染后高度超过约 6 行时，先显示前 6 行，并在其后原地放一个「展开 / 收起」文字按钮（卡片内就地展开，不打开 Details，不移动确认条的相对位置之外的元素）。展开状态按卡片 id 记在 controller 里，卡片 revision 变化时复位。
- 紧凑模式（Compact）：保留现有截断（情境 1 行）。
- 点「展开」不触发卡片的 A 区打开 Details（阻止冒泡）。
- 新文案进所有语言的 `common.json`。

## AC

- [x] `npx vitest run src/modules/cockpit/tests/CockpitCard.test.tsx` 退出 0，新增用例：Cards 模式下情境与内容未就绪原因元素不带任何 `line-clamp` 类（短文本完整渲染）；超长情境（夹具约 12 行）初始带 6 行上限并渲染「展开」按钮，点击后去掉上限、按钮变「收起」，且不触发打开 Details 的回调；Compact 模式下情境仍为 1 行截断。
- [x] `npx vitest run src/modules/cockpit/tests/cockpitCardController.test.ts` 退出 0，新增用例：展开状态按卡片 id 记录，revision 变化时复位。
- [x] 假形态变红：把 Cards 模式的情境改回 `line-clamp-2` ⇒ 第一条用例红；改完即还原。
- [x] `npx vitest run src/modules/cockpit/tests src/modules/chat/tests/inlineQuoteChip.test.tsx` 退出 0，既有用例数不减少；`npm run typecheck`、`npm run lint`、`npm run build:client` 退出 0。

## DoD

隔离实例（打开 `cockpit.fixtureCards`；夹具含一张情境约 3 行、一张约 12 行的卡）上用 MCP 浏览器（不可用时用一次性 Playwright 并写明）在 390 与 1440 宽度截图：3 行情境完整显示；12 行情境显示 6 行加「展开」，点开后完整显示、Details 未打开；Compact 模式仍为 1 行。与 `80-m-list-cards.png` 拼成对照图存 `tmp/`。⛔ 不在线上实例点击任何确认。

## Touches

- tasks/gap-cockpit-card-situation-full-text-with-inline-expand.md
- src/modules/cockpit/CockpitCard.tsx
- src/modules/cockpit/CockpitCardList.tsx
- src/modules/cockpit/cockpitCardController.ts
- src/modules/cockpit/tests/CockpitCard.test.tsx
- src/modules/cockpit/tests/cockpitCardController.test.ts
- server/modules/cockpit/cockpit-fixture-card-provider.ts
- src/modules/cockpit/tests/i18nCockpitCompleteness.test.ts
- src/modules/chat/tests/inlineQuoteChip.test.tsx
- src/modules/i18n/locales/de/common.json
- src/modules/i18n/locales/en/common.json
- src/modules/i18n/locales/es/common.json
- src/modules/i18n/locales/fr/common.json
- src/modules/i18n/locales/id/common.json
- src/modules/i18n/locales/it/common.json
- src/modules/i18n/locales/ja/common.json
- src/modules/i18n/locales/ko/common.json
- src/modules/i18n/locales/ru/common.json
- src/modules/i18n/locales/tr/common.json
- src/modules/i18n/locales/zh-CN/common.json
- src/modules/i18n/locales/zh-TW/common.json

## ADR-007

该轴仍暗,理由:本任务只改驾驶舱卡片的呈现与控制器展开状态，未跑 archguard 全量分析，L_D/L_G 没有本轮可记的量化读数，沿用 develop 基线。

## Evidence

- AC-1：`npx vitest run src/modules/cockpit/tests/CockpitCard.test.tsx` → 53 passed / 0 failed，exit 0。新增用例在 `Cards mode: the situation is decision evidence, not a two-line teaser`：短情境无 `line-clamp`、无展开按钮；contentUnavailable 在 Cards 无截断；12 行夹具初始 `line-clamp-6` + 「Show more」，点击后无上限、按钮变「Show less」，Details 回调 0 次；Compact 仍 `line-clamp-1` 且无按钮。
- AC-2：`npx vitest run src/modules/cockpit/tests/cockpitCardController.test.ts` → 41 passed / 0 failed，exit 0。按卡片 id 分别展开；同 revision 重读保留，revision 变 2 复位为空；卡片被移除时展开状态同时丢弃。
- AC-3：假形态：把 Cards 情境类改为 `line-clamp-2` ⇒ `draws a short situation in full, with no line clamp and no expand control` 红，`AssertionError: expected '… text-muted-foreground line-clamp-2' not to contain 'line-clamp'`；还原 `situationClamped && 'line-clamp-6'` 后单跑该用例 1 passed / exit 0，工作树无残留 diff。
- AC-4：`npx vitest run src/modules/cockpit/tests src/modules/chat/tests/inlineQuoteChip.test.tsx` → 21 files / 333 tests passed，exit 0（此前基线 21 files / 329 tests，新增 4 条）。`npm run typecheck` exit 0；`npm run lint` exit 0（仅既有 warning）；`npm run build:client` exit 0；`npm run build:server` exit 0（夹具改动的所需构建）。
- DoD：本会话无 MCP 浏览器，按仓库约定用一次性 Playwright（`tmp/dod-cockpit-situation.mjs`，驱动 `scripts/isolated-instance` 的 3123 实例，`cockpit.fixtureCards:true`，`userLanguage=zh-CN`）在 390×844@2 与 1440×900@1 两档实跑并截图，未点击任何确认按钮：
  - 3 行情境（fixture:ask）：390 下 clientHeight=48 / scrollHeight=48（3 行完整），无展开按钮；1440 宽下一行完整显示，同样无按钮。
  - 12 行情境（fixture:stuck，12 个 provider 行）：两档初始均 `line-clamp-6`，clientHeight=96 / scrollHeight=192，按钮「展开」`data-expanded=false`；点击后 `line-clamp` 移除，clientHeight=192（完整），按钮「收起」；Details 层计数点击前后均为 0。
  - Compact：情境 `line-clamp-1`，clientHeight=16，无展开按钮。
  - 两档 pageErrors=0、consoleErrors=0。截图：`tmp/isolated-dod/01-ask-three-lines-390.png`、`02-stuck-clamped-390.png`、`03-stuck-expanded-390.png`、`04-stuck-compact-390.png`、`02-stuck-clamped-1440.png`、`03-stuck-expanded-1440.png`、`00-cards-list-390.png`；结构化读数 `tmp/isolated-dod/report.json`；与 `tmp/cockpit-redesign/80-m-list-cards.png` 拼成的对照图 `tmp/isolated-dod/compare-cockpit-situation.png`。实例用毕已 stop，3123 端口无残留监听。

## Blocker

**2026-10-28T08:22:30.745Z — worker 未落地（exited-not-landed）**

- 未落地原因：step=suite: not ok - server/shared/tests/architecture-ratchet.test.ts:   AssertionError [ERR_ASSERTION]: ratchet: oversizeFiles src/modules/cockpit/CockpitCard.tsx 基线外→845 — 基线外的文件不得超过 800 行 [baseline A/B: HARD RED (task-introduced-red) — the task's red set is NOT a subset of the develop baseline red set: added=server/shared/tests/architecture-ratchet.test.ts,server/shared/tests/architecture-ratchet.test.ts changed=-]
- run_id：wk-prod-anchor
- session_id：9095be9d-e20a-4583-9e59-15e989d8852a

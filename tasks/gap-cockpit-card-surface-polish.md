---
id: gap-cockpit-card-surface-polish
title: 驾驶舱表面打磨：详情限宽居中、确认条不压内容、BRIEF 空态隐去、头部计数合成一行、筛选条渐隐、年龄格式统一
status: ready
labels:
  - gap
  - cockpit
parent: null
children: []
extra: {}
depends_on:
  - gap-cockpit-duplicate-cards-collapsed
---
## Proposal

来源：2026-10-29 线上驾驶舱审查。截图：`tmp/cockpit-audit/02-details-need.png`（详情铺满宽屏）、`07-column-details.png`（确认条压住「Open conversation」与最后一个选项）、`06-column-pc.png`（头部两行都在报数、筛选条被截断）。

问题（均已在线上复现，都是「读起来费劲」类，不改行为规则）：

1. **详情在宽屏上铺满整屏。** 1600px 下详情几乎占满内容区，一行文字接近两千像素，长段情境难以阅读。建议限宽居中（约 `max-w-3xl`），手机宽不受影响。
2. **详情确认条压住内容。** 确认条 sticky 在可滚动区域底部，没有给内容留等高的底部空间：页面版详情最下面的「挂起」被遮住，栏内详情里「Open conversation」链接被遮住。改法是把详情体做成「可滚动区 + 独立底部条」两段（bar 不再是滚动容器的子元素），或给滚动区补与条等高的底部内边距。
3. **BRIEF 段落在没有简报时显示开发者文案。** 线上看到 `BRIEF / No model brief for this card. / this card does not point at a conversation question`——第二句是给开发者看的判断依据（`cockpit.briefReasonUnsupportedContent`）。没有简报时整段隐去。
4. **头部把同一个数说了两遍。** 栏头 `Cockpit · 5 waiting for you`（`cockpit.columnWaitingCount`）下面紧跟 `5 cards, 1 waiting for the fleet to confirm`（`cockpit.cardAwaitingFeedback`）。合成一行：`1 needs you · 1 waiting for fleet · 3 answered`（原型 `tmp/cockpit-audit/proto/p7-pc-header-one-count.png`）。
5. **筛选条被截断且没有提示。** 440px 栏里「Decision 0」被切掉、390px 手机里「Multiple 0」被切掉；可横向滚动但没有渐隐或箭头。加右侧渐隐（`mask-image` 线性渐变）并保留横向滚动。
6. **同一时长两种写法。** 列表写 `11.2h`，详情头部写 `waiting 11 h ago`；统一为列表的格式。

## AC

- [x] `npx vitest run src/modules/cockpit/tests/cockpitCardsMobileDetails.test.tsx` 退出 0，新增用例：详情层的内层容器带宽度上限 class（`max-w-3xl`）且在 PC 断点下居中；确认条与可滚动区是兄弟节点（确认条不是滚动容器的后代）；没有简报时 `queryByText('No model brief for this card.')` 与 reason 文案都为 null，且 BRIEF 小标题不存在；有简报时 BRIEF 段正常渲染。
- [x] `npx vitest run src/modules/cockpit/tests/CockpitColumn.test.tsx` 退出 0，新增用例：栏头只渲染一行计数（`columnWaitingCount` 与 `cardAwaitingFeedback` 不同时出现），且该行同时包含「needs you」「waiting for fleet」「answered」三个读数；筛选条容器带渐隐 style。
- [x] `npx vitest run src/modules/cockpit/tests/CockpitCard.test.tsx` 退出 0，新增用例：详情头部与列表年龄 chip 使用同一格式（同一张卡的 `waitingSince` 在两处渲染出相同字符串）。
- [x] 假形态变红：把确认条改回滚动区内 ⇒ 兄弟节点用例红；把 BRIEF 空态整段恢复 ⇒ 空态隐去用例红；把头部两行恢复 ⇒ 单行计数用例红；改完即还原。
- [x] `npx vitest run src/modules/cockpit/tests/i18nCockpitCompleteness.test.ts` 退出 0（十个 locale 的 key 集一致）；`npm run typecheck`、`npm run lint` 退出 0（lint 仅既有 warning）；`src/modules/cockpit/CockpitCardDetails.tsx` 与 `CockpitCardList.tsx` 若越过 800 行基线，按 RECORDED CHANGE 记录。

## DoD

真实页面（MCP 浏览器；只读，不点 Confirm）：

1. PC 1600 打开发布卡详情：截图显示详情限宽居中、最后一项选项与「Open conversation」都不被底部条遮住；贴出确认条与滚动区的 `boundingClientRect` 读数（不重叠）。
2. 没有简报的卡：截图 BRIEF 段不存在。
3. 栏头与筛选条：截图一行计数、筛选条右侧渐隐；把栏宽拖到 440 再截一张。
4. 手机宽（390）截一张详情与一张列表；截图存 `tmp/`；若存在可用场景，同时跑 `node scripts/ui-scenario.mjs <scenario.json>` 并贴出 JSON 报告。

## 验证记录

实现提交：`51d71c7e8`（task 分支）。

- 四条 AC 套件全绿：CockpitCard 79、CockpitColumn 15、cockpitCardsMobileDetails 15、i18nCockpitCompleteness 14，共 123 个用例。
- 假形态（改后立即还原并复跑绿）：确认条放回滚动容器内 ⇒ 兄弟节点用例红；BRIEF 空态整段恢复 ⇒ 无简报用例红；栏头第二行计数恢复 ⇒ 单行计数用例红。
- `npm run typecheck` 退出 0；`npm run lint` 退出 0（仅既有 warning）。i18n 用例实际走全仓 12 个 locale（en/zh-CN/zh-TW/de/es/fr/id/it/ja/ko/ru/tr），新 key 12 个文件全部补齐。架构 ratchet：`CockpitCard.tsx` 917→900 行（下降，允许；打印「可下调基线」），`CockpitCardDetails.tsx`/`CockpitCardList.tsx` 未越 800 行基线。

回归修正（本轮，提交 `dab24db8b`）：`src/modules/cockpit/tests/CockpitBriefView.test.tsx` 上一轮红，根因是上一轮把「所有 fallback」整段隐去，越过了本任务「不改行为规则」的范围——AC-431 的理由表是为「有简报但这次缺了」服务的（预算用尽、transcript 不可读等），把这些也藏掉会让该契约与组件 fallback 分支变成不可达。改为只静默诊断型 reason（`disabled`、`unsupported-content`），其余 fallback 继续显示理由。`SILENT_FALLBACK_REASONS` 在 `CockpitCardDetails.tsx` 模块级声明。

- 复跑 5 个文件（4 条 AC 套件 + `CockpitBriefView.test.tsx`）共 134 个用例全绿。
- 假形态：把 `unsupported-content` 从 `SILENT_FALLBACK_REASONS` 移除 ⇒ `cockpitCardsMobileDetails.test.tsx`「hides the whole BRIEF section」红（`cockpit-card-details-brief` 不再为 null），已还原并复跑绿。
- `npm run typecheck` 退出 0、`npm run lint` 退出 0（仅既有 warning）；anti-drift Touches 检查 PASS（20 个实际改动文件都在声明范围内）。

DoD 真实页面（任务 worktree 的 vite dev server :5199，代理运行中的 :3001 服务与真实卡片数据；Chromium 只读驱动，网络层拦截所有非 GET 的 `/api/cockpit/**`，未点 Confirm）：

- 详情限宽居中：1600px 下内层 `mx-auto flex w-full max-w-3xl flex-col px-3 pb-3 pt-3`，实测宽 766，左右边距各 417。
- 确认条不压内容：滚动区 rect `{top:223,bottom:727,width:766}`，确认条 rect `{top:736,bottom:770,width:742}`，间隙 9px，`barInsideScroller:false`；最后一项选项 bottom 658、`Open conversation` bottom 712，均在确认条上方（余量 78px）。手机 390 同读数：滚动区 bottom 793、确认条 top 802（间隙 9），`barInsideScroller:false`。
- 无简报：`cockpit-card-details-brief` 数量 0、`cockpit-brief-fallback` 数量 0，`No model brief for this card.` 与 `Brief` 小标题均不存在。（线上该卡 reason 为 `unsupported-content`，本轮改为只静默该 reason，读数不变。）
- 栏头一行计数：`8 needs you · 1 waiting for the fleet · 0 answered cards still open`（data-needs-you=8 / data-waiting=1 / data-answered=0）；旧 `cockpit-column-count` 与 `cockpit-card-awaiting-feedback` 数量均为 0；拖动左边缘把手把栏宽从 400 拖到 440（`data-cockpit-column-width` 400→440）。
- 筛选条渐隐：容器 style `mask-image: linear-gradient(to right, black calc(100% - 24px), transparent)`，scrollWidth 467 > clientWidth 383，横向滚动保留。
- 场景运行器：`node scripts/ui-scenario.mjs e2e/scenarios/cockpit-mode-switch.json --base-url http://127.0.0.1:5199 …` → `ui-scenario: passed (3 steps, 5775ms, 3 checkpoint(s))`。
- 截图（任务 worktree `tmp/dod/`）：`pc-1600-details-nobrief.png`、`pc-1600-details-bottom.png`、`pc-column-400.png`、`pc-column-440.png`、`phone-390-list.png`、`phone-390-details.png`、`phone-390-details-bottom.png`；场景 checkpoint 在 `tmp/dod/scenario/`。

## Touches

- tasks/gap-cockpit-card-surface-polish.md
- src/modules/cockpit/CockpitCardDetails.tsx
- src/modules/cockpit/CockpitCardList.tsx
- src/modules/cockpit/CockpitColumn.tsx
- src/modules/cockpit/CockpitCard.tsx
- src/modules/cockpit/cockpitCardDescriptors.ts
- src/modules/cockpit/CockpitBriefView.tsx
- src/modules/cockpit/tests/cockpitCardsMobileDetails.test.tsx
- src/modules/cockpit/tests/CockpitColumn.test.tsx
- src/modules/cockpit/tests/CockpitCard.test.tsx
- src/modules/cockpit/tests/CockpitBriefView.test.tsx
- src/modules/i18n/locales/en/common.json
- src/modules/i18n/locales/zh-CN/common.json
- src/modules/i18n/locales/zh-TW/common.json
- src/modules/i18n/locales/de/common.json
- src/modules/i18n/locales/es/common.json
- src/modules/i18n/locales/fr/common.json
- src/modules/i18n/locales/id/common.json
- src/modules/i18n/locales/it/common.json
- src/modules/i18n/locales/ja/common.json
- src/modules/i18n/locales/ko/common.json
- src/modules/i18n/locales/ru/common.json
- src/modules/i18n/locales/tr/common.json
- server/shared/tests/architecture-ratchet.baseline.json

## Notes

- 该轴仍暗,理由:本任务只做驾驶舱表面排版与读数统一，不改模块边界、依赖方向或数据生成，L_D/L_G 两轴没有可测读数；界面行为由四条 AC 判据、真实页面 boundingClientRect 读数与场景运行器覆盖。

## Blocker

**2026-10-29T12:38:00.726Z — worker 未落地（exited-not-landed）**

- 未落地原因：step=suite: not ok - server/shared/tests/architecture-ratchet.test.ts:   AssertionError [ERR_ASSERTION]: ratchet: moduleMutableState src/modules/cockpit/CockpitCardDetails.tsx 基线外→1 — 基线外的文件模块级可变状态必须为 0 [baseline A/B: HARD RED (task-introduced-red) — the task's red set is NOT a subset of the develop baseline red set: added=server/shared/tests/architecture-ratchet.test.ts,server/shared/tests/architecture-ratchet.test.ts changed=-]
- run_id：wk-prod-anchor
- session_id：ccbff57a-cd16-442e-be8b-82c7abf06e94

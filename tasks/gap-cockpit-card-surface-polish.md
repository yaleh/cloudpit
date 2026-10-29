---
id: gap-cockpit-card-surface-polish
title: 驾驶舱表面打磨：详情限宽居中、确认条不压内容、BRIEF 空态隐去、头部计数合成一行、筛选条渐隐、年龄格式统一
status: todo
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

- [ ] `npx vitest run src/modules/cockpit/tests/cockpitCardsMobileDetails.test.tsx` 退出 0，新增用例：详情层的内层容器带宽度上限 class（`max-w-3xl`）且在 PC 断点下居中；确认条与可滚动区是兄弟节点（确认条不是滚动容器的后代）；没有简报时 `queryByText('No model brief for this card.')` 与 reason 文案都为 null，且 BRIEF 小标题不存在；有简报时 BRIEF 段正常渲染。
- [ ] `npx vitest run src/modules/cockpit/tests/CockpitColumn.test.tsx` 退出 0，新增用例：栏头只渲染一行计数（`columnWaitingCount` 与 `cardAwaitingFeedback` 不同时出现），且该行同时包含「needs you」「waiting for fleet」「answered」三个读数；筛选条容器带渐隐 style。
- [ ] `npx vitest run src/modules/cockpit/tests/CockpitCard.test.tsx` 退出 0，新增用例：详情头部与列表年龄 chip 使用同一格式（同一张卡的 `waitingSince` 在两处渲染出相同字符串）。
- [ ] 假形态变红：把确认条改回滚动区内 ⇒ 兄弟节点用例红；把 BRIEF 空态整段恢复 ⇒ 空态隐去用例红；把头部两行恢复 ⇒ 单行计数用例红；改完即还原。
- [ ] `npx vitest run src/modules/cockpit/tests/i18nCockpitCompleteness.test.ts` 退出 0（十个 locale 的 key 集一致）；`npm run typecheck`、`npm run lint` 退出 0（lint 仅既有 warning）；`src/modules/cockpit/CockpitCardDetails.tsx` 与 `CockpitCardList.tsx` 若越过 800 行基线，按 RECORDED CHANGE 记录。

## DoD

真实页面（MCP 浏览器；只读，不点 Confirm）：

1. PC 1600 打开发布卡详情：截图显示详情限宽居中、最后一项选项与「Open conversation」都不被底部条遮住；贴出确认条与滚动区的 `boundingClientRect` 读数（不重叠）。
2. 没有简报的卡：截图 BRIEF 段不存在。
3. 栏头与筛选条：截图一行计数、筛选条右侧渐隐；把栏宽拖到 440 再截一张。
4. 手机宽（390）截一张详情与一张列表；截图存 `tmp/`；若存在可用场景，同时跑 `node scripts/ui-scenario.mjs <scenario.json>` 并贴出 JSON 报告。

## Touches

- tasks/gap-cockpit-card-surface-polish.md
- src/modules/cockpit/CockpitCardDetails.tsx
- src/modules/cockpit/CockpitCardList.tsx
- src/modules/cockpit/CockpitColumn.tsx
- src/modules/cockpit/CockpitCard.tsx
- src/modules/cockpit/CockpitBriefView.tsx
- src/modules/cockpit/tests/cockpitCardsMobileDetails.test.tsx
- src/modules/cockpit/tests/CockpitColumn.test.tsx
- src/modules/cockpit/tests/CockpitCard.test.tsx
- src/modules/cockpit/tests/CockpitBriefView.test.tsx
- src/modules/i18n/locales/en/common.json
- src/modules/i18n/locales/zh-CN/common.json
- src/modules/i18n/locales/de/common.json
- src/modules/i18n/locales/es/common.json
- src/modules/i18n/locales/fr/common.json
- src/modules/i18n/locales/id/common.json
- src/modules/i18n/locales/it/common.json
- src/modules/i18n/locales/ja/common.json
- src/modules/i18n/locales/ko/common.json
- src/modules/i18n/locales/ru/common.json
- server/shared/tests/architecture-ratchet.baseline.json

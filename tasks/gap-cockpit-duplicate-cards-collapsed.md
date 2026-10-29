---
id: gap-cockpit-duplicate-cards-collapsed
title: 同一会话同一问句的重复卡片原地折叠成一张，卡上如实标注「被问了 N 次」并可展开较早的那些；计数按折叠后计算
status: todo
labels:
  - gap
  - cockpit
parent: null
children: []
extra: {}
---
## Proposal

来源：2026-10-29 线上驾驶舱审查。列表里两张一模一样的提问卡（截图 `tmp/cockpit-audit/01-cards-pc.png`、`05-mobile-sent-unconfirmed.png`）：

| 卡片 | 年龄 | 对应消息 | 状态 |
|---|---|---|---|
| `att_7f04bb456ab0` | 11.2h | `c0aa3f51:…e6-6a41-4b44-ac64-810ad5937969` | 已发出、未确认 |
| `att_8b6867850452` | 10.9h | `c0aa3f51:…c4-be80-40ed-8f0d-a47f14a9afdb` | 待处理 |

同一会话、同一句问题文本，两个不同 messageId。fleet 的待人处理条目按「项目+类目+会话:消息 id」去重（`quay-fleet/src/attention.ts` 的 dedupKey + episode），所以助手把同一句问题问了两次就生成两个条目、两张卡。更早还有一张 `att_2cbb08c595fe` 同题卡，已被反馈正常关闭。

这是**两层**问题，本任务做客户端这一层（fleet 那一层由会话另行发给 fleet 对齐）：

- **根治在 fleet**：session-ask 的去重键改为「会话 + 规范化问题文本」，同一问题再问一次只升 revision，不新开条目。
- **客户端兜底**：在 fleet 采用新键之前，把同时打开、同会话、同问题文本的卡折成一张，并在卡上如实说明「同一问题被问了 N 次」，可展开查看较早的那些。

用户定下的表现（2026-10-29 讨论）：⛔ 不引入第二个列表；折叠发生在原位。原型 `tmp/cockpit-audit/proto/p4-pc-dedup.png`。

做什么：

1. 新模块 `src/modules/cockpit/cockpitCardDuplicates.ts`：给定一组卡片，按 `subject.sessionId` + 规范化后的问句（`ask`，缺省回落到 `situation`；去首尾空白、把连续空白压成一个、去掉句末标点）分组；每组保留 `surfacedAt` 最大的一张（并列时保留 provider 顺序里靠前的一张），其余标记为折叠；返回 `{ keep: cardId, hidden: cardId[] }[]` 供控制器使用。纯函数、无 React、无时钟。
2. 控制器（`cockpitCardController.ts`）在 `normalize` 之后应用该分组：`visibleCards` 去掉被折叠的卡；新增快照字段 `duplicates: Record<cardId, { hiddenIds: string[]; expanded: boolean }>` 与命令 `toggleDuplicates(cardId)`。折叠状态与卡片 id 绑定，重新读数后按同一分组重算（不落盘，与 `openDropdownCardId` 同类）。
3. 卡片 UI（`CockpitCard.tsx` 或 `CockpitCardList.tsx` 的对应层）：被保留的那张卡顶部出现一条细条——`⧉ 同一问题被问了 N 次（较早的 N−1 张已收起）` + 右侧「展开较早的」/「收起」。展开后在原位下方显示较早的卡（沿用同一 `CockpitCard` 渲染，选择与确认只对当前可见的卡生效）。
4. 过滤与计数按**折叠后**的可见卡计算（类型 chip 计数、`N waiting for you`、项目计数）；被折叠的卡不计入任何计数，也不产生额外的确认目标。
5. 十个 locale 同步新增文案。

## AC

- [ ] `npx vitest run src/modules/cockpit/tests/cockpitCardDuplicates.test.ts` 退出 0（纯函数）：同一会话同一问句的两张卡折成一组、保留 `surfacedAt` 较晚的一张；不同会话或不同问句不折；句末标点与连续空白差异视为同一问句；`ask` 缺失时用 `situation` 分组；同一组三张时 `hiddenIds` 长度为 2 且顺序稳定。
- [ ] `npx vitest run src/modules/cockpit/tests/cockpitCardController.test.ts` 退出 0，新增用例：`visibleCards` 不含被折叠的卡；类型 chip 计数与 `waiting for you` 读数按折叠后计算；`toggleDuplicates(cardId)` 展开后该卡重新出现在 `visibleCards` 的同一位置（不排到末尾）；重新读数后展开状态按同一分组保留；被折叠的卡不产生 `targets` 条目。
- [ ] `npx vitest run src/modules/cockpit/tests/CockpitCard.test.tsx` 退出 0，新增用例：有折叠项时渲染那条细条并显示次数；点「展开较早的」后渲染较早的卡；没有折叠项时不渲染细条。
- [ ] 假形态变红：把分组键改为「卡片 id」⇒ 折叠用例红；把展开后的卡追加到列表末尾而不是原位 ⇒ 「同一位置」用例红；改完即还原。
- [ ] `npx vitest run src/modules/cockpit/tests/i18nCockpitCompleteness.test.ts` 退出 0；`npm run typecheck`、`npm run lint` 退出 0（lint 仅既有 warning）；`src/modules/cockpit/cockpitCardController.ts`（基线 1329）与 `src/modules/cockpit/CockpitCard.tsx`（基线 628）若增长，按 RECORDED CHANGE 记录。

## DoD

隔离实例（关 residentRestore；只点夹具卡片）：

1. 夹具 provider 配两张同会话同问句的卡（`surfacedAt` 不同）：截图列表只剩一张 + 「同一问题被问了 2 次」细条；贴出 `visibleCards` 与类型 chip 计数读数。
2. 点「展开较早的」：截图较早的卡出现在原位下方；再点「收起」复原。
3. 手机宽（390）与 PC 宽（1600）各一组截图，存 `tmp/`；若存在可用场景，同时跑 `node scripts/ui-scenario.mjs <scenario.json>` 并贴出 JSON 报告。

## Touches

- tasks/gap-cockpit-duplicate-cards-collapsed.md
- src/modules/cockpit/cockpitCardDuplicates.ts (new)
- src/modules/cockpit/cockpitCardController.ts
- src/modules/cockpit/CockpitCard.tsx
- src/modules/cockpit/CockpitCardList.tsx
- src/modules/cockpit/tests/cockpitCardDuplicates.test.ts (new)
- src/modules/cockpit/tests/cockpitCardController.test.ts
- src/modules/cockpit/tests/CockpitCard.test.tsx
- src/modules/cockpit/tests/cockpitCardsMobileShell.test.tsx
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

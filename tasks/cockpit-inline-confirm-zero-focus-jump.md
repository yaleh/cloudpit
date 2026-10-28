---
id: cockpit-inline-confirm-zero-focus-jump
title: 驾驶舱确认改为原地两步：点 Confirm 后确认条原地变成「将发送…」+「确认发送 / 取消」，「确认发送」占原 Confirm
  按钮同一位置（两次点击距离 0），约 6 秒无操作或换选项、卡片更新即退回；去掉固定在窗口底部的确认框；结果原地显示
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

来源：2026-10-28 用户反馈：点驾驶舱卡片里的 Confirm，会在窗口下方另弹一个确认框，焦点跳跃距离很大（用户截图：PC 右侧列第一张卡的「Confirm · 重新评估计划」在右上，确认框「Confirm this action / Cancel / Confirm and send」出现在窗口左下的会话输入框上方）。这违背用户 2026-10-26 的要求：「一键作答保持确认卡，只要保证操作方便（秒级响应/视觉焦点不跳跃）」。

根因：`src/modules/cockpit/CockpitCardList.tsx` 约第 474–510 行的确认框是 `role="dialog"` 且 `className="fixed inset-x-3 bottom-3 z-50 mx-auto max-w-md …"`，固定在视口底部水平居中，与被点的按钮无任何位置关系。PC 上它落进左侧会话区；手机上点靠上的卡时要从屏幕上方移到最底部。

用户 2026-10-28 选定方案 A：确认条原地两步，焦点零跳跃。

做什么：

- **原地确认状态**（`src/modules/cockpit/CockpitCard.tsx` 与 `CockpitCardDetails.tsx` 的确认条）：controller 的 `pendingConfirm` 指向本卡时，确认条在原地变为确认状态——上方一行「将发送『<选项名>』一次」（自己的回复显示要发送的文本摘要；不可逆选项加 ⚠ 与一句后果），下方「确认发送」与「取消」两个按钮。**「确认发送」与原 Confirm 按钮占同一位置、同一尺寸**（同一个按钮元素就地换文案与动作，或保证布局矩形不变），因此确认缺省项就是在同一处连按两下。「取消」放在它旁边，不挤动「确认发送」的位置。
- **删除固定弹框**：去掉 `CockpitCardList.tsx` 里 `data-testid="cockpit-card-confirm-panel"` 的固定确认框；不在页面其它位置渲染任何确认面板或提示。
- **自动退回**（`src/modules/cockpit/cockpitCardController.ts`）：进入确认状态后约 6 秒没有第二次按压、或切换了显示的选项、或该卡 revision 变化、或选中了别的卡，确认状态退回，不发送任何请求。计时经注入的时钟，不在组件里写定时器。
- **键盘**：焦点在驾驶舱时 Enter 进入确认状态，再按 Enter 发送（同一个键）；数字键只选选项不变；Escape 仍不处理。
- **结果原地显示**：发送中确认条显示进行中状态；成功显示「已发送 ✓」后卡片按现有规则收起或等待提供方结束；失败在确认条上显示可读原因，不弹到别处。
- 场景运行器语义面（`src/modules/ui-scenario/` 的卡片读数与 `cockpitCard.confirm` 动词）同步：确认状态读数来自卡片自身，`confirmOpenCardId` 不再依赖已删除的面板。
- 新文案进所有语言的 `common.json`。

## AC

- [ ] `npx vitest run src/modules/cockpit/tests/cockpitCardController.test.ts` 退出 0，新增用例：requestConfirm 后 6 秒（注入时钟）未确认 ⇒ pendingConfirm 为 null 且发送次数 0；确认状态中切换显示的选项、或卡片 revision 变化、或选中别的卡 ⇒ 退回且不发送；两次确认之间只发送一次；Enter 两次 ⇒ 发送一次。
- [ ] `npx vitest run src/modules/cockpit/tests/CockpitCard.test.tsx src/modules/cockpit/tests/cockpitCardsMobileDetails.test.tsx` 退出 0，新增用例：确认状态在卡片自身的确认条内渲染（「确认发送」与原 Confirm 是同一个按钮元素或同一容器内同一位置）；页面上不存在 `cockpit-card-confirm-panel`，也不存在任何 `position: fixed` 的确认面板；不可逆选项在确认状态显示 ⚠；失败原因渲染在确认条内。
- [ ] 新增 `e2e/cockpit-inline-confirm.spec.ts`，`npx playwright test e2e/cockpit-inline-confirm.spec.ts` 退出 0：用夹具卡片，在 1440×900（PC 列）与 390×844（手机卡片页）两种视口，读取点击前 Confirm 按钮的 `getBoundingClientRect()` 中心点，点击后读取「确认发送」按钮中心点，两者距离为 0（容差 1px）；点击「确认发送」后夹具执行器记录恰好多一条；另一张夹具卡进入确认状态后等待超过退回时间，读数退回且执行器记录不增加。失败时打印两次中心点坐标。
- [ ] 场景运行器判据不退：`npx vitest run src/modules/ui-scenario/tests/cockpitCardsSurface.test.ts src/modules/ui-scenario/tests/scenarioSurface.test.ts` 退出 0。
- [ ] 假形态变红：恢复固定在底部的确认框 ⇒ e2e 距离断言红；确认状态中切换选项仍保留 pendingConfirm ⇒ controller 用例红。改完即还原。
- [ ] `npx vitest run src/modules/cockpit/tests src/modules/chat/tests/inlineQuoteChip.test.tsx` 退出 0，既有用例数不减少；`npm run typecheck`、`npm run lint`、`npm run build:client` 退出 0；提交前单跑 `npx tsx --tsconfig server/tsconfig.json --test server/shared/tests/architecture-ratchet.test.ts` 退出 0。

## DoD

隔离实例（`scripts/isolated-instance.sh start`，打开 `cockpit.fixtureCards`）上用 MCP 浏览器（不可用时用一次性 Playwright 并写明），**只点夹具卡片**：

1. 1440 宽度 PC 列：点一张夹具卡的 Confirm，读出点击前 Confirm 按钮与点击后「确认发送」按钮的中心坐标，贴出两者距离（应为 0）；截图确认状态（确认条原地变化、窗口底部没有弹框）；点「确认发送」，截图「已发送 ✓」，贴出夹具执行器记录多出的那一条。
2. 390 宽度手机卡片页：同上测一张靠上的夹具卡，贴出距离与截图。
3. 让一张夹具卡进入确认状态后不操作，等待超过退回时间，截图已退回，贴出执行器记录未增加。

截图存 `tmp/`，并与用户反馈的截图（确认框在窗口左下）对照说明。场景运行器 `node scripts/ui-scenario.mjs e2e/scenarios/cockpit-cards-confirm.json …` 贴出 JSON 报告。⛔ 不在线上实例点击任何确认。实例用毕 `scripts/isolated-instance.sh stop`。

## Touches

- tasks/cockpit-inline-confirm-zero-focus-jump.md
- src/modules/cockpit/CockpitCard.tsx
- src/modules/cockpit/CockpitCardDetails.tsx
- src/modules/cockpit/CockpitCardList.tsx
- src/modules/cockpit/cockpitCardController.ts
- src/modules/cockpit/hooks/useCockpitCards.ts
- src/modules/cockpit/tests/cockpitCardController.test.ts
- src/modules/cockpit/tests/CockpitCard.test.tsx
- src/modules/cockpit/tests/cockpitCardsMobileDetails.test.tsx
- src/modules/ui-scenario/cockpitCardsSurface.ts
- src/modules/ui-scenario/tests/cockpitCardsSurface.test.ts
- e2e/cockpit-inline-confirm.spec.ts (new)
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
- server/shared/tests/architecture-ratchet.baseline.json

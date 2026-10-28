---
id: gap-cockpit-confirm-delayed-send-with-cancel
title: 驾驶舱确认改为「点一次、5 秒倒计时后发送、倒计时内可点同一按钮取消」；warn/irreversible 选项保留二次确认；去掉确认条上方的冗余提示行
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

来源：2026-10-28 用户反馈（ASK 卡片截图）：点了 Confirm 之后还要再确认一次，是多余的操作。讨论后用户拍板（效果图 `tmp/cockpit-delayed-send-mockups.png`）：

- 点一次 Confirm 即进入 **5 秒倒计时**，倒计时结束后才真正发送；倒计时内同一个按钮变成「取消」，点它取消且不发送任何请求。
- **所有选项**都走延迟发送（含会话提问卡与「自己的回复」）；只有带 `warn` 或 `irreversible` 标签的选项（`isIrreversibleOption`，`cockpitCardController.ts`）保留现在的二次确认，不进入倒计时。
- 确认条上方的两行提示——空闲态的「点一次即发送，5 秒内可取消」类提示和倒计时态的「将在 5 秒后发送…」——都是冗余信息，**不画**。倒计时态的全部信息就在按钮上：「正在发送 · 点击取消（N s）」加进度填充。
- 页面切走（路由切换、卡片页卸载）后，倒计时到点**仍然发送**。

<!-- dedup-ref -->本任务改的是 `cockpit-inline-confirm-zero-focus-jump`（已 done）建立的「原地两步」确认的行为：该任务的两次按压 / 6 秒退回规则只对不可逆选项继续成立，其余选项换成倒计时发送。另有开放任务 `gap-cockpit-option-trigger-and-explanation-one-frame` 与本任务同改 `CockpitCard.tsx`（它只改选项触发器与说明的边框，机制不同，验收独立），保持独立两个任务，由调度器按 Touches 串行。

现状（代码事实）：

- `cockpitCardController.ts`：`requestConfirm` 设 `pendingConfirm` 并以 `CONFIRM_RETREAT_MS = 6_000` 经注入时钟武装退回；`confirm()` 是第二次按压的发送；`handleKey('Enter')` 是同一个键两次；`selectCard` / `showReading` / revision 变化经 `normalize` 与 `commit` 清掉 `pendingConfirm`。
- `CockpitCard.tsx` 的 `CockpitCardConfirmBar`（卡片与 `CockpitCardDetails.tsx` 的抽屉共用）：按钮 `data-confirm-mode` 为 `open` / `send`；按钮上方有一行高 `h-5` 的说明行，空闲态放 `cardConfirmHint`，确认态放 `cardConfirmBody` 与取消按钮。
- `useCockpitCards.ts` 的 effect 清理只调 `controller.stop()`，没有任何地方调 `dispose()`；控制器的确认计时器挂在注入时钟上，不随页面卸载清掉。本任务要把「卸载后仍发送」从这个偶然行为变成有测试钉住的约定（页面刷新或关闭标签页时浏览器会终止计时器，那种情况不发送，这是预期的）。

做什么：

- **控制器**：新增发送倒计时状态（快照里给出倒计时所属卡片与到点时刻，读数经注入时钟，组件里不写定时器）。`requestConfirm`：目标不可逆 ⇒ 行为不变（`pendingConfirm` + 6 秒退回）；否则进入倒计时，到点自动走现有 `confirm()` 的发送路径。`cancelConfirm` 在倒计时内取消且不发请求。倒计时被以下情形取消且不发送：切换该卡显示的选项、该卡 revision 变化、选中别的卡。请求一旦发出（`confirming`），不可取消，按钮禁用并显示「发送中…」。
- **键盘**：Enter 在无倒计时时进入倒计时（不可逆选项则进入二次确认，与现状一致）；倒计时中再按 Enter 是取消，不是立即发送。Escape 仍不处理。
- **卸载后仍发送**：页面切走后倒计时到点照常发送；`stop()` 不得清掉倒计时。卸载后无处显示结果，下一次进入页面时卡片重读即反映结果。
- **确认条**（可把 `CockpitCardConfirmBar` 抽到新的模块私有文件以免 `CockpitCard.tsx` 越过 800 行 oversize 地板，当前 766 行；`CockpitCardDetails.tsx` 的抽屉确认条随之改用）：空闲态与倒计时态都不画说明行；倒计时态按钮 `data-confirm-mode="cancel"`，描边样式，左侧进度条在 5 秒内填满，文案「正在发送 · 点击取消（N s）」，N 由注入时钟读数得出；请求在途 `data-confirm-mode="send"` 且禁用；完成后回到空闲外观并显示「Sent ✓」（沿用 `cardConfirmSent`）。不可逆选项保留二次确认的说明行（含 ⚠ 与取消），但这行改为浮在按钮上方（与 compact 密度现有的 `absolute bottom-full` 同一机制），使两种流程里按钮的位置都不动。
- 删除不再使用的文案键 `cardConfirmHint`（所有语言），新增倒计时文案键（带 `{{seconds}}`）；场景运行器的 `cockpitCard.confirm` 动词与读数同步：普通选项的确认是一次按压并等倒计时走完，不可逆选项仍是两次按压。

## AC

- [ ] `npx vitest run src/modules/cockpit/tests/cockpitCardController.test.ts` 退出 0，新增用例（注入时钟）：普通选项 `requestConfirm` 后 4.9 秒时发送次数为 0、第 5 秒发送恰好 1 次；倒计时内 `cancelConfirm` ⇒ 发送 0 次且时钟走完仍为 0；倒计时内切换显示的选项、该卡 revision 变化、选中别的卡 ⇒ 取消且发送 0 次；倒计时内按 Enter ⇒ 取消；请求在途时 `cancelConfirm` ⇒ 返回 false 且请求不被撤销；不可逆选项 `requestConfirm` ⇒ 不进入倒计时、6 秒退回、第二次按压才发送（既有用例不减少）；自己的回复走倒计时；调用 `stop()` 之后倒计时到点仍发送 1 次。
- [ ] `npx vitest run src/modules/cockpit/tests/CockpitCard.test.tsx src/modules/cockpit/tests/cockpitCardsMobileDetails.test.tsx` 退出 0，新增用例：空闲态与倒计时态下确认条内都不存在说明行（不渲染 `cockpit-card-confirm-hint` 与 `cockpit-card-confirm-message`）；倒计时态按钮 `data-confirm-mode="cancel"`、文案含秒数且随注入时钟递减；点击它取消并回到 `open`；请求在途按钮禁用；不可逆选项仍渲染含 ⚠ 的说明行与取消按钮；抽屉里的确认条行为与卡片一致。
- [ ] 更新 `e2e/cockpit-inline-confirm.spec.ts`，`npx playwright test e2e/cockpit-inline-confirm.spec.ts` 退出 0：1440×900 与 390×844 两种视口下，普通夹具卡点一次后读到倒计时态，等待倒计时走完后夹具执行器记录恰好多一条；倒计时内点取消后等待超过 5 秒，执行器记录不增加；不可逆夹具卡仍是两次按压，且两次按压时按钮中心点距离为 0（容差 1px），说明行浮在按钮上方、不推动按钮；普通卡点击前后按钮中心点距离为 0。失败时打印中心点坐标。
- [ ] 场景运行器判据不退：`npx vitest run src/modules/ui-scenario/tests/cockpitCardsSurface.test.ts src/modules/ui-scenario/tests/scenarioSurface.test.ts` 退出 0。
- [ ] 假形态变红：把倒计时改回立即发送 ⇒ 控制器「4.9 秒发送 0 次」用例红；让 `stop()` 清掉倒计时 ⇒ 「卸载后仍发送」用例红；把不可逆选项也放进倒计时 ⇒ 不可逆用例红；把说明行恢复到空闲态 ⇒ 组件「无说明行」用例红。改完即还原。
- [ ] `npx vitest run src/modules/cockpit/tests src/modules/chat/tests/inlineQuoteChip.test.tsx` 退出 0（含 `i18nCockpitCompleteness.test.ts`，所有语言包的新键齐全、`cardConfirmHint` 已删），既有用例数量不减少；`npm run typecheck`、`npm run lint`、`npm run build:client` 退出 0；提交前单跑 `npx tsx --tsconfig server/tsconfig.json --test server/shared/tests/architecture-ratchet.test.ts` 退出 0（`cockpitCardController.ts` 已在基线内，新增行数需按 RECORDED CHANGE 格式记录，或等量压缩；`CockpitCard.tsx` 不得越过 800 行）。

## DoD

隔离实例（`scripts/isolated-instance.sh start`，打开 `cockpit.fixtureCards`；入口 `/cockpit?view=cards`）上用 MCP 浏览器（不可用时用一次性 Playwright 并写明），**只点夹具卡片，不点线上卡片**：

1. 1440 宽度与 390 宽度各取一张普通夹具卡：点 Confirm，截图倒计时态（按钮是「正在发送 · 点击取消（N s）」、上方没有说明行），读出点击前后按钮中心点并贴出距离；等倒计时走完，截图「Sent ✓」，贴出夹具执行器记录多出的那一条与从点击到发送的耗时（约 5 秒）。
2. 再点一次 Confirm，倒计时内点取消，截图已回到空闲态，等待超过 5 秒，贴出执行器记录未增加。
3. 对不可逆夹具卡重复：截图二次确认态（⚠ 说明行在按钮上方），读出两次按压按钮中心点距离，点「确认发送」后贴出执行器记录。
4. 倒计时中从 `/cockpit?view=cards` 切到另一个路由，等待 5 秒后返回，贴出执行器记录多出恰好一条。
5. 场景运行器 `node scripts/ui-scenario.mjs e2e/scenarios/cockpit-cards-confirm.json …` 贴出 JSON 报告与检查点截图。

截图存 `tmp/`，并与用户反馈的截图对照说明多余的第二次确认与冗余提示行已不存在。⛔ 不在线上实例点击任何确认。实例用毕 `scripts/isolated-instance.sh stop`。

## ADR-007

该轴仍暗,理由:本任务只改确认按钮的交互时序（倒计时、取消、卸载后发送），判据是注入时钟下的发送次数与按钮位置读数，没有本轮可记的 L_D/L_G 量化读数。

## Touches

- tasks/gap-cockpit-confirm-delayed-send-with-cancel.md
- src/modules/cockpit/CockpitCard.tsx
- src/modules/cockpit/CockpitCardConfirmBar.tsx (new)
- src/modules/cockpit/CockpitCardDetails.tsx
- src/modules/cockpit/cockpitCardController.ts
- src/modules/cockpit/tests/cockpitCardController.test.ts
- src/modules/cockpit/tests/CockpitCard.test.tsx
- src/modules/cockpit/tests/cockpitCardsMobileDetails.test.tsx
- src/modules/cockpit/tests/i18nCockpitCompleteness.test.ts
- src/modules/ui-scenario/cockpitCardsSurface.ts
- src/modules/ui-scenario/tests/cockpitCardsSurface.test.ts
- e2e/cockpit-inline-confirm.spec.ts
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

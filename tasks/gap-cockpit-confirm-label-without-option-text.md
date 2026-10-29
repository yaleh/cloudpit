---
id: gap-cockpit-confirm-label-without-option-text
title: 确认按钮不再重复选项文本：空闲态统一「Confirm」，选择项由列表显示／详情高亮表达
status: done
labels:
  - gap
  - cockpit
parent: null
children: []
extra: {}
depends_on:
  - gap-cockpit-details-option-selection-and-own-reply
---
## Proposal

来源：2026-10-29 线上驾驶舱审查（截图 `tmp/cockpit-audit/01-cards-pc.png`、`zz-crop2.png`、`05-mobile-sent-unconfirmed.png`）。

问题（用户报告）：**Confirm 按钮文本过长**。实测最长的一条在 440px 的栏里被截断、在手机上放不下：`Confirm · 打开 tmp/ 和提交记录，核对选项框任务的 DoD 证据是否齐全`。它也从不提供新信息——当前选择项在列表里已经有独立显示（选项触发器 + 说明块），在详情里应当高亮（见 `gap-cockpit-details-option-selection-and-own-reply`）。

用户定下的表现（2026-10-29）：按钮里**不再重复选项文本**；「其实有当前选择项的显示（在列表中）/高亮（在详情中）就够了」。

现状：`src/modules/cockpit/CockpitCard.tsx:298-301` 用 `cockpit.cardConfirm`（`"Confirm · {{label}}"` / `「确认 · {{label}}」`）与 `cockpit.cardConfirmOwnReply`（`"Confirm · your reply"`）拼按钮文字；`src/modules/cockpit/CockpitCardDetails.tsx:460` 用同一个 key。`cockpit.cardConfirmShort`（`"Confirm"`）已存在，但只在 compact 密度下使用。

做什么：

1. 空闲态的确认按钮文案统一为短标签：`cockpit.cardConfirm` 的值改为 `Confirm` / `确认`，`cockpit.cardConfirmOwnReply` 改为同一句（`Confirm` / `确认`）——两者绑定的对象已经由上方显示/高亮表达，不需要再用按钮文字区分。
2. 保持哪些文案**不动**：倒计时（`cardConfirmCountdown`）、发送中（`cardConfirmSending`）、已发送（`cardConfirmSent`）、不可逆提示行（`cardConfirmBody` + `cardConfirmIrreversible`）——后者是唯一仍需要说明「这一下会发送什么」的地方，且它是浮在按钮上方的一行，不占按钮宽度。
3. compact 密度分支与全宽分支使用同一短标签后，`compact ? cardConfirmShort : confirmLabel` 收敛为一处（避免两个「Confirm」来源再次分叉）。
4. 十个 locale 同步；`{{label}}` 占位符从这两个 key 上移除，i18n 完整性测试的占位符集对照随之更新。

## AC

- [x] `npx vitest run src/modules/cockpit/tests/CockpitCard.test.tsx` 退出 0，新增用例：给一张选项 label 长 60 字的卡片，空闲态确认按钮的 `textContent.trim()` 等于 `Confirm`，且**不包含**该 label 的任何片段；选「你自己的回复」时按钮文字同样等于 `Confirm`；不可逆选项进入确认态后，提示行仍包含该 label（信息没有丢）。
- [x] `npx vitest run src/modules/cockpit/tests/cockpitCardsMobileDetails.test.tsx` 退出 0，新增用例：详情里的确认按钮文字等于 `Confirm`（不随所选项变化）。
- [x] 假形态变红：把 `cardConfirm` 改回 `"Confirm · {{label}}"` ⇒ 第一条用例红；改完即还原。
- [x] `npx vitest run src/modules/cockpit/tests/i18nCockpitCompleteness.test.ts` 退出 0（十个 locale 的 key 集与占位符集一致）；`npm run typecheck`、`npm run lint` 退出 0（lint 仅既有 warning）。

## DoD

真实页面（MCP 浏览器；只读，不点线上卡的 Confirm）：

1. PC 栏宽（440）与页面宽（1600）各截一张空闲态卡片：确认按钮显示 `Confirm`，完整不截断（贴出按钮 `scrollWidth <= clientWidth` 的读数）。
2. 手机宽（390）截一张：同上。
3. 选一个不可逆选项进入确认态（线上只允许进入确认态后按 Cancel，不发送）：截图显示按钮仍为短标签、上方提示行写明要发送的选项。

截图存 `tmp/`；若存在可用场景，同时跑 `node scripts/ui-scenario.mjs <scenario.json>` 并贴出 JSON 报告。

## 完成记录（Evidence）

实现：本任务分支 `task/gap-cockpit-confirm-label-without-option-text`，commit `1c176f545`（merge develop 后为 `git log --oneline -1` 的 merge tip）。

实现形状：

- `CockpitCardConfirmBar.tsx` 成为空闲态标签的唯一来源：`showingOwnReply && target.label === ''` → `cardConfirmNoOption`；否则 `showingOwnReply ? cardConfirmOwnReply : cardConfirm`。`compact ? cardConfirmShort : confirmLabel` 的三元与 `CockpitCard.tsx` 里重复的标签计算一并删除，两个调用方（卡片、详情抽屉）都改传 `showingOwnReply`。
- 12 个 locale（仓库实际是 12 个 bundle，不是十个）把 `cardConfirm` 与 `cardConfirmOwnReply` 都改成该语言的短词（en `Confirm`、zh-CN `确认`、zh-TW `確認`、de `Bestätigen`、es `Confirmar`、fr `Confirmer`、id `Konfirmasi`、it `Conferma`、ja `確認`、ko `확인`、ru `Подтвердить`、tr `Onayla`），并删除只在 compact 分支用到的 `cardConfirmShort`；i18n 完整性测试新增「`cardConfirmShort` 在所有 bundle 中都不存在」的循环，防止第二个「Confirm」来源再次分叉。

AC 逐条读数：

1. `npx vitest run src/modules/cockpit/tests/CockpitCard.test.tsx` → 73 passed，退出 0。新增 `keeps the idle confirm button to the short label, whatever the option text`（60+ 字 label：按钮 `textContent.trim() === 'Confirm'`，不含 label 的任何片段；选项触发器仍显示完整 label；own reply 同样 `Confirm`）与 `keeps an irreversible option’s text in the floating caption once the button is short`（`cockpit-card-confirm-message` 仍含不可逆选项文本）。
2. `npx vitest run src/modules/cockpit/tests/cockpitCardsMobileDetails.test.tsx` → 12 passed，退出 0。新增 `keeps the Details button on the short label when the shown option changes`：同一张卡切换两个选项后按钮不变、文字仍为 `Confirm`。
3. 假形态：把 en 的 `cardConfirm` 改成 `"Confirm · {{label}}"` → 6 条红（含新增的短标签用例；由于调用处不再传 `label`，页面上直接渲染出字面 `{{label}}`）；从 `/tmp/en-common.json.bak` 还原（不是 git checkout/stash）后重跑 73 passed。
4. `npx vitest run src/modules/cockpit/tests/i18nCockpitCompleteness.test.ts` → 14 passed，退出 0；`npm run typecheck` 退出 0；`npm run lint` 退出 0（仅既有 warning）。

DoD 真实页面（本 worker 无 MCP 浏览器工具，按仓库规程用一次性 Playwright spec，跑完即删；真实 app + 真实 server + fixture 卡）：

- 1600 宽：`{"text":"Confirm","buttonScrollWidth":1364,"buttonClientWidth":1364,"labelScrollWidth":43,"labelClientWidth":43,"buttonWidth":1366,"cardWidth":1392,"viewportWidth":1600}`；截图 `tmp/cockpit-confirm-short-label/pc-1600-page.png`、`pc-1600-card.png`。
- 440 宽：`{"text":"Confirm","buttonScrollWidth":396,"buttonClientWidth":396,"labelScrollWidth":43,"labelClientWidth":43,"buttonWidth":398,"cardWidth":424,"viewportWidth":440}`；截图 `tmp/cockpit-confirm-short-label/pc-column-440-page.png`、`pc-column-440-card.png`。
- 390 宽：`{"text":"Confirm","buttonScrollWidth":346,"buttonClientWidth":346,"labelScrollWidth":43,"labelClientWidth":43,"buttonWidth":348,"cardWidth":374,"viewportWidth":390}`；截图 `tmp/cockpit-confirm-short-label/phone-390-page.png`、`phone-390-card.png`。
- 不可逆态（`fixture:stuck` 选 `park`，第一次按下进入确认态后 Cancel，不发送）：提示行 `This sends “Park it” once. ⚠ This action cannot be undone.`，按钮 `⚠Confirm and send`（短标签 + 既有警示三角，不含选项文本）；Cancel 后回到 `open` 且无 `cockpit-card-confirm-outcome`。截图 `tmp/cockpit-confirm-short-label/irreversible-pending-card.png`。

场景运行器：`node scripts/ui-scenario.mjs e2e/scenarios/cockpit-cards-confirm.json --base-url … --auth-token … --project … --session … --out tmp/cockpit-confirm-short-label/scenario` → 退出 0，`ok:true`，6/6 步，11180ms，5 张检查点（`tmp/cockpit-confirm-short-label/scenario/step-*.png`）。报告节选：

```
{"scenario":"cockpit-cards-confirm","ok":true,"failedStep":null,"stepCount":6,"durationMs":11180,
 "checkpoints":[step-1-open-cockpit-cards.png, step-2-drive-cockpitCard.select.png,
 step-3-drive-cockpitCard.showOption.png, step-4-drive-cockpitCard.confirm.png,
 step-5-drive-cockpitCard.select.png],
 "steps":[1 open:cockpit-cards ok, 2 cockpitCard.select ok, 3 cockpitCard.showOption ok,
 4 cockpitCard.confirm ok, 5 cockpitCard.select ok, 6 expect ok]}
```

第 4 步读数：`visibleCardIds` 仍含 `fixture:need`，`confirmOptionId:"later"`，`awaitingFeedback:1`。

诚实备注（与本次改动无关的既有红）：用 shipped 的 settings 默认 `cockpit.fixtureFeedback = {mode:"closed", delayMs:0}`（`server/modules/settings/server-settings.ts` 的 `DEFAULT_COCKPIT_FIXTURE_FEEDBACK`，随 feedback receipt 生命周期于 2026-10-28 23:21 落在 develop）时，确认后服务端立即把该卡移出列表，场景第 4 步的「卡片仍在列表」断言因此红。该红可在完全不触碰前端代码的模块级探针里复现：`createCockpitCardsModule({fixtureCards:true, fixtureFeedback:{mode:"closed",delayMs:0}})` → `confirm(fixture:need, later)` → 列表不再含 `fixture:need`。换成 provider 自己的默认 `mode:"none"`（`cockpit-fixture-card-provider.ts` 的 `DEFAULT_COCKPIT_FIXTURE_FEEDBACK`）后同一场景 6/6 绿，即上面的报告。这是既有场景与新 settings 默认之间的冲突，不是本任务的 delta。

该轴仍暗,理由:纯 UI 文案收敛（空闲态确认标签），未新增模块、导入边或跨层结构，暗轴读数持平。

## Touches

- tasks/gap-cockpit-confirm-label-without-option-text.md
- src/modules/cockpit/CockpitCard.tsx
- src/modules/cockpit/CockpitCardDetails.tsx
- src/modules/cockpit/CockpitCardConfirmBar.tsx
- src/modules/cockpit/tests/CockpitCard.test.tsx
- src/modules/cockpit/tests/cockpitCardsMobileDetails.test.tsx
- src/modules/cockpit/tests/i18nCockpitCompleteness.test.ts
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

---
id: gap-cockpit-confirm-label-without-option-text
title: 确认按钮不再重复选项文本：空闲态统一「Confirm」，选择项由列表显示／详情高亮表达
status: ready
labels:
  - gap
  - cockpit
parent: null
children: []
extra: {}
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

- [ ] `npx vitest run src/modules/cockpit/tests/CockpitCard.test.tsx` 退出 0，新增用例：给一张选项 label 长 60 字的卡片，空闲态确认按钮的 `textContent.trim()` 等于 `Confirm`，且**不包含**该 label 的任何片段；选「你自己的回复」时按钮文字同样等于 `Confirm`；不可逆选项进入确认态后，提示行仍包含该 label（信息没有丢）。
- [ ] `npx vitest run src/modules/cockpit/tests/cockpitCardsMobileDetails.test.tsx` 退出 0，新增用例：详情里的确认按钮文字等于 `Confirm`（不随所选项变化）。
- [ ] 假形态变红：把 `cardConfirm` 改回 `"Confirm · {{label}}"` ⇒ 第一条用例红；改完即还原。
- [ ] `npx vitest run src/modules/cockpit/tests/i18nCockpitCompleteness.test.ts` 退出 0（十个 locale 的 key 集与占位符集一致）；`npm run typecheck`、`npm run lint` 退出 0（lint 仅既有 warning）。

## DoD

真实页面（MCP 浏览器；只读，不点线上卡的 Confirm）：

1. PC 栏宽（440）与页面宽（1600）各截一张空闲态卡片：确认按钮显示 `Confirm`，完整不截断（贴出按钮 `scrollWidth <= clientWidth` 的读数）。
2. 手机宽（390）截一张：同上。
3. 选一个不可逆选项进入确认态（线上只允许进入确认态后按 Cancel，不发送）：截图显示按钮仍为短标签、上方提示行写明要发送的选项。

截图存 `tmp/`；若存在可用场景，同时跑 `node scripts/ui-scenario.mjs <scenario.json>` 并贴出 JSON 报告。

## Touches

- tasks/gap-cockpit-confirm-label-without-option-text.md
- src/modules/cockpit/CockpitCard.tsx
- src/modules/cockpit/CockpitCardDetails.tsx
- src/modules/cockpit/CockpitCardConfirmBar.tsx
- src/modules/cockpit/tests/CockpitCard.test.tsx
- src/modules/cockpit/tests/cockpitCardsMobileDetails.test.tsx
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

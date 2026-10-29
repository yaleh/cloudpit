---
id: gap-cockpit-option-edit-into-own-reply
title: 详情里每个选项加「✎ 编辑」：把实际发送全文（label — does）复制进自己的回复并聚焦到文本末尾
status: todo
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

来源：2026-10-29 与用户讨论定案。在详情里给选项加「✎ 编辑」，点击后把**该选项实际会发送的全文**复制进「Write your own」，并切到该行、把焦点放到文本末尾。这是「从建议出发改几个字再发」的快捷路径，不绕过确认卡。

现状核对（已读代码）：

- 会话提问卡选项真正发送的文本由服务端 `cockpit-fleet-card-projection.ts` 的 `contentOptionText(raw)` 决定：`does` 非空时是 `${label} — ${does}`，否则只发 `label`；该文本当前只存在于 `action.params.text` 里。
- `CockpitCardDetails` 已接收 `onOwnReplyChange`（绑定到 `controller.setOwnReply(cardId, text)`），而 `setOwnReply`（`cockpitCardController.ts:1446-1460`）已经会：写草稿、把 `shown` 切到 `ownReply`、取消已打开的确认/倒计时。所以「编辑」只缺两件事：把文本预填进去、把焦点放到末尾。
- 详情里的选项行现在**整行是一个 `<button>`**（`CockpitCardDetails.tsx:424-466`）。HTML 里 button 不能嵌套 button，所以「✎ 编辑」必须是行按钮的**兄弟**（`<li>` 内绝对定位在右上角），不能塞进行按钮内部。

做什么：

1. **线上契约加只读字段**：`CockpitCardOption` 增加 `sendText?: string`（`server/shared/types.ts:4737` 与 `src/shared/types.ts:4229` 同步），语义 =「该选项的动作实际会发送的文本，供『编辑进自己的回复』复制；缺席 = 该选项不可编辑」。TypeSync 的 `CockpitCardOption` object reader 覆盖该字段。
2. **服务端单一真相**：`contentOption` 里先算 `const sendText = contentOptionText(raw)`，`sendText` 放进选项、`params.text` 复用同一个值（消除「发送文本」在 action 参数与字段两处各写一份）。fleet 自己的 `session.start` / `fleet.*` 选项**不设** `sendText`（没有可复制的『发送文本』，且编辑一个 `fleet.hold` 进自己的回复没有意义）。
3. **夹具可测**：`fixtureOption` 增加可选 `sendText` 参数；`fixture:stuck` 卡的两个选项设 `sendText`（该卡 `subject.sessionId` 非空 ⇒ registry 会填 `session.send` 的 own-reply，编辑按钮因此可用），隔离实例里就能走通整条链。
4. **详情编辑按钮**：每个选项行（`card.options.map` 那一段）在其 `<li>` 内加一个绝对定位在右上角的小按钮「✎ 编辑」，只在 `option.sendText !== undefined && ownReplyAvailable && onOwnReplyChange !== undefined && !optionsLocked` 时渲染；点击 = `onOwnReplyChange(option.sendText)` + 置本地 `focusPending`。行按钮加 `pr-14`（或等价右内边距）避免与编辑按钮重叠。
5. **焦点只给编辑动作**：详情组件维护一个 `focusPending` 状态/ref；effect 在 `shown.kind === 'ownReply'` 且该抽屉的编辑 textarea 出现且 `focusPending` 为真时，`focus()` 并 `setSelectionRange(len, len)`，随后清掉标记。**普通点「✎ Write your own」不聚焦**，只有从「✎ 编辑」进来才聚焦。
6. 行内已有的高亮选中态不变：编辑按钮只是草稿快捷入口，不改变选中态语义；复制完 `shown` 是 `ownReply`，确认条绑定的是草稿文本。

## AC

- [ ] `npx vitest run src/modules/cockpit/tests/cockpitCardDetailsEditOption.test.tsx` 退出 0：渲染带 `sendText` 的选项时出现「✎ 编辑」按钮、无 `sendText` 的选项不出现；点击后 `ownReply` 草稿 === 该选项 `sendText`、`shown.kind === 'ownReply'`；点击后 textarea 获得焦点且 `selectionStart === selectionEnd === 文本长度`；**普通点击「✎ Write your own」后 textarea 不自动获得焦点**（document.activeElement 不是它）；`optionsLocked` 时编辑按钮 disabled 或不渲染；页面里不存在 button 嵌套 button（`document.querySelector('button button') === null`）。
- [ ] `npx tsx --tsconfig server/tsconfig.json --test server/modules/cockpit/tests/cockpit-fleet-card-provider.test.ts` 退出 0，新增用例：会话提问卡内容选项的 `sendText` === `label — does`（`does` 非空）或 `label`（`does` 空），且 `action.params.text === sendText`；fleet 自身 `session.start` / `fleet.*` 选项没有 `sendText` 键。
- [ ] `npx vitest run src/shared/tests/cockpitCardTypeSync.test.ts` 退出 0（`sendText` 两端字段一致）；`npx vitest run src/modules/cockpit/tests/i18nCockpitCompleteness.test.ts` 退出 0（新文案进全部 locale）。
- [ ] 假形态变红：把 `sendText` 从投影里删掉 ⇒ 第一条服务端用例红；把「普通选 own reply 不聚焦」改成无条件聚焦 ⇒ 第一条前端用例红；改完即还原。
- [ ] `npx tsx --tsconfig server/tsconfig.json --test server/shared/tests/server-import-cycle-budget.test.ts`、`npx tsx --tsconfig server/tsconfig.json --test server/shared/tests/architecture-ratchet.test.ts` 退出 0；`npm run typecheck`、`npm run lint` 退出 0（lint 仅既有 warning）；两个 `types.ts` 的增长按 RECORDED CHANGE 记录。

## DoD

隔离实例（关 residentRestore；fleet home 指向临时副本；只点夹具卡片）：

1. 打开 `fixture:stuck` 卡详情：截图显示每个选项行右上角有「✎ 编辑」；点第一个选项的编辑按钮 → 截图显示「✎ Write your own」行高亮、textarea 已填入 `Resume with a nudge — Send one message asking for the next concrete step.`、焦点与光标在末尾（贴出 `document.activeElement` 的 testid 与 `selectionStart/End` 读数）。
2. 在 textarea 末尾加几个字，确认条显示 `Confirm` 且目标 label 等于编辑后的全文（贴出 `targets[cardId].label` 读数）；**不点确认**。
3. 手机宽（390）与 PC 宽（1600）各一组截图，存 `tmp/`；若存在可用场景，同时跑 `node scripts/ui-scenario.mjs <scenario.json>` 并贴出 JSON 报告。

## Touches

- tasks/gap-cockpit-option-edit-into-own-reply.md
- server/shared/types.ts
- server/modules/cockpit/cockpit-fleet-card-projection.ts
- server/modules/cockpit/cockpit-fixture-card-provider.ts
- server/modules/cockpit/tests/cockpit-fleet-card-provider.test.ts
- src/shared/types.ts
- src/shared/tests/cockpitCardTypeSync.test.ts
- src/modules/cockpit/CockpitCardDetails.tsx
- src/modules/cockpit/tests/cockpitCardDetailsEditOption.test.tsx (new)
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
- server/shared/tests/server-import-cycle-budget.test.ts

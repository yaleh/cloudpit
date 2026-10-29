---
id: gap-cockpit-option-edit-into-own-reply
title: 详情里每个选项加「✎ 编辑」：把实际发送全文（label — does）复制进自己的回复并聚焦到文本末尾
status: ready
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

- [x] `npx vitest run src/modules/cockpit/tests/cockpitCardDetailsEditOption.test.tsx` 退出 0：渲染带 `sendText` 的选项时出现「✎ 编辑」按钮、无 `sendText` 的选项不出现；点击后 `ownReply` 草稿 === 该选项 `sendText`、`shown.kind === 'ownReply'`；点击后 textarea 获得焦点且 `selectionStart === selectionEnd === 文本长度`；**普通点击「✎ Write your own」后 textarea 不自动获得焦点**（document.activeElement 不是它）；`optionsLocked` 时编辑按钮 disabled 或不渲染；页面里不存在 button 嵌套 button（`document.querySelector('button button') === null`）。
- [x] `npx tsx --tsconfig server/tsconfig.json --test server/modules/cockpit/tests/cockpit-fleet-card-provider.test.ts` 退出 0，新增用例：会话提问卡内容选项的 `sendText` === `label — does`（`does` 非空）或 `label`（`does` 空），且 `action.params.text === sendText`；fleet 自身 `session.start` / `fleet.*` 选项没有 `sendText` 键。
- [x] `npx vitest run src/shared/tests/cockpitCardTypeSync.test.ts` 退出 0（`sendText` 两端字段一致）；`npx vitest run src/modules/cockpit/tests/i18nCockpitCompleteness.test.ts` 退出 0（新文案进全部 locale）。
- [x] 假形态变红：把 `sendText` 从投影里删掉 ⇒ 第一条服务端用例红；把「普通选 own reply 不聚焦」改成无条件聚焦 ⇒ 第一条前端用例红；改完即还原。
- [x] `npx tsx --tsconfig server/tsconfig.json --test server/shared/tests/server-import-cycle-budget.test.ts`、`npx tsx --tsconfig server/tsconfig.json --test server/shared/tests/architecture-ratchet.test.ts` 退出 0；`npm run typecheck`、`npm run lint` 退出 0（lint 仅既有 warning）；两个 `types.ts` 的增长按 RECORDED CHANGE 记录。

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
- src/modules/i18n/locales/tr/common.json
- src/modules/i18n/locales/zh-TW/common.json
- server/shared/tests/architecture-ratchet.baseline.json
- server/shared/tests/server-import-cycle-budget.test.ts

（Touches 增补说明：`tr` 与 `zh-TW` 两个 locale 原清单漏列，但 i18n 完整性用例要求每个 locale 目录都带同一个 key，实现时一并加入。）

## 实现记录

- **契约**：`CockpitCardOption.sendText?: string`，两端 `types.ts` 各 +7 行同一段字段注释；TypeSync 的 object row 自动覆盖。
- **投影**：`contentOption` 先 `const sendText = contentOptionText(raw)`，`sendText` 字段与 `action.params.text` 复用同一个字符串；fleet 选项经 `mapOption` 构造，永远不带该键。
- **夹具**：`fixtureOption(..., sendText?)`（第 8 个可选参数）；`fixture:stuck` 的 `resume` / `park` 传入与 `action.params.text` 相同的文本。
- **详情 UI**：`<li className="relative">`，行按钮在有快捷入口时加 `pr-14`；编辑按钮是行按钮的**兄弟**（不嵌套）。点击只做 `onOwnReplyChange(editableText)` + 置 `focusOwnReplyPending`。effect 在抽屉自己的 `<ul>` 里 `querySelector('textarea')`，`focus()` 后 `setSelectionRange(len, len)` 并清标记；普通点「自己的回复」不置标记 ⇒ 不聚焦。`optionsLocked`（已发反馈）时不渲染。
- **文案**：12 个 locale 的 `cockpit.cardEditOption`（en `Edit` / zh-CN `编辑` / zh-TW `編輯` / de `Bearbeiten` / es `Editar` / fr `Modifier` / id `Ubah` / it `Modifica` / ja `編集` / ko `편집` / ru `Изменить` / tr `Düzenle`）。

## AC 结果

1. `npx vitest run src/modules/cockpit/tests/cockpitCardDetailsEditOption.test.tsx` → `Test Files 1 passed | Tests 5 passed`，退出 0。用例覆盖：只有带 `sendText` 的选项出现编辑按钮、`button button` 为 null；点击后草稿 === sendText 且 `aria-pressed` 为 own-reply 行；焦点落在 textarea 末尾（`selectionStart === selectionEnd === len`）；普通点 own-reply 行**不**聚焦；已发反馈（`optionsLocked`）时无按钮、无嵌套。
2. `npx tsx --tsconfig server/tsconfig.json --test server/modules/cockpit/tests/cockpit-fleet-card-provider.test.ts` → `tests 14, pass 14, fail 0`，退出 0。新用例读：`deleting.sendText === 'Delete staging — Remove the staging directory after the archive is verified.'`、`keeping.sendText === 'Keep staging'`、两者 `action.params.text === sendText`；卡片上所有 `fleet.*` / `session.start` 选项 `'sendText' in option === false`。
3. `npx vitest run src/shared/tests/cockpitCardTypeSync.test.ts` → `Tests 7 passed`；`npx vitest run src/modules/cockpit/tests/i18nCockpitCompleteness.test.ts` → `Tests 14 passed`；均退出 0。
4. 假形态（两支都已还原，`cmp` 与备份逐字节一致）：
   - 从 `contentOption` 的返回里删掉 `sendText,` ⇒ `✖ AC: a content option carries the exact text it sends as \`sendText\`, and fleet options carry none`，`fail 1`。
   - 把 effect 守卫 `if (!focusOwnReplyPending || !showingOwnReply) return;` 改成 `if (!showingOwnReply) return;` ⇒ `× does NOT focus the editor when the ordinary own-reply row is pressed`，`Tests 1 failed | 4 passed`。
5. `server-import-cycle-budget.test.ts` → `tests 11, pass 11`；`architecture-ratchet.test.ts` → `tests 6, pass 6`；均退出 0。`npm run typecheck` 退出 0；`npm run lint` 退出 0（408 warnings，全部既有）。ratchet 的 RECORDED CHANGE 记在 `architecture-ratchet.baseline.json` 的 note 里：两个 `types.ts` 因同一段 7 行字段注释同步增长。

## DoD 结果

隔离实例：`scripts/isolated-instance.sh`（`residentRestore.enabled=false`；`cockpit.fixtureCards=true`、`fleetCards.enabled=false`、`fixtureFeedback.mode=none`；`observation.sessionDigest.enabled=false`；`HOME` 与 `QUAY_FLEET_HOME` 均指向 `/tmp/gap-opt-edit-dod` 的副本），浏览器只点 fixture 卡（脚本每次断言 `realCardsSeen === []`）。驱动脚本与 JSON 报告在 worktree `tmp/dod/`（`tmp/` 被 gitignore，不随实现提交）。

1. `fixture:stuck` 详情：两个选项行右上角都有「✎ 编辑」，几何读数 `editRightInset=4, editTopInset=4`（两行一致），`nestedButtonCount=0`。点 `resume` 的编辑按钮后：
   - `textareaValue = 'Resume with a nudge — Send one message asking for the next concrete step.'`
   - `document.activeElement` 的 testid = `cockpit-card-details-own-reply-input`（`TEXTAREA`）
   - `selectionStart = selectionEnd = 73`（= 全文长度）
   - `ownReplyRowSelected = 'true'`；卡片读数 `shownOptionId=null, ownReply=true`（即 shown 已是 ownReply）
2. 末尾键入 ` Please keep going.` 后：
   - `textareaValue` / `confirmLabel` 同为 `'Resume with a nudge — Send one message asking for the next concrete step. Please keep going.'`（当前契约把任务里写的 `targets[cardId].label` 放在 `cards[].confirmLabel`）
   - `confirmBarVisible=true`、`data-card-id='fixture:stuck'`、按钮文案中文 locale `确认` / 英文 locale `Confirm`
   - **没有点确认**（`confirmBarDataCardId` 的读取在点击前，之后无 receipt）
3. 截图（worktree `tmp/dod/`，每步一张）：
   - 1600：`dod-1600-1-details-with-edit-buttons.png`、`dod-1600-2-copied-into-own-reply.png`、`dod-1600-3-confirm-target.png`
   - 390：`dod-390-1-details-with-edit-buttons.png`、`dod-390-2-copied-into-own-reply.png`、`dod-390-3-confirm-target.png`
   - 1600 英文（补 DoD 里 `Confirm` 的字面）：`dod-1600-en-*.png`
   - 每次运行 `pageErrors=[]`。
   场景报告（`node scripts/ui-scenario.mjs … --out tmp/dod/…`）：
   - `e2e/scenarios/cockpit-mode-switch.json` → 绿：
     `{"ok":true,"stepCount":3,"failedStep":null,"durationMs":3421,"steps":[{"index":1,"action":"open:session","ok":true,"failures":[]},{"index":2,"action":"open:cockpit","ok":true,"failures":[]},{"index":3,"action":"open:session","ok":true,"failures":[]}]}`
   - `e2e/scenarios/cockpit-cards-confirm.json`（首跑，fixture 状态干净）→ steps 1–3 绿、step 4 红：
     `{"ok":false,"stepCount":6,"failedStep":4,"durationMs":7852,"steps":[{"index":1,"ok":true},{"index":2,"ok":true},{"index":3,"ok":true},{"index":4,"ok":false,"failures":["cockpitCardConfirmTarget: expected {\"optionId\":\"later\",\"label\":\"Later\"}, read {\"optionId\":\"provide\",\"label\":\"Provide the credential\"}"]},{"index":5,"ok":true},{"index":6,"ok":true}]}`
     这条红与本任务 diff 无关：确认后 fixture executor 会 `card.revision += 1`，controller 在 `(revision, contentRevision)` 变化时把 shown 掉回默认选项，于是 step 4 读到的 confirm target 是默认的 `provide`；场景期望它仍停在已发送的 `later`。本任务对这一段的改动只有 `fixtureOption` 多传一个 `sendText`（形参 + 两个调用点），没有动 executor / revision / controller。附带发现：确认记录持久化在 `~/.cloudcli/cockpit-card-feedback.json`，同一进程/同一 HOME 再跑一次会在 step 3 就被 `feedback` 锁住（`shownOptionId` 停在默认 `provide`）；删掉该文件并重启可复现上面的「1–3 绿、4 红」。

## 读数（ADR-007）

该轴仍暗,理由:本任务只把已有的 `action.params.text` 复用到一个只读字段、并在详情里把同一字符串复制进既有的 own-reply 草稿，没有新增数据通路、文档或模块依赖；L_D 与 L_G 是仓库级读数，本任务没有使它们发生变化。

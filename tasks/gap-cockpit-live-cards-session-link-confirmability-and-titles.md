---
id: gap-cockpit-live-cards-session-link-confirmability-and-titles
title: 驾驶舱真实卡片四处缺口：Details 从 subject.sessionId 推出原会话链接；未声明执行器的选项禁用确认并说明原因；显示
  contentUnavailable；无 ask 时标题用任务名或首条事实代替 quay:// 地址
status: todo
labels:
  - gap
  - defect
  - cockpit
parent: null
children: []
extra:
  schema: execution
---
## Proposal

来源：2026-10-27 22:30 接通 quay-fleet 卡片后在线上（:3001，构建 `16e52bf16`，quay-fleet release `3b624f5`）用 MCP 浏览器实测，截图在主检出 `tmp/cockpit-live-*.png`。10 张真实卡片（卡住 5、会话提问 3、需要人 1、需决定 1）暴露出四处缺口，全部在 CloudCLI 侧：

1. **Details 没有原会话链接。** 会话提问卡带 `subject.sessionId`（例如 `dbbf1404-…`），但 `src/modules/cockpit/CockpitCardDetails.tsx` 只读 `card.conversation?.sessionId`（约第 93 行）；fleet 不给 `conversation`，`server/modules/cockpit/cockpit-card-registry.ts` 的投影也没有从主体推出它（只推了 `ownReply`），所以 Details 只显示「Start a conversation about this」。
2. **未声明执行器的选项可以点确认，点了会报错。** fleet 救援卡的选项绑定 `fleet.hold`、`fleet.park`、`fleet.redispatch`、`fleet.log`，而 `cockpit-fleet-card-provider.ts` 的 `declaredExecutors` 为空、注册表里也没有这些执行器（fleet 处置执行器是后续目标）。界面上「Confirm · 可重派」却是可点的蓝色按钮，确认通道会以未声明执行器拒绝。
3. **内容未就绪的原因没显示。** 接口给出 `contentUnavailable`（例如「提问决策摘要未启用：未启用 observation.sessionDigest（提问决策摘要）」），卡片上不渲染，用户只看到一张空卡。
4. **标题是机器地址。** fleet 卡片没有 `ask`，界面退回显示 `subject.uri`（如 `quay://quay/task/gap-routine-…`、`quay://quay/board`）。

做什么：

- 投影（`cockpit-card-registry.ts`）：卡片没有 `conversation` 而 `subject.sessionId` 存在时，补 `conversation = { sessionId }`；提供方声明了 `conversation` 时以提供方为准（与已有的 ownReply 默认同一处、同一原则：按主体推出的内容默认值，不是语义判断）。
- 投影给每个选项标注可确认性：选项的 `action.executor` 不在已注册执行器集合里时，加 `confirmable: false` 与可读原因（例如「执行器 fleet.redispatch 尚未接入」）；共享类型两侧同步，TypeSync 判据覆盖新字段。前端 controller 与组件据此禁用确认条并在条上显示原因；选项照常可读、可在下拉里查看。
- 卡片组件（`CockpitCard.tsx` 与 Details）：存在 `contentUnavailable` 时在情境位置显示该原因（弱化样式），不显示空白。
- 标题兜底（前端描述表，不按提供方分支）：`ask` 为空时依次取 `subject.taskId`（显示为任务名）、首条事实的文本、最后才是 `subject.uri`；会话提问卡在内容未就绪时显示「会话 <短 id> 在等你回答」一类文案。新文案进所有语言的 `common.json`。

## AC

- [ ] `npx tsx --tsconfig server/tsconfig.json --test server/modules/cockpit/tests/cockpit-card-registry.test.ts` 退出 0，新增用例：只有 `subject.sessionId` 的卡片投影出 `conversation.sessionId`；提供方自带 `conversation` 时不被覆盖；选项执行器未注册 ⇒ `confirmable: false` 且原因含执行器 id；已注册 ⇒ 不带该标记或为 true。
- [ ] `npx vitest run src/modules/cockpit/tests/CockpitCard.test.tsx src/modules/cockpit/tests/cockpitCardController.test.ts` 退出 0，新增用例：不可确认的选项显示时确认条禁用并显示原因，确认动作不发请求；`contentUnavailable` 文本出现在卡片上；无 ask 时标题依次退到任务名、首条事实、uri；Details 对只有 subject.sessionId 的卡片渲染原会话链接（`data-testid="cockpit-card-conversation-link"`）。
- [ ] `npx vitest run src/shared/tests/cockpitCardTypeSync.test.ts` 退出 0（新字段两侧一致）。
- [ ] 假形态变红：去掉投影里的 conversation 推导 ⇒ Details 链接用例红；确认条忽略 `confirmable` ⇒ 禁用用例红。改完即还原。
- [ ] `npx vitest run src/modules/cockpit/tests src/modules/chat/tests/inlineQuoteChip.test.tsx` 退出 0，既有用例数不减少。
- [ ] `npm run typecheck`、`npm run lint` 与 `npm run build:client` 退出 0；提交前单跑 `npx tsx --tsconfig server/tsconfig.json --test server/shared/tests/architecture-ratchet.test.ts` 退出 0。

## DoD

隔离实例（`scripts/isolated-instance.sh start`，打开 `cockpit.fixtureCards`；夹具里补一张只带 `subject.sessionId` 且无 ask 的卡、一张选项执行器未注册的卡、一张带 `contentUnavailable` 的卡）上用 MCP 浏览器在 1440 与 390 宽度实际查看并截图存 `tmp/`：标题不是 `quay://` 地址；未注册执行器的选项确认条禁用并显示原因；内容未就绪原因可见；打开 Details 有原会话链接，点击后 PC 宽度在左侧打开该会话。⛔ 不在线上实例点击任何确认。实例用毕 `scripts/isolated-instance.sh stop`。

## Touches

- tasks/gap-cockpit-live-cards-session-link-confirmability-and-titles.md
- server/modules/cockpit/cockpit-card-registry.ts
- server/modules/cockpit/cockpit-fixture-card-provider.ts
- server/modules/cockpit/tests/cockpit-card-registry.test.ts
- server/shared/types.ts
- src/shared/types.ts
- src/shared/tests/cockpitCardTypeSync.test.ts
- src/modules/cockpit/CockpitCard.tsx
- src/modules/cockpit/CockpitCardDetails.tsx
- src/modules/cockpit/cockpitCardController.ts
- src/modules/cockpit/cockpitCardDescriptors.ts
- src/modules/cockpit/tests/CockpitCard.test.tsx
- src/modules/cockpit/tests/cockpitCardController.test.ts
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

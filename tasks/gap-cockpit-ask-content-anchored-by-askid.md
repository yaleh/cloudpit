---
id: gap-cockpit-ask-content-anchored-by-askid
title: 提问卡的内容按 askId 锚定：摘要按 askId 存、投影按 contentRef 取、摘要缺失时用原文兜底并禁止空卡可确认
status: ready
labels:
  - gap
  - cockpit
parent: null
children: []
extra: {}
depends_on:
  - gap-cockpit-asking-event-question-text
---
## Proposal

来源：2026-10-29 驾驶舱线上审查（MCP 浏览器，只读）。截图 `tmp/cockpit-audit2/02-empty-ask-card.png`、`zz-empty-dropdown.png`。

两个已复现的缺陷，根因是同一个：**提问卡的问句与选项来自「本会话最新那份摘要」，而不是这张卡自己那条提问的摘要**。

1. **旧卡借用新提问的选项。** `observed_objects` 每个会话只有一行、`digest_json.askDecision` 只有一个槽位。会话 `c0aa3f51` 的摘要是 askId `…c4-be80-40ed…`（较晚那次提问），而卡片 `att_7f04bb456ab0` 的 `contentRef.messageId` 是 `…e6-6a41…`（较早那次）。投影（`server/modules/cockpit/cockpit-fleet-card-projection.ts:278-290`）不看 messageId，直接用会话槽位，于是旧卡显示新提问的选项。fleet 那侧对这三张卡的实测读数是 `options=[] ask=''`——内容全部由我们这边填。
2. **没有摘要的卡是空壳。** 会话 `49622a6c` 同时挂着 3 张卡（37m/23m/15m），卡片正文只有 `Session 49622a6c is waiting for your answer` + `提问决策摘要尚未生成`，问句不在卡上，下拉里只有「✎ Write your own」，底下还写着 `Choose an option, then confirm`——一个无法理解的确认面。

做什么：

1. **摘要按 askId 存**：`SessionDigest` 的 `askDecision` 旁新增按 askId 的映射（例如 `askDecisions: Record<askId, SessionAskDecision>`，按时间保留最近 10 条，超出丢弃最旧），写入时同时维护「当前那条」的既有字段（存量读取路径不变）。单条决策的形状与现有 `SessionAskDecision` 完全一致。
2. **按 contentRef 取内容**：投影改为用卡片的 `contentRef.messageId` 解析 askId，再取该 askId 的决策；取不到时**不**回落到会话槽位。卡片因此携带 `contentUnavailable = '这条提问的摘要尚未生成'`，`options` 为空。
3. **问句兜底**：取不到摘要时，用已能读到的 `readSessionAsk(raw, sessionId, messageId).current.assistantText` 作为卡片的 `ask`（尾部截断到 600 字，常量与注释写明用途：这是原文兜底，不是摘要）；连原文都读不到才既无 ask 也无 options。
4. **不可确认的空卡**：`contentUnavailable !== undefined && options.length === 0` 时，卡片标记为不可确认（复用现有 `confirmable`/`disabledReason` 通道），前端（`CockpitCard.tsx`）在该状态下隐藏「Choose an option」下拉与确认条的空态，只显示：兜底问句、原因一句、`打开会话 ›`、`✎ 写自己的回复` 入口。
5. 效果：同一会话的两条提问各读各的摘要；摘要缺失时人仍能看到「在问什么」，并可用自己的回复作答。

## AC

- [ ] `npx tsx --tsconfig server/tsconfig.json --test server/modules/observation/tests/session-ask-decision-digest.test.ts` 退出 0，新增用例：同一会话先有 ask A、后有 ask B，各自写出一份决策；按 askId A 读回的选项标签与 write 时 A 的一致（不是 B 的）；按 askId 保留上限生效（第 11 条最早被丢）。
- [ ] `npx tsx --tsconfig server/tsconfig.json --test server/modules/cockpit/tests/cockpit-fleet-card-provider.test.ts` 退出 0，新增用例：两张卡指向同一会话的不同 messageId，各自拿到自己那份摘要的选项（断言两者的选项标签互不相等）；某张卡的 messageId 没有摘要时 `options` 为空、`contentUnavailable` 非空、`ask` 等于该消息的助手原文（截断到 600 字）。
- [ ] `npx vitest run src/modules/cockpit/tests/CockpitCard.test.tsx` 退出 0，新增用例：`contentUnavailable` 且无选项的卡不渲染选项下拉、不渲染「Choose an option, then confirm」，渲染兜底问句与「写自己的回复」入口。
- [ ] 假形态变红：把投影改回「会话槽位」取内容 ⇒ 第二条用例红（旧卡会拿到 B 的选项）；把 `ask` 兜底删掉 ⇒ 空卡用例红；改完即还原。
- [ ] `npx vitest run src/modules/cockpit/tests/i18nCockpitCompleteness.test.ts` 退出 0；`npm run typecheck`、`npm run lint` 退出 0（lint 仅既有 warning）；`server/shared/types.ts` 与 `src/shared/types.ts` 的增长按 RECORDED CHANGE 记录。

## DoD

隔离实例（关 residentRestore；fleet home 指向临时副本，⛔ 不写真实 `~/.quay-fleet`）：

1. 种一个会话：先提问 A、用户答、再提问 B。截图：A 的卡显示 A 的选项与问句，B 的卡显示 B 的；贴出两张卡的 `ask` 与选项标签读数。
2. 让 B 的摘要失败（模型名设为不存在）：B 的卡截图显示原文兜底问句 + 原因 + 「写自己的回复」，没有空白下拉；贴出 `contentUnavailable` 与 `ask` 读数。
3. 手机宽（390）与 PC 宽（1600）各一组，截图存 `tmp/`；若存在可用场景，同时跑 `node scripts/ui-scenario.mjs <scenario.json>` 并贴出 JSON 报告。

## Touches

- tasks/gap-cockpit-ask-content-anchored-by-askid.md
- server/modules/observation/session-digest.producer.ts
- server/modules/observation/session-ask-decision-digest.ts
- server/modules/observation/session-ask-decision-reader.ts
- server/modules/observation/tests/session-ask-decision-digest.test.ts
- server/modules/cockpit/cockpit-fleet-card-projection.ts
- server/modules/cockpit/tests/cockpit-fleet-card-provider.test.ts
- server/shared/types.ts
- src/shared/types.ts
- src/modules/cockpit/CockpitCard.tsx
- src/modules/cockpit/tests/CockpitCard.test.tsx
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

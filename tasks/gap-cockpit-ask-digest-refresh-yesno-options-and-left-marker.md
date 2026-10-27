---
id: gap-cockpit-ask-digest-refresh-yesno-options-and-left-marker
title: 驾驶舱提问卡三处小缺口：存为「未启用」的提问摘要在启用后读取时重算；是/否题生成「是 / 否」两个选项；左侧已打开同一会话时卡片标「已在左侧打开」
status: ready
labels:
  - gap
  - defect
  - cockpit
parent: null
children: []
extra:
  schema: execution
depends_on:
  - cockpit-shell-filters-mobile-page-and-details-bar
---
## Proposal

来源：2026-10-28 00:35 线上验证（服务构建 `e23549671`，quay-fleet `885b032`，截图 `/data/home/yale/work/claudecodeui/tmp/cockpit-v2-*.png`），6 张真实卡片中发现三处 CloudCLI 侧小缺口：

1. **启用前算出的「未启用」摘要不会重算。** 线上在 2026-10-27 22:40 才打开 `observation.sessionDigest`。此前已到达的提问，其会话 digest 里存的 `askDecision` 是 `{ state: 'skipped', reason: '未启用 observation.sessionDigest（提问决策摘要）' }`（`server/modules/observation/session-ask-decision-digest.ts` 约第 180 行），只有该会话下一轮结束才会重算。所以 4 张提问卡里有 3 张一直显示「提问决策摘要未启用」，而设置早已启用。
2. **是/否题没有选项。** 已补全的那张卡（「是否要经 SendMessage 向会话『摄像头与阻塞项驾驶舱』发送 browser_close 以释放 MCP 浏览器 profile？」）问题与情境都对，但 `options` 为空，只能用「自己的回复」。助手以「是否要…」「要我…吗」一类句式提问时，摘要应给出两个选项。
3. **「已在左侧打开」标记只认链接点击。** `src/modules/cockpit/CockpitCardList.tsx` 以 `openedCardId === detailsCard.id` 判断（约第 199 行），只有经卡片链接打开时才标记；页面本来就停在该会话（例如从侧栏点进来）时，Details 仍显示「Open conversation …」链接，没有标记。

做什么：

- 摘要重算（观察层负责，驾驶舱不判定）：读取某会话的提问摘要时，若存的是 `skipped` 且原因是「未启用」，而当前设置已启用，则就地对该会话最后一条助手消息重算一次并写回 digest；同一会话同一 askId 只重算一次（结果失败也记下，不反复调用）；受现有 `maxPerHour` 限额约束，超限时保持原读数并给出「本轮未生成（限额）」原因。入口放在观察层导出的读取函数里，`server/cockpit-fleet-wiring.ts` 的 `readAskDecision` 改为经它读取。
- 是/否题选项：`session-ask-decision-digest.ts` 的提示与校验支持二选一提问——问题是是/否形态且助手原文没有列出选项时，生成「是」「否」两个选项（各带一句做什么与后果标签）；助手原文给了推荐（例如「我建议先…」）时对应项 `suggested=true`、`source=assistant`；没有推荐时两项都不标 suggested。不改变已有的多选项提问的行为。
- 左侧标记：卡片的 `conversation.sessionId` 等于当前左侧路由的会话 id 时，Details 显示「已在左侧打开」标记而不是链接（PC 列内）；手机卡片页不受影响。当前会话 id 从路由读，经 `CockpitColumn` 传入，不让卡片组件直接读路由。

## AC

- [ ] `npx tsx --tsconfig server/tsconfig.json --test server/modules/observation/tests/session-ask-decision-digest.test.ts` 退出 0，新增用例：存为「未启用」的读数在设置启用后读取时重算一次并写回；同一 askId 第二次读取不再调用 LLM 桩；设置仍未启用时不重算；超过 `maxPerHour` 时保持原读数并给出限额原因；是/否题且原文无推荐 ⇒ 两个选项都不 suggested；是/否题且原文推荐「是」⇒ 「是」suggested 且 source=assistant；多选项提问的既有用例不变。
- [ ] `npx tsx --tsconfig server/tsconfig.json --test server/modules/cockpit/tests/cockpit-fleet-card-provider.test.ts` 退出 0（经新读取函数补全的用例覆盖「读取时重算后卡片带出问题与选项」）。
- [ ] `npx vitest run src/modules/cockpit/tests/CockpitColumn.test.tsx` 退出 0，新增用例：当前路由会话 id 等于卡片 `conversation.sessionId` 时 Details 显示「已在左侧打开」标记、不渲染 `cockpit-card-conversation-link`；不等时渲染链接。
- [ ] 假形态变红：把重算条件改为「任何 skipped 都重算」（包括设置仍未启用）⇒ 用例红；把是/否题无推荐时默认标「是」为 suggested ⇒ 用例红。改完即还原。
- [ ] `npx tsx --tsconfig server/tsconfig.json --test server/shared/tests/server-import-cycle-budget.test.ts` 与 `npx tsx --tsconfig server/tsconfig.json --test server/shared/tests/architecture-ratchet.test.ts` 均退出 0；`npm run typecheck`、`npm run lint` 退出 0（lint 仅既有 warning）。

## DoD

用 workers 网关最便宜的模型（不打印密钥，网关主机打码），在隔离实例里复制一个会话库：先在关闭 `observation.sessionDigest` 时让一个会话以是/否提问结束，读到 `skipped`；再打开设置，请求一次 `/api/cockpit/cards`（打开 `cockpit.fixtureCards` 并用一张指向该会话的夹具提问卡，或经临时未提交的提供方给出），贴出该卡带出的问题、情境与「是 / 否」两个选项，以及 LLM 调用次数（第二次请求不增加）。再用 MCP 浏览器在 1440 宽度直接打开该会话页，展开驾驶舱列并打开这张卡的 Details，截图显示「已在左侧打开」标记，存 `tmp/`。⛔ 不在线上实例点击任何确认。实例用毕 `scripts/isolated-instance.sh stop`。

## Touches

- tasks/gap-cockpit-ask-digest-refresh-yesno-options-and-left-marker.md
- server/modules/observation/session-ask-decision-digest.ts
- server/modules/observation/session-digest.producer.ts
- server/modules/observation/index.ts
- server/modules/observation/tests/session-ask-decision-digest.test.ts
- server/cockpit-fleet-wiring.ts
- server/modules/cockpit/tests/cockpit-fleet-card-provider.test.ts
- src/modules/cockpit/CockpitColumn.tsx
- src/modules/cockpit/CockpitCardList.tsx
- src/modules/cockpit/CockpitCardDetails.tsx
- src/modules/cockpit/tests/CockpitColumn.test.tsx
- server/shared/tests/server-import-cycle-budget.test.ts
- server/shared/tests/architecture-ratchet.baseline.json

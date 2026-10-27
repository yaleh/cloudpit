---
id: gap-cockpit-ask-digest-refresh-yesno-options-and-left-marker
title: 驾驶舱提问卡三处小缺口：存为「未启用」的提问摘要在启用后读取时重算；是/否题生成「是 / 否」两个选项；左侧已打开同一会话时卡片标「已在左侧打开」
status: done
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

- [x] `npx tsx --tsconfig server/tsconfig.json --test server/modules/observation/tests/session-ask-decision-digest.test.ts` 退出 0，新增用例：存为「未启用」的读数在设置启用后读取时重算一次并写回；同一 askId 第二次读取不再调用 LLM 桩；设置仍未启用时不重算；超过 `maxPerHour` 时保持原读数并给出限额原因；是/否题且原文无推荐 ⇒ 两个选项都不 suggested；是/否题且原文推荐「是」⇒ 「是」suggested 且 source=assistant；多选项提问的既有用例不变。
  - 证据：`tests 14 / pass 14 / fail 0`（retrieval 见下）。新写者 `server/modules/observation/session-ask-decision-reader.ts` 在首次读取时启动后台重算并把结果写回；同一 `askId` 只尝试一次（失败也在 `attempted` 里记住）；`maxPerHour` 用尽时返回 `{ state: 'skipped', reason: '本轮未生成（限额）' }` 且不写回。
- [x] `npx tsx --tsconfig server/tsconfig.json --test server/modules/cockpit/tests/cockpit-fleet-card-provider.test.ts` 退出 0（经新读取函数补全的用例覆盖「读取时重算后卡片带出问题与选项」）。
  - 证据：`tests 10 / pass 10 / fail 0`；新增 `AC: a stored disabled-tier reading is repaired on read, so the card carries its question and 是/否`：内存 store 存入 skipped 读数，读取触发后台重算，`settled()` 后第二次读取的卡片无 `contentUnavailable`，`ask`/`situation` 带出，选项 label 为 `['是','否']`，`suggested` 为 `[false,false]`。
- [x] `npx vitest run src/modules/cockpit/tests/CockpitColumn.test.tsx` 退出 0，新增用例：当前路由会话 id 等于卡片 `conversation.sessionId` 时 Details 显示「已在左侧打开」标记、不渲染 `cockpit-card-conversation-link`；不等时渲染链接。
  - 证据：`Test Files 1 passed / Tests 13 passed`。`CockpitColumn` 用 `useParams` 读路由并把 `currentSessionId` 传给 `CockpitCardList`，后者只在内联的列内 Details 上传递；卡片组件不读路由。路由为 `session-1` 时 `cockpit-card-opened-in-session` 在、link 不在；路由为 `session-2` 时相反。
- [x] 假形态变红：把重算条件改为「任何 skipped 都重算」（包括设置仍未启用）⇒ 用例红；把是/否题无推荐时默认标「是」为 suggested ⇒ 用例红。改完即还原。
  - 证据 A：删掉读取函数里的 `if (!settings.enabled) return reading;` 后跑 `--test-name-pattern "with the setting still off"` ⇒ `fail 1`，`AssertionError: the disabled tier must not start a repair / 1 !== 0`（该用例注入的是不受设置约束的原始 `summarize` 桩，记录每次尝试，因此判据真的能区分守卫）。
  - 证据 B：让合成的是/否选项在无推荐时把 `yes` 当作推荐 ⇒ `fail 1`，`actual [ { id:'yes', suggested:true }, … ]` vs `expected suggested:false`。两处均已还原并重跑全绿。
- [x] `npx tsx --tsconfig server/tsconfig.json --test server/shared/tests/server-import-cycle-budget.test.ts` 与 `npx tsx --tsconfig server/tsconfig.json --test server/shared/tests/architecture-ratchet.test.ts` 均退出 0；`npm run typecheck`、`npm run lint` 退出 0（lint 仅既有 warning）。
  - 证据：import-cycle `tests 11 / pass 11`；architecture-ratchet `tests 6 / pass 6`；`npm run typecheck` exit 0；`npm run lint` exit 0（403 条 warning，全部既有基线，无 error）。

## DoD

用 workers 网关最便宜的模型（不打印密钥，网关主机打码），在隔离实例里复制一个会话库：先在关闭 `observation.sessionDigest` 时让一个会话以是/否提问结束，读到 `skipped`；再打开设置，请求一次 `/api/cockpit/cards`（打开 `cockpit.fixtureCards` 并用一张指向该会话的夹具提问卡，或经临时未提交的提供方给出），贴出该卡带出的问题、情境与「是 / 否」两个选项，以及 LLM 调用次数（第二次请求不增加）。再用 MCP 浏览器在 1440 宽度直接打开该会话页，展开驾驶舱列并打开这张卡的 Details，截图显示「已在左侧打开」标记，存 `tmp/`。⛔ 不在线上实例点击任何确认。实例用毕 `scripts/isolated-instance.sh stop`。

- 隔离实例：`scripts/isolated-instance.sh start`（state 目录 `tmp/dod-ask-refresh/state`，复制 `~/.cloudcli/auth.db`，`residentRestore` off、scope sweep off，`resident_restore_started:0`），端口 `7203`。用临时未提交的 `QUAY_FLEET_BIN` 提供方（`tmp/dod-ask-refresh/fleet-stub.mjs`，不打印、不提交）给出唯一一张 `cloudcli.session-ask` 卡，指向夹具会话 `89dc5779-…`；该会话的 transcript 以「是否要经 SendMessage 向会话『摄像头与阻塞项驾驶舱』发送 browser_close…？」结束，observed object 预置为 `{ state:'skipped', reason:'未启用 observation.sessionDigest（提问决策摘要）' }`。
- 网关：workers 网关 `127.0.0.1:<打码>`，模型 `v4.1flash`（最便宜），密钥经既有 key 文件解析、未打印；调用次数由一次性计数透传代理（`tmp/dod-ask-refresh`，只转发与计数，不记录 header/body）读出。
- 阶段 A（设置关）：`/api/cockpit/cards` 卡片 `contentUnavailable = 「提问决策摘要未启用：未启用 observation.sessionDigest（提问决策摘要）」`，`ask`/`situation` 缺失，`options: []`；LLM 调用 **0** 次。
- 阶段 B（打开设置后第一次请求）：仍返回存储读数并启动后台重算；重算完成后再请求，卡片带出：
  - 问题：「是否要经 SendMessage 向会话『摄像头与阻塞项驾驶舱』发送 browser_close，以释放 MCP 浏览器 profile？」
  - 情境：「已检查 MCP 浏览器 profile：当前没有进程持有它，但会话『摄像头与阻塞项驾驶舱』还挂着一个 browser_close 的待办。」
  - 选项：`是`、`否`（`source=assistant`，均 `suggested=false`——原文没有推荐）。
  - LLM 调用 **1** 次；写回对象 `revision=2`、`provenance.producer=session-ask-decision-reader`、`tier=llm`，`askId=89dc5779-…:a-ask-1`，tokens 541/230。
- 阶段 C（再请求一次）：卡片内容不变，LLM 调用仍为 **1** 次（第二次请求不增加）。
- 浏览器（1440×900，真实构建页面 `/session/89dc5779-…`）：展开驾驶舱列、打开该卡 Details，CONVERSATION 区域显示 `Opened in the conversation on the left`（「已在左侧打开」标记），`cockpit-card-conversation-link` 计数 0；`pageerror` 为空。截图：`tmp/dod-ask-refresh/browser-opened-in-session.png`；完整读数：`tmp/dod-ask-refresh/dod-report.json`。⛔ 未点击任何确认按钮。
- 实例已 `scripts/isolated-instance.sh stop`（`ok:true`，`residual_scopes:""`，端口 7203 已关）。

暗轴记录（ADR-007）：

- L_D 该轴仍暗，理由：本次只修观察层读取时重算、是/否选项生成与驾驶舱左侧标记，不新增领域数据能力，没有可读出的领域读数。
- L_G 该轴仍暗，理由：改动不新增目标层能力；目标层判据仍由既有驾驶舱卡片/列用例承担。

## Touches

- tasks/gap-cockpit-ask-digest-refresh-yesno-options-and-left-marker.md
- server/modules/observation/session-ask-decision-reader.ts
- server/modules/observation/session-ask-decision-answer.ts
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

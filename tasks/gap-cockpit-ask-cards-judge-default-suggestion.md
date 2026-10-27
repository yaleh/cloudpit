---
id: gap-cockpit-ask-cards-judge-default-suggestion
title: 会话提问卡恢复缺省建议：助手没推荐时由 T1 摘要同一次调用的判官补一项（source=judge，附理由，○
  标记），已存的无缺省摘要读取时补算一次；controller 与卡片把 judge 来源同样作为缺省显示
status: todo
labels:
  - gap
  - defect
  - cockpit
parent: null
children: []
extra:
  schema: execution
goal_ac: AC-434
depends_on:
  - gap-cockpit-stuck-count-by-kind-and-ask-repair-silent-failure
---
## Proposal

来源：2026-10-28 用户在手机上发现每张会话提问卡的下拉都停在「Choose an option」，要多点几下、焦点来回移动才能确认，指出偏离原设计。

原设计（用户 2026-10-26 原话，见本会话记录）：「开发者最典型的行为应该是点击这个 suggestion」；「行是决策单元：类型标签、事项、推荐按钮、一句话理由…」；「列表中的信息应当能让我对问题和缺省的建议项/输入建立较完整的理解」；「主选项标题不直接提供确认按钮…为所有选项提供一个下拉列表」。效果图（`/data/home/yale/work/claudecodeui/tmp/cockpit-redesign/80-m-list-cards.png`、`150-pc-open.png`）里多数缺省项标着「suggested · ○ judge」。E1 报告（`experiments/cockpit-decision-judge/REPORT.md` 第 7 节）的建议是：缺省优先用助手自己的推荐，**判官只在助手没给推荐时补一条 source=judge 的建议**，不进入委托阶梯的自动档。

偏差：`observation-session-ask-decision-digest` 与 AC-424 实现时写成了「助手原文没有推荐时任何选项都不标 suggested」，丢掉了判官补位。线上 2026-10-28 01:36 读数：5 张有选项的提问卡，`suggested` 全部为 false（例如 a83c4cd4 那张「要现在晋升到 ready 让 worker 接手，还是我在这个会话里实现？」助手原文确实没说倾向）。按 E1 数据集粗算，历史提问只有约 44% 在结尾带推荐类措辞，所以过半的卡没有缺省。AC-423、AC-424 的 expect 与设计文档（`docs/architecture/cockpit-attention/INTERACTION-PRINCIPLES.md` 第 14 条、`CARD-PROVIDERS.md` 第 7 节；这两份文档尚未提交，规则以本任务正文为准）已于 2026-10-28 修订。

规则（本任务要实现的）：

- 每张会话提问卡都有一个缺省建议，来源按优先级：① 助手原文的推荐（`source=assistant`，● 标记）；② 助手没推荐时，判官从助手列出的选项（或是/否题的「是」「否」）里挑最可能的一项（`source=judge`，○ 标记，附一句理由）；③ 只有 `incomplete=true`（摘要不足以解释问题）时才不设缺省。
- 判官的选择在 T1 摘要的**同一次** LLM 调用里产出（提示里要求同时给出 judge 选择与理由），不另发调用；判官不得把自己的选择标成 assistant；助手有推荐时判官不得覆盖。
- 任何缺省都只是预选：卡片显示它的完整说明与来源标记，确认仍经确认卡，绝不自动执行。

做什么：

- `server/modules/observation/session-ask-decision-digest.ts`：提示与输出校验加上判官选择（选项 id + 理由）；按上面的优先级给恰好一项标 `suggested`；`source` 如实；输出缺少判官字段时按无判官处理（不报错）。
- 已存读数补算：`server/modules/observation/session-ask-decision-reader.ts` 读取时，对「已评估、有选项、`incomplete` 为 false、但没有任何 suggested」的旧读数补算一次（与「未启用」修复同一机制：每个 askId 一次、失败记住并给出原因、受 `maxPerHour` 约束）。
- 驾驶舱：`src/modules/cockpit/cockpitCardController.ts` 把任何 `suggested` 项（不论来源）作为缺省显示；`CockpitCard.tsx` 在缺省项上显示来源标记（● from assistant / ○ judge / provider），judge 来源同时显示那句理由。新增判据文件 `server/modules/observation/tests/session-ask-judge-default.test.ts`（AC-434）。

## AC

- [ ] `npx tsx --tsconfig server/tsconfig.json --test server/modules/observation/tests/session-ask-judge-default.test.ts` 退出 0（AC-434 判据）：LLM 客户端桩掉；覆盖助手有推荐 ⇒ 恰好一项 suggested 且 source=assistant；助手无推荐的多选项题 ⇒ 恰好一项 suggested 且 source=judge 且理由非空；是/否题无推荐 ⇒ 判官在「是」「否」中选一项；助手有推荐时判官不覆盖；`incomplete` ⇒ 无 suggested；每次摘要 LLM 桩调用次数为 1；旧的「无缺省」读数读取时补算一次、第二次读取不再调用。
- [ ] 假形态各自变红：判官选择标成 source=assistant ⇒ 用例红；助手有推荐时被判官覆盖 ⇒ 用例红；为判官另发一次 LLM 调用 ⇒ 用例红。改完即还原。
- [ ] `npx tsx --tsconfig server/tsconfig.json --test server/modules/observation/tests/session-ask-decision-digest.test.ts` 退出 0：按 2026-10-28 修订后的 AC-423 更新既有断言（删去「无推荐时任何选项都不标 suggested」，改为判官补位），其余用例不减。
- [ ] `npx vitest run src/modules/cockpit/tests/cockpitCardController.test.ts src/modules/cockpit/tests/CockpitCard.test.tsx` 退出 0：按修订后的 AC-424 新增用例——source=judge 的 suggested 项作为缺省显示并可直接确认（仍经确认卡）；缺省项显示来源标记，judge 来源显示理由；全无 suggested 时仍不显示缺省。
- [ ] `npx tsx --tsconfig server/tsconfig.json --test server/shared/tests/architecture-ratchet.test.ts` 退出 0；`npm run typecheck` 与 `npm run lint` 退出 0（lint 仅既有 warning）。

## DoD

用 workers 网关最便宜的模型（不打印密钥，网关主机打码）对本机会话库里 3 个以提问结束、助手原文**没有**推荐的真实会话各跑一次摘要，贴出问题、选项、被选为缺省的那一项（source=judge）与理由，以及每次的调用次数与 token 数；再找 1 个助手原文**有**推荐的会话，贴出缺省为 source=assistant。隔离实例（复制会话库，打开 `cockpit.fixtureCards` 与 `observation.sessionDigest`）里用 MCP 浏览器在 390 与 1440 宽度打开卡片页，截图显示提问卡的下拉已预选缺省项并带「○ judge」标记与理由，存 `tmp/`。⛔ 不在线上实例点击任何确认。实例用毕 `scripts/isolated-instance.sh stop`。

## Touches

- tasks/gap-cockpit-ask-cards-judge-default-suggestion.md
- server/modules/observation/session-ask-decision-digest.ts
- server/modules/observation/session-ask-decision-reader.ts
- server/modules/observation/tests/session-ask-judge-default.test.ts (new)
- server/modules/observation/tests/session-ask-decision-digest.test.ts
- server/shared/types.ts
- src/shared/types.ts
- src/shared/tests/cockpitCardTypeSync.test.ts
- src/modules/cockpit/cockpitCardController.ts
- src/modules/cockpit/CockpitCard.tsx
- src/modules/cockpit/cockpitCardDescriptors.ts
- src/modules/cockpit/tests/cockpitCardController.test.ts
- src/modules/cockpit/tests/CockpitCard.test.tsx
- server/shared/tests/quay-test-script.test.ts
- scripts/suite-duration-baseline.tsv
- server/shared/tests/architecture-ratchet.baseline.json

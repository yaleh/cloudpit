---
id: observation-session-ask-decision-digest
title: 观察层：会话提问的结构化决策摘要（问题重述、情境、选项与后果标签、助手推荐、incomplete），并经注入写入器发出
  session.asking 与 session.answered
status: ready
labels:
  - feature
  - cockpit
parent: null
children: []
extra:
  schema: execution
goal_ac: AC-423
---
## Proposal

来源：本会话 2026-10-26 量化，约三分之一的用户消息是在回答助手的提问，而驾驶舱看不到这些提问；实测观察层会话摘要 `conclusion` 只是上一条消息的逐字摘录（tier deterministic），没有情境，列表无法支持判断。设计稿 `docs/architecture/cockpit-attention/CARD-PROVIDERS.md` 第 2、4 节：会话在问什么、用户回答了没有是 CloudCLI 的事实；问题的情境与选项说明是 CloudCLI 的内容（T1 决策摘要）；等多久成为卡片、何时结束由 quay-fleet 判定。

做什么：

- 新文件 `server/modules/observation/session-ask-decision-digest.ts`：输入一个以助手提问结束的会话的近几轮转写，经注入的 LLM 客户端（复用 `session-digest-llm.ts` 的客户端形态与 `session-digest-llm-settings.ts` 的模型设置，不新建通道）产出 `{ askId, revision, ask, situation, options[{ id, label, does, tags[{kind,text}], suggested, source }], incomplete }`。规则：助手原文给出推荐时只有那一项 `suggested=true` 且 `source=assistant`；原文没有推荐时任何选项都不标 suggested；问题依赖的内容不在送入的近几轮里时 `incomplete=true` 且没有 suggested。输出经结构校验，校验失败按无摘要处理，不把原文末句冒充问题重述。
- 去重键（回应 quay-fleet 2026-10-27 的对齐意见）：`askId` 为会话 id 加该提问所在助手消息 id；同一会话在用户回答之前再次提问时沿用旧 askId 并递增 revision，不另开新卡。
- 事件：`server/modules/observation/session-digest.producer.ts` 在识别到提问时经注入的事件写入器发出一条 `session.asking`（sessionId、askId、revision、at），同一会话随后出现用户发言时发出一条 `session.answered`（sessionId、askId、at）。事件写入器以接口注入，测试用内存写入器。
- 摘要结果挂到现有会话 digest 上（新字段，旧字段不变），供后续驾驶舱的 ContentResolver 读取。

不做：3 分钟门槛、卡片生成与结束、通知，这些在 quay-fleet。不改 context 事件流的 schema（schema 归 fleet）。

## AC

- [ ] `npx tsx --tsconfig server/tsconfig.json --test server/modules/observation/tests/session-ask-decision-digest.test.ts` 退出 0（AC-423 判据）：夹具转写至少四份——助手给出推荐的提问、没有推荐的提问、依赖上文缺失的提问、同一会话未回答前再次提问；LLM 客户端桩掉；断言摘要字段、suggested 规则、incomplete 规则、再次提问沿用 askId 且 revision 递增；以内存写入器断言 `session.asking` 恰好一条、用户发言后 `session.answered` 恰好一条。
- [ ] 假形态各自变红：让摘要在桩返回无效结构时退回原文末句当问题重述 ⇒ 用例红；在助手没有推荐时补一个 suggested ⇒ 用例红；再次提问时新开 askId ⇒ 用例红。每个假形态改完即还原。
- [ ] 现有观察层判据不退：`npx tsx --tsconfig server/tsconfig.json --test server/modules/observation/tests/session-digest.test.ts` 退出 0（若该文件名不同，以 `ls server/modules/observation/tests` 中会话 digest 的测试文件为准并在完成记录写明）。
- [ ] `npx tsx --tsconfig server/tsconfig.json --test server/shared/tests/server-import-cycle-budget.test.ts` 退出 0。
- [ ] `npm run typecheck` 与 `npm run lint` 退出 0（lint 仅既有 warning）。

## DoD

用 workers 网关的最便宜模型（不打印密钥，网关主机打码）对本机真实会话库里三个以提问结束的真实会话各跑一次摘要，贴出三份输出与对应助手原文末段，人工对照：问题重述不是原文照抄、推荐只在原文有推荐时出现、缺上下文时 incomplete 为 true。贴出这三次调用的输入与输出 token 数。

事件：在隔离实例里用内存写入器替换真实写入器跑一次「提问然后回答」，贴出两条事件原文。真实写入 context 事件流需要 quay-fleet 在 schema 里加入 session.asking 与 session.answered 两个 kind，本任务只交付注入点与内存写入器的读数，真实写入在 schema 落定后接上（待外部）

## Touches

- tasks/observation-session-ask-decision-digest.md
- server/modules/observation/session-ask-decision-digest.ts (new)
- server/modules/observation/session-digest.producer.ts
- server/modules/observation/session-digest.ts
- server/modules/observation/index.ts
- server/modules/observation/tests/session-ask-decision-digest.test.ts (new)
- server/shared/types.ts
- server/shared/interfaces.ts
- server/shared/tests/server-import-cycle-budget.test.ts
- server/shared/tests/quay-test-script.test.ts
- scripts/suite-duration-baseline.tsv

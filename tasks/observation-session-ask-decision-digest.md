---
id: observation-session-ask-decision-digest
title: 观察层：会话提问的结构化决策摘要（问题重述、情境、选项与后果标签、助手推荐、incomplete），并经注入写入器发出
  session.asking 与 session.answered
status: done
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

- 新文件 `server/modules/observation/session-ask-decision-digest.ts`：输入一个以助手提问结束的会话的近几轮转写，经注入的 LLM 客户端（复用 `session-digest-llm.ts` 的客户端形态与 `session-digest-llm-settings.ts` 的模型设置，不新建通道）产出 `{ askId, revision, ask, situation, options[{ id, label, does, tags[{kind,text}], suggested, source }], incomplete }`。规则：助手原文给出推荐时只有那一项 `suggested=true` 且 `source=assistant`；原文没有推荐时任何选项都不标 suggested；问题依赖的内容不在送入的近几轮里时 `incomplete=true` 且没有 suggested。输出经结构校验，校验失败按无摘要处理，不把原文末句冒充问题重述。问题以转写里最后一条助手消息为准，不取观察层 digest 的 `askingYou` 摘录（2026-10-27 简报实验 E2 实测该摘录可能落后一轮，8 条里有 2 条因此问错了问题）。
- 去重键（与 quay-fleet 2026-10-27 对齐的 schema 草稿一致）：`askId` 形如 `<sessionId>:<assistantMessageId>`，取该会话自上次用户发言以来第一条提问所在的助手消息 id；用户回答之前再次提问时沿用这个 askId、revision 递增、事件的 `messageId` 换成新提问的消息 id，不另开新卡。
- 事件：`server/modules/observation/session-digest.producer.ts` 在识别到提问时经注入的事件写入器发出一条 `session.asking`（顶层 session、project、at、refs 为助手消息 id；data 含 askId、messageId、revision 与 `contentRef { resolver: cloudcli.session-ask, sessionId, messageId }`），同一会话随后出现用户发言时发出一条 `session.answered`（顶层 session、at；data 含 askId 与用户消息 id）。事件写入器以接口注入，测试用内存写入器。
- 摘要结果挂到现有会话 digest 上（新字段，旧字段不变），供后续驾驶舱的 ContentResolver 读取。

不做：3 分钟门槛、卡片生成与结束、通知，这些在 quay-fleet。不改 context 事件流的 schema（schema 归 fleet）。

## AC

- [x] `npx tsx --tsconfig server/tsconfig.json --test server/modules/observation/tests/session-ask-decision-digest.test.ts` 退出 0（AC-423 判据）：夹具转写至少五份——助手给出推荐的提问、没有推荐的提问、依赖上文缺失的提问、同一会话未回答前再次提问、digest 的 askingYou 摘录落后一轮的会话（摘要的问题重述必须对应最后一条助手消息）；LLM 客户端桩掉；断言摘要字段、suggested 规则、incomplete 规则、再次提问沿用 askId 且 revision 递增；以内存写入器断言 `session.asking` 恰好一条、用户发言后 `session.answered` 恰好一条。
- [x] 假形态各自变红：让摘要在桩返回无效结构时退回原文末句当问题重述 ⇒ 用例红；在助手没有推荐时补一个 suggested ⇒ 用例红；再次提问时新开 askId ⇒ 用例红。每个假形态改完即还原。
- [x] 现有观察层判据不退：`npx tsx --tsconfig server/tsconfig.json --test server/modules/observation/tests/session-digest.test.ts` 退出 0（若该文件名不同，以 `ls server/modules/observation/tests` 中会话 digest 的测试文件为准并在完成记录写明）。
- [x] `npx tsx --tsconfig server/tsconfig.json --test server/shared/tests/server-import-cycle-budget.test.ts` 退出 0。
- [x] `npm run typecheck` 与 `npm run lint` 退出 0（lint 仅既有 warning）。

## DoD

用 workers 网关的最便宜模型（不打印密钥，网关主机打码）对本机真实会话库里三个以提问结束的真实会话各跑一次摘要，贴出三份输出与对应助手原文末段，人工对照：问题重述不是原文照抄、推荐只在原文有推荐时出现、缺上下文时 incomplete 为 true。贴出这三次调用的输入与输出 token 数。

事件：在隔离实例里用内存写入器替换真实写入器跑一次「提问然后回答」，贴出两条事件原文。真实写入 context 事件流需要 quay-fleet 在 schema 里加入 session.asking 与 session.answered 两个 kind，本任务只交付注入点与内存写入器的读数，真实写入在 schema 落定后接上（待外部）

## 完成记录（2026-10-27）

### AC 读数

- 新判据：`npx tsx --tsconfig server/tsconfig.json --test server/modules/observation/tests/session-ask-decision-digest.test.ts` → tests 8 / pass 8 / fail 0，退出 0。
- 现有观察层判据文件即 `server/modules/observation/tests/session-digest.test.ts`（AC 里假设的文件名成立）→ tests 10 / pass 10 / fail 0。
- `server/shared/tests/server-import-cycle-budget.test.ts` → tests 11 / pass 11 / fail 0。
- 连带自检（本任务改到的相邻文件）：`server/modules/observation/tests/session-digest-llm.test.ts` → 9/9；`server/shared/tests/quay-test-script.test.ts` → 14/14（新增测试文件把收集数从 452 抬到 453，两处 pin 与一处描述同步改）；`scripts/suite-duration-baseline.tsv` 增加 3405ms 一行。
- `npm run typecheck` 退出 0；`npm run lint` 退出 0，改动文件无新增 warning。

### 假形态（各改一次、跑完即用 cp 备份逐字节还原，最终 8/8）

1. 无效结构退回原文末句：`session-ask-decision-digest.ts` 的解析 catch 改成 `state:'evaluated'` 且 `ask` 取原文末句 ⇒ `AC-423: malformed model output yields no digest and never echoes the last sentence` 红（1 fail / 7 pass）。还原后 `cmp` 与备份相同。
2. 原文无推荐也补 suggested：`session-ask-decision-answer.ts` 的 `buildAskDecision` 去掉 `RECOMMENDATION_CUE` 判断 ⇒ `AC-423: no recommendation cue in the original means no option is suggested` 红（1 fail）。
3. 再次提问新开 askId：`readSessionAsk` 的 askId 改用最后一条助手消息 id、revision 固定 1 ⇒ `AC-423: the question comes from the last assistant message, not the stored askingYou` 与 `AC-423: re-asking before the answer keeps askId and increments revision` 红（2 fail）。

### DoD：真实会话的三次摘要（workers 网关最便宜模型，主机打码）

探针 `tmp/ask-dod-probe.mts`（gitignored）直读 `/data/home/yale/.cloudcli/auth.db`，扫描最近 400 个未归档会话，命中 33 个以提问结束的会话；取三条形态各异的真实会话，经 `session-digest-llm-settings.ts` 读取网关设置（`gateway=http://127.***:26510/`，主机前四位后打码，密钥不打印），模型 `v4.1flash`，`maxOutputTokens=900`（网关默认 400 会截断多选项 JSON；探针里显式抬高并在注释里说明）。

case 1 · `quay-fleet outbox 待决事项`（askId `1d38c52e-a5d4-4e91-abb9-4c6b4286de9f:baf17ff2-07ec-4771-a68c-d72ee088aa66`，revision 1，原文有推荐语气：true，verbatim-equals-last-message: **false**，tokens input=187 output=416）

助手原文末段：
```
两点待你定夺：

1. **是否现在立 c1 / c2 两条 task**（用 quay-fleet 自己的 quay CLI，todo 态，先给草稿再写）。对端说「我们的 K2 fleet adapter 只在你们读口定下后才立」，所以这两条是你这边要落的。
2. c1 里那个新动词，你更想要 `cockpit cards --json` 独立动词，还是并入现有 `snapshot --json`？

你点头我就起草 task 正文给你过目。
```

摘要输出（节选为原 JSON 的所有决策字段）：
```json
{
  "state": "evaluated",
  "ask": "是否现在立 c1 / c2 两条 task（用 quay-fleet 自己的 quay CLI，todo 态，先给草稿再写），以及 c1 里那个新动词你更想要 `cockpit cards --json` 独立动词，还是并入现有 `snapshot --json`？",
  "situation": "与「摄像头与阻塞项驾驶舱」的 (c)1/(c)2 schema 对齐已收敛，对端确认了两点并请固化为可提交版本；当前定稿尚未写盘、尚未立 task。对端 K2 fleet adapter 要等 fleet 读口定下后才立，所以 c1/c2 两条 task 需由本侧落地。",
  "options": [
    { "id": "c1-c2-tasks", "label": "现在立 c1 / c2 两条 task", "does": "用 quay-fleet 自己的 quay CLI 以 todo 态立两条 task，先给草稿再写", "tags": [{ "kind": "consequence", "text": "fleet 侧读口与事件 schema 进入落地流程，对端 K2 fleet adapter 可随后跟进" }], "suggested": false, "source": "assistant" },
    { "id": "cockpit-cards-verb", "label": "`cockpit cards --json` 独立动词", "does": "为 cockpit cards 新增独立读口动词，支持 --project/--state/--include-resolved --since 等参数", "tags": [{ "kind": "consequence", "text": "读口与现有 snapshot 分离，参数与语义独立演进" }], "suggested": false, "source": "assistant" },
    { "id": "snapshot-merge", "label": "并入现有 `snapshot --json`", "does": "不新增动词，把 cockpit cards 的读口能力并入现有 snapshot --json", "tags": [{ "kind": "consequence", "text": "复用现有动词，但需在 snapshot 上扩展参数与输出形状" }], "suggested": false, "source": "assistant" }
  ],
  "incomplete": false,
  "inputTokens": 187,
  "outputTokens": 416
}
```
人工对照：问题被重述（不是照抄），两项要用户定夺的事都进了 options；原文虽有推荐语气但没有明确推荐某一项，因此没有任何 `suggested=true`。

case 2 · `摄像头与阻塞项驾驶舱`（askId `8d8a6d0d-e1a7-45e1-bf52-b970c4d6f732:b7e73de6-70fc-4dba-9dc6-2be68a6cbd3e`，revision 1，原文有推荐语气：false，verbatim: **false**，tokens input=234 output=571）

助手原文末段：
```
Three decisions are still yours:

1. **Blind rating:** in at least 4 of the 6 comparisons, would the briefing make you take its suggestion? The comparisons are `tmp/cockpit-redesign/e2-compare-{2,3,4,5,9,11}.png`; don't open the answer key until you've rated.
2. **Productising briefings:** should I file the single-call version as a second-batch task after K3? The proposed caps are 30k tokens per brief and 0.5M a day.
3. **Fleet notice:** should I send fleet the E1 conclusion now? It says rescue automation should rest on mechanical signals, and your recorded choices are data for later, not grounds for automatic answers.
```

摘要输出：
```json
{
  "state": "evaluated",
  "ask": "在 6 组对比中，是否至少有 4 组的简报会让你采纳它的建议（先盲评 tmp/cockpit-redesign/e2-compare-{2,3,4,5,9,11}.png，评分前不要打开答案键）？另外，是否要把单次调用版本作为 K3 之后的第二批任务立项（每份简报上限 30k tokens、每天 0.5M）？以及是否现在就向 fleet 发送 E1 结论？",
  "situation": "E2 简报可行性实验已结束，报告已保存，检查器 18/18 通过。E2 发现：单次网关调用 8/8 通过检查器、中位 11 秒、每份约 13k tokens、25% 论断有证据支撑；短 Claude Code 会话 6/8 通过（未达 10/12 门槛）、中位 35 秒、每份约 147k tokens（11 倍）、62% 有证据支撑，共花掉 2M 预算中的 1.70M。两种方式都没画出自由图形，暂用预设图表即可。E2 还发现摘要的问题摘录可能滞后一轮，已给 K3 加规则：摘要始终用最后一条助手消息，不用摘录；K3 仍处于就绪、未开始状态。E2 子代理已完全停止，无新结果。",
  "options": [
    { "id": "1", "label": "Blind rating", "does": "你盲评 6 组对比图，判断其中至少 4 组是否会让你采纳简报建议；评分前不打开答案键。", "tags": [{ "kind": "cost", "text": "需要你人工逐张查看并评分 6 组对比图" }], "suggested": false, "source": "assistant" },
    { "id": "2", "label": "Productising briefings", "does": "把单次调用版本作为 K3 之后的第二批任务立项，拟定上限为每份简报 30k tokens、每天 0.5M。", "tags": [{ "kind": "consequence", "text": "单次调用版本进入后续批次排期，并受每份 30k tokens、每天 0.5M 的额度约束" }], "suggested": false, "source": "assistant" },
    { "id": "3", "label": "Fleet notice", "does": "现在就向 fleet 发送 E1 结论：救援自动化应基于机械信号，你记录的选择只是后续参考数据，不构成自动回答的依据。", "tags": [{ "kind": "consequence", "text": "fleet 立即收到 E1 结论，并据此把救援自动化建立在机械信号上" }], "suggested": false, "source": "assistant" }
  ],
  "incomplete": false,
  "inputTokens": 234,
  "outputTokens": 571
}
```
人工对照：三条编号决策各成一条 option；原文没有推荐，三个 `suggested` 全为 false；问题重述保留了「评分前不打开答案键」这类限定条件。

case 3 · `Architecture 标签页 package/class 框空白`（askId `402949d9-d723-432c-8203-6613e192397b:9e53d222-4a49-4ad4-9d3f-72ada20bd35e`，revision 1，原文有推荐语气：false，verbatim: **false**，tokens input=157 output=182）

助手原文末段：
```
**文档那张任务的重叠：** 你之前那个会话已经立了 `gap-module-standards-inheritance-polymorphism-reuse`，状态 ready、AC 已勾，要点名 `IProviderShell`、`PROVIDER_DESCRIPTORS` 等已落地的正例。我昨天提交的标准文本（`b7c45e2b0`）是它的子集，它的 worker 会在此基础上扩写，不是冲突。我没有为此再立新单。

我没有改动任何代码；这些任务由 worker 执行。
```

摘要输出：
```json
{
  "state": "evaluated",
  "ask": "是否确认按当前方案执行：方向 1、2 各 4 张切片串行排队，方向 4 的 clamp/CSS 像素解析小工具任务依赖已有的 gap-shared-utils-small-helpers-dedup，方向 3 不动，且不再为文档重叠另立新单？",
  "situation": "用户此前要求 1、2、4 都立、按切片分批、3 先不动、文档改动不用跑测试。助手已把三个方向共 9 张任务立好，每张四件套经 task_check 校验，前两个切片已被 promotion-driver 自动晋升为 ready，其余按依赖链排队；助手未改动任何代码，任务由 worker 执行。",
  "options": [],
  "incomplete": false,
  "inputTokens": 157,
  "outputTokens": 182
}
```
人工对照：这条是确认式提问，助手原文没有列出可选项，`options` 为空数组（不是编造选项）；重述把「不再为文档重叠另立新单」等限定保留下来；原文无推荐，因此无 suggested。

token 读数说明：以上三次的 input/output 是网关返回的 usage 字段，原样贴出；同一会话在两次运行间该字段抖动很大（case 1 另一次读到 input=2603），属于网关 usage 读数而非摘要自身的估算，记录两次实测值。

### 事件：提问然后回答

探针 `tmp/ask-events-probe.mts` 用**真实**的 `createSessionDigestProducer` + `readSessionAsk` + `createSessionAskDecisionDigest`（LLM 用桩），商店与事件写入器为内存实现；两次 turn-end 之间用户回答。输出：

```
events=2
{"kind":"session.asking","session":"probe-session","project":"/repo/project","at":"2027-01-15T08:00:00.000Z","refs":["a1"],"data":{"askId":"probe-session:a1","messageId":"a1","revision":1,"contentRef":{"resolver":"cloudcli.session-ask","sessionId":"probe-session","messageId":"a1"}}}
{"kind":"session.answered","session":"probe-session","project":"/repo/project","at":"2027-01-15T08:01:00.000Z","data":{"askId":"probe-session:a1","messageId":"u2"}}
```

两条事件各恰好一条（每轮 turn-end 重复调用两次也不重复发）；`session.answered` 的 askId 指回被回答的那一问。生产组合 `session-digest-llm.ts` 里 `eventWriter` 暂不绑定（真实写入 context 事件流需要 quay-fleet 在 schema 里加入这两个 kind，待外部），隔离实例因此只交付注入点与内存写入器读数。

### 架构暗轴（ADR-007）

该轴仍暗,理由:本任务只在观察层内部新增叶子模块并复用 shared 类型，未产生 L_D/L_G 架构图读数。

### 第二轮（2026-10-27，续跑）：suite 红的真实原因与本轮修复

上一轮 fan-in suite 红在 `server/shared/tests/architecture-ratchet.test.ts` 的两条读数，两条都是本任务自己的 delta（该测试文件虽不在 delta 里，读的却是 delta 里的文件）：

1. `oversizeFiles server/shared/types.ts 4749→4821`：本任务新增的 72 行 ask/decision wire 词汇（`SessionAskDecisionOption`、`SessionAskDecision`、`SessionAskDecisionReading`、`SessionAskEventKind`、`SessionAskEvent`）被 4 个观察层文件与 `ISessionAskEventWriter` 注入面共用；按后端模块标准「两处以上使用的类型放 `server/shared/types.ts`」，它们就该在这里，不另建模块承载。已按基线文件自带的 RECORDED CHANGE 格式把该条上调为 4821 并在 note 里写明理由（同一行前一天已由 cockpit 卡片契约为同类原因上调 4629→4749）。
2. `moduleMutableState server/modules/observation/session-ask-decision-answer.ts 基线外→1`：`OPTION_SOURCES` 原为模块级 `new Set(...)`，被 ratchet 计为模块级可变状态（基线外文件必须为 0）。改为 `readonly` 数组 + `includes`，语义不变（仍然只校验选项来源落在 assistant/judge/provider 三项内）。

本轮复跑读数（worktree 内，合并 develop 之后）：`architecture-ratchet.test.ts` → tests 6 / pass 6 / fail 0；`session-ask-decision-digest.test.ts` 8/8；`session-digest.test.ts` 10/10；`session-digest-llm.test.ts` 9/9；`server-import-cycle-budget.test.ts` 11/11；`quay-test-script.test.ts` 14/14；`npm run typecheck` 退出 0；`npm run lint` 退出 0（改动文件无 warning）。合并 develop 无冲突。

## Touches

- tasks/observation-session-ask-decision-digest.md
- server/modules/observation/session-ask-decision-digest.ts (new)
- server/modules/observation/session-ask-decision-answer.ts (new)
- server/modules/observation/tests/session-ask-decision-digest.test.ts (new)
- server/modules/observation/session-digest.producer.ts
- server/modules/observation/session-digest.ts
- server/modules/observation/session-digest-llm.ts
- server/modules/observation/index.ts
- server/shared/types.ts
- server/shared/interfaces.ts
- server/shared/tests/architecture-ratchet.baseline.json
- server/shared/tests/server-import-cycle-budget.test.ts
- server/shared/tests/quay-test-script.test.ts
- scripts/suite-duration-baseline.tsv

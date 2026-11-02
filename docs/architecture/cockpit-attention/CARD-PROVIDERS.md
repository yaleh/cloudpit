# 驾驶舱的封装与卡片提供方（设计稿）

| 项 | 值 |
|---|---|
| 状态 | 设计稿（未实施），契约 v0 草案，与 quay-fleet 第一轮对齐见第 7 节 |
| 日期 | 2026-10-27 |
| 关系 | 交互模型见 `INTERACTION-PRINCIPLES.md`；注意力流水线见 `README.md`；规范依据 `.agents/skills/backend-module-standards`、`frontend-module-standards` |

## 1. 三条原则（用户 2026-10-27 确定）

1. **驾驶舱在本项目内是一个封装好的功能。** 界面、交互、确认流程、执行通道都在驾驶舱模块里，其它模块只经它的 barrel 使用它。
2. **项目开发的语义尽量由 quay-fleet 提供。** 什么算卡死、什么算救援、一个提问等多久才算「在等你」、什么时候该发系统通知、事项何时结束——这些判断在 fleet，不在 Cloudpit。Cloudpit 只提供**事实**（会话在问什么、用户回答了没有）和**内容**（问题的情境与选项说明）。
3. **将来可能接入别的卡片提供方。** 驾驶舱对提供方一无所知，只认契约；加一个提供方 = 写一个实现 + 注册一行，不改驾驶舱的任何调用处。

## 2. 分层

```
 提供方（语义）                 Cloudpit 驾驶舱（封装）                         界面
┌──────────────────┐      ┌──────────────────────────────────────────┐   ┌─────────────────┐
│ quay-fleet       │─────▶│ CardProvider 注册表   ─▶ 卡片投影（排序、过滤 │──▶│ PC 右侧列        │
│  （卡死/救援/    │      │                          由提供方字段决定）  │   │ 手机驾驶舱页     │
│   等待/通知/结束）│      │ ContentResolver 注册表 ─▶ 补全卡片内容       │   │ header 计数按钮  │
│ 未来的提供方 …   │      │ ActionExecutor 注册表  ◀─ 确认后执行一次     │   └─────────────────┘
└──────────────────┘      └──────────────────────────────────────────┘
          ▲                         │ 事实：session.asking / session.answered / 决策记录
          └─────────────────────────┘ （经主机级 context 事件流，现有机制）
```

- **CardProvider**（能力接口，类实现）：列出卡片、订阅变化、接收决策反馈、声明自己提供的执行器。
- **ContentResolver**：提供方的卡片可以只带一个内容引用（例如 `cloudcli.session-ask`），由 Cloudpit 本地补全问题、情境和选项说明（T1 决策摘要）。语义在提供方，内容在本地。
- **ActionExecutor**：每个选项绑定一个执行器 id 和参数。Cloudpit 自带 `session.send`（经 hub 的确认卡发给会话）和 `session.start`（在左侧开新会话并立即切过去）；提供方可以声明自己的执行器（例如 fleet 的 ack、任务处置）。
- 系统通知：发不发由提供方在卡片上声明，Cloudpit 只负责经现有 Web Push 通道送达。

## 3. 卡片契约 v0（草案）

```
CockpitCard {
  id                 提供方内稳定
  provider           提供方 id
  revision           每次内容或状态变化 +1（原位升级、不跳焦点）
  kind               开放字符串；已知：ask · multi · need · stuck · fix · decision（渲染方式查表，不分支）
  group, rank        分组（rescue / ruling …）与组内次序——**排序完全由提供方决定**
  state              open · resolved · expired（结束由提供方判定）
  waitingSince, surfacedAt
  subject            { project?, sessionId?, taskId?, uri }
  contentRef?        { resolver, … }   ← 本地补全时使用
  ask, situation     （或由 contentRef 补全）
  facts[]            { text, mechanical: boolean, ref?, observedAt? }
  viz?               固定词汇：attempts · steps · history · size · parts（数据，不是代码）
  options[]          { id, label, does, why?, warn?, tags[{kind,text}], undo?, when?,
                       suggested: boolean, source: assistant | judge | provider,
                       action: { executor, params } }
  ownReply?          { executor, params }   ← 「自己的回复」走的执行器
  conversation?      { sessionId } | { startIn: { project } }
  notify?            { system: boolean, reason }   ← 由提供方决定
  load?              0 | 1 | 2
}
```

线上类型同时在 server 与 src 两侧使用：按前端规范，放进共享类型并加 TypeSync 判据（读两侧、任一侧变化即红）。

## 4. 模块边界

**后端**
- `server/modules/cockpit/`：注册表、卡片投影、执行通道、路由（路由保持薄）。
- 提供方适配器各自一个实现类，**实现 `ICockpitCardProvider`**（接口放 `server/shared/interfaces.ts`）；fleet 适配器读 fleet 的读口，不写 fleet 的文件。
- 「会话在问你」的事实与内容由观察层产出（T1 决策摘要），经 context 事件流发给 fleet；驾驶舱模块不直接解析转写。
- 新增的叶子目录同时登记 AC-394 的导入环清单与钉子。

**前端**
- `src/modules/cockpit/` 一个模块，对外只导出：PC 右侧列、手机驾驶舱页、header 驾驶舱按钮。
- 选中、过滤、密度、Details 栈、焦点归属、确认流程都在 `createCockpitController(deps)` 里（React 之外），hook 只是绑定。
- 卡片类型、小可视化的渲染查描述表，不按提供方或类型分支。
- 会话页（project-workspace）只经驾驶舱 barrel 挂载右侧列和 header 按钮。

## 5. 需要 quay-fleet 提供的（待对齐）

1. **卡片读口**：按契约输出卡片（或可无损投影成卡片的注意力条目），带 revision 与 state。
2. **会话提问规则**：消费 Cloudpit 的 `session.asking` / `session.answered` 事件；等待满 **3 分钟**（用户 2026-10-27 确定）才成为卡片；用户在会话里回答后结束卡片。
3. **救援语义**：卡死、需人工、阻塞已修复后的重派建议，以及对应的处置动作（挂起、重派、停放、登记）。
4. **通知策略**：哪些卡片发系统通知（用户 2026-10-27：由 quay-fleet 决定）。
5. **反馈入口**：用户的选择与自己的回复写回为决策记录（委托阶梯与判官的数据来源）。

## 6. 本项目在对齐之前就能做的

- 契约类型、注册表、执行通道、驾驶舱界面，全部可以先用**测试用的夹具提供方**驱动；fleet 适配器在读口确定后再接。
- 观察层的 T1 决策摘要与 `session.asking` / `session.answered` 事件，本身就是 Cloudpit 的事实与内容，可以先做。

## 7. 与 quay-fleet 的对齐记录（2026-10-27 第一轮）

已一致：
- `revision` 只在内容或状态变化时 +1，提醒类时间刷新不 +1，随内容持久化；确认带 revision，过期返回冲突。
- 卡片 `state` 三态；fleet 的 surfaced / acked 都投影为 open；`ack` 是执行器动作，不是状态。
- 3 分钟门槛与会话提问语义都在 fleet：不满 3 分钟不投影；`waitingSince = session.asking.at`；过期时长由 fleet 定。
- `contentRef.resolver` 与执行器 id 是声明集；`options[].source` 冻结为 assistant | judge | provider；`notify.reason` 取 fleet 规则 id。
- `load` 从 v0 去掉。
- 会话提问去重：`askId` = 会话 id + 提问所在助手消息 id；用户回答前再次提问沿用 askId、revision +1。
- Cloudpit 以握手 `contracts.contextEvents` 的版本校验自己的写；新 kind 在 fleet bump schema 后才写。
- 读口需支持 `--include-resolved --since`（已处理折叠与撤销的来源）；反馈经 fleet 动词，不写文件。

第二轮（同日）：
- `conversation.startIn` 取 subject 的 projectId；fleet 的条目都带 projectId，session-ask 取 `session.asking` 顶层 project。没有 projectId 的只有 fleet 自身级的少数条目，这类只给 Details。
- `kind` 由 category 映射得出，映射表在 fleet 代码里；契约只冻结 kind 是开放字符串。参考表：session-ask→ask · worker-stall→stuck · worker-fail-repeated→fix · needs-human→need · initiative-decision→decision。group 由 grade 得出：escalate→rescue · notify→ruling。
- context 事件 schema 0→1，加 `session.asking` 和 `session.answered`（producer=cloudcli）。asking 的顶层是 session、project、refs；data 含 askId=`<sessionId>:<assistantMessageId>`、messageId，以及 `contentRef{resolver: cloudcli.session-ask}`，v0 不带 summary。answered 的 data 含 askId。fleet 的 dedupKey 用 `<projectId>|session-ask|<askId>`。
- fleet 读口是 `quay-fleet cockpit cards --json [--project] [--state] [--include-resolved --since]`，每行一张 CockpitCard。`ownerSession` 预留，v0 恒为 null。
- fleet 侧的任务要等 fleet 会话的用户同意后才立。

第三轮（同日，E1 之后）：
- 会话提问只作建议、永不自动执行；缺省选项优先 source=assistant，助手没推荐时由判官补一项（source=judge，附理由）——每张提问卡都应有缺省建议（2026-10-28 修正，见 INTERACTION-PRINCIPLES 第 14 条）。提供方自己的卡（救援、需要人、需决定）由提供方给出 suggested。反馈记录是先例数据。
- 救援的第一个自动候选是机械判定的「可重派」，有两个信号：(a) 阻塞项任务已落地，fleet 现在就能给；(b) develop 上对应的红已消失，由 quay driver 新写的 `.quay/develop-red-set.json` 提供，fleet 只读。该文件的键是「测试文件::测试名」，不用断言正文，避免数字一变就误判为红已消失。LLM 只解释原因。

仍待定：
- 多人类 / 多机器时卡片归谁（ownerSession）：v0 按单一人类处理。

## 8. 知识建议卡与可信决定（契约扩展，2026-11-01）

知识建议复用**同一条** provider / 确认 / 反馈通道，不新增动作通道。扩展只在契约的开放位上：

- `kind` 仍是开放字符串，知识卡用 `'knowledge'`；**不加入 `CockpitCardKind` 联合**，否则按 kind 查表的 `DESCRIPTORS` 会在编译期缺项。渲染仍走查表 + `knowledge` 块，不分提供方分支。
- `CockpitCard.knowledge?: CockpitKnowledgeCase`：`caseId`、`knowledgeRevision`、`proposalRevision`、`state`（pending / executing / verifying / reported / blocked / unknown）、可选 `plan`、`progress`、`executionId`、`verification {state, summary, at?}`、`nextCheckAt`、`originSessionId`/`originUri`、`factsFingerprint`，以及**仅由服务端签发**的 `confirmationRef`。
- `options[].decision?: apply | modify | defer | not-applicable` 与 `options[].plan?`。选择某个选项即声明该决定；不在词汇内的 `decision` 被投影丢弃，确认通道随后按“缺少证据”拒绝，而不是猜一个默认值。
- `group` 由提供方给出：知识建议通常落在 `ruling`；投影不得把信息类 `notify` 改写成救援组。

### 8.1 可信确认

读卡片列表时由 `cockpit-knowledge-decision.ts` 的服务端权威为每张可读知识卡签发引用：

```
kc1.<base64url(payload)>.<base64url(HMAC-SHA256(payload))>
payload = ['knowledge-confirmation/v1', provider, cardId, revision,
           caseId, knowledgeRevision, proposalRevision, factsFingerprint ?? '',
           [[optionId, decision], …按 optionId 排序]]
```

- 确认体必须携带该引用；`by` / `confirmedBy` / `confirmedByUser` / `actor` 这类**调用者自述身份一律拒绝**（`CALLER_ATTESTATION_REJECTED`），身份证明只能是服务端签发的引用。
- 签名正确但绑定已变化 ⇒ `STALE_CONFIRMATION`（409）；若此时卡片 `revision` 也已前进，动作通道先让提供方刷新取数，再以 `REVISION_CONFLICT` + `details.currentRevision` 回答当前修订，执行器不运行。前端在 `REVISION_CONFLICT` 后重新读取，保证屏幕上的卡与服务器一致。
- 需要执行计划的决定（apply / modify）缺少完整 `plan` ⇒ `KNOWLEDGE_PLAN_MISSING`；知识卡缺少可读 case 证据 ⇒ `KNOWLEDGE_EVIDENCE_MISSING`；未声明执行器 ⇒ `EXECUTOR_NOT_DECLARED`。
- 反馈的 `feedbackId` 由绑定内容派生（`kf-` + SHA-256 前 32 位），所以**同一决定的重复提交与重发复用同一个幂等键**；`(provider, cardId, revision)` 的已接受台账保证一次确认至多一次执行。

### 8.2 交接 ≠ 执行

反馈回执只证明“已交接给提供方”。`progress`、`state`、`verification` 全部来自提供方的后续读数；cockpit 不根据回执推断执行结果，也不写 `verification`。反馈 overlay 持久化 `confirmationRef` / `decision` / `knowledgeCaseId`，下次读卡片时可回读整条可信链；`feedback` 对象里没有核验字段，避免把“已发送”冒充“已核验”。

### 8.3 跨项目状态

契约来源 `quay-fleet/fleet-knowledge-cockpit-proposals` 与 `docs/specs/knowledge-application-contract.md` 在本任务实现时**尚未交付**：安装的 `quay-fleet` 不声明知识执行器、读口不输出 `knowledge` 块。因此本任务只按正文冻结的字段做**兼容投影**，未假设真实能力可用；验证使用符合契约的替身提供方（`QUAY_FLEET_BIN` 指向本地脚本），并把这一限制写入 `docs/evidence/cockpit-knowledge-decision-handoff.md`。

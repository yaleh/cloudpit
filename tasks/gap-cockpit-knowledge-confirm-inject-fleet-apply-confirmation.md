---
id: gap-cockpit-knowledge-confirm-inject-fleet-apply-confirmation
title: cockpit confirm 对知识卡注入 confirmation 给 fleet.apply（可信决定执行，而非只进反馈回执）
status: ready
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

**结论：知识卡 confirm 时，`fleet.apply` 动作执行器拿到的 `action.params` 里必须注入 fleet 要的 `confirmation`，而不是只把 knowledge 字段塞进第二次 `deliverFeedback` 回执。**

### 现状（已核实 file:line）

- `server/modules/cockpit/cockpit-card-actions.ts:561`：`result = await executor.execute(action.params)` —— 动作执行器收到的是 `action.params` **原文**，没有 confirmation。
- 同文件 `:492-522`：知识卡已算出 `knowledge = deps.knowledge.confirm(...)`（含 `ref`、`feedback`、`caseId`、`decision`、`plan`），但只在下文 `:576-591` `deliverFeedback({ ...knowledge })` 里把 `knowledge.feedback` 拼进**第二次**回执调用（`fleet.feedback`）。
- fleet 侧：`fleet.apply`（quay-fleet `rescue.ts` `EXECUTOR_IDS.apply`）是「可信决定 → 执行 → 核验」入口，`confirmationShapeRefusals`（quay-fleet `src/knowledge-execution.ts:798`）要求 `confirmation = { actorKind:'human', decisionRef:<非空>, at:<ISO-8601 UTC>, binding:<object> }`，且 `binding` 至少带 `proposalRevision`/`knowledgeRevision`/`factsFingerprint`，并按 case 绑定 `caseId`/`plan`/`decision`。而 `fleet.feedback` 是反馈回执执行器（参数表要 `feedbackId`），不是业务决定入口。人点 apply 卡 `att_d6edb0a3400e` 时按名拒绝 `fleet.feedback requires params.feedbackId`。

### 修复

在 `confirm` 里，对知识卡（`isKnowledgeCard(card)`）在 `executor.execute(action.params)` 之前，把 `knowledge` 转成 fleet 要的 confirmation 并注入 `action.params.confirmation`；`deliverFeedback` 既有行为不变（回执仍走 `fleet.feedback`）。

confirmation 形状（字段取自 `knowledge` 与 `knowledge.feedback`）：

```ts
{
  actorKind: 'human',
  decisionRef: knowledge.ref,
  at: now().toISOString(),
  binding: {
    caseId: knowledge.caseId,
    knowledgeRevision: knowledge.feedback.knowledgeRevision,
    proposalRevision: knowledge.feedback.proposalRevision,
    factsFingerprint: knowledge.feedback.factsFingerprint,
    ...(plan 字段，含 scope/steps/verification),
    decision: knowledge.decision,
  },
}
```

`binding` 即 `knowledge.feedback` 去掉 `confirmationRef` 后加 `caseId`（`decisionRef` 已单独放顶层）。`fleet.apply` 消费方会按 `confirmationShapeRefusals` 逐项核形状；缺 `binding.proposalRevision`/`knowledgeRevision`/`factsFingerprint` 或 `actorKind !== 'human'` 都会具名拒绝。

### 不弱化

- 非知识卡 confirm 的 `action.params` 一个字节不变。
- `deliverFeedback` 的 knowledge 回执拼接保持不变；只是第一次动作执行器现在也拿到 confirmation。
- 不改 executor 声明、不改契约读侧；fleet 侧把 executor 从 `fleet.feedback` 改成 `fleet.apply` 是 companion 任务 `gap-knowledge-cockpit-apply-executor-fleet-apply`（quay-fleet）负责，本任务只做 claudecodeui confirm 的注入。

## AC

- [ ] `bash scripts/with-memory-cap.sh tsx --tsconfig server/tsconfig.json --test server/modules/cockpit/tests/cockpit-knowledge-decision-handoff.test.ts` 退出码 0，且其中新增/扩展的用例断言：知识卡 confirm 时，注入的 `fleet.apply` 动作执行器收到的 `params.confirmation` 满足 `actorKind==='human'`、`decisionRef===knowledge.ref`（非空）、`at` 为可解析 ISO-8601 UTC、`binding` 含 `caseId/knowledgeRevision/proposalRevision/factsFingerprint/plan/decision` 且与 `knowledge` 一致；非知识卡 confirm 的 `params` 不含 `confirmation`；非 `fleet.apply` 执行器（如 `session.send`/`fleet.hold`）params 不因本改动新增字段。
- [ ] `npx oxlint server/modules/cockpit/cockpit-card-actions.ts server/modules/cockpit/tests/cockpit-knowledge-decision-handoff.test.ts` 退出码 0；`npx tsc --noEmit -p server/tsconfig.json` 退出码 0。
- [ ] 只读复核：`git diff -- server/modules/cockpit/cockpit-card-actions.ts` 显示注入点在 `executor.execute(action.params)` 之前、只新增 confirmation 构造与 `params` 拼装，`deliverFeedback` 的 knowledge 拼接未删；`git grep -n "confirmation" server/modules/cockpit/cockpit-card-actions.ts` 能定位到注入点。

## DoD

`server/modules/cockpit/cockpit-card-actions.ts` 的 `confirm` 对知识卡在动作执行器调用前注入 `confirmation`；单测证明 `fleet.apply` 收到的 `params.confirmation` 形状满足 fleet `confirmationShapeRefusals` 的全部形状要求（actorKind/decisionRef/at/binding 及其必带字段）。真实对象已被操作：用知识 apply 卡（`att_d6edb0a3400e` 或等价 knowledge-proposal 卡）走 confirm 后，读 `fleet.apply` 收到的 `params` 断言其含完整 `confirmation`（修复前只有 `{attentionId, revision, optionId, decision}` 且被 `fleet.feedback` 拒）。端到端「fleet.apply 落决定」在 fleet 侧 companion 任务 `gap-knowledge-cockpit-apply-executor-fleet-apply` 落地后联合复验，本任务不把「fleet 已落决定」写成自身 DoD。

## Touches

- server/modules/cockpit/cockpit-card-actions.ts
- server/modules/cockpit/tests/cockpit-knowledge-decision-handoff.test.ts
- tasks/gap-cockpit-knowledge-confirm-inject-fleet-apply-confirmation.md
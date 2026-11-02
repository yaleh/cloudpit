---
id: gap-cockpit-knowledge-confirm-inject-fleet-apply-confirmation
title: cockpit confirm 对知识卡注入 confirmation 给 fleet.apply（可信决定执行，而非只进反馈回执）
status: done
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

- [x] `bash scripts/with-memory-cap.sh tsx --tsconfig server/tsconfig.json --test server/modules/cockpit/tests/cockpit-knowledge-decision-handoff.test.ts` 退出码 0，且其中新增/扩展的用例断言：知识卡 confirm 时，注入的 `fleet.apply` 动作执行器收到的 `params.confirmation` 满足 `actorKind==='human'`、`decisionRef===knowledge.ref`（非空）、`at` 为可解析 ISO-8601 UTC、`binding` 含 `caseId/knowledgeRevision/proposalRevision/factsFingerprint/plan/decision` 且与 `knowledge` 一致；非知识卡 confirm 的 `params` 不含 `confirmation`；非 `fleet.apply` 执行器（如 `session.send`/`fleet.hold`）params 不因本改动新增字段。
- [x] `npx oxlint server/modules/cockpit/cockpit-card-actions.ts server/modules/cockpit/tests/cockpit-knowledge-decision-handoff.test.ts` 退出码 0；`npx tsc --noEmit -p server/tsconfig.json` 退出码 0。
- [x] 只读复核：`git diff -- server/modules/cockpit/cockpit-card-actions.ts` 显示注入点在 `executor.execute(action.params)` 之前、只新增 confirmation 构造与 `params` 拼装，`deliverFeedback` 的 knowledge 拼接未删；`git grep -n "confirmation" server/modules/cockpit/cockpit-card-actions.ts` 能定位到注入点。

## DoD

`server/modules/cockpit/cockpit-card-actions.ts` 的 `confirm` 对知识卡在动作执行器调用前注入 `confirmation`；单测证明 `fleet.apply` 收到的 `params.confirmation` 形状满足 fleet `confirmationShapeRefusals` 的全部形状要求（actorKind/decisionRef/at/binding 及其必带字段）。真实对象已被操作：用知识 apply 卡（`att_d6edb0a3400e` 或等价 knowledge-proposal 卡）走 confirm 后，读 `fleet.apply` 收到的 `params` 断言其含完整 `confirmation`（修复前只有 `{attentionId, revision, optionId, decision}` 且被 `fleet.feedback` 拒）。端到端「fleet.apply 落决定」在 fleet 侧 companion 任务 `gap-knowledge-cockpit-apply-executor-fleet-apply` 落地后联合复验，本任务不把「fleet 已落决定」写成自身 DoD。

## ADR-007 dark-axis record

- 该轴仍暗,理由:本任务只把 knowledge authority 已验证的决定注入 fleet.apply 的 params，不新增领域数据能力，也没有可读出的 L_D/L_G 量值。

## Evidence

**2026-11-02 续跑轮（exited-not-landed 后）**

- 上轮 suite 红 `server/modules/cli/tests/cli.service.test.ts :: the missing-metadata fallback must name the fork repository` 是 **develop 自己的真实基线红**，与本任务 delta（cockpit 两文件）无关：`a7942b0f9`（GOAL-054 分发身份）把 `cli.service.ts` 的 Documentation/Report Issues 回退值改成 `https://github.com/yaleh/cloudpit`，同提交没有更新 `cli.service.test.ts`，测试仍断言 `/yaleh\/claudecodeui/` ⇒ 确定性失败；`git diff develop -- server/modules/cli/` 为空可证两侧字节相同。上轮的 `changed-assertion` 是已知的 marker/tap 签名解析 artifact（baseline 单文件重跑拿到 assertion 文本，全量日志的密集 `__PERFILE__` 块拿不到），修绿才能落地。
- 处置：把该测试的期望改为 shipped 回退值 `yaleh/cloudpit`（只改一行断言 + 一行注释），并作为 collateral 声明进 `## Touches`；未弱化任何守卫（`doesNotMatch /siteboon/` 原样保留）。
- 本任务 AC 复验（worktree 内）：AC1 `bash scripts/with-memory-cap.sh tsx --tsconfig server/tsconfig.json --test server/modules/cockpit/tests/cockpit-knowledge-decision-handoff.test.ts` → tests 19 / pass 19 / fail 0，退出 0；AC2 `npx oxlint …` 退出 0（仅一条 develop 既有 warning，位于未改动的 `:726`），`npx tsc --noEmit -p server/tsconfig.json` 退出 0；AC3 注入点与 `deliverFeedback` 拼接均保持。
- collateral 复验：`bash scripts/test.sh server/modules/cli/tests/cli.service.test.ts` → `__PERFILE__ … passed=true`，tests 1 / pass 1 / fail 0。

## Touches

- server/modules/cockpit/cockpit-card-actions.ts
- server/modules/cockpit/tests/cockpit-knowledge-decision-handoff.test.ts
- tasks/gap-cockpit-knowledge-confirm-inject-fleet-apply-confirmation.md
- server/modules/cli/tests/cli.service.test.ts (collateral: develop 基线红 — a7942b0f9 改了 CLI 回退值未同步该断言，改为云 pit 分发身份)

## Blocker

**2026-11-02T04:12:47.658Z — worker 未落地（exited-not-landed）**

- 未落地原因：step=suite: not ok - server/modules/cli/tests/cli.service.test.ts:   AssertionError [ERR_ASSERTION]: the missing-metadata fallback must name the fork repository [baseline A/B: HARD RED (changed-assertion) — the task's red set is NOT a subset of the develop baseline red set: added=- changed=server/modules/cli/tests/cli.service.test.ts]
- run_id：wk-prod-anchor
- session_id：99f906f5-2c67-4400-81e5-7dc43e3bf528

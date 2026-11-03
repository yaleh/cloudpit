---
id: gap-cockpit-knowledge-discovery-null-revision
title: cockpit 接受 discovery 卡 knowledgeRevision:null：无 knowledgeId 时只绑
  caseId+proposalRevision
status: needs-human
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

**结论：`readKnowledgeCase` 要接受 discovery 卡的 `knowledgeRevision: null`——无 `knowledgeId` 时确认只绑 `caseId + proposalRevision`，不绑知识版本；`knowledgeRevision` 只在 `knowledgeId` 存在时才是必需证据。**

### 现状（已核实 file:line）

- fleet 侧 `src/knowledge-proposals.ts:269` `knowledgeCaseFor` 对发现来源（未登记知识）诚实钉 `knowledgeRevision: null`（注释：不补 1 冒充已登记知识）。discovery-finding 卡共 14 张，`knowledgeId` 也缺。
- cockpit 侧 `server/modules/cockpit/cockpit-knowledge-reading.ts:139-141` `readKnowledgeCase`：`const knowledgeRevision = nonNegativeInteger(value.knowledgeRevision); if (caseId === '' || knowledgeRevision === null || proposalRevision === null) return null;`——`null` 的 knowledgeRevision 让整个 case 块判 null，`knowledgeEvidenceProblem`（`:188-192`）于是报「知识建议卡 … 缺少可读的 case 证据（caseId/知识版本/建议版本）」，discovery 卡在 cockpit 点 apply 被拒。
- 类型侧 `server/shared/types.ts:4954` 与 `src/shared/types.ts:4436` 的 `CockpitKnowledgeCase.knowledgeRevision` 都是 `number`（非空），无法表达 discovery 的 null 读数。

### 修复

1. `CockpitKnowledgeCase.knowledgeRevision` 改 `number | null`（`server/shared/types.ts` 与 `src/shared/types.ts` 两端同步；两侧 `cockpitCardTypeSync` 逐字段比对需仍一致）。
2. `readKnowledgeCase`：先读 `knowledgeId`；`caseId` 空或 `proposalRevision` 空仍返回 null；**`knowledgeRevision` 只在 `knowledgeId` 非空时才是必需**——`knowledgeId` 缺失（discovery 卡）时接受 `knowledgeRevision: null` 并原样透传，`knowledgeId` 存在时仍要求 `nonNegativeInteger`（现有正控不回退）。
3. 确认与回执路径原样透传 null（`cockpit-knowledge-decision.ts` 的 `bindingPayload` 与 `feedback` 只是把 `knowledge.knowledgeRevision` 放进数组/对象，null 是确定性的合法值），无需改 binding 语义。

### 不弱化

- 有 `knowledgeId` 的已登记知识卡仍要求非空 `knowledgeRevision`，缺它仍判不可确认。
- 不改 fleet、不改契约读侧、不改前端；只放宽 cockpit 读侧对 discovery 卡 null 版本的拒绝。

## AC

- [x] `bash scripts/with-memory-cap.sh tsx --tsconfig server/tsconfig.json --test server/modules/cockpit/tests/cockpit-knowledge-decision-handoff.test.ts` 退出码 0，且新增/扩展用例断言：无 `knowledgeId` 且 `knowledgeRevision: null` 的 discovery 卡，`readKnowledgeCase` 返回非 null case 块且 `knowledgeRevision === null`、`knowledgeEvidenceProblem` 返回 null（可确认）；有 `knowledgeId` 但 `knowledgeRevision` 缺失/null 的卡仍返回 null（正控不回退）；`knowledgeRevision` 非整数（如字符串）在 `knowledgeId` 存在时仍拒。
- [x] `npx oxlint server/modules/cockpit/cockpit-knowledge-reading.ts server/modules/cockpit/tests/cockpit-knowledge-decision-handoff.test.ts` 与 `npx tsc --noEmit -p tsconfig.json && npx tsc --noEmit -p server/tsconfig.json` 退出码 0；`src/shared/tests/cockpitCardTypeSync.test.ts`（若在 vitest 集内）退出码 0。
- [x] 只读复核：`git diff` 显示 `knowledgeRevision: number` → `number | null` 只在两处类型定义、`readKnowledgeCase` 只放宽 discovery 卡的 null 版本判定；`git grep -n "knowledgeRevision" server/modules/cockpit/cockpit-knowledge-reading.ts` 命中新判定，`knowledgeId` 存在时仍要求非空的既有分支未删。

## DoD

`readKnowledgeCase` 对无 `knowledgeId` 的 discovery 卡接受 `knowledgeRevision: null` 并透传，`knowledgeEvidenceProblem` 不再拒绝，cockpit 点 apply 走通确认通道（绑 caseId + proposalRevision）；有 `knowledgeId` 的卡仍要求非空知识版本。真实对象已被操作：fleet 部署后读任一 discovery 卡（如 `knowledgeId:null`、`knowledgeRevision:null` 的 finding 卡）的 `readKnowledgeCase` 结果非 null、可 confirm；apply 后的 confirmation 含 `knowledgeRevision: null` 且 fleet `fleet.apply` 接受（端到端 apply 联合复验由对方 `知识发现与应用机制` 侧发起，本任务不把「fleet 已接受决定」写成自身 DoD）。

真实读数（本会话；探针 `tmp/knowledge-discovery-dod/probe.mts` 跑在 `quay-fleet cockpit cards --json` 的 42 张真实卡上，未提交）：

- 18 张 knowledge 卡全部是 discovery（`knowledgeId` 缺失、`knowledgeRevision: null`）：旧判定可读 0 张，新判定 18/18 投影出 case 块，`knowledgeEvidenceProblem` 全部返回 null，`authority.issue` 全部签出 `confirmationRef`。
- 取真实卡 `att_f004b576095f`（`caseId=discovery-bb0c0bfad700`）走真实确认通道：`decision=apply`，`feedbackKnowledgeRevision=null`、`feedbackProposalRevision=1`、`feedbackId=kf-b9cb90de468dc9b9c5d2c39f448c1b67`——交给 fleet 的决断里知识版本就是 null，没有编造版本号。
- 未执行 `fleet.apply`（那会真的应用一条知识建议）；端到端 apply 的联合复验按本文约定由对方「知识发现与应用机制」侧发起。

该轴仍暗,理由:本任务只放宽 cockpit 读侧对 discovery 卡 null 知识版本的拒绝并同步两侧类型定义,AC 内没有 L_D/L_G 探针或读数可记。

## Touches

- server/shared/types.ts
- src/shared/types.ts
- server/modules/cockpit/cockpit-knowledge-reading.ts
- server/modules/cockpit/tests/cockpit-knowledge-decision-handoff.test.ts
- tasks/gap-cockpit-knowledge-discovery-null-revision.md

## Blocker

**2026-11-03T10:03:50.495Z — worker 未落地（exited-not-landed）**

- 未落地原因：step=ff: fan-in-ff-merge: working tree not clean in /data/home/yale/work/claudecodeui — the merge-mode ff must run on a clean checkout (found uncommitted changes):
fan-in-ff-merge:    M src/modules/chat-support/utils/inputSuggestions.ts
fan-in-ff-merge:    M src/modules/chat-transcript/hooks/useTranscriptSelection.ts
fan-in-ff-merge:    M src/modules/chat-transcript/index.ts
fan-in-ff-merge:    M src/modules/chat/tests/useTranscriptSelection.test.tsx
- run_id：wk-prod-anchor
- session_id：48e62335-6f70-4dad-84f4-5761befcb376

## Needs-Human

**执行 2026-11-03T10:03:51.234Z — 连续修满重试上限仍不合格（标 needs-human）**

- 阻碍原因：worker-driver 连续 3 次 exited-not-landed 未落地（重试上限）
- 失败步/判词：step=ff: fan-in-ff-merge: working tree not clean in /data/home/yale/work/claudecodeui — the merge-mode ff must run on a clean checkout (found uncommitted changes):
fan-in-ff-merge:    M src/modules/chat-support/utils/inputSuggestions.ts
fan-in-ff-merge:    M src/modules/chat-transcript/hooks/useTranscriptSelection.ts
fan-in-ff-merge:    M src/modules/chat-transcript/index.ts
fan-in-ff-merge:    M src/modules/chat/tests/useTranscriptSelection.test.tsx
- run_id：wk-prod-anchor
- session_id：48e62335-6f70-4dad-84f4-5761befcb376
- fan-in 日志：/data/home/yale/work/claudecodeui/.quay/fan-in-gap-cockpit-knowledge-discovery-null-revision-wk-prod-anchor.log

---
id: gap-cockpit-knowledge-discovery-null-revision
title: cockpit 接受 discovery 卡 knowledgeRevision:null：无 knowledgeId 时只绑
  caseId+proposalRevision
status: todo
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

- [ ] `bash scripts/with-memory-cap.sh tsx --tsconfig server/tsconfig.json --test server/modules/cockpit/tests/cockpit-knowledge-decision-handoff.test.ts` 退出码 0，且新增/扩展用例断言：无 `knowledgeId` 且 `knowledgeRevision: null` 的 discovery 卡，`readKnowledgeCase` 返回非 null case 块且 `knowledgeRevision === null`、`knowledgeEvidenceProblem` 返回 null（可确认）；有 `knowledgeId` 但 `knowledgeRevision` 缺失/null 的卡仍返回 null（正控不回退）；`knowledgeRevision` 非整数（如字符串）在 `knowledgeId` 存在时仍拒。
- [ ] `npx oxlint server/modules/cockpit/cockpit-knowledge-reading.ts server/modules/cockpit/tests/cockpit-knowledge-decision-handoff.test.ts` 与 `npx tsc --noEmit -p tsconfig.json && npx tsc --noEmit -p server/tsconfig.json` 退出码 0；`src/shared/tests/cockpitCardTypeSync.test.ts`（若在 vitest 集内）退出码 0。
- [ ] 只读复核：`git diff` 显示 `knowledgeRevision: number` → `number | null` 只在两处类型定义、`readKnowledgeCase` 只放宽 discovery 卡的 null 版本判定；`git grep -n "knowledgeRevision" server/modules/cockpit/cockpit-knowledge-reading.ts` 命中新判定，`knowledgeId` 存在时仍要求非空的既有分支未删。

## DoD

`readKnowledgeCase` 对无 `knowledgeId` 的 discovery 卡接受 `knowledgeRevision: null` 并透传，`knowledgeEvidenceProblem` 不再拒绝，cockpit 点 apply 走通确认通道（绑 caseId + proposalRevision）；有 `knowledgeId` 的卡仍要求非空知识版本。真实对象已被操作：fleet 部署后读任一 discovery 卡（如 `knowledgeId:null`、`knowledgeRevision:null` 的 finding 卡）的 `readKnowledgeCase` 结果非 null、可 confirm；apply 后的 confirmation 含 `knowledgeRevision: null` 且 fleet `fleet.apply` 接受（端到端 apply 联合复验由对方 `知识发现与应用机制` 侧发起，本任务不把「fleet 已接受决定」写成自身 DoD）。

## Touches

- server/shared/types.ts
- src/shared/types.ts
- server/modules/cockpit/cockpit-knowledge-reading.ts
- server/modules/cockpit/tests/cockpit-knowledge-decision-handoff.test.ts
- tasks/gap-cockpit-knowledge-discovery-null-revision.md
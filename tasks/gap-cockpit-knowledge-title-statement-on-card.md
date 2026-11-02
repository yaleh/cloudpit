---
id: gap-cockpit-knowledge-title-statement-on-card
title: cockpit 卡面透传知识标题与正文：knowledge.title/statement 从 fleet 读到前端显示
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

**结论：cockpit 卡面要透传并显示知识条目的标题与正文（`knowledge.title` / `knowledge.statement`），让人在点 apply 之前能看到「这条知识说的是什么」。**

### 现状（已核实 file:line）

- fleet 侧 `knowledgeCaseFor()`（quay-fleet `src/knowledge-proposals.ts:239-258`）造 `contentRef.knowledge` 时只带 `caseId`/`knowledgeRevision`/`proposalRevision`/`state`/`factsFingerprint`/`plan`/`progress`，把 `judgment.knowledge` 的 `knowledgeId`/`title`/`statement` 丢了。实测 `att_d6edb0a3400e` 的 `contentRef.knowledge` `hasTitle:false / hasStatement:false / hasKnowledgeId:false`。
- claudecodeui `CockpitKnowledgeCase`（`server/shared/types.ts:4879`）只有 `knowledgeId?`，没有 `title?` / `statement?`。
- `readKnowledgeCase()`（`server/modules/cockpit/cockpit-knowledge-reading.ts:123`）用 `text()` 容错读了 `knowledgeId`，但没读 `title` / `statement`。
- `cockpit-fleet-card-projection.ts:642` `readKnowledgeCase(raw.knowledge)` 后 `:669` 透传 `knowledge` 块；前端 `CockpitCard.tsx`（`:378-390` 一带）只画 state/progress/verification，不画标题/正文。

### 修复

fleet 侧（companion `gap-knowledge-card-knowledge-content`）会补 `knowledge.knowledgeId` / `knowledge.title` / `knowledge.statement`（title=知识标题，statement=知识条目 revision 的 Markdown 全文，逐字取自 judgment.knowledge，缺则省略）。claudecodeui 侧：

1. `server/shared/types.ts` 的 `CockpitKnowledgeCase` 加 `title?: string`、`statement?: string`（`knowledgeId?` 已有，不动）。
2. `cockpit-knowledge-reading.ts` 的 `readKnowledgeCase()` 用既有 `text()` 容错读出 `title`/`statement`，非空才带、空则省略（与 `knowledgeId` 同一纪律）。
3. `cockpit-fleet-card-projection.ts` 把这两键从 fleet 卡片透传到投影后的 `knowledge` 块（已走 `readKnowledgeCase`，只补字段，不加新分支）。
4. 前端 `CockpitCard.tsx`（或知识块那一栏）把标题/正文显示出来，让人点 apply 前能读到知识内容。

### 不弱化

- 缺 title/statement 的旧卡/旧 provider 一个字节不变（字段可选、空则省略）。
- 不新增执行器、不改 confirm 通道、不改契约签名；只是把 provider 已声明的知识正文透传到卡面。

## AC

- [ ] `bash scripts/with-memory-cap.sh tsx --tsconfig server/tsconfig.json --test server/modules/cockpit/tests/cockpit-knowledge-decision-handoff.test.ts` 退出码 0，且新增/扩展用例断言：`readKnowledgeCase` 对含 `title`/`statement` 的 knowledge 块读出非空 `title`/`statement` 且逐字节等于原文；对缺这两键的 knowledge 块返回对象不含 `title`/`statement` 键（空则省略）；投影后的 `knowledge` 块把 `title`/`statement` 透传；`CockpitKnowledgeCase` 类型允许 `title?`/`statement?`。
- [ ] `npx oxlint server/shared/types.ts server/modules/cockpit/cockpit-knowledge-reading.ts server/modules/cockpit/cockpit-fleet-card-projection.ts src/modules/cockpit/CockpitCard.tsx` 与 `npx tsc --noEmit -p tsconfig.json && npx tsc --noEmit -p server/tsconfig.json` 均退出码 0。
- [ ] 只读复核：`git diff` 显示只新增 `title?`/`statement?` 两个可选字段、读取与透传、前端渲染；`git grep -n "statement" server/modules/cockpit/` 能定位到 reading 与 projection 两处，无删除既有 `knowledgeId` 读取。

## DoD

`CockpitKnowledgeCase` 带 `title?`/`statement?`，`readKnowledgeCase` 非空才读、`cockpit-fleet-card-projection` 透传、前端卡面显示标题与正文。真实对象已被操作：fleet companion `gap-knowledge-card-knowledge-content` 落地后，读 `att_d6edb0a3400e` 的 `contentRef.knowledge` 断言 `title`/`statement` 非空透传，且浏览器 Details/知识块可见；fleet 落地前用含 `title`/`statement` 的 fixture 证明本侧透传与显示成立。端到端「卡面显示知识正文」在 fleet companion 落地后联合复验，本任务不把「fleet 已补字段」写成自身 DoD。

## Touches

- server/shared/types.ts
- server/modules/cockpit/cockpit-knowledge-reading.ts
- server/modules/cockpit/cockpit-fleet-card-projection.ts
- src/modules/cockpit/CockpitCard.tsx
- server/modules/cockpit/tests/cockpit-knowledge-decision-handoff.test.ts
- tasks/gap-cockpit-knowledge-title-statement-on-card.md
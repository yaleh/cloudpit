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
- `readKnowledgeCase()`（`server/modules/cockpit/cockpit-knowledge-reading.ts:123`）用既有 `text()` 容错读了 `knowledgeId`，但没读 `title` / `statement`。
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

- [x] `bash scripts/with-memory-cap.sh tsx --tsconfig server/tsconfig.json --test server/modules/cockpit/tests/cockpit-knowledge-decision-handoff.test.ts` 退出码 0，且新增/扩展用例断言：`readKnowledgeCase` 对含 `title`/`statement` 的 knowledge 块读出非空 `title`/`statement` 且逐字节等于原文；对缺这两键的 knowledge 块返回对象不含 `title`/`statement` 键（空则省略）；投影后的 `knowledge` 块把 `title`/`statement` 透传；`CockpitKnowledgeCase` 类型允许 `title?`/`statement?`。
- [x] `npx oxlint server/shared/types.ts server/modules/cockpit/cockpit-knowledge-reading.ts server/modules/cockpit/cockpit-fleet-card-projection.ts src/modules/cockpit/CockpitCard.tsx` 与 `npx tsc --noEmit -p tsconfig.json && npx tsc --noEmit -p server/tsconfig.json` 均退出码 0。
- [x] 只读复核：`git diff` 显示只新增 `title?`/`statement?` 两个可选字段、读取与透传、前端渲染；`git grep -n "statement" server/modules/cockpit/` 能定位到 reading 与 projection 两处，无删除既有 `knowledgeId` 读取。

## DoD

`CockpitKnowledgeCase` 带 `title?`/`statement?`，`readKnowledgeCase` 非空才读、`cockpit-fleet-card-projection` 透传、前端卡面显示标题与正文。真实对象已被操作：fleet companion `gap-knowledge-card-knowledge-content` 落地后，读 `att_d6edb0a3400e` 的 `contentRef.knowledge` 断言 `title`/`statement` 非空透传，且浏览器 Details/知识块可见；fleet 落地前用含 `title`/`statement` 的 fixture 证明本侧透传与显示成立。端到端「卡面显示知识正文」在 fleet companion 落地后联合复验，本任务不把「fleet 已补字段」写成自身 DoD。

## Notes

- 该轴仍暗,理由:本任务只在既有 cockpit 知识卡契约上补两个可选显示字段并渲染，未改变领域数据形态（L_D）或模块依赖结构（L_G），无读数可测。

实现（2026-11-02，worktree `gap-cockpit-knowledge-title-statement-on-card`）：
- 契约两端同步：`server/shared/types.ts` 与 `src/shared/types.ts` 的 `CockpitKnowledgeCase` 各加 `title?`/`statement?`（两端手抄、`src/shared/tests/cockpitCardTypeSync.test.ts` 逐字段比对，7/7 绿）；每端 +11 行已在 `server/shared/tests/architecture-ratchet.baseline.json` 按 AC-394 RECORDED CHANGE 记录（5526→5537、4916→4927），ratchet 6/6 绿。
- `readKnowledgeCase()` 用 `statedText()` 逐字节保留有可见内容的字符串、纯空白视为未声明；投影经同一读取函数透传，无新分支。

验证记录：
- AC1：`bash scripts/with-memory-cap.sh tsx --tsconfig server/tsconfig.json --test server/modules/cockpit/tests/cockpit-knowledge-decision-handoff.test.ts` → 21 pass / 0 fail。新增两条：readKnowledgeCase 逐字节读出且缺键/纯空白省略；投影透传且缺键不出现。
- AC2：`npx oxlint <4 files>` exit 0（仅既有一条 tailwind warning，非本改动）；`npx tsc --noEmit -p tsconfig.json` exit 0；`npx tsc --noEmit -p server/tsconfig.json` exit 0。
- AC3：`git grep -n "statement" server/modules/cockpit/` 命中 reading（`cockpit-knowledge-reading.ts:60,149,165`）与 projection（`cockpit-fleet-card-projection.ts:642`）；`knowledgeId` 读取与透传未改（`:147,163`）。
- 相关回归：cockpit server 三文件 51/51 绿；前端 `CockpitCard.test.tsx` + `cockpitCardController.test.ts` 166/166 绿。
- DoD（fleet companion 落地前的 fixture 臂）：worktree vite dev 起真实 cards 页（后端代理线上 :3001），在 `/api/cockpit/cards` 注入带 `title`/`statement` 的 knowledge 卡 —— 卡面渲染标题与正文（DOM 读数与原文逐字相等，截图 `tmp/dod/knowledge-with-text.png`）；同一张卡去掉这两键则不渲染这两个节点（`tmp/dod/knowledge-without-text.png`）。结构化读数 `tmp/dod/knowledge-report.json`：两腿 pass、pageErrors 0。场景运行器 `node scripts/ui-scenario.mjs e2e/scenarios/cockpit-mode-switch.json --base-url http://127.0.0.1:5199 …` → passed (3 steps, 3 checkpoints)。
- fleet companion `gap-knowledge-card-knowledge-content` 落地后再联合复验 `att_d6edb0a3400e`；本任务不声明「fleet 已补字段」这一外部事实。

## Touches

- server/shared/types.ts
- src/shared/types.ts
- server/shared/tests/architecture-ratchet.baseline.json
- server/modules/cockpit/cockpit-knowledge-reading.ts
- server/modules/cockpit/cockpit-fleet-card-projection.ts
- src/modules/cockpit/CockpitCard.tsx
- server/modules/cockpit/tests/cockpit-knowledge-decision-handoff.test.ts
- tasks/gap-cockpit-knowledge-title-statement-on-card.md
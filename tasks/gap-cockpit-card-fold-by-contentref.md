---
id: gap-cockpit-card-fold-by-contentref
title: 卡片折叠按 contentRef 身份：问句缺失时不再按 session 合并不同提问
status: done
labels:
  - gap
  - cockpit
  - defect
parent: null
children: []
extra:
  schema: execution
---
## Proposal

来源：2026-10-29 复核 5b984a5f 的 3 张 ask 卡：其中 2 张 contentRef.messageId 相同（#a68ae9b0），另 1 张不同（#b8494a51）。`src/modules/cockpit/cockpitCardDuplicates.ts` 在卡片没有 `ask`/`situation` 时把 `question` 记为 null，分组键退化成「仅 sessionId」，于是这 3 张不同提问会被合成一组，卡片显示「同一个问题问了多次」。fleet 的身份是 `contentRef.messageId`：同 messageId 是重复，不同 messageId 是不同提问。

做什么：
- 折叠键改为：有问句时保持现有归一化问句键（同题重问、不同 messageId 仍折叠，行为不变）；问句缺失时使用 `contentRef.messageId`（`contentRef.ref` 里的 `#<messageId>`；没有 ref 时用卡片 id，天然不折叠）；禁止仅按 sessionId 归组。
- 折叠后的「问了 N 次」只统计同一身份；不同 messageId 不入同一组。
- 不改投影、不改 retraction、不改卡片空内容 UI（`emptyAskContent` 已由既有任务处理，不重复实现）。
- 若 `contentRef` 缺失或无法解析，卡片自成一类，不猜测身份。

## AC

- [x] `npx vitest run src/modules/cockpit/tests/cockpitCardDuplicates.test.ts` 退出 0：同一 session、三张无 ask 的卡（refs A、A、B）⇒ 只有 A/A 成组（count=2），B 独立；假形态恢复「仅 sessionId」分组 ⇒ 该用例红。
- [x] 同文件：同一归一化问句、不同 messageId 仍折叠（既有行为）；无 ask 且无 ref 的卡不成组；不同 session 永不折叠。
- [x] `npx vitest run src/modules/cockpit/tests/cockpitCardController.test.ts` 退出 0：controller 的 `normalize` 产出的 duplicates 与上面一致；可见列表里 A/A 显示 2 次、B 单独可见。
- [x] `npm run typecheck`、`npm run lint` 退出 0。

## DoD

真实/隔离页面（MCP 浏览器或一次性 Playwright；不点确认）：

1. 造或找同一 session 的 3 张卡（2 张同 ref、1 张不同 ref、都无 ask）：390 与 1440 打开 `/cockpit?view=cards`，读到 2 张可见卡；折叠卡显示 2 次而不是 3 次；截图存 `tmp/`。
2. 贴出 `[data-testid="cockpit-card-duplicates-toggle"]` 的文本与两张卡的 `contentRef` 读数。
3. 场景运行器可用时跑 `node scripts/ui-scenario.mjs e2e/scenarios/cockpit-mode-switch.json …` 并贴 JSON。

### DoD 证据（2026-10-29）

会话内无 MCP 浏览器，按既有等价路径用一次性 Playwright 驱动真实页面：worktree 的 vite dev（:5199）代理运行中的实例（:3001），页面代码取自本 worktree；`GET /api/cockpit/cards` 用 `page.route` 注入 3 张同一 session（`s1`）、均无 `ask`/`situation` 的卡：`card-a`=`s1#msgA`(01s)、`card-b`=`s1#msgA`(03s)、`card-c`=`s1#msgB`(02s)。全程未点确认，`/api/cockpit/**` 的 GET 不做任何写操作。

- 390×844 与 1440×900 读数一致：可见卡 **2 张**（`card-b`、`card-c`）；保留卡 `card-b` 的 `[data-testid="cockpit-card-duplicates"]` 为 `data-count="2"`、`data-expanded="false"`，文本「⧉ This session has 2 unanswered questions」；`[data-testid="cockpit-card-duplicates-toggle"]` 文本为 **「Show earlier」**（`data-expanded="false"`）。pageErrors 为空。读取的报告：`tmp/cockpit-card-fold-dod/report.json`。
- 截图：`tmp/cockpit-card-fold-dod/cards-390.png`、`tmp/cockpit-card-fold-dod/cards-1440.png`。
- 注入卡片的 contentRef 读数：`card-a` → `{"resolver":"cloudcli.session-ask","ref":"s1#msgA"}`；`card-b` → 同上 `ref:"s1#msgA"`；`card-c` → `ref:"s1#msgB"`（三个 ref 见 report.json 的 `contentRefsServed`）。
- 场景运行器：`node scripts/ui-scenario.mjs e2e/scenarios/cockpit-mode-switch.json --base-url http://127.0.0.1:5199 --auth-token <minted> --project claudecodeui --session pwd --out tmp/cockpit-card-fold-dod/scenario` → `ui-scenario: passed (3 steps, 5955ms, 3 checkpoint(s))`；三步路由依次 `/session/ad8fea71-…` → `/cockpit?view=board&project=claudecodeui` → `/session/ad8fea71-…`，三个 checkpoint 截图在 `tmp/cockpit-card-fold-dod/scenario/`（完整 JSON：`tmp/cockpit-card-fold-dod/scenario-report.txt`）。
- 单测/假形态判别：`cockpitCardDuplicates.test.ts` 17/17、`cockpitCardController.test.ts` 61/61 绿；把分组键临时改回「仅 sessionId」后 `cockpitCardDuplicates.test.ts` 3 例红（含 AC1 的 A/A/B 用例），恢复实现后再次全绿 —— 该用例确实咬住旧形态。
- `npm run typecheck` 退出 0；`npm run lint` 退出 0（仅仓库既有 warning）。

## Touches

- tasks/gap-cockpit-card-fold-by-contentref.md
- src/modules/cockpit/cockpitCardDuplicates.ts
- src/modules/cockpit/tests/cockpitCardDuplicates.test.ts
- src/modules/cockpit/tests/cockpitCardController.test.ts

## ADR-007 暗轴

该轴仍暗,理由:本任务只修 cockpit 卡片折叠身份的前端纯函数与其测试、并用页面读数验证，不产出领域数据能力或目标层读数。

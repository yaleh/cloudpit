---
id: gap-cockpit-card-fold-by-contentref
title: 卡片折叠按 contentRef 身份：问句缺失时不再按 session 合并不同提问
status: todo
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

- [ ] `npx vitest run src/modules/cockpit/tests/cockpitCardDuplicates.test.ts` 退出 0：同一 session、三张无 ask 的卡（refs A、A、B）⇒ 只有 A/A 成组（count=2），B 独立；假形态恢复「仅 sessionId」分组 ⇒ 该用例红。
- [ ] 同文件：同一归一化问句、不同 messageId 仍折叠（既有行为）；无 ask 且无 ref 的卡不成组；不同 session 永不折叠。
- [ ] `npx vitest run src/modules/cockpit/tests/cockpitCardController.test.ts` 退出 0：controller 的 `normalize` 产出的 duplicates 与上面一致；可见列表里 A/A 显示 2 次、B 单独可见。
- [ ] `npm run typecheck`、`npm run lint` 退出 0。

## DoD

真实/隔离页面（MCP 浏览器或一次性 Playwright；不点确认）：

1. 造或找同一 session 的 3 张卡（2 张同 ref、1 张不同 ref、都无 ask）：390 与 1440 打开 `/cockpit?view=cards`，读到 2 张可见卡；折叠卡显示 2 次而不是 3 次；截图存 `tmp/`。
2. 贴出 `[data-testid="cockpit-card-duplicates-toggle"]` 的文本与两张卡的 `contentRef` 读数。
3. 场景运行器可用时跑 `node scripts/ui-scenario.mjs e2e/scenarios/cockpit-mode-switch.json …` 并贴 JSON。

## Touches

- tasks/gap-cockpit-card-fold-by-contentref.md
- src/modules/cockpit/cockpitCardDuplicates.ts
- src/modules/cockpit/tests/cockpitCardDuplicates.test.ts
- src/modules/cockpit/tests/cockpitCardController.test.ts
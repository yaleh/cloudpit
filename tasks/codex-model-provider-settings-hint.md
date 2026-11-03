---
id: codex-model-provider-settings-hint
title: 设置页 Codex providers/模型库提示 provider 变体语义
status: done
labels:
  - feature
parent: null
children: []
extra: {}
goal_ac: AC-471
---
<!-- dedup-ref --> 机制去重：设置页 Codex 服务商 UI 已有 codex-provider-settings-ui（CRUD + 模型编辑器 provider 区）；本条只加提示文案与 built-in · N provider variants 显示，不新增表单。

## Proposal

**现状**：CodexProvidersContent 的 provider 卡片没有说明 provider 在 composer/新建会话选择器里如何出现；模型库内置模型行不显示 provider 变体数。

**范围**：
1. Codex providers 卡片说明每个 provider 以 (provider) 变体出现在 composer 与新建会话选择器（后缀=provider id）。
2. 模型库内置模型行显示 built-in · N provider variants（N=注册 provider 数，来自 provider 注册表读数）。

## Touches

- tasks/codex-model-provider-settings-hint.md
- src/modules/settings/tabs/agents-settings/sections/content/CodexProvidersContent.tsx
- src/shared/ui/ModelLibraryPanel.tsx
- src/modules/settings/tests/codexModelProviderHint.test.tsx（新）

## AC

- [x] AC-471 判据绿：npx vitest run src/modules/settings/tests/codexModelProviderHint.test.tsx 退出 0。
- [x] 正臂：provider 卡片含变体提示；模型库内置模型行显示 built-in · N provider variants 且 N=注册 provider 数。
- [x] 负臂：无注册 provider 时 N=0 或行不显示变体数。
- [x] 假形态：硬编码 provider 名或写死 N 红。

## DoD

MCP 浏览器实际操作 + 截图存 tmp/（设置页看 provider 卡片提示与模型库变体数）；vitest 单文件绿 + npm run typecheck + lint。

## ADR-007

- L_D 该轴仍暗,理由:本任务是设置页提示文案，读数是 AC 判据与浏览器截图，没有可量化的领域数据轴读数。
- L_G 该轴仍暗,理由:本任务不新增 goal 判据；目标层读数由 GOAL-056 的 AC-471 承担。

## Evidence

- AC-471：`npx vitest run src/modules/settings/tests/codexModelProviderHint.test.tsx` → 6/6 passed，exit 0（合并 develop 后复跑仍绿）。
- 证伪（假形态）：撤掉两处实现后同一文件 6/6 红；恢复后 6/6 绿。测试同时用两个不同 provider id 与 2/3 两个注册数，硬编码单一名字或单一 N 会红。
- 场景运行器：`node scripts/ui-scenario.mjs scripts/ui-scenarios/codex-provider-settings.json --base-url http://127.0.0.1:5199` → `ok: true`，13/13 步；报告 `tmp/ui-dod/report.json`，检查点截图 `tmp/ui-dod/step-*.png`。
- 真实页面（worktree vite dev :5199 → 隔离实例 :5311；本会话无 MCP 浏览器，用一次性 Playwright 驱动同一真实设置页）：`tmp/ui-dod/visual-2-provider-variants-card.png`、`tmp/ui-dod/visual-2-provider-variants-builtin.png`（N=2，两张卡片分别带 `(alice)`/`(bob)`）；负臂 `tmp/ui-dod/visual-0-provider-variants-builtin.png`（N=0）；结构化读数 `tmp/ui-dod/visual-evidence.json`。
- 类型/静态：`tsc --noEmit -p tsconfig.json` 干净；oxlint 三个改动文件无 error（两条 set-state-in-effect 警告是该文件既有代码）。
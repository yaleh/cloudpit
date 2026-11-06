---
id: gap-sidebar-project-row-toggle-replayed-by-auto-expand
title: Projects 侧栏：已展开的非选中项目行应一次点击折叠（行 toggle 被选中后的 auto-expand 重放）
status: todo
labels:
  - gap
  - defect
parent: null
children: []
extra:
  schema: execution
---
## Proposal

Projects 侧栏的 `expandedProjects` 有两个写者，同一手势里互相覆盖：(1) 行点击 `SidebarProjectItem.selectAndToggleProject()` 在项目未被选中时调用 `onProjectSelect(project)`，随后调用 `onToggleProject(projectId)`；(2) 选中项目变化后触发的 auto-expand effect 会把 `selectedProject.projectId` 加入 `expandedProjects`。因此点击一个「已展开但未选中」的项目行时：toggle 先折叠，提交后 effect 又把该项目加回来，第一击被撤销；第二击（此时选中已相同）才真正折叠。真实 Chromium 复现：切到 Conversations 并打开另一项目的会话后两个项目都处于展开态，第一次点旧的展开行仍展开，第二次才折叠。

同一 effect 也从不移除先前展开的项目，所以非行点击造成的选中变化（Conversations 行、`useProjectsState` 的会话深链路由同步）会留下多个项目同时展开，而 `toggleProject` 的语义是单开。

已批准的修复（1+2）：1. 行点击在同时改变选中时把该事实传给 toggle：`onToggleProject(projectId, { selectionWillChange: true })`，`useSidebarProjectsConcern` 用一个 ref 消费并跳过该项目的一次 auto-expand；2. auto-expand effect 写单开集合 `new Set([selectedProjectId])` 而不是在累积集合上 `add`。新增两个回归测试（新文件 `src/modules/sidebar/tests/projectToggleExpansion.test.tsx`）：a) 一次点击折叠「已展开且未选中」的项目，即使同一手势改变选中；b) 非行路径改变选中后，恰好只有新选中的项目展开。

<!-- dedup-ref --> 去重：以 `expandedProjects` / `toggleProject` / `onToggleProject` / `auto-expand` / `single-open` / `projectToggleExpansion` 检索任务库均为 0 命中；按 Touches 文件检索 todo/ready 任务无声明（本 agent 无 Bash，用 `task_list search` 替代 grep 与 granularity 脚本）。相关但不同机制的已落地任务：`gap-sidebar-project-row-actions-overflow-menu-uniform-height`（done，项目行控件/等高）、`gap-routine-architecture-analysis-god-package-src-sidebar`（done，hook 拆分），均未钉展开态 ⇒ 不重复，独立立案。合并判定：none found。

**立案时现状核对（2026-11-06，本 checkout `develop`，git status 干净）。** 与上面的「修复前」描述相比，所选修复 1+2 的源码在当前树中已经存在：`src/modules/sidebar/SidebarProjectItem.tsx:236-246` 的 `selectAndToggleProject` 已计算 `selectionWillChange` 并以 `onToggleProject(projectId, { selectionWillChange })` 调用；`src/modules/sidebar/hooks/useSidebarProjectsConcern.ts:70-73,102-126` 已有 `selectionToggleProjectRef`（命中后清空并 return）与单开写入 `setExpandedProjects(() => new Set([selectedProjectId]))`；类型面 `src/shared/types.ts:3559-3570` 已定义 `ProjectToggleOptions`，`:3589` 的 `SidebarProjectListProps.onToggleProject` 已接受 `options?: ProjectToggleOptions`。缺口是判据与证据：`src/modules/sidebar/tests/projectToggleExpansion.test.tsx` 不存在，`scripts/ui-scenarios/project-row-session-open.json` 不存在（仓库现有场景在 `e2e/scenarios/`，如 `e2e/scenarios/cockpit-mode-switch.json`；runner 是 `scripts/ui-scenario.mjs`）。⇒ 执行者先用下面 AC 的真实读数复验这两处已存在的连线，补两条回归判据、场景与浏览器证据；若复验发现 1+2 任一处未真正生效（例如仍是累积 `add`），修到 AC 通过。⛔ 不因源码已有注释就跳过验证。

范围：只动前端 sidebar 与 shared types；不修改 `server/`。场景 JSON 按下面 Touches 的新路径创建；若仓库工具要求场景必须位于 `e2e/scenarios/`，执行者须先把该路径补进 Touches 再落地（runner 接受任意场景文件参数）。

## AC

- [ ] AC1（承重，行为）：新增 `src/modules/sidebar/tests/projectToggleExpansion.test.tsx`，其用例「one click collapses an expanded non-selected project row」在 `npx vitest run src/modules/sidebar/tests/projectToggleExpansion.test.tsx` 下退出码 0：准备项目 A（已展开、非选中）与项目 B（选中），点击 A 行一次后断言 A 不在 `expandedProjects`（`isProjectExpanded(A) === false`），且同一手势内 auto-expand effect 未把 A 重新加入（最终集合不含 A，而非仅瞬时为 false）；失败时打印点击后的展开集合。
- [ ] AC2（承重，行为）：同一测试文件的用例「non-row selection change leaves exactly the newly selected project expanded」退出码 0：先让 A、B 两个项目都处于展开态，再经非项目行路径把选中改为 B（Conversations 行点击或会话路由同步），断言最终展开集合恰为 `{B}` 且 A 被折叠（单开不变式）；失败时打印最终集合。
- [ ] AC3（承重，抗假）：把实现临时还原成修复前顺序（行点击不传 `selectionWillChange`，effect 改回在累积集合上 `add`）后，AC1、AC2 两条用例都变红；用 `git checkout -- <file>` 还原后两条复绿、`git status --porcelain` 对声明文件干净。逐条记录变异 diff 与逐字失败行；若不以变异而以上述最终展开集合断言取假，须证明修复前实现的读数必然让该断言失败。

## DoD

- 两条回归测试在 vitest 下通过：`npx vitest run src/modules/sidebar/tests/projectToggleExpansion.test.tsx` 退出码 0；且 `npx vitest run src/modules/sidebar/tests` 全绿、原有用例数不减少。
- `npm run typecheck` 通过（或 `npx tsc --noEmit -p tsconfig.json` 退出码 0）。
- 真实浏览器（MCP 或 Playwright）在真实运行的页面上把场景亲手走一遍并截图存 `tmp/`：项目列表里 A 已展开但未选中、B 选中；点 A 行一次后 A 收起（同一手势选择切到 A），截图证明不是两次点击；再从 Conversations 行切回 B，截图证明只有 B 展开。
- `node scripts/ui-scenario.mjs scripts/ui-scenarios/project-row-session-open.json --base-url <dev-url>` 退出码 0，贴出 JSON 报告（`ok:true`）与检查点截图，均存 `tmp/`；诚实说明：现有场景无「Projects↔Conversations 切换」覆盖，本场景以 `open: "session"`（侧栏项目行 → 会话行）走项目行点击路径，不能证明 Conversations 行那条腿，那条腿只由单测 AC2 覆盖。
- 无 `server/` 下改动；`git diff --stat` 与 `## Touches` 逐条对齐（新增文件用 ASCII `(new)`）。
- AC3 的变异读数真的红过并 `git checkout -- <file>` 复原。

## Touches

- src/modules/sidebar/SidebarProjectItem.tsx
- src/modules/sidebar/hooks/useSidebarProjectsConcern.ts
- src/modules/sidebar/tests/projectToggleExpansion.test.tsx (new)
- src/shared/types.ts
- scripts/ui-scenarios/project-row-session-open.json (new)
- tasks/gap-sidebar-project-row-toggle-replayed-by-auto-expand.md

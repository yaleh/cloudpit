---
id: gap-sidebar-project-row-toggle-replayed-by-auto-expand
title: Projects 侧栏：已展开的非选中项目行应一次点击折叠（行 toggle 被选中后的 auto-expand 重放）
status: done
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

已批准的修复（1+2），最终形状：1. 行点击在同时改变选中时把该事实作为**位置参数**传给 toggle：`onToggleProject(projectId, selectionWillChange)`（`selectionWillChange: boolean`），`useSidebarProjectsConcern` 用 `selectionToggleProjectRef` 记录，并在 selectedProject effect 中消费一次、跳过本次手势自己的项目；2. auto-expand effect 写单开集合 `new Set([selectedProjectId])`，且 `toggleProject` 自身的展开写也是单开。实现没有采用 options-object（`{ selectionWillChange: true }`）：该类型会新增一段导出声明，把 `src/shared/types.ts` 顶过 oversize ratchet 基线，最终改为不新增类型的 boolean 位置参数。新增两个回归测试（新文件 `src/modules/sidebar/tests/projectToggleExpansion.test.tsx`）：a) 一次点击折叠「已展开且未选中」的项目，即使同一手势改变选中；b) 非行路径改变选中后，恰好只有新选中的项目展开。

<!-- dedup-ref --> 去重：以 `expandedProjects` / `toggleProject` / `onToggleProject` / `auto-expand` / `single-open` / `projectToggleExpansion` 检索任务库均为 0 命中；按 Touches 文件检索 todo/ready 任务无声明（本 agent 无 Bash，用 `task_list search` 替代 grep 与 granularity 脚本）。相关但不同机制的已落地任务：`gap-sidebar-project-row-actions-overflow-menu-uniform-height`（done，项目行控件/等高）、`gap-routine-architecture-analysis-god-package-src-sidebar`（done，hook 拆分），均未钉展开态 ⇒ 不重复，独立立案。合并判定：none found。

**实现状态（2026-11-06，本 worker 复核）。** 源码形状与立案时的最终方案一致：`src/shared/types.ts:3576` 为 `onToggleProject: (projectId: string, selectionWillChange?: boolean) => void`，`ProjectToggleOptions` 不存在；`src/modules/sidebar/SidebarProjectItem.tsx:236-246` 计算 `selectionWillChange` 并以 `onToggleProject(project.projectId, selectionWillChange)` 调用；`src/modules/sidebar/hooks/useSidebarProjectsConcern.ts:105-128` 的 effect 消费 `selectionToggleProjectRef` 一次并写单开集合，`:213-241` 的 `toggleProject` 在 `selectionWillChange` 时记录该 ref。实现、两条判据与场景文件已作为本分支提交 `2c287c7b4` 落地；读数见 `## Verification`。

范围：只动前端 sidebar 与 shared types；不修改 `server/`。

## AC

- [x] AC1（承重，行为）：新增 `src/modules/sidebar/tests/projectToggleExpansion.test.tsx`，其用例「one click collapses an expanded non-selected project row」在 `npx vitest run src/modules/sidebar/tests/projectToggleExpansion.test.tsx` 下退出码 0：准备项目 A（已展开、非选中）与项目 B（选中），点击 A 行一次后断言 A 不在 `expandedProjects`（`isProjectExpanded(A) === false`），且同一手势内 auto-expand effect 未把 A 重新加入（最终集合不含 A，而非仅瞬时为 false）；失败时打印点击后的展开集合。
- [x] AC2（承重，行为）：同一测试文件的用例「non-row selection change leaves exactly the newly selected project expanded」退出码 0：先让 A、B 两个项目都处于展开态，再经非项目行路径把选中改为 B（Conversations 行点击或会话路由同步），断言最终展开集合恰为 `{B}` 且 A 被折叠（单开不变式）；失败时打印最终集合。
- [x] AC3（承重，抗假）：把实现临时还原成修复前顺序（行点击不传 `selectionWillChange`，effect 改回在累积集合上 `add`）后，AC1、AC2 两条用例都变红；用 `git checkout -- <file>` 还原后两条复绿、`git status --porcelain` 对声明文件干净。逐条记录变异 diff 与逐字失败行；若不以变异而以上述最终展开集合断言取假，须证明修复前实现的读数必然让该断言失败。

## DoD

- 两条回归测试在 vitest 下通过：`npx vitest run src/modules/sidebar/tests/projectToggleExpansion.test.tsx` 退出码 0；且 `npx vitest run src/modules/sidebar/tests` 全绿、原有用例数不减少。
- `npm run typecheck` 通过（或 `npx tsc --noEmit -p tsconfig.json` 退出码 0）。
- 真实浏览器（MCP 或 Playwright）在真实运行的页面上把场景亲手走一遍并截图存 `tmp/`：项目列表里 A 已展开但未选中、B 选中；点 A 行一次后 A 收起（同一手势选择切到 A），截图证明不是两次点击；再从 Conversations 行切回 B，截图证明只有 B 展开。
- `node scripts/ui-scenario.mjs scripts/ui-scenarios/project-row-session-open.json --base-url <dev-url>` 退出码 0，贴出 JSON 报告（`ok:true`）与检查点截图，均存 `tmp/`；诚实说明：现有场景无「Projects↔Conversations 切换」覆盖，本场景以 `open: "session"`（侧栏项目行 → 会话行）走项目行点击路径，不能证明 Conversations 行那条腿，那条腿只由单测 AC2 覆盖。
- 无 `server/` 下改动；`git diff --stat` 与 `## Touches` 逐条对齐（新增文件用 ASCII `(new)`）。
- AC3 的变异读数真的红过并 `git checkout -- <file>` 复原。

## Verification

本 worker 在隔离 worktree（分支 `task/gap-sidebar-project-row-toggle-replayed-by-auto-expand`，实现提交 `2c287c7b4`）重跑了全部读数；下文的「worktree tmp」路径均相对该 worktree。

- 判据读数（本 worker）：`npx vitest run src/modules/sidebar/tests/projectToggleExpansion.test.tsx` → `1 file / 2 tests passed`，退出码 0（两次运行：修复后 2 passed；变异后 2 failed 见 AC3）。
- 目录读数（本 worker）：`npx vitest run src/modules/sidebar/tests` 默认并行时 `20 files / 125 tests`，其中 `SidebarProjectItemTaskCounts.test.tsx` 的 desktop 用例偶发 `Test timed out in 5000ms`（整目录跑 1 失败 / 单文件跑 2–4 失败，随宿主机负载变化）；同一文件在**未修改的 develop 工作树**（`cc5bf9947`）上以同样方式红 ⇒ 既有负载 flake，非本任务 delta。改以 `npx vitest run src/modules/sidebar/tests --no-file-parallelism` 串行复跑：`20 files / 125 tests passed`，退出码 0（原有用例数未减少：125 与立案时一致，含本任务新增 2 条）。
- 静态门（本 worker）：`npx tsc --noEmit -p tsconfig.json` → rc=0。
- AC3 变异（本 worker，两次腿）：
  - 腿 A（行点击不传 `selectionWillChange` + effect 改回累积 `add`）：两条用例都红。AC1 红在 `projectToggleExpansion.test.tsx:201`，字面读数 `assert.deepEqual(onToggleProject.mock.calls[0], [PROJECT_A.projectId, true])` 收到 `['a']`（缺 `true`）；AC2 红在 `:243`，`true !== false`（旧 expanded 集合仍含 A）。
  - 腿 B（仅 effect 改回累积 `add`，行点击保持修复形状）：AC1 红在控制器断言 `AssertionError: the auto-expand effect must not undo the collapse the same click asked for`（`true !== false`），证明重放确实存在；AC2 仍红在 `:243`。
  - 复原：`git checkout -- src/modules/sidebar/SidebarProjectItem.tsx`、`git checkout -- src/modules/sidebar/hooks/useSidebarProjectsConcern.ts` 后两条复绿（2 passed），且 `git status --porcelain` 对已跟踪的声明文件为空（仅剩被 .gitignore 的 `tmp/` 产物）。
- 真实浏览器（本 worker，真实 Chromium/Playwright，against 本 worktree 的 Vite dev + fixture 后端 `127.0.0.1:5391`，fixture 为 alpha/beta/gamma 三个项目、每项目两条会话）：截图在 worktree `tmp/browser/project-toggle-01..05*.png`，DOM 读数（`data-testid="sidebar-project-row"` 的 chevron/选中类）逐条：
  - 02：alpha 展开且选中（`expanded:true, selected:true`）。
  - 03（从 Conversations 行打开 beta 的会话后回 Projects）：`alpha expanded:false, selected:false`；`beta expanded:true, selected:true` ⇒ 非行路径的选中变化落成单开（修复前这里两个项目同时展开）。
  - 04：对**未选中**的 alpha 行**一次**点击 → `alpha expanded:true, selected:true`（同一手势完成展开与选中，不需要第二次点击）。
  - 05：再点一次 alpha → `alpha expanded:false, selected:true`（单击即折叠，无重放）。
  - 诚实偏差：DoD 字面要求的桌面态「A 已展开但未选中、B 选中」在修复后**不可达**——非选中行的展开只能来自无选中的 compact 卡片（<768px），而任何选中变化都会把非选中行收成单开。本 worker 在 390px 下用 compact 卡片确实造出了该态（读数：`alpha expanded:true, selected:false`，`beta expanded:true→false, selected:true`），但把视口拉回 1440px 时侧栏整体重挂载、`expandedProjects` 复位为自动展开的选中项（读数：`alpha expanded:false`），因此该腿没有桌面截图；它由 AC1 以控制器公开动词 `toggleProject(A)` 构造并用最终集合断言覆盖。另一条腿（Conversations 行切回 B 后只有 B 展开）由上述 03 读数覆盖。
- 场景运行器（本 worker）：`node scripts/ui-scenario.mjs scripts/ui-scenarios/project-row-session-open.json --base-url http://127.0.0.1:5391 --auth-token <fixture token> --project alpha --session "Alpha project chat" --out tmp/ui-scenarios/project-row-session-open` → 退出码 0，`ui-scenario: passed (4 steps, 7167ms, 4 checkpoint(s))`；报告 `tmp/scenario-report.json` 为 `ok:true`、`failedStep:null`、`stepCount:4`、`durationMs:7167`；四步均 `ok:true`（1 open:session、2 reload、3 open:session、4 reload），检查点截图 `tmp/ui-scenarios/project-row-session-open/step-1-open-session.png` … `step-4-reload.png`。诚实边界照 DoD：场景走的是项目行→会话行路径，Conversations 行那条腿仍只由单测 AC2 覆盖。
- 无 `server/` 改动：本分支相对 develop 的 `--stat` 只有 `src/modules/sidebar/SidebarProjectItem.tsx`、`src/modules/sidebar/hooks/useSidebarProjectsConcern.ts`、`src/shared/types.ts`、新增测试与新增场景文件，与 `## Touches` 逐条一致。
- 该轴仍暗,理由:本任务只改前端展开态的写入顺序与两个回归判据,没有 L_D(代码/文档) 或 L_G(架构图) 的可量化领域读数。
- 该轴仍暗,理由:同上一条;本任务未新增或修改 goal 判据,读数是展开集合与浏览器手势读数,不是轴读数。

## Touches

- src/modules/sidebar/SidebarProjectItem.tsx
- src/modules/sidebar/hooks/useSidebarProjectsConcern.ts
- src/modules/sidebar/tests/projectToggleExpansion.test.tsx (new)
- src/shared/types.ts
- scripts/ui-scenarios/project-row-session-open.json (new)
- tasks/gap-sidebar-project-row-toggle-replayed-by-auto-expand.md

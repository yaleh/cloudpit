---
id: gap-sidebar-project-row-toggle-replayed-by-auto-expand
title: Projects 侧栏：已展开的非选中项目行应一次点击折叠（行 toggle 被选中后的 auto-expand 重放）
status: ready
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

**最终现状（2026-11-06 复核）。** 本条立案初稿曾记「修复已存在、仅缺判据/场景」，该记录已过时并在此更正：当时读到的 options-object 形状不是最终实现，且判据、场景与浏览器证据其后已补齐。可逐字复核的最终源码：`src/shared/types.ts:3576` 的 `SidebarProjectListProps.onToggleProject` 为 `(projectId: string, selectionWillChange?: boolean) => void`，`ProjectToggleOptions` 类型已删除；`src/modules/sidebar/SidebarProjectItem.tsx:236-246` 计算 `selectionWillChange` 并在改变选中时以 `onToggleProject(project.projectId, selectionWillChange)` 调用；`src/modules/sidebar/hooks/useSidebarProjectsConcern.ts:213-241` 的 `toggleProject` 在 `selectionWillChange` 为真时写 `selectionToggleProjectRef`，`:105-128` 的 effect 消费该 ref 一次（跳过本次手势项目；若标记属于别的项目则丢弃，防止抑制后续无关选中），否则写 `new Set([selectedProjectId])`。落地产物：`src/modules/sidebar/tests/projectToggleExpansion.test.tsx`（2 条用例）与 `scripts/ui-scenarios/project-row-session-open.json`（4 步）均已存在；读数见 `## Verification`。该复核轮未勾 AC；本轮 worker 已逐条复跑判据并勾选（见 Verification 末段）。

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

实现与证据（以下源码/判据/场景/报告文件均已由本条逐字读取复核；测试与浏览器运行读数来自实现 agent / 协调者的报告）：

- 源码（已逐字复核）：`src/shared/types.ts:3576` 为位置参数 `onToggleProject: (projectId: string, selectionWillChange?: boolean) => void`，`ProjectToggleOptions` 已不存在；`src/modules/sidebar/SidebarProjectItem.tsx:42` 的行 props 同为位置参数，`:236-246` 计算并传递 `selectionWillChange`（`onToggleProject(project.projectId, selectionWillChange)`）；`src/modules/sidebar/hooks/useSidebarProjectsConcern.ts:213-241` 的 `toggleProject` 在 `selectionWillChange` 时记录 `selectionToggleProjectRef` 并把展开集合写成单开，`:105-128` 的 selectedProject effect 消费该 ref 一次并跳过，否则写 `new Set([selectedProjectId])`。
- 判据（新文件已逐字复核）：`src/modules/sidebar/tests/projectToggleExpansion.test.tsx` 含两条用例，名称分别为 `one click collapses an expanded, not-selected project instead of being replayed by the auto-expand effect` 与 `a selection change from outside the Projects row leaves exactly the newly selected project expanded`。
- 判据读数（实现 agent 报告）：两条用例在修复前树上 `2 failed`，修复后 `2 passed`；整个 `src/modules/sidebar/tests` 目录 `20 files / 125 tests passed`。
- 场景（新文件已逐字复核）：`scripts/ui-scenarios/project-row-session-open.json` 含 4 步（alpha 会话 → reload → beta 会话 → reload），每步 `checkpoint: true`。运行读数：`node scripts/ui-scenario.mjs ...` 退出码 0，4 步全过；报告文件 `tmp/ui-scenarios/project-row-session-open/report.json` 已复核为 `ok: true`、`failedStep: null`、`stepCount: 4`、`durationMs: 6224`、`baseUrl: http://127.0.0.1:5391`；检查点截图 `tmp/ui-scenarios/project-row-session-open/step-1-open-session.png`、`step-2-reload.png`、`step-3-open-session.png`、`step-4-reload.png`（路径逐条列在报告 `checkpoints[]` 中）。
- 真实浏览器（实现 agent 报告）：真实 Chromium 对隔离 dev 实例操作，截图 `tmp/project-toggle-fixed-01..05.png`；从 Conversations 会话切到 beta 后仅 beta 展开（修复前 alpha、beta 同时展开）；点 alpha 一次展开，再点一次折叠。
- 静态门（实现 agent 报告）：`npx tsc --noEmit -p tsconfig.json` rc=0；architecture-ratchet 与 frontend-import-cycle-budget 合计 12/12 通过。
- Landing（协调者报告）：实现已合入 `develop`，提交 `47ae7b8a3`（`fix(sidebar): make a project row collapse in one click`），5 个文件（`SidebarProjectItem.tsx`、`useSidebarProjectsConcern.ts`、`shared/types.ts`、`tests/projectToggleExpansion.test.tsx`、`scripts/ui-scenarios/project-row-session-open.json`），working tree 干净。MCP 浏览器复核（1440x900、隔离 dev 实例、一次性测试账号）：打开 alpha 会话 → 切 Conversations 并打开 beta 会话 → 回 Projects，读数 alpha `expanded=false` / beta `expanded=true`（单开）；点 alpha 一次展开，再点一次折叠；截图 `tmp/mcp-project-toggle-01..05-*.png`；复核后已清除浏览器 localStorage 的 auth token 并停止隔离服务器。提交树上场景 runner 仍绿：4 步 / 4 检查点，报告 `tmp/ui-scenarios/project-row-session-open/report.json`。注：`develop` 当前 tip 已被后续 `tasks:` 提交推进（本次复核读到 `8e6ea29a`），故 `47ae7b8a3` 非 tip，但协调者报告其为该修复的落地提交。
- 状态：该复核轮未勾选任何 AC、未推进 lifecycle，任务保持 `ready`，只更新 task body。
- **本轮 worker 复核（2026-11-06）。** 上一轮因分支落后 develop 在 ff 段 `not a fast-forward` 退出；本轮按无锁段步骤重新 `git merge --no-edit develop`（合并提交 `081f7c132`，无冲突），未重做实现——`git diff develop HEAD -- src scripts` 为空，5 个落地产物与 develop 逐字一致。
  - AC1/AC2 读数：`npx vitest run src/modules/sidebar/tests/projectToggleExpansion.test.tsx` → `Test Files 1 passed (1)` / `Tests 2 passed (2)`（13.13s），两条用例名与上述一致。
  - AC3 变异读数：临时改 `SidebarProjectItem.tsx` 把 `onToggleProject(project.projectId, selectionWillChange)` 改为 `onToggleProject(project.projectId)`，并把 effect 的单开写 `new Set([selectedProjectId])` 改回累积 `add`；重跑同一文件 → `Tests 2 failed (2)`，逐字失败行：`AssertionError: the row click must tell the toggle that the same gesture changes the selection` 与 `AssertionError: the project that was expanded before the selection change must close (single-open)`。`git checkout --` 两个文件后重跑 → `Tests 2 passed (2)`；`git status --porcelain` 为空。
  - 反漂移门：`anti-drift-touches-check.js --task gap-sidebar-project-row-toggle-replayed-by-auto-expand --worktree <worktree> --merge-target develop` → `ANTI-DRIFT OK: ... 1 actual file(s), all within declared Touches (6 glob(s))`，exit 0（相对 develop 仅任务文件本身）。
- L_D/L_G：该轴仍暗,理由:本条是 Projects 侧栏行点击展开态的前端行为修复，未新增或移动架构实体，无可测的 L_D/L_G 读数。

## Touches

- src/modules/sidebar/SidebarProjectItem.tsx
- src/modules/sidebar/hooks/useSidebarProjectsConcern.ts
- src/modules/sidebar/tests/projectToggleExpansion.test.tsx (new)
- src/shared/types.ts
- scripts/ui-scenarios/project-row-session-open.json (new)
- tasks/gap-sidebar-project-row-toggle-replayed-by-auto-expand.md

## Blocker

**2026-11-06T07:14:23.305Z — worker 未落地（exited-not-landed）**

- 未落地原因：step=ff: fan-in-ff-merge: suite 证书 — suite_head..tip 恰为本任务的单个 flip-done 提交（身份判定：仅 M tasks/gap-sidebar-project-row-toggle-replayed-by-auto-expand.md）⇒ 判惰性，⛔ 未调分类器
fan-in-ff-merge: FF FAILED — fatal: Not possible to fast-forward, aborting.; not a fast-forward. Retry record written (attempt 1). Return to 无锁段 step 1 (merge develop again — 必须 merge 不得 rebase, AC75), re-judge the delta (step 2) and re-run.
fan-in-ff-merge: measure ff_only_locked=false
- run_id：wk-prod-anchor
- session_id：17994772-cb78-4f41-aa90-565c12316478
- 续做记录（2026-11-06）：已按指引重新 merge develop（`081f7c132`）并复跑判据，工作树干净，等待 fan-in 重跑。

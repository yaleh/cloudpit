---
id: gap-service-line-ratchet-module-standard
title: 把 reply-suggestions 的 260 行 ratchet 与 React-free controller 纪律写进前后端模块标准
status: ready
labels:
  - gap
parent: null
children: []
extra:
  schema: execution
---
## Proposal

<!-- dedup-ref --> 相关已完成任务：`gap-reply-suggestions-backend-encapsulation`（确立「service 控制在 260 行」纪律的那条提交所在）已 done。本任务把那条只存在于 commit 消息的局部约定升格为模块标准。

reply-suggestions 重构把 `reply-suggestions.service.ts` 压到 258 行，但「service 超约 260 行必须再切关注点」只是那条提交的局部纪律，没写进 `.agents/skills/backend-module-standards/SKILL.md`。结果是次日又长出 829 行的 `quay-task-events.service.ts` 与 931 行的 `refreshJob.ts`。本任务把该纪律写进后端标准（后端 service/单文件超约 260 行须按关注点再切文件，工厂 + 类型化对象 + 注入 seam，以 reply-suggestions 为正例），并在前端标准补对应规则（hook 不得持有业务规则，规则进 React-free controller，以 `useReplySuggestions` 为正例）。只改两个 SKILL.md，不改代码。

## AC

- [x] 后端规则落地：`grep -n "260" .agents/skills/backend-module-standards/SKILL.md` 命中一条以「约 260 行」为阈值的切分规则，且该规则点名 `server/modules/reply-suggestions/reply-suggestions.service.ts` 为正例。
- [x] 前端规则落地：`grep -n "React-free\|controller" .agents/skills/frontend-module-standards/SKILL.md` 命中一条要求「业务规则抽入 React-free controller、不得持有在 hook」的规则，且点名 `useReplySuggestions` 为正例。
- [x] 仅改标准：`git diff --stat -- .agents/skills/` 只含两个 SKILL.md；`git diff --name-only -- server/ src/` 无输出。

## DoD

用新规则逐条自检两个真实文件并贴出对照：`server/modules/quay/quay-task-events.service.ts`（829 行）与 `server/modules/architecture/refreshJob.ts`（931 行）被新规则判为「违反」，`reply-suggestions.service.ts`（258 行）被判为「符合」。贴出两条 SKILL.md 的 diff 与三份对照结论。

### 三份对照结论（`wc -l` 实测于 task worktree）

| 文件 | 行数 | 新规则判定 | 依据 |
| --- | --- | --- | --- |
| `server/modules/quay/quay-task-events.service.ts` | 829 | **违反** | 829 > 约 260 行；单文件承载多关注点，未按「工厂 + 类型化对象 + 注入 seam」再切兄弟文件 |
| `server/modules/architecture/refreshJob.ts` | 931 | **违反** | 931 > 约 260 行；单文件承载多关注点，未按「工厂 + 类型化对象 + 注入 seam」再切兄弟文件 |
| `server/modules/reply-suggestions/reply-suggestions.service.ts` | 258 | **符合** | 258 ≤ 约 260 行；`createReplySuggestionsService(deps)`（:131）工厂返回 typed `ReplySuggestionsService`，依赖经 `ReplySuggestionsServiceDeps` 注入；gateway/draw-store/prompts/chips/usage-log 已拆到兄弟文件 |

### 两条 SKILL.md 的 diff

```diff
diff --git a/.agents/skills/backend-module-standards/SKILL.md b/.agents/skills/backend-module-standards/SKILL.md
@@ -24,6 +24,13 @@
 - Do not create module-local `types.ts`, `interfaces.ts`, or `utils.ts` files.
 - Keep module-private implementation details unexported.
 
+## Split files by concern at the line ratchet
+
+- Treat roughly 260 lines (约 260 行) as the ceiling for one backend service or implementation file. A file that reaches about 260 lines is due for a split: do not keep growing it, and do not split it by arbitrary line ranges.
+- Split by concern, not by count. The orchestration service keeps the request shape, the state it owns, and the composition; each distinct concern moves to its own descriptively named sibling file (for example `-draw.ts`, `-draw-store.ts`, `-prompts.ts`, `-chips.ts`, `-usage-log.ts`).
+- Compose the parts with a factory (`create<Feature>Service(deps)`) that returns a typed object, and pass collaborators through an injected dependency seam instead of importing concretes ad hoc. The factory keeps the public surface stable while the concerns live in separate files with their own tests.
+- The exemplar is `server/modules/reply-suggestions/reply-suggestions.service.ts` (258 lines): it keeps the route input type, per-session draw state and ledger rows, is built by `createReplySuggestionsService(deps)`, and delegates the gateway call, draw store, prompts, chip parsing and typed ledger rows to sibling files. Use it as the shape to copy when a file crosses the ratchet.
+
 ## Place types, interfaces, and utilities
@@ -60,5 +67,6 @@ Before finishing:
 1. Confirm all cross-module imports use `index.ts` barrels and all public exports are necessary and documented.
 2. Confirm shared definitions follow the one-use versus multiple-use placement rule and grouping-comment format.
-3. Confirm routes only parse, call services, and format responses.
-4. Run the narrow relevant tests, then `npm run build`, `npm run typecheck`, and `npm run lint` when the task scope and environment permit.
+3. Confirm no backend service or implementation file has crossed the roughly 260-line ratchet without being split by concern through a factory and injected seam.
+4. Confirm routes only parse, call services, and format responses.
+5. Run the narrow relevant tests, then `npm run build`, `npm run typecheck`, and `npm run lint` when the task scope and environment permit.
```

```diff
diff --git a/.agents/skills/frontend-module-standards/SKILL.md b/.agents/skills/frontend-module-standards/SKILL.md
@@ -116,6 +116,13 @@
 - Do not move a module-private hook into shared code merely because multiple components within the same module use it.
 - Search for an existing equivalent hook before adding a new one.
 
+## Keep business rules out of hooks
+
+- A hook must not hold business rules. Request gating, caching and cache invalidation, ordering, stale-answer guards, retry/depth limits, sequencing and reporting belong to a React-free controller, not to React state, refs, or effects.
+- A hook is the React binding only: create the controller once (for example with `useMemo`), subscribe to its snapshot with `useSyncExternalStore`, hand changed inputs to it in an effect, and dispose it on unmount. Translate the snapshot into props and callbacks; do not re-implement its decisions.
+- Put the controller in `src/modules/<feature>/utils/` with a descriptive name. Export a factory (`create<Feature>Controller(deps)`) that returns one typed object exposing commands plus a stable `getSnapshot`, and take the API client, cache, timers, and other collaborators through an injected dependency seam so the rules are testable without React.
+- The exemplar is `useReplySuggestions` (`src/modules/chat/hooks/useReplySuggestions.ts`): the hook is a thin `useSyncExternalStore` binding over the React-free controller in `src/modules/chat/utils/replySuggestionsController.ts`, which owns every draw rule and its injected API and cache. Copy that split whenever a hook starts deciding something.
+
 ## Place contexts by ownership
@@ -171,4 +178,5 @@ Before finishing:
 5. Confirm types, utilities, constants, hooks, contexts, UI components, modals, and tests follow their ownership and usage rules.
 6. Confirm shared types, utilities, and constants use the required comments and grouping separators.
 7. Confirm every newly introduced state declaration explains why it exists or is marked as possibly unnecessary.
-8. Run the narrow relevant frontend tests, followed by `npm run test:client`, `npm run build:client`, `npm run typecheck`, and `npm run lint` when the task scope and environment permit.
+8. Confirm no hook holds business rules that belong in a React-free controller, and that any new controller is a factory over an injected dependency seam.
+9. Run the narrow relevant frontend tests, followed by `npm run test:client`, `npm run build:client`, `npm run typecheck`, and `npm run lint` when the task scope and environment permit.
```

### AC 机械复核

- `grep -n "260" .agents/skills/backend-module-standards/SKILL.md` → `29:- Treat roughly 260 lines (约 260 行) …`（并点名 `server/modules/reply-suggestions/reply-suggestions.service.ts` 为 exemplar）
- `grep -n "React-free\|controller" .agents/skills/frontend-module-standards/SKILL.md` → `121`–`124`（规则 + 点名 `useReplySuggestions`）
- `git diff --stat -- .agents/skills/` → 仅两个 SKILL.md（19 insertions, 3 deletions）；`git diff --name-only -- server/ src/` → 无输出

## Touches

- .agents/skills/backend-module-standards/SKILL.md
- .agents/skills/frontend-module-standards/SKILL.md
- tasks/gap-service-line-ratchet-module-standard.md

## Blocker

**2026-10-25T19:06:00.404Z — worker 未落地（exited-not-landed）**

- 未落地原因：step=suite: # fail 0
- run_id：wk-prod-anchor
- session_id：0ddc93ed-093c-415f-a6b8-c76b13acfb1d

## Needs-Human

**执行 2026-10-25T19:06:01.600Z — 停派终止（失败无法归因，⛔ 不再重派）**

- 阻碍原因：exited-not-landed 失败无法归因（基建/契约疑似，非实现缺陷）——停止重派，⛔ 不再拿新会话撞同一堵墙：suite red could not be attributed to any failing test file in 2 consecutive rounds (bounded to at most one retry) — infra/contract suspected, not an implementable defect (parser extracted 0 of 0 failing lines and attributed none to a file); stopping instead of spending another worker session
- 失败步/判词：step=suite: # fail 0
- run_id：wk-prod-anchor
- session_id：0ddc93ed-093c-415f-a6b8-c76b13acfb1d
- suite 日志：/data/home/yale/work/claudecodeui/.quay/fan-in-suite-gap-service-line-ratchet-module-standard~wk-prod-anchor~1792953436561-74f8ee.log
- fan-in 日志：/data/home/yale/work/claudecodeui/.quay/fan-in-gap-service-line-ratchet-module-standard-wk-prod-anchor.log

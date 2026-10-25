---
id: gap-service-line-ratchet-module-standard
title: 把 reply-suggestions 的 260 行 ratchet 与 React-free controller 纪律写进前后端模块标准
status: todo
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

- [ ] 后端规则落地：`grep -n "260" .agents/skills/backend-module-standards/SKILL.md` 命中一条以「约 260 行」为阈值的切分规则，且该规则点名 `server/modules/reply-suggestions/reply-suggestions.service.ts` 为正例。
- [ ] 前端规则落地：`grep -n "React-free\|controller" .agents/skills/frontend-module-standards/SKILL.md` 命中一条要求「业务规则抽入 React-free controller、不得持有在 hook」的规则，且点名 `useReplySuggestions` 为正例。
- [ ] 仅改标准：`git diff --stat -- .agents/skills/` 只含两个 SKILL.md；`git diff --name-only -- server/ src/` 无输出。

## DoD

用新规则逐条自检两个真实文件并贴出对照：`server/modules/quay/quay-task-events.service.ts`（829 行）与 `server/modules/architecture/refreshJob.ts`（931 行）被新规则判为「违反」，`reply-suggestions.service.ts`（258 行）被判为「符合」。贴出两条 SKILL.md 的 diff 与三份对照结论。

## Touches

- .agents/skills/backend-module-standards/SKILL.md
- .agents/skills/frontend-module-standards/SKILL.md
- tasks/gap-service-line-ratchet-module-standard.md
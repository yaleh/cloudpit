---
id: gap-notices-react-free-controller
title: 把 useNotices 的 poll/失败保底/409 规则抽成 React-free noticesController
status: ready
labels:
  - gap
parent: null
children: []
extra:
  schema: execution
---
## Proposal

<!-- dedup-ref --> 先例 `gap-reply-suggestions-frontend-controller`（done）：把 `useReplySuggestions` 的规则抽成 `createReplySuggestionsController`。本任务把同一先例套到 `useNotices`，kept separate（不同模块、不同规则簇）。

`src/modules/notices/useNotices.ts`（157 行）在 hook 内持有 poll 循环（15s `setInterval`）、`hasReading` 失败保底（首次失败→unavailable，之后失败→保留上次好读数）、409→静默重读、dismiss→refresh 等规则。按 frontend 标准第 122 条「hook 只是 React 绑定」，抽成 `createNoticesController({list, dismiss, clock})` 返回 `{subscribe, getSnapshot, refresh, dismiss, dispose}`，规则全部迁入；hook 只留 `useSyncExternalStore` 订阅与转发参数。行为保持：poll 周期、失败保底、409 语义不变。

## AC

- [x] controller 落地：`grep -n "createNoticesController" src/modules/notices/noticesController.ts` 命中工厂导出，返回 `{subscribe, getSnapshot, refresh, dismiss, dispose}`。
- [x] hook 变薄：`wc -l src/modules/notices/useNotices.ts` ≤ 80 且 `grep -c "setInterval" src/modules/notices/useNotices.ts` 输出 0。
- [x] 规则可离 React 测试：新增 `src/modules/notices/tests/noticesController.test.ts`，注入假 list/dismiss/clock 覆盖「poll 每 15s 触发」「首次失败→unavailable、之后失败→保留上次好读数」「dismiss 遇 409→静默重读」「dispose 清 timer」；`npx vitest run src/modules/notices/tests/noticesController.test.ts` exit 0。
- [x] 消费方不回归：`npx vitest run src/modules/notices/tests/NoticeInbox.test.tsx src/modules/notices/tests/NoticeSlot.test.tsx` exit 0。
- [x] 类型检查：`npx tsc --noEmit -p tsconfig.json` exit 0；`npx oxlint src/modules/notices` exit 0。

## DoD

用真实 `createNoticesController`（注入假 list/dismiss/clock）驱动并贴输出：poll 每 15s 触发一次、`dispose()` 后 clock 不再触发任何 poll（timer 已清）；list 首次失败→`unavailable`、之后失败→保留上次好读数；dismiss 遇 409→静默重读。`NoticeInbox`/`NoticeSlot` 测试 green（贴命令输出）。

## Evidence

- AC1：`grep -n "createNoticesController" src/modules/notices/noticesController.ts` → `147:export function createNoticesController({`；工厂返回 `{ subscribe, getSnapshot, refresh, dismiss, dispose }`。
- AC2：`wc -l src/modules/notices/useNotices.ts` → `79 src/modules/notices/useNotices.ts`；`grep -c "setInterval" src/modules/notices/useNotices.ts` → `0`。
- AC3 / DoD（真实 controller + 假 list/dismiss/clock）：`npx vitest run src/modules/notices/tests/noticesController.test.ts` → `Test Files 1 passed (1)` / `Tests 6 passed (6)`，覆盖 (a) 创建即读一次、之后每 `NOTICES_POLL_INTERVAL_MS`=15000 触发一次；(b) 首次失败→`unavailable`，随后好后失败→同一份好读数（快照 identity 不变）；(c) 409→静默重读且不报错；(d) 200 后重读；(e) dismiss 抛错→保留读数；(f) `dispose()` 后 clock.pending()=0、clock 不再触发 poll、迟到的读数不通知。
- AC4：`npx vitest run src/modules/notices/tests/NoticeInbox.test.tsx src/modules/notices/tests/NoticeSlot.test.tsx` → `Test Files 2 passed (2)` / `Tests 12 passed (12)`。
- AC5：`npx tsc --noEmit -p tsconfig.json` exit 0；`npx oxlint src/modules/notices` exit 0（一条 `react/refs` warning：hook 把 ports 放进 ref、只在 controller 回调里读取；该规则全仓仍为 warn）。

## Touches

- src/modules/notices/useNotices.ts
- src/modules/notices/noticesController.ts (new)
- src/modules/notices/tests/noticesController.test.ts (new)
- src/modules/notices/tests/NoticeInbox.test.tsx
- src/modules/notices/tests/NoticeSlot.test.tsx
- tasks/gap-notices-react-free-controller.md
---
id: cockpit-card-session-executors
title: 驾驶舱卡片执行器：session.send（经 chatControl 发进会话）与 session.start（经
  createAppSession 开新会话并立即切过去），「自己的回复」按卡片主体给默认执行器
status: todo
labels:
  - feature
  - cockpit
parent: null
children: []
extra:
  schema: execution
goal_ac: AC-428
---
## Proposal

来源：本会话 2026-10-27。`cockpit-card-provider-contract-and-registry` 只交付了夹具执行器 `fixture.record`，确认后什么都不会真的发生；`cockpit-card-ui-core` 的完成记录写明「自己的回复」只在提供方声明 `ownReply` 的卡片上出现，而用户确认的卡片模型是「下拉末项一律是自己的回复」。设计稿 `docs/architecture/cockpit-attention/CARD-PROVIDERS.md` 第 2 节：CloudCLI 自带 `session.send`（发给会话）与 `session.start`（在左侧开新会话并立即切过去）两个执行器。

做什么：

- 两个执行器类，实现 `ICockpitActionExecutor`，放在 `server/modules/cockpit/`：
  - `cockpit-session-send.executor.ts`：params `{ sessionId, text }`（自己的回复时文本取确认通道加入的 `reply`）。经注入的发送函数发出；组合根把它绑定到与驾驶舱 hub 同一个 `chatControl.send({ userId, via }, { sessionId, content })`（见 `server/index.ts` 里 `createCockpitModule` 的 `send`）。发送被拒（`result.ok === false`）时抛 `AppError`，带该错误码，确认接口返回非 2xx，不报成功。
  - `cockpit-session-start.executor.ts`：params `{ project, initialMessage, provider? }`。`project` 先按 quay-fleet 注册表 id 解析成项目路径，解析不到再当路径用；经注入的建会话函数调用 `sessionsService.createAppSession(provider, projectPath, initialMessage, selection)`（与 MCP `session_create` 同一路径，见 `server/modules/mcp-gateway/mcp-session-write-deps.ts`），返回 `{ sessionId, projectPath }`。
- 「自己的回复」的默认执行器：在 `server/modules/cockpit/cockpit-card-registry.ts` 的投影里，卡片未声明 `ownReply` 时按主体补上——带 `subject.sessionId` 用 `session.send` 写回原会话；只带 `subject.project` 用 `session.start` 在该项目开新会话（第一条消息就是用户写的回复）；两者都没有则不补，并在投影里给出可读原因 `ownReplyUnavailable`。这是按主体推出的内容默认值，不是语义判断；提供方声明了 `ownReply` 时以提供方为准。
- 模块边界：`modules/cockpit` 在 AC-394 下是叶子，不得导入兄弟模块，所以两个执行器只依赖注入函数；绑定写在新文件 `server/cockpit-executors-wiring.ts`（仿照现有 `server/cockpit-brief-wiring.ts`），在 `createCockpitCardsModule` 的 `executors` 参数里传入。`server/index.ts` 在 architecture-ratchet 的超长基线里（2769 行），新增的接线行要在同文件等量删减，或按基线 note 的 RECORDED CHANGE 格式记录。
- 前端：`src/modules/cockpit/cockpitCardController.ts` 在确认结果的 `executor === 'session.start'` 时发出 `sessionStarted { sessionId }`；`src/modules/cockpit/hooks/useCockpitCards.ts` 收到后立即导航到 `/session/<sessionId>`（用户 10-27 确定：立即切到新会话）。卡片 Details 的「Start a conversation about this」走同一确认路径与同一执行器。
- 夹具提供方：为 DoD 给夹具卡片补上真实主体——每张卡片的 `subject` 可由 server.settings.json 的 `cockpit.fixtureSubject`（`{ sessionId?, project? }`，默认空）覆盖，便于在隔离实例里对一个复制来的会话真实发送。

## AC

- [ ] `npx tsx --tsconfig server/tsconfig.json --test server/modules/cockpit/tests/cockpit-session-executors.test.ts` 退出 0（AC-428 判据）：发送函数与建会话函数注入为桩；覆盖 session.send 恰好一次且目标与文本正确、自己的回复文本取 `reply`、发送被拒时确认失败且错误码透传、session.start 恰好一次且返回新会话 id、注册表 id 与路径两种 project 写法、ownReply 三种默认（有会话 / 只有项目 / 都没有）、提供方声明的 ownReply 优先。
- [ ] 假形态各自变红：确认后发送两次 ⇒ 用例红；发送被拒仍返回 ok ⇒ 用例红；只带项目的卡片把自己的回复发向任意现有会话 ⇒ 用例红。每个假形态改完即还原。
- [ ] `npx vitest run src/modules/cockpit/tests/cockpitCardController.test.ts` 退出 0，并新增用例：确认结果为 session.start 时 controller 发出 `sessionStarted` 且带新会话 id；其它执行器不发。
- [ ] `npx tsx --tsconfig server/tsconfig.json --test server/modules/cockpit/tests/cockpit-card-registry.test.ts` 退出 0（既有用例不减）。
- [ ] `npx tsx --tsconfig server/tsconfig.json --test server/shared/tests/server-import-cycle-budget.test.ts` 与 `npx tsx --tsconfig server/tsconfig.json --test server/shared/tests/architecture-ratchet.test.ts` 均退出 0。
- [ ] `npm run typecheck` 与 `npm run lint` 退出 0（lint 仅既有 warning）。

## DoD

在隔离实例（`scripts/isolated-instance.sh start`，residentRestore 已关闭，库是复制来的）里打开 `cockpit.fixtureCards`，把 `cockpit.fixtureSubject.sessionId` 设为复制库里一个已结束、无人在用的会话。用真实浏览器（MCP 浏览器；不可用时按项目备忘用一次性 Playwright）打开 `/cockpit?view=cards`：

1. 在一张卡片上写自己的回复并确认 ⇒ 该会话的转写里多出这一条用户消息，贴出转写尾部；确认接口响应带 `executor: session.send`。
2. 把 `fixtureSubject` 改为只带 `project`，重启后在一张卡片上用自己的回复确认 ⇒ 页面立即切到 `/session/<新 id>`，新会话的第一条消息就是该回复；贴出 URL 与截图。
3. 让发送被拒（例如指向不存在的 sessionId）⇒ 页面显示错误，不显示成功；贴出响应。

截图存 `tmp/`。不得对线上实例或真实在用的会话发送任何消息。实例用毕 `scripts/isolated-instance.sh stop`。

## Touches

- tasks/cockpit-card-session-executors.md
- server/modules/cockpit/cockpit-session-send.executor.ts (new)
- server/modules/cockpit/cockpit-session-start.executor.ts (new)
- server/modules/cockpit/cockpit-card-registry.ts
- server/modules/cockpit/cockpit-fixture-card-provider.ts
- server/modules/cockpit/cockpit.module.ts
- server/modules/cockpit/index.ts
- server/modules/cockpit/tests/cockpit-session-executors.test.ts (new)
- server/modules/cockpit/tests/cockpit-card-registry.test.ts
- server/cockpit-executors-wiring.ts (new)
- server/index.ts
- server/modules/settings/server-settings.ts
- server/shared/types.ts
- src/shared/types.ts
- src/shared/tests/cockpitCardTypeSync.test.ts
- src/modules/cockpit/cockpitCardController.ts
- src/modules/cockpit/hooks/useCockpitCards.ts
- src/modules/cockpit/tests/cockpitCardController.test.ts
- server/shared/tests/architecture-ratchet.baseline.json
- server/shared/tests/server-import-cycle-budget.test.ts
- server/shared/tests/quay-test-script.test.ts
- scripts/suite-duration-baseline.tsv

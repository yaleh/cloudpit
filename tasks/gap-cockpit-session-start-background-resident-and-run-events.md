---
id: gap-cockpit-session-start-background-resident-and-run-events
title: 驾驶舱新开会话改为后台常驻、bypassPermissions、不跳转；补写会话这轮跑完与会话关闭两种事件
status: ready
labels:
  - gap
  - cockpit
parent: null
children: []
extra: {}
---
## Proposal

来源：2026-10-28 线上。用户在驾驶舱确认 fleet 卡 `att_94edac259017` 的「重新评估计划」（executor `session.start`，project `quay-fleet`）后：界面立刻跳进新会话 `9d7d7565-c611-49e3-ac38-d72bec942cfb`，该会话 `permission_mode` 为空、`lifecycle_mode = per-run`，第一个 Bash（`cat`）就停在权限确认上。

用户定下的行为：开新会话可以，但**不要马上在 CloudCLI 打开**——开发者默认系统会在后台推进相应工作；新会话应当是 **resident** 会话，权限用 **bypassPermissions**。

现状（已查）：

- `server/cockpit-executors-wiring.ts` 的 `start` 只做 `sessions.createAppSession(provider, projectPath, initialMessage)` + `control.send(...)`，不写生命周期偏好也不写权限模式。MCP `session_create`（`server/modules/mcp-gateway/mcp-session-lifecycle.ts`）已有同一件事的正确写法：claude 缺省 `resident`，`permissionMode` 在首条消息之前写入行，首条 send 也带上它。
- `src/modules/cockpit/hooks/useCockpitCards.ts:194` 收到 `sessionStarted` 就 `navigate('/session/…')`。
- fleet 后续要据「交给的那个会话结束了没有」判断要不要重新提起一件事，但 CloudCLI 写进 `~/.quay-fleet/context/events/` 的事件里没有「会话这轮跑完了」与「会话已关闭」（现有 kind：utterance、chip.*、session.asking/answered、shadow.*、focus、send.previewed）。

做什么：

1. **后台常驻、足够权限**：`session.start` 新开的会话按服务端设置 `cockpit.sessionStart`（`server.settings.json`，`server/modules/settings/server-settings.ts` 读取）建行：`lifecycleMode` 缺省 `resident`、`permissionMode` 缺省 `bypassPermissions`；两者都在首条消息发出之前写进行，首条 send 也带上 `permissionMode`，与 MCP `session_create` 同一写法（复用它的偏好写入，不另写一份）。provider 不支持该权限模式时照实拒绝，不悄悄降级。
2. **不跳转**：确认成功后驾驶舱不再导航到新会话；`sessionStarted` 事件仍发出（卡片据它显示「打开会话 ›」链接，由人决定何时打开）。
3. **会话运行事件**：经与 `session-ask-events.port.ts` 同形的端口，向上下文事件流补写两种 kind：`session.run.ended`（一轮运行结束：`session`、`runId`、`outcome` = completed/aborted/failed、`at`）与 `session.closed`（常驻宿主关闭或会话被删除/归档：`session`、`reason`）。事件放在新文件里写（`context-event-writer.ts` 已 794 行，贴着 800 行 ratchet）；写失败只记日志，永不影响聊天。

## AC

- [ ] `npx tsx --tsconfig server/tsconfig.json --test server/modules/cockpit/tests/cockpit-session-executors.test.ts` 退出 0，新增用例：`session.start` 建出的行 `lifecycle_mode = resident`、`permission_mode = bypassPermissions`，且偏好写入先于首条 send（用注入的桩记录调用次序）；`cockpit.sessionStart` 设置改为 `per-run` / `default` 时照设置生效；provider 不支持所设权限模式时返回 400 类错误且没有建行。
- [ ] `npx tsx --tsconfig server/tsconfig.json --test server/modules/context-events/tests/session-run-events.test.ts` 退出 0：一轮运行完成、被中止、失败各写出一行 `session.run.ended`（outcome 照实）；常驻宿主关闭写出 `session.closed`；写入器抛错时聊天调用方不受影响。
- [ ] `npx vitest run src/modules/cockpit/tests/cockpitCardController.test.ts` 退出 0，新增用例：`session.start` 确认成功后仍发出 `sessionStarted`；`useCockpitCards` 的缺省绑定不再导航（用注入的 navigate 桩断言调用 0 次）。
- [ ] 假形态变红：把 wiring 里的权限写入删掉 ⇒ 第一条用例红；把导航调用加回去 ⇒ 第三条用例红；改完即还原。
- [ ] `npx tsx --tsconfig server/tsconfig.json --test server/shared/tests/server-import-cycle-budget.test.ts`、`npx tsx --tsconfig server/tsconfig.json --test server/shared/tests/architecture-ratchet.test.ts` 退出 0；`npm run typecheck`、`npm run lint` 退出 0（lint 仅既有 warning）。

## DoD

隔离实例（`scripts/isolated-instance.sh`，关 residentRestore，fleet home 指向临时副本，⛔ 不写真实 `~/.quay-fleet`；只点夹具卡片）：

1. 打开驾驶舱，对一张 `session.start` 夹具卡确认；截图证明页面仍停在原处、卡上出现「打开会话」链接。读新会话行，贴出 `lifecycle_mode` 与 `permission_mode`。
2. 新会话首轮里含一次 Bash 调用（夹具首条消息让它跑 `ls`），贴出它没有出现权限确认、这一轮正常结束的读数，以及临时事件目录里的 `session.run.ended` 行。
3. 关掉该常驻会话，贴出 `session.closed` 行。

截图存 `tmp/`；实例用毕 `scripts/isolated-instance.sh stop`。

## Touches

- tasks/gap-cockpit-session-start-background-resident-and-run-events.md
- server/cockpit-executors-wiring.ts
- server/modules/cockpit/cockpit-session-start.executor.ts
- server/modules/cockpit/tests/cockpit-session-executors.test.ts
- server/modules/settings/server-settings.ts
- server/modules/context-events/session-run-events.ts (new)
- server/modules/context-events/index.ts
- server/modules/context-events/tests/session-run-events.test.ts (new)
- server/shared/ports/session-run-events.port.ts (new)
- server/index.ts
- src/modules/cockpit/hooks/useCockpitCards.ts
- src/modules/cockpit/tests/cockpitCardController.test.ts
- server/shared/tests/architecture-ratchet.baseline.json
- server/shared/tests/server-import-cycle-budget.test.ts

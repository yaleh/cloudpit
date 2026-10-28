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

- [x] `npx tsx --tsconfig server/tsconfig.json --test server/modules/cockpit/tests/cockpit-session-executors.test.ts` 退出 0，新增用例：`session.start` 建出的行 `lifecycle_mode = resident`、`permission_mode = bypassPermissions`，且偏好写入先于首条 send（用注入的桩记录调用次序）；`cockpit.sessionStart` 设置改为 `per-run` / `default` 时照设置生效；provider 不支持所设权限模式时返回 400 类错误且没有建行。
- [x] `npx tsx --tsconfig server/tsconfig.json --test server/modules/context-events/tests/session-run-events.test.ts` 退出 0：一轮运行完成、被中止、失败各写出一行 `session.run.ended`（outcome 照实）；常驻宿主关闭写出 `session.closed`；写入器抛错时聊天调用方不受影响。
- [x] `npx vitest run src/modules/cockpit/tests/cockpitCardController.test.ts` 退出 0，新增用例：`session.start` 确认成功后仍发出 `sessionStarted`；`useCockpitCards` 的缺省绑定不再导航（用注入的 navigate 桩断言调用 0 次）。
- [x] 假形态变红：把 wiring 里的权限写入删掉 ⇒ 第一条用例红；把导航调用加回去 ⇒ 第三条用例红；改完即还原。
- [x] `npx tsx --tsconfig server/tsconfig.json --test server/shared/tests/server-import-cycle-budget.test.ts`、`npx tsx --tsconfig server/tsconfig.json --test server/shared/tests/architecture-ratchet.test.ts` 退出 0；`npm run typecheck`、`npm run lint` 退出 0（lint 仅既有 warning）。

## DoD

隔离实例（`scripts/isolated-instance.sh`，关 residentRestore，fleet home 指向临时副本，⛔ 不写真实 `~/.quay-fleet`；只点夹具卡片）：

1. 打开驾驶舱，对一张 `session.start` 夹具卡确认；截图证明页面仍停在原处、卡上出现「打开会话」链接。读新会话行，贴出 `lifecycle_mode` 与 `permission_mode`。
2. 新会话首轮里含一次 Bash 调用（夹具首条消息让它跑 `ls`），贴出它没有出现权限确认、这一轮正常结束的读数，以及临时事件目录里的 `session.run.ended` 行。
3. 关掉该常驻会话，贴出 `session.closed` 行。

截图存 `tmp/`；实例用毕 `scripts/isolated-instance.sh stop`。

## 实现

- `server/modules/cockpit/cockpit-session-start.executor.ts` 新增叶子函数 `createCockpitSessionStarter`：解析 project → 能力矩阵检查权限模式（不支持则 400，**建行之前**）→ `createAppSession` → `setSessionPermissionMode` → 按 provider 声明的 lifecycleModes 写 `switchSessionLifecycleMode`（声明里没有 `resident` 的非缺省模式 400）→ `control.send(..., options:{permissionMode})`。`server/cockpit-executors-wiring.ts` 只做绑定，测试因此不必导入组合根。
- 设置：`server/modules/settings/server-settings.ts` 的 `cockpit.sessionStart`（`lifecycleMode` 缺省 `resident`、`permissionMode` 缺省 `bypassPermissions`），非法值逐字段回退。
- 事件：新文件 `server/modules/context-events/session-run-events.ts` + `server/shared/ports/session-run-events.port.ts`（端口槽是类实例，不新增模块级可变状态）；生产者是真实 run registry（`complete` 帧）、宿主管家（`closeHost` 且 mode=resident）与会话删除/归档路径；写入串行、计数，绝不向聊天调用方抛出。
- 前端：`useCockpitCards` 的缺省监听器改为不导航（`createCockpitCardsDefaultOnEvent` 保留 navigate 缝供判据注入），控制器把确认拿到的 sessionId 记到卡片上，使卡片/详情显示「打开会话」。

## 验证记录

命令与读数（2026-10-28，worktree）：

- `npx tsx --tsconfig server/tsconfig.json --test server/modules/cockpit/tests/cockpit-session-executors.test.ts` → tests 16 / pass 16 / fail 0。
- `npx tsx --tsconfig server/tsconfig.json --test server/modules/context-events/tests/session-run-events.test.ts` → tests 4 / pass 4 / fail 0。
- `npx vitest run src/modules/cockpit/tests/cockpitCardController.test.ts` → Test Files 1 passed, Tests 51 passed。
- `npx tsx --tsconfig server/tsconfig.json --test server/shared/tests/server-import-cycle-budget.test.ts server/shared/tests/architecture-ratchet.test.ts` → tests 17 / pass 17 / fail 0。
- `npm run typecheck` → exit 0；`npm run lint` → exit 0（仅既有 warning，无 error）。
- 假形态变红（改完即还原，还原后重跑全绿）：权限写入改成 `const recorded = true;` ⇒ 第一条新用例红，实际次序 `['create','lifecycle:resident','send:bypassPermissions']` vs 期望 `['create','permission:bypassPermissions','lifecycle:resident','send:bypassPermissions']`（3 fail）；`createCockpitCardsDefaultOnEvent` 里加回 `navigate('/session/'+event.sessionId)` ⇒ 导航用例红，`expected [ '/session/new-42' ] to deeply equal []`（1 failed / 50 passed）。

### DoD 执行记录（隔离实例，真实页面 + 真实 claude CLI）

隔离实例：`scripts/isolated-instance.sh`（state `tmp/isolated-instance`），settings 写入 `cockpit.enabled=true`、`cockpit.fixtureCards=true`、`cockpit.fixtureSubject.project=<worktree>`、`cockpit.sessionStart={lifecycleMode:resident,permissionMode:bypassPermissions}`；`HOME=/tmp/dod-cockpit-start/home`（`.claude`/`.claude.json` 软链真实配置供 CLI 登录，**`.quay-fleet` 是临时目录**），`QUAY_FLEET_BIN` 指向临时 release，其中 `config/context-event.schema.v0.json` 是真实 schema 的副本 + 两个新 kind；真实 `~/.quay-fleet` 全程未被写入。用一次性 Playwright（`tmp/dod-card-session-start.mjs`）驱动 `/cockpit?view=cards`，只点夹具卡 `fixture:need`（其 ownReply executor 由 registry 投影为 `session.start`）。

1. 页面不跳转 + 「打开会话」链接：
   - 浏览器读数：`urlBefore=/cockpit?view=cards`、`urlAfter=/cockpit?view=cards`、`outcomeText=已发送 ✓ (data-ok=true)`、`conversationLinkText=打开会话 1de95e16-f0ec-49fc-9cea-9d743253f55a`、`pageErrors=[]`。
   - 截图：`tmp/dod-1-cards-stayed.png`（确认后仍停在「驾驶舱 卡片」页，卡上「已发送 ✓」）、`tmp/dod-2-open-conversation-link.png`（详情「会话」区显示「打开会话 1de95e16-…」）。
   - 新会话行（隔离库）：`lifecycle_mode=resident`、`permission_mode=bypassPermissions`、`provider=claude`、`provider_session_id=fb5f775c-fef9-4cfc-8332-30cb92e69f06`、`project_path=<worktree>`。
2. 首轮 `ls` 无权限确认并正常结束：
   - transcript：`tool_use Bash {"command":"ls","description":"List files in project directory"}` → `tool_result is_error=false`（返回目录清单）→ assistant 文本回述文件名；无 `requires approval` / `permission_request` 标记，整轮 14:26:58→14:27:02 完成。
   - 事件（临时目录 `/tmp/dod-cockpit-start/home/.quay-fleet/context/events/2026-10-28.jsonl`）：
     `{"v":1,"id":"01M61EGHKN19A4P816560JR8X6","at":"2026-10-28T14:27:02.901Z","source":"cloudcli","kind":"session.run.ended","session":"1de95e16-f0ec-49fc-9cea-9d743253f55a","data":{"runId":"d0f02373-3a6a-41d9-a1cb-a1c2496f926b","outcome":"completed"}}`
3. 关闭常驻会话：
   - `POST /api/session-hosts/1de95e16-…/close {"force":true}` → `{"mode":"resident","closeReason":"user",...}`；同一事件文件新增
     `{"v":1,"id":"01M61EGP5AT0KDBGXYZ3M02A3T","at":"2026-10-28T14:27:07.562Z","source":"cloudcli","kind":"session.closed","session":"1de95e16-f0ec-49fc-9cea-9d743253f55a","data":{"reason":"user"}}`
4. 收尾：`scripts/isolated-instance.sh stop` → `port_still_serving:false, ok:true`；该会话的 CLI 进程已无残留。

（同一流程早前还跑过一轮 session `4719e7db-…`：行同为 resident/bypassPermissions，事件里同样有 completed 的 `session.run.ended` 与 `reason:"user"` 的 `session.closed`，两次独立复现。）

档位记录：该轴仍暗,理由:本任务只改动驾驶舱会话启动与事件写入，worktree 内无 archguard 重复/依赖分析报告可读出 L_D/L_G 数值。

## Touches

- tasks/gap-cockpit-session-start-background-resident-and-run-events.md
- server/cockpit-executors-wiring.ts
- server/index.ts
- server/modules/cockpit/cockpit-session-start.executor.ts
- server/modules/cockpit/index.ts
- server/modules/cockpit/tests/cockpit-session-executors.test.ts
- server/modules/context-events/context-event-writer.ts
- server/modules/context-events/session-run-events.ts (new)
- server/modules/context-events/index.ts
- server/modules/context-events/tests/session-run-events.test.ts (new)
- server/modules/providers/services/sessions.service.ts
- server/modules/session-hosts/session-host-manager.service.ts
- server/modules/settings/index.ts
- server/modules/settings/server-settings.ts
- server/modules/websocket/services/chat-run-registry.service.ts
- server/shared/ports/session-run-events.port.ts (new)
- src/modules/cockpit/cockpitCardController.ts
- src/modules/cockpit/hooks/useCockpitCards.ts
- src/modules/cockpit/tests/cockpitCardController.test.ts
- server/shared/tests/architecture-ratchet.baseline.json
- server/shared/tests/server-import-cycle-budget.test.ts

## Blocker

**2026-10-28T14:42:10.132Z — worker 未落地（exited-not-landed）**

- 未落地原因：step=suite: __PERFILE__ duration_ms=91570 server/shared/tests/quay-test-script.test.ts passed=false end_ms=1793198071121 [baseline A/B: HARD RED (task-introduced-red) — the task's red set is NOT a subset of the develop baseline red set: added=server/shared/tests/quay-test-script.test.ts,server/shared/tests/quay-test-script.test.ts changed=-]
- run_id：wk-prod-anchor
- session_id：7332ae9f-309c-4467-aa2b-7cf428988a5f

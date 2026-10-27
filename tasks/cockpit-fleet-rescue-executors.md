---
id: cockpit-fleet-rescue-executors
title: 驾驶舱 fleet 处置执行器适配：从 quay-fleet rescue executors --json 读声明集，确认时调
  quay-fleet rescue exec，退出码 0/2/3 映射为成功/拒绝；fleet 卡的「自己的回复」走 fleet.log
status: todo
labels:
  - feature
  - cockpit
parent: null
children: []
extra:
  schema: execution
---
## Proposal

来源：2026-10-27 线上接通 quay-fleet 卡片后，救援卡的选项绑定 `fleet.hold`、`fleet.park`、`fleet.redispatch`、`fleet.log`，但 CloudCLI 一个都没注册（`cockpit-fleet-card-provider.ts` 的 `declaredExecutors` 为空），确认会被通道以未声明执行器拒绝。quay-fleet 的执行器面已在 release `3b624f5`（任务 `fleet-cockpit-rescue-actions`，提交 652a224）里，quay-fleet 会话于 2026-10-27 给出的契约如下（已用已安装 CLI 核对 `rescue executors --json` 的输出一致）：

- 声明（只读）：`quay-fleet rescue executors --json` → `{ ok: true, executors: [{ id, action, does, params: [{ name, type, required }] }] }`。
- 执行：`quay-fleet rescue exec <executorId> --params '<json>' --json`。
  - `fleet.hold`：必填 `attentionId`，可选 `reason`；ack 并保持 open。幂等，重复返回 `changed: false`。
  - `fleet.park`：必填 `attentionId`，可选 `reason`；显式 expire。幂等。
  - `fleet.redispatch`：必填 `projectId`、`taskId`，可选 `attentionId`、`category`；推进 resolution case。按 case 幂等。
  - `fleet.log`：必填 `text`（就是用户的自由文本），可选 `taskId`、`projectId`、`attentionId`；向 decisions.jsonl 追加一条，**不幂等**（调两次就是两条）。
- 退出码：0 成功；2 拒绝（未知 id、缺必填参数、台账拒绝）；3 项目未登记（仅 redispatch）。校验先于任何写入。
- 成功输出 `{ ok: true, state, executorId, action, params, at, rule, result }`；拒绝输出 `{ ok: false, state: "refused", executorId, params, code, message }`。
- hold、park、redispatch 不写决策记录，也不带自由文本；用户留痕只走 `fleet.log`。

做什么：

- `server/modules/cockpit/cockpit-fleet-executor.ts`：一个实现 `ICockpitActionExecutor` 的类，按声明逐个实例化（id 取自声明，不在 CloudCLI 里硬编码四个 id）。依赖经注入：`runFleet(args) => Promise<{ exitCode, stdout, stderr }>`。`execute(params)` 调 `rescue exec <id> --params <json> --json`；退出码 0 且 `ok: true` 返回结果；退出码 2、3 抛 `AppError`，错误码取输出的 `code`（3 映射为「项目未在 fleet 登记」），消息取 `message`；其它退出码或输出不是 JSON 时抛明确的执行失败，不报成功。
- 声明集：fleet 提供方在启动时（以及取卡缓存刷新时，最长一小时一次）读 `rescue executors --json`，`declaredExecutors()` 返回这些执行器；CLI 不可用时为空集并在诊断里写明原因。
- 「自己的回复」：fleet 卡片没有 `subject.sessionId` 时，fleet 提供方给卡片补 `ownReply = { executor: "fleet.log", params: { taskId, projectId, attentionId } }`，确认通道把用户文本作为 `text` 传入（通道现在把自由文本放进 `reply`；适配器把 `reply` 映射为 `text`）。带会话的提问卡仍用 `session.send`。
- `fleet.log` 不幂等：确认通道已有「同一卡同一 revision 只执行一次」的账本，依赖它防重复；适配器本身不重试。
- 绑定沿用 `server/cockpit-fleet-wiring.ts`（`modules/cockpit` 是 AC-394 叶子，不导入 `modules/quay`），`runFleet` 用 `createQuayFleetRunner` 与 `locateQuayFleetCli`。

## AC

- [ ] `npx tsx --tsconfig server/tsconfig.json --test server/modules/cockpit/tests/cockpit-fleet-executor.test.ts` 退出 0：`runFleet` 桩掉；覆盖声明集来自 `rescue executors --json`（桩返回三个则注册三个，id 不硬编码）、CLI 不可用时声明为空且有原因、hold 成功返回结果、exit 2 拒绝抛出且错误码与消息透传、exit 3 映射为项目未登记、非 JSON 输出抛执行失败、自由文本以 `text` 传给 `fleet.log`、无会话的 fleet 卡补出 `fleet.log` 的 ownReply 而带会话的提问卡保持 `session.send`。
- [ ] 假形态各自变红：exit 2 时仍返回成功 ⇒ 用例红；把四个执行器 id 写死而不读声明 ⇒ 「桩返回三个则注册三个」用例红；自由文本没有映射成 `text` ⇒ 用例红。改完即还原。
- [ ] `npx tsx --tsconfig server/tsconfig.json --test server/modules/cockpit/tests/cockpit-fleet-card-provider.test.ts` 与 `npx tsx --tsconfig server/tsconfig.json --test server/modules/cockpit/tests/cockpit-card-registry.test.ts` 均退出 0（既有用例不减）。
- [ ] `npx tsx --tsconfig server/tsconfig.json --test server/shared/tests/server-import-cycle-budget.test.ts` 与 `npx tsx --tsconfig server/tsconfig.json --test server/shared/tests/architecture-ratchet.test.ts` 均退出 0。
- [ ] `npm run typecheck` 与 `npm run lint` 退出 0（lint 仅既有 warning）。

## DoD

在隔离实例里，把 quay-fleet home 指向一个复制出来的临时 home（`--home <临时目录>`，复制 `~/.quay-fleet` 的 attention.json、decisions.jsonl、registry.json 等台账；⛔ 不得对真实 `~/.quay-fleet` 执行任何 `rescue exec`）。打开 `cockpit.fleetCards.enabled`，用 MCP 浏览器（不可用时用一次性 Playwright，并写明）在 1440 宽度：

1. 对一张救援卡选「挂起」并确认 ⇒ 临时 home 的 attention 条目 ack 状态改变，贴出前后读数；再确认一次同 revision ⇒ 通道拒绝重复，执行器调用数不增加。
2. 对一张无会话的 fleet 卡写自己的回复并确认 ⇒ 临时 home 的 decisions.jsonl 多一条 `type=rescue-log`，`text` 等于所写内容。
3. 构造一个缺必填参数的选项（夹具）⇒ 页面显示 fleet 的拒绝消息，不显示成功。

截图存 `tmp/`。实例用毕 `scripts/isolated-instance.sh stop`。

## Touches

- tasks/cockpit-fleet-rescue-executors.md
- server/modules/cockpit/cockpit-fleet-executor.ts (new)
- server/modules/cockpit/tests/cockpit-fleet-executor.test.ts (new)
- server/modules/cockpit/cockpit-fleet-card-provider.ts
- server/modules/cockpit/cockpit-fleet-card-projection.ts
- server/modules/cockpit/cockpit-card-actions.ts
- server/modules/cockpit/index.ts
- server/modules/cockpit/tests/cockpit-fleet-card-provider.test.ts
- server/cockpit-fleet-wiring.ts
- server/shared/tests/server-import-cycle-budget.test.ts
- server/shared/tests/quay-test-script.test.ts
- scripts/suite-duration-baseline.tsv

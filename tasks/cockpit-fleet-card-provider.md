---
id: cockpit-fleet-card-provider
title: 驾驶舱 quay-fleet 卡片提供方（K2）：经组合根注入的 CLI 调 quay-fleet cockpit cards
  --json，投影成 CockpitCard；会话提问卡由本地决策摘要补全内容，默认选项只取助手推荐
status: ready
labels:
  - feature
  - cockpit
parent: null
children: []
extra:
  schema: execution
goal_ac: AC-432
---
## Proposal

来源：本会话 2026-10-27 与 quay-fleet 会话对齐契约（`docs/architecture/cockpit-attention/CARD-PROVIDERS.md` 第 3、5、7 节）。quay-fleet 已立 `fleet-cockpit-card-read-port`（quay-fleet 仓库），读口为：

`quay-fleet cockpit cards --json [--project <id>] [--state open|resolved|expired] [--include-resolved --since <iso>]`

每行一张 CockpitCard（JSONL）：`id`（attentionId）、`provider: "quay-fleet"`、`revision`、`kind`（fleet 查表，已知值限 ask、multi、need、stuck、fix、decision）、`group`（rescue 或 ruling）、`rank`、`state`（open、resolved、expired）、`waitingSince`、`surfacedAt`、`subject { project（恒有值）, taskId, sessionId, uri }`、`contentRef`、`facts[] { text, mechanical, ref, observedAt }`、`options[]`、`notify { system, reason: "<grade>:<rule>" }`、`ownerSession: null`。会话提问卡的 `contentRef` 为 `{ resolver: "cloudcli.session-ask", sessionId, messageId }`。

语义（等多久成卡、何时结束、是否通知）全在 fleet；CloudCLI 只投影、补内容、执行。E1 结论：会话提问不自动作答，默认选项只取助手自己的推荐（source=assistant），助手没给就不设默认。

做什么：

- `server/modules/cockpit/cockpit-fleet-card-provider.ts`：一个实现 `ICockpitCardProvider` 的类，id 为 `quay-fleet`。依赖经注入：`runCards(args) => Promise<{ exitCode, stdout, stderr }>` 与 `readSessionAsk(sessionId, messageId)`（读观察层 T1 决策摘要）。取卡结果按短 TTL（默认 5 秒，可经 server.settings.json 的 `cockpit.fleetCards.ttlMs` 调）缓存，短时间多次取卡只调一次 CLI；`--include-resolved --since` 供已处理折叠与撤销使用。CLI 不存在或退出非 0 时返回空列表并记录可读原因（`/api/cockpit/cards` 的诊断字段里可见），单个坏行跳过并计数，不影响其它卡片。
- 会话提问卡的内容补全：`contentRef.resolver === "cloudcli.session-ask"` 时，用 `readSessionAsk` 取 `observation-session-ask-decision-digest` 产出的摘要，填入 ask、situation、options（带后果标签）；只有助手原文推荐的那一项 `suggested=true` 且 `source=assistant`；摘要缺失或 `incomplete` 时卡片照常出现，标明内容未就绪，不设默认选项。fleet 卡片自带的 options 原样保留。
- 执行器：fleet 卡片选项里声明的执行器 id 若当前未注册（fleet 的处置动作由 `fleet-cockpit-rescue-actions` 交付，尚未落地），确认时由现有确认通道返回未声明执行器错误；界面上该选项照常可读、确认不可用并显示原因。本任务不实现 fleet 处置执行器。
- 模块边界：`modules/cockpit` 在 AC-394 下是叶子，不得导入 `modules/quay` 或 `modules/observation`；绑定写在新文件 `server/cockpit-fleet-wiring.ts`（仿照 `server/cockpit-brief-wiring.ts`），CLI 用 `modules/quay` 已有的 `locateQuayFleetCli` 与 `createQuayFleetRunner`，在 `createCockpitCardsModule` 的 providers 参数里传入。`server/index.ts` 在 architecture-ratchet 超长基线里，新增接线行需等量删减或按基线 note 的 RECORDED CHANGE 格式记录。
- 开关：server.settings.json 的 `cockpit.fleetCards.enabled`（默认关），线上切换时再打开。

## AC

- [ ] `npx tsx --tsconfig server/tsconfig.json --test server/modules/cockpit/tests/cockpit-fleet-card-provider.test.ts` 退出 0（AC-432 判据）：CLI 运行函数注入为桩，返回按上面输出形状写的 JSONL 夹具（至少含 rescue 与 ruling 各一、open 与 resolved 各一、一张会话提问卡、一个坏行）；覆盖字段透传、TTL 内只调一次 CLI、CLI 缺失与退出非 0 返回空列表与原因、坏行跳过不影响其它卡、会话提问卡有推荐 / 无推荐 / 摘要缺失三种补全结果、开关关闭时不调用 CLI。
- [ ] 假形态各自变红：去掉缓存每次取卡都调 CLI ⇒ 用例红；会话提问卡在助手没有推荐时标出 suggested ⇒ 用例红；一个坏行让整批解析失败 ⇒ 用例红。每个假形态改完即还原。
- [ ] `npx tsx --tsconfig server/tsconfig.json --test server/modules/cockpit/tests/cockpit-card-registry.test.ts` 退出 0（既有用例不减）。
- [ ] `npx tsx --tsconfig server/tsconfig.json --test server/shared/tests/server-import-cycle-budget.test.ts` 与 `npx tsx --tsconfig server/tsconfig.json --test server/shared/tests/architecture-ratchet.test.ts` 均退出 0。
- [ ] `npm run typecheck` 与 `npm run lint` 退出 0（lint 仅既有 warning）。

## DoD

在隔离实例（`scripts/isolated-instance.sh start`）里打开 `cockpit.fleetCards.enabled`，请求 `GET /api/cockpit/cards`，贴出返回体中 provider 为 quay-fleet 的卡片与诊断字段；对一张会话提问卡贴出补全后的问题、选项与 suggested 读数，并与该会话最后一条助手消息对照。

若本机安装的 quay-fleet 已带 `cockpit cards` 动词，上述读数取自真实 CLI；若还没有，用一个按上面输出形状写的 JSONL 夹具替代 CLI 跑同一流程，并贴出 `quay-fleet cockpit cards --json` 的实际报错，真实 CLI 读数在 quay-fleet 的 `fleet-cockpit-card-read-port` 落地后补测（待外部）

实例用毕 `scripts/isolated-instance.sh stop`。

## Touches

- tasks/cockpit-fleet-card-provider.md
- server/modules/cockpit/cockpit-fleet-card-provider.ts (new)
- server/modules/cockpit/tests/cockpit-fleet-card-provider.test.ts (new)
- server/modules/cockpit/cockpit.module.ts
- server/modules/cockpit/cockpit-card-registry.ts
- server/modules/cockpit/index.ts
- server/cockpit-fleet-wiring.ts (new)
- server/index.ts
- server/modules/settings/server-settings.ts
- server/modules/observation/index.ts
- server/shared/interfaces.ts
- server/shared/types.ts
- src/shared/types.ts
- server/shared/tests/architecture-ratchet.baseline.json
- server/shared/tests/server-import-cycle-budget.test.ts
- server/shared/tests/quay-test-script.test.ts
- scripts/suite-duration-baseline.tsv

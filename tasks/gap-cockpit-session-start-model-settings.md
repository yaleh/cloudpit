---
id: gap-cockpit-session-start-model-settings
title: Cockpit session.start 使用 server.settings.json 模型设置并在首轮应用 selection
status: done
labels:
  - gap
  - cockpit
  - settings
  - defect
parent: null
children: []
extra:
  schema: execution
---
## Proposal

Cockpit `session.start` 已从 boot 读取的 `cockpit.sessionStart` 使用 lifecycle/permission 偏好，但目前没有可配置的模型选择；新会话可能落到 provider 默认而不是操作者指定的模型目录项。为 `server.settings.json` 中同一 `cockpit.sessionStart` 增加 model（shipped default 字符串 `'default'`）与可选 effort；此文件仍是唯一持久化来源，编辑后重启生效。使用现有 `SessionLaunchSelection` / provider model catalog 能力，不新增 provider-id 分支、不硬编码机器上的模型或密钥。

与已完成的 `gap-cockpit-session-start-background-resident-and-run-events`（生命周期 / 权限 / 后台运行）及 `gap-mcp-session-create-drops-library-model`（MCP 创建路径的 selection 透传）相关但机制不同；本任务只负责 cockpit `session.start` 的配置和首轮 selection。granularity advice（由协调者执行）对提议 Touches 返回 `peers=[]`、`mentions=[]`，故按 separate/no peers 立案；相关历史 Touches 是已落地事项而非 open 冲突。另一个 cockpit 卡片“开始对话”空会话入口必须最终读相同服务端配置，由依赖本任务的 B 接入，不能形成浏览器默认或第二真源。

`scheduled-messages` 仍只操作已经存在的 `sessionId` 并沿用该会话当前 model；它不创建会话、不读取本设置、不增加 scheduled 专属模型旋钮。该行为作为回归边界，不在此任务扩大改动到通用会话或既有会话模型。

## Plan

1. 在 `CockpitSessionStartSettings`、boot defaults / parser 与 `config/server.settings.example.json` 增加 `model: 'default'` 和可选 `effort`。合法配置缺省不强行选择 effort；形状错误或非法字段须进入 `problems` 并可见，不能静默忽略后意外走 OAuth/default。保留现有 lifecycleMode、permissionMode 和 provider 语义。
2. 扩展 cockpit start 注入契约，用现有模型目录校验所选 model/provider（含可配置的自定义 library model），并按现有 capability 校验显式 effort。无效或已删除的显式模型必须在建行前返回可见错误，不得回退 provider default 或留下孤儿行。
3. 将合法 `SessionLaunchSelection` 交给 `createAppSession` 写入新会话行；首轮必须从该行编译并使用正确的 model / gateway launch env，而不是在第一次 dispatch 之后才补选。built-in `'default'` 保持合法兼容；未配置 effort 保持既有推断行为。
4. 增加窄的单元/集成判据，分别覆盖 default、自定义条目、非法模型无建行、first-run selection/env，以及既有 session scheduled-send 不继承新会话配置。测试只检查 env 键和值的安全属性，不真实调用计费 LLM、不读取或写入宿主密钥。

## AC

- [x] `npx tsx --tsconfig server/tsconfig.json --test server/modules/cockpit/tests/cockpit-session-executors.test.ts server/modules/cockpit/tests/cockpit-session-start-model-selection.test.ts` 退出 0；用例机械证明 shipped `model='default'`、未配置 effort 时沿用旧语义、自定义 model library selection 被建行并作用于第一轮，first-run launch/env 与 selection 一致。
  - 证据: `tests 25 / pass 25 / fail 0`。shipped arm: `row model=default effort=null sendOptions={"permissionMode":"bypassPermissions","model":"default"} resolvedModel="default" spawnModel="default" spawnEffort=undefined`；library arm: `row model=v4.1flash-library-probe spawnModel=v4.1flash-library-probe envKeys=["ANTHROPIC_CARD_START_PROBE_BASE_URL","ANTHROPIC_CARD_START_PROBE_TOKEN"]`（只读键名，不读值）。
- [x] 同一 cockpit model-selection 测试命令中，未知或已删除的显式 model 在任何 `createAppSession` 调用之前返回可见拒绝，创建行数为 0；显式 effort 按 capability 接受/拒绝，且拒绝同样没有创建行；测试不能通过真实 provider 调用或计费请求作判据。
  - 证据: 删除后的 library id 与 typo id 均 `code=MODEL_UNKNOWN` / HTTP 400，`sessionCount` 不变、`sends.length=0`；effort 接受 arm 落行 `effort=high` 且 `spawnEffort="high"`；`effort='nonsense'` → `EFFORT_NOT_SUPPORTED`（supported: low, medium, high, max），cursor → `EFFORT_NOT_SUPPORTED`（`supportsEffort=false`），两者均 0 行 0 send。全部读数来自本地 recorder 与 SQLite，无 provider 调用。
- [x] `npx tsx --tsconfig server/tsconfig.json --test server/modules/cockpit/tests/cockpit-session-start-model-selection.test.ts` 退出 0；配置解析对合法值保留 model/effort，对错误 `cockpit.sessionStart` / 错误字段留下明确 `problems`；设置不改变现有生命周期、权限、provider 默认语义。
  - 证据: shipped `{"lifecycleMode":"resident","permissionMode":"bypassPermissions","model":"default"}`、`problems=[]`；合法值 `model="v4.1flash-library" effort="high"` 原样保留；空白 effort 读作未配置；`model:""`/`effort:5` → `problems=["\`cockpit.sessionStart.model\` must be a non-empty string","\`cockpit.sessionStart.effort\` must be a string"]` 且 model 回退 `default`；非对象 block 报 ``\`cockpit.sessionStart\` must be a JSON object``。
- [x] 同一模型选择测试报告证明 `scheduled-messages` 对已存在 session 的 dispatch 仍只携带现有 `sessionId`/消息而不注入 `cockpit.sessionStart.model` 或 effort；不创建会话、不更换该行 model；测试用本地捕获的 dispatcher/control 记录，不启动真实 LLM。
  - 证据: `dispatched=1 sendOptions={} rowModel=sonnet`；scheduled row 用生产 repository 落库，接收方为本地 recorder，无真实运行；会话行数与既有行 model 均未变。
- [x] `git diff -- server/modules/mcp-gateway/mcp-session-lifecycle.ts server/modules/mcp-gateway/tests/mcp-session-lifecycle.test.ts` 为空；实现未要求编辑这两份用户已有未提交文件。
  - 证据: 命令输出 0 行。

该轴仍暗,理由: 本任务修复 cockpit session.start 的模型/effort 配置与首轮 selection，不涉及 L_D/L_G 明暗轴的测量或迁移。

## DoD

在隔离 server instance 与临时配置 / 数据库中实际创建一个 cockpit `session.start` 会话，读回会话行的 model/effort selection，并从本地捕获的首轮 gateway launch 记录核对所选 model 与模型库 env 键确已应用；再以非法/已删除 model 重试，读数为清晰错误且数据库无新会话行。自定义模型仅取隔离模型目录的测试条目，记录环境键名而不打印凭据、不触发真实计费 LLM。补充 scheduled-message 对既有会话不改变 model 的回归读数。确认两条 cockpit 新建入口使用同一 `server.settings.json` 契约（空会话按钮的服务端接线由依赖任务完成）；不触碰宿主 live 密钥/服务，不改上述两份未提交 MCP 文件，不在本任务运行重启或部署。

## Touches

- tasks/gap-cockpit-session-start-model-settings.md
- server/modules/cockpit/cockpit-session-start.executor.ts
- server/cockpit-executors-wiring.ts
- server/modules/cockpit/tests/cockpit-session-executors.test.ts
- server/modules/cockpit/tests/cockpit-session-start-model-selection.test.ts (new)
- server/modules/settings/server-settings.ts
- server/modules/settings/tests/server-settings.test.ts (new)
- config/server.settings.example.json
- server/modules/providers/services/sessions.service.ts
- server/modules/providers/services/provider-models.service.ts
- server/shared/types.ts
- server/shared/tests/quay-test-script.test.ts
- scripts/suite-duration-baseline.tsv

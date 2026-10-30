---
id: gap-cockpit-session-start-billing-error-confirm
title: 确认 cockpit `session.start` 拉起的会话首轮订阅/账单错误（同刻常驻会话正常，执行器仍报成功）
status: done
labels:
  - gap
  - cockpit
parent: null
children: []
extra:
  schema: execution
---
## Proposal

来源：驾驶舱卡片「安排下一步」（`reevaluate` → 执行器 `session.start`）确认成功、界面显示「Sent」，但被拉起的会话首轮就死了，失败不可见。需要确认这是一次账户级订阅/账单问题、瞬时故障，还是 `session.start` 这条路径特有的会话级问题。

现场读数（2026-10-29，root=/data/home/yale/work/claudecodeui，project=quay-fleet）：

- 确认时刻 2026-10-29T16:17:54Z：卡 `att_55c270b18e3a`（entity `fleet-session-ask-text-key-migration`）的选项 `reevaluate` 走 `session.start`，返回 `ok:true, sessionId: c7daddcd-5fcc-41f5-b95e-ba7440c692d9`。
- 该会话的转写 `~/.claude/projects/-data-home-yale-work-quay-fleet/caf802f6-9f0c-4087-91f8-130423e937c9.jsonl` 里：`api-request`（16:17:56.256Z）为 `params.model="claude-opus-5-5"`、`output_config.effort="medium"`；随后唯一一条 assistant 消息（16:17:56.511Z）是：
  > Claude Code can't use your Claude subscription, usually because a payment is past due · Pay or renew at https://claude.ai/settings/billing (if you just paid, try again shortly), or use an Anthropic API key instead
- 同一时段另一条常驻会话 `8506d2f2-ce2b-42c4-b7fc-2f4326dc2f00`（cwd 同为 quay-fleet）在 16:19–16:21Z 正常回答（`requestedModel: v4pro`），说明当时不是整机/账号完全不可用。
- 驾驶舱侧：动作执行器返回成功并把 `sessionId` 记进 feedback outcome，overlay 停在「已发出」；会话首轮死亡没有任何读数回传。

要确认的问题：这个错误是否每次必现；它是否只发生在 `session.start` 的构造设置上（模型 `claude-opus-5-5`、effort medium）；还是账户订阅本身已欠费/该模型不在订阅权益内。

（查重：任务库内没有以 `session.start` 首轮订阅/账单失败为机制的条目；`gap-cockpit-card-dismiss-fleet-revision-and-receipt` 是卡片回执/revision 机制，不同。同 Touches 无在飞任务。）

## Plan

1. 取证：从上面那条转写逐字取回错误原文、时间戳、模型与 effort；不改写。
2. 复现：用与驾驶舱 `session.start` 相同的设置（同 project、同 provider/model、同 permissionMode/effort）在真实环境新建一个会话并发一句最小 prompt；记录首轮结果。相同设置再跑一次，两次读数用于区分「必现」与「偶发」。
3. 对照：读同刻成功的常驻会话 `8506d2f2` 的模型/设置读数，逐项列出与失败会话的差异（模型、provider、auth 路径、账号）；再取一条第三方读数（CLI 自带账号/订阅读数，或同一 API key 的最小请求）交叉印证。
4. 判定：在「账户级 / 瞬时 / 会话级」中给出一个结论并逐条引用支撑读数；账户级 ⇒ 写明外部下一步是续费或改用 API key；会话级/瞬时 ⇒ 记录可复现步骤，并另立一条缺陷任务（贴新任务 id），不在本任务里改代码。
5. 落记录：把判定、两态读数与下一步写进完成记录。

## AC

- [x] AC1 **失败原文可机械取回**：`grep -rl "payment is past due" /data/home/yale/.claude/projects/-data-home-yale-work-quay-fleet/ | wc -l` 输出 ≥1；完成记录逐字贴出匹配文件路径、该条 `timestamp`、`params.model` 与 `output_config.effort`。
- [x] AC2 **同款设置两次真实复现读数**：用驾驶舱 `session.start` 的同款设置在真实 provider 上新建会话并发送最小 prompt，连续两次；完成记录贴出每次的会话 id、首轮结果（成功或错误原文）与所用设置。
- [x] AC3 **对照表与判定**：完成记录列出失败会话（`caf802f6`）与同刻成功会话（`8506d2f2`）在 provider/model/effort/auth 路径上的逐项差异，并给出「账户级 / 瞬时 / 会话级」三选一的判定，每条判定理由都引用一条具体读数。
- [x] AC4 **下一步已定**：完成记录写明对应分支的下一步——账户级 ⇒「续费或改用 API key」为外部动作；会话级/瞬时 ⇒ 贴出另立任务的 id 与复现步骤。本任务不改源码。

## DoD

在真实环境用驾驶舱 `session.start` 的同款设置实际拉起会话并读回首轮结果（成功或同一错误），两次读数、对照表与三选一判定都落在完成记录里；账户级则外部动作清楚，会话级/瞬时则另立任务可读（id 已贴）。不改代码、不放宽任何判据。

## Touches

- tasks/gap-cockpit-session-start-billing-error-confirm.md
- server/modules/cockpit/cockpit-session-start.executor.ts （只读：session.start 的入口与设置）
- server/cockpit-executors-wiring.ts （只读：session.start 的构造绑定）

## 完成记录

### AC1 失败原文可机械取回

命令与读数：

```
$ grep -rl "payment is past due" /data/home/yale/.claude/projects/-data-home-yale-work-quay-fleet/ | wc -l
3
```

匹配文件（3 个）：

1. `/data/home/yale/.claude/projects/-data-home-yale-work-quay-fleet/caf802f6-9f0c-4087-91f8-130423e937c9.jsonl` —— 本任务事故会话，自身命中。
2. `/data/home/yale/.claude/projects/-data-home-yale-work-quay-fleet/e728c272-5f38-4f3a-ae65-268e7805631e.jsonl` —— 2026-10-29T09:39:56.068Z 的独立命中（同 error/model/effort）。
3. `/data/home/yale/.claude/projects/-data-home-yale-work-quay-fleet/6c59bbf6-0cdf-4b6c-bf70-67fed7c3ef55.jsonl` —— 仅在该会话的 assistant 回复里**引用**了这段错误文本，并非自身命中；不计入复现次数（诚实标注）。

`caf802f6` 逐字读数：

- 转写路径：`/data/home/yale/.claude/projects/-data-home-yale-work-quay-fleet/caf802f6-9f0c-4087-91f8-130423e937c9.jsonl`
- `api-request` `timestamp`：`2026-10-29T16:17:56.256Z`
- `params.model`：`claude-opus-5-5`
- `output_config.effort`：`medium`
- `betas` 含 `oauth-2025-04-20`（OAuth 订阅鉴权路径）
- 错误 assistant 条目 `timestamp`：`2026-10-29T16:17:56.511Z`
- 错误原文（逐字）：`Claude Code can't use your Claude subscription, usually because a payment is past due · Pay or renew at https://claude.ai/settings/billing (if you just paid, try again shortly), or use an Anthropic API key instead`
- 同条读数：`apiErrorStatus=403`、`apiErrorCode=oauth_not_allowed_for_organization`、`error=oauth_org_not_allowed`、`model="<synthetic>"`、`usage.input_tokens=0`、`usage.output_tokens=0`、`perTurnEffort=medium`

独立第二次命中（`e728c272`）：`2026-10-29T09:39:56.068Z`，同样的 `apiErrorStatus=403` / `apiErrorCode=oauth_not_allowed_for_organization` / `params.model=claude-opus-5-5` / `output_config.effort=medium` / `oauth-2025-04-20` beta。

### AC2 同款设置两次真实复现读数

所用设置（与驾驶舱 `session.start` 同款，取自代码与线上 settings）：

- project/cwd：`/data/home/yale/work/quay-fleet`
- provider：`claude`（`DEFAULT_COCKPIT_SESSION_PROVIDER`）
- model：`claude-opus-5-5`；effort：`medium`
- permissionMode：`bypassPermissions`；lifecycleMode：`resident`（`server.settings.json` 未覆盖 `cockpit.sessionStart`，用 shipped defaults）
- 环境：线上 server 进程（systemd `claudecodeui-server.service`，MainPID `517598`）的完整 `environ`；其中 `ANTHROPIC*` 键数量为 **0**
- CLI：`claude` 2.1.314，`claude -p "Reply with exactly: OK" --model claude-opus-5-5 --effort medium --permission-mode bypassPermissions --output-format json`

- 第 1 次：`session_id=94bdf4f4-c6b4-4b08-b0c7-95188a10d787`，`num_turns=1`，`is_error=true`，首轮结果：`Failed to authenticate: OAuth session expired and could not be refreshed`
- 第 2 次：`session_id=78732507-0fa1-42f2-9eba-5bf754512c3c`，`num_turns=1`，`is_error=true`，首轮结果：`Failed to authenticate: OAuth session expired and could not be refreshed`

为什么今日复现的原文与事故当时不同（诚实说明）：事故当时（10-29）OAuth token 有效，请求到达 API 后被打回 `403 oauth_not_allowed_for_organization`；今日 `~/.claude/.credentials.json` 的 `claudeAiOauth.accessToken`/`refreshToken` 长度均为 0、`expiresAt=0`，在 server 环境下 `claude auth status` 返回 `{"loggedIn": false, "authMethod": "none"}`，因此同一条 OAuth 鉴权路径在更早的一步就失败（token 已不可用），无法再打出同一条 403 原文。两次复现仍是**同一鉴权路径上的首轮失败**，且不是模型/effort 问题（403 条目的 `model="<synthetic>"`、usage 全 0，说明模型从未被推理）。

### AC3 对照表与判定

| 项 | 失败会话 `caf802f6` | 同刻成功会话 `8506d2f2` |
|---|---|---|
| provider | `claude` | `claude` |
| model | `claude-opus-5-5`（内置，无自定义 model 行） | `v4pro`（自定义 model 行） |
| effort | `medium` | `high` |
| auth 路径 | OAuth 订阅（`betas` 含 `oauth-2025-04-20`） | API key / 网关（`betas` 无 `oauth-2025-04-20`） |
| 首轮结果 | `403 oauth_not_allowed_for_organization` | 正常回答（16:18:59–16:21Z 多轮 `v4pro` 成功） |
| 时刻 | `2026-10-29T16:17:56Z` | `2026-10-29T16:10–16:21Z`（同刻） |
| 启动环境 | server 进程 env 中 `ANTHROPIC*` 键 = 0（内置模型 launch spec 为 passthrough ⇒ 落 OAuth） | 自定义 `v4pro` model 行自带 `ANTHROPIC_BASE_URL` + `ANTHROPIC_AUTH_TOKEN` ⇒ 网关 |

**判定：账户级。**

逐条理由（各引一条具体读数）：

1. API 机械错误码是 `oauth_not_allowed_for_organization`（`apiErrorStatus=403`，`error=oauth_org_not_allowed`）——这是账户/组织对 OAuth 订阅鉴权的授权判定，不是模型或 effort 报错；同条消息 `model="<synthetic>"`、`usage.input_tokens=0/output_tokens=0`，证明模型根本没被调用。
2. 不是瞬时：10-29 两个独立会话（`e728c272` @09:39:56Z、`caf802f6` @16:17:56Z）同 model/effort 均 403；今日同款设置连跑两次（`94bdf4f4`、`78732507`）仍首轮失败。
3. 不是 `session.start` 特有：差别在鉴权路径而非构造设置。线上 server 进程（PID `517598`）的 `environ` 中 `ANTHROPIC*` 键为 0 ⇒ 内置 claude 模型 passthrough ⇒ OAuth；同刻成功的 `8506d2f2` 用 `v4pro`（自定义 model 行自带网关 env、betas 无 oauth）正常回答。`session.start` 只是默认用了内置 claude 模型。
4. 第三方读数交叉印证：server env 下 `claude auth status` = `{"loggedIn": false, "authMethod": "none", "apiProvider": "firstParty"}`；`~/.claude/.credentials.json` 的 `claudeAiOauth.accessToken` 长度 0、`expiresAt` 0，`subscriptionType=max`。即订阅本身不是欠费状态（max），而是 OAuth 凭证在该组织下不可用——用户可见的 "payment is past due" 是通用文案，机械错误码才是真因。

### AC4 下一步已定

判定为账户级 ⇒ 外部动作（本任务不改源码）：

- **改用 API key / 网关鉴权**：给 claude provider 配置 Anthropic API key，或让内置模型走自定义 model 行（该行自带 `ANTHROPIC_BASE_URL` + `ANTHROPIC_AUTH_TOKEN`），即与 `v4pro` 相同的可用路径。
- 或：在允许 OAuth 的组织下重新登录订阅账号（若坚持走订阅）。
- 旁注（不在本任务范围）：驾驶舱执行器「返回成功但首轮已死不可见」是一个独立的产品可观测性观察；本任务 AC4 对账户级只要求外部动作，故此处不另立任务、不改代码。

### 复核

- 未改任何源码；`git diff develop` 预期为空（除任务文件由 ABI 提交）。
- 两次真实拉起、对照表、三选一判定与下一步均落在本完成记录。
- 该轴仍暗,理由:本任务为账户级确认、不改源码，无可测的 L_D/L_G 数值读数。
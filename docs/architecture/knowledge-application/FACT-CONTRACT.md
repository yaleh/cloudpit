# 知识应用事实契约 v1（`cloudcli.knowledge-application.fact`）

本文件是 CloudCLI 作为 **producer** 向 Fleet 知识应用 run 提供的只读事实契约。它描述的是
**一个答案的形状**，不是"每个字段都已知"的承诺：每个字段要么是带来源与观察时刻的
`evidence`，要么是带原因的 `unknown`。契约版本为 `1`；在 Fleet 侧
`docs/specs/knowledge-application-contract.md` 未交付之前，本机只声明自己的版本，不冒充与
未读过的外部 schema 版本兼容。

代码位置：

| 层 | 文件 |
| --- | --- |
| 契约叶子（无 import，端口类型与 `evidence`/`unknown` 构造器） | `server/shared/knowledge-facts.ts` |
| 活动投影（context-event 流 → 每个 ask 一条活动） | `server/modules/context-events/knowledge-activity-events.ts` |
| 组合根适配（把端口绑到本进程真实服务） | `server/knowledge-facts-wiring.ts` |
| 线上工具（`knowledge_facts`） | `server/modules/mcp-gateway/mcp-knowledge-facts.ts` |
| 注册（与 stage-3 表并列、按注入的 deps bag 条件注册） | `server/modules/mcp-gateway/mcp-read-tools-registry.ts` |

## 1. 线上形状

一个读工具，`kind` 选择三种读数之一：

```
knowledge_facts {
  kind: 'peer_result' | 'effective_config' | 'inventory'
  session?: string          // peer_result / effective_config 必填
  peerSession?: string      // peer_result 可选：调用方自己相信的目标会话
  operationId?: string      // peer_result / effective_config 可选：回读同一操作
  projectId?: string        // inventory 过滤
  provider?: string         // inventory 过滤
  limit?: number            // inventory，1..200，默认 20
  offset?: number           // inventory
  expected?: { model?, effort?, permissionMode? }   // effective_config
}
```

成功响应：

```json
{
  "identity": {
    "contract": "cloudcli.knowledge-application.fact",
    "version": 1,
    "project": "claudecodeui",
    "buildId": "<git sha 或 unbuilt>",
    "bootId": "<进程启动标识>",
    "serverVersion": "1.41.0",
    "gitSha": "<git sha | null>",
    "builtAt": "<ISO | null>",
    "observedAt": "<ISO>"
  },
  "reading": { "kind": "...", ... }
}
```

`buildId`/`gitSha`/`builtAt` 标识**代码**，`bootId` 标识**进程**，`serverVersion` 是启动时
捕获的包版本（不重新读盘，所以运行中替换文件无法改写它）。身份字段全部随每次读数返回，
consumer 不需要另开一次调用去问"是谁回答的"。

失败走网关统一的错误信封：命名了存库中不存在的会话 → `SESSION_NOT_FOUND`；`kind` 要求的
`session` 缺失或 `kind` 非法 → `INVALID_ARGUMENT`。**地址解析失败不是"所有字段未知"的事实**，
所以它是拒绝，而不是一条 reading。

## 2. 字段的两种状态

```ts
type KnowledgeEvidence<T> =
  | { state: 'evidence'; value: T; source: string; sourceRef: string; observedAt: string }
  | { state: 'unknown';  reason: string };
```

- `source` 是产出值的读取器（`sessions.db` / `sessions.transcript` / `context-events` /
  `session-hosts` / `chat-runs` / `build-info` / `caller`）；
- `sourceRef` 是该来源里的稳定指针（行 id、`file#rowId`、`session#messageId`）；
- `observedAt` 是**来源观察值的时刻**，不是被问的时刻；
- `unknown.reason` 是一句可打印的原因。

没有第三种"大概"，也没有用 `null` 冒充"我没查"。每种读数另有 `unknown: string[]` 列出
本次读取**没能建立**的字段名，以及 `readErrors: { source, message }[]` 列出读取过程中失败的
来源——失败不会变成空证据。

## 3. `peer_result`：一次 ask 与它的回复

来源：本机 context-event 流（`session.asking` / `session.answered` /
`session.asking.retracted`），加上**会话 transcript 的权威回读**。

- `operationId` 由 ask 自身的去重键 `<sessionId>:<assistantMessageId>` 经 SHA-256 派生
  （`op-<12 hex>`），不存储。因此第二次读取（另一进程、另一时刻）派生出**同一个** id，一次新
  活动与权威回读可以按同一 operation 关联。
- 一次 ask 一条活动；`answered`/`retracted` 结算取最新一行；结算行存在而 asking 行已出窗口时
  **保留**该事实并标 `askingRow` 未知（"没问过"与"问过但我看不到"必须可区分）。
- `reply` 只有在 transcript 中真的找到 `answeredMessageId` 时才是 `evidence`，并携带
  `verifiedAgainstTranscript: true`；流说"已回答"不构成证据。transcript 读失败写入
  `readErrors`（source `sessions.transcript`），不是空 transcript。
- 流**不记录**目标 peer 会话与授权范围：`targetSessionId` 与 `authorization` 默认 `unknown`。
  调用方可以自己声明 `peerSession`，但只有会话库确认该会话存在时才回显为值；确认不到则
  `targetSessionId` 仍未知，并向 `readErrors` 追加一条 `sessions.db` 记录。

活动投影的 `unknown` 会向上合并到读数，唯一例外是被本读数**实际建立**的字段：调用方声明的
peer 已被确认时，`targetSessionId` 不再出现在 `unknown` 里——`unknown` 描述的是**这次读取**
回答不了的字段，而不是原始来源省略了什么。

## 4. `effective_config`：expected / stored / actual 与身份三层

| 层 | 来源 | 说明 |
| --- | --- | --- |
| `expected` | `caller` | 调用方声明的期望；**未声明就是 unknown** |
| `stored` | `sessions.db` | 会话行里记录的 model / effort / permissionMode |
| `actual` | `session-hosts` | 当前是否有活进程（`live`、`pid`、`startedAt`）及在跑 run 的 `runId` |
| `layers.process` | `session-hosts` | 活进程的 pid / startedAt / `bootId` |
| `layers.build` | `build-info` | `buildId` |
| `layers.request` | `chat-runs` | 在飞 run 的 `runId` / `providerSessionId` |

`verified` 只有在 **expected、stored、actual、process、build、request 六层全部是 evidence**
时才为 `true`。没有 expected 层就永远验证不了——"数据库这么写"与"下一轮会用它"都不是证据。
run 的 id 只从 registry 的按会话查找取（`listRunningRuns` 投影的行没有 runId），拿不到就是
unknown，绝不用开始时刻编一个 id。

## 5. `inventory`：有界清单

- `scope` 原样回显**实际应用的**过滤（`filtersApplied`）、`limit`、`offset`；
- `total` 是过滤后整个范围的条数，分页之前；`truncated` 表示这一页是否留下了行；
- `providers` 描述过滤后的范围，而不只是本页；
- `lifecycle.stored` 是会话行记录的偏好（`resident` / `per-run`），`lifecycle.live` 是当前是否
  有活进程——**没有 host 来源时是 `null` + `unknown: ['lifecycle.live']`，不是 `false`**。

因此 `items: []` 且 `total: 0` 回答的是"这个有界查询没找到"，永远不是"本机没有会话"。

## 6. 反例（同一契约的一部分）

- 命名不存在的会话 → `SESSION_NOT_FOUND`（调用两次都一样，不做部分事实）。
- `peer_result` / `effective_config` 缺 `session`，或 `kind` 不在枚举内 → `INVALID_ARGUMENT`。
- 声明的 peer 不存在 → **不是**拒绝：ask 本身是真的，未确认的 peer 是显式缺口。
- 无活动的会话 → `activity`/`correlation`/`waiting`/`reply` 全为 `unknown`，`operationId: null`。
- 未接 host 来源 → `actual`、`process` 为 unknown，清单 `lifecycle.live` 为 `null`，绝不读成
  "没有在跑"。

## 7. 消费者与边界

- 消费者：Fleet 的 knowledge-application run 经 MCP 网关调用 `knowledge_facts`；本仓库的
  `server/modules/mcp-gateway/tests/mcp-knowledge-facts.test.ts`（真实 express + 真实 `/mcp`
  挂载 + 真实临时库与事件目录）与
  `server/modules/context-events/tests/knowledge-activity-events.test.ts` 是这两层的判据。
- **Fleet 不读取本项目的私有 home。** 事实只能经受权网关读出；事件流是触发线索，读数是权威
  事实，决定前可以按 `operationId` 回读。
- 非目标：本契约不写 fleet 文件、不读 observation store、不推断授权范围、不把"有回复"当成
  "已授权"。

## 8. 证据

`docs/evidence/knowledge-application-fact-contract.json` 记录了一次在**隔离运行**的
CloudCLI 实例上、经正式 `/mcp` 网关取得的请求/响应与身份（`buildId`/`bootId`/`serverVersion`/
`gitSha`/`builtAt`）、`peer_result` 的关联读数与其缺失标记、`effective_config` 的未验证读数，
以及两个反例的 `code`。实例使用一次性 HOME 与其自己的事件流目录，operator 的
`~/.quay-fleet` 流从不被该实例读取，也从不被本任务写入。

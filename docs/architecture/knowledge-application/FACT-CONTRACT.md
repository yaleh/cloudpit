# 知识应用事实契约 v1（`cloudcli.knowledge-application.fact`）

本文件是 Cloudpit 作为 **producer** 向 Fleet 知识应用 run 提供的只读事实契约。它描述的是
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
  deliveryId?: string       // peer_result 可选：跨会话投递链的地址（§3.1）
  correlationId?: string    // peer_result 可选：该投递携带的关联标签，交叉核对用
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

### 3.1 跨会话投递链（`deliveryCorrelation`）

`session.asking` / `session.answered` 只描述"会话在自己的流里问了一句、又说了一句"。它不记录
**这次问被交给了谁**、以哪个投递送达、对端哪条消息是回答。这三个事实只在服务端接受
`session_send` 的那一瞬同时存在，因此由投递适配器在那一刻写入进程内的投递台账
（SPEC §8.1 的 delivery 语义）：

```
deliveryId + correlationId + sourceSessionId + targetSessionId + bootId + recordedAt
```

只有**同时**声明 `sourceSession` 与 `correlationId` 的 relayed send 才写记录；单说一个不构成
关联，普通人对会话的发送也不写。读侧以 `deliveryId` 为**地址**（`correlationId` 只是交叉核对，
不是地址），返回 `deliveryCorrelation`：

```ts
type KnowledgePeerDeliveryCorrelation = {
  delivery:        KnowledgeEvidence<{ deliveryId, correlationId, sourceSessionId,
                                       targetSessionId, bootId, recordedAt }>;
  originalMessage: KnowledgeEvidence<{ messageId, role, at, verifiedAgainstTranscript: true }>;
  reply:           KnowledgeEvidence<{ messageId, role, at, afterMessageId,
                                       verifiedAgainstTranscript: true }>;
  verified: boolean;
  actionPermission: { granted: false; reason: string };
  unknown: string[];
  readErrors: { source, message }[];
};
```

`deliveryCorrelation: null` 表示**没问**这条链，不是"不支持"；能力问题看
`capabilities.deliveryCorrelation`（`readable` / `unavailable`）。契约版本仍为 `1`，这是新增的
可选分支，旧消费者忽略该字段即可。

`verified: true` 需要**四条证据同时成立**：

1. 调用方的 `session` / `peerSession` / `correlationId` 与服务端保存的记录一致（参数本身不是证据，
   只是查找地址；不一致即拒绝该链）；
2. 进程内的 resident 投递台账仍持有该 delivery，且其 session 就是记录的目标会话；
3. 目标会话 transcript 里存在一条 **id 等于 deliveryId** 的消息行——投递身份与消息身份是同一个；
4. 该行**之后**存在第一条 assistant 行。`reply.afterMessageId` 明确写出方向；此前的 assistant
   行（旧回答）永远不会被借用，最新 assistant 也不会。

`actionPermission.granted` 恒为 `false`。对端回复只证明"对端回答了这条消息"，**不是**任何后续
动作的授权；`reading.authorization` 仍是 `unknown`，授权范围只能来自 Fleet 的人类授权引用。
Fleet 传入的"已授权 ask 上下文"在本机只作为**查询定位**（哪次 ask），不改变授权判定。

失败一律是显式 `unknown` + 原因，绝不静默成功：

- 指名了不存在的 delivery 记录 → `delivery` unknown（该 send 未带 `sourceSession`/`correlationId`，
  或本进程未接受过它）；
- 记录存在但 resident 台账已无该 delivery（或 session 不符）→ `delivery` unknown；
- 调用方声明的 peer / correlation 与记录不符 → `delivery` unknown，原因点名两边；
- 目标 transcript 窗口内没有该 id 的行 → `originalMessage`/`reply` unknown；
- 有该行但其后没有 assistant 行（旧回答 / 尚未回答）→ `reply` unknown；
- transcript 读失败 → `readErrors` 一条 `sessions.transcript`，不是空 transcript。

**持久性边界（必须知道）**：该台账与 resident 投递台账一样是**进程作用域**的。另一个进程
（重启后）读不到上一进程记录的 delivery，读数会给出上面第一条显式 unknown，而**不会**从
transcript 反推出一条链——一行 transcript 只证明消息存在，不证明它由谁、以哪个投递、在哪个关联
下送出。`delivery.bootId` 标出记录它的进程。

## 4. `effective_config`：本次 operation 的实际请求与应答，逐字段判定

| 层 | 来源 | 说明 |
| --- | --- | --- |
| `expected` | `caller` | 调用方声明的期望；**未声明就是 unknown** |
| `stored` | `sessions.db` | 会话行记录的 model / effort / permissionMode——只是应用记录，**不是请求的回读** |
| `actual` | `session-hosts` | 当前是否有活进程（`live`、`pid`、`startedAt`）及在跑 run 的 `runId` |
| `layers.process` | `session-hosts` | 活进程的 pid / startedAt / `bootId` |
| `layers.build` | `build-info` | `buildId` |
| `layers.request` | `chat-runs` | 在飞 run 的 `runId` / `providerSessionId` |
| `operation` | `chat-runs` | 本次读数针对的**在飞 operation**：`id`（run id）、`at`、`bootId` |
| `actualRequest` | `sessions.transcript` | 该 operation 内最新 assistant 行的**请求侧**：`requestedModel` / `effort` / `requestRef` |
| `actualResponse` | `sessions.transcript` | **同一行**的应答侧：`message.model` / `message.id` / `timestamp` |
| `fields.*` | 组合判定 | 逐字段 verdict：`verified` / `mismatch` / `unknown`（带原因） |
| `capabilities` | 按 provider 的数据表 | 本构建对请求/应答各字段能否回读的**能力声明**；不能即 `unavailable` + 原因 |

`operation` 是"本次"的唯一锚点：run 必须仍在飞（`status === 'running'`）、由**当前进程 boot**
创建，并且当调用方传了 `operationId` 时指向它。`actualRequest` / `actualResponse` 只从
provider 自己的 transcript 里、落在 `[operation.at, now]` 且会话匹配的 assistant 行读取；
`sourceRef` 形如 `<jsonl 路径>#<uuid>`。Claude 的 transcript **没有** permission mode，因此
`capabilities.request.permissionMode === 'unavailable'`，`actualRequest.permissionMode` 恒为
`null`——stored 行里的值不会被借用。

`verified` 只有在以下**全部**成立时才为 `true`：

1. `expected` 是 evidence 且至少声明了一个字段；
2. `stored`、`actual`、`layers.process`、`layers.build`、`layers.request` 都是 evidence；
3. `operation`、`actualRequest`、`actualResponse` 都是 evidence；
4. 每个已声明字段的 verdict 都是 `verified`。

层数多不等于成功。逐字段规则：

- 已声明期望但读不到 → `unknown`，并进入读数的 `unknown`（如 `fields.effort`）；
- 读到且相等 → `verified`；读到但不等 → `mismatch`，同样进入 `unknown`；
- **未声明**的字段不参与 `verified`，也不进 `unknown`（调用方没问，不算本次读数的缺口）；
- transcript 行缺 `model` / `effort` / `requestRef` / response id 时，`actualRequest` /
  `actualResponse` 仍是 evidence，但缺失子字段列入 `unknown`（如 `actualRequest.effort`），
  不以静默 null 混过去。

否定规则（每条都有判据）：

- **只有 DB / stored**：没有在飞 run → `operation`、`actualRequest`、`actualResponse` unknown；
- **next-turn**：run 已完成（`status !== 'running'`）→ `operation` unknown；stored 与可读的历史行
  都不算"本次生效"；
- **只有 live**：活进程在，但会话行没有 transcript 路径 → `actualRequest` unknown；
- **旧进程**：run 的 `bootId` 与当前进程不同 → `operation` unknown；
- **旧应答**：最新 assistant 行早于 operation 开始，或早于活进程 / 当前构建 → `actualRequest` /
  `actualResponse` unknown，响应不被借用；
- **未知 effort**：行内没有 `effort` → `fields.effort` unknown（同一行记录到的 model 仍可 verified）；
- **命名了非当前 operation** → `operation` unknown；
- **provider 没有回读来源**（首轮只有 Claude 路径）→ `capabilities` 全 `unavailable`、
  `actualRequest` unknown、相关字段 unknown，绝不用 stored 值补造。

`reading.operationId` 与 `operation.id` 不是同一个东西：前者是**可回读的地址**（调用方传入，
否则按会话派生 `op-<hash>`），后者是本次 operation 的 run id。回读时传 `reading.operationId`
即可重新读到同一个事实。

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
- `effective_config` 只有 stored 行 / 只有活进程 / run 已完成（next-turn）/ run 属于旧 boot /
  应答早于 operation / 应答早于活进程或构建 / transcript 缺 effort / 期望与可读实际不一致 /
  调用方命名了非当前 operation / provider 无回读来源 → `verified: false`，且具体层或
  `fields.*` 进入 `unknown`（详见 §4）。
- transcript 读失败 → `readErrors` 里一条 `sessions.transcript`，`actualRequest` /
  `actualResponse` unknown；**不是**"这个 operation 没有请求"。
- 无回读来源的字段（Claude 的 permissionMode）→ `capabilities` 明确声明 `unavailable`，
  verdict 为 `unknown`；既不是 `mismatch`，也不是 stored 值的回显。
- `peer_result` 带 `deliveryId` 时（§3.1）：目标不符 / 关联标签不符 / 无投递记录 / resident
  台账已失去该投递 / transcript 无该 id 的行 / 该行之后没有 assistant 行 / 文件缺失 →
  `deliveryCorrelation.verified: false`，链路中具体那一环为 `unknown`，原因点名是哪一环；绝不会
  把"对端以前回答过"或"最新一条 assistant"当成这条投递的回答。
- 对端确实回答了，也**不是**授权：`actionPermission.granted: false`，`authorization` 仍为
  `unknown`。

## 7. 消费者与边界

- 消费者：Fleet 的 knowledge-application run 经 MCP 网关调用 `knowledge_facts`；本仓库的
  `server/modules/mcp-gateway/tests/mcp-knowledge-facts.test.ts`（真实 express + 真实 `/mcp`
  挂载 + 真实临时库与事件目录）、
  `server/modules/mcp-gateway/tests/knowledge-effective-config-proof.test.ts`（本次 operation 的
  正例 + 十一种"不能宣布生效"的反例）与
  `server/modules/context-events/tests/knowledge-activity-events.test.ts` 是这几层的判据。
- 跨会话投递链的判据是
  `server/modules/mcp-gateway/tests/knowledge-peer-correlation-proof.test.ts`：真实
  `mountMcpGateway` + 真实 bearer + 真实临时库/transcript，先经真实 `session_send` 接受一次
  relayed ask，再经 `knowledge_facts` 读回；正例记录 build/boot/operation/correlation/
  messageId，反例覆盖目标不符、关联不符、无记录、旧回答、无该行、文件缺失、resident 台账缺失、
  ordinary answered 无 messageId、未授权字段。
- Fleet 消费样例：`docs/evidence/knowledge-effective-config-proof.json` 与
  `docs/evidence/knowledge-peer-correlation-proof.json` 通过真实 `/mcp` 端口记录了
  `knowledge_facts` / `session_send` 的工具描述与输入输出 schema、正例读数（`delivery` /
  `originalMessage` / `reply` / `verified`）以及各反例的 `unknown`，可直接作为 consumer 的解析
  夹具。两者都是受控实例读数，**不**代表生产部署已启用。
- **Fleet 不读取本项目的私有 home。** 事实只能经受权网关读出；事件流是触发线索，读数是权威
  事实，决定前可以按 `operationId` 回读。
- 非目标：本契约不写 fleet 文件、不读 observation store、不推断授权范围、不把"有回复"当成
  "已授权"。

## 8. 证据

`docs/evidence/knowledge-application-fact-contract.json` 记录了一次在**隔离运行**的
Cloudpit 实例上、经正式 `/mcp` 网关取得的请求/响应与身份（`buildId`/`bootId`/`serverVersion`/
`gitSha`/`builtAt`）、`peer_result` 的关联读数与其缺失标记、`effective_config` 的未验证读数，
以及两个反例的 `code`。实例使用一次性 HOME 与其自己的事件流目录，operator 的
`~/.quay-fleet` 流从不被该实例读取，也从不被本任务写入。

`docs/evidence/knowledge-effective-config-proof.json` 记录本次 `effective_config` 的**受控实例**
读数：生产 `mountMcpGateway` + 生产 bearer 中间件跑在 loopback 上，真实 better-sqlite3 文件与
真实 transcript JSONL 位于一次性临时目录；run/host 接缝按生产形状注入。文件包含工具描述与
输入输出 schema、一次 `verified: true` 的 Claude 操作（`operation` / `actualRequest` /
`actualResponse` 均带 `sourceRef`，`permissionMode` 由 `capabilities` 声明为
`unavailable`），以及 live-only、next-turn、DB-only、无回读 provider 四种
`verified: false` 读数及各自 `unknown`。它**不**证明生产部署已启用：那部分留给 F10 与当前会话。

`docs/evidence/knowledge-peer-correlation-proof.json` 记录本次**跨会话投递链**的受控实例读数，
由该任务自己的判据在 `KNOWLEDGE_PEER_CORRELATION_EVIDENCE=<路径>` 下重跑写出：同一生产
`/mcp` 挂载上先调用真实 `session_send`（带 `sourceSession` + `correlationId`），再调用
`knowledge_facts` 读回。文件含两个工具的描述/schema、正例读数（`delivery` 的
`deliveryId`/`correlationId`/`source`/`target`/`bootId`，`originalMessage.messageId` 与
`reply.afterMessageId`，以及 `verified: true`）、以及九种 `verified: false` 反例及各自
`unknown`。控制服务的应答是按 transcript 实际携带的 delivery id 脚本化的；它同样**不**证明生产
部署已启用，也不把任何回复读成授权。

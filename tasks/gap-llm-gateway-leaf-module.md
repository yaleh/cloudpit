---
id: gap-llm-gateway-leaf-module
title: 把直连 LLM 客户端从 reply-suggestions 抽成叶子模块 modules/llm-gateway，协议分支改为策略对象
status: todo
labels:
  - gap
parent: null
children: []
extra:
  schema: execution
depends_on:
  - gap-settings-file-shared-reader
---
## Proposal

<!-- dedup-ref --> 同批 6 条重构的第 2 条（2026-10-26 架构复查）。与 `gap-settings-file-shared-reader` 共享三个 settings 读取器文件（这里只改它们的 import 来源），已用 depends_on 串行。

### 现状（2026-10-26 实测）

- 通用的直连 LLM 客户端 `completeReplySuggestions` 与密钥值对象 `ApiCredential` 由功能模块 `modules/reply-suggestions` 拥有，另外两个功能模块从它的 barrel 借用：`server/modules/quay/counter-voice.ts:33-39`、`server/modules/observation/session-digest-llm.ts:33-39`；两个 settings 读取器还从它借 `ReplySuggestionsProtocol`/`ReplySuggestionsAuthScheme` 类型。通用能力挂在一个功能名下，命名与归属都错。
- `server/modules/reply-suggestions/reply-suggestions-client.ts` 里有 6 处 `anthropic`/`openai` 协议分支（端点、请求体、鉴权头、响应解析各自 if）。
- `server/modules/voice-realtime/voice-realtime-summary.ts` 自己又写了一份 `chat/completions` 客户端（第三份）。

### 改法

新建 `server/modules/llm-gateway/`：
- `llm-protocols.ts`：`LlmProtocol` 策略类型（`endpoint(baseUrl)`、`buildRequest`、`authHeaders(credential, scheme)`、`parseResponse`），`anthropicProtocol` 与 `openaiProtocol` 两个实现，按 `protocol` 名从表中选取——替代 6 处 if 分支。
- `llm-client.ts`：`completeLlm(request)`，错误类与错误分类从 reply-suggestions-client 原样迁入，key 不进任何错误文本。
- `llm-credential.ts`：`ApiCredential` 原样迁入。
- `index.ts`：barrel，逐条 consumer 注释。

reply-suggestions、counter-voice、session-digest-llm、两个 settings 读取器改从 `@/modules/llm-gateway/index.js` 导入；`voice-realtime-summary.ts` 改用 `completeLlm` + `openaiProtocol`，删掉自带的 HTTP 客户端。reply-suggestions 的用量账本（`createReplySuggestionsUsageLog`）不在本任务范围，保持原位。

### 导入环预算（AC-394）——新目录必须是叶子

`modules/llm-gateway` 的出边只允许 `node:*`、`server/shared/**` 与自身；不得 import 任何 `server/modules/**`。它有来自 reply-suggestions / quay / observation / voice-realtime 的入边，这正是 AC-394 (c) 的叶子豁免形态：在 `server-import-cycle-budget.baseline.json` 的 `directoryManifest` **和** 测试文件的 `MANIFEST_PIN` 中同时登记 `modules/llm-gateway`，`nodeCount` 56→57，并在基线 `note` 末尾追加一条 RECORDED CHANGE 说明。`cycleGroups`（G1 三成员、G2/G3 空）、`unresolvedInternalBudget`（19）、`nonLiteralDynamic` 一律不变。

## AC

- [ ] 叶子出边：`grep -rhE "from '" server/modules/llm-gateway/*.ts | grep -vE "from '(node:[a-z/]+|@/shared/[^']+|\./[^']+)'"` 无输出。
- [ ] 协议策略：`grep -nE "export const (anthropicProtocol|openaiProtocol)" server/modules/llm-gateway/llm-protocols.ts` 两个都命中；`grep -cE "protocol === '(anthropic|openai)'" server/modules/llm-gateway/llm-client.ts` 输出 0。
- [ ] 借用消失：`grep -rnE "(completeReplySuggestions|ApiCredential|ReplySuggestionsProtocol|ReplySuggestionsAuthScheme)" server/modules/quay server/modules/observation server/modules/voice-realtime --include='*.ts' | grep -v '/tests/'` 无输出。
- [ ] 第三份客户端消失：`grep -nE "fetch\(" server/modules/voice-realtime/voice-realtime-summary.ts` 无输出，且该文件 import `@/modules/llm-gateway/index.js`。
- [ ] 判据：`npx tsx --tsconfig server/tsconfig.json --import ./scripts/undici-blocked-ports-preload.mjs --test server/modules/llm-gateway/tests/llm-client.test.ts` exit 0，用本地 loopback 假上游覆盖两种协议的请求体/鉴权头/响应解析、超时、HTTP 错误分类，并断言错误文本不含 key。
- [ ] 行为不回归：`npx tsx --tsconfig server/tsconfig.json --import ./scripts/undici-blocked-ports-preload.mjs --test server/modules/reply-suggestions/tests/reply-suggestions-routes.test.ts server/modules/reply-suggestions/tests/reply-suggestions-service.test.ts server/modules/quay/tests/counter-voice.test.ts server/modules/observation/tests/session-digest-llm.test.ts server/modules/voice-realtime/tests/voice-realtime-summary.test.ts server/modules/voice-realtime/tests/voice-realtime-run-end-summary.test.ts` exit 0。
- [ ] 导入环预算：`npx tsx --tsconfig server/tsconfig.json --test server/shared/tests/server-import-cycle-budget.test.ts` exit 0；`node -e "const b=require('./server/shared/tests/server-import-cycle-budget.baseline.json');if(b.nodeCount!==57||!b.directoryManifest.includes('modules/llm-gateway')||b.unresolvedInternalBudget!==19||JSON.stringify(b.cycleGroups)!==JSON.stringify({G1:['modules/providers','modules/providers/list/claude','modules/providers/services'],G2:[],G3:[]}))process.exit(1)"` exit 0；`grep -c "'modules/llm-gateway'" server/shared/tests/server-import-cycle-budget.test.ts` ≥ 1。
- [ ] 静态检查：`npx tsc --noEmit -p server/tsconfig.json` exit 0；`npx oxlint server/modules/llm-gateway server/modules/reply-suggestions server/modules/quay server/modules/observation server/modules/voice-realtime` exit 0。

## DoD

真实上游各打一次：用 `npm run build:server` 的 dist，在本机 workers 网关上分别以 `anthropic` 与 `openai` 协议经 `completeLlm` 发一个最短请求，贴出模型回答与 token 用量；再经 reply-suggestions 的 `/api/reply-suggestions` 路由（隔离实例）取一批真实 chips，贴出响应，证明迁移后 reply-suggestions 仍走同一条上游路径；最后贴出 AC-394 判据输出中 `nodeCount=57` 与 G1 三成员不变的读数。

## Touches

- server/modules/llm-gateway/index.ts (new)
- server/modules/llm-gateway/llm-client.ts (new)
- server/modules/llm-gateway/llm-protocols.ts (new)
- server/modules/llm-gateway/llm-credential.ts (new)
- server/modules/llm-gateway/tests/llm-client.test.ts (new)
- server/modules/reply-suggestions/reply-suggestions-client.ts
- server/modules/reply-suggestions/reply-suggestions-settings.ts
- server/modules/reply-suggestions/reply-suggestions.module.ts
- server/modules/reply-suggestions/reply-suggestions.service.ts
- server/modules/reply-suggestions/index.ts
- server/modules/reply-suggestions/tests/reply-suggestions-client.test.ts
- server/modules/quay/counter-voice.ts
- server/modules/quay/counter-voice-settings.ts
- server/modules/observation/session-digest-llm.ts
- server/modules/observation/session-digest-llm-settings.ts
- server/modules/voice-realtime/voice-realtime-summary.ts
- server/shared/tests/server-import-cycle-budget.baseline.json
- server/shared/tests/server-import-cycle-budget.test.ts
- server/shared/tests/quay-test-script.test.ts
- scripts/suite-duration-baseline.tsv
- tasks/gap-llm-gateway-leaf-module.md
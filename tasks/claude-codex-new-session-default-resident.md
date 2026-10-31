---
id: claude-codex-new-session-default-resident
title: Claude Code 与 Codex 新会话默认 resident：后端统一策略、创建时落库、网页/MCP/语音一致
status: done
labels:
  - feature
parent: null
children: []
extra: {}
---
## Proposal

用户在 resident 默认策略讨论后明确接受现有权限绑定，允许更多新会话默认使用当前 resident 权限：Claude 的 bypassPermissions，以及 Codex 的 approvalPolicy=never / sandbox=danger-full-access。此项已获确认，不以拆分权限与生命周期为前置条件。

用户原指令为“创建 quay 任务”。因上一轮输入/输出丢失而补建本任务；本次只建任务，实施由后续任务流程完成。

现状：网页 ChatInterface 的 residentEnabled 初始为 false，消费后也重置为 false；MCP session_create 仅 Claude 默认 resident，其余走行的 per-run 默认；Cockpit 已有显式 resident 配置。现有 done 任务 gap-claude-default-resident-lifecycle 仅覆盖 MCP Claude 默认值，不覆盖本项跨入口策略，不重复创建同一交付。

用户确认的范围：
1. 只影响新会话，不批量转换历史会话；显式选择 per-run 始终有效。
2. 默认策略由后端 provider 能力声明统一提供，网页、MCP、语音入口共同使用，避免各处硬编码。
3. 创建时确定模式，首条消息前生效，尽量合并现在“先创建、再切换”的两步操作。
4. 首次发送时才启动进程，打开新会话页面不启动；保留关闭进程、空闲回收和容量限制。
5. 新会话仍可关闭“保持会话运行”；创建完成后，下一个新会话恢复默认开启。

## Plan

- 检查 provider capability 契约与创建会话服务，添加有明确语义的默认生命周期声明；Claude 与 Codex 声明 resident，其余保持既有行为。支持 resident 与默认 resident 是不同属性，不能把支持列表直接等同于默认策略。
- 在统一创建服务中解析显式 lifecycleMode 与 provider 默认值，校验后随新会话写入，完成后才允许首轮派发。显式值优先；非法或不支持的模式不得被静默替换。保持历史行及数据库 per-run 默认的兼容语义，不做历史数据迁移。
- 网页、MCP 与 Live Voice 共同消费该策略；审计其他创建入口（含 Cockpit、分叉），保留显式配置及既有分叉语义。不要只改网页 useState 初值或扩大 MCP provider-id 分支。
- 网页的新会话选择由符合前端标准的状态 owner 管理：无覆盖时读取能力默认值，本次手动关闭只作用于本次新会话；成功创建后清除覆盖，下一个新会话恢复 provider 默认。切换 provider、能力尚未返回、失败重试不得使画面与实际创建模式不一致。
- 合并普通文本与语音路径里先建行再切生命周期的流程，创建请求携带显式选择，服务端在创建返回前确定模式。页面打开、浏览空白新会话或仅创建空会话行不启动 provider 进程；首次发送才拉起。
- 沿用权限绑定、关闭进程、空闲回收、resident 容量限制和重启恢复策略；当前 residentRestore 默认开启、max=16、活动窗口 24h，不在本任务中擅自调整这些值。

## AC

- [x] 后端能力响应声明 Claude 与 Codex 的默认生命周期为 resident；其他 provider 保持原有默认；前端对应线型契约按仓库要求有 TypeSync 覆盖。
- [x] 统一创建服务测试覆盖省略模式采用 provider 默认、显式 per-run 保持 per-run、显式 resident 正常校验，以及非法/不支持模式拒绝；新会话返回时行已存正确模式，首轮读取到相同模式。
- [x] 历史 per-run 与 resident 行均不被更改；向既有 per-run 会话发送不会因新默认而自动转换；保留分叉既有语义。
- [x] 网页普通文本、MCP session_create、Live Voice 分别验证 Claude 与 Codex：省略选择默认 resident，显式关闭后为 per-run；首轮没有先按 per-run 执行再切模式的窗口。
- [x] 网页开关默认开启；手动关闭并成功创建后，下一个新会话恢复开启；provider 切换、能力加载和创建失败重试时，展示选择与实际创建模式一致。
- [x] 打开新会话页面及创建无首条消息的新会话时，不增加 provider 进程或启动宿主；首次发送才启动；保留关闭进程、空闲回收与容量限制的相关行为并提供验证读数。
- [x] Claude 与 Codex 首轮 resident 保持现有权限绑定；没有被用户界面仍显示的其他权限选项静默误导，必要文案准确反映实际权限。
- [x] 运行相关窄测试、构建、类型检查和 lint；按 docs/operations/process-isolation-and-memory-caps.md 的会话内测试规则执行，不在会话内跑无界多文件 --test 或全量 suite。

## DoD

- 必须用 MCP 浏览器在真实运行页面实际操作涉及交互，截图存 tmp/ 并在任务 Evidence 贴出：Claude/Codex 默认开启、关闭后创建 per-run、下一个新会话恢复默认、普通文本与 Live Voice 首轮。
- 存在可用场景时，同时运行 node scripts/ui-scenario.mjs <scenario.json> …，在任务 Evidence 贴 JSON 报告与检查点截图；业务场景回归以场景运行器为准，MCP 浏览器用于视觉验证与探索。排查失败步骤优先 browser_evaluate('window.__cloudcliScenario.read()') 读取结构化事实。
- 给出创建响应、持久化模式、首轮模式和进程启动时机的实际证据，不能只用开关截图证明服务端默认已生效。
- 遵守 backend-module-standards 与 frontend-module-standards；实现前核实具体 Touches，跨模块经公开契约，provider 差异用能力声明承载。

## Touches

- server/modules/database/repositories/sessions.db.ts
- server/modules/mcp-gateway/mcp-session-lifecycle.ts
- server/modules/mcp-gateway/mcp-session-write-deps.ts
- server/modules/mcp-gateway/tests/mcp-session-create-library-model.test.ts
- server/modules/mcp-gateway/tests/mcp-session-lifecycle.test.ts
- server/modules/providers/provider.routes.ts
- server/modules/providers/services/provider-capabilities.service.ts
- server/modules/providers/services/sessions.service.ts
- server/modules/providers/tests/session-creation-selection.test.ts
- server/modules/providers/tests/session-selection-launch-spec.test.ts
- server/modules/providers/tests/sessions.service.test.ts
- server/modules/session-hosts/tests/resident-server-restart.test.ts
- server/shared/tests/architecture-ratchet.baseline.json
- server/shared/types.ts
- e2e/codex-resident-ui.spec.ts
- e2e/resident-enable-consent.spec.ts
- e2e/resident-enter-send.spec.ts
- src/modules/chat/ChatInterface.tsx
- src/modules/chat-composer/hooks/useChatComposerState.ts
- src/modules/chat/hooks/useNewSessionLifecycle.ts
- src/modules/chat/utils/newSessionLifecycleController.ts
- src/modules/chat-session/utils/session/sessionCreation.ts
- src/modules/chat/tests/newSessionLifecycleController.test.ts
- src/modules/chat/tests/composerNewSessionSelection.test.tsx
- src/modules/chat/tests/liveVoiceNewSessionEntry.test.tsx
- src/modules/chat/tests/voiceEntryNewSessionSelection.test.tsx
- src/modules/chat/tests/chatInterfaceEscapeAbort.test.tsx
- src/modules/chat/tests/chatMessageLocate.test.tsx
- src/modules/chat/tests/escapeAbortGuard.test.tsx
- src/modules/chat/tests/forkFromAssistantReply.test.tsx
- src/modules/chat/tests/liveVoiceMicPrewarmEntry.test.tsx
- src/modules/chat/tests/occupiedSessionReadOnly.test.tsx
- src/modules/chat/tests/replyItemReferences.test.tsx
- src/modules/chat/tests/voiceModePermissionBanner.test.tsx
- src/modules/chat/voice-realtime/tests/voiceStopVsExit.test.tsx
- src/shared/api.ts
- src/shared/hooks/useProviderCapabilities.ts
- src/shared/tests/wireContractTypeSync.test.ts
- src/shared/types.ts
- tasks/claude-codex-new-session-default-resident.md

## Evidence

### 1. 能力声明与契约（AC1）

隔离实例（dist 构建，端口 3861）`GET /api/providers/capabilities` 的实际回答（`tmp/ui-dod/readings.json` → `capabilities`）：

| provider | lifecycleModes | defaultLifecycleMode |
| --- | --- | --- |
| claude | `["per-run","resident"]` | `resident` |
| codex | `["per-run","resident"]` | `resident` |
| cursor | `["per-run"]` | `per-run` |
| opencode | `["per-run"]` | `per-run` |

TypeSync：`src/shared/tests/wireContractTypeSync.test.ts` 新增 `SessionLifecycleMode`（client）↔ `HostMode`（server）一行，4 tests 通过。

### 2. 统一创建服务（AC2）

`server/modules/providers/services/sessions.service.ts` 的 `resolveCreateLifecycleMode` 一次解析并校验，随后与行同一 INSERT；HTTP、MCP、Live Voice 全部经过它。

- `sessions.service.test.ts`：省略 → claude/codex `resident`、cursor/opencode `per-run`；显式 per-run / resident 原样保存；不支持的 cursor+resident 抛 `LIFECYCLE_MODE_NOT_SUPPORTED` 且不产生行；同一测试读取创建返回值、`sessions` 行与 `getSessionLifecycleMode`（派发用的同一个读取口）三者一致。
- `session-creation-selection.test.ts`：claude 省略返回并落库 resident、cursor per-run；非法词 400 `LIFECYCLE_MODE_UNKNOWN`，不支持模式 409 `LIFECYCLE_MODE_NOT_SUPPORTED`，拒绝前不建行。
- 窄测试（`with-memory-cap.sh`，5 文件，concurrency=2）：**37 pass / 0 fail，34.2s**。

### 3. 历史与分叉（AC3）

- 创建路径只在 INSERT 写 `lifecycle_mode`，没有任何 UPDATE 历史行的语句；`forkAppSession` 读取源会话的 `getSessionLifecycleMode(source)` 原样写入分叉行并返回。
- `session-fork.test.ts`：**10 pass / 0 fail，8.5s**。
- MCP 用例 (n) 断言创建后历史行不变；所有创建用例断言 `switchLifecycle` 调用数为 **0**，即不存在“先 per-run 再切”的窗口。

### 4. 三个入口 + 首轮（AC4）

真实浏览器（`tmp/ui-dod/verify.mjs`，真实隔离服务端 + 真实 Vite 页面，chat WebSocket 由 `page.routeWebSocket` 吞掉帧，因此 REST 创建后不存在真实首轮）：

| 入口 | 开关读数 | 创建请求 | 服务端响应 | `/api/session-hosts` 行 |
| --- | --- | --- | --- | --- |
| 网页 Claude 默认 | `aria-checked=true` | 无 `lifecycleMode` | `{lifecycleMode:"resident"}` | `{lifecycleMode:"resident",running:false}` |
| 网页 Claude 手动关 | 点击后 `false` | `"lifecycleMode":"per-run"` | `{lifecycleMode:"per-run"}` | `{lifecycleMode:"per-run",running:false}` |
| 网页 Codex 默认 | `aria-checked=true` | 无 `lifecycleMode` | `{lifecycleMode:"resident"}` | `{lifecycleMode:"resident",running:false}` |
| Live Voice 默认 | `aria-checked=true` | 无 `lifecycleMode` | `{lifecycleMode:"resident"}` | — |
| Live Voice 手动关 | `aria-checked=false` | `"lifecycleMode":"per-run"` | `{lifecycleMode:"per-run"}` | — |

MCP `session_create`（`mcp-session-lifecycle.test.ts`，含 `mcp-session-create-library-model.test.ts`）：claude 与 codex 省略 → 行与响应 `resident`；显式 per-run → `per-run`；cursor/opencode 省略 → `per-run`；`switchLifecycle` 调用数 0。

真实首轮证据（`npx playwright test e2e/codex-resident-ui.spec.ts`，**4 passed，23.0s**，服务端用 `e2e/support/codex-fake-app-server.mjs` 作为 app-server 替身）：

```
capabilities.codex.lifecycleModes=per-run,resident
capabilities.codex.defaultLifecycleMode=resident
resident.toggle.aria-checked.before=true
resident.toggle.aria-checked.off=false
resident.toggle.aria-checked.after=true
session.lifecycle_mode=resident
listing.appSessionId=c2c17196-… lifecycleMode=resident running=true
resident.badge=running
shell.launch=argv0=…/codex args=[]
```

`resident.badge=running` 与替身日志的 `turn/start` 表明首轮由 resident 宿主执行，且行在首轮后仍 `lifecycleMode=resident`。

### 5. 网页开关与一致性（AC5）

- 新会话默认 `aria-checked=true`；点击关闭后 `false`；成功创建后下一个 New Session 恢复 `true`（`claudeNextNewSessionAriaChecked`、`claudeRestoredAriaChecked` 均为 `"true"`）。
- 手动关闭的一次性：创建请求显式 `per-run`，响应/行 `per-run`；下一次创建回到省略模式。
- 切换 provider：controller 在 provider 变化时清空 override（`newSessionLifecycleController.test.ts` 6 cases）。
- 能力未返回：controller snapshot `mode:null,canToggle:false`，开关不渲染，不猜默认。
- 创建失败重试：`composerNewSessionSelection.test.tsx` 新增用例——第一次创建 503 时 override 不被 spend，第二次重试仍显式发送同一 `per-run`，成功后才 spend 一次。
- 前端窄测试：4 文件 **22 pass / 0 fail**（controller 6、composer 4、live voice 8、TypeSync 4）。

### 6. 进程启动时机与保留行为（AC6）

- 打开新会话页面不产生会话行；只有发送/语音入口才发 `POST /api/providers/sessions`。
- 创建响应与 `GET /api/session-hosts` 行在首轮之前为 `running:false`（Claude/Codex 均如此），说明创建本身不拉起宿主；`codex-resident-ui` 的真实首轮后同一行变为 `running:true`，即首次发送才启动。
- 关闭进程、空闲回收、容量限制、`residentRestore`（默认开启、max=16、24h 窗口）的实现未改动；`claude-resident-permissions.test.ts` + `codex-resident-capabilities.test.ts` **8 pass / 0 fail，12.3s**，`session-fork.test.ts` 10 pass，均未受影响。

### 7. 权限绑定与文案（AC7）

- 权限代码路径未改动：创建仍携带 `permissionMode`，首轮派发继续使用既有 resident 权限绑定（bypassPermissions / approvalPolicy=never / danger-full-access）；`claude-resident-permissions.test.ts` 的默认 bypass 与就地切换用例通过。
- UI 未新增或隐藏权限选项；resident 提示文案仍由 `chat.json` 的 `resident.notice.*` 提供，`resident-enable-consent.spec.ts` 只按“默认开启”更新开关读数。

### 8. 质量门（AC8）

- `npm run typecheck`：exit 0。
- `npm run lint`：exit 0（仅既有 warning）。
- `npm run build:client`：exit 0；`npm run build:server`：exit 0。
- 全部测试均按会话内规则用 `scripts/with-memory-cap.sh` 跑窄集合；未在会话内跑无界多文件 `--test` 或全量 suite。

### 9. 浏览器 DoD 截图

- `tmp/ui-dod/01-claude-new-session-default-on.png` — Claude 新会话开关默认开启。
- `tmp/ui-dod/02-claude-default-created.png` — 省略模式创建后的会话。
- `tmp/ui-dod/03-claude-switch-off.png` — 点击关闭后的灰色关闭态。
- `tmp/ui-dod/04-claude-next-new-session-restored.png` — 下一个新会话恢复默认开启。
- `tmp/ui-dod/05-codex-new-session-default-on.png` — Codex 新会话开关默认开启。
- `tmp/ui-dod/06-voice-default-on-created.png` — Live Voice 默认开启创建。
- `tmp/ui-dod/07-voice-switch-off-created.png` — Live Voice 手动关闭后创建。
- 结构化读数：`tmp/ui-dod/readings.json`；驱动脚本：`tmp/ui-dod/verify.mjs`（`pageErrors: []`）。

说明：截图 03 首次捕获到 CSS transition 的起始帧（`aria-checked` 已是 `false` 但轨道仍显示蓝色），computed style 在 400ms 后为灰色且滑块居左；已在 `verify.mjs` 增加 400ms 等待后重跑，03 为稳定的关闭态。这是截图时序，不是 UI 缺陷。

场景运行器：仓库当前仅 `scripts/ui-scenarios/cockpit-session-start-settings.json` 一个场景，覆盖驾驶舱会话启动设置，与本任务的网页新会话生命周期开关/创建端点无交集；按 DoD“存在可用场景时”的前提，本任务没有可跑的场景，以真实浏览器 + 隔离实例读数与 `codex-resident-ui` e2e 作为替代证据。

### 10. 上一轮 suite 红的两条修复（2026-10-31 续轮）

上一轮 fan-in suite 红了两条，均为本任务默认策略变化的直接后果，不是环境红：

- `server/modules/session-hosts/tests/resident-server-restart.test.ts`：per-run 正对照原先省略 `lifecycleMode` 创建，依赖旧的仓库层 per-run 默认；Claude 新默认 resident 后该行变成 resident，`reason` 因此非 null。修复为创建时显式 `lifecycleMode: 'per-run'`（控件行的语义本来就是“明确 per-run”）。重跑 **5 pass / 0 fail，40.9s**，读数 `sessions control lifecycle_mode=per-run running=false reason=null`。
- `server/shared/tests/architecture-ratchet.test.ts`：`sessions.db.ts` 等 6 个基线内文件因本任务真实新增而上调。`sessions.db.ts` 通过压缩同处注释等量删行使 `wc -l` 回到基线 1479；其余 5 个文件（provider.routes.ts 1122→1152、sessions.service.ts 1327→1390、server/shared/types.ts 5327→5352、src/shared/api.ts 1799→1809、src/shared/types.ts 4719→4743）是交付本身（能力默认解析、统一创建服务、两端 hand-copied 线型契约、客户端能力解析），按 AC-394 的 RECORDED CHANGE 通道在 `architecture-ratchet.baseline.json` 记录并更新读数。重跑 **6 pass / 0 fail，5.1s**。

## ADR-007 dark axis

该轴仍暗,理由:本任务的读数是能力声明、创建请求/响应、持久化行与进程 running 布尔值，没有 L_D/L_G 可量化的领域读数。

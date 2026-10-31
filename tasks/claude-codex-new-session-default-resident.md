---
id: claude-codex-new-session-default-resident
title: Claude Code 与 Codex 新会话默认 resident：后端统一策略、创建时落库、网页/MCP/语音一致
status: todo
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

- [ ] 后端能力响应声明 Claude 与 Codex 的默认生命周期为 resident；其他 provider 保持原有默认；前端对应线型契约按仓库要求有 TypeSync 覆盖。
- [ ] 统一创建服务测试覆盖省略模式采用 provider 默认、显式 per-run 保持 per-run、显式 resident 正常校验，以及非法/不支持模式拒绝；新会话返回时行已存正确模式，首轮读取到相同模式。
- [ ] 历史 per-run 与 resident 行均不被更改；向既有 per-run 会话发送不会因新默认而自动转换；保留分叉既有语义。
- [ ] 网页普通文本、MCP session_create、Live Voice 分别验证 Claude 与 Codex：省略选择默认 resident，显式关闭后为 per-run；首轮没有先按 per-run 执行再切模式的窗口。
- [ ] 网页开关默认开启；手动关闭并成功创建后，下一个新会话恢复开启；provider 切换、能力加载和创建失败重试时，展示选择与实际创建模式一致。
- [ ] 打开新会话页面及创建无首条消息的新会话时，不增加 provider 进程或启动宿主；首次发送才启动；保留关闭进程、空闲回收与容量限制的相关行为并提供验证读数。
- [ ] Claude 与 Codex 首轮 resident 保持现有权限绑定；没有被用户界面仍显示的其他权限选项静默误导，必要文案准确反映实际权限。
- [ ] 运行相关窄测试、构建、类型检查和 lint；按 docs/operations/process-isolation-and-memory-caps.md 的会话内测试规则执行，不在会话内跑无界多文件 --test 或全量 suite。

## DoD

- 必须用 MCP 浏览器在真实运行页面实际操作涉及交互，截图存 tmp/ 并在任务 Evidence 贴出：Claude/Codex 默认开启、关闭后创建 per-run、下一个新会话恢复默认、普通文本与 Live Voice 首轮。
- 存在可用场景时，同时运行 node scripts/ui-scenario.mjs <scenario.json> …，在任务 Evidence 贴 JSON 报告与检查点截图；业务场景回归以场景运行器为准，MCP 浏览器用于视觉验证与探索。排查失败步骤优先 browser_evaluate('window.__cloudcliScenario.read()') 读取结构化事实。
- 给出创建响应、持久化模式、首轮模式和进程启动时机的实际证据，不能只用开关截图证明服务端默认已生效。
- 遵守 backend-module-standards 与 frontend-module-standards；实现前核实具体 Touches，跨模块经公开契约，provider 差异用能力声明承载。

## Touches

实施前核实具体文件；预计涉及：
- server/modules/providers/ 的 provider 能力声明及公开契约
- server/modules/ 下统一会话创建服务、创建路由与相关调用入口
- server/modules/mcp-gateway/mcp-session-lifecycle.ts 及相关 tests
- src/shared/hooks/useProviderCapabilities.ts、src/shared/api.ts 与线型契约
- src/modules/chat/ChatInterface.tsx 与新会话选择状态 owner
- src/modules/chat-composer/hooks/useChatComposerState.ts
- 普通文本及 Live Voice 的相关窄测试、UI 场景与浏览器验收
- tasks/claude-codex-new-session-default-resident.md

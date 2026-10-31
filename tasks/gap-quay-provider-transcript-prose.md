---
id: gap-quay-provider-transcript-prose
title: 统一 provider 会话正文读取，修复 Codex 会话的 Quay goals/tasks 漏显示
status: ready
labels:
  - gap
  - defect
parent: null
children: []
extra: {}
---
## Proposal

用户授权：保留 SessionPulsePopover 的“正文提及过的 Quay goals/tasks”定义，为 Codex 补齐支持，并将 Claude/Codex 原始 transcript 格式识别封装到 provider 层。

问题：session-mentions.service.ts 的 readMessageText 只识别顶层 user/assistant，Codex 的 response_item.payload 和 event_msg.payload 被跳过。真实 Codex transcript 复现：101 行含 15 行 response_item/message，当前 mentions reader 接受 0 行。项目 in-flight 使用独立快照，因而仍正常。Claude 路径也独立实现正文抽取，未复用已有内部内容识别。

<!-- dedup-ref --> 2026-10-31 检索 Quay 任务的 正文、session-mentions、transcript parsing，并核对已有 gap-quay-session-mentions-and-lanes-only-readings、gap-session-mentions-reads-event-fresh-index-and-caches-goals、gap-claude-transcript-parsing-dedupe（均 done）：分别交付原始 mentions、索引/缓存优化、Claude 格式复用，不覆盖本次跨 provider 正文能力与 Codex 接入。历史不可见另由 gap-session-edit-preparation（done）、gap-session-binding-consistency（ready，AC-446）和 gap-session-edit-continuity-e2e（todo，AC-447）认领；本任务不重复实现绑定修复或恢复真实用户数据。

## Plan

1. 复核 Claude/Codex 历史与搜索使用的 transcript-format 工具，明确“用户/助手正文”契约。统一输出 role、text、timestamp；共享类型/能力接口遵循 server/shared/types.ts 与 interfaces.ts 归属规则。provider sessions 能力提供轻量正文 reader，由 registry 选择并经 providers barrel 对外；Quay 经依赖注入消费，不深导入 provider 实现，不新增 provider ID 判断。不调用完整 fetchHistory 代替增量扫描。
2. Claude reader 复用 claude-transcript-format 的已有规则，支持 user/assistant 字符串与 text blocks；核对 isMeta、内部提示和命令包装。工具、thinking、内部注入、命令输出不计入正文；展示可见不等于提及来源。必要的纯规则放在 provider 自有格式文件中，历史/搜索只复用确实相同的规则，不扩展为全面重写。
3. Codex reader 复用 isVisibleCodexUserMessage、extractCodexText：用户支持 event_msg/user_message 与 item_completed/UserMessage；助手支持 response_item/message role=assistant。排除 reasoning、工具输入/结果、内部注入和生命周期事件。以权威载体选择或可靠消息身份消除重复，不按文本相同去重，合法重复发言应保留。使用当前版本真实脱敏结构确认各种载体，不能凭猜测纳入 response_item user 内部输入。
4. Quay 保留字节增量扫描、完整行消费、候选词缓存、每次关联当前 task/goal 索引、大小写与完整 ID 匹配、phase 与 task→criterion→goal 关联。明确 reader 状态生命周期；需要去重状态时由 reader 对象持有，文件替换/路径变化/绑定变化时与扫描游标一起重置。检查同路径截断、轮换与现有文件替换检测的边界，补足本任务承诺覆盖的情况。
5. transcript 缺失/不可读须能区分于“读取成功但没有提及”，不伪装为空结果。沿现有错误通道或最小扩展表达；若改变 wire contract，同步双方类型和 TypeSync 判据、前端状态与文案，保持已读到的项目 in-flight 正常。绑定路径由现有绑定任务负责；本任务只保证读取层随当前绑定失效/重扫。
6. 聚焦行为测试后验证真实页面。真实会话验证前确认绑定有效；有故障不直接改真实 DB，记录并交现有绑定任务。弹层保留打开时读取语义，关闭重开验收，不加入持续轮询。

## AC

- [ ] Codex 用户/助手正文提及的现存 Quay task/goal 能通过实际 mentions service 返回，并在 SessionPulsePopover 展示 title/status/phase 与 goal 关联；项目 in-flight 不受影响。
- [ ] Claude 常见消息格式回归正常；内部注入、isMeta、tool call/result、thinking/reasoning、命令输出和非正文事件中的 ID 均不产生提及。
- [ ] Codex 新旧用户载体、助手正文均有真实结构夹具；重复载体只计一次，独立的相同文本消息仍分别计数。恢复旧 reader 或去掉载体去重规则时对应行为用例失败。
- [ ] 增量追加只消费新增完整行，不重计；半行等待补齐；路径/绑定替换及支持的文件截断/替换使 reader 与游标重置。原文先提及、随后新增索引记录，无须重扫即可关联。
- [ ] 文件缺失/不可读与成功空结果可区分，前端沿明确错误状态展示；恢复可读后重新打开能重试成功，独立项目快照继续显示。
- [ ] provider 原始格式只由对应 provider 拥有；Quay 不再自行识别 Claude/Codex 格式，不新增 provider ID 分支；完整历史/搜索无需被全面重写。
- [ ] 按仓库内存规则运行窄范围 provider 正文、Quay mentions、相关历史/搜索回归；按最终改动完成 typecheck/build/lint。wire 有变化时 TypeSync 与前端对应测试通过。记录实际命令和结果，不以静态扫描替代行为断言。

## DoD

MCP 浏览器在真实运行页面亲手走 Codex 与 Claude 正文提及、关闭重开、切换会话及错误恢复故事；截图存 tmp/ 并贴进 Evidence。存在可用场景时同时执行 node scripts/ui-scenario.mjs <scenario.json>，附 JSON 报告和检查点截图；若已有场景不能覆盖，添加小型隔离场景。排查失败优先 window.__cloudcliScenario.read() 的结构化读数。测试使用临时 DB/fixture，不修改活会话 transcript，不重启承载用户会话的共享服务。区分 fixture、真实 CLI 和真实页面证据。

## Touches

- server/shared/types.ts
- server/shared/interfaces.ts
- server/shared/index.ts
- server/modules/providers/index.ts
- server/modules/providers/services/*transcript*
- server/modules/providers/list/claude/claude-transcript-format.ts
- server/modules/providers/list/claude/claude-sessions.provider.ts
- server/modules/providers/list/codex/codex-transcript-format.ts
- server/modules/providers/list/codex/codex-sessions.provider.ts
- server/modules/providers/tests/*transcript*
- server/modules/quay/session-mentions.service.ts
- server/modules/quay/quay.module.ts
- server/modules/quay/quay.routes.ts
- server/modules/quay/tests/session-mentions.test.ts
- src/shared/types.ts
- src/shared/tests/*TypeSync*
- src/modules/quay/hooks/useSessionPulse.ts
- src/modules/quay/SessionPulsePopover.tsx
- src/modules/quay/tests/SessionPulse.test.tsx
- src/modules/i18n/locales/*/common.json
- scripts/ui-scenarios/*quay*mentions*.json
- tasks/gap-quay-provider-transcript-prose.md

## 约束

遵循 AGENTS.md 与 backend-module-standards；触及 src/ 时遵循 frontend-module-standards。服务约 260 行按职责拆分，能力经接口/registry 与 barrel 组合；状态封装在生命周期 owner 内。保持本次为独立 task，不新建 goal、不自动挂不相关 AC。任务范围为 Quay 记录的正文提及，不同步 Codex 原生 goals/plans/subagents，不改成“本会话创建过的任务”。

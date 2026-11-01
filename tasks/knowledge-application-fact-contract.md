---
id: knowledge-application-fact-contract
title: 知识主动应用事实契约：关联回复、配置实际证据与活动读口
status: ready
labels:
  - feature
  - knowledge-application
  - contract
parent: null
children: []
extra:
  schema: execution
  acceptance: npx tsx --tsconfig server/tsconfig.json --test
    server/modules/mcp-gateway/tests/mcp-knowledge-facts.test.ts
  applicationProgram:
    project: quay-fleet
    goal: GOAL-010
    ac: AC-090
  external_dependencies:
    - project: quay-fleet
      taskId: fleet-knowledge-application-contract
      contractRef: docs/specs/knowledge-application-contract.md
---
## Proposal

为 Fleet 首批三项文本知识提供正式 producer/read 契约。现有读口先做能力审计，缺失才增补：关联询问与回复的 source/target/correlation/operation，Claude 配置 expected/stored/actual 与 process/build/request identity，以及清单 scope/pagination/truncated/provider/lifecycle。事件只作触发线索，决定前可回读权威事实。来源时间、版本、未知与读取错误完整暴露；不把 Fleet 服务直接读取 CloudCLI home 作为接口。F1 契约交付后按版本实现双方兼容。

立案初始状态为 todo，后续实现按项目正常任务生命周期推进；立案及 Goal 激活不代替开发者确认应用卡片。实现时遵循现有 TS/运行入口约定；已有能力优先复用。历史来源用于发现跟进对象，当前事实决定动作，记录此刻跟进什么、依据是否足够、何时应回报。

<!-- dedup-ref -->
粒度决定：按人已确认的十项 Fleet/两项 CloudCLI 边界独立立案；共享接线文件按 Touches 串行，保留独立验收；本项目既有开放任务无 substantive Touches 重叠。

<!-- dedup-ref -->
跨项目交付条件：quay-fleet/fleet-knowledge-application-contract。以项目、任务、契约版本与实际可读回执核对；能力未交付时记录 blocked/unknown，不假设可用，不直接读取外部 home。外部引用另存 extra.external_dependencies，不冒充本地关系。

## AC

- [x] `npx tsx --tsconfig server/tsconfig.json --test server/modules/mcp-gateway/tests/mcp-knowledge-facts.test.ts` 退出码 0，覆盖本任务正文的正例和反例，缺失证据必须明确拒绝。
- [x] 执行 `npx tsx --tsconfig server/tsconfig.json --test server/modules/context-events/tests/knowledge-activity-events.test.ts` 返回 0，验证一次新活动与权威回读能按同一 operation 关联；未知字段不捏造。
- [x] 执行 `npx tsx --tsconfig server/tsconfig.json --test server/shared/tests/server-import-cycle-budget.test.ts` 返回 0；遵守 backend-module-standards，模块间只走 public index/共享接口，组合根注入读依赖。

## DoD

在隔离运行 CloudCLI 实例操作实际会话读对象，经正式网关读到本次关联事实与缺失标记，给出请求/响应和版本证据；Fleet 不需读取本项目私有 home。调用测试遵守进程内存限制，不在会话内执行无界测试全集。

验收必须操作本任务负责的真实机制对象并保留读回证据；局部实现可在隔离运行实例操作持久对象，首批业务投产闭环统一在 F10 收证，夹具不能冒充真实生产结果。

- 该轴仍暗,理由:quay-fleet 的 docs/specs/knowledge-application-contract.md 未交付，本机只声明自有契约 v1，跨项目 schema 兼容性无法验证（extra.external_dependencies 已记录该外部依赖）

## Touches

- docs/architecture/knowledge-application/FACT-CONTRACT.md (new)
- server/modules/context-events/knowledge-activity-events.ts (new)
- server/modules/context-events/context-events.module.ts
- server/modules/context-events/index.ts
- server/modules/mcp-gateway/mcp-knowledge-facts.ts (new)
- server/modules/mcp-gateway/mcp-gateway.read-tools.ts
- server/modules/mcp-gateway/mcp-read-tools-registry.ts
- server/modules/mcp-gateway/index.ts
- server/knowledge-facts-wiring.ts (new)
- server/index.ts
- server/shared/interfaces.ts
- server/shared/tests/architecture-ratchet.baseline.json
- docs/evidence/knowledge-application-fact-contract.json (new)
- server/modules/mcp-gateway/tests/mcp-knowledge-facts.test.ts (new)
- tasks/knowledge-application-fact-contract.md
- server/modules/context-events/tests/knowledge-activity-events.test.ts (new)
- server/shared/knowledge-facts.ts (new)
- server/modules/context-events/session-ask-stream-reader.ts
- server/modules/mcp-gateway/mcp-tool-annotations.ts
- server/modules/mcp-gateway/mcp-tool-error-codes.ts
- server/modules/mcp-gateway/tests/mcp-tool-annotations.test.ts
- server/modules/mcp-gateway/tests/mcp-error-vocabulary.test.ts

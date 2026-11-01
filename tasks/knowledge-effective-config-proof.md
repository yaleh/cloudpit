---
id: knowledge-effective-config-proof
title: 参数生效事实：本次操作的实际请求与应答及字段级未知
status: todo
labels:
  - feature
  - knowledge-application
  - runtime-integration
parent: null
children: []
extra:
  schema: execution
  acceptance: npx tsx --tsconfig server/tsconfig.json --test
    server/modules/mcp-gateway/tests/knowledge-effective-config-proof.test.ts
  applicationProgram:
    project: quay-fleet
    goal: GOAL-010
    ac: AC-090
  runtimeIntegration: true
  external_contract:
    project: quay-fleet
    contract: docs/specs/knowledge-application-contract.md
    version: 1
    compatibility: additive; probe before use; unavailable capability stays unknown
---
## Proposal

人 2026-11-01 已批准这五项接线任务及生产部署核验。保持现有 record-only 观察；不关闭 F10 或 GOAL-010，不制造授权或原目标，不通过新消息唤醒等待中的会话。无固定七天门槛；真实人工决定只在有新决策必要时要求，已有授权内只读调查不重复审批。

当前 effective_config 的 actual 主要是 live/pid/runId，不能证明 model/effort 已实际生效。补充能追到本次 launch/apply/reconfigure 的 request/response/provenance 字段：实际发送配置、实际应答模型/effort（来源支持时）、session/providerSession/run/process/build 身份、观察时刻及 sourceRef。expected 由 Fleet 原操作/启动档案传入，不从 DB 值倒推期望。

字段逐一判 evidence/unknown：只读到进程启动配置时标为启动配置，不冒充当前请求；只读到 DB/stored 或 next-turn 不能 verified。请求/应答/进程/构建属于旧 operation 时拒绝用于本次核验。若某 provider/字段根本没有回读来源，契约如实声明能力缺失，不补造值，不将几层 evidence 的数量当成功。首轮范围只含 Claude 路径。

<!-- dedup-ref -->
关联但不同机制：knowledge-application-fact-contract、fleet-p2-launch-audit-expected-effective-actual（Fleet）。这些已完成任务交付组件，本任务补实际运行接线及缺失语义；按人的五项拆分保留独立验收，共享 Touches 串行。

## AC

- [ ] `npx tsx --tsconfig server/tsconfig.json --test server/modules/mcp-gateway/tests/knowledge-effective-config-proof.test.ts` 退出 0；覆盖正文要求的正例、反例及真实公共入口，不能只扫描代码里有没有函数名。
- [ ] 执行 `npx tsx --tsconfig server/tsconfig.json --test server/modules/mcp-gateway/tests/knowledge-effective-config-proof.test.ts` 返回 0；隔离实际实例通过公共读口对一个具体 Claude 操作读取分层来源和身份，存在的来源保留真实引用，缺失字段显式 unknown。
- [ ] 同测试验证仅 DB/next-turn/live/旧进程/旧应答/未知 effort 均不能宣布本次参数生效；本次期望与可读的实际字段一致才逐字段验证。
- [ ] 遵循 backend-module-standards 和项目资源限制，相关测试逐文件执行；更新可探测的兼容契约及 Fleet 消费样例，避免引入跨模块私有导入。

## DoD

在隔离运行实例实际操作配置核验对象，经真实网关回读当前请求/应答与来源缺口，报告验证/未验证字段；不能用伪造完整字段覆盖来源不足，生产配置变更核验留给 F10。

组件机制在运行实例操作具体对象并真实回读，注明隔离/受控/自然；生产部署、三项业务验收和真实开发者点击由 F10 与当前会话收证，不可把替身/夹具当成生产已启用。不得自动标 F10 或 Goal 完成。

## Touches

- server/shared/knowledge-facts.ts
- server/knowledge-facts-wiring.ts
- server/modules/mcp-gateway/mcp-knowledge-facts.ts
- server/modules/observation/session-digest-llm-settings.ts
- server/modules/observation/index.ts
- docs/architecture/knowledge-application/FACT-CONTRACT.md
- docs/evidence/knowledge-effective-config-proof.json (new)
- server/modules/mcp-gateway/tests/knowledge-effective-config-proof.test.ts (new)
- tasks/knowledge-effective-config-proof.md (new)

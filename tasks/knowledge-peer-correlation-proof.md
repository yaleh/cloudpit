---
id: knowledge-peer-correlation-proof
title: 跨会话结果事实：原询问、投递和真实对端回复的关联证明
status: ready
labels:
  - feature
  - knowledge-application
  - runtime-integration
parent: null
children: []
extra:
  schema: execution
  acceptance: npx tsx --tsconfig server/tsconfig.json --test
    server/modules/mcp-gateway/tests/knowledge-peer-correlation-proof.test.ts
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

当前 knowledge_facts peer_result 取自 session.asking/answered，targetSessionId/authorization/reply/answeredMessageId 常为 unknown，普通问答不能证明跨会话询问完成。对正式 session_send/投递机制建立可回读 correlation/deliveryId/原会话/目标会话/原消息与回复消息身份；按服务器实际保存的投递与会话 transcript 验证，不能只信调用方传参。由 Fleet 传来的已授权询问上下文只作为查询定位，授权范围仍以 Fleet 的人类授权引用为准，CloudCLI 不因回复而授予动作权限。

保留旧 peer_result 普通问答形状向后兼容，新跨会话能力须可探测、按版本说明；没有可靠投递或回复关联时明确 unknown，不拼接最近一条消息冒充答复。增加或扩展公共读口；不读写 Fleet 私有 home，不为了测试对真实人类会话外发消息。

<!-- dedup-ref -->
关联但不同机制：knowledge-application-fact-contract、observation-session-ask-event-writer-wiring。这些已完成任务交付组件，本任务补实际运行接线及缺失语义；按人的五项拆分保留独立验收，共享 Touches 串行。

## AC

- [ ] `npx tsx --tsconfig server/tsconfig.json --test server/modules/mcp-gateway/tests/knowledge-peer-correlation-proof.test.ts` 退出 0；覆盖正文要求的正例、反例及真实公共入口，不能只扫描代码里有没有函数名。
- [ ] 执行 `npx tsx --tsconfig server/tsconfig.json --test server/modules/mcp-gateway/tests/knowledge-peer-correlation-proof.test.ts` 返回 0；隔离运行的正式网关使用真实受控会话与投递记录走过询问→对应回复→公共读回，记录 build/boot/operation/correlation/messageId。
- [ ] 同测试覆盖错目标、旧回复、错 correlation、无投递记录、普通 answered 缺回复 messageId、未授权字段；每类显式 unknown/拒绝，无副作用或假成功。
- [ ] 遵循 backend-module-standards；按文件运行相关 tests 和类型检查，禁止会话内无界全套测试；向 Fleet 发布本任务正文和 FACT-CONTRACT.md 的可消费契约，不假设对端已部署。

## DoD

通过隔离实际网关和真实受控投递/会话公共入口取得带稳定身份、可追到原操作的回复事实，并留下负控原文；跨项目真正投产由 F10 验证，不发未经授权的真实外部询问。

组件机制在运行实例操作具体对象并真实回读，注明隔离/受控/自然；生产部署、三项业务验收和真实开发者点击由 F10 与当前会话收证，不可把替身/夹具当成生产已启用。不得自动标 F10 或 Goal 完成。

## Touches

- server/shared/knowledge-facts.ts
- server/knowledge-facts-wiring.ts
- server/modules/mcp-gateway/mcp-knowledge-facts.ts
- server/modules/mcp-gateway/mcp-session-send.ts
- server/modules/context-events/knowledge-activity-events.ts
- server/modules/mcp-gateway/mcp-read-tools-registry.ts
- server/modules/session-control/index.ts (new)
- docs/architecture/knowledge-application/FACT-CONTRACT.md
- docs/evidence/knowledge-peer-correlation-proof.json (new)
- server/modules/mcp-gateway/tests/knowledge-peer-correlation-proof.test.ts (new)
- tasks/knowledge-peer-correlation-proof.md

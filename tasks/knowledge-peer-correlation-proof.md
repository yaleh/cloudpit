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

- [x] `npx tsx --tsconfig server/tsconfig.json --test server/modules/mcp-gateway/tests/knowledge-peer-correlation-proof.test.ts` 退出 0；覆盖正文要求的正例、反例及真实公共入口，不能只扫描代码里有没有函数名。
- [x] 执行 `npx tsx --tsconfig server/tsconfig.json --test server/modules/mcp-gateway/tests/knowledge-peer-correlation-proof.test.ts` 返回 0；隔离运行的正式网关使用真实受控会话与投递记录走过询问→对应回复→公共读回，记录 build/boot/operation/correlation/messageId。
- [x] 同测试覆盖错目标、旧回复、错 correlation、无投递记录、普通 answered 缺回复 messageId、未授权字段；每类显式 unknown/拒绝，无副作用或假成功。
- [x] 遵循 backend-module-standards；按文件运行相关 tests 和类型检查，禁止会话内无界全套测试；向 Fleet 发布本任务正文和 FACT-CONTRACT.md 的可消费契约，不假设对端已部署。

## DoD

通过隔离实际网关和真实受控投递/会话公共入口取得带稳定身份、可追到原操作的回复事实，并留下负控原文；跨项目真正投产由 F10 验证，不发未经授权的真实外部询问。

组件机制在运行实例操作具体对象并真实回读，注明隔离/受控/自然；生产部署、三项业务验收和真实开发者点击由 F10 与当前会话收证，不可把替身/夹具当成生产已启用。不得自动标 F10 或 Goal 完成。

## 验证记录

- 隔离实例：真实 express + 生产 `mountMcpGateway` + 生产 bearer 中间件跑在 loopback；真实 better-sqlite3 文件、真实会话行、真实 transcript JSONL 位于一次性临时目录；控制服务按 transcript 实际携带的 delivery id 脚本化。未读取或写入任何 fleet 私有 home，也未向真实人类会话外发消息。
- 公共入口：先经真实 `session_send`（带 `sourceSession` + `correlationId`）接受一次 relayed ask，再经 `knowledge_facts({kind:'peer_result', deliveryId})` 读回；正例 `verified: true`，`delivery.sourceRef=delivery:<id>`，`originalMessage.messageId` 与 `reply.afterMessageId` 均可回读，`actionPermission.granted: false`。
- 负控原文（`docs/evidence/knowledge-peer-correlation-proof.json` 的 calls）：错目标 / 错 correlation / 无投递记录 / 旧回复（`KNOWLEDGE_REPLY_NOT_AFTER_DELIVERY_REASON`）/ 无该 id 行 / transcript 文件缺失 / resident 台账缺失（`KNOWLEDGE_DELIVERY_NOT_IN_LEDGER_REASON`）/ 普通 answered 无 messageId（`KNOWLEDGE_ANSWERED_MESSAGE_UNKNOWN_REASON`）/ 未授权字段，均为显式 `unknown`，读取过程 `controlCalls === 0`，无副作用。
- 按文件运行：`knowledge-peer-correlation-proof`（10/10）、`mcp-session-send`（8/8）、`mcp-session-send-delivery`（1/1）、`mcp-knowledge-facts`（7/7）、`knowledge-effective-config-proof`（12/12）、`voice-realtime-closing-turn`（20/20）、`mcp-gateway-wiring`（3/3）、`mcp-production-session-wiring`（5/5）、`quay-test-script`（14/14）、`architecture-ratchet`（6/6）、`server-import-cycle-budget`（12/12）。`npm run typecheck` 退出 0；`oxlint src/ server/ scripts/ shared/` 退出 0（仅既有 warning）。未在会话内跑全套。
- 契约：`FACT-CONTRACT.md` 新增 §3.1（输入、输出形状、verified 四条件、失败显式 unknown、进程作用域持久性边界、回复不授予动作权限）；版本仍为 1（additive，`capabilities.deliveryCorrelation` 可探测）。不假设 Fleet 侧已部署。
- 目录合规：GOAL-053 exit gate（`server/shared/tests/cloudpit-goal-exit-gate.test.ts`，AC-455）禁止新增模块目录，原 `server/modules/session-control/` 会红；故把 accepted-send ledger 及其 knowledge-facts 读回臂放进既有叶子 `server/modules/context-events/`（该目录已承载 peer_result 的 knowledge-activity 行），通过其 barrel 暴露；证据 source 标识保持 `session-control.send` 不变。同步更新 `mcp-invalid-argument` 正控（`session_send` 新增可选 `sourceSession`）并重跑：`cloudpit-goal-exit-gate`（3/3）、`mcp-invalid-argument`（4/4）、`knowledge-peer-correlation-proof`（10/10）、`mcp-knowledge-facts`（7/7）、`mcp-session-send`（8/8）、`mcp-session-send-delivery`（1/1）、`knowledge-activity-events`（6/6）、`voice-realtime-closing-turn`（20/20）、`mcp-gateway-wiring`（3/3）、`mcp-production-session-wiring`（5/5）、`quay-test-script`（14/14）、`architecture-ratchet`（6/6）、`server-import-cycle-budget`（12/12）；`npm run typecheck` 0；`oxlint` 0（仅既有 warning）。

## ADR-007 暗轴记录

该轴仍暗,理由:本任务只读事实链与受控实例证据，未进行架构图 L_D/L_G 轴读数，轴值留待架构快照轮次。

## Touches

- server/shared/knowledge-facts.ts
- server/knowledge-facts-wiring.ts
- server/index.ts
- server/modules/mcp-gateway/mcp-knowledge-facts.ts
- server/modules/mcp-gateway/mcp-session-send.ts
- server/modules/context-events/knowledge-activity-events.ts
- server/modules/context-events/index.ts
- server/modules/context-events/knowledge-delivery-ledger.ts (new)
- server/modules/context-events/knowledge-peer-transcript.ts (new)
- server/modules/context-events/knowledge-peer-delivery-read.ts (new)
- server/modules/context-events/knowledge-peer-delivery.ts (new)
- server/modules/context-events/knowledge-unknown-fields.ts (new)
- server/modules/mcp-gateway/mcp-read-tools-registry.ts
- server/modules/mcp-gateway/tests/mcp-invalid-argument.test.ts
- server/modules/voice-realtime/voice-realtime-tools.ts
- server/modules/voice-realtime/tests/voice-realtime-closing-turn.test.ts
- server/shared/tests/quay-test-script.test.ts
- scripts/suite-duration-baseline.tsv
- docs/architecture/knowledge-application/FACT-CONTRACT.md
- docs/evidence/knowledge-peer-correlation-proof.json (new)
- server/modules/mcp-gateway/tests/knowledge-peer-correlation-proof.test.ts (new)
- tasks/knowledge-peer-correlation-proof.md

## Blocker

**2026-11-01T10:48:24.501Z — worker 未落地（exited-not-landed）**

- 未落地原因：step=suite: not ok - server/shared/tests/cloudpit-goal-exit-gate.test.ts:   AssertionError [ERR_ASSERTION]: a directory outside the frozen baseline is a NEW module directory: modules/session-control. Do not raise the baseline — GOAL-053's exit gate forbids new module directories. [baseline A/B: HARD RED (task-introduced-red) — the task's red set is NOT a subset of the develop baseline red set: added=server/modules/mcp-gateway/tests/mcp-invalid-argument.test.ts,server/shared/tests/cloudpit-goal-exit-gate.test.ts,server/modules/mcp-gateway/tests/mcp-invalid-argument.test.ts,server/shared/tests/cloudpit-goal-exit-gate.test.ts changed=-]
- run_id：wk-prod-anchor
- session_id：2d4970ca-7dd5-48be-98ab-a74bf2243c77

---
id: knowledge-effective-config-proof
title: 参数生效事实：本次操作的实际请求与应答及字段级未知
status: done
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

- [x] `npx tsx --tsconfig server/tsconfig.json --test server/modules/mcp-gateway/tests/knowledge-effective-config-proof.test.ts` 退出 0；覆盖正文要求的正例、反例及真实公共入口，不能只扫描代码里有没有函数名。
- [x] 执行 `npx tsx --tsconfig server/tsconfig.json --test server/modules/mcp-gateway/tests/knowledge-effective-config-proof.test.ts` 返回 0；隔离实际实例通过公共读口对一个具体 Claude 操作读取分层来源和身份，存在的来源保留真实引用，缺失字段显式 unknown。
- [x] 同测试验证仅 DB/next-turn/live/旧进程/旧应答/未知 effort 均不能宣布本次参数生效；本次期望与可读的实际字段一致才逐字段验证。
- [x] 遵循 backend-module-standards 和项目资源限制，相关测试逐文件执行；更新可探测的兼容契约及 Fleet 消费样例，避免引入跨模块私有导入。

## DoD

在隔离运行实例实际操作配置核验对象，经真实网关回读当前请求/应答与来源缺口，报告验证/未验证字段；不能用伪造完整字段覆盖来源不足，生产配置变更核验留给 F10。

组件机制在运行实例操作具体对象并真实回读，注明隔离/受控/自然；生产部署、三项业务验收和真实开发者点击由 F10 与当前会话收证，不可把替身/夹具当成生产已启用。不得自动标 F10 或 Goal 完成。

## 实施与验证（2026-11-01，受控实例）

- 真实公共入口：生产 `mountMcpGateway` + 生产 bearer 中间件（loopback），真实 better-sqlite3 文件与真实 transcript JSONL；受控实例读数见 `docs/evidence/knowledge-effective-config-proof.json`（`instance.isolation: controlled`，未读/写 operator 数据库、`~/.quay-fleet` 或生产配置）。
- 正例：一个具体 Claude operation 的 `operation` / `actualRequest` / `actualResponse` 均为 evidence 且带真实 `sourceRef`（`<jsonl>#<uuid>`）；`model` 与 `effort` 逐字段 `verified`；`permissionMode` 由 `capabilities` 声明 `unavailable`，未回显 stored 值。
- 反例：DB-only、next-turn（run 已完成）、live-only、旧进程 boot、旧应答、未知 effort、期望不一致、无回读 provider（codex）、应答早于活进程、transcript 不可读、命名非当前 operation —— 均 `verified: false`，缺失的层或 `fields.*` 列入 `unknown`。
- 判据逐文件执行：新判据 12/12（exit 0），兄弟判据 7/7，架构棘轮通过，`server/shared/tests/quay-test-script.test.ts` 14/14。

## Touches

- server/shared/knowledge-facts.ts
- server/knowledge-facts-wiring.ts
- server/modules/mcp-gateway/mcp-knowledge-facts.ts
- server/modules/observation/session-digest-llm-settings.ts
- server/modules/observation/index.ts
- docs/architecture/knowledge-application/FACT-CONTRACT.md
- docs/evidence/knowledge-effective-config-proof.json (new)
- server/modules/mcp-gateway/tests/knowledge-effective-config-proof.test.ts (new)
- server/modules/mcp-gateway/tests/mcp-knowledge-facts.test.ts
- scripts/suite-duration-baseline.tsv
- server/shared/tests/quay-test-script.test.ts
- tasks/knowledge-effective-config-proof.md

## ADR-007 暗轴记录

该轴仍暗,理由:Fleet 侧 `docs/specs/knowledge-application-contract.md` 仍未交付 `effective-config-check` 的字段级事实 schema（该文档第 135 行明确 producer 的事实字段形状尚未落地），本机只声明自己的 contract version 1 和按 provider 的能力缺口，不冒充与未读过的外部 schema 兼容。

## Blocker

**2026-11-01T10:04:30.713Z — worker 未落地（exited-not-landed）**

- 未落地原因：step=suite: not ok - src/modules/chat/tests/authoritativeTokenReadingChannels.test.tsx: AssertionError [ERR_ASSERTION]: The input did not match the regular expression /tokenBudget=\{liveFrame\}/. Input: [baseline A/B: HARD RED (changed-assertion) — the task's red set is NOT a subset of the develop baseline red set: added=- changed=src/modules/chat/tests/authoritativeTokenReadingChannels.test.tsx]
- run_id：wk-prod-anchor
- session_id：364c7fcd-cfca-4663-b39a-a17bd5450931

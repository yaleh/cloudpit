---
id: cockpit-knowledge-decision-handoff
title: cockpit 知识建议决定交接：可信确认、修订与进展结果
status: todo
labels:
  - feature
  - knowledge-application
parent: null
children: []
extra:
  schema: execution
  acceptance: npx tsx --tsconfig server/tsconfig.json --test
    server/modules/cockpit/tests/cockpit-knowledge-decision-handoff.test.ts
  applicationProgram:
    project: quay-fleet
    goal: GOAL-010
    ac: AC-090
  external_dependencies:
    - project: quay-fleet
      taskId: fleet-knowledge-cockpit-proposals
      contractRef: docs/specs/knowledge-application-contract.md
---
## Proposal

消费 Fleet 已版本化知识建议卡与声明执行器。复用 provider/confirm/feedback 通道，保证 ruling 类可决策建议正常显示，不把信息 notify 全部显示成救援。应用/修改/推迟/不适用保留可信 UI confirmation reference，绑定卡片 revision 和用户决定；不接受调用者自填 by:human 作为证明。一次确认交付写明范围的完整计划；反馈接收只表示已交接，执行和功能核验以关联 case 状态显示。陈旧卡重新取数、重复提交同一 feedbackId、未声明执行器禁执行。

本次只创建 todo，不推进 ready/done，不启动 worker。实现时遵循现有 TS/运行入口约定；已有能力优先复用。历史来源用于发现跟进对象，当前事实决定动作，记录此刻跟进什么、依据是否足够、何时应回报。

<!-- dedup-ref -->
复用关联任务：cockpit-fleet-card-provider；本任务交付的是新增的知识应用机制，不重建这些已交付能力。

<!-- dedup-ref -->
粒度决定：按人已确认的十项 Fleet/两项 CloudCLI 边界独立立案；共享接线文件按 Touches 串行，保留独立验收；本项目既有开放任务无 substantive Touches 重叠。

<!-- dedup-ref -->
跨项目交付条件：quay-fleet/fleet-knowledge-cockpit-proposals。以项目、任务、契约版本与实际可读回执核对；能力未交付时记录 blocked/unknown，不假设可用，不直接读取外部 home。外部引用另存 extra.external_dependencies，不冒充本地关系。

## AC

- [ ] `npx tsx --tsconfig server/tsconfig.json --test server/modules/cockpit/tests/cockpit-knowledge-decision-handoff.test.ts` 退出码 0，覆盖本任务正文的正例和反例，缺失证据必须明确拒绝。
- [ ] 执行 `npx tsx --tsconfig server/tsconfig.json --test server/modules/cockpit/tests/cockpit-card-feedback.test.ts` 返回 0；用陈旧 revision、重复 feedbackId、缺失确认身份和未知执行器反例验证拒绝或幂等。
- [ ] 真实页面完成应用/修改/推迟/不适用及进行中→核验结果查看；MCP 浏览器实际操作，截图保存 tmp/ 并在证据中贴出；检查报告和截图存在且对应本次版本。
- [ ] 在隔离实例运行 `node scripts/ui-scenario.mjs --help` 确定现行参数，再执行 scripts/ui-scenarios/cockpit-knowledge-application.json 场景，退出 0；证据贴 JSON 报告与检查点截图。

## DoD

遵循本项目 backend-module-standards 与 frontend-module-standards，真实运行页面使用 Fleet 契约兼容实例展示并决定一张知识建议卡，可信确认链可回读，进行中与最终核验结果可追踪。必须完成 MCP 浏览器实操与 tmp/ 截图，同时提交场景运行器 JSON 报告及检查点截图；真实开发者确认属于 F10 生产验收，不在开发测试中冒充。

验收必须操作本任务负责的真实机制对象并保留读回证据；局部实现可在隔离运行实例操作持久对象，首批业务投产闭环统一在 F10 收证，夹具不能冒充真实生产结果。

## Touches

- server/modules/cockpit/cockpit-fleet-card-provider.ts
- server/modules/cockpit/cockpit-fleet-card-projection.ts
- server/modules/cockpit/cockpit-card-actions.ts
- server/modules/cockpit/cockpit-card-feedback-store.ts
- server/cockpit-fleet-wiring.ts
- src/modules/cockpit/cockpitCardController.ts
- src/modules/cockpit/tests/cockpitCardController.test.ts
- docs/architecture/cockpit-attention/CARD-PROVIDERS.md
- scripts/ui-scenarios/cockpit-knowledge-application.json (new)
- docs/evidence/cockpit-knowledge-decision-handoff.md (new)
- server/modules/cockpit/tests/cockpit-knowledge-decision-handoff.test.ts (new)
- tasks/cockpit-knowledge-decision-handoff.md (new)

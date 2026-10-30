---
id: gap-observation-ask-ledger-owner
title: 将 ask ledger 状态与 recovery/sweep 从 session digest producer 拆为独立责任 owner
status: ready
labels:
  - gap
parent: null
children: []
extra:
  schema: execution
depends_on:
  - gap-cockpit-ask-retraction-and-ledger-backfill
---
## Proposal

`createSessionDigestProducer` 当前承担约 762 行 orchestration；ask ledger 状态/更新与 recovery/sweep 的职责混在 producer 中，令状态写入和恢复时机难以独立验证。本任务只做 observation 侧职责结构重构：抽出明确的 ledger owner 与 recovery/sweep helper，由 producer 编排调用；复用既有事件协议和语义，不重复实现 retraction、answered、去重或其他行为。可按现状在 `session-ask-ledger.ts` 与 `session-ask-recovery.ts` 建立窄 API，并由各自 targeted tests 固定职责边界。

<!-- dedup-ref --> 与 ready peer `gap-cockpit-ask-retraction-and-ledger-backfill` 的行为 AC 不重复；本任务只拆分状态 owner/helper 并用回归测试证明其行为保持。须待该 peer 完成后再执行，以避免同文件交叠。

## AC

- [ ] `npx tsx --tsconfig server/tsconfig.json --test server/modules/observation/tests/session-digest.test.ts` 退出 0，且既有 ask ledger、retraction、answered、去重、启动回放及事件-only 行为用例数量不减少。
- [ ] 新增 `session-ask-ledger.test.ts` 针对 ledger owner 的写入、移除、retracted 记录与重复更新断言状态快照；`npx tsx --tsconfig server/tsconfig.json --test server/modules/observation/tests/session-ask-ledger.test.ts` 退出 0。
- [ ] recovery/sweep targeted tests 对启动补扫与用户回合各运行一次及重复运行，断言事件写入次数、askId/messageId 与 ledger 状态符合现有语义；`npx tsx --tsconfig server/tsconfig.json --test server/modules/observation/tests/session-ask-recovery.test.ts` 退出 0。
- [ ] producer 委托 ledger/recovery 行为且不再持有这两类状态的写入细节；`session-digest.producer.ts` 与新 owner/helper 的引用由测试断言，且 `npm run typecheck` 与 `npm run lint` 退出 0。

## DoD

在 ready peer 合入后，从实际 observation producer 调用路径驱动现有及新增 targeted tests，验证 ledger 状态变更和 recovery/sweep 仍连通真实事件写入；测试须证明重复回放幂等、故障会话不阻断其他会话，并且 producer 本身只负责编排而由明确 owner/helper 管理 ask 状态。完成记录给出命令退出码及各测试计数。

## Touches

- tasks/gap-observation-ask-ledger-owner.md
- server/modules/observation/session-digest.producer.ts
- server/modules/observation/session-ask-ledger.ts (new)
- server/modules/observation/session-ask-recovery.ts (new)
- server/modules/observation/tests/session-digest.test.ts
- server/modules/observation/tests/session-ask-ledger.test.ts (new)
- server/modules/observation/tests/session-ask-recovery.test.ts (new)
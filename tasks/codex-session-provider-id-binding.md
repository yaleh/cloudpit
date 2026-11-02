---
id: codex-session-provider-id-binding
title: 会话记录 model_provider_id：首发送落库、换 provider 拒绝 + 一键 fork、删除/改名保护
status: todo
labels:
  - feature
parent: null
children: []
extra: {}
depends_on:
  - codex-model-entry-provider-binding
goal_ac: AC-462
---
<!-- dedup-ref --> 机制去重：无会话级 provider id 既有任务（codex resident 会话任务只管 threadId/pid，不管上游 provider）。本条是 sessions 列 + 首发送落库 + 切换/删除保护。

## Proposal

**现状**：sessions 有 model/effort/permission_mode（server/modules/database/schema.ts:177-178），无上游 provider id。resolveSessionModel 只按 model id 解析。Codex resume 要求同 provider id 配置仍在，换 provider 后 resume 必断（modelProviderMismatch）。

**范围**：
1. sessions 新列 model_provider_id（schema.ts + migrations.ts ensureColumns）。
2. 首发送落库所选模型的 provider id；resolveSessionModel/readRecordedSessionSelection 带出。
3. 换不同 provider id：拒绝 + 可读 fork/新会话动作（不静默改 model）。
4. 删除/改名被引用 provider：拒绝或显式标记（不静默把会话 model 改回默认）。

## Touches

- server/modules/database/schema.ts + migrations.ts
- server/modules/providers/services/provider-models.service.ts（session selection）
- server/modules/providers/services/sessions.service.ts
- server/modules/providers/tests/codex-session-provider-binding.test.ts（新判据，撞 pin 则上调）
- server/modules/database/tests/migrations-ensure-columns.test.ts（补列断言）

## AC（红先行，落 AC-462）

- [ ] AC-462 判据绿：npx tsx --tsconfig server/tsconfig.json --test server/modules/providers/tests/codex-session-provider-binding.test.ts 退出 0、fail 0。
- [ ] 负臂：换 provider 被拒；删除被引用 provider 不静默回退默认。

## DoD

判据逐字 tests/pass/fail；迁移对升级与全新安装结构一致；新 test.ts 撞 quay pin / 时长基线则等量上调并注明；migrations-ensure-columns.test.ts 补列断言。
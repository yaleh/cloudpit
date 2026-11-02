---
id: codex-perrun-provider-injection
title: per-run SDK 注入：queryCodex 用 CodexOptions.config/env 打到自定义 provider
status: ready
labels:
  - feature
parent: null
children: []
extra: {}
depends_on:
  - codex-model-entry-provider-binding
goal_ac: AC-464
---
<!-- dedup-ref --> 机制去重：无 per-run Codex provider 注入任务（codex-runtime 既有改动是 state 封装/transcript）。本条是 queryCodex 的 CodexOptions.config/env。

## Proposal

**现状**：queryCodex 用 new Codex()（codex-runtime.provider.ts:362），无 options；ThreadOptions 只传 model/effort。0.166.0 实测：new Codex({ config: { model_provider, model_providers }, env }) 打得到自定义端点。

**范围**：
1. queryCodex 按所选模型的 codexProviderId 从 settings 编译 CodexOptions.config（model_provider + model_providers.<id>）与 env（secret 来自 tokenFile）。
2. 无 provider 的模型沿用现行为（不传 config）。
3. 编译复用 codex-provider-config-surface 的 loader 与 codex-resident-provider-injection 的 config 编译（providers/list/codex 内能力）。

## Touches

- tasks/codex-perrun-provider-injection.md
- server/modules/providers/list/codex/codex-runtime.provider.ts
- server/modules/providers/tests/codex-runtime-provider-injection.test.ts（新判据，撞 pin 则上调）

## AC

- [ ] AC-464 判据绿：npx tsx --tsconfig server/tsconfig.json --test server/modules/providers/tests/codex-runtime-provider-injection.test.ts 退出 0、fail 0。
- [ ] 真实 mock：Authorization 来自 tokenFile secret、宿主哨兵不泄漏；无 provider 模型不传 config。

## DoD

真实 SDK + 本地 mock 跑一轮；判据逐字 tests/pass/fail；新 test.ts 撞 pin 则等量上调并注明。
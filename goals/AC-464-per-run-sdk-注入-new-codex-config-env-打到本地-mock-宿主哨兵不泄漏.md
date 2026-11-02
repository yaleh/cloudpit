---
id: AC-464
title: per-run SDK 注入：new Codex({config,env}) 打到本地 mock、宿主哨兵不泄漏
status: draft
kind: criterion
goal: GOAL-055
criterion: npx tsx --tsconfig server/tsconfig.json --test
  server/modules/providers/tests/codex-runtime-provider-injection.test.ts
expect: "per-run SDK 路径：queryCodex 以 new Codex({ config: { model_provider,
  model_providers }, env }) 启动；真实 SDK + 本地 mock 收到 /v1/responses，Authorization
  来自 tokenFile secret、宿主 env 哨兵不泄漏；无 provider 的模型沿用现行为（不传 config）。"
origin: 人 yale 2026-11-02 裁定：per-run 是第二路径。0.166.0 实测 SDK
  CodexOptions.config/env 打得到 mock。
---

---
id: AC-463
title: resident 注入 + restore/resume：真实 app-server 打到本地 mock、secret 走 env_key 不进 argv
status: active
kind: criterion
goal: GOAL-055
criterion: npx tsx --tsconfig server/tsconfig.json --test
  server/modules/providers/tests/codex-resident-provider-injection.test.ts
expect: "真实打包 app-server + 本地 mock HTTP：自定义 provider 会话 spawn 时注入 -c
  model_provider 与 -c model_providers.<id>={...}；turn 打到 mock 的
  /v1/responses，Authorization: Bearer 来自 tokenFile secret；宿主 env
  哨兵不出现在任何头；secret 不出现在 argv/进程表；thread/start 只传 modelProvider
  的正臂必须红（进程级绑定）；residentRestore 后同 provider id 可 resume；缺配置给可读错误不回落 openai。"
origin: 人 yale 2026-11-02 裁定 ③ resident 优先。0.166.0 实测：thread/start 传
  modelProvider 会 modelProviderMismatch；spawn -c 才打得到 mock；resume 缺配置
  modelProviderNotConfigured。
activatedAt: 2026-11-02T09:21:54.835Z
statusLog:
  - at: 2026-11-02T09:21:54.835Z
    from: draft
    to: active
    actor: goal-driver
    reason: "triage: activate"
fidelity:
  verdict: faithful
  reason: "fidelity judge: faithful"
  at: 2026-11-02T09:21:54.835Z
---

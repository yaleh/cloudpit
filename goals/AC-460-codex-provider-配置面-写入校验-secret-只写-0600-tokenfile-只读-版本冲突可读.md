---
id: AC-460
title: Codex provider 配置面：写入校验 + secret 只写 + 0600 + tokenFile 只读 + 版本冲突可读
status: achieved
kind: criterion
goal: GOAL-055
criterion: npx tsx --tsconfig server/tsconfig.json --test
  server/modules/settings/tests/codex-model-providers-settings.test.ts
expect: 项目自有 settings 文件（0600）里 codex.modelProviders 注册表：写入校验拒绝保留 id
  openai/ollama/lmstudio、wire_api 非 responses、空 baseUrl；未知字段（如
  api）给可读告警而非静默丢；secret 经 tokenFile（每 provider 一个 0600 文件）读回不可见，GET 只回
  isSet；版本冲突（expectedVersion 不匹配）返回可读冲突而非静默覆盖；文件权限 0600 实测。
origin: 人 yale 2026-11-02 四问题裁定 Q2/Q4：项目配置为主、secret 用 tokenFile、wire_api 仅
  responses。0.166.0 实测 wire_api="chat" 拒绝加载、保留 id 不可覆盖。
activatedAt: 2026-11-02T09:18:52.033Z
statusLog:
  - at: 2026-11-02T09:18:52.033Z
    from: draft
    to: active
    actor: goal-driver
    reason: "triage: activate"
  - at: 2026-11-02T09:44:09.333Z
    from: active
    to: achieved
    actor: goal-driver
    reason: "I2: criterion pass"
fidelity:
  verdict: faithful
  reason: "fidelity judge: faithful"
  at: 2026-11-02T09:18:52.033Z
---

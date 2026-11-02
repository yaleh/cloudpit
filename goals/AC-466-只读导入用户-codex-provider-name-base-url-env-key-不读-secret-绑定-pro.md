---
id: AC-466
title: 只读导入用户 ~/.codex provider：name/base_url/env_key 不读 secret、绑定 providerId
status: active
kind: criterion
goal: GOAL-055
criterion: npx tsx --tsconfig server/tsconfig.json --test
  server/modules/settings/tests/codex-provider-import.test.ts
expect: 只读导入用户 ~/.codex/config.toml 与 <name>.config.toml 的
  [model_providers.*]：列出 name/base_url/env_key/wire_api，不读 secret（不读 env_key
  值、不回 token）；绑定为模型条目的 codexProviderId；项目 settings 文件仍是唯一写入点，导入不写回用户文件。
origin: 人 yale 2026-11-02 裁定 ①：用户 ~/.codex profile 仅兼容、只读导入，不为主场景。
activatedAt: 2026-11-02T09:24:20.764Z
statusLog:
  - at: 2026-11-02T09:24:20.764Z
    from: draft
    to: active
    actor: goal-driver
    reason: "triage: activate"
fidelity:
  verdict: faithful
  reason: "fidelity judge: faithful"
  at: 2026-11-02T09:24:20.764Z
---

---
id: codex-provider-import-user-profile
title: 只读导入用户 ~/.codex provider：绑定 providerId，项目文件仍是唯一写入点
status: todo
labels:
  - feature
parent: null
children: []
extra: {}
depends_on:
  - codex-provider-config-surface
  - codex-model-entry-provider-binding
  - codex-provider-settings-ui
goal_ac: AC-466
---
<!-- dedup-ref --> 机制去重：无只读导入用户 ~/.codex provider 的任务。与 codex-provider-config-surface（项目文件写入）机制不同：本条是只读导入/绑定。

## Proposal

**现状**：用户 ~/.codex/config.toml 与 <name>.config.toml 有 [model_providers.*]（实测本机 bob：name/base_url/env_key + 被忽略的 api 字段）。项目不读这些。

**范围**：
1. 只读解析用户 ~/.codex/config.toml / <name>.config.toml 的 [model_providers.*]：列出 id/name/base_url/env_key/wire_api，不读 secret（不读 env_key 值、不回 token）。
2. UI 一键绑定为模型条目的 codexProviderId（codex-provider-settings-ui 的 provider 选择器可列用户 provider）。
3. 项目 settings 文件仍是唯一写入点，导入不写回用户文件。

## Touches

- server/modules/settings/codex-model-providers.settings.ts（只读导入解析）
- server/modules/settings/tests/codex-provider-import.test.ts（新判据，撞 pin 则上调）
- src/modules/settings/tabs/agents-settings/sections/content/（导入入口，跟随 codex-provider-settings-ui）

## AC（红先行，落 AC-466）

- [ ] AC-466 判据绿：npx tsx --tsconfig server/tsconfig.json --test server/modules/settings/tests/codex-provider-import.test.ts 退出 0、fail 0。
- [ ] 负臂：不回 secret；不写回用户文件；未知字段（api）在导入视图告警。

## DoD

对真实 ~/.codex（含 bob provider）解析，回显 name/base_url/env_key 不含值；判据逐字 tests/pass/fail；新 test.ts 撞 pin 则等量上调并注明。
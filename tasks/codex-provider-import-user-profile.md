---
id: codex-provider-import-user-profile
title: 只读导入用户 ~/.codex provider：绑定 providerId，项目文件仍是唯一写入点
status: ready
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

- tasks/codex-provider-import-user-profile.md
- server/modules/settings/codex-model-providers.settings.ts（只读导入解析）
- server/modules/settings/tests/codex-provider-import.test.ts (new)（新判据，撞 pin 则上调）
- src/modules/settings/tabs/agents-settings/sections/content/CodexProviderImport.tsx (new)（导入入口，跟随 codex-provider-settings-ui）
- server/shared/tests/quay-test-script.test.ts（新 server 测试文件的 known/unknown pin 等量上调）
- scripts/suite-duration-baseline.tsv（本判据时长行）

## AC

- [x] AC-466 判据绿：npx tsx --tsconfig server/tsconfig.json --test server/modules/settings/tests/codex-provider-import.test.ts 退出 0、fail 0。
- [x] 负臂：不回 secret；不写回用户文件；未知字段（api）在导入视图告警。

## DoD

对真实 ~/.codex（含 bob provider）解析，回显 name/base_url/env_key 不含值；判据逐字 tests/pass/fail；新 test.ts 撞 pin 则等量上调并注明。

## Verification

- 判据逐字：`npx tsx --tsconfig server/tsconfig.json --test server/modules/settings/tests/codex-provider-import.test.ts` → `tests 10` / `pass 10` / `fail 0`，退出 0（duration_ms 1460.401587）。
- 十条腿：config.toml 的 bob 行列出 name=`BOB API` / base_url=`https://bob-api.com/v1` / env_key=`BOB_API_KEY`（变量名，非值）/ wire_api 缺省按项目唯一方言 `responses`；`<name>.config.toml` 也被扫描且 source 指向该文件；env_key 值哨兵与 `auth.json` 哨兵都不出现在 reading 中（`envKey` 只是变量名、行上无 `token` 字段，`files` 只含 TOML）；调用前后用户目录逐文件字节快照相同、未创建 `.config/` 项目目录（不写回）；未知字段 `api` 在行 warnings 中告警且不阻止绑定；只有已知字段的行 warnings 为空；`wire_api="chat"` 与保留 id `openai` 均列出但 `bindable=false`（理由含 `responses`/`reserved`）；缺失 `~/.codex` 为空视图不抛错；坏 `broken.config.toml` 给文件级告警而 `config.toml` 的 bob 仍导入。
- 负臂逐条：secret 不回（env_key 只回变量名、不读值；不读 auth.json/token 文件；reading 无 token 字段）；不写回（全目录快照前后一致，无项目 settings 文件副作用）；未知字段 `api` 在导入视图的 per-provider warnings 里逐字出现。
- DoD 真实 profile（只读命令，`BOB_API_KEY` 设为哨兵 `dod-sentinel-env-value-must-not-appear`）：解析 `/data/home/yale/.codex/config.toml` 与 `bob-gpt.config.toml`，回显
  `{ id: "bob", name: "BOB API", baseUrl: "https://bob-api.com/v1", envKey: "BOB_API_KEY", wireApi: "responses", bindable: true, warnings: ["provider \"bob\" has unknown field \`api\`; it is ignored"] }`；`secretPresent=false`（哨兵值不在 reading 任何字段）。
- pin / 基线：`server/shared/tests/quay-test-script.test.ts` 两处 unknown 501→502、503→504（collected 504→505）并补注释链，该文件 14/14 pass；`scripts/suite-duration-baseline.tsv` 追加本判据 1460ms 行（tree 505 / baseline 456，≥90% 覆盖地板）。
- typecheck：`npx tsc --noEmit -p tsconfig.json` 与 `-p server/tsconfig.json` 均退出 0；oxlint 变更文件退出 0。

## ADR-007

- 该轴仍暗,理由:本任务只新增一个只读 TOML 解析函数、一个判据文件与一个展示型导入组件，未移动模块边界或改变依赖图，也未产出 ArchGuard 的周期/分层实测读数。

## 实现说明

导入入口组件 `CodexProviderImport.tsx` 以 `reading` + `onBind(providerId)` 为契约，画出只读视图（字段只显示 env_key 变量名）、逐行未知字段告警与不可绑定原因；把它挂到设置页并接到模型编辑器的 `codexProviderId` 属于 UI 接线，本任务的 Touches 未包含父组件/模型编辑器，故本切片交付读取面、判据与组件本体，不在此处改父级 DOM。

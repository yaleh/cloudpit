---
id: codex-perrun-provider-injection
title: per-run SDK 注入：queryCodex 用 CodexOptions.config/env 打到自定义 provider
status: done
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
- server/modules/providers/list/codex/codex-provider-injection.ts（新；config/env 编译能力，供 resident 注入后续复用）
- server/shared/ports/codex-provider-registry.port.ts（port 增 resolve(id) 与中性解析类型）
- server/modules/settings/settings.module.ts（组合根安装 resolve）
- server/modules/providers/tests/codex-runtime-provider-injection.test.ts（新判据，撞 pin 则上调）
- server/shared/tests/quay-test-script.test.ts（unknown pin 498→499、500→501）
- scripts/suite-duration-baseline.tsv（本判据 6729ms 行）

## AC

- [x] AC-464 判据绿：npx tsx --tsconfig server/tsconfig.json --test server/modules/providers/tests/codex-runtime-provider-injection.test.ts 退出 0、fail 0。
- [x] 真实 mock：Authorization 来自 tokenFile secret、宿主哨兵不泄漏；无 provider 模型不传 config。

## DoD

真实 SDK + 本地 mock 跑一轮；判据逐字 tests/pass/fail；新 test.ts 撞 pin 则等量上调并注明。

## Verification

- 判据逐字：`npx tsx --tsconfig server/tsconfig.json --test server/modules/providers/tests/codex-runtime-provider-injection.test.ts` → `tests 3` / `pass 3` / `fail 0`，退出 0（6729ms）。
- 真实 mock（正臂）：真实 `@openai/codex-sdk` 0.166.0 构造选项并启动打包 CLI；CLI 向本地 `POST /v1/responses` 发出请求，mock 读到 `Authorization: Bearer <tokenFile secret>`。同时断言 SDK options 的 `config.model_provider=bob`、`model_providers.bob.{base_url,env_key,wire_api}` 逐字，以及 `env.BOB_API_KEY` 来自 tokenFile。
- 宿主哨兵（隔离臂）：进程内设置 `CC_CODEX_HOST_SENTINEL=host-secret-that-must-not-reach-the-child`，子进程 env 中不存在该键；PATH/HOME 等 plumbing 保留（SDK 传 env 时不再继承 process.env，允许清单显式放行）。
- 负臂：无 `codexProviderId` 的模型构造 `new Codex()`，options 无 `config`/`env`（沿用现行为）；绑定未知 provider `nobody` 时输出可读错误（含 `nobody` 与 `not configured`），mock 0 请求，不回落 openai。
- 相关判据：`codex-runtime.test.ts` + `codex-provider-model-binding.test.ts` + `codex-model-providers-settings.test.ts` 共 31/31 pass；`architecture-ratchet.test.ts` + `server-import-cycle-budget.test.ts` 18/18 pass；`quay-test-script.test.ts` 14/14 pass（unknown pin 498→499、500→501）。
- typecheck：`tsc --noEmit -p server/tsconfig.json` 退出 0；oxlint 变更文件 0 error。
- 时长基线：追加本判据 6729ms 行（基线 453/502，高于 90% 覆盖地板）。

## ADR-007

- 该轴仍暗,理由:本任务未运行 ArchGuard，未产出周期/分层实测读数；新增文件只在既有 providers/list/codex 目录内并复用 shared port，未新增目录边，周期读数由 server-import-cycle-budget 18/18 绿复核。

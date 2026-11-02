---
id: codex-resident-provider-injection
title: resident 注入 + restore/resume：app-server spawn -c 注入 provider、secret 走
  env_key、按会话重注入
status: ready
labels:
  - feature
parent: null
children: []
extra: {}
depends_on:
  - codex-session-provider-id-binding
goal_ac: AC-463
---
<!-- dedup-ref --> 机制去重：codex resident 既有任务（host driver/queue/approvals/live-settings）都不碰上游 provider 注入。本条是 spawn 时 -c 注入 + restore/resume 重注入。

## Proposal

**现状**：CodexHostDriver.startResidentSession → bind → connectionFor 用 driver 级 this.launch（codex-host-driver.provider.ts:52-66, 789-809），没有 per-session launch；threadParams 只传 model/approvalPolicy/sandbox（codex-host-driver.contract.ts:326-345）。0.166.0 实测：只在 thread/start 传 modelProvider 会 modelProviderMismatch；必须 spawn 时 -c model_provider + -c model_providers.<id>={...}。

**范围**：
1. per-session CodexAppServerLaunch：startResidentSession 把会话 provider id 编译成 spawn args（-c model_provider + -c model_providers.<id>={...}），经 pendingLaunches 传到 bind/connectionFor。
2. secret 从 tokenFile 读进子进程 env（env_key 名），绝不进 argv。
3. restore/resume：residentRestore 从会话 model_provider_id 重注入；缺配置给可读错误（可映射 modelProviderNotConfigured），不回落 openai。
4. 编译做成 providers/list/codex 内能力（不新增 provider-id 分支到 providers/list 之外）。

## Touches

- tasks/codex-resident-provider-injection.md
- server/modules/providers/list/codex/codex-host-driver.provider.ts
- server/modules/providers/list/codex/codex-host-driver.contract.ts
- server/modules/providers/list/codex/codex.provider.ts（createConnection 缝）
- server/modules/providers/list/codex/codex-provider-injection.ts
- server/modules/providers/list/codex/codex-resident-provider-launch.ts (new)（per-session launch 编译叶）
- server/modules/providers/services/provider-runtime.service.ts（defaultResidentLaunchOptions 带 provider id）
- server/modules/providers/tests/codex-resident-provider-injection.test.ts（新判据，撞 pin 则上调）
- server/shared/tests/quay-test-script.test.ts（collected pin 503→504）
- server/shared/tests/architecture-ratchet.baseline.json（RECORDED CHANGE 841→855、1288→1291）
- scripts/suite-duration-baseline.tsv（本判据 8469ms 行）

## AC

- [x] AC-463 判据绿：npx tsx --tsconfig server/tsconfig.json --test server/modules/providers/tests/codex-resident-provider-injection.test.ts 退出 0、fail 0。
- [x] 真实 mock 断言：Authorization 来自 tokenFile secret；宿主哨兵不泄漏；secret 不进 argv；thread/start 只传 modelProvider 的正臂红；同 provider id resume 绿；缺配置可读错误。

## DoD

真实打包 app-server + 本地 mock（非注入替身）跑一轮自定义 provider 会话；判据逐字 tests/pass/fail；secret 逐字确认不在 argv/进程表；新 test.ts 撞 pin 则等量上调并注明。

## Verification

- 判据逐字：`npx tsx --tsconfig server/tsconfig.json --test server/modules/providers/tests/codex-resident-provider-injection.test.ts` → `tests 4` / `pass 4` / `fail 0`，退出 0（8469ms）。
- 真实 app-server 正臂：driver 用默认 transport spawn 打包 `@openai/codex 0.166.0`，本地 mock 的 `/v1/responses` 收到 `Authorization: Bearer token-file-secret-4242`；编译出的 launch argv 为 `-c model_provider="bob"` + `-c model_providers.bob={...env_key="BOB_API_KEY"...}`，`launch.env.BOB_API_KEY` 来自 tokenFile。
- secret 不入 argv / 进程表：断言 `launch.args` 不含 secret、`/proc/<pid>/cmdline` 不含 secret、全 `/proc/*/cmdline` 扫描 0 命中；`/proc/<pid>/environ` 含 `BOB_API_KEY=<secret>` 且不含宿主哨兵 `CC_CODEX_HOST_SENTINEL`。
- 负控：真实 app-server 只在 `thread/start` 传 `modelProvider`+`config` 时，`turn/start` 被服务端拒绝（"uses bob, but your current provider is openai"），mock 0 请求。
- resume 绿：关掉 host 后用同一 provider id 重开并 resume 原 thread，`readSession().threadId` 未变（排除 no-rollout 回退）且第二次请求仍带同一 Bearer。
- 缺配置：不带 provider id resume 原 thread → 服务端可读错误（`no longer configured`），mock 请求数不变；registry 不认识 `nobody` 时 `startResidentSession` 在 spawn 前抛 `CODEX_PROVIDER_NOT_CONFIGURED`（含 id 与 not configured），`openHost` 0 次。
- restore 接线：隔离 DB 的 session 行写 `model_provider_id='bob'`，走生产 `providerRuntimeService.startResidentSession` → `defaultResidentLaunchOptions`，捕获的 launch bag 含 `modelProviderId='bob'` 与行上的 model。
- typecheck：`tsc --noEmit -p server/tsconfig.json` 退出 0；oxlint 变更文件 0 error。
- 相关判据：`architecture-ratchet.test.ts` 6/6、`quay-test-script.test.ts` 14/14、`server-import-cycle-budget.test.ts` + `codex-resident-lifecycle.test.ts` 21/21、`codex-runtime-provider-injection.test.ts` + `codex-app-server-protocol.test.ts` + `codex-host-driver-persistent.test.ts` 23/23。
- 架构棘轮：新叶 `codex-resident-provider-launch.ts` 吸收了编译与 host-id 选择，`codex-host-driver.provider.ts` 841→855、`provider-runtime.service.ts` 1288→1291 按 AC-394 RECORDED CHANGE 格式记入 baseline note；collected 503→504 的 pin 与时长基线行同步。

## ADR-007

- 该轴仍暗,理由:本任务未运行 ArchGuard，未产出周期/分层实测读数；新增文件只在既有 providers/list/codex 目录内并复用 shared port，未新增目录边，周期读数由 server-import-cycle-budget 21/21 绿复核。
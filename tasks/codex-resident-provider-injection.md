---
id: codex-resident-provider-injection
title: resident 注入 + restore/resume：app-server spawn -c 注入 provider、secret 走
  env_key、按会话重注入
status: todo
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
- server/modules/providers/services/provider-runtime.service.ts（defaultResidentLaunchOptions 带 provider id）
- server/modules/providers/tests/codex-resident-provider-injection.test.ts（新判据，撞 pin 则上调）

## AC

- [ ] AC-463 判据绿：npx tsx --tsconfig server/tsconfig.json --test server/modules/providers/tests/codex-resident-provider-injection.test.ts 退出 0、fail 0。
- [ ] 真实 mock 断言：Authorization 来自 tokenFile secret；宿主哨兵不泄漏；secret 不进 argv；thread/start 只传 modelProvider 的正臂红；同 provider id resume 绿；缺配置可读错误。

## DoD

真实打包 app-server + 本地 mock（非注入替身）跑一轮自定义 provider 会话；判据逐字 tests/pass/fail；secret 逐字确认不在 argv/进程表；新 test.ts 撞 pin 则等量上调并注明。
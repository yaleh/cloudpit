---
id: gap-cockpit-card-dismiss-fleet-revision-and-receipt
title: 驾驶舱「忽略/丢弃」在真实 fleet 卡上无效：revision 0 被抬成 1、fleet 回执在 result.receipt
  未被读取、拒绝仍报成功并占住账本
status: todo
labels:
  - gap
  - cockpit
parent: null
children: []
extra:
  schema: execution
---
## Proposal

来源：线上驾驶舱（claudecodeui）对 session-ask 卡点「忽略/丢弃」→ 确认，重复多次卡片始终不消失。定位结果不是前端点击问题，而是 CloudCLI 与真实 quay-fleet 之间的 revision 错位 + 回执读取层级错误，且后者的拒绝被当成成功并占住动作账本。既有的 dismiss 功能任务只用夹具 provider 验收，夹具与真实 fleet 的两处差异正好把这组缺陷挡在判据之外。

现场读数（2026-10-30，root=/data/home/yale/work/claudecodeui，卡 att_a96882d1e1fa，session 49622a6c-0776-451a-bde6-3dfdb1af1dfa）：

1. fleet 原始读数：`quay-fleet cockpit cards --json` → `revision: 0`；`~/.quay-fleet/attention.json` 条目的 `revision` 也是 0（fleet 契约：内容变化才 +1，初始 0 合法）。同一条目经 `GET /api/cockpit/cards` 变成 `revision: 1` —— `server/modules/cockpit/cockpit-fleet-card-projection.ts:428` 的 `Math.max(1, …)` 把 0 抬成 1。
2. 用抬后的 1 调 fleet：`quay-fleet rescue exec fleet.feedback --params '{"attentionId":"att_a96882d1e1fa","revision":1,"feedbackId":"probe","dismiss":true}' --json` → `receipt: {disposition:"rejected", reason:"stale-revision"}`，`appended: 0`。dismiss 从来没写进 fleet。
3. 同一张卡随后 `POST /api/cockpit/cards/dismiss` → 409 `ALREADY_CONFIRMED`：前一次点击确实到达服务端并写入了内存 accepted 账本（`cockpit-card-actions.ts:525`），之后每次重试都被账本挡住。
4. `~/.cloudcli/cockpit-card-feedback.json` 的 `notices` 为空 —— fleet 的拒绝回执没被读到。三处回执读取（confirm 反馈 `:346`、dismiss `:539`、resend `:606`）都取 `answer.receipt`；真实 `CockpitFleetExecutor.execute` 返回整份 CLI 文档（`cockpit-fleet-executor.ts:228`），回执在 `answer.result.receipt`。夹具 provider 返回顶层 `receipt`（`cockpit-fixture-card-provider.ts`），所以既有判据全绿。

修法（三处）：

A. 投影保留 provider 的 revision 0（`Math.max(0, …)`；字段缺失的缺省仍为 1）。
B. 传输层解析器接受非负 revision：`cockpit-card-actions.ts:146`（confirm）与 `:210`（dismiss）的 `record.revision < 1` 改为 `< 0`，错误文案改为 non-negative integer。
C. 回执读取兼容顶层与 fleet 嵌套两种形状；`dismiss` 收到 `rejected` 时：记录 rejected notice、抛带 fleet reason 的 AppError、并从 accepted 账本删除该 `(provider, card, revision)` 键，使下一次重试能再次到达 fleet 而不是 409。

查重：任务库内与 dismiss 直接相关的只有 `gap-cockpit-card-dismiss-disposition`（done，夹具验收）与 `gap-cockpit-card-feedback-receipt-lifecycle`（done，完成记录明写不含真实 fleet 反馈调用）；非 done 的 cockpit/fleet 任务只有 `gap-cockpit-ask-retraction-and-ledger-backfill`（needs-human，撤回误发提问）与 `gap-observation-ask-ledger-owner`（todo，ask ledger owner），机制不同。同 Touches 无在飞任务。

## AC

- [ ] AC1 **投影与传输层接受 fleet 的 revision 0**：`grep -n "Math.max(0, Math.trunc(finiteNumber" server/modules/cockpit/cockpit-fleet-card-projection.ts` 恰命中 1 行；`cockpit-card-actions.ts` 中 confirm 与 dismiss 两个解析器的 revision 守卫改成 `< 0` 且文案为 non-negative；`npx tsx --tsconfig server/tsconfig.json --test server/modules/cockpit/tests/cockpit-fleet-card-provider.test.ts` 与同命令跑 `server/modules/cockpit/tests/cockpit-card-feedback.test.ts` 各自退出 0。
- [ ] AC2 **回执读取兼容 fleet 的嵌套形状**：`cockpit-card-actions.ts` 的回执读取对 confirm 反馈、dismiss、resend 三处都接受顶层 `receipt` 与 `result.receipt` 两种形状；夹具 provider 的旧形状行为不变；`npx tsx --tsconfig server/tsconfig.json --test server/modules/cockpit/tests/cockpit-card-feedback.test.ts` 退出 0。
- [ ] AC3 **rejected 的 dismiss 是可观测失败且可重试**：反馈执行器返回 `{result:{receipt:{disposition:'rejected',reason:'stale-revision'}}}` 时，dismiss 抛错/返回 4xx 且文本含 `stale-revision`；同一 `(card, revision)` 立即再 dismiss，反馈执行器被调用第二次（不出现 `ALREADY_CONFIRMED`）；store 记录 rejected notice。
- [ ] AC4 **判据一：revision 0 投影**（在既有 `cockpit-fleet-card-provider.test.ts` 内新增，不新建测试文件）：喂入 `revision: 0` 的 fleet 卡行，断言投影后 `card.revision === 0`（不是 1），且字段缺失时仍缺省 1；该文件整体退出 0。
- [ ] AC5 **判据二：rejected dismiss**（在既有 `cockpit-card-feedback.test.ts` 内新增，不新建测试文件）：断言 AC3 的两态；该文件整体退出 0；`npx tsx --tsconfig server/tsconfig.json --test server/modules/cockpit/tests/cockpit-card-registry.test.ts` 退出 0；`npm run typecheck` 退出 0。

## DoD

- [ ] DoD1 **真实 fleet 路径（隔离 HOME）**：以独立 HOME 建一个 `$HOME/.quay-fleet/attention.json`，放一条 `category:"session-ask"`、`state:"open"`、`revision:0` 的条目；`quay-fleet cockpit cards --json` 读到 `revision:0`；用同一 HOME 启动隔离 CloudCLI，`GET /api/cockpit/cards` 该卡 `revision` 为 0；`POST /api/cockpit/cards/dismiss` 返回 200 且应答里 `result.receipt.disposition === "dismissed"`；随后 `quay-fleet cockpit cards --json` 不再列出该 id，`attention.json` 条目 `resolvedBy` 为 `dismissed`。完成记录贴出 CLI/API/HTTP 三组逐字读数。
- [ ] DoD2 **拒绝臂真实路径**：CloudCLI 读到卡后，在磁盘上把该条目 revision 改成 1（不改 CloudCLI 手里的卡），再 dismiss：应答为 4xx 且文本含 `stale-revision`；紧接着重试同一次 dismiss，fleet 仍被再次调用（不是 `ALREADY_CONFIRMED`）。完成记录贴出两次 HTTP 状态/正文与 fleet 决策台账零写入读数。
- [ ] DoD3 **真实浏览器**：按仓库隔离实例配方打开驾驶舱卡片页，对一张 revision 0 的 ask 卡点「忽略/丢弃」→ 确认，卡片从可见列表消失；截图存 `tmp/` 并在完成记录贴路径；若存在可用场景，同时跑 `node scripts/ui-scenario.mjs <scenario.json> …` 贴 JSON 报告与检查点截图。
- [ ] DoD4 **夹具路径无回归**：fixture provider 的 dismiss（顶层 receipt、dismissed）与 kept/rejected/none 三态仍按既有读数工作；`npm run typecheck` 退出 0。

该轴仍暗,理由:本条只在既有 cockpit 模块内修正 revision 传值与回执读取，不新增跨模块边或抽象，L_D/L_G 无可读增量

## Touches

- tasks/gap-cockpit-card-dismiss-fleet-revision-and-receipt.md
- server/modules/cockpit/cockpit-fleet-card-projection.ts
- server/modules/cockpit/cockpit-card-actions.ts
- server/modules/cockpit/tests/cockpit-fleet-card-provider.test.ts
- server/modules/cockpit/tests/cockpit-card-feedback.test.ts
- server/modules/cockpit/tests/cockpit-card-registry.test.ts
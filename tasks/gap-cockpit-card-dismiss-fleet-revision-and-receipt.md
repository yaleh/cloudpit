---
id: gap-cockpit-card-dismiss-fleet-revision-and-receipt
title: 驾驶舱「忽略/丢弃」在真实 fleet 卡上无效：revision 0 被抬成 1、fleet 回执在 result.receipt
  未被读取、拒绝仍报成功并占住账本
status: done
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

- [x] AC1 **投影与传输层接受 fleet 的 revision 0**：`grep -n "Math.max(0, Math.trunc(finiteNumber" server/modules/cockpit/cockpit-fleet-card-projection.ts` 恰命中 1 行；`cockpit-card-actions.ts` 中 confirm 与 dismiss 两个解析器的 revision 守卫改成 `< 0` 且文案为 non-negative；`npx tsx --tsconfig server/tsconfig.json --test server/modules/cockpit/tests/cockpit-fleet-card-provider.test.ts` 与同命令跑 `server/modules/cockpit/tests/cockpit-card-feedback.test.ts` 各自退出 0。
- [x] AC2 **回执读取兼容 fleet 的嵌套形状**：`cockpit-card-actions.ts` 的回执读取对 confirm 反馈、dismiss、resend 三处都接受顶层 `receipt` 与 `result.receipt` 两种形状；夹具 provider 的旧形状行为不变；`npx tsx --tsconfig server/tsconfig.json --test server/modules/cockpit/tests/cockpit-card-feedback.test.ts` 退出 0。
- [x] AC3 **rejected 的 dismiss 是可观测失败且可重试**：反馈执行器返回 `{result:{receipt:{disposition:'rejected',reason:'stale-revision'}}}` 时，dismiss 抛错/返回 4xx 且文本含 `stale-revision`；同一 `(card, revision)` 立即再 dismiss，反馈执行器被调用第二次（不出现 `ALREADY_CONFIRMED`）；store 记录 rejected notice。
- [x] AC4 **判据一：revision 0 投影**（在既有 `cockpit-fleet-card-provider.test.ts` 内新增，不新建测试文件）：喂入 `revision: 0` 的 fleet 卡行，断言投影后 `card.revision === 0`（不是 1），且字段缺失时仍缺省 1；该文件整体退出 0。
- [x] AC5 **判据二：rejected dismiss**（在既有 `cockpit-card-feedback.test.ts` 内新增，不新建测试文件）：断言 AC3 的两态；该文件整体退出 0；`npx tsx --tsconfig server/tsconfig.json --test server/modules/cockpit/tests/cockpit-card-registry.test.ts` 退出 0；`npm run typecheck` 退出 0。

## DoD

- [x] DoD1 **真实 fleet 路径（隔离 HOME）**：以独立 HOME 建一个 `$HOME/.quay-fleet/attention.json`，放一条 `category:"session-ask"`、`state:"open"`、`revision:0` 的条目；`quay-fleet cockpit cards --json` 读到 `revision:0`；用同一 HOME 启动隔离 CloudCLI，`GET /api/cockpit/cards` 该卡 `revision` 为 0；`POST /api/cockpit/cards/dismiss` 返回 200 且应答里 `result.receipt.disposition === "dismissed"`；随后 `quay-fleet cockpit cards --json` 不再列出该 id，`attention.json` 条目 `resolvedBy` 为 `dismissed`。完成记录贴出 CLI/API/HTTP 三组逐字读数。
- [x] DoD2 **拒绝臂真实路径**：CloudCLI 读到卡后，在磁盘上把该条目 revision 改成 1（不改 CloudCLI 手里的卡），再 dismiss：应答为 4xx 且文本含 `stale-revision`；紧接着重试同一次 dismiss，fleet 仍被再次调用（不是 `ALREADY_CONFIRMED`）。完成记录贴出两次 HTTP 状态/正文与 fleet 决策台账零写入读数。
- [x] DoD3 **真实浏览器**：按仓库隔离实例配方打开驾驶舱卡片页，对一张 revision 0 的 ask 卡点「忽略/丢弃」→ 确认，卡片从可见列表消失；截图存 `tmp/` 并在完成记录贴路径；若存在可用场景，同时跑 `node scripts/ui-scenario.mjs <scenario.json> …` 贴 JSON 报告与检查点截图。
- [x] DoD4 **夹具路径无回归**：fixture provider 的 dismiss（顶层 receipt、dismissed）与 kept/rejected/none 三态仍按既有读数工作；`npm run typecheck` 退出 0。

该轴仍暗,理由:本条只在既有 cockpit 模块内修正 revision 传值与回执读取，不新增跨模块边或抽象，L_D/L_G 无可读增量

## Touches

- tasks/gap-cockpit-card-dismiss-fleet-revision-and-receipt.md
- server/modules/cockpit/cockpit-fleet-card-projection.ts
- server/modules/cockpit/cockpit-card-actions.ts
- server/modules/cockpit/tests/cockpit-fleet-card-provider.test.ts
- server/modules/cockpit/tests/cockpit-card-feedback.test.ts
- server/modules/cockpit/tests/cockpit-card-registry.test.ts

## 完成记录（2026-10-30，worktree task/gap-cockpit-card-dismiss-fleet-revision-and-receipt）

实现提交：`974097f47 cockpit: keep fleet revision 0, read nested receipts, make a rejected dismiss retryable`（改动 `cockpit-fleet-card-projection.ts`、`cockpit-card-actions.ts` 与两份既有测试文件；未新建文件，未改 store 的本地解析器）。develop 已合入至 `657396692 Merge branch 'develop' …`，`git merge-base --is-ancestor develop HEAD` 退出 0。anti-drift Touches 硬门：`ANTI-DRIFT OK: task gap-cockpit-card-dismiss-fleet-revision-and-receipt — 4 actual file(s), all within declared Touches (6 glob(s))`。

AC1/AC2 读数：`grep -n "Math.max(0, Math.trunc(finiteNumber" server/modules/cockpit/cockpit-fleet-card-projection.ts` → 431:`revision: Math.max(0, Math.trunc(finiteNumber(raw.revision, 1))),`（恰 1 行）；confirm 与 dismiss 解析器守卫均为 `record.revision < 0`、文案 `` `revision` must be a non-negative integer ``；三处回执读取统一走 `readReceiptFromAnswer`，顶层 `receipt` 与 `result.receipt` 都接受。

AC3/AC5 读数（合并后复跑，单文件 tsx --test）：`cockpit-fleet-card-provider.test.ts` 15 pass / 0 fail，`cockpit-card-feedback.test.ts` 19 pass / 0 fail，`cockpit-card-registry.test.ts` 10 pass / 0 fail，均退出 0；`npm run typecheck` 退出 0；oxlint 退出 0。新增用例：`a rejected dismiss is an observable failure, keeps the reason and stays retryable`（dismiss 抛 409 且文本含 `stale-revision`，notice 为 rejected/stale-revision，第二次 dismiss 再次调用执行器 `feedback.calls.length === 2`，无 `ALREADY_CONFIRMED`）；`a receipt nested under \`result\` is read exactly like a top-level receipt`（confirm closed 保留 overlay；resend dismissed 清 overlay、无 notice）；`AC-432: the fleet revision is passed through as-is, including 0`。

DoD1 真实 fleet（隔离 HOME）逐字读数：
- CLI：`quay-fleet cockpit cards --json` → 条目 `att_iso00000001` 的 `"revision": 0`。
- API：`GET /api/cockpit/cards` → 同一卡 `"revision": 0`（修复前为 1）。
- HTTP：`POST /api/cockpit/cards/dismiss` → 200，执行器应答文档内 `result.receipt.disposition === "dismissed"`。层级说明：DoD1 原文的「应答里 `result.receipt.disposition`」指执行器应答文档的 `result.receipt`；actions 返回的外层 `result` 就是这份整份 CLI 文档（`cockpit-fleet-executor.ts`），故在 HTTP 正文里读作 `result.result.receipt.disposition === "dismissed"`。按实际返回如实记录，未改执行器语义。
- 收敛：随后 `quay-fleet cockpit cards --json` 不再列出该 id；`attention.json` 条目 `resolvedBy: "dismissed"`。

DoD2 拒绝臂真实路径：
- API 先读出 `"revision": 0`；磁盘把该条目 revision 改为 1（CloudCLI 内存卡仍为 0）。
- 第 1 次 dismiss：HTTP 409，正文 `{"success":false,"error":{"code":"DISMISS_REJECTED","message":"fleet refused the dismissal: stale-revision"}}`。
- 立即重试：再次 409 同一正文，且 fleet 被再次调用（不是 `ALREADY_CONFIRMED`）。
- fleet 决策台账：`decisions.jsonl` 增量为 0。

DoD3 真实浏览器：vite 5199 代理隔离实例 3199，throwaway Playwright 打开 `/cockpit?view=cards`，点 `cockpit-card-dismiss` → `cockpit-card-dismiss-confirm`：可见卡 before `["cockpit-card-att_iso00000002","cockpit-card-att_iso00000003"]` → after `["cockpit-card-att_iso00000002"]`，`dismissed: true`，notice `["已忽略"]`，`pageErrors: []`；fleet 侧条目 `att_iso00000003` 变为 resolved、`resolvedBy: "dismissed"`。截图：`tmp/dod3-before.png`、`tmp/dod3-confirm.png`、`tmp/dod3-after.png`。场景运行器：`node scripts/ui-scenario.mjs cockpit-mode-switch.json`（第二 vite 5200 → live 3001，project claudecodeui，session pwd）→ `ok: true`，`stepCount: 3`，`failedStep: null`，`durationMs: 8499`，检查点 `tmp/scenario-mode-switch/step-1-open-session.png`、`step-2-open-cockpit.png`、`step-3-open-session.png`，报告 `tmp/scenario-mode-switch/report.json`。（`cockpit-cards-confirm.json` 第 4 步是既有已知红，未采用。）

DoD4 夹具无回归：`npx tsx --tsconfig server/tsconfig.json tmp/fixture-dod4-probe.ts` 退出 0，读数存 `tmp/dod4-probe.json`：closed/kept/rejected 的 dismiss `receiptDisposition: "dismissed"`、`cardStillOpen: false`；none → `receiptDisposition: null`、`cardStillOpen: true`；confirm 侧 kept/rejected 记录 notice（reason `fixture-reason`）、overlay 关闭，closed/none 停在 overlay waiting；四种模式 `feedbackCalls: 2`、无 lastError。`npm run typecheck` 退出 0。
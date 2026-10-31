---
id: gap-ac178-new-session-switch-gate-drops-nonmatrix-provider
title: AC-178 正控制红：debug 会话的 __provider='debug' 被 useChatProviderState
  采纳并写进偏好，空状态开关门 canToggle=false（debug 不在能力矩阵）——矩阵外 provider 不采纳，恢复新会话空状态
  [data-resident-enable] count=1
status: ready
labels:
  - gap
  - defect
parent: null
children: []
extra:
  schema: execution
goal_ac: AC-178
---
## Proposal

<!-- dedup-ref --> 机制去重读数（2026-10-31 本轮实测）：`grep -rln '^goal_ac: *AC-178' tasks/` 命中 4 份，全部 `status: done`（`gap-resident-composer-hides-enable-affordance`、`gap-resident-composer-switch-removed-intent-new-session-only`、`gap-ac178-criterion-anchor-retired-by-dock-consolidation`、`gap-ac178-criterion-ledger-red-is-merge-race`）；在飞（`todo`/`ready`/`needs-human`）且带 `goal_ac: AC-178` 的任务为 **0** ⇒ 本条不是重复，且 done 不是重复而是“上一次的修法没兜住”的证据。同机制扫描：`grep -rln 'useChatProviderState\|defaultLifecycleMode\|providerLifecycleDefaults\|__provider' tasks/*.md` 只命中已 done 的相邻任务（最近的是引入本次回归的 `claude-codex-new-session-default-resident`，done；以及 debug agent 的显示身份任务，均 done/superseded），没有开放任务认领「矩阵外 provider 被采纳进 provider state / 偏好被写成 debug」这一机制。合并候选检查（`task-granularity-advice.js`，Touches 三文件）→ `peers: []`、`mentions: []`，`perFile` 也只有本文件历史 ⇒ 无合并对象，独立立案。

**判据物**（逐字取自 goal 记录 AC-178）：`npx playwright test e2e/resident-ui-layout.spec.ts -g "composer has no resident switch"`。`expect` 逐字：「已有会话（无论 lifecycleMode 是 resident 还是 per-run）的输入区 `.chat-composer-shell` 内不再出现常驻开关 `[data-resident-enable="true"]`（count=0）；同一次运行里新会话空状态在模型卡片下仍出现同一选择器的开关（count=1，正控制，证明读数不是恒空）。取假形态：composer 仍渲染开关 ⇒ 必须红，且红落在已有会话这一条读数上。」

**本轮直接重跑判据（不是台账尾巴）**：命令 → **exit 1**，失败断言在 30s 超时处。已有会话的两条读数**通过**：`resident.composer.switch.count=0`、`per-run.composer.switch.count=0`；红在**正控制**：

```
Error: the new-session empty state must carry the switch — the control that makes the zeroes above a reading
expect(locator).toHaveCount(expected) failed
Locator:  locator('[data-resident-enable="true"]')
Expected: 1
Received: 0
Timeout:  30000ms
  at /data/home/yale/work/claudecodeui/e2e/resident-ui-layout.spec.ts:1598:7
```

trace 的最后一帧 screencast 显示空状态**已经渲染**：标题 “Choose Your AI Assistant”、Claude 模型卡、“Press Ctrl+K …”，但卡片下方没有开关。所以不是页面没到位，是渲染门为假。

**红因（页面内插桩实测，不是推断）**。在 `ChatInterface.tsx` 的 `canRunResident` 前临时打印 `{provider, providerLifecycleDefaults, canToggleNewSessionLifecycle}` 后重跑，页面 console 逐字：

```
DBG lifecycle {"provider":"claude","defaults":{},...}
DBG lifecycle {"provider":"debug","defaults":{"claude":{"supportsResident":true,"defaultLifecycleMode":"resident"},...},"canToggleNewSessionLifecycle":false,"newSessionLifecycleMode":null}
```

即：打开 `/session/<debug 会话>` 后，`useChatProviderState` 的 `provider` 变成 `debug`——它是 `selectedSession.__provider`，由 `src/modules/chat-session/hooks/useChatProviderState.ts:429-437` 的采纳 effect 无条件 `setProvider(...)` 且 `writeSelectedProvider(...)` 写进用户偏好。能力矩阵只有 claude/cursor/codex/opencode（`src/shared/types.ts:13` 的 `LLMProvider` 联合），没有 `debug`；`useNewSessionLifecycle(provider, providerLifecycleDefaults[provider] ?? null)` 因此拿不到行，`canToggle=false`，空状态开关不渲染，正控制读到 0。

**为什么上一次的修法没兜住**。AC-178 最后一次绿在 `2026-10-31T03:41:50Z`（tree `e1d1e01e` = commit `9a8c1792f`，11:35 +0800）。此后 `9ddf7c1bb`（12:19:30 +0800，`feat(sessions): default new sessions to the provider's declared lifecycle mode`，任务 `claude-codex-new-session-default-resident`，done）把空状态开关的门从 `residentProviders.has(readSelectedProvider())` 改成 `canToggleNewSessionLifecycle`：旧门读的是**经过校验的偏好**（`readSelectedProvider()` 会把矩阵外的存储值强制回落到 claude，见 `src/shared/selectedProvider.ts:24-27`），新门读**原始 provider state**。同一个 `debug` 会话，旧门仍然为真、新门为假。失败 tree `db38570c` 就是当前 HEAD 家族；03:41Z 的绿在 `9ddf7c1bb`（04:19:30Z）之前，时间线吻合。这不是判据本身失效，而是判据的**正控制**被一次无关的产品改动打断。

**最小修复方向（已用临时补丁验证，本轮已还原、未落地）**。在 `useChatProviderState` 的采纳 effect 里只采纳 `PROVIDERS`（claude/cursor/codex/opencode）集合内的 `selectedSession.__provider`；矩阵外 id（`debug` 或任何 runtime provider）既不写入 `provider` state，也不写入用户偏好。临时打上该 guard 后同一判据 `1 passed (13.2s)`，读数逐字 `resident.composer.switch.count=0` / `per-run.composer.switch.count=0` / `empty.page.switch.count=1`；随后 `git checkout` 还原，工作树干净。

这也不只是夹具问题：当前访问一个 debug 会话后，新建会话的 `provider` state 仍是 `debug`（卡片靠 `getProviderDisplayName` 的兜底显示成 Claude），而创建调用会用 `debug` 去 mint 新行——显示与创建用的 provider 分叉。guard 同时消掉这个分叉，是比“测试里先点选 Claude”更诚实的修法。

**非目标**：不改 AC-178 的判据文本与断言；不放宽正控制（禁止用“先点选 Claude 再读数”绕过）；不改 debug agent 的既有显示身份修复；不动 `defaultLifecycleMode` 的默认策略与 `useNewSessionLifecycle` 的语义。

## AC

- [x] AC1 判据复绿：`npx playwright test e2e/resident-ui-layout.spec.ts -g "composer has no resident switch"` 退出 **0**，stdout 逐字含 `resident.composer.switch.count=0`、`per-run.composer.switch.count=0`、`empty.page.switch.count=1`（同一选择器、同一次运行）；贴出退出码与这三行。
- [x] AC2 假形态必须红：把 `useChatProviderState` 的采纳条件还原成无条件 `setProvider(selectedSession.__provider); writeSelectedProvider(...)`，同一命令退出非 0，且红落在正控制上（`expect(locator).toHaveCount(expected) failed`、`Expected: 1`、`Received: 0`，行号为 `e2e/resident-ui-layout.spec.ts` 的 `toHaveCount(1, …)`）；贴出退出码、失败行与 stdout 中缺失 `empty.page.switch.count` 的事实。恢复 guard 后复绿。
- [x] AC3 采纳门单测（含对照腿）：`npx vitest run src/modules/chat/tests/chatProviderModels.test.ts` 退出 **0**；新增用例断言 (a) `selectedSession.__provider = 'debug'`（矩阵外）时 `result.current.provider` 仍为 `readSelectedProvider()` 的 `claude`，且 `readSelectedProvider()` 读回仍为 `claude`（偏好没有被写成 `debug`）；(b) 对照腿 `selectedSession.__provider = 'codex'` 时 `provider` 变为 `codex` 且偏好写为 `codex`。贴出两腿断言与运行结果。

## DoD

- 判据在真实服务 + 真实浏览器里复绿（AC1 的三行读数同一跑取得），并附本次假形态红（AC2）；两者是同一条命令、同一份断言，不换口径。
- AC3 的对照腿证明采纳门不是“永不采纳”，否则只是把一个 bug 换成另一个 bug。
- `## Touches` 里的实现文件只做必要的采纳门修改；AC-178 的判据断言逐字不变、正控制不放宽。若改了 `e2e/resident-ui-layout.spec.ts`，只允许注释/说明性改动。
- 落地后 `git status --porcelain` 只含本任务声明的文件（外加任务文件自身）。

## Touches

- src/modules/chat-session/hooks/useChatProviderState.ts
- src/modules/chat/tests/chatProviderModels.test.ts
- e2e/resident-ui-layout.spec.ts
- tasks/gap-ac178-new-session-switch-gate-drops-nonmatrix-provider.md


## Evidence

- AC1: `npx playwright test e2e/resident-ui-layout.spec.ts -g "composer has no resident switch"` exit 0；同一跑 stdout：`resident.composer.switch.count=0`、`per-run.composer.switch.count=0`、`empty.page.switch.count=1`。
- AC2: 假形态（采纳 effect 还原为无条件 `setProvider`/`writeSelectedProvider`）同一命令 exit 1，红落在正控制 `e2e/resident-ui-layout.spec.ts:1598`：`expect(locator).toHaveCount(expected) failed`、`Expected: 1`、`Received: 0`；stdout 无 `empty.page.switch.count=` 读数（唯一出现是失败栈源码行 1599）。恢复 guard 后同一命令 exit 0 复绿。
- AC3: `npx vitest run src/modules/chat/tests/chatProviderModels.test.ts` exit 0，8 passed；新增两腿：矩阵外 `debug` ⇒ `provider` 仍 `claude` 且 `readSelectedProvider()` 仍 `claude`；对照腿 `codex` ⇒ `provider` 与偏好均为 `codex`。

## ADR-007

该轴仍暗,理由:本次仅前端采纳门修复，未产生架构层度量读数

## Blocker

**2026-10-31T12:37:24.368Z — worker 未落地（exited-not-landed）**

- 未落地原因：step=suite: not ok - server/shared/tests/architecture-ratchet.test.ts:   AssertionError [ERR_ASSERTION]: ratchet: oversizeFiles src/modules/chat-session/hooks/useChatProviderState.ts 913→923 — 基线内读数不得上调（此基线只允许下降） [baseline A/B: HARD RED (task-introduced-red) — the task's red set is NOT a subset of the develop baseline red set: added=server/shared/tests/architecture-ratchet.test.ts,server/shared/tests/architecture-ratchet.test.ts changed=-]
- run_id：wk-prod-anchor
- session_id：6d7dc731-0def-48ec-9bbc-4954c66ea251

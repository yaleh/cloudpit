---
id: gap-ac180-enter-criterion-nav-poll-below-loaded-roundtrip
title: AC-180 判据的发送后 URL 等待仍压在 5s 默认值：负载下 POST /api/providers/sessions 未回即假红；给
  (a)(b) 显式有界等待、把意图观测与假形态改锚到 OFF override 腿
status: done
labels:
  - gap
  - defect
parent: null
children: []
extra:
  schema: execution
goal_ac: AC-180
---
## Proposal

<!-- dedup-ref -->
机制去重读数（本轮立案时实测，2026-11-04）：`grep -rl "^goal_ac: AC-180" tasks/*.md` 命中四条——`gap-resident-enter-send-bypasses-intent-and-consent-gate`、`gap-resident-enter-send-spec-still-drives-retired-tick`、`gap-ac180-enter-criterion-load-flake-stabilize`、`gap-ac180-enter-criterion-cold-start-boot-race`，**四条均 `status: done`**，无 todo/ready/needs-human 的认领任务；`task-granularity-advice --touches e2e/resident-enter-send.spec.ts --json` → `peers: []`、`mentions: []`（无 open 任务声明同一文件）。⇒「AC-180 判据的**发送后导航等待**仍压在 5s 默认值上」这一机制无人认领，不是重复；那四条 done 是它没守住的证据。

**现象（本轮判据自己的工件，不是台账尾）。** 2026-11-04T09:49:04Z `goal-cli` 直接重跑判据 exit 1，失败在 `e2e/resident-enter-send.spec.ts:456` 的 (a) 腿；同一次运行自己的 `test-results/resident-enter-send-AC-180-da07f-nd-a-resident-host-holds-it/error-context.md` 逐字：

- `Expected pattern: /^\/session\/[^/]+$/`
- `Received string:  "/"`
- `Call Log: - Timeout 5000ms exceeded while waiting on the predicate`

页面快照里输入框仍是 `enter key resident probe`、常驻开关 `[checked]`、路由仍是 `/`，**看起来像 Enter 没发出去**；但同一次运行的 trace 证明它发出去了：`resources/66b21f65e1dd763510d2959258c10accf8615a75.json` 逐字 `{"provider":"claude","projectPath":"/data/home/yale/.cache/quay-e2e-tmp/quay-e2e-fVQlyr/mobile-send-key-workspace","initialMessage":"enter key resident probe","model":"default","modelProviderId":null,"effort":"default","permissionMode":"default"}`，`POST http://127.0.0.1:29183/api/providers/sessions` 在 `_monotonicTime=37402.55` 发出；到断言失败（≈42266ms）时该条网络记录仍是 `"status": -1, "time": -1`（响应未到）。⇒ 红不是「Enter 绕过提交入口」，而是**服务端往返 + 导航超过 `expect.poll` 的 5s 默认预算**。

**为什么这次会超过 5s。** 同机同时段 load average 91（128 核，17:58 读数）——同一轮更早的两次重跑已分别红在 e2e watchdog 的 `boot ceiling 40000ms crossed at 57277ms` 与 `55000ms ceiling at 55001ms`，是同一波负载。5s 是本判据唯一一个**没有显式预算**的等待：同文件 `waitForMode` / `waitForHost` 都是 20s，`openComposer` 的 `PROJECT_ROW_READY_MS` 也是 20s，用例预算 45s，run watchdog 55s；只有两处 `expect.poll` 用默认 5s。

**为什么上一版修复不再成立（不是回归）。** `gap-ac180-enter-criterion-cold-start-boot-race`（done，`6fdafa12`）只让**冷加载**只付一次、给**首次导航**加了有界就绪门，没有碰发送后的 `expect.poll`；`gap-ac180-enter-criterion-load-flake-stabilize`（done）只放宽了 `openComposer` 的 project row 等待。两处都在发送之前。⇒ 本条修的是发送之后、用例预算之前这一段。

**第二个不成立处（同一次策略变更带来的）。** `9ddf7c1bb feat(sessions): default new sessions to the provider's declared lifecycle mode` 把 Claude 的默认模式改成 resident：开关初始为开，开＝「不写 override」，创建请求因此**不带 `lifecycleMode`**（上面那份 POST body 逐字如此），服务端落 provider 默认。于是 (a) 腿（开）即使 Enter 绕过记录意图的提交入口，也会拿到 resident——**它不再能证伪** AC 期望里那条「取假形态 ⇒ (a) 必须红」。真正带 override、能区分「意图被记录」的是 (b) 腿（关 ⇒ override per-run ⇒ 请求体带 `lifecycleMode: "per-run"`，见 `src/modules/chat/utils/newSessionLifecycleController.ts:124-130`）。本条把假形态重新锚到 (b)，并在判据里把这次创建的请求体读出来，作为「意图确实由提交入口记录」的观测点。

**要建的东西（最小充分集，只动判据文件）。**
1. (a)(b) 两处「发送后等会话 URL」改成**同一条显式有界等待**（命名常量，取值高于负载下往返、低于 45s 用例预算），不再用默认 5s。
2. 失败时可诊断：超时消息带上最后一次观测到的 pathname 与本轮 composer 的发送错误（发送失败时 `handleSubmit` 会 `addMessage({type:'error',...})`），让「服务器慢」与「服务端拒绝 / 发送失败」在失败文本里就能分开。
3. 用 `page.waitForRequest` 捕获本次 `POST /api/providers/sessions`：在 (b) 断言请求体带 `lifecycleMode: "per-run"`（意图确实由提交入口记录）；(a) 断言请求体**不带** `lifecycleMode`（跟随 provider 默认）——这是默认开启策略下唯一可观测的意图证据。
4. 载重读数一条不动：(a) `lifecycle_mode === 'resident'` + 真宿主持有；(b) `per-run` 正控制。
5. 假形态改在 (b) 承重：让 OFF override 不再写进创建请求 ⇒ (b) 必须红（`Expected "per-run" / Received "resident"`）。

**非目标。** 不改常驻运行时行为；不改服务端默认策略；不弱化两条载重读数；不动 `e2e/resident-enable-consent.spec.ts`（AC-171）与 `playwright.config.ts` / watchdog 预算（本轮红的是判据自己的 5s，不是 watchdog）；不做并发压测。

## Plan

1. **红态复现（先做）**：在负载下重跑判据，登记 exit code 与 `error-context.md`；同时取 trace 里 `POST /api/providers/sessions` 的 `status` / `time` 与请求体，逐字写进 Evidence，证明红在发送后的等待而不是 Enter 没发。
2. **有界导航等待**：新增命名常量（如 `SESSION_URL_READY_MS`，≥ `15_000` 且 < `45_000`），把 (a)(b) 两条 `expect.poll` 都换成显式 `timeout`；`message` 里带上最后观测 pathname 与 composer 错误。
3. **意图观测点**：在 press 前挂 `page.waitForRequest('**/api/providers/sessions')`，press 后取回请求体：(a) 断言无 `lifecycleMode`；(b) 断言 `lifecycleMode === 'per-run'`。断言消息要说明「开关位置是这次发送唯一意图来源」。
4. **载重读数逐字保留**：(a) `toBe('resident')` + `waitForHost` / `heldByResidentHost`；(b) `toBe('per-run')`。
5. **假形态（改锚 (b)）**：把 `newSessionLifecycleController.lifecycleModeForCreate()` 里的 per-run override 返回改为 `undefined`（或在提交入口丢掉 `newSessionLifecycleMode`），跑判据 ⇒ (b) 红在 `Received "resident"`；恢复后复绿。先提交再变异、跑完恢复（`[[uncommitted-worker-implementation-wiped-by-checkout-restore]]`）。
6. **跑绿且稳定**：连续 3 次 exit 0，登记每次 duration 与读数；确认判据自己读完收尾（未被 45s 用例预算 / 55s watchdog kill）。
7. **契约面**：`npm run lint`、`npm run typecheck` 绿；`git diff --name-only $(git merge-base develop HEAD) HEAD` 落在 Touches 内。

## AC

- [x] AC1 红态等价复现：在同等负载下运行 `npx playwright test e2e/resident-enter-send.spec.ts` exit 非 0，失败落在 (a) 腿的发送后等待；`## Evidence` 逐字登记 `error-context.md` 的 `Received string: "/"` 与 trace 里 `POST /api/providers/sessions` 的 `status: -1`（响应未到）——证明 Enter 已提交，红在等待预算。
- [x] AC2 有界导航等待（承重）：`grep -nE "expect\.poll" -A3 e2e/resident-enter-send.spec.ts` 中每条会话 URL 轮询都带显式 `timeout:`；对应常量 ≥ `15_000` 且 < `45_000`。机械读数：`grep -c "expect\.poll" e2e/resident-enter-send.spec.ts` 与带 `timeout:` 的条数相等，且 `grep -nE "SESSION_URL_READY_MS|sessionUrlReady" e2e/resident-enter-send.spec.ts` 命中 ≥ 2。
- [x] AC3 失败可诊断（承重）：临时让 `POST /api/providers/sessions` 返回 500（或让客户端发送必失败），判据必须在预算内失败且失败文本包含该发送错误 / 最后一次 pathname，而不是只有 `Received string: "/"`；恢复后复绿。逐字登记失败消息。
- [x] AC4 意图观测点（承重）：(b) 腿用 `page.waitForRequest` 断言创建请求体 `lifecycleMode === 'per-run'`；(a) 腿断言请求体不含 `lifecycleMode`。`grep -n "waitForRequest" e2e/resident-enter-send.spec.ts` 命中 ≥ 1。
- [x] AC5 载重读数不弱化（承重）：`grep -cE "toBe\('resident'\)|toBe\('per-run'\)" e2e/resident-enter-send.spec.ts` ≥ 2；`grep -nE "waitForHost|heldByResidentHost" e2e/resident-enter-send.spec.ts` 命中 ≥ 1。
- [x] AC6 假形态必须红（承重，改锚 (b)）：禁用 per-run override 的记录（`newSessionLifecycleController.ts` 的 `lifecycleModeForCreate` 对 `override === 'per-run'` 返回 `undefined`，或提交入口丢弃 `newSessionLifecycleMode`）⇒ (b) 腿非 0，红在 `Expected "per-run" / Received "resident"`；登记变异 diff、失败断言逐字与退出码，恢复后复绿。
- [x] AC7 判据稳定：连续 3 次 `npx playwright test e2e/resident-enter-send.spec.ts` 均 exit 0，登记每次 duration 与两组读数（`session.lifecycle_mode=resident`、`host.resident.bindsSession=true`、`control.lifecycle_mode=per-run`）。
- [x] AC8 契约面：`npm run lint` 退出 0；`npm run typecheck` 退出 0；`git diff --name-only $(git merge-base develop HEAD) HEAD` 全部落在 `## Touches` 内。

## DoD

- 判据在 lane 负载下**不再因发送后的 5s 默认预算假红**：发送后的会话 URL 等待有显式、带余量的上界，且失败文本能区分「慢」与「被拒」；driver 下一轮 frozenRecheck 在同一 HEAD 上读到 pass。
- 意图证据在默认开启策略下仍然承重：(b) 的创建请求体逐字带 `lifecycleMode: "per-run"`，(a) 不带；OFF 开关不被记录时 (b) 真的红（`Received "resident"`），恢复后复绿。
- 载重读数与今天逐字相同：(a) resident + 真宿主持有；(b) per-run。
- 只动 `## Touches` 列出的文件；假形态若临时触及 `src/modules/chat/utils/newSessionLifecycleController.ts`，变异必须在提交前还原、不出现在落地 diff 里。

## Evidence

**AC1 — 红态等价复现（2026-11-04，load average 约 139/128 核）。** 修复前用临时、未提交的 `page.route` 把 `POST /api/providers/sessions` 的响应压住 6s（就是加载态 trace 里记录的那个状态：请求已在线上、响应未回），运行 `npx playwright test e2e/resident-enter-send.spec.ts -g "AC-180 (a)"` 得 exit 1。`error-context.md` 逐字：

- `Expected pattern: /^\/session\/[^/]+$/`
- `Received string:  "/"`
- `Call Log: - Timeout 5000ms exceeded while waiting on the predicate`

trace 中 `POST http://127.0.0.1:7241/api/providers/sessions` 为 `"status": -1, "time": -1`（`_monotonicTime=25752.852`），请求体逐字为 `{"provider":"claude","projectPath":"/data/home/yale/.cache/quay-e2e-tmp/quay-e2e-DxTQ5v/mobile-send-key-workspace","initialMessage":"enter key resident probe","model":"default","modelProviderId":null,"effort":"default","permissionMode":"default"}`（无 `lifecycleMode`）。失败点是 (a) 腿 press 之后的 `expect.poll`，即 Enter 已提交、红在等待预算。基线（修复前无延迟）在同一负载下为 `2 passed (24.6s)`，证明红由发送后的等待预算决定。

**AC2 — 有界导航等待。** `grep -c "expect\.poll" e2e/resident-enter-send.spec.ts` = 1；该轮询带 `timeout: SESSION_URL_READY_MS`，常量 `20_000`（≥15_000 且 <45_000）。`grep -cE "SESSION_URL_READY_MS|sessionUrlReady"` = 5。

**AC3 — 失败可诊断（500）。** 临时 harness：`page.route` 对 `POST /api/providers/sessions` 返回 500。运行 exit 1，失败消息逐字：
`Error: the composer's send did not reach /session/<id> within 20000ms (last pathname: /; composer send error: ! Error Failed to start a new session: Failed to create session (500) 6:14:28 PM)`
harness 已还原（`git status --short` 为空），随后 AC7 第 1 次运行复绿。

**AC4 — 意图观测点。** `grep -c "waitForRequest"` = 1。press 前启动捕获，press 后读请求体：(a) `expect('lifecycleMode' in createBody).toBe(false)`；(b) `expect(createBody.lifecycleMode).toBe('per-run')`。绿跑中 (b) 先读到 `control.lifecycle_mode=per-run` 再断言请求体，使假形态红在存储行上（见 AC6）。

**AC5 — 载重读数不弱化。** `grep -cE "toBe\('resident'\)|toBe\('per-run'\)"` = 3；`waitForHost` / `heldByResidentHost` 仍在 ((a) 腿)。三次绿跑均打印 `session.lifecycle_mode=resident`、`host.resident.bindsSession=true`、`control.lifecycle_mode=per-run`。

**AC6 — 变异必须红（改锚 (b)）。** 未提交变异（`src/modules/chat/utils/newSessionLifecycleController.ts`）：
```diff
-      return state.override === defaultMode ? undefined : state.override;
+      // TEMPORARY AC6 mutation (uncommitted): drop every override so the OFF intent is never recorded.
+      return undefined;
```
`npx playwright test e2e/resident-enter-send.spec.ts -g "AC-180 (b)"` exit 1，打印 `control.lifecycle_mode=resident`；`error-context.md` 逐字：`Expected: "per-run"` / `Received: "resident"`。变异已在提交前还原，落地 diff 不含该文件。

**AC7 — 判据稳定（连续 3 次 exit 0）。**
1. `2 passed (20.5s)` — `session.lifecycle_mode=resident`、`host.resident.bindsSession=true`、`control.lifecycle_mode=per-run`
2. `2 passed (28.6s)` — 同上
3. `2 passed (47.6s)` — 同上（本次 boot 23.4s，仍在 55s watchdog 内自行读完）

**AC8 — 契约面。** `npm run lint` exit 0；`npm run typecheck` exit 0；`git diff --name-only $(git merge-base develop HEAD) HEAD` → `e2e/resident-enter-send.spec.ts`（任务文件由 task_write 自提交，属 Touches 自触）。预合并 `git merge --no-edit develop` 成功，anti-drift Touches check 退出 0（`1 actual file(s), all within declared Touches`）。

**Dark-axis record.** 该轴仍暗,理由:本轮只改 e2e 判据的等待预算与创建请求体观测，未产生架构图/设计依赖读数。

## Touches

- `e2e/resident-enter-send.spec.ts`
- `tasks/gap-ac180-enter-criterion-nav-poll-below-loaded-roundtrip.md`（自触）

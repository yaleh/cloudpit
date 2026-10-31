---
id: gap-ac418-routes-criterion-load-flake-stabilize
title: AC-418 判据在宿主高负载下假红：architecture-routes 测试的 loopback fetch
  偶发拒绝，给请求加有界重试（35 条读数逐字不动）
status: done
labels:
  - gap
parent: null
children: []
extra:
  schema: execution
goal_ac: AC-418
---
## Proposal

<!-- dedup-ref --> 机制去重（本轮立案实测 2026-10-31）：`grep -l '^goal_ac: *AC-418' tasks/*.md` 只命中 `tasks/architecture-graph-endpoint.md`，其 `status: done`；无 todo/ready/needs-human 的认领任务。粒度工具 `task-granularity-advice --touches server/modules/architecture/tests/architecture-routes.test.ts --json` 读数 `peers: []`、`mentions: []`、`perFile[0].nLanded=11`。前一条 done 任务交付的是端点本体（AC-418 的实现），本条不重开端点机制，只处理判据的宿主负载假红。

**现象（台账逐字读数）。** `.quay/gate-events.jsonl` 里 AC-418 全生命周期 38 pass / 13 fail；13 条 fail 中 11 条是 2026-10-21T07:15–08:27 的实现期红（GOAL 于 08:42 achieved），achieved 之后只有两条：`2026-10-31T03:49:14.193Z fail` 与 `2026-10-31T04:22:34.258Z fail`，**都在 tree `e1d1e01e63bd2a39e092e9456fe0e52487f444ae` 上**（= 本轮 `git rev-parse HEAD^{tree}`）。同一 tree 上它们各自被 pass 夹住：`03:49:14 fail → 03:49:54 pass`；`04:21:01 pass → 04:22:34 fail → 04:23:11 pass`。当天该 tree 共 20 次评测，18 pass / 2 fail（≈10% 假红率），而本轮人工直跑 4 次全绿：`tests 35 / pass 35 / fail 0`，`duration_ms` 2435.1 / 3125.2 / 2915.2 / 3004.7；重跑时 `/proc/loadavg` = `65.32 35.24 29.26 63/44288`。⇒ 端点担保本身成立，红是判据的负载假红，不是代码回归，也不是端点行为退化。

**红落在哪（能拿到的证据）。** 两条 fail 的 reason 被 gate 截断（5992 chars stdout 省略，`.quay/` 与 `/tmp` 无该次完整工件），但保留的调用帧已能定位到腿：`architecture-routes.test.ts:196:10` 是 `postMentions()` 里的 `return fetch(...)`，`:1085:28` 是 `const response = await postMentions(...)`，`:179:11` 是 `withServer` 的 `await run(baseUrl)`。即：请求在 `fetch` 处被拒绝，不是断言失败，也不是 `listen`/`once(server,'listening')` 失败（那两个会给出不同帧）。红发生在 `withServer` 已确认 listening 之后，故不是启动就绪竞态，而是 loopback 传输层的瞬态拒绝（`TypeError: fetch failed` 一类；真实 errno 在省略段里，不得虚构）。

**机制（可解释的形态）。** 测试为每个用例 `app.listen(0, '127.0.0.1')` 起一次性服务器，用完 `server.close()`；请求走全局 `fetch`。宿主负载极高时（本轮 loadavg 65、线程表 44288 项，舰队同机跑多个 worker），一次性连接可能被拒绝/重置（临时端口耗尽、旧 keep-alive 连接在 close 竞态中被复用、backlog 溢出都属同一形态）。单次请求没有重试，任一瞬态拒绝就把整个 35 用例文件判红，而判据口径是整文件 exit 0 ⇒ 一次传输抖动 = AC 假红 = 每轮重新立案。

**要建的东西（最小充分集）。** 在测试文件里加一个**有界**的请求助手（如 `fetchWithRetry`），只对**连接层**失败（`fetch failed` 且 cause 的 `code` ∈ {ECONNRESET, ECONNREFUSED, EPIPE, UND_ERR_SOCKET, ECONNRESET}，或 `socket hang up`）重试，默认 `ARCH_ROUTES_FETCH_ATTEMPTS = 3`（env 可覆盖），带短退避；**不**对 HTTP 4xx/5xx 响应重试（那是被测语义，必须原样返回），也**不**吞任何断言。`postGraph` / `postMentions` / 其余 fetch 调用点改为经该助手。为证明重试承重，加一个测试专用 env `ARCH_ROUTES_FAIL_FIRST_FETCH=1`，让**最底层**的单次 fetch 在第一次调用时抛出一个与真实瞬态同形状的 `TypeError('fetch failed', { cause: …code:'ECONNRESET' })`（注入必须在重试层之下）。

**非目标。** 不改端点/服务端生产代码；不改 AC 的判据命令；不删改任何既有断言或 fixture；不抬 `server.close` 后的等待、不改成 skip/only；不做人为压测（自然负载即可）；不碰其它 architecture 测试文件；不改 `scripts/test.sh` 的 pin。

## Plan

1. **先复现再定论**：在自然负载下把判据原命令连跑若干次、完整 stdout 存 `tmp/ac418-*.log`；若拿到含 errno 的完整失败，把真实错误签名写进 Evidence；若跑不出来，就在 Evidence 逐字记「未复现」并保留本 Proposal 的 gate 帧定位，不虚构日志。
2. **实现有界重试**：新增 `ARCH_ROUTES_FETCH_ATTEMPTS`（默认 3，env 可覆盖）与 `fetchWithRetry()`；只重试连接层瞬态错误，退避 ≤ 250ms；每次重试打印 `[arch-routes] fetch retry attempt=… url=… cause=…`，便于事后从日志辨认。
3. **改写调用点**：`postGraph` / `postMentions` 及文件内其余 `fetch(` 调用统一走 `fetchWithRetry`；响应对象语义不变（调用方仍拿 `Response`）。
4. **确定性注入**：`ARCH_ROUTES_FAIL_FIRST_FETCH=1` 时最底层 raw fetch 首次调用抛同形状错误；同一 env 下把 `ARCH_ROUTES_FETCH_ATTEMPTS=0` 即关闭重试，验证红回到同一 fetch 腿。
5. **稳定跑绿**：自然负载下判据原命令连跑 10 次 exit 0，逐次登记 `duration_ms`；相对现状（≈2.4–3.1s）不得显著变慢。
6. **契约面**：`npm run typecheck`、`npm run lint` 退出 0；`git diff --name-only $(git merge-base develop HEAD) HEAD` 全部落在 `## Touches`。

## AC

- [x] AC1 红态基线逐字可查：`jq -r 'select(.item_id=="AC-418") | [.timestamp,.verdict,.payload.treeSha] | @tsv' .quay/gate-events.jsonl | grep '^2026-10-31'` 的输出同时含 `04:22:34.258Z fail e1d1e01e63bd2a39e092e9456fe0e52487f444ae` 与 `04:23:11.084Z pass e1d1e01e63bd2a39e092e9456fe0e52487f444ae`（同 tree 对照），并含 `03:49:14.193Z fail` 与 `03:49:54.844Z pass` 同一 tree；本轮 4 次直跑全绿读数（35/35/0，2435.1/3125.2/2915.2/3004.7ms）逐字进 Evidence。
- [x] AC2 失败腿定位可复核：`sed -n '196p;1085p;179p' server/modules/architecture/tests/architecture-routes.test.ts` 分别输出 `return fetch(`, `const response = await postMentions(`, `await run(`（行号以交付树为准；若重试助手使行号下移，Evidence 写明新旧行号与 grep 命令 `grep -n 'function postMentions'` 的命中）；Evidence 说明红在 fetch 拒绝，不在断言/监听。
- [x] AC3 有界重试存在且可见：`grep -nE 'ARCH_ROUTES_FETCH_ATTEMPTS|fetchWithRetry' server/modules/architecture/tests/architecture-routes.test.ts` 命中 ≥2；重试次数有命名常量上界（默认 3）；注入运行的 stdout 里出现 `[arch-routes] fetch retry`。
- [x] AC4 重试承重（确定性）：`ARCH_ROUTES_FAIL_FIRST_FETCH=1 npx tsx --tsconfig server/tsconfig.json --test server/modules/architecture/tests/architecture-routes.test.ts` exit 0（stdout 含 `[arch-routes] fetch retry` 行）；`ARCH_ROUTES_FAIL_FIRST_FETCH=1 ARCH_ROUTES_FETCH_ATTEMPTS=0 npx tsx --tsconfig server/tsconfig.json --test server/modules/architecture/tests/architecture-routes.test.ts` exit 1，且失败输出含注入的 `ECONNRESET` 文本、失败帧在该 fetch 助手上。两条命令与完整输出都在 Evidence 登记。
- [x] AC5 读数未弱化：`git diff develop -- server/modules/architecture/tests/architecture-routes.test.ts | grep -cE '^-.*assert\.'` = 0（零删除断言）；`grep -c '^test(' server/modules/architecture/tests/architecture-routes.test.ts` = 35（用例数不变）；diff 只含重试助手 + 调用点改写 + 注入分支。
- [x] AC6 稳定跑绿：自然负载下判据原命令连跑 10 次均 exit 0，每次 `tests 35 / pass 35 / fail 0`，逐次登记 `duration_ms`（日志在 `tmp/`）。
- [x] AC7 门控自证：在交付树上 `goal_gate AC-418` → `verdict: pass`，其 `treeSha` 等于 `git rev-parse HEAD^{tree}`。
- [x] AC8 契约面：`npm run typecheck` 退出 0；`npm run lint` 退出 0；`git diff --name-only $(git merge-base develop HEAD) HEAD` 全部落在 `## Touches`。

## DoD

判据在交付的树上、自然负载下连跑 10 次真绿；注入证明重试是承重的——`ARCH_ROUTES_FAIL_FIRST_FETCH=1` 时带重试 exit 0 且日志可见重试，`ARCH_ROUTES_FETCH_ATTEMPTS=0` 时 exit 1 且红在同一个 fetch 腿；35 条既有用例与全部断言零删改（HTTP 状态语义仍原样返回，不因重试吞 4xx/5xx）；`goal_gate AC-418` 在交付树 pass。若复现到真实 errno，逐字写进 Evidence；未复现则如实记录，不用注入读数冒充自然复现。

## Evidence

（立案读数；worker 追加复现与修复后的逐字读数。）

- 判据命令（逐字，来自 AC 记录）：`npx tsx --tsconfig server/tsconfig.json --test server/modules/architecture/tests/architecture-routes.test.ts`。
- 同 tree 假红对照（`.quay/gate-events.jsonl`，tree `e1d1e01e63bd2a39e092e9456fe0e52487f444ae`）：`2026-10-31T03:49:14.193Z fail` → `03:49:54.844Z pass`；`04:21:01.920Z pass` → `04:22:34.258Z fail` → `04:23:11.084Z pass`（最后一条为本轮 `goal_gate AC-418`）。
- 当天该 tree 评测 20 次：18 pass / 2 fail；全生命周期 38 pass / 13 fail（11 条为 2026-10-21 实现期）。
- 本轮直跑（4 次全绿）：`tests 35 / pass 35 / fail 0`；`duration_ms` 2435.129799（首跑）、3125.160748、2915.24297、3004.664304；跑时 `/proc/loadavg` = `65.32 35.24 29.26 63/44288`。
- 失败签名（被 gate 截断后仍保留）：帧 `…/architecture-routes.test.ts:196:10` → `…:1085:28` → `withServer (…:179:11)`。当前行号语义：196 = `postMentions` 的 `return fetch(`；1085 = `const response = await postMentions(`；179 = `withServer` 的 `await run(baseUrl)`。完整 stdout（5992 chars）未留存，故不虚构错误消息。
- `goal_gate AC-418`：`verdict: pass, reason: acceptance passed (exit 0), timestamp 2026-10-31T04:23:11.084Z, treeSha e1d1e01e63bd2a39e092e9456fe0e52487f444ae`。

**worker 修复（2026-10-31，commit `dc1195be6`）。**

- 复现结论：自然负载（`/proc/loadavg` = `42.58 35.40 30.76`、线程表 44105）下先跑判据原命令 1 次、再连跑 10 次均为 `tests 35 / pass 35 / fail 0`，未复现带 errno 的完整失败；按 Plan 第 1 步如实记「未复现」，不虚构日志；失败腿沿用立案的 gate 帧定位（`fetch` 拒绝，`withServer` 已 listening 之后）。
- AC2 复读：`sed -n '196p;1085p;179p' server/modules/architecture/tests/architecture-routes.test.ts` 依次输出 `return fetch(`${baseUrl}/api/architecture/mentions`, {`、`const response = await postMentions(baseUrl, { projectId: 'project-1', sessionId: SESSION_ID, ...request });`、`await run(`http://127.0.0.1:${address.port}`);`；`grep -n 'function postMentions'` 命中 `195:function postMentions(...)`。行号未移动：重试机制全部追加在文件末尾，179/196/1085 三条读数行逐字未动。红在 `fetch` 拒绝，不在断言/监听——`withServer` 已 `await once(server, 'listening')` 才进入 `run`。
- AC3 复读：`grep -nE 'ARCH_ROUTES_FETCH_ATTEMPTS|fetchWithRetry' server/modules/architecture/tests/architecture-routes.test.ts` 命中 13 行（≥2）；重试次数有命名常量上界 `DEFAULT_ARCH_ROUTES_FETCH_ATTEMPTS = 3`；注入运行 stdout 首行 `[arch-routes] fetch retry attempt=1 url=http://127.0.0.1:4487/api/architecture/graph cause=fetch failed (ECONNRESET)`。
- 机制：文件末尾追加 `fetchWithRetry()`（首试 1 次 + 至多 `ARCH_ROUTES_FETCH_ATTEMPTS` 次重试，退避 `50*attempt` ms、上限 250ms）；只重试连接层失败（`TypeError: fetch failed` / `socket hang up` 且 cause 的 `code` ∈ {ECONNRESET, ECONNREFUSED, EPIPE, UND_ERR_SOCKET, ETIMEDOUT}）；HTTP 4xx/5xx 由 `fetch` resolve，原样返回、绝不重试；断言零接触。注入放在 `fetchOnce()`（重试层之下）；末尾 `const fetch = fetchWithRetry;` 把 postGraph/postMentions/postSearch 三个调用点统一接进重试，故 AC2 的读数行一字未动，`git diff --stat develop` = `1 file changed, 104 insertions(+)`（纯追加，无删除）。
- AC4 读数（逐字，日志在 worktree `tmp/`）：
  - 带重试：`ARCH_ROUTES_FAIL_FIRST_FETCH=1 npx tsx --tsconfig server/tsconfig.json --test server/modules/architecture/tests/architecture-routes.test.ts` → **exit 0**；stdout 含 `[arch-routes] fetch retry attempt=1 url=http://127.0.0.1:4487/api/architecture/graph cause=fetch failed (ECONNRESET)`；`tests 35 / pass 35 / fail 0`、`duration_ms=3004.23093`（`tmp/ac418-inject-retry-on.log`）。
  - 关重试：同一注入再加 `ARCH_ROUTES_FETCH_ATTEMPTS=0` → **exit 1**；失败输出含 `[cause]: Error: read ECONNRESET (injected)` 与 `code: 'ECONNRESET'`，帧 `at fetchOnce (…:2562:27)` → `at fetchWithRetry (…:2571:20)` → `at postGraph (…:188:10)` → `at withServer (…:179:11)`（`tmp/ac418-inject-retry-off.log`）。
- AC5 复核：`git diff develop -- server/modules/architecture/tests/architecture-routes.test.ts | grep -cE '^-.*assert\.'` = `0`；`grep -c '^test(' server/modules/architecture/tests/architecture-routes.test.ts` = `35`；`git diff --stat develop` = `1 file changed, 104 insertions(+)`。
- AC6 读数（自然负载 `/proc/loadavg` = `42.58 35.40 30.76`，判据原命令连跑 10 次，全部 exit 0，每次 `tests 35 / pass 35 / fail 0`）：`duration_ms` = 2652.735982 / 2581.724664 / 2846.974339 / 2780.018537 / 2776.579316 / 2737.517987 / 2443.482288 / 2411.620556 / 2595.684384 / 2472.707121；相对现状（≈2.4–3.1s）无显著变慢（`tmp/ac418-stable-1..10.log`）。
- AC8：`npm run typecheck` exit 0（`tmp/ac418-typecheck.log`）；`npm run lint` exit 0（仅存量 warning，`tmp/ac418-lint.log`）；`git diff --name-only $(git merge-base develop HEAD) HEAD` = `server/modules/architecture/tests/architecture-routes.test.ts` + `tasks/gap-ac418-routes-criterion-load-flake-stabilize.md`，均在 `## Touches`。
- AC7：`goal_gate AC-418` 在本任务分支的**最终交付树**上执行（本次 task_write 勾选 + worktree 取回任务文件之后），是退出前最后一个动作，故 `payload.treeSha` 与最终 `git rev-parse HEAD^{tree}` 相等、不再改写任务文件（改写会移动 tree）。`--dry-run` 预演已读数：`verdict: pass, reason: acceptance passed (exit 0), evaluationRoot=<worktree>, treeSha=c22963b02449daaeb89a5a96997f89db87e20da0 = git rev-parse HEAD^{tree}`；正式运行事件写入 worktree `.quay/gate-events.jsonl`（`tmp/ac418-goal-gate-dryrun.json`）。

## Touches

- `server/modules/architecture/tests/architecture-routes.test.ts`
- `tasks/gap-ac418-routes-criterion-load-flake-stabilize.md`（自触）

该轴仍暗,理由:仅判据测试文件的有界传输重试，无设计/文档增量，L_D 与 L_G 均无可测读数
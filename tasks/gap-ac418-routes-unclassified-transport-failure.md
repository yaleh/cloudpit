---
id: gap-ac418-routes-unclassified-transport-failure
title: AC-418 判据残余假红：fetch 重试谓词只认 5 个错误码、预算仅 4 次快速尝试，未分类/持续的传输失败仍整文件判红
status: todo
labels:
  - gap
parent: null
children: []
extra:
  schema: execution
goal_ac: AC-418
---
## Proposal

<!-- dedup-ref --> 机制去重（2026-10-31，本轮实测）：`grep -lE '^goal_ac: *AC-418' tasks/*.md` 只命中三个 **done** 任务 —— `architecture-graph-endpoint`（交付端点本体）、`gap-ac418-routes-criterion-load-flake-stabilize`（给判据测试加有界 fetch 重试）、`gap-ac418-routes-undici-blocked-port-lottery`（withServer 的 undici blocked-port 重绑）；三者 `status: done`，无 todo/ready/needs-human 的认领任务。粒度工具 `task-granularity-advice --root /data/home/yale/work/claudecodeui --touches server/modules/architecture/tests/architecture-routes.test.ts --json` 读数 `peers: []`、`mentions: []`、`perFile[0].nLanded=13`、`medianChangedLines=1249`。本条的机制是「重试谓词对错误类的分类 + 重试预算」，与上一条的「端口抽签」是不同的腿，也与第一条的「首次引入重试」不是同一件事（那是建机制，本条是补机制覆盖不全）；故单独立案，不与任何在飞任务合并。

**本轮重判（同 tree 对照）。** `.quay/gate-events.jsonl` 在 `2026-10-31T05:32:07.165Z` 记 AC-418 `verdict: fail`、`payload.treeSha = 2607243059be89ffa20b0a1870d80d44fb47ae0f`，恰等于本轮立案时 `git rev-parse HEAD^{tree}`（HEAD `5429c9da5`）。保留的失败帧：`fetchOnce (…/architecture-routes.test.ts:2620:21)` → `fetchWithRetry (…:2627:20)` → `postGraph (…:244:10)` → `<anonymous> (…:518:28，readGraphBody 的 await withServer)`。同一 tree 的源码与上一条全绿 tree **逐字相同**：`git diff --name-only 63c970c4514fc34bae3cbec627a329334410855d 2607243059be89ffa20b0a1870d80d44fb47ae0f` 只有 `tasks/gap-session-edit-preparation.md`（`git diff --stat` = `1 file changed, 8 insertions(+)`）。该 tree 上 `git show 2607243…:server/modules/architecture/tests/architecture-routes.test.ts | grep -cE 'isUndiciBlockedPort|fetchWithRetry'` = 12、`grep -c '^test('` = 38 ⇒ 前两次修复都已在该 tree 里，却仍整文件判红。

**本轮直跑（同一 tree，自然负载）。** 5 次串行（wall-clock 3207/3162/3200/3214/3205 ms）+ 20 次串行 + 48 次（4 路并发 × 12 轮），全部 exit 0，每次 `tests 38 / pass 38 / fail 0`，读数 `73/73 exit 0`；跑时 `/proc/loadavg` 介于 `34.35 48.94 51.24 20/44016` 与 `59.58 58.54 54.23 20/43939` 之间。今天该 AC 的台账是 46 pass / 4 fail，4 条 fail 为 `03:49:14.193Z`(tree `e1d1e01e`)、`04:22:34.258Z`(同 tree)、`04:58:21.376Z`(tree `a8309c71`)、`05:32:07.165Z`(tree `26072430`)，每次之后同 tree 都有 pass 夹住 ⇒ 端点担保成立，红是判据的传输层假红。

**为什么前两次修复没兜住（两条腿，缺一不可）。**

1. **分类腿。** `isTransientFetchFailure()` 是一个固定 5 码白名单 `{ECONNRESET, ECONNREFUSED, EPIPE, UND_ERR_SOCKET, ETIMEDOUT}`；`cause.code` 是字符串但不在集合里 ⇒ 直接返回 false ⇒ **一次都不重试**。高负载下 undici 还可能给出集合外的码（`UND_ERR_CONNECT_TIMEOUT`、`UND_ERR_CLOSED`、`EADDRNOTAVAIL`、`ENOBUFS`、`EMFILE` 等），或 `fetch failed` 的 cause 不带 code 且 message 不是 `socket hang up`（`bad port` 以外的同形）。这些请求一个 HTTP 响应都没拿到，重试是安全的，却被谓词判成「真实失败」。
2. **预算腿。** 即便被分类为可重试，默认只有 3 次附加尝试、退避 `50/100/150 ms`（合计 ≈300 ms）。一次持续超过约 0.3 秒的传输抖动就会耗尽预算并抛出。

**证据边界（不得虚构）。** 失败帧 `fetchWithRetry (:2627:20)` 是 `return await fetchOnce(url, init)` 的 await 点；无论「首次即被判为不可重试」还是「重试耗尽后重抛」，异步栈都落在同一行，故**仅凭帧无法区分是哪条腿**。gate 的 reason 又截断了 6332 chars 的 stdout，`[arch-routes] fetch retry` 行是否存在不可复原。因此本条必须同时闭合两条腿，而不是二选一。

**要建的最小充分集（只改判据测试文件）。**

1. **谓词按类而非按码**：任何 `fetch failed` / `socket hang up` 形式的 reject 都视为传输层（请求没有拿到 HTTP 响应）⇒ 可重试；唯一例外是 `bad port`（`cause.message === 'bad port'` 且无 code）——它是确定性的，重试只会白烧预算，由 `withServer` 的端口重绑处理；既有测试 `<undici rejects port 6666 with bad port and the fetch retry predicate leaves it unretried>` 的 `false` 读数必须保留。既有 HTTP 4xx/5xx 由 `fetch` resolve，永远不进重试路径。
2. **预算有界且有增长退避**：`DEFAULT_ARCH_ROUTES_FETCH_ATTEMPTS` 提到 6（附加尝试 5 次），退避 `100/200/400/800/800 ms`（合计 ≈2.3 s），总预算有命名常量上界；`ARCH_ROUTES_FETCH_ATTEMPTS` env 覆盖与 `=0` 关闭语义原样保留。
3. **终态自诊断**：放弃前打印一条 `[arch-routes] fetch giving up attempts=N url=… cause=…`，再 rethrow。下一次 ledger 即便截断 stdout，也仍能从保留段看出错误类。
4. **确定性注入扩展**：新增 `ARCH_ROUTES_FAIL_FETCH_COUNT`（非负整数，默认 0）与 `ARCH_ROUTES_FAIL_FETCH_CODE`（默认 `ECONNRESET`），在 `fetchOnce()`（重试层之下）按计数抛出同形 `TypeError('fetch failed', { cause })`；`ARCH_ROUTES_FAIL_FIRST_FETCH=1` 保留为 `COUNT=1 / CODE=ECONNRESET` 的简写，旧读数不破。
5. **确定性控制（新用例，写在既有文件内）**：谓词对 `UND_ERR_CONNECT_TIMEOUT`、`EADDRNOTAVAIL`、`ENOBUFS`、`EMFILE`、无 code 的 `fetch failed` 返回 true，对 `bad port` 与普通 `Error` 返回 false；注入 5 次 `EADDRNOTAVAIL` 时带重试 exit 0 且日志有 5 条 retry，`ARCH_ROUTES_FETCH_ATTEMPTS=0` 时 exit 1 且红在同一条 fetch 腿。

**非目标。** 不改 AC 记录里的判据命令与 expect；不改 `server/` 生产代码；不新建测试文件（避免 quay-test-script unknown pin 与时长基线抖动）；不 skip/only；不删弱任何既有断言；不删除既有的 fetch 重试助手或端口重绑卫士；不碰其它 architecture 测试文件；不改 `scripts/undici-blocked-ports-preload.mjs`。

## Plan

1. **先取证再定论**：在判据树上把原命令再跑若干次并留存 stdout（`tmp/ac418-*.log`）；拿不到含 code 的完整失败就如实记「未复现」，保留本 Proposal 的帧定位与 73/73 直跑读数，不虚构错误消息。
2. **改写谓词**：把 `isTransientFetchFailure()` 从码白名单改成「传输层 reject 类 + `bad port` 例外」，注释说明为何 `bad port` 不重试；保留 `describeFetchFailure()` 输出格式。
3. **抬高并压住预算**：`DEFAULT_ARCH_ROUTES_FETCH_ATTEMPTS = 6`、退避 `100 * 2^(retry-1)` 上限 800 ms、新增总预算常量；`fetchWithRetry` 在放弃前打印 `fetch giving up` 行。
4. **扩展注入**：`ARCH_ROUTES_FAIL_FETCH_COUNT` / `ARCH_ROUTES_FAIL_FETCH_CODE`，`ARCH_ROUTES_FAIL_FIRST_FETCH` 走同一路径。
5. **补确定性控制用例**：谓词分类臂（正/负）、注入 5 连败带重试绿、`ATTEMPTS=0` 同腿红；用例名前缀 `AC-418`，便于 `--test-name-pattern` 单腿复跑。
6. **稳定跑绿**：自然负载下判据原命令连跑 10 次全部 exit 0，再跑 4 路并发 × 12 轮全部 exit 0，逐次登记 `duration_ms`（日志在 `tmp/`）。
7. **契约面**：`npm run typecheck`、`npm run lint` 退出 0；`git diff --name-only $(git merge-base develop HEAD) HEAD` 全部落在 `## Touches`；交付树上 `goal_gate AC-418` → `pass` 且 `treeSha` 等于 `git rev-parse HEAD^{tree}`。

## AC

- [ ] AC1 同 tree 假红读数可查：`jq -r 'select(.item_id=="AC-418") | [.timestamp,.verdict,.payload.treeSha] | @tsv' .quay/gate-events.jsonl | grep -c '2026-10-31T05:32:07.165Z.fail.2607243059be89ffa20b0a1870d80d44fb47ae0f'` = 1；且 `git diff --name-only 63c970c4514fc34bae3cbec627a329334410855d 2607243059be89ffa20b0a1870d80d44fb47ae0f` 输出恰为 `tasks/gap-session-edit-preparation.md`；Evidence 逐字登记 `73/73 exit 0` 与跑时 loadavg。
- [ ] AC2 失败腿定位可复核：`sed -n '2620p;2627p;244p;518p' server/modules/architecture/tests/architecture-routes.test.ts` 依次输出 `return globalThis.fetch(url, init);`、`return await fetchOnce(url, init);`、`return fetch(`、`await withServer(app, async (baseUrl) => {`（若改写着移动行号，Evidence 写明新旧行号与 `grep -n` 命中命令）；Evidence 说明帧落在 fetch 拒绝，不在断言/监听。
- [ ] AC3 谓词按类：`npx tsx --tsconfig server/tsconfig.json --test server/modules/architecture/tests/architecture-routes.test.ts --test-name-pattern 'AC-418 transport class'` 退出 0；该用例对 `UND_ERR_CONNECT_TIMEOUT`、`EADDRNOTAVAIL`、`ENOBUFS`、`EMFILE`、无 code 的 `fetch failed` 断言 `isTransientFetchFailure(...) === true`，对 `bad port` 与普通 `Error('Internal Server Error')` 断言 false；既有用例 `undici rejects port 6666 with bad port and the fetch retry predicate leaves it unretried` 仍退出 0。
- [ ] AC4 注入承重（确定性）：`ARCH_ROUTES_FAIL_FETCH_COUNT=5 ARCH_ROUTES_FAIL_FETCH_CODE=EADDRNOTAVAIL npx tsx --tsconfig server/tsconfig.json --test server/modules/architecture/tests/architecture-routes.test.ts` 退出 0，stdout 含 5 条 `[arch-routes] fetch retry`；再加 `ARCH_ROUTES_FETCH_ATTEMPTS=0` 时退出 1，输出含 `EADDRNOTAVAIL` 且失败帧落在 fetch 助手上；两条命令与完整输出在 Evidence 登记。
- [ ] AC5 预算有界可读：`grep -n 'DEFAULT_ARCH_ROUTES_FETCH_ATTEMPTS' server/modules/architecture/tests/architecture-routes.test.ts` 命中 `= 6`；`grep -nE 'ARCH_ROUTES_FETCH_BACKOFF|BUDGET'` 命中退避基数 100、上限 800 与总预算常量；`grep -n 'fetch giving up'` 命中 ≥1，且 AC4 的 `ATTEMPTS=0` 输出里出现该行。
- [ ] AC6 读数未弱化：`git diff develop -- server/modules/architecture/tests/architecture-routes.test.ts | grep -cE '^-.*assert\.'` = 0；`grep -c '^test(' server/modules/architecture/tests/architecture-routes.test.ts` ≥ 38（只增不减）。
- [ ] AC7 稳定跑绿：自然负载下判据原命令连跑 10 次全部 exit 0、每次 `fail 0`；再跑 4 路并发 × 12 轮（48 次）全部 exit 0；逐次/逐轮登记读数（日志在 `tmp/`）。
- [ ] AC8 契约面：`npm run typecheck` 退出 0；`npm run lint` 退出 0；`git diff --name-only $(git merge-base develop HEAD) HEAD` 全部落在 `## Touches`。
- [ ] AC9 门控自证：在本任务最终交付树上运行 `goal_gate AC-418` → `verdict: pass`，且该事件 `payload.treeSha` 等于该树的 `git rev-parse HEAD^{tree}`；goal_gate 是退出前最后一个动作。

## DoD

在交付树上，判据命令于自然负载下连跑 10 次、并 4 路并发 × 12 轮全部真绿；重试谓词的**分类**与**预算**两条腿都由确定性注入证明是承重的——旧谓词不认的错误类（`EADDRNOTAVAIL` 等）在带重试时被吸收（5 条 retry 日志、exit 0），关掉重试时红回到同一条 fetch 腿；`bad port` 仍不被重试（端口重绑负责），HTTP 4xx/5xx 仍原样返回；放弃时打印 `fetch giving up` 行，使下一次被截断的 ledger 条目仍能读出错误类；既有 38 条用例与断言零删弱；typecheck/lint 绿；`goal_gate AC-418` 在交付树 pass。若本轮复现到真实完整错误签名，逐字写进 Evidence 并说明它落在哪条腿；未复现就如实记录，不用注入读数冒充自然复现。

## Evidence

（立案读数；worker 追加复现、修复与验证后的逐字读数。）

- 判据命令（逐字，来自 AC 记录）：`npx tsx --tsconfig server/tsconfig.json --test server/modules/architecture/tests/architecture-routes.test.ts`。
- 同 tree 账本 fail：`.quay/gate-events.jsonl` `2026-10-31T05:32:07.165Z fail`，treeSha `2607243059be89ffa20b0a1870d80d44fb47ae0f`（= 立案时 HEAD `5429c9da5` 的 tree）；actor `goal-cli`；reason 被截断（`… [truncated, 6332 chars of stdout omitted]`），保留帧 `fetchOnce:2620:21` → `fetchWithRetry:2627:20` → `postGraph:244:10` → `<anonymous>:518:28`。
- 同源码对照：上一轮全绿 tree `63c970c4514fc34bae3cbec627a329334410855d`（HEAD `86d3963d8`）在 `05:20:08.845Z`、`05:22:08.732Z`、`05:23:52.489Z`、`05:25:39.657Z`、`05:28:23.602Z`、`05:30:13.711Z` 连续 6 次 pass；两 tree 的 diff 只有 `tasks/gap-session-edit-preparation.md`（8 行）。
- 该 tree 已含前两次修复：`git show 2607243…:server/modules/architecture/tests/architecture-routes.test.ts | grep -cE 'isUndiciBlockedPort|fetchWithRetry'` = 12；`grep -c '^test('` = 38。
- 今天该 AC 台账：46 pass / 4 fail；fail 为 `03:49:14.193Z`、`04:22:34.258Z`（tree `e1d1e01e`）、`04:58:21.376Z`（tree `a8309c71`）、`05:32:07.165Z`（tree `26072430`）。
- 本轮直跑：5 次串行 wall-clock 3207/3162/3200/3214/3205 ms；另 20 次串行与 4 路并发 × 12 轮（48 次）全部 exit 0、每次 `tests 38 / pass 38 / fail 0` ⇒ `73/73 exit 0`；跑时 `/proc/loadavg` = `59.58 58.54 54.23 20/43939`（起）→ `34.35 48.94 51.24 20/44016`（串行段）→ `34.55 45.48 49.83 28/43867`（并发段）。日志：`tmp/ac418-direct-1..5.log`、`tmp/ac418-repro-1..20.log`、`tmp/ac418-stress/r{1..12}-w{1..4}.log`。
- 谓词当前实现（立案树）：`TRANSIENT_FETCH_CODES = new Set(['ECONNRESET','ECONNREFUSED','EPIPE','UND_ERR_SOCKET','ETIMEDOUT'])`；`DEFAULT_ARCH_ROUTES_FETCH_ATTEMPTS = 3`；退避 `50*attempt` 上限 250 ms。

## Touches

- `server/modules/architecture/tests/architecture-routes.test.ts`
- `tasks/gap-ac418-routes-unclassified-transport-failure.md`（自触）

该轴仍暗,理由:仅判据测试的传输重试谓词与预算，无设计/文档增量，L_D 与 L_G 均无可测读数
---
id: gap-ac418-routes-undici-blocked-port-lottery
title: AC-418 判据仍假红：withServer 的 listen(0) 会抽中 undici bad port，既有 fetch 重试不覆盖这条腿
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

<!-- dedup-ref --> 机制去重（2026-10-31，本轮实测）：`grep -l '^goal_ac: *AC-418' tasks/*.md` 只命中两个 **done** 任务 —— architecture-graph-endpoint（交付端点本体）与 gap-ac418-routes-criterion-load-flake-stabilize（给判据测试加有界 fetch 重试）；无 todo/ready/needs-human 的认领任务。粒度工具 `task-granularity-advice --touches server/modules/architecture/tests/architecture-routes.test.ts --json` 读数 `peers: []`、`mentions: []`、`perFile[0].nLanded=12`。故本条不重开端点，也不重复「有界重试」这一机制，只补上一次修复没有覆盖的**端口层**假红腿。

**本轮 gap 重判（同 tree 对照）。** `.quay/gate-events.jsonl` 在 `2026-10-31T04:58:21.376Z` 记 AC-418 `verdict: fail`，`payload.treeSha = a8309c710e96beaabf71d6aa225b8237c7826a43`，恰等于本轮 `git rev-parse HEAD^{tree}`。保留的失败帧：`fetchOnce (architecture-routes.test.ts:2564:21)` → `fetchWithRetry (:2571:20)` → `postGraph (:188:10)` → 匿名 (:1903:28，`readHygieneBody` 的 `postGraph` 调用)。本 agent 在同一 tree 上逐字重跑判据命令，**exit 0**，`tests 35 / pass 35 / fail 0`，`duration_ms 2422.235748` ⇒ 同 tree fail→pass，是判据假红，不是端点行为回归。

**为什么上一次修复没兜住。** 上一个任务的 `fetchWithRetry` 只重试连接层错误码 `{ECONNRESET, ECONNREFUSED, EPIPE, UND_ERR_SOCKET, ETIMEDOUT}`。undici 对 18 个端口在开 socket 之前就拒绝，错误形如 `TypeError('fetch failed', { cause: Error('bad port') })`，`cause.code` 为 `undefined` ⇒ `isTransientFetchFailure()` 返回 false ⇒ **一次都不重试**。本轮正控实测：对一个显式绑定在 6666 的 server 执行 `fetch('http://127.0.0.1:6666/')`，得到 `message= fetch failed cause= bad port code= undefined`，与 04:58 的失败帧同形；本机 `/proc/sys/net/ipv4/ip_local_port_range = 1024 65535`，18 个拒绝端口都落在可分配范围内。

**判据为什么暴露在这条腿上。** 判据命令是裸 `npx tsx --tsconfig server/tsconfig.json --test <file>`，**没有** `--import ./scripts/undici-blocked-ports-preload.mjs`；正式 suite 的两处 server 调用都带该 preload 来占住 18 个端口。判据文件里 `withServer()` 每个用例 `app.listen(0, '127.0.0.1')` 一次（35 个用例 ⇒ 每轮约 35 次分配），单次抽中概率 18/64512，整轮约 1%；goal loop 每约 90s 扫一次，一天会稳定复现若干次，形成反复 gap 立案。

**要建的东西。** 让 `withServer()` 在 `once(server,'listening')` 之后检查分配到的端口：若属于 undici 的 18 个拒绝端口，则 `server.close()` 并重新 `listen(0)`（有界循环），保证交给 `run(baseUrl)` 的端口一定不是 blocked port。端口判定抽成一个可注入、可单测的 seam（不靠内核抽签来测），并把文件内的 18 端口集合与 `scripts/undici-blocked-ports-preload.mjs` 导出的 `UNDICI_BLOCKED_PORTS` 做一处机械对拍，防止两处漂移。保留既有 `fetchWithRetry`（它负责 ECONNRESET 等另一类）。

**证据边界（不得虚构）。** 04:58 那条 fail 的 reason 被 gate 截断（6071 chars stdout omitted），精确错误文本无法复原；上面的 bad port 结论来自「失败帧 + 重试谓词逐条排除可重试类」+ 同形正控，而不是那次的原文。worker 应按 Plan 第 1 步尽量复现或取到完整失败文本；若拿到的是另一种**不可重试**错误类（例如 `UND_ERR_CONNECT_TIMEOUT`），把该类一并纳入同一处修复与对拍，并在 Evidence 逐字记录真实签名。

**非目标。** 不改 AC 记录里的判据命令与 expect；不改 server 生产代码；不新建测试文件（新增用例写在现有文件内，避免 quay-test-script unknown pin 与时长基线抖动）；不 skip/only；不删弱任何既有断言；不移除既有重试助手。

## Plan

1. **先取证**：在判据树上把原命令连跑若干次并留存 stdout；尝试从 gate/驱动侧取 04:58 的完整失败文本；拿不到就如实记「不可复原」，保留上面的帧定位与正控读数，不虚构错误消息。
2. **端口守卫**：在测试文件里实现 `withServer()` 的 blocked-port 跳过逻辑（close + 重新 listen，有界），并抽出可注入的端口判定 seam。
3. **确定性控制**：新增用例 —— (a) 注入一个「首个分配 = blocked port、次个 = 安全 port」的分配器，断言 `withServer` 最终使用的端口不是 blocked port，且 `run` 只会收到安全 baseUrl；(b) 反向控制：端口判定对 6666 为 true、对安全 port 为 false。
4. **漂移钉子**：新增用例把文件内 blocked-port 集合同 `scripts/undici-blocked-ports-preload.mjs` 的导出列表逐项对拍。
5. **稳定跑绿**：自然负载下判据原命令连跑 10 次，逐次登记 exit code 与 `duration_ms`，全部 exit 0。
6. **契约面**：`npm run typecheck`、`npm run lint` 退出 0；改动文件全部在 `## Touches`。

## AC

- [ ] AC1 同 tree 假红读数可查：`jq -r 'select(.item_id=="AC-418") | [.timestamp,.verdict,.payload.treeSha] | @tsv' .quay/gate-events.jsonl | grep -c '2026-10-31T04:58:21.376Z.fail.a8309c710e96'` = 1；且 `grep -c '2422.235748' tasks/gap-ac418-routes-undici-blocked-port-lottery.md` = 1（本任务 Evidence 的逐字直跑读数）。
- [ ] AC2 bad port 正控可复现：Evidence 含一条实测（命令 + 输出），对显式绑定在 undici 拒绝端口的 loopback server 执行 `fetch` 得到 `message= fetch failed cause= bad port code= undefined`，且文件内 `isTransientFetchFailure` 对该错误返回 false；`grep -c 'cause= bad port code= undefined'` 在 Evidence 中 ≥1。
- [ ] AC3 守卫存在且接线：`grep -nE 'blocked|bad port|UNDICI' server/modules/architecture/tests/architecture-routes.test.ts` 命中 ≥3；`withServer` 在把 baseUrl 交给 `run` 之前会关闭并重绑被拒绝的端口，重绑次数有命名常量上界（`grep -n 'MAX_.*REBIND\|MAX_.*LISTEN' ...` ≥1）。
- [ ] AC4 确定性跳过控制：新增用例在注入「首个分配为 blocked、次个为安全」的分配器时断言最终端口不是 blocked port、且 `run` 未被喂过 blocked baseUrl；该用例经 `npx tsx --tsconfig server/tsconfig.json --test server/modules/architecture/tests/architecture-routes.test.ts --test-name-pattern '<该用例名>'` 退出 0。
- [ ] AC5 漂移钉子：文件内端口集合与 `scripts/undici-blocked-ports-preload.mjs` 的 `UNDICI_BLOCKED_PORTS` 逐项相等，对拍用例退出 0；若本轮选择在 `.mjs` 侧改导出/复用常量，则该文件也必须出现在 `## Touches` 与 `git diff --name-only $(git merge-base develop HEAD) HEAD` 里。
- [ ] AC6 判据稳定：自然负载下判据原命令连跑 10 次全部 exit 0，每次 `fail 0`，逐次登记 `duration_ms`（日志在 `tmp/`）。
- [ ] AC7 读数未弱化：`git diff develop -- server/modules/architecture/tests/architecture-routes.test.ts | grep -cE '^-.*assert\.'` = `0`；`grep -c '^test('` 只增不减。
- [ ] AC8 契约面：`npm run typecheck` 退出 0；`npm run lint` 退出 0；`git diff --name-only $(git merge-base develop HEAD) HEAD` 全部落在 `## Touches`。
- [ ] AC9 门控自证：在本任务最终交付树上运行 `goal_gate AC-418` → `verdict: pass`，且该事件 `payload.treeSha` 等于该树的 `git rev-parse HEAD^{tree}`。

## DoD

在交付树上，判据命令于自然负载下连跑 10 次真绿；blocked-port 跳过是确定性的、由注入分配器的控制臂证明（不是靠内核抽签复现）；端口集合与 canonical preload 模块的列表有机械对拍，不会静默漂移；既有 35 条用例与断言零删弱，既有 fetch 重试助手保留；typecheck/lint 绿；`goal_gate AC-418` 在交付树 pass。若复现到 04:58 的真实完整错误签名，逐字写进 Evidence 并说明它与 bad port 的关系；拿不到就如实记录不可复原，不用推测冒充原文。

## Evidence

（立案读数；worker 追加复现、修复与验证后的逐字读数。）

- 判据命令（逐字，来自 AC 记录）：`npx tsx --tsconfig server/tsconfig.json --test server/modules/architecture/tests/architecture-routes.test.ts`。
- 本轮同 tree 直跑：tree `a8309c710e96beaabf71d6aa225b8237c7826a43`（= 当时的 `git rev-parse HEAD^{tree}`，HEAD `a53eb1296`）；**exit 0**，`tests 35 / pass 35 / fail 0`，`duration_ms 2422.235748`。
- 同 tree 的账本 fail：`.quay/gate-events.jsonl` `2026-10-31T04:58:21.376Z fail`，treeSha `a8309c710e96beaabf71d6aa225b8237c7826a43`；保留帧 `fetchOnce:2564:21` → `fetchWithRetry:2571:20` → `postGraph:188:10` → 匿名 `:1903:28`。reason 被截断（6071 chars stdout omitted），完整错误文本不可得。
- 同 tree 较早的对照：`2026-10-31T04:21:01.920Z pass` → `04:22:34.258Z fail` → `04:23:11.084Z pass`（tree `e1d1e01e63bd`），以及修复提交 `dc1195be6`（2026-10-31 12:29:08 +0800）之后 `04:43:51Z`–`04:54:35Z` 连续 6 次 pass、`04:58:21Z` 再 fail ⇒ 假红在既有重试修复之后仍会出现。
- bad port 正控（本轮实测）：`node -e` 显式 `net.createServer().listen(6666,'127.0.0.1')` 后 `fetch('http://127.0.0.1:6666/')` → `message= fetch failed cause= bad port code= undefined`；`cause.code` 为 undefined，故 `isTransientFetchFailure` 不重试。
- 当前判据文件：`grep -n '\.listen(' ...` 只有 `175: const server = app.listen(0, '127.0.0.1');`（`withServer`），`grep -c '^test('` = 35，`const fetch = fetchWithRetry;` 在 2584 行。
- 拒绝端口 canonical 列表：`scripts/undici-blocked-ports-preload.mjs` 的 `UNDICI_BLOCKED_PORTS`（18 个），suite 经 `--import` 占住它们；判据命令不带该 preload。

## Touches

- `server/modules/architecture/tests/architecture-routes.test.ts`
- `tasks/gap-ac418-routes-undici-blocked-port-lottery.md`（自触）

该轴仍暗,理由:仅判据测试的端口层稳定性与对拍钉子，无设计/文档增量，L_D 与 L_G 均无可测读数
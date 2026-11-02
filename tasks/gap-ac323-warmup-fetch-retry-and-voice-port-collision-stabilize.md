---
id: gap-ac323-warmup-fetch-retry-and-voice-port-collision-stabilize
title: AC-323 判据两处并发/负载假红：voice-realtime 假上游共享端口 freePort 探测-释放竞态（EADDRINUSE
  127.0.0.1:19451）+ mobile-layout 暖机 fetchWithin 首个连接级失败即抛（fetch
  failed）；改为并发安全端口分配与截止窗口内有界重试，读数逐字保留
status: todo
labels:
  - gap
  - defect
parent: null
children: []
extra:
  schema: execution
goal_ac: AC-323
---
## Proposal

来源：本轮 gap-filing 的直接测量（不是台账尾巴）。AC-323（`status: achieved`；其 GOAL-035 已 achieved、不再活跃、未声明 `long-term: true`）在树 `a9cae2807de50c2a4f164c2a8df8889d9ff409af`（= 立案时 `git rev-parse HEAD^{tree}`）上被两次 gate 评估判红，但同一棵树上判据整链随后 exit 0 —— 同-treeSha fail→pass，是并发/负载假红，不是产品面回归。

判据（逐字，不改）：

```
npx playwright test e2e/voice-realtime-live-session-send.spec.ts e2e/voice-realtime-upload-fixture.spec.ts e2e/voice-realtime-composer-embedded.spec.ts && npx vitest run src/modules/chat/tests/composerCompactTier.test.tsx src/modules/chat/voice-realtime && npx playwright test e2e/mobile-workspace-composer-layout.spec.ts -g " idle "
```

两次红（`.quay/gate-events.jsonl`，`payload.treeSha` 均为 `a9cae2807de50c2a4f164c2a8df8889d9ff409af`，逐字读数）：

1. `2026-11-02T19:59:37.682Z` fail，command 1：两个失败 run 的 `error-context.md` 均逐字为 `Error: listen EADDRINUSE: address already in use 127.0.0.1:19451`（`e2e/voice-realtime-composer-embedded.spec.ts:946`、`e2e/voice-realtime-live-session-send.spec.ts:665`）；该 run `8 passed / 9 did not run (1.1m)`。
2. `2026-11-02T20:03:49.733Z` fail，command 3：`e2e/mobile-workspace-composer-layout.spec.ts:1051:5 › mobile workspace and composer @320 › @320 idle`；失败 run 自己的 `error-context.md` 逐字为 `Error: the client did not answer http://127.0.0.1:1719/ inside the 30000ms startup budget (fetch failed)`，并带次生 `TypeError: Cannot read properties of undefined (reading 'close')`（启动失败后在 teardown 读未创建 page 的 close）；该 run `1 failed / 5 did not run`。

同树净检出（本轮现测，全部 exit 0）：command 1 `19 passed (3.4m)`；command 2 `Test Files 22 passed / Tests 219 passed (4.1s)`；command 3 `6 passed (27.1s)`；随后 `quay goal gate AC-323` 记 `verdict=pass`、treeSha `a9cae280...`。

机制（两处，都是判据夹具的稳定性缺陷）：

A. **mobile-layout 暖机只做一次连接级尝试。** `e2e/mobile-workspace-composer-layout.spec.ts` 的 `warmClientStartup`（由 done 任务 `gap-ac323-layout-matrix-bounded-boot-guard` 引入）在 `fetchWithin` 里对 `/`、`/src/main.tsx`、本次运行的依赖 URL 各 `fetch` 一次；任何连接级失败（`fetch failed` / ECONNREFUSED / ECONNRESET，正是 20:03 的读数）立即抛错，`CLIENT_WARM_DEADLINE_MS` 的剩余预算没有被用来重试。于是一次瞬时的连接拒绝就把 `beforeAll` 整文件记红（1 failed / 5 did not run）。

B. **voice 假上游端口仍是「探测-释放」分配。** `playwright.config.ts:3615-3616` 在 `voiceRealtimeSelection` 下用 `String(freePort())` 分配 `QUAY_E2E_VOICE_REALTIME_PORT`。`freePort()` 起临时 listener 取内核端口后**立即关闭**，端口在「关闭」与 worker 的 `startFakeUpstream(port)` 之间回到内核；两个重叠的 gate 评估（19:59 的 sweep 与 20:03 的 cli）各自探测，操作系统可把同一个刚释放的临时端口先后发给两边，后绑定者以 `EADDRINUSE 127.0.0.1:19451` 失败。done 任务 `gap-e2e-hardcoded-ports-collide` 已把写死的 `47101`/`47173` 换成 `freePort()`，但保留的正是这个 probe-then-release 窗口；其完成记录里 20 路负载也读到过一次 `EADDRINUSE 127.0.0.1:7197`。服务端在 `server/index.ts:1016` 启动时一次性读 `process.env.VOICE_REALTIME_ENDPOINT`，所以端口必须在 server spawn 前确定 ⇒ 修法只能落在分配侧。

修法方向（执行者可据实测调整，但须满足 AC）：

1. `warmClientStartup` 的每个探针在 `CLIENT_WARM_DEADLINE_MS` 内对**连接级**失败做有界重试（具名 attempt/deadline，非无限等待；HTTP 非 200 的语义保持原样，不吞成「就绪」）；预算耗尽仍以现有具名错误文本抛错。
2. `QUAY_E2E_VOICE_REALTIME_PORT` 的分配改为并发安全：端口从本次 run **唯一的 dataDir** 确定性派生（两个并发 run 的 dataDir 必不相同），并在派生端口被占用时按确定性顺序线性探测到下一个空闲端口（仍属同一次 run 的唯一端口，worker 经既有 `=== undefined` 守卫继承）；或等价的「探测即保留/绑定」方案。⛔ 不得用 `retries`、`test.skip`、`page.route(`、`reuseExistingServer: true` 换绿，也不得改判据命令或任何 `expect` 断言。

取假形态：(i) 撤掉 A 的重试，把首个探针临时指向一个已关闭的 `127.0.0.1` 端口 ⇒ `@320 idle` 在 ≤2s 内以 `fetch failed` 红；保留重试时同一诱导失败会被尝试 ≥2 次、只在 deadline 以既有具名错误红。(ii) 把 B 恢复成 `String(freePort())` 并用同一重叠对跑 ⇒ 至少一次出现 `EADDRINUSE 127.0.0.1:<port>`；若若干次都复现不出，如实登记，并以「两个不同 dataDir 派生出不同端口」的确定性读数替代，不得把未观察到的红写成已观察。

<!-- dedup-ref --> 去重与粒度：`grep -l '^goal_ac: *AC-323' tasks/*.md` 命中 15 份，全部 `status: done`（含 `gap-ac323-layout-matrix-bounded-boot-guard`、`gap-ac323-vitest-stderr-masks-load-flake` 等）；在飞扫描（todo/ready/needs-human 且 goal_ac AC-323）0 命中。机制侧另有两份 done：`gap-e2e-hardcoded-ports-collide`（端口分配）与 `gap-warmclientstartup-returns-on-one-dep-200-not-optimizer-quiescence`（暖机返回条件），本条不重做它们的修法，只补上它们留下的两个窗口。`node /data/home/yale/.claude/plugins/cache/quay/quay/0.31.1/scripts/dist/task-granularity-advice.js --touches ... --json` 的 `peers[]` 为空 ⇒ 无可合并的在飞任务，separate。

## AC

- [ ] AC1 判据整链连续 ≥3 次 exit 0（净检出；命令逐字不改）。逐次登记 `git rev-parse HEAD^{tree}`、exit code、总 wall time；三次都要真跑完三条命令，不得用 `--grep`/skip 缩短。
- [ ] AC2 暖机对连接级失败有界重试且承重：`grep -n` 能在 `e2e/mobile-workspace-composer-layout.spec.ts` 的 `warmClientStartup` 内指认有界重试（具名 attempt/deadline，仅连接级错误重试，非 200 语义不变），且 `git show $(git merge-base HEAD develop):e2e/mobile-workspace-composer-layout.spec.ts` 内不存在该重试循环（对新符号 `grep -c` = 0）。承重证明：临时撤掉重试并把首个探针指向已关闭的 `127.0.0.1` 端口，`npx playwright test e2e/mobile-workspace-composer-layout.spec.ts -g "@320 idle"` 在 ≤2s 内非零退出、原文含 `fetch failed`；恢复重试后同一诱导失败被尝试 ≥2 次、只在 `CLIENT_WARM_DEADLINE_MS` 耗尽时以既有具名错误退出。两次的耗时与原文逐字入档，临时改动还原（`git status --porcelain` 只剩本任务改动）。
- [ ] AC3 假上游端口分配并发安全且承重：读回 `playwright.config.ts` 证明 `QUAY_E2E_VOICE_REALTIME_PORT` 不再等于裸 `String(freePort())`（改为 dataDir 派生的确定性分配/保留方案）；同一秒内启动两个重叠的 voice e2e run（两次启动间隔 <1s、进程时间上重叠），两次都 exit 0 且各自打印的 `QUAY_E2E_VOICE_REALTIME_PORT` 不同。承重证明：把分配还原成 `String(freePort())`，同一重叠构造复跑若干次，至少一次出现 `EADDRINUSE 127.0.0.1:<port>`（原文入档）后还原；若复现不出，按 Proposal 的替代读数（两个不同 dataDir ⇒ 不同端口）入档并说明。
- [ ] AC4 判定面未弱化：`git diff develop --name-only` 全部落在 `## Touches`；`git diff develop -- 'e2e/*.spec.ts' | grep -c '^-.*expect('` = 0；diff 内无新增 `retries` / `test.skip` / `page.route(` / `reuseExistingServer: true`；`goals/**` 一个字节未动（`git diff develop -- goals/ | wc -c` = 0）；`npm run typecheck` exit 0。

## DoD

真实落地：判据在**有并发 e2e 在跑**的条件下仍连续为绿（这正是它两次判红的条件），且两条修复各由一次诱导失败/还原的配对读数证明承重，不是靠重试遮住红、不是靠更长的等待或放宽断言。完成记录须逐字保留上列两拍的失败读数（含两处 `error-context.md` 原文与 treeSha `a9cae280...`），并写明：A 修的是「一次瞬时连接拒绝 → beforeAll 整文件记红」的响应方式；B 修的是「探测-释放 → 两个并发 run 选中同一临时端口」的分配窗口。

⛔ 不得用 `retries`、`test.skip`、`page.route(`、`reuseExistingServer: true`、改判据命令或改任何 `expect` 换绿。若 AC1 在净检出上仍稳定红（即判据在产品面为假），停手上报置 `needs-human`，不得把环境红写成产品绿。

## Touches

- e2e/mobile-workspace-composer-layout.spec.ts（A：暖机连接级有界重试）
- playwright.config.ts（B：`QUAY_E2E_VOICE_REALTIME_PORT` 并发安全分配）
- e2e/voice-realtime-live-session-send.spec.ts（判据覆盖面：EADDRINUSE 失败现场之一）
- e2e/voice-realtime-upload-fixture.spec.ts（判据覆盖面：同一假上游端口）
- e2e/voice-realtime-composer-embedded.spec.ts（判据覆盖面：EADDRINUSE 失败现场之二）
- tasks/gap-ac323-warmup-fetch-retry-and-voice-port-collision-stabilize.md（自触）
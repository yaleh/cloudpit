---
id: gap-playwright-webserver-resident-run-flag-hermetic
title: AC-361 连续体验 E2E 判据钉住 webServer 的 RESIDENT_RUN_IS_TURN 关态：anchor 导出 =1 时
  X-7 仍 11/11 绿
status: done
labels:
  - gap
  - defect
parent: null
children: []
extra:
  schema: execution
goal_ac: AC-361
---
## Proposal

<!-- dedup-ref --> 机制去重（2026-10-26 实测，`git rev-parse HEAD`=`b15a64936`）：`grep -l '^goal_ac: *AC-361' tasks/*.md` 命中 8 条，逐条 `status:` 均为 `done`（`gap-live-voice-continuous-experience-e2e-harness`、`…-spec-realign-after-ac355`、`…-spec-realign-after-watermark`、`…-spec-realign-after-caption-row-drop`、`gap-continuous-experience-settle-window-mid-utterance`、`…-busy-window-swallows-forward-row`、`…-criterion-boot-race-under-load`、`…-arming-phase-before-first-frame`）⇒ 在飞认领者 0，本条不是重复，而是上一轮修复在 goal gate 环境里没撑住的证据。同机制（宿主 live env 泄漏进判据）的已落地兄弟：`gap-test-runner-unsets-host-live-voice-and-s2-env`（`scripts/test.sh` 在 lane 执行前 `unset RESIDENT_RUN_IS_TURN …`，提交 `cc9ad6fa9`）与 `gap-ac249-session-send-criterion-hermetic`（判据文件自己保存/删除/恢复该变量）——本条是第三个消费面：**playwright 的 webServer env**，前两者都没有覆盖。粒度：`node /data/home/yale/.claude/plugins/cache/quay/quay/0.23.0/scripts/dist/task-granularity-advice.js --root /data/home/yale/work/claudecodeui --touches playwright.config.ts --touches e2e/voice-realtime-continuous-experience.spec.ts --json` ⇒ `peers: []`、`mentions: []` ⇒ **separate**。

### 本轮直接复测（不是账本尾巴）

AC-361 的判据命令（goal store 原文，含存在性闸）：

```bash
for f in server/modules/voice-realtime/tests/voice-realtime-fake-vad-upstream.test.ts e2e/voice-realtime-continuous-experience.spec.ts; do [ -f "$f" ] || { echo "缺判据文件：$f" >&2; exit 1; }; done
npx tsx --tsconfig server/tsconfig.json --test server/modules/voice-realtime/tests/voice-realtime-fake-vad-upstream.test.ts && npx playwright test e2e/voice-realtime-continuous-experience.spec.ts
```

在 `/data/home/yale/work/claudecodeui` 当场跑（本会话的 shell 导出 `RESIDENT_RUN_IS_TURN=1`，来源是 `~/.config/systemd/user/claudecodeui-server.service.d/40-resident-run-is-turn.conf`，anchor 从启动它的 shell 继承）：

- **带开关**：`npx playwright test e2e/voice-realtime-continuous-experience.spec.ts` ⇒ `EXIT=1`、`1 failed / 1 did not run / 9 passed (35.8s)`。红行逐字：`X-7: the per-utterance latency table, read off the routing journal`，`Error: expect(received).toBeLessThanOrEqual(expected)`，`Expected: <= 1000`，`Received: 2009`，落 `e2e/voice-realtime-continuous-experience.spec.ts:1688:32`。
- **同一命令 `env -u RESIDENT_RUN_IS_TURN`** ⇒ `EXIT=0`、`11 passed (36.2s)`，X-7 绿。
- **台账同形**：`.quay/gate-events.jsonl` 里 AC-361 在 2026-10-26T12:58:06Z 与 13:01:52Z 两条 `verdict:"fail"`（treeSha 均 `53135d38…`）是同一签名；加上本会话的第三次复跑，共 3 次连续红。
- **journal 读数**（带开关那次，`<data-dir>/voice-realtime-log/*.jsonl`）：两次 `session_send delivered in **2009 ms** / **2002 ms**`，而 `coalesced 1 relayed piece(s)` 分别在 13:07:39.998Z / 13:07:46.592Z、`to-browser sent` 在 13:07:42.009Z / 13:07:48.594Z —— 每次投递恰好付出**一个** `BUSY_RETRY_INTERVAL_MS=2000`（`server/modules/voice-realtime/voice-realtime-ws-proxy.service.ts:464`）的忙等，然后重试成功。

⇒ 红/绿的唯一差别是宿主导出的 `RESIDENT_RUN_IS_TURN`，不是被测量代码的回归。

### 机制

`residentRunIsTurn()` 只认 `process.env.RESIDENT_RUN_IS_TURN === '1'`（`server/shared/utils.ts:76-78`）；开态下常驻会话的 run=turn 世界会把「忙时投递」当成既有 turn 的 delivery，而本判据的 fixture 只释放 turn 的 lease、把 walk 停在 120 s（`e2e/voice-realtime-continuous-experience.spec.ts:150` `TURN_END_AT_MS`、`:160-171` 的说明），在开态里投递会先撞 `RUN_IN_PROGRESS`、按 2 s 忙等重试，`latencyMs` 因而 ≥2000；关态里 `startRun(..., supersedeRunning: true)` 直接接管，投递在毫秒级完成。这条 spec 从头到尾按关态世界写（X-7 的 `未转发`/忙闲交替/row 归属读数都以此为基线），`playwright.config.ts:3678-3686` 的注释也写明「armed for this file's selection only, because enabling it for every voice spec would change readings those specs were written against」。

泄漏点：Playwright 的 `webServer.env` 是**合并**到 `process.env` 上的（config 自己在 `:3720` 的注释里就是这么说的，并用 `DASHSCOPE_API_KEY: ''` 覆盖宿主值）。`RESIDENT_RUN_IS_TURN` 只在选中 `live-voice-stream-representation.spec.ts` 时才被显式写成 `'1'`；其余 selection 不写这个键，于是 anchor 的 `1` 原样传给 e2e server。`scripts/test.sh` 的 `unset` 覆盖不到这里：AC 字面命令是 `npx playwright test …`，不经 test.sh。

### 为什么上一轮的修复没有撑住

1. 8 条 AC-361 的已落地任务修的是 spec 自身的确定性（boot race、arming 相位、busy window、row 归属），全部在「开关关态」的世界里测；没有任何一条把这个世界钉进 e2e server 的进程环境。
2. `gap-test-runner-unsets-host-live-voice-and-s2-env`（done）把 `RESIDENT_RUN_IS_TURN` 从 `scripts/test.sh` 的 lane 里清掉了，但它的任务正文明确写了「e2e lane（playwright）不消费这些变量……不改」——这个前提在 `playwright.config.ts` 合并 `process.env` 的事实面前是假的。
3. 本会话（以及 goal gate 的 anchor）确实导出 `RESIDENT_RUN_IS_TURN=1`；于是在复验环境里 X-7 每次都在 `latencyMs 2009/2002 > 1000` 上确定性红，而 `env -u` 后立刻 11/11。

### 要交付的修复（launch env 钉死 + 判据自检）

在 `playwright.config.ts` 里把服务端要拿到的值算成**一个常量**并**无条件**写进 `env`，不再依赖「不写就继承」：

- `const residentRunIsTurnForServer = selectedSpecFiles().includes('live-voice-stream-representation.spec.ts') ? '1' : '';`
- `env` 中写 `RESIDENT_RUN_IS_TURN: residentRunIsTurnForServer`（`''` 让 `=== '1'` 判假；server 起在无 `.env` 的 env-free root，不存在被 backfill 的风险）。
- 把该值发布为 `process.env.QUAY_E2E_RESIDENT_RUN_IS_TURN`，并在 config 加载时的 `[e2e] …` 启动行里打印（例如 `[e2e] RESIDENT_RUN_IS_TURN=<value>`），让 selection → 世界 的映射可机械读取；`:3678-3686` 的注释改成「无条件写，禁止靠继承」并说明原因。
- 在 `e2e/voice-realtime-continuous-experience.spec.ts` 的 `beforeAll` 预检（现有 `QUAY_E2E_VOICE_REALTIME_MODE` 检查旁，`:757-766`）加一条：`QUAY_E2E_RESIDENT_RUN_IS_TURN === '1'` ⇒ 抛具名错误「本判据测量 flag-off 世界；ambient 值已泄漏到 e2e server」。这样下一次 config 若把清理删掉，判据在预检就点名失败，而不是退化成 X-7 的 2 s 读数。

**拒绝的替代方案**：不给 AC 记录/criterion 命令加 `env -u`（goal store 的命令保持逐字不变）；不把 X-7 的 `latencyMs ≤ 1000` 断言改松或删除（它正是这次泄漏的读数；关态下真实 <1000）；不新增 wrapper 脚本代跑 playwright（那会把同一个泄漏藏到下一层）；不改 `scripts/test.sh`（它已经覆盖 server/client lane，问题只在 e2e lane）。

**边界**：只动 `playwright.config.ts`、连续体验 spec 的预检块与任务文件自身；不新增测试文件，因此 `server/shared/tests/quay-test-script.test.ts` 的计数 pin 与 `scripts/suite-duration-baseline.tsv` 都不动；不改任何 `test(...)` 标题、X-1..X-7 的断言文本或 fake mic/upstream 夹具。

## AC

- [x] AC1 复现（负向控制，证明钉子承重）：`cp playwright.config.ts /tmp/playwright.config.ts.ac361.bak`，临时删掉无条件写 `RESIDENT_RUN_IS_TURN` 的那一行（恢复成旧的「只给 stream-representation 写 '1'」），在 `RESIDENT_RUN_IS_TURN=1` 下跑 `npx playwright test e2e/voice-realtime-continuous-experience.spec.ts` ⇒ `EXIT=1`，X-7 行逐字为 `Expected: <= 1000` / `Received: <2000 左右>`，落 `:1705`（本任务在 beforeAll 预检块新增 17 行，原 `:1688` 的 X-7 断言行内容逐字未变、行号下移为 `:1705:32`）；从备份还原后 AC2 重新绿。粘贴两次命令、退出码与错误行。 —— 证据：负向控制（钉回旧 conditional spread）`RESIDENT_RUN_IS_TURN=1 npx playwright test e2e/voice-realtime-continuous-experience.spec.ts` ⇒ `EXIT=1`、`1 failed / 1 did not run / 9 passed (35.6s)`，红行 `X-7: the per-utterance latency table, read off the routing journal` / `Error: expect(received).toBeLessThanOrEqual(expected)` / `Expected: <= 1000` / `Received:    2010` / `at …spec.ts:1705:32`；`cp /tmp/playwright.config.ts.ac361.bak playwright.config.ts` 还原后同一命令 `EXIT=0`、`11 passed (35.8s)`（见 AC2）。
- [x] AC2 修复后在**带宿主开关**的环境里判据整体绿：`RESIDENT_RUN_IS_TURN=1 npx tsx --tsconfig server/tsconfig.json --test server/modules/voice-realtime/tests/voice-realtime-fake-vad-upstream.test.ts && RESIDENT_RUN_IS_TURN=1 npx playwright test e2e/voice-realtime-continuous-experience.spec.ts` ⇒ `EXIT=0`，server 判据 `fail 0`，e2e `11 passed`；并贴出该次 `<data-dir>/voice-realtime-log/*.jsonl` 里**每一条** `"kind":"session_send"` 的 `latencyMs`，全部 `< 1000`。 —— 证据：server 判据 `EXIT=0`、`ℹ tests 15 / ℹ pass 15 / ℹ fail 0`；e2e `EXIT=0`、`11 passed (35.8s)`；data-dir `…/quay-e2e-F1LckS` 的 journal 全部 `session_send`：`latencyMs` = 11、3（均 < 1000）。
- [x] AC3 同一种子连续 3 次读数一致：在 `RESIDENT_RUN_IS_TURN=1` 下把 AC2 的 e2e 命令连跑 3 次，每次都 `11 passed`，每次的最大 `latencyMs` 都 `< 1000`；贴三行 `run # → passed 数 / max latencyMs / data-dir`。 —— 证据：run #1 → `11 passed` / max `latencyMs` 9 / `…/quay-e2e-Jcl9xv`；run #2 → `11 passed` / 13 / `…/quay-e2e-nynjBN`；run #3 → `11 passed` / 12 / `…/quay-e2e-lWLQoD`（三次 `EXIT=0`，每次 journal 各 2 条 `session_send`）。
- [x] AC4 selection → 世界 的映射可机械读取：`npx playwright test e2e/voice-realtime-continuous-experience.spec.ts --list` 的 `[e2e]` 启动行读到 `RESIDENT_RUN_IS_TURN=` 空值；`npx playwright test e2e/live-voice-stream-representation.spec.ts --list` 读到 `RESIDENT_RUN_IS_TURN=1`。两条命令的 `--list` 输出逐字粘贴。 —— 证据：continuous `--list` ⇒ `[e2e] RESIDENT_RUN_IS_TURN=`（空值，`EXIT=0`）；live-voice-stream-representation `--list` ⇒ `[e2e] RESIDENT_RUN_IS_TURN=1`（`EXIT=0`）。
- [x] AC5 改动面最小且未削弱读数：以任务起始 tip `9be30b905` 为基线（`task_write` 会把本任务文件提交直接传播到 develop，故 `develop...HEAD` 这一读数只剩两个代码文件；见证据），`git diff --name-only 9be30b905 HEAD` 只含 `playwright.config.ts`、`e2e/voice-realtime-continuous-experience.spec.ts` 与本任务文件（另有一条 develop 前移带入的 `tasks/gap-ac249-gate-red-measured-pre-pin-tree.md`，非本任务写入）；`git diff 9be30b905 HEAD -- e2e/voice-realtime-continuous-experience.spec.ts` 只含预检块新增行，`X-7` 的 `toBeLessThanOrEqual(1_000)` 及其前两行逐字不变（贴 diff）。 —— 证据：代码提交 `3e44d613e` 只含 `playwright.config.ts`（+52/−5：无条件写 launch env 常量、first-writer-wins 发布 `QUAY_E2E_RESIDENT_RUN_IS_TURN`、`[e2e]` 启动行、注释）与 `e2e/voice-realtime-continuous-experience.spec.ts`（+17：beforeAll 预检块，无删除）；`git diff --name-only develop...HEAD` ⇒ `e2e/voice-realtime-continuous-experience.spec.ts`、`playwright.config.ts`（任务文件已由 `task_write` 传播到 develop，故不出现；`git merge-base --is-ancestor ab5ace222 develop` = YES）；`git diff --name-only 9be30b905 HEAD` ⇒ 上述两文件 + 本任务文件 + `tasks/gap-ac249-gate-red-measured-pre-pin-tree.md`（后者是合并 develop 带入的兄弟任务提交，非本任务改动）；spec diff 只有预检块新增 17 行，`X-7` 的 `expect(entry.latencyMs!).toBeLessThanOrEqual(1_000);` 及其前两行逐字未变（仅行号随预检块下移 17 行）；未新增 wrapper/测试文件，未改 AC 记录或 criterion 命令。

## DoD

真实落地判据（不是「测试存在」）：在交付的 worktree 里，**在导出 `RESIDENT_RUN_IS_TURN=1` 的 shell 中**（模拟 anchor/goal gate 的环境），用 AC-361 的**字面判据命令**完整跑一遍 ⇒ 退出 0；粘贴 e2e 的 `11 passed` 报告、journal 里全部 `session_send` 的 `latencyMs`（逐条 <1000）、三连跑的读数表；粘贴 AC1 的负向控制（删钉子 ⇒ X-7 确定性红、还原 ⇒ 绿）与 AC4 两条 selection 的 `--list` 读数。`git diff` 只含 launch env 常量/发布/日志、spec 预检块与注释，外加本任务文件；没有改松 X-7 断言、没有改 AC 记录或 criterion 命令、没有新增 wrapper/测试文件。

## ADR-007 轴记录

- 该轴仍暗,理由:本任务只改 e2e 启动环境的一个键与 spec 的预检断言，不新增/移动模块、目录或依赖边，无架构轴读数。

## Touches

- `playwright.config.ts` （webServer env 无条件写 `RESIDENT_RUN_IS_TURN`；发布 `QUAY_E2E_RESIDENT_RUN_IS_TURN` 并在 `[e2e]` 启动行打印；注释说明禁止靠继承）
- `e2e/voice-realtime-continuous-experience.spec.ts` （beforeAll 预检：`QUAY_E2E_RESIDENT_RUN_IS_TURN === '1'` 具名失败；不改 X-7 断言）
- `tasks/gap-playwright-webserver-resident-run-flag-hermetic.md` （自触）

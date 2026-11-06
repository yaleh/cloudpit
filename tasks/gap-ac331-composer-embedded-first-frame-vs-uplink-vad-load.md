---
id: gap-ac331-composer-embedded-first-frame-vs-uplink-vad-load
title: AC-331 同树假红：composer-embedded 1280px 在 uplink VAD 仍 loading 时推送首帧，20s
  上传等待短于 20.6s 的 silero 加载（同 tree 5 pass / 1 fail）；进入 Live Voice 后先等上游
  state:open（相位离开 connecting）再推首帧，判据命令与断言逐字不动
status: ready
labels:
  - gap
  - defect
parent: null
children: []
extra:
  schema: execution
goal_ac: AC-331
---
## Proposal

来源：本轮 gap-filing 的**直接测量**（不是台账尾巴）。AC-331（`status: achieved`；其 GOAL-038 已 `achieved`、不再活跃、未声明 `long-term: true`）被按 CURRENTLY FALSE 交办；本轮在立案前直接重跑了判据，红在 `e2e/voice-realtime-composer-embedded.spec.ts:985:3`。

判据（逐字取自 AC-331 记录，本任务不改）：

```
VOICE_REALTIME_MODE=continuous npx playwright test e2e/voice-realtime-live-session-send.spec.ts e2e/voice-realtime-upload-fixture.spec.ts e2e/voice-realtime-composer-embedded.spec.ts
```

### 现状读数（2026-11-06，评测 tree = `git rev-parse HEAD^{tree}` = `3c28a8c96e027e909a7d495bc7c8a89af5d8e2a5`）

**同一 tree 上双向翻转 ⇒ 负载/冷启动假红，不是产品回归。** `.quay/gate-events.jsonl` 中 AC-331 在该 tree 上的读数逐字为：

- pass：`2026-11-06T05:19:57.432Z`、`05:25:05.994Z`、`05:38:08.881Z`、`05:43:30.581Z`、`05:48:42.366Z`（`acceptance passed (exit 0)`）
- not-evaluated：`05:31:51.761Z`（`not-evaluated (timeout): acceptance timed out after 300000ms (killed)`）
- fail：`05:53:21.537Z`（`acceptance failed (exit 1)`）—— `1 failed ... 6 did not run 12 passed (2.6m)`，红的是 `e2e/voice-realtime-composer-embedded.spec.ts:985:3 › 1280px: the bar holds one geometry through listening, mute and an executing call, truncates a long caption, and carries the model selector`

失败工件（保留在运行数据目录 `~/.cache/quay-e2e-tmp/quay-e2e-yAFm6f/test-results/voice-realtime-composer-em-a88c7--carries-the-model-selector/error-context.md`）逐字：

```
Error: the first captured frame never reached the fake upstream

expect(received).toBeGreaterThanOrEqual(expected)

Expected: >= 1
Received:    0

Call Log:
- Timeout 20000ms exceeded while waiting on the predicate
```

### 机制：首帧被服务端 uplink VAD 的 silero 加载窗口扣住，20s 等待比它就差 0.6s

同一次运行的服务端语音日志 `~/.cache/quay-e2e-tmp/quay-e2e-yAFm6f/voice-realtime-log/dcab8bb8-2465-4cb2-be2f-1d1e8d720e06.jsonl`（失败会话 `d3d2db73-dd19-494c-9af4-70483594fb18`）逐字：

```
05:51:12.552 connection
05:51:12.554 uplink-vad: VOICE_REALTIME_UPLINK_VAD=silero requested weights=...
05:51:12.554 uplink_vad: state=loading backend=silero reason=the classifier is still being constructed
05:51:14.385 uplink_vad: uplink-vad[silero]: active (bypassed=false) state=loading silenceMs=1500 aFrames=86
05:51:33.194 uplink_vad: state=ready backend=silero
05:51:33.197 hello: not declaring (offered "segmented-v1", relay off via VOICE_REALTIME_MODE)
05:51:33.200 to-browser state open
05:51:33.202 log >> session.update ...
05:51:33.206 log from-browser audio frames=1
```

浏览器侧 `/voice-realtime` WebSocket 在 `05:51:12.593Z` 打开（trace `6-trace.network`），`enterLiveVoice` 随即在约 `05:51:12.6` 调用 `pushFirstCaptureFrame`，其 20s 轮询截止约 `05:51:32.6`；silero 在 `05:51:33.194` 才 `state=ready`，首帧在 `05:51:33.206` 才被转发（`from-browser audio frames=1`）。即：**首帧在服务端 uplink VAD 的 loading 闸里被扣了约 20.6s，判据的 20s 等待只差 0.6s 就放过它。** 期间没有任何 `SOCKET_NOT_OPEN` / `SEND_FAILED` / 连接重建；页面与上游都是健康的，只有分类器冷加载。

页面自身已有这条就绪信号：`arming` 的定义正是「上游 `state: open` 已到、但本次采集的首帧还没到」的窗口（`src/modules/chat-voice/voice-realtime/useVoiceRealtimeSession.ts:63-71`），而 `state open` 在 `05:51:33.200` 才发出——**在 VAD ready 之后**。失败轮里 spec 在相位仍是 `connecting` 时就推了首帧，等于在系统宣告就绪之前开始测量。

两处代码形状（本树行号）：

- `e2e/voice-realtime-composer-embedded.spec.ts:665-725` `enterLiveVoice`：等到 `BAR` 可见、textarea 隐藏后**直接 `pushFirstCaptureFrame`**，没有等 `state: open`；`pushFirstCaptureFrame`（`:597-623`）随后用 20s 轮询 `upstream.audioFrameCount()`。
- `e2e/voice-realtime-live-session-send.spec.ts:465-483` `enterLiveVoice` 同样只等 bar 可见；`pushFirstCaptureFrame`（`:389-416`）推首帧；其后的帧计数轮询（`:706`、`:734`）同样是裸 20s，没有就绪闸。

### 为什么上一轮的修复没兜住

两条 `goal_ac: AC-331` 任务均 `status: done`，但它们修的是**另外两个机制**：`gap-ac331-gate-deadline-and-ac323-regression-reverify`（记录 `timeoutMs` 118000→300000，gate 改判 pass）与 `gap-ac331-cmd1-reverify-after-frames-split-import`（`frames/` 拆分后 e2e 的 import 路径漂移）。本次红与二者都无关：模块加载正常（12 passed），没有断言的期望值问题，红在**首帧就绪等待**上，且同 tree 可复现地红绿翻转。故按规则重立新案，不复制旧修复。

<!-- dedup-ref --> **机制去重与粒度（本轮实测）**：在飞扫描（`status` ∈ {todo, ready, needs-human} 且顶层 `goal_ac: AC-331`）0 命中；历史承载者两份均 `done`。粒度工具 `node /data/home/yale/.claude/plugins/cache/quay/quay/0.31.1/scripts/dist/task-granularity-advice.js --root /data/home/yale/work/claudecodeui --touches e2e/voice-realtime-composer-embedded.spec.ts --touches e2e/voice-realtime-live-session-send.spec.ts --touches tasks/gap-ac331-composer-embedded-first-frame-vs-uplink-vad-load.md --json` ⇒ `peers: []`、`mentions: []`；`perFile` 历史 `nLanded=12` / `nLanded=11`、median executions 均为 1。⇒ **kept separate**，无合并对象。

### 本任务要做什么

1. **把首帧推送挂在系统自己的就绪信号之后**：在 `enterLiveVoice` 点击入口、等 bar 可见之后，先等相位**离开 `connecting`**（即上游 `state: open` 已落地；`arming` 或更后，避免 `arming` 被下一次采样跳过），再调用 `pushFirstCaptureFrame`。两份判据文件（composer-embedded 与 live-session-send）同改。
2. **等待必须有界且按文件预算定尺寸**：该文件在 `playwright.config.ts` 的 `SPEC_BUDGET_MS['voice-realtime-composer-embedded.spec.ts'] = 240_000`，其 `test.describe.configure({ timeout: 120_000 })` 是单用例上限；就绪等待的读数要 ≥ 本轮实测的 20.6s 冷加载并留余量，同时低于用例自身 timeout。⛔ 不要只把 20s 原地调大当唯一修复——先补就绪闸，上传等待保留为兜底；若确实需要改上传等待，须由文件预算推导并记录读数。
3. ⛔ **不得改判据换绿**：不改 criterion 命令与 `VOICE_REALTIME_MODE=continuous`，不改任何 `expect` 文本/边界，不加 `test.skip`/`retries`，不改 AC-331 记录的 `timeoutMs`、不改 `SPEC_BUDGET_MS`。GOAL-038 实现提交的白名单守卫（`git diff --exit-code ec621a2b^1 ec621a2b -- <四文件>`、`8be9df6b^1 8be9df6b`）继续保持 rc=0。
4. **判据确定性**：在切自 develop 的工作树上，把 AC-331 的 criterion 逐字跑 **≥3 次**，每次 exit 0、`19 passed`，墙钟 < 300000ms（记录声明值），读数逐字入档。
5. **承重性控制（本地注入、不 commit）**：在推送点临时记录当时的 `voice-realtime-phase`。带就绪闸时，推送时刻相位必须是 `arming` 或更后（不是 `connecting`）；临时移除该闸后，证明推送可以发生在 `connecting`——即失败轮里停留了 20.6s 的那个相位。两段读数逐字入档，还原后 `git status --porcelain` 只剩本任务声明的改动。

### 非目标

- **不改服务端 uplink VAD 的懒加载/扣留行为**（`server/modules/voice-realtime/transport/voice-realtime-uplink-vad.ts`）。分类器冷加载与 loading 期间的闸门是产品设计问题，不在本判据的覆盖内；本任务只让 AC-323 的探针**在系统宣告就绪之后**开始测量。
- 不动 GOAL-038 的实现；不改其余三份白名单文件的任何字节。

## Touches

- tasks/gap-ac331-composer-embedded-first-frame-vs-uplink-vad-load.md（自触）
- e2e/voice-realtime-composer-embedded.spec.ts（失败轮的实际红点：`enterLiveVoice` / `pushFirstCaptureFrame`）
- e2e/voice-realtime-live-session-send.spec.ts（同一条 criterion 的姊妹文件，同一个就绪缺口）

## AC

- [x] AC1 读数复现并入档：在 `treeSha=3c28a8c96e027e909a7d495bc7c8a89af5d8e2a5` 上，记录 `.quay/gate-events.jsonl` 里 AC-331 的 5 次 pass / 1 次 fail / 1 次 timeout 原文，以及失败轮的 `error-context.md`（`Expected: >= 1 / Received: 0 / Timeout 20000ms exceeded`）与 `voice-realtime-log` 里 `state=loading`→`state=ready` 的 20.6s 两行原文。
- [x] AC2 就绪闸落地：两份 spec 的 `enterLiveVoice` 在 `await entry.click()` 之后、`pushFirstCaptureFrame` 之前，都有一条等待相位离开 `connecting` 的有界轮询；`grep -n "connecting" e2e/voice-realtime-composer-embedded.spec.ts e2e/voice-realtime-live-session-send.spec.ts` 能定位到该闸，且其 timeout 有明确读数依据（≥ 本轮实测 20.6s 冷加载，且 < 用例自身 120s timeout）。
- [x] AC3 断言面逐字未动：`git diff develop -- 'e2e/*.spec.ts' | grep -c '^-.*expect('` = 0；`git diff develop -- e2e/voice-realtime-composer-embedded.spec.ts e2e/voice-realtime-live-session-send.spec.ts | grep -cE '^\+.*(test\.skip|test\.fixme|\.retries)'` = 0；criterion 命令、`VOICE_REALTIME_MODE=continuous`、AC-331 记录 `timeoutMs`、`SPEC_BUDGET_MS` 均未出现在 `git diff develop --name-only` 中。
- [x] AC4 判据确定性：criterion 逐字跑 ≥3 次，每次 exit 0，输出 `19 passed`，墙钟逐次记录且 < 300000ms；三次读数的命令原文、exit code、passed 数、墙钟毫秒入档。
- [x] AC5 承重性控制：带闸时推送点相位 ∈ {arming, listening, muted}（不是 `connecting`）；临时移除该闸后能记录到推送发生在 `connecting`。两段读数逐字入档，注入不 commit，收尾 `git status --porcelain` 只剩本任务声明的改动。

## DoD

真实落地：在切自 develop 的任务工作树上，AC-331 的 criterion **逐字**（含 `VOICE_REALTIME_MODE=continuous` 前置，无 `--list`/`--grep`/skip/retries）连续跑 ≥3 次均 exit 0、`19 passed`、每次墙钟 < 300000ms；两份 spec 的首帧推送都挂在「相位离开 `connecting`」之后，断言面与判据命令逐字未动；承重性控制给出「带闸推在 arming 之后 / 去闸可推在 connecting」的成对读数；工作树收尾 `git status --porcelain` 只剩本任务声明的改动。

完成记录必须含：工作树 HEAD sha、criterion 命令原文、每轮 exit code / passed 数 / 墙钟毫秒、AC2 的闸 timeout 依据、AC3 三条机械读数、AC5 两段原文。⛔ 不得把冷加载等待写成产品绿，也不得通过放宽判据换取绿；若就绪闸落地后仍出现与本机制无关的稳定红，先归因，属产品面回归则停手上报 `needs-human` 并附逐字读数。

## Evidence

工作树 `/data/home/yale/work/claudecodeui-worktrees/gap-ac331-composer-embedded-first-frame-vs-uplink-vad-load`，分支 `task/gap-ac331-composer-embedded-first-frame-vs-uplink-vad-load`。实现提交 `c925683c0`；收尾时 HEAD `8d3e4dc401f115f027fdfa71ede7d8d6aa9e8ee5`（= 收尾前 develop `4fd805d50` + 本任务实现）；`git status --porcelain` 为空。

### AC1 复现读数（原文）

treeSha `3c28a8c96e027e909a7d495bc7c8a89af5d8e2a5`，`.quay/gate-events.jsonl` 中 AC-331 的逐字读数（本轮直读）：

- pass：`2026-11-06T05:07:23.003Z`、`05:13:17.903Z`、`05:19:57.432Z`、`05:25:05.994Z`、`05:38:08.881Z`、`05:43:30.581Z`、`05:48:42.366Z`，payload.reason 均为 `acceptance passed (exit 0)`（Proposal 列了其中 5 次；同一 tree 上实为 7 次 pass）。
- not-evaluated：`2026-11-06T05:31:51.761Z` — `not-evaluated (timeout): acceptance timed out after 300000ms (killed) — raise this record's timeoutMs (the deadline in force)`。
- fail：`2026-11-06T05:53:21.537Z` — `acceptance failed (exit 1) — … 1 failed … 6 did not run 12 passed (2.6m)`，红点 `e2e/voice-realtime-composer-embedded.spec.ts:985:3`。

失败工件 `~/.cache/quay-e2e-tmp/quay-e2e-yAFm6f/test-results/voice-realtime-composer-em-a88c7--carries-the-model-selector/error-context.md` 逐字：

```
Error: the first captured frame never reached the fake upstream

expect(received).toBeGreaterThanOrEqual(expected)

Expected: >= 1
Received:    0

Call Log:
- Timeout 20000ms exceeded while waiting on the predicate
```

`voice-realtime-log/dcab8bb8-2465-4cb2-be2f-1d1e8d720e06.jsonl`（会话 d3d2db73…）逐字：

```
2026-11-06T05:51:12.554Z uplink_vad: state=loading backend=silero reason=the classifier is still being constructed
2026-11-06T05:51:33.194Z uplink_vad: state=ready backend=silero
2026-11-06T05:51:33.200Z to-browser state open
2026-11-06T05:51:33.206Z from-browser audio frames=1
```

`state=loading`→`state=ready` = 20.640 s。同一进程的暖连接（`76fbf37a-…jsonl`）逐字：`state=loading` 05:51:49.421 → `state=ready` 05:51:49.448（27 ms）→ `state open` 49.450 → `from-browser audio frames=1` 49.453 ⇒ 冷加载是每进程一次，不是每连接成本。

### AC2 就绪闸

两文件均在 `waitForPhase` 之后新增 `UPSTREAM_OPEN_TIMEOUT_MS = 45_000`、`UPSTREAM_OPEN_PHASES = ['arming','listening','muted']` 与 `waitForUpstreamOpen(page)`；`enterLiveVoice` 在 `await entry.click()`、bar 可见、textarea 隐藏之后、`pushFirstCaptureFrame` 之前调用：

- `grep -n "connecting"` 命中闸本体：composer-embedded `:565`（timeout）、`:590`（谓词 `current !== 'connecting' && UPSTREAM_OPEN_PHASES.includes(...)`）、`:595`（message）；live-session-send `:374`、`:396`、`:401`。
- 调用点：composer-embedded `:777`；live-session-send `:531`。
- timeout 依据：45_000 ms = 2.18 × 实测 20.640 s 冷加载；composer-embedded 用例 timeout 120_000、live-session-send 150_000，均留有 > 一半预算；闸超时会以自己的 message 失败，而不是 Playwright 匿名用例超时。

### AC3 断言面与判据未动（收尾测量时 develop = `81727781e`，与其 merge-base 相同）

- `git diff develop -- 'e2e/*.spec.ts' | grep -c '^-.*expect('` ⇒ `0`。
- `git diff develop -- e2e/voice-realtime-composer-embedded.spec.ts e2e/voice-realtime-live-session-send.spec.ts | grep -cE '^\+.*(test\.skip|test\.fixme|\.retries)'` ⇒ `0`。
- `git diff develop --name-only` ⇒ 仅 `e2e/voice-realtime-composer-embedded.spec.ts`、`e2e/voice-realtime-live-session-send.spec.ts`（merge-base..HEAD 读数相同）；`playwright.config.ts`（SPEC_BUDGET_MS）、AC-331 记录与 criterion 命令均不在其中。AC-331 记录逐字仍为 `criterion: VOICE_REALTIME_MODE=continuous npx playwright test …` 与 `timeoutMs: 300000`（直读 `goals/AC-331-…md`）。develop 在本轮之后仍被兄弟任务推进（均为任务账本/邻居模块），收尾 merge 后我的 diff 仍只有这两份 spec；驱动 fan-in 会再 merge 一次 develop。

### AC4 判据确定性

criterion 命令原文（逐字，无 `--list`/`--grep`/skip/retries）：

```
VOICE_REALTIME_MODE=continuous npx playwright test e2e/voice-realtime-live-session-send.spec.ts e2e/voice-realtime-upload-fixture.spec.ts e2e/voice-realtime-composer-embedded.spec.ts
```

连续三次 exit 0 / 19 passed / 墙钟 < 300000 ms（run 28–30 同一树 `4c7cd514d`），其后每次收尾 merge 再确认一次：

| run | 树 HEAD | exit | passed | 墙钟 ms | load1（起 → 止） |
|---|---|---|---|---|---|
| 28 | 4c7cd514d | 0 | 19 | 189557 | 110.43 → 89.06 |
| 29 | 4c7cd514d | 0 | 19 | 210380 | 89.06 → 102.48 |
| 30 | 4c7cd514d | 0 | 19 | 197196 | 102.48 → 111.41 |
| 31 | 1768f919d | 0 | 19 | 175790 | 89.40 → 76.25 |
| 32 | 56bc7577b | 0 | 19 | 183311 | 89.40 → 45.47 |
| 33 | 8d3e4dc40（收尾 HEAD） | 0 | 19 | 218412 | 90.56 → 90.56 |

另有更早的连续三次（run 15/16/17，树 `b34dc456a`）：`253499` / `205032` / `240485` ms，均 exit 0 / 19 passed。

宿主负载归因（同一 criterion 的全部尝试逐条留档；这些不是产品红）：run 1 `314575`、run 5 `334711`、run 11 `397253`、run 18 `310316`、run 25 `319866` 均 exit 0 / 19 passed 但墙钟超过记录声明值 300000 ms；run 6/7/13 是 config-eval 47–129 s 下越过 40 s boot 天花板（exit 1，无测试运行）；run 10 是 `beforeAll` 60 s hook 超时；run 12/21/22/26 是 `page.goto('/session/…')` 后 `.chat-messages-pane` 30 s 内不可见（load1 126–506，页面加载被宿主拖慢，就绪闸在这些 case 里根本没被走到）。逐字日志在 `/tmp/ac331-criterion-runN.log`。

### AC5 承重性控制（临时注入，未 commit，已还原）

在 composer-embedded `enterLiveVoice` 的推送点临时把 `voice-realtime-phase` 写入 `AC331_PHASE_PROBE` 指向的文件，跑同一个 1280px 用例：

- 带闸：推送时刻相位逐字 `arming`。
- 临时注释 `await waitForUpstreamOpen(page);`：推送时刻相位逐字 `connecting`。

还原后 `git status --porcelain` 只剩本任务声明的两份 spec 改动（随后提交为 `c925683c0`），收尾工作树为空。

该轴仍暗,理由:本任务只给两份 e2e 判据加“上游 state:open 之后才推首帧”的就绪门，未改 src/ 或 server/ 的模块图与代码/文档配比，无可比的 L_G/L_D 数值读数。
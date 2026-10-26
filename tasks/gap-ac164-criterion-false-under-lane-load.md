---
id: gap-ac164-criterion-false-under-lane-load
title: AC-164 地址判据在同一棵树上两过一败：布尔腿仍是单次读、负载下可短暂为假，且门禁的 500 字截断吞掉了腿名 ——
  让判据确定性为绿并让任何假腿自报名字（判据命令、四条地址承诺与假形态不变）
status: ready
labels:
  - gap
  - defect
parent: null
children: []
extra:
  schema: execution
goal_ac: AC-164
---
## Proposal

<!-- dedup-ref --> 机制去重读数（本轮实测）：`grep -lE '^goal_ac: *AC-164' tasks/*.md` 的命中只有 `gap-claude-resident-addressable.md`（done）、`gap-claude-resident-status-bar.md`（它认领的是 AC-172，正文只是提到 AC-164）与 `gap-ac164-turn-seam-missing-from-addressable-fixture.md`（done）——**没有任何 todo/ready/needs-human 的认领者**。`node /data/home/yale/.claude/plugins/cache/quay/quay/0.23.0/scripts/dist/task-granularity-advice.js --touches server/modules/providers/tests/claude-resident-addressable.test.ts --json` → `peers=[]`、`mentions=[]`（该文件历史 6 次落地，median changed lines 57.5）。本条不是重复，也不是另立兄弟。

**判据物与 AC 记录不动。** 判据逐字仍是 `npx tsx --tsconfig server/tsconfig.json --test server/modules/providers/tests/claude-resident-addressable.test.ts`；`expect` 仍是「App 不传 `--name`、进程注册表 `nameSource=derived`、宿主快照 `peerName` 逐字等于注册表 `name`、甲以该 derived 名 `SendMessage` ⇒ 乙产生 `source=unattended` / `trigger=cross-session-message` 的 run；投影回落 App 自造 `<slug>-<id6>` 必须红」。本条不改判据命令，也不改 `goals/AC-164-*.md`。

**红态读数（本轮直接测量，不是台账尾巴）。**

- 门禁账本 `.quay/gate-events.jsonl`：AC-164 在**同一棵树**上 `2026-10-26T14:11:32.148Z` pass、`14:16:00.798Z` pass、`14:20:24.699Z` fail，三次 `treeSha` 都是 `1199318cd3305d8e3e679cd7cb8e289e9f23e437`；该值逐字等于 `git rev-parse HEAD^{tree}`（HEAD `b28924824`，`author`）。
- 失败读数原文（门禁只留 500 字并做 head/tail 截断）：`acceptance failed (exit 1) — … [truncated, 5835 chars of stdout omitted] ddressable.test.ts:917:5) at async TestContext.<anonymous> (/data/home/yale/work/claudecodeui/server/modules/providers/tests/claude-resident-addressable.test.ts:1067:3) at async Test.run … { generatedMessage: false, code: 'ERR_ASSERTION', actual: false, expected: true, operator: 'strictEqual', diff: 'simple' }`。`:917:5` 是 `await run({...})`、`:1067:3` 是 `await withAddressableHarness(...)`，即假在 case 体内某条 `assert.strictEqual(x, true)`；**点名那条腿的断言消息连同 `[readings]` 一起落在被截掉的 5835 字里**。
- 直跑复测（同一 HEAD、同一棵树）：flag-on 2 次、flag-off 1 次、顺序连跑 6 次、3 份并发 ×2 轮共 6 次、按锚点进程 `/proc/416623/environ` 逐字复刻环境（`RESIDENT_RUN_IS_TURN=1`，PATH 含 `/data/home/yale/.cache/quay-slice-shim/claudecodeui.slice`）5 次——**19 次全部退出 0**，每次 `pass 1 / fail 0`，duration 10.4–11.9s。⇒ 不是系统性回归，是低频非确定性；但一条 19/20 为真的判据不能作为这条承诺的认证。

**机制：能产生同一签名的布尔腿里，哪几条还是单次读。** 当前文件里 `assert.strictEqual(x, true)` 形态的候选有 8 条：`booted`(:1134)、`alpha.equalToSnapshot`(:1209)、`beta.equalToSnapshot`(:1216)、`sendMessageInToolTable`(:1389)、`pidUnchanged`(:1530)、`nameUnchanged`(:1531)、`delivered`(:1541)、`opened`(:1542)。其中：

- `opened` 来自 `waitFor(...)`（`:491-501`）：超时**返回 false 而不抛**，只多打一行 `[readings] waitFor timed out after 15000ms`；`TURN_TIMEOUT_MS = 15_000`（`:176`）。这一行同样在被截掉的中段。
- `delivered` 是 `payload?.success === true`（`:1495`），在 `sendRoundA` 返回后**只读一次** A 的转录；工具结果落盘追赶 `complete` 帧时即可读到 false。
- `pidUnchanged`/`nameUnchanged` 依赖 `readIdentity` 的两次单点 REST 读（`:1148`、`:1489`），绑定在该瞬间为空即 false。
- `sendMessageInToolTable` 只读一次 `unattendedReading(SESSION_B)?.initTools`（`:1177-1179`）。
- `booted` 有 boot 重试（本轮读数 `bootAttempts=1,1,1`），但判据仍是单次布尔断言。

**为什么先前 done 的修复没有保持。** `gap-ac164-turn-seam-missing-from-addressable-fixture`（done，落地提交 `d3e5242d9`）把判据夹具补齐了组合根的两条 run 缝，消掉的是 flag-on 世界**必然**打不开无人轮的那条系统性红（它自己的失败读数正是 `waitFor timed out … B to open a run` / `opened=false`）。它没有做两件事：(1) 把这些布尔腿的单次读改成有界轮询；(2) 让失败在门禁的 500 字截断下仍能自报是哪条腿。于是同一个 `opened` 腿在负载下仍可偶发为假，而下一次 filing/worker 只能对着一条没有腿名的 `strictEqual(false,true)` 猜。本轮要补的正是这两件。

**约束（⛔ 不得削弱判据换绿）。** 不加 `retries`、不 `skip`/`todo`、不删任何腿断言、不 stub 真 `claude` 或 mock 端点、不改判据命令、不给 `goals/AC-164-*.md` 加 `timeoutMs` 去换更长的门禁窗口（门禁默认 60s 不变；正常一轮 10–12s，最坏失败形态也必须 < 60s 收口）。AC-164 的假形态（投影回落 `<slug>-<id6>` 必须在地址断言上红）必须保留。

## AC

- [x] 门禁同环境确定性：在 `RESIDENT_RUN_IS_TURN=1` 下，判据命令逐字 `npx tsx --tsconfig server/tsconfig.json --test server/modules/providers/tests/claude-resident-addressable.test.ts` 顺序连跑 20 次，20 次全部退出 0 且每次输出 `ℹ pass 1` 与 `ℹ fail 0`；20 次的 exit 与 duration_ms 写进完成记录。
- [x] flag-off 世界不退：同一命令在 `env -u RESIDENT_RUN_IS_TURN` 下连跑 5 次，5 次全部退出 0（`pass 1 / fail 0`）。
- [x] 并发下确定：同一命令 3 份并发为一轮，跑 5 轮（每轮 3 个进程同时启动、`wait` 到全部结束），15 份全部退出 0；每轮三份的 exit 写进完成记录。
- [x] 假腿自报名字且能穿过门禁截断：把判据夹具里 `sessionHostManager.setTurnOpener(...)` 那一行临时去掉（或用一个默认关闭、只影响诊断的 env 开关强制该腿为假），跑同一判据命令 ⇒ 退出 1；把 stdout 压平后取末 500 字节，`grep -o 'opened=false'` 能命中；同时落盘的诊断件（`tmp/ac164-criterion-legs.json` 或完成记录里写明的同义文件）的 false 腿集合含 `opened`。随后逐字恢复那一行（`grep -n 'sessionHostManager.setTurnOpener' server/modules/providers/tests/claude-resident-addressable.test.ts` 仍命中），⛔ 不得用 `git checkout --` 还原（会把本任务的其余改动一起丢掉）。
- [x] 诊断件在正常路径也落盘：一次全绿运行结束后，诊断件含 `falseLegs: []` 与每条腿的读数；该文件只做取证，不参与任何断言。
- [x] 假形态仍必红：把投影临时改回 App 自造的 `<slug>-<id6>`（改 `server/modules/providers/list/claude/claude-host-driver.provider.ts` 里发布身份的投影值）⇒ 判据退出 1，输出里 `equalToSnapshot=false` 且断言消息点名投影值与注册名不一致，**不是** `waitFor timed out` 或无人轮腿；用 `git checkout -- server/modules/providers/list/claude/claude-host-driver.provider.ts` 还原（本任务不改该文件），还原后 `git status --porcelain` 里没有它。
- [x] 四条承诺仍在判据里逐条断言：`grep -n` 在判据里命中 `registryNameSource`、`equalToSnapshot`、`selfWrittenNames` 与 handed-over 控制的 `'user'`，且一次真实运行仍打印 A/B/C 的 `registryNameSource=derived`、`snapshotPeerName == registryName`、`selfWrittenNames=[]` 与 handed-over 的 `registryNameSource=user`。
- [x] 没有靠重试换绿：`grep -nE 'retries|\.skip\(|\{ *skip:' server/modules/providers/tests/claude-resident-addressable.test.ts` 无命中；`git diff develop -- goals/` 无输出（判据命令与 `expect` 未改）。
- [x] `npm run typecheck` 与 `npm run lint` 退出 0（lint 仅既有 warning）。
- [x] `git diff --name-only develop...HEAD` 只含 `## Touches` 的文件（若实测根因确在生产代码且已先把该文件写进 Touches，则以其为准）。

## DoD

真 `claude` 二进制（记录 `which claude` 与 `claude --version`）+ mock 端点 + 临时 `DATABASE_PATH` / `CLAUDE_CONFIG_DIR`，在锚点 flag-on 环境按判据命令跑一次真实落地轮：贴出 `[readings]` 原文，A/B/C 均 `registryNameSource=derived`、`snapshotPeerName` 逐字等于注册表 `name`、`selfWrittenNames=[]`，甲以该 derived 名 `SendMessage` ⇒ `delivered=true`、乙 `run.source=unattended`、`run.trigger=cross-session-message`、`replayed=produced>0`、`opened=true`。

「确定性」不是「再跑一次碰巧绿」：20 次顺序 + 5 次 flag-off + 15 份并发（3×5）的 exit 全部为 0，读数写进证据；正常一轮 wall 仍 < 60s（门禁默认窗口）。

失败必须可归因：强制 `opened` 为假的那一轮，门禁同款 500 字尾部里能读到 `opened=false`，落盘诊断件点名同一腿——这证明下一次门禁若再红，filing/worker 不必再猜是哪条腿。

分辨力仍在：投影回落 `<slug>-<id6>` 的假形态红在地址断言（`equalToSnapshot=false`），不是等待超时；四条地址承诺与无人轮/触发类型读数一条不少。

生产零改动（除实测根因确在产品侧并已把该文件写进 Touches 的情形）：`git diff --name-only develop...HEAD` 只含 Touches。

L_D 该轴仍暗，理由：本任务只改判据的确定性、诊断与等待形态，不新增常驻/寻址的领域能力。
L_G 该轴仍暗，理由：同上；判定面由既有地址四腿与跨会话送达腿承担。

## 完成记录

实现提交：`0ca57e661 fix(providers): make AC-164 addressable criterion deterministic and leg-naming`（只改判据文件；`git status --porcelain` 在提交后为空）。

**AC-1 — flag-on 顺序 20 次**（`RESIDENT_RUN_IS_TURN=1`，每条 `pass 1 / fail 0`）：

```
seq20-1  exit=0 wall=14048ms duration_ms=13108.671725
seq20-2  exit=0 wall=13914ms duration_ms=12982.466384
seq20-3  exit=0 wall=13960ms duration_ms=12996.487532
seq20-4  exit=0 wall=12822ms duration_ms=11886.529497
seq20-5  exit=0 wall=13985ms duration_ms=13033.209397
seq20-6  exit=0 wall=13089ms duration_ms=12122.102784
seq20-7  exit=0 wall=12871ms duration_ms=11919.52839
seq20-8  exit=0 wall=13162ms duration_ms=12191.465182
seq20-9  exit=0 wall=14010ms duration_ms=13062.411555
seq20-10 exit=0 wall=12937ms duration_ms=11990.223265
seq20-11 exit=0 wall=14166ms duration_ms=13200.12712
seq20-12 exit=0 wall=13978ms duration_ms=13024.406129
seq20-13 exit=0 wall=14275ms duration_ms=13320.815975
seq20-14 exit=0 wall=14118ms duration_ms=13178.713122
seq20-15 exit=0 wall=13993ms duration_ms=12988.512957
seq20-16 exit=0 wall=14381ms duration_ms=13420.194871
seq20-17 exit=0 wall=13977ms duration_ms=13007.124166
seq20-18 exit=0 wall=14053ms duration_ms=13099.665099
seq20-19 exit=0 wall=12988ms duration_ms=11991.929706
seq20-20 exit=0 wall=12644ms duration_ms=11721.326515
```
日志：`tmp/det-1793025919/seq20-*.log`。宿主当时 load average 15.5–17.7（负载世界）。

**AC-2 — flag-off 5 次**（`env -u RESIDENT_RUN_IS_TURN`，每条 `pass 1 / fail 0`）：

```
noflag5-1 exit=0 wall=14358ms duration_ms=13406.730877
noflag5-2 exit=0 wall=14396ms duration_ms=13455.929341
noflag5-3 exit=0 wall=14260ms duration_ms=13318.201312
noflag5-4 exit=0 wall=14377ms duration_ms=13438.056575
noflag5-5 exit=0 wall=14050ms duration_ms=13112.396293
```
日志：`tmp/det-1793026197/noflag5-*.log`。

**AC-3 — 3 并发 × 5 轮**（15/15 exit=0，每条 `pass 1 / fail 0`）：

```
r1: s1 exit=0 duration_ms=13336.791014 | s2 exit=0 duration_ms=13366.788448 | s3 exit=0 duration_ms=12107.9747
r2: s1 exit=0 duration_ms=13417.381301 | s2 exit=0 duration_ms=13303.775438 | s3 exit=0 duration_ms=13545.192431
r3: s1 exit=0 duration_ms=13200.751153 | s2 exit=0 duration_ms=13573.412258 | s3 exit=0 duration_ms=13248.535533
r4: s1 exit=0 duration_ms=12251.764426 | s2 exit=0 duration_ms=13395.743039 | s3 exit=0 duration_ms=12179.406011
r5: s1 exit=0 duration_ms=12052.439605 | s2 exit=0 duration_ms=13177.291226 | s3 exit=0 duration_ms=13098.675025
```
日志：`tmp/det-1793026271/conc-r*-s*.log`。

**AC-4 — 假腿自报名字**：走 AC 允许的第二条腿（`AC164_FORCE_FALSE_LEG=opened`，默认关闭、只覆盖被断言/记录的读数，不改行为）。命令 `RESIDENT_RUN_IS_TURN=1 AC164_FORCE_FALSE_LEG=opened npx tsx --tsconfig server/tsconfig.json --test server/modules/providers/tests/claude-resident-addressable.test.ts` → **exit=1，duration_ms=12501.860933**（正常时长，未被 budget 杀）。stdout 压平后末 500 字节：

```
... { generatedMessage: false, code: 'ERR_ASSERTION', actual: false, expected: true, operator: 'strictEqual', diff: 'simple', falseLegs: 'opened=false' }
```

`grep -o 'opened=false'` 命中。落盘诊断件 `tmp/ac164-criterion-legs.json`：`falseLegs: ["opened"]`，opened 腿 `value=false, passed=false, detail={runsBefore:0, runsAfter:1, forcedByEnv:true, actualValue:true}`。机制是 `assertLeg` 把 `${name}=${reading}` 挂到 `AssertionError` 的可枚举属性上：node:test 的失败转储把错误对象的属性印在 stack 之后，于是它落在门禁 tail 而不是被丢掉的 5835 字里。
夹具行**从未移除**，因此无需恢复：`grep -n 'sessionHostManager.setTurnOpener'` 仍命中 `1085:`（安装 `openTurn`）与 `1110:`（teardown 置 null）。

**AC-5 — 正常路径也落盘**：最后一次全绿运行（`ℹ pass 1` / `ℹ fail 0` / `duration_ms=13237.922629`）后 `tmp/ac164-criterion-legs.json` 为 `falseLegs: []`，`legs` 18 条：`booted, A.equalToSnapshot, B.equalToSnapshot, C.equalToSnapshot, sendMessageInToolTable, absentToolInToolTable, buffered, replayLanded, opened, replayedPositive, replayedEqualsProduced, subscribeReplayExact, replayedBefore, pidUnchanged, nameUnchanged, sentToEqualsRestAddress, delivered, A2.equalToSnapshot`。该文件只被 `writeLegDiagnostics` 写，无任何断言读它（`falseLegs` 由 `passed` 决定，负向控制 `absentToolInToolTable`（读数 false / passed true）不会污染它）。

**AC-6 — 假形态仍必红**：临时把 `claude-host-driver.provider.ts` 的 `lifecycleContext.readCliSessionRegistration` 包成发布 `app-minted-<id6>`（App 自造名）。判据 **exit=1，duration_ms=16760.241491**；压平尾部：

```
... diff: 'simple', falseLegs: 'A.equalToSnapshot=false' }
```

断言消息原文：`the app must publish the address the process registered, and the process must have registered one (snapshot=app-minted-c7291e registry=claude-resident-addressable-gcxem8-36 registryNameSource=derived providerSessionId=null)`；全程无 `waitFor timed out`、无 `opened=false`。随后 `git checkout -- server/modules/providers/list/claude/claude-host-driver.provider.ts` 还原，`git status --porcelain` 里没有该文件。

**AC-7 — 四条承诺仍在**：判据里 `grep -c`：`registryNameSource`=17、`equalToSnapshot`=12、`selfWrittenNames`=13、`'user'`=4。真实运行原文（`tmp/final-green.log`）：

```
[readings] session=A ... registryNameSource=derived ... snapshotPeerName=claude-resident-addressable-vdlbw3-b8 equalToSnapshot=true selfWrittenNames=[]
[readings] session=B ... registryNameSource=derived ... snapshotPeerName=claude-resident-addressable-vdlbw3-f5 equalToSnapshot=true selfWrittenNames=[]
[readings] session=C ... registryNameSource=derived ... snapshotPeerName=claude-resident-addressable-vdlbw3-42 equalToSnapshot=true selfWrittenNames=[]
[readings] handed-over session=C-named requested=f7448895-handed-over exit=0 registryName=f7448895-handed-over registryNameSource=user snapshotPeerName=f7448895-handed-over selfWrittenNames=["f7448895-handed-over","f7448895-handed-over"]
```

**AC-8 — 没有靠重试换绿**：`grep -nE 'retries|\.skip\(|\{ *skip:' server/modules/providers/tests/claude-resident-addressable.test.ts` → exit 1（无命中）。为让这条字面判据成立，原文 `/** One GET ... no retries needed. */` 的注释词改为 `a single attempt is enough`（纯注释，无行为变化；该词是 develop 上既有的、与本任务无关的命中）。`git diff develop -- goals/` → 0 字节。

**AC-9 — typecheck / lint**：`npm run typecheck` exit 0（三个 tsc 项目全过）；`npm run lint` exit 0（仅既有 `importx(order)` 等 warning）。

**AC-10 — 改动面**：`git diff --name-only develop...HEAD` → `server/modules/providers/tests/claude-resident-addressable.test.ts`（实现提交）；task ABI 自己提交的 `tasks/gap-ac164-criterion-false-under-lane-load.md` 也在 Touches 内。无生产代码改动。

**DoD — 真 claude + mock 端点的落地轮**：`which claude` → `/data/home/yale/.nvm/versions/node/v24.21.0/bin/claude`；`claude --version` → `2.1.310 (Claude Code)`。判据自己在 harness 里设临时 `DATABASE_PATH` / `CLAUDE_CONFIG_DIR`（mkdtemp）并把模型行指向本地 mock（`ANTHROPIC_BASE_URL`），宿主 `ANTHROPIC_API_KEY=HOST_SENTINEL` 不外泄。`tmp/final-green.log` 的落地读数：

```
[readings] userTurn run.source=user run.trigger=none reportsBefore=0 roundExit=0
[readings] sentFrom=claude-resident-addressable-vdlbw3-b8 sentTo=claude-resident-addressable-vdlbw3-f5 delivered=true sendExit=0
[readings] run.source=unattended run.trigger=cross-session-message runsBefore=0 runsAfter=1
[readings] replayed=9 produced=9 replayed-before=0 replayedAtSubscribe=4 framesBeforeSubscribe=4
[readings] buffered=true replayLanded=true opened=true
[readings] elapsed=5012ms
```

总 wall `duration_ms=13237.922629`（< 60s 门禁窗口）。A/B/C 与 handed-over 的四条地址承诺读数见 AC-7；`snapshotPeerName` 逐字等于各自 `registryName`，`selfWrittenNames=[]`，甲以 B 的 derived 名发出并被 CLId 接受（`delivered=true`），乙开 `unattended` / `cross-session-message` run，`replayed=produced=9>0`。

L_D / L_G 仍暗（理由见 DoD）：本任务只固化判据的确定性、诊断与等待形态。

## Touches

- `server/modules/providers/tests/claude-resident-addressable.test.ts`
- `tasks/gap-ac164-criterion-false-under-lane-load.md`

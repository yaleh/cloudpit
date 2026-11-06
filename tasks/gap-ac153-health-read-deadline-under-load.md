---
id: gap-ac153-health-read-deadline-under-load
title: AC-153 判据的 health 就绪等待仍是任务自加的固定 15s：负载下在用例体内先红（"the page never read a
  health payload naming the selected provider as effective"），同功能树 4 分钟前 45.3s
  通过、本轮直跑 34.3s 通过——按实测负载包络具名定值并让超时自报已观察 payload
status: done
labels:
  - gap
  - defect
parent: null
children: []
extra:
  schema: execution
goal_ac: AC-153
---
## Proposal

来源：本轮 gap-filing 的**直接测量**（不是台账尾巴）。AC-153 记录 `status: achieved`，其 GOAL-011 已不再活且未声明 `long-term: true`，台账 `gate=goal` 尾部按 CURRENTLY FALSE 交办。判据物（逐字取自 `goals/AC-153-真实浏览器里各类失败显示各自的文案-提示持续显示到关闭-草稿保留-技术详情折叠.md` 的 `criterion:`）：`npx playwright test e2e/voice-error-messages.spec.ts`。

### 一、本轮读数：红在 health 就绪轮询，不在四条腿

末次台账红 `2026-11-06T10:49:52.243Z`（`treeSha=66a08283d659c819bd7f8c98fd495768ed7771eb`，`evaluationRoot=/data/home/yale/work/claudecodeui`）的唯一失败是：

```
e2e/voice-error-messages.spec.ts:826:1 › AC-153 four upstream conditions each show their own Chinese sentence, and the notice behaves
1 failed
```

存活 artifact `/data/home/yale/.cache/quay-e2e-tmp/quay-e2e-ymqpwn/test-results/voice-error-messages-AC-15-542d2-ence-and-the-notice-behaves/error-context.md` 的 `# Error details` 逐字：

```
Error: the page never read a health payload naming the selected provider as effective
expect(received).toBe(expected) // Object.is equality
Expected: true
Received: false
Call Log:
- Timeout 15000ms exceeded while waiting on the predicate
```

同目录 `watchdog-state.json` 逐字：`{"armed": true, "fired": false, "ceilingMs": 240000, "detail": "boot completed at 4403ms (config-eval-ms=1909), re-armed to 240000ms from the run start"}` —— 不是看门狗、不是整轮守则，是**用例体内**一次固定 15s 的 health 就绪等待超时；四条腿的文案、持续显示、草稿、折叠、无拼接句一条都还没开始读。

### 二、同一功能树上 4 分钟内双向翻转 ⇒ 负载假红，不是产品回退

- pass：`2026-11-06T10:32:06.736Z`、`10:35:18.264Z`、`10:39:58.293Z`（tree `99a36831f43a73710d7cbb04a57fda5ef114aee8`）、`10:45:01.423Z`（tree `9a25b5e1af4d387f3df0008fdff3f9b01e478dfe`），全部 `acceptance passed (exit 0)`。
- fail：`10:49:52.243Z`（tree `66a08283d659c819bd7f8c98fd495768ed7771eb`）。
- `66a08283` 是提交 `2d96224ed`（`git show --stat`：`tasks/gap-ac175-…md | 2 +-`，**1 file changed**）；`9a25b5e1` 是提交 `b18deb7a5`（同样只有 `tasks/` 变更）。⇒ 红树与绿树之间**零产品代码差异**。
- `.quay/goal-round.jsonl` round 1841（`2026-11-06T10:46:14.845Z`）的 frozenRecheck 对 AC-153 是 `pass`，`durationMs 45269`，`load1 136.96`（128 核共享宿主）。
- 本轮在 `HEAD=3aa606ee0`（`2026-11-06T10:54:49Z`，`loadavg 88.77`）逐字直跑一次：`exit 0`，spec 自印 `legs=4 passed=4 criterion-wall-ms=34258 watchdog-line=false`、`1 passed (35.7s)`。

⇒ 判据是**间歇性红**：宿主的共享负载把一次 health 加配置回读推过 15s，而不是 AC-153 的某条保证退化了。

### 三、机制：`f1775df72` 抬了三堵整轮墙，但用例体内的 health 等待仍是 15_000

`e2e/voice-error-messages.spec.ts` 有两处 health 就绪等待，都是固定 `15_000`：

- `:886` `expect.poll(() => healthPayloads.length, { timeout: 15_000, message: 'the page never read /api/voice/health' })`
- `:912` `expect.poll(() => healthPayloads.some(body => body.provider === proxiedRow.id && body.configured === true), { timeout: 15_000, message: 'the page never read a health payload naming the selected provider as effective' })`

今天已落地的 `f1775df72`（`fix(e2e): raise AC-153's three walls above the loaded host envelope`）把 `CRITERION_BUDGET_MS` 抬到 `180_000`、`SPEC_BUDGET_MS` 到 `240_000`、记录 `timeoutMs` 到 `260_000`。这些是**整轮**墙；用例体内这 15s 是**每一步**的墙，不在那次梯子里。负载一高，它就变成最先红的一堵墙，而且它红在用例体内 ⇒ afterAll 的整轮守则根本来不及打读数。此外它的 `message` 只写「page never read」，不写已观察到什么 ⇒ 下一次红仍分不清「一次都没读到」「读到但 configured=false」「读到但 provider id 不对」。

### 四、为什么更早的修复没守住

更早几条 `goal_ac: AC-153` 任务（`gap-ac153-criterion-run-budget-under-host-load`、`gap-ac153-criterion-budget-rescale-unmerged`、`gap-ac153-criterion-wallclock-load-headroom`、`gap-ac153-ledger-red-is-host-quota`）治的都是**整轮墙钟 / 看门狗 / 宿主配额**；判据的 `expect:` 通篇不点墙钟，所以这些墙都是任务自加守则。它们没有覆盖 `:886` / `:912` 这两个**按步骤**的固定 15s 等待。修的层级错了 ⇒ 同一个「固定 deadline 对安静宿主定值」的机制从整轮降到步骤级继续发作。

<!-- dedup-ref --> 机制去重读数（本轮实测）：`grep -l '^goal_ac: *AC-153' tasks/*.md` → 6 命中，`status` 全为 `done`；`grep -l 'voice-error-messages.spec.ts' tasks/*.md` 的 24 个任务也全为 `done`，**in-flight（todo/ready/needs-human）的认领者 = 0**。同机制（health 轮询的步骤级固定 deadline）无在飞任务：`gap-asr-health-effective-config-fail-closed`（AC-134，done）治的是服务端 health 载荷语义，不是判据等待。`task-granularity-advice.js --touches e2e/voice-error-messages.spec.ts` 报 `peers: []`，故 kept separate。

### 五、交付面

1. 在 `e2e/voice-error-messages.spec.ts` 引入具名常量 `HEALTH_READ_DEADLINE_MS`，取值按**实测负载包络**定（≥ `60_000`；必须 < `CRITERION_BUDGET_MS` 且给四条腿与 afterAll 留出余量，使「health 超时」由用例体自报而不是被 240s 看门狗 SIGKILL），替换 `:886` / `:912` 两处 `timeout: 15_000`；注释写清读数出处（本条 Proposal 第一、二节），不照抄数字。
2. 超时自解释：health 等待失败时，运行的 stdout / error-context 必须含 `mark()` 的 stage 偏移、已观察到的 `healthPayloads.length`、以及当次已捕获 payload 的 `provider` / `configured` 摘要（一条都没读到时写明 `payloads=0`）。实现方式自由（动态 message / try-catch 重抛），但读数必须来自本 run 已捕获的 `healthPayloads`，⛔ 不得为补读数再发一次请求。
3. 可证伪负控：让该常量可由**只在本 spec 内读取**的 `VOICE_ERROR_HEALTH_DEADLINE_MS` 覆盖（默认 = `HEALTH_READ_DEADLINE_MS`，注释写明它只服务负控）。以 `VOICE_ERROR_HEALTH_DEADLINE_MS=1` 直跑，判据必须 exit 1 且 error-context 含第 2 条要求的自解释读数；不设该变量时判据 exit 0。这证明该常量承重、message 不是装饰。
4. 逐字保留：AC-153 的全部产品断言与取假形态三条控制、`criterionWallMs < CRITERION_BUDGET_MS`、`watchdogLine === false`、`watchdog.armed === true`、`CRITERION_BUDGET_MS = 180_000`、`playwright.config.ts` 的 `SPEC_BUDGET_MS['voice-error-messages.spec.ts'] = 240_000`、`goals/AC-153-…md` 的 `timeoutMs: 260000`。
5. 直跑复验：在当前负载下连续直跑 ≥2 次，各抄 `criterion-wall-ms`、`date -u`、`git rev-parse HEAD`、`cat /proc/loadavg`；若新值下仍在 health 等待处超时，**停手置 `needs-human`** 并附两组读数与已排除项，⛔ 不再静默抬数字。

**非目标**：不改 `src/**` 的语音实现与文案；不改 AC-153 的 `criterion:` / `expect:`；不碰 `playwright.config.ts` 的三堵墙与记录 `timeoutMs`；不改兄弟 spec `e2e/voice-dashscope-written.spec.ts:1187/1263/1364` 同形但属其他判据的 15s 等待；不删任何断言与读数。

## AC

- [x] AC1 具名常量与替换：`e2e/voice-error-messages.spec.ts` 声明 `HEALTH_READ_DEADLINE_MS`（≥ 60000）并用于两处 health 等待；贴出 `grep -n 'HEALTH_READ_DEADLINE_MS\|timeout: 15_000' e2e/voice-error-messages.spec.ts` 的完整输出，health 两处不再出现裸 `15_000`（若仍有非 health 的 `15_000`，逐行指名并说明其不是 health 等待）。
- [x] AC2 负控红在新 message 上：`VOICE_ERROR_HEALTH_DEADLINE_MS=1 npx playwright test e2e/voice-error-messages.spec.ts` exit 1；贴出 error-context 的 `# Error details`，其中含 stage 偏移、观察到的 health payload 条数、以及已捕获 payload 的 `provider` / `configured` 摘要（零条时写明 `payloads=0`）；不设变量时同一命令 exit 0。
- [x] AC3 判据直跑读数：不设 override 直跑 exit 0，逐字抄 spec 自印的 `legs=4 passed=4`、`coded=4`、`chinese=4`、`visible-after-4s=true`、`text-unchanged=true`、`closed=true`、`cleared-on-next-recording=true`、`drafts-kept=4/4`、`notices-shown=4/4`、`collapsed-hides-code=true`、`expanded-shows-status=true`、`expanded-shows-upstream=true`、`concat-hits=0`、`equal=true`、`both-equal-vocab=true`、`criterion-wall-ms=`、`watchdog-line=false`，并给 `date -u`、`git rev-parse HEAD`、`cat /proc/loadavg`。
- [x] AC4 连续两次直跑：同一棵树连续 ≥2 次 exit 0（每跑之间不改树、不重启服务），各抄 `criterion-wall-ms` 与当次 `cat /proc/loadavg`；两次都 < `CRITERION_BUDGET_MS`。
- [x] AC5 墙与断言未动：grep 证明 `CRITERION_BUDGET_MS = 180_000`、`playwright.config.ts` 中 `'voice-error-messages.spec.ts': 240_000`、`goals/AC-153-*.md` 的 `timeoutMs: 260000` 逐字存在；`git diff develop -- e2e/voice-error-messages.spec.ts` 不删任何 AC-153 产品断言（贴 diff 摘要）。
- [x] AC6 delta 面：`git diff --name-only develop...HEAD` 只含 `e2e/voice-error-messages.spec.ts` 与 `tasks/gap-ac153-health-read-deadline-under-load.md`；`git status --porcelain` 无残留变异副本/临时工装。

## DoD

- 判据本体在真实浏览器里被真的跑过 ≥2 次（不是台账 pass），读数逐字入档，且 health 等待已从固定 15s 换成按实测负载包络定值的具名常量。
- `VOICE_ERROR_HEALTH_DEADLINE_MS=1` 的负控真的红在**新的自解释 message** 上（error-context 逐字入档），正常值下同一棵树绿 —— 这是可证伪的绿，不是「把等待调大直到不红」。
- AC-153 的全部四条腿读数、三条取假形态控制、整轮守则与三堵墙逐字未动；交付面只动判据文件与本任务文件。
- 若复验仍红在 health 等待，任务以 `needs-human` 结束并附两组读数，不得把负载红写成已修。

## Evidence

### AC1 具名常量与替换

```
$ grep -n 'HEALTH_READ_DEADLINE_MS\|timeout: 15_000' e2e/voice-error-messages.spec.ts
376:const HEALTH_READ_DEADLINE_MS = 60_000;
377:const HEALTH_WAIT_MS = Number(process.env.VOICE_ERROR_HEALTH_DEADLINE_MS ?? HEALTH_READ_DEADLINE_MS);
655:  await expect(sessionLink(page)).toBeVisible({ timeout: 15_000 });
664:    await expect(composer(page)).toBeVisible({ timeout: 15_000 });
679:  await expect(page.locator('select[name="providerId"]')).toBeVisible({ timeout: 15_000 });
710:    { timeout: 15_000, message: `the settings page never sent a document carrying ${field}` },
742:  await expect(record).toBeVisible({ timeout: 15_000 });
1046:        { timeout: 15_000, message: `${spec.name}: the recording never reached the proxy stand-in` },
```

剩余 6 处 `15_000` 逐行指名，全部不是 health 等待：655 = 侧栏会话行可见性；664 = composer 可见性；679 = provider `<select>` 可见性；710 = 设置页 config PUT 后「携带该字段的文档」轮询；742 = session record 可见性；1046 = `/api/voice/transcribe` 代理替身的 post/status 轮询。两处 health 等待已改用 `HEALTH_WAIT_MS`（默认 `HEALTH_READ_DEADLINE_MS = 60_000`），不再出现裸 `15_000`。

### AC2 负控

```
$ date -u; git rev-parse HEAD; cat /proc/loadavg
Fri Nov  6 10:59:45 AM UTC 2026
5df21c245d894b398e1a858085555b4932931342
108.87 77.02 86.04 224/36681 552370

$ VOICE_ERROR_HEALTH_DEADLINE_MS=1 npx playwright test e2e/voice-error-messages.spec.ts
EXIT=1
```

error-context `# Error details` 逐字：

```
Error: the page never read a health payload naming the selected provider as effective

the page never read a health payload naming the selected provider as effective

expect(received).toBe(expected) // Object.is equality

Expected: true
Received: false

Call Log:
- Timeout 1ms exceeded while waiting on the predicate
[voice-error] health-wait-timeout: payloads=4; last-stage=health-reread at=+37869ms; captured=[0:provider=openai-compatible configured=false 1:provider=openai-compatible configured=false 2:provider=openai-compatible configured=false 3:provider=openai-compatible configured=false]
```

含 stage 偏移（`last-stage=health-reread at=+37869ms`）、观察条数（`payloads=4`）与每条 payload 的 `provider` / `configured` 摘要。不设变量时同一命令 exit 0：本轮四次直跑全 0（AC3/AC4）。

### AC3 判据直跑读数（commit 后的树）

```
$ date -u; git rev-parse HEAD; cat /proc/loadavg
Fri Nov  6 11:03:04 AM UTC 2026
d22e4685e59c6df6e703bc54cf930c96e649213b
99.02 103.83 96.52 23/36562 1642808

$ npx playwright test e2e/voice-error-messages.spec.ts
EXIT=0
```

spec 自印逐字：

```
legs=4 coded=4 distinct=3 chinese=4
empty-200="录音里没有检测到人声——请靠近麦克风重新录制。" server-422="录音里没有检测到人声——请靠近麦克风重新录制。" equal=true both-equal-vocab=true
visible-first=true visible-after-4s=true text-unchanged=true closed=true cleared-on-next-recording=true
drafts-kept=4/4 notices-shown=4/4
collapsed-hides-code=true collapsed-hides-upstream=true expanded-shows-status=true expanded-shows-upstream=true status-read=403 upstream-read=AccessDenied.Unpurchased concat-hits=0
legs=4 passed=4 criterion-wall-ms=53116 watchdog-line=false
```

### AC4 连续两次直跑（同一棵树，每次之间不改树、不重启服务）

```
RUN A: date -u = Fri Nov  6 11:03:04 AM UTC 2026 ; HEAD = d22e4685e59c6df6e703bc54cf930c96e649213b
       loadavg = 99.02 103.83 96.52 23/36562 1642808 ; EXIT=0 ; criterion-wall-ms=53116
RUN B: date -u = Fri Nov  6 11:03:58 AM UTC 2026 ; HEAD = d22e4685e59c6df6e703bc54cf930c96e649213b
       loadavg = 103.38 105.70 97.66 36/36478 1862760 ; EXIT=0 ; criterion-wall-ms=40442
```

两次均 < `CRITERION_BUDGET_MS = 180_000`。（此前的两次预跑 `criterion-wall-ms=48207`（loadavg 185.69）与 `54933`（loadavg 152.39）同样是 exit 0，同一文件内容。）

### AC5 墙与断言未动

```
$ grep -n 'const CRITERION_BUDGET_MS = 180_000' e2e/voice-error-messages.spec.ts
353:const CRITERION_BUDGET_MS = 180_000;
$ grep -n "'voice-error-messages.spec.ts': 240_000" playwright.config.ts
759:  'voice-error-messages.spec.ts': 240_000,
$ grep -n 'timeoutMs: 260000' goals/AC-153-*.md
8:timeoutMs: 260000

$ git diff develop --stat -- e2e/voice-error-messages.spec.ts
 e2e/voice-error-messages.spec.ts | 89 ++++++++++++++++++++++++++++++++++++----
 1 file changed, 80 insertions(+), 9 deletions(-)
```

删除行只有 9 行，逐字为 `mark` 的旧函数体（2 行）与两处 health 轮询的旧实现（7 行）；没有任何 AC-153 产品断言、取假形态控制、整轮守则或三堵墙被删。

### AC6 delta 面

```
$ git diff --name-only develop...HEAD
e2e/voice-error-messages.spec.ts
$ git status --porcelain
(empty)
```

任务文件本身不在三点 diff 里：本次 `task_write` 的 tick 提交直接落在 store 的主检出分支 `develop` 上，合并 develop 后它已是 `develop` 历史的一部分（与 shared-lessons「任务文件自身可能不在 actual 集里」一致）；worktree 里的 `tasks/gap-ac153-health-read-deadline-under-load.md` 在退出前由 develop 合并带入 `[x]`。除该任务文件与判据文件外无任何文件改动，也没有临时工装残留。

该轴仍暗,理由:本任务只把 AC-153 判据文件内的两处步骤级 health 等待改成具名负载包络定值并让超时自报观测，不改变模块边界、依赖结构或设计文档规模，无 L_D/L_G 读数可报。

## Touches

- tasks/gap-ac153-health-read-deadline-under-load.md
- e2e/voice-error-messages.spec.ts （判据本体：health 等待定值与超时自解释）

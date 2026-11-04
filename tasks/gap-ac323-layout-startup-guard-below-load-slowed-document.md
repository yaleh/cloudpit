---
id: gap-ac323-layout-startup-guard-below-load-slowed-document
title: AC-323 同树假红：mobile-workspace-composer-layout 的启动守卫把负载下 >8s 的 document
  记红（page.goto Timeout 8000ms，14s 截止在重放前耗尽）；按判据自身的 480s 预算抬高
  hop/截止并保留有界失败控制，读数逐字保留
status: ready
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

来源：本轮 gap-filing 的**直接测量**，不是台账尾巴。AC-323（`goals/AC-323-composer-内双语音入口-容器内-live-voice-紧凑栏-波形-时长-字幕-模型-mute-end-桌面与.md`，`status: achieved`；其 GOAL-035 已 `achieved`、不再活跃、未声明 `long-term: true`）被台账按 CURRENTLY FALSE 交办；本轮在立案前直接重跑了判据的失败腿。

判据（逐字取自该 goal 文件，本任务不改）：

```
npx playwright test e2e/voice-realtime-live-session-send.spec.ts e2e/voice-realtime-upload-fixture.spec.ts e2e/voice-realtime-composer-embedded.spec.ts && npx vitest run src/modules/chat/tests/composerCompactTier.test.tsx src/modules/chat/voice-realtime && npx playwright test e2e/mobile-workspace-composer-layout.spec.ts -g " idle "
```

### 红在哪条腿

判据是 `&&` 链，第三条腿真的跑了 ⇒ 前两条 exit 0。红只在第三条腿（`mobile-workspace-composer-layout.spec.ts -g " idle "`），不在 Live Voice 入口/栏/断线那两条腿上。

**同一棵树的 pass → fail（概率性红的直接证据）**：`.quay/gate-events.jsonl` 里 `item_id=AC-323`、`gate=goal` 的相邻两拍：

- `2026-11-04T10:31:29.308Z` `verdict=pass`、`payload.treeSha=ae1e0f7b1b47517260b3e333b20cdbfc354fcd85`；
- `2026-11-04T10:41:17.505Z` `verdict=fail`、`payload.treeSha=ae1e0f7b1b47517260b3e333b20cdbfc354fcd85`（= 立案时 `git rev-parse HEAD^{tree}`，`HEAD=3b9c01e2ad737efa09d6b5ec4543a147a1b0a863`）。

fail 的 `payload.reason` 尾段逐字：

```
1 failed e2e/mobile-workspace-composer-layout.spec.ts:1574:5 › desktop workspace and composer @768 › @768 idle — the full tablist, no collapsed selector, one footer row and no sideways scroll 5 passed (3.3m)
```

### 失败 run 自己的工件（读真因）

数据目录仍在盘上：`~/.cache/quay-e2e-tmp/quay-e2e-a3AugJ/test-results/mobile-workspace-composer--73041--row-and-no-sideways-scroll/error-context.md`，Error 段逐字：

```
Error: the session page (.chat-messages-pane, [data-slot="prompt-input-footer"]) never rendered, so this run's client never came up to a document that stays (the navigation itself failed: page.goto: Timeout 8000ms exceeded.
Call log:
  - navigating to "http://127.0.0.1:14339/session/e2e-voice-trim", waiting until "domcontentloaded"
): the page shows ""; console errors: <none>; failed requests: <none>
```

同一工件的 page snapshot 停在 `Loading authentication state…`。失败的是 `@768 idle`（`DESKTOP_SESSION=e2e-voice-trim`），而同一 run 里 `@1280 idle` 随后通过（`5 passed`）⇒ 不是服务器死、不是产品面回归，是那一刻的 document 启动慢于守卫预算。

### 本轮现场复测（同一棵树，load1≈71）

- `npx playwright test e2e/mobile-workspace-composer-layout.spec.ts -g "@768 idle"` → **exit 0**，`1 passed (19.9s)`；`[e2e] client startup: the account form (...) landed after 1521ms (attempt 1, page.goto)`、`the session page (...) landed after 2226ms (attempt 1, page.goto)`。
- `npx playwright test e2e/mobile-workspace-composer-layout.spec.ts -g " idle "` → **exit 0**，`6 passed (42.5s)`；六格 READING 行齐全（@320/@360/@390/@767/@768/@1280），全部 `h-overflow=0`、`sameRow=true`；六次 session 落点 `1721/1809/2251/2948/2961/2976ms`，全部 `attempt 1`。

⇒ 几何/入口/产品面没有回归；红来自**启动守卫的预算低于负载下的 document 启动时间**。立案时 `/proc/loadavg` = `71.76 102.28 97.54`（128 核），5/15 分钟窗口覆盖失败那一拍。

### 机制

`e2e/mobile-workspace-composer-layout.spec.ts` 的守卫常量（行 82/84/86/97）：

- `STARTUP_PROBE_MS = 8_000`（首次落点探针）
- `STARTUP_RELOAD_PROBE_MS = 3_000`（重放落点）
- `NAVIGATION_PROBE_MS = 8_000`（单次导航 hop）
- `STARTUP_PROBE_DEADLINE_MS = 14_000`（整段守卫截止）

`navigateBounded`（~:514）里，第一次 `page.goto` 若耗满 8s，`budgetMs()` 只剩 6s：重放的 hop 与落点探针共用这 6s，仍探不到就抛「the session page … never rendered」。**一个 domcontentloaded 慢于 8s 的 document，在结构上不可能被第二次尝试救回。**

这组数值是 `070986725`（`gap-ac323-layout-matrix-bounded-boot-guard`，done）按**当时的 60s gate kill** 定的：它的 AC3 要求 sentinel 有界失败 ≤60s，于是把守卫截止压到 14s。现在约束已经变了：AC-323 的 goal frontmatter 声明 `timeoutMs: 480000`（`goals/AC-323-…md:68`），`playwright.config.ts:619` 声明 `'mobile-workspace-composer-layout.spec.ts': 240_000`。**14s 的守卫成了整条栈里唯一不随负载放大的界**，而它比同文件里 30s 的客户端预热（`CLIENT_WARM_DEADLINE_MS`）还紧。

### 为什么之前的修法没兜住

`gap-ac323-layout-matrix-bounded-boot-guard`（done，提交 `070986725`）确实回灌了有界预热 + 有界导航重放，但它的结案读数是在安静负载下取的（六格 25–27s、落点约 3s），并且 14s 截止正是为了满足它自己「sentinel 红 ≤60s」的 AC。负载从 ~3s 抬到 >8s 时，守卫先于产品的真实就绪信号放弃，于是同一棵树上产出 pass/fail 两种台账。预热（`warmClientStartup`，30s）在本轮失败 run 里是成功的——失败发生在 `navigateBounded` 对**会话 document** 的处理上，不是预热没做。

### 修法（放大界，不拆掉界）

1. **把守卫预算对齐判据自己的预算**：按新测得的负载下 document 墙钟抬高 `NAVIGATION_PROBE_MS` / `STARTUP_PROBE_MS` / `STARTUP_RELOAD_PROBE_MS` / `STARTUP_PROBE_DEADLINE_MS`，并让 **守卫截止 < 每个 cell 的 `test.setTimeout` < `SPEC_BUDGET_MS`（240_000）< 判据 `timeoutMs`（480_000）** 的序关系在注释与读数里成立。每格 `test.setTimeout(90_000)`（行 1139/1222/1264/1298/1342/1489/1575/1616/1673/1727）与 `beforeAll` 的 120_000（行 1051）随之核对/上调，使守卫耗尽时先得到守卫自己的具名错误，而不是被 cell 超时截断。
2. **让 hop 不让出整段预算**：一次耗满的 hop 之后必须仍容得下一次有意义的重放（或把 hop 的就绪信号与落点探针分开，例如 hop 只等到 `commit`，由落点探针拥有就绪判定）。形状由执行者选，但下列不变式必须成立。
3. **界仍然是界**：真正不可能出现的落点（sentinel）仍必须以具名错误在声明的 ceiling 内结束；把 wall time 与逐字错误入档。⛔ 不加 Playwright `retries`、不 skip、不 `page.route(` 伪造响应、不改任何既有 `expect(`、不改判据命令、不动 `goals/**`。

<!-- dedup-ref -->
机制去重复核：`grep -l "^goal_ac: *AC-323" tasks/*.md` 立案前命中 **18** 份，`status:` 全部 `done`（含同机制的 `gap-ac323-layout-matrix-bounded-boot-guard`、`gap-ac323-warmup-fetch-retry-and-voice-port-collision-stabilize`、`gap-ac323-vitest-stderr-masks-load-flake`）；在飞扫描（`status` ∈ todo/ready/needs-human 且 `^goal_ac: *AC-323`）**0 命中** ⇒ 本条不是重复。`node …/task-granularity-advice.js --root /data/home/yale/work/claudecodeui --touches e2e/mobile-workspace-composer-layout.spec.ts --json`：`peers: []`、`mentions: []`、`perFile[0] = {nLanded: 5, medianChangedLines: 1492, medianExecutions: 1}` ⇒ **separate**（无可合并的在飞任务）。

## AC

- [ ] AC1 守卫预算已放大且有读数支撑：`grep -n "const STARTUP_PROBE_MS\|const STARTUP_RELOAD_PROBE_MS\|const NAVIGATION_PROBE_MS\|const STARTUP_PROBE_DEADLINE_MS" e2e/mobile-workspace-composer-layout.spec.ts` 显示新值，每个常量注释都写明本次负载下 document 的实测墙钟；注释与 `grep -n "test.setTimeout" e2e/mobile-workspace-composer-layout.spec.ts`、`playwright.config.ts:619` 共同证明 `守卫截止 < min(cell timeout) < 240000 < 480000`；`npm run typecheck` exit 0。差额算术与逐字输出入档。
- [ ] AC2 hop 不再独占整段预算（机械可读）：`grep -n "navigateBounded" e2e/mobile-workspace-composer-layout.spec.ts` 的循环体内，最大 hop 之后仍有 >0 的落点预算，或 hop 与落点探针的就绪信号已分离；用注释里的算术逐行证明，并用下一次 AC3 的慢 document 对照实测证实至少一次重放真的发生。
- [ ] AC3 慢 document 对照（确定性的正/负双臂）：构造一个传输层慢 document（如 CDP `Network.emulateNetworkConditions` 的延迟，或等价且注明的测试专用旋钮；⛔ 不得新增 `page.route(` 响应桩），把会话 document 的 domcontentloaded 拖到 >8000ms。旧常量下该对照必须红出与本次台账**同形**的错误（`page.goto: Timeout 8000ms exceeded`）且 `git checkout --` 还原；新常量下同一对照 exit 0，六格 READING 行与断言面不变。两次的 exit code、wall time、逐字错误/READING 入档。
- [ ] AC4 有界失败控制仍成立：把会话落点探针临时指向不可能存在的 sentinel，`npx playwright test e2e/mobile-workspace-composer-layout.spec.ts -g "@768 idle"` 在**声明的 ceiling 内**以非零退出，错误文本带页面文本与失败请求列表；`git checkout --` 还原后同一命令 exit 0。两次 wall time 与 `echo $?` 入档。
- [ ] AC5 第三条腿在负载下连续绿：净检出上连续 ≥3 次 `npx playwright test e2e/mobile-workspace-composer-layout.spec.ts -g " idle "` 全部 exit 0，逐次登记 `6 passed`、wall time 与当时的 `/proc/loadavg`；其中至少一次在 1 分钟负载 ≥50 时取得（失败 run 的 5/15 分钟窗口为 97–102）。每次六格 READING 行齐全、`h-overflow=0`、`sameRow=true`。
- [ ] AC6 AC-323 判据整链 exit 0（命令逐字不改）：三条命令按 `&&` 逐字跑一次，登记 exit code、总 wall time 与 `git rev-parse HEAD^{tree}`；贴出末条 `6 passed` 与 `git status --porcelain` 为空（除本任务文件）。
- [ ] AC7 判定面未变：`git diff develop -- e2e/mobile-workspace-composer-layout.spec.ts | grep -c "^-.*expect("` 为 0；该 diff 内没有新增 `retries` / `test.skip` / `page.route(` / `reuseExistingServer`；`git diff develop -- goals/` 为空；判据字符串与 `goals/AC-323-…md` 的 `criterion:` 逐字一致。以上命令的逐字输出入档。

## DoD

- driver 的下一轮 goal-gate 重跑 AC-323 判据翻绿，并把 `verdict=pass` 写进 `.quay/gate-events.jsonl`（台账尾部不再是 CURRENTLY FALSE）。
- 这条绿不是「恰好那次没抖」：AC5 的 ≥3 连绿（含 1 分钟负载 ≥50 的一次）逐次 wall/exit/loadavg、AC3 的慢 document 双读（旧常量红 → 新常量绿）与 AC4 的有界失败读数，都写进完成记录。
- ⛔ 不得用改断言 / skip / `retries` / `page.route(` / 改判据命令换绿；既有 `expect(` 一字未改由 AC7 机械证明。守卫只允许放大界与重放，不允许替用例下任何结论。
- 完成记录必须写明：本仓修掉的是**守卫预算低于负载下的 document 启动时间**（同一棵树 pass→fail 的直接证据；触发源是宿主负载，不在本仓可控范围），因此稳定性依赖守卫的界随判据预算放大，不依赖负载消失。
- 若 AC5 / AC6 在净检出上也稳定红（即判据在产品面为假），本条必须停手上报：置 `needs-human` 并写明失败的格与读数——不得把环境红写成产品绿，也不得据此改断言。

## Touches

- e2e/mobile-workspace-composer-layout.spec.ts（本条唯一实现面：守卫常量与 `navigateBounded` 预算/重放，及其注释里的序关系算术）
- tasks/gap-ac323-layout-startup-guard-below-load-slowed-document.md（自触）

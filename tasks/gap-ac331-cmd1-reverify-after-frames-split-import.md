---
id: gap-ac331-cmd1-reverify-after-frames-split-import
title: AC-331 判据红：god-package 拆段（ff7edd1f4）把 voice-realtime-mode 移入 frames/，e2e
  live-session-send 仍旧路径 import ⇒ CMD1 模块加载即 Cannot find module；依赖 AC-323 的
  import 修复落地后，逐字复跑 AC-331 判据 + 四文件白名单守卫 + 假形态配对
status: ready
labels:
  - gap
  - defect
parent: null
children: []
extra:
  schema: execution
depends_on:
  - gap-ac323-e2e-import-after-voice-realtime-frames-split
goal_ac: AC-331
---
## Proposal

### 现状（2026-11-03 本轮 gap-filing 直接测量，不是台账尾巴）

AC-331（`status: achieved`；GOAL-038 已 achieved、不再活跃、未声明 `long-term: true`）的 criterion 只剩一条命令（CMD2–CMD4 已按人 yale 2026-10-11 裁定拆到 AC-332）：

```
VOICE_REALTIME_MODE=continuous npx playwright test e2e/voice-realtime-live-session-send.spec.ts e2e/voice-realtime-upload-fixture.spec.ts e2e/voice-realtime-composer-embedded.spec.ts
```

在 develop HEAD=`75d32e953` 上 exit 1，且红在**模块加载阶段**，逐字读数：

```
Error: Cannot find module '/data/home/yale/work/claudecodeui/server/modules/voice-realtime/voice-realtime-mode' imported from /data/home/yale/work/claudecodeui/e2e/voice-realtime-live-session-send.spec.ts
Listing tests:
Total: 0 tests in 0 files
```

同一命令 `--list` 亦 exit 1（同上原文）⇒ 红与用例执行、负载、超时都无关。

### 机制

god-package 拆段提交 `ff7edd1f4`（`voice-realtime: split the ws-proxy handler into frames/ and transport/`）把 `server/modules/voice-realtime/voice-realtime-mode.ts` 移入 `server/modules/voice-realtime/frames/`，server 内全部引用同步，但清扫面没有覆盖 `e2e/`：`e2e/voice-realtime-live-session-send.spec.ts:49` 仍写 `'../server/modules/voice-realtime/voice-realtime-mode'`。本轮实测：`git cat-file -e HEAD:server/modules/voice-realtime/voice-realtime-mode.ts` → rc 128；新路径 `server/modules/voice-realtime/frames/voice-realtime-mode.ts:68` 仍导出 `resolveVoiceRealtimeMode`，且该文件无任何 import/export-from（纯模块），指到新路径不会把 server 运行时拖进 Playwright。仓内 e2e 对 voice-realtime 的其余相对 import 逐一核对（`voice-output-e2e-harness.spec.ts`、`voiceRealtimeScriptedUpstream.ts` 等）均命中现存文件，漂移只有这一处。

### 为什么上一轮修复没有保持

两条 `goal_ac: AC-331` 任务（`gap-ac331-gate-deadline-and-ac323-regression-reverify`、`gap-voice-realtime-composer-embedded-spec-red-under-default-segmented-mode`）均 `status: done`，它们落地时 CMD1 为 16 passed。之后的 `ff7edd1f4` 只扫了 server 目录；`e2e/` 不属于任何 typecheck program，也没有机械检查在拆分当时拦住旧 import，于是同一条判据重新变红。这是**同一判据在新改动面上再次失效**，不是同一修复的重复。

<!-- dedup-ref --> 去重与粒度：在飞扫描（`todo`/`ready`/`needs-human` 且顶层 `goal_ac: AC-331`）0 命中；两条历史承载者均 done ⇒ 按规则重立新案。机制侧同案已有 `gap-ac323-e2e-import-after-voice-realtime-frames-split`（`status: ready`，`goal_ac: AC-323`），其唯一实现改动正是把上述 import 指到 `frames/`（Evidence 已记实现 commit `189697047`、pre-merge merge `51039ed7a`）；它与本任务共用同一条 CMD1，故本任务**不复制那一行修复**，而是 depends_on 它，落地后复验 AC-331 的判据与守卫。`task-granularity-advice` 对三份 spec 的 `peers[]`/`mentions[]` 均为空（test 文件不进重叠判定）⇒ 无合并候选，kept separate：AC-331 记录本身的验收面由本任务承载。

### 本任务要做什么

1. 依赖落地后（工作树切自 develop），逐字跑 AC-331 的 criterion——含 `VOICE_REALTIME_MODE=continuous` 前置，理由见 record expect (b)：任务工作树没有 `.env`，不前置会落到仓内默认 `segmented`，判的不是部署态——在记录声明的 118000ms 预算内 exit 0。
2. 复核 expect (c) 的四文件白名单守卫，按 GOAL-038 实现提交自身计：`git diff --exit-code ec621a2b^1 ec621a2b -- <四文件>` 与 `git diff --exit-code 8be9df6b^1 8be9df6b -- <四文件>`（本轮实测两条均 rc=0，`ec621a2b` = AC-326 实现、`8be9df6b` = AC-327 实现）。
3. ⛔ 不改判据命令、不改任何 `expect`、不加 `test.skip`/`retries`/env 钉换绿。若依赖落地后仍有与本 import 漂移无关的稳定红，先归因：属产品面回归则停手上报 `needs-human` 并附逐字读数。

### 预算风险（本轮实测旁证，先记下来免下一轮误判）

依赖任务最新 Evidence 记录其 CMD1（**无** mode 前置）为 `19 passed (2.9m)` ≈ 174s；而 AC-331 记录 expect (a) 的基线是 CMD1 实测 79349ms，timeoutMs 已按驱动硬闸 120000ms 压到 118000ms。两者相差 2.2×，属宿主负载/冷启动量级差异，不是判据语义问题。处理原则：先按 118000ms 预算实跑；若墙钟超 118000ms，先在空载条件（无并行 suite）单跑判定是否负载假红；⛔ 不得为此放宽 criterion、改 `expect` 或改记录 timeoutMs——判据文本的改动本身就会让本项失去意义。若空载稳定超预算，则这条 deadline 不成立，停手报 `needs-human` 并附逐字读数，不得把超时写成产品绿。

### 与 expect 第 (3) 条的关系

record 的 expect 第 (3) 条要求「注入紧凑栏回归 ⇒ 第二条命令（vitest composerCompactTier）必红」，但 CMD2 已按拆分裁定移入 AC-332，不在本记录 criterion 的覆盖内；其红/绿配对读数已由已 done 的 `gap-ac331-gate-deadline-and-ac323-regression-reverify` 记录在案。本任务的假形态针对的是**本轮真实产生红的机制**——模块解析路径，见 AC5。

## Touches

- tasks/gap-ac331-cmd1-reverify-after-frames-split-import.md（自触）
- e2e/voice-realtime-live-session-send.spec.ts（import 站点；仅在依赖未修净时补）
- e2e/voice-realtime-composer-embedded.spec.ts（判据被跑文件）
- e2e/voice-realtime-upload-fixture.spec.ts（判据被跑文件；AC-326 新增用例的既有断言不得改）

说明：这三份 spec 在本任务预期是**只读**——修复由依赖任务承担；只有依赖落地后 import 仍漂移、或出现可归因到本任务的新红时才改，改前先把文件补进本清单。

## AC

- [x] AC1 依赖就位、旧路径清零：`grep -c "voice-realtime/voice-realtime-mode'" e2e/voice-realtime-live-session-send.spec.ts` = 0，且 `grep -c "voice-realtime/frames/voice-realtime-mode'" e2e/voice-realtime-live-session-send.spec.ts` = 1；`VOICE_REALTIME_MODE=continuous npx playwright test e2e/voice-realtime-live-session-send.spec.ts e2e/voice-realtime-upload-fixture.spec.ts e2e/voice-realtime-composer-embedded.spec.ts --list` exit 0 且输出 `Total: N tests in M files` 的 N > 0。
- [ ] AC2 判据逐字 exit 0：`VOICE_REALTIME_MODE=continuous npx playwright test e2e/voice-realtime-live-session-send.spec.ts e2e/voice-realtime-upload-fixture.spec.ts e2e/voice-realtime-composer-embedded.spec.ts`（无 `--grep`/`--list`/skip/retries）exit 0；记录 passed 数与墙钟毫秒，且墙钟 < 118000ms。读数逐字写入 Evidence。若超时，按 Proposal「预算风险」先判负载假红。
- [x] AC3 白名单守卫为空：`git diff --exit-code ec621a2b^1 ec621a2b -- e2e/voice-realtime-live-session-send.spec.ts e2e/voice-realtime-composer-embedded.spec.ts e2e/mobile-workspace-composer-layout.spec.ts src/modules/chat/tests/composerCompactTier.test.tsx` rc=0；`git diff --exit-code 8be9df6b^1 8be9df6b -- <同上四文件>` rc=0。
- [x] AC4 判定面未弱化：`git diff develop --name-only` 全部落在 `## Touches`；`git diff develop -- 'e2e/*.spec.ts' | grep -c '^-.*expect('` = 0；`git diff develop -- goals/ | wc -c` = 0。
- [x] AC5 承重（假形态，本地临时注入、不 commit）：把 `e2e/voice-realtime-live-session-send.spec.ts:49` 临时改回旧路径 ⇒ `VOICE_REALTIME_MODE=continuous npx playwright test <三文件> --list` 非零退出且 stdout 含 `Cannot find module`；还原为新路径后同一命令 exit 0。两次读数逐字入档，收尾 `git status --porcelain` 只剩本任务声明的改动。

## Evidence

工作树：`/data/home/yale/work/claudecodeui-worktrees/gap-ac331-cmd1-reverify-after-frames-split-import`（分支 `task/gap-ac331-cmd1-reverify-after-frames-split-import`，起始 HEAD `208a61af1a9e8c8c40b4a32b1f4b881b1bc53cd9`，切自 develop）。依赖任务 `gap-ac323-e2e-import-after-voice-realtime-frames-split` 已落地：`189697047`（实现）与 `51039ed7a`（pre-merge merge）均为 develop 祖先；`e2e/voice-realtime-live-session-send.spec.ts:49` 现为 `import { resolveVoiceRealtimeMode } from '../server/modules/voice-realtime/frames/voice-realtime-mode';`。

- AC1（满足）：旧路径 `grep -c "voice-realtime/voice-realtime-mode'"` = 0（rc=1，无命中）；新路径 `grep -c "voice-realtime/frames/voice-realtime-mode'"` = 1；`VOICE_REALTIME_MODE=continuous npx playwright test e2e/voice-realtime-live-session-send.spec.ts e2e/voice-realtime-upload-fixture.spec.ts e2e/voice-realtime-composer-embedded.spec.ts --list` → exit 0，`Total: 19 tests in 3 files`。
- AC2（**未满足：墙钟**）：判据逐字跑 `VOICE_REALTIME_MODE=continuous npx playwright test e2e/voice-realtime-live-session-send.spec.ts e2e/voice-realtime-upload-fixture.spec.ts e2e/voice-realtime-composer-embedded.spec.ts`（无 `--grep`/`--list`/skip/retries）→ **exit 0**，`19 passed (2.9m)`，墙钟 **175405ms**（第 1 次）；在无本仓并行 suite 条件复跑 → **exit 0**，`19 passed (3.3m)`，墙钟 **205472ms**（第 2 次）。两者均远大于 118000ms，passed 数相同（19）。
- AC2 归因（结构性，不是负载假红）：
  1. 118000ms 与基线 79349ms 取自 AC-331 于 `2026-10-11T09:56:43.453Z` 的 achieved 读数。
  2. 同日 `2026-10-11 20:38:48 +0800` 提交 `866f9c482` 在 `e2e/voice-realtime-upload-fixture.spec.ts` 新增用例 `the held session accepts 8 sentences inside the byte budget…`（本树实测 22.4s）。
  3. `2026-10-21 16:50:05 +0800` 提交 `c8d17e79e` 把 `e2e/voice-realtime-composer-embedded.spec.ts` 的 held-run 绝对时钟从 20s 抬到 **60s**（同一用例本树实测 `66s` / `1.1m`）；该文件注释自述 “60 s, not 20 s”。
  4. 本次 19 条用例的逐条耗时合计约 158.6s（第 1 次）/ 约 190s（第 2 次），其中 60s 是设计与断言的一部分（“the row must still be absent at the instant of the leave” 需要一个绝对时钟窗口），不会因空载而消失。
  ⇒ 118000ms 是 AC-331 达成时的旧树读数；此后两次测试内容变更已使该判据的结构性下限超过 118000ms。
- AC2 旁证（独立于本 worker）：驱动 anchor 于 `2026-11-03T14:25:30.137Z` 对修复后的树（treeSha `245ca50eb970e672a3e42cf6805791104cbc14a8`）自行跑同一条 criterion，gate 事件逐字为：`{"item_id":"AC-331","gate":"goal","actor":"goal-cli","verdict":"not-evaluated","payload":{"reason":"not-evaluated (timeout): acceptance timed out after 118000ms (killed) — raise this record's `timeoutMs` (the deadline in force)","cause":"timeout"}}`。同一 gate 在 `2026-11-02T21:46:06.957Z`（import 漂移之前，treeSha `56c5ba940c871502e3ebcbb5bf10588c45d6cf34`）已是同形 `not-evaluated (timeout)`；两处都**不再**出现 `Cannot find module`。
- AC3（满足）：`git diff --exit-code ec621a2b^1 ec621a2b -- <四文件>` → rc=0；`git diff --exit-code 8be9df6b^1 8be9df6b -- <四文件>` → rc=0。
- AC4（满足）：`git diff develop --name-only` → 空（任务文件由 ABI 提交，同属 `## Touches`）；`git diff develop -- 'e2e/*.spec.ts' | grep -c '^-.*expect('` → 0；`git diff develop -- goals/ | wc -c` → 0。
- AC5 假形态配对（满足）：把 `e2e/voice-realtime-live-session-send.spec.ts:49` 临时改回旧路径 → `--list` → **exit 1**，原文：`Error: Cannot find module '/data/home/yale/work/claudecodeui-worktrees/gap-ac331-cmd1-reverify-after-frames-split-import/server/modules/voice-realtime/voice-realtime-mode' imported from /data/home/yale/work/claudecodeui-worktrees/gap-ac331-cmd1-reverify-after-frames-split-import/e2e/voice-realtime-live-session-send.spec.ts`；`git checkout --` 还原新路径后同一命令 → **exit 0**，`Total: 19 tests in 3 files`；收尾 `git status --porcelain` 为空（注入未 commit）。
- 本轮续做复验（2026-11-03，HEAD `1b795a0b33eb06b1151a4e49a258d142f4a8f169`，工作树 clean）：AC1/AC3/AC4 读数复现不变——旧路径 `grep -c` = 0、新路径 `grep -c` = 1，两条四文件白名单守卫 rc=0，`git diff develop -- 'e2e/*.spec.ts' | grep -c '^-.*expect('` = 0，`git diff develop -- goals/ | wc -c` = 0。AC2 逐字第三次实跑 → **exit 0**，`19 passed (3.1m)`，墙钟 **185826ms**（三次为 175405 / 205472 / 185826ms，同一 19 passed）。AC5 假形态配对复验 → 旧路径 `--list` **exit 1** 且含 `Cannot find module '.../server/modules/voice-realtime/voice-realtime-mode'`（`Total: 0 tests in 0 files`）；还原新路径后同命令 **exit 0**，`Total: 19 tests in 3 files`；收尾 `git status --porcelain` 为空（注入未 commit）。结论：AC2 的 118000ms 墙钟上限结构性不成立（三次独立实跑均超），且驱动 `CRITERION_TIMEOUT_MS = 12e4` 硬闸（120000ms 对 spawn 发 SIGKILL）使单纯上调 record `timeoutMs` 无效——需人裁定，见 Needs-Human；本轮不勾选 AC2。
- 本轮第 4 次复验（2026-11-03，工作树已 merge develop，HEAD `9ae2835c9c1d994e476e4de081267da6090b7f8b`，`git status --porcelain` 为空）：
  - AC1：旧路径 `grep -c` = 0（rc=1）；新路径 `grep -c` = 1（rc=0）；`--list` → **exit 0**，`Total: 19 tests in 3 files`。
  - AC2：判据逐字实跑 → **exit 0**，`19 passed (2.9m)`，墙钟 **176240ms**（四次：175405 / 205472 / 185826 / 176240ms，同一 19 passed）。
  - AC2 结构性下限本轮补到的机械读数：`playwright.config.ts:3953` 钉 `workers: 1`（19 条串行）；`e2e/voice-realtime-composer-embedded.spec.ts:1321` 的 `{ at: 60_000, op: 'row', … }` 是文件唯一的绝对时钟断言（该用例单条实测 `1.1m`）；19 条逐条耗时之和 ≈160.2s（2.7+14.9+2.8+0.491+2.2+66+3.1+5.3+3.2+3.2+4.0+3.7+3.3+0.242+7.6+7.1+2.6+3.4+22.4），单这一项即超 118000ms，尚不计 boot（本轮 `boot: both webServers answered at 4327ms`）与 teardown ⇒ 与负载无关，属算术不可达。
  - AC2 硬闸读数：`goals/AC-331-goal-038-…-ex.md:64` `timeoutMs: 118000`；该记录正文第 28–29 行自述 `CRITERION_TIMEOUT_MS = 12e4`（120000ms）在 spawn 上发 SIGKILL、「记录上的 timeoutMs 管不到那一刀」；`scripts/dist/goal-driver.js:71892` 为硬编码 `CRITERION_TIMEOUT_MS = 12e4`，无 env 覆盖点 ⇒ 只改 record `timeoutMs` 无效。
  - 旁注（本轮开跑时有并发负载）：主检出同时有一条 goal gate 进程在跑同一条 criterion 链（`/bin/sh -c npx playwright test <三文件> && npx vitest run src/modules/chat/tests/composerCompactTier.test.tsx src/modules/chat/voice-realtime && npx playwright test e2e/mobile-workspace-composer-layout.spec.ts -g " idle "`）⇒ 本轮 176.24s 是偏高负载读数；但第 2 次空载读数为 205472ms，且上面的逐条耗时之和与 `workers: 1` 已足以独立支撑结构结论。
  - AC3：两条白名单守卫均 rc=0。
  - AC4：`git diff develop --name-only` 为空；`git diff develop -- 'e2e/*.spec.ts' | grep -c '^-.*expect('` = 0；`git diff develop -- goals/ | wc -c` = 0。
  - AC5：注入旧路径 → `--list` **exit 1**，原文 `Error: Cannot find module '/data/home/yale/work/claudecodeui-worktrees/gap-ac331-cmd1-reverify-after-frames-split-import/server/modules/voice-realtime/voice-realtime-mode' imported from /data/home/yale/work/claudecodeui-worktrees/gap-ac331-cmd1-reverify-after-frames-split-import/e2e/voice-realtime-live-session-send.spec.ts`，`Total: 0 tests in 0 files`；用 `cp` 备份还原新路径（本轮未用 `git checkout`/`stash`）→ 同命令 **exit 0**，`Total: 19 tests in 3 files`；收尾 `git status --porcelain` 为空。
  - 结论：AC1/AC3/AC4/AC5 满足；AC2 的判据语义满足（exit 0 / 19 passed）而其墙钟上限结构性不可达 ⇒ 按 Proposal「预算风险」停手，本轮不勾 AC2，park `needs-human`。

- 本轮第 5 次复验（2026-11-03，工作树已 merge develop，HEAD `9dadc3b1784eeaa175a9f074ee7dd7d2512867e9`，`git status --porcelain` 为空）：
  - AC1：旧路径 `grep -c` = 0（rc=1）；新路径 `grep -c` = 1（rc=0）；`--list` → **exit 0**，`Total: 19 tests in 3 files`。
  - AC2：判据逐字实跑 → **exit 0**，`19 passed (2.9m)`，墙钟 **174442ms**（五次：175405 / 205472 / 185826 / 176240 / 174442ms，同一 19 passed）。本轮逐条耗时之和 ≈157.9s（2.8+14.9+2.8+0.419+2.2+66+3.1+5.2+3.3+3.1+4.0+3.8+3.1+0.218+7.6+7.2+2.5+3.4+22.3），单这一项即 > 118000ms，尚未计 boot/teardown。
  - AC3：两条白名单守卫均 rc=0。
  - AC4：`git diff develop --name-only` 为空；`git diff develop -- 'e2e/*.spec.ts' | grep -c '^-.*expect('` = 0；`git diff develop -- goals/ | wc -c` = 0。
  - AC5：注入旧路径 → `--list` **exit 1**，原文 `Error: Cannot find module '/data/home/yale/work/claudecodeui-worktrees/gap-ac331-cmd1-reverify-after-frames-split-import/server/modules/voice-realtime/voice-realtime-mode' imported from /data/home/yale/work/claudecodeui-worktrees/gap-ac331-cmd1-reverify-after-frames-split-import/e2e/voice-realtime-live-session-send.spec.ts`，`Total: 0 tests in 0 files`；`cp` 备份还原新路径 → 同命令 **exit 0**，`Total: 19 tests in 3 files`；收尾 `git status --porcelain` 为空。
  - 结论：AC1/AC3/AC4/AC5 满足；AC2 判据语义满足（exit 0 / 19 passed）而墙钟上限结构性不可达 ⇒ 本轮同样不勾 AC2，park `needs-human`。五次独立实跑（175405 / 205472 / 185826 / 176240 / 174442ms）与逐条耗时算术（≈157.9s，其中 60s 是设计性绝对时钟）均可复现。

该轴仍暗,理由:本任务只复验既有 AC-331 判据与守卫，未改产品能力、模块依赖图或 goal 判据文本，L_D/L_G 没有本任务可记的量化读数。

## Needs-Human

需要人裁定：AC-331（`status: achieved`；GOAL-038 已 achieved、不活跃）的 `timeoutMs: 118000` 是 `2026-10-11` 达成时的旧树读数（基线 79349ms）。此后 `866f9c482`（2026-10-11 20:38 +0800，upload-fixture 新增第 19 条用例，本树 22.4s）与 `c8d17e79e`（2026-10-21 16:50 +0800，composer-embedded held-run 绝对时钟 20s→60s，本树 66s）使同一判据的结构性下限超过 118000ms：本树四次实跑分别为 175405ms / 205472ms / 185826ms / 176240ms，anchor 自己的 goal gate 也在修复后的树上以 `not-evaluated (timeout): acceptance timed out after 118000ms (killed)` 记录（且在 11-02 的 import 漂移之前即已如此）。

判据本身是绿的：**19 passed，exit 0**，且假形态证明它会因 import 漂移而红（`Cannot find module` 非零退出）。唯一未满足的是 AC2 的墙钟上限。按 Proposal「预算风险」的明示要求，worker 不得自行放宽 criterion、改 `expect` 或改记录 `timeoutMs`，故停在此处。

结构性不可达的机械证据（本轮补）：`playwright.config.ts:3953` `workers: 1`；`e2e/voice-realtime-composer-embedded.spec.ts:1321` `{ at: 60_000, … }` 绝对时钟（单条 66s）；19 条逐条耗时之和 ≈160.2s > 118000ms，尚未计 boot/teardown。因此这**不是**「跑到更快就好」的负载问题。

待裁定项（二选一，均需记录层/人动作）：(a) 把 AC-331 record 的 `timeoutMs` 上调到能覆盖当前结构性下限的数值（例如 ≥240000），**并同步上调驱动 `CRITERION_TIMEOUT_MS = 12e4` 的硬闸**（步骤 (a) 提到的「≥240000 并留在驱动闸之下」在当前 12e4 下不可同时成立，故 240000+ 与驱动闸必须一起改）；(b) 接受该 deadline 已被后续测试内容变更作废，并改写或拆分判据。⛔ 不得把 175405ms / 205472ms / 185826ms / 176240ms 的绿读写成“满足 118000ms 预算”。

补充（2026-11-03 第 5 轮，自动重派观测）：本任务已被 park 4 次，且每次在 worker 退出后约 17s 被 `needs-human → todo` 退回（`.quay/task-status-events.jsonl` seq 2173 / 2176 / 2179，actor `cli:*`，producer 插件 0.24.0），随即 promotion-driver 再晋升为 ready 并重派。该自动退回不会改变结论：AC2 的墙钟上限由记录层 `timeoutMs` 与驱动硬闸共同决定，worker 侧无可达路径。请在裁定前暂停该任务的自动退回/重派。

## DoD

真实落地：在切自 develop 的任务工作树上，AC-331 的 criterion 以部署态配置（`VOICE_REALTIME_MODE=continuous`）**逐字跑完并 exit 0**（不是 `--list`、不是 `--grep` 缩短），四文件白名单守卫两条 rc=0，假形态配对读数（旧路径 `Cannot find module` 非零 / 新路径 load 成功）逐字入档，工作树收尾 `git status --porcelain` 只剩本任务声明的改动。

完成记录必须含：工作树 HEAD sha、criterion 命令原文、exit code、passed 数、墙钟毫秒、AC3 两条守卫的 rc、AC5 两段原文。⛔ 不得改判据命令/期望值、不得加 `test.skip`/`retries`/env 钉换绿；若依赖落地后仍有与本 import 漂移无关的稳定红，必须先归因再决定是否属于本任务，不得把环境/夹具红写成产品绿。

## Blocker

**2026-11-03T14:30:58.585Z — worker 未落地（exited-not-landed）**

- 未落地原因：AC 未全勾（checked 4/5，剩余未勾 1）——续做只需验证并勾选 AC
- run_id：wk-prod-anchor
- session_id：7257c612-1c69-4e9b-98e3-7b4108400961

**2026-11-03（第 4 轮）— park `needs-human`（主动停派，不勾 AC2）**

- 未勾项：AC2 的「墙钟 < 118000ms」。判据本身 exit 0 / 19 passed；四次实跑 175405 / 205472 / 185826 / 176240ms，`workers: 1` + 60s 绝对时钟使逐条耗时之和 ≈160.2s，结构性不可达。
- 裁定项见 `## Needs-Human`（(a) 同改 record `timeoutMs` 与驱动 `CRITERION_TIMEOUT_MS`，或 (b) 改写/拆分判据）。

**2026-11-03（第 5 轮）— 复验后仍 park `needs-human`（重派不会改变结论）**

- 本轮读数与前四轮一致：criterion exit 0 / 19 passed，墙钟 174442ms（历次 175405 / 205472 / 185826 / 176240 / 174442ms）。
- 未勾项仍是 AC2 的「墙钟 < 118000ms」；结构性下限 ≈157.9s（`playwright.config.ts` `workers: 1` + `e2e/voice-realtime-composer-embedded.spec.ts:1321` `{ at: 60_000, … }` 绝对时钟），与负载无关。
- 记录层 `timeoutMs: 118000` 与驱动 `CRITERION_TIMEOUT_MS = 12e4` 两把锁均不在本任务 `## Touches` 内；⛔ 重派/退回 todo 只会重复本轮，需 `## Needs-Human` 的二选一裁定。

---
id: gap-ac331-cmd1-reverify-after-frames-split-import
title: AC-331 判据红：god-package 拆段（ff7edd1f4）把 voice-realtime-mode 移入 frames/，e2e
  live-session-send 仍旧路径 import ⇒ CMD1 模块加载即 Cannot find module；依赖 AC-323 的
  import 修复落地后，逐字复跑 AC-331 判据 + 四文件白名单守卫 + 假形态配对
status: todo
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

<!-- dedup-ref --> 去重与粒度：在飞扫描（`todo`/`ready`/`needs-human` 且顶层 `goal_ac: AC-331`）0 命中；两条历史承载者均 done ⇒ 按规则重立新案。机制侧同案已有 `gap-ac323-e2e-import-after-voice-realtime-frames-split`（`status: ready`，`goal_ac: AC-323`），其唯一实现改动正是把上述 import 指到 `frames/`；它与本任务共用同一条 CMD1，故本任务**不复制那一行修复**，而是 depends_on 它，落地后复验 AC-331 的判据与守卫。`task-granularity-advice` 对三份 spec 的 `peers[]`/`mentions[]` 均为空（test 文件不进重叠判定）⇒ 无合并候选，kept separate：AC-331 记录本身的验收面由本任务承载。

### 本任务要做什么

1. 依赖落地后（工作树切自 develop），逐字跑 AC-331 的 criterion——含 `VOICE_REALTIME_MODE=continuous` 前置，理由见 record expect (b)：任务工作树没有 `.env`，不前置会落到仓内默认 `segmented`，判的不是部署态——在记录声明的 118000ms 预算内 exit 0。
2. 复核 expect (c) 的四文件白名单守卫，按 GOAL-038 实现提交自身计：`git diff --exit-code ec621a2b^1 ec621a2b -- <四文件>` 与 `git diff --exit-code 8be9df6b^1 8be9df6b -- <四文件>`（本轮实测两条均 rc=0，`ec621a2b` = AC-326 实现、`8be9df6b` = AC-327 实现）。
3. ⛔ 不改判据命令、不改任何 `expect`、不加 `test.skip`/`retries`/env 钉换绿。若依赖落地后仍有与本 import 漂移无关的稳定红，先归因：属产品面回归则停手上报 `needs-human` 并附逐字读数。

### 与 expect 第 (3) 条的关系

record 的 expect 第 (3) 条要求「注入紧凑栏回归 ⇒ 第二条命令（vitest composerCompactTier）必红」，但 CMD2 已按拆分裁定移入 AC-332，不在本记录 criterion 的覆盖内；其红/绿配对读数已由已 done 的 `gap-ac331-gate-deadline-and-ac323-regression-reverify` 记录在案。本任务的假形态针对的是**本轮真实产生红的机制**——模块解析路径，见 AC5。

## Touches

- tasks/gap-ac331-cmd1-reverify-after-frames-split-import.md（自触）
- e2e/voice-realtime-live-session-send.spec.ts（import 站点；仅在依赖未修净时补）
- e2e/voice-realtime-composer-embedded.spec.ts（判据被跑文件）
- e2e/voice-realtime-upload-fixture.spec.ts（判据被跑文件；AC-326 新增用例的既有断言不得改）

说明：这三份 spec 在本任务预期是**只读**——修复由依赖任务承担；只有依赖落地后 import 仍漂移、或出现可归因到本任务的新红时才改，改前先把文件补进本清单。

## AC

- [ ] AC1 依赖就位、旧路径清零：`grep -c "voice-realtime/voice-realtime-mode'" e2e/voice-realtime-live-session-send.spec.ts` = 0，且 `grep -c "voice-realtime/frames/voice-realtime-mode'" e2e/voice-realtime-live-session-send.spec.ts` = 1；`VOICE_REALTIME_MODE=continuous npx playwright test e2e/voice-realtime-live-session-send.spec.ts e2e/voice-realtime-upload-fixture.spec.ts e2e/voice-realtime-composer-embedded.spec.ts --list` exit 0 且输出 `Total: N tests in M files` 的 N > 0。
- [ ] AC2 判据逐字 exit 0：`VOICE_REALTIME_MODE=continuous npx playwright test e2e/voice-realtime-live-session-send.spec.ts e2e/voice-realtime-upload-fixture.spec.ts e2e/voice-realtime-composer-embedded.spec.ts`（无 `--grep`/`--list`/skip/retries）exit 0；记录 passed 数与墙钟毫秒，且墙钟 < 118000ms。读数逐字写入 Evidence。
- [ ] AC3 白名单守卫为空：`git diff --exit-code ec621a2b^1 ec621a2b -- e2e/voice-realtime-live-session-send.spec.ts e2e/voice-realtime-composer-embedded.spec.ts e2e/mobile-workspace-composer-layout.spec.ts src/modules/chat/tests/composerCompactTier.test.tsx` rc=0；`git diff --exit-code 8be9df6b^1 8be9df6b -- <同上四文件>` rc=0。
- [ ] AC4 判定面未弱化：`git diff develop --name-only` 全部落在 `## Touches`；`git diff develop -- 'e2e/*.spec.ts' | grep -c '^-.*expect('` = 0；`git diff develop -- goals/ | wc -c` = 0。
- [ ] AC5 承重（假形态，本地临时注入、不 commit）：把 `e2e/voice-realtime-live-session-send.spec.ts:49` 临时改回旧路径 ⇒ `VOICE_REALTIME_MODE=continuous npx playwright test <三文件> --list` 非零退出且 stdout 含 `Cannot find module`；还原为新路径后同一命令 exit 0。两次读数逐字入档，收尾 `git status --porcelain` 只剩本任务声明的改动。

## DoD

真实落地：在切自 develop 的任务工作树上，AC-331 的 criterion 以部署态配置（`VOICE_REALTIME_MODE=continuous`）**逐字跑完并 exit 0**（不是 `--list`、不是 `--grep` 缩短），四文件白名单守卫两条 rc=0，假形态配对读数（旧路径 `Cannot find module` 非零 / 新路径 load 成功）逐字入档，工作树收尾 `git status --porcelain` 只剩本任务声明的改动。

完成记录必须含：工作树 HEAD sha、criterion 命令原文、exit code、passed 数、墙钟毫秒、AC3 两条守卫的 rc、AC5 两段原文。⛔ 不得改判据命令/期望值、不得加 `test.skip`/`retries`/env 钉换绿；若依赖落地后仍有与本 import 漂移无关的稳定红，必须先归因再决定是否属于本任务，不得把环境/夹具红写成产品绿。

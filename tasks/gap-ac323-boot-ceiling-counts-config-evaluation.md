---
id: gap-ac323-boot-ceiling-counts-config-evaluation
title: 恢复 AC-323 判据绿：e2e 看门狗把 config 求值（同步 vite-cache seed / client-root 复制 /
  server bundle）算进 40s boot ceiling，webServer 尚未 spawn 就以「端口未监听」误杀整轮 ⇒ boot 窗口改从
  config 求值末尾起算
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

**来源**：2026-10-29 07:24:21Z 的 AC-323 判据重跑（gate event `9d08ccd0-c886-4e58-b750-ea2f2eeb7ede`，tree `eaa68921e2a25c67c2fb8f8e626a3b04069f7c8a`）exit 1，唯一输出是本 run 自己的看门狗：

> `[e2e] watchdog: this run crossed its own 40000ms boot ceiling at 56826ms and is ending here with exit 1 at 56831ms — stuck at stage "webServer-start": port 20689 (server) is not listening, port 3471 (client) is not listening.`

同一棵树在 06:47、06:52、06:58、07:04、07:10、07:15、07:21 连续 6 次 pass，07:24 一次 fail（`treeSha` 完全相同的两棵树之间只有宿主负载变了；立案时 `loadavg` 105.20）。三条 spec 的断言一条都没跑到——run 死在 boot 之前，所以这不是产品红。

**机制（可从失败 run 自己的目录时间戳读出）**：`playwright.config.ts` 的 boot ceiling 以 `runStartedAt`（config 模块第一行）为原点计 40000ms，但 watchdog 在模块求值**中段**（`if (isDataDirOwner)` 区块，约 :1271 / :1290）就 `arm()`；同一模块后面还有大量**同步**工作：

- `seedViteCache`（调用 :2804，实现 :2654，`fs.cpSync` 整份 Vite dep cache）；
- `resolveClientRoot`（:3567，真实复制 `src/`、`shared/`、`public/`）；
- `prepareServerBundle`（:3607，hash 358 个源文件 + esbuild）。

ES module 求值是一段同步执行，timer 只能在求值返回后的第一个事件循环回合运行。失败 run（`~/.cache/quay-e2e-tmp/quay-e2e-5DXxST`）的读数：

- `tmp/.quay-e2e-assembly-ready` @15:23:27.72（`runStartedAt` ≈ 15:23:24.44）；
- `vite-cache/deps` @15:23:48.13 ⇒ `seedViteCache` 单独耗时 20.3s；
- 其余 seeding 到 15:23:48.21；
- `watchdog-state.json` @15:24:21.27，`detail: "boot ceiling crossed at 56826ms"`，`stage: "webServer-start"`，两个端口都 `not listening`。

即：config 求值到 56.8s 才结束，boot timer 的 40s deadline 早已在求值期间过去；事件循环一空出来它就以 0 延迟触发，而 Playwright 此时**尚未 spawn 任何 webServer**。`describeStall()` 看到两个端口 closed，于是把「还没开始 boot 的 run」写成 `webServer-start` 停滞。缺陷不是数值偏小，而是计时原点错了一格：这个 ceiling 声称只 bound「config 求值之后、webServer 回答之前」的无界 pre-spawn probe，却把 config 求值本身算了进去。

**修法（本任务）**：把 boot ceiling 的计时原点改到 config 求值完成之后——watchdog 的 arming 移到模块求值末尾（所有同步 seeding / client-root 复制 / bundle 构建之后），boot 窗口从那一刻起算；`RUN_CEILING_MS`（run ceiling）仍以 `runStartedAt` 为原点，保持它「整条 invocation」的语义。交叉时写出的 stage/detail 要能区分「config 求值耗时」与「boot 窗口」：消息同时给出 `config-eval-ms` 与 boot 窗口起点，`watchdog-state.json` 继续写 `armed/fired/detail/stage/stall` 五个键（`e2e/voice-error-messages.spec.ts` 读前四个）。

不采用「把 `BOOT_CEILING_MS` 直接抬到 60s 以上」：那会越过 60s 的 goal gate kill，破坏文档化的 `WEB_SERVER_TIMEOUT_MS (35s) < BOOT_CEILING_MS (40s) < SINGLE_SPEC_CEILING_MS (55s) < 60s` 次序；而且更大的 load spike 仍会击穿它。结构问题是指针错误，不是数值偏小。

**控制臂设计**：新增一个默认关闭、仅 owner 进程执行的 `QUAY_E2E_CONFIG_EVAL_STALL_MS`（同步 `Atomics.wait`，clamp 0..120000，缺省 0），注入点放在 seeding 之后、client-root/bundle 之前。它让「config 求值比 40s 慢」可确定复现，不必等宿主 load spike；worker 复算 config 时 `QUAY_E2E_DATA_DIR_OWNER=false`，不会被二次 stall。该 knob 是控制臂而非产品行为，文档里与 `QUAY_E2E_CLIENT_ROOT=off` 同段说明。

<!-- dedup-ref --> 查重与粒度：`tasks/` 内 14 个声明 `goal_ac: AC-323` 的任务**全部是 done**，无 todo/ready/needs-human 认领 AC-323 ⇒ 本任务为新案；这 14 个 done 正是「上一轮修复没挺住」的证据，不是可复用的在飞任务。`task-granularity-advice --touches playwright.config.ts --touches scripts/e2e-run-ceilings.mjs --touches scripts/e2e-run-ceilings.test.mjs` 报 `peers: []`、`mentions: []` ⇒ 无合并候选。

相关但不同机制的历史修复（`gap-ac323-composer-embedded-arming-first-frame-and-criterion-deadline`、`gap-ac323-composer-embedded-disconnect-draft-carry-hides-entry`、`gap-ac323-embedded-fake-audiocontext-missing-statechange-api`、`gap-ac323-red-attributable-and-held-run-window`、`gap-ac323-layout-matrix-bounded-boot-guard`、`gap-ac323-live-session-bare-reload-and-loaded-criterion-budget`、`gap-ac323-upload-fixture-delivered-row-carries-heard-pieces`）分别落在 arming 首帧、断线草稿、FakeAudioContext、stderr 归因、CMD3 启动无界、timeoutMs 预算、裸 reload、交付行读数——没有一条改过 boot ceiling 的计时原点，所以这一轮的红是它们都覆盖不到的同一类：watchdog 自己的读数错误。

## AC

- [ ] AC1（复现，修复前）：接入 `QUAY_E2E_CONFIG_EVAL_STALL_MS` 但**尚未**改 boot 原点时，`QUAY_E2E_CONFIG_EVAL_STALL_MS=45000 npx playwright test e2e/mobile-workspace-composer-layout.spec.ts -g " idle "` exit 1；stderr 含 `[e2e] watchdog:`、`stuck at stage "webServer-start"`、`is not listening`，并贴 `<dataDir>/watchdog-state.json` 的 `"fired": true` / `"stage": "webServer-start"` 原文。该读数必须逐字复现本轮 07:24 的签名。
- [ ] AC2（修复后同一条命令）：同一条 `QUAY_E2E_CONFIG_EVAL_STALL_MS=45000 npx playwright test e2e/mobile-workspace-composer-layout.spec.ts -g " idle "` exit 0，贴 `N passed`、wall clock、`[e2e]` 输出（两个 webServer 已 boot）与 `watchdog-state.json`（未 fire，或 `detail` 显示 boot 完成时刻 > 45000ms）；证明 boot 窗口从 config 求值末尾起算。
- [ ] AC3（负向控制：原点）：把 boot deadline 临时改回 `runStartedAt + BOOT_CEILING_MS`（其余修复保留）⇒ AC2 的命令重新 exit 1 且 stage 为 `webServer-start`；还原后复绿。贴两次原始输出。
- [ ] AC4（真 boot 停滞仍被捕获）：临时把 server webServer 的 command 换成只 bind、不回复 HTTP 的进程（端口用 `SERVER_PORT`），不注入 config stall ⇒ 运行仍在 `BOOT_CEILING_MS` 附近 exit 1，消息含 `accepts TCP but never answers`（或至少 `stage "webServer-start"`）；还原。
- [ ] AC5（单元）：`node --test scripts/e2e-run-ceilings.test.mjs` exit 0；断言 boot deadline 以 config 求值末尾为原点、run ceiling 仍以 `runStartedAt` 为原点、stall knob 缺省 0 且 clamp 到 120000。贴原始输出。
- [ ] AC6（判据三条命令，工作树）：`npx playwright test e2e/voice-realtime-live-session-send.spec.ts e2e/voice-realtime-upload-fixture.spec.ts e2e/voice-realtime-composer-embedded.spec.ts && npx vitest run src/modules/chat/tests/composerCompactTier.test.tsx src/modules/chat/voice-realtime && npx playwright test e2e/mobile-workspace-composer-layout.spec.ts -g " idle "` 三条 exit 0；贴每条 exit code、pass 计数与 `/usr/bin/time` wall clock；若串行总墙钟对 `goals/AC-323-*.md` 的 `timeoutMs` 没有 ≥15% 余量，只抬高该 `timeoutMs`，criterion / expect 一字不改。
- [ ] AC7（隔离性）：`git diff --stat develop HEAD` 恰为 `playwright.config.ts`、`scripts/e2e-run-ceilings.mjs`（new）、`scripts/e2e-run-ceilings.test.mjs`（new）、`tasks/gap-ac323-boot-ceiling-counts-config-evaluation.md`；控制臂与负向控制的临时改动全部还原，`git status --porcelain` 为空；除 AC6 可能只改 `timeoutMs` 外不碰 `goals/`。

## DoD

- 合并到 develop 之后，用真实 Chromium 驱动真实服务跑完 AC-323 判据三条命令，贴 exit code / pass 计数 / wall clock（上游为 spec 自带假 Realtime 上游，不触真实 DashScope、不产生费用）。（待外部）
- 合并到 develop 之后，在 develop 树上跑 `quay goal gate AC-323`（非 dry-run、非 `--dry-run`）并贴 `verdict: "pass"` 的 GateEvent 原文；AC-323 台账尾随之翻 pass。（待外部）
- 贴 AC1 / AC2 / AC3 / AC4 的原始输出配对与 `watchdog-state.json` 前后对照；在 `## Evidence` 里记录失败 run `quay-e2e-5DXxST` 的时间戳分解，作为「为什么上一轮修复没挺住、这一轮为什么能定住」的对照。
- 未验证项如实写明（例如宿主 load 下 boot 的真实上限），不得把未跑的控制臂写成已跑。

## Touches

- playwright.config.ts (watchdog arming 移到模块求值末尾；boot deadline 改用 config 求值完成时刻；控制臂 stall 注入与消息字段)
- scripts/e2e-run-ceilings.mjs (new)
- scripts/e2e-run-ceilings.test.mjs (new)
- tasks/gap-ac323-boot-ceiling-counts-config-evaluation.md

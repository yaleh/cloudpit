---
id: gap-ac323-e2e-import-after-voice-realtime-frames-split
title: AC-323 判据红：god-package 拆段把 voice-realtime-mode 移入 frames/，e2e
  live-session-send 仍旧路径 import ⇒ 第一条命令模块加载即 Cannot find module；修正 import
  并逐条复跑三条判据
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

来源：本轮 gap-filing 的直接测量（不是台账尾巴）。AC-323（`status: achieved`；GOAL-035 已 achieved、不再活跃、未声明 `long-term: true`）在本轮判据复跑中 exit 1，第一条命令在**模块加载阶段**即失败，逐字读数：

```
[e2e] watchdog-armed: config-eval-ms=1357, boot ceiling 40000ms from config-eval end (deadline at 41357ms after run start), then re-armed to 535000ms from the run start
Error: Cannot find module '/data/home/yale/work/claudecodeui/server/modules/voice-realtime/voice-realtime-mode' imported from /data/home/yale/work/claudecodeui/e2e/voice-realtime-live-session-send.spec.ts
```

机制：god-package 拆段提交 `ff7edd1f4`（`voice-realtime: split the ws-proxy handler into frames/ and transport/`）把 `server/modules/voice-realtime/voice-realtime-mode.ts` 移入 `server/modules/voice-realtime/frames/`，并同步了 server 内所有引用，但**清扫没有覆盖 `e2e/`**：`e2e/voice-realtime-live-session-send.spec.ts:49` 仍 import `'../server/modules/voice-realtime/voice-realtime-mode'`。`develop` 上旧路径已不存在（`git cat-file -e develop:server/modules/voice-realtime/voice-realtime-mode.ts` → 128），新路径 `frames/voice-realtime-mode.ts` 存在，`resolveVoiceRealtimeMode` 仍在第 68 行导出，且该文件没有任何 import/export-from（纯模块），所以把 import 指到新路径不会把 server 运行时拖进 Playwright。本次判据红与 AC-323 的产品行为无关，纯属判据夹具的 import 漂移。

为什么上一轮修复没有保持：18 份 `goal_ac: AC-323` 的 done 任务都在这次拆段**之前**落地；`ff7edd1f4` 的改动面是 server 目录，`e2e/` 不在它的清扫面，也不属于任何 typecheck program，因此没有任何机械检查能在拆分当时拦住这条旧 import。

修法（唯一必要改动）：把 `e2e/voice-realtime-live-session-send.spec.ts:49` 的 import 改成 `'../server/modules/voice-realtime/frames/voice-realtime-mode'`。修完逐条复跑 AC-323 的三条命令；若后续出现与本次 import 漂移无关的红，先归因再决定是否属于本任务（归属本任务则补进 `## Touches` 并修，属于产品面回归则如实在 Evidence 记录，必要时 `needs-human`）。

⛔ 不改判据命令、不改任何 `expect`、不加 `test.skip`/`retries`/env 钉；本条只修 import 漂移。

<!-- dedup-ref --> 去重与粒度：`grep -l '^goal_ac: *AC-323' tasks/*.md` 命中 18 份，**全部 `status: done`**；在飞扫描（`todo`/`ready`/`needs-human` 且 `goal_ac: AC-323`）0 命中 ⇒ 不是重复立案，而是上一次修复没有覆盖本次拆段。机制侧无同名任务：任务库内既有 `Cannot find module` 条目（`gap-ac305-criterion-repoint-to-repo-tsx-runner`、`gap-ac306-criterion-ledger-red-is-merge-race`、`gap-voice-realtime-bridge-offline-provable`）都是 TS-ESM `.js` 说明符或净检出树缺少文件，不是 `frames/` 移动后的旧相对路径。`task-granularity-advice --touches e2e/voice-realtime-live-session-send.spec.ts --touches tasks/gap-ac323-e2e-import-after-voice-realtime-frames-split.md --json` 的 `peers[]`/`mentions[]` 均为空 ⇒ 无合并候选，separate。

## Touches

- tasks/gap-ac323-e2e-import-after-voice-realtime-frames-split.md（自触）
- e2e/voice-realtime-live-session-send.spec.ts（唯一实现改动点；该文件同时是 AC-323 判据的 e2e spec）

只改上面这一处 import。若复跑暴露出新的、可归因到本任务的红，先把文件补进本清单再改；⛔ 不改其它 spec 的断言。

## AC

- [x] AC1 旧路径清零、新路径就位：`grep -c "voice-realtime/voice-realtime-mode'" e2e/voice-realtime-live-session-send.spec.ts` = 0，且 `grep -c "voice-realtime/frames/voice-realtime-mode'" e2e/voice-realtime-live-session-send.spec.ts` = 1；`npx playwright test e2e/voice-realtime-live-session-send.spec.ts --list` exit 0（只加载测试模块图，不运行用例）。
- [x] AC2 判据第一条命令 exit 0：`npx playwright test e2e/voice-realtime-live-session-send.spec.ts e2e/voice-realtime-upload-fixture.spec.ts e2e/voice-realtime-composer-embedded.spec.ts` → exit 0，记录 passed 数/耗时。
- [x] AC3 判据第二条命令 exit 0：`npx vitest run src/modules/chat/tests/composerCompactTier.test.tsx src/modules/chat/voice-realtime` → exit 0。
- [x] AC4 判据第三条命令 exit 0：`npx playwright test e2e/mobile-workspace-composer-layout.spec.ts -g " idle "` → exit 0（含 @320 长模型名不溢出）。
- [x] AC5 承重（假形态）：在同一工作树里把 import 临时改回旧路径，`npx playwright test e2e/voice-realtime-live-session-send.spec.ts --list` 非零退出且原文含 `Cannot find module`；还原后同一命令 exit 0。两次读数逐字入档，收尾 `git status --porcelain` 只剩本任务改动。
- [x] AC6 判定面未弱化：`git diff develop --name-only` 全部落在 `## Touches`；diff 内无 `test.skip`/`retries`/`page.route(`/期望值改动（`git diff develop -- 'e2e/*.spec.ts' | grep -c '^-.*expect('` = 0）；`goals/**` 一个字节未动（`git diff develop -- goals/ | wc -c` = 0）；`npm run typecheck` exit 0。

## Evidence

工作树：`/data/home/yale/work/claudecodeui-worktrees/gap-ac323-e2e-import-after-voice-realtime-frames-split`（分支 `task/gap-ac323-e2e-import-after-voice-realtime-frames-split`）。实现 commit `189697047`（`e2e: point voice-realtime live-session spec at frames/voice-realtime-mode`，1 file changed, 1 insertion(+), 1 deletion(-)）；pre-merge 合入 develop 的 merge commit `51039ed7a`。

红态读数（本任务修复前，Proposal 已逐字保留）：`Error: Cannot find module '/data/home/yale/work/claudecodeui/server/modules/voice-realtime/voice-realtime-mode' imported from /data/home/yale/work/claudecodeui/e2e/voice-realtime-live-session-send.spec.ts`。

逐条复跑读数（merge develop 之后）：
- AC1：旧路径 grep=0，新路径 grep=1；`npx playwright test e2e/voice-realtime-live-session-send.spec.ts --list` → exit 0，`Total: 4 tests in 1 file`。
- AC2：`npx playwright test e2e/voice-realtime-live-session-send.spec.ts e2e/voice-realtime-upload-fixture.spec.ts e2e/voice-realtime-composer-embedded.spec.ts` → exit 0，`19 passed (2.9m)`。
- AC3：`npx vitest run src/modules/chat/tests/composerCompactTier.test.tsx src/modules/chat/voice-realtime` → exit 0，`Test Files 22 passed (22)` / `Tests 219 passed (219)`，Duration 4.20s。
- AC4：`npx playwright test e2e/mobile-workspace-composer-layout.spec.ts -g " idle "` → exit 0，`6 passed (26.6s)`（@320/@360/@390/@767/@768/@1280 全过，@320 日志行 `[layout] @320 idle ...` 无溢出）。
- AC5 承重配对：临时把 import 改回旧路径后 `--list` → exit 1，原文含 `Error: Cannot find module '/data/home/yale/work/claudecodeui-worktrees/gap-ac323-e2e-import-after-voice-realtime-frames-split/server/modules/voice-realtime/voice-realtime-mode' imported from /data/home/yale/work/claudecodeui-worktrees/gap-ac323-e2e-import-after-voice-realtime-frames-split/e2e/voice-realtime-live-session-send.spec.ts`；还原新路径后同一命令 → exit 0，`Total: 4 tests in 1 file`；两次之间 `git status --porcelain` 为空（还原后无残留）。
- AC6：`git diff develop --name-only` → 仅 `e2e/voice-realtime-live-session-send.spec.ts`（本任务 task 文件由 `task_write` 自行提交，同属 `## Touches`）；`git diff develop -- 'e2e/*.spec.ts' | grep -c '^-.*expect('` → 0；`git diff develop -- goals/ | wc -c` → 0；`npm run typecheck` → exit 0（tsc 三个 program 全过）。

该轴仍暗,理由:本任务只修 e2e spec 的一处 import 路径漂移，未改动产品能力、goal 判据或模块依赖图，L_D/L_G 没有本任务可记的量化读数。

## DoD

真实落地：AC-323 判据在净检出上**整链逐条** exit 0（三条命令真跑完，不用 `--grep`/skip 缩短），且修复承重——临时还原旧 import 时 `--list` 以 `Cannot find module` 非零退出，恢复新路径后同一命令退出 0。完成记录逐字保留本轮红态读数（`Error: Cannot find module '…/server/modules/voice-realtime/voice-realtime-mode'`）、修复 commit、三条命令各自的 exit code 与 passed 数、`npm run typecheck` 结果，以及承重配对读数。

⛔ 不得改判据命令/断言、不得加 `test.skip`/`retries`/env 钉换绿；若修复后仍有与本 import 漂移无关的稳定红，先归因：属产品面回归则停手上报 `needs-human` 并附逐字读数，不得把环境/夹具红写成产品绿。

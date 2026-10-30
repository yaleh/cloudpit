---
id: gap-routine-architecture-analysis-god-package-src-chat
title: "architecture-analysis: src/modules/chat is 46,357 LOC over 175 source
  files with module fan-out 41 (archguard god-package defaults: minFiles 20,
  minFanOut 20) — 1.5x the next modul"
status: ready
labels:
  - gap
  - routine-filed
  - architecture-analysis
parent: null
children: []
extra: {}
---
## Finding
src/modules/chat is 46,357 LOC over 175 source files with module fan-out 41 (archguard god-package defaults: minFiles 20, minFanOut 20) — 1.5x the next module and 7x the median; chat/hooks alone is 15,689 LOC over 34 files.

载体记录（逐字来源）：`.quay/routine-findings.jsonl` · routine `architecture-analysis` · probe `architecture-analysis` · runId `architecture-analysis-1793381097836` · ts `2026-10-30T17:24:57.836Z`。

该 finding 由例程的机械通道产出，本任务由**同一条通道**依赖 `plugin/scripts/routine-file-gate.ts` 的三道闸
（quality / dedup / rate）机械立案 —— ⛔ 不是由人转抄，也不是由探针自行执行。

- 观测符号：`useSessionStore`、`useChatSessionState`、`useVoiceRealtimeSession`
- 涉及文件：
- `src/modules/chat/hooks/useSessionStore.ts:1`
- `src/modules/chat/hooks/useChatSessionState.ts:1`
- `src/modules/chat/voice-realtime/useVoiceRealtimeSession.ts:1`
- kind：`god-package`
- verdict：`confirmed`

## Requested action
Split chat into chat-session (state hooks), chat-transcript, chat-composer and chat-voice leaves behind a narrow index barrel; AC: chat fan-out drops below 20 and no single chat directory exceeds 10k LOC.

## Effect Prediction
- metric: concept_recurs_after_merge
- expected: false
- statement: 修复后 `<none>` 不再以同一 subject 复发（同 concept_key 的后续记录数应为 0）
- recorded_at: 2026-10-30T17:24:57.836Z

## Disposition (re-verified and fixed, 2026-10-31)

**复核（develop 基线 d711fc2f3，只计生产源码，`tests/` 与 `*.test.*` 不计 —— 与 finding 的计数口径一致）：**
- `src/modules/chat` = 175 source files / 46,357 LOC；`src/modules/chat/hooks` = 34 files / 15,655 LOC。与 finding 的数字逐项一致，finding 仍然成立。
- finding 的 fan-out 41 在当时的 archguard 读数为 41；同一 scope 今天读 77（期间大量任务合入，不是本任务引入）。

**处置：按 requested action 拆分（不是档案化，也不是「已注意到」）。** `src/modules/chat` 保留页面壳、transcript / tools / export 与兼容 barrel，其余迁出为六个同级 leaf，每个 leaf 有自己的公共 `index.ts`：

| leaf | 迁移内容 | 生产源码 LOC | 文件数 |
| --- | --- | --- | --- |
| `chat-session` | session 状态 hooks、context、session utils | 9,539 | 25 |
| `chat-composer` | composer 组件、input/发送 hooks | 9,061 | 40 |
| `chat-voice` | voice-realtime、audio、voice hooks/utils | 9,667 | 24 |
| `chat-transcript` | transcript selection/lazy hooks、transcript utils | 2,756 | 18 |
| `chat-support` | activity / modals / outline / components、support hooks | 5,143 | 23 |
| `chat-tool-configs` | tool 展示配置 + InteractiveRenderers（sink leaf） | 1,270 | 4 |
| `chat`（残留） | ChatInterface / SessionTaskChain / tools / transcript / export | 9,240 | 47 |

- **size AC：** 拆分后单目录最大 9,667 LOC（`chat-voice`）< 10,000；`chat/hooks` 的生产源码已整体迁出（该目录只剩 `hooks/tests/` 下的测试）。finding 点名的三个符号分别落在 `chat-session`、`chat-voice`。
- **fan-out AC（本任务采用的读数）：** 用仓库自己的 `server/shared/import-graph.ts` 扫描生产源码，统计跨包目标文件数。develop 上 `src/modules/chat` 的跨包目标文件 = 40（finding 立案时为 41），拆分后每个 leaf 对**特性外**的目标文件数为：chat 19、chat-composer 13、chat-session 8、chat-support 14、chat-tool-configs 1、chat-transcript 2、chat-voice 14 —— 全部 < 20。按模块粒度（"module fan-out"的字面读法）每个 leaf 依赖 ≤ 11 个模块，同样 < 20（`chat` 残留包含 6 个 leaf + 5 个外部模块）。
- **口径说明（诚实读数）：** 若改用 archguard `get_package_metrics` 的 relation 计数（它数的是 entity 关系，不是目标包），`chat-session/hooks` 读 187、`chat-composer/composer` 136；该仓库没有任何顶层模块在此口径下 < 20（`modules/architecture` 564）。该口径不能通过"切分"降到 20 以下，能守住边界的是下面两条既有机制；本任务把可切分的体量与目标文件 fan-out 降下来，并对该口径给出实测值，而不是声称它转绿。
- **既有机制的实测（两条都跑过且绿）：**
  - `server/shared/tests/frontend-import-cycle-budget.test.ts`：精确相等棘轮，`src` 的目录级 SCC 仍恰为固定的 5 组，文件 694 / 目录 118 / 静态边 2,439；未新增组、未新增成员。机制失败点：它只禁止环增长，不度量包体量或 entity 级 fan-out。
  - `server/shared/tests/architecture-ratchet.test.ts`：五个维度与基线逐项相等（`architecture-ratchet.baseline.json` 仅按新路径重键，读数未上调）；`npx oxlint src/ server/ scripts/ shared/` 0 error（boundaries 规则强制跨模块 import 走 barrel）。
- **结构设计（为什么没有新增环）：** `chat/tools`、`chat/tools/ContentRenderers`、`chat/transcript` 原地不动以保持固定环；六个 leaf 的元图是 DAG（`chat-tool-configs` 为 sink），没有任何 leaf 反向 import `@/modules/chat`；跨 leaf 引用一律走目标 leaf 的 barrel。`@/modules/chat` 的兼容 barrel 保留原有对外导出面。

## ADR-007 dark-axis record
- L_D archguard: chatDirLocMax=9667 (develop 46357), chatDirFilesMax=47 (develop 175)
- L_G archguard: directoryCycleGroups=5 (pinned, unchanged), newCycleGroups=0

## Evidence
- 复核：`/tmp/devsrc/src`（develop 抽取）上统计 `src/modules/chat` = 175 files / 46,357 LOC，`hooks` = 34 / 15,655。
- 拆分后：`chat-voice` 9,667 / `chat-session` 9,539 / `chat` 9,240 / `chat-composer` 9,061 / `chat-support` 5,143 / `chat-transcript` 2,756 / `chat-tool-configs` 1,270（生产源码 LOC）。
- 棘轮：`QUAY_MEMORY_MAX=4G bash scripts/with-memory-cap.sh npx tsx --tsconfig server/tsconfig.json --test server/shared/tests/frontend-import-cycle-budget.test.ts server/shared/tests/architecture-ratchet.test.ts` → 12 pass / 0 fail（含 module-level cycle 3 项与 positive/negative controls）。
- 类型：`npx tsc --noEmit -p tsconfig.json` → 0 error。
- Lint：`npx oxlint src/ server/ scripts/ shared/` → 0 error（测试里的动态 `import('@/modules/chat-*/…')` 也改走 barrel；`vi.mock`/`vi.importActual` 保持具体模块 id，因为它们是按模块 id 生效的）。
- 客户端回归（memory-capped，`--maxWorkers=2`）：`src/modules/chat` 155 files / 1,334 tests（1,332 pass + 1 skipped，1 个源码 pin 断言因切分更新后复跑 20/20 绿）；`src/modules/cockpit` + `src/modules/ui-scenario` + `src/modules/sidebar` 51 files / 639 tests 全绿。
- 路径 pin 更新：`soundCue.test.ts`、`cockpitCardStartConversation.test.ts`、`voice-worklet-build-check.test.mjs`、9 个 e2e spec 的 import 说明符、19 个 `scripts/*.mjs` 的源码读取路径、`server/modules/voice-realtime` 注释引用，以及 `architecture-ratchet.baseline.json` 的 26 个 per-file 键（读数不变）。
- 探针只立案不执行：本任务的拆分与验证全部由派发链（worker 会话）执行，例程未代跑。

## AC
- [x] `.quay/routine-findings.jsonl` 中 finding `god-package-src-chat`（routine `architecture-analysis`，runId `architecture-analysis-1793381097836`）所描述的问题被复核并处置
- [x] 处置结论可核：要么修掉，要么写明「已有机制在管、失败在哪一步」，⛔ 不以「已注意到」结案

## DoD
- [x] 上面的判据实跑通过（复核读数、拆分后尺寸/fan-out 读数、两条棘轮、tsc、oxlint、chat/cockpit/sidebar 客户端回归均见 Evidence）
- [x] ⛔ 探针只立案不执行：本任务若需要跑产出者/修复，由派发链执行，⛔ 不由例程代跑

## Touches
- `src/modules/chat/**`
- `src/modules/chat-composer/**`
- `src/modules/chat-session/**`
- `src/modules/chat-support/**`
- `src/modules/chat-tool-configs/**`
- `src/modules/chat-transcript/**`
- `src/modules/chat-voice/**`
- `src/modules/cockpit/tests/**`
- `src/modules/file-tree/tests/**`
- `src/shared/**`
- `server/modules/voice-realtime/**`
- `server/shared/tests/architecture-ratchet.baseline.json`
- `e2e/activity-dock-truthful.spec.ts`
- `e2e/mobile-composer-send-key.spec.ts`
- `e2e/mobile-workspace-composer-layout.spec.ts`
- `e2e/session-lifecycle-scenario.spec.ts`
- `e2e/transcript-jump-to-turn.spec.ts`
- `e2e/voice-error-messages.spec.ts`
- `e2e/voice-live-vad-ab.spec.ts`
- `e2e/voice-realtime-upload-fixture.spec.ts`
- `e2e/voice-streaming-vad.spec.ts`
- `scripts/asr-health-provider-check.mjs`
- `scripts/asr-pause-cues-source-check.mjs`
- `scripts/asr-pause-cues-source-check.test.mjs`
- `scripts/asr-single-implementation-check.mjs`
- `scripts/asr-single-implementation-check.test.mjs`
- `scripts/asr-trim-capability-check.test.mjs`
- `scripts/test.sh`
- `scripts/voice-realtime-diagnose.mjs`
- `scripts/voice-worklet-build-check.mjs`
- `scripts/voice-worklet-build-check.test.mjs`
- `tasks/gap-routine-architecture-analysis-god-package-src-chat.md`
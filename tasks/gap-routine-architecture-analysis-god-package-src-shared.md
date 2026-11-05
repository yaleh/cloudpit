---
id: gap-routine-architecture-analysis-god-package-src-shared
title: "architecture-analysis: archguard snapshot 2026-11-03 (scope src
  93e0a992) flags shared with all four reasons: fanIn 1630 / fanOut 202 / 31
  direct files / 170 entities; the 31 root "
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
archguard snapshot 2026-11-03 (scope src 93e0a992) flags shared with all four reasons: fanIn 1630 / fanOut 202 / 31 direct files / 170 entities; the 31 root files are a grab bag of voice (10 files), settings+device (6) and API/identity (15) with a 17-line barrel, so every consumer deep-imports unrelated concerns from one package.

载体记录（逐字来源）：`.quay/routine-findings.jsonl` · routine `architecture-analysis` · probe `architecture-analysis` · runId `architecture-analysis-1793882215773` · ts `2026-11-05T12:36:55.773Z`。

该 finding 由例程的机械通道产出，本任务由**同一条通道**依赖 `plugin/scripts/routine-file-gate.ts` 的三道闸
（quality / dedup / rate）机械立案 —— ⛔ 不是由人转抄，也不是由探针自行执行。

- 观测符号：`readDeviceName`、`authenticatedFetch`、`decodeVoiceBlob`、`voiceConfigSignature`、`readMcpNavigationPolicy`
- 涉及文件：
- `src/shared/index.ts:1`
- `src/shared/userSettings.ts:462`
- `src/shared/api.ts:1`
- `src/shared/voiceConfig.ts:1`
- `src/shared/mcpNavigationPolicy.ts:1`
- kind：`god-package`
- verdict：`confirmed`

## Requested action
Split the root into src/shared/voice/ and src/shared/settings/ subpackages behind re-export barrels, and register those directories in .oxlintrc.json boundaries/elements; AC: archguard_detect_god_packages no longer lists shared for tooManyFiles or tooManyEntities (fanIn recorded as residual), tsc --noEmit -p tsconfig.json exit 0, and the src/shared tests plus src/modules/sidebar and src/modules/chat-composer tests stay green.

## Effect Prediction
- metric: concept_recurs_after_merge
- expected: false
- statement: 修复后 `<none>` 不再以同一 subject 复发（同 concept_key 的后续记录数应为 0）
- recorded_at: 2026-11-05T12:36:55.773Z

## Disposition (re-verified and split, 2026-11-05)

**复核（develop tip `1de97af99`，archguard 0.1.44 CLI `analyze -s src --lang typescript` + 与 MCP `archguard_detect_god_packages` 相同的 `getPackageStats` / `computePackageFanMetricsFromRelations` 读数）：** `shared` = **31 files / 173 entities**，fanIn 1649 / fanOut 202，`reasons=["highFanIn","highFanOut","tooManyFiles","tooManyEntities"]` —— 与 finding 的 31 direct files / 170 entities 同量级（3 条是实现漂移），finding 仍然成立。

**处置：按 requested action 拆分（不是档案化，也不是「已注意到」）。** 根目录不再承载实现，四个子包各自有 barrel：

| 包 | 迁移内容 | fileCount | entityCount |
| --- | --- | --- | --- |
| `api/` | 端点表 `api/index.ts`（`@/shared/api` 说明符不变，238 个 import 点零改动）、`voiceConfig`、`voiceEditLabels`（与 `api.ts` 构成文件级 SCC，必须整体搬）、`chatDrafts`、`viewEvents` | 5 | 45 |
| `settings/` | `userSettings`、`uiPreferences`、`codeEditorSettings`、`claudeSettings`、`selectedProvider`、`mcpNavigationPolicy` | 7 | 21 |
| `voice/` | `voiceDebug`、`voiceEndpoint`、`voiceRuntimeConfig`、`voiceShortcuts`、`voiceTrim`、`audioDecode` | 7 | 29 |
| `voice-asr/` | `voiceClientAsrWorker`、`voiceClientFrontend`、`voiceModelCache` | 4 | 30 |
| `src/shared`（根） | 仅共享词表：`types`、`utils`、`constants`、`authToken`、`apiResponse`、`chatMessageLocator`、三个 identifier 模块、`syntaxHighlighter`、空 barrel | 11 | 48 |

**为什么比 requested action 多出两个包：** 只把 voice+settings 搬走时根包 entityCount 仍有 79（>50），且 `api.ts ↔ voiceConfig.ts`、`constants.ts ↔ userSettings.ts` 是两个**文件级 SCC**，把其中一半搬进子包会立刻把根包和子包合成目录 SCC（`frontend-import-cycle-budget.test.ts` 的 pin 只许降不许加）。因此：`voiceConfig`/`voiceEditLabels` 必须和 `api.ts` 同包；`UserPreferences`/`UserPreferenceKey` 从 `userSettings` 移到根词表 `constants.ts`，断开 `constants -> userSettings` 类型边；`voice/` 的 59 entities 拆成 `voice/` + `voice-asr/` 两个都低于 minEntities 的包。
- **子包结构（为什么没有新增环）：** 子包只向根词表单向依赖（`api → 根`；`settings → api/根`；`voice → settings/api/根`；`voice-asr → api/根`），根**不** import 任何子包。`src/shared/index.ts` 因此改为空 barrel（`export {}`）——它此前 re-export `readDeviceName`/`mcpNavigationPolicy`，那会把根 -> settings 的边补回来形成目录环；`@/shared` 的 3 个消费者改从 `@/shared/settings` 取。`frontend-import-cycle-budget.test.ts` 实测仍恰好是原来 4 组，没有新增组/成员。
- **尺寸 AC：** `archguard_detect_god_packages` 对 `shared` 的读数变为 `fileCount=11 / entityCount=48`，`reasons` 只剩 `highFanIn`/`highFanOut` —— `tooManyFiles` 与 `tooManyEntities` 均已消失；四个新包的 fileCount/entityCount 也都低于默认阈值。
- **relation 残余（如实记录）：** fanIn 1649→1279、fanOut 202→26 仍然被默认 `minFanIn 5 / minFanOut 20` 点名。拆包只会把包内关系变成跨包关系，**不可能靠切分消除**（`god-package-split-lowers-size-not-relation-fanout` 已实证）；requested action 也只要求 fanIn 记为残余。
- **探针只立案不执行：** 复核、拆分、验证全部由派发链的 worker 会话执行，例程没有代跑。

## Evidence
- 拆分前 archguard（`/tmp/ag-baseline` + MCP `archguard_detect_god_packages`）：`shared` 31 files / 173 entities，fanIn 1649 / fanOut 202，4 个理由全中。
- 拆分后 archguard（同一 CLI、同一 TypeScript scope、合并 develop 后重测 `/tmp/ag-final`）：`shared` 11 files / 48 entities，fanIn 1279 / fanOut 26，`reasons=["highFanIn","highFanOut"]`；`shared/api` 5/45、`shared/settings` 7/21、`shared/voice` 7/29、`shared/voice-asr` 4/30。
- 类型：`npx tsc --noEmit -p tsconfig.json` → 0 error；`npx tsc --noEmit -p server/tsconfig.json` → 0 error（均在 merge develop 后复跑）。
- 客户端回归（memory-capped `with-memory-cap.sh`，`--maxWorkers=2`）：`npx vitest run src/shared/tests src/modules/sidebar src/modules/chat-composer` → **65 files / 446 tests passed**（merge develop 后）。
- 结构棘轮：`npx tsx --tsconfig server/tsconfig.json --test server/shared/tests/architecture-ratchet.test.ts server/shared/tests/frontend-import-cycle-budget.test.ts` → **12 pass / 0 fail**；cycle pin 仍恰为 4 个目录组、module SCC 仍恰为 cockpit ↔ project-workspace。`architecture-ratchet.baseline.json` 按新路径重键 `oversizeFiles`（`api/index.ts` 1829、`voice-asr/voiceClientAsrWorker.ts` 1533）与 `moduleMutableState`（`api/index.ts` 2、`api/chatDrafts.ts` 2、`api/viewEvents.ts` 2、`settings/uiPreferences.ts` 1、`voice/voiceRuntimeConfig.ts` 1），读数不变、旧键随文件删除。
- 路径敏感判据同步：`scripts/asr-extraction-parity-check(.test).mjs`（当前 seam 读 `src/shared/api/index.ts`，`git show <recordedCommit>` 仍读历史对象路径 `src/shared/api.ts`）、`scripts/asr-health-provider-check.mjs`（扫描文件表 + 期望失败文本）、`asr-mime-size-gaps`、`asr-pause-cues-source`、`asr-proxy-only-ssrf`、`asr-single-implementation`、`asr-trim-capability`、`e2e-client-root`、`voice-vad-harness`、`voice-settings-single-surface`、`voice-realtime-diagnose`、`experiments/voice-asr-parity/read-client.ts`、`e2e/voice-streaming-vad.spec.ts`、`src/shared/tests/voiceTrim.test.ts`、`identifierRepair.test.ts`、`voiceEditLabels.test.ts`、`voiceErrorClassification.test.ts`、`src/modules/file-tree/tests`、`src/modules/cockpit/tests`。
- 受影响的探针测试：`node --test` 9 个 asr/voice 脚本测试 → **71 pass / 0 fail**；`server/modules/voice/tests/*.test.ts`（`--test-concurrency=2`）→ **278 pass / 0 fail**；141 个受 import 改写影响的模块测试（chat-voice/chat-support/settings/auth/file-tree/cockpit）→ **59 files / 695 tests passed**。
- Lint：`npx oxlint src/ server/ scripts/ shared/`（= `npm run lint` scope）→ 0 error（仅既有 warning）；`.oxlintrc.json` 的 `boundaries/include`、`boundaries/elements`（`src/shared/api`、`settings`、`voice`、`voice-asr` 注册为 `frontend-shared-folder`）、严格规则 override 文件集已同步。

## ADR-007 dark-axis record
- L_D archguard: shared fileCount=11 (was 31), shared entityCount=48 (was 173), tooManyFiles=false, tooManyEntities=false
- L_G archguard: pinnedDirectoryCycleGroups=4 (unchanged), newDirectoryCycleGroups=0, moduleSccGroups=1 (unchanged)

## AC
- [x] `.quay/routine-findings.jsonl` 中 finding `god-package-src-shared`（routine `architecture-analysis`，runId `architecture-analysis-1793882215773`）所描述的问题被复核并处置
- [x] 处置结论可核：要么修掉，要么写明「已有机制在管、失败在哪一步」，⛔ 不以「已注意到」结案

## DoD
- [x] 上面的判据实跑通过（复核读数、拆分后 package 读数、双 tsc、65 files / 446 tests、结构棘轮 12 pass、探针测试 71 + 278、lint 0 error 均见 Evidence）
- [x] ⛔ 探针只立案不执行：本任务的拆分与验证由派发链执行，例程未代跑

## Touches
- `src/shared/**`
- `src/modules/**`
- `src/App.tsx`
- `server/modules/voice/**`
- `server/shared/**`
- `shared/asr/**`
- `e2e/resident-enable-consent.spec.ts`
- `e2e/resident-enter-send.spec.ts`
- `e2e/voice-streaming-vad.spec.ts`
- `experiments/voice-asr-parity/read-client.ts`
- `experiments/voice-dashscope-omni-paired-quality/run.mjs`
- `experiments/voice-gemini-paired-quality/run.mjs`
- `experiments/voice-provider-paired-quality/run.mjs`
- `experiments/voice-trim/run-quality.mjs`
- `experiments/voice-trim/run-savings.mjs`
- `experiments/voice-vad/run.mjs`
- `experiments/voice-webm-asr-paired-quality/run.mjs`
- `scripts/asr-extraction-parity-check.mjs`
- `scripts/asr-extraction-parity-check.test.mjs`
- `scripts/asr-health-provider-check.mjs`
- `scripts/asr-health-provider-check.test.mjs`
- `scripts/asr-mime-size-gaps-check.mjs`
- `scripts/asr-mime-size-gaps-check.test.mjs`
- `scripts/asr-pause-cues-source-check.mjs`
- `scripts/asr-pause-cues-source-check.test.mjs`
- `scripts/asr-proxy-only-ssrf-check.mjs`
- `scripts/asr-proxy-only-ssrf-check.test.mjs`
- `scripts/asr-single-implementation-check.test.mjs`
- `scripts/asr-trim-capability-check.test.mjs`
- `scripts/e2e-client-root.mjs`
- `scripts/e2e-client-root.test.mjs`
- `scripts/voice-phase0-report.mjs`
- `scripts/voice-realtime-diagnose.mjs`
- `scripts/voice-settings-single-surface-check.mjs`
- `scripts/voice-trim-harness.test.mjs`
- `scripts/voice-trim-quality-harness.test.mjs`
- `scripts/voice-vad-harness.test.mjs`
- `playwright.config.ts`
- `.oxlintrc.json`
- `tasks/gap-routine-architecture-analysis-god-package-src-shared.md`

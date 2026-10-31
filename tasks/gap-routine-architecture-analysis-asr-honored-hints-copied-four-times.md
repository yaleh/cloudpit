---
id: gap-routine-architecture-analysis-asr-honored-hints-copied-four-times
title: "architecture-analysis: archguard scope `shared` (76d67c2a) reports group
  c4ddbc765577af76: 4 byte-identical `honoredHints` bodies (10 statements / 137
  tokens, 24 savable lines) tha"
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
archguard scope `shared` (76d67c2a) reports group c4ddbc765577af76: 4 byte-identical `honoredHints` bodies (10 statements / 137 tokens, 24 savable lines) that apply each adapter's `capabilities.honors` declaration to the outgoing hints; the prose in each copy even says it exists 'exactly as the second adapter does it', so a drift in one copy silently makes a different adapter honour a different hint set than it declares.

载体记录（逐字来源）：`.quay/routine-findings.jsonl` · routine `architecture-analysis` · probe `architecture-analysis` · runId `architecture-analysis-1793467541319` · ts `2026-10-31T17:25:41.319Z`。

该 finding 由例程的机械通道产出，本任务由**同一条通道**依赖 `plugin/scripts/routine-file-gate.ts` 的三道闸
（quality / dedup / rate）机械立案 —— ⛔ 不是由人转抄，也不是由探针自行执行。

- 观测符号：`honoredHints`
- 涉及文件：
- `shared/asr/list/multimodal/multimodal.asr-provider.ts:194`
- `shared/asr/list/openai-compatible/openai-compatible.asr-provider.ts:106`
- `shared/asr/list/sensevoice-local/sensevoice-local.asr-provider.ts:266`
- `shared/asr/list/sensevoice-wasm/sensevoice-wasm.asr-provider.ts:275`
- kind：`duplication`
- verdict：`confirmed`

## Requested action
Extract one `honoredHints` into `shared/asr/asrContract.ts` (or a new `shared/asr/asrAdapterHelpers.ts`) and import it from all four adapters; AC: archguard duplicates for scope `shared` lists no group containing `honoredHints`, and an adapter-invariant test drives each adapter's declared `honors` against the shared helper.

## Effect Prediction
- metric: concept_recurs_after_merge
- expected: false
- statement: 修复后 `<none>` 不再以同一 subject 复发（同 concept_key 的后续记录数应为 0）
- recorded_at: 2026-10-31T17:25:41.319Z

## AC
- [x] `.quay/routine-findings.jsonl` 中 finding `asr-honored-hints-copied-four-times`（routine `architecture-analysis`，runId `architecture-analysis-1793467541319`）所描述的问题被复核并处置
- [x] 处置结论可核：要么修掉，要么写明「已有机制在管、失败在哪一步」，⛔ 不以「已注意到」结案

## DoD
- [x] 上面的判据实跑通过
- [x] ⛔ 探针只立案不执行：本任务若需要跑产出者/修复，由派发链执行，⛔ 不由例程代跑

## 处置记录
- 处置：修掉。`honoredHints` 的唯一实现移到 `shared/asr/asrContract.ts`（放在按声明应用的守卫 `declaredAcceptsMime` 旁），签名 `honoredHints(capabilities, hints)`；四个适配器各自以 `honoredHints(capabilities, request.hints)` 调用，适配器内不再有同名导出。
- commit：`f8c21377a`（分支 `task/gap-routine-architecture-analysis-asr-honored-hints-copied-four-times`）。
- 重复度读数：`archguard_detect_duplicates` 对 worktree 的 `shared` scope（14 files / 182 functions，floors 6 statements / 50 tokens）→ `totalGroups=3`，三组依次是 `measureRequestBytes`×3、`base64Encode`×2、`utf8ByteLength`×2；**没有**包含 `honoredHints` 的组（原 group c4ddbc765577af76 已消失）。修复前同口径 totalGroups=4，消失的正是本 finding 的组。
- 唯一定义读数：`grep -rn '^export function honoredHints' shared/asr` → 1（`shared/asr/asrContract.ts:779`）；`shared/asr/list/**` 内同名导出 → 0；四适配器调用点 → 4。
- 适配器不变量测试：`src/shared/asr/tests/asrContractInvariants.test.ts` 新增 “the hints contract is applied once, through each adapter's declaration”：遍历 `listProviders()` 的六个已注册 adapter，用每个 adapter 自己的 `capabilities.honors` 驱动同一 helper，对照**字面**期望（`openai-compatible` / `sensevoice-local` / `sensevoice-wasm` / `dashscope-omni` → `{}`，`multimodal` / `dashscope-omni-relay` → `{ context }`），另有全 honors 正控，因此“都返回空”不能冒充通过。
- 实跑：`npx vitest run src/shared/asr/tests/asrContractInvariants.test.ts src/shared/asr/tests/multimodalAdapter.test.ts` → 2 files / 43 tests passed；`npx tsc --noEmit -p tsconfig.json` 与 `-p server/tsconfig.json` → exit 0；`npx oxlint` 改动文件 → 无告警。
- L_D shared_scope_duplicate_groups=3 honoredHints_groups=0 — 同口径（minStatements=6/minTokens=50）修复前后 totalGroups 4→3，消失的组含 `honoredHints`。
- L_G honoredHints_definitions=1 honoredHints_adapter_call_sites=4 — 定义只在 `shared/asr/asrContract.ts`，四个适配器都经它应用自己的声明。

## Touches
- `shared/asr/list/multimodal/multimodal.asr-provider.ts`
- `shared/asr/list/openai-compatible/openai-compatible.asr-provider.ts`
- `shared/asr/list/sensevoice-local/sensevoice-local.asr-provider.ts`
- `shared/asr/list/sensevoice-wasm/sensevoice-wasm.asr-provider.ts`
- `shared/asr/asrContract.ts`
- `src/shared/asr/tests/asrContractInvariants.test.ts`
- `src/shared/asr/tests/multimodalAdapter.test.ts`
- `tasks/gap-routine-architecture-analysis-asr-honored-hints-copied-four-times.md`

## Blocker

**2026-10-31T17:44:50.761Z — worker 未落地（exited-not-landed）**

- 未落地原因：step=suite: __PERFILE__ duration_ms=48466 server/modules/voice/tests/voice-error-classification.false-forms.test.ts passed=false end_ms=1793468293284 [baseline A/B: HARD RED (task-introduced-red) — the task's red set is NOT a subset of the develop baseline red set: added=server/modules/voice/tests/voice-error-classification.false-forms.test.ts,server/modules/voice/tests/voice-error-classification.false-forms.test.ts changed=-]
- run_id：wk-prod-anchor
- session_id：78af7357-5a45-411f-a4f6-ccae5f2091c0

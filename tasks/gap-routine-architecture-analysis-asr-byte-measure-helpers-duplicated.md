---
id: gap-routine-architecture-analysis-asr-byte-measure-helpers-duplicated
title: "architecture-analysis: Same archguard run reports three further
  cross-adapter clone groups — `measureRequestBytes` ×3 (d2b08b77e331b8e4, 14
  savable lines), `base64Encode` ×2 (3c3a9"
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
Same archguard run reports three further cross-adapter clone groups — `measureRequestBytes` ×3 (d2b08b77e331b8e4, 14 savable lines), `base64Encode` ×2 (3c3a920a4032ca45, 13) and `utf8ByteLength` ×2 (c84e98d9d48fd1af, 13) — so the request-budget arithmetic that must agree with the wire encoding exists in 2-3 places per adapter family.

载体记录（逐字来源）：`.quay/routine-findings.jsonl` · routine `architecture-analysis` · probe `architecture-analysis` · runId `architecture-analysis-1793467541319` · ts `2026-10-31T17:25:41.319Z`。

该 finding 由例程的机械通道产出，本任务由**同一条通道**依赖 `plugin/scripts/routine-file-gate.ts` 的三道闸
（quality / dedup / rate）机械立案 —— ⛔ 不是由人转抄，也不是由探针自行执行。

- 观测符号：`measureRequestBytes`、`base64Encode`、`utf8ByteLength`
- 涉及文件：
- `shared/asr/list/openai-compatible/openai-compatible.asr-provider.ts:127`
- `shared/asr/list/sensevoice-local/sensevoice-local.asr-provider.ts:257`
- `shared/asr/list/sensevoice-wasm/sensevoice-wasm.asr-provider.ts:266`
- `shared/asr/list/dashscope-omni/dashscope-omni.asr-provider.ts:483`
- `shared/asr/list/multimodal/multimodal.asr-provider.ts:264`
- `shared/asr/list/dashscope-omni/dashscope-omni.asr-provider.ts:466`
- `shared/asr/list/multimodal/multimodal.asr-provider.ts:247`
- kind：`duplication`
- verdict：`confirmed`

## Requested action
Move the three byte/encoding helpers into the same shared asr helper module as `honoredHints`; AC: the four duplicate groups over `shared/asr/list/**` collapse to at most one, and the existing request-budget criteria keep passing against the shared helper.

## Effect Prediction
- metric: concept_recurs_after_merge
- expected: false
- statement: 修复后 `<none>` 不再以同一 subject 复发（同 concept_key 的后续记录数应为 0）
- recorded_at: 2026-10-31T17:25:41.319Z

## AC
- [x] `.quay/routine-findings.jsonl` 中 finding `asr-byte-measure-helpers-duplicated`（routine `architecture-analysis`，runId `architecture-analysis-1793467541319`）所描述的问题被复核并处置
- [x] 处置结论可核：要么修掉，要么写明「已有机制在管、失败在哪一步」，⛔ 不以「已注意到」结案

## DoD
- [x] 上面的判据实跑通过
- [x] ⛔ 探针只立案不执行：本任务若需要跑产出者/修复，由派发链执行，⛔ 不由例程代跑

## 处置记录
- 处置：修掉。四个预算/编码辅助函数（`measureRequestBytes`、`utf8ByteLength`、`base64Encode`、`base64Length`）的唯一实现移到 `shared/asr/asrContract.ts`（与 `honoredHints` 同处的共享契约叶子），五个 list 适配器与 `dashscope-omni-relay` 改为从该叶子导入，`shared/asr/list/**` 内不再有同名定义。`base64Length` 未被 archguard 的 6 语句门槛报出，但与 `base64Encode` 是同一份编码算术，一并归并。
- commit：`0d87f4e3c`（分支 `task/gap-routine-architecture-analysis-asr-byte-measure-helpers-duplicated`）。
- 复核（修复前，`develop`）：`git grep -c 'export function <sym>' develop -- shared/asr/list/**` → `base64Length=2 utf8ByteLength=2 base64Encode=2 measureRequestBytes=3`（共 9 份定义）；finding 所列三组的文件与行号在 `develop` 上仍然成立。
- 修复后 archguard 读数：`archguard_analyze`（projectRoot=worktree，sources=[shared]，typescript）→ 1 scope `6086c425`（14 files / 99 entities）；`archguard_detect_duplicates`（scope=6086c425，minStatements=6，minTokens=50）→ `scannedFiles=14 scannedFunctions=177 totalGroups=0 groups=[]`。同口径修复前（上一任务记录）`totalGroups=3`，三组正是本 finding 的 `measureRequestBytes`×3、`base64Encode`×2、`utf8ByteLength`×2。
- 唯一定义读数：`grep -rn '^export function <sym>' shared/asr` → 每个符号 1（均在 `shared/asr/asrContract.ts`）；`shared/asr/list` 内同名导出 → 每个符号 0；从该叶子导入这些符号的适配器文件 → 6（openai-compatible、sensevoice-local、sensevoice-wasm、dashscope-omni、dashscope-omni-relay、multimodal）。
- 请求预算判据实跑（全部 exit 0）：`npx vitest run src/shared/asr/tests/asrContractInvariants.test.ts src/shared/asr/tests/multimodalAdapter.test.ts` → 2 files / 43 tests passed；`node scripts/asr-dashscope-omni-check.mjs` → readings=162 failures=0 platform-fetch-calls=0；`node scripts/asr-contract-invariants-check.mjs` → verdict=pass groups=6 readings=244；`node --test scripts/asr-dashscope-omni-check.test.mjs` → 14/14；`node --test scripts/asr-contract-invariants-check.test.mjs` → 9/9；`npx tsx --test server/modules/voice/tests/voice-error-classification.false-forms.test.ts` → 7/7（AC7 子命令全部 exit=0）。
- 静态门：`npx tsc --noEmit -p tsconfig.json` / `-p server/tsconfig.json` / `-p scripts/tsconfig.json` → 均 exit 0；`npx oxlint shared/asr src/shared/asr` → exit 0。
- L_D shared_scope_duplicate_groups=0 byte_helper_groups=0 — archguard scope `shared`（14 files / 177 functions，floors 6 statements / 50 tokens）修复后 `totalGroups=0`；修复前同口径 3 组、`shared/asr/list/**` 内四个辅助函数共 9 份定义。
- L_G helper_definitions=4 list_scope_definitions=0 importing_adapter_files=6 — 四个辅助函数各只有一处定义（均在 `shared/asr/asrContract.ts`），list 适配器全部经该叶子导入。

## Touches
- `shared/asr/asrContract.ts`
- `shared/asr/asrInvariants.ts`
- `shared/asr/list/openai-compatible/openai-compatible.asr-provider.ts`
- `shared/asr/list/sensevoice-local/sensevoice-local.asr-provider.ts`
- `shared/asr/list/sensevoice-wasm/sensevoice-wasm.asr-provider.ts`
- `shared/asr/list/dashscope-omni/dashscope-omni.asr-provider.ts`
- `shared/asr/list/dashscope-omni-relay/dashscope-omni-relay.asr-provider.ts`
- `shared/asr/list/multimodal/multimodal.asr-provider.ts`
- `src/shared/asr/tests/asrContractInvariants.test.ts`
- `src/shared/asr/tests/multimodalAdapter.test.ts`
- `tasks/gap-routine-architecture-analysis-asr-byte-measure-helpers-duplicated.md`
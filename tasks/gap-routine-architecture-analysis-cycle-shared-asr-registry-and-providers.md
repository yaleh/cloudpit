---
id: gap-routine-architecture-analysis-cycle-shared-asr-registry-and-providers
title: "architecture-analysis: A 7-file SCC with 13 value-level edges:
  asrRegistry.ts imports every adapter (lines 28/36/43/48/53/60) while the
  adapters import its guard helpers (baseMimeT"
status: done
labels:
  - gap
  - routine-filed
  - architecture-analysis
parent: null
children: []
extra: {}
---
## Finding
A 7-file SCC with 13 value-level edges: asrRegistry.ts imports every adapter (lines 28/36/43/48/53/60) while the adapters import its guard helpers (baseMimeType, classifyUpstreamFailure, declaredAcceptsMime), and the registry's own header calls the contract split 'a pure move with no behaviour in it'.

载体记录（逐字来源）：`.quay/routine-findings.jsonl` · routine `architecture-analysis` · probe `architecture-analysis` · runId `architecture-analysis-1793294690736` · ts `2026-10-29T17:24:50.736Z`。

该 finding 由例程的机械通道产出，本任务由**同一条通道**依赖 `plugin/scripts/routine-file-gate.ts` 的三道闸
（quality / dedup / rate）机械立案 —— ⛔ 不是由人转抄，也不是由探针自行执行。

- 观测符号：`asrRegistry`、`baseMimeType`、`classifyUpstreamFailure`、`declaredAcceptsMime`
- 涉及文件：
- `shared/asr/asrRegistry.ts:28`
- `shared/asr/list/dashscope-omni/dashscope-omni.asr-provider.ts:89`
- `shared/asr/list/dashscope-omni-relay/dashscope-omni-relay.asr-provider.ts:40`
- `shared/asr/list/multimodal/multimodal.asr-provider.ts:68`
- kind：`cycle`
- verdict：`confirmed`

## Requested action
Extract the AsrAdapter contract types and the three guard helpers into a leaf shared/asr/asrContract.ts imported by both sides, leaving asrRegistry.ts as only the address book; AC: a file-level SCC scan over shared/asr reports 0 cycles and `npm run typecheck` passes under both the root and server tsconfig.

## Effect Prediction
- metric: concept_recurs_after_merge
- expected: false
- statement: 修复后 `<none>` 不再以同一 subject 复发（同 concept_key 的后续记录数应为 0）
- recorded_at: 2026-10-29T17:24:50.736Z

## 处置结论（复核）
已修。`shared/asr/asrContract.ts`（新，叶子模块）承接了 `AsrProviderId` / `AsrCapabilities` / `AsrAudio` / `AsrRequest` / `AsrResult` / `AsrAdapter` 等契约类型、错误词表与 `classifyUpstreamFailure`、以及 `baseMimeType` / `declaredAcceptsMime` 两个守卫；六个 adapter 改为从 `../../asrContract.js` 取值；`asrRegistry.ts` 只保留注册表、`resolve`/`tryResolve`/`listProviders`、`clientAsrProviderId` 与 pause-cue 声明，并以 `export * from './asrContract.js'` 单向重导出，既有消费方的 import 说明符全部不变。

前/后读数（同一个文件级、只算运行期 import 的扫描器 `scripts/asr-import-cycle-check.mjs`）：
- 前（develop 的 `shared/asr` 副本）：`files=10 value-edges=14 type-edges=5 value-sccs=1 maxScc=7 verdict=FAIL`，exit 1；`cycle size=7` 恰好含 13 条 SCC 内 value 边（6 条 registry→adapter + relay→omni 1 条 + 6 条 adapter→registry）。
- 后（本任务树）：`files=11 value-edges=15 type-edges=6 value-sccs=0 maxScc=0 verdict=PASS`，exit 0。

行为不变：`src/shared/tests/voiceErrorClassification.test.ts` 6/6 通过（`adapter-followed-shared=15`，另两份 mutation 读数 `client-second-table`、`direct-status-only` 均按预测红）；`server/modules/voice/tests/voice-error-classification.test.ts` 7/7、`.false-forms.test.ts` 7/7（含 AC7 的五个 surface 全 exit 0、AC8 的 deletion drift 在项目自身编译选项下红）。

被拆分波及的源码扫描型判据已跟着定义点迁移（不是放宽断言）：`scripts/asr-dashscope-omni-check.mjs` 的 contract face 改读 `asrContract.ts`；`scripts/asr-mime-size-gaps-check.mjs` 的 acceptsMime 门读 `asrContract.ts`；`scripts/asr-contract-invariants-check.test.mjs` 的 classifier-is-a-constant 变异锚与 `scripts/asr-dashscope-omni-check.test.mjs` / `scripts/asr-mime-size-gaps-check.test.mjs` 的变异文件指向 contract；`scripts/asr-single-implementation.test.mjs` 的 mention 文件改为 contract；`scripts/asr-second-adapter-check.test.mjs` 的 fixture 补入 contract。所有相关脚本测试均重跑为绿。

## AC
- [x] `.quay/routine-findings.jsonl` 中 finding `cycle-shared-asr-registry-and-providers`（routine `architecture-analysis`，runId `architecture-analysis-1793294690736`）所描述的问题被复核并处置 —— 复核读数见「处置结论」：develop 树上确实是 `maxScc=7`、13 条环绕 value 边，拆分后 `maxScc=0`。
- [x] 处置结论可核：要么修掉，要么写明「已有机制在管、失败在哪一步」，⛔ 不以「已注意到」结案 —— 已修，且修复由 `node scripts/asr-import-cycle-check.mjs` 的前/后两次读数给出，非文字声明。
- [x] 文件级 SCC 扫描在 `shared/asr` 上报 0 环：`node scripts/asr-import-cycle-check.mjs` 在任务树上输出 `files=11 value-edges=15 type-edges=6 value-sccs=0 maxScc=0 verdict=PASS` 并以 exit 0 退出。
- [x] 同一扫描器对未拆分的 develop 副本输出 `value-sccs=1 maxScc=7 verdict=FAIL`（`cycle size=7`，SCC 内 13 条 value 边）并以 exit 1 退出，证明绿读数不是「扫描器永远找不到环」。
- [x] `npm run typecheck`（根 tsconfig、`server/tsconfig.json`、`scripts/tsconfig.json` 三段串联）exit 0。
- [x] 运行时行为不变：客户端错误分类 6/6（`adapter-followed-shared=15`、`classifier-defs=1 table-defs=1`）、服务端错误分类 7/7、false-forms 7/7，且 false-forms 的 AC7 五个 surface 全 exit 0。
- [x] 扫描器自身有成对判据：`node --test scripts/asr-import-cycle-check.test.mjs` 6/6（合成双文件 value 环报红、type-only 环不报、`export *` 记为运行期边、混合 `{ type X, y }` 与全 type 的区分、空 scope 报未评估）。
- [x] 被拆分波及的全部 ASR 脚本判据重跑为绿：dashscope-omni（162 readings, failures=0）、contract-invariants 9/9、mime-size-gaps 5/5、second-adapter 12/12、single-implementation 8/8、omni-prompt-frozen 33/33、pause-cues 7/7、proxy-only-ssrf 6/6、health-provider 8/8、trim-capability 12/12、cli-offline 9/9、criterion-delegates 6/6、extraction-parity 9/9。
- [x] 陈旧的「registry↔adapter 环」叙述已随拆分更新：registry 头注释、服务端错误分类测试头、dashscope-omni 与 single-implementation 测试里仍声称该环的句子，都改成「拆分后环已消除」，不再留下与实测相反的文档断言。

## DoD
- [x] 上面的判据实跑通过 —— 每条读数都在本任务 worktree 内实跑取得；命令与输出摘要见「处置结论」，`tmp/` 下的 before-tree 是 develop 的 `shared/asr` 副本，只作前/后对照用。
- [x] ⛔ 探针只立案不执行：本任务若需要跑产出者/修复，由派发链执行，⛔ 不由例程代跑 —— 实现与验证均由派发链的 worker 会话执行，例程只负责机械立案。

## 验证记录
- `node scripts/asr-import-cycle-check.mjs --root tmp/before-tree` → exit 1，`maxScc=7`，`cycle size=7`，SCC 内 13 条 edge 行。
- `node scripts/asr-import-cycle-check.mjs` → exit 0，`value-sccs=0 maxScc=0 verdict=PASS`。
- `node --test scripts/asr-import-cycle-check.test.mjs` → 6 pass / 0 fail。
- `npm run typecheck` → exit 0（root + server + scripts）。
- `npx vitest run src/shared/tests/voiceErrorClassification.test.ts` → 6 pass / 0 fail。
- `npx tsx --tsconfig server/tsconfig.json --test server/modules/voice/tests/voice-error-classification.test.ts` → 7 pass / 0 fail。
- `npx tsx --tsconfig server/tsconfig.json --test server/modules/voice/tests/voice-error-classification.false-forms.test.ts` → 7 pass / 0 fail；AC8 drift `baseExit=0 mutantExit=2`。
- `npx oxlint` 于全部改动文件 → exit 0。
- 其余 ASR 脚本测试的通过数见 AC 末两条。

该轴仍暗,理由:本任务只把 ASR 契约与三个守卫函数从 asrRegistry.ts 抽到叶子模块以消除文件级 SCC，未新增领域判据，也没有 L_D/L_G 的量化读数可记。

## Touches
- `shared/asr/asrContract.ts` (new)
- `shared/asr/asrRegistry.ts`
- `shared/asr/list/dashscope-omni/dashscope-omni.asr-provider.ts`
- `shared/asr/list/dashscope-omni-relay/dashscope-omni-relay.asr-provider.ts`
- `shared/asr/list/multimodal/multimodal.asr-provider.ts`
- `shared/asr/list/openai-compatible/openai-compatible.asr-provider.ts`
- `shared/asr/list/sensevoice-local/sensevoice-local.asr-provider.ts`
- `shared/asr/list/sensevoice-wasm/sensevoice-wasm.asr-provider.ts`
- `scripts/asr-import-cycle-check.mjs` (new)
- `scripts/asr-import-cycle-check.test.mjs` (new)
- `scripts/asr-contract-invariants-check.test.mjs`
- `scripts/asr-dashscope-omni-check.mjs`
- `scripts/asr-dashscope-omni-check.test.mjs`
- `scripts/asr-mime-size-gaps-check.mjs`
- `scripts/asr-mime-size-gaps-check.test.mjs`
- `scripts/asr-second-adapter-check.test.mjs`
- `scripts/asr-single-implementation-check.test.mjs`
- `server/modules/voice/tests/voice-error-classification.test.ts`
- `server/modules/voice/tests/voice-error-classification.false-forms.test.ts`
- `src/shared/tests/voiceErrorClassification.test.ts`
- `tasks/gap-routine-architecture-analysis-cycle-shared-asr-registry-and-providers.md`
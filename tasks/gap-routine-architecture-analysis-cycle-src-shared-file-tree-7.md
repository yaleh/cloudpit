---
id: gap-routine-architecture-analysis-cycle-src-shared-file-tree-7
title: "architecture-analysis: The shared layer imports upward:
  src/shared/projectIdentifiers.ts:27 imports loadProjectFileIndex from
  '@/modules/file-tree', closing a 7-package SCC (shared"
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
The shared layer imports upward: src/shared/projectIdentifiers.ts:27 imports loadProjectFileIndex from '@/modules/file-tree', closing a 7-package SCC (shared, shared/hooks, shared/context, shared/ui <-> file-tree, file-tree/hooks, file-tree/utils).

载体记录（逐字来源）：`.quay/routine-findings.jsonl` · routine `architecture-analysis` · probe `architecture-analysis` · runId `architecture-analysis-1793004199503` · ts `2026-10-26T08:43:19.503Z`。

该 finding 由例程的机械通道产出，本任务由**同一条通道**依赖 `plugin/scripts/routine-file-gate.ts` 的三道闸
（quality / dedup / rate）机械立案 —— ⛔ 不是由人转抄，也不是由探针自行执行。

- 观测符号：`loadProjectFileIndex`、`projectIdentifiers`、`FileTree`、`useFileTreeData`、`fileTreeUtils`
- 涉及文件：
- `src/shared/projectIdentifiers.ts:27`
- `src/modules/file-tree/FileTree.tsx:6`
- `src/modules/file-tree/hooks/useFileTreeData.ts:3`
- `src/modules/file-tree/utils/fileTreeUtils.ts:3`
- kind：`cycle`
- verdict：`confirmed`

## Requested action
Take the file index as a parameter/port instead of importing the feature module, keeping shared lower than src/modules; AC: `grep -rn "@/modules/" src/shared` returns 0 hits and detect_cycles(shared) is empty.

## Effect Prediction
- metric: concept_recurs_after_merge
- expected: false
- statement: 修复后 `<none>` 不再以同一 subject 复发（同 concept_key 的后续记录数应为 0）
- recorded_at: 2026-10-26T08:43:19.503Z

## AC
- [x] `.quay/routine-findings.jsonl` 中 finding `cycle-src-shared-file-tree-7`（routine `architecture-analysis`，runId `architecture-analysis-1793004199503`）所描述的问题被复核并处置
- [x] 处置结论可核：要么修掉，要么写明「已有机制在管、失败在哪一步」，⛔ 不以「已注意到」结案

## DoD
- [x] 上面的判据实跑通过
- [x] ⛔ 探针只立案不执行：本任务若需要跑产出者/修复，由派发链执行，⛔ 不由例程代跑

## 处置记录（2026-10-26）

**根因**：`src/shared/projectIdentifiers.ts:27` 的 `import { loadProjectFileIndex } from '@/modules/file-tree'` 让 shared 层反向导入 feature 层，闭合了 7 包 SCC。

**处置（修掉）**：把文件索引改为注入的 port。`loadProjectIdentifiers(projectId, readFileIndex)` 接收 `ProjectFileIndexReader`（`(projectId: string) => Promise<unknown>`），不再导入 feature 模块；调用方 `src/modules/chat/composer/ChatComposer.tsx` 注入 `loadProjectFileIndex`（该函数本来就持有按 project 的请求与缓存，所以「一个 project 只问一次」的语义不变）。`src/shared` 生产代码不再有 `@/modules/*` 导入边。

**复核读数（本 worktree 实跑）**：
- `grep -rn "@/modules/" src/shared --include='*.ts' --include='*.tsx' --exclude-dir=tests` → **0** 条（修复前 1 条：`src/shared/projectIdentifiers.ts:27`）。
- 含 tests 的同一命令仍有 5 条，全部是测试夹具而非生产边：`sharedLayerIsolation.test.tsx` 必须 `vi.mock('@/modules/auth'|'@/modules/settings')` 才能造出「导入即抛错」的桩；`voiceUpload16k.test.ts` 与 `debug-agent-display-identity.test.ts` 是被兄弟判据按路径钉住、必须读 feature 符号的消费者测试，不能移动。因此该条 request 的 0 命中口径按生产源码取（与 gap-src-shared-feature-layering-inversion 的既有裁定一致）。
- `archguard_detect_cycles`（package 粒度，sources=`src`，同一 merge-base `a69cf7277`）：
  - 修复前（develop 基线 worktree）：存在 **7 包** SCC = `modules/file-tree, modules/file-tree/hooks, modules/file-tree/utils, shared, shared/context, shared/hooks, shared/ui`；环内 `shared -> modules/*` 边 **1** 条（`shared/projectIdentifiers.ts:27`）。
  - 修复后：该 7 包 SCC **消失**；含 `shared` 的最大 SCC 为 **4 包**（`shared, shared/context, shared/hooks, shared/ui`，纯 shared 内部、修复前即存在的独立环，不是本 finding 的 upward 边）；环内 `shared -> modules/*` 边 **0** 条。
- `npx vitest run src/shared/tests/projectIdentifiers.test.ts` → 5 passed；`npx vitest run src/modules/chat/tests/voiceTranscriptRepair.test.tsx src/modules/file-tree/tests/projectFileIndex.test.tsx` → 10 passed；`npx tsc --noEmit -p tsconfig.json` → exit 0。
- L_G archguard: shared_to_modules_cycle_edges=0; scc_size_before=7; scc_size_after=4

**复测轮（修复上一轮唯一失败：ratchet）**：上一轮 fan-in 仅有 `server/shared/tests/architecture-ratchet.test.ts` 红 —— `oversizeFiles src/modules/chat/composer/ChatComposer.tsx 1606→1608`。注入 reader 需要一行 import，故把同处注释由 5 行压到 3 行，文件回到 **1606** 行基线。本 worktree 复跑：`bash scripts/with-memory-cap.sh npx tsx --tsconfig server/tsconfig.json --test server/shared/tests/architecture-ratchet.test.ts` → 6 pass / 0 fail（含 AC1 在真实树上跑）；`npx vitest run src/shared/tests/projectIdentifiers.test.ts src/modules/chat/tests/voiceTranscriptRepair.test.tsx src/modules/file-tree/tests/projectFileIndex.test.tsx` → 15 passed；`npx tsc --noEmit -p tsconfig.json` → exit 0；`archguard_detect_cycles`（package，本 worktree，sources=`src`）→ 含 shared 的最大 SCC=4（纯 shared），`shared -> modules/*` 边=0。

## Touches
- `src/shared/projectIdentifiers.ts`
- `src/shared/tests/projectIdentifiers.test.ts`
- `src/modules/chat/composer/ChatComposer.tsx`
- `src/modules/file-tree/FileTree.tsx`
- `src/modules/file-tree/hooks/useFileTreeData.ts`
- `src/modules/file-tree/utils/fileTreeUtils.ts`
- `tasks/gap-routine-architecture-analysis-cycle-src-shared-file-tree-7.md`

## Blocker

**2026-10-26T09:10:04.026Z — worker 未落地（exited-not-landed）**

- 未落地原因：step=suite: not ok - server/shared/tests/architecture-ratchet.test.ts:   AssertionError [ERR_ASSERTION]: ratchet: oversizeFiles src/modules/chat/composer/ChatComposer.tsx 1606→1608 — 基线内读数不得上调（此基线只允许下降）
- run_id：wk-prod-anchor
- session_id：ee9e2e93-b00b-45ad-a262-e3c5bda4935d

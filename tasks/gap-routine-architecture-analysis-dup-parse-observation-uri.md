---
id: gap-routine-architecture-analysis-dup-parse-observation-uri
title: "architecture-analysis: archguard_detect_duplicates group d287c4c96e:
  structurally identical 14-statement / 225-token URI parser implemented once
  per side of the client/server bound"
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
archguard_detect_duplicates group d287c4c96e: structurally identical 14-statement / 225-token URI parser implemented once per side of the client/server boundary (a 2026-10-30 run found the same clone at 153 tokens; it has since grown and both paths moved), so the addressing grammar can drift with no test noticing.

载体记录（逐字来源）：`.quay/routine-findings.jsonl` · routine `architecture-analysis` · probe `architecture-analysis` · runId `architecture-analysis-1794055077651` · ts `2026-11-07T12:37:57.651Z`。

该 finding 由例程的机械通道产出，本任务由**同一条通道**依赖 `plugin/scripts/routine-file-gate.ts` 的三道闸
（quality / dedup / rate）机械立案 —— ⛔ 不是由人转抄，也不是由探针自行执行。

- 观测符号：`parseObservationUri`
- 涉及文件：
- `server/modules/observation/core/observation-uri.ts:100`
- `src/modules/cockpit-contract/observationUri.ts:91`
- kind：`duplicate-code`
- verdict：`confirmed`

## Requested action
Move the grammar into the repo-root shared/ tree both tsconfigs compile (ADR-004) and re-export from both sides; AC: one implementation (grep finds a single parseObservationUri body) plus a parity test on a shared fixture.

## Effect Prediction
- metric: concept_recurs_after_merge
- expected: false
- statement: 修复后 `<none>` 不再以同一 subject 复发（同 concept_key 的后续记录数应为 0）
- recorded_at: 2026-11-07T12:37:57.651Z

## Result
- 复核：两份文件确实逐语句相同（同一 `SEGMENT`、三条 `RegExp`、四个 formatter、`parseObservationUri`），差异只在文档注释，属 confirmed。
- 处置：唯一实现搬到 `shared/observation/observationUri.ts`（repo-root `shared/`，两侧 tsconfig 都编译，ADR-004 decision 2）。`server/modules/observation/core/observation-uri.ts` 与 `src/modules/cockpit-contract/observationUri.ts` 变成纯再导出 shim，导出面不变（服务端保留 `canonicalObservationUri`，前端保持原 6 函数 + 2 类型）。
- 共享夹具：`shared/observation/observationUri.fixtures.ts`（28 条 parse 用例含非法/非字符串输入 + 4 条 formatter 用例）。服务端 `server/modules/observation/tests/observation-store.test.ts`、前端 `src/modules/cockpit/tests/observationUri.test.ts` 各自用同一份夹具驱动自己那一侧的入口，并断言该入口拿到的是共享实现的同一个函数对象（不是一个副本）。
- 单实现读数：`grep -rn "export function parseObservationUri" --include=*.ts --include=*.tsx --include=*.mjs server src shared` 只命中 `shared/observation/observationUri.ts:111`；`const CLOUDPIT_URI = new RegExp(` 也只在该文件。`cloudpit-runtime-flip.test.ts` AC6 与 `electron/tests/cloudpit-runtime-identity-surfaces.test.mjs` AC4 原本读「两份文本逐字相同」，改为读「只有 shared 一份实现，两侧 shim 只再导出、不重述语法」。
- 实跑（本 worktree）：`observation-store.test.ts` 11/11 绿；`cloudpit-runtime-flip.test.ts` 11/11 绿；`cloudpit-runtime-identity-surfaces.test.mjs` 10/10 绿；`src/modules/cockpit/tests/observationUri.test.ts` 26/26 绿；结构闸 `server-import-cycle-budget.test.ts` + `frontend-import-cycle-budget.test.ts` + `architecture-ratchet.test.ts` 同批 24/24 绿（AC-394 的 unresolvedInternal 仍在 19 预算内：`@shared/*` 对它的解析器属 external；新文件均未触 800 行 / 模块级可变状态棘轮）。`npm run typecheck` 的两个项目与 `oxlint` 对改动文件均退出 0。
- 该轴仍暗,理由:本任务只是把重复的 URI 解析器搬进 repo-root shared/ 并由两侧再导出，没有改变领域数据能力或模块依赖方向，L_D/L_G 没有本轮可记的新读数（结构侧以 AC-394 与前端 cycle 棘轮实跑读数为准）。

## AC
- [x] `.quay/routine-findings.jsonl` 中 finding `dup-parse-observation-uri`（routine `architecture-analysis`，runId `architecture-analysis-1794055077651`）所描述的问题被复核并处置
- [x] 处置结论可核：要么修掉，要么写明「已有机制在管、失败在哪一步」，⛔ 不以「已注意到」结案

## DoD
- [x] 上面的判据实跑通过
- [x] ⛔ 探针只立案不执行：本任务若需要跑产出者/修复，由派发链执行，⛔ 不由例程代跑

## Touches
- `shared/observation/observationUri.ts` (new)
- `shared/observation/observationUri.fixtures.ts` (new)
- `server/modules/observation/core/observation-uri.ts`
- `src/modules/cockpit-contract/observationUri.ts`
- `server/modules/observation/tests/observation-store.test.ts`
- `server/shared/tests/cloudpit-runtime-flip.test.ts`
- `src/modules/cockpit/tests/observationUri.test.ts`
- `electron/tests/cloudpit-runtime-identity-surfaces.test.mjs`
- `tasks/gap-routine-architecture-analysis-dup-parse-observation-uri.md`

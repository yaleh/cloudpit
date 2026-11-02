---
id: gap-routine-architecture-analysis-dup-settings-expected-version-readers
title: "architecture-analysis: Fresh archguard duplicate group 1be6c2743c82f132
  (scope server): readExpectedVersion (lines 27-46) and
  readCockpitSessionStartVersion (lines 315-334) are byt"
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
Fresh archguard duplicate group 1be6c2743c82f132 (scope server): readExpectedVersion (lines 27-46) and readCockpitSessionStartVersion (lines 315-334) are byte-identical 20-line / 138-token bodies — same INVALID_VERSION / VERSION_REQUIRED AppErrors and same body-or-If-Match fallback — so the save-precondition contract is implemented twice in one feature module.

载体记录（逐字来源）：`.quay/routine-findings.jsonl` · routine `architecture-analysis` · probe `architecture-analysis` · runId `architecture-analysis-1793622946064` · ts `2026-11-02T12:35:46.064Z`。

该 finding 由例程的机械通道产出，本任务由**同一条通道**依赖 `plugin/scripts/routine-file-gate.ts` 的三道闸
（quality / dedup / rate）机械立案 —— ⛔ 不是由人转抄，也不是由探针自行执行。

- 观测符号：`readExpectedVersion`、`readCockpitSessionStartVersion`
- 涉及文件：
- `server/modules/settings/codex-model-providers.service.ts:27`
- `server/modules/settings/settings.service.ts:315`
- kind：`duplication`
- verdict：`confirmed`

## Requested action
Extract one readExpectedVersion(body, headerVersion) into server/shared/settings-file.ts and import it from both services; AC: archguard_detect_duplicates(scope=server) no longer reports hash 1be6c2743c82f132 and the existing settings version-conflict tests keep both error codes covered.

## Effect Prediction
- metric: concept_recurs_after_merge
- expected: false
- statement: 修复后 `<none>` 不再以同一 subject 复发（同 concept_key 的后续记录数应为 0）
- recorded_at: 2026-11-02T12:35:46.064Z

## Disposition
处置结论：修掉（实现已提交在任务分支，交由 fan-in 合入 develop）。
- 复验（archguard `detectDuplicates`，scope `server (typescript)`，同一实现/参数）：修改前报告 hash `1be6c2743c82f132`，成员正是 `codex-model-providers.service.ts:27-46`（name=readExpectedVersion）与 `settings.service.ts:315-334`（name=readCockpitSessionStartVersion）；修改后同一次扫描不再出现该 hash，也没有按这两个符号命名的组，组数 5 → 4。
- 实现：`server/shared/settings-file.ts` 新增并导出 `readExpectedVersion(body, headerVersion)`；`codex-model-providers.service.ts` 与 `settings.service.ts` 删除各自副本并改为 import 该共享实现。
- 测试：`cockpit-session-start-settings.routes.test.ts` 的拒绝表新增 `INVALID_VERSION` 臂（`VERSION_REQUIRED` 原本已在）；`codex-model-providers-settings.test.ts` 新增一条同时钉住 `VERSION_REQUIRED` 与 `INVALID_VERSION` 的用例。实跑该三份文件：26 tests / 26 pass / 0 fail。
- 机械检查：`tsc --noEmit -p server/tsconfig.json` exit 0；`oxlint` 对改动文件 exit 0；architecture-ratchet 与 server-import-cycle-budget 18/18 pass。

## AC
- [x] `.quay/routine-findings.jsonl` 中 finding `dup-settings-expected-version-readers`（routine `architecture-analysis`，runId `architecture-analysis-1793622946064`）所描述的问题被复核并处置
- [x] 处置结论可核：要么修掉，要么写明「已有机制在管、失败在哪一步」，⛔ 不以「已注意到」结案

## DoD
- [x] 上面的判据实跑通过
- [x] ⛔ 探针只立案不执行：本任务若需要跑产出者/修复，由派发链执行，⛔ 不由例程代跑

## Touches
- `server/modules/settings/codex-model-providers.service.ts`
- `server/modules/settings/settings.service.ts`
- `server/shared/settings-file.ts`
- `server/modules/settings/tests/cockpit-session-start-settings.routes.test.ts`
- `server/modules/settings/tests/codex-model-providers-settings.test.ts`
- `tasks/gap-routine-architecture-analysis-dup-settings-expected-version-readers.md`

## ADR-007 axis
该轴仍暗,理由:本任务处置 archguard duplication 组 1be6c2743c82f132，L_D/L_G 两根轴都不测量重复组，无可引用读数。
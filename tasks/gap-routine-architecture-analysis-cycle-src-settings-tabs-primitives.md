---
id: gap-routine-architecture-analysis-cycle-src-settings-tabs-primitives
title: "architecture-analysis: 5-member SCC: the settings shell (Settings.tsx)
  statically imports its five tab directories while every tab imports the
  shell's form primitives (SettingsCard"
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
5-member SCC: the settings shell (Settings.tsx) statically imports its five tab directories while every tab imports the shell's form primitives (SettingsCard/Row/Section/Toggle, PremiumFeatureCard) — 22 back-edges.

载体记录（逐字来源）：`.quay/routine-findings.jsonl` · routine `architecture-analysis` · probe `architecture-analysis` · runId `architecture-analysis-1793090640570` · ts `2026-10-27T08:44:00.570Z`。

该 finding 由例程的机械通道产出，本任务由**同一条通道**依赖 `plugin/scripts/routine-file-gate.ts` 的三道闸
（quality / dedup / rate）机械立案 —— ⛔ 不是由人转抄，也不是由探针自行执行。

- 观测符号：`Settings`、`AppearanceSettingsTab`、`BrowserUseSettingsTab`、`GitSettingsTab`、`TasksSettingsTab`、`SettingsCard`、`SettingsRow`、`SettingsSection`、`SettingsToggle`
- 涉及文件：
- `src/modules/settings/Settings.tsx:9`
- `src/modules/settings/Settings.tsx:12`
- `src/modules/settings/tabs/AppearanceSettingsTab.tsx:6`
- `src/modules/settings/tabs/browser-use-settings/BrowserUseSettingsTab.tsx:7`
- `src/modules/settings/tabs/git-settings/GitSettingsTab.tsx:6`
- `src/modules/settings/tabs/tasks-settings/TasksSettingsTab.tsx:4`
- kind：`dependency-cycle`
- verdict：`confirmed`

## Requested action
Move SettingsCard/SettingsRow/SettingsSection/SettingsToggle/PremiumFeatureCard into a leaf src/modules/settings/ui/ that both the shell and the tabs import; AC: the SCC over settings* packages is gone and Settings.tsx still renders all five tabs.

## Effect Prediction
- metric: concept_recurs_after_merge
- expected: false
- statement: 修复后 `<none>` 不再以同一 subject 复发（同 concept_key 的后续记录数应为 0）
- recorded_at: 2026-10-27T08:44:00.570Z

## AC
- [ ] `.quay/routine-findings.jsonl` 中 finding `cycle-src-settings-tabs-primitives`（routine `architecture-analysis`，runId `architecture-analysis-1793090640570`）所描述的问题被复核并处置
- [ ] 处置结论可核：要么修掉，要么写明「已有机制在管、失败在哪一步」，⛔ 不以「已注意到」结案

## DoD
- [ ] 上面的判据实跑通过
- [ ] ⛔ 探针只立案不执行：本任务若需要跑产出者/修复，由派发链执行，⛔ 不由例程代跑

## Touches
- `src/modules/settings/Settings.tsx`
- `src/modules/settings/tabs/AppearanceSettingsTab.tsx`
- `src/modules/settings/tabs/browser-use-settings/BrowserUseSettingsTab.tsx`
- `src/modules/settings/tabs/git-settings/GitSettingsTab.tsx`
- `src/modules/settings/tabs/tasks-settings/TasksSettingsTab.tsx`
- `tasks/gap-routine-architecture-analysis-cycle-src-settings-tabs-primitives.md`
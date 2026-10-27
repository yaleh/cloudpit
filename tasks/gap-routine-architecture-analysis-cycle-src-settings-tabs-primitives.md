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

## 处置记录（2026-10-27）

**复核（修前读数，archguard package 粒度）**：在 `develop@5e5e1074f` 的独立 baseline worktree 上
`archguard_analyze(projectRoot=<baseline>, sources=['src'])` + `archguard_detect_cycles(scope=src, outputScope=package)`，
精确复现 finding 的 5 包 SCC：
`{modules/settings, modules/settings/tabs, modules/settings/tabs/browser-use-settings, modules/settings/tabs/git-settings, modules/settings/tabs/tasks-settings}`，size=5；round 内 cycles=6、maxScc=5。

**处置（修掉）**：把 5 个表单原语从 `src/modules/settings/`（shell 包）移进新的叶子目录
`src/modules/settings/ui/`：`SettingsCard`、`SettingsRow`、`SettingsSection`、`SettingsToggle`、`PremiumFeatureCard`。
`ui/` 只 import `@/shared/utils`、`@/shared` 与第三方包，不 import settings shell/tabs/hooks。
6 个消费方改为从 `@/modules/settings/ui/*` 取用：`AppearanceSettingsTab`、`BrowserUseSettingsTab`、
`GitSettingsTab`、`TasksSettingsTab`，以及 finding 未点名但同样持有回边的 `VoiceSettingsTab`、`AboutTab`。
`Settings.tsx` 未改动 —— 它只 import tab 目录，不需要原语；shell→tabs 的单向边保留，回边消失。
目录级 import 图（tabs → settings）已无原语边；tabs→settings/hooks 是单向边，hooks 不回指 tabs。

**修后读数（本 worktree 实跑）**：
- `archguard_analyze(projectRoot=<worktree>, sources=['src'])` + `archguard_detect_cycles(scope=src, outputScope=package)`：
  cycles=5、maxScc=5；**含 `modules/settings` 的环 = 0**（修前 1 个 size=5 的环，成员如上）。
- `npx tsc --noEmit -p tsconfig.json` → exit 0。
- `bash scripts/with-memory-cap.sh npx vitest run src/modules/settings/tests` → 13 files / 66 tests 全绿。
- `npx oxlint src/modules/settings` → exit 0（仅既有 warning）。
- 真实页面（隔离实例 + worktree Vite 源码）：Settings 弹窗逐个点击 Appearance / Git / Tasks / Browser / About / Voice，
  每个 tab 的正文渲染、侧栏高亮落在被点项，`pageerror=0`、console error=0。截图与 JSON 读数：
  `tmp/settings-tabs-dod/{appearance,git,tasks,browser,about,voice}.png`、`tmp/settings-tabs-dod/report.json`。

**ADR-007 Architecture axis**
- L_G archguard: maxScc=5 cycles=5 settingsSccCount=0 before_maxScc=5 before_settingsSccCount=1 (scope=src, outputScope=package, baseline=develop@5e5e1074f)

## AC
- [x] `.quay/routine-findings.jsonl` 中 finding `cycle-src-settings-tabs-primitives`（routine `architecture-analysis`，runId `architecture-analysis-1793090640570`）所描述的问题被复核并处置
- [x] 处置结论可核：要么修掉，要么写明「已有机制在管、失败在哪一步」，⛔ 不以「已注意到」结案

## DoD
- [x] 上面的判据实跑通过
- [x] ⛔ 探针只立案不执行：本任务若需要跑产出者/修复，由派发链执行，⛔ 不由例程代跑

## Touches
- `src/modules/settings/Settings.tsx`
- `src/modules/settings/tabs/AppearanceSettingsTab.tsx`
- `src/modules/settings/tabs/browser-use-settings/BrowserUseSettingsTab.tsx`
- `src/modules/settings/tabs/git-settings/GitSettingsTab.tsx`
- `src/modules/settings/tabs/tasks-settings/TasksSettingsTab.tsx`
- `src/modules/settings/tabs/AboutTab.tsx`
- `src/modules/settings/tabs/VoiceSettingsTab.tsx`
- `src/modules/settings/ui/PremiumFeatureCard.tsx`
- `src/modules/settings/ui/SettingsCard.tsx`
- `src/modules/settings/ui/SettingsRow.tsx`
- `src/modules/settings/ui/SettingsSection.tsx`
- `src/modules/settings/ui/SettingsToggle.tsx`
- `tasks/gap-routine-architecture-analysis-cycle-src-settings-tabs-primitives.md`
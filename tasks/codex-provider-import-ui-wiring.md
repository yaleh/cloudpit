---
id: codex-provider-import-ui-wiring
title: Codex 导入 provider 的父级接线：挂到设置页 + 一键绑定到模型编辑器的 codexProviderId
status: done
labels:
  - feature
parent: null
children: []
extra: {}
depends_on:
  - codex-provider-settings-ui
  - codex-provider-import-user-profile
---
<!-- dedup-ref --> 机制去重：codex-provider-import-user-profile（done）交付了只读解析 + CodexProviderImport.tsx 组件本体，但「挂到设置页 + 接模型编辑器 codexProviderId」的父级接线被该任务显式排除在 Touches 外（其实现说明逐字写明）。本条是那条 UI 接线的补全，机制是 DOM 挂载与绑定流，不是 TOML 解析。

## Proposal

**现状**：CodexProviderImport.tsx 已交付（reading + onBind(providerId) 契约、逐行未知字段告警、bindable/不可绑定原因），但没有任何父组件挂载它；模型编辑器的 provider 选择器也收不到它的 onBind。用户无法从设置页「一键绑定」导入的 provider 到模型条目。

**范围**：
1. 把 CodexProviderImport 挂到 Settings → Agents → Codex 的服务商设置区（CodexProvidersContent），列出只读导入的 provider 与 bindable 状态。
2. onBind(providerId) 接到模型编辑器的 codexProviderId：点「绑定」即把该 provider 设为当前编辑模型条目的 provider 选择值，保存后落库。
3. 复用既有 useCodexProviders / codexProvidersController，不新写状态机；provider 差异继续走 PROVIDER_DESCRIPTORS 数据，不写 provider === 'codex' 分支。

## Touches

- src/modules/settings/tabs/agents-settings/sections/content/CodexProvidersContent.tsx
- src/modules/settings/tabs/agents-settings/sections/content/CodexProviderImport.tsx
- src/shared/ui/ModelLibraryPanel.tsx
- src/modules/settings/tabs/agents-settings/sections/content/ModelsContent.tsx
- src/modules/settings/tests/codexProviderImportWiring.test.tsx（新判据，红先行）
- scripts/ui-scenarios/codex-provider-import.json
- tasks/codex-provider-import-ui-wiring.md

## AC

- [x] 判据绿：npx vitest run src/modules/settings/tests/codexProviderImportWiring.test.tsx 退出 0、fail 0。
- [x] 负臂：绑定动作把 codexProviderId 写进模型条目（保存后回读一致）；bindable=false 的导入行「绑定」禁用；未挂载/未接线时必红。

## DoD

真实浏览器走一遍（场景运行器 + 一次性 Playwright 驱动，截图存 tmp/）：设置页看到导入的 bob provider（bindable + 未知字段告警），点「绑定」后模型编辑器 provider 选择器选中 bob 并可保存；pageErrors=[]。

## 实现说明

- **父级挂载**：`CodexProvidersContent` 渲染 `CodexProviderImport`（AC-466 的挂载保留）；`onBind` 现在先发布一条 `CodexProviderBindRequest`（providerId + requestId），再调用既有 `bindImportedProvider`，请求经 `ModelsContent` 传到 `ModelLibraryPanel`。
- **绑定流**：`ModelLibraryPanel` 仅在 Codex provider picker 正在绘制、且该 provider 已出现在 registry reading 时把选择值改成该 id；被服务端拒绝的导入（provider 不出现）不会移动 picker；同一 id 再绑由 requestId 重放。保存时随 `config.codexProviderId` 落库，重开条目即回读（判据有断言）。状态机仍在 `codexProvidersController`，本次未新增 state 机；未新增 provider === 'codex' 分支（picker 由 `PROVIDER_DESCRIPTORS[...].modelConfigKind` 决定）。
- **判据**：新增 `src/modules/settings/tests/codexProviderImportWiring.test.tsx`（2 条腿）。红先行读数：实现前在 `picker.value === 'bob'` 处红（expected bob / received ''），实现后 `Test Files 1 passed | Tests 2 passed`；兄弟文件 `codexProviderSettings/modelLibrarySave/modelLibrarySettings/modelLibraryDuplicate/codexProviderAdvancedUi` 共 30 条全绿；`npx tsc --noEmit -p tsconfig.json` 0 错误；改动文件 `npx oxlint` 仅既有 `react/set-state-in-effect` warn。
- **场景**：`scripts/ui-scenarios/codex-provider-import.json` 去掉手动 `modelLibrary.selectCodexProvider` 步骤，bind 后直接断言 `codexModelProvider: "bob"`。
- **证据（`tmp/ui-codex-import-wiring/`）**：场景报告 `ok:true, failedStep:null, stepCount:5, durationMs:4608`，checkpoint `step-1-open-settings-agents-codex.png`、`step-2-drive-codexProvider.import.png`、`step-5-drive-modelLibrary.save.png`；一次性 Playwright 手动探针 `dod-1-import-panel.png`、`dod-2-picker-selected.png`（picker `"" → "bob"`）、`dod-3-saved-bound-model.png`（行标签 `DoD Imported Model · bob`，项目 settings 文件 providers `["bob"]`）。读数：bindable=true、env_key 只显示变量名 `BOB_API_KEY`、未知字段告警可见、pageErrors=[]（控制台 4 条 403 资源加载与侧栏既有 validateDOMNesting 警告与本次改动无关）。

## ADR-007

该轴仍暗,理由:本任务只做设置页内的 DOM 挂载与绑定交接，不移动模块边界或依赖图，也不产出 ArchGuard 的周期/分层实测读数。
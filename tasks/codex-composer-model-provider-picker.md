---
id: codex-composer-model-provider-picker
title: composer 模型菜单渲染 model×provider 单选择项并发送 model + provider id
status: done
labels:
  - feature
parent: null
children: []
extra: {}
goal_ac: AC-469
---
<!-- dedup-ref --> 机制去重：composer 模型菜单已有 ComposerModelMenu + useChatProviderState.selectProviderModel；本条只把选项身份从 model 扩成 model+modelProviderId，不新开 provider 下拉框。

## Proposal

**现状**：ComposerModelMenu 渲染 modelOptions（ProviderModelOption[]），key=option.value，onSelectModel(option.value)；useChatProviderState 以 providerModels[provider] 存单字符串 model，selectProviderModel 只发 model（useChatProviderState.ts:630-680）。ProviderModelOption 无 modelProviderId 字段。

**范围**：
1. src/shared/types.ts 给 ProviderModelOption 加 modelProviderId?: string|null（wire 镜像，同步 wireContractTypeSync）。
2. useChatProviderState：选项身份改为 (value, modelProviderId)；选中变体时 selectProviderModel 携带 model + modelProviderId（裸名 modelProviderId=null）；存储按 provider 记 (model, modelProviderId)。
3. ComposerModelMenu 按 model 分组渲染内置模型（裸名 + 每个 (provider) 变体）与自定义模型（单条）；收起态按钮显示合成标签 gpt-5.6-terra (fjdac)。
4. 前端不写 provider === 'codex' 分支：分组/变体来自目录数据。

## Touches

- tasks/codex-composer-model-provider-picker.md
- src/modules/chat-composer/composer/ComposerModelMenu.tsx
- src/modules/chat-composer/composer/ChatComposer.tsx
- src/modules/chat-session/hooks/useChatProviderState.ts
- src/modules/chat/ChatInterface.tsx
- src/shared/types.ts
- src/shared/api.ts
- src/shared/tests/wireContractTypeSync.test.ts
- server/shared/tests/architecture-ratchet.baseline.json
- src/modules/chat/tests/composerModelProviderOption.test.tsx（新）

## AC

- [x] AC-469 判据绿：npx vitest run src/modules/chat/tests/composerModelProviderOption.test.tsx 退出 0。
- [x] 正臂：内置模型展开裸名+每个 (provider) 变体、自定义模型单条；选中变体 selectProviderModel 携带 model+modelProviderId；收起态按钮显示 gpt-5.6-terra (fjdac)。
- [x] 负臂：裸名选择不带 modelProviderId；未知/已删 provider 变体不渲染。
- [x] 假形态：仍按 provider 分组或两个下拉框红；provider === 'codex' 分支红。

## DoD

MCP 浏览器实际操作 + 截图存 tmp/（composer 选 gpt-5.6-terra (fjdac) 并发送）；scripts/ui-scenario.mjs 场景报告 + 检查点截图；pageErrors=[]。vitest 单文件绿 + npm run typecheck + lint。

## ADR-007

- L_D 该轴仍暗,理由:本任务是 composer 选择器 UI，读数是 AC 判据与场景运行器，没有可量化的领域数据轴读数。
- L_G 该轴仍暗,理由:本任务不新增 goal 判据；目标层读数由 GOAL-056 的 AC-469 承担。

## Evidence

- AC-469 判据：`npx vitest run src/modules/chat/tests/composerModelProviderOption.test.tsx` → 1 file passed / 8 tests passed，exit 0（用例 a/b/c/c2/c3/d/d2/d3 覆盖展开、变体发送、裸名不带 id、已删 provider 无行、按 model 分组、claude 同形、无 provider === 'codex' 分支）。
- wire 镜像：`npx vitest run src/shared/tests/wireContractTypeSync.test.ts` → 5 tests passed，exit 0。
- `npm run typecheck`（tsconfig + server/tsconfig + scripts/tsconfig）→ exit 0。
- `npx oxlint` 本任务 7 个文件 → exit 0（仅存量 warning）。
- 合并解冲突：`server/shared/tests/architecture-ratchet.baseline.json` 取 develop note + 本任务 RECORDED CHANGE 段；oversizeFiles 两侧各自新增互不相交（本任务 4 条 / develop 2 条）取并集，无 re-key 删除；JSON 校验通过，diff MERGE_HEAD 仅本任务 5 行。
- anti-drift Touches：`anti-drift-touches-check` → OK，8 个实际文件全部在声明的 Touches 内。
- UI DoD（MCP 浏览器，tmp/ui-dod/）：`01-session-loaded.png` … `06-message-sent.png` 六张检查点截图；`report.json` 记录 groups=10 / rows=20、选中变体 `GPT-6.1-Sol (fjdac)`、收起态触发标签同值、发送后 composer 清空，写路径 body `{"model":"gpt-6.1-sol","modelProviderId":"fjdac"}`，`pageErrors=[]`；场景运行器报告与检查点截图见 `tmp/ui-dod/scenario/report.json` 与 `step-1..3-*.png`。
- 上一轮 exited-not-landed 的 Blocker（baseline 合并冲突）已在本轮解冲突后清除。
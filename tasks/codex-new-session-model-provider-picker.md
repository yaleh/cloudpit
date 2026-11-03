---
id: codex-new-session-model-provider-picker
title: 新建会话 Model Selector 渲染 model×provider 单选择项
status: done
labels:
  - feature
parent: null
children: []
extra: {}
goal_ac: AC-470
---
<!-- dedup-ref --> 机制去重：新建会话选择器已有 ProviderSelectionEmptyState + ModelGroupList；本条把分组从 provider 改成 model、选项身份扩成 model+modelProviderId，不新开对话框。

## Proposal

**现状**：ProviderSelectionEmptyState 的 Model Selector 用 ModelGroupList 按 provider 分组（PROVIDER_META 四组），handleModelSelect(provider, model) 只传 model（ProviderSelectionEmptyState.tsx:186-195）；ModelGroup 类型 { key, provider, name, models } 与 onSelect(provider, model) 只支持 provider 分支。

**范围**：
1. ModelGroupList 支持按 model 分组的组（key 区分模型与 provider 变体），选项渲染 (provider) 后缀，onSelect 传 (provider, model, modelProviderId)。
2. ProviderSelectionEmptyState 对 codex 按 model 分组（内置模型裸名+变体、自定义单条），其余 provider 保持现状；选中变体写 provider + model + modelProviderId。
3. 收起态卡片显示合成标签（当前 provider · model (provider)）。

**实现说明**：分组判据取自目录数据而非 provider id——某 provider 的目录里只要有行声明了上游 provider（`modelProviderId`，或旧目录的 `config.codexProviderId`），该 provider 就按 model 分组；否则保持单 provider 组。这样 AC-468 展开的内置模型变体自动生效，前端不写 `provider === 'codex'`（GOAL-056 架构红线）。`ProviderModelOption` 增加 `modelProviderId?: string | null`（wire 镜像）。

## Touches

- tasks/codex-new-session-model-provider-picker.md
- src/modules/chat/transcript/ProviderSelectionEmptyState.tsx
- src/modules/chat-support/components/ModelGroupList.tsx
- src/modules/chat/tests/newSessionModelProviderOption.test.tsx（新）
- src/shared/types.ts
- src/shared/utils.ts

## AC

- [x] AC-470 判据绿：npx vitest run src/modules/chat/tests/newSessionModelProviderOption.test.tsx 退出 0。
- [x] 正臂：codex 按 model 分组渲染内置模型裸名+变体、自定义单条；选中变体写 provider+model+modelProviderId；收起态卡片显示合成标签。
- [x] 负臂：其余 provider 分组不变；未知 provider 变体不渲染。
- [x] 假形态：codex 仍按 provider 分组或两个下拉框红。

## DoD

MCP 浏览器实际操作 + 截图存 tmp/（新建会话选 gpt-5.6-terra (fjdac) 并发送）；scripts/ui-scenario.mjs 场景报告 + 检查点截图；pageErrors=[]。vitest 单文件绿 + npm run typecheck + lint。

### Evidence（2026-11-03）

- 判据：`npx vitest run src/modules/chat/tests/newSessionModelProviderOption.test.tsx` → 7 passed，退出 0（7 例覆盖：按 model 分组、裸名+变体+自定义单条标签、选中三元组、收起态合成标签、仅选中变体打勾、其余 provider 分组不变、假形态）。
- `npm run typecheck`（client + server + scripts 三份 tsconfig）通过；`npm run lint` 退出 0（532 条全仓既有 warning，改动文件 0 条）。
- 真实页面（隔离实例 :3319，`dist-server` 由本 worktree 构建，已含已落地的 AC-468 目录展开；worktree vite :5234 代理到该实例；`CODEX_SETTINGS_PATH` 指向 `tmp/iso-picker/codex.settings.json`，工程注册 provider `fjdac`；未触碰真实 `~/.config/cloudpit`）：
  - `tmp/dod-picker/02b-picker-codex.png`：Codex 目录按 model 分组（每组 count=2），行 `GPT-5.6-Terra` 与 `GPT-5.6-Terra (fjdac)` 并列；`tmp/dod-picker/02-picker.png` 显示 claude 仍是单个 Anthropic 组。读数（`tmp/dod-picker/report.json`）：`commandRoots=1`、`selects=0`、codexGroups 为 8 个 `codex:model:*`、terra 行 providerId 依次 `null/fjdac`。
  - `tmp/dod-picker/03-selected.png`：选中后收起态卡片 `Codex · GPT-5.6-Terra (fjdac)`，底部 ready 文案 `Ready to use Codex with gpt-5.6-terra`。
  - `tmp/dod-picker/04-sent.png`：消息已发送并渲染，页面进入 `/session/38e13f61-45cf-4cd7-8fda-106fd81ad0fb`；`pageErrors=[]`，console 仅既有 validateDOMNesting 警告与 GitHub API 403（与本改动无关）。
  - 场景运行器：现有 `scripts/ui-scenarios/` 无覆盖新建会话 Model Selector 的场景，运行器的 opener/drive 词表也没有该视图入口（要新增语义面，超出本任务 Touches），因此本腿无场景报告，改用上面的一次性 Playwright 驱动（本会话无 MCP 浏览器工具时的等价路径）。
- **残余（如实记录）**：首次发送的 create 请求体仍是 `{provider, projectPath, initialMessage, model, effort, permissionMode, lifecycleMode}`——不含 `modelProviderId`；落库会话 `38e13f61…` 的 `model`=gpt-5.6-terra 但 `model_provider_id`=NULL。选择器已把三元组交给 host 回调，但「首发把 provider id 送到会话行」属于 composer/发送链路（AC-469）与服务端发送漏斗，不在本条 Touches 内；本条未在 UI 之外伪造该绑定。

### Evidence（2026-11-03 续做轮，合并 develop 后复验）

- 上轮 exited-not-landed 的唯一红点是 `architecture-ratchet.test.ts: oversizeFiles src/shared/types.ts 5002→5010`。真因是分支滞后：兄弟任务 `codex-composer-model-provider-picker` 已把同名 `modelProviderId` wire 字段落到 develop，并把该文件基线上调到 5010；本分支仍持有旧基线 5002。将 develop 合入（26 提交）后，`types.ts` 冲突仅是同一注释的换行差异，取语义并集（字段两侧一致，取较窄换行），合并后 5010 行 = 基线，不再上调。
- 复验：`architecture-ratchet.test.ts` 6/6 pass（`src/shared/types.ts` 不再出现在上调节目；其余打印均为 `可下调基线`）；`newSessionModelProviderOption.test.tsx` 7/7 pass；`npm run typecheck` 退出 0；`npm run lint` 退出 0（仅既有 warning）；anti-drift Touches 检查 `ANTI-DRIFT OK — 5 actual file(s), all within declared Touches`。
- AC 状态不变（4/4），AC-470 判据与正/负/假形态四臂均由上述 7 例覆盖。

## ADR-007

- L_D 该轴仍暗,理由:本任务是新建会话选择器 UI，读数是 AC 判据与场景运行器，没有可量化的领域数据轴读数。
- L_G 该轴仍暗,理由:本任务不新增 goal 判据；目标层读数由 GOAL-056 的 AC-470 承担。

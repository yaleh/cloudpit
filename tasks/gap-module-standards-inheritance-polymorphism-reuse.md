---
id: gap-module-standards-inheritance-polymorphism-reuse
title: 模块标准补继承/多态/复用/去重/契约规则，并以已落地的重构为正例
status: todo
labels:
  - gap
parent: null
children: []
extra:
  schema: execution
---
## Proposal

<!-- dedup-ref --> 相关已完成任务（本任务引用其产物作正例，机制不同：只改标准文本）：`gap-settings-file-shared-reader`、`gap-llm-gateway-leaf-module`、`gap-provider-capability-facets-replace-name-branches`、`gap-frontend-external-store-lru-clock-primitives`、`gap-wire-type-sync-criteria`、`gap-server-features-store-encapsulation`、`gap-service-line-ratchet-module-standard`、`gap-backend-state-lifecycle-encapsulation-standard`。

现状（2026-10-26 实测）：两份标准已有 barrel、260 行 ratchet、后端状态属主、前端 React-free controller 四类规则，但继承、多态、复用、去重、wire 契约五个维度没有规则，前端也没有「模块级可变状态必须有属主」这一条。缺规则的后果已被量到：server 曾有 21 处、前端约 35 处按 provider id 分支；LLM 客户端长在 reply-suggestions 里被 quay 与 observation 借用；4 份近似克隆的 settings 读取器（两份之间 138 行相同）；`isRecord` 17 处定义；11 份手写外部 store；前后端 wire 类型靠注释 Mirrors 手抄。对应重构已经完成，所以本任务写规则时直接点名真实存在的正例，而不是指向尚不存在的组件。

要写的规则：

后端 `.agents/skills/backend-module-standards/SKILL.md`：
1. 继承只用于两种情况：模板方法（基类实现流程、子类只填钩子，正例 `McpProvider`、`SkillsProvider`）与 `implements` 一个能力接口；不为复用代码而继承。
2. 多态替代 id 分支：providers/list 之外不新增按 provider id 的分支，补一个 `IProvider*` 能力面（正例 `IProviderShell`、`IProviderTokenUsage`）；协议差异做成策略对象（正例 `server/modules/llm-gateway` 的 `selectProtocol`）。注明当前仍存的少量 id 分支是已知残留，规则约束的是新增。
3. 通用能力不寄生在功能模块：被两个以上功能模块使用的能力提为叶子模块或 `server/shared`（正例 `server/modules/llm-gateway`），新叶子目录同时登记 AC-394 导入环清单。
4. 近似克隆：第二份结构相同的读取器或适配器出现时就抽出共享部分（正例 `server/shared/settings-file.ts` 的 `readBoolean`、`resolveSettingsPath`）；ArchGuard 精确克隆检测阈值看不见被拆小的近似克隆，不能作为「无重复」的证据。
5. Verify 段加机械检查：新增代码在 providers/list 之外不引入 `provider === '<id>'` 分支。

前端 `.agents/skills/frontend-module-standards/SKILL.md`：
1. 模块级可变状态必须有属主：用类或 `createExternalStore` 承载（正例 `ServerFeaturesStore`），不得散在模块顶层被自由函数读写。
2. 共享基础件优先：外部 store、LRU、时钟注入分别用 `createExternalStore`、`createBoundedLru`、`Clock`，不再手写。
3. Provider 差异查 `PROVIDER_DESCRIPTORS` 描述表，不写名字分支。
4. 前后端 wire 类型镜像必须配 TypeSync 判据（正例 `src/shared/tests/wireContractTypeSync.test.ts`）。
5. Verify 段加对应检查。

只改两份 SKILL.md，不改代码。

## AC

- [ ] 后端继承与多态：`grep -cE "McpProvider|IProviderShell" .agents/skills/backend-module-standards/SKILL.md` 输出 ≥ 2，且 `grep -niE "inherit|polymorph" .agents/skills/backend-module-standards/SKILL.md` 有命中。
- [ ] 后端复用与近似克隆：`grep -cE "llm-gateway|settings-file" .agents/skills/backend-module-standards/SKILL.md` 输出 ≥ 2，且 `grep -niE "near-clone" .agents/skills/backend-module-standards/SKILL.md` 有命中。
- [ ] 前端状态、基础件与描述表：`grep -cE "ServerFeaturesStore|createExternalStore|createBoundedLru|PROVIDER_DESCRIPTORS" .agents/skills/frontend-module-standards/SKILL.md` 输出 ≥ 4。
- [ ] 前端 wire 契约：`grep -n "wireContractTypeSync" .agents/skills/frontend-module-standards/SKILL.md` 有命中。
- [ ] 正例全部真实存在：`grep -rlE "class McpProvider|interface IProviderShell|export function selectProtocol|export function resolveSettingsPath|class ServerFeaturesStore|export function createExternalStore|export function createBoundedLru|PROVIDER_DESCRIPTORS:" server/ src/ --include='*.ts' | grep -v node_modules | wc -l` 输出 ≥ 7。
- [ ] 仅改标准：`git diff --name-only -- server/ src/` 无输出，且 `git diff --stat -- .agents/skills/` 只含两份 SKILL.md。

## DoD

用新写的后端多态规则对真实仓库做一次机械自检并贴出读数：在 providers/list 之外统计 `provider === '<id>'` 分支，列出每个残留文件与计数（2026-10-26 立案时为 7 个文件共 10 处），并确认规则文本把它们表述为已知残留而非合规样板；再用前端状态规则对 `src/shared/hooks/useServerFeatures.ts` 自检判为「符合」。贴出两份 SKILL.md 的 diff。

## Touches

- .agents/skills/backend-module-standards/SKILL.md
- .agents/skills/frontend-module-standards/SKILL.md
- tasks/gap-module-standards-inheritance-polymorphism-reuse.md
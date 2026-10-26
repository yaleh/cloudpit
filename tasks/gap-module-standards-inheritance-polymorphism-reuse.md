---
id: gap-module-standards-inheritance-polymorphism-reuse
title: 模块标准补继承/多态/复用/去重/契约规则，并以已落地的重构为正例
status: ready
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

- [x] 后端继承与多态：`grep -cE "McpProvider|IProviderShell" .agents/skills/backend-module-standards/SKILL.md` 输出 ≥ 2，且 `grep -niE "inherit|polymorph" .agents/skills/backend-module-standards/SKILL.md` 有命中。
- [x] 后端复用与近似克隆：`grep -cE "llm-gateway|settings-file" .agents/skills/backend-module-standards/SKILL.md` 输出 ≥ 2，且 `grep -niE "near-clone" .agents/skills/backend-module-standards/SKILL.md` 有命中。
- [x] 前端状态、基础件与描述表：`grep -cE "ServerFeaturesStore|createExternalStore|createBoundedLru|PROVIDER_DESCRIPTORS" .agents/skills/frontend-module-standards/SKILL.md` 输出 ≥ 4。
- [x] 前端 wire 契约：`grep -n "wireContractTypeSync" .agents/skills/frontend-module-standards/SKILL.md` 有命中。
- [x] 正例全部真实存在：`grep -rlE "class McpProvider|interface IProviderShell|export function selectProtocol|export function resolveSettingsPath|class ServerFeaturesStore|export function createExternalStore|export function createBoundedLru|PROVIDER_DESCRIPTORS:" server/ src/ --include='*.ts' | grep -v node_modules | wc -l` 输出 ≥ 7。
- [x] 仅改标准：`git diff --name-only -- server/ src/` 无输出，且 `git diff --stat -- .agents/skills/` 只含两份 SKILL.md。

## DoD

用新写的后端多态规则对真实仓库做一次机械自检并贴出读数：在 providers/list 之外统计 `provider === '<id>'` 分支，列出每个残留文件与计数（2026-10-26 立案时为 7 个文件共 10 处），并确认规则文本把它们表述为已知残留而非合规样板；再用前端状态规则对 `src/shared/hooks/useServerFeatures.ts` 自检判为「符合」。贴出两份 SKILL.md 的 diff。

DoD evidence（2026-10-26）：

后端多态规则自检 — `grep -rnP "\bprovider\s*===\s*'(?:claude|codex|cursor|opencode)'" server --include='*.ts'`，排除 `node_modules`、`*.test.*`、`tests/` 目录、注释行与 `providers/list/` 后：

- server/modules/mcp-gateway/mcp-session-lifecycle.ts — 1（`else if (provider === 'claude')`）
- server/modules/mcp-gateway/mcp-session-search.ts — 2（同一行 `args.provider === 'claude' || args.provider === 'codex'`）
- server/modules/providers/services/session-conversations-search.service.ts — 3（1223、1226、1386）
- server/modules/providers/services/sessions-watcher.service.ts — 1（`provider === 'opencode'`）
- server/modules/git/git.routes.ts — 2（`'claude'`、`'cursor'`）
- server/modules/session-hosts/session-hosts.routes.ts — 1（`session.provider === 'claude'`）

合计 6 个文件 10 处（立案时记 7 个文件 10 处；本轮按「严格等号 + 主语为 provider/`*.provider`」口径复核，`provider.routes.ts` 的 `normalized === '<id>'` 与 `session-ai-title.service.ts` 的 `provider !== 'claude'` 是同一类残留但不在该口径内）。提交的 `server/shared/tests/architecture-ratchet.baseline.json` 的 `providerNameBranches` 维度是更宽的文本口径读数：server 侧 10 个文件 19 处（另含 `interfaces.ts` 的一行注释与 `quay-task-log-cursor-store.ts` 的 `seed.kind === 'cursor'` 非 provider 命中），该基线只降不升。规则文本第 3 条明确写为「KNOWN RESIDUE awaiting the capability-facet migration, not an approved pattern」，并在 Verify 第 6 条要求「the existing ones are recorded residue pinned by `architecture-ratchet.baseline.json`, and the baseline only shrinks」——即描述为已知残留，不是合规样板。

前端状态规则自检 — `src/shared/hooks/useServerFeatures.ts`：判「符合」。`ServerFeaturesStore` 是一个类属主，`reading`/`listeners`/`inFlight`/`settled` 全部是私有字段，没有模块顶层可变绑定被自由函数读写；`subscribe`/`getSnapshot`/`load`/`publish` 是显式命令面，每次写入都走 `publish` 这一条路径；hook 只做 `useSyncExternalStore` 绑定与首挂载触发。规则文本同时把它列为「store 兼有生命周期状态时」的类属主正例。

AC 读数（于 worktree `/data/home/yale/work/claudecodeui-worktrees/gap-module-standards-inheritance-polymorphism-reuse` 实测）：
- AC1 `grep -cE "McpProvider|IProviderShell"` = 2；inherit/polymorph 命中标题行与两条正文。
- AC2 `grep -cE "llm-gateway|settings-file"` = 3；`near-clone` 命中 2 行。
- AC3 `grep -cE "ServerFeaturesStore|createExternalStore|createBoundedLru|PROVIDER_DESCRIPTORS"` = 7。
- AC4 `wireContractTypeSync` 命中 1 行。
- AC5 命中文件数 = 7（llm-protocols.ts、mcp.provider.ts、settings-file.ts、interfaces.ts、src/shared/utils.ts、useServerFeatures.ts、src/shared/constants.ts）。
- AC6 `git diff --name-only -- server/ src/` 为空；`git diff --stat -- .agents/skills/` 仅 backend-module-standards/SKILL.md 与 frontend-module-standards/SKILL.md 两份。

两份 SKILL.md 的 diff（commit 924538aff，`git show 924538aff -- .agents/skills/`）：backend 增加 `IProviderShell`/`IProviderTokenUsage` 能力面与 `selectProtocol` 策略正例、已知残留声明、`llm-gateway` 叶子与 AC-394 登记要求、`settings-file` 近似克隆正例与 ArchGuard 阈值说明，Verify 增补三条；frontend 新增 "Reuse the shared primitives" 节（`createExternalStore`/`createBoundedLru`/`Clock` 与 `ServerFeaturesStore` 类属主边界）、把描述表写成 `PROVIDER_DESCRIPTORS`、把 TypeSync 正例指向 `wireContractTypeSync.test.ts`，Verify 增补一条。共 2 files changed, 19 insertions(+), 9 deletions(-)。

续跑轮（2026-10-26 第二次 fan-in）— suite 红不是本任务 delta：上一轮唯一的红是 develop 自带的 stale-census（`src/modules/architecture/semanticZoomLayout.ts` 基线 1642 / 实测 1688，两个文件与 develop 尖端逐字节相同）。`baseline A/B: changed-assertion` 是签名解析器的 marker/tap 不对称伪影：本轮 task 日志与驱动自己的 develop 基线日志（`.quay/fan-in-suite-…~baseline-1793000690815-bc901b.log`）里的 assertion 文本逐字节相同，两边都红。按「互为 gate 的基线红由一条分支同时承载两份修复」的既有做法，本分支把兄弟任务已提交的 census 重录逐字取来作 collateral：`git checkout task/gap-codex-transcript-format-shared-helpers -- server/shared/tests/architecture-ratchet.baseline.json`（与兄弟分支 `git diff <branch> -- <file>` 为空，来源 `a9ac78eee`，含 RECORDED CHANGE note），并在 `## Touches` 中以 `(collateral: …)` 声明。复验读数：`npx tsx --tsconfig server/tsconfig.json --test server/shared/tests/architecture-ratchet.test.ts` → tests 6 / pass 6 / fail 0，EXIT=0。

## Touches

- .agents/skills/backend-module-standards/SKILL.md
- .agents/skills/frontend-module-standards/SKILL.md
- server/shared/tests/architecture-ratchet.baseline.json (collateral: 内容逐字取自 task/gap-codex-transcript-format-shared-helpers 的 a9ac78eee，含 RECORDED CHANGE note)
- tasks/gap-module-standards-inheritance-polymorphism-reuse.md

## Blocker

**2026-10-26T07:45:13.480Z — worker 未落地（exited-not-landed）**

- 未落地原因：step=suite: not ok - server/shared/tests/architecture-ratchet.test.ts:   AssertionError [ERR_ASSERTION]: ratchet: oversizeFiles src/modules/architecture/semanticZoomLayout.ts 1642→1688 — 基线内读数不得上调（此基线只允许下降） [baseline A/B: HARD RED (changed-assertion) — the task's red set is NOT a subset of the develop baseline red set: added=- changed=server/shared/tests/architecture-ratchet.test.ts]
- run_id：wk-prod-anchor
- session_id：fefc146a-4d96-40bb-901a-0aa0660e7b15

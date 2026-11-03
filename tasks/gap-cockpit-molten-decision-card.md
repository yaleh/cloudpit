---
id: gap-cockpit-molten-decision-card
title: cockpit 熔融需人决策卡：新 kind molten-decision 渲染 + confirm 结晶执行器（不复用 knowledge
  confirm）
status: ready
labels:
  - gap
  - feature
  - cockpit
parent: null
children: []
extra:
  schema: execution
---
## Proposal

**结论：ADR-016 熔融驱动短环的「需人决策」产物在 cockpit 用 kind `molten-decision` 渲染 + `fleet.molten-decide` 执行器结晶。本正文把 GOAL-012 的 wire 契约逐字钉死，替换早先的占位形状（kind `molten`、judgement/conclusion/actions 块、自由 option）。**

### 契约（GOAL-012 已定，逐字）

- 卡面：`kind:'molten-decision'`；`subject:{uri:'quay://molten/<proposalId>', project}`；`situation`（触发语境）；`facts:[{text,ref,observedAt}]`；`molten:{proposalId, project, belief:[...], action:{kind,summary,scope}, taskSpec:{title,proposal,ac,dod,touches}, evidenceRefs:[...]}`；`options: crystallize-task | decline | modify`。
- 执行器：`fleet.molten-decide {attentionId, revision, decision}`，`decision ∈ crystallize-task|decline|modify`；`crystallize-task` 在 project 的 quay store 立 `taskSpec`（本批 project=quay-fleet）；`decline` 关卡不立；`modify` 保持开交回改 spec。

### 为什么不复用 knowledge confirm

cockpit 现有两条卡通道：`knowledge` 卡绑定 `caseId/knowledgeRevision/proposalRevision/factsFingerprint`、confirm 走 `fleet.apply`（apply/modify/defer/not-applicable 词汇）；`decision` 卡是 initiative-decision 的自决审计。熔融决策卡两者都不是——它是「LLM session 产出的需人决策 + dispatch 提议」，没有知识溯源，也不走倡议自决。所以用新 open kind `molten-decision`：渲染复用通用卡片框架（situation/facts/options + confirm bar），confirm 走 `fleet.molten-decide` 结晶，⛔ 不经过 `fleet.apply`、不建 knowledge 块。

### claudecodeui 侧范围（本任务）

1. 新 kind descriptor `molten-decision`（badge/tone/label），`kind` 开放字符串，不塞进 `CockpitCardKind` 已知并集（与 `knowledge`/`digest` 同态）。
2. wire 类型 `CockpitMoltenDecision`（含 `belief`/`action`/`taskSpec`/`evidenceRefs` 子类型）在 `src/shared/types.ts` + `server/shared/types.ts` 两端同步，`cockpitCardTypeSync` 逐字段比对。
3. 投影：fleet 熔融卡 → `kind:'molten-decision'`，`molten` 块逐字透传（`proposalId`/`project`/`belief`/`action`/`taskSpec`/`evidenceRefs`），`taskSpec` 的 ac/dod/touches 不裁剪。
4. options：固定三选 `crystallize-task` / `decline` / `modify`，各 option `action.executor === 'fleet.molten-decide'`、`params = {attentionId, revision, decision}`（decision 为对应枚举值）。
5. confirm 执行器声明 `fleet.molten-decide {attentionId, revision, decision}`；`declaredExecutors` 含该 id。

### 依赖与边界

- 端到端「熔融触发 → 卡 → apply（crystallize-task 立任务）」在 GOAL-012 与本任务都落地后联合复验（待外部）。本任务只做 cockpit 侧渲染 + confirm 声明 + 类型同步，不实现 fleet 侧结晶逻辑。

## AC

- [x] `npx vitest run src/modules/cockpit/tests/CockpitCard.test.tsx` 退出码 0，且新增/扩展用例断言：descriptor `molten-decision` 命中（非默认 other）；熔融决策卡投影后 `kind === 'molten-decision'` 且 `molten` 块逐字节透传（含 `taskSpec.title/proposal/ac/dod/touches` 与 `evidenceRefs`）；options 恰为 `crystallize-task`/`decline`/`modify` 三选，各 option 的 executor 是 `fleet.molten-decide`、params 含 `attentionId`/`revision`/`decision` 且 `decision` 是三者之一；卡片无 knowledge 块。
- [x] `npx oxlint`（改动文件）与 `npx tsc --noEmit -p tsconfig.json && npx tsc --noEmit -p server/tsconfig.json` 退出码 0；`src/shared/tests/cockpitCardTypeSync.test.ts` 退出码 0。
- [x] 只读复核：`git diff` 显示只新增 `molten-decision` descriptor、`molten` 块类型同步、投影透传、`fleet.molten-decide` 执行器声明与三选 options；`git grep -n "fleet.apply" server/modules/cockpit/` 无新增调用；`git grep -n "molten-decision" src/modules/cockpit/cockpitCardDescriptors.ts` 命中新 descriptor。

## DoD

一张熔融决策卡在 cockpit 用 `molten-decision` kind 渲染，`molten` 块（含 taskSpec 全文）逐字透传，confirm 走 `fleet.molten-decide {attentionId, revision, decision}`（decision=crystallize-task 时 fleet 在 project quay store 立 taskSpec；decline 不立；modify 保持开交回改 spec）。真实对象已被操作：GOAL-012 落地后，用一次真实熔融触发产出的卡在浏览器打开、渲染、confirm `crystallize-task` 走新执行器（端到端「熔融触发→卡→apply(立任务)」联合复验，待外部），截图存 `tmp/`。本任务不把「fleet 已立 taskSpec」写成自身 DoD。

## Touches

- src/modules/cockpit/cockpitCardDescriptors.ts
- src/shared/types.ts
- server/shared/types.ts
- server/modules/cockpit/cockpit-fleet-card-projection.ts
- server/modules/cockpit/cockpit-fleet-molten.ts (new)
- server/modules/cockpit/cockpit-fleet-executor.ts
- server/modules/cockpit/cockpit-fleet-card-provider.ts
- src/modules/cockpit/tests/CockpitCard.test.tsx
- src/shared/tests/cockpitCardTypeSync.test.ts
- server/modules/cockpit/tests/cockpit-fleet-card-provider.test.ts
- server/modules/cockpit/tests/cockpit-fleet-executor.test.ts
- server/shared/tests/architecture-ratchet.baseline.json
- src/modules/i18n/locales/*/common.json
- tasks/gap-cockpit-molten-decision-card.md

## Evidence

- AC1 命令 `npx vitest run src/modules/cockpit/tests/CockpitCard.test.tsx src/shared/tests/cockpitCardTypeSync.test.ts` → exit 0，`Test Files 2 passed`，`Tests 107 passed`（CockpitCard 100 + typeSync 7）。熔融用例断言：descriptor `molten-decision` 非 `DEFAULT_COCKPIT_CARD_DESCRIPTOR`（badge `data-kind=molten-decision`、tone `molten`、文案 `MLT`/`Molten decision`）；`molten` 块 `toEqual` 输入（含 `taskSpec.ac/dod/touches` 与 `evidenceRefs`）；options 恰为 `crystallize-task`/`decline`/`modify`，每个 executor=`fleet.molten-decide`、params 含 `attentionId`/`revision`/`decision`；`card.knowledge === undefined` 且渲染后无 knowledge testid。
- 服务端真实投影读数（同一契约在投影层的判据）：`npx tsx --tsconfig server/tsconfig.json --test server/modules/cockpit/tests/cockpit-fleet-card-provider.test.ts server/modules/cockpit/tests/cockpit-fleet-executor.test.ts server/shared/tests/architecture-ratchet.test.ts` → `tests 41 / pass 41 / fail 0`。熔融用例把 `quay-fleet cockpit cards --json` 的 label-less 三选展开重建为可确认选项：`card.kind === 'molten-decision'`、`card.molten` deepEqual 输入块、options 恰为三选且 `params={attentionId:'att-molten-1',revision:2,decision}`、`knowledge===undefined`；fleet 只给 wire（`options: []`）时回退到卡片自身 id/revision（`att-molten-2`/5）。
- AC2：`npx oxlint <11 changed ts/tsx files>` → exit 0；`npx tsc --noEmit -p tsconfig.json` → 0；`npx tsc --noEmit -p server/tsconfig.json` → 0；`architecture-ratchet.test.ts` → `pass 6 / fail 0`（`server/shared/types.ts` 5639 与 `src/shared/types.ts` 5002 停在基线，未上调）。
- AC3：`git diff develop -- server/modules/cockpit/ | grep '^+.*fleet\.apply'` → 无输出（无新增调用）；`git grep -n "molten-decision" -- src/modules/cockpit/cockpitCardDescriptors.ts` → 命中 descriptor 行 `'molten-decision': {`；`anti-drift-touches-check --merge-target develop` → `ANTI-DRIFT OK ... 24 actual file(s), all within declared Touches`。
- 合并读数：`git merge --no-edit develop` → 无冲突（Merge made by the 'ort' strategy）；工作树 clean。
- L_D 该轴仍暗,理由:本任务只交付卡片 kind、wire 类型、投影与执行器声明,读数是 AC 判据与模型类型同步,没有可量化的领域数据轴读数。
- L_G 该轴仍暗,理由:新增的 cockpit-fleet-molten.ts 是 server/modules/cockpit 下的同目录叶子文件,不新增目录、不引入环;架构读数由 AC-394 棘轮与 import-cycle 预算判据承担,本任务不另立图读数。
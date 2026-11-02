---
id: codex-model-entry-provider-binding
title: Codex 模型条目挂 codexProviderId：绑定与校验、目录显示 model · provider
status: done
labels:
  - feature
parent: null
children: []
extra: {}
depends_on:
  - codex-provider-config-surface
goal_ac: AC-461
---
<!-- dedup-ref --> 机制去重：`grep -rliE 'codexProviderId|模型条目.*provider|挂 provider' tasks/` 无同机制任务。与 codex-provider-config-surface（配置面）机制不同：本条是模型条目引用 providerId 的绑定与校验。

## Proposal

**现状**：ProviderModelConfig 只有 { env: [...] }（server/shared/types.ts:542），provider_models.config_json 存 env 行；Codex 模型条目与 Claude 共用 env 编辑器，Codex 端点无法表达。

**范围**：
1. ProviderModelConfig 增 codexProviderId（可选；未声明 = 继承 Codex 全局）。
2. provider-models.service.ts 校验：声明不存在/已删 provider → 可读 409/404（含 provider id），不落库；provider.routes.ts parseModelConfigPayload 透传。
3. 删除/改名 provider 时检查引用（codex-session-provider-id-binding 之前先给可读错误）。
4. 目录合并后自定义模型行带 provider 显示（model · provider），供 UI 区分同名模型。

## Touches

- tasks/codex-model-entry-provider-binding.md
- server/shared/types.ts
- src/shared/types.ts
- src/shared/tests/wireContractTypeSync.test.ts
- server/shared/ports/codex-provider-registry.port.ts (new)
- server/modules/providers/services/provider-models.service.ts
- server/modules/providers/provider.routes.ts
- server/modules/providers/tests/codex-provider-model-binding.test.ts (new)
- server/modules/settings/settings.module.ts
- server/shared/tests/quay-test-script.test.ts
- server/shared/tests/architecture-ratchet.baseline.json
- scripts/suite-duration-baseline.tsv

## AC

- [x] AC-461 判据绿：npx tsx --tsconfig server/tsconfig.json --test server/modules/providers/tests/codex-provider-model-binding.test.ts 退出 0、fail 0。
- [x] 负臂：声明不存在 provider / 已删 provider 拒绝；未声明沿用现行为（passthrough 基线不红）。

## DoD

判据逐字 tests/pass/fail；新 test.ts 撞 quay pin / 时长基线则等量上调并注明；typecheck 绿。

## Verification

- 判据逐字：`npx tsx --tsconfig server/tsconfig.json --test server/modules/providers/tests/codex-provider-model-binding.test.ts` → `tests 7` / `pass 7` / `fail 0`，退出 0（4412ms）。
- 负臂逐条：未知 provider `nobody` → 409 `CODEX_PROVIDER_UNKNOWN`，消息含 `nobody`，catalog 无新行；先绑定 `bob` 再从注册表删除 → update/create 均 409 且原行 model/config 不变；未声明 `codexProviderId` → label 为裸 model、存储 config 无该键、`config` 省略时仍为 null（passthrough 基线）。
- 路由透传：真实 SQLite + 生产 router，POST `config:{env:[],codexProviderId:'bob'}` → 201 且 `config_json` 含 `codexProviderId`；`nobody` → 409 且库中无该行。
- 目录显示：合并目录里自定义行 label 为 `Route Bound · bob`；未声明行为 `Bound Model`。
- 注册表读取经 `shared/ports/codex-provider-registry.port.ts`（settings.module 安装），providers 不 import settings，`server-import-cycle-budget.test.ts` 绿（12/12，G1/G2/G3 未变）；服务不对 provider id 分支，architecture-ratchet 的 providerNameBranches 未变。
- pin / 基线：`server/shared/tests/quay-test-script.test.ts` unknown 496→497、498→499（collected 499→500）；`scripts/suite-duration-baseline.tsv` 追加本判据 4412ms 行；`architecture-ratchet.baseline.json` 的 oversize 三处（provider.routes.ts 1152→1162、server/shared/types.ts 5537→5552、src/shared/types.ts 4927→4935）按 RECORDED CHANGE 上调并记录理由。
- develop 合并后的计数（2026-11-03，本轮 exited-not-landed 的冲突解析）：develop 的 gap-cloudpit-migrate-assets-rewrite 也新增了 `server/modules/cli/tests/asset-migration.service.test.ts` 判据（tree 500 / baseline 451）。union 解析后 tree 501 / baseline 452；`quay-test-script.test.ts` 两个断言随之为 known=3 unknown=498、known=1 unknown=500，该文件 14/14 pass。
- 合并后复跑判据：7/7 pass，fail 0（4253ms）；`provider-models.service.test.ts` + `model-config-write-path.test.ts` + `provider.routes.test.ts` 44/44 pass；`architecture-ratchet` + `cloudpit-goal-exit-gate` 9/9 pass；`wireContractTypeSync` 5/5 pass；anti-drift-touches-check 11 个实际文件全部落在 Touches 内。
- 其它：`tsc --noEmit -p server/tsconfig.json`、`-p tsconfig.json` 均退出 0。

## ADR-007

- 该轴仍暗,理由:本任务未运行 ArchGuard，未产出周期/分层实测读数；新增的 shared/ports 端口按 AC-394 叶子规则不进入任何 SCC，周期读数由 server-import-cycle-budget.test.ts 12/12 绿代替。

## Blocker

**2026-11-02T17:38:49.405Z — worker 未落地（exited-not-landed）**

- 未落地原因：step=merge-develop: Auto-merging scripts/suite-duration-baseline.tsv
CONFLICT (content): Merge conflict in scripts/suite-duration-baseline.tsv
Auto-merging server/shared/tests/quay-test-script.test.ts
CONFLICT (content): Merge conflict in server/shared/tests/quay-test-script.test.ts
Automatic merge failed; fix conflicts and then commit the result.
- run_id：wk-prod-anchor
- session_id：9e0b6954-11cc-464e-9ae4-d7b55874a0f5

---
id: gap-goal-054-ac451-ac452-false-form-legs-unverified-by-criterion
title: AC-451/AC-452 false-form 腿：expect 新增 scope 腿未被 criterion
  验证（brand-allowlist-check 不扫 @yalehwang/cloudcli 与 cli.module.ts）
status: ready
labels:
  - gap
parent: null
children: []
extra:
  schema: execution
goal_ac: AC-451
---
## Proposal

GOAL-054 采纳 (a) 的收尾过程中，为让充分性判官翻 `covered`，AC-451 与 AC-452 的 expect 各扩了两条 scope 腿；但它们的 criterion 目前**不验证**这些新腿，构成 false-form（work 已在 goal 分支落地，test 没坐实）：

- AC-451 criterion = `npx tsx --tsconfig server/tsconfig.json --test scripts/brand-allowlist-check.test.mjs`。`brand-allowlist-check.mjs` 的 token 是 `/CloudCLI|claudecodeui/`，**不含小写包名 `@yalehwang/cloudcli`**；SCANNED_SURFACES 也**缺 `server/modules/cli/cli.module.ts`**（该文件持有 `npm show/update -g @yalehwang/cloudpit`）。故 expect 里「CLI 自更新与 system update 命令改新包、更新路径无 `@yalehwang/cloudcli` 残留」这条腿未被坐实。
- AC-452 criterion = `npx tsx --tsconfig server/tsconfig.json --test server/shared/tests/cloudpit-runtime-flip.test.ts`，需核实是否覆盖 expect 新增的「`CLOUDPIT_*` 成为规范（新名优先、旧 `CLOUDCLI_*` 兼容）」与「IPC/bridge/BroadcastChannel/语义面改新名」。

⚠️ 工作对象是 goal 分支 `goal/GOAL-054`（goal worktree `/data/home/yale/work/claudecodeui-worktrees/goal-GOAL-054/`），不是普通 task worktree——`scripts/brand-allowlist-check.mjs`、`scripts/brand-allowlist-check.test.mjs`、`server/shared/tests/cloudpit-runtime-flip.test.ts` 只在 goal 分支存在（主检出 author/develop 无）。改动须提交到 `goal/GOAL-054` 分支，随 goal merge 落地 develop。

## AC

- [ ] AC1: `scripts/brand-allowlist-check.mjs` 的 SCANNED_SURFACES 含 `server/modules/cli/cli.module.ts`（kind=code），且 token 覆盖小写 `@yalehwang/cloudcli`（或等价包名 token），命中旧包名即 violation；intentional 历史引用（CHANGELOG、release.yml 注释、package-lock、迁移文档）走显式 allowlist span。
- [ ] AC2: `scripts/brand-allowlist-check.test.mjs` 有负向控制：在更新路径（cli.module.ts / cli.service.ts 形）注入 `@yalehwang/cloudcli` 的合成源码，checker 必须报 violation；goal 分支当前树该 criterion 绿。
- [ ] AC3: 核实 `cloudpit-runtime-flip.test.ts` 对 AC-452 expect 新增两条腿（`CLOUDPIT_*` 新名优先/旧 `CLOUDCLI_*` 兼容；IPC/bridge/BroadcastChannel/语义面改新名）要么已覆盖、要么补断言；补上后 goal 分支该 criterion 绿。
- [ ] AC4: 读回 `quay goal show AC-451 --json` 与 `quay goal show AC-452 --json`，其 expect 的新增腿均有对应 criterion 验证（不再 false-form）。

## DoD

goal/GOAL-054 分支上两条 criterion 都绿（`npx tsx --tsconfig server/tsconfig.json --test scripts/brand-allowlist-check.test.mjs` 与 `... server/shared/tests/cloudpit-runtime-flip.test.ts`）；变异（把某更新命令改回 `@yalehwang/cloudcli`）使 AC-451 criterion 红、恢复后绿；AC-451/AC-452 读回 expect 的新腿与 criterion 覆盖一致。

## Touches

- scripts/brand-allowlist-check.mjs (new)
- scripts/brand-allowlist-check.test.mjs (new)
- server/shared/tests/cloudpit-runtime-flip.test.ts (new)
- tasks/gap-goal-054-ac451-ac452-false-form-legs-unverified-by-criterion.md

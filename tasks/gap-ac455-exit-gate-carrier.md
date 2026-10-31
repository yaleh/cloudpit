---
id: gap-ac455-exit-gate-carrier
title: AC-455 目标退出结构门的 goal_ac 承载与整链独立验收
status: ready
labels:
  - gap
parent: null
children: []
extra:
  schema: execution
depends_on:
  - gap-goal-053-exit-structural-gate-not-an-ac
goal_ac: AC-455
---
## Proposal

AC-455（GOAL-053 的目标退出结构门）当前判据在 author 树上实测为红：`2026-10-31T07:29:00Z` 的 goal gate 读数是 `acceptance failed (exit 1) — 缺判据文件：server/shared/tests/cloudpit-goal-exit-gate.test.ts`。该判据文件与冻结基线由 `gap-goal-053-exit-structural-gate-not-an-ac`（status=ready）实现；但那条任务的顶层 `goal_ac` 为空，而 goal driver 的 readTaskFacts 只按顶层 `goal_ac` 统计承载者，所以 AC-455 在驱动侧仍读作「无承载者」，gap 轮会持续重复立案。

<!-- dedup-ref -->本任务与 `gap-goal-053-exit-structural-gate-not-an-ac` 的关系已用顶层 `depends_on` 边声明：上游实现判据文件与基线，本任务只承担 AC-455 的 goal_ac 承载与整链独立验收，不重写判据、不新增模块目录、不往 `server/shared/utils.ts` 加行。两者保持独立：上游是 ready 的实现任务，本任务是 goal 侧的验收承载，验收口径不同。

本任务不改任何生产代码，只运行 AC-455 记录的 criterion 命令并登记读数。AC-455 记录自带 `timeoutMs=150000`，运行整链时同时核对这个时限是否仍足够。

## AC

- [ ] AC1 存在性闸：逐字运行 `for f in server/shared/tests/cloudpit-goal-exit-gate.test.ts server/shared/tests/cloudpit-brand-env.test.ts server/shared/tests/cloudpit-data-root.test.ts server/modules/assets/tests/cloudpit-assets-dual-root.test.ts server/shared/tests/settings-file.test.ts server/shared/tests/image-attachments.test.ts server/modules/assets/tests/image-assets.service.test.ts server/modules/websocket/tests/chat-attachment-filter.test.ts electron/tests/cloudpit-userdata-migration.test.mjs; do [ -f "$f" ] || { echo "缺判据文件：$f" >&2; exit 1; }; done`，退出 0 且输出不含「缺判据文件」。
- [ ] AC2 server 判据文件：`npx tsx --tsconfig server/tsconfig.json --test server/shared/tests/cloudpit-goal-exit-gate.test.ts server/shared/tests/cloudpit-brand-env.test.ts server/shared/tests/cloudpit-data-root.test.ts server/modules/assets/tests/cloudpit-assets-dual-root.test.ts server/shared/tests/settings-file.test.ts server/shared/tests/image-attachments.test.ts server/modules/assets/tests/image-assets.service.test.ts server/modules/websocket/tests/chat-attachment-filter.test.ts` 退出 0，汇总段含 `# fail 0`。
- [ ] AC3 electron 判据文件：`npx tsx --tsconfig server/tsconfig.json --test electron/tests/cloudpit-userdata-migration.test.mjs` 退出 0，汇总段含 `# fail 0`。
- [ ] AC4 类型检查：`npm run typecheck` 退出 0。
- [ ] AC5 静态检查：`npm run lint` 退出 0。
- [ ] AC6 结构门本体：单独运行 `npx tsx --tsconfig server/tsconfig.json --test server/shared/tests/cloudpit-goal-exit-gate.test.ts` 退出 0，汇总段含 `# fail 0`；并在该文件输出中确认目录臂与 utils.ts 臂的负向控制用例都已执行（输出里出现对应的测试名，不是 skip）。
- [ ] AC7 整链复跑：把 AC1–AC5 串成一条命令一次执行，整体退出 0；记录整链实际耗时并与 AC-455 记录的 `timeoutMs=150000` 对比。

## DoD

- 贴出 AC1 的存在性闸命令与实际 `EXIT=0`；不得只声称通过。
- 贴出 AC2 的完整 `# tests` / `# pass` / `# fail` 汇总行（要求 `# fail 0`）。
- 贴出 AC3 的汇总行与实际退出码。
- 贴出 `npm run typecheck` 与 `npm run lint` 的实际退出码。
- 贴出 AC6 的汇总行，以及目录臂、utils.ts 臂两条负向控制的实际测试名与通过状态。
- 贴出 AC7 整链一条命令的 `EXIT=0` 与实测耗时，并给出 `timeoutMs=150000` 是否足够的结论。
- `git diff --name-only develop...HEAD` 只列出 `tasks/gap-ac455-exit-gate-carrier.md`；本任务不改生产代码、不改判据文件与基线。
- 本任务无 UI 改动，不适用浏览器 / UI 场景 DoD。
- 该轴仍暗,理由:本任务只运行 AC-455 判据并登记读数，不改变任何生产读取、默认值或模块依赖边。

## Touches

- tasks/gap-ac455-exit-gate-carrier.md

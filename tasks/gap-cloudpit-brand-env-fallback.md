---
id: gap-cloudpit-brand-env-fallback
title: Cloudpit A1：品牌常量与 CLOUDPIT_* 回退（暗管道，默认行为不变）
status: ready
labels:
  - gap
parent: null
children: []
extra:
  schema: execution
  acceptance: npx tsx --tsconfig server/tsconfig.json --test
    server/shared/tests/cloudpit-brand-env.test.ts
goal_ac: AC-448
---
## Proposal

GOAL-053 的第一条暗管道任务（A1）。只建立品牌常量与 `CLOUDPIT_*` / `CLOUDCLI_*` 读取器，不接线任何生产默认值，因此用户可见行为、默认数据根、设置路径与 `APP_NAME` 都保持原样。

- `src/shared/constants.ts` 增加 `BRAND` 常量：`name: 'Cloudpit'`、`shortName: 'Cloudpit'`、`packageName: '@yalehwang/cloudpit'`、`repository: 'yaleh/cloudpit'`、`scheme: 'cloudpit'`。现有 `CLOUDCLI_WORDMARK_FONT_FAMILY` 不动，UI 也不消费新常量；翻转留给 GOAL-054。
- `server/shared/brand.ts` 新增 `createBrandEnvReader({ env, warn })`：每次 `read(name)` 先读 `CLOUDPIT_<name>`，再回退 `CLOUDCLI_<name>`；返回 `{ value, source: 'new' | 'legacy' | 'absent', key }`。只有命中旧名时才调用 `warn`，同一 reader 对同一 key 只警告一次。空字符串与 `undefined` 一律视为未设置（避免 `.env` 填空值被当成开关）。状态（已警告集合）在工厂闭包里，不放模块级可变绑定。
- 本任务**不**创建生产单例、不接线 CLI/数据库/设置/Electron；A2/A3 负责接线。因此 `createBrandEnvReader` 的消费方暂时只有测试。
- `server/shared/tests/cloudpit-brand-env.test.ts` 新增三臂测试：只旧名、只新名、两者都有；另测都未设置、新名为空串、警告只一次、两个 reader 实例互不影响。`BRAND` 常量用 TypeScript AST 读取 `src/shared/constants.ts` 断言，避免注释或字符串字面量伪装成常量。
- 新增 server 测试文件会把 `collected server test files` 从 482 推到 483，`server/shared/tests/quay-test-script.test.ts` 里两处 `known/unknown` 钉子与注释需要同步（AC2 fixture `known=3 unknown=479 → 480`；AC3 fixture `known=1 unknown=481 → 482`，并补一行说明新增文件）。这是本任务唯一预期的 collateral 文件。

## AC

- [ ] AC1 `npx tsx --tsconfig server/tsconfig.json --test server/shared/tests/cloudpit-brand-env.test.ts` 退出 0；`BRAND` AST 断言读到五个字段且值分别为 `Cloudpit` / `Cloudpit` / `@yalehwang/cloudpit` / `yaleh/cloudpit` / `cloudpit`。
- [ ] AC2 同一测试的三臂通过：只设 `CLOUDCLI_X` 返回旧值与 `source='legacy'` 并警告；只设 `CLOUDPIT_X` 返回新值与 `source='new'` 且不警告；两者同时设置时新名胜出且不警告。
- [ ] AC3 同一测试的边界臂通过：两者都未设置返回 `{ value: undefined, source: 'absent' }`；`CLOUDPIT_X=''` 且 `CLOUDCLI_X='old'` 时回退旧值；同一个 reader 连续读同一旧名只产生一次警告；两个 reader 各自产生一次警告。
- [ ] AC4 `server/shared/tests/quay-test-script.test.ts` 的钉子已更新，`npx tsx --tsconfig server/tsconfig.json --test server/shared/tests/quay-test-script.test.ts` 退出 0，输出含 `known=3 unknown=480` 与 `known=1 unknown=482`。
- [ ] AC5 没有生产接线：`git grep -n 'createBrandEnvReader' -- server src electron` 只命中 `server/shared/brand.ts` 与本任务测试文件；`server/modules/cli/cli.module.ts` 的默认库路径仍为 `.cloudcli/auth.db`，`electron/main.js` 的 `APP_NAME` 仍为 `CloudCLI`。
- [ ] AC6 `npm run typecheck` 退出 0；`npx oxlint src/shared/constants.ts server/shared/brand.ts server/shared/tests/cloudpit-brand-env.test.ts server/shared/tests/quay-test-script.test.ts` 退出 0。

## DoD

- 真实运行新测试并贴出 `tests/pass/fail` 行；不是只声称“测试通过”。
- 贴出三臂与边界臂的逐条读数（至少包含 legacy/new/both/absent/empty/警告计数），并说明每条断言在哪个测试名下。
- 贴出 `git grep -n 'createBrandEnvReader'` 的完整结果，证明没有生产消费方；贴出 `cli.module.ts` 默认路径与 `electron/main.js` `APP_NAME` 的原文行，证明默认值未翻转。
- 贴出 `quay-test-script.test.ts` 的 diff，显示 479→480、481→482 与新增注释；运行该文件贴出末行。
- 贴出 `npm run typecheck` 与 `npx oxlint ...` 的退出码。
- anti-drift：`git diff --name-only develop...HEAD` 只列出 `## Touches` 的文件（含本任务文件）。
- 提交范围只含 Touches；不新增模块目录；不往 `server/shared/utils.ts` 加行。

## Touches

- src/shared/constants.ts
- server/shared/brand.ts (new)
- server/shared/tests/cloudpit-brand-env.test.ts (new)
- server/shared/tests/quay-test-script.test.ts (collateral: server test-file count pins 479/481 → 480/482)
- tasks/gap-cloudpit-brand-env-fallback.md

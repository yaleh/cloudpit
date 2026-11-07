---
id: gap-claude-plugin-skills-ignore-foreign-install-scope
title: 插件技能扫描不按 scope/projectPath 过滤 install record：为 plantuml-js local 安装的
  archguard 0.1.42 被列进当前工作区，且同一组件无 local>project>user 优先级
status: ready
labels:
  - gap
  - defect
parent: null
children: []
extra:
  schema: execution
---
## Proposal

来源：同一次 2026-11-07 复现中发现的第二个泄漏面，与版本目录扫描是不同机制。`listPluginSkills` 只接收 `claudeHomePath`，从不看 install record 的 `scope` / `projectPath`：`~/.claude/plugins/installed_plugins.json` 里 `archguard@archguard` 有一条 `scope: local, projectPath: /data/home/yale/work/plantuml-js, installPath: …/0.1.42`，它属于另一个项目，却被算进本工作区的技能列表（实测 `/archguard:*` 同时出现 0.1.42、0.1.44、0.1.45 三个版本目录）。

本仓已经有一份正确的适用性规则：`server/modules/quay/quay-entrypoint-resolver.ts:285-345` 实现 `enabledPlugins` 的 local > project > user 优先级（缺省视为启用）、`projectPath` 等于项目根才采用 project/local 记录、同 scope 取最近更新的一条。skills provider 现在把这条规则整个漏掉了。按后端模块规范，第二份结构相同的选择器必须抽到 `server/shared/` 由一个实现同时服务两个消费者，而不是在 provider 里复制一遍。

修复方向：把「从 installed_plugins.json 读记录 → 按 workspace 适用性与 enabledPlugins 选出一条候选记录」抽成 `server/shared/plugin-scope.ts`（新文件，避免继续撑大已被 oversize 棘轮钉住的 `server/shared/utils.ts`），让 `quay-entrypoint-resolver.ts` 与 `claude-skills.provider.ts` 共用；skills provider 再按选出的记录读取它的 payload。`appliedScope` 若需进 `ProviderSkill`，只加可选字段，不改已有字段语义。

<!-- dedup-ref -->
与 `gap-claude-plugin-skills-scan-all-cache-versions` 保持分离：那条决定「一个 record 内读哪些目录」，这条决定「哪些 record 适用于本工作区」，验收互不依赖；两条共用 provider 与测试文件，调度器串行，`task-granularity-advice` 的 peers 为空。

## AC

- [ ] 单文件判据 exit 0：`npx tsx --tsconfig server/tsconfig.json --import ./scripts/undici-blocked-ports-preload.mjs --test server/modules/providers/tests/skills.test.ts`。该文件含新增用例：`scope: local` 且 `projectPath` 指向别处的记录完全不贡献技能；`projectPath` 等于本工作区的记录贡献技能。
- [ ] 同文件含优先级用例：同一个 plugin 同时存在 user 与 project（`projectPath` 等于本工作区）两条启用记录时，只采用 project 记录，命令不出现重复条目。
- [ ] 同文件含 `enabledPlugins` 优先级用例：user 设置启用、`<workspace>/.claude/settings.json` 写 false 时该 scope 被跳过；三处都未配置时视为启用。
- [ ] `npx tsx --tsconfig server/tsconfig.json --import ./scripts/undici-blocked-ports-preload.mjs --test server/modules/quay/tests/quay-entrypoint-resolver.test.ts` exit 0（抽取共享规则后 quay 侧行为不变）。
- [ ] `npm run typecheck` exit 0。

## DoD

在真实机器上跑一次本工作区的技能列表，贴出 `/archguard:*` 的 `sourcePath`：只能落在 `0.1.45/`（user 记录），不得出现 `0.1.42/`（plantuml-js 的 local 记录）；同时贴出 `/quay:*` 仍全部来自 `0.31.1/`。再贴一次 `quay-entrypoint-resolver` 的真实解析结果（claudecodeui → user 记录），证明抽取共享规则没有改变入口解析。只贴测试结论不算完成。

## Touches

- server/modules/providers/list/claude/claude-skills.provider.ts
- server/modules/providers/tests/skills.test.ts
- server/shared/plugin-scope.ts (new)
- server/modules/quay/quay-entrypoint-resolver.ts
- server/modules/quay/tests/quay-entrypoint-resolver.test.ts
- tasks/gap-claude-plugin-skills-ignore-foreign-install-scope.md
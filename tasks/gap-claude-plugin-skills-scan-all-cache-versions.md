---
id: gap-claude-plugin-skills-scan-all-cache-versions
title: Claude 插件技能扫描把 installPath 的所有兄弟版本目录当成 payload：18 个缓存版本产出 204 条 plugin
  skill（仅 20 条唯一命令），旧 frontmatter 造出 /quay:quay-init 等幽灵斜杠命令
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

来源：2026-11-07 在本仓主检出的直接复现，不是症状转述。`server/modules/providers/list/claude/claude-skills.provider.ts:148` 用 `listChildDirectories(path.dirname(installPath))` 把 installPath 的**所有兄弟目录**当成插件 payload，而 Claude Code 的 `~/.claude/plugins/cache/<marketplace>/<plugin>/` 下每个版本目录（0.10.0 … 0.31.1，含 `-dev`）都是兄弟。

实测读数（用本仓 `providerSkillsService.listProviderSkills('claude', …)` 直接跑真实 HOME）：

- plugin skill 204 条，唯一命令只有 20 条；`/quay:init` 出现 13 次（0.19.0 … 0.31.1），`/quay:execute` 16 次。
- 已安装版本是 0.31.1（`installed_plugins.json` 的 installPath），但旧版本仍在产出**不同的命令名**：`/quay:quay-init` 来自 0.10.0/0.11.0/0.14.0/0.30.0（0.30.0 的目录是 `quay-init`、frontmatter `name: quay-init`），`/quay:quay-cold-start`、`/quay:quay-drivers`、`/quay:quay-loop-driver`、`/quay:quay-manager` 来自 0.10.0–0.14.0。
- composer 的 `dedupeProviderSkills`（`src/modules/chat-composer/hooks/useSlashCommands.ts:62`）只按命令名去重，名字不同就合并不了 ⇒ 斜杠菜单同时出现 `/quay:init` 与 `/quay:quay-init`；Agents → Skills 页的 identity 含 `sourcePath`（`src/modules/skills/hooks/useProviderSkills.ts:115`）⇒ 204 条全量渲染。

修复方向：installPath 自身就是一个完整 payload（真实 0.31.1 下 `skills/` 直接存在），扫描应以它为准；只有当它既无 `skills/` 也无 `commands/` 时才回退兄弟目录，且回退时按 install record 的 `version` 过滤 semver 兄弟（同版本目录保留），非 semver 兄弟（`builtin`、测试里的 `legacy777`）保留以兼容历史布局。夹具 `server/modules/providers/tests/skills.test.ts:123` 的 `legacy777` 钉住了「默认扫兄弟」的旧行为，必须改写为「installPath 无 payload 时的兜底」用例，并新增「旧版本兄弟不得产出技能」的回归。

<!-- dedup-ref -->
与 `gap-claude-plugin-skills-ignore-foreign-install-scope` 保持分离：那条是 install record 的 workspace 适用性（另一个机制、独立验收），两条只共用同一个 provider 文件，调度器会串行，不损失并行度；`task-granularity-advice` 的 peers 为空。

- 该轴仍暗,理由:本任务只改插件的技能发现路径与夹具，AC 内没有 L_D/L_G 探针或读数可记，两轴读数不因本任务变化。

## AC

- [x] 单文件判据 exit 0：`npx tsx --tsconfig server/tsconfig.json --import ./scripts/undici-blocked-ports-preload.mjs --test server/modules/providers/tests/skills.test.ts`。该文件含新增用例：同一插件的 `0.30.0` 与 `0.31.1` 两个缓存目录并存、install record 指向 `0.31.1` 时，旧目录里的技能名（`quay-init`）不出现在结果里，`/plugin:init` 只出现一次。
- [x] 同一文件含兜底用例：install record 的 installPath 自身既无 `skills/` 也无 `commands/` 时，仍能从未带版本号的兄弟目录（`legacy777`）读到技能；同一父目录下另一个 semver 且不等于 record `version` 的兄弟目录仍被跳过。
- [x] `npm run typecheck` exit 0。

## DoD

在真实机器上用真实 `~/.claude` 跑一次 `providerSkillsService.listProviderSkills('claude', { workspacePath: '/data/home/yale/work/claudecodeui' })`，贴出 plugin skill 的命令清单与 sourcePath：`/quay:quay-init`、`/quay:quay-cold-start`、`/quay:quay-drivers`、`/quay:quay-loop-driver`、`/quay:quay-manager` 全部消失；每个 `/quay:*` 命令只出现一次且 sourcePath 落在 `0.31.1/`；plugin skill 总数从 204 降到已安装版本的实测值。只贴测试结论不算完成。

实测（2026-11-07，修复后的 worktree 用真实 HOME 运行 `providerSkillsService.listProviderSkills('claude', { workspacePath: '/data/home/yale/work/claudecodeui' })`）：

- plugin skill 总数 204 → **18**（唯一命令 15）；其中 `/quay:*` 12 条。
- 幽灵命令全部消失：`/quay:quay-init` 0 次、`/quay:quay-cold-start` 0 次、`/quay:quay-drivers` 0 次、`/quay:quay-loop-driver` 0 次、`/quay:quay-manager` 0 次。
- 每个 `/quay:*` 命令只出现一次，sourcePath 全部落在 `~/.claude/plugins/cache/quay/quay/0.31.1/skills/<name>/SKILL.md`。
- 命令清单：`/quay:cold-start`、`/quay:drivers`、`/quay:execute`、`/quay:extension-point-refactor`、`/quay:init`、`/quay:loop-driver`、`/quay:manager`、`/quay:quay-directive`、`/quay:quay-file-task`、`/quay:quay-native-methodology`、`/quay:quay-task-operator`、`/quay:quay-task-to-plan`。

## Touches

- server/modules/providers/list/claude/claude-skills.provider.ts
- server/modules/providers/tests/skills.test.ts
- tasks/gap-claude-plugin-skills-scan-all-cache-versions.md
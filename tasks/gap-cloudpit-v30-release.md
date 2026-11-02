---
id: gap-cloudpit-v30-release
title: Cloudpit v3.0.0 发布准备：checker 版本化、release notes 补全、workflow/桌面资产、AC-458 复验
status: ready
labels:
  - gap
parent: null
children: []
extra:
  schema: execution
depends_on:
  - gap-cloudpit-v30-env-data-settings-removal
  - gap-cloudpit-v30-identity-contract-removal
  - gap-cloudpit-v30-appid-switch-migration
---
## Proposal

v3.0 的三条实现任务（A/B/C）已落 develop，但发布面还没跟上：`package.json` 仍是 2.0.0；分发判据 `scripts/cloudpit-distribution-check.mjs` 的 `NEW_VERSION` 仍硬编码 2.0.0；`docs/operations/cloudpit-v3.0-release-notes.md` 只写了 R5/R7/R8/R9/R11，缺 R1/R2/R3/R13 与 R4 的退场说明。本任务准备 3.0.0 发布，并把外部发布动作留给人工窗口。

仓库侧（worker 可做）：

1. **分发判据版本化**：`scripts/cloudpit-distribution-check.mjs` 的 `NEW_VERSION` / 资产前缀 / GitHub release tag 改为可传版本（默认 `3.0.0`，保留显式 `--version` 覆盖）；`scripts/cloudpit-distribution-check.test.mjs` 的 2.0.0 夹具改为 3.0.0，并保留一条「2.0.0 历史读数不被改写」的说明/夹具。AC-458 已 achieved，其 2.0.0 判据不改写；v3.0 用同一 checker 的版本参数复验。
2. **Release notes 补全**：`docs/operations/cloudpit-v3.0-release-notes.md` 增加 R1（`CLOUDCLI_*` 不再读取）、R2（数据根不再回退，一次性迁移保留）、R3（settings 旧文件只复制一次）、R13（appId 切换到 `ai.cloudpit.desktop` 与安装迁移）、R4（附件双根仍在，`migrate-assets --rewrite` 是后续前置）；写清升级路径：必须先经 2.x（SW 旧缓存、URI 键归一化、旧 token 老化），旧数据/旧安装不自动删除。
3. **Release workflow 文案**：`.github/workflows/release.yml` 的 release name 默认值/描述改为 Cloudpit v3.0.0 语义；确认没有旧 tag 前缀。
4. **预检**：`npm pack --dry-run` 的 tarball 只有 `cloudpit` bin；`node scripts/cloudpit-distribution-check.mjs --version 3.0.0 --json` 在未发布时应只报「3.0.0 未发布」而不能误读 2.0.0；`npm run typecheck` 与 `npx oxlint` 绿。

外部窗口（人执行，worker 不做）：

1. `npx release-it --ci --increment=3.0.0`（release-it 负责 package.json/package-lock/CHANGELOG/tag/GitHub Release/npm publish）。
2. `gh workflow run desktop-release.yml -R yaleh/cloudpit --ref develop -f tag=v3.0.0`，产出 `cloudpit-desktop-3.0.0-*` 与 `cloudpit-local-server-v3.0.0-*`。
3. `GITHUB_TOKEN="$(gh auth login token)" node scripts/cloudpit-distribution-check.mjs --release --version 3.0.0` 必须 `exitCode: 0`、`violations: []`；这一步等价于 AC-458 的 v3.0 复验，不覆盖 AC-458 的历史 2.0.0 读数。

## AC

- [ ] `scripts/cloudpit-distribution-check.mjs` 的版本/资产前缀/tag 由参数或常量 `3.0.0` 驱动，不再有硬编码 2.0.0 的发布目标；`--version 3.0.0` 与默认值行为一致。
- [ ] `scripts/cloudpit-distribution-check.test.mjs` 更新为 3.0.0 夹具，`node --test scripts/cloudpit-distribution-check.test.mjs` 退出 0；测试里保留一条「2.0.0 历史 release 仍可被显式版本读取」的负向/兼容臂，证明没有把历史版本从 checker 里删掉。
- [ ] `docs/operations/cloudpit-v3.0-release-notes.md` 含 R1/R2/R3/R13/R4 五节与「升级路径」节；每节有 breaking/action/rollback 三类信息；明确「R4 附件双根仍保留，等 `migrate-assets --rewrite`」。
- [ ] `.github/workflows/release.yml` 的 release name 默认/描述为 Cloudpit v3.0.0；workflow/资产无 `cloudcli-local-server-*` / `cloudcli-desktop-*` 旧前缀。
- [ ] `npm pack --dry-run` 的 tarball bin 只有 `cloudpit`；`node scripts/cloudpit-distribution-check.mjs --version 3.0.0 --json` 在未发布状态只报 3.0.0 缺失，不把 2.0.0 当当前版本。
- [ ] `package.json` / `package-lock.json` 的版本在发布窗口后为 `3.0.0`（待外部；由 release-it 写入，worker 不手工 publish）。
- [ ] 外部发布完成后 `GITHUB_TOKEN=... node scripts/cloudpit-distribution-check.mjs --release --version 3.0.0` 退出 0、`violations: []`；`v3.0.0` GitHub release 与 `cloudpit-desktop-3.0.0-*` / `cloudpit-local-server-v3.0.0-*` 资产可下载（待外部）。
- [ ] `npm run typecheck` 与 `npx oxlint` 对改动文件退出 0；anti-drift 只列 Touches。

## DoD

- 贴出 checker 版本参数化 diff、3.0.0 夹具运行末行、2.0.0 历史兼容臂读数。
- 贴出 release notes 的章节标题与 R1/R2/R3/R4/R13 关键句。
- 贴出 `npm pack --dry-run` 的 bin 片段、未发布状态下 `--version 3.0.0 --json` 的 violations 读数、workflow 旧 tag 前缀 grep 零命中。
- 贴出 typecheck/oxlint 退出码与 anti-drift。
- 外部发布读数（`release-it` 输出、3.0.0 npm/GitHub/桌面资产、带 token 的 checker `exitCode: 0`）由人窗口执行后贴回；执行者不得代发。
- 本任务不改 UI，不需要 MCP 浏览器截图。

## Touches

- scripts/cloudpit-distribution-check.mjs
- scripts/cloudpit-distribution-check.test.mjs
- docs/operations/cloudpit-v3.0-release-notes.md
- .github/workflows/release.yml
- tasks/gap-cloudpit-v30-release.md

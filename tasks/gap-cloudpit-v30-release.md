---
id: gap-cloudpit-v30-release
title: Cloudpit v3.0.0 发布准备：checker 版本化、release notes 补全、workflow/桌面资产、AC-458 复验
status: needs-human
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
> **RETREATED / 搁置（仓库侧已落 develop；release-it / desktop-release / 3.0.0 checker 待人工窗口，2 条外部 AC 未勾，按任务终态约定 park needs-human）**

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

终态约定：仓库侧落地后本任务的正确终态是 **needs-human**，不是 done。带「（待外部）」的两条 AC 由人窗口执行后勾选；worker 不得 push yaleh、不得触发 workflow、不得 `npm publish`、不得代勾外部 AC。

## AC

- [ ] `scripts/cloudpit-distribution-check.mjs` 的版本/资产前缀/tag 由参数或常量 `3.0.0` 驱动，不再有硬编码 2.0.0 的发布目标；`--version 3.0.0` 与默认值行为一致。
- [ ] `scripts/cloudpit-distribution-check.test.mjs` 更新为 3.0.0 夹具，`node --test scripts/cloudpit-distribution-check.test.mjs` 退出 0；测试里保留一条「2.0.0 历史 release 仍可被显式版本读取」的负向/兼容臂，证明没有把历史版本从 checker 里删掉。
- [ ] `docs/operations/cloudpit-v3.0-release-notes.md` 含 R1/R2/R3/R13/R4 五节与「升级路径」节；每节有 breaking/action/rollback 三类信息；明确「R4 附件双根仍保留，等 `migrate-assets --rewrite`」。
- [ ] `.github/workflows/release.yml` 的 release name 默认/描述为 Cloudpit v3.0.0；workflow/资产无 `cloudcli-local-server-*` / `cloudcli-desktop-*` 旧前缀。
- [ ] `npm pack --dry-run` 的 tarball bin 只有 `cloudpit`；`node scripts/cloudpit-distribution-check.mjs --version 3.0.0 --json` 在未发布状态只报 3.0.0 缺失，不把 2.0.0 当当前版本。
- [ ] `package.json` / `package-lock.json` 的版本在发布窗口后为 `3.0.0`；由 release-it 写入，worker 不手工 publish（待外部）
- [ ] 外部发布完成后 `GITHUB_TOKEN=... node scripts/cloudpit-distribution-check.mjs --release --version 3.0.0` 退出 0、`violations: []`；`v3.0.0` GitHub release 与 `cloudpit-desktop-3.0.0-*` / `cloudpit-local-server-v3.0.0-*` 资产可下载（待外部）
- [ ] `npm run typecheck` 与 `npx oxlint` 对改动文件退出 0；anti-drift 只列 Touches。

## DoD

- [x] 贴出 checker 版本参数化 diff、3.0.0 夹具运行末行、2.0.0 历史兼容臂读数。
- [x] 贴出 release notes 的章节标题与 R1/R2/R3/R4/R13 关键句。
- [x] 贴出 `npm pack --dry-run` 的 bin 片段、未发布状态下 `--version 3.0.0 --json` 的 violations 读数、workflow 旧 tag 前缀 grep 零命中。
- [x] 贴出 typecheck/oxlint 退出码与 anti-drift。
- [ ] 外部发布读数（`release-it` 输出、3.0.0 npm/GitHub/桌面资产、带 token 的 checker `exitCode: 0`）由人窗口执行后贴回；执行者不得代发（待外部）
- [ ] 仓库侧 AC 全绿后把任务 park 为 `needs-human`（不是 done），并在 NOTES 里写明「等外部窗口：release-it + desktop-release + checker --release」；外部窗口由人执行（待外部）
- [x] 本任务不改 UI，不需要 MCP 浏览器截图。

## NOTES / 验证记录

仓库侧实现已提交在 `task/gap-cloudpit-v30-release`（commit 8f471d2b1）。

**Checker 版本参数化**（`scripts/cloudpit-distribution-check.mjs`）：
- `NEW_VERSION = '3.0.0'`；新增 `localServerAssetPrefix(version)`，`LOCAL_SERVER_ASSET_PREFIX` 由它派生。
- `distributionViolations(snapshot, { version = NEW_VERSION })`、`collectReleaseSnapshot({ …, version })`、`releaseAssets(…, version)` 的 npm version 文档、unpkg 清单、`releases/tags/v${version}` 与 local-server 资产前缀全部随 `version`；默认值与显式 `--version 3.0.0` 同判。
- `parseArgs` 新增 `--version <x.y.z>`（semver 校验，非法值 exit 2）；`usage()` 记录默认值与历史版本读法；JSON 输出带 `version`。
- 3.0.0 夹具运行末行：`tests 9 / pass 9 / fail 0`（`node --test scripts/cloudpit-distribution-check.test.mjs`）。
- 2.0.0 历史兼容臂：`node scripts/cloudpit-distribution-check.mjs --release --version 2.0.0 --json` → `exitCode: 0`、`violations: []`（历史 release 未被删掉）；同一 2.0.0 夹具在默认 3.0.0 下红在 `new package @yalehwang/cloudpit@3.0.0 is not published`，证明默认不会把 2.0.0 当当前版本。

**Release notes**：`docs/operations/cloudpit-v3.0-release-notes.md` 章节标题：
`R1 Environment variables`、`R2 Data root`、`R3 Settings file`、`R13 Desktop app identity`、`R4 Attachment dual root (retained in 3.0)`、`R9 OAuth scope`、`R5/R7 Observation URIs`、`R8/R11 MCP server name`、`Upgrade path`。
五个退场节各含 `**Breaking**` / `**Action**` / `**Rollback**`（grep 计数 5/6/6，多出的一条属于 R9 的 rollback）；R4 明写「deliberately still present in 3.0 … deferred until the `cloudpit migrate-assets --rewrite` prerequisite lands」；升级路径明写必须先经 2.x（SW `claude-ui-*` 缓存、URI 键归一化、旧 token 90 天老化），且旧数据/旧安装不自动删除。

**预检读数**：
- `npm pack --dry-run`：`package.json` bin = `{"cloudpit":"dist-server/server/modules/cli/cli.js"}`（唯一 bin）；当前 tarball 仍为 `@yalehwang/cloudpit@2.0.0`（版本号由外部 release-it 写入）。
- 未发布状态 `--release --version 3.0.0 --json`：`exitCode: 1`，violations 只含 3.0.0：`new package @yalehwang/cloudpit@3.0.0 is not published`、`tarball bin … found []`、`cloudpit-desktop-* … missing`、`cloudpit-local-server-v3.0.0-* … missing`；`cloudpit@2.0.0 is not published` 命中数 0。
- 默认 `--release --json` 与 `--version 3.0.0 --json` 的 `version=3.0.0`、`exitCode` 与 violations 完全一致。
- `.github/workflows/release.yml`：`increment.default = "3.0.0"`，`release_name.description` 写明 v3.0.0 release 名为 `Cloudpit v3.0.0`；`grep -rn 'cloudcli-local-server-|cloudcli-desktop-' .github/` 零命中（exit 1）。
- `npm run typecheck` → exit 0；`npx oxlint scripts/cloudpit-distribution-check.mjs scripts/cloudpit-distribution-check.test.mjs` → exit 0；anti-drift：`4 actual file(s), all within declared Touches (5 glob(s))`。

**等外部窗口：release-it + desktop-release + checker --release。** 外部 AC 保持未勾（（待外部）），worker 未 push yaleh、未触发 workflow、未 `npm publish`、未代勾。

## ADR-007

该轴仍暗,理由:本任务是发布准备（checker 版本参数化、release notes 与 workflow 文案），不改变模块依赖或可量化的文档/图轴，无 L_D/L_G 读数。

## Touches

- scripts/cloudpit-distribution-check.mjs
- scripts/cloudpit-distribution-check.test.mjs
- docs/operations/cloudpit-v3.0-release-notes.md
- .github/workflows/release.yml
- tasks/gap-cloudpit-v30-release.md

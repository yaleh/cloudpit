---
id: gap-goal-054-post-merge-release-window
title: GOAL-054 post-merge 发布窗口：仓库侧分发身份与 release 资产命名先落地，再执行旧包 1.42.0
  deprecate→仓库改名→新包 2.0.0→桌面资产，使 AC-458 转绿
status: todo
labels:
  - gap
parent: null
children: []
extra:
  schema: execution
goal_ac: AC-458
---
## Proposal

### 缺口读数（2026-11-02，develop `810b3847d`，现场重跑）

`node scripts/cloudpit-distribution-check.mjs --release --json` → `exitCode: 1`，10 条 violations，六组里四组红：

- `old-package`：`@yalehwang/cloudcli@1.42.0 is not deprecated`。registry 单版本文档 404，dist-tags 仍 `{"latest":"1.41.0"}` ⇒ 1.42.0 从未发布，不可能被 deprecate。SPEC §6.2 的退路是 deprecate 1.41.0，但 AC-458 逐字要求 1.42.0，本任务按 1.42.0 执行。
- `new-package` / `tarball-bin`：`@yalehwang/cloudpit` packument 为 `Not found`；tarball bin 读到 `[]`。
- `repository`：`gh repo view yaleh/cloudpit` → `Could not resolve to a Repository`（full_name 为空）；同时**本地 `package.json` 的 `homepage` / `repository.url` / `bugs.url` 仍全部指向 `yaleh/claudecodeui`**——判据的这三项读的是本地 `package.json`（`scripts/cloudpit-distribution-check.mjs:484-486`），不是 npm 元数据。
- `desktop-assets`：`cloudpit-desktop-*` 与 `cloudpit-local-server-v2.0.0-*` 均缺失。
- `ownership`（README 的 fork-of siteboon 声明、NOTICE/LICENSE 的 `CloudCLI UI`）是唯一绿组。

### 为什么前序任务没兜住

<!-- dedup-ref -->
`gap-goal-054-post-merge-distribution-ac`（done）只造了 AC-457 的离线判据载体；`gap-goal-054-postmerge-verification-in-scope-ac`（done）只把 AC-454 换成创建即 active 的 AC-458。两者都写明「不执行任何外部发布动作」，因此发布状态从未被推动过。

AC-451（achieved）的判据 `scripts/brand-allowlist-check.test.mjs` 只静态断言 `name` / `bin` / `productName` / `artifactName`；`yaleh/claudecodeui` 的 URL 字段与 release 资产命名不在它的 expect 里，所以它绿着而 AC-458 红着。

更实际的一条：**即使今天把桌面 release 发出来，资产名也对不上 AC-458**。活管线的 server bundle 文件名是 `cloudcli-local-server-${version}-…`（`scripts/release/build-server-bundle.js:112`、`electron/serverInstaller.js:121`、三个 desktop workflow 的 `server_bundle_tag` 与 glob 全是旧名），而 AC-457 已入册的判据要求 `cloudpit-local-server-v2.0.0-`（**带 v**，`scripts/cloudpit-distribution-check.mjs:47`）。v1.41.0 的真实资产 `cloudcli-local-server-1.41.0-win-x64.tar.gz`（`gh release view cloudcli-local-server-v1.41.0 -R yaleh/claudecodeui --json assets`）证明 tag 有 v、文件名无 v。仓库侧必须先改资产命名，否则外部窗口发完仍然红。

因此本条分两段：仓库侧（worker 可验证）+ 外部发布窗口（人 yale，需 npm 凭据/Trusted Publishing 与 GitHub 仓库管理权限）。

### 仓库侧（worker 在本任务分支完成）

1. `package.json`：`homepage` → `https://github.com/yaleh/cloudpit`，`repository.url` → `git+https://github.com/yaleh/cloudpit.git`，`bugs.url` → `https://github.com/yaleh/cloudpit/issues`；`name` / `bin` 已是目标形态，不动。
2. `server/modules/cli/cli.service.ts` 的 Documentation / Report Issues 兜底 URL 同步新仓库。
3. release 资产命名：`scripts/release/build-server-bundle.js` 的 `bundleName` 与 `electron/serverInstaller.js` 的 `getBundleName()` 改为 `cloudpit-local-server-v${version}-${platform}-${arch}.tar.gz`（文件名带 v，与判据前缀一致）；`desktop-release.yml` / `desktop-windows-branch-build.yml` / `desktop-macos-branch-build.yml` 的 `server_bundle_tag=cloudpit-local-server-${TAG|SAFE_REF}` 与 `find … -name 'cloudpit-local-server-v*.tar.gz'` 同步。
4. `electron/serverInstaller.js` 的 `DEFAULT_BUNDLE_BASE_URL` → `https://github.com/yaleh/cloudpit/releases/download`。
5. 兄弟钉子同步：`scripts/release/tests/server-installer-bundle-url.test.mjs`（`FORK_REPO_PATH=yaleh/cloudpit`、`RELEASE_TAG=cloudpit-local-server-v2.0.0`、资产名带 v）与 `scripts/release/tests/fork-release-workflows.test.mjs`（package.json 与 README 的 `/yaleh\/claudecodeui/` 断言改 `/yaleh\/cloudpit/`）。
6. `.release-it.json` 的 `github.releaseName` 与 conventional-changelog header 改 Cloudpit；`.github/workflows/release.yml` 顶部注释与 `release_name` 描述里的 `@yalehwang/cloudcli` / `yaleh/claudecodeui` 同步新名。
7. `README.md` 的 yaleh/claudecodeui 链接改新仓库、`cloudcli-local-server-<version>` 文案改 `cloudpit-local-server-v<version>`；**保留** fork-of `siteboon/claudecodeui` 归属段与 NOTICE/LICENSE 的 `CloudCLI UI`。
8. 不改 `scripts/cloudpit-distribution-check.mjs` 及其测试（AC-457 已 achieved，判据不得放宽）。

### 外部发布窗口（人 yale 执行；worker ⛔ 不 push yaleh、⛔ 不触发 workflow、⛔ 不 npm publish、⛔ 不改 GitHub 仓库名）

顺序来自 SPEC §6.2–6.4 与 `release-runbook-fork-push-and-async-npm-gotchas`：

0. 先手动把本 needs-human 任务分支并入 develop 并 `git push yaleh develop`（release workflow checkout 的是 `yaleh/develop`；quay fan-in 从不 push 到 yaleh）。
1. 旧包最终版，必须在改名之前（旧包 OIDC 绑定旧仓库名）：从 `v1.41.0` 切一次性分支，`package.json` name 保持 `@yalehwang/cloudcli`，用有 npm 凭据的会话 `npx release-it --ci --increment=1.42.0 --git.requireBranch=<该分支>` 发布，再 `npm deprecate '@yalehwang/cloudcli@1.42.0' 'CloudCLI has been renamed to Cloudpit. Install @yalehwang/cloudpit.'`。npm 发布是异步的：以 `registry.npmjs.org/@yalehwang%2fcloudcli/1.42.0` 单版本文档 200 为准，不信 `npm view version` 的缓存。
2. `gh api repos/yaleh/claudecodeui -X PATCH -f name=cloudpit`；`git remote set-url yaleh https://github.com/yaleh/cloudpit.git`。之后 gh 一律显式 `-R yaleh/cloudpit`（gh 默认解析到 `origin`=siteboon）。
3. 在 npm 为新包配置 Trusted Publishing（仓库 `yaleh/cloudpit` + `.github/workflows/release.yml`）。
4. `gh workflow run release.yml -R yaleh/cloudpit --ref develop -f increment=2.0.0` → 发布 `@yalehwang/cloudpit@2.0.0` 并建 GitHub release `v2.0.0`。
5. `gh workflow run desktop-release.yml -R yaleh/cloudpit --ref develop -f tag=v2.0.0` → 上传 `cloudpit-desktop-*`，并建 `cloudpit-local-server-v2.0.0` prerelease（资产 `cloudpit-local-server-v2.0.0-win-x64.tar.gz`）。
6. `node scripts/cloudpit-distribution-check.mjs --release --json` 必须 `exitCode: 0`、`violations: []`。

## AC

- [ ] AC1 身份字段：`node -e "const p=require('./package.json'); console.log(JSON.stringify({name:p.name,bin:Object.keys(p.bin),homepage:p.homepage,repository:p.repository.url,bugs:p.bugs.url}))"` 打印 `name=@yalehwang/cloudpit`、`bin=["cloudpit"]`、三项 URL 均为 `yaleh/cloudpit`；`git grep -n "yaleh/claudecodeui" -- package.json .release-it.json README.md electron/serverInstaller.js scripts/release .github/workflows server/modules/cli/cli.service.ts` 为 0 命中。
- [ ] AC2 资产命名：`npx tsx --tsconfig server/tsconfig.json --test scripts/release/tests/server-installer-bundle-url.test.mjs` 退出 0（3/3），断言 URL 为 `https://github.com/yaleh/cloudpit/releases/download/cloudpit-local-server-v2.0.0/cloudpit-local-server-v2.0.0-win-x64.tar.gz`；`git grep -n "cloudcli-local-server" -- electron/serverInstaller.js scripts/release/build-server-bundle.js .github/workflows/desktop-release.yml .github/workflows/desktop-windows-branch-build.yml .github/workflows/desktop-macos-branch-build.yml README.md` 为 0 命中。
- [ ] AC3 发布守卫：`node --test scripts/release/tests/fork-release-workflows.test.mjs` 退出 0（7/7），其内 package.json 与 README 的仓库断言已指向 `yaleh/cloudpit`；把任一 URL 改回 `yaleh/claudecodeui` 后该测试退出非 0，恢复后复绿（贴两读）。
- [ ] AC4 release 名与说明：`node -e "const r=require('./.release-it.json'); console.log(r.github.releaseName, r.plugins['@release-it/conventional-changelog'].header)"` 为 `Cloudpit v${version}` 且 header 含 `Cloudpit`；`grep -n "CloudCLI UI\|@yalehwang/cloudcli\|yaleh/claudecodeui" .release-it.json .github/workflows/release.yml` 为 0 命中（注释也算）。
- [ ] AC5 判据未放宽：`npx tsx --tsconfig server/tsconfig.json --test scripts/cloudpit-distribution-check.test.mjs` 退出 0（8/8）；`git diff --stat -- scripts/cloudpit-distribution-check.mjs scripts/cloudpit-distribution-check.test.mjs` 为空。
- [ ] AC6 归属声明仍在：`grep -c "fork of" README.md` ≥1 且匹配 `/fork of\s+\[?siteboon\/claudecodeui/i`；`grep -c "CloudCLI UI" NOTICE LICENSE` 各 ≥1。
- [ ] AC7 静态检查：`npm run typecheck` 退出 0；`npx oxlint` 对本次改动文件退出 0（仅基线 warning）。
- [ ] AC8 旧包最终版：`@yalehwang/cloudcli@1.42.0` 已发布且已 deprecate，deprecation 文案含 `@yalehwang/cloudpit`；`node -e` 读 `registry.npmjs.org/@yalehwang%2fcloudcli/1.42.0` 的 `deprecated` 并打印该文案（人工窗口项，人 yale 执行）。
- [ ] AC9 仓库改名：`gh api repos/yaleh/cloudpit --jq .full_name` 打印 `yaleh/cloudpit`（人工窗口项，人 yale 执行）。
- [ ] AC10 新包发布：`@yalehwang/cloudpit@2.0.0` 单版本文档 200，`https://unpkg.com/@yalehwang/cloudpit@2.0.0/package.json` 的 `bin` 键集合恰为 `["cloudpit"]`（人工窗口项，人 yale 执行）。
- [ ] AC11 桌面资产：`gh release view v2.0.0 -R yaleh/cloudpit --json assets` 同时含可下载的 `cloudpit-desktop-*` 与 `cloudpit-local-server-v2.0.0-*` 资产（人工窗口项，人 yale 执行）。
- [ ] AC12 判据终态：`node scripts/cloudpit-distribution-check.mjs --release --json` 退出 0、`violations: []`、`checks` 六项（人工窗口项，人 yale 执行）。

## DoD

- 贴出 AC1/AC2/AC3/AC5 的完整命令末行与退出码；AC3 的两读（改回旧仓库 URL ⇒ 红，恢复 ⇒ 绿）逐字贴出，不用「应该会红」代替。
- 贴出 AC6 的 README/NOTICE/LICENSE 命中行，证明改 README 链接没有删掉 fork 归属段。
- 人工窗口执行后，贴出 AC8–AC12 的读回：旧包 deprecated 文案、`gh api … full_name`、新包 `bin`、`gh release view` 的资产名列表、`--release --json` 的完整输出（`exitCode: 0`、`violations: []`）。终态以真实 registry/GitHub 读数为准，不以「配置改好了」代替发布。
- 仓库侧改动只落在 `## Touches`；不改 `goals/`、不改 AC-458 的 criterion/expect、不放宽 `cloudpit-distribution-check.mjs`。
- 不做任何外部发布动作：push yaleh、workflow dispatch、npm publish、GitHub 改名都留给人工窗口。

## Needs-Human

- 仓库侧（AC1–AC7）完成后，本任务的正确终态是 **needs-human**，不是 done：AC8–AC12 依赖人 yale 执行外部发布窗口（npm 凭据、npm Trusted Publishing、GitHub 仓库改名、workflow dispatch）。worker 做完仓库侧并提交后立即 park，AC8–AC12 保持未勾。
- 人工窗口第一步是把本任务分支并入 develop 并 push yaleh；否则 release workflow 仍从旧 `yaleh/develop` 取树，仓库侧命名改动不会进入发布产物。
- 窗口执行的完整顺序见 `## Proposal` 的「外部发布窗口」；每一步的外部读数写回对应 AC。

## Touches

- tasks/gap-goal-054-post-merge-release-window.md
- package.json
- server/modules/cli/cli.service.ts
- scripts/release/build-server-bundle.js
- electron/serverInstaller.js
- .github/workflows/desktop-release.yml
- .github/workflows/desktop-windows-branch-build.yml
- .github/workflows/desktop-macos-branch-build.yml
- .github/workflows/release.yml
- .release-it.json
- scripts/release/tests/server-installer-bundle-url.test.mjs
- scripts/release/tests/fork-release-workflows.test.mjs
- README.md

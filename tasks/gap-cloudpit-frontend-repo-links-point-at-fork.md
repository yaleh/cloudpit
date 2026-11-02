---
id: gap-cloudpit-frontend-repo-links-point-at-fork
title: Cloudpit 前端仓库链接归 fork：7 个 src 文件的 GitHub/版本检查/星标指向 yaleh/cloudpit，保留上游归属
status: done
labels:
  - gap
parent: null
children: []
extra:
  schema: execution
---
## Proposal

GOAL-054 发布闭环后的孤儿残留：前端 `src/` 的 GitHub 仓库链接仍指上游 `siteboon/claudecodeui`，导致 live 页面 star badge 与版本检查请求 `api.github.com/repos/siteboon/claudecodeui`（经未认证 GitHub API 限流产生 403），About 的版本检查查上游 release。AC-459 覆盖 runtime identity（IPC/bridge/channel/`__cloudcliScenario`），release-window 覆盖 `package.json`/README/workflow/release 资产，两者夹缝里的 `src/` 仓库链接无人接手（对方会话已确认无重复、无计划，可立独立 gap 任务落 develop）。

本任务把**功能链接**（releases/issues/star/版本检查）指向 fork `yaleh/cloudpit`，同时**保留上游归属链接** `https://github.com/siteboon/claudecodeui` 以满足 AC-456 的 e2e 断言。

### 逐文件改动（7 个 src 文件）

- `src/modules/sidebar/Sidebar.tsx:86` — `useVersionCheck('siteboon','claudecodeui')` → `('yaleh','cloudpit')`。
- `src/modules/settings/tabs/AboutTab.tsx:10-11,27` — 拆两个常量：新增 `UPSTREAM_REPO_URL = 'https://github.com/siteboon/claudecodeui'`（仅作「Based on CloudCLI UI」归属链接，AC-456 逐字要求此 URL 仍在 About 的 `a[href]` 集合里）；`GITHUB_REPO_URL` / `GITHUB_ISSUES_URL` 改为 fork（`https://github.com/yaleh/cloudpit` 与 `.../issues/new`）；`useVersionCheck('siteboon','claudecodeui')` → `('yaleh','cloudpit')`；`releasesUrl` 兜底随 `GITHUB_REPO_URL` 变 fork。**不得删除上游链接**：改完后 About 渲染里必须仍有一个 `href="https://github.com/siteboon/claudecodeui"` 的锚点（可放在 License 区，如「Based on CloudCLI UI · Licensed under AGPL-3.0」把前半句做成链接）。
- `src/modules/sidebar/GitHubStarBadge.tsx:6,18` — `GITHUB_REPO_URL` → fork；`useGitHubStars('siteboon','claudecodeui')` → `('yaleh','cloudpit')`。
- `src/modules/sidebar/SidebarFooter.tsx:8` — `GITHUB_REPO_URL` → fork。
- `src/modules/sidebar/SidebarCollapsed.tsx:8` — `GITHUB_ISSUES_URL` → fork。
- `src/modules/auth/AuthScreenLayout.tsx:61` — `href` → fork。
- `src/modules/settings/tests/aboutTabCommunityLinks.test.tsx:24` — `ISSUE_URL` 钉子 → fork。

### 边界与口径

- **403 ≠ 指错仓库**：未认证 GitHub API 60 次/小时限流对 fork 同样成立。本任务只改「请求目标」，**不以「0 条 403」为判据**；验收看请求 URL 已指 fork + 403 时 UI 优雅降级（star badge 静默或显示空、版本检查显示无更新而非崩溃）。是否做「服务端带 token 的代理/缓存」是另一条任务，不在本任务范围。
- 不改 `scripts/brand-allowlist-check.mjs` 的规则表：`siteboon/claudecodeui` 属「旧 URL」allowlist 类别，上游归属链接不红；本任务完成后**复跑** AC-451 的判据确认没误删归属面。
- 不改 `e2e/cloudpit-brand-preview.spec.ts`：AC-456 的断言只要求 About 的 `links` 数组**包含** `https://github.com/siteboon/claudecodeui`，保留一条归属链接即可，spec 不动。
- 不改 `cloudcli.ai` 外部服务链接、`DISCORD_URL`、`appId`、协议。

## AC

- [x] AC1 静态指向 fork：`git grep -n 'siteboon/claudecodeui' -- src/` 的命中只剩 `AboutTab.tsx` 的 `UPSTREAM_REPO_URL` 归属链接（加一行「Based on」锚点）与 `e2e/cloudpit-brand-preview.spec.ts` 的 `UPSTREAM_REPO_URL` 常量；其余 6 个文件零命中；`git grep -n 'useVersionCheck(.siteboon\|useGitHubStars(.siteboon' -- src/` 零命中。
- [x] AC2 About 拆分：`AboutTab.tsx` 有 `UPSTREAM_REPO_URL`（siteboon）与 `GITHUB_REPO_URL`/`GITHUB_ISSUES_URL`（fork）两个常量；渲染中 `href="https://github.com/siteboon/claudecodeui"` 至少出现一次且 `href="https://github.com/yaleh/cloudpit"` 至少出现一次（star 按钮 / GitHub 链接 / releases 兜底）。
- [x] AC3 版本检查与星标归 fork：`useVersionCheck('yaleh','cloudpit')` 在 `Sidebar.tsx` 与 `AboutTab.tsx` 各出现一次；`useGitHubStars('yaleh','cloudpit')` 在 `GitHubStarBadge.tsx` 出现一次。
- [x] AC4 AC-456 回归：`npx playwright test e2e/cloudpit-brand-preview.spec.ts -g "AC-456"` 退出 0（About 仍含 siteboon 归属链接 + AGPL-3.0 行）。
- [x] AC5 AC-451 回归：`npx tsx --tsconfig server/tsconfig.json --test scripts/brand-allowlist-check.test.mjs` 退出 0。
- [x] AC6 测试钉子：`npx vitest run src/modules/settings/tests/aboutTabCommunityLinks.test.tsx` 退出 0；`npm run typecheck` 退出 0；`npx oxlint` 对全部改动文件退出 0。

## DoD

- 真实浏览器（MCP 浏览器，AGENTS.md 强制）：在运行页面上核对 `document.querySelectorAll('a[href*="github"]')` 的去重集合含 `https://github.com/yaleh/cloudpit`（与 `.../issues/new`），打开 Settings → About 核对产品名 Cloudpit、上游归属链接 `siteboon/claudecodeui` 仍在、AGPL-3.0 行仍在；截图存 `tmp/` 并贴出。当前无覆盖「仓库链接」的场景 JSON，写明「无可用场景，使用 MCP 浏览器实测」；若有场景则同时跑 `node scripts/ui-scenario.mjs <scenario.json> …` 贴 JSON 报告。
- 贴出 `git grep -n 'siteboon/claudecodeui' -- src/` 的完整命中，逐条说明哪些是允许的归属常量、哪些已消除。
- 贴出 AC4/AC5/AC6 各判据的 `tests/pass/fail` 行与退出码；AC4 贴 playwright 报告路径与关键行。
- 贴出浏览器截图与检查点读数（URL 集合、About 归属链接存在性）。
- anti-drift：`git diff --name-only develop...HEAD` 只列出 `## Touches` 的文件；不新增模块目录；不改 `scripts/brand-allowlist-check.mjs` 与 `e2e/cloudpit-brand-preview.spec.ts`。
- 不跑全量 suite（会话内 cgroup 8G）；只跑上述有界文件。

## Execution Evidence

- 该轴仍暗,理由:本任务只把前端功能链接指向 fork，未产出设计文档或架构图增量，无 L_D/L_G 可测读数

### AC1 静态指向（实跑）

```
$ git grep -n 'siteboon/claudecodeui' -- src/
src/modules/settings/tabs/AboutTab.tsx:12:const UPSTREAM_REPO_URL = 'https://github.com/siteboon/claudecodeui';
$ git grep -nE "useVersionCheck\(['\"]siteboon|useGitHubStars\(['\"]siteboon" -- src/
(no output, exit 1)
```

唯一命中是 `AboutTab.tsx` 的 `UPSTREAM_REPO_URL`（允许的归属常量，「Based on CloudCLI UI」锚点使用它）；原先 6 处功能链接命中（`AuthScreenLayout.tsx:61`、`AboutTab.tsx:10-11`、`aboutTabCommunityLinks.test.tsx:24`、`GitHubStarBadge.tsx:6`、`SidebarCollapsed.tsx:8`、`SidebarFooter.tsx:8`）已消除。`e2e/cloudpit-brand-preview.spec.ts:40` 的 `UPSTREAM_REPO_URL` 常量未改（不在 `src/` 扫描面，且任务要求 spec 不动）。

### AC2 / AC3

`AboutTab.tsx` 常量：

```
const UPSTREAM_REPO_URL = 'https://github.com/siteboon/claudecodeui';
const GITHUB_REPO_URL = 'https://github.com/yaleh/cloudpit';
const GITHUB_ISSUES_URL = 'https://github.com/yaleh/cloudpit/issues/new';
```

License 区渲染 `<a href={UPSTREAM_REPO_URL}>Based on CloudCLI UI</a> · Licensed under AGPL-3.0`；star 按钮 / GitHub 链接 / releases 兜底都走 `GITHUB_REPO_URL`。渲染读数见下方浏览器检查点（links 同时含 siteboon 与 fork）。

`useVersionCheck('yaleh','cloudpit')`：`Sidebar.tsx:85-87`（多行参数形式）与 `AboutTab.tsx:30` 各一次；`useGitHubStars('yaleh','cloudpit')`：`GitHubStarBadge.tsx:18` 一次。

### AC4（playwright，reporter=list，无 HTML 报告文件）

```
$ npx playwright test e2e/cloudpit-brand-preview.spec.ts -g "AC-456"
[AC-456] readings {"title":"Cloudpit","appleTitle":"Cloudpit","manifest":{"name":"Cloudpit","short_name":"Cloudpit",...},"about":{"productName":"Cloudpit","links":["https://github.com/yaleh/cloudpit/releases","https://github.com/yaleh/cloudpit","https://github.com/yaleh/cloudpit","https://discord.gg/buxwujPNRE","https://github.com/yaleh/cloudpit/issues/new","https://cloudcli.ai/docs/plugin-overview","https://cloudcli.ai","https://cloudcli.ai","https://cloudcli.ai","https://cloudcli.ai","https://github.com/siteboon/claudecodeui"],"licenseLine":"Based on CloudCLI UI · Licensed under AGPL-3.0"}}
  ✓  1 e2e/cloudpit-brand-preview.spec.ts:214:1 › AC-456 goal preview shows the Cloudpit identity on every visible preview surface (9.9s)
  ✓  2 e2e/cloudpit-brand-preview.spec.ts:275:1 › AC-456 false-form rejects injected CloudCLI readings through the same assertion function (2ms)
  2 passed (11.8s)
exit 0
```

### AC5（AC-451 回归）

```
✔ AC1: checker and criterion exist and the real tree has zero violations
✔ AC2: the visible product surfaces carry the Cloudpit value
✔ AC3: distribution identity points at @yalehwang/cloudpit with bin cloudpit
✔ AC4: a real tarball exposes only the cloudpit bin, and a synthetic cloudcli bin is rejected
✔ AC5: the allowlist accepts attribution and rejects product copy, over every declared surface
✔ AC6: injected legacy tokens turn the same scan red and name the file
✔ AC7: the deprecated package name is a violation on update paths
ℹ tests 7
ℹ pass 7
ℹ fail 0
exit 0
```

### AC6

```
$ npx vitest run src/modules/settings/tests/aboutTabCommunityLinks.test.tsx
 ✓ src/modules/settings/tests/aboutTabCommunityLinks.test.tsx (1 test) 27ms
 Test Files  1 passed (1)
      Tests  1 passed (1)
exit 0

$ npm run typecheck
tsc --noEmit -p tsconfig.json && tsc --noEmit -p server/tsconfig.json && tsc --noEmit -p scripts/tsconfig.json
exit 0

$ npx oxlint <7 changed files>
exit 0
```

### DoD 浏览器实测（无 MCP 浏览器；无可用场景 JSON）

本会话未挂载 MCP 浏览器（ToolSearch `browser playwright` 无匹配），`scripts/ui-scenarios/` 无覆盖「仓库链接」的场景文件（现有仅 cockpit/cost/quay-session/session-* 场景），故采用等价的真实浏览器路径：一次性 Playwright spec 驱动同一套真实 Vite client + backend（跑完删除，未进提交、未改 `playwright.config.ts`）。检查点读数：

```
[DOD] landing github hrefs ["https://github.com/yaleh/cloudpit"]
[DOD] about {"productName":"Cloudpit","links":["https://github.com/yaleh/cloudpit/releases","https://github.com/yaleh/cloudpit","https://github.com/yaleh/cloudpit","https://discord.gg/buxwujPNRE","https://github.com/yaleh/cloudpit/issues/new","https://cloudcli.ai/docs/plugin-overview","https://cloudcli.ai","https://cloudcli.ai","https://cloudcli.ai","https://cloudcli.ai","https://github.com/siteboon/claudecodeui"],"licenseLine":"Based on CloudCLI UI · Licensed under AGPL-3.0"}
1 passed (11.7s)
exit 0
```

页面级 `a[href*="github"]` 去重集合含 `https://github.com/yaleh/cloudpit`；About 的 links 同时含 `.../issues/new`（fork）与 `https://github.com/siteboon/claudecodeui`（上游归属）；产品名 Cloudpit；AGPL-3.0 行仍在。截图（`tmp/` 已 gitignore）：

- `tmp/cloudpit-repo-links/landing.png` — 侧栏 star badge + footer `Cloudpit v2.0.0 – Open Source`
- `tmp/cloudpit-repo-links/about.png` — Settings → About（Cloudpit / GitHub / Join Community / Report Issue / Docs）
- `tmp/cloudpit-repo-links/about-attribution.png` — About 底部 `Based on CloudCLI UI · Licensed under AGPL-3.0`
- `tmp/cloudpit-brand-preview/AC-456-{auth,landing,about}.png` — AC4 官方 spec 自带截图

### anti-drift

```
$ node .../anti-drift-touches-check.js --task gap-cloudpit-frontend-repo-links-point-at-fork --worktree <wt> --merge-target develop
ANTI-DRIFT OK: task gap-cloudpit-frontend-repo-links-point-at-fork — 7 actual file(s), all within declared Touches (8 glob(s))
exit 0
```

未新增模块目录；未改 `scripts/brand-allowlist-check.mjs` 与 `e2e/cloudpit-brand-preview.spec.ts`；未跑全量 suite。

## Touches

- src/modules/sidebar/Sidebar.tsx
- src/modules/settings/tabs/AboutTab.tsx
- src/modules/sidebar/GitHubStarBadge.tsx
- src/modules/sidebar/SidebarFooter.tsx
- src/modules/sidebar/SidebarCollapsed.tsx
- src/modules/auth/AuthScreenLayout.tsx
- src/modules/settings/tests/aboutTabCommunityLinks.test.tsx (collateral: ISSUE_URL pin)
- tasks/gap-cloudpit-frontend-repo-links-point-at-fork.md

---
id: gap-cloudpit-frontend-repo-links-point-at-fork
title: Cloudpit 前端仓库链接归 fork：7 个 src 文件的 GitHub/版本检查/星标指向 yaleh/cloudpit，保留上游归属
status: ready
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

- [ ] AC1 静态指向 fork：`git grep -n 'siteboon/claudecodeui' -- src/` 的命中只剩 `AboutTab.tsx` 的 `UPSTREAM_REPO_URL` 归属链接（加一行「Based on」锚点）与 `e2e/cloudpit-brand-preview.spec.ts` 的 `UPSTREAM_REPO_URL` 常量；其余 6 个文件零命中；`git grep -n 'useVersionCheck(.siteboon\|useGitHubStars(.siteboon' -- src/` 零命中。
- [ ] AC2 About 拆分：`AboutTab.tsx` 有 `UPSTREAM_REPO_URL`（siteboon）与 `GITHUB_REPO_URL`/`GITHUB_ISSUES_URL`（fork）两个常量；渲染中 `href="https://github.com/siteboon/claudecodeui"` 至少出现一次且 `href="https://github.com/yaleh/cloudpit"` 至少出现一次（star 按钮 / GitHub 链接 / releases 兜底）。
- [ ] AC3 版本检查与星标归 fork：`useVersionCheck('yaleh','cloudpit')` 在 `Sidebar.tsx` 与 `AboutTab.tsx` 各出现一次；`useGitHubStars('yaleh','cloudpit')` 在 `GitHubStarBadge.tsx` 出现一次。
- [ ] AC4 AC-456 回归：`npx playwright test e2e/cloudpit-brand-preview.spec.ts -g "AC-456"` 退出 0（About 仍含 siteboon 归属链接 + AGPL-3.0 行）。
- [ ] AC5 AC-451 回归：`npx tsx --tsconfig server/tsconfig.json --test scripts/brand-allowlist-check.test.mjs` 退出 0。
- [ ] AC6 测试钉子：`npx vitest run src/modules/settings/tests/aboutTabCommunityLinks.test.tsx` 退出 0；`npm run typecheck` 退出 0；`npx oxlint` 对全部改动文件退出 0。

## DoD

- 真实浏览器（MCP 浏览器，AGENTS.md 强制）：在运行页面上核对 `document.querySelectorAll('a[href*="github"]')` 的去重集合含 `https://github.com/yaleh/cloudpit`（与 `.../issues/new`），打开 Settings → About 核对产品名 Cloudpit、上游归属链接 `siteboon/claudecodeui` 仍在、AGPL-3.0 行仍在；截图存 `tmp/` 并贴出。当前无覆盖「仓库链接」的场景 JSON，写明「无可用场景，使用 MCP 浏览器实测」；若有场景则同时跑 `node scripts/ui-scenario.mjs <scenario.json> …` 贴 JSON 报告。
- 贴出 `git grep -n 'siteboon/claudecodeui' -- src/` 的完整命中，逐条说明哪些是允许的归属常量、哪些已消除。
- 贴出 AC4/AC5/AC6 各判据的 `tests/pass/fail` 行与退出码；AC4 贴 playwright 报告路径与关键行。
- 贴出浏览器截图与检查点读数（URL 集合、About 归属链接存在性）。
- anti-drift：`git diff --name-only develop...HEAD` 只列出 `## Touches` 的文件；不新增模块目录；不改 `scripts/brand-allowlist-check.mjs` 与 `e2e/cloudpit-brand-preview.spec.ts`。
- 不跑全量 suite（会话内 cgroup 8G）；只跑上述有界文件。

## Touches

- src/modules/sidebar/Sidebar.tsx
- src/modules/settings/tabs/AboutTab.tsx
- src/modules/sidebar/GitHubStarBadge.tsx
- src/modules/sidebar/SidebarFooter.tsx
- src/modules/sidebar/SidebarCollapsed.tsx
- src/modules/auth/AuthScreenLayout.tsx
- src/modules/settings/tests/aboutTabCommunityLinks.test.tsx (collateral: ISSUE_URL pin)
- tasks/gap-cloudpit-frontend-repo-links-point-at-fork.md

---
id: gap-cloudpit-brand-check-skip-node-modules
title: brand-lines 扫描跳过 node_modules：修复主检出 brand-allowlist-check 的 60 条缓存误红
status: done
labels:
  - gap
parent: null
children: []
extra:
  schema: execution
---
## Proposal

`gap-cloudpit-code-brand-sweep-and-gateway-rename` 已落 develop（`09759ca69`），但它在**主检出**上把 `brand-allowlist-check` 弄红了：

- `node scripts/brand-allowlist-check.mjs --json` → `exitCode: 1`，**60 条 violations**；
- 60 条全部来自 3 个文件：`server/node_modules/.cache/quay-e2e-build/server-index.<hash>.mjs`（e2e 构建缓存，内容是清扫前的旧 bundle）；
- `node --test scripts/brand-allowlist-check.test.mjs` 因此红 5 个臂：AC1（real tree 零违规）、AC5（allowlist 覆盖面）、AC7（deprecated package）、current docs（real tree green）、AC8（code-wide sweep）。
- 任务 worktree 里没有这个缓存目录，所以当时判据是绿的；主检出上 `server/node_modules` 存在，才暴露。

根因不是清扫漏改，而是新的 `brand-lines` 目录展开（`server/**` 等）递归走完了 `node_modules`。这些缓存是运行时产物，不是 shipped source，也不该被品牌扫描判红。

修复范围：

1. `scripts/brand-allowlist-check.mjs` 的 `brand-lines` 展开：跳过任何路径段为 `node_modules` 的文件（同时跳过 `.git` 段），仍按 `TEXT_EXTENSIONS` 过滤；不删除缓存、不改 allowlist、不放宽真实源码的扫描。
2. 在 `scripts/brand-allowlist-check.test.mjs` 增加确定性的回归臂（不依赖主检出是否恰好有缓存）：
   - 夹具文件 `server/node_modules/.cache/quay-e2e-build/stale.mjs` 含 `CloudCLI` ⇒ 扫描必须绿；
   - 同一夹具里 `server/modules/demo/source.ts` 含 `CloudCLI` ⇒ 扫描必须红。
3. 复核清扫后的其余读数不变：真实源码里只允许 Proposal 白名单的 20 个文件出现 `CloudCLI`（electron 迁移与其测试、`PRISM CloudCLI`、`Based on CloudCLI UI`、`ATTRIBUTION = 'CloudCLI UI'`、checker 自身）。

边界：不删除 `server/node_modules/.cache`；不改产品源码；不新增/放宽任何全局 allowlist span；不改 gateway 改名结果。

## AC

- [x] `node scripts/brand-allowlist-check.mjs --json` 在主检出退出 0、`violations: []`；`readings.brandLineFiles` 不再包含任何含 `node_modules` 路径段的文件（60 → 0）。
- [x] `node --test scripts/brand-allowlist-check.test.mjs` 退出 0，AC1/AC5/AC7/current docs/AC8 全部恢复绿。
- [x] 新增回归臂：`server/node_modules/.cache/.../stale.mjs` 含 `CloudCLI` 时扫描绿；`server/modules/demo/source.ts` 含 `CloudCLI` 时扫描红；两条都由同一测试文件断言。
- [x] 真实源码的允许面不变：`git grep -l "CloudCLI" -- server src electron scripts public` 仍只列白名单文件（约 20 个），且任何非白名单源码注入都会让检查器红。
- [x] `node scripts/list-script-tests.mjs` 仍列出该测试文件；`npx oxlint scripts/brand-allowlist-check.mjs scripts/brand-allowlist-check.test.mjs` 退出 0；anti-drift 只列 Touches。

## DoD

- 贴出修复前 60 条 violations 的聚合（3 个 node_modules 缓存文件）与修复后的 `exitCode: 0` / `violations: []` / `scannedFiles` 读数。
- 贴出修复前 5 个红臂名与修复后 `tests/pass/fail` 末行。
- 贴出两条新回归臂的夹具路径与红/绿读数。
- 贴出 `git grep -l "CloudCLI"` 的 20 文件白名单清单与 oxlint 退出码。
- 不改 UI，不需要 MCP 浏览器截图。

## Evidence

修复前（主检出、旧 checker）：`exitCode: 1`，`violations: 60`，全部落在 3 个 `server/node_modules/.cache/quay-e2e-build/server-index.<hash>.mjs`（每个 20 条）；`brandLineFiles: 2328`。测试：`tests 10 / pass 4 / fail 6`，红臂为 AC1、AC5、AC7、current docs (real tree)、current docs (injected H1)、AC8。

修复后（新 checker，`--root` 指向主检出）：`exitCode: 0`，`violations: 0`，`scannedFiles: 2438`，`brandLineFiles: 2324`，扫描集合中 `node_modules` 路径段文件数 `0`。worktree 内 `tests 11 / pass 11 / fail 0`。

新回归臂夹具：缓存文件 `server/node_modules/.cache/quay-e2e-build/stale.mjs`（内容含 `CloudCLI`）⇒ `exitCode: 0` / `violations: 0` / `cacheScanned: false`；同一夹具的 `server/modules/demo/source.ts` 注入 `CloudCLI` ⇒ `exitCode: 1`，违规定位到 `server/modules/demo/source.ts:1`。

`git grep -l "CloudCLI" -- server src electron scripts public` = 20 个文件（electron 迁移与其 3 个测试、scripts 两个 checker、`server/modules/quay/tests/contracts/README.md`、architecture ratchet 基线、6 个 locale settings、`PluginSettingsTab.tsx`、`AboutTab.tsx`）；`npx oxlint` 退出 0；`list-script-tests` 仍列出 `scripts/brand-allowlist-check.test.mjs`。

## Touches

- scripts/brand-allowlist-check.mjs
- scripts/brand-allowlist-check.test.mjs
- tasks/gap-cloudpit-brand-check-skip-node-modules.md

该轴仍暗,理由:本任务是品牌扫描器的目录展开修复，不改变模块边界或设计文档规模，L_D/L_G 在本次 delta 上无实质读数。

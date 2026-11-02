---
id: gap-cloudpit-current-docs-brand-sweep
title: Cloudpit 当前文档产品名 sweep + 品牌检查器覆盖 README/翻译/架构文档
status: todo
labels:
  - gap
parent: null
children: []
extra:
  schema: execution
depends_on:
  - gap-cloudpit-primary-docs-rename
  - gap-cloudpit-translated-readmes-banner
---
## Proposal

当前有效文档里仍有把本项目叫作 `CloudCLI` 的产品名用法，而 `scripts/brand-allowlist-check.mjs` 目前只覆盖 UI 文案/安装命令行等扫描面，README H1、CONTRIBUTING、翻译 README 与当前架构文档不在扫描面内，所以这些残留一直绿着。

本任务做两件事：

1. **扩展品牌检查器**：在 `scripts/brand-allowlist-check.mjs` 增加一组显式的「当前文档扫描面」：
   - `README.md` 的 H1/正文产品名（不是只扫安装命令行）
   - `CONTRIBUTING.md`
   - 7 份 `docs/README.*.md` 的 H1、logo alt、安装块
   - 当前架构文档：`docs/architecture/cockpit-attention/{01-planes.puml,CARD-PROVIDERS.md,INTERACTION-PRINCIPLES.md,README.md}`、`docs/architecture/knowledge-application/FACT-CONTRACT.md`
   历史面（`docs/proposals/`、`docs/experiments/`、`adr/`、`CHANGELOG.md`、`NOTICE`、`LICENSE`）明确排除。
2. **修当前架构文档的产品名**：把上述 5 份当前文档中作为本项目产品名的 `CloudCLI` 改成 `Cloudpit`；上游包/服务名、代码标识符（如 `CLOUDCLI_WATCHER_MODE`、`cloudcli-resident.slice`、`buildCloudCliSessionName`）保持原样。

依赖：本任务假设 P0（英文主文档）与 P1（翻译 README）已落地，因此扫描面里 README/CONTRIBUTING/翻译文件应已无违规；若它们未落地，本任务只报红不代改，等依赖完成后再跑。

## AC

- [ ] `scripts/brand-allowlist-check.mjs` 新增显式 `CURRENT_DOC_SURFACES`（README H1、CONTRIBUTING、7 份翻译、5 份架构文档）；`scripts/brand-allowlist-check.test.mjs` 至少新增三条 false-form：向 README H1、某份翻译 H1、某份架构文档注入 `CloudCLI` 都必须返回 `exitCode: 1` 并点名文件。
- [ ] 真实树运行 `node scripts/brand-allowlist-check.mjs --root .` 退出 0、`violations: []`，且输出里 `docSurfaces` 计数覆盖上述全部路径。
- [ ] 5 份当前架构文档中作为产品名的 `CloudCLI` 零命中；上游包/服务名与代码标识符不受影响（`git grep -n 'CLOUDCLI_WATCHER_MODE\|cloudcli-resident.slice\|buildCloudCliSessionName'` 仍命中）。
- [ ] 历史面零改动：`docs/proposals/`、`docs/experiments/`、`adr/`、`CHANGELOG.md`、`NOTICE`、`LICENSE` 不在 `git diff --name-only develop...HEAD`。
- [ ] `node --test scripts/brand-allowlist-check.test.mjs` 退出 0；`npm run typecheck` 与 `npx oxlint scripts/brand-allowlist-check.mjs scripts/brand-allowlist-check.test.mjs` 退出 0。
- [ ] anti-drift：`git diff --name-only develop...HEAD` 只列出 `## Touches` 的文件。

## DoD

- 贴出检查器新增扫描面的源码片段与 `docSurfaces` 计数读数。
- 贴出三条 false-form 的注入内容、`exitCode: 1` 与违规消息；再贴真实树 `violations: []` 的绿读数。
- 贴出 5 份架构文档改动前后的 `CloudCLI` 命中数，以及代码标识符仍命中的 grep 读数。
- 贴出 `node --test`、`npm run typecheck`、`npx oxlint` 的退出码。
- 文档改动不需要浏览器实测；若改了 UI 才按 AGENTS.md 补截图。

## Touches

- scripts/brand-allowlist-check.mjs
- scripts/brand-allowlist-check.test.mjs
- docs/architecture/cockpit-attention/01-planes.puml
- docs/architecture/cockpit-attention/CARD-PROVIDERS.md
- docs/architecture/cockpit-attention/INTERACTION-PRINCIPLES.md
- docs/architecture/cockpit-attention/README.md
- docs/architecture/knowledge-application/FACT-CONTRACT.md
- tasks/gap-cloudpit-current-docs-brand-sweep.md

---
id: gap-cloudpit-current-docs-brand-sweep
title: Cloudpit 当前文档产品名 sweep + 品牌检查器覆盖 README/翻译/架构文档
status: done
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

- [x] `scripts/brand-allowlist-check.mjs` 新增显式 `CURRENT_DOC_SURFACES`（README H1、CONTRIBUTING、7 份翻译、5 份架构文档）；`scripts/brand-allowlist-check.test.mjs` 至少新增三条 false-form：向 README H1、某份翻译 H1、某份架构文档注入 `CloudCLI` 都必须返回 `exitCode: 1` 并点名文件。
- [x] 真实树运行 `node scripts/brand-allowlist-check.mjs --root .` 退出 0、`violations: []`，且输出里 `docSurfaces` 计数覆盖上述全部路径。
- [x] 5 份当前架构文档中作为产品名的 `CloudCLI` 零命中；上游包/服务名与代码标识符不受影响（`git grep -n 'CLOUDCLI_WATCHER_MODE\|cloudcli-resident.slice\|buildCloudCliSessionName'` 仍命中）。
- [x] 历史面零改动：`docs/proposals/`、`docs/experiments/`、`adr/`、`CHANGELOG.md`、`NOTICE`、`LICENSE` 不在 `git diff --name-only develop...HEAD`。
- [x] `node --test scripts/brand-allowlist-check.test.mjs` 退出 0；`npm run typecheck` 与 `npx oxlint scripts/brand-allowlist-check.mjs scripts/brand-allowlist-check.test.mjs` 退出 0。
- [x] anti-drift：`git diff --name-only develop...HEAD` 只列出 `## Touches` 的文件。

## DoD

- 贴出检查器新增扫描面的源码片段与 `docSurfaces` 计数读数。
- 贴出三条 false-form 的注入内容、`exitCode: 1` 与违规消息；再贴真实树 `violations: []` 的绿读数。
- 贴出 5 份架构文档改动前后的 `CloudCLI` 命中数，以及代码标识符仍命中的 grep 读数。
- 贴出 `node --test`、`npm run typecheck`、`npx oxlint` 的退出码。
- 文档改动不需要浏览器实测；若改了 UI 才按 AGENTS.md 补截图。

## Dark axis (ADR-007)

- 该轴仍暗,理由:本任务只扩展品牌检查器扫描面并替换当前架构文档中的产品名，不产生 L_D/L_G 轴读数。

## Evidence

- 检查器新增扫描面（`scripts/brand-allowlist-check.mjs`）：导出 `CURRENT_DOC_SURFACES`（14 项：`README.md`、`CONTRIBUTING.md`、7 份 `docs/README.*.md`、5 份当前架构文档），并入 `SCANNED_SURFACES`；README/翻译用新 `doc-head` 抽取（H1 / logo alt / 安装命令），架构文档与 CONTRIBUTING 走全文 `text`。翻译 README 正文保留的上游 `CloudCLI UI` 归属说明不在扫描面内，无需放宽 allowlist。
- 真实树绿读数：`brand-allowlist: files=132 values=35896 localeValues=27324 allowlistHits=20 docSurfaces=14 violations=0`；`--json` 的 `readings.docSurfaceFiles` 恰为上述 14 条路径，`violations: []`、`exitCode: 0`。
- 三条 false-form（测试实跑生产 `runBrandAllowlistCheck`）：
  - `README.md` 注入 `<h1>CloudCLI</h1>` ⇒ `exitCode: 1`，`README.md:3 carries "CloudCLI" outside the brand allowlist: <h1>CloudCLI</h1>`
  - `docs/README.ja.md` 注入 `<h1>CloudCLI（別名 Claude Code UI）</h1>` ⇒ `exitCode: 1`，`docs/README.ja.md:6 carries "CloudCLI" outside the brand allowlist: <h1>CloudCLI（別名 Claude Code UI）</h1>`
  - `docs/architecture/cockpit-attention/README.md` 追加 `CloudCLI 只做只读投影。` ⇒ `exitCode: 1`，`docs/architecture/cockpit-attention/README.md:158 carries "CloudCLI" outside the brand allowlist: CloudCLI 只做只读投影。`
  - 正臂：翻译 README 正文追加 `CloudCLI UI は上流の製品名です。` 仍 `exitCode: 0`（正文不属于 doc-head 扫描面）。
- 5 份架构文档产品名命中数（`git show develop:<file> | grep -c 'CloudCLI'` → 当前）：`01-planes.puml` 4→0；`CARD-PROVIDERS.md` 8→0；`INTERACTION-PRINCIPLES.md` 1→0；`README.md` 13→0；`FACT-CONTRACT.md` 2→0。
- 代码标识符不受影响：`git grep -n 'CLOUDCLI_WATCHER_MODE\|cloudcli-resident.slice\|buildCloudCliSessionName'` 仍命中（`docs/architecture/03-conversation-handoff.md`、`docs/operations/process-isolation-and-memory-caps.md`、`server/modules/debug-agent/tests/debug-agent-external-write.test.ts` 等）。
- 历史面零改动：实现提交 `1c74478de` 的 `git diff --name-only develop...HEAD` 只有 7 个声明的 Touches 文件，`docs/proposals/`、`docs/experiments/`、`adr/`、`CHANGELOG.md`、`NOTICE`、`LICENSE` 均不在其中。
- 退出码：`node --test scripts/brand-allowlist-check.test.mjs` → 0（9 pass / 0 fail）；`npm run typecheck` → 0；`npx oxlint scripts/brand-allowlist-check.mjs scripts/brand-allowlist-check.test.mjs` → 0；anti-drift Touches check → 0（7 actual files，全部在 Touches 内）。

## Touches

- scripts/brand-allowlist-check.mjs
- scripts/brand-allowlist-check.test.mjs
- docs/architecture/cockpit-attention/01-planes.puml
- docs/architecture/cockpit-attention/CARD-PROVIDERS.md
- docs/architecture/cockpit-attention/INTERACTION-PRINCIPLES.md
- docs/architecture/cockpit-attention/README.md
- docs/architecture/knowledge-application/FACT-CONTRACT.md
- tasks/gap-cloudpit-current-docs-brand-sweep.md

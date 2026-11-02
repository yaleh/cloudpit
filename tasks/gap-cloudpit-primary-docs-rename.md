---
id: gap-cloudpit-primary-docs-rename
title: Cloudpit 主文档改名：README H1、CONTRIBUTING、回复建议路径与 nginx 模板注释
status: todo
labels:
  - gap
parent: null
children: []
extra:
  schema: execution
---
## Proposal

Cloudpit 改名已上线，但英文主文档仍残留旧产品名，会误导新用户与贡献者。本任务只改「当前有效」的主文档与配置示例，不改历史账本、NOTICE/LICENSE 与上游归属。

具体缺口（2026-11-02 实测）：

- `README.md:3` 仍是 `<h1>Cloud CLI (aka Claude Code UI)</h1>`，而 logo alt、安装命令、fork 链接都已是 Cloudpit。
- `CONTRIBUTING.md` 标题/正文仍是 `CloudCLI UI`，issues/PR 指 `siteboon/claudecodeui`，clone URL 与目录名仍是 `claudecodeui`。
- `config/reply-suggestions.settings.example.json:44` 与 `docs/operations/reply-suggestions.md:19` 仍写 `~/.cloudcli/reply-suggestions-usage.jsonl`，而代码默认已迁到 `~/.cloudpit`。
- `docs/nginx-subpath-template.conf` 的说明注释仍写 `CloudCLI UI`；`cloudcli_*` 变量名保留以兼容既有配置，但注释要改成 Cloudpit 并写明变量名沿用旧名。

边界：`NOTICE`、`LICENSE` 的 `CloudCLI UI` / Siteboon 归属必须原样保留；README 里上游 `@cloudcli-ai`、`cloudcli.ai`、第三方插件名属于 allowlist，不改；`docs/proposals/`、`docs/experiments/`、`adr/`、`CHANGELOG.md` 是历史账本，不改。

## AC

- [ ] `README.md` 的 H1 逐字为 `<h1>Cloudpit</h1>`；`grep -n '<h1>' README.md` 只命中这一行；README 的 logo alt、安装命令、fork 链接保持现状。
- [ ] `CONTRIBUTING.md` 第一行逐字为 `# Contributing to Cloudpit`，正文中的 `CloudCLI UI` 产品名改 Cloudpit；issues/PR/clone URL 指向 `yaleh/cloudpit`；若保留一行上游归属说明，该行必须明确写 `upstream`/`fork of`，不得再作为贡献入口。
- [ ] `config/reply-suggestions.settings.example.json` 与 `docs/operations/reply-suggestions.md` 都写 `~/.cloudpit/reply-suggestions-usage.jsonl`；这两个文件里 `grep -n '~/.cloudcli'` 为零命中。
- [ ] `docs/nginx-subpath-template.conf` 的说明注释用 Cloudpit；`cloudcli_*` 变量名可保留，但文件里要有一行说明「变量名沿用旧名以兼容既有配置」；`grep -n 'CloudCLI UI' docs/nginx-subpath-template.conf` 为零命中。
- [ ] `node scripts/brand-allowlist-check.mjs --root .` 退出 0；`NOTICE`、`LICENSE`、`docs/proposals/`、`docs/experiments/`、`adr/`、`CHANGELOG.md` 零改动。
- [ ] anti-drift：`git diff --name-only develop...HEAD` 只列出 `## Touches` 的文件。

## DoD

- 贴出 `grep -n '<h1>' README.md`、`head -1 CONTRIBUTING.md`、两处 `~/.cloudpit` 命中、nginx 注释命中与 `CloudCLI UI` 零命中的完整读数。
- 贴出 `node scripts/brand-allowlist-check.mjs --root .` 的末行读数与退出码。
- 贴出 `git diff --name-only develop...HEAD`，逐条对照 Touches；贴出 `git diff --stat` 证明 NOTICE/LICENSE/历史账本零改动。
- 文档改动不需要浏览器实测；若顺手改了任何用户可见 UI，才按 AGENTS.md 补 MCP 浏览器截图与场景报告。

## Touches

- README.md
- CONTRIBUTING.md
- config/reply-suggestions.settings.example.json
- docs/operations/reply-suggestions.md
- docs/nginx-subpath-template.conf
- tasks/gap-cloudpit-primary-docs-rename.md

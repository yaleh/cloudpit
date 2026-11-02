---
id: gap-cloudpit-translated-readmes-banner
title: Cloudpit 翻译 README：7 份上游快照加横幅并修正标题/logo/安装/Issue 链接
status: ready
labels:
  - gap
parent: null
children: []
extra:
  schema: execution
---
## Proposal

7 份翻译 README 仍是上游快照：每份 `Cloudpit` 0 次、`CloudCLI` 35 次，`<img alt="CloudCLI UI">`、H1 为「Cloud CLI（又名 Claude Code UI）」，安装命令仍是 `npx @cloudcli-ai/cloudcli` / `npm install -g @cloudcli-ai/cloudcli`。用户按翻译文档安装会装到上游包，而不是 Cloudpit。

本任务做**最小机械更新 + 顶部横幅**，不重译散文：

1. 每份文件顶部（`<div align="center">` 之前）加一条醒目横幅：
   `> **This translation follows the upstream README. Cloudpit install: \`npx @yalehwang/cloudpit\`; see [README.md](../README.md) for the current Cloudpit-specific docs.**`
2. H1 改 Cloudpit（各语言可用「Cloudpit」+ 原有副标题，不要求翻译新句子）。
3. logo `alt` 改 `Cloudpit`。
4. 安装命令行 `@cloudcli-ai/cloudcli` → `@yalehwang/cloudpit`；只改 `npx`/`npm install -g` 这类安装命令，插件名、上游服务名、外部文档 URL 不动。
5. issue 链接 `siteboon/claudecodeui/issues` → `yaleh/cloudpit/issues`；其余上游文档链接保留。

边界：不重写翻译散文；不改 `docs/proposals/`、`docs/experiments/`、`adr/`、`CHANGELOG.md`；不改英文 README（P0 已覆盖主文档）。

## AC

- [ ] 7 份 `docs/README.{de,ja,ko,ru,tr,zh-CN,zh-TW}.md` 每份都含横幅标记 `<!-- cloudpit-translation-banner -->` 与可见的 `Cloudpit install:` 文本；`grep -L 'cloudpit-translation-banner'` 对这 7 个路径输出为空。
- [ ] 7 份文件的 `<h1>` 都含 `Cloudpit`；`grep -n '<img'` 的 `alt` 均为 `Cloudpit`，不再出现 `alt="CloudCLI UI"`。
- [ ] 7 份文件里 `npx @cloudcli-ai/cloudcli` 与 `npm install -g @cloudcli-ai/cloudcli` 零命中；安装位置改为 `@yalehwang/cloudpit`。
- [ ] issue/PR 链接指向 `yaleh/cloudpit`；`grep -n 'siteboon/claudecodeui'` 只允许出现在明确的 upstream 归属说明行；`cloudcli.ai` 文档链接可保留。
- [ ] 7 份文件的散文主体除上述行外零改动（`git diff --numstat` 每份新增行只来自横幅/标题/alt/安装/链接这几类）。
- [ ] anti-drift：`git diff --name-only develop...HEAD` 只列出 `## Touches` 的文件。

## DoD

- 逐份贴出：横幅行、H1、img alt、安装命令前后 diff。
- 贴出 7 份文件的 `Cloudpit` 命中数（每份至少横幅+H1+安装命令）与 `npx @cloudcli-ai/cloudcli` 零命中的 grep 读数。
- 贴出 `git diff --numstat`，证明每份文件的改动行数只覆盖上述五类。
- 文档改动不需要浏览器实测；若改了任何 UI 才按 AGENTS.md 补截图。

## Touches

- docs/README.de.md
- docs/README.ja.md
- docs/README.ko.md
- docs/README.ru.md
- docs/README.tr.md
- docs/README.zh-CN.md
- docs/README.zh-TW.md
- tasks/gap-cloudpit-translated-readmes-banner.md

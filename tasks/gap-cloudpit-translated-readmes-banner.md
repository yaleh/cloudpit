---
id: gap-cloudpit-translated-readmes-banner
title: Cloudpit 翻译 README：7 份上游快照加横幅并修正标题/logo/安装/Issue 链接
status: done
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

- [x] 7 份 `docs/README.{de,ja,ko,ru,tr,zh-CN,zh-TW}.md` 每份都含横幅标记 `<!-- cloudpit-translation-banner -->` 与可见的 `Cloudpit install:` 文本；`grep -L 'cloudpit-translation-banner'` 对这 7 个路径输出为空。
- [x] 7 份文件的 `<h1>` 都含 `Cloudpit`；`grep -n '<img'` 的 `alt` 均为 `Cloudpit`，不再出现 `alt="CloudCLI UI"`。
- [x] 7 份文件里 `npx @cloudcli-ai/cloudcli` 与 `npm install -g @cloudcli-ai/cloudcli` 零命中；安装位置改为 `@yalehwang/cloudpit`。
- [x] issue/PR 链接指向 `yaleh/cloudpit`；`grep -n 'siteboon/claudecodeui'` 只允许出现在明确的 upstream 归属说明行；`cloudcli.ai` 文档链接可保留。
- [x] 7 份文件的散文主体除上述行外零改动（`git diff --numstat` 每份新增行只来自横幅/标题/alt/安装/链接这几类）。
- [x] anti-drift：`git diff --name-only develop...HEAD` 只列出 `## Touches` 的文件。

## DoD

- 逐份贴出：横幅行、H1、img alt、安装命令前后 diff。
- 贴出 7 份文件的 `Cloudpit` 命中数（每份至少横幅+H1+安装命令）与 `npx @cloudcli-ai/cloudcli` 零命中的 grep 读数。
- 贴出 `git diff --numstat`，证明每份文件的改动行数只覆盖上述五类。
- 文档改动不需要浏览器实测；若改了任何 UI 才按 AGENTS.md 补截图。

## 实施证据

实现提交：`a3f0eb349`（任务分支 `task/gap-cloudpit-translated-readmes-banner`），已 merge develop 得 `f4d72a047`。

**横幅（7 份相同，位于文件第 1–3 行、`<div align="center">` 之前）**

```
<!-- cloudpit-translation-banner -->
> **This translation follows the upstream README. Cloudpit install: `npx @yalehwang/cloudpit`; see [README.md](../README.md) for the current Cloudpit-specific docs.**
```

**逐份 H1 / logo alt / 安装 / Issue 变更**

| 文件 | H1 前 → 后 | alt 前 → 后 | 安装命令前 → 后 | issue 前 → 后 |
|---|---|---|---|---|
| de | `Cloud CLI (auch bekannt als Claude Code UI)` → `Cloudpit (auch bekannt als Claude Code UI)` | `CloudCLI UI` → `Cloudpit` | `npx @cloudcli-ai/cloudcli` / `npm install -g @cloudcli-ai/cloudcli` → `@yalehwang/cloudpit` | `siteboon/claudecodeui/issues` → `yaleh/cloudpit/issues` |
| ja | `Cloud CLI（別名 Claude Code UI）` → `Cloudpit（別名 Claude Code UI）` | 同上 | 同上 | 同上 |
| ko | `Cloud CLI (일명 Claude Code UI)` → `Cloudpit (일명 Claude Code UI)` | 同上 | 同上 | 同上 |
| ru | `Cloud CLI (aka Claude Code UI)` → `Cloudpit (aka Claude Code UI)` | 同上 | 同上 | 同上 |
| tr | `Cloud CLI (Claude Code UI olarak da bilinir)` → `Cloudpit (...)` | 同上 | 同上，表格中另含 `@latest sandbox ~/project` 两处 | 同上 |
| zh-CN | `Cloud CLI（又名 Claude Code UI）` → `Cloudpit（又名 Claude Code UI）` | 同上 | 同上 | 同上 |
| zh-TW | `Cloud CLI（又名 Claude Code UI）` → `Cloudpit（又名 Claude Code UI）` | 同上 | 同上 | 同上 |

沙箱命令与表格内安装命令：`npx @cloudcli-ai/cloudcli@latest sandbox ~/my-project` → `npx @yalehwang/cloudpit@latest sandbox ~/my-project`；设置行 `npx @cloudcli-ai/cloudcli` → `npx @yalehwang/cloudpit`（tr 表格亦含 sandbox 变体）。插件仓库 URL（`cloudcli-ai/cloudcli-plugin-*`）与 `cloudcli.ai` 文档链接保留未动。

**grep 读数（7 份均为）**

- 横幅标记：`grep -L 'cloudpit-translation-banner'` 输出为空（exit 1）；`Cloudpit install:` 每份 1 次。
- `Cloudpit` 每份 3 次（横幅 + H1 + ...）；`@yalehwang/cloudpit` 每份 5 行命中。
- `alt="CloudCLI UI"` 每份 0；`npx @cloudcli-ai/cloudcli` / `npm install -g @cloudcli-ai/cloudcli` 每份 0。
- `siteboon/claudecodeui` 每份 0（全部改为 `yaleh/cloudpit/issues`，每份 2 处新链接）。

**`git diff --numstat develop...HEAD`**

```
11	8	docs/README.de.md
11	8	docs/README.ja.md
11	8	docs/README.ko.md
11	8	docs/README.ru.md
11	8	docs/README.tr.md
11	8	docs/README.zh-CN.md
11	8	docs/README.zh-TW.md
```

每份 8 个被改行 = 2 行插入（横幅标记 + 横幅文本）+ 8 个成对替换（H1、logo alt、头部 issue、npx、npm -g、sandbox npx、表格安装（tr 含 2 处同属一行）、底部 issue），新增合计 11 行（含空行）。

**anti-drift**

```
ANTI-DRIFT OK: task gap-cloudpit-translated-readmes-banner — 7 actual file(s), all within declared Touches (8 glob(s))
```

`git diff --name-only develop...HEAD` 仅输出上述 7 份 `docs/README.*.md`。

## ADR-007 暗轴

- 该轴仍暗,理由:本任务只机械更新 7 份翻译 README 的横幅/标题/alt/安装命令/Issue 链接，不改变 L_D/L_G 的领域数据形态或模块依赖结构，无可读读数。

## Touches

- docs/README.de.md
- docs/README.ja.md
- docs/README.ko.md
- docs/README.ru.md
- docs/README.tr.md
- docs/README.zh-CN.md
- docs/README.zh-TW.md
- tasks/gap-cloudpit-translated-readmes-banner.md

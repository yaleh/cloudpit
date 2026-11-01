---
id: GOAL-054
title: Cloudpit 身份翻转：UI/分发/运行时默认值与桌面身份一次性切换，带兼容回退
status: active
kind: goal
origin: docs/proposals/cloudpit-rename-SPEC.md（2026-10-31）；人 yale 2026-10-31
  裁定采用 GOAL-053 普通 + GOAL-054 branch-mode 的混合推进：暗管道落 develop，身份翻转放短命 goal
  分支，外部发布留人工窗口。
activatedAt: 2026-10-31T14:50:30.073Z
statusLog:
  - at: 2026-10-31T14:50:30.073Z
    from: draft
    to: active
    actor: goal-cli
    reason: ""
branch: true
---
## 目标

在 `goal/GOAL-054` 这条短命分支上，一次性完成 Cloudpit 的身份翻转：用户可见品牌、npm/桌面身份、运行时默认值与桌面应用名同时切换，旧值全部保留兼容回退；分支经人触发并入 develop 后，再由人工窗口完成外部发布。

本 goal 只承载「必须原子切换」的部分。低风险的兼容管道已由 GOAL-053 落在 develop；外部发布动作（npm 发布、仓库改名、OIDC、桌面 release）不在本 goal 的分支上执行，而是作为 post-merge AC 在并入后核验。

## 范围

- 显示层（AC-451）：品牌常量翻到 Cloudpit，UI 文案、12 语言包、index.html、PWA manifest、README/文档、CLI banner、About、窗口/通知标题。
- 分发身份（AC-451）：`package.json` name=`@yalehwang/cloudpit`、bin 只有 `cloudpit`、productName=`Cloudpit`、artifactName=`cloudpit-desktop-*`；CLI 自更新与 system update 命令改新包。
- 运行时默认值（AC-452）：默认数据根 `~/.cloudpit`、settings 新路径、附件新根写入、`CLOUDPIT_*` 成为规范、`cloudpit://` 注册、MCP 新名、OAuth scope 双列、SW 缓存新前缀。
- 运行时内部身份面（AC-459）：IPC/bridge/BroadcastChannel/语义面改名。
- 桌面（AC-453）：`APP_NAME=Cloudpit`、userData 迁移启用、server 缓存迁移、`local-server.json` 回退、两个 scheme 都注册。
- 跨切面 AC（AC-451/452/453/456）：品牌 allowlist、默认翻转后的旧布局迁移、桌面升级、goal preview 上的 UI DoD。

## 非目标

- `appId` 仍为 `ai.cloudcli.desktop`；appId 切换留到 v3.0 并配迁移安装器。
- `cloudcli.ai` 的云端登录契约不变：`cloudcli://auth/callback`、`app_surface=cloudcli_desktop`、控制平面 URL 保持。
- OAuth wire scope 不硬切：新授权写 `cloudpit:*`，旧 `cloudcli:*` 继续接受，旧 token 不失效。
- PAT 前缀 `ccp_` 保持。
- 上游 Docker 镜像 / `@cloudcli-ai/*` / `plugins/starter` 不改，只标注第三方。
- 不改历史账本（tasks/goals/adr/experiments/proposals/CHANGELOG）。
- 不做本机 systemd / 目录 / 生产数据迁移（发布后单独维护窗口）。

## 发布顺序

1. GOAL-053 的暗管道全部落 develop。
2. 从 develop 切旧包 `@yalehwang/cloudcli@1.42.0`（deprecate + CLI 迁移提示）。
3. 创建/推进本 goal 的 `goal/GOAL-054` 分支；pre-merge AC 全绿后用 `quay goal preview` 做 UI 试用。
4. 人触发 `quay goal merge`，worker-driver 把 goal 分支并入 develop。
5. GitHub 仓库改名为 `yaleh/cloudpit`；配置新包 Trusted Publishing。
6. 发布 `@yalehwang/cloudpit@2.0.0`；发桌面 `cloudpit-desktop-*` 与 runtime tag。
7. post-merge AC 核验通过后 goal 才 `achieved`。

## 风险

- 分支并入后不能重开；分支存活时间必须压在 3–7 天内。若合并后需要继续改，走新 task/新 goal。
- 每个任务落地都会把 develop 合进 worktree；与 GOAL-052 的 i18n/会话改动可能冲突，启动本 goal 前应确认 GOAL-052 接近收尾。
- pre-merge AC 不得包含 npm 发布、仓库改名等外部动作；那些必须是 post-merge AC。
- 最终 logo 未到位时，资产任务可作为 post-merge 任务，只阻塞发布，不阻塞 `goal merge`。
- branch-mode 的 AC 在 goal worktree 上求值；查真假用 CLI `quay goal gate`，不要用 MCP `goal_gate`。

## 退出条件

- AC-451、AC-452、AC-453 全部达成（pre-merge）。
- AC-458 达成（post-merge，外部发布核验）。
- AC-451、AC-452、AC-453、AC-456 四项跨切面证据齐全（品牌 allowlist／旧布局迁移／桌面升级／UI 预览）。
- 全部 AC 达成且无 close-block 后，goal 才由现有机制翻 `achieved`。
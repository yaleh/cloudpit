---
id: GOAL-053
title: Cloudpit 兼容暗管道：旧品牌下先行落地读取、迁移与夹具，默认行为不变
status: draft
kind: goal
origin: docs/proposals/cloudpit-rename-SPEC.md（2026-10-31）；人 yale 2026-10-31
  裁定采用 GOAL-053 普通 + GOAL-054 branch-mode 的混合推进：暗管道落 develop，身份翻转放短命 goal
  分支，外部发布留人工窗口。
branch: false
---
## 目标

在不改变任何用户可见行为的前提下，为 Cloudpit 改名先把兼容读取、数据根解析、旧布局迁移与测试夹具落到 develop，给 GOAL-054 的身份翻转准备一个可独立验证、可回退的地基。

本 goal 产出的是「暗管道」：新增的 `CLOUDPIT_*` 读取、新数据根、新设置路径、附件双根和桌面 userData helper 都已经存在，但**默认值仍全部指向旧值**（`~/.cloudcli`、`~/.config/claudecodeui`、旧 assets 根、`APP_NAME=CloudCLI`）。只有显式设置 `CLOUDPIT_HOME` 或测试夹具才走新路径。因此本 goal 的每个 task 都可以独立 fan-in 到 develop，不影响现有发布。

## 范围

- 品牌常量与兼容层骨架（`src/shared/constants.ts`、`server/shared/brand.ts`），不替换用户可见字符串。
- `CLOUDPIT_*` 优先、`CLOUDCLI_*` 回退的读取器；旧名单独设置时行为逐字不变，警告只打一次。
- `resolveDataRoots()`：默认仍返回 `~/.cloudcli`；显式 `CLOUDPIT_HOME` 才返回该根；旧布局迁移（SQLite 一致性备份、voice-data、cockpit feedback、reply-suggestions usage log）可重入、失败回退、不删除旧根。
- 附件双根读取：旧根永久可读，新根仅在显式 opt-in 时写入；两段路径穿越防护都保留。
- `~/.config/claudecodeui/server.settings.json` 的新路径优先、旧路径回退；默认仍写旧路径。
- 桌面 userData / server 缓存迁移 helper：实现但不自动调用（`APP_NAME` 未翻转）。
- 旧布局测试夹具与三臂测试（只旧 / 只新 / 两者都有）。

## 非目标

- 不替换 UI 文案、12 语言包、README、manifest、CLI banner。
- 不改 `package.json` 的 name/bin/productName/artifactName。
- 不改默认数据根、默认设置路径、默认附件写入根、`APP_NAME`、协议、OAuth scope、MCP 名、SW 缓存前缀。
- 不发布 npm、不改 GitHub 仓库、不配置 OIDC、不发桌面 release。
- 不做本机 systemd / 目录 / 生产数据迁移。

## 与 GOAL-054 的关系

GOAL-053 是 GOAL-054 的输入：GOAL-054 在短命 `goal/GOAL-054` 分支上把默认值和身份一次性翻转。两个 goal 的 AC 不重叠；GOAL-053 的任何 AC 都不应断言「UI 已经是 Cloudpit」或「npm 包已经改名」。

## 退出条件

- AC-448、AC-449、AC-450 全部达成。
- 旧品牌下行为逐字不变：默认数据根、默认设置路径、默认附件写入根、`APP_NAME`、用户可见文案均与改动前一致。
- 旧布局夹具可迁移，迁移可重入、失败回退、旧根未被修改。
- 相关单测、typecheck、lint 绿；不新增模块目录，不往 `server/shared/utils.ts` 加行（避免 AC-394 与 oversize 棘轮）。

## 参考

- `docs/proposals/cloudpit-rename-SPEC.md` §3、§4、§8、§9 Stage A。
- `docs/proposals/cloudpit-rename-SPEC.md` §10.1 AC4–AC7 的判据语义。
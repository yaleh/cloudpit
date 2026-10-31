---
id: AC-454
title: Post-merge 分发：旧包 deprecate、新包发布、仓库与桌面 release 可核验
status: draft
kind: criterion
goal: GOAL-054
criterion: node scripts/cloudpit-distribution-check.mjs --release
expect: npm 上 @yalehwang/cloudcli@1.42.0 已 deprecate 且文案指向
  @yalehwang/cloudpit；@yalehwang/cloudpit@2.0.0 已发布，tarball 中只有 cloudpit
  bin；GitHub 仓库 yaleh/cloudpit 的 URL、homepage、repository、bugs 可解析；桌面
  cloudpit-desktop-* 与 cloudpit-local-server-v2.0.0-*
  资产可下载；README/NOTICE/LICENSE 中的 CloudCLI UI 归属声明仍在。取假形态：旧包未
  deprecate、新包未发布、桌面资产缺失、或归属声明被删，均红。
origin: docs/proposals/cloudpit-rename-SPEC.md（2026-10-31）§3 兼容矩阵、§5 运行时契约、§6
  分发与发布、§9 Stage B；人 yale 2026-10-31 裁定 GOAL-053 普通 + GOAL-054 branch-mode
  的混合推进。
phase: post-merge
---

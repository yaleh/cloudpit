---
id: AC-458
title: Post-merge 发布核验（在域）：旧包 deprecate、新包发布、仓库与桌面 release 可核验
status: achieved
kind: criterion
goal: GOAL-054
criterion: node scripts/cloudpit-distribution-check.mjs --release
expect: npm 上 @yalehwang/cloudcli@1.42.0 已 deprecate 且文案指向
  @yalehwang/cloudpit；@yalehwang/cloudpit@2.0.0 已发布，tarball 中只有 cloudpit
  bin；GitHub 仓库 yaleh/cloudpit 的 URL、homepage、repository、bugs 可解析；桌面
  cloudpit-desktop-* 与 cloudpit-local-server-v2.0.0-*
  资产可下载；README/NOTICE/LICENSE 中的 CloudCLI UI 归属声明仍在。取假形态：旧包未
  deprecate、新包未发布、桌面资产缺失、或归属声明被删，均红。
origin: 人 yale 2026-11-01 经会话裁定采纳
  gap-goal-054-postmerge-verification-in-scope-ac 提案 (a)：AC-454 因 draft→active
  能力闸判定根不含 goal 分支载体而无法进入在域集合，创建即 active 的 post-merge 发布核验 AC，判据/期望与 AC-454
  逐字相同；AC-454 同步 supersede。
activatedAt: 2026-11-01T12:40:29.696Z
statusLog:
  - at: 2026-11-02T03:38:39.211Z
    from: active
    to: achieved
    actor: goal-driver
    reason: "I2: criterion pass"
phase: post-merge
---

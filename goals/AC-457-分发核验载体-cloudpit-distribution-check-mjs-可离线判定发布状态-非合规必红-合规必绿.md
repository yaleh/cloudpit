---
id: AC-457
title: 分发核验载体：cloudpit-distribution-check.mjs 可离线判定发布状态，非合规必红、合规必绿
status: achieved
kind: criterion
goal: GOAL-054
criterion: npx tsx --tsconfig server/tsconfig.json --test
  scripts/cloudpit-distribution-check.test.mjs
expect: scripts/cloudpit-distribution-check.mjs 存在并实现 --release 模式，供 AC-454 的
  node scripts/cloudpit-distribution-check.mjs --release
  直接调用；发布状态读取必须可注入（fixture/reader），使本判据能在 pre-merge 零网络运行。判定覆盖 AC-454 的六项：旧包
  @yalehwang/cloudcli@1.42.0 已 deprecate 且文案指向
  @yalehwang/cloudpit；@yalehwang/cloudpit@2.0.0 已发布且 tarball 只有 cloudpit
  bin；GitHub yaleh/cloudpit 的 URL/homepage/repository/bugs 可解析；桌面
  cloudpit-desktop-* 与 cloudpit-local-server-v2.0.0-*
  资产可下载；README/NOTICE/LICENSE 的 CloudCLI UI
  归属声明仍在。取假形态：脚本缺失、对任一注入的非合规发布状态不变红、或合规快照不绿，均红。
origin: 人 yale 2026-11-01 经会话裁定采纳 gap-goal-054-post-merge-distribution-ac 的提案
  (a)；依据 GOAL-054 充分性判官 verdict=insufficient（key 3e43bc4629c5…70276，since
  2026-10-31T15:51:35.231Z，cache ts 2026-10-31T15:49:43.112Z）：退出条件第 2 条「AC-454
  达成（post-merge，外部发布核验）」无在域 AC，根因是 AC-454 的判据载体
  scripts/cloudpit-distribution-check.mjs 在树中不存在，capability 闸 missingCarriers
  拒绝激活。编号 AC-457（AC-451…AC-454 属 GOAL-054，AC-455 属 GOAL-053，AC-456 已存在）。
activatedAt: 2026-11-01T03:02:51.755Z
statusLog:
  - at: 2026-11-01T03:22:56.749Z
    from: active
    to: achieved
    actor: goal-driver
    reason: "I2: criterion pass"
phase: pre-merge
---

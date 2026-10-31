---
id: AC-453
title: 桌面身份迁移：APP_NAME=Cloudpit，旧 userData/server 缓存/local-server marker
  可迁移，appId 与云端回调不变
status: achieved
kind: criterion
goal: GOAL-054
criterion: npx tsx --tsconfig server/tsconfig.json --test
  electron/tests/cloudpit-desktop-identity.test.mjs
expect: 桌面 APP_NAME/productName 为 Cloudpit；首次启动把旧 userData 的三个 JSON
  复制到新目录；~/.cloudcli/server 缓存可移动或重新下载；local-server marker 新路径优先、旧路径回退；cloudcli
  与 cloudpit 两个 scheme 均注册；appId 仍为 ai.cloudcli.desktop；云端登录仍使用
  cloudcli://auth/callback 且 app_surface=cloudcli_desktop。取假形态：appId 被改、云回调改用
  cloudpit://、旧 userData 未迁移、或 marker 只读新路径，均红。
origin: docs/proposals/cloudpit-rename-SPEC.md（2026-10-31）§3 兼容矩阵、§5 运行时契约、§6
  分发与发布、§9 Stage B；人 yale 2026-10-31 裁定 GOAL-053 普通 + GOAL-054 branch-mode
  的混合推进。
activatedAt: 2026-10-31T14:50:45.702Z
statusLog:
  - at: 2026-10-31T14:50:45.702Z
    from: draft
    to: active
    actor: goal-cli
    reason: ""
  - at: 2026-10-31T16:31:09.005Z
    from: active
    to: achieved
    actor: goal-driver
    reason: "I2: criterion pass"
fidelity:
  verdict: not-evaluated
  reason: no judge configured
  at: 2026-10-31T14:50:45.702Z
phase: pre-merge
---

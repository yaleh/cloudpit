---
id: AC-452
title: 运行时默认值翻转与兼容：默认新根/新设置/新附件写入，协议与 scope/MCP/SW 双接受
status: draft
kind: criterion
goal: GOAL-054
criterion: npx tsx --tsconfig server/tsconfig.json --test
  server/shared/tests/cloudpit-runtime-flip.test.ts
expect: 未设置 CLOUDPIT_HOME 时默认使用 ~/.cloudpit 并自动迁移旧布局；settings
  写新路径；新附件写新根且旧附件仍可读；cloudpit:// 已注册且观测 URI 双读；MCP 新名写出、旧 cloudcli-browser
  仍被接受；OAuth metadata 双列新旧 scope，旧 scope 的 token 不失效；SW 清理同时覆盖 cloudpit- 与
  claude-ui- 前缀。取假形态：默认仍是旧根、旧 scope token 被拒、旧 MCP 名被拒、或旧 SW 缓存未被清理，均红。
origin: docs/proposals/cloudpit-rename-SPEC.md（2026-10-31）§3 兼容矩阵、§5 运行时契约、§6
  分发与发布、§9 Stage B；人 yale 2026-10-31 裁定 GOAL-053 普通 + GOAL-054 branch-mode
  的混合推进。
phase: pre-merge
---

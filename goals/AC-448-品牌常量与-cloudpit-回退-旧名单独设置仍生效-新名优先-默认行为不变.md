---
id: AC-448
title: 品牌常量与 CLOUDPIT_* 回退：旧名单独设置仍生效，新名优先，默认行为不变
status: draft
kind: criterion
goal: GOAL-053
criterion: npx tsx --tsconfig server/tsconfig.json --test
  server/shared/tests/cloudpit-brand-env.test.ts
expect: 只设置 CLOUDCLI_* 时，读取值与改动前逐字一致，且 deprecation 警告只打一次；同时设置 CLOUDPIT_* 与
  CLOUDCLI_* 时新名优先；两者都未设置时取现有默认值。用户可见文案、默认数据根、默认设置路径、APP_NAME
  均不得变化。取假形态：删掉旧名回退、让旧名覆盖新名、或每次读取都打警告，都会让该测试变红。
origin: "docs/proposals/cloudpit-rename-SPEC.md（2026-10-31）§3 兼容矩阵 #4、§4.1、§9
  Stage A；人 yale 2026-10-31 裁定 GOAL-053 普通 + GOAL-054 branch-mode 的混合推进。"
---

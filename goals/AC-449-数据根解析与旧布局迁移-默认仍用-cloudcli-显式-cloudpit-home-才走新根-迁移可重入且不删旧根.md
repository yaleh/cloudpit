---
id: AC-449
title: 数据根解析与旧布局迁移：默认仍用 ~/.cloudcli，显式 CLOUDPIT_HOME 才走新根，迁移可重入且不删旧根
status: active
kind: criterion
goal: GOAL-053
criterion: npx tsx --tsconfig server/tsconfig.json --test
  server/shared/tests/cloudpit-data-root.test.ts
expect: 默认解析结果仍是 ~/.cloudcli；显式设置 CLOUDPIT_HOME
  时才使用该根。旧布局夹具（auth.db、voice-data、server.settings.json、cockpit-card-feedback.json、reply-suggestions-usage.jsonl）迁移后数据可见，新写入落新根，旧根逐字未改，二次启动不重复迁移；SQLite
  备份失败或旧库被占用时回退旧根，不产生半套新根。取假形态：默认根被提前改新、迁移删除旧根、失败后仍写新根、或迁移不可重入，均红。
origin: docs/proposals/cloudpit-rename-SPEC.md（2026-10-31）§3 兼容矩阵、§4 数据与配置迁移、§9
  Stage A；人 yale 2026-10-31 裁定 GOAL-053 普通 + GOAL-054 branch-mode 的混合推进。
activatedAt: 2026-10-31T06:06:16.392Z
statusLog:
  - at: 2026-10-31T06:06:16.392Z
    from: draft
    to: active
    actor: goal-cli
    reason: ""
fidelity:
  verdict: not-evaluated
  reason: no judge configured
  at: 2026-10-31T06:06:16.392Z
---

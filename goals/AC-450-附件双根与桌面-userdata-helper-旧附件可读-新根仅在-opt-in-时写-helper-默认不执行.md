---
id: AC-450
title: 附件双根与桌面 userData helper：旧附件可读，新根仅在 opt-in 时写，helper 默认不执行
status: draft
kind: criterion
goal: GOAL-053
criterion: npx tsx --tsconfig server/tsconfig.json --test
  server/modules/assets/tests/cloudpit-assets-dual-root.test.ts && node --test
  electron/tests/cloudpit-userdata-migration.test.mjs
expect: 旧 ~/.cloudcli/assets 中的附件经文件名路由仍可读；新上传默认仍写旧根，只有显式 opt-in
  才写新根；新旧两段路径穿越防护都拒绝 ../ 与分隔符；桌面 helper 能把旧 userData 的
  cloud-account.json、desktop-settings.json、desktop-notifications-settings.json
  三个文件复制到新目录，且只复制这三个，但在 APP_NAME 未翻转时不得自动调用。取假形态：只读新根、opt-in 仍写旧根、穿越防护只覆盖一个根、或
  helper 在默认启动时执行，均红。
origin: docs/proposals/cloudpit-rename-SPEC.md（2026-10-31）§3 兼容矩阵、§4 数据与配置迁移、§9
  Stage A；人 yale 2026-10-31 裁定 GOAL-053 普通 + GOAL-054 branch-mode 的混合推进。
---

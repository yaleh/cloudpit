---
id: AC-455
title: 目标退出结构门：相关单测 / typecheck / lint 绿，零新增模块目录，server/shared/utils.ts 未增行
status: active
kind: criterion
goal: GOAL-053
criterion: npx tsx --tsconfig server/tsconfig.json --test
  server/shared/tests/cloudpit-goal-exit-gate.test.ts
  server/shared/tests/cloudpit-brand-env.test.ts
  server/shared/tests/cloudpit-data-root.test.ts
  server/modules/assets/tests/cloudpit-assets-dual-root.test.ts
  server/shared/tests/settings-file.test.ts
  server/shared/tests/image-attachments.test.ts
  server/modules/assets/tests/image-assets.service.test.ts
  server/modules/websocket/tests/chat-attachment-filter.test.ts && npx tsx
  --tsconfig server/tsconfig.json --test
  electron/tests/cloudpit-userdata-migration.test.mjs && npm run typecheck &&
  npm run lint
expect: 有界判据文件全部存在且退出 0：8 个 server 文件（cloudpit-goal-exit-gate /
  cloudpit-brand-env / cloudpit-data-root / cloudpit-assets-dual-root /
  settings-file / image-attachments / image-assets.service /
  chat-attachment-filter）与
  electron/tests/cloudpit-userdata-migration.test.mjs，各自 fail 0；npm run
  typecheck 与 npm run lint 均退出 0。结构门两臂由 cloudpit-goal-exit-gate.test.ts 本体断言：(a)
  目录臂——scanImportGraph(collectServerSources(<repo>/server)).nodes ⊆ 冻结基线
  cloudpit-goal-exit-gate.baseline.json.moduleDirectories 且 ⊆
  server-import-cycle-budget.baseline.json.directoryManifest（立案时均 58），extra=[]
  才绿；missing 仅记录不断言（AC-394 的 manifest 只许缩，合法收缩不得打红）。取假形态：合成多一个目录必须红。(b) utils.ts
  臂——server/shared/utils.ts 行数 <= 冻结 utilsLineCount（立案时 1930）且 <=
  architecture-ratchet.baseline.json 的 oversizeFiles
  条目；只断言不增行，不要求相等。取假形态：合成多一行必须红。判据时限由记录 timeoutMs 承载（立案时写
  150000，落地前按整链实测重定），避免默认 60000 把可过判据记成 fail。
origin: 人 yale 2026-10-31 经会话裁定采纳 gap-goal-053-exit-structural-gate-not-an-ac
  的提案 (a)；依据 GOAL-053 充分性判官 verdict=insufficient（key 12ff5522…，since
  2026-10-31T06:22:27Z，cache ts 06:20:31Z）：退出条件第 4 条无在域 AC。编号 AC-455（451–454 属
  GOAL-054）。判据按单调读法（不增行 / 不增目录）与记录级 timeoutMs 落地。
activatedAt: 2026-10-31T07:17:26.743Z
timeoutMs: 150000
---

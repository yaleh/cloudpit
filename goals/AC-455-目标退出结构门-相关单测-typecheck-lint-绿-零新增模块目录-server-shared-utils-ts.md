---
id: AC-455
title: 目标退出结构门：相关单测 / typecheck / lint 绿，目录臂为 recorded-change
  棘轮，server/shared/utils.ts 未增行
status: achieved
kind: criterion
goal: GOAL-053
criterion: for f in server/shared/tests/cloudpit-goal-exit-gate.test.ts
  server/shared/tests/cloudpit-brand-env.test.ts
  server/shared/tests/cloudpit-data-root.test.ts
  server/modules/assets/tests/cloudpit-assets-dual-root.test.ts
  server/shared/tests/settings-file.test.ts
  server/shared/tests/image-attachments.test.ts
  server/modules/assets/tests/image-assets.service.test.ts
  server/modules/websocket/tests/chat-attachment-filter.test.ts
  electron/tests/cloudpit-userdata-migration.test.mjs; do [ -f "$f" ] || { echo
  "缺判据文件：$f" >&2; exit 1; }; done; npx tsx --tsconfig server/tsconfig.json
  --test server/shared/tests/cloudpit-goal-exit-gate.test.ts
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
  typecheck 与 npm run lint 均退出 0。判据命令以 for f in ... 先显式断言上列 9 个文件都存在（缺一个即 exit
  1）：tsx --test 在混合存在的文件集里会静默忽略缺失路径并 exit 0（2026-10-31 dry-run
  实测），存在性闸必须由判据自己承担。结构门两臂由 cloudpit-goal-exit-gate.test.ts 本体断言；2026-11-03 人
  yale 裁定（见 gap-ac455-directory-arm-recorded-change）把目录臂从『永不新增』收窄为
  recorded-change 棘轮。(a)
  目录臂——scanImportGraph(collectServerSources(<repo>/server)).nodes ⊆
  cloudpit-goal-exit-gate.baseline.json.moduleDirectories，且该基线 ⊆ 判据源码里的
  GATE_DIRECTORY_PIN；只改 JSON 不能放行新目录，新增目录必须在同一次受审的源码变更里同时改 pin 与 JSON（与 AC-394
  MANIFEST_PIN 同形）。missing 仅记录不断言；AC-394 的 directoryManifest
  只作交叉读数打印、不断言（它只许缩）。取假形态：合成多一个测得目录、合成一个基线内但不在源码 pin 内的目录都必须红。(b) utils.ts
  臂——server/shared/utils.ts 行数 <= 冻结 utilsLineCount（立案时 1930）且 <=
  architecture-ratchet.baseline.json 的 oversizeFiles
  条目；只断言不增行，不要求相等。取假形态：合成多一行必须红。判据时限由记录 timeoutMs 承载（150000），避免默认 60000 把可过判据记成
  fail。
origin: 人 yale 2026-10-31 经会话裁定采纳 gap-goal-053-exit-structural-gate-not-an-ac
  的提案 (a)；依据 GOAL-053 充分性判官 verdict=insufficient（key 12ff5522…，since
  2026-10-31T06:22:27Z，cache ts 06:20:31Z）：退出条件第 4 条无在域 AC。编号 AC-455（451–454 属
  GOAL-054）。判据按单调读法（不增行 / 不增目录）与记录级 timeoutMs 落地；2026-10-31 dry-run
  实测混合文件集会静默忽略缺失路径，故补 for f 存在性闸。
activatedAt: 2026-10-31T07:17:26.743Z
statusLog:
  - at: 2026-10-31T07:49:37.441Z
    from: active
    to: achieved
    actor: goal-driver
    reason: "I2: criterion pass"
timeoutMs: 150000
---
## 2026-11-03 修订（人 yale 裁定 (a)）

GOAL-053 自 2026-10-31T07:50:43Z 起 achieved。原目录臂把 GOAL-053 的退出条件『不新增模块目录』落成整树永久不变量，位于全量 suite，导致任何合法的模块拆包都成为 task-introduced-red。裁定：目录臂收窄为 recorded-change 棘轮（判据源码 GATE_DIRECTORY_PIN + JSON 只许缩），首个 recorded change 预声明 modules/observation/{core,session-ask,session-digest,producers}，随 gap-routine-architecture-analysis-god-package-server-observation 的拆包落地。utils.ts 臂不变。GOAL-053 仍 achieved；因 achieved goal 不在复验扫描内，修订落地后须手工复跑本 criterion 并登记新 evidence。执行任务见 gap-ac455-directory-arm-recorded-change。
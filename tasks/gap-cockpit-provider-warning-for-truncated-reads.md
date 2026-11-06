---
id: gap-cockpit-provider-warning-for-truncated-reads
title: Cockpit 截断/坏行降级必须显示 warning，不得在救回卡片时静默丢弃末段
status: todo
labels:
  - gap
  - defect
  - cockpit
parent: null
children: []
extra: {}
depends_on:
  - gap-cockpit-provider-diagnostics-to-degraded-stage
---
## Proposal

来源：任务 `gap-cockpit-provider-diagnostics-to-degraded-stage` 已合入，但实现只把 `ok:false` 的 diagnostic 当作失败：`providerFailures = diagnostics.filter(ok === false)`，`degraded = providerFailures.length > 0`。任务 `gap-cockpit-fleet-card-read-bound-and-truncation-salvage` 的截断救回在成功时会给出 `ok:true`、`truncated:true`、`completeLines`、`truncatedTailBytes` 与 `reason`；按当前实现，超过 8 MiB 的读会显示已救回的卡，却没有任何降级提示，末段卡被丢弃这件事对用户不可见。本任务补上 warning 读数与提示，不改 A/B 已定的 `ok` 语义（`ok` 仍表示「产出了可用批次」）。

具体：
1. 控制器快照新增 `providerWarnings`：`ok === true && (truncated === true || skippedLines > 0)` 的 diagnostic 全形状条目；`degraded = providerFailures.length > 0 || providerWarnings.length > 0`。`reason` 只作展示文案，不参与失败/降级判定。
2. `CockpitCardList` 从三分支扩为四分支：无卡且无失败与 warning=正常空态；无卡有失败=原因与既有 reload 重试；有卡有失败=卡片照常显示并附常驻错误提示（`role=alert`）；有卡有降级=卡片照常显示并附常驻降级提示（黄色）。失败与降级同时存在时逐条显示两条提示，卡片照常可见，不合并成一个 degraded 分支。轮询跨状态继续，下次成功自动清除两类提示。
3. 十个 locale 同步新增 warning 文案，占位符与现有 i18n 完整性判据一致。

## AC

- [ ] C1 执行 `bash scripts/with-memory-cap.sh npx vitest run src/modules/cockpit/tests/cockpitCardController.test.ts --maxWorkers=1` 退出 0；用例覆盖：`ok:true,truncated:true,reason:'…'` ⇒ `providerWarnings` 含该条、`degraded:true`、`visibleCards` 保留；`ok:true,skippedLines:1,reason:'…'` ⇒ 同样进 `providerWarnings`；`ok:true,reason:'…'` 但无 `truncated` 且 `skippedLines:0` ⇒ `providerWarnings` 为空、`degraded:false`；`ok:false` 仍进 `providerFailures`；下一轮健康读数把两类提示都清空。
- [ ] C2 执行 `bash scripts/with-memory-cap.sh npx vitest run src/modules/cockpit/tests/CockpitCardList.test.tsx --maxWorkers=1` 退出 0；四分支 testid 与文案：无卡有失败显示 `cockpit-card-provider-error` 且不显示 `cockpit-card-empty`；有卡有失败同时显示卡片与错误提示；有卡有降级显示 `cockpit-card-provider-warning` 且文案含 diagnostic 的 reason；无卡且无失败与 warning 显示 `cockpit-card-empty`；一条 failure 与一条 warning 同时存在时两条提示都出现、卡片可见，不得合并成一条 `degraded` 提示。
- [ ] C3 执行 `bash scripts/with-memory-cap.sh npx vitest run src/modules/cockpit/tests/CockpitColumn.test.tsx src/modules/cockpit/tests/CockpitOverlay.test.tsx src/modules/cockpit/tests/cockpitCardsMobileDetails.test.tsx --maxWorkers=1` 退出 0，确认页面、列、手机抽屉三处共用列表接同一 warning 读数。
- [ ] C4 执行 `bash scripts/with-memory-cap.sh npx vitest run src/modules/cockpit/tests/i18nCockpitCompleteness.test.ts --maxWorkers=1` 退出 0；`npm run typecheck`、`npm run lint`、`npm run build:client` 分别退出 0。
- [ ] C5 负控并改完即还原：只用 `ok:false` 判降级、漏掉 `truncated`/`skippedLines`，C1/C2 的 warning 用例必须红；改用 `reason !== null` 判 warning，C1 的「成功读数带 reason 但无 truncated/skipped」反例必须红；下一轮成功不清提示，C1 必须红。

## DoD

在隔离实例上用真实 provider 读数操作卡片墙：第一腿让 quay-fleet 返回 `ok:true,truncated:true,reason`（复用超过 8 MiB 的截断夹具），页面显示完整行对应的卡并出现降级提示，提示文案含 diagnostic 的 reason；第二腿让 quay-fleet `ok:false` 且关闭 fixture provider，页面显示失败原因与重试，不显示正常空态；第三腿开启 fixture provider 并让 quay-fleet 失败，页面同时显示夹具卡与错误提示；恢复后两类提示消失、卡片保留。用 MCP 浏览器在真实页面逐条操作并截图存 `tmp/`，在完成记录贴出截图路径与对应读数（`GET /api/cockpit/cards` 的 `cards` 与 `diagnostics` 原文）。存在可用的 cockpit 卡片场景时同时执行 `node scripts/ui-scenario.mjs <scenario.json>`，贴出 JSON 报告与检查点截图；新 warning 态若没有场景驱动，须在完成记录说明并保留 MCP 浏览器证据。

## Touches

- tasks/gap-cockpit-provider-warning-for-truncated-reads.md
- src/modules/cockpit/cards/cockpitCardController.ts
- src/modules/cockpit/cards/CockpitCardList.tsx
- src/modules/cockpit/tests/cockpitCardController.test.ts
- src/modules/cockpit/tests/CockpitCardList.test.tsx
- src/modules/cockpit/tests/CockpitColumn.test.tsx
- src/modules/cockpit/tests/CockpitOverlay.test.tsx
- src/modules/cockpit/tests/cockpitCardsMobileDetails.test.tsx
- src/modules/cockpit/tests/i18nCockpitCompleteness.test.ts
- src/modules/i18n/locales/*/common.json
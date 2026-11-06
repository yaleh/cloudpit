---
id: gap-cockpit-provider-warning-for-truncated-reads
title: Cockpit 截断/坏行降级必须显示 warning，不得在救回卡片时静默丢弃末段
status: done
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

- [x] C1 执行 `bash scripts/with-memory-cap.sh npx vitest run src/modules/cockpit/tests/cockpitCardController.test.ts --maxWorkers=1` 退出 0；用例覆盖：`ok:true,truncated:true,reason:'…'` ⇒ `providerWarnings` 含该条、`degraded:true`、`visibleCards` 保留；`ok:true,skippedLines:1,reason:'…'` ⇒ 同样进 `providerWarnings`；`ok:true,reason:'…'` 但无 `truncated` 且 `skippedLines:0` ⇒ `providerWarnings` 为空、`degraded:false`；`ok:false` 仍进 `providerFailures`；下一轮健康读数把两类提示都清空。
- [x] C2 执行 `bash scripts/with-memory-cap.sh npx vitest run src/modules/cockpit/tests/CockpitCardList.test.tsx --maxWorkers=1` 退出 0；四分支 testid 与文案：无卡有失败显示 `cockpit-card-provider-error` 且不显示 `cockpit-card-empty`；有卡有失败同时显示卡片与错误提示；有卡有降级显示 `cockpit-card-provider-warning` 且文案含 diagnostic 的 reason；无卡且无失败与 warning 显示 `cockpit-card-empty`；一条 failure 与一条 warning 同时存在时两条提示都出现、卡片可见，不得合并成一条 `degraded` 提示。
- [x] C3 执行 `bash scripts/with-memory-cap.sh npx vitest run src/modules/cockpit/tests/CockpitColumn.test.tsx src/modules/cockpit/tests/CockpitOverlay.test.tsx src/modules/cockpit/tests/cockpitCardsMobileDetails.test.tsx --maxWorkers=1` 退出 0，确认页面、列、手机抽屉三处共用列表接同一 warning 读数。
- [x] C4 执行 `bash scripts/with-memory-cap.sh npx vitest run src/modules/cockpit/tests/i18nCockpitCompleteness.test.ts --maxWorkers=1` 退出 0；`npm run typecheck`、`npm run lint`、`npm run build:client` 分别退出 0。
- [x] C5 负控并改完即还原：只用 `ok:false` 判降级、漏掉 `truncated`/`skippedLines`，C1/C2 的 warning 用例必须红；改用 `reason !== null` 判 warning，C1 的「成功读数带 reason 但无 truncated/skipped」反例必须红；下一轮成功不清提示，C1 必须红。

## DoD

在隔离实例上用真实 provider 读数操作卡片墙：第一腿让 quay-fleet 返回 `ok:true,truncated:true,reason`（复用超过 8 MiB 的截断夹具），页面显示完整行对应的卡并出现降级提示，提示文案含 diagnostic 的 reason；第二腿让 quay-fleet `ok:false` 且关闭 fixture provider，页面显示失败原因与重试，不显示正常空态；第三腿开启 fixture provider 并让 quay-fleet 失败，页面同时显示夹具卡与错误提示；恢复后两类提示消失、卡片保留。用 MCP 浏览器在真实页面逐条操作并截图存 `tmp/`，在完成记录贴出截图路径与对应读数（`GET /api/cockpit/cards` 的 `cards` 与 `diagnostics` 原文）。存在可用的 cockpit 卡片场景时同时执行 `node scripts/ui-scenario.mjs <scenario.json>`，贴出 JSON 报告与检查点截图；新 warning 态若没有场景驱动，须在完成记录说明并保留 MCP 浏览器证据。

## Completion

实现提交 `f77e42472`（worktree `gap-cockpit-provider-warning-for-truncated-reads`，已 merge develop；实现 = 控制器 `providerWarnings` + 列表琥珀色 warning 分支 + 12 个 locale 的 `cockpit.cardProviderWarning` + 四层测试）。本仓实际有 12 个 locale 目录（i18n 完整性判据自己按 12-locale glob 断言），全部同步。

AC 证据（2026-11-06，全部在本 worktree 跑）：
- C1 `cockpitCardController.test.ts` 83 passed；C2 `CockpitCardList.test.tsx` 11 passed；C3 `CockpitColumn`/`CockpitOverlay`/`cockpitCardsMobileDetails` 20+3+19 passed；C4 `i18nCockpitCompleteness` 14 passed，且 `npm run typecheck`、`npm run lint`、`npm run build:client` 均 exit 0。
- C5 负控（每条改完即 `git checkout --` 还原，最终树干净）：
  1. `providerWarnings` 恒为空（只认 `ok:false` 判降级）⇒ C1 3 红、C2 5 红；
  2. 改用 `reason !== null` 判 warning ⇒ C1「成功读数带 reason 但无 truncated/skipped」反例 1 红；
  3. 只在非空时写 `providerWarnings`（成功不清提示）⇒ C1「下一轮健康读数把两类提示都清空」1 红。

DoD（隔离实例 `:5231`，`GET /api/cockpit/cards` 原文读数；截图在本 worktree 的 `tmp/`）：
- 第一腿（>8 MiB 截断救回）：`cards`=65；`diagnostics`=`[{"provider":"quay-fleet","ok":true,"reason":"quay-fleet output was cut at the read bound; the incomplete last line was dropped","cards":65,"skippedLines":0,"cached":false,"truncated":true,"completeLines":65,"truncatedTailBytes":8338993}]`。真实页面显示 65 张救回卡 + 黄色降级提示，提示文案含该 reason。截图 `tmp/dod-leg1-truncated-warning.png`。
- 第二腿（quay-fleet `ok:false`，fixtureCards off）：`cards`=0；`diagnostics`=`[{"provider":"quay-fleet","ok":false,"reason":"quay-fleet: the fleet state directory cannot be read","cards":0,"skippedLines":0,"cached":false}]`。页面显示失败原因 + Retry，不显示正常空态。截图 `tmp/dod-leg2-provider-failure.png`。
- 第三腿（fixtureCards on + quay-fleet 失败）：`cards`=9，`diagnostics` 同第二腿；页面同时显示 9 张夹具卡与错误提示。截图 `tmp/dod-leg3-failure-with-fixture-cards.png`。
- 恢复腿：不重载、不点 Retry，等下一次轮询；`cards`=11，两类提示都不再渲染。截图 `tmp/dod-leg4-recovered.png`。
- 场景运行器：本会话没有 MCP 浏览器工具，改用仓内 Playwright 驱动真实页面（HEADLESS）并保留截图。`node scripts/ui-scenario.mjs tmp/dod/cockpit-cards-truncated.json --base-url http://127.0.0.1:5232 --auth-token <token> --project claudecodeui --session 164c3087-A-0-mv95vsj6 --out tmp/ui-scenarios/cockpit-cards-truncated` ⇒ exit 0；JSON：`{"ok":true,"failedStep":null,"steps":[{"action":"open:cockpit-cards","ok":true,"failures":[],"screenshot":"tmp/ui-scenarios/cockpit-cards-truncated/step-1-open-cockpit-cards.png","visible":65}]}`。检查点截图同时显示 warning 与 65 张卡。
- 说明：语义面 `cockpit.cards` 目前不暴露 providerWarnings，warning 态没有专属场景断言；因此 warning 的文案与显隐以上面的真实页面截图为准，场景只断言 65 张救回卡的结构化读数。截图/报告位于 worktree `tmp/`（gitignored）。
- Anti-drift：`anti-drift-touches-check --merge-target develop` ⇒ OK（20 files within 10 declared globs）。

ADR-007：
该轴仍暗,理由:本任务是 cockpit 缺陷修补，没有可测的 L_D/L_G 数理或图形读数。

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
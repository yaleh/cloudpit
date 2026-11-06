---
id: gap-cockpit-provider-diagnostics-to-degraded-stage
title: Cockpit provider 读取失败必须显示为失败态，不得坍缩成成功空页
status: ready
labels:
  - gap
  - defect
  - cockpit
parent: null
children: []
extra:
  schema: execution
depends_on:
  - gap-cockpit-fleet-card-read-bound-and-truncation-salvage
---
## Proposal

来源：同一次 2026-11-06 空卡片事故的第二层缺陷。服务端 `GET /api/cockpit/cards` 已在 `diagnostics` 里返回 `{provider, ok:false, reason, cards, skippedLines, cached}`，但客户端 transport（`src/modules/cockpit/hooks/useCockpitCards.ts`）只取 `answer.cards`，控制器因此把「读取失败」记成 `status:'loaded'` + 空数组，界面显示成功空页。本任务把 provider 失败作为一等读数带到卡片墙：`status:'error'` 只保留给 transport 失败；provider 失败进入 `providerFailures` 并派生 `degraded`；三种空态分开渲染，一个 provider 失败不得清空其它 provider 的卡。

具体：
1. `CockpitCardProviderDiagnostic` 从 `server/modules/cockpit/cockpit-card-registry.ts` 移到 `server/shared/types.ts` 并在 `src/shared/types.ts` 镜像；`src/shared/tests/cockpitCardTypeSync.test.ts` 增加逐字段比对。该类型新增的 `truncated`、`completeLines`、`truncatedTailBytes` 字段也要在两端出现。
2. `fetchCards` 返回 `{ cards, diagnostics }`；hook 只透传，不解释原因。
3. 控制器快照新增 `providerFailures`（全形状 diagnostic 的 `ok:false` 条目）与派生 `degraded`；normalize 保留该读数。
4. `CockpitCardList` 三分支：无卡无失败=正常空态；无卡有失败=原因与既有 reload 重试；有卡有失败=卡片照常显示并附常驻原因提示。轮询跨状态继续，下次成功自动清除提示。
5. 十个 locale 同步新增文案。

## AC

- [ ] B1 执行 `bash scripts/with-memory-cap.sh npx vitest run src/shared/tests/cockpitCardTypeSync.test.ts --maxWorkers=1` 退出 0；`CockpitCardProviderDiagnostic` 在 server/client 两端的字段集合一致，包含 provider、ok、reason、cards、skippedLines、cached、truncated、completeLines、truncatedTailBytes。
- [ ] B2 执行 `bash scripts/with-memory-cap.sh npx vitest run src/modules/cockpit/tests/cockpitCardController.test.ts --maxWorkers=1` 退出 0；用例覆盖：`fetchCards` 返回空卡加一条 `ok:false` diagnostic 时快照 `status:'loaded'`、`providerFailures` 含该条、`degraded:true`；返回健康卡加失败 diagnostic 时 `visibleCards` 保留健康卡且 `degraded:true`；`fetchCards` 抛错时仍为 `status:'error'`。
- [ ] B3 执行 `bash scripts/with-memory-cap.sh npx vitest run src/modules/cockpit/tests/CockpitCardList.test.tsx --maxWorkers=1` 退出 0（新建文件）；断言三分支的 testid 与文案：无卡有失败显示 `cockpit-card-provider-error` 且不显示 `cockpit-card-empty`；有卡有失败同时显示卡片与提示；无卡无失败显示 `cockpit-card-empty`。
- [ ] B4 执行 `bash scripts/with-memory-cap.sh npx vitest run src/modules/cockpit/tests/CockpitColumn.test.tsx src/modules/cockpit/tests/CockpitOverlay.test.tsx src/modules/cockpit/tests/cockpitCardsMobileDetails.test.tsx --maxWorkers=1` 退出 0，确认页面、列、手机抽屉三处共用列表接同一读数。
- [ ] B5 执行 `bash scripts/with-memory-cap.sh npx vitest run src/modules/cockpit/tests/i18nCockpitCompleteness.test.ts --maxWorkers=1` 退出 0；`npm run typecheck`、`npm run lint`、`npm run build:client` 分别退出 0；按 RECORDED CHANGE 格式更新 `server/shared/tests/architecture-ratchet.baseline.json` 中 `server/shared/types.ts` 与 `src/shared/types.ts` 的旧→新读数并写明原因与日期，执行 `bash scripts/with-memory-cap.sh npx tsx --tsconfig server/tsconfig.json --test server/shared/tests/architecture-ratchet.test.ts` 退出 0。
- [ ] B6 负控并改完即还原：transport 丢掉 diagnostics，B2/B3 必须红；任一 provider 失败就把整墙置为 `status:'error'`，B3 的「有卡仍显示」必须红；下一次成功轮询不清除提示，B2 必须红。

## DoD

在隔离实例上用两个真实 provider 读数操作卡片墙：第一腿只让 quay-fleet 读失败（`QUAY_FLEET_BIN` 指向失败夹具）且关闭 fixture provider，页面显示失败原因与重试，不显示正常空态；第二腿开启 fixture provider 并让 quay-fleet 失败，页面同时显示夹具卡与常驻原因提示；点击重试或等待轮询在 quay-fleet 恢复后提示消失且卡片保留。用 MCP 浏览器在真实页面逐条操作并截图存 `tmp/`，在完成记录贴出截图路径与对应读数（`GET /api/cockpit/cards` 的 `cards` 与 `diagnostics` 原文）。存在可用的 cockpit 卡片场景时同时执行 `node scripts/ui-scenario.mjs <scenario.json>`，贴出 JSON 报告与检查点截图；新失败态若没有场景驱动，须在完成记录说明并保留 MCP 浏览器证据。

## Touches

- tasks/gap-cockpit-provider-diagnostics-to-degraded-stage.md
- server/shared/types.ts
- src/shared/types.ts
- server/modules/cockpit/cockpit-card-registry.ts
- server/modules/cockpit/cockpit.module.ts
- server/modules/cockpit/index.ts
- server/modules/cockpit/cockpit-fleet-card-provider.ts
- server/shared/tests/architecture-ratchet.baseline.json
- src/modules/cockpit/hooks/useCockpitCards.ts
- src/modules/cockpit/cards/cockpitCardController.ts
- src/modules/cockpit/cards/CockpitCardList.tsx
- src/modules/cockpit/tests/CockpitCardList.test.tsx (new)
- src/shared/tests/cockpitCardTypeSync.test.ts
- src/modules/cockpit/tests/cockpitCardController.test.ts
- src/modules/cockpit/tests/CockpitColumn.test.tsx
- src/modules/cockpit/tests/CockpitOverlay.test.tsx
- src/modules/cockpit/tests/cockpitCardsMobileDetails.test.tsx
- src/modules/cockpit/tests/CockpitCard.test.tsx
- src/modules/cockpit/tests/CockpitCardActionEntrySurfaces.test.tsx
- src/modules/cockpit/tests/CockpitCardCreateSession.test.tsx
- src/modules/cockpit/tests/cockpitCardDetailsSelectable.test.tsx
- src/modules/cockpit/tests/cockpitCardDetailsEditOption.test.tsx
- src/modules/cockpit/tests/CockpitBriefView.test.tsx
- src/modules/cockpit/tests/cockpitCardFeedback.test.ts
- src/modules/cockpit/tests/cockpitColumnController.test.ts
- src/modules/project-workspace/tests/mobileHeaderCockpitEntry.test.tsx
- src/modules/i18n/locales/*/common.json
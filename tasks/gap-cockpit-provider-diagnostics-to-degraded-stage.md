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

- [x] B1 执行 `bash scripts/with-memory-cap.sh npx vitest run src/shared/tests/cockpitCardTypeSync.test.ts --maxWorkers=1` 退出 0；`CockpitCardProviderDiagnostic` 在 server/client 两端的字段集合一致，包含 provider、ok、reason、cards、skippedLines、cached、truncated、completeLines、truncatedTailBytes。
- [x] B2 执行 `bash scripts/with-memory-cap.sh npx vitest run src/modules/cockpit/tests/cockpitCardController.test.ts --maxWorkers=1` 退出 0；用例覆盖：`fetchCards` 返回空卡加一条 `ok:false` diagnostic 时快照 `status:'loaded'`、`providerFailures` 含该条、`degraded:true`；返回健康卡加失败 diagnostic 时 `visibleCards` 保留健康卡且 `degraded:true`；`fetchCards` 抛错时仍为 `status:'error'`。
- [x] B3 执行 `bash scripts/with-memory-cap.sh npx vitest run src/modules/cockpit/tests/CockpitCardList.test.tsx --maxWorkers=1` 退出 0（新建文件）；断言三分支的 testid 与文案：无卡有失败显示 `cockpit-card-provider-error` 且不显示 `cockpit-card-empty`；有卡有失败同时显示卡片与提示；无卡无失败显示 `cockpit-card-empty`。
- [x] B4 执行 `bash scripts/with-memory-cap.sh npx vitest run src/modules/cockpit/tests/CockpitColumn.test.tsx src/modules/cockpit/tests/CockpitOverlay.test.tsx src/modules/cockpit/tests/cockpitCardsMobileDetails.test.tsx --maxWorkers=1` 退出 0，确认页面、列、手机抽屉三处共用列表接同一读数。
- [x] B5 执行 `bash scripts/with-memory-cap.sh npx vitest run src/modules/cockpit/tests/i18nCockpitCompleteness.test.ts --maxWorkers=1` 退出 0；`npm run typecheck`、`npm run lint`、`npm run build:client` 分别退出 0；按 RECORDED CHANGE 格式更新 `server/shared/tests/architecture-ratchet.baseline.json` 中 `server/shared/types.ts` 与 `src/shared/types.ts` 的旧→新读数并写明原因与日期，执行 `bash scripts/with-memory-cap.sh npx tsx --tsconfig server/tsconfig.json --test server/shared/tests/architecture-ratchet.test.ts` 退出 0。
- [x] B6 负控并改完即还原：transport 丢掉 diagnostics，B2/B3 必须红；任一 provider 失败就把整墙置为 `status:'error'`，B3 的「有卡仍显示」必须红；下一次成功轮询不清除提示，B2 必须红。

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

## Evidence

实现提交 `c4c7055da`（worktree `gap-cockpit-provider-diagnostics-to-degraded-stage`，已合并 develop）。

**AC 读数（全部退出 0）**

- B1 `cockpitCardTypeSync.test.ts`：8 passed。新增 `CockpitCardProviderDiagnostic` 行 + 九字段逐名钉子（`cached/cards/completeLines?/ok/provider/reason/skippedLines/truncated?/truncatedTailBytes?`），两端 `readObjectKeysFromSource` 读数一致。
- B2 `cockpitCardController.test.ts`：77 passed，新增 4 条（空卡+`ok:false` ⇒ `status:'loaded'`/`providerFailures`/`degraded:true`；健康卡+失败 diagnostic ⇒ `visibleCards` 保留且 `degraded:true`；下一轮健康 ⇒ 清空；抛错 ⇒ `status:'error'` 且 `providerFailures:[]`）。
- B3 `CockpitCardList.test.tsx`（新建）：6 passed。三分支 testid 逐条断言，另加「页面 binding 的默认 transport 转发 diagnostics」一腿（spy `api.cockpitCards` 返回 `{cards:[],diagnostics:[ok:false]}` ⇒ 墙上出现 `cockpit-card-provider-error`）。
- B4 三处共用列表：`CockpitColumn.test.tsx` 19 + `CockpitOverlay.test.tsx` 2 + `cockpitCardsMobileDetails.test.tsx` 18 = 39 passed。
- B5 `i18nCockpitCompleteness.test.ts` 14 passed（12 个 locale 全部补齐 `cardProviderError`/`cardProviderNoReason`/`cardProviderRetry`，占位符 `providers,reason` 一致）；`npm run typecheck` exit 0；`npm run lint` exit 0（仅既有 warning）；`npm run build:client` exit 0；`architecture-ratchet.test.ts` 6 passed。baseline RECORDED CHANGE（2026-11-06，gap-cockpit-provider-diagnostics-to-degraded-stage）：`server/shared/types.ts` 5655→5693、`src/shared/types.ts` 5010→5048 —— 两端手抄的 wire 契约各增 38 行，新增的正是这次交付的类型。
- 连带受影响测试另行全绿：`CockpitCard`/`CockpitCardCreateSession`/`CockpitBriefView`/`CockpitCardActionEntrySurfaces`/`cockpitCardFeedback`/`cockpitCardDetailsSelectable`/`cockpitCardDetailsEditOption`/`cockpitColumnController`/`mobileHeaderCockpitEntry`/`cockpitCardsMobileShell` 共 174 passed（`fetchCards` 由 `CockpitCard[]` 改为 `{cards, diagnostics}` 的调用点全部更新）。

**B6 负控（每次改完立即还原，还原后 144 passed 复验）**

1. 丢掉 diagnostics：`read()` 里 `providerFailures` 恒为 `[]` ⇒ B2 + B3 文件共 7 red（含 transport 转发腿）。
2. provider 失败即整墙 error：`providerFailures.length>0` 时抛错 ⇒ 同一批 7 red，含「有卡有失败仍显示健康卡」。
3. 下一轮成功不清提示：空失败时沿用上一轮 `providerFailures` ⇒ 精确 2 red：`a successful poll clears the failures` 与 `the retry re-reads, and a recovered provider clears the notice`。

**DoD — 隔离实例两条真实 provider 读数**

隔离实例：`/tmp/cockpit-dod-gap-provider-diagnostics`（`scripts/isolated-instance.sh` 建库后以同库同 settings 手工重启，residentRestore.enabled=false、`CLAUDE_SESSION_SCOPE_SWEEP=off`），端口 4391，production build（`npm run build:client` + `npm run build:server`），settings `cockpit.enabled=true`、`cockpit.fleetCards.enabled=true, ttlMs=1000`，`QUAY_FLEET_BIN=/tmp/cockpit-dod-fleet.sh`（flag 文件不存在时向 stderr 打印一行并以 1 退出；存在时 exit 0 空批次）。

- 第一腿（fixture off，quay-fleet 失败）`GET /api/cockpit/cards` 原文：
  `{"cards":[],"diagnostics":[{"provider":"quay-fleet","ok":false,"reason":"cockpit-dod fixture: quay-fleet CLI unavailable (QUAY_FLEET_BIN)","cards":0,"skippedLines":0,"cached":false}]}`
  DOM：`providerFailure=true`、`providerFailureProviders="quay-fleet"`、`retry=true`、`empty=false`、`cardCount=0`。截图 `tmp/cockpit-provider-degraded/leg1-fleet-failed.png`（页面只有原因行 + Retry，无「没有等待处理的卡片」空态）。
- 第二腿（fixture on，quay-fleet 仍失败）`GET /api/cockpit/cards`：`cards` 9 条（全部 `provider:"fixture"`），`diagnostics` 仍为上面那条 `ok:false`。DOM：`providerFailure=true`、`cardCount=9`、`empty=false`。截图 `tmp/cockpit-provider-degraded/leg2-fixture-cards-plus-notice.png`（9 张夹具卡 + 顶部常驻原因 + Retry）。
- 第三腿（恢复）：页面点 `cockpit-card-provider-retry` 后 `GET /api/cockpit/cards` 变为 9 张夹具卡 + `{"provider":"quay-fleet","ok":true,"reason":null,"cards":0,"skippedLines":0,"cached":false}`。DOM before `{providerFailure:true, cardCount:9}` → after `{providerFailure:false, cardCount:9}`。截图 `tmp/cockpit-provider-degraded/leg3-recovered-notice-cleared.png`（提示消失、卡片保留）。

**场景运行器说明**：`scripts/ui-scenarios/` 现有场景（`cockpit-knowledge-application`、`cockpit-session-start-settings` 等）都不驱动 provider 失败/恢复这条新读数，且 `window.__cloudpitScenario` 语义面只在开发构建挂载，而 DoD 实例要的是隔离的 production build；因此本次没有可执行的卡片失败态场景，按 DoD 条款以上面的真实页面读数与三张截图为准。另：本会话未暴露 MCP 浏览器工具，真实页面由 Playwright（与 `scripts/ui-scenario.mjs` 同一引擎）驱动并整页截图，脚本保存在 `tmp/cockpit-provider-degraded/read-cards.mjs` 与 `recover.mjs`。

## Axis

该轴仍暗,理由:本任务只修复卡片读数的客户端投影（diagnostic 透传与失败态渲染），不新增领域数据能力（L_D），也不改变目标层判据（L_G）。

---
id: gap-cockpit-card-dismiss-disposition
title: 驾驶舱卡片「忽略/丢弃」动作：不 session.send，走 fleet.feedback dismiss（claudecodeui 侧）
status: ready
labels:
  - gap
  - cockpit
parent: null
children: []
extra:
  schema: execution
---
## Proposal

来源：线上驾驶舱 session-ask 卡（fleet `cockpit cards --json` 里 kind=ask）只有「是/否」两个选项；任一选项确认后都经 CloudCLI 内置 `session.send` 执行器把选项文本写回原会话、触发一轮推理（`server/modules/cockpit/cockpit-fleet-card-projection.ts` 的 `contentOption()` 给每个摘要选项的动作是 `{executor:'session.send', params:{sessionId, text}}`，真正写回在 `server/modules/cockpit/cockpit-session-send.executor.ts:95` 的 `deps.send`）。用户要第三个「忽略/丢弃」动作：不回发、直接作废这张卡与其 fleet 事件。

方案（已与 quay-fleet 会话对齐）：复用 fleet 在 `rescue executors --json` 声明的 `fleet.feedback` 反馈执行器（动作成功后 CloudCLI 调它、fleet 据此关闭条目），加 dismiss 信号——反馈参数带顶层 `dismiss: true`，receipt 返回 `disposition:'dismissed'`；fleet 照关条目并把关闭原因记 dismissed（与 closed/kept/rejected 区分）。本仓只负责 claudecodeui 侧：加宽 `CockpitCardReceiptDisposition`（`server/shared/types.ts` 与 `src/shared/types.ts` 两份同步）、在 `cockpit-card-actions.ts` 增一条「跳过动作执行器、直接发 dismiss feedback」的通道、`cockpit.module.ts` 增 dismiss 路由、卡片 UI 增「忽略/丢弃」动作与确认目标。fleet 侧 `fleet.feedback` 的 dismissed 处置在 quay-fleet 仓另立任务；本仓用夹具 provider 验证 dismiss 通道，不依赖 fleet 侧先落地。

<!-- dedup-ref -->
与 gap-cockpit-card-surface-polish 分开立案：那条是表面打磨，本条是行为改动（新增忽略/dismiss 通道），独立验收；两任务 Touches 重叠在 CockpitCard.tsx 与 CockpitCardDetails.tsx，调度器按 Touches 重叠串行。

## AC

- [x] `grep -n "dismissed" server/shared/types.ts src/shared/types.ts` 各命中 `CockpitCardReceiptDisposition` 那一行，且 `npm run typecheck` 退出 0。
- [x] `npx vitest run src/shared/tests/cockpitCardTypeSync.test.ts` 退出 0（两端 `CockpitCardReceiptDisposition` union 成员一致，均含 `dismissed`）。
- [x] `npx tsx --tsconfig server/tsconfig.json --test server/modules/cockpit/tests/cockpit-card-feedback.test.ts` 退出 0，新增用例：dismiss 确认不调用任何动作执行器（`session.send` 桩调用次数 0）、feedback 参数带 `dismiss: true`、receipt `disposition:'dismissed'` 走 settle 分支（卡片消失，不按 kept/rejected 返回队列）。
- [x] `npx tsx --tsconfig server/tsconfig.json --test server/modules/cockpit/tests/cockpit-card-feedback.test.ts server/modules/cockpit/tests/cockpit-card-registry.test.ts server/modules/cockpit/tests/cockpit-fleet-card-provider.test.ts` 退出 0（既有用例不减）。
- [x] `npx vitest run src/modules/cockpit/tests/cockpitCardController.test.ts` 退出 0，新增用例：卡片级「忽略/丢弃」确认目标与 option/ownReply 并列、其 confirm 走 dismiss 通道而非 session.send；假形态变红——把 dismiss 确认改回调 session.send 即红，改完还原。
- [x] `npx vitest run src/modules/cockpit/tests/CockpitCard.test.tsx` 退出 0，新增用例：session-ask 卡渲染「忽略/丢弃」动作，点击进入确认态且不影响现有「是/否」选项。
- [x] `npx vitest run src/modules/cockpit/tests/i18nCockpitCompleteness.test.ts` 退出 0（新增「忽略/丢弃」key 在 12 个 locale 键集一致）；`npm run lint` 退出 0（仅既有 warning）。
- [x] `npx tsx --tsconfig server/tsconfig.json --test server/shared/tests/architecture-ratchet.test.ts` 退出 0；若 `cockpitCardController.ts` 或 `CockpitCard.tsx` 增行越过基线，按 AC-394 的 RECORDED CHANGE 格式在 `server/shared/tests/architecture-ratchet.baseline.json` 记录，不得静默上调。

## DoD

真实页面（MCP 浏览器实际操作 + 截图存 `tmp/`）：

1. 打开 cockpit 卡片页，对一张 session-ask 卡（`cockpit.fixtureCards` 夹具或真实卡）点「忽略/丢弃」→ 确认：截图显示该卡从可见列表消失、确认通知为「已忽略」；并确认原会话未新增一条由该选项文本触发的 user 回合（读 session transcript 或活动读数，无新一轮推理）。
2. 服务端对同一张卡走 dismiss 确认后，夹具 provider 的 feedback 记录参数带 `dismiss: true`、receipt `disposition:'dismissed'`，卡片按 settle 处理（消失，不按 kept/rejected 返回队列）。
3. 截图存 `tmp/`；若存在可用场景，同时跑 `node scripts/ui-scenario.mjs <scenario.json> …` 并贴出 JSON 报告与检查点截图。

DoD 读数（2026-10-29；隔离实例 127.0.0.1:3407 + Vite 127.0.0.1:5199，settings `cockpit.fixtureCards:true`，夹具 feedback 取 settings 默认 `closed`）：

- 真实页面（本会话无 MCP 浏览器，按既有配方用一次性 Playwright 探针 `tmp/dod-dismiss.mjs`）：在 `/cockpit?view=cards` 对 `fixture:ask` 点「Ignore / discard」→「Confirm discard」，卡片从可见列表与 `GET /api/cockpit/cards` 同时消失，列表顶部通知读数 `已忽略`（`data-ok="true"`）；期间 `/api/cockpit/cards/confirm` 与 chat send 的请求计数均为 0。截图：`tmp/dod-dismiss/01-cards-before.png`、`02-dismiss-confirm.png`、`03-after-dismiss.png`，以及第二张 ask 卡复跑的 `04-fixture-session-only-notice.png`（通知与「卡已消失」同页可见）。报告 `tmp/dod-dismiss/report.json`：`failures: []`，`dismissResponse.body` = `executor: fixture.feedback`、`params.dismiss: true`、`result.receipt.disposition: "dismissed"`。
- 服务端：dismiss 的 HTTP 应答即夹具 feedback 执行器读数（`params.dismiss: true`、receipt `dismissed`、卡片按 settle 消失）；服务端判据另证动作执行器调用 0 次、store 不记 kept/rejected notice。
- 场景运行器：`node scripts/ui-scenario.mjs e2e/scenarios/cockpit-mode-switch.json …` 3/3 绿，报告 `tmp/scenario-mode-switch-report.json`，检查点 `tmp/scenario-mode-switch/`。现有 `cockpit-cards-confirm.json` 第 4 步在 develop 基线上即红（fixture executor 每次确认都递增 revision，controller 随内容变化把 shown 掉回默认），与本任务 diff 无关，未作为本任务读数。

该轴仍暗,理由:本任务只在既有 cockpit 模块内增加一条 dismiss 反馈通道、控制器确认状态与卡片第三个按钮，不新增或迁移模块依赖与抽象，L_D/L_G 无可读增量；架构面唯一读数是被动抬高的 AC-394 行宽棘轮（已按 RECORDED CHANGE 记录）。

## Touches

- tasks/gap-cockpit-card-dismiss-disposition.md
- server/shared/types.ts
- server/modules/cockpit/cockpit-card-feedback-store.ts
- server/modules/cockpit/cockpit-fixture-card-provider.ts
- server/modules/cockpit/cockpit-fleet-card-projection.ts
- server/modules/cockpit/cockpit-card-actions.ts
- server/modules/cockpit/cockpit.module.ts
- server/modules/cockpit/tests/cockpit-card-feedback.test.ts
- server/shared/tests/architecture-ratchet.baseline.json
- src/shared/types.ts
- src/modules/cockpit/cockpitCardController.ts
- src/modules/cockpit/CockpitCard.tsx
- src/modules/cockpit/CockpitCardList.tsx
- src/modules/cockpit/CockpitCardDetails.tsx
- src/modules/cockpit/CockpitCardConfirmBar.tsx
- src/modules/cockpit/hooks/useCockpitCards.ts
- src/modules/cockpit/index.ts
- src/shared/api.ts
- src/modules/cockpit/tests/cockpitCardController.test.ts
- src/modules/cockpit/tests/CockpitCard.test.tsx
- src/shared/tests/cockpitCardTypeSync.test.ts
- src/modules/i18n/locales/de/common.json
- src/modules/i18n/locales/en/common.json
- src/modules/i18n/locales/es/common.json
- src/modules/i18n/locales/fr/common.json
- src/modules/i18n/locales/id/common.json
- src/modules/i18n/locales/it/common.json
- src/modules/i18n/locales/ja/common.json
- src/modules/i18n/locales/ko/common.json
- src/modules/i18n/locales/ru/common.json
- src/modules/i18n/locales/tr/common.json
- src/modules/i18n/locales/zh-CN/common.json
- src/modules/i18n/locales/zh-TW/common.json

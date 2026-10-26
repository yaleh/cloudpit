---
id: gap-quay-pulse-popover-counts-band-and-inflight-list
title: 标题栏 Quay popover：增加各状态任务/goal 计数带与 in-flight 任务列表（Tests/Fan-in 等 quay
  读取动词发版后另做）
status: ready
labels:
  - gap
parent: null
children: []
extra:
  schema: execution
---
## Proposal

<!-- dedup-ref --> 相关的已完成任务：`gap-workspace-header-quay-pulse-trigger-and-session-popover`（popover 本体）、`gap-quay-tab-status-band-charts-session-first-layout`（Quay tab 的状态带与会话面板，已落地）。本任务机制不同：给 popover 加两块项目级读数，不改本会话提及列表、不改甘特图与窗口设置。

背景（2026-10-26 用户裁定）：popover 要参考 Quay tab 补充信息。裁定的范围是：各状态 task 与 goal 的数量统计、in-flight 任务列表；Tests 与 Fan-in 两张图**不在本任务内**——它们目前由 CloudCLI 直接读 `.quay/` 内部文件，用户要求改由 quay CLI 提供，待 quay 的读取动词发版后另立任务，本任务不得为 popover 新增任何直接读 `.quay/` 文件的代码。「激活的任务」一项用户尚未界定，本任务不做。

要做的事：
- popover 打开时读取一次 `api.quaySnapshot(projectId, { hours: 窗口小时数 })`（与 tab 共用服务端 TTL 缓存），关闭即丢弃，重新打开再读；不轮询；新增 hook `useSessionSnapshot` 放在 `hooks/useSessionPulse.ts`，与 `useSessionMentions` 同样的打开才读语义。触发器的 30 秒 lanes 轮询不变。
- 计数带：一行小徽标。项目级任务按状态（`snapshot.tasks.byStatus`）与 goal 按状态（`snapshot.goals.breakdown.byStatus`），徽标样式沿用 in-flight 卡的状态徽标，标签注明是「项目」口径；另有一行「本会话 N 个任务 · M 个 goal」，由已有的提及列表算出。`tasks` 或 `goals` 为 `null` 时该组不画任何数字，写「未读到」，不得画 0。
- in-flight 列表：`snapshot.inFlight` 每项一行：任务 id、阶段徽标（沿用 `QUAY_IN_FLIGHT_PHASE_META`）、已运行时长；本会话提到过的任务加标记。`null` 写「未读到」，`[]` 写「当前没有任务在跑」，两者不得混同。
- 整体顺序：甘特图与窗口设置、计数带、in-flight 列表、本会话 goal 与 task 列表（原有）。snapshot 读失败或未返回时，计数带与 in-flight 位置显示一行错误提示，原有的甘特图与会话列表仍正常显示。
- 手机（isMobile）下同样显示，沿用现有面板的纵向滚动。

不做：Tests、Fan-in 图；抽取或改动 `QuayPanel.tsx` 里的卡片函数；改 server；「激活的任务」列表；新增轮询。

## AC

- [ ] 读取时机：`npx vitest run src/modules/quay/tests/SessionPulse.test.tsx` exit 0；新增用例：popover 打开时 `quaySnapshot` 恰被调用一次且带当前窗口小时数，关闭后重新打开再调一次；打开期间没有定时重读；触发器的 lanes 轮询次数与改动前相同。
- [ ] 计数带：同一测试文件含用例：给定 `tasks.byStatus` 与 `goals.breakdown.byStatus`，每个状态各出一个徽标且数字正确；`tasks: null` 时该组出现「未读到」且文本里没有数字 0；会话计数行等于提及列表的任务数与 goal 数。
- [ ] in-flight：同一测试文件含用例：三项 `inFlight`（不同阶段）渲染三行，徽标色取自 `QUAY_IN_FLIGHT_PHASE_META`；本会话提到过的任务行带标记、没提到的不带；`inFlight: null` 与 `[]` 渲染出不同的文案。
- [ ] 降级：同一测试文件含用例：`quaySnapshot` 拒绝时，计数带与 in-flight 位置出现错误提示，而甘特图与会话任务列表仍然渲染。
- [ ] 不读内部文件：`git diff -U0 -- src server | grep -nE "\\.quay/|full-suite-state|verification-round|worker-outcome"` 无输出；`git diff -U0 -- server` 无输出。
- [ ] 文案与完整性：`npx vitest run src/modules/project-workspace/tests/i18nQuayTabCompleteness.test.ts` exit 0，十二个 locale 的 `common.json` 都含新增键；`npx vitest run src/modules/chat/tests/chatInterfaceEscapeAbort.test.tsx` exit 0。
- [ ] 静态检查：`npx tsc --noEmit -p tsconfig.json` exit 0，`npx oxlint src/modules/quay` exit 0。

## DoD

在真实运行的页面上（MCP 浏览器；若被别的会话占用则用一次性 Playwright 脚本并如实注明）：桌面宽度与手机宽度（768px 以下）各打开本项目某个会话的 popover，截图存 `tmp/`，并贴出：计数带的数字与同一时刻 Quay tab 里 Task ledger、Stage goals 的数字一致；in-flight 列表与 Quay tab 的 In flight 卡一致；窗口切换后甘特图仍随之变化；浅色与深色各一张。按项目约定同时跑 `node scripts/ui-scenario.mjs` 下现有的 quay 相关场景并贴出 JSON 报告；没有可用场景则如实写明。

## Touches

- src/modules/quay/SessionPulsePopover.tsx
- src/modules/quay/hooks/useSessionPulse.ts
- src/modules/quay/index.ts
- src/shared/types.ts
- src/modules/i18n/locales/*/common.json
- src/modules/quay/tests/SessionPulse.test.tsx
- src/modules/project-workspace/tests/i18nQuayTabCompleteness.test.ts
- src/modules/chat/tests/chatInterfaceEscapeAbort.test.tsx
- tasks/gap-quay-pulse-popover-counts-band-and-inflight-list.md

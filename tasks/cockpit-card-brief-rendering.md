---
id: cockpit-card-brief-rendering
title: 驾驶舱简报渲染：Details 打开时取 GET /api/cockpit/cards/:id/brief，按预置形式描述表画出
  radar、compare-table、diffstat、checklist、timeline、graph、callout；简报线上类型进共享类型并由
  TypeSync 钉住
status: ready
labels:
  - feature
  - cockpit
parent: null
children: []
extra:
  schema: execution
goal_ac: AC-431
---
## Proposal

来源：本会话 2026-10-27。`cockpit-session-ask-brief` 已落地简报服务与读口 `GET /api/cockpit/cards/:id/brief`（返回 `status: generated | fallback`、原因、简报文档），但界面没有任何地方渲染它。E2 盲评里用户认为简报「基本都可以接受」；盲评用的渲染是实验脚本 `experiments/cockpit-briefing/e2-render.mjs` 与 `/tmp/cockpit-analysis/` 下的效果图脚本（都只是参考，未入库或不在本仓库，worker 可按绝对路径 `/data/home/yale/work/claudecodeui/experiments/cockpit-briefing/` 读）。设计原则见 `docs/architecture/cockpit-attention/INTERACTION-PRINCIPLES.md` D 节：可视化词汇固定、● 机械与 ○ 判断分开标注、不编造。

做什么：

- 线上类型：服务端 `server/modules/cockpit/cockpit-brief-core.ts` 里简报文档现为 `Record<string, unknown>`。在 `server/shared/types.ts` 定义简报读口的线上类型（`CockpitBriefResponse`：status、reason、question、headline、options、blocks 等；块按预置形式区分的联合类型），服务端读口改用它；`src/shared/types.ts` 加镜像；`src/shared/tests/cockpitCardTypeSync.test.ts` 扩展到简报类型（或同目录新判据），两侧任一侧增删字段或字面量即红。
- 渲染：`src/modules/cockpit/CockpitBriefView.tsx` 与 `src/modules/cockpit/cockpitBriefBlocks.tsx`。每种预置形式一个渲染器，经描述表查找（不按类型写分支）；未知块类型走默认渲染（显示块标题与原始要点）。雷达图必带 rev 与 evid 两条轴，轴名可读、分数旁有一句「高意味着什么」；对照表、diffstat、checklist（`done` 可选，默认未完成）、timeline、graph、callout 用现有 Tailwind 类与 SVG 画，不引入新的图表依赖。
- 取数：`src/modules/cockpit/cockpitCardController.ts` 增加简报状态（idle、loading、ready、error），Details 打开时请求一次，同一卡片同一 revision 关闭再打开不重复请求；`src/shared/api.ts` 加 `cockpitCardBrief(id)`。
- 挂载：`CockpitCardDetails.tsx` 在情境之后、选项之前显示简报；fallback 时显示原因（例如「今日简报额度已用完」）且不画空图；失败时显示可读错误，卡片其余部分照常可用。
- DoD 用的数据：夹具提供方开启时，读口对夹具卡片返回一份覆盖七种预置形式的固定简报（`server/modules/cockpit/cockpit-fixture-card-provider.ts` 内的常量），以便在不调用网关的情况下做真实页面验证；非夹具卡片行为不变。
- 新文案进所有语言的 `common.json`。

## AC

- [x] `npx vitest run src/modules/cockpit/tests/CockpitBriefView.test.tsx` 退出 0（AC-431 判据）：简报读口桩掉；覆盖 Details 打开请求恰好一次、同 revision 重开不重复请求、七种预置形式各渲染出可识别的结构、雷达带 rev 与 evid、未知块类型默认渲染不报错、fallback 显示原因且无空图、loading 与 error 两态。
- [x] 简报线上类型两侧一致：`npx vitest run src/shared/tests/cockpitCardTypeSync.test.ts` 退出 0；临时在 `src/shared/types.ts` 的简报状态联合里删去 `fallback` 后该命令退出非 0 且失败信息点名该字面量，随后改回。
- [x] 假形态变红：把渲染改为按块类型写 `switch` 且去掉默认分支 ⇒ 未知块类型用例红；改完即还原。
- [x] 服务端不退：`npx tsx --tsconfig server/tsconfig.json --test server/modules/cockpit/tests/cockpit-brief.test.ts` 与 `npx tsx --tsconfig server/tsconfig.json --test server/modules/cockpit/tests/cockpit-brief-spec.test.ts` 均退出 0。
- [x] `npx vitest run src/modules/cockpit/tests src/modules/chat/tests/inlineQuoteChip.test.tsx` 退出 0，既有用例数不减少。
- [x] `npm run typecheck`、`npm run lint` 与 `npm run build:client` 退出 0；提交前单跑 `npx tsx --tsconfig server/tsconfig.json --test server/shared/tests/architecture-ratchet.test.ts` 退出 0。

## DoD

隔离实例（`scripts/isolated-instance.sh start`，打开 `cockpit.fixtureCards`）上用 MCP 浏览器（不可用时按项目备忘用一次性 Playwright，并如实写明）在 390 与 1280 宽度打开 `/cockpit?view=cards`，打开一张夹具卡片的 Details：七种预置形式都画出来，逐块截图存 `tmp/`；雷达的轴名与分数可读、没有被挤压成竖排（E2 渲染曾在窄宽度下出现此问题）。再在同一实例打开 `cockpit.brief.enabled`、把 `dailyTokenCap` 设为 1，对一张非夹具、带 `cloudcli.session-ask` 内容引用的卡片（可用临时未提交的提供方给出，用完删除并重建 dist）打开 Details：显示 fallback 原因、无空图、网关调用数为 0。实例用毕 `scripts/isolated-instance.sh stop`。

## DoD 记录

本会话没有 MCP 浏览器，按项目备忘改用一次性 Playwright 脚本（未进提交）。隔离实例 `scripts/isolated-instance.sh start` 读到 `residentRestore.enabled=false`、`resident-restore started=0`；`cockpit.fixtureCards` 通过传给脚本的 `NODE_BIN` 包装器合并进它的 settings 文件（脚本自带 start 只写 residentRestore）。

- 夹具卡 `fixture:ask` 的 Details 在 1280×900 与 390×844 都画出七种预置形式（radar / compare-table / diffstat / checklist / timeline / graph / callout 各 1 个，无重复），逐块截图 `tmp/brief-dod/shots/{width}-block-*.png`，读数 `tmp/brief-dod/report.json`；控制台错误与 pageerror 均 0。
- 雷达在 390 宽度下三条轴各 348×47、标签单行 17px，没有被压成竖排；rev/evid 轴名、●/○ 与「high means: …」都可见（`390-viewport-brief.png`）。
- 同一卡片关闭再打开：`/brief` 请求数保持 1（`report.json` 的 requestsAfterOpen / requestsAfterReopen）。
- fallback 腿：`cockpit.brief.enabled=true`、`dailyTokenCap=1`，先用一次热身简报花掉 150 tokens，再打开非夹具卡 `temp:2` ⇒ 显示「today's brief budget is used up」、0 个 block、0 张 SVG，该腿网关调用 0 次（`tmp/brief-dod/leg2-report.json`，截图 `390-fallback-details.png`、`1280-fallback-details.png`）。临时提供方与本地桩网关用完即删，未进提交。
- 浏览器腿之后修了一处观感问题：graph 的 SVG 在宽抽屉里被拉满宽，标签放大到 40px；加 `max-w-[360px]` 后 1280 下为 360px（`1280-viewport-brief-bottom.png`）。

## ADR-007 暗轴记录

该轴仍暗,理由:本任务只交付前端渲染与服务端线上类型的映射，没有新增文档、也不改模块依赖图；L_D 与 L_G 是仓库级读数，本任务没有使它们发生变化。

## Touches

- tasks/cockpit-card-brief-rendering.md
- src/modules/cockpit/CockpitBriefView.tsx (new)
- src/modules/cockpit/cockpitBriefBlocks.tsx (new)
- src/modules/cockpit/tests/CockpitBriefView.test.tsx (new)
- src/modules/cockpit/CockpitCardDetails.tsx
- src/modules/cockpit/CockpitCardList.tsx
- src/modules/cockpit/cockpitCardController.ts
- src/modules/cockpit/hooks/useCockpitCards.ts
- src/modules/cockpit/index.ts
- src/shared/api.ts
- src/shared/types.ts
- src/shared/tests/cockpitCardTypeSync.test.ts
- server/shared/types.ts
- server/modules/cockpit/cockpit-brief-core.ts
- server/modules/cockpit/cockpit-brief.service.ts
- server/modules/cockpit/cockpit-fixture-card-provider.ts
- server/modules/cockpit/cockpit.module.ts
- src/modules/cockpit/tests/i18nCockpitCompleteness.test.ts
- src/modules/chat/tests/inlineQuoteChip.test.tsx
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
- server/shared/tests/architecture-ratchet.baseline.json

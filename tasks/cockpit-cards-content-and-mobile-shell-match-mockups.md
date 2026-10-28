---
id: cockpit-cards-content-and-mobile-shell-match-mockups
title: 驾驶舱卡片内容与手机外壳对齐效果图：情境与事实去重、手机 Details
  改底部抽屉并常驻确认条、简报关闭时隐藏简报区、手机顶部状态行与单行输入、下拉改单选圆圈并去掉重复的 Write your own
status: ready
labels:
  - gap
  - cockpit
  - ui
parent: null
children: []
extra:
  schema: execution
---
## Proposal

来源：2026-10-28 用户要求把线上驾驶舱截图与效果图做视觉比较。线上截图（构建 `72aa67bfe`）与并排对照图在 `/data/home/yale/work/claudecodeui/tmp/cockpit-cmp/`（`live-*.png`、`cmp-*.png`；左效果图右线上）；效果图在 `/data/home/yale/work/claudecodeui/tmp/cockpit-redesign/`（`80-m-list-cards.png`、`81-m-dropdown-own-text.png`、`87-m-details-top.png`、`88-m-details-session-link.png`、`150-pc-open.png`、`150-pc-details.png`）。目录 gitignored，按绝对路径读。

本任务处理比较中属于 CloudCLI 前端与外壳的差距（fleet 卡片的选项文案与后果标签由 quay-fleet 处理；缺省建议、stuck 计数已由其它任务交付）：

1. **情境与事实重复、偏机器原文。** fleet 的「需要人」卡情境是「recovery-window-expired (6h) without landing — recorded and raised」，下面两个事实胶囊又原样重复同一段。效果图里情境是一两句人话，事实是短读数（「● driver log 4 次」「● blocker: ready」）。
2. **手机 Details 缺块且有死区。** 效果图 `87` 是底部抽屉（顶部拖拽把手），底部常驻确认条（绑定当前显示的选项），有助手原话引用并带「in session」链接；线上是带 Close 的弹层，没有常驻确认条与原话引用，并且显示「BRIEF · No model brief for this card / the brief feature is off」——线上 `cockpit.brief.enabled` 关闭，这一块是无用的空区。
3. **手机外壳。** 效果图顶部是「Cockpit · Command」加一行状态（idle · landed 5 · suite ✓ · deploy ✓ · 待办数）；线上是「Cockpit · Cards」加两个图标按钮，没有状态行。效果图底部是单行输入（「Say a number, then what to do…」）加大圆形话筒；线上是两行输入框加两个按钮，占地更多。
4. **下拉细节。** 线上下拉里「✎ Write your own」与「Write your own」重复出现；选项项用 1、2 编号，效果图是单选圆圈并高亮当前选中项（`81`）。

做什么：

- 事实去重（`src/modules/cockpit/CockpitCard.tsx` 与 Details）：与情境文本相同、或被情境包含的事实不再显示为胶囊；胶囊只显示事实的短形式（超长截断，完整文本进 Details）。不按提供方分支。
- 手机 Details：改为底部抽屉（约 90% 高、顶部拖拽把手、下拉关闭不用 Escape），底部常驻同一个确认条；摘要里有助手原话时显示一段引用并带「in session」链接（跳到该会话）。简报功能关闭或该卡没有简报时，不渲染简报区。
- 手机外壳（`view=cards` 的手机宽度）：顶部一行状态，读数取现有的 quay 摘要与部署读数（driver 状态、近期落地数、suite、部署是否最新、待办数），不新增服务端接口；底部输入改为单行加圆形话筒按钮，发送按钮在输入有内容时出现。
- 下拉：选项项改为单选圆圈并高亮当前选中项；「自己的回复」只出现一个标题加一个编辑框。
- 新文案进所有语言的 `common.json`。

## AC

- [ ] `npx vitest run src/modules/cockpit/tests/CockpitCard.test.tsx` 退出 0，新增用例：与情境相同或被包含的事实不渲染为胶囊；下拉选项为单选样式且当前选中项带选中态；「Write your own」文本在下拉里恰好出现一次。
- [ ] 新增 `src/modules/cockpit/tests/cockpitCardsMobileDetails.test.tsx`，`npx vitest run src/modules/cockpit/tests/cockpitCardsMobileDetails.test.tsx` 退出 0：手机宽度下 Details 为底部抽屉且含常驻确认条（标签与当前选项一致）；有助手原话时渲染引用与会话链接；简报功能关闭时不渲染简报区；手机卡片页顶部渲染状态行、底部为单行输入。
- [ ] 假形态变红：恢复重复的「Write your own」标题 ⇒ 用例红；简报关闭时仍渲染简报区 ⇒ 用例红。改完即还原。
- [ ] 现有测试不退：`npx vitest run src/modules/cockpit/tests src/modules/chat/tests/inlineQuoteChip.test.tsx` 退出 0，既有用例数不减少。
- [ ] `npm run typecheck`、`npm run lint` 与 `npm run build:client` 退出 0；提交前单跑 `npx tsx --tsconfig server/tsconfig.json --test server/shared/tests/architecture-ratchet.test.ts` 退出 0。

## DoD

隔离实例（打开 `cockpit.fixtureCards`）上用 MCP 浏览器（不可用时用一次性 Playwright 并写明）在 390 宽度截图：卡片列表、展开的选项下拉、Details 底部抽屉；1440 宽度截图 PC 列。把每张截图与对应效果图（`80`、`81`、`87`、`150-pc-open`）拼成左右对照图存 `tmp/`，在完成记录里逐项列出仍有的差异及原因。场景运行器 `e2e/scenarios/cockpit-cards-confirm.json` 贴出 JSON 报告。⛔ 不在线上实例点击任何确认。

## Touches

- tasks/cockpit-cards-content-and-mobile-shell-match-mockups.md
- src/modules/cockpit/CockpitCard.tsx
- src/modules/cockpit/CockpitCardDetails.tsx
- src/modules/cockpit/CockpitCardList.tsx
- src/modules/cockpit/CockpitStage.tsx
- src/modules/cockpit/CockpitPage.tsx
- src/modules/cockpit/CockpitInput.tsx
- src/modules/cockpit/cockpitCardDescriptors.ts
- src/modules/cockpit/tests/CockpitCard.test.tsx
- src/modules/cockpit/tests/cockpitCardsMobileDetails.test.tsx (new)
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

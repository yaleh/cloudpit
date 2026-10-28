---
id: cockpit-cards-content-and-mobile-shell-match-mockups
title: 驾驶舱卡片内容与手机外壳对齐效果图：情境与事实去重、手机 Details
  改底部抽屉并常驻确认条、简报关闭时隐藏简报区、手机顶部状态行与单行输入、下拉改单选圆圈并去掉重复的 Write your own
status: done
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

- [x] `npx vitest run src/modules/cockpit/tests/CockpitCard.test.tsx` 退出 0，新增用例：与情境相同或被包含的事实不渲染为胶囊；下拉选项为单选样式且当前选中项带选中态；「Write your own」文本在下拉里恰好出现一次。
- [x] 新增 `src/modules/cockpit/tests/cockpitCardsMobileDetails.test.tsx`，`npx vitest run src/modules/cockpit/tests/cockpitCardsMobileDetails.test.tsx` 退出 0：手机宽度下 Details 为底部抽屉且含常驻确认条（标签与当前选项一致）；有助手原话时渲染引用与会话链接；简报功能关闭时不渲染简报区；手机卡片页顶部渲染状态行、底部为单行输入。
- [x] 假形态变红：恢复重复的「Write your own」标题 ⇒ 用例红；简报关闭时仍渲染简报区 ⇒ 用例红。改完即还原。
- [x] 现有测试不退：`npx vitest run src/modules/cockpit/tests src/modules/chat/tests/inlineQuoteChip.test.tsx` 退出 0，既有用例数不减少。
- [x] `npm run typecheck`、`npm run lint` 与 `npm run build:client` 退出 0；提交前单跑 `npx tsx --tsconfig server/tsconfig.json --test server/shared/tests/architecture-ratchet.test.ts` 退出 0。

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

## 完成记录（2026-10-28）

### 实现

- `src/modules/cockpit/cockpitCardDescriptors.ts`：新增三个共享纯函数——`cockpitCardFactsBeyondSituation`（把情境与事实都做空白折叠 + 小写归一后按「包含」过滤；情境为空时全部保留）、`cockpitFactShortForm` + `COCKPIT_FACT_PILL_MAX_CHARS = 48`（超长在词边界截断并加「…」，尾部标点去掉）、`cockpitAssistantQuote`（依次在 `situation`、`ask` 里找第一段 「」『』“”"" 引号内容）。卡片与 Details 用同一规则，没有 provider 分支。
- `src/modules/cockpit/CockpitCard.tsx`：胶囊改画 `facts`（去重后）的短形式，`title` 与 `data-full-text` 保留全文；下拉容器本身是 `role="radiogroup"`，每个选项是 `role="radio"` + `aria-checked` + `data-selected`，行首画圆形单选圈（`cockpit-card-option-radio`，选中时实心 + `bg-accent/70 ring-1`）；「自己的回复」触发项同样是 `role="radio"`，下拉里只留一个可见标题，编辑器只有 `aria-label`（不再画第二个标题）。
- `src/modules/cockpit/CockpitCardDetails.tsx`：新增 `drawer` 变体——`h-[90vh] max-h-[90vh] w-full rounded-t-2xl` 底部面板、顶部 sticky 拖拽把手（点击或向下滑 ≥60px 关闭，无 Escape 监听）、抽屉不画 Close 按钮；助手原话引用段（`cockpit-card-assistant-quote`）+「in session」链接（`/session/<id>`）；事实同样去重后全量显示；简报区只在有真实内容时渲染（idle / 缺省，或 `status: 'fallback'` 且 `reason: 'disabled'` 时不画）。
- `src/modules/cockpit/CockpitCardList.tsx`：页面变体用 `useDeviceSettings` 的 `isMobile` 选抽屉，遮罩层 `items-end`；PC 列变体保持内联 Details。
- `src/modules/cockpit/CockpitStage.tsx`：新增 `CockpitPhoneStatus`，只用现有读数——`api.quayFleetSummary` 的 `projects[].driver.state`、`pulse.fanIn.recent` 里 outcome 为 `landed` 的条数、`pulse.tests.current.state`、各项目 `tasks.todo` 之和，以及 `api.system.deployReadiness()` 的 `status`；没有新增服务端接口。
- `src/modules/cockpit/CockpitInput.tsx`：手机宽度下单行 dock（`data-single-line="true"`、`rows=1`、`resize-none`）、圆形话筒，发送按钮仅在 `value.trim() !== ''` 时渲染。
- 12 份 `common.json`：在 `cardWriteOwn` 后新增 6 个键（`cardDetailsAssistantQuote`、`cardDetailsInSession`、`phoneStatusLanded`、`phoneStatusSuite`、`phoneStatusDeploy`、`phoneStatusTodo`），逐语言翻译；`i18nCockpitCompleteness.test.ts` 保持绿。

### 验证

- AC1：`bash scripts/with-memory-cap.sh npx vitest run src/modules/cockpit/tests/CockpitCard.test.tsx src/modules/cockpit/tests/cockpitCardsMobileDetails.test.tsx --maxWorkers=2` → 2 files / 49 tests passed；其中 `CockpitCard.test.tsx` 42 条，新增 4 条：情境已含/被含的事实不画胶囊且 Details 不重复、长事实胶囊截断但 `title` 与 Details 保留全文、下拉为 `radiogroup` 且 3 个单选圈/1 个选中态且切换后标记跟随、下拉里「Write your own」恰好一次且只有一个编辑框。
- AC2：同一命令里新文件 `cockpitCardsMobileDetails.test.tsx` 7 条全过：抽屉（`data-drawer=true`、`h-[90vh]`、`rounded-t-2xl`、层 `items-end`、拖拽把手、无 Close）、确认条标签 = 当前选项（Delete staging）、下滑关闭、引用「继续」+「in session」→ `/session/fixture-session`、关闭简报时不画简报区（且 brief 请求确实发出）、生成态简报仍画（正控制）、状态行读数（running / landed 1 / suite green+ok / deploy fresh+ok / todo 2）、单行输入与发送按钮的出现条件。
- AC3：两条假形态都实测变红并还原——（a）给下拉里的编辑器再加一个可见 `label`，`split('Write your own')` 计数从 1 变 2，`CockpitCard.test.tsx` 红；（b）删掉 `briefVisible` 的 `reason === 'disabled'` 闸，抽屉重新画出「No model brief / the brief feature is off」，`cockpitCardsMobileDetails.test.tsx` 红。两处均从 `/tmp` 备份还原后 49 条全绿。
- AC4：`bash scripts/with-memory-cap.sh npx vitest run src/modules/cockpit/tests src/modules/chat/tests/inlineQuoteChip.test.tsx --maxWorkers=2` → 21 files / 310 tests passed，0 failed（既有用例未减少）。
- AC5：`npm run typecheck` = 0；`npm run lint` = 0（仅有仓库既有 warning）；`npm run build:client` = 0（22.97s）；`npx tsx --tsconfig server/tsconfig.json --test server/shared/tests/architecture-ratchet.test.ts` → 6 pass / 0 fail。本期没有给基线内文件加行，`architecture-ratchet.baseline.json` 未改（新增的是测试文件，不入基线）。

### DoD：隔离实例 + 一次性 Playwright

**MCP 浏览器在本会话不可用**，按任务允许的方式改用一次性 Playwright 脚本 `tmp/dod/verify.mjs`（真实 Vite dev 页面 + 隔离后端）。

- 实例：`scripts/isolated-instance.sh start`（首次因 worktree 无 `dist-server` 先跑 `npm run build:server`），settings 打为 `{"residentRestore":{"enabled":false},"cockpit":{"enabled":true,"fixtureCards":true}}` 后手工重启；`CLAUDE_SESSION_SCOPE_SWEEP=off`；`QUAY_FLEET_BIN=/data/home/yale/work/quay-fleet/bin/quay-fleet.mjs`。后端 `127.0.0.1:1423`，Vite dev `127.0.0.1:5199`（代理到 1423）。
- 夹具只给出线上一半的状态（提供方不在本任务 Touches，无法改夹具），因此脚本在浏览器内改写了两个响应：`fixture:ask` 的情境改成 `对话里只有“继续”，没有 diff 内容。`、事实改成 `没有 diff 内容`（与情境逐字重复，必须被去重）+ `staging holds 1.2 GB`（必须留成短胶囊）；所有简报响应改成 `{"status":"fallback","reason":"disabled"}`，复现线上简报功能关闭的状态。
- 390×844 读数（`tmp/dod/report.json`）：抽屉 `data-drawer=true`、class 含 `h-[90vh] … rounded-t-2xl`、层 `items-end`、把手在、Close 不在；常驻确认条 `Confirm · Delete staging`；引用 `继续`、链接 href `/session/fixture-session`；简报区不在；`fixture:ask` 只剩 1 枚胶囊（重复事实被丢掉）；下拉 3 个单选圈 / 1 个选中、`Write your own` 计数 1；状态行 `driver=running`、`landed=943`、`suite=green(ok)`、`deploy=fresh(ok)`、`todo=1`；输入 `data-single-line=true`、空输入无发送、输入后发送出现。
- 1440 读数：整页 cards 变体不变（无抽屉、有 Close、`data-single-line=false`、发送常在）；`/session/1d38c52e-…` 的 PC 列宽 360px、表头 `9 waiting for you · 2 stuck`、9 张卡、点开后为内联 Details（`inline=true`、`drawer=false`、Back 在、Close 不在）且确认条同为 `Confirm · Delete staging`。
- 截图 `tmp/dod/`：`m-80-cards.png`、`m-81-dropdown.png`、`m-87-details.png`、`m-88-details-session-link.png`、`pc-150-open.png`、`pc-150-details.png`、`pc-150-column.png`、`pc-150-column-details.png`；左右对照图（左效果图 / 右实测）`compare-80-m-list-cards.png`、`compare-81-m-dropdown.png`、`compare-87-m-details.png`、`compare-150-pc-column.png`、`compare-150-pc-column-details.png`。完整读数 `tmp/dod/report.json`。

#### 逐项差异与原因

1. **顶部 chrome 与状态行样式**：效果图是「Cockpit · Command」+ 汉堡按钮，状态行末尾一枚黑色计数圆；本次保留既有的「Cockpit · Cards」+ 两个图标按钮，状态行只画文本读数。头部 chrome 属于更早的壳层任务，本任务只要求「一行状态」；黑色计数圆是效果图里另一个元素，没有对应判据。
2. **Cards/Compact 切换**：效果图是一枚黑色填充的分段控件，实测仍是既有两个描边按钮。本任务没有要求改这个控件。
3. **卡片正文结构**：效果图的选项是带边框的下拉框、`1 of 4` 在标题下方；实测是上一个卡片解剖任务交付的同构结构（选项行 + does 行 + 全宽确认条）。本任务只改下拉里的单选圈与高亮，不改正文骨架。
4. **底部 dock**：效果图占位文案是「Say a number, then what to do…」单行 + 右侧深色圆钮；实测沿用既有命令占位文案与提示行、话筒在左，发送按钮按任务要求只在有内容时出现。占位与提示文案来自既有 i18n 键（不在本任务 Touches），单行/圆形话筒/有内容才发送三项读数都成立。
5. **抽屉信息块**：效果图以问题为标题，并有「RE-OBSERVED NOW · VS WHAT THE SESSION SAID」表与「Compare all 3 side by side ›」；实测以「类型标 · Details · 等待」开头、问题在下一行，没有复观测表与并排比较入口——卡片契约里没有复观测字段，加它需要新契约/服务端改动，超出本任务 Touches。引用块位置：效果图在灰底框内、链接内联；实测是独立小节 + 下方链接（内容与跳转一致）。
6. **数据决定项**：项目名、会话 id（`fixture-session`）、选项文案与 `1 of 2` 计数来自夹具；效果图用真实数据。
7. **简报区**：功能关闭时两边都不画，实测与效果图一致（效果图也没有 BRIEF 块）。

### 场景运行器

`node scripts/ui-scenario.mjs e2e/scenarios/cockpit-cards-confirm.json --base-url http://127.0.0.1:5199 --auth-token … --out tmp/dod/ui-scenario` → 退出 0：

```json
{"scenario":"cockpit-cards-confirm","baseUrl":"http://127.0.0.1:5199","ok":true,"failedStep":null,"stepCount":6,"durationMs":2621,"checkpoints":["step-1-open-cockpit-cards.png","step-2-drive-cockpitCard.select.png","step-3-drive-cockpitCard.showOption.png","step-4-drive-cockpitCard.confirm.png","step-5-drive-cockpitCard.select.png"]}
```

6/6 步、5 张检查点；完整报告 `tmp/dod/ui-scenario/report.json`。确认只在隔离实例（fixture executor）点击，未触碰线上实例。

### 环境备注

- 隔离后端（pid 662387）与 Vite（pid 679761）已停止，1423 端口已释放；主 checkout 上另一个 `dist-server` 进程未动。`tmp/` 是 gitignored，浏览器产物不进提交。

### ADR-007 暗轴记录

该轴仍暗,理由:本任务只改卡片渲染、手机抽屉与外壳的 DOM/样式与文案,AC 内没有 L_D/L_G 探针或读数可记。
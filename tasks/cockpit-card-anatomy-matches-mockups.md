---
id: cockpit-card-anatomy-matches-mockups
title: 驾驶舱卡片解剖对齐效果图：头部行（彩色类型标·项目·主体名·相对时间·负荷）、情境行、事实胶囊、viz
  小图、选项标签图标语义、黑色确认条加说明行、无推荐时一行提示；紧凑模式做成真紧凑
status: done
labels:
  - gap
  - cockpit
  - ui
parent: null
children: []
extra:
  schema: execution
depends_on:
  - gap-cockpit-live-cards-session-link-confirmability-and-titles
---
## Proposal

来源：2026-10-27 用户要求比较线上驾驶舱卡片与之前确认的效果图。效果图（gitignored，按绝对路径读）：手机 `/data/home/yale/work/claudecodeui/tmp/cockpit-redesign/80-m-list-cards.png`、`81-m-dropdown-own-text.png`、`84-m-option-selected.png`、`86-m-list-compact.png`；PC `150-pc-open.png`、`150-pc-compact.png`。线上截图：`/data/home/yale/work/claudecodeui/tmp/cockpit-review-pc-open-1440.png`、`cockpit-review-pc-dropdown-1440.png`、`cockpit-review-pc-compact-1440.png`、`cockpit-review-m-page-390.png`。交互原则见 `docs/architecture/cockpit-attention/INTERACTION-PRINCIPLES.md` D、G 节（可视化词汇固定、● 机械与 ○ 判断分开、颜色稀缺、不编造）。

逐处差异（左效果图 / 右线上）：

- 头部行：彩色类型标（STK 红、ASK 琥珀等）· **项目名** · 任务或会话名（截断）· 相对时间（9h）· 负荷三格 · › ／ 灰色类型标 · 「waiting 15 d ago」，无项目、无主体名、无负荷。
- 情境：问题下方 2–3 行灰字 ／ 无（卡片有 `situation` 时也应显示）。
- 事实：胶囊（● driver log 4 次 · ● blocker: ready），机械读数带 ●、判断带 ○ ／ 项目符号列表里的长原始文本。
- 小图：尝试圆点、进度条等按 `viz` 渲染 ／ 无（`CockpitCardViz.tsx` 已存在，需要接到卡片上并在没有 `viz` 时不画）。
- 选项框：「suggested · ● from assistant / ○ judge / provider · 1 of 4」，→ 做什么、因为…、↺ 随时取消 · ◷ 不耗 worker · ⚠ 不可逆、适合… ／ 结构接近，但标签原样显示原始值（如 `blocked-task-done`），没有 ↺ ◷ ⚠ 的图标语义；来源显示为「Provider」。
- 确认条：黑色实心，下方一行「opens the confirm card — nothing is sent yet」；不可逆为橙色描边加 ⚠ ／ 蓝色实心；没有推荐时是一整条浅蓝的「Nothing to confirm」，又占地方又像能点。
- 紧凑模式：每卡两行问题 + 一行情境 + 同一行的选项下拉与 Confirm，一屏约 5 张 ／ 切到 Compact 后选项说明框仍展开、标题仍两行，一屏约 3 张。

做什么（全部经前端描述表实现，不按提供方或 kind 写分支）：

- `src/modules/cockpit/cockpitCardDescriptors.ts`：kind → 类型标文字、颜色（效果图的色系；颜色只用于类型标与危险态）；tag kind → 图标（undo ↺、cost ◷、irreversible ⚠、fit 适合、其它原样）；source → 「● from assistant / ○ judge / provider」。
- `src/modules/cockpit/CockpitCard.tsx`：头部行（类型标 · `subject.project` · 主体名〔taskId 或会话标题，截断〕· 相对时间〔紧凑格式 9h、3d〕· 负荷格〔有 `load` 时〕· ›）；情境行；事实胶囊（`mechanical` 决定 ● / ○，过长截断，完整内容进 Details）；`viz` 存在时渲染 `CockpitCardViz`，否则不占位；选项框按描述表渲染标签；确认条改黑色实心 + 说明行，不可逆为警示样式；没有推荐时不画大按钮，改为下拉旁一行「选一个选项后确认」。
- `viz` 的形状（quay-fleet 会话 2026-10-27 确定，任务 `fleet-cockpit-rescue-card-content` 交付；只有 stuck、fix 卡带，其余 kind 不给，CloudCLI 不画）：`{ kind: "attempts", cap: 5, items: [{ at: <iso>, outcome: "landed" | "failed" | "running" | "pending" }] }`，items 按 at 新→旧，最多 cap 条。渲染为一排圆点：landed 绿、failed 红、running 动态、pending 虚线；顺序按效果图从旧到新左→右排列（即把 items 反转后画）。共享类型两侧补 `CockpitCardViz` 的 attempts 形状并由 `src/shared/tests/cockpitCardTypeSync.test.ts` 钉住；未知 viz kind 不画、不报错。fleet 同时会把 `facts` 收短为一句一条，长原文放 `ref` 或 Details；渲染端对超长事实截断为胶囊、完整文本进 Details。
- 紧凑模式：问题最多两行、情境一行，选项下拉与 Confirm 同一行，选项说明框不展开（选中选项后也不展开，详情进 Details）。
- 新文案进所有语言的 `common.json`。

## AC

- [x] `npx vitest run src/modules/cockpit/tests/CockpitCard.test.tsx` 退出 0，新增用例：头部行含项目名与主体名；`mechanical: true/false` 的事实分别带 ● / ○；有 `viz` 时渲染小图、无 `viz` 时没有小图节点；undo / cost / irreversible 标签渲染为对应图标与文字；不可逆选项的确认条带警示样式；无推荐时不存在全宽确认按钮而是一行提示；紧凑模式下选项说明框不在 DOM、Confirm 与下拉在同一行容器内。
- [x] 描述表覆盖：未知 kind、未知 tag kind 走默认渲染不报错（用例断言）。
- [x] 假形态变红：在组件里按 `card.provider === 'quay-fleet'` 分支渲染 ⇒ 新增的「同一卡片数据换 provider 字段渲染结果相同」用例红；改完即还原。
- [x] `npx vitest run src/modules/cockpit/tests src/modules/chat/tests/inlineQuoteChip.test.tsx` 退出 0，既有用例数不减少。
- [x] `npm run typecheck`、`npm run lint` 与 `npm run build:client` 退出 0；提交前单跑 `npx tsx --tsconfig server/tsconfig.json --test server/shared/tests/architecture-ratchet.test.ts` 退出 0。

## DoD

隔离实例（打开 `cockpit.fixtureCards`；夹具覆盖六种 kind、有无推荐、有无 viz、可逆与不可逆选项、机械与判断事实）上用 MCP 浏览器（不可用时用一次性 Playwright 并写明）在 390 与 1440 宽度、Cards 与 Compact 两种密度各截图存 `tmp/`，与效果图 `80-m-list-cards.png`、`86-m-list-compact.png`、`150-pc-open.png`、`150-pc-compact.png` 并排对照，在完成记录里逐项列出仍有的差异及原因（例如某字段提供方未给）。场景运行器 `e2e/scenarios/cockpit-cards-confirm.json` 贴出 JSON 报告。⛔ 不在线上实例点击任何确认。

## Touches

- tasks/cockpit-card-anatomy-matches-mockups.md
- src/modules/cockpit/CockpitCard.tsx
- src/modules/cockpit/CockpitCardViz.tsx
- src/modules/cockpit/cockpitCardDescriptors.ts
- src/modules/cockpit/CockpitCardList.tsx
- src/modules/cockpit/cockpitCardController.ts
- src/modules/cockpit/tests/CockpitCard.test.tsx
- src/modules/cockpit/tests/cockpitCardController.test.ts
- server/shared/types.ts
- src/shared/types.ts
- src/shared/tests/cockpitCardTypeSync.test.ts
- server/modules/cockpit/cockpit-fixture-card-provider.ts
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

## 完成记录（2026-10-27）

### 实现

- `src/modules/cockpit/cockpitCardDescriptors.ts`：kind → 描述表一行（类型标文案 `badgeKey`、稀缺色 `tone`、可画的 `viz`），六种 kind 之外走 `DEFAULT_COCKPIT_CARD_DESCRIPTOR`（未知 kind 不报错）；tag kind → 图标表（`undo ↺`、`cost ◷`、`irreversible ⚠`、`fit` 无图标——其文本自身就是「适合」、未知 kind 无图标）；source → `● from assistant / ○ judge / provider`；`cockpitCardSubjectName` 依次取 `subject.title` → `taskId` → 会话 id 前 8 位。
- `src/modules/cockpit/CockpitCard.tsx`：A 区头部行（稀缺色类型标 + 项目 + 主体名截断 + 紧凑相对时间 + 三格负荷 + ›）、情境行（Cards 两行 / Compact 一行）、事实胶囊（`mechanical` → ●/○，`max-w-[16rem]` 截断、`title` 带全文、内容完整版在 Details）、viz 在事实行右侧且没有 `viz` 时不占位。B/C 区：选项行按描述表渲染标签与来源；确认条改黑色实心 + 「opens the confirm card — nothing is sent yet」说明行，不可逆为琥珀描边 + ⚠；无确认目标时不画全宽按钮，改为下拉旁虚线框「Choose an option, then confirm」。Compact：问题两行、情境一行、不画事实行/说明框、下拉与 Confirm 同一行、短文案 Confirm、无说明行。
- `src/modules/cockpit/CockpitCardViz.tsx`：`attempts` 的新读数 `items`（提供方按 at 新→旧给出）反转后从旧到新左→右画点，`cap` 限定条数；landed 绿 / failed 红 / running 脉冲 / pending 虚线；未知 outcome 中性点。旧的标量 `count` 分支保留，老提供方仍能画点。
- 共享契约：`server/shared/types.ts` 与 `src/shared/types.ts` 同步新增 `CockpitCardVizOutcome`、`CockpitCardVizAttempt`、`CockpitCardViz.cap/items`、`CockpitCardSubject.title`、`CockpitCard.load`，`src/shared/tests/cockpitCardTypeSync.test.ts` 增加两行钉住；`cockpitCardController.ts` 的 `isIrreversibleOption` 同时识别现行 `irreversible` 标签与旧的 `warn`。
- 夹具 `server/modules/cockpit/cockpit-fixture-card-provider.ts`：`subject.title` 覆盖六种 kind；`load` 由 need/stuck/ask 三张给出（2/3/1），其余卡不给（提供方没给的读数不画）；stuck/fix 带 `attempts`（cap 5、新→旧，含 landed/failed/running/pending），need 给可逆选项、stuck 的 park 为不可逆，事实同时含机械与判断；12 份 `common.json` 增加类型标、年龄、负荷、确认说明与无推荐提示文案（i18n 完整性用例保持绿色）。

### 验证

- AC1：`npx vitest run src/modules/cockpit/tests/CockpitCard.test.tsx` → 1 file / 32 tests passed（新增覆盖头部项目名与主体名、●/○、viz 有无、↺/◷/⚠ 标签、不可逆确认条、无推荐一行提示、紧凑模式无说明框且下拉与 Confirm 同容器）。
- AC2：同一文件内未知 kind 与未知 tag kind 各一条断言（默认渲染、无图标、不抛错）。
- AC3：假形态——在头部把 `t(descriptor.badgeKey)` 换成 `card.provider === 'quay-fleet' ? 'FLEET' : …`，provider 无关用例（`fixture` 与 `quay-fleet` 同一数据 `innerHTML` 相等）确定性变红（`AssertionError: ASK vs FLEET`）；随后从备份还原，`grep -c 'providerBranch|FALSE FORM'` 为 0，32 条用例恢复全绿。
- AC4：`npx vitest run src/modules/cockpit/tests src/modules/chat/tests/inlineQuoteChip.test.tsx` → 19 files / 278 tests passed，0 failed，既有用例未减。
- AC5：`npm run typecheck` → 0；`npm run lint` → 0；`npm run build:client` → 0（29.07s）；`npx tsx --tsconfig server/tsconfig.json --test server/shared/tests/architecture-ratchet.test.ts` → 6 pass / 0 fail。`architecture-ratchet.baseline.json` 只按实测上调了本任务三个文件（`server/shared/types.ts` 5120→5144、`src/shared/types.ts` 4542→4566、`cockpitCardController.ts` 871→876），并按 AC-394 格式追加了 RECORDED CHANGE 段落。

### DoD：隔离实例四种组合实测

**MCP 浏览器在本会话不可用**，按任务允许的方式改用一次性 Playwright 脚本 `tmp/dod-capture.mjs`（真实 Vite dev 页面 + 隔离后端）。

- 实例：`scripts/isolated-instance.sh start`，入口包装 `tmp/dod-entry.mjs` 在启动前把 `{"cockpit":{"enabled":true,"fixtureCards":true}}` 合并进隔离 settings（`residentRestore.enabled:false` 保留）；`base_url=http://127.0.0.1:13691`，`ok:true`；隔离 `HOME=/tmp/dod-cockpit-anatomy/home`（符号链接真实 `~/.claude`、`~/.claude.json`、`~/.quay-fleet`）。新用户先经 `POST /api/user/complete-onboarding` 清掉引导页。Vite dev 在 `127.0.0.1:5191`（`SERVER_PORT=13691`），语义面与页面都来自开发构建。
- 读数：列表 9 张夹具卡；`aria-pressed` 在 Cards / Compact 下分别为 `true/false`；首卡高度 **Cards 249.5px、Compact 124px**（约一半），两种宽度一致。
- 截图（`tmp/dod-cockpit/`）：`m-cards.png`、`m-compact.png`、`pc-cards.png`、`pc-compact.png`；并排对照图：`m-cards-side-by-side.png`、`m-compact-side-by-side.png`、`pc-cards-side-by-side.png`、`pc-compact-side-by-side.png`（左效果图 / 右本次实现）。

#### 逐项差异与原因

共同（四张都有，且都不在卡片解剖范围内或由夹具数据决定）：

- 顶部 chrome（模式切换、状态条、Type/Project 选择器、过滤胶囊）来自其它任务与隔离实例，效果图是更晚的壳层设计。
- 项目名、主体名、年龄（夹具 15.8h）、选项数量与文案由夹具数据决定；效果图是真实数据（9h、1 of 4 等）。
- 效果图的选项展开框里选项标题更大、字段带「→ / 因为 / 适合」前缀；本次实现把同一批字段（does / why / undo / tag / when）按描述表渲染成正文行 + 标签胶囊，没有新增这些前缀文案（Proposal 的「做什么」只要求标签图标与来源语义）。
- 提供方没给的读数不画：夹具只给 need/stuck/ask 三张 `load`，fix、multi、decision、content-unavailable 等卡的头部因此没有三格；效果图每张都有，因为它的提供方都给了该字段。
- 效果图的 PC 卡片位于窄侧列（约 750px），本轮隔离实例没有会话，`/cockpit?view=cards` 是整页，所以卡片更宽；卡片内部结构与顺序一致。

逐张：

- `80-m-list-cards.png` / `m-cards.png`：头部七要素齐全（NEED 青色标 · fixture-project · Deploy credential · 15.8h · 三格负荷 · ›）；问题、情境两行；事实两枚胶囊（● 机械）；右侧尝试圆点（红/绿/空心）；选项行「Provide the credential · suggested · ● from assistant · 1 of 2」+ 说明行；黑色确认条 + 说明行。
- `86-m-list-compact.png` / `m-compact.png`：问题两行 + 情境一行 + 同一行下拉与 Confirm；无事实胶囊、无选项说明框；Confirm 短文案。
- `150-pc-open.png` / `pc-cards.png`：与手机同构，整行确认条；差异仅宽度与上述共同项。
- `150-pc-compact.png` / `pc-compact.png`：下拉与 Confirm 同一行；无推荐卡（ASK dbfb414）显示虚线的「Choose an option, then confirm」，不存在全宽确认按钮（虚线框在窄宽度下折成两行，但仍是提示而非可点按钮）。

### 场景运行器

`node scripts/ui-scenario.mjs e2e/scenarios/cockpit-cards-confirm.json --base-url http://127.0.0.1:5191 …` → 退出 0（6/6 步、8704ms、5 张检查点）：

```json
{"scenario":"cockpit-cards-confirm","ok":true,"failedStep":null,"stepCount":6,"durationMs":8704,"steps":[{"index":1,"action":"open:cockpit-cards","ok":true,"failures":[]},{"index":2,"action":"drive:cockpitCard.select","ok":true,"failures":[]},{"index":3,"action":"drive:cockpitCard.showOption","ok":true,"failures":[]},{"index":4,"action":"drive:cockpitCard.confirm","ok":true,"failures":[]},{"index":5,"action":"drive:cockpitCard.select","ok":true,"failures":[]},{"index":6,"action":"expect","ok":true,"failures":[]}],"checkpoints":["step-1-open-cockpit-cards.png","step-2-drive-cockpitCard.select.png","step-3-drive-cockpitCard.showOption.png","step-4-drive-cockpitCard.confirm.png","step-5-drive-cockpitCard.select.png"]}
```

完整报告 `tmp/dod-scenario/report.json`，检查点截图同目录。确认只在隔离实例上点击，未触碰线上实例。

### 环境备注

- 隔离实例已 `scripts/isolated-instance.sh stop`（`port_still_serving:false`），Vite（pid 3082343）同时停止；隔离 HOME 让真实 `~/.cloudcli/local-server.json` 未被改写。
- Playwright 浏览器装在真实 `HOME` 的缓存里，隔离 `HOME` 下需显式 `PLAYWRIGHT_BROWSERS_PATH=/data/home/yale/.cache/ms-playwright`。

### ADR-007 暗轴记录

该轴仍暗,理由:本任务只改卡片渲染、描述表、共享卡片类型与夹具,AC 内没有 L_D/L_G 探针或读数可记

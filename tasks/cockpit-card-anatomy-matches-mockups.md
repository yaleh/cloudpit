---
id: cockpit-card-anatomy-matches-mockups
title: 驾驶舱卡片解剖对齐效果图：头部行（彩色类型标·项目·主体名·相对时间·负荷）、情境行、事实胶囊、viz
  小图、选项标签图标语义、黑色确认条加说明行、无推荐时一行提示；紧凑模式做成真紧凑
status: ready
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

- [ ] `npx vitest run src/modules/cockpit/tests/CockpitCard.test.tsx` 退出 0，新增用例：头部行含项目名与主体名；`mechanical: true/false` 的事实分别带 ● / ○；有 `viz` 时渲染小图、无 `viz` 时没有小图节点；undo / cost / irreversible 标签渲染为对应图标与文字；不可逆选项的确认条带警示样式；无推荐时不存在全宽确认按钮而是一行提示；紧凑模式下选项说明框不在 DOM、Confirm 与下拉在同一行容器内。
- [ ] 描述表覆盖：未知 kind、未知 tag kind 走默认渲染不报错（用例断言）。
- [ ] 假形态变红：在组件里按 `card.provider === 'quay-fleet'` 分支渲染 ⇒ 新增的「同一卡片数据换 provider 字段渲染结果相同」用例红；改完即还原。
- [ ] `npx vitest run src/modules/cockpit/tests src/modules/chat/tests/inlineQuoteChip.test.tsx` 退出 0，既有用例数不减少。
- [ ] `npm run typecheck`、`npm run lint` 与 `npm run build:client` 退出 0；提交前单跑 `npx tsx --tsconfig server/tsconfig.json --test server/shared/tests/architecture-ratchet.test.ts` 退出 0。

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

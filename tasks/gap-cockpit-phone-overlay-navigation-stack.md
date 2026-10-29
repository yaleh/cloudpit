---
id: gap-cockpit-phone-overlay-navigation-stack
title: 手机驾驶舱覆盖层按导航栈往返会话并恢复卡片上下文
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

现有 `gap-cockpit-phone-cockpit-overlay` 已完成手机覆盖层打开/关闭、会话不卸载与独立深链；其完成记录明确记录了从卡片打开会话 B 时覆盖层关闭并替换 history entry。按用户刚确认的覆盖层效果图，导航语义需改为一层真实可往返的导航栈：会话 A → 全屏覆盖驾驶舱（复用现有 cards 主界面与编辑框，不另造 modal 卡片交互）→ 从卡片打开会话 B；返回应回到覆盖驾驶舱原卡片上下文，再关闭/返回才回会话 A。

本任务只补齐这一层内跨会话导航与上下文恢复，不重做已完成任务的入口/覆盖层基础行为。覆盖层来源会话 A 必须保持原上下文；返回驾驶舱时按当前 card controller 的真实 memory contract 验证选中卡片、筛选与滚动恢复，不声称详情或 option 状态可记忆，除非现有 contract 与可观测读数明确支持。会话 B 的导航、浏览器后退及关闭覆盖层须遵从明确一致的 history semantics。直接深链 `/cockpit?view=cards` 仍是独立页面，无会话来源时不显示回程条；PC 列行为不变。

<!-- dedup-ref --> `gap-cockpit-phone-cockpit-overlay`（done）负责覆盖层的基础生命周期，已完成证据不覆盖本任务要求的「打开会话 B 后返回到原覆盖层上下文」往返语义，因此本任务是该已落地机制上的独立后续交付，而非并存重做入口或覆盖层。`gap-cockpit-entry-return-path`（ready）只负责仍进入独立驾驶舱页的入口记录 returnPath 与其「会话」段回程；此次导航栈不改写或重复认领该行为，独立页 fallback 仍归它所有。

约束：
- 覆盖层继续复用既有 cards 主界面及编辑框，不新增另一套卡片/编辑交互或第二份 card state。
- 会话 A 的实例不得因进入覆盖层、打开 B、再返回而被意外卸载/重建；会话 A 的滚动位置与草稿应保持不变。
- 卡片筛选、选中与滚动只按现有 controller memory contract 声明并验证；不要假定详情/option 状态持久化。
- `Escape` 不得由覆盖层消费，避免中断运行中的聊天回合；使用明确返回/关闭控件及浏览器 history。
- 新文案如有，必须进入全部 12 个 locale 的 `common.json`。
- 遵循 `$frontend-module-standards`；若需新逻辑，优先放入新 component/hook，`CockpitPage.tsx` 不得在 oversize ratchet 下净增。

## AC

- [ ] `npx vitest run src/modules/cockpit/tests/CockpitOverlay.test.tsx src/modules/cockpit/tests/cockpitCardDetailsSelectable.test.tsx` 退出 0：在移动视口从会话 A 打开覆盖层、记录 card controller 可观测支持的选中项/筛选/滚动，然后从卡片打开会话 B；浏览器返回回到覆盖层，且会话 A 仍是同一挂载实例、卡片上下文与打开 B 前一致。用例同时验证会话 B 是当前会话，且返回不是直接落到 A。
- [ ] 同组测试验证再次关闭/返回覆盖层后 URL/导航位置回到会话 A；会话 A 的挂载身份、transcript 滚动与输入草稿均与初始读数一致。用独立挂载计数或节点身份断言，不能只断言内容相同。
- [ ] 反形态：把打开会话 B 的动作改为 replace 原覆盖层 entry，或令返回直接回到会话 A，第一条导航栈用例必须失败；恢复后通过。记录该负控的失败断言与退出码。
- [ ] `npx vitest run src/modules/project-workspace/tests/mobileHeaderCockpitEntry.test.tsx` 退出 0：手机深链 `/cockpit?view=cards` 仍为独立 cards 页面且无回程条；1440px PC 列仍按原行为工作。
- [ ] `npm run typecheck`、`npm run lint`、`npm run build:client` 退出 0；`npx tsx --tsconfig server/tsconfig.json --test server/shared/tests/architecture-ratchet.test.ts` 退出 0。

## DoD

1. 在真实运行页面以手机 390×844 驱动完整旅程：会话 A → 全屏覆盖驾驶舱 → 记录可观测卡片选中/筛选/滚动及 A 的挂载身份、transcript 滚动和输入草稿 → 从卡片进入会话 B → 浏览器返回到覆盖层并逐项比较原始读数 → 显式关闭覆盖层回到会话 A并再次比较会话身份/滚动/草稿。每个关键状态截图存 `tmp/`，在任务完成记录贴绝对或仓库内路径与结构化读数。
2. 在覆盖层输入框实际输入并确认可用；按 Escape 验证覆盖层不消费该键（不得破坏聊天自身 Escape 中断行为）。截图与结果记录。
3. 实测 `/cockpit?view=cards` 无来源深链与 1440px PC 列反向对照，截图证明二者未改变。
4. 若可用场景运行器，运行并贴出 JSON 报告及 checkpoint 截图；优先更新/使用 `e2e/scenarios/cockpit-phone-overlay.json` 覆盖 A→overlay→B→back→overlay→close→A 的完整旅程。运行器不可表达该交互时，明确记录障碍与报告，不伪称通过。
5. 新增或调整覆盖层/导航逻辑优先放新 component/hook；若修改 `CockpitPage.tsx`，提交架构 ratchet 退出码及基线读数。

## Touches

- tasks/gap-cockpit-phone-overlay-navigation-stack.md
- src/modules/cockpit/CockpitOverlay.tsx
- src/modules/cockpit/CockpitCardList.tsx
- src/modules/cockpit/CockpitCardDetails.tsx
- src/modules/project-workspace/WorkspaceHeader.tsx
- src/App.tsx
- src/modules/cockpit/tests/CockpitOverlay.test.tsx
- src/modules/cockpit/tests/cockpitCardDetailsSelectable.test.tsx
- src/modules/project-workspace/tests/mobileHeaderCockpitEntry.test.tsx
- e2e/scenarios/cockpit-phone-overlay.json
- src/modules/i18n/locales/en/common.json
- src/modules/i18n/locales/zh-CN/common.json
- src/modules/i18n/locales/zh-TW/common.json
- src/modules/i18n/locales/de/common.json
- src/modules/i18n/locales/es/common.json
- src/modules/i18n/locales/fr/common.json
- src/modules/i18n/locales/id/common.json
- src/modules/i18n/locales/it/common.json
- src/modules/i18n/locales/ja/common.json
- src/modules/i18n/locales/ko/common.json
- src/modules/i18n/locales/ru/common.json
- src/modules/i18n/locales/tr/common.json
- server/shared/tests/architecture-ratchet.baseline.json
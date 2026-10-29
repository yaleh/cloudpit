---
id: gap-cockpit-phone-overlay-navigation-stack
title: 手机驾驶舱覆盖层按导航栈往返会话并恢复卡片上下文
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

- [x] `npx vitest run src/modules/cockpit/tests/CockpitOverlay.test.tsx src/modules/cockpit/tests/cockpitCardDetailsSelectable.test.tsx` 退出 0：在移动视口从会话 A 打开覆盖层、记录 card controller 可观测支持的选中项/筛选/滚动，然后从卡片打开会话 B；浏览器返回回到覆盖层，且会话 A 仍是同一挂载实例、卡片上下文与打开 B 前一致。用例同时验证会话 B 是当前会话，且返回不是直接落到 A。
- [x] 同组测试验证再次关闭/返回覆盖层后 URL/导航位置回到会话 A；会话 A 的挂载身份、transcript 滚动与输入草稿均与初始读数一致。用独立挂载计数或节点身份断言，不能只断言内容相同。
- [x] 反形态：把打开会话 B 的动作改为 replace 原覆盖层 entry，或令返回直接回到会话 A，第一条导航栈用例必须失败；恢复后通过。记录该负控的失败断言与退出码。
- [x] `npx vitest run src/modules/project-workspace/tests/mobileHeaderCockpitEntry.test.tsx` 退出 0：手机深链 `/cockpit?view=cards` 仍为独立 cards 页面且无回程条；1440px PC 列仍按原行为工作。
- [x] `npm run typecheck`、`npm run lint`、`npm run build:client` 退出 0；`npx tsx --tsconfig server/tsconfig.json --test server/shared/tests/architecture-ratchet.test.ts` 退出 0。

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

## Completion

实现（提交 `70a26bd52`，worktree `/data/home/yale/work/claudecodeui-worktrees/task-gap-cockpit-phone-overlay-navigation-stack`）：`CockpitOverlayHost` 的 `onOpenConversation` 从 `navigate(path, { replace: true })` 改为不带 replace 的 push，导航栈变为 A → 覆盖层 entry → B；浏览器后退回到覆盖层同一 entry（卡片筛选/选中/滚动不丢），覆盖层自身的关闭才 pop 回 A。`CockpitOverlay.test.tsx` 新增「a card-opened session B sits ABOVE the layer」用例：真实 `MemoryRouter` + `CockpitOverlayHost`（与 `App` 一样作为 `<Routes>` 兄弟）驱动整条往返，用 controller 读数与 DOM 节点身份/挂载计数断言。

AC 证据：
- AC1 `npx vitest run src/modules/cockpit/tests/CockpitOverlay.test.tsx src/modules/cockpit/tests/cockpitCardDetailsSelectable.test.tsx` → 2 files / 7 tests passed，exit 0。
- AC2 同一用例后半段：后退回到 `/session/session-phone-overlay` 且覆盖层仍存在；显式关闭后 URL 回 A、`session-area`/`session-draft`/`session-transcript` 为同一 DOM 节点、`mountLedger.mounts === 1`、transcript `scrollTop` 42、草稿 `keep this draft for A` 不变。
- AC3 反形态：把该行改回 `{ replace: true }` 后运行 `CockpitOverlay.test.tsx` → 1 failed，`AssertionError: Back lands on the layer, not directly on session A`（`CockpitOverlay.test.tsx:441`），exit 1；恢复 push 后同文件 2 passed，exit 0。
- AC4 `npx vitest run src/modules/project-workspace/tests/mobileHeaderCockpitEntry.test.tsx` → 9 tests passed，exit 0。
- AC5 `npm run typecheck` exit 0；`npm run lint` exit 0（仅既有 warning）；`npm run build:client` exit 0（25.10s）；`npx tsx --tsconfig server/tsconfig.json --test server/shared/tests/architecture-ratchet.test.ts` → 6 pass / 0 fail，exit 0（仅打印可下调基线提示；未改 `CockpitPage.tsx`）。

DoD（真实运行页面 390×844；worktree vite :5199 代理 live :3001；仅拦截 `GET /api/cockpit/cards`（提供 9 张夹具卡，卡片内容非本任务所改）与 `/api/user/drafts`（内存应答，避免写真实库），其余均为真实服务）：
- 驱动脚本 `tmp/dod-phone-overlay-stack.mjs`，结构化报告 `tmp/dod-phone-overlay-stack/report.json`：29/29 checks passed，exit 0。A = `49d976b2-e00e-4c56-8c8e-6cbc1724fe58`（Live Voice 第三场），B = `4e8bb98e-ec89-4ba9-91d0-14c7f7912fa0`（Respond with hello）。
- 打开覆盖层：URL 仍 `/session/A`，标题「Live Voice 第三场」；筛选 `need`、选中 `dod-need-conv`、列表 `scrollTop=137`；A 的 `[data-app-shell]` 为同一节点。
- 卡片的「Open conversation」→ B：URL `/session/B`，覆盖层不绘制，shell / composer textarea / transcript 均为 A 时同一 DOM 节点（workspace 未重建）。
- 浏览器后退：URL `/session/A` 且覆盖层重新出现（不是裸 A），标题仍在；筛选/选中/`scrollTop=137` 与离开前一致，`sessionStorage['cockpit.cards.memory.v1'] = {"selectedCardId":"dod-need-conv","scrollPosition":137}`；草稿不变。
- 显式关闭：URL `/session/A`、覆盖层消失，shell/transcript/textarea 仍为同一节点，草稿 `keep this draft for A` 不变。
- 截图（仓库内）：`tmp/dod-phone-overlay-stack/01-session-a.png`、`02-overlay-open.png`、`03-card-context-and-input.png`、`04-session-b.png`、`05-overlay-after-back.png`、`06-session-a-return.png`。
- DoD 2：在覆盖层内卡片 Details 的「Write your own」编辑框真实输入 `dod phone overlay input works` 并读回一致（`03-card-context-and-input.png`）；覆盖层复用既有 cards 主界面，本身没有额外 composer，故未另造输入框。按 Escape 后覆盖层仍在（未消费，聊天自身 Escape 语义保留）。
- 差异诚实记录：实时页 transcript 在 A→B→A 会话切换后 `scrollTop` 由离开时 3101 变为 588；对照实验（不经覆盖层，侧栏 Conversations 切到另一会话再后退）同样得到 588，说明这是 transcript 在会话消息重载时自身的恢复行为、与本覆盖层无关，且 transcript 的 DOM 节点身份全程不变；精确 scrollTop 相等由 AC2 单测（显式 42→42）断言。
- DoD 3：`/cockpit?view=cards` 深链无覆盖层、无回程条（`08-deeplink-cards-page.png`）；1440px 打开的是 `[data-testid="cockpit-column"]`，从不绘制手机覆盖层（`08-pc-column-1440.png`）。
- DoD 4：运行器可用性实测 `node scripts/ui-scenario.mjs tmp/dod-runner-availability-probe.json --base-url http://127.0.0.1:5199 --auth-token <jwt> --out tmp/ui-scenario-probe` → exit 0，报告 `tmp/ui-scenario-probe.json`，checkpoint `tmp/ui-scenario-probe/step-1-open-cockpit.png`。但本旅程无法表达且未伪称通过：`scripts/ui-scenario.mjs:682` 固定 `viewport: {width:1280,height:800}`；`:769` 的 openers 为闭集 `session|cockpit|cockpit-cards|quay-panel`（无覆盖层入口）；步骤只有 open/drive/expect/checkpoint（无点击/视口步骤），语义面 `window.__cloudcliScenario` 也无覆盖层读数。因此未创建会失败或误导的 `e2e/scenarios/cockpit-phone-overlay.json`，该旅程由上述真实浏览器脚本覆盖。
- Pre-merge：`git merge --no-edit develop` 无冲突（merge commit `96a38380e`）；项目未声明 scoped_command，按流程跳过 scoped gate；anti-drift Touches 检查 `ANTI-DRIFT OK ... 2 actual file(s), all within declared Touches (23 glob(s))`，exit 0。

该轴仍暗,理由:本任务只改前端覆盖层的 history 语义并补测试，未新增或改变任何架构依赖边，L_D/L_G 无变化。
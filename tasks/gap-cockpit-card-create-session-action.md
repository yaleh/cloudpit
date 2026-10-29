---
id: gap-cockpit-card-create-session-action
title: Cockpit 卡片按钮直接创建会话并安全导航
status: ready
labels:
  - gap
  - feature
  - cockpit
parent: null
children: []
extra:
  schema: execution
---
## Proposal

用户已确认的交互契约：点击 Cockpit 卡片按钮应直接创建一个空的新 session，并导航到该 session 页面；这不是对卡片执行仅确认/acknowledgment。项目解析严格优先 `card.conversation.startInProject`，否则取 `card.subject.project`；该值必须匹配实际已注册项目。未匹配时显示可见错误，不得回退到当前项目或其他项目。创建请求进行中应阻止重复点击；创建失败须显示可见、可重试的错误。复用既有 `createChatSession` gateway，以及适用的会话注册与导航回调，避免另造会话创建路径。

<!-- dedup-ref --> 机制去重与 traceability：用户指出的 acknowledgment-only Cockpit 卡片修复（commit `ee8d97e4b`）只确认卡片，不创建 session；本任务交付的是分配真实 session、解析注册项目并导航，行为机制不同，不构成前置。现有任务查询未发现已登记的 `startInProject` 或 `createChatSession` Cockpit 任务；在飞 `todo` Cockpit 标签任务也未发现。任务 ABI 不提供 task-granularity-advice 脚本，因此未能执行按具体源码 Touches 的工具化 peer 检查；在当前可读任务查询中没有发现相同机制的在飞任务，按 separate 继续。

## Implementation

- 规则放在 React-free 控制器 `src/modules/cockpit/cockpitCardStartConversation.ts`：项目取值（`startInProject` 优先、`subject.project` 兜底）、注册项目匹配（精确 `projectId`，否则忽略大小写的 `fleetProjectId`，无其他回退）、进行中锁、成功/失败快照、注册后导航。
- `hooks/useCockpitStartConversation.ts` 是唯一的 React 绑定：`createChatSession` 只经 `@/modules/chat` barrel 进入；页面已有注册项目列表时传入，overlay / column 在首次按下时按需读 fleet summary。
- `CockpitCardStartConversation.tsx` 是三个 Details 表面共用的按钮（pending 时 disabled + `aria-busy`，失败显示 `role="alert"`，同一按钮即重试）。
- `CockpitCardList` 新增 `registeredProjects` / `onSessionCreated` / `onNavigateToSession` 三个 prop 缝隙：page 由 `CockpitStage` 传 `navigate`，overlay 走 `onOpenConversation`，PC column 注册后经同一回调切到左侧会话。
- `CockpitCard.tsx` 与 `cockpitCardController.ts` 未改动（棘轮零余量），新增代码全部落在新文件。

## AC

- [x] `npx vitest run src/modules/cockpit/tests/CockpitCardCreateSession.test.tsx src/modules/cockpit/tests/CockpitCardActionEntrySurfaces.test.tsx` 退出码为 0；测试真实点击卡片按钮并断言 `createChatSession` 创建空 session、注册新 session、随后导航到其 session 页面，而非只执行 acknowledge。测试覆盖所有现有 Cockpit 卡片入口表面。（13 tests passed：9 + 4，含 page 路由、phone overlay、PC column 三个表面）
- [x] 在同一组测试中，分别断言 `card.conversation.startInProject` 优先于 `card.subject.project`；只有 startInProject 不存在时才用 subject.project；两种解析出的 id 均匹配到已注册项目并传给 session gateway。（另覆盖忽略大小写的 `fleetProjectId`）
- [x] 在同一组测试中，项目 id 不匹配已注册项目时显示可见错误、gateway 调用次数为 0、导航调用次数为 0，且断言没有使用当前项目或另一项目作为回退。
- [x] 在同一组测试中，让创建 promise 保持 pending 并重复触发按钮，断言创建 gateway 只调用一次且按钮在请求期间不可再次触发；再分别断言创建失败会显示可见错误，错误可通过重试操作恢复，重试成功后仅创建并导航到一个 session。
- [x] `npx tsc --noEmit -p tsconfig.json` 退出码为 0。

## DoD

实际落地时需在真实运行的 Cockpit 页面完成端到端操作：从卡片按钮创建空 session，确认目标项目来自已解析且已注册的 id，并确认页面确实导航到新 session；另实际演示未匹配项目时的可见错误且不发生创建/导航，以及创建失败后可见错误并成功重试。提供浏览器操作证据及创建的 session/project 读数。全套既有卡片入口回归测试通过；变更仅涉及 Touches 声明范围，创建流程复用既有 gateway 与会话注册/导航机制。

### 真实浏览器证据（2026-10-29，worktree vite dev :5199 → 线上实例 :3001 的 `/api`）

驱动脚本 `tmp/dod/drive.mjs`（一次性 Playwright，非仓库代码），读数 `tmp/dod/report.json`，截图 `tmp/dod/01-…05-*.png`：

1. 真实数据创建：卡 `att_94edac259017`，卡面项目 `quay-fleet` → 注册项目 `projectId=cc478371-7ff5-4d61-9c12-f0b1ebb19383`、`projectPath=/data/home/yale/work/quay-fleet`；按下按钮后网关调用 `POST /api/providers/sessions {provider:'claude', projectPath:'/data/home/yale/work/quay-fleet'}` → 201 `sessionId=7bf758d2-4b9b-4a30-bcbe-ae3718f02863`，地址从 `/cockpit?view=cards` 变为 `/session/7bf758d2-…`。截图 `01-details-start-button.png`（按钮）、`02-created-session.png`（新会话页，左侧栏已出现 Untitled Session）。
2. 未匹配项目：只把浏览器侧卡片读数改写为 `conversation.startInProject='ghost-project'`（服务端数据未动）。按下后可见 `role="alert"` 文案 “No registered project matches “ghost-project”.”（`data-error-kind=unregistered`），`POST /api/providers/sessions` 0 次，地址仍为 `/cockpit?view=cards`。截图 `03-unregistered-error.png`。
3. 失败后重试：浏览器侧把第一次 `POST /api/providers/sessions` 以 500 兑现。第一次按下显示可见错误 “Could not start the conversation: Failed to create session (500)”，地址未变；同一按钮即重试，第二次 201 → `sessionId=ab10169e-3e2c-4425-9771-5d3584488eb9`，地址变为 `/session/ab10169e-…`；两次尝试总计恰好 2 个 POST、仅 1 个成功。截图 `04-create-failed.png`、`05-retry-created.png`。
4. 无页面 console error（`report.json.consoleErrors = []`）。

场景运行器：现有场景清单里没有覆盖该交互的场景（`scripts/ui-scenario.mjs` 的 `cockpitCard.*` 驱动词表只有 select/showOption/ownReply/confirm/openDetails，没有按下该按钮的动词），故按 AGENTS.md 的“存在可用场景时”条件没有可跑场景；大颗粒度卡片回归以 `src/modules/cockpit/tests` 全量（28 文件 / 434 tests 通过）为准。

回归：`npx vitest run src/modules/cockpit/tests src/modules/i18n/tests/i18nCockpitCompleteness.test.ts src/modules/i18n/tests/localeDuplicateKeys.test.ts` → 28 files / 434 tests passed；`npx oxlint src/` 退出码 0（仅仓库既有 warning）。

该轴仍暗,理由:本任务交付的是卡片按钮的创建+导航行为，未产生可对照的 L_D/L_G 读数。

## Touches

- src/modules/cockpit/cockpitCardStartConversation.ts
- src/modules/cockpit/CockpitCardStartConversation.tsx
- src/modules/cockpit/hooks/useCockpitStartConversation.ts
- src/modules/cockpit/CockpitCardDetails.tsx
- src/modules/cockpit/CockpitCardList.tsx
- src/modules/cockpit/CockpitStage.tsx
- src/modules/cockpit/tests/CockpitCardCreateSession.test.tsx
- src/modules/cockpit/tests/CockpitCardActionEntrySurfaces.test.tsx
- src/modules/cockpit/tests/cockpitCardDetailsSelectable.test.tsx
- src/modules/project-workspace/context/ProjectsStateContext.tsx
- src/modules/project-workspace/index.ts
- src/modules/chat/index.ts
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
- tasks/gap-cockpit-card-create-session-action.md (self)

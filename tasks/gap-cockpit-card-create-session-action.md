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

## AC

- [ ] `npx vitest run src/modules/cockpit/tests/CockpitCardCreateSession.test.tsx src/modules/cockpit/tests/CockpitCardActionEntrySurfaces.test.tsx` 退出码为 0；测试真实点击卡片按钮并断言 `createChatSession` 创建空 session、注册新 session、随后导航到其 session 页面，而非只执行 acknowledge。测试覆盖所有现有 Cockpit 卡片入口表面。
- [ ] 在同一组测试中，分别断言 `card.conversation.startInProject` 优先于 `card.subject.project`；只有 startInProject 不存在时才用 subject.project；两种解析出的 id 均匹配到已注册项目并传给 session gateway。
- [ ] 在同一组测试中，项目 id 不匹配已注册项目时显示可见错误、gateway 调用次数为 0、导航调用次数为 0，且断言没有使用当前项目或另一项目作为回退。
- [ ] 在同一组测试中，让创建 promise 保持 pending 并重复触发按钮，断言创建 gateway 只调用一次且按钮在请求期间不可再次触发；再分别断言创建失败会显示可见错误，错误可通过重试操作恢复，重试成功后仅创建并导航到一个 session。
- [ ] `npx tsc --noEmit -p tsconfig.json` 退出码为 0。

## DoD

实际落地时需在真实运行的 Cockpit 页面完成端到端操作：从卡片按钮创建空 session，确认目标项目来自已解析且已注册的 id，并确认页面确实导航到新 session；另实际演示未匹配项目时的可见错误且不发生创建/导航，以及创建失败后可见错误并成功重试。提供浏览器操作证据及创建的 session/project 读数。全套既有卡片入口回归测试通过；变更仅涉及 Touches 声明范围，创建流程复用既有 gateway 与会话注册/导航机制。

## Touches

- src/modules/cockpit/CockpitCard.tsx
- src/modules/cockpit/tests/CockpitCardCreateSession.test.tsx
- src/modules/cockpit/tests/CockpitCardActionEntrySurfaces.test.tsx
- tasks/gap-cockpit-card-create-session-action.md (self)

---
id: gap-cockpit-stuck-count-by-kind-and-ask-repair-silent-failure
title: 驾驶舱两处：列标题「stuck」按 kind 计数（现按 group 把会话提问也算成 stuck）；查清 quay
  项目提问卡重算后仍显示「未启用」的原因（限额还是转写定位失败）并让失败原因可见
status: ready
labels:
  - gap
  - defect
  - cockpit
parent: null
children: []
extra:
  schema: execution
---
## Proposal

来源：2026-10-28 01:36 线上验证（构建 `72aa67bfe`，quay-fleet `885b032`，截图 `/data/home/yale/work/claudecodeui/tmp/cockpit-v3-pc-details-1440.png`、`cockpit-v3-m-page-390.png`）。

1. **列标题的 stuck 数错了。** PC 列标题显示「7 waiting for you · 7 stuck」，而当时 7 张卡是会话提问 5、需要人 1、需决定 1，没有一张 stuck。原因：`src/modules/cockpit/CockpitColumn.tsx` 的标题按 `group === 'rescue'` 计数，而 quay-fleet 把会话提问卡也归在 rescue 组（组与次序由提供方决定，这本身没错）。手机页的类型胶囊按 kind 计数，显示「Stuck 0」是对的。标题应与胶囊用同一个计数源（controller 的按 kind 计数），显示 stuck 卡的数量；为 0 时不显示这一段。
2. **quay 项目那张提问卡重算后仍显示「未启用」。** 同一轮里另外两张「未启用」卡已经由 `server/modules/observation/session-ask-decision-reader.ts` 读取时重算成功；quay 项目的那张（会话 `dbbf1404-7c68-40f6-a709-342c1fc158ce`，askId 后半 `684e3c75-6c0f-40c1-b228-8eb8d07bb123`，项目路径为 quay 仓库）仍是 `contentUnavailable: 提问决策摘要未启用…`。该读取器每个提问只试一次、失败也记住；撞限额时应显示「本轮未生成（限额）」，现在没有，因此更可能是重算失败（例如按会话 id 定位不到 quay 项目下的转写、或该会话的转写编码目录与 claudecodeui 不同）被记住后静默保留了旧读数。先查清原因再修。

做什么：

- 列标题：用 controller 已有的按 kind 计数（与手机胶囊同源），标题「N waiting for you」后只在 stuck 数 > 0 时显示「· M stuck」。不按 provider 或 group 分支。
- 重算失败可见：读取器在重算失败时把失败原因写进读数（例如「重算失败：找不到会话转写」），卡片显示这个原因而不是旧的「未启用」；限额与失败两种原因要能区分。
- 查原因：在完成记录里写清 quay 项目那张卡重算失败的确切原因与证据（日志、读取器内部状态或复现）。若是转写定位问题（跨项目会话），修正定位使其能读到 quay 项目会话的最后一条助手消息；若是别的原因，按实际修，并在完成记录说明。

## AC

- [ ] `npx vitest run src/modules/cockpit/tests/CockpitColumn.test.tsx` 退出 0，新增用例：7 张卡全为 rescue 组但 kind 为 ask×5、need×1、decision×1 时，标题不出现 stuck 段；含 2 张 kind=stuck 时标题显示「· 2 stuck」；标题计数与 controller 的按 kind 计数一致。
- [ ] `npx tsx --tsconfig server/tsconfig.json --test server/modules/observation/tests/session-ask-decision-digest.test.ts` 退出 0，新增用例：重算失败（桩的转写读取抛错或返回空）时读数带失败原因、不再显示「未启用」；限额用尽时原因为「本轮未生成（限额）」，两者文字不同；跨项目会话（转写位于另一项目编码目录）能被定位并重算成功。
- [ ] 假形态变红：标题改回按 group 计数 ⇒ 第一条新用例红；改完即还原。
- [ ] `npm run typecheck` 与 `npm run lint` 退出 0（lint 仅既有 warning）；提交前单跑 `npx tsx --tsconfig server/tsconfig.json --test server/shared/tests/architecture-ratchet.test.ts` 退出 0。

## DoD

在完成记录里贴出第 2 点的根因证据。隔离实例（复制会话库，打开 `cockpit.fixtureCards` 与 `observation.sessionDigest`，用 workers 网关最便宜的模型，不打印密钥）里给一张指向 quay 项目会话的提问卡（可用临时未提交的提供方给出），请求 `/api/cockpit/cards` 两次，贴出第二次的问题与选项（或明确的失败原因）。用 MCP 浏览器 1440 宽度截图列标题（夹具含与不含 stuck 卡各一张），存 `tmp/`。⛔ 不在线上实例点击任何确认。

## Touches

- tasks/gap-cockpit-stuck-count-by-kind-and-ask-repair-silent-failure.md
- src/modules/cockpit/CockpitColumn.tsx
- src/modules/cockpit/cockpitCardController.ts
- src/modules/cockpit/tests/CockpitColumn.test.tsx
- server/modules/observation/session-ask-decision-reader.ts
- server/modules/observation/session-ask-decision-digest.ts
- server/modules/observation/tests/session-ask-decision-digest.test.ts
- server/cockpit-fleet-wiring.ts

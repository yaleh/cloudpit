---
id: gap-cockpit-stuck-count-by-kind-and-ask-repair-silent-failure
title: 驾驶舱两处：列标题「stuck」按 kind 计数（现按 group 把会话提问也算成 stuck）；查清 quay
  项目提问卡重算后仍显示「未启用」的原因（限额还是转写定位失败）并让失败原因可见
status: done
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

- [x] `npx vitest run src/modules/cockpit/tests/CockpitColumn.test.tsx` 退出 0，新增用例：7 张卡全为 rescue 组但 kind 为 ask×5、need×1、decision×1 时，标题不出现 stuck 段；含 2 张 kind=stuck 时标题显示「· 2 stuck」；标题计数与 controller 的按 kind 计数一致。
- [x] `npx tsx --tsconfig server/tsconfig.json --test server/modules/observation/tests/session-ask-decision-digest.test.ts` 退出 0，新增用例：重算失败（桩的转写读取抛错或返回空）时读数带失败原因、不再显示「未启用」；限额用尽时原因为「本轮未生成（限额）」，两者文字不同；跨项目会话（转写位于另一项目编码目录）能被定位并重算成功。
- [x] 假形态变红：标题改回按 group 计数 ⇒ 第一条新用例红；改完即还原。
- [x] `npm run typecheck` 与 `npm run lint` 退出 0（lint 仅既有 warning）；提交前单跑 `npx tsx --tsconfig server/tsconfig.json --test server/shared/tests/architecture-ratchet.test.ts` 退出 0。

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

## 完成记录

**根因（第 2 点）。** 线上该会话的观测对象 `cloudcli://session/dbbf1404-7c68-40f6-a709-342c1fc158ce` 里存的是**tier 关闭时写下的 skip**：`askDecision.state='skipped'`、`reason='未启用 observation.sessionDigest（提问决策摘要）'`（provenance producer=`session-digest`）。读取器的重算路径其实拿到了转写：`sessions.jsonl_path` 指向 `/data/home/yale/.claude/projects/-data-home-yale-work-quay/03a388ed-5590-4da3-afd0-9f79086eb026.jsonl`（存在，5.6 MB），所以**不是跨项目转写定位失败**。失败在**提问定位**：旧 `readSessionAsk` 只看转写的最后一条助手消息；该会话最后一条助手消息（uuid `8d339239-8fd5-41fd-a4ef-5080d62faf2c`）是一段收尾汇报，`analyzeAsking` 为 false，于是 `current=null`，重算提前返回且**不写任何失败原因**，旧的「未启用」被永久保留。fleet 卡片的 `contentRef` 其实点名了更早的那条提问消息（`684e3c75-6c0f-40c1-b228-8eb8d07bb123`），而 `server/cockpit-fleet-wiring.ts` 把 `messageId` 丢掉了（形参 `_messageId`）。

用真实转写复现（`tmp/probe-readask.mts`，脚本未提交）：
- 不传 messageId：`current: null`；最后一条助手消息 uuid `8d339239-8fd5-41fd-a4ef-5080d62faf2c`，`analyzeAsking={"isAsking":false}`。
- 传 `684e3c75-6c0f-40c1-b228-8eb8d07bb123`：`askId=dbbf1404-7c68-40f6-a709-342c1fc158ce:684e3c75-6c0f-40c1-b228-8eb8d07bb123`，`revision=1`，`analyzeAsking={"isAsking":true,…}`。
- 传 `a94129cd-f961-403e-a109-ef20effb6330`：同样命中提问（另一条提问消息，说明定位不依赖固定 id）。

**修法。** ① wiring 透传 `contentRef.messageId`；② `readSessionAsk(raw, sessionId, messageId)` 按消息 id 定位该条助手消息（上下文止于该条），不再要求转写最后一条是提问；③ 定位不到提问/转写时写 `unevaluated` 的可见原因（`重算失败：找不到会话转写` / `重算失败：转写里找不到这次提问` / `重算失败：读取转写失败（…）`），不再静默保留「未启用」；④ 限额读作 `本轮未生成（限额）`，且只返回合成读数、不落库；⑤ 按 `provider_session_id` 在 `<claude config>/projects/*/` 下兜底定位跨项目转写。

**DoD（隔离实例，复制会话库；`cockpit.fixtureCards=true`、`cockpit.fleetCards.enabled=true`、`observation.sessionDigest.enabled=true`，模型 `v4.1flash`＝workers 网关最便宜的档；密钥未打印；未在线上实例点击任何确认）。** 用临时未提交的 quay-fleet 桩（`tmp/dod-stuck/fleet-stub.mjs`，走真实 locator 握手与真实 provider/reader 组合根）给出指向 quay 会话 `dbbf1404-7c68-40f6-a709-342c1fc158ce`、消息 `684e3c75-6c0f-40c1-b228-8eb8d07bb123` 的提问卡（`contentRef.resolver=cloudcli.session-ask`）。
- 第 1 次 `/api/cockpit/cards`（16 张卡，含夹具）：该卡仍为 `contentUnavailable="提问决策摘要未启用：未启用 observation.sessionDigest（提问决策摘要）"`——即线上那条坏读数。
- 第 2 次（重算完成后再读）：`contentUnavailable=null`，问题=`是否要在下一轮 full-suite 全量轮落地后，核一次 oomKill 与 state？还是到此为止？`，选项=`是` / `否`；原文证据在 `tmp/dod-stuck/fixtures-read-2.json`。

**列标题截图（1440 px；本会话没有 MCP 浏览器，用一次性 Playwright 脚本驱动真实页面 + 真实隔离后端，`cockpit.column.v1` 展开、400 px）：**
- `tmp/dod-stuck/column-title-no-stuck-1440.png`：7 张卡全为 rescue 组、kind=ask×5/need×1/decision×1 ⇒ 标题 `Cockpit 7 waiting for you`，无 stuck 段。
- `tmp/dod-stuck/column-title-with-stuck-1440.png`：同一夹具 + 2 张 kind=stuck ⇒ `Cockpit 9 waiting for you · 2 stuck`。
- 说明：内置 fixture provider 固定带 kind=stuck 卡，无法产出「不含 stuck」的标题，故截图腿改用上面这个临时未提交的提供方（DoD 允许）；API 腿则在 `fixtureCards=true` 的实例上跑。

**AC 证据。**
- `npx vitest run src/modules/cockpit/tests/CockpitColumn.test.tsx` → 14 passed。
- `npx tsx --tsconfig server/tsconfig.json --test server/modules/observation/tests/session-ask-decision-digest.test.ts` → 19 passed（含失败原因、限额、跨项目三条新用例）。
- 假形态：把 `stuckCount` 改回 `cards.snapshot.cards.filter((card) => card.group === 'rescue').length` ⇒ 2 条新用例红（`expected <span…> to be null`、`expected '5 stuck' to be '2 stuck'`），改完即还原、14 passed。
- `npm run typecheck` → exit 0；`npm run lint` → exit 0（仅既有 warning）；`npx tsx --tsconfig server/tsconfig.json --test server/shared/tests/architecture-ratchet.test.ts` → 6 passed。

**ADR-007 暗轴记录：**

- 该轴仍暗，理由：本任务只改列标题计数与会话提问读取器的失败可见性，未改变任何分层/依赖关系。

**Touches 说明。** 实际改动落在 Touches 已列的文件中；`src/modules/cockpit/cockpitCardController.ts` 未改（标题直接读既有的 `typeCounts`）。

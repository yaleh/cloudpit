---
id: context-event-behavior-signal-producer
title: 发布行为信号到 context 流：ui.view 视图进入 + utterance.data.class 稳定契约（quay-fleet
  行为实验 v1 的 producer 契约）
status: ready
labels:
  - context-events
  - observation
parent: null
children: []
extra: {}
---
## Proposal

背景：quay-fleet 行为实验 v0 砍掉 3 个特征（polling_cadence / answer_in_session_rate / cross_session_relay_rate），因为它们依赖 claudecodeui 侧先落地 producer 契约。本任务就是这条 producer 契约：把行为信号写进主机级 context 流，供 quay-fleet 行为实验 v1 读取。

现状（已核对代码）：

1. `~/.cloudcli/ui-view-events.jsonl`（视图进入：`session`/`tab`/`cockpit-tile`/`cockpit-preview`）是 CloudCLI 本地 carrier，**不进** context 流；fleet 纪律不直读它 ⇒ answer_in_session_rate 缺「用户此刻在 cockpit 还是会话」的信号。
2. `utterance` 事件已进 context 流，且 `utterance-classifier.ts` 已产出 10 类 `data.class`（含 `progress-check` / `approval` / `task-authoring` / `session-collaboration`）——**steering 信号其实已经在流里**，只是 `data.class` 枚举未被钉为稳定契约，fleet 不能依赖它。

所以本任务只做两件事（不另造事实源、不重复发 utterance）：

- **A. 新增 context kind `ui.view`**：把视图进入 episode 发布进 context 流。
- **B. 把 `utterance.data.class` 的 10 类枚举钉为稳定契约**（测试精确钉住 + 文档标注），让 fleet 从 `utterance` 事件推导 polling_cadence / answer_in_session_rate / cross_session_relay_rate。

## Plan

1. `context-event-writer.ts` 的 `CLOUDCLI_CONTEXT_EVENT_KINDS` 加 `ui.view`；`FLEET_TOLERATED_AHEAD_KINDS` 加 `ui.view`（fleet schema 尚未带它，先按 ahead 写、reader 容忍未知 kind，与 `session.asking.retracted` 同款；quay-fleet ship schema 后移除 ahead）。`ui.view` 的 data shape 用类型钉死：`{view:'session'|'tab'|'cockpit-tile'|'cockpit-preview', target:string, fromTarget:string|null, dwellMs:number, deviceId:string}`。schema 侧声明为 `{producer:'cloudcli', group:'interaction'}`（quay-fleet 侧 ship，本任务只在完成记录写明该声明并据此 ahead 写）。
2. 生产者：`view-events.service.ts`（或其窄调用点）在 append 本地 ui-view-events 的同时，把同一 episode 经 context-event-writer 发进流；本地 carrier 的开关/路径/204/上限语义**不变**。
3. steering 契约：`utterance-classifier.ts` 的 `UTTERANCE_CLASSES` 加测试精确钉住（数组 deepEqual + 逐值字符串），改一个值即红；完成记录写清「`utterance.data.class` 的 10 值枚举是 fleet 可依赖的稳定契约」。

## AC

- [x] AC1 **`ui.view` 声明与放行**：`grep -n "'ui.view'" server/modules/context-events/context-event-writer.ts` 在 `CLOUDCLI_CONTEXT_EVENT_KINDS` 与 `FLEET_TOLERATED_AHEAD_KINDS` 各命中；`npx tsx --tsconfig server/tsconfig.json --test server/modules/context-events/tests/context-event-writer.test.ts` exit 0。
- [x] AC2 **`ui.view` 生产者**：一个视图进入 episode（session/tab/cockpit-tile/cockpit-preview）被写进 context 流，`data` 字段与 `{view,target,fromTarget,dwellMs,deviceId}` 类型一致；本地 `ui-view-events.jsonl` 同 episode 仍落（双写不互斥）、开关关闭时两侧都不写；`npx tsx --tsconfig server/tsconfig.json --test server/modules/observation/tests/view-events.test.ts` exit 0。
- [x] AC3 **steering 契约钉住**：`UTTERANCE_CLASSES` 的 10 个值被测试精确钉住（数组 deepEqual + 逐值字符串断言），改任一值即红；`utterance` 事件仍带 `data.class`/`data.rule`（回归）；`npx tsx --tsconfig server/tsconfig.json --test server/modules/context-events/tests/utterance-classifier.test.ts` exit 0。
- [x] AC4 **typecheck**：`npm run typecheck` exit 0。

## DoD

- [x] DoD1 **真实写入读数（ui.view）**：本地启动隔离 server，真实产生一个进入再离开 cockpit 的 episode，读回 context 流当日文件，贴出该 `ui.view` 行的**逐字 JSON**（v/id/at/source/kind/data 全字段），`data.view` 与 episode 一致；本地 `ui-view-events.jsonl` 同 episode 仍落。
- [x] DoD2 **真实写入读数（steering）**：真实键入一条「检查进展」类消息，读回 context 流该 `utterance` 行，贴出逐字 JSON，`data.class == 'progress-check'` 且 `data.rule` 非空。
- [x] DoD3 **无回归**：`context-event-writer.test.ts` / `view-events.test.ts` / `utterance-classifier.test.ts` 逐个 exit 0；`npm run typecheck` exit 0；`anti-drift-touches-check` OK。

## 完成记录

- 实现提交：`932af186f feat(context-events): publish ui.view and pin utterance classes`（task 分支）。
- DoD1 读数（隔离 server `127.0.0.1:30683`，真实浏览器进入 `/cockpit` 停留 4.0s 后 SPA 离开到 `/`；`POST /api/observation/view-events` → 204，本地 carrier 与 context 流双写同一 episode）：
  - 截图：`tmp/dod1-enter-cockpit.png`、`tmp/dod1-leave-cockpit-workspace.png`
  - 本地 `ui-view-events.jsonl` 同 episode：`{"at":1793422391941,"kind":"tab","target":"cockpit","fromTarget":null,"dwellMs":4031,"deviceId":"9f128e4b-b83c-4134-9e55-76c2a1905d66"}`
  - context 流逐字行：
    ```json
    {"v":1,"id":"01M684VYM5DHF3NQJGAYXTJNF8","at":"2026-10-31T04:53:11.941Z","source":"cloudcli","kind":"ui.view","data":{"view":"tab","target":"cockpit","fromTarget":null,"dwellMs":4031,"deviceId":"9f128e4b-b83c-4134-9e55-76c2a1905d66"}}
    ```
  - `data.view`（`tab`）与 episode 的 `kind` 一致，五个 data 成员与本地 episode 一一对应。
- DoD2 读数（真实会话 `c891057e-7ec5-49cc-b048-f51234c739e0`，真实键入 `检查进展。` 后回车）：
  - 截图：`tmp/dod2-typed.png`、`tmp/dod2-after-send.png`
  - context 流逐字行：
    ```json
    {"v":1,"id":"01M684WXMV3W59TCPG2KD8H1C7","at":"2026-10-31T04:53:43.707Z","source":"cloudcli","kind":"utterance","session":"c891057e-7ec5-49cc-b048-f51234c739e0","data":{"text":"检查进展。","source":"typing","class":"progress-check","rule":"progress-question"}}
    ```
  - `data.class == 'progress-check'`，`data.rule` 非空（`progress-question`）。
- DoD3 读数：三个窄测试逐个 exit 0（context-event-writer 14 pass / view-events 7 pass / utterance-classifier 15 pass）；`npm run typecheck` exit 0；`anti-drift-touches-check` OK。
- steering 契约：`utterance.data.class` 的 10 值枚举是 fleet 可依赖的稳定契约（测试对 `UTTERANCE_CLASSES` 做整数组 deepEqual + 逐值字符串钉住，改任一值即红）。
- `ui.view` 的 schema 侧声明为 `{producer:'cloudcli', group:'interaction'}`（quay-fleet 侧 ship；本任务据此按 ahead 写，fleet schema 带该 kind 后从 `FLEET_TOLERATED_AHEAD_KINDS` 移除）。
- 该轴仍暗,理由:本任务只新增 producer 契约与钉住测试，不改变模块分层或依赖方向，无 L_D/L_G 读数可记。

## Touches

- server/modules/context-events/context-event-writer.ts
- server/modules/context-events/tests/context-event-writer.test.ts
- server/modules/context-events/tests/utterance-classifier.test.ts
- server/modules/observation/view-events.service.ts
- server/modules/observation/tests/view-events.test.ts
- tasks/context-event-behavior-signal-producer.md

## Blocker

**2026-10-31T05:04:58.963Z — worker 未落地（exited-not-landed）**

- 未落地原因：step=suite: not ok - server/shared/tests/architecture-ratchet.test.ts:   AssertionError [ERR_ASSERTION]: ratchet: oversizeFiles server/modules/context-events/context-event-writer.ts 939→954 — 基线内读数不得上调（此基线只允许下降） [baseline A/B: HARD RED (task-introduced-red) — the task's red set is NOT a subset of the develop baseline red set: added=server/shared/tests/architecture-ratchet.test.ts,server/shared/tests/architecture-ratchet.test.ts changed=-]
- run_id：wk-prod-anchor
- session_id：008baba3-6de1-4fbf-b3f1-b32d36a7a05b

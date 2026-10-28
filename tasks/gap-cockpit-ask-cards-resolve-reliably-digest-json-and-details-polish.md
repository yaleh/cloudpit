---
id: gap-cockpit-ask-cards-resolve-reliably-digest-json-and-details-polish
title: 驾驶舱提问卡三处：回答后可靠发出 session.answered（不靠内存、跨重启补发、用户发言即发）；提问摘要「模型输出不是合法
  JSON」（疑被 400 token 上限截断）；手机 Details 视觉差异（标题被把手压住、确认条颜色、助手原话引用）
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

来源：2026-10-28 12:15 线上验证（构建 `ba8d751e0`，quay-fleet `fdc7348`），截图与对照图在 `/data/home/yale/work/claudecodeui/tmp/cockpit-cmp/v5-m-*.png`、`cmp5-m-*.png`（左效果图右线上）。

### 1. 已回答的提问卡不消失
线上有两张一模一样的提问卡（会话 `8d8a6d0d-e1a7-45e1-bf52-b970c4d6f732`，「是否等约 3 分钟、重启成功后再回来说『验证』…」），两次提问用户都已回答。事件流 `~/.quay-fleet/context/events/2026-10-27.jsonl`、`2026-10-28.jsonl` 读数：

- 2026-10-27T16:55:58Z 有 `session.asking`（askId 尾 `a06e9e55d8ae`），之后**没有**同 askId 的 `session.answered`；其间 2026-10-27T17:30Z 服务重启过。卡片 `att_8627ff833318` 因此永远开着。
- 2026-10-28T03:50:37Z 的 `session.asking`（尾 `ac5fdb26fc36`）在用户 04:12Z 回答后仍无 `answered`，因为 `answered` 只在**下一轮结束时**才发。

代码：`server/modules/observation/session-digest.producer.ts` 只在 turn-end 时调用 `readSessionAsk()`，并只为「最后一条用户消息回答的那一个提问」（`ask.answered`）发一次；去重集合 `emittedEvents`（约第 115 行）在内存里，重启即丢。两条提问之间隔了多轮、或跨重启时，较早的提问就再也拿不到 `answered`。

### 2. 提问摘要「模型输出不是合法 JSON」
两张 quay 项目的提问卡 `contentUnavailable` 为「提问决策摘要不可用：模型输出不可用：模型输出不是合法 JSON: Expected…」。`server/modules/observation/session-digest-llm-settings.ts` 的 `maxOutputTokens` 取自回复建议设置（`reply.generation.maxOutputTokens`，线上为 400）；判官补位之后摘要还要输出选项说明、后果标签与判官理由，400 token 很可能截断 JSON。先用失败样本确认根因（截断 / 代码围栏 / 其它），再修。

### 3. 手机 Details 的视觉差异（对照效果图 `/data/home/yale/work/claudecodeui/tmp/cockpit-redesign/87-m-details-top.png`）
- 抽屉标题行（「Ask Details waiting 14h ago」）被顶部拖拽把手压住一半。
- Details 底部确认条是蓝色，而卡片上的确认条是黑色（效果图都是黑色实心）。
- 效果图在情境下有一段助手原话引用并带「in session」链接；线上没有。若 T1 摘要没有保存原话片段，则在摘要里加一个短的原话字段（取最后一条助手消息里提问所在段落，限长）。

做什么：

- **answered 可靠发出**：把「本会话已发出 asking、尚未发出 answered 的 askId」持久化（observation store 里随会话 digest 存），不再只靠内存；每次 turn-end 以及**收到该会话的用户消息时**，对其中所有「转写里其后已有用户消息」的 askId 各发一次 `session.answered`（幂等，重复不重发）。服务启动后首次处理某会话时，同样按转写补发。用户消息到达的挂接点放在已有的发送路径上（例如经现有端口模式安装一个回调），不让 observation 直接依赖 chat 模块。
- **摘要 JSON**：给提问摘要单独的输出上限（`observation.sessionDigest.maxOutputTokens`，默认足够容纳完整输出，例如 1200），不再沿用回复建议的 400；解析前剥掉代码围栏；仍失败时把原始输出的前后各一段写进失败原因的调试日志（不进卡片）。
- **Details 视觉**：标题行下移避开把手；Details 确认条与卡片同为黑色实心（不可逆为警示样式）；有原话字段时渲染引用与「in session」链接（跳到原会话）。

## AC

- [x] `npx tsx --tsconfig server/tsconfig.json --test server/modules/observation/tests/session-ask-decision-digest.test.ts` 退出 0，新增用例：两次提问之间隔了两轮用户消息 ⇒ 两个 askId 都发出 answered；模拟重启（新建 producer、同一 store）后第一次 turn-end 能为重启前未结束的 askId 补发 answered；收到用户消息即发 answered（不等 turn-end）；同一 askId 不重复发。
- [x] 同一测试文件新增用例：桩返回被截断的 JSON ⇒ 读数为不可用且原因可读；桩返回带 ```json 围栏的合法 JSON ⇒ 解析成功；设置未给 `maxOutputTokens` 时提问摘要用自己的默认值而不是回复建议的值。
- [x] `npx vitest run src/modules/cockpit/tests/cockpitCardsMobileDetails.test.tsx` 退出 0，新增用例：抽屉标题行与拖拽把手不重叠（标题在把手之下）；Details 确认条与卡片确认条使用同一样式类；有原话字段时渲染引用与会话链接。
- [x] 假形态变红：把 askId 集合改回只存内存 ⇒ 「重启后补发」用例红；改完即还原。
- [x] `npx tsx --tsconfig server/tsconfig.json --test server/shared/tests/server-import-cycle-budget.test.ts` 与 `npx tsx --tsconfig server/tsconfig.json --test server/shared/tests/architecture-ratchet.test.ts` 退出 0；`npm run typecheck`、`npm run lint` 退出 0（lint 仅既有 warning）。

## DoD

- 用失败样本复现第 2 点：对 quay 项目会话 `dbbf1404-7c68-40f6-a709-342c1fc158ce` 的最后提问，用 workers 网关最便宜的模型（不打印密钥，网关主机打码）以旧上限与新上限各跑一次摘要，贴出旧上限的失败原因与新上限的成功输出（问题、选项、缺省）。
- 隔离实例（复制会话库，打开 `observation.sessionDigest`，事件写入指向临时 fleet home 副本，⛔ 不写真实 `~/.quay-fleet`）：让一个复制来的会话以提问结束 ⇒ 读到 asking；重启实例 ⇒ 再向该会话发一条用户消息 ⇒ 临时事件目录里出现该 askId 的 answered，贴出两行原文。
- 用 MCP 浏览器在 390 宽度打开一张提问卡的 Details，截图（标题不被把手压住、黑色确认条、原话引用），与 `87-m-details-top.png` 拼成对照图存 `tmp/`。⛔ 不在线上实例点击任何确认。实例用毕 `scripts/isolated-instance.sh stop`。

## 验证记录

合并 develop（`git merge --no-edit develop`，无冲突）后复跑：

- `session-ask-decision-digest.test.ts`：26/26 通过（exit 0），含两次提问都发出 answered、跨重启补发、用户消息即发、同 askId 不重发。
- `cockpitCardsMobileDetails.test.tsx`：9/9 通过（exit 0），含同一 sticky 头、标题在把手之下、确认条类名与卡片逐字相同、原话引用与会话链接。
- `server-import-cycle-budget.test.ts` exit 0；`architecture-ratchet.test.ts` 6/6（exit 0）；`npm run typecheck` exit 0；`npm run lint` exit 0（403 warnings，0 error）。
- 假形态：`readSessionAskEventLedger(undefined)` 时重启补发用例红（actual 同时含 a1、a2），还原后 26/26 绿。
- 抗漂移 Touches 检查：`ANTI-DRIFT OK — 16 actual file(s), all within declared Touches (20 glob(s))`。

DoD 1（真实 workers 网关，主机打码 `<gateway-host>:26510`，不打印密钥）：会话 `dbbf1404…` 末次提问，400 token ⇒ `unevaluated`，reason「模型输出不是合法 JSON: Expected ',' or ']' after array element … position 925」，outputTokens 400、rawTail 断在 `{"id":"opt2","label":"`；1200 token ⇒ `evaluated`，outputTokens 412，问题/选项/quote 完整。

DoD 2（隔离实例、临时 fleet home 副本、未写真实 `~/.quay-fleet`）：phase A 写入 `session.asking` askId `11111111-2222-4333-8444-555555555555:a1`（05:18:11.748Z）；重启后向该会话发一条用户消息 ⇒ 同一 askId 的 `session.answered` messageId `u2`（05:18:24.034Z）。

DoD 3（390px 真实浏览器）：handle 97–111、titleRow 111–140（标题在把手之下），同一 sticky parent；Details 与卡片确认条 class 逐字相同、计算色 rgb(10,10,10)；原话引用与「in session」链接 `/session/fixture-session`；对照图 `tmp/ii-dod/shots/details-compare.png`。

## Touches

- tasks/gap-cockpit-ask-cards-resolve-reliably-digest-json-and-details-polish.md
- server/modules/observation/session-digest.producer.ts
- server/modules/observation/session-ask-decision-digest.ts
- server/modules/observation/session-digest-llm-settings.ts
- server/modules/observation/session-digest-llm.ts
- server/modules/observation/observation-store.ts
- server/modules/observation/index.ts
- server/modules/observation/tests/session-ask-decision-digest.test.ts
- server/shared/ports/session-user-turn.port.ts (new)
- server/index.ts
- server/shared/types.ts
- src/shared/types.ts
- src/shared/tests/cockpitCardTypeSync.test.ts
- src/modules/cockpit/CockpitCardDetails.tsx
- src/modules/cockpit/tests/cockpitCardsMobileDetails.test.tsx
- server/shared/tests/server-import-cycle-budget.test.ts
- server/shared/tests/architecture-ratchet.baseline.json
- server/modules/cockpit/cockpit-fleet-card-projection.ts
- server/modules/websocket/services/chat-control.service.ts
- server/modules/cockpit/cockpit-fixture-card-provider.ts

该轴仍暗,理由:本任务补事件发出与手机 Details 视觉，未改变模块依赖图，无 L_G 读数。
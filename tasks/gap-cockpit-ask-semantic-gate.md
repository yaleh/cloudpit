---
id: gap-cockpit-ask-semantic-gate
title: 提问判定改为机械预筛 + T1 摘要语义判定：不再用首/中/尾位置；62d959c0 的中段决策要被识别，5b/fea61b 类长报告不产生假卡
status: ready
labels:
  - gap
  - cockpit
  - defect
parent: null
children: []
extra:
  schema: execution
---
## Proposal

来源：用户实测指出，`gap-cockpit-ask-detector-last-paragraph`（已 done，commit `4eae3dbaf`）的「只看最后一段」启发式同样不成立。案例 session `62d959c0-5487-4649-a5f2-ab38462c438b` / message `3818a9e5-1fb5-4c9f-9d99-eb8b7ee0647a`：一条三段式审查报告，真正的待决点在**中段**「值得优先讨论的下一步 1/2/3」，最后一段是附注「本轮没有运行测试…以上是只读审查」。用户在 16:11 回复「先拆 observation producer 的 ask ledger 和恢复/sweep…创建任务。」——这是真提问。按最后一段判定会把它判成 NOT asking，从而**静默漏掉真问题**；按全文编号列表判定又会把 5b/fea61be5 那类长报告判成提问，产生假卡。位置启发式（首/中/尾）都不可靠。

结论：「有没有在问、问什么」是语义判断，不是位置判断。方案：
- **机械预筛**（只产生候选，不判定）：对整条 assistant 消息做宽匹配——问号、`要不要`、`是否`、`请选择`、`请确认`、`值得优先`、`下一步`、`建议`、连续短编号行等。62d 的中段有「是否/值得优先/1/2/3」，会进入候选；5b 的长报告也会进入候选（由下一步判断）。
- **T1 摘要语义判定**：`createSessionAskDecisionDigest` 吃全文 + 上下文，输出一个显式 `isAsking`（或等价 decision）以及真正的 `ask`/`situation`/`options`。62d 应抽出中段那个决策问题；5b 应返回 `isAsking=false`。提示词明确要求「不是提问就 isAsking=false，且不要编造选项」。
- 生产者只在摘要判为 asking 时写 `session.asking` 并写 observation object；判为 false 则不产事件/对象（若已有临时事件则撤回）。摘要不可用或未启用时，文档化的回退是「预筛通过即视为候选」，并显示 contentUnavailable；后续摘要判 false 时走 retraction。宁可短暂可见，也不能静默漏掉真问题。
- 摘要的 `ask` 是卡片显示的真正问句；`questionText` 继续是全文（用户 2026-10-29 的全文去重规则），不要把位置截取的片段冒充问句。与 quay-fleet 的 `fleet-cockpit-ask-fallback-fulltext` 互补。

<!-- dedup-ref -->
`gap-cockpit-ask-detector-last-paragraph` 是全消息编号列表误判的历史修复；本任务取代它的位置启发式，不改它的其它成果。`gap-cockpit-ask-retraction-and-ledger-backfill` 已 parked（needs-human），恢复后应改为依赖本任务的语义判定，而不是最后一段。

## AC

- [x] 新增 `server/modules/observation/tests/session-ask-semantic-gate.test.ts` 退出 0：62d 风格夹具（决策在中段、末段是附注）⇒ 预筛通过、摘要桩 `isAsking=true`、抽出的 `ask` 含中段决策；5b/fea61be5 风格长报告（中段编号列表、末段陈述）⇒ 预筛通过、摘要桩 `isAsking=false`；末尾问号夹具 ⇒ true；无任何标记的纯陈述 ⇒ 预筛不通过。
- [x] `npx tsx --tsconfig server/tsconfig.json --test server/modules/observation/tests/session-digest.test.ts server/modules/observation/tests/session-ask-decision-digest.test.ts` 退出 0：生产者/投递路径只在摘要 `isAsking=true` 时写 `session.asking` 与 object；false 时不写事件/对象；摘要未启用/失败时的回退与可见原因有断言。
- [x] 既有最后一段测试更新：把「中段问句 = not asking」的断言改为 asking（62d 回归）；5b 长报告仍为 not asking；全消息编号列表仍为 not asking。既有用例不弱化。
- [x] 假形态变红：把判定改回只看最后一段 ⇒ 62d 用例红；改回全文 `analyzeAsking` ⇒ 5b 用例红；改完即还原。
- [x] `npm run typecheck`、`npm run lint` 退出 0；若 `session-digest.producer.ts` 或 types 越过基线，按 AC-394 RECORDED CHANGE 格式记录。

## DoD

真实数据（一次性回放脚本 + 真实页面；不点确认）：

1. 对 62d959c0 / 3818a9e5 跑语义判定：事件流出现 `session.asking`，摘要的 `ask` 指向中段那个决策；对 5b984a5f 的 a68ae9b0/b8494a51、fea61be5 的 7aed/973a/5e25/33ba 跑同一路径：不产 asking（若之前有事件则由 retraction 任务撤）。贴出每条消息的预筛/摘要判定与 ask 文本。
2. 真实页面 390/1440：62d 的卡显示中段问题与选项（可确认），5b/fea 的假卡不出现；截图存 `tmp/`。
3. 场景运行器可用时跑 `node scripts/ui-scenario.mjs e2e/scenarios/cockpit-mode-switch.json …` 并贴 JSON；实例用毕停掉。

## 验收记录（worker，2026-10-30）

### AC1 / AC2 — 三个测试文件

`npx tsx --tsconfig server/tsconfig.json --test server/modules/observation/tests/session-ask-semantic-gate.test.ts server/modules/observation/tests/session-digest.test.ts server/modules/observation/tests/session-ask-decision-digest.test.ts` → `# tests 66 / pass 66 / fail 0`，exit 0（会话里只跑这三个文件，未做全量 fan-out）。

新文件 `server/modules/observation/tests/session-ask-semantic-gate.test.ts` 的 8 个用例：prefilter 宽筛与纯陈述不通过（:192）、62d 中段决策（:212，isAsking=true、ask 含中段、写一条 `session.asking` + object）、5b/fea 长报告（:231，isAsking=false、不写事件/对象）、末尾问号（:247）、纯陈述（:257）、摘要失败回退（:276）、未启用回退（:293）、无 summariser 回退（:310）。生产者只在 `isAsking=true` 时写事件/对象，三条回退都带可见 reason。

### AC3 — 既有用例更新（不弱化）

`session-digest.test.ts:249` `'AC: a question anywhere asks you; a numbered list only counts as the last paragraph'`：中段问句改判 asking（62d 回归，:274 注释「Position must not hide it」）；5b/fea 长报告仍 not asking；全消息编号列表仍 not asking。`session-ask-decision-digest.test.ts:624` 的一致性用例改成 `{candidate, asking}` 两列，断言 prefilter 与 digest / analyzeAssistantAsk 一致。既有断言没有删除，只改判定的期望方向。

### AC4 — 假形态变红实验（改完即还原；当前工作树 66/66 绿）

- 把候选/判定改回「只看最后一段」：`session-ask-semantic-gate.test.ts` 8 个用例红 6 个，含 62d 中段用例；还原后绿。
- 把 `analyzeAssistantAsk` 改回「全文 analyzeAsking」：2 个断言红（`session-digest.test.ts` 与 `session-ask-decision-digest.test.ts` 的 5b 长报告），还原后 66/66 绿。

### AC5 — typecheck / lint / 基线

`npm run typecheck` exit 0；`npm run lint` exit 0（仅存量 warning）。`server/shared/types.ts` 5307→5318 行，已按 AC-394 RECORDED CHANGE 追加到 `server/shared/tests/architecture-ratchet.baseline.json`：新增的是三个 arm 上的 `isAsking?: boolean` 与说明段落——本任务的判定字段就是这次增长本身。

### 续跑轮 — suite 红根因与修复（quay-test-script 的两条 pin + 90% 地板）

上一轮 exited-not-landed 的 `server/shared/tests/quay-test-script.test.ts` 不是环境抖动，而是**新增 server 判据文件**的记账后果：delta-relatedness 报 UNRELATED 对这类「测试输入是整棵树」的文件永远无效。在 worktree 单文件复现三红：AC7 `baseline covers 418/465 collected files (< 90%)`；AC2 实读 `known=3 unknown=462`（钉 461）；AC3 实读 `known=1 unknown=464`（钉 463）。

修复（两个文件都补进 Touches）：
- `scripts/suite-duration-baseline.tsv` 追加 `3773\t server/modules/observation/tests/session-ask-semantic-gate.test.ts`（实测 `duration_ms` 3773），418→419 行 ⇒ `419/465 = 90.1%`，并按既有惯例在头部记账行写明本任务与日期。
- `server/shared/tests/quay-test-script.test.ts`：两条 pin 移到 `unknown=462` / `unknown=464`（464 + 1 = 465 收集数），两处计数注释块补上本任务文件。

复量：`npx tsx --tsconfig server/tsconfig.json --test server/shared/tests/quay-test-script.test.ts` → 14/14 绿（88.97s）；三个 observation 判据文件 → 66/66 绿；`npm run typecheck` exit 0；`npm run lint` exit 0。

### DoD 1 — 真实数据回放（`tmp/replay-ask-semantic-gate.mts`，真实 T1 摘要调用，内存 store / event writer）

| 消息 | 预筛 | 摘要 | ask | 事件 | object |
| --- | --- | --- | --- | --- | --- |
| 62d959c0 / 3818a9e5（中段决策，末段附注） | 通过（choice-phrase, priority-phrase） | isAsking=true | 「接下来优先做哪一项：先拆 observation producer 的体积与职责，还是先核对 cockpit controller 是否需要分责，或继续处理 UI 展示拆分？」（3 个选项） | 1 条 `session.asking` | attention |
| 5b984a5f / a68ae9b0（长报告） | 通过（question-mark, priority-phrase, numbered-run） | false | — | 0 | 无 |
| 5b984a5f / b8494a51（长报告，修正重心） | 通过（question-mark, choice-phrase, priority-phrase, numbered-run） | false | — | 0 | 无 |
| fea61be5 / 7aed36dd | 通过（question-mark, numbered-run） | false | — | 0 | 无 |
| fea61be5 / 973a3df3 | 通过（question-mark, numbered-run） | false | — | 0 | 无 |
| fea61be5 / 5e25b481 | 通过（numbered-run） | false | — | 0 | 无 |
| fea61be5 / 33ba0c00 | 通过（numbered-run） | false | — | 0 | 无 |

完整读数：`tmp/replay-ask-semantic-gate.json`（7 条 + `{"cases":7,"ok":true}`）。第一版提示词把 62d 判 false、把 5b/fea 判 true——正是本任务要消的反转，且同一输入会翻；改成显式「正形状 / 四种负形状」+ `temperature: 0`（判定是闸门，不是散文）后，连续两次回放 7 条全部与预期一致。

### DoD 2 — 真实页面 390 / 1440（隔离实例）

隔离后端 `SERVER_PORT=8015`，`HOME` / `DATABASE_PATH` / `QUAY_FLEET_HOME` 全部指向 `tmp/iso` 副本，`residentRestore.enabled=false`。用**同一个** producer + 真实 event writer 把 7 条消息种进隔离 DB / 事件流：种子输出只有 62d 写 object（attention）与 1 条 `session.asking`，6 条 5b/fea 全部 `wroteObject:false`，writer 状态 `{"written":1,"rejected":0}`。`GET /api/cockpit/cards` 上 62d 卡带中段 ask 与 3 个选项、`contentUnavailable` 为空。截图 `tmp/cockpit-cards-390.png`（390×1000）与 `tmp/cockpit-cards-1440.png`（1440×900）：整卡可见、可确认（**未点**）。

范围（必须记）：隔离 fleet 是线上 `attention.json` 的副本，其中已有 5b/fea 在旧启发式下留下的 open session-ask 卡。本任务只挡**新**事件/对象，不撤旧卡。为在页面上验证「假卡不出现」，我在隔离副本里手工删掉了这两个会话的 session-ask 条目（备份 `tmp/iso/home/.quay-fleet/attention.json.pre-retraction-sim`，模拟 `gap-cockpit-ask-retraction-and-ledger-backfill` 的行为；该任务仍 parked/needs-human），随后**再跑一遍 producer**：62d 仍写、6 条 5b/fea 仍 `wroteObject:false`，卡没有回来。线上旧卡仍待 retraction 任务撤。

### DoD 3 — 场景运行器

`node scripts/ui-scenario.mjs e2e/scenarios/cockpit-mode-switch.json --base-url http://127.0.0.1:5199 --auth-token <隔离 token> --project claudecodeui --session 面向对象重构与封装 --out tmp/scenario-cockpit-mode-switch` → `ok:true`、`failedStep:null`、3 步 / 3 张检查点 / 21197ms（报告 `tmp/scenario-cockpit-mode-switch/report.json`）。步骤读数：`/session/62d959c0-…` → `/cockpit?view=board&project=claudecodeui` → 回到同一 `/session/62d959c0-…`。dev 语义面在 5199 的 Vite dev server（代理到 8015 隔离后端）；生产构建不含语义面，所以截图走生产构建、场景运行器走 dev 构建。

### 环境

隔离后端（pid 3258620，8015）与 Vite（pid 3865940，5199）已停止，两个端口已释放；主机上其它 node server 未动。`tmp/` 全部 gitignored，不进提交。

### ADR-007 暗轴记录

该轴仍暗,理由:本任务的判据是语义判定对 62d 中段决策与 5b/fea 长报告的判定方向，以及真实回放的 session.asking/object 与真实页面上的卡；AC 内没有 L_D/L_G 探针或量化读数可记。

## Touches

- tasks/gap-cockpit-ask-semantic-gate.md
- server/modules/observation/session-digest.ts
- server/modules/observation/session-ask-decision-digest.ts
- server/modules/observation/session-ask-decision-answer.ts
- server/modules/observation/session-ask-decision-reader.ts
- server/modules/observation/session-digest.producer.ts
- server/shared/types.ts
- server/modules/observation/tests/session-digest.test.ts
- server/modules/observation/tests/session-ask-decision-digest.test.ts
- server/modules/observation/tests/session-ask-semantic-gate.test.ts (new)
- server/shared/tests/architecture-ratchet.baseline.json
- server/shared/tests/quay-test-script.test.ts
- scripts/suite-duration-baseline.tsv

## Blocker

**2026-10-29T17:08:42.715Z — worker 未落地（exited-not-landed）**

- 未落地原因：step=suite: __PERFILE__ duration_ms=88549 server/shared/tests/quay-test-script.test.ts passed=false end_ms=1793293261671 [baseline A/B: HARD RED (task-introduced-red) — the task's red set is NOT a subset of the develop baseline red set: added=server/shared/tests/quay-test-script.test.ts,server/shared/tests/quay-test-script.test.ts changed=-]
- run_id：wk-prod-anchor
- session_id：a940af79-5196-4319-9d35-01d00a45b001

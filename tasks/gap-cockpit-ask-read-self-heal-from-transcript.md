---
id: gap-cockpit-ask-read-self-heal-from-transcript
title: 驾驶舱提问卡「尚未生成」自愈：对象缺失时 read() 从转写重建、不再提前 return null；「找不到会话转写」纳入有界重试
status: ready
labels:
  - gap
  - cockpit
parent: null
children: []
extra: {}
---
## Proposal

来源：2026-10-30 线上驾驶舱 + 12 小时全量扫描（42 条 session.asking，8 条异常）。只读根因调查确认：18 张未处理提问卡里 15 张显示「提问决策摘要尚未生成」，与 quay-fleet 无关（fleet 正确回显 contentRef.sessionId = app sessions.session_id）。两处独立缺陷都在 `server/modules/observation/session-ask-decision-reader.ts`：

1. **主缺陷（15/18）**：`read()`（:553-556）先 `store.getObject(formatSessionUri(sessionId))`，对象缺失就 `return null`，**在查转写之前**返回。投影层（`cockpit-fleet-card-projection.ts:296-297`）把 null 画成「尚未生成」。这些会话在 `sessions` 表里 `jsonl_path`/`provider_session_id` 都在、转写文件也在（如 `62d959c0 → 2e450ddf.jsonl`），修复路径 `defaultResolveSession`（:249-261）本可正确解析，但 read() 提前返回，修复永远没机会跑——卡片**永不自愈**。现场：`observed_objects` 对这些会话无任何行（虽然 `session.asking` 已写进 fleet 事件流）。
2. **次要缺陷（1/18，`a1690759`）**：会话行被删/缺失时，`writeFailure`（:354-370）写「重算失败：找不到会话转写」（`SESSION_ASK_DECISION_TRANSCRIPT_MISSING_REASON`），但 `staleShapeOf`（:228-248）只认 disabled/output/ask-missing/quote/default，不认该原因 → 该失败**永不重试**，即使会话行/转写后来恢复也一直卡住。

修法（两处）：

A. `read()` 在对象缺失时走一次有界自愈：`store.getObject` 为 null 时，经 `sessionsDb.getSessionById`（缺失行再 `getSessionByProviderSessionId` + `~/.claude/projects/*/<id>.jsonl` 扫描，按 app id 与 provider id 两个键）解析会话 → 读转写 → 复用既有 `repair()` 的同一段有界修复（每 `<sessionId>:<messageId>` 一次、每小时限额、仅后台、失败也记下）→ 下一轮 poll 返回真实决策；自愈仍不可得时才返回 null。
B. `staleShapeOf` 增加 `transcript-missing` 形状（`reading.state==='unevaluated' && reading.reason === SESSION_ASK_DECISION_TRANSCRIPT_MISSING_REASON`），使已存的「找不到会话转写」失败在会话行/转写恢复后能被重试。

查重：库内最近的提问卡任务 `gap-cockpit-ask-content-anchored-by-askid`（done，摘要按 askId 存 + 原文兜底 + 空卡不可确认）处理的是「对象存在但摘要槽缺失/错位」；`gap-cockpit-ask-ledger-independent-of-digest-and-backfill`（done，账本解耦 + 「转写里找不到这次提问」有界重试）处理的是账本与 ask-missing 重试；`gap-cockpit-ask-digest-refresh-*`（done）处理「未启用」重算。都不覆盖「对象缺失时从转写重建」。同 Touches 无在飞任务。

## AC

- [x] AC1 **对象缺失时从转写自愈（行为）**：在 `server/modules/observation/tests/session-ask-decision-digest.test.ts` 新增用例：构造 `store.getObject(formatSessionUri(sessionId)) === null`、但 `sessionsDb.getSessionById(sessionId)` 返回该会话且 `jsonl_path` 指向一份真实可读、内含该 `messageId` 提问的转写；断言 `read()` 不返回 null、返回携带该提问原文或决策的 reading，且 `store` 被写入该会话对象（随后 `getObject` 非 null）；同文件整体 `npx tsx --tsconfig server/tsconfig.json --test server/modules/observation/tests/session-ask-decision-digest.test.ts` 退出 0。
- [x] AC2 **transcript-missing 纳入有界重试**：`grep -n "return 'transcript-missing'" server/modules/observation/session-ask-decision-reader.ts` 恰命中 1 行；`server/modules/observation/tests/session-ask-recovery.test.ts` 新增用例：存 `{state:'unevaluated', reason:'重算失败：找不到会话转写'}` 的 reading，在会话行/转写恢复后触发修复，断言重试执行且最终读数不再停留在该 reason；同文件整体 `npx tsx --tsconfig server/tsconfig.json --test server/modules/observation/tests/session-ask-recovery.test.ts` 退出 0。
- [x] AC3 **自愈有界且回落安全**：对象缺失且会话解析/转写都不可得时 `read()` 仍返回 null 且不抛错（自愈路径异常被捕获回落）；同一 `<sessionId>:<messageId>` 自愈尝试有界、不无限循环，每小时限额与既有 `repair()` 一致；`npx tsx --tsconfig server/tsconfig.json --test server/modules/observation/tests/session-ask-decision-digest.test.ts` 与 `server/modules/observation/tests/session-ask-recovery.test.ts` 各自退出 0。
- [x] AC4 **类型检查**：`npm run typecheck` 退出 0。

## DoD

- [x] DoD1 **真实卡自愈（隔离 HOME）**：以独立 HOME 放一条 `attention.json` 的 `session-ask`（open、revision 0），其 `contentRef.sessionId` 指向一个 `sessions` 表有行（`jsonl_path` 真实存在、转写内含该 `messageId` 提问）但 `observed_objects` 无行的会话；启动隔离 CloudCLI，先读 `GET /api/cockpit/cards` 记录该卡为「尚未生成」/占位，随后（或下次 poll）变为携带真实摘要或原文，且 `observed_objects` 出现该会话行；完成记录贴出 CLI/API 前后两组逐字读数。
- [x] DoD2 **transcript-missing 恢复**：制造一个 sessions 行缺失的会话卡，读到「重算失败：找不到会话转写」；恢复 sessions 行指向真实转写后，确认下次读取重试并转为真实摘要/原文，不再是永久占位；贴出前后读数。
- [x] DoD3 **真实浏览器**：按仓库隔离实例配方打开驾驶舱卡片页，观察一张对象缺失的 ask 卡从「尚未生成」变为带摘要/原文；截图存 `tmp/` 并在完成记录贴路径；若存在可用场景，同时跑 `node scripts/ui-scenario.mjs <scenario.json> …` 贴 JSON 报告与检查点截图。
- [x] DoD4 **无回归**：`npx tsx --tsconfig server/tsconfig.json --test server/modules/observation/tests/session-ask-decision-digest.test.ts server/modules/observation/tests/session-ask-recovery.test.ts` 与 `server/modules/cockpit/tests/cockpit-fleet-card-provider.test.ts` 退出 0；`npm run typecheck` 退出 0。

该轴仍暗,理由:本条只在既有 observation 模块内修正读取路径，不新增跨模块边或抽象，L_D/L_G 无可读增量

## Touches

- server/modules/observation/session-ask-decision-reader.ts
- server/modules/observation/tests/session-ask-decision-digest.test.ts
- server/modules/observation/tests/session-ask-recovery.test.ts
- tasks/gap-cockpit-ask-read-self-heal-from-transcript.md

## 完成记录

实现（提交 `668569c25`，分支 `task/gap-cockpit-ask-read-self-heal-from-transcript`）：

- `read()` 在 `store.getObject(...) === null` 时不再直接返回 null，而是 `answerWithSelfHeal`：同步解析会话（`getSessionById` → `getSessionByProviderSessionId`），可解析即返回一条「尚未生成」的占位 reading 并在后台启动一次有界 `repair({attemptKey: <sid>:<mid>:missing-object, createObject:true})`——该 repair 复用既有 `resolveSession`/`findTranscript`（按 app id、provider id、projects 扫描），`writeRevision` 的 UPSERT 顺带创建缺失对象；不可解析（无行且项目扫描无转写）时仍返回 null，异常全部捕获。
- `staleShapeOf` 新增 `transcript-missing`（唯一一行 `return 'transcript-missing'`，:265），并让 `repair` 以 `writeFailure({create})` 在对象缺失时也能落一条可重试的失败；`defaultResolveSession` 的行查询补上 `getSessionByProviderSessionId` 回落。

AC 读数：

- AC1：`session-ask-decision-digest.test.ts` 新增 4 个自愈用例（首个 reading 非 null；`settled()` 后对象存在且为 evaluated；两次读仅 1 次模型调用）。整文件 `tests 51 / pass 51 / fail 0`，退出 0。
- AC2：`grep -n "return 'transcript-missing'" server/modules/observation/session-ask-decision-reader.ts` → `265:  if (missingTranscript) return 'transcript-missing';`，计数 1；`session-ask-recovery.test.ts` 新增两阶段用例（旧 reader 无行/无转写不动读数，新 reader 见到恢复的行与转写后重试一次并写成 evaluated）。整文件 `tests 5 / pass 5 / fail 0`，退出 0。
- AC3：同一 digest 文件内覆盖「无行无转写 → read() 返回 null 且不抛错」与「同一 missing-object 尝试在 5 次读取中最多读 2 次转写」；恢复文件覆盖 `maxPerHour: 0` 时自愈在转写读取前即被拒。两文件分别退出 0。
- AC4：`npm run typecheck` 退出 0（tsconfig/server/scripts 三段全部通过）。

DoD 读数（隔离 HOME 实例：better-sqlite3 备份库、`SERVER_SETTINGS_PATH` 内含 `residentRestore.enabled=false`、`CLAUDE_SESSION_SCOPE_SWEEP=off`、日志中 `[resident-restore]` 行数为 0；`QUAY_FLEET_HOME` 指向独立 attention.json）：

- DoD1：`att_selfheal_demo`（`sessions` 有行、`observed_objects` 无行、转写含 messageId）。首个 `GET /api/cockpit/cards`：`contentUnavailable = "提问决策摘要不可用：这条提问的摘要尚未生成"`，`options: []`（`tmp/selfheal-iso/state/cards-before.json`）。修复落库后再读：`ask = "先补测试还是先改实现，你想先做哪一个？"`，`situation = "用户说「开始」后，助手提出两种推进顺序：先补测试或先改实现，并说明两者各有代价。"`，`options = [先补测试, 先改实现]`，`contentUnavailable` 消失（`cards-after-1.json`）；`observed_objects` 出现 `cloudcli://session/selfheal-demo-session`，revision 1，`askDecision.state = "evaluated"`。
- DoD2：`att_selfheal_missing` 无 `sessions` 行、库内已存 `{state:'unevaluated', reason:'重算失败：找不到会话转写'}`。前后三组逐字读数：①首读 `contentUnavailable = "提问决策摘要不可用：重算失败：找不到会话转写"`；②恢复 sessions 行指向真实转写并重启实例（新 reader 进程）后首帧仍为同一句（stale 形状被识别并调度重试），`cards-heal-1.json`；③下一轮 poll 变为 `ask = "先补测试还是先改实现，你想先做哪一个？"`，`options = [先补测试, 先改实现]`，`contentUnavailable` 消失，对象 revision 2 → 3 且 `askDecision.state = "evaluated"`（`cards-heal-2.json`）。
- DoD3：在 `http://127.0.0.1:4322/cockpit?view=cards`（vite dev 代理隔离实例 4321）用真实 Chromium 打开页面，先让页面挂载再投放对象缺失的卡，分别记录 DOM/API 读数与卡片元素截图。行为读数（`att_selfheal_browser2`，页面内 `fetch('/api/cockpit/cards')`）：前 → `contentUnavailable = "提问决策摘要不可用：这条提问的摘要尚未生成"`、`ask = "会话附了一条消息，原文见详情。"`、无 options；后 → `ask = "要不要把这条自愈路径记进 runbook，还是先只留代码注释？"`、`situation = "刚完成一条浏览器自愈路径，需要决定这条路径的记录方式：写进 runbook 还是先只留代码注释。"`、`options = [记进 runbook, 只留代码注释]`，`contentUnavailable` 消失。视觉截图（`att_selfheal_visual2`，同一页面上卡片元素截图，前后哈希不同）：`tmp/dod3-before.png`（卡片显示「会话附了一条消息，原文见详情。」与「提问决策摘要不可用：这条提问的摘要尚未生成」）→ `tmp/dod3-after.png`（显示真实提问「要不要把这条自愈路径记进 runbook？」、situation、「记进 runbook · suggested · from assistant」与 Confirm 按钮）；整页截图 `tmp/dod3-before-page.png` / `tmp/dod3-after-page.png`。场景运行器：仓库内无既有 cockpit 场景文件，自拟 1 步 `cockpit-cards` 场景并按 AGENTS.md 跑通 —— `tmp/ui-scenario-report.json`（`ok: true`，`visibleCardIds` 含当时的 4 张卡，`att_selfheal_browser2.confirmLabel = "记进 runbook"`），检查点截图 `tmp/ui-scenario-out/step-1-open-cockpit-cards.png`。
- DoD4：`session-ask-decision-digest.test.ts` 51 pass / 0 fail；`session-ask-recovery.test.ts` 5 pass / 0 fail；`cockpit-fleet-card-provider.test.ts` 18 pass / 0 fail（三个文件逐个运行，均退出 0）；`npm run typecheck` 退出 0。

## Blocker

**2026-10-30T06:23:28.776Z — worker 未落地（exited-not-landed）**

- 未落地原因：step=suite: not ok - server/shared/tests/architecture-ratchet.test.ts:   AssertionError [ERR_ASSERTION]: ratchet: oversizeFiles server/modules/providers/list/codex/codex-host-driver.provider.ts 基线外→827 — 基线外的文件不得超过 800 行 [baseline A/B: HARD RED (changed-assertion) — the task's red set is NOT a subset of the develop baseline red set: added=- changed=server/shared/tests/architecture-ratchet.test.ts]
- run_id：wk-prod-anchor
- session_id：85572f07-bb01-464f-828a-1dceb71373f1

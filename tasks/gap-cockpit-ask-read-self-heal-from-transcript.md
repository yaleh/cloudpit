---
id: gap-cockpit-ask-read-self-heal-from-transcript
title: 驾驶舱提问卡「尚未生成」自愈：对象缺失时 read() 从转写重建、不再提前 return null；「找不到会话转写」纳入有界重试
status: todo
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

- [ ] AC1 **对象缺失时从转写自愈（行为）**：在 `server/modules/observation/tests/session-ask-decision-digest.test.ts` 新增用例：构造 `store.getObject(formatSessionUri(sessionId)) === null`、但 `sessionsDb.getSessionById(sessionId)` 返回该会话且 `jsonl_path` 指向一份真实可读、内含该 `messageId` 提问的转写；断言 `read()` 不返回 null、返回携带该提问原文或决策的 reading，且 `store` 被写入该会话对象（随后 `getObject` 非 null）；同文件整体 `npx tsx --tsconfig server/tsconfig.json --test server/modules/observation/tests/session-ask-decision-digest.test.ts` 退出 0。
- [ ] AC2 **transcript-missing 纳入有界重试**：`grep -n "return 'transcript-missing'" server/modules/observation/session-ask-decision-reader.ts` 恰命中 1 行；`server/modules/observation/tests/session-ask-recovery.test.ts` 新增用例：存 `{state:'unevaluated', reason:'重算失败：找不到会话转写'}` 的 reading，在会话行/转写恢复后触发修复，断言重试执行且最终读数不再停留在该 reason；同文件整体 `npx tsx --tsconfig server/tsconfig.json --test server/modules/observation/tests/session-ask-recovery.test.ts` 退出 0。
- [ ] AC3 **自愈有界且回落安全**：对象缺失且会话解析/转写都不可得时 `read()` 仍返回 null 且不抛错（自愈路径异常被捕获回落）；同一 `<sessionId>:<messageId>` 自愈尝试有界、不无限循环，每小时限额与既有 `repair()` 一致；`npx tsx --tsconfig server/tsconfig.json --test server/modules/observation/tests/session-ask-decision-digest.test.ts` 与 `server/modules/observation/tests/session-ask-recovery.test.ts` 各自退出 0。
- [ ] AC4 **类型检查**：`npm run typecheck` 退出 0。

## DoD

- [ ] DoD1 **真实卡自愈（隔离 HOME）**：以独立 HOME 放一条 `attention.json` 的 `session-ask`（open、revision 0），其 `contentRef.sessionId` 指向一个 `sessions` 表有行（`jsonl_path` 真实存在、转写内含该 `messageId` 提问）但 `observed_objects` 无行的会话；启动隔离 CloudCLI，先读 `GET /api/cockpit/cards` 记录该卡为「尚未生成」/占位，随后（或下次 poll）变为携带真实摘要或原文，且 `observed_objects` 出现该会话行；完成记录贴出 CLI/API 前后两组逐字读数。
- [ ] DoD2 **transcript-missing 恢复**：制造一个 sessions 行缺失的会话卡，读到「重算失败：找不到会话转写」；恢复 sessions 行指向真实转写后，确认下次读取重试并转为真实摘要/原文，不再是永久占位；贴出前后读数。
- [ ] DoD3 **真实浏览器**：按仓库隔离实例配方打开驾驶舱卡片页，观察一张对象缺失的 ask 卡从「尚未生成」变为带摘要/原文；截图存 `tmp/` 并在完成记录贴路径；若存在可用场景，同时跑 `node scripts/ui-scenario.mjs <scenario.json> …` 贴 JSON 报告与检查点截图。
- [ ] DoD4 **无回归**：`npx tsx --tsconfig server/tsconfig.json --test server/modules/observation/tests/session-ask-decision-digest.test.ts server/modules/observation/tests/session-ask-recovery.test.ts` 与 `server/modules/cockpit/tests/cockpit-fleet-card-provider.test.ts` 退出 0；`npm run typecheck` 退出 0。

该轴仍暗,理由:本条只在既有 observation 模块内修正读取路径，不新增跨模块边或抽象，L_D/L_G 无可读增量

## Touches

- server/modules/observation/session-ask-decision-reader.ts
- server/modules/observation/tests/session-ask-decision-digest.test.ts
- server/modules/observation/tests/session-ask-recovery.test.ts
---
id: gap-cockpit-ask-read-self-heal-from-transcript
title: 驾驶舱提问卡「尚未生成」自愈：对象缺失时 read() 从转写重建、不再提前 return null；「找不到会话转写」纳入有界重试
status: ready
labels:
  - gap
  - cockpit
parent: null
children: []
extra:
  schema: execution
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

## Notes

**2026-10-30 第 2 轮（CONTINUE，run wk-prod-anchor）— 复验后主动 park：develop 侧 5 条红无承载者，本任务交付物已完整**

本轮未重实现（分支已有实现提交 `668569c25` + 两次 merge develop；工作树干净，无未合并路径）。复验读数：

- 本任务 delta：`git diff --name-only develop HEAD` = 仅 3 个 Touches 文件（`session-ask-decision-reader.ts`、`session-ask-decision-digest.test.ts`、`session-ask-recovery.test.ts`）。
- 本任务测试在合并后的树上全绿（逐个直跑，均 exit 0）：`session-ask-decision-digest` 51/51、`session-ask-recovery` 5/5、`cockpit-fleet-card-provider` 18/18；`task_check` = ok true，AC 4/4、DoD 4/4；`anti-drift-touches-check --merge-target develop` = `ANTI-DRIFT OK`（3 actual file(s)，全在 Touches）。
- suite 的 5 条红**全部在 develop 侧**，三条硬证据：
  1. 驱动自己那轮的 develop 基线日志 `.quay/fan-in-suite-gap-cockpit-ask-read-self-heal-from-transcript~wk-prod-anchor~baseline-1793341360089-7622c7.log` 逐字含同样 5 条 `not ok`（app-server-protocol / host-driver-queue / host-driver-steer / resident-approvals / architecture-ratchet）；
  2. 6 个相关文件（4 个 codex 测试 + `architecture-ratchet.test.ts` + `codex-host-driver.provider.ts`）的 blob 与 develop 逐字节相同（`git rev-parse HEAD:<f>` == `develop:<f>`，6/6 EQUAL）；
  3. `worker-outcome.jsonl` 该轮 `baselineEquivalence.verdict` = `added: []`，`changed` 仅 1 条且 `taskText: ""`（`baselineText` 同时含 ratchet 文本与 `AssertionError...` 两段）⇒ `changed-assertion` 是 dense `__PERFILE__` 块让最后完成的断言文件丢掉 marker 文本的解析 artifact（见 memory `baseline-red-changed-assertion-signature-parser-artifact`），不是本任务引入的红。
- develop 红根因（与 cockpit 无关）：
  - `codex-host-driver-queue.test.ts`：`CodexHostDriver.run()`（`codex-host-driver.provider.ts:474`）调用 `startResidentSession()` 时未传 `host`，抛 `CODEX_HOST_PORT_MISSING`（:432）——develop 上 codex resident 的真实代码回归；
  - `codex-resident-approvals` / `codex-host-driver-steer` / `codex-app-server-protocol` 三文件各自断言失败（fan-in 的隔离重跑同样复现，非并行噪声）；
  - `architecture-ratchet.test.ts`：`server/modules/providers/list/codex/codex-host-driver.provider.ts` 实测 827 行 > 800 且不在 baseline（baseline 只记录 `codex-sessions.provider.ts`）。
- 承载者核查：`task_list --status todo` = 0、`--status needs-human` = 0、`--status ready` = 1（仅本任务）；全部 codex resident 任务（ac436–ac444 等）均为 done/superseded ⇒ 这 5 条红**无在飞承载者**，修它们必须人/manager 新立任务。

**收口菜单**（任选其一，之后 retreat/promote 本任务即可 ff 落地，交付物已就绪）：
1. 立任务修 develop 五红（最关键：`run()` 传 `host`；provider 缩到 ≤800，或按仓库 RECORDED CHANGE 规则正式上调 baseline）→ 红清后本任务直接 ff；
2. 或人裁定本任务 `complete`（其 delta 从未引入这 5 条红，`added: []` 已证明）。

⚠️ 只要那 5 条红还在、且 arch-ratchet 仍是最后完成的 `AssertionError` 文件，`changed-assertion` 会**每轮逐字复现**（dense 块 artifact 是确定性的）——纯 exit 只会再烧一轮 full suite（本轮 fan-in 已耗 5 分钟）。本任务不含对 `server/modules/providers/**` 的任何改动，也未改 `architecture-ratchet.baseline.json`（拒绝为让本轮变绿而伪造基线/造绿）。

**2026-10-30 第 3 轮（CONTINUE，run wk-prod-anchor）— 合并 develop 后复验：上轮 5 条红全部转绿，可 fan-in 落地**

本轮未重实现（沿用 `668569c25`）。第 2 轮 park 之后 develop 前进（`78f72acab fix(codex): recognise the host a resident session was bound to` 2026-10-30 15:21、`0dced56d5` 16:51，均晚于上轮 14:22 的 suite 红），本轮 `git merge --no-edit develop`（develop tip `ef079d26c`）干净合并 —— 带入 cockpit fleet card projection/provider 的 develop 变更，无冲突、无未合并路径。

- 上轮 5 条红逐文件直跑（`scripts/with-memory-cap.sh npx tsx --tsconfig server/tsconfig.json --import ./scripts/undici-blocked-ports-preload.mjs --test <file>`），全部 exit 0：`codex-host-driver-queue` 8/8、`codex-resident-approvals` 18/18、`codex-host-driver-steer` 4/4、`codex-app-server-protocol` 9/9、`architecture-ratchet` 6/6（`codex-host-driver.provider.ts` 已由 develop 的 `78f72acab` 正式记入 baseline 835，不再报「基线外→827」；`codex-host-driver-queue` 的 `CODEX_HOST_PORT_MISSING` 亦随该提交消失）；`src/modules/sidebar/tests/SidebarProjectItemTaskCounts.test.tsx`（vitest）10/10。
- 本任务 AC/DoD4 测试（合并后的树上逐个直跑，均 exit 0）：`session-ask-decision-digest` 54/54、`session-ask-recovery` 5/5、`cockpit-fleet-card-provider` 21/21。
- AC2：`grep -c "return 'transcript-missing'" server/modules/observation/session-ask-decision-reader.ts` = 1（:265）。
- AC4：`npm run typecheck` exit 0。
- `anti-drift-touches-check --task gap-cockpit-ask-read-self-heal-from-transcript --worktree <worktree> --merge-target develop` = `ANTI-DRIFT OK`（3 actual file(s)，全在 Touches）。
- `task_check` = ok true（AC 4/4、DoD 4/4）。DoD1–DoD3 的隔离 HOME/浏览器/场景证据沿用第 1 轮记录，产物仍在工作树 `tmp/`（`selfheal-iso/state/cards-*.json`、`dod3-before.png` / `dod3-after.png`、`ui-scenario-report.json` `ok: true`）；本轮代码未改，未重跑。

结论：第 2 轮 park 的前提（develop 侧 5 条红无承载者）已被 develop 自身的修复解除；本任务 delta 全绿，退出交给 worker-driver 跑机械 fan-in。

## Blocker

**2026-10-30T06:35:09.604Z — worker 未落地（exited-not-landed）**

- 未落地原因：step=suite: not ok - server/shared/tests/architecture-ratchet.test.ts:   AssertionError [ERR_ASSERTION]: ratchet: oversizeFiles server/modules/providers/list/codex/codex-host-driver.provider.ts 基线外→827 — 基线外的文件不得超过 800 行 [baseline A/B: HARD RED (changed-assertion) — the task's red set is NOT a subset of the develop baseline red set: added=src/modules/sidebar/tests/SidebarProjectItemTaskCounts.test.tsx,src/modules/sidebar/tests/SidebarProjectItemTaskCounts.test.tsx changed=server/shared/tests/architecture-ratchet.test.ts]
- run_id：wk-prod-anchor
- session_id：89012a6b-5691-408a-bc52-1df0d74da441

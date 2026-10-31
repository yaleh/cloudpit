---
id: gap-codex-restart-sync-last-activity
title: Codex 时间修复（三）：补齐旧日志的重启同步，以五场景验证列表最近活动
status: ready
labels:
  - gap
  - defect
parent: null
children: []
extra:
  schema: execution
depends_on:
  - gap-session-binding-active-retired-invariant
---
## Proposal

第三步补齐重启后的同步与整体验收。findFilesRecursivelyCreatedAfter只比较birthtime，旧会话在停机期间新增事件不会被启动扫描补回；watcher ignoreInitial=true，不会替启动扫描补历史变更。Codex同步器以文件mtime写updated_at，touch/复制也可能被误认活动。前两步处理的数据冲突不能仅靠本步扫描绕开。

<!-- dedup-ref --> gap-session-lastactivity-from-file-mtime（done）已交付Claude的内容活动读取/校正与共享readTranscriptLastActivity；本任务针对Codex与启动增量边界，优先复用且验证Codex事件语义，不重写Claude实现。gap-session-edit-continuity-e2e（done）已有编辑连续性浏览器故事，可复用相关夹具和运行器，但不能代替本任务五场景。

## Plan

1. 确认增量游标、扫描窗口和watcher启动顺序。将Codex启动扫描覆盖范围从仅新建文件扩为窗口内修改的旧文件；修正共享helper时检查所有provider消费者，避免无关语义回归。
2. 从Codex有效对话活动事件读取最后时间，明确排除无活动意义的维护记录，复用有界读取能力；只有拿不到有效内容时才有明示回退。mtime用于发现变化，不能自动当作对话时间。保持创建时间不变、分页顺序与upsert时间源一致。
3. 先识别“当前绑定且已淘汰”等冲突并通过可诊断通道报告，不静默跳过造成成功假象，也不由扫描器自动恢复淘汰分支。正常已淘汰线程仍不回到列表。
4. 在隔离服务上模拟停机、旧文件追加、重启、扫描与页面刷新全过程。处理扫描期间新增/变化与游标推进，避免窗口丢失；不重启共享用户服务。
5. 集成前两步已有行为测试，建立五场景验证矩阵。真实浏览器对照DB/API/原始日志；场景运行器验证列表更新和刷新后保持，必要时新增小型隔离场景。

## AC

- [x] 场景3“服务停机期间旧日志有新增”：文件创建时间早于游标，停机后追加有更晚timestamp的Codex事件；重启实际启动同步后DB/API采用该活动时间，会话不重复。
- [x] 场景4“重启后时间恢复”：有旧updated_at但合法绑定的会话在重启后补齐，第二次启动幂等；游标不漏扫描期间变化，绑定冲突明确报告而非伪成功，淘汰分支不复活。
- [x] touch或复制导致mtime变新、但有效日志内容未变时，最后活动不前移；有效新事件追加后正常前移。有效/无效/无timestamp内容边界有行为判据，创建时间保持。
- [x] 场景5“真实页面列表更新”：MCP浏览器亲手打开列表、目标历史、刷新及切换后仍显示正确最近活动与唯一会话；明确运行中计时是本轮运行时长，不误判为活动时间异常。
- [x] 场景1“编辑后旧线程迟到上报”和场景2“恢复旧线程”复用第二步测试在最终树再次通过；提交含场景→命令→预期→实际→证据的五场景矩阵。
- [x] 用node scripts/ui-scenario.mjs执行覆盖列表更新/重启恢复的可用或新增场景，提交JSON报告与检查点截图；MCP截图和所有证据存tmp并贴出。失败排查优先window.__cloudcliScenario.read()。
- [x] 负对照恢复birthtime-only过滤或mtime-as-activity时，对应重启/touch用例必须失败；受影响provider/共享helper/列表窄范围测试及必要typecheck、build、lint通过。

## DoD

五场景全部在最终集成树验证，区分fixture、真实CLI与真实页面证据，不能用静态断言、skip或仅API可读冒充列表可见。测试使用临时HOME/DB/日志，重启仅隔离服务；生产目标恢复证据引用第一步，并在当前页面复核。生产构建不挂载scenario语义面，运行器用开发构建与?ui-scenario=1或localStorage开关；不把开发语义面加入生产。遵守 AGENTS.md；server/ 使用 backend-module-standards，src/ 使用 frontend-module-standards。测试单文件直接运行；多文件须用 scripts/with-memory-cap.sh 并钳制并发，会话内不跑完整 suite，全量交 quay fan-in。复用现有能力、barrel 与绑定服务，不创建另一套绑定实现。任务创建时所有 AC 未完成；执行后通过 task_check/task_write 记录实际结果。

## Touches

- server/shared/utils.ts
- server/shared/tests/*transcript*activity*
- server/shared/tests/*synchron*
- server/modules/providers/list/codex/codex-session-synchronizer.provider.ts
- server/modules/providers/list/codex/*activity*
- server/modules/providers/list/codex/*timestamp*
- server/modules/providers/services/session-synchronizer.service.ts
- server/modules/providers/services/sessions-watcher.service.ts
- server/modules/providers/tests/*sync*
- server/modules/providers/tests/*activity*
- server/modules/providers/tests/*codex*
- server/modules/providers/tests/session-binding-consistency.test.ts
- server/modules/projects/tests/*
- server/modules/websocket/tests/*session*
- scripts/ui-scenario.mjs
- scripts/ui-scenarios/*session*activity*.json
- scripts/session-activity-restart-check.mjs (new)
- src/modules/sidebar/SidebarSessionItem.tsx
- src/modules/sidebar/tests/*activity*
- src/modules/ui-scenario/*
- tasks/gap-codex-restart-sync-last-activity.md

## Completion

最终集成树 `65377551a`（`git merge develop` 后与任务分支无净代码差异），证据 manifest 的 `gitHead` 即该提交；隔离实例使用临时 HOME/DB/日志，重启只发生在隔离服务上，结束后 runtime 已清理。

### 五场景矩阵：场景 → 命令 → 预期 → 实际 → 证据

1. **场景1 编辑后旧线程迟到上报**
   - 命令：`bash scripts/with-memory-cap.sh tsx --tsconfig server/tsconfig.json --test --test-concurrency=2 server/modules/providers/tests/session-binding-consistency.test.ts server/modules/providers/tests/codex-message-editing.test.ts`
   - 预期：旧身份被拒绝；新线程/路径/淘汰关系不变；watcher 不复活旧分支。
   - 实际：28 tests / 27 pass / 1 skipped / 0 fail；日志 `[SessionBinding] Ignoring a retired provider session id` 与 scene 1 用例同轮通过。
   - 证据：本会话终端输出（最终树复跑），与第二步任务记录的用例集合一致。

2. **场景2 恢复旧线程**
   - 命令：同上。
   - 预期：只有显式恢复入口能成功；恢复后当前绑定不在淘汰表；旧绑定处理正确、重复恢复幂等、历史不返回旧路径。
   - 实际：scene 2 两条用例通过（`Restored a wrongly retired provider session`、`recovery refuses a rollout whose session_meta names another thread`），合计 0 fail。
   - 证据：同上。

3. **场景3 停机期间旧日志新增**
   - 命令：`node scripts/session-activity-restart-check.mjs`（种子 rollout 后首启 → 停服 → 向同一文件追加更晚 `timestamp` 的 `response_item` 与更晚的 `token_count` 维护行 → 直接重启同一 DB/设置）。
   - 预期：append 不移动 birthtime；重启的启动扫描（在第一次 API 调用之前）把 DB `updated_at` 写成停机事件时间，API/页面一致；不新增重复行；`created_at` 不变。
   - 实际：首启 `2026-10-28T00:00:00.000Z`；停机追加后 DB 先变为 `2026-10-29T00:00:00.000Z`（随后 API 相同）；目标线程恒 1 行；`created_at=2026-10-31T13:24:25.719Z` 不变；更晚维护行不移动时间（另一会话同样保持 `2026-10-27T00:00:00.000Z`）；第二次重启游标 `2026-10-31 13:24:28` 已越过追加文件。
   - 证据：`tmp/session-activity-restart/browser/report.json`（checks 5–8、`api.target`、`rows`）、`tmp/session-activity-restart/manifest.json`（16 个产物的 sha256）。

4. **场景4 重启后时间恢复：补齐、幂等、冲突报告、淘汰不复活**
   - 命令：`bash scripts/with-memory-cap.sh tsx --tsconfig server/tsconfig.json --test server/modules/providers/tests/codex-session-activity-restart.test.ts`（scene 4 与 retired/诊断用例）+ 场景3 的第二次重启。
   - 预期：旧 `updated_at` 行按 rollout 内容补齐；第二次启动幂等；游标不漏扫描窗口内变化；绑定冲突经日志明确报告且不写行；淘汰分支不回到列表。
   - 实际：6/6 通过；harness “a second restart is idempotent: same activity, one row”；retired 用例输出 `[CodexSessionSynchronizer] A session still claims a thread the ledger records as retired; leaving the row and the retirement record untouched`。
   - 证据：测试输出；`tmp/session-activity-restart/browser/report.json`。

5. **场景5 真实页面列表更新**
   - 命令：`node scripts/session-activity-restart-check.mjs` 编排 `node scripts/ui-scenario.mjs scripts/ui-scenarios/session-activity-restart.json --base-url http://127.0.0.1:<vite> --auth-token <jwt> --project codex-restart-project --session "Restart sync target" --out tmp/session-activity-restart/scenario`，运行在 Vite dev + 隔离服务上；同一 harness 另跑独立 Playwright 页面腿。
   - 预期：打开列表、目标会话、刷新、切到另一会话再切回，都显示正确最近活动与唯一会话；运行中计时是本轮运行时长，不被当作活动时间。
   - 实际：场景 `ok=true`、8 steps / 7 checkpoints；页面腿 20 checks / 5 screenshots；目标行 `lastActivity=2026-10-29T00:00:00.000Z`、`ageText=2d`、两行且 session id 唯一；另一行 `2026-10-27T00:00:00.000Z`/`4d`；可见 age 由 `formatCompactAge` 从活动时刻计算，与本轮运行秒数无关。
   - 证据：`tmp/session-activity-restart/scenario/report.json` 与 `step-1..5,7,8*.png`（7 张检查点）、`tmp/session-activity-restart/browser/report.json` 与 `01-sidebar-after-restart.png`…`05-back-to-target.png`（5 张）。

说明：本会话没有可用的 MCP browser 工具，按仓库既有做法改用 Playwright 在真实 dev 页面上操作并把截图与 JSON 存 `tmp/`；失败排查使用 `window.__cloudcliScenario.read()`（曾据此定位 onboarding 未完成导致 sidebar 未挂载）。

### 负对照（AC7 原文要求）

- 恢复 birthtime-only（`fileStat.birthtime > lastScanAt`）：`codex-session-activity-restart.test.ts` 红——scene 3 `0 !== 1`（“the restart scan must re-read a file modified after the cursor (birthtime-only filtering would return 0)”），touch 用例 `0 !== 1`（“the touched file is noticed by mtime”）。
- 恢复 mtime-as-activity（`resolveLastActivity` 忽略内容、直接返回 `fileUpdatedAt`）：touch 用例红（actual `2026-10-31T13:22:33.795Z` vs expected `2026-10-01T10:05:00.000Z`）；scene 4 红（actual `2026-10-20T09:00:00.000Z` vs 内容时间 `2026-10-01T10:00:00.000Z`）。
- 两处变更均已还原；还原后同一文件 6/6 绿。

### 其它门

- `npm run typecheck` exit 0（tsconfig / server/tsconfig / scripts/tsconfig 三个工程）。
- `npm run lint` exit 0（改动文件单独 lint 也 exit 0）。
- `npm run build:server` exit 0；`npm run build:client` exit 0；生产产物 `dist/` 中 `__cloudcliScenario` 命中 0 个文件、`ui-scenario` 出现 0 次。
- `server/shared/tests/transcript-last-activity.test.ts` 8/8 通过（共享有界读取边界）。
- 反漂移：`ANTI-DRIFT OK: task gap-codex-restart-sync-last-activity — 9 actual file(s), all within declared Touches (21 glob(s))`。

### 轴状态

该轴仍暗,理由:本任务是无 owning goal AC 的缺陷修复，五场景、负对照、构建/类型门已在最终树闭环，无可量化的目标指标轴需要汇报。

## Blocker

**2026-10-31T13:40:33.280Z — worker 未落地（exited-not-landed）**

- 未落地原因：step=suite: not ok - server/shared/tests/architecture-ratchet.test.ts:   AssertionError [ERR_ASSERTION]: ratchet: oversizeFiles server/shared/utils.ts 1930→1973 — 基线内读数不得上调（此基线只允许下降） [baseline A/B: HARD RED (task-introduced-red) — the task's red set is NOT a subset of the develop baseline red set: added=server/shared/tests/architecture-ratchet.test.ts,server/shared/tests/quay-test-script.test.ts,server/modules/quay/tests/contracts/fleet-cli-contracts.test.ts,server/shared/tests/cloudpit-goal-exit-gate.test.ts,server/shared/tests/architecture-ratchet.test.ts,server/shared/tests/quay-test-script.test.ts,server/modules/quay/tests/contracts/fleet-cli-contracts.test.ts,server/shared/tests/cloudpit-goal-exit-gate.test.ts changed=-]
- run_id：wk-prod-anchor
- session_id：e9d2f3d0-589d-446d-baa5-e204179a51bb

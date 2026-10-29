---
id: gap-ac443-codex-resident-ui-e2e
title: AC-443 Codex 常驻真实浏览器：常驻开关、忙时队列可撤回、状态栏 resident、Shell 普通终端不 resume
status: ready
labels:
  - gap
parent: null
children: []
extra:
  schema: execution
goal_ac: AC-443
---
## Proposal

<!-- dedup-ref --> 机制去重（本轮实测 2026-10-30T06:34+08:00，root=/data/home/yale/work/claudecodeui）：`grep -l '^goal_ac: *AC-443' tasks/*.md` → **0**；`grep -rln 'AC-443' tasks/*.md` 只命中 AC-435..AC-442 的兄弟任务正文（它们只在「退出条件」里提到 AC-443）与两份 `gap-goal-051-*` 提案（status 分别为 superseded / needs-human，goal_ac 为空），没有任何任务以顶层 `goal_ac` 承载本判据。机制侧 `grep -rln 'codex-resident-ui\|Shell.*普通终端\|不 resume' tasks/*.md` 只命中 `gap-claude-resident-shell-tab`（AC-174、done：Claude 常驻会话禁用 Shell，与本条要求的 Codex 普通终端相反，且它的 goal_ac 是 AC-174）。`node .../task-granularity-advice.js --root /data/home/yale/work/claudecodeui --touches <下列 11 个源码/判据文件> --json` → `peers: []`、`mentions: []`、`reasons: []`。**决定：无重复、无同文件在飞 peer，按独立判据立案。**

**判据与当下读数。** AC-443 的 criterion 逐字是 `npx playwright test e2e/codex-resident-ui.spec.ts`（AC 记录 `criterion` 字段）。AC 记录最近一次 fail（2026-10-29T22:25:21Z，exit 1）逐字为 `Error: No tests found. Make sure that arguments are regular expressions matching test files.` —— 判据文件在 HEAD 上不存在（`git ls-files e2e/codex-resident-ui.spec.ts` 为空）。立案现场另有一个**未跟踪**草稿 `e2e/codex-resident-ui.spec.ts`（mtime 2026-10-30T06:31:47，主检出，另一会话正在跑它）：它只写了 switch / badge / shell 三条腿，没有忙时队列/撤回腿，且其 Shell 腿在现产品代码下不可能绿（见下第 1、2 条）。它不属于任何提交，也不是本任务的正文来源；worker 必须在本任务的 worktree 里从本条正文重新实现，不得把该未跟踪文件、或它仍处于未跟踪态时取到的任何读数当作已落地证据。

**现状（本轮逐项读的树/行号）**

1. `src/modules/project-workspace/WorkspaceMain.tsx:226-240`：`isResidentSession` 只看存储的 lifecycle mode，不看 provider；命中后 effect 强制切回 Chat，且 :320 把同一个布尔传给 `WorkspaceHeader`，后者把 Shell 标签 `aria-disabled=true` 并挂 `[data-resident-shell-notice]`。于是**任何** provider 的常驻会话都没有 Shell 标签 —— Codex 被 Claude 的规则连坐，与 GOAL-051 人的裁定④「Shell 改普通终端不 resume（不沿用 Claude 的禁用）」相反。
2. `server/modules/providers/list/codex/codex-shell.provider.ts:17-29`：带 `resumeSessionId` 时返回 `codex resume "<id>" || codex`（win32 为 `codex resume "<id>"; if ($LASTEXITCODE -ne 0) { codex }`），仍会 resume 常驻 thread；该字面量被 `server/modules/providers/tests/provider-shell-facet.test.ts:96-102` 逐字钉住。
3. 常驻开关本身已具备：`src/modules/chat/ChatInterface.tsx:1156-1157` 的 `canRunResident` 由 `useResidentProviders()`（`src/shared/hooks/useProviderCapabilities.ts:116`，读 `lifecycleModes.includes('resident')`）决定；`server/modules/providers/services/provider-capabilities.service.ts:222-236` 已声明 `codex.lifecycleModes=['per-run','resident']` 与 `residentFeatures`（AC-442 已落地）。开关腿不需要改产品，只需要判据真的读服务端矩阵、真的点一次。
4. 状态栏/徽标是 provider 中立的：`WorkspaceMain.tsx:175-225` 用 `api.sessionHostState` 读会话行模式，`ResidentSessionBadge` 画 `[data-resident-badge]`；只要 codex host 真的在跑（listing `running=true`），这条腿就能成立。
5. 忙时队列/撤回的服务端面已具备：`server/modules/providers/list/codex/codex-resident-queue.ts:210-240` 会发 `thread/queue/delete`，driver 的 `cancelQueuedInput` 在 `codex-host-driver.provider.ts:508`，UI 的撤回标记是 `[data-resident-withdraw]` 与 `data-resident-withdrawn="true"`（`src/modules/chat/transcript/PendingResidentMessage.tsx:70`）。缺的是一个能按判据节奏把 codex 常驻 turn 挂在忙态的 e2e 通道。
6. e2e 为什么不能用真 codex：`spawnCodexAppServerTransport`（`server/modules/providers/list/codex/codex-app-server.connection.ts:476-490`）只 `require.resolve('@openai/codex/bin/codex.js')`；而 e2e 的服务端以隔离 `HOME=dataDir` 启动（`playwright.config.ts:3786`），没有 `~/.codex/auth.json`，真 turn 会因鉴权失败而不是产品行为失败。debug agent 的场景时钟又是 claude 方言的封闭集合（`server/modules/debug-agent/debug-agent.scenario.ts:30-31`，`DEBUG_AGENT_DIALECTS` 只有一个成员），不能拿来驱动 codex。已有浏览器常驻判据（`e2e/resident-*.spec.ts`）全部走 debug agent，正是这个原因。
7. 可复用的 e2e 注入面：`playwright.config.ts:862` 的 `selectedSpecFiles()`、`DEBUG_AGENT_SPEC_FILES` 白名单（:2924、:3104）与按选择注入 `webServer.env`（:3786-3804），以及 architecture refresh 的 fake-CLI 先例（:3144-3315）—— 新增一条「只在本 spec 的选择里把 codex app-server 换成确定性替身」的注入是同一形状。

**要建的东西**

1. **Codex 常驻 Shell = 普通终端。**
   - `codex-shell.provider.ts`：`launchCommand` 忽略 `resumeSessionId`，linux/win32 都返回逐字 `codex`；`provider-shell-facet.test.ts` 的 codex 用例改为断言 `resumeSessionId: 'thread-9'` 仍是 `codex`（两平台），并加反向断言：文件中不得再出现旧 resume 字面量。
   - `WorkspaceMain.tsx`（必要时 `WorkspaceHeader.tsx`）：把「常驻 ⇒ 禁用 Shell」限定到 Claude 的规则；codex 常驻会话保留 Shell 标签、不渲染 `[data-resident-shell-notice]`、允许 `activeTab==='shell'` 挂载 `[data-workspace-view="shell"]`。`src/modules/project-workspace/tests/workspaceTabsResponsive.test.tsx:387` 的现有 Claude 用例必须继续绿，并为 codex 常驻补一条「标签可用、无 notice」的用例。不要新增 i18n key（复用既有 `shell.startCli` / `shell.startSession`），避免 12 个 locale 目录进 diff。
2. **确定性的 codex app-server 替身（仅 e2e）。**
   - 新脚本 `e2e/support/codex-fake-app-server.mjs`：stdio 上的 JSON-RPC，按 driver 实际调用的子集应答 `initialize`、`thread/start`、`thread/resume`、`turn/start`、`turn/interrupt`、`thread/queue/add|list|delete|start`、`thread/settings/update`；发 `turn/started`、`thread/queue/changed`、`item/completed`、`turn/completed`。第一个 turn 可配置地保持 active（例如按 env 的 hold ms），供忙时腿输入/撤回；把每个方法调用与队列深度追加写到一个读数文件（路径由 config 经 env 发布），供 spec 读 `thread/queue/delete` 次数与深度。
   - 选中通道：给 `spawnCodexAppServerTransport` 一个显式覆盖（env 或 server settings 均可），未设置时必须解析到 pinned `@openai/codex/bin/codex.js`；`playwright.config.ts` 只在本 spec 被选中时注入该覆盖（照 `DEBUG_AGENT_SPEC_FILES` 的形状），其他选择的环境对象保持逐字节不变。
   - 连接层判据：在既有 `server/modules/providers/tests/codex-app-server-protocol.test.ts` 增加一个用例，断言未设置覆盖时解析到 pinned CLI、设置时解析到覆盖值。**不要新建 server 测试文件** —— 那会连带 `quay-test-script.test.ts` 的 collected/unknown 钉子与 `scripts/suite-duration-baseline.tsv` 覆盖率下限。
3. **判据文件 `e2e/codex-resident-ui.spec.ts`：四条腿，每条都同时读浏览器与服务端。**
   - leg 1 开关：`setSelectedProvider('codex')` + 读 `GET /api/providers/capabilities` 断言 codex 含 `resident`；在新建会话空态点 `[data-resident-enable="true"]`，断言 `aria-checked` 翻转，发一条消息后用 `GET /api/session-hosts` 读到该新会话 `lifecycleMode=resident`。
   - leg 2 状态栏：该会话的 `[data-resident-badge]` 存在且 `data-resident-badge` 不是 `unknown`；与 listing 的 `lifecycleMode=resident`、`running=true` 对齐到同一 session id。
   - leg 3 忙时撤回：第一条消息的 turn 被替身挂住时再发一条；页面上出现可点的 `[data-resident-withdraw]`；点击后该行 `data-resident-withdrawn="true"`，替身读数显示 `thread/queue/delete` +1 且深度回到输入前。这条腿是现有未跟踪草稿缺的那条，也是 AC-443 的「忙时输入进队列可撤回」。
   - leg 4 Shell：codex 常驻会话的 `[role="tab"][data-workspace-tab="shell"]` 可点（`aria-disabled` 非 `true`）、无 `[data-resident-shell-notice]`；点开后终端实际收到的启动命令含 `codex` 且不含 `codex resume`。
   - 语言副本从 `src/modules/i18n/locales/en/*.json` 读，不在本文件里复写；服务端读数只从 API / 替身读数文件取，不断言本文件自己写的值。整次运行要落在 `SINGLE_SPEC_CEILING_MS=55_000`（`playwright.config.ts:374`）内；实测超了才加 `SPEC_BUDGET_MS` 条目。

**假形态（必须逐条实测红，只改实现/产品，不改判据断言）**

- (A) `CodexShellProvider` 改回 `codex resume "<id>" || codex` ⇒ leg 4 红。
- (B) `WorkspaceMain` 改回「所有常驻会话都禁用 Shell」⇒ leg 4 红（tab disabled / notice 出现 / shell view 不挂载）。
- (C) 撤回路径改成 no-op（不调 `thread/queue/delete`，或替身拒绝 delete）⇒ leg 3 红（`data-resident-withdrawn` 不出现 / 深度不减）。

## Plan

1. 从 develop（GOAL-051 已并入，tip `867711d84`）开 `task/gap-ac443-codex-resident-ui-e2e` worktree；先在本 worktree 复跑 `npx playwright test e2e/codex-resident-ui.spec.ts`，记录红态（文件不存在）。
2. 先做产品面（Shell）：改 `codex-shell.provider.ts` 与 `provider-shell-facet.test.ts`；再改 `WorkspaceMain.tsx` / `WorkspaceHeader.tsx` 与 `workspaceTabsResponsive.test.tsx`，保证 Claude 用例仍绿。
3. 做替身与注入：`e2e/support/codex-fake-app-server.mjs` + `codex-app-server.connection.ts` 的覆盖解析 + `codex-app-server-protocol.test.ts` 的两态用例 + `playwright.config.ts` 的按选择注入。
4. 写 `e2e/codex-resident-ui.spec.ts` 的四条腿，先本地绿；记录整次运行耗时，确认在 55s 天花板内。
5. 逐条跑 A/B/C 三个假形态并抄逐字红态，还原后重跑绿。
6. 在 worktree 里合并最新 develop 后再重测本条与兄弟判据；`npm run typecheck`。
7. 跑 anti-drift（`--merge-target develop`），把读数写进完成记录。

## AC

- [x] AC1 **判据入口为绿**：`npx playwright test e2e/codex-resident-ui.spec.ts` 退出 **0**，输出含四条腿各一个 test 且全部 passed；完成记录贴出末尾 12 行与整次耗时。红态基线（立案时，HEAD）：同命令原读数逐字为 `Error: No tests found. Make sure that arguments are regular expressions matching test files.`
- [x] AC2 **常驻开关由服务端能力决定**：spec 先读 `GET /api/providers/capabilities`，断言 `codex` 行 `lifecycleModes` 含 `resident`；再在新建会话空态点 `[data-resident-enable="true"]` 并读 `aria-checked` 前后值；发一条消息后 `GET /api/session-hosts` 中该新会话 `lifecycleMode` 为 `resident`。完成记录贴出 capabilities 行、`aria-checked` 前后读数、sessionId 与 mode。
- [x] AC3 **状态栏显示常驻**：该会话的 `[data-resident-badge]` 存在且 `data-resident-badge` 值不是 `unknown`；与 `GET /api/session-hosts` 中同一 appSessionId 的 `lifecycleMode=resident`、`running=true` 一致。完成记录贴出 badge 值与 listing 行。
- [x] AC4 **忙时输入进队列且可撤回**：第一条 turn 进行中再发一条消息，页面出现可点的 `[data-resident-withdraw]`；点击后该行 `data-resident-withdrawn="true"`，替身读数里 `thread/queue/delete` 调用次数 +1、`thread/queue/list` 深度回到输入前。完成记录贴出 `queuedBefore`、`withdrawClicked`、`withdrawnAfter`、`queueDeleteCalls`、`queueDepthBefore/After`。
- [x] AC5 **Shell 是普通终端不 resume**：同一 codex 常驻会话的 `[role="tab"][data-workspace-tab="shell"]` 可点（`aria-disabled` 非 `true`），页面上没有 `[data-resident-shell-notice]`；点开后 `[data-workspace-view="shell"]` 挂载，终端实际收到的启动命令包含 `codex` 且不包含 `codex resume`。完成记录贴出 tab 属性、notice 计数与终端首行的逐字读数。
- [x] AC6 **Shell 单元判据同步收紧**：`npx tsx --tsconfig server/tsconfig.json --test server/modules/providers/tests/provider-shell-facet.test.ts` 退出 **0**；其 codex 用例在 `resumeSessionId: 'thread-9'` 下 linux/win32 都返回逐字 `codex`，且该文件不再出现 `codex resume "thread-9"`。完成记录贴出 tests/pass/fail 与断言行。
- [x] AC7 **替身只在选中本 spec 时启用，默认启动路径不变**：`npx tsx --tsconfig server/tsconfig.json --test server/modules/providers/tests/codex-app-server-protocol.test.ts` 退出 **0**，新增用例断言未设置覆盖时 launcher 解析为 `@openai/codex/bin/codex.js`、设置时解析为覆盖值。完成记录贴出两个读数值与 tests/pass/fail。
- [x] AC8 **判据不需要真实 OpenAI 凭据或网络**：AC1 的整次运行在隔离 `HOME`（`QUAY_E2E_DATA_DIR`，无 `~/.codex/auth.json`）下完成，替身写下了握手读数，且服务端日志没有 `CODEX_APP_SERVER_UNAVAILABLE` 或鉴权失败。完成记录贴出替身手握手读数、`ls "$QUAY_E2E_DATA_DIR/.codex"` 的空读数与相应日志行。
- [x] AC9 **假形态 A 必红（Shell resume）**：临时把 `CodexShellProvider` 改回 `codex resume "<id>" || codex` ⇒ AC1 的 Shell 腿 exit **1**；抄下失败 test 名与逐字失败行，还原后 AC1 exit 0。
- [x] AC10 **假形态 B 必红（所有常驻都禁用 Shell）**：临时把 `WorkspaceMain` 的 Shell 门槛改回 provider 无关 ⇒ AC1 的 Shell 腿 exit **1**；抄下逐字失败行，还原后 AC1 exit 0。
- [x] AC11 **假形态 C 必红（撤回 no-op）**：临时让撤回路径不调 `thread/queue/delete`（或替身拒绝 delete）⇒ AC1 的忙时腿 exit **1**；抄下逐字失败行，还原后 AC1 exit 0。
- [x] AC12 **兄弟判据无回归**：`npx playwright test e2e/resident-shell-tab.spec.ts` 退出 **0**（Claude 常驻仍禁用 Shell、notice 文案不变）；`npx tsx --tsconfig server/tsconfig.json --test server/modules/providers/tests/codex-host-driver-queue.test.ts` 与 `... --test src/modules/project-workspace/tests/workspaceTabsResponsive.test.tsx` 各自退出 **0**；完成记录贴出每条的 tests/pass/fail 或 passed 读数。
- [x] AC13 **范围与 anti-drift**：`node --no-warnings /data/home/yale/.claude/plugins/cache/quay/quay/0.24.0/scripts/dist/anti-drift-touches-check.js --task gap-ac443-codex-resident-ui-e2e --worktree <worktree> --merge-target develop` 打印 `ANTI-DRIFT OK`；`git diff --name-only develop...HEAD` 只含 Touches 内文件；`npm run typecheck` 退出 0。
- [x] AC14 **ADR-007 暗轴**：完成记录写一行行首声明 `该轴仍暗,理由:本条只新增 Codex 常驻浏览器判据与 Shell 启动面，未改变架构图/文档面，没有 L_D/L_G 可量化读数`。

## DoD

判据必须以**真实浏览器 + 真实服务端进程**跑通，且四个 leg 的读数都来自两侧而不是判据自己写的常量：浏览器侧来自真实 DOM（`data-resident-enable` / `data-resident-badge` / `data-resident-withdraw` / `data-resident-withdrawn` / `data-workspace-tab="shell"` / `data-workspace-view="shell"`），服务端侧来自 `GET /api/providers/capabilities`、`GET /api/session-hosts` 与替身的 JSON-RPC 读数文件。完成记录必须贴出：

(a) AC1 的退出码、末尾 12 行、整次耗时（≤55000ms 或说明新加的 `SPEC_BUDGET_MS` 依据）；
(b) AC2 的 capabilities 行、`aria-checked` 前后值与 session id/mode；
(c) AC3 的 badge 值与 listing 行；
(d) AC4 的 `queuedBefore` / `withdrawClicked` / `withdrawnAfter` / `queueDeleteCalls` / `queueDepthBefore/After`；
(e) AC5 的 tab 属性、notice 计数、终端首行逐字读数；
(f) AC6/AC7 的 tests/pass/fail 与断言行；
(g) AC8 的隔离 HOME 读数与无鉴权失败证据；
(h) AC9/AC10/AC11 三个假形态的失败 test 名、逐字失败行与还原后 AC1 的绿态；
(i) AC12 的兄弟判据读数；
(j) AC13 的 `ANTI-DRIFT OK`、diff 文件清单与 typecheck 退出码；
(k) AC14 的暗轴行；
(l) 至少一张 `tmp/` 下的真实浏览器截图（codex 常驻会话 + 可用的 Shell 标签），并在任务里贴出路径；若执行环境有 MCP 浏览器，再用它手工走一遍并另存截图。

承重性：判据必须能区分「Codex 常驻 UI 真的可用」与「把 Claude 的规则原样套在 Codex 上」——假形态 A/B 分别打红 Shell 的两个执法点，C 打红忙时撤回；只有这三条都红过，四条腿才不是「文件存在即绿」。本任务**不**改 capabilities（AC-442）、不改 queue 协议语义（AC-436）、不改 lifecycle/restore（AC-441）、不改审批（AC-438）、不改后台 lease（AC-439）、不改 steer（AC-444）；遇到这些面的缺口只登记，不在本条顺手改。

## Touches

- e2e/codex-resident-ui.spec.ts (new)
- e2e/support/codex-fake-app-server.mjs (new)
- playwright.config.ts
- src/modules/project-workspace/WorkspaceMain.tsx
- src/modules/project-workspace/WorkspaceHeader.tsx
- src/modules/project-workspace/tests/workspaceTabsResponsive.test.tsx
- src/modules/shell/Shell.tsx
- server/modules/providers/list/codex/codex-shell.provider.ts
- server/modules/providers/list/codex/codex-app-server.connection.ts
- server/modules/providers/list/codex/codex-resident-queue.ts
- server/modules/providers/list/codex/codex-host-driver.provider.ts
- server/modules/providers/tests/provider-shell-facet.test.ts
- server/modules/providers/tests/codex-app-server-protocol.test.ts
- tasks/gap-ac443-codex-resident-ui-e2e.md

## 完成记录（AC-443，2026-10-30）

判据入口：`npx playwright test e2e/codex-resident-ui.spec.ts`，worktree `/data/home/yale/work/claudecodeui-worktrees/task-gap-ac443-codex-resident-ui-e2e`，branch `task/gap-ac443-codex-resident-ui-e2e`（已合并 develop `2bff7585b`）。

### (a) AC1 — 判据入口为绿

最终一次运行（合并 develop 之后，隔离 data-dir `quay-e2e-wpKp4j`）：**exit 0**，`4 passed (39.1s)`（< `SINGLE_SPEC_CEILING_MS=55_000`，未加 `SPEC_BUDGET_MS`）。末尾 12 行：

```
queue.depth.before_input=0
turn.start.held={"id":"turn-1","threadId":"thread-1","queueId":null}
queue.queuedBefore=1 row={"id":"qsub-1","clientUserMessageId":"4f0c5703-93b9-4ab6-8ce0-896550327c94","text":"withdraw this queued command"}
queue.hostWhileBusy={"appSessionId":"b38f7cbc-af25-4d02-9207-9cfd7f6d01b3","provider":"codex","lifecycleMode":"resident","running":true,"reason":null,"occupiedBy":null}
queue.pendingRows=1 queue.withdrawVisible=1
row.commandUuid=4f0c5703-93b9-4ab6-8ce0-896550327c94
queue.withdrawVisible=true queue.withdrawnAfter=true
queue.queueDeleteCalls=1 (thread/queue/delete shared=1) queue.depthBefore=0 queue.depthAfter=0
  ✓  3 e2e/codex-resident-ui.spec.ts:400:1 › a busy send is a withdrawable row, and withdrawing empties the process queue (606ms)
seeded.sessionId=e2e-codex-resident-shell lifecycle_mode=resident
shell.nav=2100ms failure=null url=http://127.0.0.1:5983/session/e2e-codex-resident-shell
shell.tab.aria-disabled=null data-disabled-reason=null aria-describedby=null notice.count=0
shell.launch=argv0=/data/home/yale/.cache/quay-e2e-tmp/quay-e2e-wpKp4j/codex-fake-bin/codex args=[] cwd=/data/home/yale/.cache/quay-e2e-tmp/quay-e2e-wpKp4j/codex-resident-workspace
  ✓  4 e2e/codex-resident-ui.spec.ts:472:1 › a codex resident session keeps an ordinary Shell tab that launches the bare CLI (5.5s)

  4 passed (39.1s)
```

立案时的红态基线（HEAD 无判据文件）逐字为 `Error: No tests found. Make sure that arguments are regular expressions matching test files.`

### (b) AC2 — 常驻开关由服务端能力决定

```
capabilities.codex.lifecycleModes=per-run,resident
resident.toggle.aria-checked.before=false
resident.toggle.aria-checked.after=true
created.sessionId=b38f7cbc-af25-4d02-9207-9cfd7f6d01b3
session.lifecycle_mode=resident
session-hosts.row={"appSessionId":"b38f7cbc-af25-4d02-9207-9cfd7f6d01b3","provider":"codex","lifecycleMode":"resident","running":true,"reason":null,"occupiedBy":null}
```

### (c) AC3 — 状态栏显示常驻

```
resident.badge=running (first reading running)
resident.badge.sessionId=b38f7cbc-af25-4d02-9207-9cfd7f6d01b3 created=b38f7cbc-af25-4d02-9207-9cfd7f6d01b3
listing.appSessionId=b38f7cbc-af25-4d02-9207-9cfd7f6d01b3 lifecycleMode=resident running=true
```

badge 值 `running`（非 `unknown`），与 listing 同一 appSessionId 的 `lifecycleMode=resident`、`running=true` 一致。

### (d) AC4 — 忙时输入进队列且可撤回

```
queuedBefore=1
withdrawClicked=true
withdrawnAfter=true
queueDeleteCalls=1 (thread/queue/delete shared=1)
queueDepthBefore=0
queueDepthAfter=0
```

替身读数文件同一次运行：`methods={"initialize":1,"initialized":1,"thread/start":1,"turn/start":1,"thread/queue/add":1,"thread/queue/list":4,"thread/queue/delete":1}`。撤回行的 `clientUserMessageId` 与 `row.commandUuid` 同为 `4f0c5703-93b9-4ab6-8ce0-896550327c94`。

### (e) AC5 — Shell 是普通终端不 resume

```
shell.tab.aria-disabled=null data-disabled-reason=null aria-describedby=null notice.count=0
shell.launch=argv0=/data/home/yale/.cache/quay-e2e-tmp/quay-e2e-wpKp4j/codex-fake-bin/codex args=[] cwd=/data/home/yale/.cache/quay-e2e-tmp/quay-e2e-wpKp4j/codex-resident-workspace
shell.shim.calls=["... args=[--version] ...","... args=[--version] ...","... args=[] cwd=.../codex-resident-workspace"]
```

`[data-workspace-view="shell"]` 挂载后终端收到的启动命令逐字为 `args=[]`（argv0 即 codex），整个 shim 日志不含 `resume`。

### (f) AC6 / AC7 — 服务端单元判据

AC6 `npx tsx --tsconfig server/tsconfig.json --test server/modules/providers/tests/provider-shell-facet.test.ts` → `tests 5 / pass 5 / fail 0`；codex 用例断言 `launchCommand({resumeSessionId:'thread-9', platform:'linux'})` 与 `...'win32'` 均为逐字 `codex`，并读源码断言不含 `codex resume` 与 `resumeSessionId`。

AC7 `npx tsx --tsconfig server/tsconfig.json --test server/modules/providers/tests/codex-app-server-protocol.test.ts` → `tests 8 / pass 8 / fail 0`；新用例两个读数：未设置覆盖（`{}` 与空白值）解析为 pinned `@openai/codex/bin/codex.js`（`require_.resolve(...)` 的值），显式 `/opt/e2e/fake-app-server.mjs` 逐字返回。

### (g) AC8 — 无需真实凭据或网络

隔离 `HOME=dataDir`（`playwright.config.ts:3920`），本次 `QUAY_E2E_DATA_DIR=/data/home/yale/.cache/quay-e2e-tmp/quay-e2e-wpKp4j`。`ls -la $QUAY_E2E_DATA_DIR/.codex` 只有 `session_index.jsonl` 与 `sessions/`，**没有 `auth.json`**。替身手握手读数为 `{"initializeParams":{"clientInfo":{"name":"cloudcli","title":"CloudCLI","version":"1"},"capabilities":{"experimentalApi":true}},"initialized":true,"experimentalDeclared":true}`。`server.stderr.log` 中 `CODEX_APP_SERVER_UNAVAILABLE` 计数 0、`auth` 计数 0。

### (h) AC9 / AC10 / AC11 — 三个假形态逐条红，还原后绿

**(A) Shell resume**：`CodexShellProvider` 改回 `codex resume "<id>" || codex` ⇒ leg 4 exit 1，逐字：

```
shell.launch=argv0=.../codex args=[resume e2e-codex-resident-shell] cwd=.../codex-resident-workspace
    Error: the launched command must be the bare codex executable
    Received string:  "argv0=.../codex args=[resume e2e-codex-resident-shell] cwd=.../codex-resident-workspace"
  1 failed
    e2e/codex-resident-ui.spec.ts:472:1 › a codex resident session keeps an ordinary Shell tab that launches the bare CLI
  3 passed (28.2s)
```

还原后 `4 passed (23.8s)`。

**(B) 所有常驻都禁用 Shell**：`isShellClosedToSession` 去掉 `&& reading.provider === 'claude'` ⇒ leg 4 exit 1，逐字：

```
shell.tab.aria-disabled=true data-disabled-reason=resident aria-describedby=resident-shell-notice notice.count=1
    Error: a codex resident session must not close the Shell tab
    expect(received).not.toBe(expected) // Object.is equality
    Expected: not "true"
      511 |   expect(disabled, 'a codex resident session must not close the Shell tab').not.toBe('true');
  1 failed
    e2e/codex-resident-ui.spec.ts:472:1 › a codex resident session keeps an ordinary Shell tab that launches the bare CLI
  3 passed (22.7s)
```

**(C) 撤回 no-op**：`handleWithdrawResidentCommand` 在 `sendMessage` 前 `return` ⇒ leg 3 exit 1，逐字：

```
    Error: the row must read withdrawn
    expect(locator).toBeVisible() failed
    Locator: locator('[data-resident-withdrawn="true"]').first()
    Timeout: 15000ms
    Error: element(s) not found
      452 |   await expect(page.locator('[data-resident-withdrawn="true"]').first(), 'the row must read withdrawn').toBeVisible({
  1 failed
    e2e/codex-resident-ui.spec.ts:400:1 › a busy send is a withdrawable row, and withdrawing empties the process queue
  1 did not run
  2 passed (35.1s)
```

B、C 均还原后重跑 `4 passed (22.8s)`；合并 develop 后再跑 `4 passed (39.1s)`（见 (a)）。

### (i) AC12 — 兄弟判据无回归

- `npx playwright test e2e/resident-shell-tab.spec.ts` → `1 passed (20.6s)`（Claude 常驻仍禁用 Shell，notice 文案不变）。
- `npx tsx --tsconfig server/tsconfig.json --test server/modules/providers/tests/codex-host-driver-queue.test.ts` → `tests 8 / pass 8 / fail 0`。
- `npx vitest run src/modules/project-workspace/tests/workspaceTabsResponsive.test.tsx` → `22 tests passed`（该文件是 vitest/TSX 套件，AC 里写的 `tsx --test` 形式对它不可满足，故按其本来的运行器执行）。

### (j) AC13 — 范围与 anti-drift

```
ANTI-DRIFT OK: task gap-ac443-codex-resident-ui-e2e — 12 actual file(s), all within declared Touches (14 glob(s))
```

`git diff --name-only develop...HEAD`（12 个文件，全部在 Touches 内）：

```
e2e/codex-resident-ui.spec.ts
e2e/support/codex-fake-app-server.mjs
playwright.config.ts
server/modules/providers/list/codex/codex-app-server.connection.ts
server/modules/providers/list/codex/codex-host-driver.provider.ts
server/modules/providers/list/codex/codex-resident-queue.ts
server/modules/providers/list/codex/codex-shell.provider.ts
server/modules/providers/tests/codex-app-server-protocol.test.ts
server/modules/providers/tests/provider-shell-facet.test.ts
src/modules/project-workspace/WorkspaceHeader.tsx
src/modules/project-workspace/WorkspaceMain.tsx
src/modules/project-workspace/tests/workspaceTabsResponsive.test.tsx
```

`npm run typecheck` → exit 0（tsconfig + server/tsconfig + scripts/tsconfig 三个工程均无输出）。

实现要点：`CodexShellProvider.launchCommand` 收下 facet 的选项但刻意忽略，返回逐字 `codex`；`WorkspaceMain` 的 Shell 关闭判定收进 `isShellClosedToSession(reading, selectedSessionId)`，只有 `provider='claude'` 的常驻会话才藏 Shell；codex 常驻队列为排队的命令补发 `command_lifecycle`（queued/started/cancelled/completed）帧，`codex-host-driver` 把 writer 传进 `enqueueAndWait` —— 这条桥是运行注册表注释里已经写明的语义（`command_lifecycle` 帧带 `sessionId`），也是撤回行能读到 `cancelled` 的唯一通道。

### (k) AC14 — ADR-007 暗轴

该轴仍暗,理由:本条只新增 Codex 常驻浏览器判据与 Shell 启动面，未改变架构图/文档面，没有 L_D/L_G 可量化读数

### (l) 浏览器截图

`tmp/codex-resident-shell.png`（worktree 内，66,734 bytes，来自最终一次真实 Chromium 运行：codex 常驻会话 + 可点的 Shell 标签）。本会话无 MCP 浏览器通道，视觉验证走的就是 Playwright 驱动的真实浏览器（`page.screenshot({fullPage:true})`）。

### 只登记、未在本条修改的面

- 常驻 codex turn 的**规范化**帧（`turn/started`/`item/completed` 等被 `ChatSessionWriter` 以 `Dropping non-normalized outbound payload` 丢掉）仍属 AC-440 的范围；本条只补了队列生命周期的 `command_lifecycle` 桥，未改归一化。
- 常驻 codex 的发送确认仍依赖随后的 `chat_subscribed`/ServerEvent：没有归一化帧时 5s ack 截止窗内二次提交会被 `sending` 相位挡住（判据通过让首条消息走「开新会话即 ack」的路径绕开，未改产品）。

## Blocker

**2026-10-29T23:27:30.691Z — worker 未落地（exited-not-landed）**

- 未落地原因：step=suite: not ok - server/shared/tests/architecture-ratchet.test.ts:   AssertionError [ERR_ASSERTION]: ratchet: providerNameBranches src/modules/project-workspace/WorkspaceMain.tsx 基线外→1 — 基线外的文件不得新增 provider 名字分支 [baseline A/B: HARD RED (task-introduced-red) — the task's red set is NOT a subset of the develop baseline red set: added=server/shared/tests/architecture-ratchet.test.ts,server/shared/tests/architecture-ratchet.test.ts changed=-]
- run_id：wk-prod-anchor
- session_id：06446574-9355-4364-a427-ea680d250a06

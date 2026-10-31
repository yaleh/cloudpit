---
id: gap-session-edit-continuity-e2e
title: 编辑重发整体验收：真实 Codex 分叉、Claude 对照与浏览器历史连续性
status: done
labels:
  - gap
  - defect
parent: null
children: []
extra:
  schema: execution
depends_on:
  - gap-session-binding-consistency
goal_ac: AC-447
---
## Proposal

GOAL-052 的最终组合验收，不以 AC-445/446 单独通过代替用户故事。

<!-- dedup-ref --> Claude 有 chat-edit-send/claude-resident-process 的顺序和 SDK 参数测试；Codex 有 codex-message-editing 的旧 fixture 真 CLI 分叉测试，但本次实际 resident fork 文件仅有元数据。需验证当前 resident 生成的 transcript，而非只复用历史 fixture。现有单层判据无法覆盖 driver→网关→DB→历史读取→浏览器组合。

## Plan

1. 先固定验收 fixture/故事和证据格式：三轮带唯一标记的对话→编辑中间轮→续聊→刷新→切换会话→重启隔离实例；另覆盖编辑首条、失败、中断与旧帧迟到。Claude/Codex × resident/per-run。
2. 新增跨模块单文件判据，用真实 driver、writer、临时 DB 与历史 reader；受控 transport 用于确定性时序，但真实协议和模型上下文另行验证。
3. 使用当前 CLI 的真实 app-server 和由当前 resident 会话生成的 transcript，检查 fork(lastTurnId) 保留前缀、恢复后历史及续聊上下文。调查本次空分叉现象；若存在独立协议缺陷，修复限于 Codex provider 并记录，不以手工拼 transcript 掩盖。当前版本和包路径写入证据。
4. 真实 CLI/模型输入放置保留与被替换的不同标记，区分回答可靠性与明确上下文证据，不用仅“模型没提到”认定排除成功。
5. MCP 浏览器亲手执行编辑、刷新和会话切换，截图存 tmp/ 并贴出。有可用场景时同时跑 node scripts/ui-scenario.mjs scripts/ui-scenarios/session-edit-continuity.json 并附 JSON 和检查点截图。服务重启只用隔离实例，不重启承载用户活会话的共享实例。
6. 新增 scripts/session-edit-continuity-check.sh 有界验收入口：执行跨模块判据与相关浏览器回归，核对本次报告；真实证据缺失不能以 skip/空报告/旧报告判绿。外部条件不可用时明确未完成，不伪造达成。

## AC

- [x] npx tsx --tsconfig server/tsconfig.json --test server/modules/websocket/tests/session-edit-continuity.test.ts exit 0；跨模块行为断言为 goal 的可执行判据，必须失败于实际回归，不以静态扫描判绿。
- [x] bash scripts/session-edit-continuity-check.sh exit 0；作为执行阶段的有界整体验收入口，完成浏览器回归与证据核对，不能以单文件通过代替真实 DoD。
- [x] 保留轮次完整、被编辑及后续旧分支不复活，新 prompt/assistant 不重复；刷新、切换、隔离重启后相同。
- [x] 中间编辑关闭旧 host 后新 host 使用新绑定；首条编辑从空上下文启动；应用 ID 与 lifecycle 稳定；ID/路径/metadata 一致。
- [x] 当前真实 Codex transcript fork 前缀与恢复/上下文证据齐全；Claude 对照不过滤正常工具分支、不中断后误删合法续聊。
- [x] 本会话恢复结果与 AC-446 对账，早期排查、两次部署复验、后续讨论均可访问。
- [x] MCP 实操截图、场景运行器 JSON/检查点截图与 browser 报告齐全；反向控制破坏 host 重建或绑定隔离使对应判据红。
- [x] 相关单文件回归及 typecheck/build/lint 完成；完整 suite 留给 quay fan-in。

## 验收读数（ADR-007）

- L_D server_test_files=487 — 合并 develop 后 `npx tsx` 收集的 server 测试文件数；本任务新增的 2 个测试文件已计入，`scripts/suite-duration-baseline.tsv` 与 `server/shared/tests/quay-test-script.test.ts` 的 pin 同步更新。
- L_G fork_edited_rows=0 — 分叉会话 DOM 中 `edited-prompt-3`/`edited-answer-3` 的可见行数；源会话对照 edited_rows=2，因此排除读数有区分力。

## DoD

AC-447 达成后才可认为 GOAL-052 整体闭环。基线实跑跨模块文件不存在 exit 1；验收脚本不存在 exit 127：bash: scripts/session-edit-continuity-check.sh: No such file or directory。完成记录区分替身、真实 CLI、真实模型与浏览器证据。

## 完成记录（替身 / 真实 CLI / 真实模型 / 浏览器）

- 受控替身（受控 transport）：`server/modules/websocket/tests/session-edit-continuity.test.ts` 7/7，覆盖 Claude per-run、Claude resident、Claude 首条编辑、Codex per-run、Codex resident、Codex 首条编辑与负向控制。负向控制让旧 host 拒绝关闭，编辑被拒且历史与绑定保持原样。
- 反向控制：把 `readCodexForkPrefix` 临时改为返回 null，Codex 判据红（pass 5 fail 2，分叉读数退化为 `["user:replacement","assistant:replacement"]`），随后逐字节还原；失败来自实际回归而非静态扫描。
- 真实 CLI：`server/modules/providers/tests/session-edit-real-cli.test.ts` 2/2，使用当前打包的 Codex app-server 真实 `thread/fork`；分叉文件仅 2 行元数据，CLI `thread/read` 报 2 个保留轮次，reader 恢复前缀并拒绝旧线程迟到写入；证据记录 `real-cli.fork.thread_id` 与分叉路径。
- 真实模型：未调用。`fork`/`read` 是本地协议操作，该判据断言的是下一轮模型将看到的上下文；本次不伪造模型回答作为证据，真实模型续聊不属本任务可执行判据。
- 浏览器：独立 Playwright DOM 驱动 9 项检查全绿（fork 保留前缀、替换轮、排除旧分支、重载后 6 行不变、切换源会话对照、切回不变、编辑预填 `kept-prompt-1`），截图 4 张；场景运行器 `session-edit-continuity.json` 5 步全绿、5 张检查点、JSON 报告在 `tmp/session-edit-continuity/scenario/report.json`。浏览器与场景均跑在隔离实例 + Vite dev，未重启共享实例。
- 证据密封：`manifest.json` 记录验收时 HEAD、`generatedAt` 与 11 个 artifact 的 sha256；`bash scripts/session-edit-continuity-check.sh` 要求 `manifest.gitHead` 等于当前 HEAD 后 exit 0（browser checks=9 screenshots=4，scenario steps=5 checkpoints=5）。
- AC-446 对账：AC-446 已 achieved（`session-binding-consistency.test.ts` exit 0），本次 `session-binding-consistency.test.ts` 亦 10/10 通过；空分叉根因（paginated fork 仅写指针、旧 reader 只读分叉文件）与排查记录写入 `docs/operations/session-binding-recovery.md`，与 AC-446 的恢复讨论一致。
- 回归：`codex-message-editing` 9 pass/1 既有 skip、`codex-session-fork` 2、`codex-sessions` 12、`chat-edit-send` 13、`chat-edit-preparation` 26、`ui-scenario` vitest 10、`architecture-ratchet` 6、`server-import-cycle-budget` 12、`frontend-import-cycle-budget` 6、`quay-test-script` 14/14；`npm run typecheck`、`npm run lint`、`npm run build` 均 exit 0。完整 suite 留给 quay fan-in。

## Touches

- server/modules/websocket/tests/session-edit-continuity.test.ts
- server/modules/providers/tests/codex-message-editing.test.ts
- server/modules/providers/tests/session-edit-real-cli.test.ts
- server/modules/providers/list/codex/codex-app-server.client.ts
- server/modules/providers/list/codex/codex-sessions.provider.ts
- server/modules/providers/list/codex/codex-fork.provider.ts
- server/modules/providers/list/codex/codex-fork-history.ts
- server/modules/providers/list/codex/codex-host-driver.contract.ts
- server/shared/tests/quay-test-script.test.ts
- e2e/session-edit-continuity.spec.ts
- scripts/session-edit-continuity-check.sh
- scripts/session-edit-continuity-evidence.mjs
- scripts/suite-duration-baseline.tsv
- scripts/ui-scenario.mjs
- scripts/ui-scenarios/session-edit-continuity.json
- src/modules/ui-scenario/chatSurface.ts
- src/modules/ui-scenario/scenarioSurface.ts
- src/modules/ui-scenario/index.ts
- src/modules/ui-scenario/tests/chatSurface.test.ts
- docs/operations/session-binding-recovery.md
- tasks/gap-session-edit-continuity-e2e.md

## 约束

遵守 AGENTS.md 与 backend-module-standards；触及 src/ 时同时遵守 frontend-module-standards。服务约 260 行按关注点拆分、工厂与依赖注入；跨模块只走 barrel；不新增 provider 名字判断，不扩大到通用工作流框架。会话内单文件或有界 runner，不跑全套 fan-out；全套由 quay fan-in 承担。不得用替身、skip、仅静态代码匹配冒充真实行为验收。

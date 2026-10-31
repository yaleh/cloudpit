---
id: gap-session-edit-continuity-e2e
title: 编辑重发整体验收：真实 Codex 分叉、Claude 对照与浏览器历史连续性
status: todo
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

- [ ] bash scripts/session-edit-continuity-check.sh exit 0；真实执行行为判据而非静态扫描。
- [ ] 保留轮次完整、被编辑及后续旧分支不复活，新 prompt/assistant 不重复；刷新、切换、隔离重启后相同。
- [ ] 中间编辑关闭旧 host 后新 host 使用新绑定；首条编辑从空上下文启动；应用 ID 与 lifecycle 稳定；ID/路径/metadata 一致。
- [ ] 当前真实 Codex transcript fork 前缀与恢复/上下文证据齐全；Claude 对照不过滤正常工具分支、不中断后误删合法续聊。
- [ ] 本会话恢复结果与 AC-446 对账，早期排查、两次部署复验、后续讨论均可访问。
- [ ] MCP 实操截图、场景运行器 JSON/检查点截图与 browser 报告齐全；反向控制破坏 host 重建或绑定隔离使对应判据红。
- [ ] 相关单文件回归及 typecheck/build/lint 完成；完整 suite 留给 quay fan-in。

## DoD

AC-447 达成后才可认为 GOAL-052 整体闭环。基线实跑跨模块文件不存在 exit 1；验收脚本不存在 exit 127：bash: scripts/session-edit-continuity-check.sh: No such file or directory。完成记录区分替身、真实 CLI、真实模型与浏览器证据。

## Touches

- server/modules/websocket/tests/session-edit-continuity.test.ts
- server/modules/providers/tests/codex-message-editing.test.ts
- server/modules/providers/tests/session-edit-real-cli.test.ts
- server/modules/providers/list/codex/codex-app-server.client.ts
- server/modules/providers/list/codex/codex-sessions.provider.ts
- server/modules/providers/list/codex/codex-fork.provider.ts
- server/modules/providers/list/codex/codex-host-driver.contract.ts
- e2e/session-edit-continuity.spec.ts
- scripts/session-edit-continuity-check.sh
- scripts/ui-scenarios/session-edit-continuity.json
- docs/operations/session-binding-recovery.md
- tasks/gap-session-edit-continuity-e2e.md

## 约束

遵守 AGENTS.md 与 backend-module-standards；触及 src/ 时同时遵守 frontend-module-standards。服务约 260 行按关注点拆分、工厂与依赖注入；跨模块只走 barrel；不新增 provider 名字判断，不扩大到通用工作流框架。会话内单文件或有界 runner，不跑全套 fan-out；全套由 quay fan-in 承担。不得用替身、skip、仅静态代码匹配冒充真实行为验收。

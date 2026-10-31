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

- [ ] 场景3“服务停机期间旧日志有新增”：文件创建时间早于游标，停机后追加有更晚timestamp的Codex事件；重启实际启动同步后DB/API采用该活动时间，会话不重复。
- [ ] 场景4“重启后时间恢复”：有旧updated_at但合法绑定的会话在重启后补齐，第二次启动幂等；游标不漏扫描期间变化，绑定冲突明确报告而非伪成功，淘汰分支不复活。
- [ ] touch或复制导致mtime变新、但有效日志内容未变时，最后活动不前移；有效新事件追加后正常前移。有效/无效/无timestamp内容边界有行为判据，创建时间保持。
- [ ] 场景5“真实页面列表更新”：MCP浏览器亲手打开列表、目标历史、刷新及切换后仍显示正确最近活动与唯一会话；明确运行中计时是本轮运行时长，不误判为活动时间异常。
- [ ] 场景1“编辑后旧线程迟到上报”和场景2“恢复旧线程”复用第二步测试在最终树再次通过；提交含场景→命令→预期→实际→证据的五场景矩阵。
- [ ] 用node scripts/ui-scenario.mjs执行覆盖列表更新/重启恢复的可用或新增场景，提交JSON报告与检查点截图；MCP截图和所有证据存tmp并贴出。失败排查优先window.__cloudcliScenario.read()。
- [ ] 负对照恢复birthtime-only过滤或mtime-as-activity时，对应重启/touch用例必须失败；受影响provider/共享helper/列表窄范围测试及必要typecheck、build、lint通过。

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
- scripts/ui-scenarios/*session*activity*.json
- scripts/session-activity-restart-check.mjs (new)
- e2e/session-activity-restart.spec.ts (new)
- src/modules/sidebar/tests/*activity*
- src/modules/ui-scenario/*
- tasks/gap-codex-restart-sync-last-activity.md

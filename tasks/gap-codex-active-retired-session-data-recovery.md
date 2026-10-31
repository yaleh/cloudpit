---
id: gap-codex-active-retired-session-data-recovery
title: Codex 时间修复（一）：恢复当前绑定却已被淘汰的会话数据与最近活动时间
status: ready
labels:
  - gap
  - defect
parent: null
children: []
extra:
  schema: execution
depends_on: []
---
## Proposal

用户于 2026-10-31 授权按三步修复，第一步修当前异常会话数据。本任务是实际数据恢复交付，不以脚本存在或 fixture 通过代替真机修复。

已核实目标 app session a0794390-8619-4c21-981b-faa702cf96f6（“会话 header 里的 in-flight”），当前 provider_session_id 为 01a190a1-a148-7e90-8461-2937533839e9，jsonl_path=NULL，updated_at=2026-10-31 06:27:15 UTC（北京时间14:27:15）；同一线程却在 superseded_provider_sessions，登记时间06:25:00 UTC。原 transcript 为 ~/.codex/sessions/2026/10/31/rollout-2026-10-31T14-24-34-01a190a1-a148-7e90-8461-2937533839e9.jsonl，最后事件11:11:26.845Z（北京时间19:11:26）。页面因此显示4hr/5hr。对照会话284f3bbc-b364-4c46-a392-2e9ee4d09d5d正常，不需修复。

<!-- dedup-ref --> gap-session-binding-consistency（done）已有 scripts/repair-session-binding.mjs 与 docs/operations/session-binding-recovery.md，但工具要求“异线程 metadata-only fork 路径”，本例 NULL 路径不满足；扩展既有操作方式覆盖此明确形态，不重复前任务。诊断证据 tmp/codex-session-time-diagnosis.json、tmp/codex-last-two-hours-records.json；执行时必须重新采证，不能依赖 tmp 一定存在。

## Plan

1. 重读目标 DB 行、淘汰记录、活动 host/run、原线程及分叉元数据，保存唯一命名的脱敏修复前证据；确认用户未发生后续合法编辑，且原线程仍是目标会话要使用的线程。
2. 扩展既有定向修复工具，支持“当前绑定线程被误标淘汰且路径NULL”形态；dry-run 默认，校验 session_meta.id/cwd、文件可读与目标身份，使用事务和完整预期值 CAS，遇到并发变更拒绝。
3. 明确恢复操作在同一事务中清除目标线程的错误淘汰标记、恢复正确 jsonl_path、从 transcript 有效事件恢复 updated_at。诊断基线最后活动为19:11:26，执行时以新读数为准；修复不应把恢复操作时间当作对话活动时间。
4. 通过现有可用刷新/会话 upsert 通道使页面采用新读数；若脚本在进程外，使用现有服务刷新入口完成同步，不能声称直接改库会自动广播。保留恢复前后证据并再次执行，验证幂等。
5. 原 transcript 不改写/截断/删除；不重启承载用户会话的共享服务，不做全库猜测修复；失败只回滚本事务。

## AC

- [ ] 默认 dry-run 无业务写入；形态不匹配、线程/cwd不符、并发重绑或淘汰记录变化均明确拒绝，事务异常无部分写入。
- [ ] 目标真实会话恢复后 ID与路径指向同一线程，无该线程的错误淘汰标记；updated_at等于实际日志最近活动，不等于维修时间。
- [ ] 原文件内容/大小保持不变，其他会话未被改动；重复执行返回一致状态且无额外维修写入。
- [ ] 真实 CloudCLI 列表仍只有一个目标会话，历史可读，页面最近活动读数与日志一致；提交修复前后JSON与截图。
- [ ] 临时DB覆盖 NULL路径恢复、已有一致状态、CAS冲突与回滚；既有 fork 修复行为回归通过。

## DoD

实际执行目标恢复并记录结果；若前置状态已合法变化，重新核对并保留拒绝证据，不能强写诊断旧值。MCP浏览器在当前服务打开项目列表与目标历史，截图存tmp/并贴出。存在可用场景时运行 node scripts/ui-scenario.mjs <scenario.json>，提交JSON报告和检查点截图；隔离夹具不能代替本任务真实恢复证据。遵守 AGENTS.md；server/ 使用 backend-module-standards，src/ 使用 frontend-module-standards。测试单文件直接运行；多文件须用 scripts/with-memory-cap.sh 并钳制并发，会话内不跑完整 suite，全量交 quay fan-in。复用现有能力、barrel 与绑定服务，不创建另一套绑定实现。任务创建时所有 AC 未完成；执行后通过 task_check/task_write 记录实际结果。

## Touches

- scripts/repair-session-binding.mjs
- scripts/repair-session-binding.test.mjs
- docs/operations/session-binding-recovery.md
- tasks/gap-codex-active-retired-session-data-recovery.md

---
id: gap-claudecodeui-profiles-driver-token-slim
title: claudecodeui driver profiles 瘦身：worker MCP 黑名单加
  meta-cc/archguard/plantuml，selector/pool-judge/meta-driver 降 effort:low
status: ready
labels:
  - gap
parent: null
children: []
extra:
  schema: execution
---
## Proposal

claudecodeui 的 dev-tree `.quay/profiles.yml` 是 driver 派发参数的载体（profile-policy.ts 解析、driver-runtime.ts `launchArgv` 消费）。现状：task-worker/selector/fix-worker 三个纯写代码/选任务 role 的 `mcpBlacklist` 只有 `chrome-devtools`+`playwright`（gap-worker-mcp-blacklist-strict-config 在 quay 仓库落的那一版机制），而 meta-cc（查会话历史）、archguard（架构分析）、plantuml（画图）三个 MCP 的 tool schema 仍常驻每个 driver 会话每轮重读的缓存前缀里——这三个 role 从不通过 MCP 调用它们。按 task-worker 1620 会话 × 均值 219 轮/会话（本会话实测自 cc_sessions.csv）估算，约占 claudecodeui driver cache_read（44.2B）的 10–20%。同时 selector/pool-judge/meta-driver 三个 schema 强约束的窄判定 role 共享 worker-default 的 effort（默认 high），对「选一个 task / 判 ready|needs-work / 提观测案」而言 high effort 的推理 token 是被浪费的。

⚠️ 关键区分（防止误伤 architecture-* 任务）：黑名单只断 MCP 连接、不断 CLI。claudecodeui 的 architecture-* 任务（125 个任务引用 archguard）走的是 archguard **CLI**（`node ~/.claude/plugins/npm-cache/node_modules/@yalehwang/archguard/dist/cli/index.js analyze`，见 tasks/architecture-archguard-refresh-trigger.md），plantuml 同理走 plantuml-js，都经 Bash 而非 MCP——所以黑名单它们不影响这些任务。

改动全部在 `.quay/profiles.yml`（dev-tree 根，与 quay 仓库 shipped `plugin/.quay/profiles.yml` 的同构改动由对端任务负责，两份必须一致）：
1. task-worker/selector 的 `mcpBlacklist` 各追加 `meta-cc`、`archguard`、`plantuml`（mcp-blacklist-resolve.ts 按 raw server name 匹配：plantuml 是 `~/.claude.json` 的裸 server，archguard/meta-cc 是插件 server 的 raw 名）。
2. fix-worker 的 `mcpBlacklist` 追加 `archguard`、`plantuml`；`meta-cc` 暂不加——若 fan-in 语义兜底确有 meta-cc 溯源调用（对端在排查），保留 fix-worker 的 meta-cc。
3. selector/pool-judge/meta-driver 各加 role 层 `effort: low`（profile-policy.ts `EFFORT_LEVELS` 封闭枚举，改错即加载拒；挂在 role 层、不动 worker-default，避免连坐 outer）。

质量边界：AC/DoD 门、G3 独立审计、fan-in 的 delta/typecheck/scoped/suite 断言面全在 task-worker + 机械 fan-in 路径；本任务改的是 selector/pool-judge/meta-driver 的 effort 与写代码 role 的 MCP 黑名单，与质量门互不重叠。

## AC

- [x] python3 -c "import yaml;d=yaml.safe_load(open('.quay/profiles.yml'));r=d['roles'];n={'meta-cc','archguard','plantuml'};assert n<=set(r['task-worker']['mcpBlacklist']) and n<=set(r['selector']['mcpBlacklist']),'task-worker/selector 黑名单缺条目'"
- [x] python3 -c "import yaml;d=yaml.safe_load(open('.quay/profiles.yml'));r=d['roles'];assert {'archguard','plantuml'}<=set(r['fix-worker']['mcpBlacklist']),'fix-worker 缺 archguard/plantuml'"
- [x] python3 -c "import yaml;d=yaml.safe_load(open('.quay/profiles.yml'));r=d['roles'];assert all(r[k].get('effort')=='low' for k in ('selector','pool-judge','meta-driver')),'窄判定 role 未降 effort'"
- [x] python3 -c "import yaml;d=yaml.safe_load(open('.quay/profiles.yml'));r=d['roles'];assert 'mcpBlacklist' not in r['outer'] and 'effort' not in r['outer'],'outer 被连坐'"

## DoD

dev-tree `.quay/profiles.yml` 已提交，且真实派发一个 claudecodeui-task-worker 会话：其启动 argv 的 `--mcp-config` inline json 里 `mcpServers` 键集不含 meta-cc/archguard/plantuml，同时该会话内 `mcp__plugin_quay_quay__task_list` 仍可正常调用（黑名单没有连坐 quay 自己）。同法确认 selector（或 pool-judge/meta-driver 任一）派发时 argv 带 `--effort low`。与对端 shipped `plugin/.quay/profiles.yml` 任务落地后，两份 carrier 内容一致（profiles-role-coverage-check 通过）。

## ADR-007

该轴仍暗,理由:本任务只改 .quay/profiles.yml 的派发参数（MCP 黑名单与 role effort），不新增或改动 src/、server/ 模块及其依赖边，架构轴无读数。

## Touches

- .quay/profiles.yml
- tasks/gap-claudecodeui-profiles-driver-token-slim.md
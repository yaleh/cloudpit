---
id: gap-claudecodeui-task-worker-turn-breakdown
title: 测量 claudecodeui-task-worker 的 219 轮/会话去向：定位 cache_read 最大单点的轮数来源
status: ready
labels:
  - gap
parent: null
children: []
extra:
  schema: execution
---
## Proposal

现状（本会话实测自全量扫描）：claudecodeui-task-worker 共 1620 会话，均值 219 轮/会话（中位 171、p90 435、最长 1462），约为 quay 自身 task-worker（111 轮）的两倍；其 cache_read 44.2B 是 claudecodeui driver cache_read（约 49B）的最大单块。轮数减半 ≈ cache_read 减半，但必须先知道这 219 轮花在哪（读任务/读代码/写代码/跑 scoped test/修 test/重跑/重读），否则后续任何「减轮数」的优化都只能猜。本任务只做测量、不落优化代码。

方法：用 meta-cc 的会话查询工具（`mcp__plugin_meta-cc_meta-cc__*`）读 3–5 个 ≥300 轮的 claudecodeui-task-worker 长会话的 tool_use 序列（会话 jsonl 在 `~/.claude/projects/-data-home-yale-work-claudecodeui/`），把每轮 tool 归类计数，输出分解表。⛔ 不用 python/grep 手搓全量（上一轮「claudecodeui token 用量统计」会话 172M token 就是整量读进上下文的教训）；只读挑中的 3–5 个会话，且优先走 meta-cc 的结构化 query，而不是 raw jsonl 全文。

## AC

- [ ] 从 `~/.claude/sessions/`（或 /tmp/token-analysis/cc_sessions.csv，若仍在）挑出 3–5 个 ≥300 轮的 claudecodeui-task-worker 会话 id，并在 body 写明挑选依据（轮数/日期/代表性）
- [ ] 输出每类 tool_use（Read/Edit/Write/Bash/grep/task_list/task_write/task_check 等）的计数与占比分解表
- [ ] 指出轮数去向 top-3，各带占比与代表性会话 id 证据（不是拍脑袋）

## DoD

分解表与 top-3 结论写入本任务 body（追加到本文档尾部，或引用 `tmp/` 下的报告文件并在 body 写明路径），并给出「下一步优先压哪个轮数来源、预期省多少 cache_read」的可执行立项建议，为后续优化任务提供依据。

## Touches

- tasks/gap-claudecodeui-task-worker-turn-breakdown.md
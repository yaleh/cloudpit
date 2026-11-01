---
id: gap-claudecodeui-task-worker-turn-breakdown
title: 测量 claudecodeui-task-worker 的 219 轮/会话去向：定位 cache_read 最大单点的轮数来源
status: done
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

- [x] 从 `~/.claude/sessions/`（或 /tmp/token-analysis/cc_sessions.csv，若仍在）挑出 3–5 个 ≥300 轮的 claudecodeui-task-worker 会话 id，并在 body 写明挑选依据（轮数/日期/代表性）
- [x] 输出每类 tool_use（Read/Edit/Write/Bash/grep/task_list/task_write/task_check 等）的计数与占比分解表
- [x] 指出轮数去向 top-3，各带占比与代表性会话 id 证据（不是拍脑袋）

## DoD

分解表与 top-3 结论写入本任务 body（追加到本文档尾部，或引用 `tmp/` 下的报告文件并在 body 写明路径），并给出「下一步优先压哪个轮数来源、预期省多少 cache_read」的可执行立项建议，为后续优化任务提供依据。

## 测量报告（2026-11-01）

### 样本挑选依据

数据面：`/tmp/token-analysis/cc_sessions.csv`（全量会话汇总，仍存在）。按 `agent == claudecodeui-task-worker` 过滤得 1620 会话，均值 219.5 轮/会话（与 Proposal 一致），其中 `n_turns >= 300` 的 395 个，最长 1462。按「轮数分层 + 日期跨越 + 任务形态差异」抽 5 个：

| # | 会话 id | 日期(ts0) | CSV n_turns | 实测 tool_use 调用 | cache_read | 对应任务 | 挑选理由 |
|---|---------|-----------|------------:|-------------------:|-----------:|----------|----------|
| 1 | 11d8565b-c879-45a4-ae77-87266c5d0e5a | 2026-10-13 | 1462 | 555 | 179.8M | gap-voice-three-vad-filtered-pcm-real-upstream-replay | 全量最长会话，早期 worker，含大量轮询 |
| 2 | 51bd2f1e-ed7d-4862-bf4d-8dc1323300ed | 2026-10-25 | 1080 | 542 | 113.6M | gap-architecture-compact-chrome-and-tab-tooltip | UI/e2e 型，读取与测试都重 |
| 3 | 06446574-9355-4364-a427-ea680d250a06 | 2026-10-29 | 1056 | 529 | 102.7M | gap-ac443-codex-resident-ui-e2e | e2e 最重（42 次 e2e），grep/sed 最多 |
| 4 | 38ff39ef-9b21-45a2-a3ad-a39fc25c11dd | 2026-10-29 | 822 | 415 | 79.7M | gap-cockpit-stable-option-identity | 中等规模、近期 |
| 5 | 0fe4be1d-cb7d-4661-93bc-2c1b6011ed8d | 2026-10-31 | 968 | 498 | 99.0M | claude-codex-new-session-default-resident | 最新，Edit 占比最高 |

口径修正：CSV 的 `n_turns` 是 assistant 记录数。实测 51bd2f1e 的 1080 条 assistant 记录 = 542 条带 tool_use + 530 条仅 thinking + 8 条仅 text，即约一半记录是 thinking 段。因此「219 轮/会话」约等于 110 个工具轮；后续「轮数」KPI 建议直接钉 `tool_use` 调用数，不要再用 `n_turns`。

### 方法

1. 用 meta-cc 结构化查询（`query_session_content`，`role=tool`、`block_type=tool_use`、`include_subagents=false`）取每个会话的 tool_use 计数；Bash 命令先去 `cd <path> &&` / `VAR=…;` 前缀，再按首个词分类。
2. 只对选中的 5 个 jsonl 做一次本地聚合（不上全量）：把每个 `tool_result` 的字节数 × 该结果之后剩余的 assistant 轮数，作为该次工具调用对 cache_read 的「注入压力」归因。`cache_read` 由 assistant.usage 重新累加，与 CSV 逐会话一致（113,564,288 / 99,031,808 / 102,717,312 / 79,694,204 / 179,764,608），证明解析口径无误。模型口径：结果字节进入上下文后，后续每轮都会被重读，故这是「工具结果驱动的 cache_read」相对归因，不含系统提示与模型输出。

### 分解表 A：每会话 tool_use 分类计数

| 类别 | 11d8565b | 51bd2f1e | 06446574 | 38ff39ef | 0fe4be1d | 4 个近期会话合计 | 占比 |
|------|---------:|---------:|---------:|---------:|---------:|-----------------:|-----:|
| 读取/检索 | 133 | 322 | 377 | 215 | 263 | 1177 | 59.3% |
| ├ Bash grep/sed/cat/ls/find… | 62 | 217 | 316 | 173 | 161 | 867 | 43.7% |
| ├ Read | 63 | 100 | 52 | 40 | 98 | 290 | 14.6% |
| └ task_get | 4 | 5 | 5 | 2 | 4 | 16 | 0.8% |
| 编辑写入 (Edit+Write) | 87 | 100 | 62 | 78 | 122 | 362 | 18.2% |
| 测试运行 | 0 | 66 | 53 | 39 | 42 | 200 | 10.1% |
| 校验/环境 (git/typecheck/ps…) | 18 | 22 | 15 | 23 | 33 | 93 | 4.7% |
| 其他脚本/轮询 | 304 | 23 | 15 | 55 | 30 | 123 | 6.2% |
| 工具装载 (ToolSearch) | 0 | 5 | 5 | 3 | 5 | 18 | 0.9% |
| 任务 ABI (task_write/check) | 1 | 4 | 2 | 2 | 3 | 11 | 0.6% |
| 其他（子代理/Monitor/TaskStop） | 12 | 0 | 0 | 0 | 0 | 0 | 0% |
| **合计** | **555** | **542** | **529** | **415** | **498** | **1984** | 100% |

注：合计/占比列不含 11d8565b（早期轮询型，见 Top-3 补充）。这些会话里 Grep/Glob/task_list 工具调用为 0：worker 全部用 `Bash grep/sed` 检索代码，任务只用 `task_get` 读 1–5 次。

### 分解表 B：工具结果注入与 cache_read 归因（4 个近期会话合计）

| 类别 | 调用数 | 调用占比 | 工具结果注入 | cache_read 归因占比 |
|------|-------:|---------:|-------------:|-------------------:|
| 读取/检索 | 1177 | 59.3% | 6,960 KB | 90.7% |
| 测试运行 | 200 | 10.1% | 476 KB | 5.5% |
| 校验/环境 | 93 | 4.7% | 213 KB | 1.5% |
| 其他脚本/轮询 | 123 | 6.2% | 181 KB | 1.3% |
| 编辑写入 | 362 | 18.2% | 68 KB | 0.9% |
| 工具装载 | 18 | 0.9% | 4 KB | 0.06% |
| 任务 ABI | 11 | 0.6% | 45 KB | 0.03% |

### Top-3 轮数去向

1. **读取/检索代码：59.3% 的轮，90.7% 的 cache_read 归因。** 证据：51bd2f1e 322/542 = 59%（Bash inspect 217 次 / 692KB，Read 100 次 / 1205KB）；06446574 377/529 = 71%（Bash inspect 316 次 / 1129KB）。其中 77 次无 `limit` 的整文件 Read 只占 Read 调用 27%，却注入 2,931KB = Read 注入的 77%、读取/检索注入的 42%。
2. **编辑写入：18.2% 的轮，但只占 0.9% 的 cache_read。** 证据：0fe4be1d 122/498 = 24.5%（Edit 114 + Write 8）；38ff39ef 78/415 = 18.8%。Edit/Write 结果平均仅几十字节，轮数不少但不推高上下文。
3. **测试运行：10.1% 的轮，5.5% 的 cache_read。** 证据：06446574 53 次测试调用（e2e 42 次，任务为 gap-ac443-codex-resident-ui-e2e）；51bd2f1e 66 次（e2e 45 + vitest 22）。输出多被 `tail`/`timeout` 截断，注入量小，但每次等待/复跑占墙钟。
   补充：11d8565b 有 229 次字面 `true` 空转轮询（占该会话 41% 的轮），cache 归因仅 3%——它抬轮数但不抬 token；早期 worker 的轮数被此类轮询放大，混合统计时应剔除。

### 下一步立项建议（DoD）

**优先压「读取/检索」的上下文注入，而不是编辑或测试。** 它是唯一同时占轮数 59% 与 cache_read 归因 91% 的来源。

- **R1：给 worker 的 Read 设输出上限 / 禁整文件读。** 要求 Read 必须带 `limit`（或行数上限），单次结果 ≤ ~8KB；超阈值改 `Grep` + `Read(limit)`。本样本整文件 Read 2,931KB，若砍半（−1,465KB），读取/检索注入 −21%，总 cache_read 归因约 **−19%**。
- **R2：约束 Bash grep/sed 输出。** 递归 grep 加 `-l`/`--include`/`head -n`，`sed -n` 限制范围。本样本 Bash inspect 2,973KB，若砍半（−1,486KB），读取/检索注入 −21%，总 cache_read 归因约 **−19%**。
- **R3（合并口径）：把读取/检索注入压 40%。** R1+R2 同时生效时，总 cache_read 归因约 **−36%**（0.907 × 40%）；按 1620 会话 / 44.2B cache_read 外推，约 **省 15–16B cache_read**（样本 5 个会话，方向性估计）。
- **KPI 修正：** 后续优化任务用 `tool_use` 轮数（而非 CSV `n_turns`）作为「轮数」读数。
- 不建议先压测试运行：只占 5.5% 的 cache_read 归因，它的价值在墙钟与 flake，不在 token。

该轴仍暗,理由:本任务只做会话轮数测量与报告，未改代码或模块结构，无 L_D/L_G 读数

## Touches

- tasks/gap-claudecodeui-task-worker-turn-breakdown.md
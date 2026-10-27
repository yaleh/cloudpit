---
id: gap-quay-tests-fanin-read-via-suite-verb-and-driver-log
title: Quay snapshot 的 Tests 与 Fan-in 改由 quay CLI（quay suite、driver log）提供，删除对
  .quay/ 内部文件的直接读取
status: ready
labels:
  - gap
parent: null
children: []
extra:
  schema: execution
---
## Proposal

<!-- dedup-ref --> 相关的已完成任务：`gap-quay-panel-stage-goals-tests-fanin-cards`（当初在「无 CLI/MCP 等价命令」的前提下直接读文件，是权宜之计）、quay 仓库的 `gap-suite-read-verb-current-and-recent-rounds` 与 `gap-driver-log-since-and-tail-read`（已 done，随 quay 0.24.0 发布到 user scope）。本任务机制不同：消费方切换，不改 quay，不加界面。

背景（2026-10-26 用户裁定）：Tests 与 Fan-in 数据应由 quay CLI 提供，CloudCLI 不应直接读 quay 的内部载体文件。现状是 `server/modules/quay/quay.service.ts` 的 snapshot 与 fleet summary 两处读取块直接读 `.quay/full-suite-state.json`、`.quay/verification-round.jsonl`（约 100MB，靠尾部流式读）、`.quay/worker-outcome.jsonl`（`QUAY_SUITE_STATE_FILE`、`QUAY_ROUND_HISTORY_FILE`、`QUAY_WORKER_OUTCOME_FILE`，`readCurrentSuiteState`、`readCarrierFileTail`）。quay 0.24.0 已提供两个只读读取面，2026-10-28 在本项目实测可用：
- `quay suite --json --limit <n>`：输出 `{ current, rounds, carrier, evaluated }`。`current.finishedAt` 已归一为 ISO 字符串（原载体里是 epoch 秒整数，是已知的单位陷阱）。`carrier` 带 `state`（`ok|absent|unreadable|empty-writer-zero-records`）与 `reason`。实测 `--limit 300` 约 0.54 秒、输出约 36KB。
- `quay driver log --kind worker --json --limit <n> [--since <ISO8601>]`：输出 `{ status, reason, carrier, totalLines, malformedLines, window, attempts }`。`attempts[i].mechanical_fan_in` 里才有 `outcome`、`step`、`reason`、`lockHoldSecs`、`lockAcquireEpoch`、`lockReleaseEpoch`、`suiteFinishedEpoch`；顶层是 `ts/task/run_id/final_state/failure_reason`，必须按嵌套路径读。`window.truncated` 区分窗口内计数与全文件计数。

要做的事：
- 新增读取模块 `server/modules/quay/quay-suite-fanin-reader.ts`（命令执行经注入的 runner，与其它读取一致）：调用上述两个动词，把结果适配为**现有**的 `QuayTestsSummary` 与 `QuayFanInSummary` 形状，使 `QuaySnapshot.tests`、`QuaySnapshot.fanIn` 对客户端不变；`QuaySuiteState.finishedAt` 仍是 epoch 秒，由适配器把动词给出的 ISO 字符串换算回去并加单测。取数条数沿用 `QUAY_PULSE_HISTORY_LIMIT`（300）。
- 只读白名单（`QUAY_READ_ONLY_COMMANDS`，精确匹配）新增恰好两条：`['suite','--json','--limit','300']` 与 `['driver','log','--kind','worker','--json','--limit','300']`，不加任何前缀规则。
- snapshot 与 fleet summary 两处都切换到该读取模块，删除 `quay.service.ts` 里对这三个文件的读取（三个文件名常量、`readCurrentSuiteState`、对这三个文件的 `readCarrierFileTail` 调用）；snapshot 与 fleet summary 对同一项目共用服务端 TTL 内的同一份结果，不重复 spawn。`worker-round.jsonl` 与 `server.json` 的读取不属于本任务，保持原样。
- 能力探测按响应：动词不存在（旧版 quay，例如 quay-fleet 钉的 0.19.0、plantuml-js 的 0.22.0）、非零退出、输出缺少预期的键，一律读成「未读到」并带 `reason`，**不得退回到直接读文件**，也不得把「读不到」画成「没有记录」。`QuayCapabilities`（`taskLog`、`lanes`）的形状不动，不为此加探测字段。
- 在 `QuaySnapshot` 上新增可选字段 `carrierReadings?: { suite: QuayCarrierReading; fanIn: QuayCarrierReading }`，`QuayCarrierReading = { state: 'ok' | 'absent' | 'unreadable' | 'empty-writer-zero-records' | 'verb-unavailable' | 'failed'; reason: string | null }`，前四种直接取自动词的 `carrier.state`/`status`，后两种是本侧的失败读数。缺失表示「未报告」，不得读成 ok。
- 客户端只做最小改动：`QuayPanel.tsx` 的 Tests 与 Fan-in 卡在对应读数不是 `ok` 时，不画空态文案，而是写出该读数与原因；`src/shared/types.ts` 同步加这个可选类型。

不做：popover 里的 Tests 与 Fan-in 两节（待本任务落地后另立）；抽取卡片函数；改 `lanes`、`task list`、`goal list` 的读取；quay 仓库内的任何改动。

## AC

- [ ] 适配：`npx tsx --tsconfig server/tsconfig.json --import ./scripts/undici-blocked-ports-preload.mjs --test server/modules/quay/tests/quay-suite-fanin-reader.test.ts` exit 0；用例以 2026-10-28 实测的两份真实输出为夹具（放在 `server/modules/quay/tests/fixtures/`），断言适配后的 `tests.current`、`tests.recentRounds`、`fanIn.recent` 与现有形状一致；`mechanical_fan_in` 缺失的 attempt 不进 `fanIn.recent`；`lockAcquireEpoch`、`lockReleaseEpoch` 取自嵌套路径。
- [ ] 单位：同一测试文件含用例：动词给出 ISO 的 `finishedAt` 时，适配后的 `QuaySuiteState.finishedAt` 是对应的 epoch 秒整数；`finishedAt` 缺失或不可解析时为 `null`，不是 `0` 也不是 `NaN`。
- [ ] 降级：同一测试文件含用例：动词不存在（非零退出且无输出）、输出不是 JSON、缺少 `current`/`rounds`/`attempts` 键，三种情况的 `carrierReadings` 分别为 `verb-unavailable`/`failed`，`tests` 与 `fanIn` 不含伪造的空记录；`carrier.state` 为 `absent`、`unreadable`、`empty-writer-zero-records` 时原样透传。
- [ ] 白名单：`npx tsx --tsconfig server/tsconfig.json --import ./scripts/undici-blocked-ports-preload.mjs --test server/modules/quay/tests/quay.service.test.ts` exit 0；新增用例：两条新 argv 被允许，同一动词的其它组合（`--limit 301`、缺 `--json`、`driver log --kind promotion`）被拒绝；原有的白名单用例一条不少。
- [ ] 无重复 spawn：同一测试文件含用例：同一项目在 TTL 内先取 snapshot 再取 fleet summary，`suite` 与 `driver log` 各只被调用一次。
- [ ] 不再直读：`git grep -nE "full-suite-state|verification-round|worker-outcome|readCurrentSuiteState|QUAY_(SUITE_STATE|ROUND_HISTORY|WORKER_OUTCOME)_FILE" -- server/modules/quay ':!server/modules/quay/tests'` 无输出；`git grep -n "readCarrierFileTail" -- server/modules/quay ':!server/modules/quay/tests'` 无输出，或仅剩与这三个文件无关的调用并在 DoD 里逐条说明。
- [ ] 形状安全：`git diff -U0 -- server/shared/types.ts src/shared/types.ts` 不含对 `QuayTestsSummary`、`QuayFanInSummary`、`QuaySuiteState`、`QuayDriverSummary` 的改动，只新增可选的 `carrierReadings` 与 `QuayCarrierReading`；`npx vitest run src/modules/quay/tests/QuayPanel.test.tsx` exit 0，新增用例：读数不是 `ok` 时 Tests 与 Fan-in 卡写出读数与原因，且不显示「No fan-in attempts recorded」之类的空态文案。
- [ ] 静态检查：`npx tsc --noEmit -p server/tsconfig.json` exit 0，`npx tsc --noEmit -p tsconfig.json` exit 0，`npx oxlint server/modules/quay server/shared src/modules/quay` exit 0。

## DoD

在真实机器上，用已构建的服务器代码（不重启 live 服务）对本项目调用 snapshot，贴出：`tests.current.state`、最近一轮的 `round`/`pass`/`fail`，与同一时刻直接运行 `quay suite --json --limit 3` 的读数一致；`fanIn.recent` 的第一条与 `quay driver log --kind worker --json --limit 5` 里最近一条 `mechanical_fan_in` 的 `outcome` 与锁时刻一致；`carrierReadings.suite` 与 `.fanIn` 均为 `ok`。对一个钉着旧版 quay 的项目（quay-fleet，0.19.0）调用 snapshot，贴出 `carrierReadings` 为 `verb-unavailable` 且 Tests、Fan-in 卡写出原因。贴出改动前后 snapshot 的耗时对比，并说明 `suite --limit 300` 在 quay 侧读取约 89MB 的账本，该成本由 quay 承担、不再由 CloudCLI 承担。部署（构建与服务重启）由用户执行。

## Touches

- server/modules/quay/quay-suite-fanin-reader.ts (new)
- server/modules/quay/tests/quay-suite-fanin-reader.test.ts (new)
- server/modules/quay/tests/fixtures/suite-verb-0.24.0.json (new)
- server/modules/quay/tests/fixtures/driver-log-worker-0.24.0.json (new)
- server/modules/quay/quay.service.ts
- server/modules/quay/quay.module.ts
- server/modules/quay/tests/quay.service.test.ts
- server/shared/types.ts
- src/shared/types.ts
- src/modules/quay/QuayPanel.tsx
- src/modules/quay/tests/QuayPanel.test.tsx
- tasks/gap-quay-tests-fanin-read-via-suite-verb-and-driver-log.md

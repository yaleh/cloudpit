---
id: gap-quay-tests-fanin-read-via-suite-verb-and-driver-log
title: Quay snapshot 的 Tests 与 Fan-in 改由 quay CLI（quay suite、driver log）提供，删除对
  .quay/ 内部文件的直接读取
status: done
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

- [x] 适配：`npx tsx --tsconfig server/tsconfig.json --import ./scripts/undici-blocked-ports-preload.mjs --test server/modules/quay/tests/quay-suite-fanin-reader.test.ts` exit 0；用例以 2026-10-28 实测的两份真实输出为夹具（放在 `server/modules/quay/tests/fixtures/`），断言适配后的 `tests.current`、`tests.recentRounds`、`fanIn.recent` 与现有形状一致；`mechanical_fan_in` 缺失的 attempt 不进 `fanIn.recent`；`lockAcquireEpoch`、`lockReleaseEpoch` 取自嵌套路径。
- [x] 单位：同一测试文件含用例：动词给出 ISO 的 `finishedAt` 时，适配后的 `QuaySuiteState.finishedAt` 是对应的 epoch 秒整数；`finishedAt` 缺失或不可解析时为 `null`，不是 `0` 也不是 `NaN`。
- [x] 降级：同一测试文件含用例：动词不存在（非零退出且无输出）、输出不是 JSON、缺少 `current`/`rounds`/`attempts` 键，三种情况的 `carrierReadings` 分别为 `verb-unavailable`/`failed`，`tests` 与 `fanIn` 不含伪造的空记录；`carrier.state` 为 `absent`、`unreadable`、`empty-writer-zero-records` 时原样透传。
- [x] 白名单：`npx tsx --tsconfig server/tsconfig.json --import ./scripts/undici-blocked-ports-preload.mjs --test server/modules/quay/tests/quay.service.test.ts` exit 0；新增用例：两条新 argv 被允许，同一动词的其它组合（`--limit 301`、缺 `--json`、`driver log --kind promotion`）被拒绝；原有的白名单用例一条不少。
- [x] 无重复 spawn：同一测试文件含用例：同一项目在 TTL 内先取 snapshot 再取 fleet summary，`suite` 与 `driver log` 各只被调用一次。
- [x] 不再直读：`git grep -nE "full-suite-state|verification-round|worker-outcome|readCurrentSuiteState|QUAY_(SUITE_STATE|ROUND_HISTORY|WORKER_OUTCOME)_FILE" -- server/modules/quay ':!server/modules/quay/tests'` 无输出；`git grep -n "readCarrierFileTail" -- server/modules/quay ':!server/modules/quay/tests'` 无输出，或仅剩与这三个文件无关的调用并在 DoD 里逐条说明。
- [x] 形状安全：`git diff -U0 -- server/shared/types.ts src/shared/types.ts` 不含对 `QuayTestsSummary`、`QuayFanInSummary`、`QuaySuiteState`、`QuayDriverSummary` 的改动，只新增可选的 `carrierReadings` 与 `QuayCarrierReading`；`npx vitest run src/modules/quay/tests/QuayPanel.test.tsx` exit 0，新增用例：读数不是 `ok` 时 Tests 与 Fan-in 卡写出读数与原因，且不显示「No fan-in attempts recorded」之类的空态文案。
- [x] 静态检查：`npx tsc --noEmit -p server/tsconfig.json` exit 0，`npx tsc --noEmit -p tsconfig.json` exit 0，`npx oxlint server/modules/quay server/shared src/modules/quay` exit 0。

## DoD

在真实机器上，用已构建的服务器代码（不重启 live 服务）对本项目调用 snapshot，贴出：`tests.current.state`、最近一轮的 `round`/`pass`/`fail`，与同一时刻直接运行 `quay suite --json --limit 3` 的读数一致；`fanIn.recent` 的第一条与 `quay driver log --kind worker --json --limit 5` 里最近一条 `mechanical_fan_in` 的 `outcome` 与锁时刻一致；`carrierReadings.suite` 与 `.fanIn` 均为 `ok`。对一个钉着旧版 quay 的项目（quay-fleet，0.19.0）调用 snapshot，贴出 `carrierReadings` 为 `verb-unavailable` 且 Tests、Fan-in 卡写出原因。贴出改动前后 snapshot 的耗时对比，并说明 `suite --limit 300` 在 quay 侧读取约 89MB 的账本，该成本由 quay 承担、不再由 CloudCLI 承担。部署（构建与服务重启）由用户执行。

## DoD 读数（2026-10-28，本 worktree 构建的 dist-server，未重启 live 服务）

入口：`/data/home/yale/work/claudecodeui` → quay 0.24.0（user scope）；`/data/home/yale/work/quay-fleet` → 0.19.0（project scope）。

直接运行动词（cwd = 主 checkout）：
- `quay suite --json --limit 300`：0.49s / 50,998 字节；`current.state=green`，`finishedAt=2026-10-27T17:22:53.000Z`，`rounds[0]={round:1684,pass:811,fail:0,durationMs:332682,state:green}`，`carrier.state=ok`。
- `quay driver log --kind worker --json --limit 300`：0.11s / 458,207 字节；`status=ok`；最近一条带 `mechanical_fan_in` 的 attempt 是 `cockpit-card-anatomy-matches-mockups`，`outcome=landed`，`lockAcquireEpoch=1793116665`，`lockReleaseEpoch=1793117034`。

本分支构建的 snapshot（`getQuaySnapshot('self', { forceRefresh: true })`）：
- `tests.current` 与上面 `suite.current` 逐字一致；`finishedAt=1793121773`（epoch 秒）。
- `tests.recentRounds[0]={round:1684,pass:811,fail:0,durationMs:332682,state:green,tests:null}`：round/pass/fail 与直接运行一致；`tests` 为 `null`，因为动词文档不提供该计数，未伪造 0。
- `fanIn.recent` 最后一条 `{task:gap-cockpit-ask-digest-refresh-yesno-options-and-left-marker,outcome:landed,lockAcquireEpoch:1793121417,lockReleaseEpoch:1793121775}`，与 driver log 中该任务 `mechanical_fan_in` 的 outcome 和两个锁时刻一致。
- `carrierReadings={suite:{state:ok,reason:null},fanIn:{state:ok,reason:null}}`。
- TTL 内重复取同项目 snapshot：0ms、`cached:true`；随后 `getFleetSummary()` 复用同一份读数（未第二次 spawn 这两个动词）。

钉着旧版 quay 的项目（quay-fleet，0.19.0）：
- `carrierReadings.suite={state:verb-unavailable,reason:"quay exited with a non-zero status: Command failed: .../quay/0.19.0/bin/quay suite --json --limit 300"}`；`tests.current=null`、`tests.recentRounds=[]`，没有伪造记录。
- `carrierReadings.fanIn={state:ok}`：0.19.0 已有 `driver log --kind worker --json`，Fan-in 是真读数（如实记录，未硬算成不可用）。
- 面板表现：Tests 卡写 `verb-unavailable — <reason>` 且不画 "No suite running" / "No suite rounds recorded"；Fan-in 卡照常画时间线。该行为由 `QuayPanel.test.tsx` 新增用例断言（读数非 `ok` 时写出 state 与 reason，三条空态文案都不在 DOM）。
- 页面实拍：本 worktree 没有可用的隔离页面实例（DoD 明确部署由用户执行），本次未做浏览器截图；UI 腿以组件测试 + 上面的真实 snapshot 读数为准。

耗时对比（同一进程内交替 `forceRefresh`，主 checkout 项目，3 轮）：
- develop 构建：1298 / 1274 / 2228 ms。
- 本分支构建：1409 / 1287 / 1280 ms。
- 两者相当（约 1.3s，差异在噪声内）。原先 CloudCLI 本地读的三份载体实测为：`verification-round.jsonl` 120,333,710 字节、`worker-outcome.jsonl` 6,214,727 字节、`full-suite-state.json` 414 字节；现在 CloudCLI 不再打开它们。quay 侧 `suite` 自己报告 `carrier.rounds={bytesRead:1310720,exhausted:false}`，即它在自己进程内做有界尾部读取——成本归 quay，不再由 CloudCLI 承担（账本实测 120MB，不是 Proposal 里写的 89MB）。
- 附带读数：develop 构建的 `tests.recentRounds[0]` 是 `round=1385（2026-10-22T17:04:37Z）`，同一时刻动词给的是 `round=1684（2026-10-27T17:17:16Z）`——旧的有界尾部读取读到的不是最新一轮；切到动词后一致。

- 该轴仍暗,理由:本任务只把 Tests/Fan-in 的取数从本地载体文件切到 quay 只读动词，未新增模块边界或文档，本轮未取 archguard 读数。

## 本轮修复（2026-10-28，worker 第二轮）

上一轮 exited-not-landed 的两个红都是本任务引入的真红（机械 delta-relatedness 的 UNRELATED 是误判：两条判据都不直接 import 本任务的文件，但都数整个仓库的读数）：

- `server/shared/tests/architecture-ratchet.test.ts`：本任务让三个基线内文件变长——`server/shared/types.ts` 5144→5168、`src/shared/types.ts` 4566→4590（两侧手抄的 `QuayCarrierReading` + `carrierReadings`），`src/modules/quay/QuayPanel.tsx` 1120→1176（`CarrierReadingLine` 与两张卡的非 ok 分支）。按基线 note 自带的 AC-394 RECORDED CHANGE 格式按实测值重录这三条并写明为何增加是本改动的诚实形态；其余条目一个未动（本轮读数只有下降项）。
- `server/shared/tests/quay-test-script.test.ts`：该判据把「收集到的 server 测试文件数」写成字面量。本任务新增 `server/modules/quay/tests/quay-suite-fanin-reader.test.ts` 使其 459→460，故 `known=3 unknown=456→457`、`known=1 unknown=458→459`，注释同步记录是本任务加的这条文件。

复验（均在本 worktree 内，develop 已再次合入）：
- `npx tsx --tsconfig server/tsconfig.json --test server/shared/tests/architecture-ratchet.test.ts` → 6 pass / 0 fail（AC1–AC5 + duplicates 全绿）。
- `npx tsx --tsconfig server/tsconfig.json --test server/shared/tests/quay-test-script.test.ts` → 14 pass / 0 fail。

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
- server/shared/tests/architecture-ratchet.baseline.json
- server/shared/tests/quay-test-script.test.ts
- tasks/gap-quay-tests-fanin-read-via-suite-verb-and-driver-log.md

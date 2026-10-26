---
id: gap-quay-fleet-cli-runner-consolidation
title: quay fleet CLI 管道收敛：4 份 defaultExecFile、4 份 parseJsonObject、2 份
  canonicalPath/run 与重复导出的类型收进 quay-fleet-cli.ts
status: done
labels:
  - gap
parent: null
children: []
extra:
  schema: execution
---
## Proposal

<!-- dedup-ref --> 2026-10-26 架构复查第二批第 3 条（重复代码家族之一）。依据是 ArchGuard 当天对 server scope 的重复检测：默认阈值下 `defaultExecFile` 一组可省 63 行；低阈值下 `parseJsonObject` 一组可省 50 行。

### 现状（2026-10-26 实测，均在 `server/modules/quay/`）

调用 quay-fleet CLI 的四个文件各自带一套相同的管道：
- `defaultExecFile`（execFile 的 Promise 包装，加超时/ENOENT/失败分类）：`quay-fleet-locator.ts:151`、`quay-fleet-project-id.ts:148`、`quay-fleet-registry.ts:48`、`quay-initiatives.ts:70`，四份结构相同。
- `parseJsonObject`：`quay-fleet-locator.ts:247`、`quay-fleet-project-id.ts:183`、`quay-fleet-registry.ts:113`、`quay-initiatives.ts:253`。
- `canonicalPath`：`quay-fleet-project-id.ts:171`、`quay-fleet-registry.ts:125`。
- `run`（解析 bin 路径→找不到时返回固定错误→执行）：`quay-fleet-registry.ts:160` 与 `quay-initiatives.ts:487` 相同。
- 类型 `QuayFleetCommandResult`/`QuayFleetExec` 在 `quay-fleet-registry.ts:30,40` 与 `quay-initiatives.ts:53,62` 各导出一份；`QuayFleetExecError` 声明了 4 次；`QUAY_FLEET_TIMEOUT_MS`/`QUAY_FLEET_MAX_OUTPUT_BYTES` 声明了 3 次，其中 initiatives 的输出上限是 2 MiB，其它是 1 MiB。

后端标准要求两处以上使用的类型与工具只定义一次，这里没做到。

### 改法

新增 `server/modules/quay/quay-fleet-cli.ts`（在既有目录内）：
- 导出唯一的 `QuayFleetCommandResult`、`QuayFleetExec` 类型；
- `defaultQuayFleetExec`（即原 `defaultExecFile`，错误文案逐字保留）；
- `parseFleetJsonObject`；`canonicalFleetPath`；
- `createQuayFleetRunner({ resolveBinPath, exec, timeoutMs, maxOutputBytes })`，返回 `run(args)`。

四个文件删除本地副本改为导入。initiatives 继续传 2 MiB 的输出上限，其它保持 1 MiB——行为逐字不变。`quay-fleet-locator.ts` 自有的 `QuayFleetCliExec` 签名若与 `QuayFleetExec` 一致就合并，不一致则保留并在注释中说明差异。

`server/modules/observation/project-truth.producer.ts` 的 `parseDeployDocument` 属于另一个模块，不在本任务范围内。

### 导入环预算（AC-394）

只在 `modules/quay` 目录内移动代码，不新增目录。新文件只 import `node:*`、`server/shared/**` 和本目录；不得新增指向其它 `server/modules/**` 的边。基线 JSON 与测试文件不改。

## AC

- [x] 副本清零：`grep -nE "^(const defaultExecFile|function parseJsonObject|function canonicalPath)\b" server/modules/quay/quay-fleet-locator.ts server/modules/quay/quay-fleet-project-id.ts server/modules/quay/quay-fleet-registry.ts server/modules/quay/quay-initiatives.ts` 无输出。
- [x] 类型唯一：`grep -rnE "^export type (QuayFleetCommandResult|QuayFleetExec) " server/modules/quay --include='*.ts' | grep -v '/tests/'` 只命中 `quay-fleet-cli.ts` 的两行；`grep -cE "^(export )?type QuayFleetExecError" server/modules/quay/*.ts | awk -F: '{s+=$2} END{print s}'` 输出 ≤ 1。
- [x] 常量唯一：`grep -nE "^(export )?const QUAY_FLEET_(TIMEOUT_MS|MAX_OUTPUT_BYTES)" server/modules/quay/*.ts` 只命中 `quay-fleet-cli.ts`；initiatives 的 2 MiB 上限以调用参数传入，`grep -n "2 \* 1024 \* 1024" server/modules/quay/quay-initiatives.ts` 命中。
- [x] 新判据：`npx tsx --tsconfig server/tsconfig.json --import ./scripts/undici-blocked-ports-preload.mjs --test server/modules/quay/tests/quay-fleet-cli.test.ts` exit 0，覆盖 exec 成功、超时（`killed`）、ENOENT、非零退出四种分类的错误文案逐字与迁移前一致，以及 runner 在 bin 找不到时的固定错误文案。
- [x] 行为不回归：`npx tsx --tsconfig server/tsconfig.json --import ./scripts/undici-blocked-ports-preload.mjs --test server/modules/quay/tests/quay-fleet-locator.test.ts server/modules/quay/tests/quay-fleet-project-id.test.ts server/modules/quay/tests/quay-fleet-summary.test.ts server/modules/quay/tests/quay-initiatives.test.ts server/modules/quay/tests/quay-uri-resolve.test.ts` exit 0。
- [x] 导入环预算不变：`npx tsx --tsconfig server/tsconfig.json --test server/shared/tests/server-import-cycle-budget.test.ts` exit 0，且 `git diff --quiet "$(git merge-base develop HEAD)" -- server/shared/tests/server-import-cycle-budget.baseline.json server/shared/tests/server-import-cycle-budget.test.ts` exit 0。
- [x] 静态检查：`npx tsc --noEmit -p server/tsconfig.json` exit 0；`npx oxlint server/modules/quay` exit 0。

## DoD

用 `npm run build:server` 的 dist 起隔离实例，对本机真实安装的 quay-fleet 走三条真实调用路径并贴出读数：
- `GET /api/quay/fleet-summary`；
- 驾驶舱 initiatives 读数接口（`/api/quay/initiatives` 一类）；
- 一个会话的 fleet「对人接口会话」pin 读取。

再把 `QUAY_FLEET_BIN` 指向一个不存在的路径重启该隔离实例，贴出同一接口返回的「not found」错误文案，证明与迁移前逐字一致。

注：上列「未改动」类判据与 develop 的 merge-base 比较，覆盖已提交与未提交的改动；与 HEAD 比较在提交后恒为空，会真空通过。

## Touches

- server/modules/quay/quay-fleet-cli.ts (new)
- server/modules/quay/tests/quay-fleet-cli.test.ts (new)
- server/modules/quay/quay-fleet-locator.ts
- server/modules/quay/quay-fleet-project-id.ts
- server/modules/quay/quay-fleet-registry.ts
- server/modules/quay/quay-initiatives.ts
- server/modules/quay/tests/quay-initiatives.test.ts
- server/shared/tests/quay-test-script.test.ts
- scripts/suite-duration-baseline.tsv
- tasks/gap-quay-fleet-cli-runner-consolidation.md
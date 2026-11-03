---
id: gap-quay-test-script-runner-self-overhead
title: 降低 Quay 测试脚本自测开销并刷新 suite duration 基线
status: ready
labels:
  - gap
parent: null
children: []
extra:
  schema: execution
---
## Proposal

最新记录显示，`quay-test-script.test.ts` 在 round 1924 用时 93.7s，最近 12 轮约 91.8–98.8s；它多次同步启动 `scripts/test.sh`，重复收集约 507 个 server 测试并重跑调度。真实 CLI 合约哨兵约 14–15.5s，来自四个真实场景和长工具进程清理，保留其合约与清理语义作为独立重型判据。此任务降低 Quay 自测自身开销，并刷新长任务调度数据。

<!-- dedup-ref -->相关但机制不同：`gap-suite-server-dispatch-longest-first-and-parallel-static-stages` 已落地生产调度；本任务优化该调度机制的自测成本和排序实现评估，不重复其功能。真实 CLI 清理已有 `gap-cli-contract-sentinel-sleep2-bash-child-leaks-into-suite-leak-sweep` 判据，本文不改 CLI 场景时长或等待语义。

## Plan

1. 合并 AC2/AC4 重复的完整排序与集合检查；AC3 多个 fail-open 案例共享一次预期文件列表计算，同时各自继续验证独立输入与输出。
2. 将大列表算法案例改为可注入的合成文件清单 fixture；真实 `find` 收集与 positional 参数只保留少量入口集成案例。fixture 注入只能在 order 测试接缝生效，普通测试运行仍从仓库收集文件。
3. 在相同的约 507 项输入上评估当前匹配/排序路径与候选实现，记录可复跑的耗时读数，并以排序结果逐字节一致为正确性门槛；采用有证据支持的实现，若没有稳定收益则保留当前实现并记录结论。
4. 从最新绿色 fan-in 的 `.quay/verification-round.jsonl` 重生成 `scripts/suite-duration-baseline.tsv`，校验来源轮次、覆盖率与长文件排名。不要调整真实 CLI 哨兵的超时、工具时长或清理逻辑。

## AC

- [x] 执行 `npx tsx --tsconfig server/tsconfig.json --import ./scripts/undici-blocked-ports-preload.mjs --test server/shared/tests/quay-test-script.test.ts` 退出 0；合并检查后，AC2 的降序/未知文件保序/缺失路径断言与 AC4 的集合不变/positional 顺序断言仍全部执行。
- [x] AC3 的缺失、空、不可解析、不可读（适用时）和有效 baseline 案例均逐项运行；测试只计算一次预期完整清单，且每个案例仍断言退出码、stderr 判词与 stdout 字节级结果。
- [x] order 接缝下用合成清单运行大列表 fixture；同一 fixture 覆盖有效、失效 baseline 与重复/缺失路径边界，普通未设置 fixture 的 order 调用仍与仓库 `find server -name '*.test.ts' -o -name '*.test.js' | grep -v node_modules | sort` 结果一致，positional 文件仍按调用顺序输出。
- [x] 对同一约 507 项输入至少各运行三次当前排序路径和候选路径；在任务验证记录中贴出可复跑命令、每次耗时、中位数和逐字节结果比较，并据此保留或替换实现；不可只凭代码复杂度推断更快。
- [x] 从最新绿色 round 生成 duration baseline 后，执行文件内记载的再生成命令并与提交内容比较无 diff；`server/shared/tests/quay-test-script.test.ts` 中覆盖率、数据格式、来源轮次和 top-8 守卫通过。
- [x] 执行 `npx tsx --tsconfig server/tsconfig.json --import ./scripts/undici-blocked-ports-preload.mjs --test server/modules/providers/tests/claude-resident-cli-contract.test.ts` 退出 0，四场景真实 CLI 轨迹与 tamper 自检仍通过，且测试内的 50 秒进程预算守卫未改。

## DoD

真实落地以本仓库一次绿色 Quay fan-in 为准：在最新 `.quay/verification-round.jsonl` 记录中核实更新后的 baseline 已实际驱动 server longest-first 派发，所有测试文件仍被执行且 per-file 结果完整；记录 Quay 自测文件耗时、server 阶段跨度与 suite 总墙钟耗时，并和改动前 round 1924 的 93.7s / 286.8s 对照。仅有 fixture、基线文件或单文件测试通过不算完成；若整套耗时受其他阶段或宿主负载影响，须同时贴出 per-file 区间和实际派发顺序，不能把相关性写成算法提速结论。

## Verification (2026-11-04, worktree gap-quay-test-script-runner-self-overhead, 提交 fb0ce6f3c)

### AC1 — 自测文件退出 0，合并后的五条断言仍全部执行

```
npx tsx --tsconfig server/tsconfig.json --import ./scripts/undici-blocked-ports-preload.mjs --test server/shared/tests/quay-test-script.test.ts
→ exit 0；tests 14 / pass 14 / fail 0 / duration_ms 76768.6（隔离态串行，同日同宿主）
```

合并后的用例 `AC1 (merged AC2+AC4): …` 一次跑完并仍逐条断言：known 头三条按 duration 降序（`out.slice(0,3)`）、未列文件按收集序（`out.slice(3)` 与 `collected - known` 深比较）、baseline 列出但不存在于收集的路径被丢弃（`!out.includes(gone)`）、集合不变（`out.length === collected.length` 且双向排序集相等）、positional 两文件按调用顺序逐字输出。旧的 AC2/AC4 两个用例的完整排序与集合检查不再各跑一次（原先 2 次全收集 + 1 次 positional，现 1 次全收集 + 1 次 positional）。

`known/unknown` 读数不再钉字面量：期望尾段由同一条收集流水线现算，`known=3 unknown=${rest.length}` 动态匹配 —— 兄弟任务新增测试文件不会再因计数漂移判红（旧文件里 370 行的计数变更注释一并删除）。

### AC2 — fail-open 逐例运行，预期清单只算一次

`tempDir` 内写一份**非字母序**的收集清单（zzz/aaa/mmm/bbb 四行），`const expected = manifest.join('\n') + '\n'` 只计算一次，随后逐例运行：

- missing（文件不存在）、empty（0 字节）、unparseable(non-numeric duration: `abc\t…`)、unparseable(missing path: `123`) 四例，另加 unreadable（mode 000；root 下按已有的 `test -r` 探针跳过并打印 diagnostic）与 valid baseline 一例；
- 每例各自断言：`r.status === 0`、stderr 有且仅有一条 `test.sh: server dispatch order=alphabetical reason=…`（valid 例为 `order=longest-first … known=1 unknown=3`）、stdout 与该预期清单逐字节相等。

valid 例的 baseline 里同一路径出现两次（9000 与 7000）——重复行只派发一次，首次出现的 duration 生效，输出 4 行无重复。

### AC3 — 合成大清单驱动 order 接缝（有效/失效 baseline、重复/缺失路径、真实收集、positional）

同一份 508 行 manifest（507 条唯一 `server/synthetic/unit-NNN.test.ts`，**刻意非字母序**，另加 1 条重复行）作为 `QUAY_TEST_SERVER_FILES_FIXTURE`：

- 有效 baseline：6 条 known（其中 1 条 baseline 重复行）+ 1 条 manifest 中不存在的路径；断言头 6 行按 duration 降序、其余 501 行保持收集序、缺失路径被丢弃、总行数仍 507（重复行未变成两个文件）、集合与 507 条唯一路径相等、派发行 `known=6 unknown=501`；
- 失效 baseline（`not-a-baseline-line`）：stdout 与收集序逐字节相等，判词 `order=alphabetical reason=…`；
- 不设 fixture 的普通 order 调用（baseline 指向不存在的文件）：stdout 与仓库 `find server -name '*.test.ts' -o -name '*.test.js' | grep -v node_modules | sort` **逐字节相等**（默认 test.sh 用例从未被 fixture 顶替）；
- positional 两个文件（字母序后者在先）：输出恰为给定顺序。

fixture 接缝的生效面被钉死在 `QUAY_TEST_STOP_AFTER=order`（test.sh 中条件与 `find` 分支并列，普通运行恒走 `find`）。

### AC4 — 同一 ~507 项输入上，当前实现 vs 候选实现各 3 次

```
BASE=$WT/scripts/suite-duration-baseline.tsv      # 两侧同用这份 507 行基线
for root in /data/home/yale/work/claudecodeui "$WT"; do   # 前者 scripts/test.sh = 基线提交 02868184a（当前实现），后者 = fb0ce6f3c（候选）
  for n in 1 2 3; do
    t0=$(date +%s%N)
    ( cd "$root" && QUAY_TEST_STOP_AFTER=order QUAY_SUITE_DURATION_BASELINE="$BASE" bash scripts/test.sh > out.$n 2> err.$n )
    echo "$root $(( ($(date +%s%N)-t0)/1000000 ))ms"
  done
  grep -h 'server dispatch' err.*   # 两侧均 known=507 unknown=0
done
cmp old/out.$n new/out.$n           # 逐字节
```

order 接缝端到端读数（同日在跑 fan-in，宿主有负载，故交错各跑 3 次）：

| run | 当前实现 (02868184a) | 候选实现 (fb0ce6f3c) |
| --- | --- | --- |
| 1 | 5683ms | 3488ms |
| 2 | 5512ms | 3492ms |
| 3 | 5496ms | 3407ms |
| 中位数 | 5512ms | 3488ms |

3/3 次 stdout **逐字节相同**：507 行，sha256 两侧均为 `41f69da4531e…`；派发行两侧同为 `order=longest-first … known=507 unknown=0`。

隔离的算法读数（把两版函数体原样抽出，喂同一 507 文件清单 × 507 行基线）：当前实现 parse 17ms + known 扫描 999–1052ms + unknown 扫描 893–900ms ≈ **1.92–1.94s**；候选 `map_total` **21–22ms**，输出逐字节相同（507 行）。据此**替换**实现（不是按复杂度推断）：候选在两次独立测量里都稳定快两个数量级且结果逐字节一致；若读数无稳定收益则保留原实现。

### AC5 — 基线由 round 1924 重生成，再生成命令与提交内容无 diff

来源：`/data/home/yale/work/claudecodeui/.quay/verification-round.jsonl` 中最新绿色 round = **1924**（fail=0，pass=885，durationMs=286799，plannedFiles=507，startedAt 2026-11-03T14:13:10Z）。该轮 507 条 server per-file 行与当前 `find` 收集的 507 条**完全相同**（0 缺失、0 多余、0 重复）。

```
{ grep '^#' scripts/suite-duration-baseline.tsv; node -e '<文件内记载的那条 REGENERATE 命令>' /data/home/yale/work/claudecodeui/.quay/verification-round.jsonl; } > /var/tmp/regenerated.tsv
diff scripts/suite-duration-baseline.tsv /var/tmp/regenerated.tsv
→ REGENERATE: NO DIFF
```

文件内命令把来源轮次**钉住**（`r.round===1924`）而不是取「最新绿色」：ledger 每隔几分钟就多一轮绿色，取最新会让同一条命令每次重跑都打印不同字节，本文件就永远无法与自己的文档命令对账。头部同时写明来源轮次/计数/覆盖率与重钉方法。

文件内守卫（AC7 用例）全绿：格式 `^[0-9]+\tserver/\S+\.test\.(ts|js)$` 逐行匹配、覆盖率 507/507（≥90%）、header 含 `verification-round.jsonl` / `node -e` / `round 1924`、top-8 含 `voice-error-classification.false-forms.test.ts`（该轮第 2 名，48906ms）。新的 top-8 首行即本自测文件本身（93663ms）。

### AC6 — 真实 CLI 合约哨兵未改且仍通过

```
npx tsx --tsconfig server/tsconfig.json --import ./scripts/undici-blocked-ports-preload.mjs --test server/modules/providers/tests/claude-resident-cli-contract.test.ts
→ exit 0；tests 2 / pass 2 / fail 0 / duration_ms 18193.8
```

四场景 `contract.idle / later-drain / next-fold / interrupt` 全部 `=ok`；tamper 自检四条合成轨迹全部 `=violated`；`[budget] budget=50000ms elapsed=12757ms exit=0` 仍是 50 秒预算守卫，该文件本次无任何改动（`git diff --stat` 不含它）。

### DoD 读数（落地前可见部分）

本会话不跑全量 suite（fan-in 的合并闸），落地后由 driver 的 fan-in round 提供最终读数，届时核对：该轮 perFile 里 `server/shared/tests/quay-test-script.test.ts` 的 durationMs、server 阶段 span（`phases`）与 `durationMs` 总墙钟，对照 round 1924 的 93.7s / 286.8s。

已测且可复算的部分：

- 自测文件整体（隔离态串行，同日同宿主）：改动前 92.5s → 改动后 76.8s（−17%）；其中 4 个 dry 用例合计 9.7s、AC5/AC6 合计 9.4s、e2e 三例 11.7s 基本未动，原因是每次 `scripts/test.sh` 调用都付 ~2.4s 的 suite prelude（`suite-scope-check.sh` 扫描 1386 个任务文件），共 ~17 次调用——这部分不在本任务 Touches 内，未改。
- 每次全收集调用的 server 调度本身：1.92–1.94s → 21–22ms（上表）。
- 派发顺序：候选实现的 order 接缝输出与当前实现逐字节相同（507 行），生产 suite 的派发顺序不变，服务端阶段跨度因此只可能受调度开销（每轮约 −1.9s）与宿主负载影响，不能被写成算法提速带来的跨度变化。

- 该轴仍暗,理由:本任务只改 Quay 自测入口脚本、自测判据与耗时基线数据,不新增或移动模块与依赖关系,架构图读数没有可比对象

## Touches

- scripts/test.sh
- scripts/suite-duration-baseline.tsv
- server/shared/tests/quay-test-script.test.ts
- server/modules/providers/tests/claude-resident-cli-contract.test.ts
- tasks/gap-quay-test-script-runner-self-overhead.md
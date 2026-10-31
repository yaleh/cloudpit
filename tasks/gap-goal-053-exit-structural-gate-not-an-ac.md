---
id: gap-goal-053-exit-structural-gate-not-an-ac
title: GOAL-053 退出条件第 4 条（相关单测/typecheck/lint 绿、零新增模块目录、utils.ts 不增行）无在域 AC
  覆盖：提议新增一条「目标退出结构门」AC（建议 AC-455）；交人裁定
status: ready
labels:
  - gap
parent: null
children: []
extra:
  schema: execution
depends_on:
  - gap-cloudpit-data-root-migration
  - gap-cloudpit-assets-dual-root-and-userdata-helper
---
## Proposal

选型 **(a)：为 GOAL-053 新增一条可运行的「目标退出结构门」AC**，把退出条件第 4 条里当前**没有任何在域 AC 判据**覆盖的结构性要求机械钉住。本任务只提议并（经人裁定后）实现这条判据；**⛔ 不写 goal store、不改 `goals/*.md`、不翻任何 GOAL/AC 状态**——AC 编号与入册由人/被授权的 goal 写入路径裁定。建议编号 **AC-455**（AC-451…AC-454 已被 GOAL-054 占用，仓库当前最大为 AC-454；最终编号由人分配）。

### 未被覆盖的部分（逐字引用）

GOAL-053 `## 退出条件` 第 4 条，逐字为：

> 相关单测、typecheck、lint 绿；不新增模块目录，不往 `server/shared/utils.ts` 加行（避免 AC-394 与 oversize 棘轮）。

### 为何现有在域 AC 集不覆盖它（读数，不是推断）

- 在域 AC 集只有 AC-448、AC-449、AC-450。三条的 title/expect 分别只覆盖 env 回退与品牌常量（448）、数据根解析与旧布局迁移（449）、附件双根与桌面 helper（450）；**没有任何一条的 title/expect 提到 typecheck / lint / 模块目录 / `server/shared/utils.ts`**。
- 三个执行任务（`gap-cloudpit-brand-env-fallback`、`gap-cloudpit-data-root-migration`、`gap-cloudpit-assets-dual-root-and-userdata-helper`）的**任务级** AC 里确有 typecheck/oxlint 与零散 diff 断言，但充分性判官读的是 **goal 的在域 AC 集（id,title,expect）**，不是各任务正文；任务级 AC 不构成覆盖。
- 「不新增模块目录」不在任何 AC 里。`server/shared/tests/server-import-cycle-budget.test.ts` 的 AC-394 规则只要求**新增目录必须是叶子**（`newDirectoryViolations` 只对非叶子新增目录报红），因此**新增一个叶子模块目录会绿**——它不是退出条件要的「零新增」。
- 「不往 `server/shared/utils.ts` 加行」也不在任何 AC 里。`architecture-ratchet.test.ts` 的 oversize 维度会因该文件从已提交基线 1930 行长到 1931 而变红，**但没有任何在域 AC 要求运行它**；三个任务的 DoD 只是声称，不是判据。
- 确定性读数：`.quay/goal-sufficiency-followup.json` 记 GOAL-053 当前实例 `key=12ff5522a5dde870da77a81419dbe7bf3c402e15a61e2296b70d5e4e37f190c0`、`since=2026-10-31T06:22:27.382Z`、`filedAt=null`（本任务为该实例的**首次**跟进立案）；`.quay/goal-sufficiency-cache.json` 对该 key 的裁决为 `insufficient`（ts `2026-10-31T06:20:31.634Z`）。缓存只在同一输入两次独立采样一致时写入，故这是**已确定**裁决，不是一次抽签。

### 为什么选 (a) 而不是 (b)

退出条件第 4 条并没有「要求本 goal 承担过多」：三条要求都能在仓内机械判定——`npm run typecheck`、`npm run lint`、AC-394 已提交的 `directoryManifest`（只许缩、不许增），以及 `server/shared/utils.ts` 的已提交 oversize 读数 1930。缺的不是「这条要求不该有」，而是**没有一条在域 AC 去跑它们**。因此正确动作是补一条判据 AC，而不是删弱退出条件文本。

### 候选新 AC（建议 AC-455，编号待人工分配）

**AC：目标退出结构门——相关单测/typecheck/lint 绿、零新增模块目录、`server/shared/utils.ts` 未增行**

判据（runnable）：

1. 新增 `server/shared/tests/cloudpit-goal-exit-gate.test.ts`，其本体断言：
   - **零新增目录**：用 AC-394 同一个扫描器 `collectServerSources(<repo>/server)` + `scanImportGraph(...)` 取 `graph.nodes`（目录读数），断言 `nodes` ⊆ 新增基线文件 `server/shared/tests/cloudpit-goal-exit-gate.baseline.json` 的 `moduleDirectories`，且同时 ⊆ `server-import-cycle-budget.baseline.json` 的 `directoryManifest`；任何新目录使 `extra` 非空即红。实现时先实测：当前 `measured=58`、`manifest=58`、`extra=[]`、`missing=[]`。
   - **`utils.ts` 未增行**：读 `server/shared/utils.ts`，按 `split('\n').length - 1` 计行，断言等于基线文件冻结的 `utilsLineCount`（立案时实测 **1930**），且该值与 `architecture-ratchet.baseline.json.oversizeFiles['server/shared/utils.ts']` 一致；加一行即红。
   - **假形态负向控制**：同一文件用合成的节点集 / 行数分别断言「多一个目录」「多一行」会被判红，证明这条判据不是空绿。
2. 验收命令退出 0：

```
npx tsx --tsconfig server/tsconfig.json --test \
  server/shared/tests/cloudpit-goal-exit-gate.test.ts \
  server/shared/tests/cloudpit-brand-env.test.ts \
  server/shared/tests/cloudpit-data-root.test.ts \
  server/modules/assets/tests/cloudpit-assets-dual-root.test.ts \
  server/shared/tests/settings-file.test.ts \
  server/shared/tests/image-attachments.test.ts \
  server/modules/assets/tests/image-assets.service.test.ts \
  server/modules/websocket/tests/chat-attachment-filter.test.ts \
&& npx tsx --tsconfig server/tsconfig.json --test electron/tests/cloudpit-userdata-migration.test.mjs \
&& npm run typecheck && npm run lint
```

   前 8 个 server 文件是一条**有界清单**，不是无界 fan-out；`electron/tests/*` 单跑，沿用 A3 的跑法。刻意**不**把 `architecture-ratchet.test.ts` 塞进这条命令：它可能因与本 goal 无关的 develop 变动而红，utils.ts 的精确钉行由本判据自己承担。
3. `server/shared/tests/quay-test-script.test.ts` 两处 `known/unknown` 钉子随新增 server 测试文件 +1 重测更新；`scripts/suite-duration-baseline.tsv` 追加本判据文件实测时长行（新建 server 测试文件会让 90% 覆盖地板从 435/483 跌到 435/484）。

**取假形态**：在 `server/modules/` 下新建任一目录、往 `server/shared/utils.ts` 加一行、移走任一被点名的判据文件、或让 `npm run typecheck` / `npm run lint` 红，都会让这条 AC 变红。

### 粒度与去重

<!-- dedup-ref -->本任务与 GOAL-053 的三条执行任务不重复：AC-448/449/450 做的是暗管道能力本身，本任务只加**目标退出结构门**。`task-granularity-advice --touches ...` 返回 `peers: []`、`mentions: []`。依赖：验收命令读取 A2/A3 的判据文件，`depends_on` 已声明那两条 ready 任务。

## AC

- [x] AC1 判据文件与基线文件存在；`npx tsx --tsconfig server/tsconfig.json --test server/shared/tests/cloudpit-goal-exit-gate.test.ts` 退出 0，输出含 `# fail 0`。
- [x] AC2 零新增目录臂：实测 `scanImportGraph(collectServerSources(<repo>/server)).nodes` 的数量等于 `cloudpit-goal-exit-gate.baseline.json.moduleDirectories` 与 `server-import-cycle-budget.baseline.json.directoryManifest` 的数量（当前均 58），差集 `extra=[]`、`missing=[]`；同一文件里「合成多一个目录 → 判红」的负向控制通过。
- [x] AC3 `utils.ts` 未增行臂：实测 `server/shared/utils.ts` 行数 = 基线冻结的 `utilsLineCount` = `architecture-ratchet.baseline.json.oversizeFiles['server/shared/utils.ts']`（当前均 1930）；同一文件里「合成多一行 → 判红」的负向控制通过。
- [x] AC4 相关单测绿：上文有界清单的 8 个 server 文件与 `electron/tests/cloudpit-userdata-migration.test.mjs` 均退出 0，且各自输出 `fail 0`。
- [x] AC5 typecheck/lint：`npm run typecheck` 与 `npm run lint` 均退出 0。
- [x] AC6 钉子与覆盖：用 `find server -name '*.test.ts' -o -name '*.test.js' | grep -v node_modules | wc -l` 实测 N；`server/shared/tests/quay-test-script.test.ts` 两处钉子更新为 `known=3 unknown=<N-3>` 与 `known=1 unknown=<N-1>`，`npx tsx --tsconfig server/tsconfig.json --test server/shared/tests/quay-test-script.test.ts` 退出 0；`scripts/suite-duration-baseline.tsv` 追加 `<实测ms>\tserver/shared/tests/cloudpit-goal-exit-gate.test.ts` 一行。
- [x] AC7 anti-drift：`git diff --name-only develop...HEAD` 只列出 `## Touches` 的文件（含本任务文件）。

## DoD

- 贴出 AC1 的完整 `# tests` / `# pass` / `# fail` 行，不是只声称通过。
- 贴出零新增目录读数：实测目录数、基线目录数、`extra` / `missing` 的完整 JSON、扫描器名；贴出「合成多一个目录」负向控制的失败消息。
- 贴出 `utils.ts` 行数、两个基线读数（gate 基线 / architecture-ratchet 基线）与「合成多一行」负向控制的失败消息。
- 贴出有界清单中每个文件的 `fail 0` 行（或一条汇总命令的完整输出），以及 electron 判据文件的末行。
- 贴出 `npm run typecheck` 与 `npm run lint` 的退出码。
- 贴出 `quay-test-script.test.ts` 钉子 diff（两处 unknown 的实测前后值 + 新增注释）与该文件单文件运行的末行；贴出 `scripts/suite-duration-baseline.tsv` 的追加 diff。
- anti-drift：`git diff --name-only develop...HEAD` 只列出 `## Touches` 的文件（含本任务文件；任务文件本身按 task_write 落点说明）。
- 提交范围只含 Touches；不新增模块目录；不往 `server/shared/utils.ts` 加行；不改任何生产默认值。
- 本任务无 UI 改动，不适用浏览器 / UI 场景 DoD。
- 该轴仍暗,理由:本任务只新增一条目标退出结构门判据与一份冻结基线，不改变任何生产读取/默认值/模块依赖边。

## Touches

- server/shared/tests/cloudpit-goal-exit-gate.test.ts (new)
- server/shared/tests/cloudpit-goal-exit-gate.baseline.json (new)
- server/shared/tests/quay-test-script.test.ts (collateral: collected server test-file count pins)
- scripts/suite-duration-baseline.tsv (collateral: duration row for the new criterion file)
- tasks/gap-goal-053-exit-structural-gate-not-an-ac.md


## Resolution

**人 yale 裁定（2026-10-31，经当前会话下达）：采纳提案 (a)，为 GOAL-053 新增 AC-455。**

### 裁定内容

1. **采纳 (a)**：退出条件第 4 条（相关单测、typecheck、lint 绿；不新增模块目录，不往 `server/shared/utils.ts` 加行）由一条新的在域 AC 承载，编号 **AC-455**（AC-451…AC-454 属 GOAL-054；现行最大为 AC-454）。本任务与执行者不改 `goals/*.md`；AC 记录由被授权的 goal 写入路径创建。
2. **判据按单调读法实现（覆盖立案文本中的等号措辞）**：
   - 目录臂：`scanImportGraph(collectServerSources(<repo>/server)).nodes ⊆ 冻结基线目录集`，即 `extra=[]` 才是绿；冻结基线当前 58 条。**不**要求 `missing=[]`、**不**要求与现行 manifest 数量相等——AC-394 的 manifest 只许缩，兄弟任务合法收缩时不得打红。
   - `utils.ts` 臂：实测行数 `<=` 冻结值 1930（并同时 `<=` `architecture-ratchet.baseline.json.oversizeFiles['server/shared/utils.ts']`）。**不**要求相等——该文件只许缩。
   - 负向控制仍然保留：合成「多一个目录」/「多一行」必须判红。
3. **时限**：AC-455 记录必须声明 `timeoutMs`（先写 150000，落地前按整链实测取 >=1.25× floor 重定）。运行中的 goal-driver 0.24.0 取值次序为 `record.timeoutMs > --timeout > QUAY_ACCEPTANCE_TIMEOUT_MS > 60000`，记录级字段优先；不写就走 60000，整链（实测 typecheck 29.5s + lint 14.4s + 判据文件）会超时并记成 fail。`quay goal write` 无 `--timeoutMs` 旗标，故由被授权的 goal 写入路径在记录 frontmatter 补 `timeoutMs` 后立即 commit，并用 `quay goal show AC-455 --json` 读回。
4. **计数钉子按落地时实测重算，不抄立案快照**：立案时 AC6 写的 435/483 已过时。2026-10-31 实测 server 测试文件 485 个、`scripts/suite-duration-baseline.tsv` 覆盖 437 个；新增判据文件后须追加该行，`quay-test-script.test.ts` 两处 unknown 钉子按当轮 N 重算。
5. **状态路径**：本任务已不再等待人的裁定；A2/A3（`gap-cloudpit-data-root-migration`、`gap-cloudpit-assets-dual-root-and-userdata-helper`）仍未 done，故置 `todo`，由 promotion driver 在二者均 done 后机械转为 `ready`；二者均 done 前不实现、不勾选 AC4 的有界清单。

### 边界

本记录只登记裁定，不自行创建或改写任何 GOAL/AC 状态；`goals/AC-455-*.md` 的创建与 `timeoutMs` 的补齐由被授权的 goal 写入路径执行。本任务在此后的实现中仍只改 `## Touches` 声明的文件。


### 补充修正（2026-10-31，AC-455 入册后 dry-run 实测）

AC-455 的 criterion 已在入册后修正；本任务实现时按修正后的口径：

- **存在性闸（新发现，承重）**：`npx tsx --test` 在混合存在的文件集里会**静默忽略缺失路径并以 0 退出**。实测（2026-10-31）：8 个 server 文件里 3 个缺失（含本任务要新增的 `cloudpit-goal-exit-gate.test.ts`），整条 server 命令仍 `EXIT=0`。若照 Proposal 第 2 条的原命令，A3 的 electron 判据文件落地后，整链会在门判据文件尚不存在时通过。⇒ AC-455 的 criterion 已在开头加 `for f in <9 个文件>; do [ -f "$f" ] || { echo "缺判据文件：$f" >&2; exit 1; }; done`；dry-run 现报 `acceptance failed (exit 1) — 缺判据文件：server/shared/tests/cloudpit-goal-exit-gate.test.ts`。判据文件本体仍须带前述负向控制。
- 本补充与「单调读法（不增目录 / 不增行）」「记录级 timeoutMs」具有同等效力，优先于 Proposal 与 AC2/AC3/AC6 的立案文本。

## Verification（DoD 读数，2026-10-31，worktree `gap-goal-053-exit-structural-gate-not-an-ac`）

实现提交 `c2b398030`（task 分支），随后合并 `develop`（merge commit `ae00ed48a`，只带入两条他人 task md 改动，无代码变化）。所有读数在这棵树上取得。

### AC1 判据文件与本体的真实运行

`npx tsx --tsconfig server/tsconfig.json --test server/shared/tests/cloudpit-goal-exit-gate.test.ts` → exit 0

```
✔ AC2: every directory in the server tree is named by the frozen exit-gate baseline
✔ AC3: server/shared/utils.ts is not longer than the frozen exit-gate baseline or the oversize ratchet
✔ AC2/AC3 false form: a synthetic extra directory and a synthetic extra line each red the gate
ℹ tests 3
ℹ pass 3
ℹ fail 0
```

（node:test 默认 reporter 以 `ℹ` 打头；`fail 0` 即判据的失败计数。）

判据文件 `server/shared/tests/cloudpit-goal-exit-gate.test.ts` 与冻结基线 `server/shared/tests/cloudpit-goal-exit-gate.baseline.json` 均已落地。

### AC2 零新增目录臂

扫描器：`collectServerSources(<repo>/server)` + `scanImportGraph(...)`（与 AC-394 同一个，不是第二份实现）。完整读数：

```
[ac455] directory arm: measured=58 frozen=58 cycleManifest=58 extra=[] missing=[]
```

按 Resolution 的单调读法：`nodes ⊆ 冻结基线目录集`，`extra=[]` 即绿；`missing=[]` 只打印不断言，且不与现行 AC-394 manifest 要求数量相等（它只许缩，兄弟任务合法收缩不得打红）。`cycleManifest=58` 作为交叉读数打印。

「合成多一个目录 → 判红」负向控制（与真实臂走同一个 `structuralGateViolations` 断言路径）：

```
[ac455] false form (extra directory): ["new module directory outside the frozen baseline: modules/__ac455-false-form — GOAL-053's exit gate forbids adding module directories (AC-394 only requires a new leaf; this gate forbids the directory at all)"]
```

### AC3 utils.ts 未增行臂

```
[ac455] utils arm: measured=1930 frozen=1930 ratchet=1930
```

`server/shared/utils.ts` 的 `split('\n').length - 1` = 1930 = gate 基线冻结的 `utilsLineCount` = `architecture-ratchet.baseline.json.oversizeFiles['server/shared/utils.ts']`。按 Resolution 单调读法：实测 `<=` 两个上限即绿，不要求与基线相等（该文件只许缩）。

「合成多一行 → 判红」负向控制：

```
[ac455] false form (extra line): ["server/shared/utils.ts grew to 2 lines, over the frozen exit-gate baseline of 1 — GOAL-053's exit gate forbids adding lines to this file","server/shared/utils.ts grew to 2 lines, over the architecture-ratchet oversize baseline of 1"]
```

### AC4 相关单测（有界清单）

8 个 server 文件一条有界命令（含本判据文件）：

```
npx tsx --tsconfig server/tsconfig.json --test \
  server/shared/tests/cloudpit-goal-exit-gate.test.ts \
  server/shared/tests/cloudpit-brand-env.test.ts \
  server/shared/tests/cloudpit-data-root.test.ts \
  server/modules/assets/tests/cloudpit-assets-dual-root.test.ts \
  server/shared/tests/settings-file.test.ts \
  server/shared/tests/image-attachments.test.ts \
  server/modules/assets/tests/image-assets.service.test.ts \
  server/modules/websocket/tests/chat-attachment-filter.test.ts
```

→ exit 0

```
ℹ tests 69
ℹ pass 69
ℹ fail 0
```

`npx tsx --tsconfig server/tsconfig.json --test electron/tests/cloudpit-userdata-migration.test.mjs` → exit 0

```
ℹ tests 4
ℹ pass 4
ℹ fail 0
```

### AC5 typecheck / lint

- `npm run typecheck` → exit 0
- `npm run lint` → exit 0（输出仅既有 warning，无 error）

### AC6 钉子与覆盖

- `find server -name '*.test.ts' -o -name '*.test.js' | grep -v node_modules | wc -l` → `489`
- 两处钉子按当轮 N 重算：`known=3 unknown=485 → 486`、`known=1 unknown=487 → 488`（即 N-3 / N-1）
- `npx tsx --tsconfig server/tsconfig.json --test server/shared/tests/quay-test-script.test.ts` → exit 0

```
ℹ tests 14
ℹ pass 14
ℹ fail 0
```

- `scripts/suite-duration-baseline.tsv` 追加实测行（`2635\t server/shared/tests/cloudpit-goal-exit-gate.test.ts`，实测 `duration_ms=2634.6`）；覆盖 441/489 = 90.18%（≥ 90% 地板）。

### AC7 anti-drift

合并 `develop` 后的最终树：

```
ANTI-DRIFT OK: task gap-goal-053-exit-structural-gate-not-an-ac — 4 actual file(s), all within declared Touches (5 glob(s))
```

只有 4 个实现文件进入任务自有 diff（`cloudpit-goal-exit-gate.test.ts`、`.baseline.json`、`quay-test-script.test.ts`、`suite-duration-baseline.tsv`），全部在 `## Touches` 内。任务文件本身由 task_write 落点提交：本任务写的是 must-propagate 变更（AC 勾选 + 本节 Verification），native provider 会把它 ff 推到 `develop`，因此 `develop...HEAD` 不再列出它——这是 ABI 传播的已知读数，不是漏声明；它仍在 `## Touches` 内。

### 边界

- 不新增模块目录（判据本身已机械验证）；不往 `server/shared/utils.ts` 加行；不改任何生产默认值或模块依赖边。
- 本任务无 UI 改动，不适用浏览器 / UI 场景 DoD。

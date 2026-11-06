---
id: gap-ac459-criterion-stale-architecture-split-paths
title: AC-459 判据读架构 god-package 拆分前的旧路径：改读 render/ 包边界并保留 BroadcastChannel 不变式
status: ready
labels:
  - gap
parent: null
children: []
extra:
  schema: execution
goal_ac: AC-459
---
## Proposal

### 现场读数（2026-11-06，直接重跑判据）

AC-459 的 criterion 逐字运行：

```
npx tsx --tsconfig server/tsconfig.json --test electron/tests/cloudpit-runtime-identity-surfaces.test.mjs
```

结果 exit 1、tests 10 / pass 8 / fail 2。两条红都是 ENOENT：

```
✖ AC2: the live runtime identity surfaces are clean, and the scan is not vacuous
  Error: ENOENT: no such file or directory, open
  '.../src/modules/architecture/architectureChatBridge.ts'
    at readRepoFile (electron/tests/cloudpit-runtime-identity-surfaces.test.mjs:189)
✖ AC-459 expect: one BroadcastChannel name feeds both architecture surfaces
  Error: ENOENT: no such file or directory, open
  '.../src/modules/architecture/architectureChatBridge.ts'
```

判据文件共三处读旧路径：AC2 正臂第 217 行、BroadcastChannel 用例第 295 行、以及同一用例第 314 行的 `ArchitecturePanel.tsx`（第 217 行先 ENOENT，所以第三个尚未被跑到，修完前两处后会接着红）。

### 根因

`9c32497d1`（refactor(architecture): split god package into render/layout/dom leaves）把两个文件搬进 `src/modules/architecture/render/`：

- `architectureChatBridge.ts` → `src/modules/architecture/render/architectureChatBridge.ts`
- `ArchitecturePanel.tsx` → `src/modules/architecture/render/ArchitecturePanel.tsx`

判据仍逐字读取拆分前的旧路径，于是真红。活代码面本身没有旧名残留：对 `electron/ src/ scripts/ e2e/ AGENTS.md` 逐个 grep `cloudcli-desktop:`、`cloudcliDesktop`、`cloudcli-architecture`、`__cloudcliScenario` 全部零命中。这是「拆分把判据读数搬到包边界」的路径漂移，不是判据语义有错。

### 更早的修复为什么没保住

同 AC 的 `gap-ac459-criterion-stale-observation-uri-path`（done）只把 AC4 的 observation 副本从 `server/modules/observation/observation-uri.ts` 改到 `core/observation-uri.ts`，没有覆盖架构面的两处读数。架构拆分任务 `gap-routine-architecture-analysis-god-package-src-architecture` 的 Touches 写的是 `src/modules/architecture/**`（目录级），没有声明 `electron/tests/cloudpit-runtime-identity-surfaces.test.mjs`，于是拆分落地时判据不在变更面内、未被同步更新，下一次重跑就真红。

### 修法（保留不变式，不做真空绿）

- 把三处旧路径改成拆分后的包边界：`src/modules/architecture/render/architectureChatBridge.ts`（两次）与 `src/modules/architecture/render/ArchitecturePanel.tsx`（一次）。
- 原有断言逐条保留：channel 常量必须是 `export const ARCHITECTURE_CHAT_CHANNEL = 'cloudpit-architecture';`；`new BroadcastChannel(...)` 恰好一次且入参用该常量；`ArchitecturePanel.tsx` 必须含 `sendArchitectureChatMessage`；`architecture/index.ts` 必须含 `useArchitectureChatBridge`。
- 增加一条包边界一致性断言：`src/modules/architecture/index.ts` 的 re-export 说明符必须含 `render/architectureChatBridge`。这样将来再拆分时，失败信息会指向「包边界不再是 render/architectureChatBridge」，而不是又一次裸 ENOENT；同时不得把正臂降级成纯存在性检查。
- 不删任何一面、不改写成行为断言、不把 `readRepoFile` 换成「文件存在即绿」。

### 非目标

- `tasks/`、`goals/`、`adr/`、`experiments/`、`docs/proposals/`、`CHANGELOG` 属历史账本，按 GOAL-054 非目标不修改。
- `cloudcli.ai`、`cloudcli://auth/callback`、`app_surface=cloudcli_desktop`、`LEGACY_DESKTOP_APP_ID = 'ai.cloudcli.desktop'`、观测 URI 的两个副本保持原样；AC4 的存在性断言继续钉它们。
- 不改任何运行时源码（`electron/`、`src/` 一行不动），只改判据文件。

<!-- dedup-ref -->
同 AC 的 `gap-ac459-runtime-identity-surfaces-criterion`、`gap-goal-054-ac459-identity-surfaces-criterion`、`gap-ac459-criterion-stale-v30-identity-pins`、`gap-ac459-criterion-stale-observation-uri-path` 均已 done；本任务只修并发架构拆分造成的路径漂移，机制不同（上一条修的是 server observation 副本）。task-granularity-advice 对草稿 Touches 返回 peers=[] / mentions=[]，无在飞任务重叠，故独立立案。

## AC

- [x] 先 `git merge develop` 进任务分支，再跑 `npx tsx --tsconfig server/tsconfig.json --test electron/tests/cloudpit-runtime-identity-surfaces.test.mjs`：退出码 0，tests 10 / pass 10 / fail 0，贴出摘要输出。
- [x] `grep -c 'modules/architecture/architectureChatBridge.ts' electron/tests/cloudpit-runtime-identity-surfaces.test.mjs` 输出 0，`grep -c 'modules/architecture/render/architectureChatBridge.ts'` 输出 2；`grep -c 'modules/architecture/ArchitecturePanel.tsx'` 输出 0，`grep -c 'modules/architecture/render/ArchitecturePanel.tsx'` 输出 1。四个读数全部贴出。
- [x] 正臂非空转：对 `src/modules/architecture/render/architectureChatBridge.ts` 跑 `grep -c "ARCHITECTURE_CHAT_CHANNEL = 'cloudpit-architecture'"`（期望 1）与 `grep -c 'new BroadcastChannel('`（期望 1）；对 `src/modules/architecture/render/ArchitecturePanel.tsx` 跑 `grep -c sendArchitectureChatMessage`（期望 ≥1）。读数贴出。
- [x] 包边界一致性断言存在且为真：`grep -c 'render/architectureChatBridge' src/modules/architecture/index.ts` 期望 ≥1，且判据里新增的该断言在 AC1 的全绿运行中同时通过（不是只加注释）。
- [x] 负向控制仍红：判据 AC3 的两个注入用例在 AC1 运行中 pass；另用 `node --input-type=module -e` 对同一扫描器在内存中注入一条拼接的 `cloudcli-desktop:` 与一条 `__cloudcliScenario`，未注入时为绿、注入后为红，两条读数一并贴出；不改动盘上文件。
- [x] `git diff --stat` 只出现 `electron/tests/cloudpit-runtime-identity-surfaces.test.mjs` 与本任务文件；`electron/`、`src/` 下运行时源码零改动；`git diff` 不出现 `cloudcli.ai`、`cloudcli://auth/callback`、`app_surface=cloudcli_desktop`、`LEGACY_DESKTOP_APP_ID`、`tasks/`、`goals/`、`adr/`、`experiments/`、`docs/proposals/`、`CHANGELOG` 的改动。

## DoD

- 判据文件在合入 develop 的任务分支上逐字跑通并贴出 tests 10 / pass 10 / fail 0、exit 0 的真实输出——不是「文件存在」或「测试存在」。
- 同一次收尾里正臂真实读取了 `render/architectureChatBridge.ts` 与 `render/ArchitecturePanel.tsx` 的新包边界；BroadcastChannel 常量、唯一构造点、两个消费面四条不变式读数一并贴出；负向控制在未注入时绿、内存注入后红。
- `git diff --stat` 只显示判据文件（路径 + 必要的边界断言/注释）与本任务文件，`electron/`、`src/` 运行时零改动，非目标面与历史账本零改动。
- 无 UI 改动，UI DoD 不适用；本任务不修改 `server/` 代码，后端模块标准不引入新约束；前端仅改判据文件，前端模块标准不引入新约束。

## Evidence（2026-11-06，worktree `gap-ac459-criterion-stale-architecture-split-paths`）

- AC1：`git merge --no-edit develop` → `Already up to date.`；`npx tsx --tsconfig server/tsconfig.json --test electron/tests/cloudpit-runtime-identity-surfaces.test.mjs` → `ℹ tests 10` / `ℹ pass 10` / `ℹ fail 0`，`EXIT=0`；10 个用例逐条 ✔（含 AC2 正臂与 BroadcastChannel 用例）。
- AC2：`oldBridge=0`，`newBridge=2`，`oldPanel=0`，`newPanel=1`。
- AC3：`render/architectureChatBridge.ts channel_const=1 broadcast_ctor=1`；`render/ArchitecturePanel.tsx panel_send=2`。
- AC4：`grep -c 'render/architectureChatBridge' src/modules/architecture/index.ts` → `1`；新增断言在 AC1 的 `AC-459 expect: one BroadcastChannel name feeds both architecture surfaces` ✔ 中同时通过。
- AC5：AC1 运行中两条 AC3 注入用例均 ✔；`node --input-type=module -e` 用判据文件自身的 `LEGACY_TOKENS` 组装（原样求值）与同一 `includes` 逐行谓词：`clean_violations=0 => GREEN`，`injected_violations=2 => RED`，`injected_detail=[{"line":1,"token":"cloudcli-desktop:"},{"line":2,"token":"__cloudcliScenario"}]`，`NEG_EXIT=0`；注入只在内存中拼接，盘上文件未改动（运行后 `git status --porcelain` 只有判据文件）。
- AC6：实现提交 `5f2800ce2` 的 `git diff --stat` → `1 file changed, 12 insertions(+), 3 deletions(-)`，仅判据文件；`electron/`、`src/` 运行时零改动；对 diff 跑非目标名/账本路径 grep → `NO_FORBIDDEN_HITS`。
- anti-drift：`ANTI-DRIFT OK: task gap-ac459-criterion-stale-architecture-split-paths — 1 actual file(s), all within declared Touches (2 glob(s))`。

## Axis Record

该轴仍暗,理由:本任务只改判据读取路径并新增一条包边界断言,未改运行时源码,无设计/架构轴增量可计量

## Touches

- electron/tests/cloudpit-runtime-identity-surfaces.test.mjs
- tasks/gap-ac459-criterion-stale-architecture-split-paths.md

---
id: gap-ac459-criterion-stale-observation-uri-path
title: AC-459 判据 AC4 仍读 observation god-package 拆分前的旧路径：改钉
  core/observation-uri.ts 并保留 R7 不变式
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

### 现场读数（2026-11-04，直接重跑判据）

AC-459 的 criterion 逐字运行：

```
npx tsx --tsconfig server/tsconfig.json --test electron/tests/cloudpit-runtime-identity-surfaces.test.mjs
```

结果 exit 1、tests 10 / pass 9 / fail 1。唯一红是 AC4：

```
✖ AC4: the live non-goal identity pins are untouched
  Error: ENOENT: no such file or directory, open
  '.../server/modules/observation/observation-uri.ts'
    at readRepoFile (electron/tests/cloudpit-runtime-identity-surfaces.test.mjs:189)
    at TestContext.<anonymous> (electron/tests/cloudpit-runtime-identity-surfaces.test.mjs:467)
```

### 根因

判据 AC4 直接以源文本读取观测 URI 语法的两份副本：前端 `src/modules/cockpit-contract/observationUri.ts`（仍存在）与 server 侧 `server/modules/observation/observation-uri.ts`。后者已在 `9dd352a6d`（2026-11-02，observation god-package 拆分）搬到 `server/modules/observation/core/observation-uri.ts`，旧路径从树上消失。

### 更早的修复为什么没保住

同 AC 的任务 `gap-ac459-criterion-stale-v30-identity-pins`（done）在 `77ffb90d0`（2026-11-03）把 v3.0 R7 的 canonical-only 钉子加进 AC4，但该任务分支的基点早于拆分提交；拆分任务合并进 develop 时搬走了文件，且拆分任务的 Touches 没有声明这个判据文件，于是判据在 develop 上真红。这是「拆分把判据读数搬到包边界」的典型漂移，不是判据语义有错。

### 修法（保留不变式，不做真空绿）

- 把 AC4 循环里的 server 路径改为拆分后的包边界 `server/modules/observation/core/observation-uri.ts`。
- 两条断言原样保留：源文本必须含 `^cloudpit://(session|architecture)/`，且不得含已退役的双读分支 `(?:cloudcli|cloudpit)://`（该串由常量拼接，判据文件自身不出现字面量）。
- 不把该臂改成存在性检查、不删 server 臂、不改写成纯行为断言——v3.0 R7 要求两份语法副本逐字同钉，行为断言已由 `src/modules/cockpit/tests/observationUri.test.ts` 承担。
- 附带把 `src/modules/cockpit-contract/observationUri.ts` 头部注释里对 server 副本的旧路径引用改成新路径（纯注释；解析器、格式化器、正则一字不动）。

### 非目标

- `tasks/`、`goals/`、`adr/`、`experiments/`、`docs/proposals/`、`CHANGELOG` 属历史账本，按 GOAL-054 非目标不修改（`docs/proposals/cloudpit-compat-retirement.md` 里的旧路径保持原样）。
- `cloudcli.ai`、`cloudcli://auth/callback`、`app_surface=cloudcli_desktop`、`LEGACY_DESKTOP_APP_ID = 'ai.cloudcli.desktop'` 四个非目标面保持原样；AC4 的存在性断言继续钉它们。
- 不改观测 URI 的运行时行为，不新增/删除任何 server 或前端运行时代码。

<!-- dedup-ref -->
同 AC 的历史任务 `gap-ac459-runtime-identity-surfaces-criterion`、`gap-goal-054-ac459-identity-surfaces-criterion`、`gap-ac459-criterion-stale-v30-identity-pins` 均已 done；本任务只修并发拆分造成的路径漂移，机制不同。task-granularity-advice 对草稿 Touches 返回 peers=[] / mentions=[]，无在飞任务重叠，故独立立案。

## AC

- [x] 先 `git merge develop` 进任务分支，再跑 `npx tsx --tsconfig server/tsconfig.json --test electron/tests/cloudpit-runtime-identity-surfaces.test.mjs`：退出码 0，tests 10 / pass 10 / fail 0，贴摘要输出。
- [x] `grep -c 'modules/observation/observation-uri' electron/tests/cloudpit-runtime-identity-surfaces.test.mjs` 输出 0，且 `grep -c 'modules/observation/core/observation-uri' electron/tests/cloudpit-runtime-identity-surfaces.test.mjs` 输出 1：判据只读拆分后的包边界。
- [x] 两条 R7 断言仍非空转：对 `server/modules/observation/core/observation-uri.ts` 与 `src/modules/cockpit-contract/observationUri.ts` 各跑 `grep -c '\^cloudpit://(session|architecture)/'`（期望 1）与 `grep -c '(?:cloudcli|cloudpit)://'`（期望 0），四个读数全部贴出。
- [x] 负向控制：用 `node --input-type=module -e` 读取同一份 `core/observation-uri.ts` 源文本，在内存中注入一条已退役双读分支后跑判据所用的 `includes` 谓词，结果必须为「红」（即负断言失败）；同一次命令里对未注入的原文本结果为「绿」。不改动盘上文件。
- [x] `grep -rn 'modules/observation/observation-uri' electron src scripts e2e AGENTS.md` 零命中：活代码面不再引用拆分前路径。
- [x] 非目标面未被改动：`git diff` 不出现 `cloudcli.ai`、`cloudcli://auth/callback`、`app_surface=cloudcli_desktop`、`LEGACY_DESKTOP_APP_ID` 的删除或改名，也不出现 `tasks/`、`goals/`、`adr/`、`experiments/`、`docs/proposals/`、`CHANGELOG` 的改动。
- [x] `npx vitest run src/modules/cockpit/tests/observationUri.test.ts`（或本仓等价单文件前端命令）保持全绿，证明附带注释改动没有碰运行时行为。

## DoD

- 判据文件在合入 develop 的任务分支上逐字跑通并贴出 10/10 pass、0 fail 的真实输出——不是「文件存在」或「测试存在」。
- 同一次收尾里 AC4 的两个副本（server `core/observation-uri.ts` 与前端 `cockpit-contract/observationUri.ts`）都被真实读取；负向控制在盘上原文件上不变红、在内存注入后变红，两条读数一并贴出。
- `git diff --stat` 显示 `src/modules/cockpit-contract/observationUri.ts` 只有一行注释改动，`electron/tests/cloudpit-runtime-identity-surfaces.test.mjs` 只有路径与（如有）必要的行内说明改动；无运行时行为变化。
- 无 UI 改动，UI DoD 不适用；本任务不修改 `server/` 代码，后端模块标准不引入新约束；前端模块标准仅覆盖那一行注释改写。

## Evidence（2026-11-04，worktree `gap-ac459-criterion-stale-observation-uri-path`）

- AC1：`git merge --no-edit develop` → `Already up to date.`；`npx tsx --tsconfig server/tsconfig.json --test electron/tests/cloudpit-runtime-identity-surfaces.test.mjs` → `ℹ tests 10 / ℹ pass 10 / ℹ fail 0`，`EXIT=0`。
- AC2：`old-path-cnt=0 new-path-cnt=1`。
- AC3：`server/modules/observation/core/observation-uri.ts canonical=1 retireddual=0`；`src/modules/cockpit-contract/observationUri.ts canonical=1 retireddual=0`。
- AC4：`unmodified predicate=green`；`in-memory-injected predicate=red`；`NEGATIVE CONTROL PASS`；`git status --porcelain` 只有两个被修改文件。
- AC5：`grep -rn 'modules/observation/observation-uri' electron src scripts e2e AGENTS.md` 零行输出（grep exit 1）。
- AC6：`git diff --stat` → 2 files changed, 2 insertions(+), 2 deletions(-)；非目标名与账本路径 grep 均 exit 1（无命中）。
- AC7：`npx vitest run src/modules/cockpit/tests/observationUri.test.ts` → `Test Files 1 passed (1) / Tests 23 passed (23)`，`EXIT=0`。

## Axis Record

该轴仍暗,理由:本任务只改判据读取路径与一行注释,无设计/架构轴增量可计量

## Touches

- electron/tests/cloudpit-runtime-identity-surfaces.test.mjs
- src/modules/cockpit-contract/observationUri.ts
- tasks/gap-ac459-criterion-stale-observation-uri-path.md

## Needs-Human

**2026-11-04T03:25+08:00 — worker 复验：任务侧已无可做工作，唯一阻塞是共享主检出的未提交 WIP（交主检出所有者）**

- 任务侧无剩余工作：worktree `gap-ac459-criterion-stale-observation-uri-path` 已把 develop（`293ad9e3f`）合入分支（`git merge --no-edit develop`，无冲突），AC1–AC7 在合并后的树上逐条复验全绿：AC1 `tests 10 / pass 10 / fail 0`（EXIT=0）、AC2 old=0/new=1、AC3 canonical=1/retired=0（两份副本）、AC4 负向控制 `NEGATIVE CONTROL PASS`、AC5 零命中（grep exit 1）、AC6 仅 2 文件各 1 行、AC7 `23 passed (23)`。`task_check` → `ok:true acTotal:7 acChecked:7`；anti-drift → `ANTI-DRIFT OK`（3 actual files 全在 Touches 内）。
- 上一轮机械 fan-in 的 merge-develop / anti-drift / delta / typecheck / ac-precheck / suite（223s 绿）/ flip-done 全部通过，唯一失败步是最后的 `ff`。
- 阻塞原因不在任务侧：共享主检出 `/data/home/yale/work/claudecodeui` 有两个**已跟踪文件的未提交修改** —— `M scripts/test.sh`、`M server/shared/tests/quay-test-script.test.ts`。ff 的 cleanTreeCheck 只放行 `.quay/` 与 runtime artifact 的 `??`；对已跟踪修改一律判 dirty（`.git/info/exclude` 无效）。
- 这两处修改属于**同一工作区里另一个会话的在飞工作**：Codex/VSCode 会话 `01a1a21a-241c-7593-989f-3aaf10017fe2`（`~/.codex/sessions/2026/11/03/rollout-2026-11-03T23-49-44-01a1a21a-241c-7593-989f-3aaf10017fe2.jsonl`，2026-11-04 01:16 CST 落盘），内容是 opt-in server/client 并行 canary（`QUAY_TEST_PARALLEL_SERVER_CLIENT=1`，含 AC8 用例）。该会话自述其验证已通过（contract 单文件 15/15、typecheck、oxlint、`bash -n`、dry-run），但**该内容不存在于任何分支或提交**（`git log --all -S'QUAY_TEST_PARALLEL_SERVER_CLIENT'` 为空）。它不是本任务的产物，worker 不 stash / 不 commit / 不 assume-unchanged（shared lesson `fan-in-ff-clean-check-tracked-modifications-need-owner`）。
- 解阻（由该 WIP 的所有者执行，二选一，均保留完整内容）：(a) 把它提交（建议作为独立任务/分支落地）；(b) `git -C /data/home/yale/work/claudecodeui stash push -m "server-client canary WIP" -- scripts/test.sh server/shared/tests/quay-test-script.test.ts`。
- 之后主检出 `git status --porcelain` 为空即可重跑本任务：**无需重新实现**，任务分支已就绪，fan-in 剩下的 `ff` 会通过。若本任务已被机械标为 needs-human，请把它拉回 ready 再重派。

## Blocker

**2026-11-03T19:19:45.555Z — worker 未落地（exited-not-landed）**

- 未落地原因：step=ff: fan-in-ff-merge: working tree not clean in /data/home/yale/work/claudecodeui — the merge-mode ff must run on a clean checkout (found uncommitted changes):
fan-in-ff-merge:    M scripts/test.sh
fan-in-ff-merge:    M server/shared/tests/quay-test-script.test.ts
- run_id：wk-prod-anchor
- session_id：ab67da69-3bb2-4134-a846-1c23cd53b410

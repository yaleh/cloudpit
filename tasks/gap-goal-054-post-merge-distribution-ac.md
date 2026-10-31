---
id: gap-goal-054-post-merge-distribution-ac
title: GOAL-054 退出条件「AC-454 达成（post-merge）」无在域 AC：提议新增分发核验载体 AC（建议 AC-457）
status: needs-human
labels:
  - gap
parent: null
children: []
extra:
  schema: execution
---
## Proposal

选型 **(a)：为 GOAL-054 新增一条可运行的「分发核验载体」AC**（建议编号 **AC-457**；AC-451…AC-454 属 GOAL-054，AC-455 属 GOAL-053，AC-456 已存在，仓库当前最大为 AC-456），把 AC-454 的判据载体 `scripts/cloudpit-distribution-check.mjs` 在 pre-merge 阶段落地，使 AC-454 能被激活、从而进入充分性判官的「在域 AC」集合。本任务只提议；经人裁定后才入册 AC、再由人激活 AC-454。⛔ 不写 goal store、不改 `goals/*.md`、不翻任何 GOAL/AC 状态——AC 编号与入册由人/被授权的 goal 写入路径裁定。

### 未被覆盖的部分（逐字引用）

GOAL-054 `## 退出条件` 第 2 条，逐字为：

> AC-454 达成（post-merge，外部发布核验）。

### 为何现有在域 AC 集不覆盖它（读数，不是推断）

- 充分性判官只收到 `inScopeAcsOf()` 过滤后的 AC，口径是 `status ∈ {active, achieved, needs-human}`（goal-driver.js 的 `inScopeAcsOf`）。AC-454 当前 `status: draft`，所以判官拿到的在域 AC 只有 AC-451、AC-452、AC-453、AC-456：`.quay/goal-round.jsonl` round 1713（2026-10-31T15:53:57.957Z）的 `goal-sufficiency` 为 `{"goal":"GOAL-054","verdict":"insufficient"}`（在域 4 条），`phaseSplit.excluded` 为 `["AC-454"]`。
- AC-454 目前无法被激活：同一 round 的 `flips` 记 `{"id":"AC-454","to":"active","ok":false,...}`，`activationBlocked` 记 `cause: criterion-capability-unevaluated`、`storeCode: criterion-capability-unevaluable`、`missingCarriers: ["scripts/cloudpit-distribution-check.mjs"]`、`rules: ["uncertifiable-executed-artifact"]`。根因是 AC-454 的 criterion `node scripts/cloudpit-distribution-check.mjs --release` 直接执行的文件在工作树里不存在，capability 闸在运行前就拒绝它。
- 该裁决是确定性的，不是一次抽签：`.quay/goal-sufficiency-cache.json` 对 key `3e43bc4629c5…70276` 记 `{"verdict":"insufficient","ts":"2026-10-31T15:49:43.112Z"}`；缓存只在两次独立取样一致时写入。`.quay/goal-sufficiency-followup.json` 记同一 key、`since: 2026-10-31T15:51:35.231Z`、`filedAt: null`（本实例尚未立案）。
- 其余在域 AC 都不覆盖「外部发布核验」：AC-451 是品牌/包身份的静态 allowlist 扫描（不触 npm/GitHub 发布态）；AC-452 是运行时默认值翻转；AC-453 是桌面身份迁移；AC-456 是 goal preview 的浏览器品牌面，且其 expect 明说窗口/通知标题与 CLI banner 仍由 AC-451 的静态判据覆盖。四条都不涉及旧包 deprecate、新包发布、仓库可解析性或桌面 release 资产。
- 结论：AC-454 存在但永远进不了在域集合，退出条件第 2 条因此**结构性不可覆盖**；只要充分性 verdict 仍是 `insufficient`，`goalFlipDecision` 就不会把 GOAL-054 翻 `achieved`。

### 为什么选 (a) 而不是 (b)

退出条件并没有要求过多。goal body 的 `## 发布顺序` 第 5–7 步逐字为：

> 5. GitHub 仓库改名为 `yaleh/cloudpit`；配置新包 Trusted Publishing。
> 6. 发布 `@yalehwang/cloudpit@2.0.0`；发桌面 `cloudpit-desktop-*` 与 runtime tag。
> 7. post-merge AC 核验通过后 goal 才 `achieved`。

SPEC §6 与 §10.1 AC11 也把分发身份/发布核验列为独立判据面。缺的不是「这条要求不该有」，而是 **AC-454 的判据载体在树里不存在**，导致这条已经写好的 AC 无法进入判定。删弱退出条件会丢掉「外部发布核验通过才 achieved」的唯一保证。因此正确动作是补一条落地载体的判据 AC。

### 候选新 AC（建议 AC-457，编号待人工分配）

**AC-457：分发核验载体：`cloudpit-distribution-check.mjs` 可离线判定发布状态，非合规必红、合规必绿**

- `goal: GOAL-054`、`phase: pre-merge`、`status: active`（由被授权的 goal 写入路径入册）。
- `criterion`（runnable，与 AC-451 同形）：

  ```
  npx tsx --tsconfig server/tsconfig.json --test scripts/cloudpit-distribution-check.test.mjs
  ```

- `expect`（判据要断言的读数）：`scripts/cloudpit-distribution-check.mjs` 存在并实现 `--release` 模式，供 AC-454 的 `node scripts/cloudpit-distribution-check.mjs --release` 直接调用；发布状态读取必须可注入（fixture/reader），使本判据能在 pre-merge 零网络运行。判定覆盖 AC-454 的六项：旧包 `@yalehwang/cloudcli@1.42.0` 已 deprecate 且文案指向 `@yalehwang/cloudpit`；`@yalehwang/cloudpit@2.0.0` 已发布且 tarball 只有 `cloudpit` bin；GitHub `yaleh/cloudpit` 的 URL/homepage/repository/bugs 可解析；桌面 `cloudpit-desktop-*` 与 `cloudpit-local-server-v2.0.0-*` 资产可下载；README/NOTICE/LICENSE 的 CloudCLI UI 归属声明仍在。取假形态：脚本缺失、对任一注入的非合规发布状态不变红、或合规快照不绿，均红。
- 为什么它闭合缺口：载体落地后，AC-454 的 `criterion-capability` 闸不再因 `missingCarriers` 拒绝激活；人把 AC-454 从 `draft` 激活为 `active` 后，`inScopeAcsOf()`（只按 status 过滤、不看 phase）就会把 AC-454 连同其 title/expect「Post-merge 分发：旧包 deprecate、新包发布、仓库与桌面 release 可核验」交给充分性判官，退出条件第 2 条被逐字覆盖。pre-merge 阶段 AC-454 仍因 `phase: post-merge` 被 `preMergePhaseExcludedAcIds` 排除出**判定**，所以不会挡住 `goal merge`；goal 分支被合并删除后才进入 post-merge 判定并闸住 `achieved`。
- 边界：本 AC 只造载体与其离线判据，不执行任何外部发布动作（npm publish / 仓库改名 / release 上传），也不改 AC-451/452/453/456 的 criterion/expect。

### 落地形态（供入册后实现）

1. 新增 `scripts/cloudpit-distribution-check.mjs`：导出一个纯判定函数 `distributionViolations(snapshot)`；`--release` 用 live reader 组装 snapshot，fixture 模式从文件读同一 snapshot，两种来源走同一判定函数。脚本头不加 `@real-infra`（否则 capability 闸会按 `declared-real-infra-artifact` 拒绝激活）。
2. 新增 `scripts/cloudpit-distribution-check.test.mjs`：六种非合规桩造各断言 exit 非 0 且消息点名对应检查项，一份合规快照断言 exit 0；测试内不得发真实网络请求。
3. 与 AC-454 对齐：`--release` 的调用形态必须与 AC-454 criterion 逐字一致；用 `quay goal show AC-454 --json` 读回比对。
4. 开工前把 `goal/GOAL-054` 合进 task worktree 并复跑判据；会话内不跑全量 suite（`AGENTS.md` 的 cgroup/runner 规则）。

### 粒度与去重

<!-- dedup-ref -->与本提案相邻但不同：`gap-goal-054-goal-preview-ui-dod-ac` 处理退出条件第 3 条的「UI 预览」（已产出 AC-456），本提案处理第 2 条的 AC-454，两者不重叠。`task-granularity-advice --touches scripts/cloudpit-distribution-check.mjs --touches scripts/cloudpit-distribution-check.test.mjs --root /data/home/yale/work/claudecodeui --json` 返回 `peers: []`、`mentions: []`；`task_list search=GOAL-054` 无在飞任务提议 AC-454 或退出条件改动。

## AC

- [ ] AC1 载体与判据可运行：`scripts/cloudpit-distribution-check.mjs` 与 `scripts/cloudpit-distribution-check.test.mjs` 存在；`npx tsx --tsconfig server/tsconfig.json --test scripts/cloudpit-distribution-check.test.mjs` 退出 0，输出 `# fail 0`。
- [ ] AC2 外部发布状态的真红臂：同一 test 文件对六种桩造非合规态各自 exit 非 0 并点名检查项——旧包未 deprecate、新包未发布、tarball 含 `cloudcli` bin、仓库 URL/homepage/repository/bugs 不可解析、桌面 `cloudpit-desktop-*`/`cloudpit-local-server-*` 资产缺失、README/NOTICE/LICENSE 归属声明被删；`grep -c "test(" scripts/cloudpit-distribution-check.test.mjs` 至少 7（6 红 + 1 绿），且运行输出 `# fail 0`。
- [ ] AC3 真绿臂与单一读数路径：合规桩造快照 exit 0；`grep -c "export function distributionViolations" scripts/cloudpit-distribution-check.mjs` 为 1，且 test 文件 import 同一个函数（fixture 与 live 读数不各写一份判定）。
- [ ] AC4 与 AC-454 criterion 对齐：`quay goal show AC-454 --json` 的 criterion 逐字为 `node scripts/cloudpit-distribution-check.mjs --release`；该路径在本次 diff 中新增；`node scripts/cloudpit-distribution-check.mjs --help` 退出 0 并列出 `--release`。
- [ ] AC5 anti-drift：`git diff --name-only goal/GOAL-054...HEAD` 的输出是 `## Touches` 列表的子集（任务文件按 task_write 落点说明）。
- [ ] AC6 不写 goal store / 不改兄弟判据：`git diff --name-only goal/GOAL-054...HEAD -- goals/` 输出为空。

## DoD

- 贴出 AC1 的完整命令末行（`# pass` / `# fail 0`）、退出码与耗时，不是只声称通过。
- 逐条贴出 AC2 六个红臂的桩造输入与失败消息，消息里必须点名对应检查项（旧包 deprecate / 新包发布 / tarball bin / 仓库字段 / 桌面资产 / 归属声明）。
- 贴出 AC3 合规快照的完整输出与 `# fail 0`，并贴出 `distributionViolations` 的唯一导出点及其被 test import 的行号。
- 贴出 AC4 的 `quay goal show AC-454 --json` criterion 读回与 `--help` 输出；写明「AC-454 的激活是载体落地后由人执行的 goal store 写入，本任务不做」。
- 贴出 AC5/AC6 的 `git diff` 输出（应为空或仅 Touches）。
- 不跑全量 suite（`AGENTS.md` 的 runner 规则）；不写 `goals/*.md`；不改 AC-451/452/453/456 的 criterion/expect；不改任何生产默认值或外部发布配置。
- 本任务无 UI 改动，不适用 MCP 浏览器 / ui-scenario 的 UI DoD；如实现过程中发现必须改 UI，改为按 `needs-human` 交回。

## Touches

- tasks/gap-goal-054-post-merge-distribution-ac.md
- scripts/cloudpit-distribution-check.mjs (new)
- scripts/cloudpit-distribution-check.test.mjs (new)

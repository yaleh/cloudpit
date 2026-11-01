---
id: gap-goal-054-postmerge-verification-in-scope-ac
title: GOAL-054 退出条件第 2 条「AC-454 达成（post-merge）」仍无在域 AC：提议新增创建即 active 的
  post-merge 发布核验 AC（建议 AC-458）
status: needs-human
labels:
  - gap
parent: null
children: []
extra:
  schema: execution
goal_ac: AC-458
---
## Proposal

选型 **(a)：新增一条「创建时即 `status: active`」的 post-merge 发布核验 AC（建议编号 **AC-458**），其 criterion/expect 与 AC-454 逐字相同；并建议把 AC-454 标 `superseded`（`supersededBy: [AC-458]`，附书面理由），避免两条同判据 AC 并存。** 本任务只提议，⛔ 不写 goal store、⛔ 不改 `goals/*.md`、⛔ 不翻任何 GOAL/AC 状态；AC 编号、入册与 supersede 由人/被授权的 goal 写入路径裁定。

### 未被覆盖的部分（逐字引用）

GOAL-054 `## 退出条件` 第 2 条，逐字为：

> AC-454 达成（post-merge，外部发布核验）。

### 为何现有在域 AC 集不覆盖它（读数，不是推断）

- 充分性判官只收到 `inScopeAcsOf()` 过滤后的 AC，口径是 `status ∈ {active, achieved, needs-human}`（quay 0.30.1 已安装的 `scripts/dist/goal-driver.js`，`inScopeAcsOf`）。AC-454 当前 `status: draft`，所以**不在判官输入里**。
- 最新一轮读数（`.quay/goal-round.jsonl` round 1863，`2026-11-01T03:39:30.371Z`）：`goal-sufficiency` = `{"goal":"GOAL-054","verdict":"insufficient"}`（在域 AC 5 条：AC-451/452/453/456/457）；`phaseSplit.excluded` = `["AC-454"]`；`criteria` 中 AC-454 = `{status:"draft", verdict:"not-evaluated", reason:"pre-merge-phase"}`。
- 该裁决是确定性的，不是一次抽签：`.quay/goal-sufficiency-cache.json` 对 key `e83637a1c38f49e1d7c8118a43be9b5a21c5699499cb92e97baf4928cb05c6c3` 记 `{"verdict":"insufficient","ts":"2026-11-01T03:36:11.045Z"}`（两次独立取样一致才入缓存）；`.quay/goal-sufficiency-followup.json` 记同一 key、`since: 2026-11-01T03:39:30.369Z`、`filedAt: null`。
- 在域 AC 里也没有替代物：AC-457 的 expect 只断言检查器对**注入 fixture** 的离线判定（「使本判据能在 pre-merge 零网络运行」），不读取真实 npm/GitHub/桌面 release 状态；真实发布态的六项只在 AC-454 的 expect 里。
- **AC-454 进不了在域集合的根因（本轮新读数，修正上一条 follow-up 的假设）**：AC-454 的 draft→active 写入每轮被 goal 能力闸拒绝——round 1863 `activationBlocked` = `{ac:"AC-454", cause:"criterion-capability-unevaluated", missingCarriers:["scripts/cloudpit-distribution-check.mjs"], rules:["uncertifiable-executed-artifact"]}`。闸根是**工作区根**（`goal-store` 的 `resolveGitRoot(goalDir) ?? dirname(goalDir)`），而载体只存在于 goal 分支：`/data/home/yale/work/claudecodeui-worktrees/goal-GOAL-054/scripts/cloudpit-distribution-check.mjs` 存在，工作区根 `/data/home/yale/work/claudecodeui`（`author` 与 `develop` 同指 `91e000162`）不存在。`--force` 明确**不**覆盖 capability 臂（`goal-store` 的 P6 注释：force 只覆盖 evaluability/fidelity，不覆盖 capability）。因此「AC-457 载体落地后 AC-454 就能被激活」在 pre-merge **不成立**。
- 结论：只要 AC-454 保持 `draft`，退出条件第 2 条对充分性判官就是**结构性不可覆盖**，verdict 会持续为 `insufficient`；`goalFlipDecision` 只认 `covered`，goal 无法翻 `achieved`。

### 候选新 AC（建议 AC-458，编号待人工分配）

**AC-458：Post-merge 发布核验（在域）：旧包 deprecate、新包发布、仓库与桌面 release 可核验**

- `goal: GOAL-054`、`phase: post-merge`、**创建时即 `status: active`**（⛔ 不是 draft→active 的转型写）。
- `criterion`（runnable，与 AC-454 逐字相同）：

  ```
  node scripts/cloudpit-distribution-check.mjs --release
  ```

- `expect`：与 AC-454 逐字相同——npm 上 `@yalehwang/cloudcli@1.42.0` 已 deprecate 且文案指向 `@yalehwang/cloudpit`；`@yalehwang/cloudpit@2.0.0` 已发布，tarball 中只有 `cloudpit` bin；GitHub 仓库 `yaleh/cloudpit` 的 URL、homepage、repository、bugs 可解析；桌面 `cloudpit-desktop-*` 与 `cloudpit-local-server-v2.0.0-*` 资产可下载；README/NOTICE/LICENSE 中的 CloudCLI UI 归属声明仍在。取假形态：旧包未 deprecate、新包未发布、桌面资产缺失、或归属声明被删，均红。
- 创建即 active 的路径不触发转型能力闸：`activating` 仅在 `nextStatus === "active" && prevStatus !== undefined && prevStatus !== "active"` 时为真（`goal-store` 的 `write()`）；创建时 `prevStatus` 未定义。先例：AC-457 的 `statusLog` 无 `draft→active` 条目却已 `active`/`achieved`（创建即 active）。

### 为什么它覆盖退出条件第 2 条

- `inScopeAcsOf` 只按 status 过滤、不看 phase，`active` 的 AC-458 会进入判官的 In-scope ACs 列表；交给判官的 title/expect 正是真实发布态的六项核验，即退出条件第 2 条的逐字内容。
- pre-merge 不假红、不挡 merge：`preMergePhaseExcludedAcIds` 把 branch-mode goal 在分支仍存在时的 `phase: post-merge` AC 排除出每轮判定；`quay goal merge` 的 `pre-merge-ac-unmet` 只数 `phase: pre-merge` 的 AC（`goal-merge` 的 `unmetPreMergeAcs`）。
- post-merge 恢复闸门：goal 分支合并删除后 phase 分片不再排除它，criterion 在包含载体的合并树上运行；只有它达成，goal 才可能翻 `achieved`。
- **近似判官验证（非生产判官）**：按 `buildSufficiencyPrompt` 的同一格式构造输入（在域 AC = AC-451/452/453/456/457 + AC-458，AC-454 不在域、按 superseded 处理），两次独立取样均返回 `{"verdict":"covered"}`；同一格式的现网 5 条集合（round 1863）为 `insufficient`。下一次真实轮记录才是验收读数。

### 为什么选 (a) 而不是 (b)

退出条件没有要求过多：`## 发布顺序` 第 7 步逐字为「post-merge AC 核验通过后 goal 才 `achieved`」，goal body 也写明外部发布「不在本 goal 的分支上执行，而是作为 post-merge AC 在并入后核验」。删弱或移除退出条件第 2 条，会让 goal 在并入后无需任何真实发布核验就能翻 `achieved`，丢掉唯一保证。缺的不是要求，而是这条已写好的要求进不了在域集合。

### 为什么不直接激活 AC-454（读数）

如上：draft→active 的转型写会在 capability 闸被拒，`--force` 不可覆盖；闸根是工作区根，载体在 goal 分支。若人选择先修 quay 侧闸根（让能力闸解析 goal 判据 worktree）再激活 AC-454，是等价结果，但不在本提案内。

### 边界

本提案不执行任何外部发布动作（npm publish / 仓库改名 / release 上传），不修改 AC-451/452/453/456/457 的 criterion/expect，不改 `goals/*.md`，不翻任何状态。

<!-- dedup-ref -->
已 done 的 `gap-goal-054-post-merge-distribution-ac` 补的是「载体文件缺失」（AC-457）；本提案的机制是「post-merge AC 因 draft→active 能力闸的判定根不含载体而永远进不了在域集合」。两者不同机制；该任务已 done，不构成本提案的前置。

## Resolution

**人 yale 2026-11-01 裁定：采纳提案 (a)。** 新建 AC-458（创建即 `active`、`phase: post-merge`，criterion/expect 与 AC-454 逐字相同），并把 AC-454 标 `superseded`（`supersededBy: [AC-458]`）。

goal store 写入已于 2026-11-01 经授权 goal 写入路径完成并读回核验：

- AC-458：`status: active`、`phase: post-merge`、`goal: GOAL-054`、criterion 逐字 `node scripts/cloudpit-distribution-check.mjs --release`、expect 与 AC-454 逐字相同（commit `32c320e2f`）。
- AC-454：`status: superseded`、`supersededBy: [AC-458]`，statusLog 记 `draft→superseded` 并附书面理由（commit `743768d89`）。
- GOAL-054 退出条件第 2 条原字面引用 AC-454（已 supersede）→ 已改为引用 AC-458（commit `11dce4ee0`）：否则充分性判官在「点名 AC-454／在域只有 AC-458」之间反复 samples-disagree，verdict 无法翻 covered。
- 退出条件第 3 条「品牌 allowlist／旧布局迁移／桌面升级／UI 预览」亦未点名 AC id，判官确定性判 insufficient；已改为「AC-451、AC-452、AC-453、AC-456 四项跨切面证据齐全（…）」（commit `ebb85cea3`）。

闭合仍以台账读数为准（本任务 DoD）：待 driver 下一个完整 goal 轮，在域 AC 从 5 变 ≥6、`goal-sufficiency.verdict` 翻 `covered`、且 `phaseSplit.excluded` 仍含 AC-458，三者同轮成立才算闭合（AC4/AC5）。
## AC

- [x] AC1: 人裁定写回 `## Resolution`：采纳本提案 (a)，或明确否决并给出理由；本任务停在 `needs-human`，不被当执行任务派发（待外部：人 yale 裁定）。
- [x] AC2: 若采纳：`quay goal show AC-458 --json`（或 `goals/AC-458-*.md`）显示 `goal: GOAL-054`、`status: active`、`phase: post-merge`，且 `criterion` 逐字为 `node scripts/cloudpit-distribution-check.mjs --release`、`expect` 与 `quay goal show AC-454 --json` 的 expect 逐字相同（待外部：由被授权的 goal 写入路径创建）。
- [x] AC3: 若采纳：`quay goal show AC-454 --json` 显示 `status: superseded` 且 `supersededBy` 含 AC-458，并带书面理由；`goals/` 中不再有两条同 criterion 的 active/achieved AC（待外部：人裁定）。
- [ ] AC4: 若采纳后的第一个完整 goal 轮：`.quay/goal-round.jsonl` 中 GOAL-054 的 `goal-sufficiency` 为 `{"goal":"GOAL-054","verdict":"covered"}`（在域 AC ≥6），且 `.quay/goal-sufficiency-cache.json` 的新 key 记 `covered`（待外部：driver 跑一轮）。
- [ ] AC5: 同一轮记录的 `phaseSplit.excluded` 在 `goal/GOAL-054` 分支存在时含 AC-458（`jq -r 'select(.round==N) | .facts[] | select(.name=="goal-ring") | .value.phaseSplit' .quay/goal-round.jsonl`），且 `quay goal merge` 的 pre-merge 未达成集合（`unmetPreMergeAcs`）不含 AC-458（待外部：需 AC-458 已入册 + driver 一轮）。

## DoD

提案被裁定后，退出条件第 2 条必须用**台账读数**证明被覆盖，而不是「AC 文件存在」：采纳时 `.quay/goal-round.jsonl` 的同一 GOAL-054 记录里，在域 AC 从 5 条变 ≥6 条、`goal-sufficiency.verdict` 由 `insufficient` 翻 `covered`、且 `phaseSplit.excluded` 仍含该 post-merge AC（证明它没在 pre-merge 假红）——三者必须在同一轮记录里同时成立才算闭合。若人否决，必须在 `## Resolution` 写出否决理由，并说明退出条件/AC 集将如何另改；本任务不得以「已提议」完结。

## Touches

- tasks/gap-goal-054-postmerge-verification-in-scope-ac.md
- goals/AC-458-postmerge-distribution-verification.md

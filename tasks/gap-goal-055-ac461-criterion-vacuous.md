---
id: gap-goal-055-ac461-criterion-vacuous
title: "GOAL-055 退出条件 AC-461 无在域 AC 覆盖：判据空洞（fidelity: vacuous）无法激活——提议替换为专用红先行判据"
status: needs-human
labels:
  - gap
parent: null
children: []
extra:
  schema: execution
goal_ac: AC-461
---
<!-- dedup-ref --> 机制去重：`codex-model-entry-provider-binding` 是 AC-461 的功能实现（模型条目挂 provider），本条补的是「AC-461 因判据空洞进不了在域集合」这一覆盖缺口，机制不同；本 goal 无其他 AC/退出条件变更提案。

## Proposal

选型 **(a)：为 AC-461 提供一条新的、可判伪的 criterion（原地替换 AC-461 的 criterion，AC id / title / expect / goal / phase 均不变）**，使 AC-461 能通过 fidelity 闸进入在域集合。建议把 criterion 改为：

```
npx tsx --tsconfig server/tsconfig.json --test server/modules/providers/tests/codex-provider-model-binding.test.ts
```

本任务只提议；⛔ 不写 goal store、⛔ 不改 `goals/*.md`、⛔ 不翻任何 GOAL/AC 状态——是否采纳由人 yale 经被授权的 goal 写入路径裁定。

### 未被覆盖的部分（逐字引用）

GOAL-055 `## 退出条件` 中 AC-461 一条，逐字为：

> AC-461 模型条目挂 provider：可声明 codexProviderId；未声明继承全局；声明不存在/已删 provider 可读拒绝；目录显示 model · provider。

### 为何现有在域 AC 集不覆盖它（台账读数，不是推断）

- 判官的在域口径是 `status ∈ {active, achieved, needs-human}`（已安装 quay 0.31.1 `scripts/dist/goal-driver.js` 的 `inScopeAcsOf`）。AC-461 当前 `status: draft`、`statusLog` 为空（从未激活），因此**不在判官输入里**。
- 其余 7 条退出条件各自有在域 AC（AC-460 active、AC-462 achieved、AC-463/464/465/466/467 active），只有 AC-461 这一条没有在域 AC；本 goal 最近三轮（`.quay/goal-round.jsonl` round 287 / 288 / 289，09:25:12Z / 09:28:56Z / 09:32:41Z）的 `goal-sufficiency` 都是 `{"goal":"GOAL-055","verdict":"insufficient"}`。
- 在域 AC 里没有替代物：AC-460 只管 provider 注册表写入校验；AC-462 只管 sessions 的 `model_provider_id`；AC-465 的「模型编辑器 provider 选择器」是 UI 呈现；三者都不度量「ProviderModelConfig 可声明 codexProviderId / 未声明继承全局 / 声明不存在或已删 provider 被可读拒绝 / 目录显示 model · provider」。
- **根因（本轮新读数）**：goal-driver 每轮都 triage 它（`triageDraftAc` → `decision: "activate"`），但 `writeGoalStatus` 每轮都被 fidelity 闸拒绝。round 287 / 288 / 289 的 `goal-ring.flips` 对 AC-461 逐字为：`write exit 2: goal-store: activated AC-461 — criterion ran in ... (pass)\ngoal-store: write failed: cannot activate AC-461: criterion vacuous (fidelity judge: vacuous) — pass --force to override`。三轮 `activationBlocked` 均为 `[]`，所以这不是能力闸（capability），而是**判据空洞**：criterion 跑的是既有 `server/modules/providers/tests/model-config-write-path.test.ts`，该文件 0 处 `codexProviderId`（`grep -c codexProviderId` = 0），测的是 disallowed env keys / config_json / 内建模型等，与 expect 度量的对象无关。
- **不能直接 `--force` 激活**：该 criterion 在现树上是绿的，`.quay/gate-events.jsonl` 里 AC-461 的台账尾是 `verdict: pass`（09:33:45.242Z，treeSha c67d9697）。强制激活后 driver 的 `I2: criterion pass` 会立刻把 AC-461 翻 `achieved`——在「模型条目挂 provider」功能尚未实现时制造假绿，正好是充分性判官要防的情形。
- 因此只要 AC-461 保持 `draft`，退出条件中这一条对判官就是结构性不可覆盖，`goalFlipDecision` 永远不满足（它只认 `covered`）。

### 为什么新 criterion 覆盖这条退出条件

- AC-461 的 expect 已经是退出条件这一条的逐字内容；缺的只是「能被判官看见且能判伪」的判据。新判据指向一个**尚不存在**的专用文件：fidelity judge 无法把它当现树无关测试的恒绿探针，因此判 `faithful`——这与本 goal 内 AC-463 / AC-464 / AC-466 / AC-467 完全同形（四条 criterion 都指向尚不存在的专用测试文件，`fidelity.verdict` 均为 `faithful`，均已在域）。
- 激活后 AC-461 进入 `inScopeAcsOf`，判官收到的在域集合里出现「可声明 codexProviderId；未声明继承全局；声明不存在/已删 provider 可读拒绝；目录显示 model · provider」，即退出条件这一条的逐字内容。
- 与现有 criterion 不同，新判据在功能落地前是**红**的（文件不存在 → `Could not find ...`），所以激活不会造成假绿；功能落地（`codex-model-entry-provider-binding` 创建该文件并补断言）后才转绿，再由 driver 翻 `achieved`。
- 判据文件名遵循本 goal 同批命名（`codex-resident-provider-injection.test.ts` / `codex-runtime-provider-injection.test.ts` / `codex-provider-import.test.ts` / `codex-provider-advanced.test.ts`）；新 server 测试文件撞时长基线/未知 pin 时按既有约定等量上调并注明。

### 采纳时的一并改动（都走被授权写入路径）

1. AC-461 criterion 改为上面的新命令；expect / title / goal / phase 不变。
2. `codex-model-entry-provider-binding` 的 `## Touches` 增加 `server/modules/providers/tests/codex-provider-model-binding.test.ts`，其 AC 判据命令与 AC-461 新 criterion 逐字一致（现 Touches 写「扩 model-config-write-path.test.ts，不新建」，与本提案冲突，采纳后须同步）。
3. 不改退出条件文本（AC id 未变）。

**不做**：不 supersede AC-461、不新建同 expect 的第二条 AC（会造成两条同判据 AC，并迫使退出条件改点名）、不删既有 `model-config-write-path.test.ts` 的覆盖（扩它仍可保留，但不是 AC-461 的判据）。

### 备选读数（不构成本提案）

若人选择不新增判据文件：等 `codex-model-entry-provider-binding` 落地、把 `codexProviderId` 断言加进既有 `model-config-write-path.test.ts` 后，该判据会重跑并可能被 fidelity judge 重判为 `faithful`，AC-461 自然可激活。但这要等实现落地（该任务刚因 `codex-provider-config-surface` 完成而变为可派发），且整文件判据的判伪性仍依赖实现者真的把断言写进该文件；本提案的红先行专用文件把这两点都钉死。

## AC

- [x] AC1: 人裁定写回 `## Resolution`：采纳本提案（替换 AC-461 criterion + 同步 `codex-model-entry-provider-binding` 的 Touches），或明确否决并给出理由；本任务停在 `needs-human`，不被当执行任务派发（待外部：人 yale 裁定）。
- [x] AC2: 若采纳：`quay goal show AC-461 --json`（或 `goals/AC-461-*.md`）的 criterion 逐字为 `npx tsx --tsconfig server/tsconfig.json --test server/modules/providers/tests/codex-provider-model-binding.test.ts`，且 title / expect / goal / phase 与判定前逐字相同（待外部：被授权 goal 写入路径）。
- [ ] AC3: 若采纳后的第一个完整 goal 轮：`.quay/goal-round.jsonl` 中 GOAL-055 记录里 `goal-sufficiency` 为 `{"goal":"GOAL-055","verdict":"covered"}`，且同一记录 `goal-ring.criteria` 中 AC-461 的 status ∈ {active, achieved, needs-human}（待外部：goal-driver 跑一轮）。
- [x] AC4: 若采纳：`codex-model-entry-provider-binding` 的 `## Touches` 含 `server/modules/providers/tests/codex-provider-model-binding.test.ts`，且其 AC 判据命令与 AC-461 新 criterion 逐字一致（待外部：被授权 task_write）。
- [ ] AC5: 若否决：`## Resolution` 写出否决理由，并说明 AC-461 将以什么路径进入在域集合（或退出条件 / AC 集如何另改）；本任务不得以「已提议」完结（待外部：人 yale 裁定）。

## DoD

本条是 AC 集提案，不以「任务文件存在」或「提案已写」为完成。闭合以台账读数为准：采纳时，同一个 GOAL-055 轮记录里 `goal-sufficiency.verdict` 由 `insufficient` 翻 `covered`，且 `goal-ring.criteria` 显示 AC-461 已在域（active / achieved / needs-human）——两者必须同轮成立；并在同一轮确认 AC-461 的判据读数对应**新的**命令（文件不存在时为 fail；只有实现任务已创建该文件时才是 pass），排除旧判据 pass 台账直接翻 achieved 的假绿。若人否决，必须在 `## Resolution` 写出否决理由与替代闭合路径。本任务自身不写 goal store、不翻任何状态。

## Touches

- tasks/gap-goal-055-ac461-criterion-vacuous.md
- goals/AC-461-codex-模型条目挂-codexproviderid-未声明继承全局-未知-已删-provider-可读拒绝.md
- tasks/codex-model-entry-provider-binding.md

## Resolution

2026-11-02，裁定：**采纳选型 (a)** —— 原地替换 AC-461 的 criterion（AC id / title / expect / goal / phase 不变），不 supersede、不新建同 expect 的第二条 AC、不改退出条件文本。批准人：yale（本会话授权）。提案未被否决，AC5 不适用。

### 已执行的写入（被授权路径 + 读回）

- `goal_write AC-461`：criterion 现为 `npx tsx --tsconfig server/tsconfig.json --test server/modules/providers/tests/codex-provider-model-binding.test.ts`；status 仍 `draft`，title / expect / goal / phase 读回逐字未变（`goals/AC-461-…md` 同步落盘）。
- `task_write codex-model-entry-provider-binding`：Touches 把「扩 model-config-write-path.test.ts，不新建」改为新建 `server/modules/providers/tests/codex-provider-model-binding.test.ts`，并补 `server/shared/tests/quay-test-script.test.ts` 与 `scripts/suite-duration-baseline.tsv`（新 server 测试文件的 pin / 时长地板连带；提案正文未列，采纳时一并补齐）；AC 判据命令与 AC-461 新 criterion 逐字一致，并补「四个面逐条断言」；DoD 的「不新建 server 测试文件」同步改为新建该文件。

### 裁定前复核的读数（均在本轮重新读取，不是转述提案）

- 在域口径确为 status ∈ {active, achieved, needs-human}（已安装 quay 0.31.1 `scripts/dist/goal-driver.js` 的 `inScopeAcsOf`）；`goalFlipDecision = goalAchievedFromRecords && sufficiency === 'covered'`。
- `.quay/goal-round.jsonl` round 287 / 288 / 289 / 292（09:25:12Z / 09:28:56Z / 09:32:41Z / 09:51:34Z）：AC-461 的 `goal-ring.flips` 每次都逐字带 `cannot activate AC-461: criterion vacuous (fidelity judge: vacuous)`，`activationBlocked` 为 `[]`；`goal-sufficiency` 四轮均 `insufficient`。
- `grep -c codexProviderId server/modules/providers/tests/model-config-write-path.test.ts` = 0，且该文件判据在 round 292 仍是 `pass`（exit 0）⇒ vacuous-but-green，`--force` 会在功能未实现时假绿翻 achieved，故不采用 force。
- 新判据文件当前不存在；capability 闸只对被解释器直接执行的第一个字面路径做存在性检查，`npx tsx --test <file>` 不被当作解释器 ⇒ 可激活且先红；fidelity 对缺失机制走 LLM 判官，同形 sibling AC-463 / 464 / 466 / 467 的判据文件同样不存在且均已 activation ok。
- 依赖 `codex-provider-config-surface` 读回为 `done`，本实现任务已可派发。

### 提案读数的两处过期/缺口（已在执行中修正）

1. 提案称「AC-460 active」：现为 `achieved`（round 292），不影响结论。
2. 提案只要求同步实现任务的 `## Touches` 与 AC 命令；实际其 `## DoD` 仍写「不新建 server 测试文件」，且新 server 测试文件会撞 `quay-test-script.test.ts` 两条 unknown pin 与 `scripts/suite-duration-baseline.tsv` 覆盖率地板。已在同一 `task_write` 中修正 DoD 并把两个连带文件补进 Touches。

### 剩余外部验证（AC3 / 本任务 DoD）

AC-461 现为 `draft` + 新 criterion；下一轮 goal-driver 应 triage 激活它（criterion 因文件缺失而 fail，fidelity 判 faithful），进入在域集合后 GOAL-055 的 `goal-sufficiency` 应从 `insufficient` 翻 `covered`。该读数只能由 driver 的下一轮产生，故 AC3 保持未勾并由 driver 侧闭合；本任务不以「已提议」完结，待该轮读数确认后由外部闭合。
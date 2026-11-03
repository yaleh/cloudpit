---
id: gap-ac458-criterion-version-pin-drift
title: AC-458 判据版本漂移：checker 默认 NEW_VERSION 升到 3.0.0 后无版本判据红，经 ABI 把判据钉到
  --version 2.0.0 并复核台账翻绿
status: todo
labels:
  - gap
parent: null
children: []
extra:
  schema: execution
goal_ac: AC-458
---
## Proposal

### 缺口读数（2026-11-03，现场重跑，非台账尾巴）

AC-458 存储的 criterion 是**不带版本**的：

```
GITHUB_TOKEN="$(/data/home/yale/.local/bin/gh auth token)" node scripts/cloudpit-distribution-check.mjs --release
```

现场按这条逐字运行 → `exitCode: 1`，4 条 violations，全部指向尚未发布的 3.0.0：

- `new-package: new package @yalehwang/cloudpit@3.0.0 is not published`
- `tarball-bin: new package tarball bin must be exactly "cloudpit", found []`
- `desktop-assets: desktop release asset cloudpit-desktop-* is missing or not downloadable`
- `desktop-assets: desktop release asset cloudpit-local-server-v3.0.0-* is missing or not downloadable`

这与 `.quay/gate-events.jsonl` 里 2026-11-03T03:40:36Z（goal-sweep）与 03:43:43Z（goal-cli）两条 AC-458 `verdict: fail` 逐字一致。

同一判据显式加 `--version 2.0.0` 现场运行 → `exitCode: 0`、`version: "2.0.0"`、`violations: []`，六项 checks（old-package / new-package / tarball-bin / repository / desktop-assets / ownership）全绿。也就是说 AC-458 的 expect 所写的 2.0.0 发布态（旧包 1.42.0 已 deprecate、新包 2.0.0 已发布且 tarball 只有 `cloudpit` bin、仓库 URL 可解析、`cloudpit-desktop-*` 与 `cloudpit-local-server-v2.0.0-*` 可下载、归属声明仍在）**此刻真实成立**。

### 为什么早先的修复没有守住

- `gap-goal-054-post-merge-release-window`（done，顶层 `goal_ac: AC-458`）在 2026-11-02 完成 2.0.0 外部发布窗口。当时 checker 的 `NEW_VERSION = '2.0.0'`，所以不带 `--version` 的 AC-458 判据读到 2.0.0：`goal-sweep` 于 2026-11-02T14:04:16Z 记 `verdict: pass`（`treeSha 4d4db986…`）。
- `gap-cloudpit-v30-release`（needs-human）随后在 commit `8f471d2b1`（2026-11-02T17:26Z）把 `NEW_VERSION` 改为 `'3.0.0'` 作为 v3.0 发布准备，并在任务正文写明「AC-458 已 achieved，其 2.0.0 判据不改写；v3.0 用同一 checker 的版本参数复验」。
- 但 AC-458 的 criterion 省略了 `--version`，**隐式依赖默认值**；默认值一改，判据就被静默重定向到尚未发布的 3.0.0（commit 里 `localServerAssetPrefix(version = NEW_VERSION)`、`distributionViolations(snapshot, { version = NEW_VERSION })`、`releases/tags/v${version}` 都随之改读 3.0.0）。那个任务改了默认值，却没有同时把历史 AC 的判据钉版本，所以修复不 durable：发布状态没有回退，回退的是「判据测哪一版」。
- 缺陷机制：**判据与其 expect 的版本漂移**——expect 明写 2.0.0，判据却读可变默认值。

### 修复（仓库侧，不需要任何外部发布动作）

1. 通过授权 goal 写入 ABI（`goal_write` MCP 或 `quay goal write`；⛔ 不手改 `goals/*.md`）把 AC-458 的 criterion 逐字改为：

   ```
   GITHUB_TOKEN="$(/data/home/yale/.local/bin/gh auth token)" node scripts/cloudpit-distribution-check.mjs --release --version 2.0.0
   ```

   - 只改 criterion。`expect`、`goal: GOAL-054`、`origin`、`status: achieved`、`longTerm: false` 原样保留，不 pass 这些字段或按写前原值回传。
   - 写后 `quay goal show AC-458 --json` 读回全部字段，并 `git log -1 -- goals/` 确认是 ABI 自己的提交（不是工作区手改）。
2. **不回滚** `scripts/cloudpit-distribution-check.mjs` 的默认 `NEW_VERSION = '3.0.0'`：v3.0 发布窗口仍由 `gap-cloudpit-v30-release` 承载，它的外部动作（release-it、desktop-release、npm/GitHub）不在本任务。
3. 复核三读：新判据逐字跑 `exitCode: 0`；同命令 `--version 3.0.0` 仍 `exitCode: 1` 且只点名 3.0.0（证明 pin 不是放宽判定）；`node --test scripts/cloudpit-distribution-check.test.mjs` 仍绿（历史 2.0.0 兼容臂仍在）。
4. 跑一次 `quay goal gate AC-458`，让台账写入同树 pass；driver 下一轮复验也会独立跑同一条判据。

### 非目标

- 不发布 3.0.0，不 `npm publish`，不 push yaleh，不触发任何 workflow，不改 GitHub 仓库/桌面 release 资产。
- 不改 AC-458 的 expect / status / 编号，不 supersede，不声明 `long-term: true`。
- 不改 checker 默认版本、release notes、workflow 文案或测试夹具（那些属于 `gap-cloudpit-v30-release` 的仓库侧成果）。

### 为什么不是「等 3.0.0 发布」或 supersede

- AC-458 的 expect 逐字是 **2.0.0** 发布核验；2.0.0 的 release 仍在且可核验。等 3.0.0 发布既不匹配 expect，也把 GOAL-054 的 post-merge 核验替换成另一个未来发布窗口的事项。
- supersede 会删掉唯一一条「GOAL-054 的 2.0.0 发布真实可核验」的保证。失效原因只是判据隐式依赖可变默认值，应修判据文本，而不是废除保证。

<!-- dedup-ref -->
相关任务（机制不同，不重复）：`gap-goal-054-post-merge-release-window`（done，`goal_ac: AC-458`；做 2.0.0 外部发布并已完成）与 `gap-cloudpit-v30-release`（needs-human，无 `goal_ac`；做 3.0.0 发布准备与外部窗口，其默认值改动是本缺陷的触发源，但本任务不重做它的发布动作，也不改它的默认值与 release 资产）。`task-granularity-advice` 对下列 Touches 返回 `peers: []`。

## AC

- [ ] AC1 判据已钉版本（经 ABI）：`quay goal show AC-458 --json`（或 `quay goal get AC-458 --json`）的 `criterion` 逐字为 `GITHUB_TOKEN="$(/data/home/yale/.local/bin/gh auth token)" node scripts/cloudpit-distribution-check.mjs --release --version 2.0.0`；`expect` 与写前逐字相同（仍含 `@yalehwang/cloudpit@2.0.0` 与 `cloudpit-local-server-v2.0.0-*`）；`status` 仍为 `achieved`、`longTerm` 仍为 false；`git log -1 -- goals/` 显示该写入由 goal 写入路径提交。
- [ ] AC2 判据逐字跑绿：`GITHUB_TOKEN="$(/data/home/yale/.local/bin/gh auth token)" node scripts/cloudpit-distribution-check.mjs --release --version 2.0.0 --json` 退出 0，`version: "2.0.0"`，`violations: []`，`checks` 六项齐全。
- [ ] AC3 判据非空转（负臂）：同命令把版本改为 `--version 3.0.0` 后退出非 0，violations 只点名 3.0.0（如 `new package @yalehwang/cloudpit@3.0.0 is not published`），不把 2.0.0 当当前版本；证明 pin 选中历史 release 而非放宽判定。
- [ ] AC4 台账翻绿：`quay goal gate AC-458`（或 `goal_gate` MCP）返回 pass，且 `.quay/gate-events.jsonl` 中 AC-458 最新 `gate: goal` 事件为 `verdict: pass`、`payload.treeSha` 等于 `git rev-parse HEAD^{tree}`（同树自证，不是旧 pass 尾巴）。
- [ ] AC5 无回归：`node --test scripts/cloudpit-distribution-check.test.mjs` 退出 0；`git diff --stat -- scripts/cloudpit-distribution-check.mjs scripts/cloudpit-distribution-check.test.mjs` 为空（未改默认值与夹具）。

## DoD

- 贴出写前 / 写后 `quay goal show AC-458 --json` 的 criterion、expect、status、longTerm 四段读数，证明只有 criterion 变了。
- 贴出 AC2 的完整 JSON 末段（`exitCode: 0`、`version: "2.0.0"`、`violations: []`）。
- 贴出 AC3 的 violations 列表原文（只点名 3.0.0），证明负臂有效。
- 贴出 AC4 的新 GateEvent 原文（`verdict: pass`，`payload.treeSha` 与 `git rev-parse HEAD^{tree}` 相同）。
- 贴出 AC5 的测试末行（pass/fail 计数）与 `git diff --stat` 空输出。
- 真实落地判据：AC-458 的记录判据本身变成可复跑且通过，driver 下一轮独立复验拿到 pass；不是「脚本改好了」或「2.0.0 曾经通过」代替。
- 只改 `goals/AC-458-*.md` 与 `tasks/gap-ac458-criterion-version-pin-drift.md`；不改 `goals/GOAL-054-*.md`、不改 checker 默认值/夹具、不做任何外部发布。

## Touches

- goals/AC-458-post-merge-发布核验-在域-旧包-deprecate-新包发布-仓库与桌面-release-可核验.md
- scripts/cloudpit-distribution-check.test.mjs
- tasks/gap-ac458-criterion-version-pin-drift.md

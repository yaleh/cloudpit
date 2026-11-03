---
id: gap-ac459-criterion-stale-v30-identity-pins
title: AC-459 判据 AC4 仍钉住 v3.0 已退役的观测 URI 双读与旧 appId 活值：按 R7/R13 现意图改钉并同步 AC expect
status: todo
labels:
  - gap
parent: null
children: []
extra:
  schema: execution
goal_ac: AC-459
---
## Proposal

### 缺口读数（2026-11-03，现场重跑，非台账尾巴）

AC-459 的 criterion 逐字运行：

```
npx tsx --tsconfig server/tsconfig.json --test electron/tests/cloudpit-runtime-identity-surfaces.test.mjs
```

现场读数 `pass 9 / fail 1`，唯一红：

```
✖ AC4: the live non-goal identity pins are untouched
  AssertionError: src/modules/cockpit-contract/observationUri.ts keeps the dual-read observation URI regex
  at electron/tests/cloudpit-runtime-identity-surfaces.test.mjs:453:12
```

同一判据的 AC1/AC2/AC3/AC6 全绿：IPC 三处一致、contextBridge 两名、BroadcastChannel、语义面全局、注入旧名的两条负臂、历史账本仍在。**四名翻转本身的保证此刻成立**；红的是 AC4 里一条过期的「非目标面」钉子。

### 为什么早先的修复没有守住

- `gap-ac459-runtime-identity-surfaces-criterion`（done，顶层 `goal_ac: AC-459`）在 2026-11-01 写出本判据时，v3.0 的兼容退场还没执行，AC-459 的 expect 明确把「`cloudcli://` 观测 URI 双读」列为必须保留的非目标面，于是 AC4 用 `source.includes('(?:cloudcli|cloudpit)://')` 与 `source.includes('cloudcli://session/')` 把双读钉成活代码不变量。
- 2026-11-02，`gap-cloudpit-v30-identity-contract-removal`（done）按 `docs/proposals/cloudpit-compat-retirement.md` 的 **R7** 执行退场：提交 `cd528d09c` 把两份语法文件的接受正则改为 `^cloudpit://(session|architecture)/…`，删除 `legacyCloudUri` / `observationUriSpellings`，并在 `src/modules/cockpit/tests/observationUri.test.ts:49-55` 钉住相反形态（`parseObservationUri('cloudcli://session/legacy-1')` 必须为 `null`）。
- 同一退场批次里，提交 `ace4e47cc` 按 **R13** 把活 appId 切到 `ai.cloudpit.desktop`（`electron/main.js:17`），并把旧拼写保留为迁移常量 `LEGACY_DESKTOP_APP_ID`（`electron/appIdMigration.js:37`）。AC4 的 appId 断言当时跟着改成了新活值，**但同一条测试里的双读钉子没跟着改**，所以那一轮看起来「改好了」，实际留下一条与 R7 相反的断言。
- 缺陷机制：判据钉住的是**已被后续裁定退役的兼容回退**；expect 的同一段还留着旧 appId 活值。这不是身份面回归，而是判据与现行意图漂移。

### 修复（仓库侧，不恢复任何旧回退）

1. **改判据文件** `electron/tests/cloudpit-runtime-identity-surfaces.test.mjs` 的 AC4 活体钉子：两份观测 URI 语法文件不再断言「保留双读」，改为断言
   - `const CLOUDPIT_URI = new RegExp(\`^cloudpit://(session|architecture)/`（只接受 canonical 拼写）；
   - 源码不再出现 `(?:cloudcli|cloudpit)://` 或 `cloudcli://session|architecture/` 的接受分支；
   - 同一条测试补读 `electron/appIdMigration.js` 的 `LEGACY_DESKTOP_APP_ID = 'ai.cloudcli.desktop'`，让「旧 appId 作为迁移常量保留」这一半继续被读到，而不是随删除一起变空。
2. **保留且不动** AC4 的 tmp 夹具臂：夹具里只有 `cloudcli://session/<id>` / `cloudcli.ai` / `cloudcli://auth/callback` / `app_surface=cloudcli_desktop` 时扫描必须零 violations —— 这继续证明「零命中扫描不得把 `cloudcli://` 一并禁掉」。
3. **同步 AC-459 的 expect**（经 goal 写入 ABI：`goal_write` MCP 或 `quay goal write`；⛔ 不手改 `goals/*.md`）。只改写末段这两句，其余逐字保留：

   > 非目标面保持原样并在同一判据中断言其存在：`cloudcli.ai` 域名判定、`cloudcli://auth/callback`、`app_surface=cloudcli_desktop`、旧 appId 拼写 `ai.cloudcli.desktop` 作为 v3.0 迁移常量保留在 `electron/appIdMigration.js` 的 `LEGACY_DESKTOP_APP_ID`（活值 `APP_USER_MODEL_ID` 已是 `ai.cloudpit.desktop`）；零命中扫描不得把 `cloudcli://` 一并禁掉。观测 URI 按 v3.0 R7 只接受 `cloudpit://session|architecture`，旧拼写 `cloudcli://session|architecture` 必须解析为 null（`src/modules/cockpit/tests/observationUri.test.ts` 同钉）。

   `criterion` 一行不改；`goal: GOAL-054`、`status: achieved`、`longTerm: false`、`origin` 原样保留。
4. **复核**：新判据逐字跑绿；临时把双读正则注回一份语法文件时判据必须红在新增断言上（判别性），随后还原；同模块的 `observationUri` 单测仍绿；`quay goal gate AC-459` 写入同树 pass。

### 非目标

- ⛔ 不恢复 `cloudcli://` 双读、不改 `observationUri.ts` / `observation-uri.ts` 的生产行为，不推翻 `cd528d09c` 的 R7。
- ⛔ 不动 AC-459 的四面扫描器、注入负臂、零命中作用域或历史账本断言。
- ⛔ 不 supersede AC-459，不改 GOAL-054 的记录或退出条件，不声明 `long-term: true`。
- ⛔ 不改 v3.0 发布面（checker 默认版本、release notes、workflow）——那属于 `gap-cloudpit-v30-release`。

<!-- dedup-ref -->
相关任务（机制不同，不重复）：`gap-ac459-runtime-identity-surfaces-criterion`（done，写了本判据）与 `gap-goal-054-ac459-identity-surfaces-criterion`（done，同判据的前身）；`gap-cloudpit-v30-identity-contract-removal`（done，执行 R7）与 `gap-cloudpit-v30-appid-switch-migration`（done，执行 R13）是触发本漂移的后来裁定，本任务不重做它们的删除或迁移，也不回滚它们。当前 store 里没有 `todo`/`ready`/`needs-human` 状态且带 `goal_ac: AC-459` 的任务。`task-granularity-advice` 对本任务 Touches 返回 `peers: []`。

## AC

- [ ] AC1 判据文件改钉：`electron/tests/cloudpit-runtime-identity-surfaces.test.mjs` 的 AC4 活体臂不再断言双读（源码中不再出现 `includes('(?:cloudcli|cloudpit)://')` / `includes('cloudcli://session/')`），改为断言两份语法文件含 `^cloudpit://(session|architecture)/` 的接受正则、且不含 `(?:cloudcli|cloudpit)://` 双读分支；同一测试新增读取 `electron/appIdMigration.js` 的 `LEGACY_DESKTOP_APP_ID = 'ai.cloudcli.desktop'`。
- [ ] AC2 AC-459 的 expect 已经 ABI 同步：`quay goal show AC-459 --json`（或 `goal_get`）的 `expect` 含「v3.0 R7 只接受 `cloudpit://」与「`LEGACY_DESKTOP_APP_ID`」，且不再含「观测 URI 双读」；`criterion` 逐字仍为 `npx tsx --tsconfig server/tsconfig.json --test electron/tests/cloudpit-runtime-identity-surfaces.test.mjs`；`status` 仍 `achieved`、`longTerm` 仍 false；`git log -1 -- goals/` 显示由 goal 写入路径提交。
- [ ] AC3 判据逐字跑绿：`npx tsx --tsconfig server/tsconfig.json --test electron/tests/cloudpit-runtime-identity-surfaces.test.mjs` 退出 0，`fail 0`，AC4 与其余 9 条全 pass。
- [ ] AC4 新钉子有判别性（负臂）：临时把 `(?:cloudcli|cloudpit)://` 注回 `src/modules/cockpit-contract/observationUri.ts` 后同一判据退出非 0 并红在新增的「只接受 canonical 拼写」断言上（贴出断言原文）；随后用 `git checkout --` 还原并确认 `git status --short` 对该文件为空。
- [ ] AC5 无回归：`npx vitest run src/modules/cockpit/tests/observationUri.test.ts` 退出 0、fail 0（R7 的 null 钉子仍在）；`npx tsc --noEmit -p server/tsconfig.json` 退出 0。
- [ ] AC6 台账翻绿：`quay goal gate AC-459`（或 `goal_gate` MCP）返回 pass，且 `.quay/gate-events.jsonl` 中 AC-459 最新 `gate: goal` 事件为 `verdict: pass`、`payload.treeSha` 等于 `git rev-parse HEAD^{tree}`。

## DoD

- 贴出写前/写后 `quay goal show AC-459 --json` 的 `criterion`、`expect`、`status`、`longTerm` 四段读数，证明只有 `expect` 变了。
- 贴出 AC3 的完整测试末行（`tests` / `pass` / `fail` 计数）与新增 AC4 断言原文。
- 贴出 AC4 的判别性读数：注回双读后的红断言全文，以及还原后 `git status --short` 对两份语法文件的空输出——证明新钉不是放宽判定。
- 贴出 AC5 两条命令的末行与 AC6 的新 GateEvent 原文（`verdict: pass`、`treeSha` 与 `HEAD^{tree}` 相同）。
- 真实落地判据：AC-459 的记录判据本身变成可复跑且通过，driver 下一轮独立复验拿到 pass；不是「测试改好了」或「四名翻转曾经通过」代替。
- 只改 `electron/tests/cloudpit-runtime-identity-surfaces.test.mjs`、`goals/AC-459-…md`、`tasks/gap-ac459-criterion-stale-v30-identity-pins.md`；不改生产语法文件、不改 GOAL-054、不做任何 v3.0 发布动作。

## Touches

- electron/tests/cloudpit-runtime-identity-surfaces.test.mjs
- goals/AC-459-运行时内部身份面翻转-ipc-contextbridge-broadcastchannel-语义面全局以-cloudpit-为准-旧名零残留.md
- tasks/gap-ac459-criterion-stale-v30-identity-pins.md
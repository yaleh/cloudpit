---
id: gap-goal-054-runtime-identity-surfaces-ac
title: GOAL-054 范围「IPC/bridge/BroadcastChannel/语义面改名」无在域 AC：提议新增运行时内部身份面翻转 AC（建议
  AC-459）
status: needs-human
labels:
  - gap
parent: null
children: []
extra:
  schema: execution
---
## Proposal

选型 **(a)：新增一条 pre-merge AC（建议编号 AC-459），把 GOAL-054 范围里唯一没有任何在域 AC 承载的运行时内部身份面——Electron IPC 通道、contextBridge 暴露名、BroadcastChannel、dev-only 语义面全局——从 `cloudcli-*` 翻到 `cloudpit-*`。** 本任务只提议：⛔ 不写 goal store、⛔ 不改 `goals/*.md`、⛔ 不翻任何 GOAL/AC 状态；AC 编号、入册与 status 由人/被授权的 goal 写入路径裁定。

### 未被覆盖的部分（逐字引用）

GOAL-054 标题逐字为：

> Cloudpit 身份翻转：UI/分发/运行时默认值与桌面身份一次性切换，带兼容回退

其中「运行时默认值……一次性切换」在 goal body 的 `## 范围` 里被展开，逐字引用该条：

> - 运行时默认值：默认数据根 `~/.cloudpit`、settings 新路径、附件新根写入、`CLOUDPIT_*` 成为规范、`cloudpit://` 注册、MCP 新名、OAuth scope 双列、SW 缓存新前缀、IPC/bridge/BroadcastChannel/语义面改名。

`docs/proposals/cloudpit-rename-SPEC.md` §5.5（逐字引用，证明这是已裁定的 2.0.0 交付物）：

> 这些只在同一次发布内自洽，不需要跨版本兼容：
>
> - `cloudcli-desktop:*` → `cloudpit-desktop:*`；
> - `window.cloudcliDesktop` / `cloudcliDesktopNotifications` → `cloudpitDesktop` / `cloudpitDesktopNotifications`；
> - `cloudcli-architecture` → `cloudpit-architecture`；
> - `window.__cloudcliScenario` → `window.__cloudpitScenario`（dev-only；e2e / `scripts/ui-scenario.mjs` 同步）。

### 为何现有在域 AC 集不覆盖它（读数，不是推断）

- **AC-452 的 expect 是封闭列表**：默认根、settings、附件、`cloudpit://`、MCP、OAuth scope、SW 前缀——没有 IPC/bridge/BroadcastChannel/语义面。AC-452 已 `achieved`，而目标分支上这四块仍全是旧名；这本身就是「AC-452 不要求它们」的读数。
- **AC-451 的品牌 allowlist 只针对用户可见的 `CloudCLI` 文案**；这些内部标识符是小写 `cloudcli-` / `__cloudcliScenario`，AC-451 的判据在目标分支上 exit 0 的同时它们仍有 54 处命中。
- **AC-453 的判据** `electron/tests/cloudpit-desktop-identity.test.mjs` 对 `ipc|channel|Broadcast` 零命中（grep 读数），桌面身份迁移不覆盖通道改名。
- **AC-456** 是浏览器预览；**AC-457/AC-458** 是分发/发布核验；均不涉及这些内部面。
- 目标分支 `goal/GOAL-054`（tip `50556466a`）现状读数：
  - `grep -rho 'cloudcli-desktop:[a-z-]*' electron/ | wc -l` = **54**；`grep -rho 'cloudpit-desktop:[a-z-]*' electron/ src/ | wc -l` = **0**。
  - `electron/main.js:729-777` 是 23 个 `ipcMain.handle('cloudcli-desktop:*')`；`electron/preload.cjs:17,19,25-57` 的 invoke/on 全为旧名，`contextBridge.exposeInMainWorld` 暴露 `cloudcliDesktopNotifications`（:24）与 `cloudcliDesktop`（:32）；`electron/desktopWindow.js:118,121,127,132` 的 `webContents.send` 仍是旧名；`electron/launcher/launcher.js:89` 仍读 `window.cloudcliDesktop`。
  - `src/modules/architecture/architectureChatBridge.ts:33` 为 `ARCHITECTURE_CHAT_CHANNEL = 'cloudcli-architecture'`。
  - `src/modules/ui-scenario/scenarioSurface.ts:769` 安装 `window.__cloudcliScenario`（`src/main.tsx:27` 注释、`scripts/ui-scenario.mjs:635,645,660` 读同一旧名）；`__cloudpitScenario` 全仓 **0** 命中。
- 结论：范围里这四块是 2.0.0 必须完成的身份翻转，但当前在域 AC 集没有任何一条要求它。判官按 `## 范围` 判 AC 集完整性时，这是结构性缺口。

<!-- dedup-ref -->

已核对的相邻任务（机制不同，不重复）：`gap-cloudpit-runtime-default-flip`（AC-452 实现，body 全文无 IPC/bridge/BroadcastChannel/语义面）、`architecture-standalone-page`（引入 BroadcastChannel 做架构页跨标签通信，非改名）、`gap-goal-054-postmerge-verification-in-scope-ac`（已采纳为 AC-458，post-merge 发布核验，机制不同）。合并候选检查 `task-granularity-advice --touches … --json` 对下列 Touches 返回 `peers: []`；kept separate: 独立验收（运行时内部身份面 vs 发布状态）。

### 候选新 AC（建议 AC-459，编号待人工分配）

**AC-459：运行时内部身份面翻转：IPC/contextBridge/BroadcastChannel/语义面全局以 cloudpit- 为准，旧名零残留**

- `goal: GOAL-054`、`phase: pre-merge`、**创建时即 `status: active`**（不是 draft→active 的转型写；理由见下）。
- `criterion`（runnable）：

  ```
  npx tsx --tsconfig server/tsconfig.json --test electron/tests/cloudpit-runtime-identity-surfaces.test.mjs
  ```

- `expect`：
  Electron IPC 通道全部为 `cloudpit-desktop:*`（`electron/main.js` 的 `ipcMain` 注册、`electron/preload.cjs` 的 `invoke`/`on`、`electron/desktopWindow.js` 的 `webContents.send` 三处一致），仓库内 `cloudcli-desktop:` 零命中；contextBridge 只暴露 `cloudpitDesktop` / `cloudpitDesktopNotifications`，`electron/launcher/launcher.js` 消费新名，旧 `cloudcliDesktop*` 零命中；架构独立页与工作区标签页的 BroadcastChannel 为 `cloudpit-architecture`，`cloudcli-architecture` 零命中；dev-only 语义面为 `window.__cloudpitScenario`，`src/main.tsx` / `src/modules/ui-scenario/scenarioSurface.ts` / `scripts/ui-scenario.mjs` 同步新名，`__cloudcliScenario` 零命中。非目标面保持原样、本 AC 不得改动：`cloudcli.ai` 域名判定、`cloudcli://auth/callback`、`app_surface=cloudcli_desktop`、appId `ai.cloudcli.desktop`，以及 AC-452 已管的 `cloudcli://` 观测 URI 双读。取假形态：任一面仍残留旧名、或同一判据对注入一条 `cloudcli-desktop:` / `__cloudcliScenario` 的合成读数不变红、或把上述非目标面一并改掉，均红。

- **为什么创建即 active**：本 goal 的既有 AC（AC-451/452/453/456/457/458）都是创建即 active；draft→active 的转型写会被 goal 能力闸按**工作区根**判定载体，而新判据文件只在 goal 分支上存在，路径与 AC-454 被拒的根因同形（见 `gap-goal-054-postmerge-verification-in-scope-ac` 的读数）。创建即 active 不进转型闸，且能让这条 AC 立刻进入判官输入与 `unmetPreMergeAcs`，在实现落地前挡住 `quay goal merge`——这正是「一次性切换」要的原子性。

### 为什么它覆盖这个缺口

- AC-459 的 expect 逐项对应 §5.5 的四个面，也就是范围里的「IPC/bridge/BroadcastChannel/语义面改名」。
- criterion 是目标分支上的真实文件，producer/consumer 全部点名，并带两条负臂（注入旧名必红；非目标面不得被误改），因此「检查器不变红」也有判据。
- `phase: pre-merge` 使它在实现落地前进入 pre-merge 未达成集合，而不是只在判官输入里出现。

### 为什么选 (a) 而不是 (b)

退出条件/范围没有要求过多：§5.5 明确写这四面「2.0.0 即完成」，兼容矩阵第 18–20 行也标为 R（rename，随包同发无兼容）。删弱这条范围等于让 goal 在旧内部身份下 merge，违背已裁定的 2.0.0 身份翻转。缺的是 AC，不是要求。

### 相邻读数（不在本提案内）

范围里另一条没写进任何 AC `expect` 的是「CLI 自更新与 system update 命令改新包」。读数：该行为已由 AC-451 的判据文件 `scripts/brand-allowlist-check.test.mjs` 的 AC3 臂断言（`npm show @yalehwang/cloudpit version`、`npm update -g @yalehwang/cloudpit`、12 个 locale 的 `npmUpgradeCommand`），只是没有写进 AC-451 的 `expect` 文本。本提案不新增第二条 AC、不改 AC-451 文本；此处只记录读数，供人判断。

### 边界

本提案不执行实现、不改任何源码、不改 `goals/*.md`、不翻任何状态、不分配 AC 编号；⛔ 不修改 AC-451/452/453/456/457/458 的 criterion/expect。

## Resolution

**人 yale 2026-11-01 经会话裁定：采纳本提案 (a)——新增一条 pre-merge AC（建议 AC-459），但 `expect` 按本节「入册文本」执行，不逐字采用 Proposal 原文。** 本裁定不写 goal store、不改 `goals/*.md`、不翻任何 GOAL/AC 状态；AC-459 的编号确认、创建与 status 由被授权的 goal 写入路径完成。本任务停在 `needs-human`，不被当执行任务派发。

### 裁定依据（复核于 `goal/GOAL-054` tip `50556466a`，不是照抄提案）

- **缺口成立**：GOAL-054 `## 范围` 含「IPC/bridge/BroadcastChannel/语义面改名」；spec 兼容矩阵第 18–20 行标 R /「2.0.0 即完成」。活代码面仍有 `cloudcli-desktop:` 54 处（`main.js` 23 个 `ipcMain.handle`、`preload.cjs` 27 处 `invoke`/`on`、`desktopWindow.js` 4 处 `send`），`cloudpit-desktop:` 0 处。
- **现有在域 AC 不覆盖**：AC-452 的 `expect` 是封闭列表且已 `achieved`；AC-451 的 brand allowlist 检查器对这些内部名零命中；AC-453 的判据文件对 `ipc|channel|Broadcast` 零命中；AC-456/457/458 是浏览器预览 / 分发核验，面不同。在域 AC 共 6 条（451/452/453/456/457/458；AC-454 已 `superseded`）。
- **判官读数一致**：最近一轮 `.quay/goal-round.jsonl` 的 GOAL-054 `sufficiency.verdict` = `insufficient`，gap agent 的 stdout 正是为这个缺口立的本任务。
- **编号与形态可行**：AC-459 在当前全部分支上未被占用（现有最高 458）；创建即 `active` 有 AC-458 先例（draft→active 转型闸按工作区根判定载体，而判据文件只在 goal 分支存在）。

### 入册时必须采用的修订（4 点；被取代的仅限 Proposal 的 `expect` 文本）

1. **零命中作用域改为活代码面**：`electron/`、`src/`、`scripts/`、`e2e/`、`AGENTS.md`。历史账本（`tasks/`、`goals/`、`adr/`、`experiments/`、`docs/proposals/`、`CHANGELOG`）按 GOAL-054 非目标「不改历史账本」排除。
   - 原因：Proposal 的「仓库内零命中」与 goal 非目标直接冲突。`docs/proposals/cloudpit-rename-SPEC.md` 含 `cloudcli-desktop:` ×2、`__cloudcliScenario` ×2、`cloudcli-architecture` ×2；`tasks/` 下 12 个文件含 `__cloudcliScenario`。逐字执行只能靠改写历史账本，或让 AC 永远红。
   - 同时纠正提案读数：`__cloudpitScenario` 在代码内 0 命中，在 spec 文档内 2 处；Proposal 的「全仓 0 命中」不准确。
2. **补齐活消费者**：`__cloudcliScenario` 除 `src/main.tsx` / `scenarioSurface.ts` / `scripts/ui-scenario.mjs` 外，还有 `src/modules/ui-scenario/index.ts:6`、`src/modules/ui-scenario/tests/scenarioSurface.test.ts`、`src/modules/ui-scenario/tests/cockpitCardsSurface.test.ts`、`e2e/ui-scenario-runner.spec.ts`、`e2e/scenarios/quay-wall-focus-pin-utter.json`、`AGENTS.md:18`；contextBridge 旧名消费者除 `electron/launcher/launcher.js:89` 外，还有 `src/modules/settings/Settings.tsx:44`、`src/modules/settings/hooks/useWebPush.ts:28`。criterion 按活代码根扫描，`expect` 把上述文件列为预期同步面。
3. **注入 / 自匹配机制写明**：判据文件自身不得进入零命中扫描。扫描器接受可注入 root：正臂扫 worktree 活根，负臂在 `tmp/` 夹具上跑；旧名字面量由常量拼接或置于夹具数据。否则零命中要么被自命中永久打红，要么靠排除自身削弱负臂。
4. **非目标面改为正断言**：`cloudcli.ai` 域名判定、`cloudcli://auth/callback`、`app_surface=cloudcli_desktop`、appId `ai.cloudcli.desktop` 必须在同一判据中断言其存在。注意 AC-452 的 `cloudcli://` 观测 URI 是双读，零命中扫描不得顺手禁掉 `cloudcli://`。

### 入册文本（AC-459，供被授权的 goal 写入路径逐字使用）

- `goal: GOAL-054`、`kind: criterion`、`status: active`（创建即 active，不走 draft→active）、`phase: pre-merge`
- `criterion`：

  ```
  npx tsx --tsconfig server/tsconfig.json --test electron/tests/cloudpit-runtime-identity-surfaces.test.mjs
  ```

- `expect`（修订后，取代 Proposal 原文的 `expect`）：

  ```
  Electron IPC 通道全部为 `cloudpit-desktop:*`（`electron/main.js` 的 `ipcMain` 注册、`electron/preload.cjs` 的 `invoke`/`on`、`electron/desktopWindow.js` 的 `webContents.send` 三处一致）；contextBridge 只暴露 `cloudpitDesktop` / `cloudpitDesktopNotifications`；架构独立页与工作区标签页的 BroadcastChannel 为 `cloudpit-architecture`；dev-only 语义面为 `window.__cloudpitScenario`。旧名 `cloudcli-desktop:`、`cloudcliDesktop*`、`cloudcli-architecture`、`__cloudcliScenario` 在活代码面（`electron/`、`src/`、`scripts/`、`e2e/`、`AGENTS.md`）零命中；历史账本（`tasks/`、`goals/`、`adr/`、`experiments/`、`docs/proposals/`、`CHANGELOG`）按 GOAL-054 非目标排除。语义面同步面包括 `src/main.tsx`、`src/modules/ui-scenario/scenarioSurface.ts`、`src/modules/ui-scenario/index.ts`、`src/modules/ui-scenario/tests/scenarioSurface.test.ts`、`src/modules/ui-scenario/tests/cockpitCardsSurface.test.ts`、`scripts/ui-scenario.mjs`、`e2e/ui-scenario-runner.spec.ts`、`e2e/scenarios/quay-wall-focus-pin-utter.json`、`AGENTS.md`；contextBridge 新名消费面包括 `electron/launcher/launcher.js`、`src/modules/settings/Settings.tsx`、`src/modules/settings/hooks/useWebPush.ts`。判据扫描器接受可注入 root：正臂对 worktree 活代码根取证，负臂在 `tmp/` 夹具（旧名由常量拼接或置于夹具数据，判据文件自身不进入扫描）上验证，注入一条 `cloudcli-desktop:` / `__cloudcliScenario` 必须变红。非目标面保持原样并在同一判据中断言其存在：`cloudcli.ai` 域名判定、`cloudcli://auth/callback`、`app_surface=cloudcli_desktop`、appId `ai.cloudcli.desktop`，以及 AC-452 已管的 `cloudcli://` 观测 URI 双读；零命中扫描不得把 `cloudcli://` 一并禁掉。取假形态：活代码面任一面仍残留旧名、或同一判据对注入旧名的合成读数不变红、或把上述非目标面一并改掉（包括为凑零命中而改写历史账本），均红。
  ```

### 状态

- 本节闭合 AC1；AC2 已由授权 goal 写入路径闭合：AC-459 创建于 commit `84bf33894`（`goals/AC-459-运行时内部身份面翻转-ipc-contextbridge-broadcastchannel-语义面全局以-cloudpi.md`，`status: active`、`phase: pre-merge`，criterion 逐字一致，`expect` 读回与入册文本相同）。
- 同批收口：AC-452 的 expect 去掉 `；IPC/bridge/BroadcastChannel/语义面改新名`（commit `464123e15`，status 仍 `achieved`），GOAL-054 `## 范围` 拆成「运行时默认值（AC-452）」与「运行时内部身份面（AC-459）」（commit `5e6746365`）。
- AC3/AC4/AC5 已按下方收口读数闭合；判官 verdict 会 flap（round 10–15 在 AC-459 入册前已判 `covered`），故 AC4 以连续两轮读数为准。
- 2026-11-01 15:05 UTC 收口：AC-459 已 `achieved`（evidence `pass` @ 15:02:42）；判据 `electron/tests/cloudpit-runtime-identity-surfaces.test.mjs` 在 goal worktree 实跑 `tests 10 / pass 10 / fail 0`；round 25 的 in-scope 列表含 AC-459 且 `verdict=covered`；round 22–24 AC-459 为 `active/fail` 且不在 `phaseSplit.excluded`，证明实现前确实挡 merge。四面改名在 `goal/GOAL-054`：`cloudcli-desktop:` 0 / `cloudpit-desktop:` 54，`__cloudcliScenario` 活代码 0 / `__cloudpitScenario` 9。剩余只有人触发的 `quay goal merge` 与 post-merge AC-458。

### 收口读数（2026-11-01）

- 判据口径：`npx tsx --tsconfig server/tsconfig.json --test electron/tests/cloudpit-runtime-identity-surfaces.test.mjs` → `tests 10 / pass 10 / fail 0`（goal worktree，`duration_ms 1813`）。
- 判据内容含：注入旧名（`cloudcli-desktop:` / `__cloudcliScenario`）必红、非目标面（`cloudcli.ai` / `cloudcli://auth/callback` / `app_surface=cloudcli_desktop` / `ai.cloudcli.desktop` / `cloudcli://` 双读）正断言、历史账本不被扫描也不被改写、扫描根排除 `tasks/ goals/ adr/ experiments/ docs/proposals/ CHANGELOG`。
- 改名的独立实现任务：`gap-goal-054-ac451-ac452-false-form-legs-unverified-by-criterion`（done，提交 `6b2d6407f`）与 `gap-goal-054-ac459-identity-surfaces-criterion`（done，提交 `853d307bf`/`08685f783`）；本任务自身的判据任务 `gap-ac459-runtime-identity-surfaces-criterion` 也已完成（`577580bef`）。三条汇入 `goal/GOAL-054`，goal tip `577580bef`。
- GOAL-054 剩余：`quay goal merge`（branch-mode 发布顺序第 4 步，由人触发）；AC-458 是 merge 后的发布核验。

## AC

- [x] AC1: 人裁定写回 `## Resolution`：采纳本提案 (a)，或明确否决并给出理由；本任务停在 `needs-human`，不被当执行任务派发（待外部：人 yale 裁定）。
- [x] AC2: 若采纳：`quay goal show AC-459 --json` 显示 `goal: GOAL-054`、`status: active`、`phase: pre-merge`，`criterion` 逐字为 `npx tsx --tsconfig server/tsconfig.json --test electron/tests/cloudpit-runtime-identity-surfaces.test.mjs`，`expect` 与 `## Resolution` 的入册文本逐字一致（已创建：commit `84bf33894`；读回 `expect_matches=true`）。
- [x] AC3: 若采纳：目标分支上该 criterion exit 0，且同一判据对注入旧名的合成读数变红、对非目标面（`cloudcli.ai` / appId / `cloudcli://auth/callback`）保持不变（已满足：goal worktree `tests 10 / pass 10 / fail 0`；注入负臂与变异红/绿见 `gap-goal-054-ac459-identity-surfaces-criterion` 的 AC3/AC7；round 25 `AC-459 pass`）。
- [x] AC4: 采纳后的第一个完整 goal 轮：`.quay/goal-round.jsonl` 的 GOAL-054 记录里 In-scope AC 列表含 AC-459（在域 AC ≥7），且 `goal-sufficiency.verdict` 为 `covered`（已满足：round 24 与 round 25 连续两轮 in-scope 含 AC-459，均 `covered`；round 25 `AC-459 pass`）。
- [x] AC5: 同一轮的 pre-merge 未达成读数（`unmetPreMergeAcs` 或等价字段）含 AC-459，证明它在实现前真实挡住 merge（已满足：round 22–24 的 `criteria` 里 AC-459 为 `active/fail` 且不在 `phaseSplit.excluded`，即 pre-merge 未达成集合）。

## DoD

本提案被裁定后，范围的覆盖必须用**台账读数**证明，而不是「AC 文件存在」：采纳时，`.quay/goal-round.jsonl` 的同一 GOAL-054 记录里，在域 AC 从 6 条变 ≥7 条且列表含 AC-459、`goal-sufficiency.verdict` 为 `covered`（连续两轮稳定，不以单轮为准：判官在 AC-459 入册前已因并发的纸面 expect 扩写判过 `covered`）、且 AC-459 以 `phase: pre-merge` 出现在未达成集合里——三者在同一轮记录里同时成立才算闭合；实现落地后 AC-459 离开未达成集合、其 criterion exit 0。若人否决，必须在 `## Resolution` 写出否决理由，并说明改用哪条 AC 或哪段退出条件/范围文本承载这四块内部身份面；本任务不得以「已提议」完结。

## Touches

- tasks/gap-goal-054-runtime-identity-surfaces-ac.md
- goals/AC-459-运行时内部身份面翻转-ipc-contextbridge-broadcastchannel-语义面全局以-cloudpi.md (new, created via authorized goal write)
- goals/AC-452-运行时默认值翻转与兼容-默认新根-新设置-新附件写入-协议与-scope-mcp-sw-双接受.md (expect 去掉 IPC leg)
- goals/GOAL-054-cloudpit-身份翻转-ui-分发-运行时默认值与桌面身份一次性切换-带兼容回退.md (## 范围 拆分)
- electron/tests/cloudpit-runtime-identity-surfaces.test.mjs (new, AC-459 criterion)
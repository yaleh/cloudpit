---
id: gap-goal-054-runtime-identity-surfaces-ac
title: GOAL-054 范围「IPC/bridge/BroadcastChannel/语义面改名」无在域 AC：提议新增运行时内部身份面翻转 AC（建议
  AC-459）
status: todo
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

## AC

- [ ] AC1: 人裁定写回 `## Resolution`：采纳本提案 (a)，或明确否决并给出理由；本任务停在 `needs-human`，不被当执行任务派发（待外部：人 yale 裁定）。
- [ ] AC2: 若采纳：`quay goal show AC-459 --json` 显示 `goal: GOAL-054`、`status: active`、`phase: pre-merge`，`criterion` 逐字为 `npx tsx --tsconfig server/tsconfig.json --test electron/tests/cloudpit-runtime-identity-surfaces.test.mjs`，`expect` 与本提案逐字一致（待外部：由被授权的 goal 写入路径创建）。
- [ ] AC3: 若采纳：目标分支上该 criterion exit 0，且同一判据对注入旧名的合成读数变红、对非目标面（`cloudcli.ai` / appId / `cloudcli://auth/callback`）保持不变（待外部：需实现任务先落地）。
- [ ] AC4: 采纳后的第一个完整 goal 轮：`.quay/goal-round.jsonl` 的 GOAL-054 记录里 `goal-sufficiency.verdict` 翻 `covered`，且 In-scope AC 列表含 AC-459（待外部：driver 跑一轮）。
- [ ] AC5: 同一轮的 pre-merge 未达成读数（`unmetPreMergeAcs` 或等价字段）含 AC-459，证明它在实现前真实挡住 merge，而不是只在判官输入里凑数（待外部：driver 跑一轮）。

## DoD

本提案被裁定后，范围的覆盖必须用**台账读数**证明，而不是「AC 文件存在」：采纳时，`.quay/goal-round.jsonl` 的同一 GOAL-054 记录里，在域 AC 从 6 条变 ≥7 条、`goal-sufficiency.verdict` 由 `insufficient` 翻 `covered`、且 AC-459 以 `phase: pre-merge` 出现在未达成集合里——三者必须在同一轮记录里同时成立才算闭合。若人否决，必须在 `## Resolution` 写出否决理由，并说明改用哪条 AC 或哪段退出条件/范围文本承载这四块内部身份面；本任务不得以「已提议」完结。

## Touches

- tasks/gap-goal-054-runtime-identity-surfaces-ac.md
- goals/AC-459-cloudpit-runtime-identity-surfaces.md
- electron/tests/cloudpit-runtime-identity-surfaces.test.mjs (new, AC-459 criterion)
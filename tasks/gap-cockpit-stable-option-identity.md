---
id: gap-cockpit-stable-option-identity
title: 选项身份稳定：id 由标签派生、卡片带 contentRevision、已发出但选项已变时标明并禁用重发
status: done
labels:
  - gap
  - cockpit
parent: null
children: []
extra: {}
depends_on:
  - gap-cockpit-ask-content-anchored-by-askid
  - gap-cockpit-card-sent-state-single-line
---
## Proposal

来源：2026-10-29 驾驶舱线上审查（MCP 浏览器，只读）。截图 `tmp/cockpit-audit2/04-mobile-mismatch.png`。

已复现的缺陷：**选项身份不稳定，卡片自己都说不清人发了什么。**

三张卡正在线上同时显示「已发出 `是`」，而它们**根本没有“是”这个选项**：

| 卡片 | 本地回执记的选项 | 卡片现在的选项 |
|---|---|---|
| `att_7f04bb456ab0` | `optionId: yes` / 标签「是」 | `1` / `2` |
| `att_e3e02b26dac5` | `yes` / 「是」 | `opt-baseline-first` / `opt-retreat-promote` |
| `att_9cbf4d2ee785` | `yes` / 「是」 | `opt-baseline-first` / `opt-retreat-promote` |

原因有两条：

1. **选项 id 由模型自由生成。** 摘要把模型输出的选项 id 原样带上线（同一条提问重算一次，id 可能从 `yes` 变成 `1` 再变成 `opt-baseline-first`），而本地回执与 fleet 的反馈调用都用这个 id 作身份。
2. **卡片的 revision 不覆盖摘要。** `revision` 来自 fleet 条目（只反映 fleet 自己的内容），摘要变了 revision 不变，界面无从知道「这张卡的内容换了」。

后果：人看不到自己到底发了什么；重发时拿旧 id 去调 `fleet.feedback`，多半被拒；fleet 侧也可能因此收不到（今天 06:08/06:41 四次调用在 fleet 的 `decisions.jsonl` 里没有记录，两次成功的都在更早）。

做什么：

1. **选项 id 稳定化（服务端）**：摘要归一化时把模型给的 id 换成**由标签派生**的稳定值 `opt-<sha1(规范化标签) 前 8 位>`；规范化 = 去首尾空白 + 压缩连续空白。同一标签在任何一次重算里得到同一 id；同一次输出里标签重复时追加 `-2`、`-3` 保证唯一。模型给的 id 只作为提示，不上线。
2. **内容版本上线**：`CockpitCard` 增加只读字段 `contentRevision?: number` = 该卡所引用那份摘要的 revision；fleet 的 `revision` 语义不变（确认与反馈仍用它）。前端把「显示项/下拉/展开状态」的键改为 `(revision, contentRevision)`，摘要一变就复位。
3. **已发出但选项已不在**：本地回执记录里保存发送时的 `optionId` 与 `contentRevision`；读卡时若 `optionId` 不在当前 `options[].id` 里，状态行改为「已发出：〈当时的标签〉（该选项已不在当前卡片）」，并把「重发」禁用且给出原因「选项已变化，重发会被拒；去会话里看或选新选项」。
4. **不再用旧标签冒充当前选择**：选项已变化时，卡片不得在任何位置（按钮、状态行、详情）把旧标签当成当前选中项显示。

## AC

- [x] `npx tsx --tsconfig server/tsconfig.json --test server/modules/observation/tests/session-ask-decision-digest.test.ts` 退出 0，新增用例：同一组选项以不同顺序出现两次，id 逐一相同；标签改一个字即得不同 id；同一输出里两条标签相同 ⇒ id 分别为 `opt-x` 与 `opt-x-2`；模型给的 `id` 不出现在写出的决策里。
- [x] `npx tsx --tsconfig server/tsconfig.json --test server/modules/cockpit/tests/cockpit-fleet-card-provider.test.ts` 退出 0，新增用例：同一 fleet 条目在摘要重算前后，`revision` 不变而 `contentRevision` 递增；两端的 `contentRevision` 与摘要存储里的 revision 相等。
- [x] `npx vitest run src/modules/cockpit/tests/cockpitCardFeedback.test.ts` 退出 0，新增用例：回执的 `optionId` 不在当前选项里时，状态行含「（该选项已不在当前卡片）」且「重发」为 disabled 并给出原因；`optionId` 仍在时行为不变；卡片任何位置都不出现「旧标签 = 当前选中」的组合。
- [x] `npx vitest run src/shared/tests/cockpitCardTypeSync.test.ts` 退出 0（`contentRevision` 两端一致）；`npx vitest run src/modules/cockpit/tests/i18nCockpitCompleteness.test.ts` 退出 0。
- [x] 假形态变红：把选项 id 改回「模型给什么用什么」⇒ 第一条用例红；把「选项已不在」的判断删掉 ⇒ 第三条用例红；改完即还原。
- [x] `npx tsx --tsconfig server/tsconfig.json --test server/shared/tests/server-import-cycle-budget.test.ts`、`npx tsx --tsconfig server/tsconfig.json --test server/shared/tests/architecture-ratchet.test.ts` 退出 0；`npm run typecheck`、`npm run lint` 退出 0（lint 仅既有 warning）；两个 `types.ts` 的增长按 RECORDED CHANGE 记录。
- [x] 解 suite 红灯（上一轮 exited-not-landed 的唯一失败）：`npx tsx --tsconfig server/tsconfig.json --test server/modules/session-hosts/tests/resident-server-restart.test.ts` 退出 0（本机 5/5 通过，20.4s；`sigterm-killed killed=5 spared=1`，`gone-after-ms=887 closeReason=server-shutdown`）。真因不在本任务 delta：`processTable()` 用 `spawnSync('ps', …)` 读表而 `ps` 输出 1.22 MB（5736 进程）超过 1 MiB 默认 `maxBuffer` ⇒ `ENOBUFS` ⇒ 进程表读成 `[]` ⇒ 组信号杀 0 个进程、服务器从未被停。修法：`maxBuffer` 提到 64 MiB，读失败显式抛错（不再用空表冒充「没有这个进程」），并加 AC1c 正向控制（表里必须含本进程）。

## DoD

隔离实例（关 residentRestore；fleet home 指向临时副本；只点夹具卡片）：

1. 夹具摘要第一次给出 `yes/no`，确认「是」并让反馈不回执（保持已发出）；再把同一会话的摘要改成另一组选项并触发重读：截图状态行显示「已发出：是（该选项已不在当前卡片）」且「重发」禁用，贴出 `contentRevision` 前后读数。
2. 同一条提问用同一组选项重算两次（顺序打乱）：贴出两次的 `options[].id` 完全一致。
3. 手机宽（390）与 PC 宽（1600）各一组截图，存 `tmp/`；若存在可用场景，同时跑 `node scripts/ui-scenario.mjs <scenario.json>` 并贴出 JSON 报告。

## Touches

- tasks/gap-cockpit-stable-option-identity.md
- server/modules/observation/session-ask-decision-digest.ts
- server/modules/observation/tests/session-ask-decision-digest.test.ts
- server/modules/observation/tests/session-ask-judge-default.test.ts
- server/modules/cockpit/cockpit-fleet-card-projection.ts
- server/modules/cockpit/tests/cockpit-fleet-card-provider.test.ts
- server/modules/cockpit/cockpit-card-actions.ts
- server/modules/cockpit/cockpit-card-feedback-store.ts
- server/shared/types.ts
- src/shared/types.ts
- src/shared/tests/cockpitCardTypeSync.test.ts
- src/modules/cockpit/cockpitCardFeedback.ts
- src/modules/cockpit/cockpitCardController.ts
- src/modules/cockpit/CockpitCard.tsx
- src/modules/cockpit/tests/cockpitCardFeedback.test.ts
- src/modules/cockpit/tests/CockpitCard.test.tsx
- src/modules/i18n/locales/en/common.json
- src/modules/i18n/locales/zh-CN/common.json
- src/modules/i18n/locales/zh-TW/common.json
- src/modules/i18n/locales/de/common.json
- src/modules/i18n/locales/es/common.json
- src/modules/i18n/locales/fr/common.json
- src/modules/i18n/locales/id/common.json
- src/modules/i18n/locales/it/common.json
- src/modules/i18n/locales/ja/common.json
- src/modules/i18n/locales/ko/common.json
- src/modules/i18n/locales/ru/common.json
- src/modules/i18n/locales/tr/common.json
- server/shared/tests/architecture-ratchet.baseline.json
- server/modules/session-hosts/tests/resident-server-restart.test.ts

## 暗轴记录（ADR-007）

- L_G ratchet: oversizeFiles=77 moduleMutableState=112 hookStateHeavy=6 providerNameBranches=27 smallHelperCopies=6

读数出自 `npx tsx --tsconfig server/tsconfig.json --test server/shared/tests/architecture-ratchet.test.ts` 本任务树上打印的五行；L_D 本轮没有接入可量化的探针，故只记 L_G。

## Evidence

### 上一轮 suite 红灯的真因（2026-10-29T10:18:51 exited-not-landed 的唯一失败项）

- 失败文件：`server/modules/session-hosts/tests/resident-server-restart.test.ts`，`Timed out after 20000ms waiting for pid 3247745 to leave after SIGTERM`（suite 日志里同一文件 rerun 也红）。
- 单独重跑同一命令即可复现（不是 lane 负载抖动）：`sigterm-killed killed=0 spared=1`，服务器进程组一个都没被杀。
- 实测读数：`ps -eo pid=,pgid=,ppid=,args=` 输出 **1,216,228 字节 / 5736 行**；`node -e` 用默认参数 `spawnSync` 复读得到 `status null error ENOBUFS stdoutLen 1052230`。默认 `maxBuffer` = 1 MiB，`processTable()` 的 `if (result.status !== 0 || !result.stdout) return []` 把读失败静默变成空表。
- 空表的后果是**空洞的杀**：`signalServiceGroup` 在空表上 `killed=0`，SIGTERM 从未到达服务器，resident CLI 当然 20s 不走；清理路径（`stop('SIGKILL', null)`）同样杀不掉，于是每次失败还泄漏一整棵 `npm exec → sh → tsx → node server/index.ts` 进程树。
- 与本任务 delta 的关系：该文件不在本任务 3 个提交的 diff 里，与 develop 上的版本逐字节相同，结论是环境规模触发（进程表大小），非本任务改动引入；但它是 fan-in suite 的确定性红灯，必须在此轮解决。
- 修法（本分支提交 `session-hosts: file-read the ps table with headroom, not a silent empty table`）：`PS_MAX_BUFFER_BYTES = 64 MiB` 传入 `spawnSync`；读失败（`result.error` / 非零退出 / 空 stdout）改为抛出，不再返回 `[]`；新增 AC1c 正向控制，要求读到的表里含本进程 pid。

### 修后读数

- `npx tsx --tsconfig server/tsconfig.json --test server/modules/session-hosts/tests/resident-server-restart.test.ts`：`tests 5 / pass 5 / fail 0 / duration_ms 20451`，退出 0。
- SIGTERM 腿：`sigterm-killed killed=5 spared=1`、`sigterm resident-pid=… gone-after-ms=887 closeReason=server-shutdown`。
- SIGKILL 腿：`sigkill survivor=true killed=4 spared=1`、`sigkill-residue … swept=1`、`sigkill-reaped … alive-after-sweep=false`。
- `npx tsc --noEmit -p server/tsconfig.json` 退出 0；`npx oxlint server/modules/session-hosts/tests/resident-server-restart.test.ts` 无告警。
- 手工清理了此前失败轮次在本 worktree 留下的 4 棵孤儿服务器进程树（pgid 272116 / 2568311 / 3238122 / 3868381，均已 re-parent 到 systemd --user），避免下一轮 suite 被判为 leaked-process。

## Blocker

**2026-10-29T10:18:51.624Z — worker 未落地（exited-not-landed）**

- 未落地原因：step=suite: __PERFILE__ duration_ms=240830 server/modules/session-hosts/tests/resident-server-restart.test.ts passed=false end_ms=1793267930269
- run_id：wk-prod-anchor
- session_id：38ff39ef-9b21-45a2-a3ad-a39fc25c11dd
- 本轮处置：已按上文 Evidence 定位并修复真因（ps 表 ENOBUFS），同一文件本机 5/5 通过。

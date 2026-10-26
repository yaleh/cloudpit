---
id: gap-ac164-turn-seam-missing-from-addressable-fixture
title: AC-164 地址判据在锚点环境（RESIDENT_RUN_IS_TURN=1）红：判据夹具只装了组合根两条 run 缝中的
  setUnattendedRunOpener，跨会话送达因此打不开无人轮；地址四腿本身全绿
status: ready
labels:
  - gap
  - defect
parent: null
children: []
extra:
  schema: execution
goal_ac: AC-164
---
## Proposal

**红态基线（本轮直跑，两次对照，不是台账尾巴）**

本机锚点继承了线上服务 drop-in `40-resident-run-is-turn.conf` 的环境：`RESIDENT_RUN_IS_TURN=1`。`scripts/test.sh:82` 会 unset 它，但 goal gate 是逐字执行判据命令、不经过 test.sh，所以判据在锚点环境里看到的是 flag-on 世界。

命令逐字：`npx tsx --tsconfig server/tsconfig.json --test server/modules/providers/tests/claude-resident-addressable.test.ts`

- 继承环境（`RESIDENT_RUN_IS_TURN=1`）：退出 **1**、`fail 1`，红在 `...test.ts:1495` 的 `AssertionError: the arriving message must open a run on the addressed session`。读数原文：`booted=true bootExits=0,0,0`；A/B/C 三条 `registryNameSource=derived ... snapshotPeerName==registryName ... equalToSnapshot=true selfWrittenNames=[]`；handed-over 控制 `registryNameSource=user snapshotPeerName=<handed-over>`；`sendMessageInToolTable=true`；`sentTo=<B 的 derived 名> delivered=true sendExit=0`；`waitFor timed out after 15000ms: B to open a run for the arriving message`；`run.source=none run.trigger=null runsBefore=0 runsAfter=0`；`buffered=false replayLanded=false opened=false`。
- 同一命令加 `env -u RESIDENT_RUN_IS_TURN`：退出 **0**；`run.source=unattended run.trigger=cross-session-message runsBefore=0 runsAfter=1`、`replayed=9 produced=9`、`opened=true`。

⇒ 地址与读回四腿本身全绿；红的是「跨会话送达 ⇒ 目标会话开一条无人 run」，且只在 flag-on 世界发生。

**机制（逐行可查）**

1. driver 选缝：`server/modules/providers/list/claude/claude-host-driver.provider.ts:5018` —— `residentRunIsTurn() ? this.host.openTurn({... kind: 'unattended'}) : this.host.openUnattendedRun({...})`。
2. manager 有两条互相独立的可选缝：`server/modules/session-hosts/session-host-manager.service.ts:1585 setUnattendedRunOpener`、`:1613 setTurnOpener`；没装的那条返回 `null`，driver 把 `null` 当作「照旧不建 run」。
3. 生产组合根两条都装：`server/index.ts:1621` 与 `:1630`。
4. 本判据的夹具只装了第一条：`server/modules/providers/tests/claude-resident-addressable.test.ts:895`，teardown 也只清它（`:915`）。flag-on 时 `openTurn` 无 opener ⇒ 返回 `null` ⇒ 乙的到达轮不建 run。
5. 第二条 seam 由 `0af347562`（AC-382 run 即 turn）引入，晚于本判据首次落地（`b7fa4d0ed`），夹具一直没跟上。

**为什么先前 done 的修复没有保持**

`gap-claude-resident-addressable`（done，`goal_ac: AC-164`）落了 derived 名读回与投影，当时判据在 flag-off 世界是绿的；`scripts/test.sh` 全局 unset 该 flag，所以全套 suite 也一直绿。只有 goal gate 逐字跑判据、环境里带着线上 flag-on 时才暴露。同族夹具 `gap-ac162-unattended-background-trigger-red`（done 2026-10-26，`a43042416`）今天已经补过完全相同的两条 seam；本判据夹具被漏掉了。

<!-- dedup-ref --> 机制去重与相邻关系：全库 `grep -lE '^goal_ac: *AC-164' tasks/*.md` 只有 `tasks/gap-claude-resident-addressable.md`（done），没有 todo/ready/needs-human 的认领者；`grep -lF 'RESIDENT_RUN_IS_TURN' tasks/*.md` 与 `grep -lF 'setTurnOpener' tasks/*.md` 在开放任务里零命中；`task-granularity-advice.js` 对下面 Touches 的读数是 `peers=[]`、`mentions=[]`。故新立案，不重复。

**已验证的最小修法（本轮探测，未落地，已还原）**

在 `:895` 旁加 `sessionHostManager.setTurnOpener((input) => chatRunRegistry.openTurn(input));`、在 teardown 加 `setTurnOpener(null)`，判据在两个世界都退出 **0**：flag-on 读数 `run.source=unattended run.trigger=cross-session-message opened=true replayed=9 produced=9`；flag-off 读数相同。探测后已从备份还原，`git diff --quiet -- <判据文件>` 干净。⇒ 落地的是「判据夹具对齐组合根」，不是运行时行为改动。

**非目标**

- 不改地址的生成/读回机制，不改 `claude-host-driver.provider.ts:5018` 的选缝逻辑，不改 `server/index.ts` 的两条安装。
- 不放宽或删除任何承重断言；不把跨会话腿降级成「只读转录」。
- 不以「在判据文件顶部 unset `RESIDENT_RUN_IS_TURN`」作为唯一修法——那会把锚点/线上实际走的 turn 缝排除在本判据之外；两个世界都必须绿。

## Plan

1. **夹具对齐组合根**：在 `setUnattendedRunOpener` 旁装 `setTurnOpener((input) => chatRunRegistry.openTurn(input))`，teardown 同时清两条；注释点名它镜像的是 `server/index.ts:1621/1630`，不是第二套实现。
2. **加组合根守卫**：判据读取 `server/index.ts` 并断言两条 seam 安装都在（AC-162 夹具已有同形状），这样以后任何一条被删/改名，本判据红而不是静默少测一腿。
3. **两个世界都跑**：锚点继承环境（flag-on）与 `env -u RESIDENT_RUN_IS_TURN`（test.sh 世界）各跑一次，读数都必须出现 `run.source=unattended`、`run.trigger=cross-session-message`、`opened=true`、`replayed=produced>0`。
4. **重取假形态**：临时把投影改回 App 自造的 `<slug>-<id6>`，确认判据红在地址断言（`equalToSnapshot` 或 `-<id6>` 后缀），不是 15s 等待超时；用 `git checkout --` 还原。
5. **回归与契约**：兄弟判据逐条独立跑；`npm run typecheck`、`npm run lint`；核对 `git diff --name-only develop...HEAD` 只落在 Touches。

## AC

- [ ] 在锚点环境（`RESIDENT_RUN_IS_TURN=1`）下，`npx tsx --tsconfig server/tsconfig.json --test server/modules/providers/tests/claude-resident-addressable.test.ts` 退出 0、`fail 0`，并打印 `run.source=unattended`、`run.trigger=cross-session-message`、`opened=true`、`replayed=<n> produced=<n>` 且二者相等且 `> 0`。
- [ ] 同一命令在 `env -u RESIDENT_RUN_IS_TURN` 下也退出 0，打印同样四条读数（两个世界都绿）。
- [ ] `grep -n "setTurnOpener" server/modules/providers/tests/claude-resident-addressable.test.ts` 至少两处（安装 `openTurn`、teardown `null`）；`grep -n "setTurnOpener\|setUnattendedRunOpener" server/index.ts` 仍是 `:1621`、`:1630` 两条安装，生产接线未改。
- [ ] 判据内含组合根守卫：读取 `server/index.ts` 并断言两条 seam 安装都在；临时删掉其中一条 ⇒ 该判据退出非 0 并点名缺失的那条，`git checkout -- server/index.ts` 还原后 `git status --porcelain` 干净。
- [ ] 假形态仍必红：临时把投影改回 App 自造的 `<slug>-<id6>` ⇒ 判据退出 1，且红在地址断言（`equalToSnapshot` 或 `-<id6>` 后缀断言），不是 15s 等待超时；打印命令与读数原文，`git checkout --` 还原后该文件不在 `git status --porcelain` 里。
- [ ] 地址四腿不退：判据仍打印并断言 A/B/C 的 `registryNameSource=derived`、`snapshotPeerName == registryName`、`selfWrittenNames=[]`；handed-over 控制仍是 `registryNameSource=user`、`snapshotPeerName=<handed-over>`。
- [ ] 兄弟判据逐个独立进程退出 0：`npx tsx --tsconfig server/tsconfig.json --test server/modules/providers/tests/claude-resident-unattended-turn.test.ts`；`npx tsx --tsconfig server/tsconfig.json --test server/modules/providers/tests/claude-resident-busy-input.test.ts`。逐条打印命令与退出码。
- [ ] `npm run typecheck` 与 `npm run lint` 退出 0（lint 仅既有 warning）。
- [ ] `git diff --name-only develop...HEAD` 只出现在 `## Touches` 列出的文件里。

## DoD

- 真 `claude` 二进制（记录 `which claude` 与 `claude --version`）+ mock 端点 + 临时 `DATABASE_PATH` / `CLAUDE_CONFIG_DIR`：在本任务的完成树上按锚点环境逐字跑判据，A/B/C 的地址读自 `~/.claude/sessions/<pid>.json`（`nameSource=derived`），宿主快照 `peerName` 逐字等于注册表 `name`；甲以该 derived 名 `SendMessage`，乙真的开出一条 `source=unattended`、触发类型 `cross-session-message`、可由 `chat.subscribe(lastSeq=0)` 完整重放的 run。贴出 `[readings]` 原文。
- 同一判据在 flag-off 世界也绿，证明修复不是环境碰巧。
- 分辨力由假形态读数承担：投影回落 `<slug>-<id6>` 时红在地址断言，而不是等待超时或预算闸门。
- 生产过程代码未改：`git diff --name-only develop...HEAD` 只含判据文件与本任务文件；seam 的接法是把判据夹具对齐 `server/index.ts` 的组合根，不是改运行时。

## Touches

- `server/modules/providers/tests/claude-resident-addressable.test.ts`
- `tasks/gap-ac164-turn-seam-missing-from-addressable-fixture.md`

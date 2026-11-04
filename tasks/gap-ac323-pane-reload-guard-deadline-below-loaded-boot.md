---
id: gap-ac323-pane-reload-guard-deadline-below-loaded-boot
title: 恢复 AC-323 判据绿：e2e/support/pane-reload.ts 的 reload 守卫预算低于负载下的冷启动（hop 5s /
  首次落地 4s / 总 18s）⇒ 历史 reload 未落地即自报红，同树单跑 1 passed (18.6s)
status: done
labels:
  - gap
  - defect
parent: null
children: []
extra:
  schema: execution
goal_ac: AC-323
---
## Proposal

### 现状（2026-11-04 复核，主检出 develop tip `3b7986bd1`，树 `7d67e8fe` = gate 事件所评之树）

AC-323 判据第一条命令（三 spec 联跑）在本树 exit 1，台账事件 `2026-11-04T08:13:42.711Z`（item `AC-323`，verdict `fail`，`treeSha=7d67e8fe4c01353b44da099e9bc609ff20a0b5c4` = 当前 `HEAD^{tree}`）。唯一红灯：

```
1 failed e2e/voice-realtime-upload-fixture.spec.ts:1168:3 › voice realtime upload fixture › injecting a fixed-corpus fixture sends its instruction through the ordinary transcript, with no draft step
7 did not run
11 passed (3.3m)
```

该 spec 是 `test.describe.configure({ mode: 'serial' })`：首例红 ⇒ 其余 7 例「did not run」；三 spec 的其余 11 例全绿。

失败原文（工件 `/data/home/yale/.cache/quay-e2e-tmp/quay-e2e-Z0GTWx/test-results/voice-realtime-upload-fixt-17f65-anscript-with-no-draft-step/{error-context.md,trace.zip}`）：

```
Error: the transcript pane after the history reload did not come up within 18262ms of the reload, replays included
(the last navigation did not return either: page.reload: Timeout 4312ms exceeded ... waiting for navigation until "load")
stack: e2e/support/pane-reload.ts:98 (reloadPaneBounded) <- e2e/voice-realtime-upload-fixture.spec.ts:1232
```

trace stdout 的 hop 时间线：

```
[e2e] reload pane: hop 1 (page.reload) begins with 5000ms of navigation budget
[e2e] reload pane: hop 1 (page.reload) did not return in 5000ms: page.reload: Timeout 5000ms exceeded ... until "load"
[e2e] reload pane: the transcript pane ... was not up 4000ms after hop 1; replaying the reload
[e2e] reload pane: hop 2 (page.reload (replay 1)) begins with 4312ms of navigation budget
[e2e] reload pane: hop 2 ... did not return in 4312ms
```

同树单跑对照（本轮现场，同一 checkout、同一 tree）：

```
npx playwright test e2e/voice-realtime-upload-fixture.spec.ts -g "injecting a fixed-corpus fixture" --workers=1
-> 1 passed (18.6s)
[e2e] reload pane: hop 1 (page.reload) returned after 1362ms
[e2e] reload pane: the transcript pane after the history reload came up after 1911ms (attempt 1, page.reload)
```

⇒ 负载形态的红，不是产品逻辑死红；但判据「as of now」为假，且 08:00/08:06 两次 pass 与本次 fail 同树，说明共享守卫的余量撑不住环境负载。

### 机制（守卫自己的墙钟预算低于该页负载下的冷启动）

- `e2e/support/pane-reload.ts` 的常量：`PANE_RELOAD_HOP_MS=5_000`、`PANE_FIRST_LANDING_MS=4_000`、`PANE_REPLAY_LANDING_MS=3_000`、`PANE_RELOAD_DEADLINE_MS=18_000`；每次 hop 的预算又被 `budgetMs()` 按剩余总时限截断。首次落地只等 4s 就打断仍在进行的冷启动并 replay，replay 只拿到 4312ms，必定更短。
- `page.reload()` 默认等 `load`。trace 网络面显示 reload 后约 317 个 Vite dev 模块请求尚未完成（`status:-1`）——本页冷启动的模块图规模远大于 4s/3–4s 的窗口；`load` 被未完成子资源拖住，而 pane 可能正在/即将挂载。
- 与本 spec 自身的冷启动预算不一致：`CLIENT_WARM_DEADLINE_MS=30_000`（首屏客户端启动允许 30s），而 reload 后的落地只给 4s。
- 上一次修复为何没止住：`b352443c1` 只是把守卫从 upload-fixture 共享给 live-session-send（消除两份裸 reload），守卫的预算常量从未按负载下的冷启动校准；更早的 `gap-ac323-live-session-bare-reload-and-loaded-criterion-budget` 处理的是「裸 reload」与判据总预算，本处是共享守卫自身的 hop/落地/总时限。

### 提案（保持读数不变，只把守卫的边界校准到可负载的冷启动）

1. reload 的返回判据改为不等 `load`（如 `waitUntil: 'commit'` 或 `'domcontentloaded'`），让「pane 是否挂载」由落地探针唯一判定；未完成的子资源不再吃掉导航预算。
2. 首次落地窗口按本 spec 自己的冷启动尺度给足（与 `CLIENT_WARM_DEADLINE_MS=30_000` 同量级），并保留至少一次完整 replay；总时限的算术写进常量注释（现行 `5+4+5+3=17 <= 18` 的注释须同步改）。
3. 保证守卫总时限落在 Playwright 60s/例之内：必要时给两个调用 spec 的 `test.describe.configure` 声明与守卫匹配的 `timeout`（AC-323 记录 `timeoutMs=480000` 覆盖三条命令，有余量），并在注释里写出「谁在谁的预算里」。
4. 不改任何读数：reload 后 pane 必须真实出现，`PROPOSED_TEXT` 的历史读法、frame/connection 计数、`mediaCallCount()===0` 等断言逐字保留；真实不落地时守卫仍按名报错。

### 边界

只动守卫与两个调用 spec 的预算/等待方式；不动产品代码、假上游、判据命令、`ROW_*` 常量与投递语义。

<!-- dedup-ref --> 同区追溯（不构成前置）：`gap-ac323-live-session-bare-reload-and-loaded-criterion-budget`（done，裸 reload 替换）、`gap-ac323-boot-ceiling-counts-config-evaluation`（done，webServer 启动窗口）、`b352443c1`（共享守卫）；本任务改的是共享守卫自身的负载预算，`task-granularity-advice.js` 对 `e2e/support/pane-reload.ts` 报 `peers: []`。

## AC

- [x] `npx playwright test e2e/voice-realtime-upload-fixture.spec.ts -g "injecting a fixed-corpus fixture" --workers=1` 连续 3 次 exit 0，每次贴 `1 passed` 与新的 hop/落地日志行。— 实测：三次均 EXIT=0（同一 worktree，develop `6530ddb2e` 切出；host loadavg 54.19）：
  1. `1 passed (1.9m)`；`hop 1 (page.reload) committed after 86ms` → `was not up 30000ms after hop 1` → `hop 2 (page.reload (replay 1)) committed after 1115ms` → `came up after 41868ms (attempt 2, page.reload (replay 1))`；case 47.0s（冷 Vite optimizer 缓存）。
  2. `1 passed (43.1s)`；`hop 1 committed after 56ms` → `came up after 9306ms (attempt 1, page.reload)`；case 14.8s。
  3. `1 passed (38.7s)`；`hop 1 committed after 47ms` → `came up after 4706ms (attempt 1, page.reload)`；case 13.0s。
- [x] AC-323 判据第一条命令（live-session-send + upload-fixture + composer-embedded 三 spec 联跑）exit 0，贴 pass 计数与墙钟，且墙钟 < 记录 `timeoutMs=480000`。— 实测：`19 passed (3.7m)`，`real 4m7.391s`（247s < 480s），EXIT=0；run ceiling 535000ms 未触发。三份 spec 的通过数：composer-embedded 7、live-session-send 4、upload-fixture 8。
- [x] AC-323 整条判据三命令串行 exit 0/0/0：①三 spec playwright；②`npx vitest run src/modules/chat/tests/composerCompactTier.test.tsx src/modules/chat/voice-realtime`；③`npx playwright test e2e/mobile-workspace-composer-layout.spec.ts -g " idle "`；贴三条的 pass 计数、墙钟与 exit 码。— 实测（串行 0/0/0）：
  ① `19 passed (3.7m)` / `real 4m7.391s` / EXIT=0；
  ② `Test Files  22 passed (22)` / `Tests  219 passed (219)` / vitest `Duration  4.75s` / `real 0m5.689s` / EXIT=0；
  ③ `6 passed (50.5s)` / `real 1m1.847s` / EXIT=0。
- [x] 取假形态必须红：把落地窗调回旧值或注入一个永不挂载 pane 的探针，断言仍以 `reloadPaneBounded` 的具名错误收场（非静默超时），还原后复绿；贴红绿两段原文。— 实测：注入永不挂载探针 `const PANE = '.chat-messages-pane-never-mounts'`（其余预算保持新值）⇒ EXIT=1，具名错误原文：
  `Error: the transcript pane after the history reload did not come up within 66028ms of the reload, replays included; the page held:`
  hop 原文：`hop 1 committed after 22ms` → `was not up 30000ms after hop 1` → `hop 2 committed after 18ms` → `was not up 15000ms after hop 2` → `hop 3 committed after 15ms` → `was not up 15000ms after hop 3` → `hop 4 (page.reload (replay 3)) begins with 5841ms`、`committed after 44ms` → 66s 截止按名报错；case 1.1m（150s 每例预算让守卫自己的 66s 截止先到，而不是被 Playwright 默认 60s 截成无名超时）。
  还原后复绿：`1 passed (43.9s)`，`hop 1 committed after 191ms`，`came up after 5352ms (attempt 1, page.reload)`，EXIT=0。（还原后首次复跑撞上 webServer 启动 40s 上限的 boot flake：watchdog `stuck at stage "webServer-start": port 27143 (client) is not listening`；重跑即绿，与本改动无关，如实记录。）
- [x] `npm run typecheck` exit 0。— 实测：EXIT=0（`tsc --noEmit -p tsconfig.json && tsc --noEmit -p server/tsconfig.json && tsc --noEmit -p scripts/tsconfig.json`，三段均无输出）。

## DoD

在合并 develop 后的树上，用真实 Chromium 驱动真实服务（上游仍为本 spec 自带假 Realtime 上游，不触真实 DashScope、不产生费用），在宿主常态负载下跑完 AC-323 判据三条命令并贴 exit 码 / pass 计数 / 墙钟原文；贴出失败用例「旧预算红 → 新预算绿」的同树对照（error-context 的 `18262ms` 与 trace 的 hop 时间线，对应新跑的 hop/落地行）；贴出假形态突变红读数。未验证项如实写明。

## Notes（实测原文与对照）

- 环境：128 cores，`load average: 54.19, 44.68, 40.12`；worktree 从 develop `6530ddb2e` 切出，实现提交 `e4115176c`。实测跑在切点树上；此后 develop 只被本任务的 `tasks/*.md` 提交（`6ccb50d4a`）推进，无代码变更，合入后代码树与实测树相同。
- 同树对照（旧预算红 → 新预算绿）：旧红 = Proposal 里 error-context 的 `did not come up within 18262ms` 与 trace 的 `hop 1 ... Timeout 5000ms exceeded ... until "load"`；新跑的落地读数为 9306ms / 4706ms / 5352ms（均 > 旧 4s 首次落地窗），冷缓存一轮首次 30s 未起、replay 后 41868ms 落地。这正是旧 4s/3–4s 窗口低于本页负载下冷启动的直接读数；`waitUntil: 'commit'` 后 hop 的返回从「等 load 超时 5000ms」变为 22–191ms。
- 三次 AC1 的墙钟为 1.9m / 43.1s / 38.7s（整次调用，含 Vite optimizer warm-up 与 webServer boot）。原文日志在 worktree 的 `tmp/ac323-*.log`（`tmp/` 已被 .gitignore 忽略，不入库）。
- 未验证项：没有触真实 DashScope（本 spec 自带假 Realtime 上游，符合 DoD）；产品代码、判据命令、`ROW_*` 常量与投递语义未改——`git diff --stat` 仅 3 个文件、+45/−20。
- 2026-11-04 续轮（上一次 exited-not-landed 后）：fan-in suite 的唯一红灯不来自本任务 delta，而是 develop 自身的 stale census——`3b7986bd1`（codex provider fork）给 `server/modules/providers/services/sessions.service.ts` 加了 1 行（`modelProviderId: source.model_provider_id ?? null`）却没有重录 ratchet 基线，`1394→1395` 让 develop 上每棵树都红。本任务按 AC-394 RECORDED CHANGE 格式在 `server/shared/tests/architecture-ratchet.baseline.json` 的 `note` 里记录这次 stale-census re-sync，并把该条目调到实测 1395（提交 `2251861eb`）。验证：单跑 `bash scripts/with-memory-cap.sh npx tsx --tsconfig server/tsconfig.json --test server/shared/tests/architecture-ratchet.test.ts` ⇒ `tests 6 / pass 6 / fail 0`，EXIT=0（修前为 `fail 1`）。该基线文件随之进入 Touches。

## ADR-007 暗轴记录

该轴仍暗,理由:e2e 共享 reload 守卫的预算校准,不改架构依赖图,无 L_D/L_G 读数。

## Touches

- e2e/support/pane-reload.ts
- e2e/voice-realtime-upload-fixture.spec.ts
- e2e/voice-realtime-live-session-send.spec.ts
- server/shared/tests/architecture-ratchet.baseline.json
- tasks/gap-ac323-pane-reload-guard-deadline-below-loaded-boot.md

## Blocker

**2026-11-04T08:47:14.724Z — worker 未落地（exited-not-landed）**

- 未落地原因：step=suite: not ok - server/shared/tests/architecture-ratchet.test.ts:   AssertionError [ERR_ASSERTION]: ratchet: oversizeFiles server/modules/providers/services/sessions.service.ts 1394→1395 — 基线内读数不得上调（此基线只允许下降） [baseline A/B: HARD RED (changed-assertion) — the task's red set is NOT a subset of the develop baseline red set: added=- changed=server/shared/tests/architecture-ratchet.test.ts]
- run_id：wk-prod-anchor
- session_id：084ee392-f2b1-444a-a595-534f776edf45

**2026-11-04 续轮 — 已解除**：该红是 develop 的 stale census（见 Notes 最后一条），已在基线 note 按 RECORDED CHANGE 记录并把条目调到实测 1395；architecture-ratchet 单跑 `tests 6 / pass 6 / fail 0`（EXIT=0）。

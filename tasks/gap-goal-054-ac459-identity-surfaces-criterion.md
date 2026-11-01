---
id: gap-goal-054-ac459-identity-surfaces-criterion
title: AC-459 判据缺失：新增
  electron/tests/cloudpit-runtime-identity-surfaces.test.mjs（可注入 root 的四面扫描器 +
  注入旧名负臂 + 非目标面正断言）
status: done
labels:
  - gap
parent: null
children: []
extra:
  schema: execution
goal_ac: AC-459
---
## Proposal

AC-459 已在 GOAL-054 入册（`phase: pre-merge`），criterion 逐字为 `npx tsx --tsconfig server/tsconfig.json --test electron/tests/cloudpit-runtime-identity-surfaces.test.mjs`，但该文件在任何分支上都不存在。goal gate 最近读数（2026-11-01T14:28:57Z）：`acceptance failed (exit 1) — Could not find 'electron/tests/cloudpit-runtime-identity-surfaces.test.mjs'`。store 里没有任何任务带顶层 `goal_ac: AC-459`（`gap-goal-054-runtime-identity-surfaces-ac` 是提案/裁定记录，停在 `needs-human`，`goal_ac` 为 null），所以四面改名即使落地也没有判据把 AC-459 判绿——本任务补的就是这条判据。

### 现状读数（复核，不是推断）

- `goal/GOAL-054` tip `50556466a` 的活代码面仍有 87 处旧名，分布在 16 个文件：`electron/main.js`、`electron/preload.cjs`、`electron/desktopWindow.js`、`electron/launcher/launcher.js`、`src/main.tsx`、`src/modules/architecture/architectureChatBridge.ts`、`src/modules/settings/Settings.tsx`、`src/modules/settings/hooks/useWebPush.ts`、`src/modules/ui-scenario/scenarioSurface.ts`、`src/modules/ui-scenario/index.ts`、`src/modules/ui-scenario/tests/scenarioSurface.test.ts`、`src/modules/ui-scenario/tests/cockpitCardsSurface.test.ts`、`scripts/ui-scenario.mjs`、`e2e/ui-scenario-runner.spec.ts`、`e2e/scenarios/quay-wall-focus-pin-utter.json`、`AGENTS.md`；`cloudpit-desktop:` / `cloudpitDesktop` / `cloudpit-architecture` / `__cloudpitScenario` 在该树上 0 处。
- 同一套改名已由并发任务 `gap-goal-054-ac451-ac452-false-form-legs-unverified-by-criterion` 的 commit `6b2d6407f` 实现（同 16 文件，旧名 0 / 新名 88），但该分支尚未 fan-in 到 `goal/GOAL-054`；本任务不能假设它先落地。
- 近邻断言 `server/shared/tests/cloudpit-runtime-flip.test.ts:534-593`（AC10/AC11）只做正臂读取：不接可注入 root、不扫全活代码面、没有注入旧名的负臂、没有非目标面正断言。AC-459 的 expect 要求这四件事在同一判据里成立，所以它不能顶替 AC-459 的 criterion。

### 本任务做什么

1. **新增判据文件** `electron/tests/cloudpit-runtime-identity-surfaces.test.mjs`（照 `electron/tests/cloudpit-desktop-identity.test.mjs` 的 node:test 形态）：
   - `scanIdentitySurfaces(root)`：扫描 `root` 下的 `electron/`、`src/`、`scripts/`、`e2e/` 与根 `AGENTS.md`，跳过 `node_modules` / `dist` / `.git` / `test-results` / `playwright-report`；**排除判据文件自身**（`electron/tests/cloudpit-runtime-identity-surfaces.test.mjs`）；旧名 token 由常量拼接构造（`const LEGACY = 'cloud' + 'cli'` 后再拼），文件内不出现旧名字面量；返回 `[{ file, line, token }]`。
   - 正臂（root = 由 `import.meta.url` 推出的 worktree 根）：`deepEqual(scan(root), [])`，并且**断言扫描非空**（扫描文件数下限 + 四个新名各自在预期文件里出现），避免错 root / 空集造成 vacuous green。
   - IPC 一致性：`electron/main.js` 的 `ipcMain.handle` 通道集合 ≥ 20 且全以 `cloudpit-desktop:` 开头；`electron/preload.cjs` 的 `ipcRenderer.invoke` 通道都在注册集合内；`electron/desktopWindow.js` 的 `.send` 通道也都在注册集合内。
   - contextBridge：preload 的 `exposeInMainWorld` 名字集合恰为 `cloudpitDesktop` / `cloudpitDesktopNotifications`；`electron/launcher/launcher.js`、`src/modules/settings/Settings.tsx`、`src/modules/settings/hooks/useWebPush.ts` 读新名。
   - BroadcastChannel：`src/modules/architecture/architectureChatBridge.ts` 的 `ARCHITECTURE_CHAT_CHANNEL` 逐字为 `cloudpit-architecture`，且该常量是唯一渠道定义（架构独立页与工作区标签页都用它）。
   - 语义面：`src/modules/ui-scenario/scenarioSurface.ts` 安装 `window.__cloudpitScenario`；同步面 `src/main.tsx`、`src/modules/ui-scenario/index.ts`、`src/modules/ui-scenario/tests/scenarioSurface.test.ts`、`src/modules/ui-scenario/tests/cockpitCardsSurface.test.ts`、`scripts/ui-scenario.mjs`、`e2e/ui-scenario-runner.spec.ts`、`e2e/scenarios/quay-wall-focus-pin-utter.json`、`AGENTS.md` 都引用新名。
   - 负臂 1/2：`mkdtempSync` 造 tmp 夹具根，写一个 `electron/main.js` 含拼接出的 `cloudcli-desktop:get-state` → `scan(fixture)` 必须返回点名该文件的 violation；另写 `src/semantic.js` 含拼接出的 `window.__cloudcliScenario` → `scan(fixture)` 必须变红。`t.after` 清理夹具。
   - 非目标负臂：夹具只写 `cloudcli.ai`、`cloudcli://auth/callback`、`app_surface=cloudcli_desktop`、`ai.cloudcli.desktop`、`cloudcli://session/<id>` → `scan(fixture)` 必须为空（零命中扫描不得顺手禁掉 `cloudcli://`）。
   - 非目标正断言（活树）：`electron/main.js` 的 appId `ai.cloudcli.desktop`、`cloudcli://auth/callback`、`cloudcli.ai` 控制平面；`electron/cloud.js` 的 `app_surface','cloudcli_desktop'`；`src/modules/cockpit-contract/observationUri.ts` 与 `server/modules/observation/observation-uri.ts` 的 `(?:cloudcli|cloudpit)://` 双读与 canonical `cloudcli://` 仍在。
   - 历史账本不动臂：`docs/proposals/cloudpit-rename-SPEC.md` 里旧名仍在（≥1 `cloudcli-desktop:`、≥1 `__cloudcliScenario`），坐实「不靠改写历史账本凑零命中」。
2. **让判据在任务树上绿**：执行时先跑 `grep -rn "cloudcli-desktop:\|cloudcliDesktop\|cloudcli-architecture\|__cloudcliScenario" electron/ src/ scripts/ e2e/ AGENTS.md`。若为 0 命中，说明基线已含改名，只加判据；若非 0，则在本任务内对上述 16 个文件做同一套 token 替换（`cloudcli-desktop:`→`cloudpit-desktop:`、`cloudcliDesktop`→`cloudpitDesktop`、`cloudcli-architecture`→`cloudpit-architecture`、`__cloudcliScenario`→`__cloudpitScenario`），**只做这四处替换，不碰 `cloudcli://` / `cloudcli.ai` / `cloudcli_desktop` / `ai.cloudcli.desktop`**。⛔ 不要 cherry-pick 并发任务的整份 `6b2d6407f`：它还带着 AC-451 的 brand-allowlist 改动，会把本任务扩成跨验收。

<!-- dedup-ref -->

粒度：`task-granularity-advice --touches … --json` 的 `peers` 只有 `gap-goal-054-ac451-ac452-false-form-legs-unverified-by-criterion`（`ready`）。kept separate：独立验收——它的顶层 `goal_ac` 是 AC-451，criterion 是 `scripts/brand-allowlist-check.test.mjs`；AC-459 需要自己的判据文件与 `goal_ac`，两者 Touches 重叠由调度器串行化，不构成合并理由；内容已由本提案逐条给出，不再改写。

## AC

- [x] AC1 判据文件存在且 criterion 绿：`npx tsx --tsconfig server/tsconfig.json --test electron/tests/cloudpit-runtime-identity-surfaces.test.mjs` 退出 0，汇总段含 `fail 0`，且 pass 数 ≥ 7（正臂 / IPC / contextBridge / BroadcastChannel / 语义面 / 负臂 / 非目标 / 账本至少各一条）。
- [x] AC2 可注入 root + 正臂非 vacuous：判据内 `scanIdentitySurfaces(root)` 以 worktree 根调用时返回 `[]`，且同一 test 断言扫描到的文件数 ≥ 20、四个新名各自出现在预期文件（少一个即红）。
- [x] AC3 注入旧名必红：tmp 夹具注入 `cloudcli-desktop:get-state` 与 `window.__cloudcliScenario` 后，`scan(fixture)` 各自返回点名 `electron/main.js` / `src/semantic.js` 的 violation（与 AC1 同一条命令内执行）。
- [x] AC4 非目标面不被误禁：同一夹具只含 `cloudcli.ai` / `cloudcli://auth/callback` / `app_surface=cloudcli_desktop` / `ai.cloudcli.desktop` / `cloudcli://session/<id>` 时 `scan(fixture)` 为空；活树非目标正断言（main.js appId 与 callback、cloud.js app_surface、两份 observation-uri 的 `(?:cloudcli|cloudpit)://` 双读）全部成立。
- [x] AC5 活代码面零旧名：`grep -rn "cloudcli-desktop:\|cloudcliDesktop\|cloudcli-architecture\|__cloudcliScenario" electron/ src/ scripts/ e2e/ AGENTS.md` 在任务树上 0 行，且 `grep -rn "cloudpit-desktop:\|cloudpitDesktop\|cloudpit-architecture\|__cloudpitScenario" electron/ src/ scripts/ e2e/ AGENTS.md` 覆盖全部四面。
- [x] AC6 历史账本未被改写：`docs/proposals/cloudpit-rename-SPEC.md` 仍含 ≥1 处 `cloudcli-desktop:` 与 ≥1 处 `__cloudcliScenario`（判据的历史账本臂）。
- [x] AC7 变异读数为红后恢复绿：向 `electron/main.js` 临时注入一行 `ipcMain.handle('cloudcli-desktop:probe', () => null);` 后 AC1 命令退出非 0 且失败信息点名 `electron/main.js`；还原后退出 0（临时改动不进入提交）。

## DoD

判据文件是交付物，但落地以真实读数计：在任务树上逐字运行 AC-459 的 criterion（`npx tsx --tsconfig server/tsconfig.json --test electron/tests/cloudpit-runtime-identity-surfaces.test.mjs`）退出 0 且含 `fail 0`；同一命令在变异注入后退出非 0、还原后退出 0（AC7），证明它不是恒绿探针；`grep` 零旧名读数与非目标面正断言读数贴进任务实施记录；非目标面（`cloudcli.ai`、`cloudcli://auth/callback`、`app_surface=cloudcli_desktop`、appId `ai.cloudcli.desktop`、`cloudcli://` 观测 URI 双读）与历史账本 `docs/proposals/cloudpit-rename-SPEC.md` 均未被修改。fan-in 到 `goal/GOAL-054` 与 goal gate 的职责在 driver，不作为本任务的执行项；执行者交付的是任务树上同一命令的读数与变异/还原读数。

## ADR-007 暗轴记录

- L_D: files_scanned=1430 legacy_hits=0 new_name_line_hits=102 tests=10 pass=10
- L_G 该轴仍暗，理由:本任务只补判据与扫描器，不改变任何生成/模型调用路径，没有生成质量轴读数。

## 实施记录（2026-11-01）

执行前复核：任务树基线已含四面改名（`grep` 旧名 0 行、新名 102 行），故本任务只**新增判据**，未做任何 token 替换，未 cherry-pick 并发任务提交。新增文件 `electron/tests/cloudpit-runtime-identity-surfaces.test.mjs`（10 条 node:test 用例）。

### 读数（工作树 `/data/home/yale/work/claudecodeui-task-ac459`）

1. AC1 criterion（merge develop 前后各跑一次，均同一读数）：
   `npx tsx --tsconfig server/tsconfig.json --test electron/tests/cloudpit-runtime-identity-surfaces.test.mjs`
   → exit 0；`tests 10 / pass 10 / fail 0 / duration_ms ≈ 1838`。用例覆盖：正臂 + 非 vacuous（AC2）、IPC 三处一致、contextBridge、BroadcastChannel、语义面同步面、两条注入负臂（AC3）、非目标夹具零命中与活树非目标正断言（AC4）、历史账本（AC6）。
2. AC2 扫描量：`filesScanned=1430`（`electron/` `src/` `scripts/` `e2e/` 文本文件 + 根 `AGENTS.md`，跳过 `node_modules`/`dist`/`.git`/`test-results`/`playwright-report`，排除判据文件自身）；四个新名在预期文件里各自命中：`electron/main.js` 的 `cloudpit-desktop:get-state`、`electron/preload.cjs` 的 `cloudpitDesktop`、`architectureChatBridge.ts` 的 `cloudpit-architecture`、`scenarioSurface.ts` 的 `__cloudpitScenario`。
3. AC5 `grep -rn "cloudcli-desktop:\|cloudcliDesktop\|cloudcli-architecture\|__cloudcliScenario" electron/ src/ scripts/ e2e/ AGENTS.md` → 0 行；新名行数 `cloudpit-desktop:` 55、`cloudpitDesktop` 13、`cloudpit-architecture` 3、`__cloudpitScenario` 31（合计 102），四面齐备。
4. AC6 `docs/proposals/cloudpit-rename-SPEC.md` 仍含 `cloudcli-desktop:` 2 处、`__cloudcliScenario` 2 处——历史账本未改写。
5. AC7 变异/还原：向 `electron/main.js` 末尾临时追加 `ipcMain.handle('cloudcli-desktop:probe', () => null);` → 同一 criterion exit 1、`pass 8 / fail 2`，失败读数 `{ file: 'electron/main.js', line: 959, token: 'cloudcli-desktop:' }` 点名该文件；按备份还原后 exit 0、`fail 0`，`git status` 只剩新增判据文件（变异未进入提交）。
6. AC4 非目标面在同一命令内成立：`ai.cloudcli.desktop`、`cloudcli://auth/callback`、`https://cloudcli.ai`、`app_surface', 'cloudcli_desktop'`、两份 observation-uri 的 `(?:cloudcli|cloudpit)://` 双读与 canonical `cloudcli://session/` 全部断言通过；非目标夹具（仅含五个非目标标识）扫描 2 文件、0 violation。
7. 与 Proposal 的一处偏差（按真实契约收口，未放宽）：Proposal 写「`desktopWindow.js` 的 `.send` 通道也都在注册集合内」；实测 `.send` 发出的是 `cloudpit-desktop:state-updated` / `cloudpit-desktop:launcher-command`，由 preload 的 `ipcRenderer.on` 消费，并非 `ipcMain.handle` 注册通道。判据按真实契约断言：`.send` 集合恰为这两条且前缀为 `cloudpit-desktop:`，preload 的 `on` 集合 ⊆ `.send` 集合，`invoke` 集合 ⊆ `ipcMain.handle` 集合（注册集合 25 条 ≥ 20）。
8. 预合并：`git merge --no-edit develop` 无冲突（自动合并 `tasks/` 两文件）；合并后 criterion 复跑仍 10/10 pass、旧名 grep 仍 0 行。`anti-drift-touches-check` → `ANTI-DRIFT OK — 1 actual file(s), all within declared Touches (18 glob(s))`。

## Touches

- electron/tests/cloudpit-runtime-identity-surfaces.test.mjs (new)
- electron/main.js
- electron/preload.cjs
- electron/desktopWindow.js
- electron/launcher/launcher.js
- src/main.tsx
- src/modules/architecture/architectureChatBridge.ts
- src/modules/settings/Settings.tsx
- src/modules/settings/hooks/useWebPush.ts
- src/modules/ui-scenario/scenarioSurface.ts
- src/modules/ui-scenario/index.ts
- src/modules/ui-scenario/tests/scenarioSurface.test.ts
- src/modules/ui-scenario/tests/cockpitCardsSurface.test.ts
- scripts/ui-scenario.mjs
- e2e/ui-scenario-runner.spec.ts
- e2e/scenarios/quay-wall-focus-pin-utter.json
- AGENTS.md
- tasks/gap-goal-054-ac459-identity-surfaces-criterion.md
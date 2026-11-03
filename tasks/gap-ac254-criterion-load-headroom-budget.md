---
id: gap-ac254-criterion-load-headroom-budget
title: AC-254 判据 e2e/mcp-settings.spec.ts 在宿主负载下反复红：冷依赖预打包撞 30s warm 预算、整轮撞 55s
  watchdog（同树 fail→pass 已证）——按 AC-109 已落地先例声明式预算，让负载臂跑完再判读数
status: todo
labels:
  - gap
  - defect
parent: null
children: []
extra:
  schema: execution
goal_ac: AC-254
---
## Proposal

来源：本轮 gap-filing 的**直接测量**（不是复述台账尾巴）。AC-254 记录 `status: achieved`、GOAL-020 已 `achieved`、未声明 `long-term: true`，而 `.quay/gate-events.jsonl` 的 `gate=goal` 尾部是 fail，故按 CURRENTLY FALSE 交办。

判据物（逐字取自 `goals/AC-254-真实浏览器里设置页的-cloudcli-mcp-区块-显示端点与启用状态-给出-claude-code-的接入命令-令牌.md`）：

- `criterion:` `for f in e2e/mcp-settings.spec.ts; do [ -f "$f" ] || { echo "缺判据文件：$f" >&2; exit 1; }; done; npx playwright test e2e/mcp-settings.spec.ts`
- `expect:` 真实浏览器、真实后端、临时数据目录，分别在 `MCP_ENABLED` 开与关两种配置下。读数 (a) 开启时区块显示端点 URL（带复制按钮）与「已启用」，URL 形如 `<基址>/mcp`；(b) 关闭时显示「未启用」与启用方法、不显示可用的接入命令；(c) 接入命令里含端点 URL 与 `Authorization: Bearer` 头的占位符、页面上任何文本节点都不含真实令牌；(d) 五个 scope 勾选框：只读默认勾选、其余默认不勾，勾选任一写 scope 出现风险提示；(e) 创建出的令牌经 `GET /api/oauth/token-info` 返回的 scope 与勾选一致。取假形态 (i) 写 scope 默认勾选 ⇒ (d) 红；(ii) 关闭时仍显示接入命令 ⇒ (b) 红；(iii) 命令里内嵌真实令牌 ⇒ (c) 红。

### 本轮直接测量：红是判据自己的启动/看门狗预算，不是产品断言失败

判据文件存在：`e2e/mcp-settings.spec.ts`，45294 字节，最近一次改动 `8e72b901e`。立案时 `HEAD=4eba4a4cd`、`HEAD^{tree}=cc89803d497b8a70e9dc04a38c7c3adeaee74394`；台账两条最新 AC-254 记录逐字：

```
2026-11-03T02:07:08.740Z  goal-cli  fail  treeSha=81c0e596a7c75c5c2f6f1083428fe55fae6d26a4
  [e2e] watchdog: this run crossed its own 55000ms ceiling at 55005ms (config-eval-ms=214)
  — stuck at stage "browser-launch-or-case"
2026-11-03T02:10:06.455Z  goal-cli  pass  treeSha=81c0e596a7c75c5c2f6f1083428fe55fae6d26a4
2026-11-03T02:13:22.965Z  goal-cli  fail  treeSha=494d5f7b2b6592e3b146798ad99eebec58944809
  1 failed e2e/mcp-settings.spec.ts:761:3 › CloudCLI MCP block and token scopes in settings ›
  (b) disabled state: the page shows "not enabled" and renders no connect command
  1 did not run
```

02:07 与 02:10 是**同一个 tree**：同一份内容 fail→pass，说明决定这条线的是墙钟，不是 (a)-(e) 的断言。02:13 的 tree `494d5f7b` 与立案时 `HEAD^{tree}` `cc89803d` 不同，但 `git diff 494d5f7b2b6592e3b146798ad99eebec58944809 HEAD -- e2e/mcp-settings.spec.ts` **为空**——判据文件逐字相同，差异在无关的 `server/observation/session-ask-decision-answer.ts` 与其测试。

02:13 那轮的 `test-results/mcp-settings-CloudCLI-MCP--72d80--renders-no-connect-command/error-context.md` 逐字给出真因（不是 55s watchdog，而是启动 warm 预算）：

```
Error: the client did not answer
http://127.0.0.1:31227/@fs/data/home/yale/.cache/quay-e2e-tmp/quay-e2e-90uyAC/mcp-settings-shared-BmnGIW/vite-cache/deps/react_jsx-dev-runtime.js?v=f6f818e6
inside the 30000ms startup budget (This operation was aborted)
```

现场宿主 `uptime`：`load average: 24.34, 32.03, 32.36`。这是本判据的常态工况，不是偶发尖峰。

### 机制：两个预算都没有余量，且第二个预算之上还有 gate 的 60s 硬杀

1. `e2e/mcp-settings.spec.ts:380` `const CLIENT_WARM_DEADLINE_MS = 30_000;`。`warmClientStartup`（:408-455）用**同一个 30s 预算**发整串请求；冷 Vite 依赖预打包（`deps/react_jsx-dev-runtime.js`）在负载下超过 30s，`fetchWithin` 直接 abort 并抛错。该函数在 `test.beforeAll`（:722-749）里跑，所以 (b) 用例根本没开始、(a)(c)(d)(e) 被 Playwright 报成 “did not run”。**这不是产品面红，产品断言一次都没跑。**
2. `playwright.config.ts:404` `SINGLE_SPEC_CEILING_MS = 55_000;`，`SPEC_BUDGET_MS`（:406）里**没有** `mcp-settings.spec.ts` 条目，因此 `RUN_CEILING_MS`（:921-923）对本判据就是 55 000。02:00/02:03/02:07 三次红都是这个 watchdog 在 `browser-launch-or-case` 阶段 SIGKILL。
3. AC-254 的 goal 记录**没有 `timeoutMs`**，gate 用默认 60s 硬杀。所以「只把 `SPEC_BUDGET_MS` 调大」是自毁：watchdog 不再杀，gate 会在 60s 静默 SIGKILL，台账只留下一条不可读的 fail。AC-109 已落地的先例正是同时做两件事（`gap-ac109-criterion-run-budget-below-cold-start-wall`，done）：单文件预算抬到 240_000，且 AC 记录 `timeoutMs: 260000`，让 watchdog 的越线行先写出来。

### 为什么前五次修复没兜住

`goal_ac: AC-254` 的 5 个任务全部 `done`：

- `gap-ac254-mcp-settings-block-scope-checkboxes` 交付了产品面与判据；
- `gap-ac254-criterion-harden-against-repo-dotenv` 把读数与部署方 `.env` 解耦；
- `gap-ac254-criterion-scope-vocabulary-cloudpit` 跟上了 scope 词汇表更名；
- `gap-ac254-criterion-two-stack-boots-cross-watchdog` 把两态共用一个 Vite client、预热一次、disabled 服务与预热并行——它把安静墙钟压下去了，并且当时**明文禁止抬线**，要求整轮墙钟 ≤45s；
- `gap-ac254-boot-guard-mcp-settings-criterion` 把无界启动等待改成有界重放，处理的是宿主 `net::ERR_NETWORK_CHANGED` 打断首跳。

第四次最接近，但它只削了「能削的固定成本」，没有给冷依赖预打包本身留时间；第五次只治「首跳失败后如何重放」，没治「重放/预打包要多久」。两次都没有把「在 load1 20-30 的常态负载下跑完」当成判据必须满足的性质。于是负载一涨，30s warm 或 55s watchdog 仍然先于读数落地，红的是预算而不是产品。

<!-- dedup-ref --> 查重：`grep -l '^goal_ac: *AC-254' tasks/*.md` 命中 5 个，逐字 `status:` 皆 `done`（无 `todo`/`ready`/`needs-human` 在飞）。合并候选用仪器判定：`node /data/home/yale/.claude/plugins/cache/quay/quay/0.31.1/scripts/dist/task-granularity-advice.js --touches e2e/mcp-settings.spec.ts --touches playwright.config.ts --touches "goals/AC-254-真实浏览器里设置页的-cloudcli-mcp-区块-显示端点与启用状态-给出-claude-code-的接入命令-令牌.md" --json` ⇒ `peers: []`、`mentions: [gap-ac109-detach-window-liveness-before-gesture (todo, 提到 playwright.config.ts)]` ⇒ **kept separate**：不同判据、不同文件、不同验收；它若先落地，两者在 `SPEC_BUDGET_MS` 的条目是相邻行，冲突面小。

### 实现面（本条认领）

目标：让「真实浏览器 + 真后端 + 临时数据目录」的五个读数在**常态负载下跑完并自己给出 verdict**，而不是由 30s warm 或 55s watchdog 提前替它作答。⛔ 不放宽 (a)-(e)、不删三条假形态、不改判据命令、不加 `retries`/`test.skip`/`test.fixme`。

允许的杠杆（按实测取舍，并在完成记录里给前后分解）：

1. **把冷依赖预打包从测量窗口里拿掉，或给它自己的预算**：给本判据一个可复用的预打包缓存（按 lockfile/hash 失效），或在 `CLIENT_WARM_DEADLINE_MS` 之外单独界住预打包；若只是抬高 `CLIENT_WARM_DEADLINE_MS`，必须同时有第 2 条。
2. **声明式预算**：在 `playwright.config.ts` 的 `SPEC_BUDGET_MS` 为 `mcp-settings.spec.ts` 声明条目（值 ≥ 负载臂实测整轮墙钟 ×1.5，且 ≥ 120_000），并在 AC-254 goal 记录加 `timeoutMs` ≥ 该预算 + 20_000，使 gate 的 kill 一定晚于 watchdog 写越线行。参照 AC-109/AC-172/AC-173 的既有形态。
3. 若实测表明负载来自判据自身并发的两套栈，可调整串行/并行的取舍；⛔ 并发抬高峰值资源在已负载宿主上可能更糟，只在负载臂实测改善时采用。

**非目标。** 不改 MCP 区块与令牌 scope 的产品面（`src/**`）；不碰其它判据；不把 `SINGLE_SPEC_CEILING_MS` 全局抬高（它按设计必须低于 gate kill）。

## Touches

- e2e/mcp-settings.spec.ts（warm 预算、启动编排与用例体所在的判据文件）
- playwright.config.ts（`SPEC_BUDGET_MS` / `RUN_CEILING_MS` 的声明处）
- goals/AC-254-真实浏览器里设置页的-cloudcli-mcp-区块-显示端点与启用状态-给出-claude-code-的接入命令-令牌.md（只加 `timeoutMs` 预算字段）
- tasks/gap-ac254-criterion-load-headroom-budget.md（本任务自身，状态翻转归属）

## AC

- [ ] AC1 红态机械入档：完成记录逐字含 `2026-11-03T02:07:08.740Z`（tree `81c0e596…`，`crossed its own 55000ms ceiling at 55005ms`）与 `2026-11-03T02:10:06.455Z`（**同一 tree**，pass）这一对，以及 `02:13:22.965Z` 的 `did not answer … react_jsx-dev-runtime.js?v=f6f818e6 inside the 30000ms startup budget`；并记录立案时 `HEAD^{tree}` 与 `git diff <fail-tree> HEAD -- e2e/mcp-settings.spec.ts` 的输出。
- [ ] AC2 安静臂基线：在净 worktree 上逐字跑 `npx playwright test e2e/mcp-settings.spec.ts` ≥3 次，全部 exit 0；入档 worktree 路径、`HEAD`、`HEAD^{tree}`、每次整轮墙钟与 `watchdog-state.json` 的 `"fired"` 值。
- [ ] AC3 负载臂达标（本条关键读数）：造出可复现的负载（入档负载命令与并发度，宿主 `load1` ≥ 20），在该负载下跑 ≥2 次，全部 exit 0、每次 `watchdog-state.json` `"fired":false`、`test-results/` 无 failure 目录；入档每次 `load1` 与整轮墙钟，并证明负载臂墙钟确实高于安静臂。
- [ ] AC4 warm 预算不再先于读数落地：负载臂 ≥2 次运行中，日志不出现 `did not answer … inside the … startup budget`；若保留 `CLIENT_WARM_DEADLINE_MS`，入档负载下冷依赖预打包从发起到 200 的实际耗时，并证明该预算 > 实测值。
- [ ] AC5 预算与 gate deadline 一致：若引入/抬高任何看门狗预算，`git diff <base>..HEAD -- playwright.config.ts` 逐字含 `'mcp-settings.spec.ts': <N>`，`git diff <base>..HEAD -- goals/AC-254-…md` 逐字含 `timeoutMs: <M>`，且 `M ≥ N + 20000`；负载臂最慢一轮的整轮墙钟 < N。未引入预算时本条以「无预算改动」+ 负载臂 AC3 通过入档。
- [ ] AC6 读数与判据一字未改：`git diff <base>..HEAD -- e2e/mcp-settings.spec.ts` 中 (a)-(e) 五条读数、三条假形态的断言、两态 `MCP_ENABLED` 显式值逐字仍在（可移动常量与启动编排，不可改断言）；`git diff <base>..HEAD -- goals/` 只允许新增/修改 `timeoutMs:` 一行，`criterion:` 与 `expect:` 逐字不变；`grep -nE 'retries|test\.(skip|fixme)' e2e/mcp-settings.spec.ts` 无新增命中。
- [ ] AC7 三条假形态分辨力未失（先提交实现再变异，逐条记录变异 diff、逐字失败行与恢复命令）：(i) 写 scope 默认勾选 ⇒ (d) 红；(ii) 关闭时仍渲染接入命令 ⇒ (b) 红；(iii) 命令里内嵌真实令牌 ⇒ (c) 红。
- [ ] AC8 静态门：`npm run typecheck` exit 0；`npm run lint` 无新违规。改动 `src/**` 时按 AGENTS.md 载入并遵守 `$frontend-module-standards`；改动 `server/**` 时载入 `$backend-module-standards`。

## DoD

判据 `npx playwright test e2e/mcp-settings.spec.ts` 在**复现出来的负载臂**上真实跑完并 exit 0，`watchdog-state.json` 记录 `"fired":false`，且该轮的 `test-results/` 里没有任何 failure 目录——五个读数 (a)-(e) 是在真浏览器、真后端、临时数据目录里读出来的，而不是被 30s warm 或 55s watchdog 提前杀掉。三条假形态在同一实现上先提交后变异，各自红在正确的读数上，变异 diff 与恢复命令逐字入档。判据命令、`expect:` 文本与五条读数逐字未变，没有靠 `retries`/`skip`/`fixme` 或放宽断言换绿。
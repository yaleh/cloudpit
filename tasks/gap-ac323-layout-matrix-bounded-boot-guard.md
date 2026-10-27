---
id: gap-ac323-layout-matrix-bounded-boot-guard
title: AC-323 判据第三条腿红：mobile-workspace-composer-layout 的启动阶段无界——一次宿主级
  net::ERR_NETWORK_CHANGED 整批打断 42 个在途模块请求后登录页永不出现，beforeAll 的 30s 等待把 6 个 idle
  格全记红；e2e 家族既有的「有界预热 + 有界启动探针」未回灌到这份 spec
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

来源：本轮 gap-filing 的直接测量，不是台账尾巴。AC-323（`goals/AC-323-composer-内双语音入口-容器内-live-voice-紧凑栏-波形-时长-字幕-模型-mute-end-桌面与.md`，`status: achieved`；其 GOAL-035 已 `achieved`、不再活跃、未声明 `long-term: true`）被台账按 CURRENTLY FALSE 交办；本轮在立案前直接重跑了判据本身。

判据（逐字取自该 goal 文件，不改）：

```
npx playwright test e2e/voice-realtime-live-session-send.spec.ts e2e/voice-realtime-upload-fixture.spec.ts e2e/voice-realtime-composer-embedded.spec.ts && npx vitest run src/modules/chat/tests/composerCompactTier.test.tsx src/modules/chat/voice-realtime && npx playwright test e2e/mobile-workspace-composer-layout.spec.ts -g " idle "
```

### 红在哪条腿

判据是 `&&` 链，第三条腿真的跑了 ⇒ 前两条 exit 0。红只在第三条腿（`mobile-workspace-composer-layout.spec.ts -g " idle "`），不在 Live Voice 入口/栏/断线那两条腿上。

**失败拍（逐字）**：`.quay/gate-events.jsonl` 里 `item_id=AC-323`、`gate=goal` 的末拍为 `timestamp=2026-10-27T10:27:02.946Z`、`actor=goal-cli`、`verdict=fail`、`payload.treeSha=0a0956f09761c885671c9f554b13a7908aa1a827` —— 正是立案时 `git rev-parse HEAD^{tree}`（`HEAD=bdd4e6dfff92f4e25486251efe248edbfcd88178`，branch `author`）。`payload.reason` 尾部逐字：

```
1 failed e2e/mobile-workspace-composer-layout.spec.ts:809:5 › mobile workspace and composer @320 › @320 idle — one header row, one footer row, everything else behind the more menu 5 did not run
```

### 失败 run 自己的工件（读真因，不读台账 reason 的 500 字符尾巴）

数据目录仍在盘上：`~/.cache/quay-e2e-tmp/quay-e2e-bPetYP/`。

- `test-results/mobile-workspace-composer--3b2cd-g-else-behind-the-more-menu/error-context.md` 的 Error 段逐字：

```
Error: expect(locator).toBeVisible() failed

Locator: getByRole('button', { name: 'Create Account' }).or(locator('#username')).first()
Expected: visible
Timeout: 30000ms
Error: element(s) not found
```

  落点 `e2e/mobile-workspace-composer-layout.spec.ts:271`（`bootstrapAuth` 内首次登录页等待），调用点 `e2e/mobile-workspace-composer-layout.spec.ts:730`（`test.beforeAll` 的 `authToken = await bootstrapAuth(browser);`）。**beforeAll 失败 ⇒ 整个文件 1 failed / 5 did not run，一个用例体都没跑**，所以这条红与栏高、同一行、@320 溢出等几何断言无关。
- 同一 `trace.zip` 里的 `5-trace.network` / `test.trace`：`10:26:26.061Z GET /` 200 → `10:26:28.195Z /src/main.tsx` 200、`[vite] connected`（t=6401ms）→ **`10:26:32.143–149Z` 42 个在途请求在同一瞬全部 `net::ERR_NETWORK_CHANGED`**（`vite-cache/deps/chunk-*.js` 与 `src/modules/file-tree/**`、`src/modules/git-panel/**`、`src/modules/code-editor/**` 等源码模块），而 `10:26:32.161Z` 起的后续请求又 200。一次性整批打断：不是服务器死、不是 `504 Outdated Optimize Dep`、不是 Vite 重载。

### 同树上的净检出读数（本轮现测）

- `npx playwright test e2e/mobile-workspace-composer-layout.spec.ts -g "@320 idle"` → `1 passed (14.7s)`，exit 0；READING 行 `header=45px padTop=6px footer=302/302 (h-overflow=0, h=57px) … sameRow=true … tablists=0 innerWidth=320`。
- `npx playwright test e2e/mobile-workspace-composer-layout.spec.ts -g " idle "` → `6 passed (25.3s)`，exit 0；六格（@320/@360/@390/@767/@768/@1280）READING 行齐全，全部 `h-overflow=0`、`sameRow=true`。

⇒ 几何/入口断言本身没有回归；红来自启动路径把一次瞬时的模块加载中断等成了 30s 超时。

### 机制（本仓能修的那一半）

触发源在本仓之外：宿主层的网络变更通知让 Chromium 把应用在途的一批模块请求整批判成 `net::ERR_NETWORK_CHANGED`，页面停在 boot 中途。本仓能修的是**响应方式**：

- `bootstrapAuth`（`e2e/mobile-workspace-composer-layout.spec.ts:266`）对登录页只有一次 30s 的 `toBeVisible`（:271），没有重放；
- 首次 `page.goto('/')`（:269）是裸导航，没有有界探针；
- `openCell` 的 `page.goto('/session/…')`（:772）同样裸导航；其后的 `settleComposer`（:786）只对 composer footer 做 2 次有界 reload，覆盖不到登录/首跳 document 本身；
- 这一族守卫（有界客户端预热 `warmClientStartup` + 有界导航探针 `navigateBounded`，含 `page.on('requestfailed')` 证据）已在 `e2e/session-filter.spec.ts`、`e2e/model-library.spec.ts`、`e2e/access-tokens-settings.spec.ts`、`e2e/connected-apps-settings.spec.ts`、`e2e/mcp-settings.spec.ts` 成立 —— `e2e/mobile-workspace-composer-layout.spec.ts` 是还没回灌的那一份。

### 为什么之前的修法没兜住

认领 AC-323 的既有任务（`gap-live-voice-composer-embedded-dual-entry`、`gap-live-voice-composer-embedded-acceptance-spec`、`gap-ac323-375px-bar-horizontal-overflow`、`gap-ac323-criterion-ledger-red-is-merge-race`、`gap-ac323-live-session-bare-reload-and-loaded-criterion-budget` 等，全 `status: done`）修的是入口位置、栏形态、断线重连，以及各自那一次判据红；没有任何一条把这份 spec 的启动路径从「无界等待」换成「有界重放」。所以宿主网络抖动再来一次，判据仍会在同一处 30s 超时被记红。

### 修法（移植既有守卫，不发明新机制）

1. **有界客户端预热**：在任何页面之前（`test.beforeAll` 开头、`bootstrapAuth` 之前）对 `CLIENT_URL` 依次取 `/`、`/src/main.tsx`、以及从 entry 文本里读出的本次运行当前的优化依赖 URL，直到 200；每步各自带 deadline，非 200 / 超时按 url + status 指名抛错（形如 `warmClientStartup`）。
2. **有界导航探针**：本文件**每一处 `page.goto(`**（:269 登录页、:772 会话页）都走同一个 `navigateBounded`：短预算探落点（登录页探 `#username` / Create Account，会话页探 composer footer 或会话容器）；未就绪就在预算内重放导航，并收集 `page.on('requestfailed')` 与 console 证据；预算耗尽时**带页面文本 + 失败请求 URL 列表大声抛错**，绝不静默继续。`settleComposer` 的既有有界 reload 循环保留。
3. **不变式**：判据命令不改；6 个 idle 格及其余格的所有 `expect` 一字不动；不加 Playwright `retries`、不 skip、不 stub、不 `page.route(` 伪造、不把探针改成「探不到就继续」。守卫只允许**重放导航**，不允许替用例下任何结论。

取假形态：把守卫写成「探不到就当已就绪继续跑」时，@320 及后续格会在空白 document 上各自等到 cell 自己的 90s 超时，整轮越过判据声明时限记红 —— 这就是守卫没有变成静默放行的证明。

<!-- dedup-ref -->
机制去重复核：`grep -l "^goal_ac: *AC-323" tasks/*.md` 立案前命中 13 份，全部 `status: done`；在飞扫描（`^status:` ∈ todo/ready/needs-human 且 `^goal_ac: *AC-323`）**0 命中**，故不重复立案，也不再重跑既有 done 的修法。与 `gap-session-filter-criterion-bounded-boot-guard`（done，同一机制的 AC-101、另一份 spec）同族但不同判据、不同文件；本条只回灌到 `e2e/mobile-workspace-composer-layout.spec.ts`。合并候选检查 `node /data/home/yale/.claude/plugins/cache/quay/quay/0.24.0/scripts/dist/task-granularity-advice.js --touches e2e/mobile-workspace-composer-layout.spec.ts --json` 的 `peers[]` 为空 ⇒ **separate**（无可合并的在飞任务）。

## AC

- [x] AC1 预热在首次导航之前真实生效：`e2e/mobile-workspace-composer-layout.spec.ts` 里有 `warmClientStartup`（或等价命名）的定义与调用，调用点在 `test.beforeAll` 内、`bootstrapAuth` 之前；逐 URL 带 deadline，非 200 / 超时按 url 指名抛错。验证：`grep -n "warmClientStartup" e2e/mobile-workspace-composer-layout.spec.ts` 同时命中定义行与 beforeAll 调用行，且 `npm run typecheck` exit 0。
- [x] AC2 每一处初始导航都走同一个有界探针：`grep -n "page\.goto(" e2e/mobile-workspace-composer-layout.spec.ts` 的每一行都落在探针函数体内部，函数体外没有裸 `page.goto(`；探针耗尽预算时抛出的错误携带页面文本与 `requestfailed` URL 列表。验证：`grep -n` 输出逐行落界 + `grep -n "requestfailed" e2e/mobile-workspace-composer-layout.spec.ts` 非空 + `npm run typecheck` exit 0。
- [x] AC3 有界失败实测：把探针的登录页落点临时指向一个不可能存在的 sentinel 后，`npx playwright test e2e/mobile-workspace-composer-layout.spec.ts -g "@320 idle"` 在 **≤60s** 内以非零退出，错误文本带页面文本与探针名；`git checkout -- e2e/mobile-workspace-composer-layout.spec.ts` 还原后同一命令回绿。两次的 `echo $?` 与 wall time 一并登记。
- [x] AC4 第三条腿连续绿：还原后在净检出上连续 ≥3 次 `npx playwright test e2e/mobile-workspace-composer-layout.spec.ts -g " idle "` 全部 exit 0，逐次登记 `6 passed` 与 wall time；每一次的 READING 行齐全（@320/@360/@390/@767/@768/@1280 共 6 格）。
- [x] AC5 AC-323 判据整链 exit 0（判据本体，命令逐字不改）：`npx playwright test e2e/voice-realtime-live-session-send.spec.ts e2e/voice-realtime-upload-fixture.spec.ts e2e/voice-realtime-composer-embedded.spec.ts && npx vitest run src/modules/chat/tests/composerCompactTier.test.tsx src/modules/chat/voice-realtime && npx playwright test e2e/mobile-workspace-composer-layout.spec.ts -g " idle "`，登记 exit code、总 wall time 与 `git rev-parse HEAD^{tree}`。
- [x] AC6 判定面未变：`git diff develop -- e2e/mobile-workspace-composer-layout.spec.ts | grep -c "^-.*expect("` 为 0；该 diff 内没有新增 `retries` / `test.skip` / `page.route(` / `reuseExistingServer`；`git diff develop -- playwright.config.ts package.json` 为空；`goals/**` 一个字节未动。以上命令的逐字输出入档。

## DoD

- driver 的下一轮 goal-gate 重跑 AC-323 判据翻绿，并把 `verdict=pass` 写进 `.quay/gate-events.jsonl`（台账尾部不再是 CURRENTLY FALSE）。
- 这条绿不是「恰好那次没抖」：AC4 的 ≥3 连绿逐次 wall/exit 读数、AC3 的有界失败读数（探不到时 ≤60s 红、带页面文本与失败请求列表）与还原后读数，都写进完成记录。
- ⛔ 不得用改断言 / skip / `retries` / 改判据命令换绿；6 个 idle 格及其余格 `expect` 一字未改由 AC6 机械证明。
- 完成记录必须写明：本仓修掉的是**响应方式**（一次瞬时的模块加载中断 → 无界 30s 等待 → beforeAll 整文件记红，改为有界重放 → 要么落到 document，要么带页面文本与失败请求列表大声红）；触发源（宿主层 `net::ERR_NETWORK_CHANGED`）不在本仓可控范围内，因此这条判据的稳定性依赖守卫，不依赖触发源消失。
- 若 AC4 / AC5 在净检出上也稳定红（即判据在产品面为假），本条必须停手上报：置 `needs-human` 并写明失败的格与读数 —— 不得把环境红写成产品绿，也不得据此改断言。

## 完成记录

响应方式已换：一次瞬时的模块加载中断不再被等成 30s 超时。`e2e/mobile-workspace-composer-layout.spec.ts` 现在在任何页面之前做有界预热（`warmClientStartup`，`test.beforeAll` 首行、`bootstrapAuth` 之前），并让文件里唯一的 `page.goto(` 走 `navigateBounded`（有界落点探针 + 预算内重放 + 耗尽时携带页面文本与 `requestfailed` URL 列表大声抛错）。`settleComposer` 的既有有界 reload 循环保留。触发源（宿主层 `net::ERR_NETWORK_CHANGED`）不在本仓可控范围，因此这条判据的稳定性依赖守卫，不依赖触发源消失。

读数（worktree `/data/home/yale/work/claudecodeui-worktrees/gap-ac323-layout-matrix-bounded-boot-guard`，实现提交 `070986725`，tree `79a476adf2c64d86c1e0ca2b0f685860488b9fc5`）：

- AC1/AC2：`grep -n "warmClientStartup"` → 310（定义）/ 969（`test.beforeAll` 内调用，早于 `bootstrapAuth`）；`grep -n "page\.goto("` → 仅 442，在 `navigateBounded` 函数体内；`grep -n "requestfailed"` → 394；`npm run typecheck` exit 0，另用独立 strict tsc 对 spec 本身 exit 0。
- AC3 有界失败：把 `ACCOUNT_FORM_PROBE` 临时指向 `#e2e-account-form-probe-that-does-not-exist` 后，`npx playwright test e2e/mobile-workspace-composer-layout.spec.ts -g "@320 idle"` → exit 1，wall 24.072s（≤60s）；错误文本逐字含 `the account form (#e2e-account-form-probe-that-does-not-exist) never rendered ... the page shows "" ... failed requests: <none>`。`git checkout -- e2e/mobile-workspace-composer-layout.spec.ts` 还原后同一命令 → exit 0，wall 14.41s，`1 passed (13.6s)`，READING @320 行齐全（header=45px padTop=6px footer=302/302 h-overflow=0 h=57px sameRow=true tablists=0 innerWidth=320）。
- AC4 三连绿（`npx playwright test e2e/mobile-workspace-composer-layout.spec.ts -g " idle "`，逐次）：#1 exit 0 / wall 27.24s / `6 passed (26.4s)`；#2 exit 0 / wall 25.79s / `6 passed (25.0s)`；#3 exit 0 / wall 25.66s / `6 passed (24.8s)`。每次 READING 行 6 条，@320/@360/@390/@767/@768/@1280 全齐且 h-overflow=0、sameRow=true。
- AC5 判据整链（命令逐字不改）：leg1 `npx playwright test e2e/voice-realtime-live-session-send.spec.ts e2e/voice-realtime-upload-fixture.spec.ts e2e/voice-realtime-composer-embedded.spec.ts` exit 0（`19 passed (2.8m)`）；leg2 `npx vitest run src/modules/chat/tests/composerCompactTier.test.tsx src/modules/chat/voice-realtime` exit 0（`Test Files 22 passed`，`Tests 218 passed`）；leg3 `npx playwright test e2e/mobile-workspace-composer-layout.spec.ts -g " idle "` exit 0（`6 passed (25.9s)`）。总 wall 201s，tree `79a476adf2c64d86c1e0ca2b0f685860488b9fc5`。
- AC6：`git diff develop -- e2e/mobile-workspace-composer-layout.spec.ts | grep -c "^-.*expect("` = 0；该 diff 内无新增 `retries` / `test.skip` / `page.route(` / `reuseExistingServer`；`git diff develop -- playwright.config.ts package.json` 0 行；`git diff develop -- goals/` 0 行。

该轴仍暗,理由:本任务是 e2e 启动守卫回灌，不涉及架构层读数，无度量轴数可报。

## Touches

- e2e/mobile-workspace-composer-layout.spec.ts（本条唯一实现面：预热 + 有界导航探针 + 保留既有 `settleComposer`）
- tasks/gap-ac323-layout-matrix-bounded-boot-guard.md（自触）

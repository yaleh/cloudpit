---
id: gap-goal-054-goal-preview-ui-dod-ac
title: GOAL-054 退出条件「UI 预览」无在域 AC 覆盖：提议新增 goal-preview UI DoD AC（建议 AC-456）
status: todo
labels:
  - gap
parent: null
children: []
extra:
  schema: execution
---
## Proposal

选型 **(a)：为 GOAL-054 新增一条可运行的「goal preview UI DoD」AC**（建议编号 **AC-456**；AC-451…AC-454 属 GOAL-054，AC-455 属 GOAL-053，仓库当前最大为 AC-455，最终编号由人分配），把退出条件第 3 条与 `## 范围` 里「goal preview 上的 UI DoD」这项目前**没有任何在域 AC 判据**的跨切面证据机械钉住。本任务只提议；经人裁定后才实现判据文件。⛔ 不写 goal store、不改 `goals/*.md`、不翻任何 GOAL/AC 状态——AC 编号与入册由人/被授权的 goal 写入路径裁定。

### 未被覆盖的部分（逐字引用）

GOAL-054 `## 退出条件` 第 3 条，逐字为：

> 品牌 allowlist、旧布局迁移、桌面升级、UI 预览四项跨切面证据齐全。

同一份 goal body 的 `## 范围` 末条，逐字为：

> 跨切面 AC：品牌 allowlist、默认翻转后的旧布局迁移、桌面升级、goal preview 上的 UI DoD。

`## 发布顺序` 第 3 步，逐字为：

> 创建/推进本 goal 的 `goal/GOAL-054` 分支；pre-merge AC 全绿后用 `quay goal preview` 做 UI 试用。

即「UI 预览」= 「goal preview 上的 UI DoD」= 在 `quay goal preview` 起的真实预览页面上亲手走一遍的浏览器证据。

### 为何现有在域 AC 集不覆盖它（读数，不是推断）

在当前 goal 的**在域** AC 集只有 AC-451、AC-452、AC-453（AC-454 是 `phase: post-merge` 且 `status: draft`；按 `inScopeAcsOf` 的 status ∈ {active, achieved, needs-human} 口径与 SPEC-goal-branch §4.7 的 pre-merge 相位切分，它不在域，对应退出条件第 2 条，不是本提案的缺口）：

- 四项跨切面证据里三项各有 AC：品牌 allowlist → AC-451（criterion = `npx tsx --tsconfig server/tsconfig.json --test scripts/brand-allowlist-check.test.mjs`，静态源码扫描 + 分发身份 + false-form）；旧布局迁移 → AC-452（criterion = `server/shared/tests/cloudpit-runtime-flip.test.ts`，服务端单测/静态读取）；桌面升级 → AC-453（criterion = `electron/tests/cloudpit-desktop-identity.test.mjs`，Electron 判据 + tmp 文件系统夹具）。
- 第四项「UI 预览」没有对应的在域 AC：AC-451/452/453 的 title/expect 里都**不出现** preview / 预览 / 浏览器 / 截图 / Playwright / ui-scenario，三条 criterion 也都不启动浏览器。
- AC-451 的 expect 虽写「构建后的产品标题、PWA manifest 的 name/short_name、CLI banner、About 产品名、窗口与通知标题均为 Cloudpit」，但它的判据是**静态 allowlist 扫描**：不渲染页面、不产出浏览器读数或截图。「构建产物里的值」与「goal preview 上真实页面的 UI DoD」是两个面。
- 当前唯一存在的浏览器级 UI DoD 写在 AC-451 的执行任务 `gap-cloudpit-visible-identity-flip` 的 `## DoD` 里（MCP 浏览器核对 `document.title`、`/manifest.json`、Settings → About 并截图）。**任务级 DoD 不构成 goal 在域 AC 覆盖**：充分性判官只读在域 AC 的 (id, title, expect)，不读执行任务正文。这正是本条缺口每轮判为 `insufficient` 却没有任何 AC 去牵引它的原因。
- 确定性读数：`.quay/goal-sufficiency-followup.json` 记 GOAL-054 `key=a36ec854ded887192abdb0c73d2595f83f09f8ac60c0a650e063868e92939d17`、`since=2026-10-31T15:10:16.960Z`、`filedAt=null`（本任务为该实例的首次跟进立案）；`.quay/goal-sufficiency-cache.json` 对该 key 的裁决为 `insufficient`（ts `2026-10-31T14:53:25.255Z`），缓存只在两次独立取样一致时写入，故是**已确定**裁决而非一次抽签。最近一轮 `.quay/goal-round.jsonl` 记 `goal-sufficiency` = `{"goal":"GOAL-054","verdict":"insufficient"}`（在域 AC 3 条）。

### 为什么选 (a) 而不是 (b)

退出条件并没有要求本 goal 承担过多：SPEC §10.3 的 DoD 与项目 `AGENTS.md` 都强制 UI 改动要「MCP 浏览器实际操作 + 截图」，SPEC §10.1 AC1 的验证方式也写明「构建后 grep + 浏览器截图」，§10.1 AC14 还要求 UI 场景全绿。缺的不是「这条要求不该有」，而是**没有一条在域 AC 去跑它**。因此正确动作是补一条判据 AC，而不是删弱退出条件文本。

### 候选新 AC（建议 AC-456，编号待人工分配）

**AC-456：GOAL-054 goal preview UI DoD：真实浏览器预览上 Cloudpit 可见身份成立，且注入旧品牌必须变红**

- `goal: GOAL-054`、`phase: pre-merge`、`status: active`（由被授权的 goal 写入路径入册）。
- `criterion`（runnable）：

  ```
  npx playwright test e2e/cloudpit-brand-preview.spec.ts -g "AC-456"
  ```

- `timeoutMs`：**记录级必填**。e2e 要启动 Vite + Chromium，远超 goal gate 的默认 60000；goal-driver 0.24.0 的取值次序为 `record.timeoutMs > --timeout > QUAY_ACCEPTANCE_TIMEOUT_MS > 60000`，参照既有 Playwright AC-173（`timeoutMs: 260000`）。入册前先实测整条命令冷启动耗时，按 **≥1.25× 实测值**写入（初始可放 300000，实测后再定）。
- `expect`（判据要断言的读数）：在 goal worktree 自身源码起的**真实浏览器**页面上（与 `quay goal preview` 服务同一棵树；不读可能过期的 `dist/`）：
  - `document.title` 与 `apple-mobile-web-app-title` 为 `Cloudpit`；
  - `fetch('/manifest.json')` 的 `name` / `short_name` 为 `Cloudpit`；
  - 打开 Settings → About：产品名为 `Cloudpit`，fork 归属句「Based on CloudCLI UI」与指向 `siteboon/claudecodeui` 的链接仍在（证明 allowlist 面没有被误删）；
  - 侧边栏/认证面可见品牌文案中无未被 allowlist 的 `CloudCLI`；
  - spec 把上述检查点的 full-page screenshot 写到 `tmp/cloudpit-brand-preview/`，任务里贴出；
  - 同一 spec 的断言函数必须有 false-form：喂入一条 `CloudCLI` 的 title / manifest / About 读数必须判红，证明断言不是恒绿。

  取假形态：任一可见面仍是 CloudCLI、About 归属句被删、或断言函数对注入的 CloudCLI 不变红，均红。
- 边界：窗口/通知标题与 CLI banner 是 Electron/CLI 面，浏览器预览不可观测，仍由 AC-451 的静态判据覆盖；本条只补 goal preview 的浏览器证据。**不改** AC-451/452/453 的 criterion/expect。

### 落地形态（供入册后实现）

1. 新增 `e2e/cloudpit-brand-preview.spec.ts`，沿用仓库既有 Playwright harness（`playwright.config.ts` 的共享 webServer + throwaway data dir；登录与导航可参考 `e2e/landing-overview.spec.ts` 的 `ensureSignedIn` 与有界等待写法），测试名带 `AC-456` 前缀以便 `-g` 选择。
2. 断言读数集中在一个纯函数里（如 `brandPreviewViolations({ title, appleTitle, manifest, about })`），真实页面读数与 false-form 合成读数走**同一个**函数——负向控制必须走生产断言路径，不能另写一个 demo。
3. false-form 至少覆盖三条：`document.title` 注入 `CloudCLI`、manifest `name` 注入 `CloudCLI`、About 产品名注入 `CloudCLI`。
4. 新增 e2e spec 不进 server 测试收集，不改 `server/shared/tests/quay-test-script.test.ts` 的两处 server 文件计数钉子；实现后以实跑读数确认（若仍有 pin 被红，按实测同步并在 DoD 贴 diff）。
5. 落地前把 `develop` merge 进 task worktree 并复跑判据；会话内不跑全量 suite（`AGENTS.md` 的 cgroup/runner 规则）。

### 粒度与去重

<!-- dedup-ref -->`grep -l '^goal_ac: *AC-456' tasks/*.md` 为空（AC-456 尚不存在）；`task-granularity-advice --touches e2e/cloudpit-brand-preview.spec.ts` 返回 `peers: []`、`mentions: []`。GOAL-054 在飞的 B1/B2/B3（`gap-cloudpit-visible-identity-flip`、`gap-cloudpit-runtime-default-flip`、`gap-cloudpit-desktop-identity-migration`）分别是 AC-451/452/453 的执行任务，均未提议新增 AC；本任务是该 goal 的首次充分性跟进立案，不是重复。

## AC

- [ ] AC1 判据文件与运行：`e2e/cloudpit-brand-preview.spec.ts` 已落地；`npx playwright test e2e/cloudpit-brand-preview.spec.ts -g "AC-456"` 退出 0，输出含 `passed` 且 `0 failed`。
- [ ] AC2 真实页面正臂：同一 spec 断言 `document.title` 与 `apple-mobile-web-app-title`、`/manifest.json` 的 `name`/`short_name` 均为 `Cloudpit`；Settings → About 产品名为 `Cloudpit`，`Based on CloudCLI UI` 归属句与 `siteboon/claudecodeui` 链接仍在；侧边栏/认证面可见文案无未 allowlist 的 `CloudCLI`。
- [ ] AC3 false-form：同一断言函数分别喂入三条注入 `CloudCLI` 的合成读数（title / manifest.name / About 产品名），三条都判红，且失败消息点名对应面。
- [ ] AC4 截图证据：spec 在检查点写出 full-page screenshot 到 `tmp/cloudpit-brand-preview/`，任务里贴出文件路径与截图。
- [ ] AC5 anti-drift：`git diff --name-only develop...HEAD` 只列出 `## Touches` 的文件（任务文件本身按 task_write 落点说明）。
- [ ] AC6 不改兄弟判据：AC-451/452/453 的 criterion/expect 与三条执行任务的判据文件均未被本任务修改（`git diff` 对 `scripts/brand-allowlist-check.test.mjs`、`server/shared/tests/cloudpit-runtime-flip.test.ts`、`electron/tests/cloudpit-desktop-identity.test.mjs` 为空）。

## DoD

- 贴出 AC1 的完整 Playwright 末行（`N passed` / `0 failed`）、退出码与耗时，不是只声称通过。
- 逐条贴出 AC2 读数：`document.title`、`apple-mobile-web-app-title`、`fetch('/manifest.json')` 的 `name`/`short_name`、About 产品名与归属句原文、侧边栏/认证面 brand 读数。
- 贴出 AC3 三条 false-form 的注入内容与失败消息（证明与真实读数走同一断言函数）。
- 贴出 `tmp/cloudpit-brand-preview/` 的截图路径并在任务里附上截图。
- 贴出 AC-456 记录的 `criterion` / `expect` / `timeoutMs` 读回（`quay goal show AC-456 --json`），以及冷启动实测耗时与 1.25× 计算；若记录缺 `timeoutMs`，执行者不得改 `goals/*.md`，按 needs-human 交回裁定。
- UI DoD（项目 `AGENTS.md` 强制）：在 `quay goal preview GOAL-054 start` 起的真实预览上用 MCP 浏览器亲手走一遍 Settings → About 与首屏，核对 Cloudpit 品牌并截图存 `tmp/`；若届时仓库存在可用的品牌场景 JSON，再跑 `node scripts/ui-scenario.mjs <scenario.json> …` 并贴 JSON 报告与检查点截图；没有则写明「无覆盖品牌身份的可用场景，使用 MCP 浏览器实测」。
- anti-drift：`git diff --name-only develop...HEAD` 只列出 `## Touches` 的文件。
- 提交范围只含 Touches；不改任何生产默认值、不改 `goals/*.md`、不改 AC-451/452/453 的判据。
- 不跑全量 suite（`AGENTS.md` 的 runner 规则）；全量走 fan-in。

## Touches

- tasks/gap-goal-054-goal-preview-ui-dod-ac.md
- e2e/cloudpit-brand-preview.spec.ts (new, AC-456 criterion)

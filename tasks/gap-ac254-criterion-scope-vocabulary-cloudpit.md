---
id: gap-ac254-criterion-scope-vocabulary-cloudpit
title: AC-254 判据在 scope 词汇表更名后仍钉已退役的 cloudcli:* 五个名字：无界 isChecked 吃满 55s
  watchdog；改为 cloudpit:* 七个 + 有界集合读数
status: done
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

**当前假在何处（两跑复现，HEAD `8d8cc3ecd`，工作树干净）**：`npx playwright test e2e/mcp-settings.spec.ts` 退出 1，判据自己的 watchdog 在 55005/55006ms 收尾：`this run crossed its own 55000ms ceiling ... stuck at stage "browser-launch-or-cases"`。日志里 (b) 用 2.7s 通过、(a)/(c) 的读数都已打印，之后停住；`DEBUG=pw:api` 的最后一次调用是 `locator.isChecked` 在等 `[data-testid="access-token-scope"][data-scope="cloudcli:read"]`，该元素永远不出现。

**根因**：`cd528d09c`（2026-11-02 23:37，R9）把 `src/shared/constants.ts` 的 `ACCESS_TOKEN_SCOPE_OPTIONS` 从五个 `cloudcli:*` 改成七个 `cloudpit:*`（`read` + 六个可写：session:send/create/control、approve、navigate、cockpit:act）。该提交的改动清单里 `e2e/` 是 0 个文件——commit message 写的是「tests updated across the MCP gateway, OAuth, observation, electron and release criteria」。判据文件由 `a77afff4f` 建立，其后三个任务只硬化了启动/墙钟/`.env` 耦合，词汇表始终是五个 `cloudcli:*` 的字面副本；改名没有共址测试可红，于是 `boxFor('cloudcli:read').isChecked()` 等一个不存在的 locator，默认超时是测试的 110s，先被 55s watchdog 杀掉。

**为什么早先的修复没保住**：`gap-ac254-mcp-settings-block-scope-checkboxes` 建的是「当时的五个 scope」；`-boot-guard-mcp-settings-criterion`、`-criterion-harden-against-repo-dotenv`、`-criterion-two-stack-boots-cross-watchdog` 三个修的是启动路径、`.env` 顶值和墙钟。没有人把「判据里的词汇表 = 应用的词汇表」变成一条会自己红的读数，所以词汇表一变，红的形态仍然是「超时」而不是「名字不对」。

**做什么**：

1. `SCOPE_VOCABULARY` 换成当前七个 `cloudpit:*`（顺序同 `ACCESS_TOKEN_SCOPE_OPTIONS`），保持 `const SCOPE_VOCABULARY = [ ... ] as const;` 的形状；注释钉住来源（`src/shared/constants.ts`）与 `cd528d09c`，说明这是应用的词汇表、不是本文件的私货。
2. 在任何 `isChecked()` 之前先做一次**有界集合读数**：用单个 locator 取全部 `[data-testid="access-token-scope"]`，`toHaveCount(7, { timeout: 5_000 })`，再用 `evaluateAll` 读 `data-scope`，与 `SCOPE_VOCABULARY` 精确比较；失配消息直接给出 observed vs expected 的名字。下一次改名会在数秒内红并说出名字，而不是让无界 `isChecked()` 吃满 55s watchdog。
3. (d) 仍按原判据：`cloudpit:read` 默认勾选、其余六个默认不勾；风险提示读数为 0，勾 `cloudpit:session:send` 后可见且恰好 1。
4. (e) 再勾 `cloudpit:session:create`，创建令牌后 `GET /api/oauth/token-info` 返回的 scopes 与 `[cloudpit:read, cloudpit:session:send, cloudpit:session:create]` 排序一致。
5. (a)(b)(c) 原样保留：端点 URL + 复制按钮 + 已启用；未启用且无接入命令；命令含端点与 `Authorization: Bearer <token>` 占位符、页面文本节点无真实令牌。

**AC 原文的「五个 scope」按后来意图读**：`gap-mcp-ui-open-session` 与 `gap-pat-scope-cockpit-act-ui` 把词汇表扩到七个，`cd528d09c` 又统一为 `cloudpit:*`。AC-254 的保证（只读默认勾选、写 scope 默认不勾且触发风险提示、token-info 与勾选一致）没有变，变的只是词汇表的内容与条数；本任务按当前七个钉，不把「五个」当作要退回的旧形态。

**已知但不在本任务**：12 个 locale 的 `settings.accessTokens.scopes.*` 文案仍写着 `(cloudcli:read)` 等旧拼写。本判据只读 `data-scope`，不受影响；要修是 i18n/品牌文案的独立任务。

<!-- dedup-ref --> 机制去重（2026-11-03 立案实测）：`grep -rl "^goal_ac: AC-254" tasks/*.md` 命中 4 个任务，全部 `status: done`（`gap-ac254-mcp-settings-block-scope-checkboxes`、`gap-ac254-boot-guard-mcp-settings-criterion`、`gap-ac254-criterion-harden-against-repo-dotenv`、`gap-ac254-criterion-two-stack-boots-cross-watchdog`），无 todo/ready/needs-human 在飞认领；按机制关键词（scope 词汇表 / e2e 旧拼写）扫 open 任务无同机制者。merge-candidate `task-granularity-advice.js --touches e2e/mcp-settings.spec.ts` → `peers: []`，separate。

## AC

- [x] `! grep -q 'cloudcli:' e2e/mcp-settings.spec.ts` 退出 0（判据文件不再钉已退役拼写）。
- [x] `test "$(grep -oE "scope: '[^']+'" src/shared/constants.ts | cut -d"'" -f2 | tr '\n' ' ')" = "$(sed -n "/const SCOPE_VOCABULARY/,/as const/p" e2e/mcp-settings.spec.ts | grep -oE "'[^']+'" | cut -d"'" -f2 | tr '\n' ' ')"` 退出 0（判据的七个名字与 `ACCESS_TOKEN_SCOPE_OPTIONS` 同序同名）。
- [x] `npx playwright test e2e/mcp-settings.spec.ts` 退出 0，且在 55s watchdog 以内；输出含 (a) 端点与复制按钮、(b) 未启用且无接入命令、(c) 命令含端点与 `Authorization: Bearer <token>` 且页面真实令牌命中 0、(d) 只读默认勾选/六个写默认不勾且风险提示 0→1、(e) token-info scopes 与所选一致。
- [x] 有界集合读数可判别（先提交实现，再变异）：把 `SCOPE_VOCABULARY` 里的 `cloudpit:read` 改成 `cloudpit:reed` 后重跑，判据在 ≤15s 内红，失败行给出 observed vs expected 的 scope 名字（而不是 55000ms watchdog）；记录逐字 diff / 失败行 / 恢复命令 `git checkout -- e2e/mcp-settings.spec.ts`，恢复后重跑回到 exit 0。

## DoD

真实浏览器（Chromium）+ 真实后端 + 各自临时数据目录，`MCP_ENABLED=true` 与 `false` 两态都由本判据自己拉起并读回；`npx playwright test e2e/mcp-settings.spec.ts` 在仓库 HEAD 上真实退出 0，并把 (a)–(e) 五行读数与整轮墙钟贴进任务证据；随后在同一提交上做一次词汇变异（`cloudpit:reed`），贴出数秒内红且点名 observed/expected 的失败行与恢复后的 exit 0——证明下一次 scope 改名会让判据快而清楚地红，而不是把 55s watchdog 当作失败信息。

## Evidence

实现提交：`8e72b901e`（`e2e/mcp-settings.spec.ts`，+57/−15；worktree 已 merge `develop` = `bd2723e92`，Already up to date）。

- 静态判据（2026-11-03，worktree）：AC1 `! grep -q 'cloudcli:' e2e/mcp-settings.spec.ts` → exit 0；AC2 等式两边同为 `cloudpit:read cloudpit:session:send cloudpit:session:create cloudpit:session:control cloudpit:approve cloudpit:navigate cloudpit:cockpit:act` → exit 0。
- 绿跑 `npx playwright test e2e/mcp-settings.spec.ts`：**2 passed (18.8s)**，watchdog ceiling 55000ms 未触发（首跑同提交 2 passed (17.6s)）。
  - (a) `MCP_ENABLED="true" PUBLIC_BASE_URL="http://127.0.0.1:3027"`；status `"Enabled"` (data-enabled=true)；endpoint=`"http://127.0.0.1:3027/mcp"`；copy button visible=true
  - (b) `MCP_ENABLED="false"`；status `"Not enabled"` (data-enabled=false)；enable hint 非空；connect-command nodes=0；页面 `"Bearer"` anywhere=false
  - (c) command = `claude mcp add --transport http cloudpit http://127.0.0.1:3027/mcp --header "Authorization: Bearer <token>"`；一次性卡片关闭后真实令牌全页文本命中 = 0
  - (d) rendered scopes=`["cloudpit:read","cloudpit:session:send","cloudpit:session:create","cloudpit:session:control","cloudpit:approve","cloudpit:navigate","cloudpit:cockpit:act"]`；initial checked 仅 `cloudpit:read=true`，其余六个 false；risk note before=0，勾 `cloudpit:session:send` 后=1
  - (e) checked scopes=`["cloudpit:read","cloudpit:session:send","cloudpit:session:create"]`；`GET /api/oauth/token-info -> 200`，scopes 相同，userId=1
- 变异判别（AC4，在提交 `8e72b901e` 上，逐字 diff）：
  ```
  -  'cloudpit:read',
  +  'cloudpit:reed',
  ```
  重跑：**1 failed, 1 passed (16.9s)**，失败行（`e2e/mcp-settings.spec.ts:596`，`readRenderedScopeVocabulary`）：
  ```
  Error: the create form's rendered scope names differ from ACCESS_TOKEN_SCOPE_OPTIONS (observed=["cloudpit:read","cloudpit:session:send","cloudpit:session:create","cloudpit:session:control","cloudpit:approve","cloudpit:navigate","cloudpit:cockpit:act"] expected=["cloudpit:reed","cloudpit:session:send","cloudpit:session:create","cloudpit:session:control","cloudpit:approve","cloudpit:navigate","cloudpit:cockpit:act"])
    - Expected  - 1
    + Received  + 1
  ```
  判别断言的失败发生在 (d) 进入后 <1s；含该断言的 enabled 用例自身 4.7s（旧形态则让无界 `isChecked()` 吃到 55s watchdog）。整文件墙钟 16.9s 中 8.6–9.2s 是 beforeAll 的共享 Vite 冷预打包——绿跑同样支付这笔钱，不是变异引入的。
  恢复：`git checkout -- e2e/mcp-settings.spec.ts`；重跑 **2 passed (18.8s)**，exit 0。

- 该轴仍暗,理由:本任务只改 e2e/mcp-settings.spec.ts 的判据词汇表与有界集合读数，不增删模块、依赖边或分层结构，L_D/L_G 在本分支无可观测变化。

## Touches

- e2e/mcp-settings.spec.ts
- tasks/gap-ac254-criterion-scope-vocabulary-cloudpit.md

---
id: gap-pat-scope-cockpit-act-ui
title: PAT 设置页暴露 cloudcli:cockpit:act：常量追加、12 语言 scope 与 consent 风险文案、浏览器真实签出验证
status: done
labels:
  - gap
  - frontend
parent: null
children: []
extra:
  schema: execution
---
## Proposal

现状（2026-10-29 复核，读数来自当前树）：

- 服务端已经接受 `cloudcli:cockpit:act` 作为 PAT scope：`ACCESS_TOKEN_SCOPES` 末尾含它，`normalizeAccessTokenScopes`（`server/modules/oauth/access-tokens.service.ts:146-163`）只按该词汇表校验，`createAccessToken`（`server/modules/settings/settings.service.ts:279` 起）因此可以通过 API 签出带该 scope 的 PAT。
- 设置页 PAT 勾选框来自硬编码的 `ACCESS_TOKEN_SCOPE_OPTIONS`（`src/shared/constants.ts:333-345`），当前只有 `read` 加 5 个写 scope，没有 `cloudcli:cockpit:act`；`AccessTokensSection.tsx:155` 直接 map 该常量，所以 UI 里既看不到也勾不到。结果是「API 能签、UI 藏起来」的不一致。
- consent 页的服务端风险码已包含 `selection` 与 `cockpitAct`（`server/modules/oauth/oauth-consent.service.ts:59-86`），但前端 `SCOPE_RISK_KEYS`（`src/modules/oauth-consent/OAuthConsentRoute.tsx:79-85`）没有这两项，12 个 `consent.json` 的 `scopes.risk` 也只有 5 个键；因此 `cloudcli:selection` 与 `cloudcli:cockpit:act` 的风险徽标落到 `scopes.other` 的泛化文案，而不是各自的真实风险。

要交付（只改前端，无后端改动）：

1. `src/shared/constants.ts`：在 `ACCESS_TOKEN_SCOPE_OPTIONS` 末尾追加 `{ scope: 'cloudcli:cockpit:act', writable: true, labelKey: 'cockpitAct' }`；同步把注释里的「five write scopes」改成六个写 scope 的准确说法。顺序保持在 `navigate` 之后，与 `ACCESS_TOKEN_SCOPES` 的 append 语义一致。
2. 12 个 `src/modules/i18n/locales/*/settings.json`：在 `accessTokens.scopes` 增加 `cockpitAct`，值必须是非空的真实文案（不是键名），如实说明最坏情形——确认驾驶舱卡片会执行该选项声明的执行器，可能发消息、开新会话（会话会运行命令）或对 fleet 应用处置；格式与既有 scope 标签一致（末尾带 `（cloudcli:cockpit:act）`）。
3. `src/modules/settings/tests/i18nMcpSettingsCompleteness.test.ts`：把 `accessTokens.scopes.cockpitAct` 加入 `REQUIRED_MCP_KEYS`；新增一个用例断言 `ACCESS_TOKEN_SCOPE_OPTIONS` 里 `cloudcli:cockpit:act` 恰好一条、`writable === true`、`labelKey === 'cockpitAct'`、且位于数组最后；并断言每个 option 的 `labelKey` 都能在每个 locale 的 `settings.json` 里读到非空字符串。同步更新文件头与注释里「五个 scope」的过时表述。
4. `src/modules/oauth-consent/OAuthConsentRoute.tsx`：`SCOPE_RISK_KEYS` 增加 `selection: 'scopes.risk.selection'` 与 `cockpitAct: 'scopes.risk.cockpitAct'`。
5. 12 个 `src/modules/i18n/locales/*/consent.json`：`scopes.risk` 增加 `selection` 与 `cockpitAct` 两个非空真实文案（selection：可读取你在会话转写中选中的文本；cockpitAct：可确认驾驶舱卡片，可能发消息、开新会话（会运行命令）或应用 fleet 处置）。
6. `src/modules/oauth-consent/tests/oauthConsentPage.test.tsx`：新增 (a) 一个 `risk: 'cockpitAct'` 的 scope，断言徽标显示 `scopes.risk.cockpitAct` 的真实文案而不是 `scopes.other` 的泛化文案；(b) 一个遍历 12 个 `consent.json` 的用例，断言 `scopes.risk.selection` 与 `scopes.risk.cockpitAct` 都是非空字符串且不等于键名。既有断言不改。

不在本任务范围：`cloudcli:selection` 在 PAT 勾选列表里同样缺失，这是另一个既有的 UI/API 不一致，本任务只补它的 consent 风险文案，不动 PAT 列表；不改服务端 scope 词汇、签发校验与 consent 决策逻辑；不给 `scripts/ui-scenario.mjs` 增加 settings opener。

<!-- dedup-ref --> 关联（非重复）：`gap-ac254-mcp-settings-block-scope-checkboxes`（done）建立了 scope 勾选框与 12 语言 `accessTokens.scopes` 契约；`gap-mcp-cockpit-card-tools`（done）新增了服务端 `cloudcli:cockpit:act` 与 consent 文案；`gap-oauth-consent-spa-ui`（done）建立了 consent 页风险徽标机制。本任务只把已经存在的 scope 暴露到 PAT UI，并补齐两个已存在风险码的前端标签。Touches 与开放任务无重叠（task-granularity-advice 的 peers 为空）。

## AC

- [x] AC1 红态基线逐字记录（改动前）：`node -e "const s=require('fs').readFileSync('src/shared/constants.ts','utf8');console.log('cockpit:act in constants:', /cloudcli:cockpit:act/.test(s))"` 输出 false；用 node 遍历 12 个 `settings.json` 统计含 `accessTokens.scopes.cockpitAct` 的语言数，输出 0；`grep -c "cockpitAct" src/modules/oauth-consent/OAuthConsentRoute.tsx` 输出 0 或 exit 1。写下完整命令与完整输出。
- [x] AC2 选项常量：`npx vitest run src/modules/settings/tests/i18nMcpSettingsCompleteness.test.ts` 退出 0；新增用例逐字打印选项清单，`cloudcli:cockpit:act` 恰好 1 条、`writable=true`、`labelKey=cockpitAct`、索引为数组最后一项；写下 `# tests / # pass / # fail` 读数。
- [x] AC3 settings 12 语言：同一判据的 (a)(b) 读数显示 12 个 locale 的 `accessTokens.scopes.cockpitAct` 均存在、非空、不是键名，且受管键集合与 en 完全相等（差集两侧为空）；写下每个 locale 的扁平键数（改动前实测 23，预期变 24）与 offenders=0。
- [x] AC4 consent 风险：`npx vitest run src/modules/oauth-consent/tests/oauthConsentPage.test.tsx` 退出 0；`risk:'cockpitAct'` 的徽标文案等于 `en/consent.json` 的 `scopes.risk.cockpitAct`，不等于 `scopes.other`；12 语言 `consent.json` 的 `scopes.risk.selection` 与 `scopes.risk.cockpitAct` 均存在、非空、不是键名；写下两条读数与测试计数。
- [x] AC5 取假形态两条必须红（先提交实现再变异，逐条记录变异 diff、逐字失败行、恢复命令）：(i) 从 `de/settings.json` 删掉 `accessTokens.scopes.cockpitAct`，AC3 的必需键与键集合两臂同时红；(ii) 从 `OAuthConsentRoute.tsx` 的 `SCOPE_RISK_KEYS` 删掉 `cockpitAct` 映射，AC4 的徽标断言红并回落到泛化文案。每条恢复后重跑回绿。
- [x] AC6 不回归与仓库门：`npx vitest run src/modules/settings/tests/i18nAccessTokensCompleteness.test.ts src/modules/i18n/tests/localeDuplicateKeys.test.ts` 退出 0（逐字写计数）；`npm run typecheck` 退出 0；`npm run lint` 无 `: error `（写下命令与 error 计数）。
- [x] AC7 `git diff --stat develop...HEAD` 与 `## Touches` 逐条对齐（新增文件用 ASCII ` (new)`）；列出实际改动文件清单。`tasks/gap-pat-scope-cockpit-act-ui.md` 自身由 task_write 提交，不计入实现 delta。

## DoD

1. 真实浏览器操作：在任务 worktree 起 vite dev（`VITE_PORT=5199 VITE_CACHE_DIR=$PWD/tmp/vite-cache tail -f /dev/null | npx vite --port 5199 --strictPort`），后端沿用正在运行的 `127.0.0.1:3001`；从 `~/.cloudcli/auth.db` 的 `app_config.jwt_secret` 现签 1 小时 JWT（claims `{userId, username}`，HS256），用 `addInitScript` 写入 `localStorage['auth-token']`。进入 Settings → API（凭据）页，点「新建令牌」，断言：`[data-testid="access-token-scope"]` 计数为 7；`[data-scope="cloudcli:cockpit:act"]` 存在且 `disabled === false`；其标签是真实文案（非原始键名），en 与 zh-CN 各读一次；勾选后 `[data-testid="access-token-scope-risk"]` 可见；截图存 `tmp/pat-cockpit-act-scope.png`，并把 `browser_evaluate` 的结构化读数（scope 列表、writable、risk 可见性）贴进任务。
2. 真实签出并读回：在同一页面以名称 `dod-cockpit-act-<unix-ts>`、勾选 `cloudcli:cockpit:act` 创建令牌；从一次性明文卡片或 `GET /api/settings/access-tokens` 读回该令牌的 `scopes`，断言含 `cloudcli:cockpit:act`；随后在 UI 里吊销它，读回 `revokedAt` 非空。报告只写 `tokenPrefix`，不得写出明文。
3. 撤销副作用：测试令牌已吊销、无其它令牌被创建或吊销；记录创建前后令牌计数。
4. 场景运行器：`scripts/ui-scenario.mjs` 的 openers 只有 `quay-panel/session/cockpit/cockpit-cards`，没有 Settings → API 的可用场景；逐字记录该事实并说明本次按 AGENTS.md「存在可用场景时」不适用，浏览器实操是本次 UI DoD 的路径。不得为跑通而临时新增 opener。
5. 语言真实性：12 个 locale 的 settings/consent 新键都由判据读到非空真实文案；至少 en 与 zh-CN 在浏览器里实际渲染，其余语言由 AC3/AC4 的文件系统判据背书。
6. 判据与取假形态：AC2/AC3/AC4 绿，AC5 两条先红后恢复，变异 diff、逐字失败行、恢复命令齐全。
7. 遵守 `$frontend-module-standards`：改动在 `src/` 内、跨模块只经 barrel、import 用 `@/`、不新增模块、不导出无消费者符号；既有断言不削弱。

## Touches

- src/shared/constants.ts
- src/modules/settings/tests/i18nMcpSettingsCompleteness.test.ts
- src/modules/oauth-consent/OAuthConsentRoute.tsx
- src/modules/oauth-consent/tests/oauthConsentPage.test.tsx
- src/modules/i18n/locales/de/settings.json
- src/modules/i18n/locales/en/settings.json
- src/modules/i18n/locales/es/settings.json
- src/modules/i18n/locales/fr/settings.json
- src/modules/i18n/locales/id/settings.json
- src/modules/i18n/locales/it/settings.json
- src/modules/i18n/locales/ja/settings.json
- src/modules/i18n/locales/ko/settings.json
- src/modules/i18n/locales/ru/settings.json
- src/modules/i18n/locales/tr/settings.json
- src/modules/i18n/locales/zh-CN/settings.json
- src/modules/i18n/locales/zh-TW/settings.json
- src/modules/i18n/locales/de/consent.json
- src/modules/i18n/locales/en/consent.json
- src/modules/i18n/locales/es/consent.json
- src/modules/i18n/locales/fr/consent.json
- src/modules/i18n/locales/id/consent.json
- src/modules/i18n/locales/it/consent.json
- src/modules/i18n/locales/ja/consent.json
- src/modules/i18n/locales/ko/consent.json
- src/modules/i18n/locales/ru/consent.json
- src/modules/i18n/locales/tr/consent.json
- src/modules/i18n/locales/zh-CN/consent.json
- src/modules/i18n/locales/zh-TW/consent.json
- tasks/gap-pat-scope-cockpit-act-ui.md

## Notes

该轴仍暗,理由:本任务是 PAT 勾选项与 consent 文案的完整性修复，判据全部落在真实勾选框、locale 键集合与浏览器读数上，没有可读的 L_D/L_G 学习轴量。

- 既有 `i18nAccessTokensCompleteness.test.ts` 比较整个 `accessTokens` 子树与 en；12 个 locale 同时新增键即可保持绿，不需要改它的 `REQUIRED_ACCESS_TOKEN_KEYS`，但要把它列入 AC6 回归。
- `localeDuplicateKeys.test.ts` 会检查 JSON 重复键；新增键照既有缩进插入即可。
- consent 测试文件已经 import `enConsent` 并加载真实翻译；新增的 12 语言检查可以复用该文件顶部已有的 `readFileSync`，路径按既有 jsdom 约定从 `process.cwd()` 解析。

## 完成记录

实现提交：`79cab7b5b feat(settings): expose cloudcli:cockpit:act in PAT scopes and consent risks`；随后 `git merge --no-edit develop` 得 `a7ee1d461`（无冲突），post-merge 复跑下述判据仍全绿。

### AC1 红态基线（worktree 起始 tip b6e1f31ab，改动前）

```
$ node -e "const s=require('fs').readFileSync('src/shared/constants.ts','utf8');console.log('cockpit:act in constants:', /cloudcli:cockpit:act/.test(s))"
cockpit:act in constants: false

$ node -e "…遍历 src/modules/i18n/locales/*/settings.json 读 accessTokens.scopes.cockpitAct…"
locales with accessTokens.scopes.cockpitAct: 0

$ grep -c "cockpitAct" src/modules/oauth-consent/OAuthConsentRoute.tsx
0
grep exit=1
```

### AC2 选项常量

`npx vitest run src/modules/settings/tests/i18nMcpSettingsCompleteness.test.ts` → `Test Files 1 passed (1)` / `Tests 5 passed (5)` / `# fail 0`，exit 0。

```
[AC2] PAT scope options (7): [{"scope":"cloudcli:read","writable":false,"labelKey":"read"},{"scope":"cloudcli:session:send","writable":true,"labelKey":"sessionSend"},{"scope":"cloudcli:session:create","writable":true,"labelKey":"sessionCreate"},{"scope":"cloudcli:session:control","writable":true,"labelKey":"sessionControl"},{"scope":"cloudcli:approve","writable":true,"labelKey":"approve"},{"scope":"cloudcli:navigate","writable":true,"labelKey":"navigate"},{"scope":"cloudcli:cockpit:act","writable":true,"labelKey":"cockpitAct"}]
[AC2] option label offenders (0): []
```

`cloudcli:cockpit:act` 恰好 1 条，`writable=true`，`labelKey=cockpitAct`，索引 6（数组最后一项）。

### AC3 settings 12 语言

```
[AC2] per-locale MCP+scope flat key counts: {"de/settings.json":24,"en/settings.json":24,"es/settings.json":24,"fr/settings.json":24,"id/settings.json":24,"it/settings.json":24,"ja/settings.json":24,"ko/settings.json":24,"ru/settings.json":24,"tr/settings.json":24,"zh-CN/settings.json":24,"zh-TW/settings.json":24}
[AC2] offenders (0): []
[AC3] per-locale key-set diffs vs en: 每个 locale 均为 {"missing":[],"extra":[]}
```

改动前 flat key 数为 23（对 `develop:src/modules/i18n/locales/en/settings.json` 用同一 flatten 判据实测 23），新增键后为 24；offenders=0，12 个 locale 键集合与 en 全等。

### AC4 consent 风险

`npx vitest run src/modules/oauth-consent/tests/oauthConsentPage.test.tsx` → `Test Files 1 passed (1)` / `Tests 19 passed (19)` / `# fail 0`，exit 0。

- `risk:'cockpitAct'` 徽标文案 = `Can confirm cockpit cards — may send messages, start sessions (which run commands) or apply fleet dispositions`（= `en/consent.json` 的 `scopes.risk.cockpitAct`），≠ `scopes.other` 的 `Additional permission requested by this application`。
- ```
[AC4] consent bundles (12): ["de/consent.json","en/consent.json","es/consent.json","fr/consent.json","id/consent.json","it/consent.json","ja/consent.json","ko/consent.json","ru/consent.json","tr/consent.json","zh-CN/consent.json","zh-TW/consent.json"]
[AC4] consent risk offenders (0): []
```

### AC5 取假形态（先提交实现再变异）

(i) 变异 diff：

```diff
-      "navigate": "Sitzung in einem Ihrer Browser öffnen (cloudcli:navigate)",
-      "cockpitAct": "Cockpit-Karten bestätigen — kann Nachrichten senden, Sitzungen starten (die Befehle ausführen) oder Fleet-Dispositionen anwenden (cloudcli:cockpit:act)"
+      "navigate": "Sitzung in einem Ihrer Browser öffnen (cloudcli:navigate)"
```

逐字失败行（`npx vitest run src/modules/settings/tests/i18nMcpSettingsCompleteness.test.ts`，exit 1，`Tests 3 failed | 2 passed`）：

```
FAIL … > gives every locale every required MCP / scope key, non-empty and not the key name
AssertionError: expected [ Array(1) ] to deeply equal []
+   "de/settings.json: accessTokens.scopes.cockpitAct is missing",
FAIL … > gives every locale exactly the same MCP / scope key set as en
AssertionError: de/settings.json key set vs en: expected { …(2) } to deeply equal { missing: [], extra: [] }
FAIL … > exposes cloudcli:cockpit:act last and resolves every scope labelKey in every locale
```

恢复：`git checkout -- src/modules/i18n/locales/de/settings.json` → 重跑 `Tests 5 passed (5)`。

(ii) 变异 diff：

```diff
   selection: 'scopes.risk.selection',
-  cockpitAct: 'scopes.risk.cockpitAct',
 };
```

逐字失败行（`npx vitest run src/modules/oauth-consent/tests/oauthConsentPage.test.tsx`，exit 1，`Tests 1 failed | 18 passed`）：

```
FAIL … > OAuthConsentRoute > badges a cockpit-act scope with its own risk text, not the generic fallback
AssertionError: Expected values to be strictly equal:
+ 'Additional permission requested by this application'
- 'Can confirm cockpit cards — may send messages, start sessions (which run commands) or apply fleet dispositions'
```

即删掉映射后回落到 `scopes.other` 泛化文案。恢复：`git checkout -- src/modules/oauth-consent/OAuthConsentRoute.tsx` → 重跑 `Tests 19 passed (19)`。

### AC6 不回归与仓库门

- `npx vitest run src/modules/settings/tests/i18nAccessTokensCompleteness.test.ts src/modules/i18n/tests/localeDuplicateKeys.test.ts` → `Test Files 2 passed (2)` / `Tests 7 passed (7)`，exit 0。
- post-merge（a7ee1d461）复跑 4 个相关文件 → `Test Files 4 passed (4)` / `Tests 31 passed (31)`。
- `npm run typecheck` → exit 0（post-merge 复跑亦 exit 0）。
- `npm run lint` → exit 0，`grep -c ": error "` = 0。

### AC7 delta 与 Touches 对齐

`git diff --stat develop...HEAD` → `28 files changed, 174 insertions(+), 31 deletions(-)`；`--name-status` 全部为 `M`（无新增文件），28 个文件逐条落在 `## Touches` 内（另 1 条 Touches 为本任务文件自身，由 task_write 提交，不计入实现 delta）。anti-drift 机械检查：`ANTI-DRIFT OK: task gap-pat-scope-cockpit-act-ui — 28 actual file(s), all within declared Touches (29 glob(s))`。

### DoD 读数

1. **真实浏览器（端口说明）**：DoD 指定的 5199 已被另一 sibling worktree 的 vite dev 占用（pid 1863914，cwd `…/claudecodeui-worktrees/task-gap-cockpit-card-create-session-action`），未杀它；在任务 worktree 以同一命令改用 5201、`VITE_CACHE_DIR=$PWD/tmp/vite-cache`，后端仍代理运行中的 `127.0.0.1:3001`。JWT 由 `~/.cloudcli/auth.db` 的 `app_config.jwt_secret` HS256 现签（`{userId:1,username:'yale'}`, 1h），`addInitScript` 写 `localStorage['auth-token']`。en 与 zh-CN 各一条腿，截图 `tmp/dod-pat-scope/pat-cockpit-act-scope.png`、`tmp/dod-pat-scope/pat-cockpit-act-scope-zh-CN.png`。结构化读数（en）：`scopeCount=7`、`cockpitPresent=true`、`cockpitDisabled=false`、`cockpitWritable="true"`、勾选前 `riskVisible=false` / 勾选后 `riskVisible=true`，标签逐字等于 en 的 `accessTokens.scopes.cockpitAct`；zh-CN 标签逐字等于 zh-CN 的同键文案（`确认驾驶舱卡片——可能发消息、开新会话（会话会运行命令）或对 fleet 应用处置（cloudcli:cockpit:act）`），两条腿 `pageErrors=[]`。
2. **真实签出并读回**：UI 创建 `dod-cockpit-act-1793288146986`，`tokenPrefix=ccp_dffb`（不写明文），`scopes=["cloudcli:read","cloudcli:cockpit:act"]`；UI 吊销后 `revokedAt=2026-10-29T15:35:48.105Z`（非空）。
3. **撤销副作用**：有两次 DoD 脚本运行（首次在 zh-CN 腿因语言偏好被判据拦截而中止，但其 en 腿已创建并吊销 token 283；第二次完整运行创建并吊销 token 284）。所有 `dod-cockpit-act-*` 测试令牌均已吊销；非测试令牌 id 集合 `[170,78,27]` 前后未变，`otherTokensChanged=false`、`otherTokensRevoked=[]`。完整运行报告 `tokensBefore={count:4,ids:[283,170,78,27]}` → `tokensAfter={count:5,ids:[284,283,170,78,27]}`，净增即已吊销的测试令牌 284。
4. **场景运行器**：`scripts/ui-scenario.mjs` 的 openers 是封闭词汇表，逐字为 `quay-panel` / `session` / `cockpit` / `cockpit-cards`，没有 Settings → API 的可用场景；按 AGENTS.md「存在可用场景时」本次不适用，浏览器实操是本次 UI DoD 的路径，未临时新增 opener。
5. **语言真实性**：en 与 zh-CN 在浏览器里实际渲染（见 DoD 1）；其余 10 个 locale 的新键由 AC3/AC4 的文件系统判据（offenders=0）背书。
6. **判据与取假形态**：AC2/AC3/AC4 绿；AC5 两条先红后恢复，变异 diff、逐字失败行、恢复命令见上。
7. **frontend-module-standards**：改动全部在 `src/` 内；新增 import 走 `@/shared/constants`；未新增模块、未导出无消费者符号；既有断言未削弱（consent 测试仅新增用例，settings 测试仅新增用例与 required-key）。

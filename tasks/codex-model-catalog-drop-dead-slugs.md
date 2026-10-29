---
id: codex-model-catalog-drop-dead-slugs
title: Codex 模型目录删除已下线的 gpt-5.5/gpt-5.4/gpt-5.4-mini，并把前端兜底模型改为 gpt-5.6-sol
status: done
labels:
  - defect
parent: null
children: []
extra: {}
---
## Proposal

<!-- dedup-ref --> 2026-10-30 立案期检索（root=/data/home/yale/work/claudecodeui）：`grep -rln 'CODEX_PREDEFINED_MODELS\|codex-models.provider' tasks/` → 0；`grep -rln 'gpt-5\.4\|gpt-5\.5\|gpt-5\.4-mini' tasks/` → 0；`ls tasks/ | grep -i codex-model` → 无同名任务。`grep -rln 'codex.*模型\|模型目录\|model catalog\|模型列表' tasks/` 只命中 4 个 custom-model / model-library 任务（自定义模型 CRUD、密钥写入、布局），机制与预置目录不同。`task-granularity-advice.js --root … --touches <本任务 4 个源码/测试文件> --json` → `peers: []`、`mentions: []`、`substantiveInputs=[codex-models.provider.ts, useChatProviderState.ts]`。决定：无重复、无同文件在飞 peer，单独立项。

### 判据与当下读数（2026-10-30 实测）

应用聊天使用打包的 `@openai/codex 0.153.4`：`@openai/codex-sdk` 自己解析 node_modules 里的平台二进制，`server/modules/providers/list/codex/codex-app-server.connection.ts:480-488` 也 `require.resolve('@openai/codex/bin/codex.js')` 后 spawn `app-server`；PATH 上的 `codex 0.165.0` 只被 auth 检查（`codex-auth.provider.ts:24`）和 Shell 标签页（`codex-shell.provider.ts`）使用。

- 打包 CLI 的 app-server `model/list` 返回 4 个可见模型：`gpt-6-astra`（isDefault，default effort low）、`gpt-5.6-sol`、`gpt-5.6-terra`、`gpt-5.6-luna`（均 medium）。
- 用打包二进制逐模型实跑 `node node_modules/@openai/codex/bin/codex.js exec --skip-git-repo-check -m <id> -c model_reasoning_effort=low "Reply with exactly: OK"`：上述 4 个 rc=0；`gpt-5.5`、`gpt-5.4`、`gpt-5.4-mini` 均 rc=1，逐字 `The '<id>' model is not supported when using Codex with a ChatGPT account.`（`model_not_found`）。
- PATH 的 0.165.0 目录有 8 个（多出 `gpt-6.1-sol`/`gpt-6.1-terra`/`gpt-6-sol`/`gpt-6-luna`），但打包 0.153.4 对 `gpt-6.1-sol` 同样报 model_not_found；聊天不走 PATH。
- `codex debug models`（打包二进制，310,947 字节，离线）与 `model/list` 的可见集合一致：astra / 5.6-sol / 5.6-terra / 5.6-luna。

### 缺陷

1. **P0 服务端预置目录含死项。** `server/modules/providers/list/codex/codex-models.provider.ts:85/:94/:103` 的 `OPTIONS` 仍列 `gpt-5.5`、`gpt-5.4`、`gpt-5.4-mini`，三者不在打包 CLI 目录、也不在 PATH 目录，实测均 400。选择器会展示它们；`assertSelectableModel`（`server/modules/providers/services/provider-models.service.ts:236-258`）按同一目录判 known，因此放行，请求到 codex 才失败。目录共 7 项，只有 4 项可用。
2. **P1 前端兜底是死模型。** `src/modules/chat/hooks/useChatProviderState.ts:34` 的 `FALLBACK_DEFAULT_MODEL.codex = 'gpt-5.4'`；目录尚未加载时（新浏览器首屏）第一次发送会带出它。`pickStoredOrCurrent`（同文件 :301-313）只在目录到达后回落，救不了首屏这一次。

### 要改的东西

1. **服务端目录**：删除 `gpt-5.5`、`gpt-5.4`、`gpt-5.4-mini` 三个 `OPTIONS`，保留 astra / 5.6-sol / 5.6-terra / 5.6-luna，`DEFAULT` 仍为 `gpt-5.6-sol`。不要改动保留项的 value/label/effort（本任务不顺手改 effort.default）。
2. **前端兜底**：`FALLBACK_DEFAULT_MODEL.codex` 改为 `'gpt-5.6-sol'`，与后端 `DEFAULT` 一致。
3. **回归钉子（不新建 server 测试文件）**：在既有 `server/modules/providers/tests/provider-models.service.test.ts` 增加一个用例：import 真实 `CODEX_PREDEFINED_MODELS`；用 `createRequire(import.meta.url).resolve('@openai/codex/bin/codex.js')` 取打包 launcher（仅解析失败时 skip）；在 `mkdtemp` 的临时 `CODEX_HOME` 下 `spawnSync(process.execPath, [launcher, 'debug', 'models'], { encoding: 'utf8', timeout: 30_000, maxBuffer: 16 * 1024 * 1024 })`（目录 JSON 有 310,947 字节，默认 1 MiB 上限必须显式抬高）；解析 stdout JSON，取 `visibility === 'list'` 的 slug 排序，与 `OPTIONS.map(o => o.value).sort()` 做 `assert.deepEqual`。不要读宿主 `~/.codex`。
4. **前端回归钉子**：在既有 `src/modules/chat/tests/chatProviderModels.test.ts` 增加一个用例：`localStorage.clear()` 后渲染 hook（该文件 mock 的 `providers.models` 返回 `data:null`，目录保持为空），断言 `result.current.providerModels.codex === 'gpt-5.6-sol'`。
5. **规范**：改 `server/` 前读 `.agents/skills/backend-module-standards/SKILL.md`；改 `src/` 前读 `.agents/skills/frontend-module-standards/SKILL.md`。

### 不在本任务内（已裁定，勿扩）

- 不新增 `gpt-6.1-*`/`gpt-6-*`：打包 CLI 仍停在 0.153.4，加了必挂；bump `@openai/codex` 是另一件事（resident 代码/注释/测试按 0.153.4 实测钉住）。
- 不改 `DEFAULT` 与打包 CLI `isDefault`（astra）的差异：本机 `~/.codex/config.toml` 的 `model` 已是 `gpt-5.6-sol`，换默认属产品决策。
- 不修 `gpt-5.6-sol` 的 `effort.default: 'low'`（目录写 medium）：全仓没有读取 `effort.default` 的消费方，是惰性元数据。
- 不处理历史会话已记录的 `gpt-5.4`：`resolveSessionModel` 记录优先，需用户在该会话重选一次；改语义另立任务。
- 不改 `src/shared/ui/ModelLibraryPanel.tsx` 的 placeholder `gpt-5.5-pro`（纯文案）。

## AC

- [x] AC1 **预置目录等于打包 CLI 的可见集合**：`npx tsx --tsconfig server/tsconfig.json --test server/modules/providers/tests/provider-models.service.test.ts` 退出 0；新增用例打印 `codex-catalog OPTIONS=<4 个 slug> visible=<4 个 slug>` 且 `assert.deepEqual` 通过。完成记录贴出 tests/pass/fail 与两行读数。
- [x] AC2 **三个死 slug 已从目录移除**：`! grep -n "gpt-5\.5\|gpt-5\.4" server/modules/providers/list/codex/codex-models.provider.ts` 退出 0（0 命中）；完成记录贴出空读数与 `grep -c` 的 0。
- [x] AC3 **前端兜底是 gpt-5.6-sol**：`npx vitest run src/modules/chat/tests/chatProviderModels.test.ts` 退出 0；新增用例在 `localStorage.clear()` 后断言 `providerModels.codex === 'gpt-5.6-sol'`。完成记录贴出 passed 数与用例名。
- [x] AC4 **假形态 A 必红（目录加回死项）**：临时把 `gpt-5.4` 加回 `OPTIONS` ⇒ AC1 同命令退出 1，失败信息包含该 slug 与两侧集合；抄下逐字失败行，还原后 AC1 退出 0。
- [x] AC5 **假形态 B 必红（兜底改回 gpt-5.4）**：临时把 `FALLBACK_DEFAULT_MODEL.codex` 改回 `'gpt-5.4'` ⇒ AC3 同命令退出 1；抄下逐字失败行，还原后 AC3 退出 0。
- [x] AC6 **兄弟判据无回归**：`npx tsx --tsconfig server/tsconfig.json --test server/modules/providers/tests/codex-host-driver-settings.test.ts` 与 `npx tsx --tsconfig server/tsconfig.json --test server/modules/providers/tests/provider.routes.test.ts` 各自退出 0。完成记录贴出两条 tests/pass/fail。
- [x] AC7 **类型与 lint**：`npm run typecheck` 与 `npm run lint` 均退出 0。
- [x] AC8 **Touches 与 anti-drift**：`node --no-warnings /data/home/yale/.claude/plugins/cache/quay/quay/0.24.0/scripts/dist/anti-drift-touches-check.js --task codex-model-catalog-drop-dead-slugs --worktree <worktree> --merge-target develop` 打印 `ANTI-DRIFT OK`；`git diff --name-only develop...HEAD` 只含 Touches 内文件。

## DoD

真实对象验收：应用真的按新目录工作，而不是只有测试绿。

1. 在 worktree 起真实前端与后端（`npm run server:dev` 与 `npm run client`），用 MCP 浏览器打开真实页面；选 codex，打开模型选择器：恰好 4 个选项（GPT-6 Astra / GPT-5.6 Sol / GPT-5.6 Terra / GPT-5.6 Luna），页面可见文本与 DOM 中不存在 `gpt-5.5` / `gpt-5.4` / `gpt-5.4-mini`。截图存 `tmp/codex-model-catalog-after.png` 并贴进完成记录。
2. 同一实例 `GET /api/providers/codex/models` 的 `OPTIONS[].value` 集合等于上述 4 个；贴出响应 JSON 片段。
3. 在浏览器里 `localStorage.removeItem('codex-model')` 后重载新会话页，模型触发器显示 `GPT-5.6 Sol`（不是 `GPT-5.4`）；贴出触发器逐字文本与 `localStorage.getItem('codex-model')` 读数。
4. 反向读数：在修复前的树（develop tip）同一路径的选择器显示 7 项且含三个死 slug；若不复跑旧树，须在完成记录里贴出立案时已记录的 7 项读数并说明未复跑的原因。
5. 证据落盘：截图、API JSON、localStorage 读数都写进完成记录；UI 读数必须来自 MCP 浏览器的真实操作，不能用 curl 代替选择器操作。

## 完成记录

### 改动

- `server/modules/providers/list/codex/codex-models.provider.ts`：删除 `gpt-5.5`、`gpt-5.4`、`gpt-5.4-mini` 三个 `OPTIONS`，保留 `gpt-6-astra` / `gpt-5.6-sol` / `gpt-5.6-terra` / `gpt-5.6-luna`；`DEFAULT` 仍 `gpt-5.6-sol`。保留项字段未动。
- `src/modules/chat/hooks/useChatProviderState.ts`：`FALLBACK_DEFAULT_MODEL.codex` `'gpt-5.4'` → `'gpt-5.6-sol'`。
- `server/modules/providers/tests/provider-models.service.test.ts`：新增用例 `the predefined Codex catalog equals the packaged CLI account catalog`。
- `src/modules/chat/tests/chatProviderModels.test.ts`：新增用例 `an empty codex catalog falls back to a model the packaged CLI can run`。
- 分支 `task/codex-model-catalog-drop-dead-slugs`，实现提交 `61755859e`；收尾前已两次 `git merge --no-edit develop`（最新 develop tip `6f0283360`，只带 tasks 文件），`git merge-base --is-ancestor develop HEAD` 退出 0，工作树干净。

### AC 读数

AC1：`npx tsx --tsconfig server/tsconfig.json --test server/modules/providers/tests/provider-models.service.test.ts` → exit 0，`tests 27 / pass 27 / fail 0`；用例打印：

```
codex-catalog OPTIONS=gpt-5.6-luna,gpt-5.6-sol,gpt-5.6-terra,gpt-6-astra visible=gpt-5.6-luna,gpt-5.6-sol,gpt-5.6-terra,gpt-6-astra
```

AC2：`! grep -n "gpt-5\.5\|gpt-5\.4" server/modules/providers/list/codex/codex-models.provider.ts` → exit 0，输出为空；`grep -c` → `0`。

AC3：`npx vitest run src/modules/chat/tests/chatProviderModels.test.ts` → exit 0，`Tests 6 passed (6)`；用例名 `an empty codex catalog falls back to a model the packaged CLI can run`。

AC4：临时把 `gpt-5.4` 加回 `OPTIONS` → AC1 同命令 exit 1，逐字失败行：

```
AssertionError [ERR_ASSERTION]: Expected values to be strictly deep-equal:
+ actual - expected
+ [ 'gpt-5.4', 'gpt-5.6-luna', 'gpt-5.6-sol', 'gpt-5.6-terra', 'gpt-6-astra' ]
- [ 'gpt-5.6-luna', 'gpt-5.6-sol', 'gpt-5.6-terra', 'gpt-6-astra' ]
```

还原后 AC1 再跑 exit 0、27/27。

AC5：临时把 `FALLBACK_DEFAULT_MODEL.codex` 改回 `'gpt-5.4'` → AC3 同命令 exit 1，逐字失败信息：

```
AssertionError [ERR_ASSERTION]: Expected values to be strictly equal:
+ actual - expected
+ 'gpt-5.4'
- 'gpt-5.6-sol'
```

还原后 AC3 再跑 exit 0、6 passed。

AC6：`codex-host-driver-settings.test.ts` → exit 0，`tests 6 / pass 6 / fail 0`；`provider.routes.test.ts` → exit 0，`tests 6 / pass 6 / fail 0`。

AC7：`npm run typecheck` → exit 0；`npm run lint` → exit 0。

AC8：`ANTI-DRIFT OK: task codex-model-catalog-drop-dead-slugs — 4 actual file(s), all within declared Touches (5 glob(s))`；`git diff --name-only develop...HEAD` →

```
server/modules/providers/list/codex/codex-models.provider.ts
server/modules/providers/tests/provider-models.service.test.ts
src/modules/chat/hooks/useChatProviderState.ts
src/modules/chat/tests/chatProviderModels.test.ts
```

（收尾合并最新 develop 后又跑了一次，读数同上。）

### 实现偏离与说明（Proposal 第 3 条）

Proposal 写“临时 `CODEX_HOME` 下 `debug models` 得到 310,947 字节的 4 项目录”只对**带账号凭证并成功联网刷新**的 `CODEX_HOME` 成立。实测：空的临时 `CODEX_HOME` 会回落到**打包内置目录**（517,840 字节，`visibility=list` 有 6 项，含 `gpt-5.5`、`gpt-5.2`）；把宿主 `~/.codex/auth.json` 复制进临时 `CODEX_HOME` 后联网刷新才得到 310,947 字节 / 4 项。因此测试的实现是：复制宿主 auth.json（宿主无该文件时 skip）→ 分别跑 `debug models`（刷新）与 `debug models --bundled`（内置）→ 两者可见集合相同即视为刷新失败（离线）并 skip，否则打印 `codex-catalog …` 并对刷新后的可见集合与 `CODEX_PREDEFINED_MODELS` 做 `assert.deepEqual`。AC1 的断言目标与文案未改；只是让“目录来源”在离线时可判、不产生假绿。

### DoD 读数

真实前端 + 真实后端：`scripts/isolated-instance.sh` 起隔离实例（真实构建产物 server，端口 3109），vite dev（5199）经 `SERVER_PORT=3109` 代理；Playwright 驱动真实页面（`tmp/codex-dod/dod.mjs`，报告 `tmp/codex-model-catalog-report.json`）。

1. 选择 codex 后打开模型选择器（composer 的 `role=menu` “Select model and reasoning effort”），选项逐字为 `GPT-6 Astra / GPT-5.6 Sol / GPT-5.6 Terra / GPT-5.6 Luna`，计数 `4`；菜单文本与页面 body 均无 `gpt-5.5` / `gpt-5.4`（`composerMenuMentionsDeadSlugs=false`、`pageBodyMentionsDeadSlugs=false`）。全 provider 的 “Choose a model” 对话框里的 **OpenAI 组**同样只有上述 4 项；该对话框里仍可见的 `gpt-5.5`/`gpt-5.4` 来自 Cursor / OpenCode 等其他 provider 的组与用户自定义模型，不属本任务目录。截图：`tmp/codex-model-catalog-after.png`（另存 `tmp/codex-model-catalog-fallback.png`、供应商选择器 `tmp/codex-dod/codex-provider-picker.png`）。`pageErrors=[]`。
2. 同一实例 `GET /api/providers/codex/models` → `OPTIONS[].value = gpt-6-astra, gpt-5.6-sol, gpt-5.6-terra, gpt-5.6-luna`，`DEFAULT=gpt-5.6-sol`；完整响应 `tmp/codex-models-api.json`。
3. `localStorage.removeItem('codex-model')` 后重载新会话页：触发器逐字 `GPT-5.6 Sol`，`localStorage.getItem('codex-model')` → `gpt-5.6-sol`。选择后同样读到 `triggerAfterPick=GPT-5.6 Sol`、`storedAfterPick=gpt-5.6-sol`。
4. 反向读数：未重建旧树复跑。立案时（develop tip）同一路径的读数已记录为 7 项 `gpt-6-astra / gpt-5.6-sol / gpt-5.6-terra / gpt-5.6-luna / gpt-5.5 / gpt-5.4 / gpt-5.4-mini`；另以主检出未重建的 dist 产物与运行在 :3001 的实例 API 复核，仍返回 7 项且含三个死 slug，与立案读数一致，故未再为旧树单独起前端。不复跑原因：旧树需 checkout 到另一个 worktree 并重建前端，仅复述同一条已被主检出 dist/API 佐证的读数，成本高于信息量。
5. 证据均在 worktree 的 `tmp/`（gitignored，不随分支提交）：`codex-model-catalog-after.png`、`codex-model-catalog-fallback.png`、`codex-model-catalog-report.json`、`codex-models-api.json`、`codex-dod/`（脚本与报告）。UI 读数全部来自真实页面操作，未用 curl 代替。

### 暗轴（ADR-007）

该轴仍暗,理由:本任务只删除三个死 slug 常量并改一处前端兜底字符串，未新增或移动模块与依赖，结构读数与本次缺陷无关。

## Touches

- server/modules/providers/list/codex/codex-models.provider.ts
- server/modules/providers/tests/provider-models.service.test.ts
- src/modules/chat/hooks/useChatProviderState.ts
- src/modules/chat/tests/chatProviderModels.test.ts
- tasks/codex-model-catalog-drop-dead-slugs.md
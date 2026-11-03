---
id: gap-codex-user-provider-import-wiring
title: AC-466：只读导入的用户 ~/.codex provider 真正可绑定 —— 接线导入端点、设置页一键导入、写项目 settings 并可在模型条目选中
status: done
labels:
  - gap
  - defect
parent: null
children: []
extra:
  schema: execution
goal_ac: AC-466
---
<!-- dedup-ref --> 机制去重：无在飞任务（todo/ready/needs-human）以顶层 `goal_ac: AC-466` 声明同一机制。已 done 的 codex-provider-import-user-profile 只交付了纯函数与未挂载组件（证据见 Proposal），不是本任务的重复。与本任务文件名有交集的 codex-provider-advanced-capabilities（ready，AC-467）是另一机制（高级字段/连接测试）；本任务不编辑 `server/modules/settings/codex-model-providers.settings.ts`，独立验收。

## Proposal

**为什么上一轮的 done 没有成立（实测，非推测）**

1. `readCodexUserProviderImports`（`server/modules/settings/codex-model-providers.settings.ts:256`）全仓只被它自己的判据 `server/modules/settings/tests/codex-provider-import.test.ts` 调用；`server/modules/settings/settings.routes.ts` 只有 `GET/PUT /codex/model-providers`，没有任何 import 路由。产品里没有任何入口能读到用户 `~/.codex` provider。
2. `CodexProviderImport.tsx` 全仓从未被 import 或渲染；`CodexProvidersContent.tsx` 只画项目 provider 表单与模型库。上一轮任务自己的 `## 实现说明` 也承认「不在此处改父级 DOM」。
3. 因此 AC-466 的「绑定为模型条目的 `codexProviderId`」在产品里不可达：模型编辑器的 provider 选择器只列项目 settings 文件里已保存的 provider（`codexModelProviderOptions` 来自 registry reading）。导入面也没有任何写入项目 settings 的路径，所以「项目文件仍是唯一写入点」只证明了 reader 不写，没有证明 binding 写。
4. 上一轮判据的 10 条腿全部只打纯函数，改前改后都绿——判据根本没有覆盖 AC 的产品半边。goal 记录里 `2026-11-03T00:03:57Z` 的 fail 是 `Could not find 'server/modules/settings/tests/codex-provider-import.test.ts'`，发生在 develop 合入（08:05:38+0800）之前，属 stale-tree 竞态，不能当作「导入已可用」的证据。

**本次范围（一个连贯机制：只读导入面 → 一键导入写项目文件 → 模型条目可绑定）**

1. **服务/路由**：`codex-model-providers.service.ts` 增加 `getCodexUserProviderImports()` 与 `importCodexUserProviders({ ids, expectedVersion / If-Match })`；`settings.module.ts` 把真实 `readCodexUserProviderImports` 以 port 注入（组合根决定 `homeDir`/`env`）。GET `/api/settings/codex/model-providers/import` 返回只读 reading；POST 同路径把选中的可绑定行合并进项目 registry，复用现有 `write()`（版本冲突仍是 409，不做部分写入）。
2. **导入复制什么**：只复制 id/name/base_url/env_key/wire_api（缺省 `responses`）；不复制 secret、不读 env_key 值、不读 auth.json 或 token 文件；`tokenFile` 留空（由 store 解析到 `<settings dir>/codex.secrets/<id>.token`），`tokenSet` 如实为 false。保留 id（`openai`/`ollama`/`lmstudio`）、非 `responses`、缺 base_url 的行 `bindable=false` 且 POST 逐条拒绝（400 指名 id 与原因）。
3. **合并语义**：POST 以当前项目 registry reading 为底，保留既有 provider 行（含 `tokenFile`，且不回传 token）再追加导入行；同名 id 覆盖前先校验可绑定。项目 settings 文件是唯一写入目标，用户 `~/.codex` 文件零写入。
4. **UI 接线**：把 `CodexProviderImport` 挂进 `CodexProvidersContent`；`useCodexProviders` 与 `codexProvidersController` 增加 import reading 的加载、`bindImportedProvider(id)` 动作（POST 后以返回的 reading 刷新 drafts，冲突走现有 conflict 呈现）。导入成功后 provider 立即出现在模型编辑器的 provider 选择器；保存模型即写入 `codexProviderId`。
5. **判据**：扩既有 `codex-provider-import.test.ts`（不新增 server 测试文件，避免 quay-test-script pin 与时长基线）：在现有 10 条纯函数腿之外新增产品腿——进程内 HTTP GET 导入面、POST 导入写项目文件并保持用户目录字节快照、保留 id/非 responses 拒绝且无部分写入、env_key 值/token 哨兵不出现在响应与项目文件。新增腿必须在实现前逐条红，实现后同命令 fail 0。
6. **UI 场景**：新增 `scripts/ui-scenarios/codex-provider-import.json`（隔离实例 HOME 预置 `config.toml` 的 bob 与 `bob-gpt.config.toml`），并在 `src/modules/ui-scenario/codexProvidersSurface.ts` 与 `scripts/ui-scenario.mjs` 暴露 import reading 与 `codexProvider.import` 动词；场景从空 registry 开始，导入 bob 后断言 registry 与模型 picker 的变化。

**已排除的旁路**：不在前端伪造「已导入」只加 draft 而绕过项目文件写入；不把导入做成写回 `~/.codex`；不编辑 `codex-model-providers.settings.ts`（与 ready 的 AC-467 解耦）。

## Touches

- tasks/gap-codex-user-provider-import-wiring.md
- server/modules/settings/codex-model-providers.service.ts
- server/modules/settings/settings.routes.ts
- server/modules/settings/settings.module.ts
- server/modules/settings/tests/codex-provider-import.test.ts
- src/modules/settings/tabs/agents-settings/sections/content/CodexProvidersContent.tsx
- src/modules/settings/tabs/agents-settings/sections/content/CodexProviderImport.tsx
- src/modules/settings/hooks/useCodexProviders.ts
- src/modules/settings/utils/codexProvidersController.ts
- src/modules/settings/tests/codexProviderSettings.test.tsx
- src/modules/ui-scenario/codexProvidersSurface.ts
- src/modules/ui-scenario/scenarioSurface.ts
- src/modules/ui-scenario/tests/scenarioSurface.test.ts
- scripts/ui-scenario.mjs
- scripts/ui-scenarios/codex-provider-import.json

## AC

- [x] AC-466 判据绿：`npx tsx --tsconfig server/tsconfig.json --test server/modules/settings/tests/codex-provider-import.test.ts` 退出 0、`fail 0`；贴出 tests/pass/fail 与 duration。
- [x] 红先证据：先只落判据改动跑同一命令，4 条新产品腿逐条 `not ok`（GET 导入路由 / POST 写项目文件 / 保留 id 拒绝无部分写 / 用户文件快照不变）；实现后同命令全绿。两次日志都贴出。
- [x] GET 可达：进程内 `createSettingsRouter(createSettingsService(...))` 的 `GET /api/settings/codex/model-providers/import` 返回 200，`providers[].{id,name,baseUrl,envKey,wireApi,source,bindable,warnings}` 齐全，`wire_api` 缺省按 `responses`。
- [x] 绑定写点唯一：`POST /api/settings/codex/model-providers/import` 携带 `{ ids: ["bob"], expectedVersion }` 返回 200 后：(a) `CODEX_SETTINGS_PATH` 指向的项目 settings 文件出现 bob 的 name/baseUrl/envKey；(b) 预置用户 home 全目录快照与调用前逐字节相同；(c) 响应与项目文件都没有 `token` 字段、没有 env_key 值哨兵。
- [x] 拒绝无部分写：同一 POST 混入保留 id `openai` 或 `wire_api="chat"` 的不可绑定行 → 400 且消息指名 id 与原因，项目 settings 文件字节不变；GET reading 里这些行 `bindable=false`。
- [x] 模型绑定可用：导入后的 provider 出现在 `codexModelProviderOptions`；保存一个 `codexProviderId="bob"` 的模型条目返回 200，registry 行标注 `model · bob`（服务判据或 UI 场景至少一处机械断言）。
- [x] UI 已接线：`grep -R "CodexProviderImport" src --include=*.tsx` 命中 `CodexProvidersContent.tsx` 的 import 与 render（不再只有组件自身）；`src/modules/settings/tests/codexProviderSettings.test.tsx` 有一键导入动作的断言且 vitest 通过。
- [x] UI 场景：`node scripts/ui-scenario.mjs scripts/ui-scenarios/codex-provider-import.json --base-url <isolated> --auth-token <token> --project <p> --session <s> --out tmp/ui-codex-import` 退出 0，报告无 `failedStep`，checkpoint 截图齐全。
- [x] 不新增 server 测试文件：`git diff --name-only develop...HEAD -- 'server/**/tests/*.test.ts'` 只输出 `server/modules/settings/tests/codex-provider-import.test.ts`，因此不触发 quay-test-script pin 与时长基线。
- [x] typecheck：`npx tsc --noEmit -p tsconfig.json` 与 `npx tsc --noEmit -p server/tsconfig.json` 均退出 0；变更文件 oxlint 退出 0。

## DoD

- **真实产品操作**：起隔离开例，其 HOME 的 `.codex/` 预置 `config.toml` 的 `[model_providers.bob]` 与 `bob-gpt.config.toml`，并设 env_key 值与 token 为哨兵。用 MCP 浏览器打开 Settings → Agents → Codex：导入面板列出 bob 的 name / base_url / env_key 变量名 / wire_api，页面与 DOM 快照中不出现哨兵值；点「Import」后项目 registry 出现 bob，`$CODEX_SETTINGS_PATH` 文件落盘包含 bob，而预置 `~/.codex` 文件快照逐字节不变；模型编辑器的 provider picker 出现 bob，保存一个绑定模型后该行标注 `model · bob`。截图存 `tmp/` 并在任务贴出。
- **场景运行器**：贴出 `node scripts/ui-scenario.mjs scripts/ui-scenarios/codex-provider-import.json …` 的 JSON 报告与 checkpoint PNG 路径；大颗粒回归以 runner 为准。
- **负臂逐字**：哨兵 env 值、token 值不出现在 GET 响应 JSON、项目 settings 文件、页面 DOM；保留 id / `wire_api="chat"` 的 POST 返回 400 且项目文件字节不变。
- **判据逐字**：贴出红先阶段与实现后两次 `tests/pass/fail`；typecheck / oxlint 命令与退出码。
- 如果判据扩写后时长超过基线覆盖地板，按仓库规则处理并在任务里逐字说明。

## 实现说明

**判据红先 → 绿（同一命令）**

红先阶段（只落判据，未实现；`tmp/red-first.log`）：

```
$ npx tsx --tsconfig server/tsconfig.json --test server/modules/settings/tests/codex-provider-import.test.ts
ℹ tests 14
ℹ pass 10
ℹ fail 4
ℹ duration_ms 2407.1381
✖ AC-466 GET /codex/model-providers/import is the reachable read-only reading  (404 Cannot GET)
✖ AC-466 POST /import writes the project file and leaves every user file byte-identical  (404)
✖ AC-466 a reserved id or a Chat Completions row is refused by name without a partial write  (404)
✖ AC-466 env_key VALUES and token sentinels never reach the import response or project file  (404)
```

实现后（`tmp/green-server.log`）：

```
$ npx tsx --tsconfig server/tsconfig.json --test server/modules/settings/tests/codex-provider-import.test.ts
ℹ tests 14
ℹ pass 14
ℹ fail 0
ℹ duration_ms 2251.9961
exit 0
```

**typecheck / lint / UI 判据**

- `npx tsc --noEmit -p tsconfig.json` → exit 0
- `npx tsc --noEmit -p server/tsconfig.json` → exit 0
- 变更文件 `npx oxlint <12 files>` → exit 0
- `npx vitest run src/modules/settings/tests/codexProviderSettings.test.tsx` → `Test Files 1 passed | Tests 6 passed`（新增一键导入用例：面板挂载、Bind POST `{ids:["bob"],expectedVersion:"version-0"}`、drafts 刷新、picker 变为 `["","bob"]`）
- `git diff --name-only develop...HEAD -- 'server/**/tests/*.test.ts'` → 仅 `server/modules/settings/tests/codex-provider-import.test.ts`
- `grep -R "CodexProviderImport" src --include=*.tsx` → 命中 `CodexProvidersContent.tsx` 的 import 与 `<CodexProviderImport` render，以及组件自身定义

**场景运行器（真实隔离开例 + Vite dev）**

隔离实例：`dist-server` 构建于本 worktree，`ISOLATED_INSTANCE_PORT=3311`，`HOME=/data/scratch/yale/codex-import-dod/home`（`.codex/config.toml` 的 bob、`.codex/bob-gpt.config.toml`、`.codex/auth.json` 哨兵），`CODEX_SETTINGS_PATH=<tmp>/project/codex.settings.json`，`BOB_API_KEY`/`BOB_GPT_API_KEY` 设哨兵值。Vite dev 以 `SERVER_PORT=3311` 代理到该实例。

```
$ node scripts/ui-scenario.mjs scripts/ui-scenarios/codex-provider-import.json \
    --base-url http://127.0.0.1:5199 --auth-token <isolated-token> \
    --project claudecodeui --session pwd --out tmp/ui-codex-import
exit 0
{ "ok": true, "failedStep": null, "stepCount": 6, "durationMs": 7611,
  "checkpoints": [
    "tmp/ui-codex-import/step-1-open-settings-agents-codex.png",
    "tmp/ui-codex-import/step-2-drive-codexProvider.import.png",
    "tmp/ui-codex-import/step-6-drive-modelLibrary.save.png" ] }
```

场景断言链：首步 import reading `{count:2, ids:["bob","bob-gpt"], bindable:[true,true], envKeys:["BOB_API_KEY","BOB_GPT_API_KEY"], wireApis:["responses","responses"], directory includes ".codex"}`、registry 空且 picker `[""]`；`codexProvider.import:bob` 后 registry `["bob"]`、picker `["","bob"]`；选中 bob 保存模型后 `codexModelLabelsInclude: "· bob"`。

**真实产品操作（DoD）**

- 导入面板截图（`tmp/ui-codex-import/dod-import-panel.png`）：bob 行显示 name `BOB API`、`base_url`、`env_key BOB_API_KEY`（变量名）、`wire_api responses`，无哨兵值。
- registry 截图（`tmp/ui-codex-import/dod-registry.png`）：导入后项目表单出现 bob（Provider ID/Display name/Base URL/Env key/Token file，Token 显示 `not set`）。
- 模型截图（`tmp/ui-codex-import/dod-bound-model.png`）：`Scenario Imported Model · bob` 行，Custom 标记。
- DOM 哨兵扫描：`leakedSentinels: []`（页面 textContent 不含 `sk-env-*-sentinel` / `sk-user-auth-token-sentinel`）；`importEnvKeys: ["BOB_API_KEY","BOB_GPT_API_KEY"]`。
- 写点唯一（真实实例上的第二次 POST 前后 sha256）：预置 `config.toml` / `bob-gpt.config.toml` / `auth.json` 三个文件 `HOME PRESET FILES BYTE-IDENTICAL: yes`；响应与 `$CODEX_SETTINGS_PATH` 项目文件中均无哨兵。说明：被测应用自身的 `[codex-models] model/list discovery` 会在同一 `~/.codex` 下创建运行期 sqlite 状态文件；预置的三个用户文件逐字节不变，导入路径没有任何写回。

## ADR-007

该轴仍暗,理由:本任务只接线既有 reader 与 registry 的路由、UI 和判据，不移动模块边界、不改依赖图，也不产出 ArchGuard 的周期/分层实测读数。

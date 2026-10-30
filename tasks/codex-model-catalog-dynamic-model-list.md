---
id: codex-model-catalog-dynamic-model-list
title: Codex 模型目录改为 app-server model/list 动态发现：TTL 缓存＋静态兜底，明确推翻
  no-provider-native-discovery 约定
status: done
labels:
  - feature
parent: null
children: []
extra: {}
depends_on:
  - codex-cli-bump-0-166
---
## Proposal

<!-- dedup-ref --> 2026-10-30 立案期检索（root=/data/home/yale/work/claudecodeui）：`grep -rln 'model/list' tasks/` 只命中 `codex-model-catalog-drop-dead-slugs`（它用的是 `debug models`，不是 app-server `model/list`）；`grep -rln 'provider-native discovery\|动态发现\|模型发现' tasks/` 同样只命中该任务；`ls tasks/ | grep -iE 'dynamic-catalog|model-list'` 为空。task-granularity-advice 报 `peers: [codex-model-catalog-drop-dead-slugs]`（共享 `server/modules/providers/list/codex/codex-models.provider.ts`），同文件串行由 frontmatter 表达，正文不复述。

**本任务明确推翻 `server/modules/providers/services/provider-models.service.ts` 里的这句现行设计约定：**

> Curated adapter definitions stay source-controlled and are merged at read time with custom SQLite rows. This deliberately has no predefined-model persistence, memory cache, disk cache, TTL, or provider-native discovery.

**新契约（本任务落地后）：**

1. provider 适配器可以做 provider-native discovery；Codex 适配器以 app-server `model/list` 为主来源。
2. 内存缓存（TTL + single-flight）属于适配器，不属于 service；service 仍只做 merge 与校验。
3. 持久化仍然只有 custom rows（SQLite）；发现结果不落盘。
4. 静态 `CODEX_PREDEFINED_MODELS` 降级为兜底与离线对照，不再是唯一来源。

### 证据（2026-10-30 实测）

- app-server `model/list` 在 0.153.4 与 0.165.0 都存在；没有 auth.json 也返回目录，且与有 auth 时相同。
- 返回字段：`id`/`model`、`displayName`、`description`、`defaultReasoningEffort`、`supportedReasoningEfforts[].reasoningEffort`、`hidden`、`isDefault`；分页用 `nextCursor`（当前两版都一次返回完）。
- 它反映 CLI 自带目录，不是账号 entitlement；账号不可用仍会在 turn 时报 400。本任务不承诺解决 entitlement。

### 设计

1. `server/modules/providers/list/codex/codex-app-server.client.ts`：新增 `listModels()`，用现有 `withAppServer` 起一次 app-server，循环 `model/list { cursor }` 直到 `nextCursor` 为空；导出纯函数 `collectModelPages(call)` 供单测注入假 call。整次调用有上限（≤3s），超时或失败返回 null。
2. `server/modules/providers/list/codex/codex-models.provider.ts`：`getSupportedModels()` 改为"活的优先、静态兜底"：
   - 可注入 `listModels` 与 `now`（默认真实实现）；
   - 缓存 5 分钟，single-flight；key 含打包 CLI 版本与 `CODEX_HOME`；
   - 只取 `hidden === false` 的项；`isDefault` → `DEFAULT`；`defaultReasoningEffort` → `effort.default`；`supportedReasoningEfforts[].reasoningEffort` → `effort.values`；
   - 失败、超时或空集合 → 返回 `CODEX_PREDEFINED_MODELS`；失败最多缓存 30 秒，避免 spawn 风暴；
   - 暴露内部读数 `lastCatalogSource(): 'live' | 'cache' | 'fallback'` 供 DoD 证明走的是活目录。
3. `server/modules/providers/services/provider-models.service.ts`：把上面那段 "deliberately has no ... provider-native discovery" 换成新契约四条；保留"custom rows 是唯一持久化"。
4. **测试放既有文件，不新建 server 测试文件**（避免时长基线与脚本 pin）：
   - `server/modules/providers/tests/provider-models.service.test.ts`：映射、TTL、single-flight、fallback、与 custom rows 合并；
   - `server/modules/providers/tests/codex-app-server-protocol.test.ts`：`collectModelPages` 的两页拼接与按 id 去重。
5. 跑 `server/shared/tests/server-import-cycle-budget.test.ts` 与 `server/modules/providers/tests/providers-websocket-cycle.test.ts`，确认新增 import 边没有改变 SCC 预算；需要时按 AC-394 的既有钉子处理。

### 不在本任务内

- 不改 UI；前端继续消费 `/api/providers/codex/models`。
- 不改 `resolveSessionModel` 的记录优先语义。
- 不把发现的目录缓存到 SQLite。
- 不展示 hidden 模型；不做账号 entitlement 预判。

## AC

- [x] AC1 **映射正确**：注入假 lister 返回 3 项（1 项 hidden、1 项 isDefault、各自不同 efforts），`getSupportedModels()` 返回恰好 2 项可见模型，`value/label/description/effort.default/effort.values` 与假数据逐项相等，`DEFAULT` 等于 isDefault 项的 id。完成记录贴出断言与返回值。
- [x] AC2 **TTL 与 single-flight**：TTL 内连续两次调用 lister 只被调用 1 次；把注入时钟推过 TTL 后再调用变成 2 次；两次并发调用在冷缓存下也只有 1 次 lister 调用。完成记录贴出计数。
- [x] AC3 **静态兜底**：lister reject 或返回空数组时，`getSupportedModels()` 返回与 `CODEX_PREDEFINED_MODELS` 完全相等的定义；失败缓存不超过 30 秒（用注入时钟验证第二次仍在窗口内不重试、过后重试）。完成记录贴出两侧对象与计数。
- [x] AC4 **分页拼接**：`collectModelPages` 面对假 call 的两页（第二页 `nextCursor: null`）返回拼接结果；同一 id 出现在两页时只保留一份。完成记录贴出输入页与输出 id 列表。
- [x] AC5 **与 custom rows 合并不变**：真实 service 在动态定义之上合并自定义行；自定义行仍可覆盖/新增，预置项仍不可编辑。完成记录贴出合并后的 id 列表与 custom 行。
- [x] AC6 **活目录与 CLI 一致且有来源读数**：真实服务第一次 `GET /api/providers/codex/models` 后 `lastCatalogSource()` 为 `live`，第二次为 `cache`，返回集合等于打包 CLI 的 `model/list` 可见集合。完成记录贴出两次来源读数与集合。
- [x] AC7 **旧约定已推翻**：`! grep -n "deliberately has no" server/modules/providers/services/provider-models.service.ts` 退出 0；`grep -rn "no provider-native discovery" server/ docs/ README.md` 0 命中；新契约段落存在并贴出逐字内容。
- [x] AC8 **导入图与类型**：`npx tsx --tsconfig server/tsconfig.json --test server/shared/tests/server-import-cycle-budget.test.ts` 与 `... --test server/modules/providers/tests/providers-websocket-cycle.test.ts` 各自退出 0；`npm run typecheck` 与 `npm run lint` 均退出 0。
- [x] AC9 **Touches 与 anti-drift**：`node --no-warnings /data/home/yale/.claude/plugins/cache/quay/quay/0.24.0/scripts/dist/anti-drift-touches-check.js --task codex-model-catalog-dynamic-model-list --worktree <worktree> --merge-target develop` 打印 `ANTI-DRIFT OK`；`git diff --name-only develop...HEAD` 只含 Touches 内文件。

## DoD

真实对象验收：应用真的从 CLI 目录取模型，而不是继续读常量。

1. 真实服务启动后 `GET /api/providers/codex/models` 的集合等于打包 CLI `model/list` 的可见集合；贴出两侧与 `lastCatalogSource()` 的 `live` / `cache` 两次读数。
2. 真实页面里打开 codex 模型选择器，看到的选项与 API 一致（数量与 id）；截图存 `tmp/codex-model-dynamic-catalog.png`。
3. 缓存行为：同一实例连续两次请求 API，服务端日志显示第一次有一次 lister 调用、第二次没有；贴出两条日志行。
4. 兜底演练：临时让 lister 指向一个 reject 的假实现（单测或脚本），`getSupportedModels()` 返回静态定义；贴出读数后还原。
5. 新契约：完成记录贴出 `provider-models.service.ts` 新段落逐字内容，并说明 custom rows 仍是唯一持久化。

## 完成记录

worktree：`/data/home/yale/work/claudecodeui-worktrees/task-codex-model-catalog-dynamic-model-list`（分支 `task/codex-model-catalog-dynamic-model-list`，基于 develop `f4152b858`）。

commits：

- `f59faa3a` feat(codex): discover the model catalog from app-server model/list
- `dba8e1dd` feat(codex): log catalog reads so a cached answer is distinguishable from a spawn

改动文件（全部在 Touches 内）：`codex-app-server.client.ts`、`codex-models.provider.ts`、`provider-models.service.ts`、`provider-models.service.test.ts`、`codex-app-server-protocol.test.ts`。未新建 server 测试文件。

### AC 逐条

**AC1 映射正确** — 注入 lister 返回 3 项（1 项 `hidden:true`、1 项 `isDefault:true`、efforts 各不相同）。`assert.deepEqual` 逐项比对 `value/label/description/effort.default/effort.values`：
```
codex-live mapped=["codex-live-default","codex-live-fast"] DEFAULT=codex-live-default source=live
```

**AC2 TTL 与 single-flight** — 注入时钟：TTL 内两次读取 lister=1（第二次 `source=cache`）；`clock += 5*60_000` 后 lister=2；冷缓存下两个并发读取共享一次发现：
```
codex-ttl calls=2 source=live
codex-single-flight calls=1
```

**AC3 静态兜底** — reject 与空数组两个分支都返回与 `CODEX_PREDEFINED_MODELS` 深相等的定义；30 秒失败窗口内不重试、越过窗口后重试：
```
codex-fallback calls=2 source=fallback
PROBE_FALLBACK={"source":"fallback","equalsStatic":true,"listerCalls":2}
```
（`equalsStatic:true` 是脚本里两侧 `JSON.stringify` 的逐字比较；单测用 `assert.deepEqual`。）

**AC4 分页拼接** — 假 call 两页（第二页 `nextCursor:null`），`model-b` 同时出现在两页：
```
collectModelPages calls=[{"method":"model/list","params":{}},{"method":"model/list","params":{"cursor":"page-2"}}] ids=["model-a","model-b","model-c"]
```
输入页：page1 `[a, b]` + `nextCursor:"page-2"`；page2 `[b, c]` + `nextCursor:null`。输出 `["model-a","model-b","model-c"]`，`b` 只保留一份且取第二页副本。

**AC5 与 custom rows 合并不变** — 真 service + 真 adapter（注入 lister）+ 内存 catalog store：
```
codex-merge ids=["codex-live-default","codex-live-fast","my-live-model"] custom=["my-live-model"]
```
预置项 `isCustom:false` 且无 `recordId`；对不存在的 row 走 `update` 得 `MODEL_NOT_FOUND`；用预置 id 建 custom row 得 `MODEL_ID_ALREADY_EXISTS`。

**AC6 活目录与 CLI 一致且有来源读数** — 本 worktree 的 `dist-server` 起隔离实例（`:5825`），同一个 registry 适配器上的进程内探针读取两次：
```
PROBE_READ_1={"source":"live","ids":["gpt-6.1-sol","gpt-6.1-terra","gpt-6-astra","gpt-6-sol","gpt-6-luna","gpt-5.6-sol","gpt-5.6-terra","gpt-5.6-luna"],"default":"gpt-6.1-sol"}
PROBE_READ_2={"source":"cache","ids":["gpt-6.1-sol","gpt-6.1-terra","gpt-6-astra","gpt-6-sol","gpt-6-luna","gpt-5.6-sol","gpt-5.6-terra","gpt-5.6-luna"],"default":"gpt-6.1-sol"}
```
与打包 CLI app-server `model/list` 的 `hidden===false` 集合逐项相等，effort 默认值与取值也一致：
```
cliVisibleIds=["gpt-5.6-luna","gpt-5.6-sol","gpt-5.6-terra","gpt-6-astra","gpt-6-luna","gpt-6-sol","gpt-6.1-sol","gpt-6.1-terra"]
apiIds=["gpt-5.6-luna","gpt-5.6-sol","gpt-5.6-terra","gpt-6-astra","gpt-6-luna","gpt-6-sol","gpt-6.1-sol","gpt-6.1-terra"]
equal=true
effortDiffFromCli=[]
```
`gpt-6.1-sol` 与 `gpt-5.6-sol` 的 `effort.default` 实测是 `medium`，静态常量里写的是 `low`——API 返回的是活目录，不是常量。

**AC7 旧约定已推翻** —
```
$ ! grep -n "deliberately has no" server/modules/providers/services/provider-models.service.ts
old-phrase-absent-exit=0
$ grep -rn "no provider-native discovery" server docs README.md
discovery-phrase-hits-exit=1   (0 命中)
```
新契约段落（逐字）：
```
 * The contract, revised when Codex moved to live discovery:
 *
 * 1. Provider adapters may perform provider-native discovery; the Codex
 *    adapter reads the packaged CLI's app-server `model/list` as its primary
 *    source.
 * 2. Memory caching (TTL + single-flight) belongs to the adapter, never to
 *    this service: the service only merges and validates.
 * 3. Persistence stays custom SQLite rows only; discovery results are never
 *    written to disk.
 * 4. The static `CODEX_PREDEFINED_MODELS` catalog is a fallback and an offline
 *    reference, not the only source.
 *
 * Tests inject a small custom-model store through the same boundary.
```

**AC8 导入图与类型** — 四条命令均 exit 0：
```
npx tsx --tsconfig server/tsconfig.json --test server/shared/tests/server-import-cycle-budget.test.ts      → pass 12 / fail 0
npx tsx --tsconfig server/tsconfig.json --test server/modules/providers/tests/providers-websocket-cycle.test.ts → pass 1 / fail 0
npm run typecheck → exit 0
npm run lint      → exit 0（仅有既存 warning）
```
新增的 import 边在同目录内（`codex-models.provider.ts` → `codex-app-server.client.ts`），未改变任何目录级 SCC 预算，baseline 未改。

**AC9 Touches 与 anti-drift** —
```
ANTI-DRIFT OK: task codex-model-catalog-dynamic-model-list — 5 actual file(s), all within declared Touches (7 glob(s))
```
`git diff --name-only develop...HEAD` 为实现提交的 5 个文件，全部在 Touches 内；`task_write` 写入的 `tasks/codex-model-catalog-dynamic-model-list.md` 本身也在 Touches 内。

### DoD

1. 真实服务（隔离实例 `:5825`，本 worktree `dist-server`）`GET /api/providers/codex/models` 的集合等于打包 CLI `model/list` 可见集合（AC6 的 `equal=true` 区块）；来源读数为 `live` → `cache`（`PROBE_READ_1` / `PROBE_READ_2`）。
2. 真实页面：`API status=200 count=8`；模型菜单项 `["Default","low","medium","high","xhigh","max","ultra","GPT-6.1-Sol","GPT-6.1 Terra","GPT-6-Astra","GPT-6-Sol","GPT-6-Luna","GPT-5.6-Sol","GPT-5.6-Terra","GPT-5.6-Luna"]`；`UI_MODEL_LABEL_COUNT=8 API_LABEL_COUNT=8 UI_MISSING_LABELS=[] PAGE_ERRORS=[]`。截图：`tmp/codex-model-dynamic-catalog.png`（1280×900，模型段 8 项全部可见）。
3. 缓存行为（隔离实例 `tmp/isolated-instance/server.log`）：
```
2026-10-30T00:26:21.557Z [codex-models] model/list discovery started
2026-10-30T00:26:21.833Z [codex-models] model/list discovery ok visible=8
2026-10-30T00:26:21.845Z [codex-models] catalog read source=cache models=8
```
同一实例连续两次 GET：第一次只有 `discovery started/ok` 两行（一次 lister 调用），第二次只有 `source=cache` 一行，没有新的 discovery 行。
4. 兜底演练：`tmp/codex-catalog-probe.mts` 把 lister 指向 reject 的假实现 → `PROBE_FALLBACK={"source":"fallback","equalsStatic":true,"listerCalls":2}`，返回静态定义；注入只存在于该脚本进程，生产 registry 未被修改，"还原"= 无持久副作用（空数组分支另有单测）。
5. 新契约：见 AC7 的逐字段落。持久化仍然只有 custom rows（SQLite `provider_models`）；发现结果只存在适配器的进程内 `cached` 字段，不落盘。

## ADR-007 暗轴

L_D 该轴仍暗,理由:本任务只把 Codex 模型目录的来源从常量换成 CLI 的 model/list 并加内存缓存,不新增领域数据能力,没有可读的 L_D 读数。
L_G 该轴仍暗,理由:同上;本任务的读数是目录集合、来源标记与 lister 调用计数,不新增 goal 判据,不是生成对齐读数。

## Touches

- server/modules/providers/list/codex/codex-models.provider.ts
- server/modules/providers/list/codex/codex-app-server.client.ts
- server/modules/providers/services/provider-models.service.ts
- server/modules/providers/tests/provider-models.service.test.ts
- server/modules/providers/tests/codex-app-server-protocol.test.ts
- server/shared/tests/server-import-cycle-budget.test.ts
- tasks/codex-model-catalog-dynamic-model-list.md
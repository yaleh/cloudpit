---
id: gap-mcp-project-create-tool
title: 新增 Cloudpit MCP 工具 project_create：复用 UI 的 createProject 流程（安全目录/幂等/返回
  projectId+path），创建后 projects_list 与 session_create 可直接使用
status: done
labels:
  - gap
  - feature
parent: null
children: []
extra:
  schema: execution
---
## Proposal

需求：Claude 侧（MCP 客户端）目前只能用 `projects_list` 读、用 `session_create` 建会话，但没有任何 MCP 动词能**注册/创建项目**。本任务新增 `project_create`，让一个 MCP 调用即可把一个安全目录变成 Cloudpit 项目，并且创建后 `projects_list` 能读到、`session_create` 能用它建会话。

现状（读代码确认，不是推测）：

- UI 的创建流程是 `POST /api/projects/create-project`（`server/modules/projects/projects.routes.ts:143`）→ `createProject()`（`server/modules/projects/services/project-management.service.ts:83`）。后者已经做了安全目录校验（`validateWorkspacePath`：系统目录黑名单、realpath、不存在时按父目录解析）、`mkdir -p`、持久化，并对已归档路径返回 `reactivated_archived`、对活动冲突抛 `PROJECT_ALREADY_EXISTS`（409）。
- MCP 写工具由 `registerMcpWriteTools` 注册（`server/modules/mcp-gateway/mcp-gateway.write-tools.ts`）。`MCP_STAGE4_WRITE_TOOLS` 是 AC-249 钉死的五个名字，新工具必须像 `session_steer` / `draft_*` / `ui_*` 一样**在表外**、通过可选 deps 注册：deps 缺省时不注册，保证旧 mount 的 `tools/list` 完全不变。
- 工具名 union / 注解 / 错误码声明是三个 TOTAL record：`McpGatewayToolName`（`mcp-tool-annotations.ts:99`）、`MCP_TOOL_ANNOTATIONS`、`MCP_TOOL_ERROR_CODES`（`mcp-tool-error-codes.ts`）。新增工具三处都要加行，否则编译失败。
- `session_create` 的 `project` 参数由 AC-246 的 target gate 用活动项目列表解析（`mcp-resolve-target.ts` 读 `getProjectsWithSessions`），所以只要 `project_create` 写入的是活动行，`session_create` 无需改动即可用返回的 `projectId`。

设计：

1. 新模块 `server/modules/mcp-gateway/tools/projects/mcp-project-create.ts`，导出 `PROJECT_CREATE_TOOL_NAME = 'project_create'`、描述、zod 输入/输出 shape、`buildProjectCreate()`、`registerMcpProjectCreateTool()`。
2. 输入 `{ path: string, name?: string }`（`name` 映射到既有 `customName`）。输出 `{ projectId, path, fullPath, displayName, created, outcome }`，其中 `outcome ∈ created | reactivated_archived | existing`。返回的 `projectId`/`path` 就是后续 `session_create`/`projects_list` 用的值。
3. **复用**而非复制：deps 只注入 `createProject`（UI 路由用的同一个服务函数）与 `findProjectByPath`（在 projects 模块新增，复用 `mapProjectRowToApiView` 的同一投影）。不得在 MCP 侧重写路径校验或目录创建。
4. 幂等：`createProject` 抛 `PROJECT_ALREADY_EXISTS` 时，工具用 `findProjectByPath` 读回现有活动项目并返回 `created:false, outcome:'existing'`；同路径重复调用永远返回同一个 `projectId`。其它 `AppError`（invalid path / not a directory）转成结构化 MCP 错误（`INVALID_ARGUMENT`，details 带原始 code），且不写行。
5. 权限：沿用 `cloudcli:session:create`（现有词表里最接近的写 scope；不新增 scope，避免动 AC-243 的位置敏感词表）。
6. 注册：`McpWriteToolDeps.projectCreate?: McpProjectCreateDeps`；存在时 `registerMcpProjectCreateTool`，缺省时不注册。`server/index.ts` 绑定 `createProject` 与 `projectsDb.getProjectPath` 的投影。
7. 元数据：注解 `readOnlyHint:false, destructiveHint:false, idempotentHint:true, openWorldHint:false`；错误码声明 `WRAPPER_CODES`；描述英文（`mcp-english-only` 判据会读）。

实现偏差（落地时发现，已按约束改道）：设计 1 的文件路径 `tools/projects/` 会新建一个目录，而 `mcp-gateway.write-tools.ts`（`modules/mcp-gateway`）必须导入它 —— AC-394 的目录叶子规则禁止「新目录被另一个 `modules/**` 目录导入」。因此该文件落在既有清单目录 `server/modules/mcp-gateway/mcp-project-create.ts`（与 `mcp-resolve-target.ts` 等模块级 seam 同层）；工具名/契约/行为与设计 1–7 完全一致。

<!-- dedup-ref -->
与已完成的 `gap-mcp-resolve-target-exact-precedence-and-strict-writes`（target gate 解析，不改创建）、`gap-ac245-mcp-read-tools-fixture-readings`（读工具）机制不同；`task-granularity-advice` 的 peers/mentions 均为空。本条是唯一承载 `project_create` 的任务。

- 该轴仍暗,理由:本任务只新增一个 MCP 写工具与它的集成测试，AC 内没有 L_D/L_G 探针或读数可记，两轴读数不因本任务变化。

## AC

- [x] 新测试文件 `server/modules/mcp-gateway/tests/mcp-project-create.test.ts` exit 0：`npx tsx --tsconfig server/tsconfig.json --import ./scripts/undici-blocked-ports-preload.mjs --test server/modules/mcp-gateway/tests/mcp-project-create.test.ts`。用真实临时目录 + 真实 sqlite 调 `project_create`，返回的 `projectId`/`path` 指向新建的项目行，目录已存在。
- [x] 同文件含幂等用例：同一路径第二次调用返回同一个 `projectId`、`created:false`、`outcome:'existing'`，数据库仍只有一行。
- [x] 同文件含安全目录用例：系统目录（如 `/etc`）与不可用路径被拒，错误为结构化 MCP 错误、数据库不新增行；正控制是同一夹具下的合法临时目录成功创建。
- [x] 同文件含创建后可用性用例：创建返回的 `projectId` 随后被 `projects_list` 读到，并被 `session_create({ project: projectId })` 解析成功（会话行的 `project_path` 等于创建返回的 `path`）。
- [x] 同文件含权限用例：不带 `cloudcli:session:create` 的 token 调用被拒（`INSUFFICIENT_SCOPE`），且没有写行。
- [x] `npx tsx --tsconfig server/tsconfig.json --import ./scripts/undici-blocked-ports-preload.mjs --test server/modules/mcp-gateway/tests/mcp-session-lifecycle.test.ts`、`... --test server/modules/mcp-gateway/tests/mcp-read-tools.test.ts`、`... --test server/modules/mcp-gateway/tests/mcp-error-vocabulary.test.ts` 三者 exit 0（新工具不改变旧 mount 的注册集与错误码声明）。
- [x] `npm run typecheck` exit 0。

## DoD

在真实运行的 Cloudpit 服务上（隔离实例或本机 :3001，真实 sqlite、真实文件系统），用一个带 `cloudcli:session:create` 的真实 token 走 `/mcp`：

1. 调 `project_create` 指向一个真实的新临时目录，贴出完整返回（`projectId`/`path`/`outcome`）；
2. 再调一次同路径，贴出 `created:false` 与相同 `projectId`；
3. 调 `projects_list` 证明该 id 在列；
4. 用该 id 调 `session_create`（可带一条 message），贴出 `sessionId` 与数据库里该会话行的 `project_path`；
5. 调 `project_create` 指向 `/etc`，贴出结构化拒绝且 `projects_list` 行数不变。

最后报告落地 commit sha，以及**上线状态**：该服务进程是否已重启/重新构建以加载这份代码（没加载就如实写「代码已合入 develop，运行进程仍是旧代码」，不要写成已上线）。只贴单测结论不算完成。

## Touches

- server/modules/mcp-gateway/mcp-project-create.ts (new)
- server/modules/mcp-gateway/mcp-gateway.write-tools.ts
- server/modules/mcp-gateway/mcp-tool-annotations.ts
- server/modules/mcp-gateway/mcp-tool-error-codes.ts
- server/modules/mcp-gateway/tests/mcp-project-create.test.ts (new)
- server/modules/mcp-gateway/tests/mcp-tool-annotations.test.ts
- server/modules/mcp-gateway/tests/mcp-error-vocabulary.test.ts
- server/modules/projects/index.ts
- server/modules/projects/services/project-management.service.ts
- server/index.ts
- tasks/gap-mcp-project-create-tool.md

## Evidence

### 实现（commit 649832b30，task/gap-mcp-project-create-tool）

- `server/modules/mcp-gateway/mcp-project-create.ts`：`PROJECT_CREATE_TOOL_NAME` / 描述 / zod 输入输出 / `buildProjectCreate()` / `registerMcpProjectCreateTool()`。deps 只注入 UI 路由同一个 `createProject` 与新增的 `findProjectByPath`，不重写路径校验或建目录。
- `server/modules/projects/services/project-management.service.ts`：新增 `findProjectByPath()`，复用 `mapProjectRowToApiView` 的同一投影，只回答活动行。
- `mcp-gateway.write-tools.ts`：`McpWriteToolDeps.projectCreate?`，存在时以 `SESSION_CREATE_SCOPE` 注册，缺省不注册。
- `mcp-tool-annotations.ts` / `mcp-tool-error-codes.ts`：union 增 `project_create`，注解 `false/false/true/false`，错误码 `WRAPPER_CODES`。
- `server/index.ts`：`projectCreate: { createProject, findProjectByPath }`（+1 行，oversize 棘轮 2905/2905 不越线）。
- 两个兄弟判据的 deps bag 各补 `projectCreate`（`mcp-tool-annotations.test.ts` / `mcp-error-vocabulary.test.ts`），否则「tools/list == 声明键集」因新行而红。

### 单测读数

- 新判据 `mcp-project-create.test.ts`：`tests 6 / pass 6 / fail 0`，六条腿的原始读数（[a] created:true + 目录存在 + 行 id 一致；[b] 同 id/created:false/existing/1 行；[c] `/etc` 与 root 外路径皆 `INVALID_ARGUMENT`+`details.code=INVALID_PROJECT_PATH` 且 0 行、同 root 内合法目录正控制成功；[d] `projects_list` 命中 id、`session_create` 返回 sessionId 且会话行 `project_path` 等于创建 path；[e] 无 create scope 的 token `INSUFFICIENT_SCOPE` 且 0 行 0 目录；[f] 未接 deps 的 mount 的 tools/list 不含 `project_create`）。
- AC 指定三件：`mcp-session-lifecycle.test.ts` 17/17、`mcp-read-tools.test.ts` 8/8、`mcp-error-vocabulary.test.ts` 5/5，全 exit 0。
- 受影响的兄弟判据：`mcp-tool-annotations.test.ts` 5/5、`mcp-english-only.test.ts` 10/10、`mcp-gateway-wiring.test.ts` 3/3、`mcp-production-session-wiring.test.ts` 5/5、`server-import-cycle-budget.test.ts` 12/12（目录叶子规则未触发：文件落在既有 `modules/mcp-gateway` 目录）、`architecture-ratchet.test.ts` 6/6、`project-management.service.test.ts` 5/5。
- `npm run typecheck` exit 0（先修了判据里 `McpControlSeam` 未含 `abort` 的类型缺口）。

### DoD（真实隔离服务，非 :3001）

起了一个真实服务进程（`npx tsx server/tsconfig.json server/index.ts`，独立临时 `DATABASE_PATH`、`HOST=127.0.0.1`、`SERVER_PORT=3711` ≠ 3001、`MCP_ENABLED=1`、独立 `WORKSPACES_ROOT`），用独立进程播种带 `cloudpit:session:create` 的真实 PAT，用 MCP SDK `Client` + `StreamableHTTPClientTransport` 打 `/mcp` 五步：

1. `project_create {path: <root>/dod-project, name: 'DoD Project'}` → `{"projectId":"e7a6c802-857e-48df-9699-e6ad345d2582","path":"/var/tmp/dod-project-create-CcOqnn/workspaces/dod-project","fullPath":"…","displayName":"DoD Project","created":true,"outcome":"created"}`
2. 同路径再调 → 同 `projectId`，`"created":false,"outcome":"existing"`
3. `projects_list` → `{"id":"e7a6c802-…","name":"DoD Project","path":"…/workspaces/dod-project","sessionCount":0,…}`，count=1
4. `session_create {project:"e7a6c802-…"}` → `{"sessionId":"01197e8b-ac16-4cce-98dc-b21300131730","lifecycleMode":"resident"}`；库里 `sessions.project_path = /var/tmp/dod-project-create-CcOqnn/workspaces/dod-project`（等于步骤 1 的 path）
5. `project_create {path:"/etc"}` → `{"code":"INVALID_ARGUMENT","message":"Invalid project path","retryable":false,"details":{"code":"INVALID_PROJECT_PATH","details":"Cannot use system-critical directories as workspace locations"}}`；`projects_list` 仍 1 行，DB `COUNT(*) FROM projects` = 1

`tools/list contains project_create: true`。

**上线状态**：代码只在本任务分支（commit 649832b30），尚未合入 develop，更没有重启或重建任何常驻进程 —— 本机 :3001/fleet 正在跑的是旧代码，不含 `project_create`。上面的 DoD 读数来自我为本任务临时拉起的隔离实例（端口 3711，已整组杀掉）。

**附带发现（不在本任务 AC，未修）**：`session_create` 声明的 outputSchema 是 `{sessionId, deliveryId, runId}`，但真实 payload 还带 `lifecycleMode`。先 `tools/list`、再 `session_create` 的客户端（SDK 会缓存 output validator）会客户端侧报 `-32602 Structured content does not match ... additional properties`；该缺陷在 develop 上已存在，与本任务改动无关。本 DoD 按写明的五步顺序驱动（第 4 步前未 listTools），并在最后单独读 `tools/list`。

---
id: gap-mcp-project-create-tool
title: 新增 Cloudpit MCP 工具 project_create：复用 UI 的 createProject 流程（安全目录/幂等/返回
  projectId+path），创建后 projects_list 与 session_create 可直接使用
status: todo
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

<!-- dedup-ref -->
与已完成的 `gap-mcp-resolve-target-exact-precedence-and-strict-writes`（target gate 解析，不改创建）、`gap-ac245-mcp-read-tools-fixture-readings`（读工具）机制不同；`task-granularity-advice` 的 peers/mentions 均为空。本条是唯一承载 `project_create` 的任务。

- 该轴仍暗,理由:本任务只新增一个 MCP 写工具与它的集成测试，AC 内没有 L_D/L_G 探针或读数可记，两轴读数不因本任务变化。

## AC

- [ ] 新测试文件 `server/modules/mcp-gateway/tests/mcp-project-create.test.ts` exit 0：`npx tsx --tsconfig server/tsconfig.json --import ./scripts/undici-blocked-ports-preload.mjs --test server/modules/mcp-gateway/tests/mcp-project-create.test.ts`。用真实临时目录 + 真实 sqlite 调 `project_create`，返回的 `projectId`/`path` 指向新建的项目行，目录已存在。
- [ ] 同文件含幂等用例：同一路径第二次调用返回同一个 `projectId`、`created:false`、`outcome:'existing'`，数据库仍只有一行。
- [ ] 同文件含安全目录用例：系统目录（如 `/etc`）与不可用路径被拒，错误为结构化 MCP 错误、数据库不新增行；正控制是同一夹具下的合法临时目录成功创建。
- [ ] 同文件含创建后可用性用例：创建返回的 `projectId` 随后被 `projects_list` 读到，并被 `session_create({ project: projectId })` 解析成功（会话行的 `project_path` 等于创建返回的 `path`）。
- [ ] 同文件含权限用例：不带 `cloudcli:session:create` 的 token 调用被拒（`INSUFFICIENT_SCOPE`），且没有写行。
- [ ] `npx tsx --tsconfig server/tsconfig.json --import ./scripts/undici-blocked-ports-preload.mjs --test server/modules/mcp-gateway/tests/mcp-session-lifecycle.test.ts`、`... --test server/modules/mcp-gateway/tests/mcp-read-tools.test.ts`、`... --test server/modules/mcp-gateway/tests/mcp-error-vocabulary.test.ts` 三者 exit 0（新工具不改变旧 mount 的注册集与错误码声明）。
- [ ] `npm run typecheck` exit 0。

## DoD

在真实运行的 Cloudpit 服务上（隔离实例或本机 :3001，真实 sqlite、真实文件系统），用一个带 `cloudcli:session:create` 的真实 token 走 `/mcp`：

1. 调 `project_create` 指向一个真实的新临时目录，贴出完整返回（`projectId`/`path`/`outcome`）；
2. 再调一次同路径，贴出 `created:false` 与相同 `projectId`；
3. 调 `projects_list` 证明该 id 在列；
4. 用该 id 调 `session_create`（可带一条 message），贴出 `sessionId` 与数据库里该会话行的 `project_path`；
5. 调 `project_create` 指向 `/etc`，贴出结构化拒绝且 `projects_list` 行数不变。

最后报告落地 commit sha，以及**上线状态**：该服务进程是否已重启/重新构建以加载这份代码（没加载就如实写「代码已合入 develop，运行进程仍是旧代码」，不要写成已上线）。只贴单测结论不算完成。

## Touches

- server/modules/mcp-gateway/tools/projects/mcp-project-create.ts (new)
- server/modules/mcp-gateway/mcp-gateway.write-tools.ts
- server/modules/mcp-gateway/mcp-tool-annotations.ts
- server/modules/mcp-gateway/mcp-tool-error-codes.ts
- server/modules/mcp-gateway/tests/mcp-project-create.test.ts (new)
- server/modules/projects/index.ts
- server/modules/projects/services/project-management.service.ts
- server/index.ts
- tasks/gap-mcp-project-create-tool.md
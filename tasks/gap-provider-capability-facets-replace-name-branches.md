---
id: gap-provider-capability-facets-replace-name-branches
title: Provider 多态补洞：shell/transcript/token-usage 能力面替代服务端名字分支，前端改用 provider 描述表
status: todo
labels:
  - gap
parent: null
children: []
extra:
  schema: execution
---
## Proposal

<!-- dedup-ref --> 同批 6 条重构的第 3 条（2026-10-26 架构复查）。与同批其它任务只共享测试计数钉子 `server/shared/tests/quay-test-script.test.ts` 与 `scripts/suite-duration-baseline.tsv`（新增判据文件必改），调度器按 Touches 串行，无需 depends_on。

### 现状（2026-10-26 实测）

`server/shared/interfaces.ts` 已有 12 个 `IProvider*` 能力接口，由 `provider.registry.ts` 统一分发；但没有对应能力面的行为直接按 provider 名分支。server 端 `providers/list/**` 之外共 21 处、9 个文件；前端约 35 处、13 个文件。新增一个 provider 需要改 20 多个文件。本任务处理分支最密集的 6 个文件（server 12 处 + client 15 处）：

- `server/modules/websocket/services/shell-websocket.service.ts:205-227, 562-567`：按 provider 拼 CLI 启动/恢复命令与欢迎语里的显示名（6 处）。
- `server/modules/providers/services/sessions.service.ts:717/820/909`：同一个 `provider === 'claude' || provider === 'codex'` 判断 transcript 是否由 jsonl 文件承载（3 处）。
- `server/modules/providers/services/provider-token-usage.service.ts:400-424`：按 provider 选用量读取方式（3 处）。
- `src/modules/provider-auth/ProviderLoginModal.tsx:46-69`（8 处）、`src/shared/ui/LLMProviderLogo.tsx`（3 处）、`src/modules/chat/transcript/MessageComponent.tsx:189, 520-524`（4 处）。

### 改法

服务端（多态）：
- 新增 `IProviderShell`：`displayName` + `launchCommand({ resumeSessionId, initialCommand, platform })`；四个 provider 各自实现，`shell-websocket.service.ts` 经注册表取 `provider.shell`。
- `IProviderSessions` 增加只读属性 `transcriptFileBacked: boolean`，`sessions.service.ts` 读它。
- 新增 `IProviderTokenUsage`：`readSessionUsage(session, deps)`；`readOpenCodeTokenUsage`、`findCodexSessionFile` 等私有读取器随实现迁入对应 `providers/list/<p>/` 目录，`provider-token-usage.service.ts` 只做分发与公共错误包装。

前端（数据驱动）：在 `src/shared/constants.ts` 增加 `PROVIDER_DESCRIPTORS: Record<LLMProvider, { displayName; loginTitle; loginCommand; logo; … }>`，三个前端文件改为查表。

本任务不处理：`git.routes.ts`、`session-conversations-search.service.ts`、`sessions-watcher.service.ts`、`session-hosts.routes.ts`、`mcp-session-search.ts`、`mcp-session-lifecycle.ts` 以及其余前端文件的分支——它们留待后续按同一能力面迁移。

### 导入环预算（AC-394）

只在既有目录内移动代码，不新增目录：`directoryManifest`/`nodeCount`（56）不变。注意 `providers`、`providers/list/claude`、`providers/services` 是 G1 环的三个成员：把用量读取器迁进 `providers/list/codex`、`providers/list/opencode`、`providers/list/cursor` 时，这些目录**不得**新增指向 `providers/services` 或 `providers` 的 import，否则会把它们拉进 G1。G1 必须保持三成员，基线 JSON 与测试文件不得改动。

## AC

- [ ] 服务端分支清零：`grep -nE "=== '(claude|codex|cursor|opencode)'" server/modules/websocket/services/shell-websocket.service.ts server/modules/providers/services/sessions.service.ts server/modules/providers/services/provider-token-usage.service.ts` 无输出。
- [ ] 能力面落地：`grep -nE "export interface (IProviderShell|IProviderTokenUsage)" server/shared/interfaces.ts` 两个都命中；`grep -n "transcriptFileBacked" server/shared/interfaces.ts` 命中；`grep -lE "implements IProviderShell" server/modules/providers/list/*/*.ts | wc -l` 输出 4。
- [ ] 前端分支清零：`grep -nE "=== '(claude|codex|cursor|opencode)'" src/modules/provider-auth/ProviderLoginModal.tsx src/shared/ui/LLMProviderLogo.tsx src/modules/chat/transcript/MessageComponent.tsx` 无输出；`grep -n "export const PROVIDER_DESCRIPTORS" src/shared/constants.ts` 命中。
- [ ] 行为不回归（服务端）：`npx tsx --tsconfig server/tsconfig.json --import ./scripts/undici-blocked-ports-preload.mjs --test server/modules/websocket/tests/shell-websocket.service.test.ts server/modules/websocket/tests/shell-resume-launch-spec.test.ts server/modules/providers/tests/provider-token-usage.service.test.ts server/modules/providers/tests/sessions.service.test.ts` exit 0。
- [ ] 新判据：同一命令追加的 `server/modules/providers/tests/provider-shell-facet.test.ts` exit 0，逐个 provider 断言 `launchCommand` 在有/无 resumeSessionId、win32/linux 下的输出与迁移前 `shell-websocket.service.ts` 的字面量一致。
- [ ] 行为不回归（前端）：`npx vitest run src/modules/chat/tests/debug-agent-message-header-identity.test.tsx src/modules/sidebar/tests/debugAgentIdentity.test.tsx` exit 0。
- [ ] 导入环预算不变：`npx tsx --tsconfig server/tsconfig.json --test server/shared/tests/server-import-cycle-budget.test.ts` exit 0，且 `git diff --quiet HEAD -- server/shared/tests/server-import-cycle-budget.baseline.json server/shared/tests/server-import-cycle-budget.test.ts` exit 0。
- [ ] 静态检查：`npm run typecheck` exit 0；`npx oxlint server/shared server/modules/providers server/modules/websocket src/shared src/modules/provider-auth src/modules/chat/transcript` exit 0。

## DoD

MCP 浏览器在隔离实例的真实页面上走一遍：为 claude、codex 各打开一次 Shell tab（新会话与恢复会话各一次），截图证明欢迎语中的显示名与启动命令和迁移前一致；打开 provider 登录对话框，截图四个 provider 的标题与命令；打开一个 codex 会话的 transcript 截图 provider logo 与消息头。截图存 `tmp/` 并贴出；存在可用场景时同时跑 `node scripts/ui-scenario.mjs <scenario.json>` 并贴出 JSON 报告。再用真实 codex 会话调一次 token-usage 端点贴出读数。

## Touches

- server/shared/interfaces.ts
- server/modules/providers/shared/base/abstract.provider.ts
- server/modules/providers/list/claude/claude.provider.ts
- server/modules/providers/list/codex/codex.provider.ts
- server/modules/providers/list/cursor/cursor.provider.ts
- server/modules/providers/list/opencode/opencode.provider.ts
- server/modules/providers/list/claude/claude-shell.provider.ts (new)
- server/modules/providers/list/codex/codex-shell.provider.ts (new)
- server/modules/providers/list/cursor/cursor-shell.provider.ts (new)
- server/modules/providers/list/opencode/opencode-shell.provider.ts (new)
- server/modules/providers/list/codex/codex-token-usage.provider.ts (new)
- server/modules/providers/list/opencode/opencode-token-usage.provider.ts (new)
- server/modules/providers/list/claude/claude-sessions.provider.ts
- server/modules/providers/list/codex/codex-sessions.provider.ts
- server/modules/providers/list/cursor/cursor-sessions.provider.ts
- server/modules/providers/list/opencode/opencode-sessions.provider.ts
- server/modules/websocket/services/shell-websocket.service.ts
- server/modules/providers/services/sessions.service.ts
- server/modules/providers/services/provider-token-usage.service.ts
- server/modules/providers/tests/provider-shell-facet.test.ts (new)
- server/shared/tests/quay-test-script.test.ts
- scripts/suite-duration-baseline.tsv
- src/shared/constants.ts
- src/modules/provider-auth/ProviderLoginModal.tsx
- src/shared/ui/LLMProviderLogo.tsx
- src/modules/chat/transcript/MessageComponent.tsx
- tasks/gap-provider-capability-facets-replace-name-branches.md
---
id: gap-codex-transcript-format-shared-helpers
title: Codex transcript 解析去重：会话搜索服务改用 providers/list/codex 下的
  codex-transcript-format.ts，与 Claude 侧已有做法对齐
status: ready
labels:
  - gap
parent: null
children: []
extra:
  schema: execution
---
## Proposal

<!-- dedup-ref --> 2026-10-26 架构复查第二批第 5 条（重复代码家族之一）。与 `gap-provider-capability-facets-replace-name-branches` 同属「provider 专属知识泄漏到通用服务」，但机制不同：那条处理按 provider 名字的分支，本条处理 Codex 记录格式解析的副本。两条都会改 `server/modules/providers/list/codex/codex-sessions.provider.ts`（那条加 `transcriptFileBacked` 属性，本条删两个本地函数），调度器按 Touches 串行，改动区域不同，不需要 depends_on。

### 现状（2026-10-26 实测）

`server/modules/providers/services/session-conversations-search.service.ts` 自己重新实现了一份 Codex transcript 的解析规则，与 `server/modules/providers/list/codex/codex-sessions.provider.ts` 中的版本平行：
- `isVisibleCodexUserMessage`：search `:1099` 与 provider `:60` 逐字节相同（`diff` 为空）。
- 文本抽取：search 的 `extractCodexText`（`:622`）与 provider 的 `extractCodexTextContent`（`:198`）结构克隆，只差拼接分隔符（search 用 `' '`，provider 用 `'\n'`）。ArchGuard 在默认阈值下把它报为一组。
- search 另有 `isInternalCodexContent`（`:400`），用于识别 Codex 的内部注入内容。

Claude 侧已经有正确做法：记录格式规则放在 `providers/list/claude/claude-transcript-format.ts`，search 服务直接导入（search `:11-16`）。Codex 侧没有对应文件，所以规则被复制了一份。Codex 记录格式一变，两处必须同时改，漏改一处就会出现「会话里能看到、搜索搜不到」或反过来的漂移。

### 改法

新增 `server/modules/providers/list/codex/codex-transcript-format.ts`，形状与 `claude-transcript-format.ts` 对齐：
- 导出 `isVisibleCodexUserMessage`；
- 导出 `extractCodexText(content, separator)`，两个调用方各自传入原来的分隔符，行为逐字不变；
- 若 provider 侧有与 `isInternalCodexContent` 同义的判断，一并收进来；没有则把 search 的版本移入此文件，由 search 导入。

`codex-sessions.provider.ts` 与 `session-conversations-search.service.ts` 删除本地副本改为导入。新文件只 import `node:*`、`server/shared/**`，不 import providers 目录内的任何其它文件。

### 导入环预算（AC-394）

不新增目录；`providers/list/codex` 已在 manifest 中。新增边是 `providers/services → providers/list/codex`。实测 `providers/list/codex` 只 import 自身与 `providers/shared/*`，不指回 `providers/services` 或 `providers` 根，所以这条边不会把它拉进 G1（G1 现为 `providers`、`providers/list/claude`、`providers/services` 三个成员）。G1 必须保持这三个成员，基线 JSON 与测试文件不改。

## AC

- [x] 副本清零：`grep -nE "^function (isVisibleCodexUserMessage|extractCodexText|extractCodexTextContent)\(" server/modules/providers/services/session-conversations-search.service.ts server/modules/providers/list/codex/codex-sessions.provider.ts` 无输出；`grep -nE "^export function (isVisibleCodexUserMessage|extractCodexText)\(" server/modules/providers/list/codex/codex-transcript-format.ts` 命中两行。
- [x] 新文件为叶子：`grep -hE "from '" server/modules/providers/list/codex/codex-transcript-format.ts | grep -vE "from '(node:[a-z/]+|@/shared/[^']+)'"` 无输出。
- [x] 新判据：`npx tsx --tsconfig server/tsconfig.json --test server/modules/providers/tests/codex-transcript-format.test.ts` exit 0，覆盖可见/不可见用户消息、三种文本块类型（input_text/output_text/text）、非对象条目与空内容，以及两种分隔符各自的输出。
- [x] 行为不回归：`npx tsx --tsconfig server/tsconfig.json --import ./scripts/undici-blocked-ports-preload.mjs --test server/modules/providers/tests/codex-sessions.test.ts server/modules/providers/tests/claude-search-ignores-capture-rows.test.ts` exit 0。
- [x] 导入环预算不变：`npx tsx --tsconfig server/tsconfig.json --test server/shared/tests/server-import-cycle-budget.test.ts` exit 0，且 `git diff --quiet "$(git merge-base develop HEAD)" -- server/shared/tests/server-import-cycle-budget.baseline.json server/shared/tests/server-import-cycle-budget.test.ts` exit 0。
- [x] 静态检查：`npx tsc --noEmit -p server/tsconfig.json` exit 0；`npx oxlint server/modules/providers` exit 0。

## DoD

在隔离实例上用一个真实的 Codex 会话（从本机 `~/.codex/sessions` 选一个含多轮用户消息的 jsonl）验证同一条消息两边一致：在会话视图中打开它并截图某一轮用户消息；再用会话搜索搜该消息中的一个独特短语，截图命中结果。证明可见性判断与文本抽取在两条路径上一致。截图存 `tmp/` 并贴出；存在可用场景时同时跑 `node scripts/ui-scenario.mjs <scenario.json>` 并贴出 JSON 报告。

注：上列「未改动」类判据与 develop 的 merge-base 比较，覆盖已提交与未提交的改动；与 HEAD 比较在提交后恒为空，会真空通过。

## Touches

- server/modules/providers/list/codex/codex-transcript-format.ts (new)
- server/modules/providers/tests/codex-transcript-format.test.ts (new)
- server/modules/providers/list/codex/codex-sessions.provider.ts
- server/modules/providers/services/session-conversations-search.service.ts
- server/shared/tests/quay-test-script.test.ts
- scripts/suite-duration-baseline.tsv
- tasks/gap-codex-transcript-format-shared-helpers.md

## Blocker

**2026-10-26T07:33:11.454Z — worker 未落地（exited-not-landed）**

- 未落地原因：step=suite: not ok - server/shared/tests/architecture-ratchet.test.ts:   AssertionError [ERR_ASSERTION]: ratchet: oversizeFiles src/modules/architecture/semanticZoomLayout.ts 1642→1688 — 基线内读数不得上调（此基线只允许下降） [baseline A/B: HARD RED (changed-assertion) — the task's red set is NOT a subset of the develop baseline red set: added=- changed=server/shared/tests/architecture-ratchet.test.ts]
- run_id：wk-prod-anchor
- session_id：b2fedb9d-438b-48b6-a11f-68e219fbd3fb

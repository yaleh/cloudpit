---
id: gap-wire-type-sync-criteria
title: 前后端 wire 契约同步判据：把 reply-suggestions 的 TypeSync 做法推广到 notices / 架构刷新 /
  resident 终态 / 提及来源
status: todo
labels:
  - gap
parent: null
children: []
extra:
  schema: execution
---
## Proposal

<!-- dedup-ref --> 同批 6 条重构的第 6 条（2026-10-26 架构复查）。只新增一个判据文件，不改任何生产代码，因此与 `gap-notices-react-free-controller`（会改 `useNotices.ts`）无文件冲突；判据按类型名在 `src/**` 中定位声明，那条任务若把类型搬到别的文件也不会让本判据误红。

### 现状（2026-10-26 实测）

server 与浏览器包不共享类型，wire 形状由人手抄两份，代码里自己写着：`src/modules/notices/useNotices.ts` 注释「duplicated rather than imported」；`src/modules/project-workspace/hooks/useRecentSessionEndings.ts:9` 写「Mirrors `ResidentTerminalState`」；`src/modules/architecture/hooks/useMentions.ts:8,30` 写「Mirrors the server's `SeedMentionHit`」「Mirrors `ArchitectureMentionEntity`」；`ArchitectureRefresh*` 在 `server/shared/types.ts:4576-4628` 与 `src/shared/types.ts:4053-4100` 各一份。防漂移的判据目前只有 `src/shared/tests/replySuggestionsTypeSync.test.ts` 一份，且只比字面量联合。

### 改法

新增 `src/shared/tests/wireContractTypeSync.test.ts`，提供两种读法：
- `readLiteralUnion(file, typeName)`：读 `export type X = 'a' | 'b';` 的成员集合；
- `readObjectKeys(file, typeName)`：读 `export type X = { … };` 顶层字段名集合（含 `?` 可选标记）。

客户端声明按类型名在 `src/**`（排除 tests）中搜索定位，服务端声明用固定路径。比对表：

| 客户端类型 | 服务端类型 | 读法 |
|---|---|---|
| `NoticeLifecycle`、`NoticeSeverity` | 同名（`server/modules/notices/notice-registry.service.ts`） | 联合 |
| `Notice`、`NoticeList` | 同名（同上） | 字段 |
| `ArchitectureRefreshState`、`ArchitectureRefreshStage` | 同名（`server/shared/types.ts`） | 联合 |
| `ArchitectureRefreshStatus`、`ArchitectureRefreshStartResult` | 同名（同上） | 字段 |
| `RecentTerminalState` | `ResidentTerminalState`（`server/modules/resident-ledger/terminal-state.ts`） | 联合 |
| `ArchitectureMentionHit` | `SeedMentionHit`（`server/modules/architecture/seed-extraction.ts`） | 字段 |
| `ArchitectureMentionEntity` | 同名（`server/modules/architecture/service.ts`） | 字段 |

每一行都做非空自检（读到的集合非空），防止正则读不到时判据静默变绿；另加一个假形态用例：对一份内存中改掉一个成员的源码副本断言比对失败，证明判据能区分。

## AC

- [ ] 判据全绿：`npx vitest run src/shared/tests/wireContractTypeSync.test.ts` exit 0。
- [ ] 覆盖面：`grep -cE "(NoticeLifecycle|NoticeSeverity|ArchitectureRefreshState|ArchitectureRefreshStage|ArchitectureRefreshStatus|ArchitectureRefreshStartResult|RecentTerminalState|ArchitectureMentionHit|ArchitectureMentionEntity|NoticeList)" src/shared/tests/wireContractTypeSync.test.ts` ≥ 10。
- [ ] 非空自检：`grep -nE "length > 0|\.length, 0\)|toBeGreaterThan\(0\)" src/shared/tests/wireContractTypeSync.test.ts` 至少命中一处，且该断言覆盖表中每一行（逐行循环或逐行断言）。
- [ ] 假形态：`grep -nE "false-form|假形态" src/shared/tests/wireContractTypeSync.test.ts` 命中一个用例，它对内存副本改掉一个联合成员与一个对象字段后断言比对 **不** 相等。
- [ ] 只加判据：`git diff --name-only "$(git merge-base develop HEAD)" -- src/ server/ | grep -v '^src/shared/tests/wireContractTypeSync.test.ts$'` 无输出。
- [ ] 静态检查：`npx tsc --noEmit -p tsconfig.json` exit 0；`npx oxlint src/shared/tests/wireContractTypeSync.test.ts` exit 0。

注：上列「未改动」类判据（与 develop 的 merge-base 比较，覆盖已提交与未提交改动；对 HEAD 比较在提交后恒为空，会真空通过）。

## DoD

在本地对真实源码做一次漂移演练并贴出输出：临时在 `server/modules/notices/notice-registry.service.ts` 的 `NoticeSeverity` 里加一个成员 `'urgent'`，运行判据，贴出指向 `NoticeSeverity` 的失败信息；再临时给 `server/shared/types.ts` 的 `ArchitectureRefreshStatus` 加一个字段，贴出指向该类型的失败信息；两处都还原后再跑一次贴出全绿。三次运行证明判据在真实文件上能抓住两种漂移（联合成员、对象字段）。

## Touches

- src/shared/tests/wireContractTypeSync.test.ts (new)
- tasks/gap-wire-type-sync-criteria.md
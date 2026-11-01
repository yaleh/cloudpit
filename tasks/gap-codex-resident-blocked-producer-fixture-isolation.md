---
id: gap-codex-resident-blocked-producer-fixture-isolation
title: 修复 producer fixture/DoD 场景把 session.blocked 合成事件写进真实 fleet home
status: ready
labels: []
parent: null
children: []
extra:
  schema: execution
---
## Proposal

F2 实现期间，producer 的 fixture/DoD 场景把合成会话 `dod-codex-blocked-1793458130445`（project=None）的 `session.blocked`/`session.blocked.resolved` 事件经真实 CloudCLI 上下文写者写进了生产 `~/.quay-fleet/context/events/2026-10-31.jsonl`，被 fleet 升级成 `session-blocked-failed/approval/interrupted` 三条幽灵卡（fleet attention/outbox/decisions 均无载体）。单元测试 `session-blocked-events.test.ts` 已用临时 home（正确），泄漏出在 DoD/验证/试运行路径把 fixture 事件写进了真实 fleet home。

## Plan

producer 的 fixture / DoD / 验证场景一律写隔离的临时 fleet home（与单测同纪律），绝不写真实 `~/.quay-fleet`。

## AC

- [x] AC1 **fixture 隔离**：fixture 场景（合成会话 `dod-codex-blocked-*` 或等价）的 `session.blocked` 事件绝不落进真实 `~/.quay-fleet/context/events/`（隔离断言；正控：写真实 home 会失败）。
- [x] AC2 **生产路径不回归**：真实生产路径的 `session.blocked` 事件照常落真实上下文流（回归不破坏）。

## DoD

真实 `~/.quay-fleet/context/events/` 里不再出现 `dod-codex-blocked-*` 合成会话的 `session.blocked`/`session.blocked.resolved` 事件（隔离断言 + 真实 home 读数为证）；AC1 正控（写真实 home 会失败）先红后绿；AC2 生产路径回归绿；`npm run typecheck` 退出 0。

## Notes

该轴仍暗,理由:本任务是后端 context 事件写出路径，无界面/可视化读数可测，暗轴不适用。

实现（`session-blocked-events.ts`）：adapter 看不到 `record` seam 实际写向哪个 home，因此把合成 session id（`dod-*` / `fixture-*` / `synthetic-*` 分段标记）判为 fixture-only，在到达 seam **之前**拒绝；只有显式声明 `fixtureHome`（隔离的 fleet home）时才放行，且声明值若为空或与真实 `~/.quay-fleet`（及操作员的 `QUAY_FLEET_HOME`）重叠，同样拒绝。生产组合根不传 `fixtureHome`（默认即生产），真实 CloudCLI session id 不受影响。与 ADR-003「fixture HOME 隔离与清理」同纪律：fixture 根必须被声明，绝不默认到真实 home。

验证记录（2026-11-01，worktree `gap-codex-resident-blocked-producer-fixture-isolation`）：
- 单文件判据：`npx tsx --tsconfig server/tsconfig.json --test server/modules/context-events/tests/session-blocked-events.test.ts` → 7/7 绿（新增 3 条：隔离臂、AC1 正控、AC2 回归臂）。
- AC1 正控先红后绿（取假）：把 adapter 的拒绝条件改成 `if (false && …)` 后复跑 → AC1 正控与 AC2 回归臂两条红（`production wiring must never hand a fixture session to the record seam`）；还原后 7/7 复绿。
- AC2 回归：`codex-resident-approvals.test.ts` 23/23 绿（真实 adapter + 临时 home，真实 `ac438-session` 的 approval/turn 两臂照常落盘）；`production-wiring.test.ts` 6/6 绿。
- 真实 home DoD 读数（探针：真实 `createContextEventWriter` 默认指向真实 `~/.quay-fleet` + 生产 wiring adapter）：`before=0`、生产 wiring 写 fixture 会话 → `written=0, rejected=2, rejectedByReason={'fixture-session':2}`、`afterProduction=0`；同一 fixture 六条事件在声明 `fixtureHome=<mkdtemp>/.quay-fleet` 的隔离臂 → `written=6, rejected=0`、隔离目录 6 行、真实 home `afterAll=0`。即「写真实 home 会失败」，隔离 home 正常落盘。
- 已泄漏数据清理：`~/.quay-fleet/context/events/2026-10-31.jsonl` 中 6 行 `session=dod-codex-blocked-1793458130445` 的 `session.blocked`/`session.blocked.resolved` 已逐行删除（只删这 6 行，其余 1192 行保持；备份 `/tmp/codex-blocked-fixture-cleanup-backup-1793508214.jsonl`）；清理后与探针后全目录 grep 读数均为 0。
- `npm run typecheck` 退出 0。
- anti-drift：`ANTI-DRIFT OK — 2 actual file(s), all within declared Touches`。

## Touches

- server/modules/context-events/session-blocked-events.ts
- server/modules/context-events/tests/session-blocked-events.test.ts
- tasks/gap-codex-resident-blocked-producer-fixture-isolation.md

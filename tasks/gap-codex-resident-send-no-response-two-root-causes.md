---
id: gap-codex-resident-send-no-response-two-root-causes
title: 修复 codex resident 会话首轮「发送无响应」：effort 'default' 被原样透传给 app-server
status: ready
labels: []
parent: null
children: []
extra:
  schema: execution
---
## 背景

生产 :3001（构建 `aa5e582f`，GOAL-051 已部署）上人 yale 创建 resident codex 会话，发消息后无响应。日志：`2026-10-30T02:14:40Z` 会话 `01a18a96` 的 `turn/start` 被 codex app-server 0.153.4 拒绝 400 —— `Invalid value: 'default'. Supported values are: 'none', 'minimal', 'low', 'medium', 'high', 'xhigh', and 'max'.`（`codexErrorInfo: 'other'`）。

## 根因

`server/modules/providers/list/codex/codex-host-driver.contract.ts:206-213` 的 `turnParams`：

```
const effort = turn.options.effort;
return {
  threadId,
  input: [{ type: 'text', text: turn.command }],
  ...(typeof effort === 'string' ? { effort } : {}),
};
```

它把 CloudCLI 的 effort 词表（含 `'default'`，表示「用模型默认」）原样发给 `turn/start`；codex app-server 只收 none/minimal/low/medium/high/xhigh/max，`'default'` 不是合法值 → 400 → turn 落空。

## 边界（不在本任务内）

同一日志里另一会话 `74c9a75e` 的 `No Codex resident session is bound for "<id>"` 是**既有契约**：常驻宿主是单会话的（multiplexedHost=false，一会话一 app-server），管理器按 `host-not-multiplexed` 拒绝第二条 resident 会话绑定。见 `codex-cli-bump-0-166`（done）「边界与已知偏差」第 2 条。本任务不修它；若要让同一 provider 同时承载多条 resident 会话，属 GOAL-051 决策①（multiplexedHost false）的后续变更，另立任务/决策，不在本任务内。

## 修复

`turnParams`：`'default'` 不写进 `turn/start` 的 `effort` 字段（省略，让 app-server 用其默认）；其余 CloudCLI 合法 effort 值映射到 codex 词表（low/medium/high 直通；不属于 codex 词表的省略或映射，映射表要在代码里注明来源）。`thread/start` 的 `threadParams` 若同样透传 effort，一并处理。

## Acceptance Criteria

- [x] AC1 **effort 'default' 不再透传**：`npx tsx --tsconfig server/tsconfig.json --test server/modules/providers/tests/codex-host-driver-persistent.test.ts` 退出 0 且 fail 0；新增/改写的用例断言 `turnParams(threadId, { command, options: { effort: 'default' } })` 的返回对象**不含** `effort` 键，`effort: 'high'` 时含 `effort: 'high'`。假形态：临时把 `'default'` 恢复为原样透传 ⇒ 该用例红；抄下逐字失败行后还原。
- [x] AC2 **不新增 server 测试文件**：修复的测试加进既有 `server/modules/providers/tests/codex-host-driver-persistent.test.ts`（或既有 codex-host-driver-* 测试文件），不新建 `*.test.ts`，避免连带 quay-test-script 的 collected/unknown 钉子与 suite-duration-baseline 覆盖率下限。
- [x] AC3 **typecheck 无回归**：`npm run typecheck` 退出 0。

## Definition of Done

AC1 的假形态实测过（先红后绿），完成记录贴出判据的 tests/pass/fail 与逐字失败行。修完后生产 :3001 上人 yale 能创建 resident codex 会话、发第一条消息得到响应（真实 app-server，不是注入替身）。

## Touches

- server/modules/providers/list/codex/codex-host-driver.contract.ts
- server/modules/providers/tests/codex-host-driver-persistent.test.ts
- tasks/gap-codex-resident-send-no-response-two-root-causes.md

## 完成记录

- AC1 绿：`npx tsx --tsconfig server/tsconfig.json --test server/modules/providers/tests/codex-host-driver-persistent.test.ts` → `ℹ tests 6` / `ℹ pass 6` / `ℹ fail 0`，读数 `defaultHasEffort=false highEffort=high ultracodeHasEffort=false`。
- AC1 假形态红：临时把 `turnParams` 还原为 `const effort = turn.options.effort; … typeof effort === 'string' ? { effort }` → `ℹ tests 1` / `ℹ pass 0` / `ℹ fail 1`；逐字失败行：`AssertionError [ERR_ASSERTION]: the 'default' sentinel must leave the effort field out of turn/start`，`actual: { threadId: 'thread-effort', input: [ [Object] ], effort: 'default' }`，`expected: { threadId: 'thread-effort', input: [ [Object] ] }`。随后已还原并复绿。
- AC2：只改既有 `server/modules/providers/tests/codex-host-driver-persistent.test.ts`，未新增 `*.test.ts`。
- AC3：`npm run typecheck`（tsc ×3）→ `EXIT=0`。
- 边界：按 amended body，`No Codex resident session is bound` 属既有单会话契约，本任务未改 `codex-host-driver.provider.ts`。
- 续做轮（2026-10-30）：上一轮 exited-not-landed 的真因是 fan-in 的 AC 闸读不到判据段——正文用 `## AC` / `## DoD`，而任务无 `## Proposal`/`## Plan`/`## Contract`/`## Finding` 标题时 shape 判为 unknown，闸只认字面量 `## Acceptance Criteria` / `## Definition of Done`，于是 `fan-in-ac-completion-gate.js --json` 返回 `status:"not-evaluated", sectionFound:false`。已把两个段标题改为通用字面量（AC 文本原样保留，勾选不变）。复验：闸 → `{"ok":true,"status":"pass","total":3,"checked":3}`；测试 6/6 fail 0；typecheck EXIT=0；anti-drift `ANTI-DRIFT OK`（2 文件均在 Touches 内）。

## ADR-007 暗轴

- 该轴仍暗,理由:本任务只改 codex provider 内部的 effort 映射与一个既有测试文件，未新增模块、依赖边或文档面，未采集 ArchGuard 度量。

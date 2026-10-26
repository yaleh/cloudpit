---
id: cockpit-session-ask-brief
title: 驾驶舱卡片简报：卡片浮出时网关单次生成 BriefSpec、宿主检查最多 3 轮、不过回落默认卡，单条 30k 与每日 0.5M token
  上限经 server.settings.json
status: ready
labels:
  - feature
  - cockpit
parent: null
children: []
extra:
  schema: execution
depends_on:
  - observation-session-ask-decision-digest
  - cockpit-card-provider-contract-and-registry
goal_ac: AC-427
---
## Proposal

来源：本会话 2026-10-27 简报实验 E2（报告与脚本在主检出 `/data/home/yale/work/claudecodeui/experiments/cockpit-briefing/`，尚未提交，worktree 里按绝对路径读）。结论：网关单次调用 + 宿主检查（最多 3 轮）8/8 通过，p90 16 s，约 1.3 万 token/条；短 Claude Code 会话约 11 倍成本、6/8 通过。用户看过 6 张盲评对照，认为两者「基本都可以接受，差异不大」，确认产品化单次版本。

简报是卡片的内容（ContentResolver 一侧），不是语义：什么时候算「在等你」由 quay-fleet 决定（满 3 分钟才把 ask 投影成卡片）。所以触发点是「一张带 `cloudcli.session-ask` 内容引用的卡片被浮出」，CloudCLI 不自己计时。

做什么：

- `server/modules/cockpit/cockpit-brief-spec.ts`：把实验里的 `brief-check.mjs`（185 行）移植成 TS——BriefSpec v0 的预置形式（radar、compare-table、diffstat、checklist、timeline、graph、callout）、`checkBrief`、`defaultBrief`、`LIMITS`、必带雷达轴 rev 与 evid、按显示宽度计的最短长度（CJK 算 2）、`radarSemantic` 简写展开（实验里修过：CLI 曾漏展开）。按 E2 建议把 checklist 的 `done` 改为可选、默认 false。canvas 两臂都没用过，v0 先不移植 canvas。
- `server/modules/cockpit/cockpit-brief.service.ts`：一个带生命周期的类。输入为卡片的内容引用（sessionId、messageId）与 `observation-session-ask-decision-digest` 产出的决策摘要；读转写尾部，问题以最后一条助手消息为准，不取 digest 的 `askingYou` 摘录（E2 里 2/8 因此问错了问题）。经现有 `llm-gateway` 模块调用网关（模型与网关设置复用回复建议与会话 digest 的做法，不新建通道），提示词带 schema、骨架、一份完整示例（参照实验的 `e2-b1.py`）。宿主检查不过就把错误回给模型，最多 3 轮；仍不过返回 `defaultBrief`，并记录失败规则与原始输出（E2 的 `unparseable-json` 因没留原文而无法分析）。结果按 askId 与 revision 缓存。
- 预算：`server/modules/cockpit/cockpit-brief-settings.ts` 读 server.settings.json 的 `cockpit.brief` 块（`enabled` 默认关、`perBriefTokenCap` 默认 30000、`dailyTokenCap` 默认 500000），用 `server/shared/settings-file.ts` 的块读取器；输入输出 token（含缓存读写）都计入。超单条上限停止并回落默认简报；当日达到上限后新卡片直接回落默认简报，不调用网关。
- 读口：`GET /api/cockpit/cards/:id/brief` 返回简报或默认简报，带 `generated | fallback` 与原因；挂在 `server/modules/cockpit/cockpit.module.ts`。

不做：简报的界面渲染（卡片 Details 里的雷达、对照表等）留给后续界面任务；短 Claude Code 会话版本不上线。

## AC

- [ ] `npx tsx --tsconfig server/tsconfig.json --test server/modules/cockpit/tests/cockpit-brief.test.ts` 退出 0（AC-427 判据）：网关客户端桩掉；覆盖首轮通过即缓存（同一 askId 与 revision 第二次请求网关调用数仍为 1）、两轮失败后第 3 轮通过、3 轮都失败回落默认简报并记录失败规则与原始输出、单条上限、每日上限、问题取最后一条助手消息而非 digest 摘录。
- [ ] 假形态各自变红：检查失败仍返回模型输出 ⇒ 用例红；允许第 4 次调用网关 ⇒ 用例红；达到每日上限仍调用网关 ⇒ 用例红；把 cache_read 与 cache_creation token 排除在计数外 ⇒ 预算用例红。每个假形态改完即还原。
- [ ] `npx tsx --tsconfig server/tsconfig.json --test server/modules/cockpit/tests/cockpit-brief-spec.test.ts` 退出 0：移植实验 `brief-check.test.mjs` 的 18 条用例（canvas 相关的除外，并在完成记录写明除外了哪几条），另加 checklist 缺 `done` 时通过的用例。
- [ ] `npx tsx --tsconfig server/tsconfig.json --test server/shared/tests/server-import-cycle-budget.test.ts` 与 `npx tsx --tsconfig server/tsconfig.json --test server/shared/tests/architecture-ratchet.test.ts` 均退出 0。
- [ ] `npm run typecheck` 与 `npm run lint` 退出 0（lint 仅既有 warning）。

## DoD

在隔离实例里打开 `cockpit.brief.enabled` 与 `cockpit.fixtureCards`，用 workers 网关的最便宜模型（不打印密钥，网关主机打码）对本机会话库里 3 个以提问结束的真实会话各生成一次简报：贴出每份简报 JSON、检查轮数、耗时与 token 数（含缓存读写），确认问题都对应最后一条助手消息。再把 `dailyTokenCap` 临时设为低于一条的值，请求一张新卡片的简报，贴出 `fallback` 响应与原因，且网关调用数没有增加。实例用毕 `scripts/isolated-instance.sh stop`。

## Touches

- tasks/cockpit-session-ask-brief.md
- server/modules/cockpit/cockpit-brief-spec.ts (new)
- server/modules/cockpit/cockpit-brief.service.ts (new)
- server/modules/cockpit/cockpit-brief-settings.ts (new)
- server/modules/cockpit/cockpit.module.ts
- server/modules/cockpit/index.ts
- server/modules/cockpit/tests/cockpit-brief.test.ts (new)
- server/modules/cockpit/tests/cockpit-brief-spec.test.ts (new)
- server/shared/tests/server-import-cycle-budget.test.ts
- server/shared/tests/quay-test-script.test.ts
- scripts/suite-duration-baseline.tsv

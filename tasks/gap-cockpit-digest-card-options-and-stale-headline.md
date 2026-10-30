---
id: gap-cockpit-digest-card-options-and-stale-headline
title: digest 卡渲染：永远有可点选项、自愈后标题不再滞留、读数行可区分
status: ready
labels:
  - cockpit
parent: null
children: []
extra: {}
---
## Proposal

digest 卡（`plan.digest.v0` 的 `+N error` escalate）有渲染缺陷。实测 2026-10-30T11 claudecodeui 卡 `att_2d86bc040462`：

1. **空选项**：卡 `options:[]`，但 UI 套「Choose an option, then confirm」——用户没有可点项，既无法确认也无法 dismiss。
2. **标题/读数不跟随自愈**：标题钉在「+2 error」，但同一条 evidence 里 11:29:19 已有一条「+2 ok」（读已自愈）；卡既不反映已恢复，也不自动关案。
3. **读数行不可区分**：两条 evidence（11:26 `+2 error` / 11:29 `+2 ok`）被渲染成两个几乎相同的「读数：plan.digest.v0 … +2 error」行，看不出哪条 error 哪条 ok。

修：digest 卡（及同类非 session-ask 的 notify/escalate 卡）渲染要（a）永远给出可点选项（至少 dismiss/ack），（b）标题/读数反映最新状态（自愈后显示已恢复，或按最新 evidence 判定），（c）多条读数行按 grade/状态可区分。

## Plan

1. 卡片投影层对 digest 类卡生成至少一个可点选项（`dismiss` 或 `ack`），不再返回 `options:[]`。
2. 卡片的标题/headline 取最新 evidence 的状态，而不是只取第一条 escalate 的 reason；digest 已自愈（存在 +ok evidence）时标题反映 recovered/ok。
3. 多条 evidence 的读数行渲染带上 grade/状态标记（error vs ok），不再截断成相同前缀。

## AC

- [ ] AC1: 一张 digest escalate 卡的 `options` 非空，至少含一项 dismiss/ack（回归 `att_2d86bc040462` 的 `options:[]`）。
- [ ] AC2: 同 dedup 键的 digest 卡在 +ok evidence 到达后，标题/headline 反映 recovered（不再「标题 +2 error、evidence 已 +2 ok」的滞留态）。
- [ ] AC3: 多条 evidence 的读数行可区分（每行带 grade/状态，或明确 error vs ok），不再出现两行截断得一样的「+2 error」。

## DoD

在 landed 提交上，digest 卡有可点选项、自愈后标题不再滞留过期 error、读数行可区分。

## Touches

- server/modules/cockpit/cockpit-fleet-card-provider.ts
- server/modules/cockpit/cockpit-fleet-card-projection.ts
- server/modules/cockpit/tests/cockpit-fleet-card-provider.test.ts
- tasks/gap-cockpit-digest-card-options-and-stale-headline.md

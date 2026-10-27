---
id: AC-432
title: quay-fleet 卡片提供方：调 quay-fleet cockpit cards --json 投影成卡片，会话提问卡本地补全内容，默认选项只取助手推荐
status: achieved
kind: criterion
goal: GOAL-050
criterion: npx tsx --tsconfig server/tsconfig.json --test
  server/modules/cockpit/tests/cockpit-fleet-card-provider.test.ts
expect: 以注入的 CLI 运行函数（返回 JSONL 夹具，形状照 quay-fleet 任务 fleet-cockpit-card-read-port
  的输出）：每行投影为一张 provider 为 quay-fleet
  的卡片，revision、state、group、rank、subject、notify
  原样透传，排序与显隐只由注册表按提供方字段决定；短时间内多次取卡只调用一次 CLI；CLI 不存在、退出非 0 或某行不是合法 JSON
  时，提供方返回空列表或跳过坏行并给出可读原因，不抛到注册表；contentRef.resolver 为 cloudcli.session-ask
  的卡片，其问题、情境与选项由注入的会话提问摘要读取函数补全，助手原文有推荐时只有那一项 suggested 且 source 为
  assistant，没有推荐时没有默认选项，摘要缺失时卡片照常出现并标明内容未就绪。取假形态：每次取卡都调用一次 CLI
  即红；会话提问卡在助手没有推荐时出现 suggested
  即红；坏行让整批卡片消失即红。当前必红：server/modules/cockpit/tests/cockpit-fleet-card-provider.test.ts
  不存在。
origin: 本会话 2026-10-27：quay-fleet 已立 fleet-cockpit-card-read-port（读口 quay-fleet
  cockpit cards --json，每行一张 CockpitCard，provider 为 quay-fleet，subject.project
  恒有值，session-ask 卡带 contentRef cloudcli.session-ask）；E1 结论默认选项只取助手推荐。
activatedAt: 2026-10-27T02:55:59.626Z
statusLog:
  - at: 2026-10-27T02:55:59.626Z
    from: draft
    to: active
    actor: claude-session-摄像头与阻塞项驾驶舱
    reason: 用户 2026-10-27 批准激活 GOAL-050（调整正文后）
  - at: 2026-10-27T03:28:59.206Z
    from: active
    to: achieved
    actor: goal-driver
    reason: "I2: criterion pass"
fidelity:
  verdict: faithful
  reason: "fidelity judge: faithful"
  at: 2026-10-27T02:55:59.626Z
---

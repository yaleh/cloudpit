---
id: GOAL-050
title: 驾驶舱：卡片提供方架构与手机 / PC 界面
status: draft
kind: goal
origin: 本会话 2026-10-26 至 10-27
  驾驶舱重设计（docs/architecture/cockpit-attention/INTERACTION-PRINCIPLES.md、CARD-PROVIDERS.md）；用户确定驾驶舱只放等我处理的卡片，PC
  为会话页右侧常驻可收起列，手机为独立页。
---
## 背景

用户近期几乎不用驾驶舱：现有三个跨项目页面（首页、Observation wall、All projects）要切换，列表行的信息不足以做判断。约三分之一的用户消息是在回答助手的提问，而这些提问在驾驶舱里看不到。

重设计后的模型：驾驶舱 = 等我处理的卡片。卡片显示问题、情境、事实与默认选项的完整说明；一个选项下拉（富文本，末项为自己的回复）；一个确认，始终经确认卡。PC 为会话页右侧常驻可收起列（header 右侧带计数按钮），手机为独立页。驾驶舱在本项目内封装；卡死、救援、等待、通知、结束等开发语义由 quay-fleet 提供；将来可接入别的卡片提供方。

2026-10-27 实验结论：会话提问的判官达不到自动执行的精度（E1），默认选项只取助手自己的推荐；卡片简报用网关单次生成可行（E2），已产品化。

## 退出条件

第一批：
- AC-421 卡片契约与提供方注册表
- AC-422 卡片线上类型两侧一致
- AC-423 会话提问的结构化决策摘要与 session.asking / session.answered 事件
- AC-424 驾驶舱 controller 的确认与选项规则
- AC-425 卡片组件的触摸区与选项下拉
- AC-426 场景运行器能读出并操作驾驶舱卡片
- AC-427 卡片简报：网关单次生成、宿主检查、预算上限

第二批（不依赖 quay-fleet）：
- AC-428 执行器 session.send 与 session.start，自己的回复按主体给默认执行器
- AC-429 PC 右侧驾驶舱列
- AC-430 手机 header 与驾驶舱页
- AC-431 简报渲染

第三批（对接 quay-fleet；fleet 侧任务 fleet-cockpit-card-read-port、fleet-context-schema-session-ask-events、fleet-cockpit-rescue-actions 已在 quay-fleet 仓库立项）：
- AC-432 quay-fleet 卡片提供方
- AC-433 会话提问事件真实写入 context 事件流

待 fleet 处置动作落地后补入：fleet 处置执行器、指令开会话。

## 非目标

- 不在 CloudCLI 里判定卡死、救援、等待时长、通知与事项结束；这些由提供方给出。
- 不写 quay-fleet 的文件；fleet 适配器只读它的读口。
- 悬停预览、批量确认不在本目标内。
- 会话提问不自动作答（E1）。

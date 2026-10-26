---
id: AC-425
title: 卡片组件：非选项区打开 Details、无独立按钮、富文本选项与自己的回复编辑框
status: draft
kind: criterion
goal: GOAL-050
criterion: npx vitest run src/modules/cockpit/tests/CockpitCard.test.tsx
expect: 渲染一张卡片：点按头部、问题、情境或事实区域即请求打开 Details；卡片上不存在独立的 Alternatives 或 Details
  按钮；选项下拉的每一项显示该选项的富文本说明（做什么与后果标签），最后一项是带编辑框的「自己的回复」；选中的选项在卡片上显示完整说明，确认条的标签带该选项名；不可逆选项的确认条为警示样式；卡片类型与小可视化按描述表渲染，未知类型走默认渲染而不报错。当前必红：src/modules/cockpit/tests/CockpitCard.test.tsx
  不存在。
origin: 本会话 2026-10-26 用户确认的手机卡片设计（效果图 80 至 90 号，A、B、C 三个触摸区与选项下拉）。
---

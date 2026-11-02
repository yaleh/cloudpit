---
id: AC-465
title: Settings → Agents → Codex 服务商设置 UI：CRUD + 模型编辑器 provider 区（真实浏览器 + 场景运行器）
status: active
kind: criterion
goal: GOAL-055
criterion: npx vitest run src/modules/settings/tests/codexProviderSettings.test.tsx
expect: Settings → Agents → Codex 有服务商设置：provider CRUD
  表单（baseUrl/envKey/tokenFile/wire_api 固定 responses）、secret
  掩码、未知字段告警、Responses-only 提示；模型编辑器对 codex 显示 provider 选择器（数据来自 settings 路由）而非
  Claude env 编辑器；前端不写 provider === 'codex' 分支（差异走 PROVIDER_DESCRIPTORS/数据）。DoD
  另含 MCP 浏览器实际操作 + 截图 + scripts/ui-scenario.mjs 报告。
origin: 人 yale 2026-11-02 裁定：项目配置为主；UI DoD 遵循 AGENTS.md（MCP 浏览器 + 场景运行器）。
activatedAt: 2026-11-02T09:23:15.646Z
statusLog:
  - at: 2026-11-02T09:23:15.646Z
    from: draft
    to: active
    actor: goal-driver
    reason: "triage: activate"
fidelity:
  verdict: faithful
  reason: "fidelity judge: faithful"
  at: 2026-11-02T09:23:15.646Z
---

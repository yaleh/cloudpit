---
id: gap-ac443-codex-resident-shell-tab-not-disabled
title: "AC-443 leg 3: codex resident 会话的 Shell 标签不沿用 Claude 的禁用（普通终端不 resume）"
status: ready
labels: []
parent: null
children: []
extra:
  schema: execution
---
## 背景

GOAL-051 / AC-443（post-merge）真实浏览器判据 `npx playwright test e2e/codex-resident-ui.spec.ts` 三条腿里 leg 1（常驻开关）、leg 2（状态栏 resident 徽标）绿，leg 3（Shell 标签普通终端）红。Playwright 抓到的真实 DOM：codex resident 会话的 Shell 标签是

```
<button disabled role="tab" … aria-disabled="true" data-disabled-reason="resident"
  aria-describedby="resident-shell-notice"
  title="Shell is unavailable for resident sessions. Close resident mode to use it.">
```

即 codex 沿用了 Claude 的「resident 禁用 Shell」行为，与 GOAL-051 裁定「Shell 标签：普通终端不 resume（不沿用 Claude 的禁用）」相反。

## 根因

`src/modules/project-workspace/WorkspaceMain.tsx` 的 `isResidentSession = lifecycleMode.mode === 'resident'` 是 provider 无关的；`src/modules/project-workspace/WorkspaceTabs.tsx` 的 `shellTabState` 对一切 resident 会话的 shell 标签返回 disabled。没有 codex 例外（`grep codex src/modules/project-workspace/*.tsx` = 0）。

## 修复

在 `WorkspaceMain.tsx` 引入 provider 感知的 shell 限制标志：

```
const shellResidentRestricted =
  isResidentSession && (selectedSession?.__provider ?? selectedSession?.provider) !== 'codex';
```

并把 WorkspaceMain 里四处 shell 相关用法（kick-off effect、WorkspaceHeader 传参、resident-shell-notice、shell view 条件）从 `isResidentSession` 改为 `shellResidentRestricted`。codex resident 会话因此保持普通终端（Shell 可开、不渲染 resident 禁用提示）。

## AC

- [x] AC1 **leg 3 绿**：主检出 `npx playwright test e2e/codex-resident-ui.spec.ts` 三条腿全绿（leg 1/2/3 pass，fail 0）。leg 3 失败行必须不再是 `element is not enabled`（disabled shell 标签）。
- [x] AC2 **codex 不禁用、claude 仍禁用**：真实浏览器里 (a) codex resident 会话的 Shell 标签无 `disabled`/`aria-disabled`/`data-disabled-reason="resident"`，点击后 `[data-workspace-view="shell"]` 挂载、`[data-resident-shell-notice]` 计数 0；(b) claude resident 会话的 Shell 标签仍 `disabled`（负向控制：不是把 shell 限制整个删掉）。

## DoD

leg 3 判据绿 + AC2 的 codex/claude 双侧读数都记录（claude 侧可用既有 `e2e/resident-shell-tab.spec.ts` 佐证未回归）。`npx playwright test e2e/resident-shell-tab.spec.ts` 不因本次改动红。

## Evidence

- `npx playwright test e2e/codex-resident-ui.spec.ts` → `3 passed (18.6s)`，fail 0；leg 3 输出 `codex.resident.shell.closure={"disabled":null,"ariaDisabled":null,"reason":null} enabled=true` 与 `codex.resident.shell=normal`。
- AC2(a) codex 侧：Shell 标签 `disabled`/`aria-disabled`/`data-disabled-reason` 三个属性均为 null，`isDisabled()=false`；点击后 `[data-workspace-view="shell"]` count=1，`[data-resident-shell-notice]` count=0。
- AC2(b) claude 负向控制：`npx playwright test e2e/resident-shell-tab.spec.ts` → `1 passed (19.8s)`；resident 读数 `shellTab.disabled=true`、`shellTab.disabledReason=resident`、`shellTab.ariaDisabled=true`。
- 抗漂移 Touches：`ANTI-DRIFT OK — 3 actual file(s), all within declared Touches (4 glob(s))`。
- 预合并：`git merge --no-edit develop` → `Already up to date.`

## ADR-007 暗轴记录

该轴仍暗,理由:本任务只改 WorkspaceMain 的 Shell 关闭分支并新增 e2e 判据，未新增或删除模块依赖边，架构图无变化。

## Touches

- src/modules/project-workspace/WorkspaceMain.tsx
- e2e/codex-resident-ui.spec.ts
- playwright.config.ts
- tasks/gap-ac443-codex-resident-shell-tab-not-disabled.md

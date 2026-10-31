---
id: AC-456
title: GOAL-054 goal preview UI DoD：真实浏览器预览上 Cloudpit 可见身份成立，注入旧品牌必须变红
status: active
kind: criterion
goal: GOAL-054
criterion: npx playwright test e2e/cloudpit-brand-preview.spec.ts -g "AC-456"
expect: 在 goal/GOAL-054 工作树自身源码起的真实浏览器页面上（与 quay goal preview 同一棵树，不读可能过期的
  dist/）：document.title 与 <meta name="apple-mobile-web-app-title"> 为
  Cloudpit；fetch('/manifest.json') 的 name 与 short_name 为 Cloudpit；Settings →
  About 产品名为 Cloudpit，上游 fork 链接 https://github.com/siteboon/claudecodeui 与
  AGPL-3.0 行仍在（证明 allowlist 面没有被误删；About 里的 CloudCLI Hosted/Pro 属 allowlist
  的外部服务文案，不作整面禁令）；侧边栏与认证面的可见品牌文案中无未被 allowlist 的 CloudCLI（按
  scripts/brand-allowlist-check.mjs 的规则表判定）；同一 spec 把上述检查点的 full-page screenshot
  写到 tmp/cloudpit-brand-preview/。取假形态：任一可见面仍是 CloudCLI，或同一断言函数对注入 CloudCLI
  的合成读数（title / manifest.name / About 产品名）不变红，均红。窗口/通知标题与 CLI banner 是
  Electron/CLI 面，浏览器预览不可观测，仍由 AC-451 的静态判据覆盖。
origin: 人 yale 2026-10-31 经会话裁定采纳 gap-goal-054-goal-preview-ui-dod-ac 的提案 (a)；依据
  GOAL-054 充分性判官 verdict=insufficient（key a36ec854…，since
  2026-10-31T15:10:16.960Z，cache ts 2026-10-31T14:53:25.255Z）：退出条件第 3 条「UI
  预览」无在域 AC。编号 AC-456（AC-451…AC-454 属 GOAL-054，AC-455 属 GOAL-053）。
activatedAt: 2026-10-31T15:47:22.713Z
---

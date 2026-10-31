---
id: AC-451
title: Cloudpit 可见身份：产品名/manifest/CLI/About 全为 Cloudpit，CloudCLI 仅出现在 allowlist
status: active
kind: criterion
goal: GOAL-054
criterion: npx tsx --tsconfig server/tsconfig.json --test
  scripts/brand-allowlist-check.test.mjs
expect: 构建后的产品标题、PWA manifest 的 name/short_name、CLI banner、About 产品名、窗口与通知标题均为
  Cloudpit；package.json 的 name=@yalehwang/cloudpit、bin 只有
  cloudpit、productName=Cloudpit、artifactName=cloudpit-desktop-*；CloudCLI 只出现在
  LICENSE/NOTICE、fork 归属段、cloudcli.ai 外部服务文案与上游包/镜像/URL 中；品牌 allowlist 检查器在注入一条非
  allowlist 的 CloudCLI 时必须变红。取假形态：任一产品面仍写 CloudCLI、tarball 中仍有 cloudcli
  bin、或检查器对注入违规不变红，均红。
origin: docs/proposals/cloudpit-rename-SPEC.md（2026-10-31）§3 兼容矩阵、§5 运行时契约、§6
  分发与发布、§9 Stage B；人 yale 2026-10-31 裁定 GOAL-053 普通 + GOAL-054 branch-mode
  的混合推进。
activatedAt: 2026-10-31T14:50:47.166Z
statusLog:
  - at: 2026-10-31T14:50:47.166Z
    from: draft
    to: active
    actor: goal-cli
    reason: ""
fidelity:
  verdict: not-evaluated
  reason: no judge configured
  at: 2026-10-31T14:50:47.165Z
phase: pre-merge
---

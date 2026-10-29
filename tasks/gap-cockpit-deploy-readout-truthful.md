---
id: gap-cockpit-deploy-readout-truthful
title: 驾驶舱部署读数如实：Last deploy 读运行中进程的构建信息、changes not yet built 与
  build-skew-check 同源、读不到时说未知
status: todo
labels:
  - gap
  - cockpit
  - p2
parent: null
children: []
extra: {}
---
## Proposal

来源：2026-10-29 驾驶舱线上审查（MCP 浏览器）。截图 `tmp/cockpit-audit2/01-list-pc.png` 顶部。

问题：驾驶舱顶部的部署读数与事实不符。

- 页面显示 `Last deploy 6f6d140 · verified · 100 hours ago`，而线上实际跑的是 `13e798c`（2026-10-28T16:31Z 延迟重启上线，`~/.local/state/cloudcli-deferred-restart/result.json` 里有 `buildInfo.gitSha` 与 `finishedAt`）。
- 同一行左侧写着 `8 changes not yet built`，但我们每次都是完整构建后才重启，`node scripts/build-skew-check.mjs --json` 当时读数是 `same`。
- 旁边的 `todo 3` 与队列里 6 个任务不一致。

这类读数一旦说错，人会用它判断「要不要重启」，比界面不刷新更危险。要做的是让读数与它声称的来源对齐，并在来源不可读时**说不可读**，不要给出一个看起来像事实的旧值。

做什么：

1. 先查清这三处读数各自的数据来源（`DeployReadiness.tsx` 及其服务端读取），在任务完成记录里写出来源文件/接口与实测值。
2. `Last deploy` 改为读**当前正在运行的那个进程的构建信息**（`dist-server/build-info.json` + `/api/health` 或同类运行时读数），不读历史物化的某个文件；读不到时显示「未知（读数不可用）」，不显示旧 sha。
3. `changes not yet built` 与 `build-skew-check` 用同一个判定（同一次构建的 client/server sha 与服务端正在运行的 sha 比较），不再另算一套。
4. `todo N` 与驾驶舱队列用同一个来源（quay 任务读数），并写明读的是「队列里 ready+todo 的任务数」。

## AC

- [ ] `npx vitest run src/modules/cockpit/tests/DeployReadiness.test.tsx` 退出 0，新增用例：给出「运行中 sha = A、构建物 sha = A」的注入读数时，显示已部署 A 且不显示 `changes not yet built`；「运行中 sha = A、构建物 sha = B」时显示 `1 change not yet built` 与两个 sha；读数缺失时显示「未知（读数不可用）」而不是任何 sha 字面量。
- [ ] `npx vitest run src/modules/cockpit/tests/DeployReadiness.test.tsx` 追加用例：`todo` 计数等于注入的队列读数，且与卡片列表用同一个注入源（同一测试里断言两处数字相等）。
- [ ] 假形态变红：把运行中 sha 改回读历史文件 ⇒ 第一条用例红；把缺失读数回落成旧 sha ⇒ 「未知」用例红；改完即还原。
- [ ] `npm run typecheck`、`npm run lint` 退出 0（lint 仅既有 warning）。

## DoD

真实页面（MCP 浏览器，只读）：截图驾驶舱顶部，贴出页面上显示的运行中 sha 与 `dist-server/build-info.json` 的 `gitSha`、`node scripts/build-skew-check.mjs --json` 的 `clientSha` 三个读数，三者一致；再贴出读数字段在服务端的来源路径。

## Touches

- tasks/gap-cockpit-deploy-readout-truthful.md
- src/modules/cockpit/DeployReadiness.tsx
- src/modules/cockpit/tests/DeployReadiness.test.tsx
- src/modules/cockpit/CockpitPage.tsx
- src/shared/api.ts

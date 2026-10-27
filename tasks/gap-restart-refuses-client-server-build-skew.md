---
id: gap-restart-refuses-client-server-build-skew
title: 重启前拒绝前后端构建不一致：dist/build-info.json 与 dist-server/build-info.json 的 gitSha
  不同就不重启（共享检查脚本 + restart-server-detached.sh 与延迟重启脚本都调用），部署面板显示不一致
status: ready
labels:
  - gap
  - defect
  - ops
parent: null
children: []
extra:
  schema: execution
---
## Proposal

来源：2026-10-27 线上事故（用户在驾驶舱看到「Could not read the cards: Unexpected token '<', \"<!doctype \"... is not valid JSON」）。MCP 浏览器复现与排查结论：

- 会话「CloudCLI voice input 耳机手势控制」为上线语音修复，18:07 只跑了 `npm run build:client`，18:08 用延迟重启脚本（`~/.local/state/cloudcli-deferred-restart/restart-when-idle.sh`，经 `systemd-run --user` 起独立单元）重启了 `claudecodeui-server.service`。
- 结果 `dist/build-info.json` 为 `d2a9ac5`（10-27），`dist-server/build-info.json` 仍为 `5513eec`（10-26）。新前端请求的 `/api/cockpit/cards` 在旧服务端不存在，落进 SPA 兜底返回 `index.html`，前端解析 JSON 失败。凡是两次构建之间新增或改动接口的功能都会同样坏掉。
- 处置：完整 `npm run build` 后再延迟重启，两份 build-info 都是 `16e52bf16`。

缺陷类：重启链路从不检查「将要服务的前端与服务端是否出自同一提交」。现有能力里已经有两份读数：`server/modules/system/deploy-readiness.service.ts` 读 `dist-server/build-info.json`（builtSha）与 `dist/build-info.json`（clientBuiltSha），`scripts/check-deploy-freshness.mjs` 只比运行中的服务端与 git ref。三条重启入口——`scripts/restart-server-detached.sh`、仓外的延迟重启脚本、部署面板的「Build and restart」（`npm run build`，前后端都建，但构建中途失败时仍可能留下一半）——都没有这道检查。

做什么：

- 新增 `scripts/build-skew-check.mjs`：读两份 build-info，输出 `{ verdict: same | skew | missing, clientSha, serverSha, clientBuiltAt, serverBuiltAt }`（`--json`），`same` 退出 0，`skew` 退出 1，任一缺失退出 2；只读，不构建、不重启。
- `scripts/restart-server-detached.sh` 的 preflight（停服务之前）调用它：非 `same` 时拒绝重启并打印两边的 sha 与修法（`npm run build`）；提供显式 `--allow-build-skew` 逃生开关，用时在日志里记一行原因。
- 把延迟重启脚本收进仓库：`scripts/restart-when-idle.sh`（内容取自 `~/.local/state/cloudcli-deferred-restart/restart-when-idle.sh`，读运行中会话注册表、空闲满 120 秒才重启），在真正停服务前同样调用 `build-skew-check.mjs`，不一致则不重启并把原因写进它的 result.json。仓外旧脚本不删（由人决定），完成记录里写明新旧路径。
- `deploy-readiness.service.ts` 在 builtSha 与 clientBuiltSha 不同时给出明确状态（例如 `buildSkew: true` 与两边 sha），部署面板显示「前端与服务端构建不一致」，而不是只显示待构建提交数。

## AC

- [x] `node --test scripts/build-skew-check.test.mjs` 退出 0：在临时目录造两份 build-info，覆盖 same、skew、client 缺失、server 缺失、JSON 损坏五种，读数与退出码逐一断言。
- [x] `restart-server-detached.sh` 的拒绝路径可验证：用测试缝（`QUAY_SERVER_UNIT` 等既有变量加一个指向临时 build-info 目录的变量）在 `--dry-run` 下造 skew，脚本退出非 0 且输出两边 sha，不触发任何 `systemctl` 调用；same 时 `--dry-run` 照常通过。用例放进 `scripts/build-skew-check.test.mjs` 或同目录新测试文件，在完成记录写明。
- [x] `npx tsx --tsconfig server/tsconfig.json --test server/modules/system/tests/deploy-readiness.test.ts` 退出 0，新增用例：两份 build-info sha 不同 ⇒ 读数带 `buildSkew: true` 与两边 sha；相同 ⇒ `buildSkew: false`。
- [x] 假形态变红：把检查改为只比较 builtAt 不比较 sha ⇒ skew 用例红；改完即还原。
- [x] `npm run typecheck` 与 `npm run lint` 退出 0（lint 仅既有 warning）。

## DoD

在隔离实例上实测：只跑 `npm run build:client` 让两份 build-info 不一致，然后执行 `scripts/restart-server-detached.sh --dry-run` 与 `scripts/restart-when-idle.sh` 的同等预检（指向隔离实例的单元与端口），贴出两次「拒绝重启」的输出与两边 sha；再跑完整 `npm run build`，同一预检通过。用 MCP 浏览器打开隔离实例的部署面板，截图显示构建不一致的提示，存 `tmp/`。⛔ 不得对线上 `claudecodeui-server.service` 执行真实重启。

## Touches

- tasks/gap-restart-refuses-client-server-build-skew.md
- scripts/build-skew-check.mjs (new)
- scripts/build-skew-check.test.mjs (new)
- scripts/restart-server-detached.sh
- scripts/restart-when-idle.sh (new)
- server/modules/system/deploy-readiness.service.ts
- server/modules/system/tests/deploy-readiness.test.ts
- server/modules/system/tests/deploy-notice-provider.test.ts
- src/modules/cockpit/DeployReadiness.tsx
- src/modules/cockpit/tests/DeployReadiness.test.tsx
- src/modules/cockpit/tests/i18nCockpitCompleteness.test.ts
- src/modules/i18n/locales/*/common.json
- src/modules/notices/tests/NoticeSlot.test.tsx

## Completion Notes

实现（提交在本任务分支，位于 `5dd46593d` 之上）：

- 新检查脚本 `scripts/build-skew-check.mjs`：`compareBuildFingerprints()` 是唯一判定（`gitSha` 缺失任一 ⇒ `missing`，相等 ⇒ `same`，否则 `skew`），CLI 支持 `--root`/`--json`，退出码 0/1/2；`isEntrypoint()` 用 `realpath` 比较，脚本经符号链接调用仍算入口，测试可以直接 import 纯函数。只读，不构建、不重启。
- `scripts/restart-server-detached.sh`：新增 `QUAY_BUILD_INFO_ROOT` 缝（默认 `$ROOT`），build-skew 预检排在**所有** `systemctl` 调用之前；非 `same` 直接 `die`，日志打印两边完整 sha 与 `npm run build`；显式 `--allow-build-skew` 时改为记一行 `build-skew OVERRIDE ... reason: ...`。
- `scripts/restart-when-idle.sh`（新，仓内版本）：旧路径 `~/.local/state/cloudcli-deferred-restart/restart-when-idle.sh` **未删除**（由人决定），仓外旧版没有本预检，新延迟重启一律用仓内路径。`--dry-run` 只跑预检；真实路径在启动时与真正 `systemctl --user restart` 之前各查一次，拒绝时写 result `refused-build-skew` 并退出 1。
- `deploy-readiness.service.ts`：读数新增必填 `buildSkew: boolean`（`builtSha` 与 `clientBuiltSha` 都非空且不等）。部署面板 `DeployReadiness.tsx` 在 `buildSkew` 时显示 `cockpit.deployBuildSkew`（12 个 locale 同步新增，占位符 `client`/`server`），并提供「Build and restart」动作，节点带 `data-build-skew`。
- 必填字段加宽会红掉兄弟夹具，一并补了 `buildSkew: false` 并申报 Touches：`src/modules/notices/tests/NoticeSlot.test.tsx`、`server/modules/system/tests/deploy-notice-provider.test.ts`。

AC 证据：

- AC1/AC2 用例在 `scripts/build-skew-check.test.mjs`（9 个用例，`node --test` 全绿）。拒绝路径用真实脚本 + 临时 app root（脚本符号链接进夹具，`ROOT` 落在临时目录）+ PATH 桩记录 `systemctl` 调用：skew `--dry-run` 退出非 0、输出两边 sha 与 `npm run build`、`systemctlCalls === ''`；same 时照常 `DRY RUN` 通过；`--allow-build-skew` 通过并记 `build-skew OVERRIDE`。
- AC3 `deploy-readiness.test.ts` 16/16 通过，新增 sha 不等 ⇒ `buildSkew: true` + 两边 sha、相等 ⇒ `false`。
- AC4 假形态：备份后把判定改成只比 `builtAt`，skew 相关 3 个用例红；按字节还原（sha256 `ab8c322ffd8c0cad0141878b808251fee48f77fb93ca2caf7a904363686be1cc`）后重跑全绿。
- AC5 `npm run typecheck`、`npm run lint` 均退出 0（lint 仅既有 warning）。

DoD 证据（隔离实例，**未对线上 `claudecodeui-server.service` 执行任何真实重启**，全程 `--dry-run`）：

- 造出真实 skew（`f506856` / `5dd4659`）后，`restart-server-detached.sh --dry-run`：`build-skew preflight: SKEW client=f5068568... server=5dd46593... — ... run 'npm run build' (full build) before restarting`，退出 1，未调用 `systemctl`。
- `restart-when-idle.sh` 同预检：拒绝并写入 result `refused-build-skew`，退出 1，两边 sha 同上。
- 完整 `npm run build` 后两份 build-info 都是 `5dd46593d838361629f83f7784cea1cc15afb142`：detached 预检 `build-skew preflight: SAME ...`（随后 `preflight OK` + `DRY RUN`，退出 0），waiter 预检 `build-skew preflight OK: SAME ...`（退出 0）。
- 隔离实例 API 读数 `"buildSkew": true`；真实浏览器（Playwright）读 `data-status="fresh"`、`data-build-skew="true"`，文案 `Frontend and server builds differ (frontend f506856, server 5dd4659)`，动作按钮在场，`pageErrors: []`。截图：`tmp/gap-restart-refuses-client-server-build-skew-dod/deploy-build-skew.png`。验证后已停掉隔离实例（端口 12143）与临时单元 `skew-isolated-unit`；线上单元 MainPID 642437 未变。

- 该轴仍暗,理由:本任务只加重启前护栏、读数与面板提示，不改变任何文档生成或模块依赖图，L_D/L_G 没有本任务产生的新读数；行为由上述判据、隔离实例读数与真实浏览器截图覆盖。

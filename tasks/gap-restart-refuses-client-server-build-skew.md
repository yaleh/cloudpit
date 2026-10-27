---
id: gap-restart-refuses-client-server-build-skew
title: 重启前拒绝前后端构建不一致：dist/build-info.json 与 dist-server/build-info.json 的 gitSha
  不同就不重启（共享检查脚本 + restart-server-detached.sh 与延迟重启脚本都调用），部署面板显示不一致
status: todo
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

来源：2026-10-27 线上事故（用户在驾驶舱看到「Could not read the cards: Unexpected token '<', "<!doctype "... is not valid JSON」）。MCP 浏览器复现与排查结论：

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

- [ ] `node --test scripts/build-skew-check.test.mjs` 退出 0：在临时目录造两份 build-info，覆盖 same、skew、client 缺失、server 缺失、JSON 损坏五种，读数与退出码逐一断言。
- [ ] `restart-server-detached.sh` 的拒绝路径可验证：用测试缝（`QUAY_SERVER_UNIT` 等既有变量加一个指向临时 build-info 目录的变量）在 `--dry-run` 下造 skew，脚本退出非 0 且输出两边 sha，不触发任何 `systemctl` 调用；same 时 `--dry-run` 照常通过。用例放进 `scripts/build-skew-check.test.mjs` 或同目录新测试文件，在完成记录写明。
- [ ] `npx tsx --tsconfig server/tsconfig.json --test server/modules/system/tests/deploy-readiness.test.ts` 退出 0，新增用例：两份 build-info sha 不同 ⇒ 读数带 `buildSkew: true` 与两边 sha；相同 ⇒ `buildSkew: false`。
- [ ] 假形态变红：把检查改为只比较 builtAt 不比较 sha ⇒ skew 用例红；改完即还原。
- [ ] `npm run typecheck` 与 `npm run lint` 退出 0（lint 仅既有 warning）。

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
- src/modules/cockpit/DeployReadiness.tsx
- src/modules/cockpit/tests/DeployReadiness.test.tsx

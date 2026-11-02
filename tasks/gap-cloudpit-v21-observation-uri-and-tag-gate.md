---
id: gap-cloudpit-v21-observation-uri-and-tag-gate
title: Cloudpit v2.1：观测 URI 改新写 + cockpit 反馈键归一化 + 旧 release tag 检查
status: todo
labels:
  - gap
parent: null
children: []
extra:
  schema: execution
depends_on:
  - gap-cloudpit-brand-env-reader-wiring
---
## Proposal

按 `docs/proposals/cloudpit-compat-retirement.md` 的 v2.1 门执行两件事：R6 观测 URI 改为新写、R12 旧 release tag 前缀检查；并补上计划里要求的 `cockpit-card-feedback.json` 键归一化。2.0 已双读，2.1 只切「写」与「检查」，不删除旧读兼容。

范围：

1. **R6 新写**：`server/modules/observation/observation-uri.ts` 与 `src/modules/cockpit-contract/observationUri.ts` 的 `formatSessionUri` / `formatArchitectureUri` 改为 `cloudpit://...`；解析器继续接受 `cloudcli://` 与 `cloudpit://`，旧拼写归一化后仍可读。`src/modules/cockpit/observationUri.ts` 是纯 re-export，保持同形。
2. **键归一化**：`~/.cloudpit/cockpit-card-feedback.json` 及其卡片记录里以 `cloudcli://` 开头的 URI 字符串，在读取时归一到 `cloudpit://`；写前备份，失败回退，幂等；不得丢失卡片/反馈条目。
3. **R12 旧 tag 检查**：release workflow 与 release 资产中不得再出现 `cloudcli-local-server-*` / `cloudcli-desktop-*`；若某渠道在 2.0 实际补发过旧 tag，记录停止补发的 commit，已发布 tag 不删除。
4. 更新 2.0 的「写旧」判据：`server/shared/tests/cloudpit-runtime-flip.test.ts` AC6 从「写旧」改为「写新」，并保留「旧拼写仍可读」臂；混合旧/新键的数据夹具必须通过。

边界：不删除 `cloudcli://` 读取；云端 `cloudcli://auth/callback` 不变；不改 3.0 才退场的 env/数据根/settings/scope/MCP/appId；不改历史账本。

## AC

- [ ] `formatSessionUri` / `formatArchitectureUri` 在 server 与前端两份实现中都产出 `cloudpit://...`；`parseObservationUri('cloudcli://session/x')` 与 `'cloudpit://session/x'` 都返回同一 canonical 结果，前端同形断言通过。
- [ ] 混合夹具：DB/JSON 里同时存在旧键 `cloudcli://session/a` 与旧键 `cloudcli://architecture/b` 时，读取归一到新 URI；`cockpit-card-feedback.json` 的 `subject.uri` 等字符串字段被归一化，备份文件存在，二次运行幂等，失败时保留原文件并报告。
- [ ] `server/shared/tests/cloudpit-runtime-flip.test.ts` 的 AC6 已改为「写新」，并保留「旧拼写可读」对偶臂；`server/modules/observation/tests/observation-store.test.ts`、`observation-routes.test.ts`、`src/modules/cockpit/tests/observationUri.test.ts`、`server/modules/cockpit/tests/cockpit-card-feedback.test.ts` 全部通过。
- [ ] release 检查：`scripts/release/tests/fork-release-workflows.test.mjs` 与 `scripts/release/tests/server-installer-bundle-url.test.mjs` 新增/更新「无旧 tag 前缀」断言；`node --test` 这两个文件退出 0；若工作流/资产仍有旧前缀，本任务必须修正或记录停止补发的 commit。
- [ ] 没有提前删除 2.0 兼容面：`git grep -n 'cloudcli://'` 仍能在解析器与旧键归一化路径命中；`cloudcli://auth/callback` 仍在。
- [ ] `npm run typecheck` 与 `npx oxlint` 对改动文件退出 0；anti-drift 只列 Touches。

## DoD

- 贴出两处 formatter 的 diff、两种拼写的 parse 结果、前端同形断言。
- 贴出混合夹具的归一化前后 JSON、备份路径、二次运行幂等读数、失败回退读数。
- 贴出 `cloudpit-runtime-flip.test.ts` AC6 的改判 diff 与运行末行；贴出 observation/cockpit 相关测试的 `tests/pass/fail`。
- 贴出 release 两个测试文件的运行末行，以及工作流/资产中旧 tag 前缀的 grep 读数（零命中或记录停止补发的 commit）。
- 贴出 `git grep -n 'cloudcli://'` 的残余命中，说明哪些是 2.1 仍保留的读取/契约。
- 贴出 typecheck、oxlint 退出码；不改 UI，不需要浏览器截图。

## Touches

- server/modules/observation/observation-uri.ts
- src/modules/cockpit-contract/observationUri.ts
- src/modules/cockpit/observationUri.ts
- server/modules/observation/observation-store.ts
- server/modules/cockpit/cockpit-card-feedback-store.ts
- server/shared/tests/cloudpit-runtime-flip.test.ts
- server/modules/observation/tests/observation-store.test.ts
- server/modules/observation/tests/observation-routes.test.ts
- src/modules/cockpit/tests/observationUri.test.ts
- server/modules/cockpit/tests/cockpit-card-feedback.test.ts
- scripts/release/tests/fork-release-workflows.test.mjs
- scripts/release/tests/server-installer-bundle-url.test.mjs
- tasks/gap-cloudpit-v21-observation-uri-and-tag-gate.md

---
id: gap-cloudpit-v21-observation-uri-and-tag-gate
title: Cloudpit v2.1：观测 URI 改新写 + cockpit 反馈键归一化 + 旧 release tag 检查
status: done
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

- [x] `formatSessionUri` / `formatArchitectureUri` 在 server 与前端两份实现中都产出 `cloudpit://...`；`parseObservationUri('cloudcli://session/x')` 与 `'cloudpit://session/x'` 都返回同一 canonical 结果，前端同形断言通过。
- [x] 混合夹具：DB/JSON 里同时存在旧键 `cloudcli://session/a` 与旧键 `cloudcli://architecture/b` 时，读取归一到新 URI；`cockpit-card-feedback.json` 的 `subject.uri` 等字符串字段被归一化，备份文件存在，二次运行幂等，失败时保留原文件并报告。
- [x] `server/shared/tests/cloudpit-runtime-flip.test.ts` 的 AC6 已改为「写新」，并保留「旧拼写可读」对偶臂；`server/modules/observation/tests/observation-store.test.ts`、`observation-routes.test.ts`、`src/modules/cockpit/tests/observationUri.test.ts`、`server/modules/cockpit/tests/cockpit-card-feedback.test.ts` 全部通过。
- [x] release 检查：`scripts/release/tests/fork-release-workflows.test.mjs` 与 `scripts/release/tests/server-installer-bundle-url.test.mjs` 新增/更新「无旧 tag 前缀」断言；`node --test` 这两个文件退出 0；若工作流/资产仍有旧前缀，本任务必须修正或记录停止补发的 commit。
- [x] 没有提前删除 2.0 兼容面：`git grep -n 'cloudcli://'` 仍能在解析器与旧键归一化路径命中；`cloudcli://auth/callback` 仍在。
- [x] `npm run typecheck` 与 `npx oxlint` 对改动文件退出 0；anti-drift 只列 Touches。

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
- server/modules/observation/session-digest-llm.ts
- server/modules/cockpit/cockpit-card-feedback-store.ts
- server/shared/tests/cloudpit-runtime-flip.test.ts
- server/modules/observation/tests/observation-store.test.ts
- server/modules/observation/tests/observation-routes.test.ts
- src/modules/cockpit/tests/observationUri.test.ts
- server/modules/cockpit/tests/cockpit-card-feedback.test.ts
- scripts/release/tests/fork-release-workflows.test.mjs
- scripts/release/tests/server-installer-bundle-url.test.mjs
- tasks/gap-cloudpit-v21-observation-uri-and-tag-gate.md

## Evidence

2026-11-02，任务树提交 `31708e9a5`。

- formatter/parse（server 与前端同形实现）：
  - `formatSessionUri('x')` → `cloudpit://session/x`；`formatArchitectureUri('project-1')` → `cloudpit://architecture/project-1`
  - `parseObservationUri('cloudcli://session/x')` 与 `parseObservationUri('cloudpit://session/x')` 都返回 `{"scheme":"cloudpit","kind":"session","id":"x","uri":"cloudpit://session/x"}`
  - `parseObservationUri('cloudcli://architecture/project-1')` 与 `cloudpit://architecture/project-1` 都返回 canonical `cloudpit://architecture/project-1`
  - 前端 `src/modules/cockpit/tests/observationUri.test.ts`：round-trip 与 legacy 读取臂通过，`Tests 23 passed`；两份语法文件的接受 scheme 行仍逐字一致（runtime-flip AC6 的文本对拍仍绿）。
- 混合键 DB 夹具（`server/modules/observation/tests/observation-store.test.ts`）：legacy `cloudcli://session/a` 与 `cloudcli://architecture/b` 两行读出 `cloudpit://...`；wall 与新拼写 pin 归一 join；对 2.0 旧行写入时 revision 2→3 续链而非从 1 重启。`tests 10 / pass 10 / fail 0`。
- `cockpit-card-feedback.json` 归一化（/tmp 实测夹具）：
  - `first.normalization = {"changed":true,"backupPath":"/tmp/v21-feedback-F0aAUF/cockpit-card-feedback.json.cloudcli-backup","error":null}`
  - `backup.exists = true`，`backup.is-pristine = true`
  - `params.subject.uri`：`cloudcli://session/a` → `cloudpit://session/a`；`notices[0].ref = cloudpit://session/a#item-1`；`cardRecords[0].subject.uri = cloudpit://architecture/b`（卡片/反馈条目未丢）
  - `second.normalization = {"changed":false,...,"error":null}`（幂等，不覆盖 pristine 备份）
  - 写失败：`failed.normalization = {"changed":false,"error":"EACCES: permission denied, open '.../readonly.json'"}`，`failed.original-preserved = true`，内存读仍为 canonical
  - `server/modules/cockpit/tests/cockpit-card-feedback.test.ts`：`tests 21 / pass 21 / fail 0`
- `cloudpit-runtime-flip.test.ts` AC6 改为「写新 + 旧拼写可读」：`tests 10 / pass 10 / fail 0`。`observation-routes.test.ts`：`tests 5 / pass 5 / fail 0`。
- 重试轮补漏（上一轮 suite 的 task-introduced-red）：`server/modules/observation/session-digest-llm.ts` 的用量账本用 `/^cloudcli:\/\/session\//` 剥前缀取会话 id；2.1 写 `cloudpit://` 后 `sessionId` 变成整条 URI，`session-digest-llm.test.ts` AC1 断言 `actual='cloudpit://session/llm-success' expected='llm-success'` 红。改为 `parseObservationUri(...).id`（两种拼写都归一），该文件补进 Touches。修后 `session-digest-llm.test.ts`：`tests 9 / pass 9 / fail 0`。
- release：`node --test scripts/release/tests/fork-release-workflows.test.mjs scripts/release/tests/server-installer-bundle-url.test.mjs` → `tests 12 / pass 12 / fail 0`，两文件的 `legacy.tag_prefixes=0`。生产 release 面（`.github/workflows` + `scripts/release/build-server-bundle.js` + `electron/serverInstaller.js` + `package.json`）对 `cloudcli-local-server-|cloudcli-desktop-` 零命中；2.0 未补发旧 tag，无「停止补发 commit」可记。
- `git grep -n 'cloudcli://'` 残余命中（2.1 保留的读取/契约）：`observation-uri.ts` 的解析正则与 `legacyCloudUri` 归一化；`observation-store.ts` 的 INVALID_URI 双拼写文案；`cockpit-card-feedback-store.ts` 的归一化路径；`observation.routes.ts` 的 400 文案；`electron/main.js` 的 `cloudcli://auth/callback`；chat 的 `cloudcli://session/<id>/msg/...` itemRef 契约；cockpit fixture/deep-link 夹具与 docs/goals/tasks 历史账本。`cloudcli://auth/callback` 仍在。
- `npm run typecheck` exit 0；`npx oxlint <改动文件>` exit 0；anti-drift：`ANTI-DRIFT OK ... 11 actual file(s), all within declared Touches (14 glob(s))`。
- 未改 UI，无需浏览器截图。

## Notes

该轴仍暗,理由:本任务只切换观测 URI 的写入拼写、补旧键归一化与 release tag 负向检查，不新增领域数据能力也不改模块依赖图，AC 内没有 L_D/L_G 探针可读。

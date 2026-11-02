---
id: gap-cloudpit-v30-identity-contract-removal
title: Cloudpit v3.0：删除 deep link/观测 URI/MCP/OAuth/SW 旧回退（保留 PAT 与 R14 itemRef）
status: todo
labels:
  - gap
parent: null
children: []
extra:
  schema: execution
depends_on:
  - gap-cloudpit-v30-env-data-settings-removal
---
## Proposal

P3 退场计划的 v3.0 第二批：删除 R5、R7–R9、R11 的身份契约旧回退；R10 PAT 与 R14 brief/reply itemRef 明确**保留**。

范围：

1. **R5 本地 deep link**：`DEEP_LINK_SCHEMES` 只留 `cloudpit`；`cloudcli://auth/callback` 与 `app_surface=cloudcli_desktop` 是第三方契约，继续保留。
2. **R7 观测 URI 旧读**：2.1 已完成新写与键归一化；3.0 删除 `cloudcli://session|architecture` 的读取，`parseObservationUri('cloudcli://session/x')` 返回 null；`cloudcli://auth/callback` 不受影响。
3. **R8 MCP 名**：删除 legacy 名单与「同时清理旧名」；注册/清理只认 `cloudpit-browser`。旧注册由 2.x 卸载路径清理完毕。
4. **R9 OAuth scope**：删除 `cloudcli:*` 的接受与 metadata 双列；旧 token 的 refresh TTL 前置已满足或在 release notes 说明；只保留 `cloudpit:*`。
5. **R11 SW 缓存**：删除 `claude-ui-*` 清理，只删 `cloudpit-*`；不支持 1.x 直升 3.x。
6. **R12 release tag**：无删除动作，只加「未重新引入旧 tag」的负向检查。
7. **保留**：R10 `ccp_` 前缀；R14 brief/reply itemRef 继续写 `cloudcli://session/...`，任何 blanket 删除必须排除 `cockpit-brief-result.ts` 与 `replyItems.ts`。

## AC

- [ ] `DEEP_LINK_SCHEMES` 只含 `cloudpit`；`cloudcli://auth/callback` 仍被解析/注册；`cloudpit-desktop-identity.test.mjs` 的 scheme 判据更新。
- [ ] `parseObservationUri('cloudcli://session/x')` 与 `'cloudcli://architecture/x'` 返回 null；`cloudpit://...` 仍可解析；`cloudcli://auth/callback` 与 R14 的 `cloudcli://session/<id>/msg/...` 仍可用（R14 测试绿）。
- [ ] MCP 名：`mcpServerNamesToRemove()` 只含 `cloudpit-browser`；`cloudcli-browser` / `cloudcli-browser-use` 不再被清理或注册；`browser-use-mcp-entry.test.ts` 更新。
- [ ] OAuth：AS metadata 的 `scopes_supported` 只含 8 个 `cloudpit:*`；`ACCEPTED_ACCESS_TOKEN_SCOPES` 只接受新拼写；旧 scope 请求被拒；旧 token 的失效/续期策略写进 release notes；相关测试更新。
- [ ] SW：activation 只删 `cloudpit-*`；`claude-ui-*` 不再被清理；无关 speech model 缓存保留；`cloudpit-runtime-flip.test.ts` AC9 更新。
- [ ] release 检查：workflow/资产无旧 tag 前缀的负向判据仍绿；R14 的两个 formatter 仍写旧拼写，`replyItems.test.ts`/`cockpit-brief*.test.ts` 绿。
- [ ] `npm run typecheck`、`npx oxlint` 对改动文件退出 0；anti-drift 只列 Touches。

## DoD

- 贴出 deep link scheme 列表、两种观测 URI 的 parse 结果、`cloudcli://auth/callback` 与 R14 formatter 的保留读数。
- 贴出 MCP 名清理/注册读数、OAuth metadata 全表与旧 scope 拒绝读数、SW 删除集合读数。
- 贴出相关测试的 `tests/pass/fail` 末行；贴出 release 负向检查读数。
- 贴出 typecheck/oxlint 退出码；不改 UI，不需要浏览器截图（除非改了可见文案）。

## Touches

- electron/main.js
- package.json
- server/modules/observation/observation-uri.ts
- src/modules/cockpit-contract/observationUri.ts
- server/modules/observation/observation-store.ts
- server/modules/observation/observation.routes.ts
- server/modules/browser-use/mcp-server-names.ts
- server/modules/browser-use/browser-use.service.ts
- server/modules/cli/browser-use-mcp.ts
- server/shared/mcp-contract/types.ts
- server/modules/oauth/access-tokens.service.ts
- server/modules/oauth/oauth-consent.service.ts
- server/modules/mcp-gateway/oauth-metadata.gate.ts
- server/modules/mcp-gateway/mcp-gateway.auth.ts
- public/sw.js
- electron/tests/cloudpit-desktop-identity.test.mjs
- server/modules/observation/tests/observation-store.test.ts
- server/modules/observation/tests/observation-routes.test.ts
- src/modules/cockpit/tests/observationUri.test.ts
- server/modules/cli/tests/browser-use-mcp-entry.test.ts
- server/modules/oauth/tests/access-tokens.service.test.ts
- server/shared/tests/cloudpit-runtime-flip.test.ts
- server/modules/static-assets/tests/service-worker-transient-failure.test.ts
- scripts/release/tests/fork-release-workflows.test.mjs
- tasks/gap-cloudpit-v30-identity-contract-removal.md

---
id: gap-cloudpit-compat-retirement-plan
title: Cloudpit 兼容退场计划：2.1 观测 URI 新写与 3.0 回退面移除/appId 切换
status: ready
labels:
  - gap
parent: null
children: []
extra:
  schema: execution
---
## Proposal

Cloudpit 2.0.0 的兼容层是「新值优先、旧值回退」。现在需要把退场路线写成可执行计划，避免兼容面永久留存或过早删除。本任务**只写计划与判据映射，不删除任何兼容代码**。

计划文档落在 `docs/proposals/cloudpit-compat-retirement.md`，至少覆盖以下每一行的「旧值 / 新值 / 2.0 行为 / 退场版本 / 验证测试 / 回滚」：

- `CLOUDCLI_*` → `CLOUDPIT_*` 环境变量回退
- `~/.cloudcli` → `~/.cloudpit` 数据根、DB、voice-data、cockpit feedback、usage log
- `~/.config/claudecodeui/server.settings.json` → `~/.config/cloudpit/server.settings.json`
- 附件双根读取与新写根
- `cloudcli://` 本地别名 / 观测 URI 双读（2.0 仍写旧值）
- `cloudcli-browser` MCP 名与 legacy 名单
- `cloudcli:*` OAuth scope 双列与旧 token
- `ccp_` PAT 前缀
- SW 缓存 `claude-ui-*` 清理
- 旧 release tag / runtime 资产别名（若 2.0 双发过）
- `appId=ai.cloudcli.desktop` → `ai.cloudpit.desktop`（v3.0，含 userData/安装迁移）

计划要给出两个版本门：

- **v2.1**：观测 URI 改为新写、停止旧 runtime tag 别名（若存在）；其余回退仍读。
- **v3.0**：删除旧环境变量/旧数据根/旧 settings/旧 scope/旧 MCP 名/旧 URI 的兼容；appId 切换并配一次性迁移安装器。

每行必须映射到至少一个现有或新增的测试文件/判据；没有可验证退场的行不得进入计划。计划需与 `docs/proposals/cloudpit-rename-SPEC.md` §13 的退场时间表一致，冲突处以本计划为准并回写 SPEC 的差异说明。

## Plan

1. 逐项 grep 当前回退实现，记录文件与行号（`server/shared/brand.ts`、`data-root.ts`、`settings-file.ts`、`image-attachments.ts`、`observation-uri.ts`、`browser-use.service.ts`、`mcp-gateway.auth.ts`、`public/sw.js` 等）。
2. 写矩阵：每行旧值、新值、当前兼容行为、退场版本、验证命令/测试、回滚方式。
3. 把每行映射到测试：已有测试优先；缺的列出「需要新增哪个测试」，但本任务不新增测试。
4. 写 v2.1 / v3.0 两个版本门与发布顺序，标明 appId 切换的安装器/迁移要求。
5. 与 SPEC §13 对拍；差异写进计划的「与 SPEC 的差异」段。
6. 人 review 后，后续任务按矩阵逐项执行；本任务不执行删除。

## AC

- [ ] `docs/proposals/cloudpit-compat-retirement.md` 存在，含「矩阵」「v2.1 门」「v3.0 门」「与 SPEC 差异」「验证映射」五节；矩阵行数 ≥ 11（覆盖 Proposal 列出的每一项）。
- [ ] 矩阵每一行都有旧值/新值/2.0 行为/退场版本/验证测试/回滚六列，且无空单元格；`grep -c '^|'` 与表头列数一致（可用脚本校验）。
- [ ] 每行的退场版本只取 `2.1` 或 `3.0`；appId 行必须是 `3.0` 且写明 userData/安装迁移；观测 URI 写切换必须是 `2.1`。
- [ ] 验证映射中每个测试路径都真实存在于当前树，或明确标注「本任务不新增，执行时新增」；不得引用不存在的文件却声称已验证。
- [ ] 与 `docs/proposals/cloudpit-rename-SPEC.md` §13 对拍：相同项一致，不一致项在「与 SPEC 差异」段逐条说明。
- [ ] 本任务代码零改动：`git diff --name-only develop...HEAD` 只列出计划文档与本任务文件；`grep -rn 'CLOUDCLI_' server/shared/brand.ts` 等回退实现仍在，证明没有提前删除。
- [ ] anti-drift：`git diff --name-only develop...HEAD` 只列出 `## Touches` 的文件。

## DoD

- 贴出计划文档的章节标题与矩阵表头、行数、每行版本列。
- 贴出每行验证测试路径的存在性读数（`test -e`/`ls`），不存在的明确标注「执行时新增」。
- 贴出与 SPEC §13 的对拍结果（逐项一致/差异说明）。
- 贴出 `git diff --name-only develop...HEAD` 与 `git diff --stat`，证明只有计划文档与本任务文件改动。
- 本任务不改 UI，不需要浏览器实测。

## Touches

- docs/proposals/cloudpit-compat-retirement.md (new)
- tasks/gap-cloudpit-compat-retirement-plan.md

---
id: gap-cloudpit-compat-retirement-plan
title: Cloudpit 兼容退场计划：2.1 观测 URI 新写与 3.0 回退面移除/appId 切换
status: done
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

- [x] `docs/proposals/cloudpit-compat-retirement.md` 存在，含「矩阵」「v2.1 门」「v3.0 门」「与 SPEC 差异」「验证映射」五节；矩阵行数 ≥ 11（覆盖 Proposal 列出的每一项）。
- [x] 矩阵每一行都有旧值/新值/2.0 行为/退场版本/验证测试/回滚六列，且无空单元格；`grep -c '^|'` 与表头列数一致（可用脚本校验）。
- [x] 每行的退场版本只取 `2.1` 或 `3.0`；appId 行必须是 `3.0` 且写明 userData/安装迁移；观测 URI 写切换必须是 `2.1`。
- [x] 验证映射中每个测试路径都真实存在于当前树，或明确标注「本任务不新增，执行时新增」；不得引用不存在的文件却声称已验证。
- [x] 与 `docs/proposals/cloudpit-rename-SPEC.md` §13 对拍：相同项一致，不一致项在「与 SPEC 差异」段逐条说明。
- [x] 本任务代码零改动：`git diff --name-only develop...HEAD` 只列出计划文档与本任务文件；`grep -rn 'CLOUDCLI_' server/shared/brand.ts` 等回退实现仍在，证明没有提前删除。
- [x] anti-drift：`git diff --name-only develop...HEAD` 只列出 `## Touches` 的文件。

## DoD

- 贴出计划文档的章节标题与矩阵表头、行数、每行版本列。
- 贴出每行验证测试路径的存在性读数（`test -e`/`ls`），不存在的明确标注「执行时新增」。
- 贴出与 SPEC §13 的对拍结果（逐项一致/差异说明）。
- 贴出 `git diff --name-only develop...HEAD` 与 `git diff --stat`，证明只有计划文档与本任务文件改动。
- 本任务不改 UI，不需要浏览器实测。

## Touches

- docs/proposals/cloudpit-compat-retirement.md (new)
- tasks/gap-cloudpit-compat-retirement-plan.md

## Evidence

- 计划文档：`docs/proposals/cloudpit-compat-retirement.md`（133 行；章节：`## 矩阵` / `## v2.1 门` / `## v3.0 门` / `## 与 SPEC 差异` / `## 验证映射`）。
- 矩阵：表头 6 列（旧值（项目）/ 新值 / 2.0 行为 / 退场版本 / 验证测试 / 回滚）；数据行 13；`grep -c '^|'` = 15（表头 1 + 分隔 1 + 数据 13）；脚本逐行校验 6 单元格、无空单元格，VALID=true；退场版本仅 `2.1`/`3.0`；R6（观测 URI 写切换）= `2.1`；R13（appId）= `3.0` 且写明 userData 与安装迁移。
- 验证路径存在性（2026-11-02 `test -e`，全部 OK）：`server/shared/tests/cloudpit-brand-env.test.ts`、`server/shared/tests/cloudpit-runtime-flip.test.ts`、`server/shared/tests/cloudpit-data-root.test.ts`、`server/modules/voice/tests/voice-data.test.ts`、`server/modules/reply-suggestions/tests/reply-suggestions-usage-log.test.ts`、`server/shared/tests/settings-file.test.ts`、`server/modules/assets/tests/cloudpit-assets-dual-root.test.ts`、`server/modules/assets/tests/image-assets.service.test.ts`、`electron/tests/cloudpit-desktop-identity.test.mjs`、`electron/tests/cloudpit-userdata-migration.test.mjs`、`server/modules/observation/tests/observation-store.test.ts`、`server/modules/observation/tests/observation-routes.test.ts`、`src/modules/cockpit/tests/observationUri.test.ts`、`server/modules/cli/tests/browser-use-mcp-entry.test.ts`、`server/modules/oauth/tests/access-tokens.service.test.ts`、`server/modules/mcp-gateway/tests/mcp-auth.test.ts`、`server/modules/static-assets/tests/service-worker-transient-failure.test.ts`、`scripts/release/tests/fork-release-workflows.test.mjs`、`scripts/cloudpit-distribution-check.test.mjs`。执行时新增（本任务不新增）：2.1 观测 URI 键归一化判据、2.1 release tag 负向判据、3.0 appId 安装器迁移判据。
- SPEC §13 对拍：2.1 观测 URI 新写 = 一致；2.1 旧 tag 别名停止 = 与 SPEC §3 第 23 行冲突，计划取 2.1 并说明；3.0 移除旧 env/数据根/settings/scope/MCP 名/URI = 一致；3.0 appId 切换 = 一致；附件行 = 计划收窄为「3.0 退查找回退、数据不删」并说明；SW 缓存 = 计划定 3.0 并说明；PAT = 保留，3.0 仅复核。
- 代码零改动：`git diff --name-only develop...HEAD` = `docs/proposals/cloudpit-compat-retirement.md`；`git diff --stat develop...HEAD` = 1 file changed, 133 insertions(+)。任务文件由 task_write 提交到 develop，合入后其内容与 develop 相同，故三-dot diff 不再列出它（Touches 仍声明两者）。回退实现仍在：`grep -c 'CLOUDCLI_' server/shared/brand.ts` = 3；`grep -c '.cloudcli' server/shared/data-root.ts` = 2；`grep -c 'claudecodeui' server/shared/settings-file.ts` = 1；`grep -c 'cloudcli' server/shared/image-attachments.ts` = 4。
- anti-drift：退出前运行 `anti-drift-touches-check --task gap-cloudpit-compat-retirement-plan --worktree <wt> --merge-target develop`，只允许 Touches 中的两份文件。
- L_D: doc_lines_added=133 code_lines_added=0 doc_files_added=1
该轴仍暗,理由:本任务只新增 docs/proposals 计划文档，未改变任何模块依赖或代码边界，无 L_G 可测读数。

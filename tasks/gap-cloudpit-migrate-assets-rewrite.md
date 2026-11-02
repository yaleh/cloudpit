---
id: gap-cloudpit-migrate-assets-rewrite
title: cloudpit migrate-assets --rewrite：附件旧根复制与持久化路径改写（R4 前置）
status: ready
labels:
  - gap
parent: null
children: []
extra:
  schema: execution
---
## Proposal

R4 附件双根删除的前置任务：提供 `cloudpit migrate-assets --rewrite`，把 `~/.cloudcli/assets` 的文件复制到 `~/.cloudpit/assets`，并把应用自己持久化的旧绝对路径改写为新路径；旧根不删除，作为回滚与未改写引用的只读来源。只有该命令真实跑过、引用改写完成，后续 R4 才允许删除旧根读取。

范围：

1. **CLI 命令**：在 `server/modules/cli` 增加 `migrate-assets [--rewrite] [--dry-run] [--json]`；`--dry-run` 只读扫描并输出将复制/改写的数量；`--rewrite` 执行复制与路径改写；无参数时打印用法。
2. **复制语义**：把旧 `assets` 根下文件复制到新根（同文件系统可用 rename/copy，保留旧文件）；同名冲突不覆盖，报告冲突；目标已存在且内容一致则跳过；幂等。
3. **路径改写**：只改写应用自己持久化的绝对路径（至少覆盖 app DB 中保存的附件路径与已知 JSON 状态）；provider transcript 等外部文件不直接改写，只输出「不可改写引用」清单，供人工决定；改写前备份 DB/JSON，失败回滚，不产生半套新路径。
4. **报告**：`--json` 返回 `{copied, skipped, conflicts, rewritten, unrewritable, backupPaths, errors}`；`unrewritable` 必须逐条列出文件/记录，不能静默丢弃。
5. **文档**：新增 `docs/operations/migrate-assets.md`，写清 dry-run → 备份 → 真跑 → 校验 → 旧根保留的顺序，以及 R4 删除旧根读取的前置条件。

边界：不删除旧 assets；不改 `image-attachments.ts` 的默认读取行为（R4 删除另立任务）；不触碰历史账本；不改 UI。

## AC

- [x] `cloudpit migrate-assets --help` 与不带参数的用法输出存在；`--dry-run` 对临时 HOME 夹具只扫描、不创建/不修改任何文件（`git status`/目录清单前后一致）。
- [x] `--rewrite` 在夹具中把旧根文件复制到新根，旧根文件仍在；同名冲突不覆盖并计入 `conflicts`；二次运行 `copied=0`、`skipped` 覆盖全部文件（幂等）。
- [x] 夹具中 app DB/JSON 的旧绝对路径被改写为新根路径；改写前备份文件存在；注入写失败时原文件保留、报告 `errors` 且不产生半套新路径。
- [x] 不可改写的外部引用（如 provider transcript 中的旧路径）逐条进入 `unrewritable`，命令退出码非零或明确 warn，不静默成功。
- [x] `--json` 的字段齐全且可被测试断言；`server/modules/cli/tests/asset-migration.service.test.ts` 覆盖 dry-run、幂等、冲突、失败回滚、unrewritable 五臂。
- [x] `docs/operations/migrate-assets.md` 存在，含 dry-run/备份/真跑/校验/旧根保留顺序与 R4 前置条件；`npm run typecheck`、`npx oxlint` 对改动文件退出 0。
- [x] anti-drift：`git diff --name-only develop...HEAD` 只列出 `## Touches` 的文件。

## DoD

- 贴出 `--help`/无参数用法、`--dry-run` 前后目录清单、`--rewrite` 的 JSON 报告与二次运行幂等读数。
- 贴出冲突、失败回滚、unrewritable 三臂的夹具路径与报告原文。
- 贴出 DB/JSON 路径改写前后的读数与备份文件清单。
- 贴出 `docs/operations/migrate-assets.md` 的章节标题。
- 贴出 typecheck/oxlint 退出码与 anti-drift。
- 本任务不改 UI，不需要 MCP 浏览器截图。

## Evidence

夹具：`/tmp/cloudpit-migrate-dod-*`（DoD 驱动，每轮 `mkdtemp` 新建）与单测自己的 `mkdtemp` 夹具。

- **用法**：`--help` → exit 0；无参数 → exit 1；两者都打印 `Usage: cloudpit migrate-assets --dry-run [--json]` 与 `--rewrite` 行。
- **dry-run 前后目录清单**：`tree identical: true`（`.claude/…`、`.cloudcli/assets/**`、`.cloudpit/assets/conflict.txt`、`.cloudpit/auth.db`、`.config/cloudpit/server.settings.json` 的 sha256 前后逐条相等）；报告 `copied=2 skipped=0 conflicts=["conflict.txt"] rewritten=2 unrewritable=["…/.claude/projects/demo/session.jsonl:2"] backupPaths=[] errors=[]`，exit 3（只因 transcript 引用）。
- **rewrite #1**：`copied=2 skipped=0 conflicts=["conflict.txt"] rewritten=2 unrewritable=["…/session.jsonl:2"] backupPaths=["…/.cloudpit/auth.db.bak-asset-migration-20261103-120000","…/.config/cloudpit/server.settings.json.bak-asset-migration-20261103-120000"] errors=[]`，exit 3；旧根三个文件仍在且字节未变；冲突目标保持 `pre-existing different bytes`。
- **rewrite #2（幂等）**：`copied=0 skipped=2 conflicts=["conflict.txt"] rewritten=0 backupPaths=[] errors=[]`。
- **DB/JSON 改写前后**：settings `"avatarPath": "…/.cloudcli/assets/one.png"` → `"…/.cloudpit/assets/one.png"`；`scheduled_messages.options` 同样由旧根变新根；两个 `.bak-asset-migration-20261103-120000` 备份文件均存在且为改写前字节。
- **失败回滚**（注入写失败；测试里失败店的 JSON 半批已落盘后才抛错）：`rewritten=0 errors=["rewrite: injected write failure (DoD arm)"]`，exit 1；settings 文件与 DB 行逐字未变（`settings unchanged: true`、`db row unchanged: true`），备份仍保留。
- **unrewritable**：逐条列出 `…/.claude/projects/demo/session.jsonl:2`，stderr `[WARN] 1 reference(s) still point at …/.cloudcli/assets; provider transcripts are not rewritten — resolve them by hand.`，exit 3；transcript 字节未改。
- **单测**：`npx tsx --tsconfig server/tsconfig.json --test server/modules/cli/tests/asset-migration.service.test.ts` → 7 pass / 0 fail（覆盖 dry-run、幂等、冲突、失败回滚、unrewritable 五臂；另含用法与备份改写臂）。
- **typecheck / lint**：`npm run typecheck` exit 0；`npm run lint` exit 0（改动文件 oxlint 0 warning / 0 error）。
- **anti-drift**：`anti-drift-touches-check.js --task gap-cloudpit-migrate-assets-rewrite --worktree <wt> --merge-target develop` → `ANTI-DRIFT OK … 12 actual file(s), all within declared Touches (14 glob(s))`，exit 0。
- **docs 章节**：`What the command changes`、`Order of operations`、`Report and exit codes`、`Rollback`、`Precondition for R4`。

## ADR-007 暗轴

- 该轴仍暗,理由:本任务是打包 CLI 的附件复制与路径改写工具及运维文档，不新增架构层边界也不改目标判据，没有可读的轴读数。

## Touches

- server/modules/cli/cli.module.ts
- server/modules/cli/cli.service.ts
- server/modules/cli/asset-migration.service.ts (new)
- server/modules/cli/asset-migration-report.ts (new)
- server/modules/cli/asset-migration-files.ts (new)
- server/modules/cli/asset-migration-store.ts (new)
- server/modules/cli/tests/asset-migration.service.test.ts (new)
- server/modules/cli/tests/cli.service.test.ts
- server/modules/cli/tests/cli-environment-bootstrap.test.ts
- server/shared/image-attachments.ts
- server/shared/tests/quay-test-script.test.ts
- scripts/suite-duration-baseline.tsv
- docs/operations/migrate-assets.md (new)
- tasks/gap-cloudpit-migrate-assets-rewrite.md

# cockpit 知识建议决定交接 — 验证证据

- 任务：`cockpit-knowledge-decision-handoff`
- 日期：2026-11-01
- 分支 / worktree：`/data/home/yale/work/claudecodeui-worktrees/cockpit-knowledge-decision-handoff`
- 依赖状态：`quay-fleet/fleet-knowledge-cockpit-proposals` 仍为 todo；安装的 `quay-fleet` 不声明知识执行器、读口不输出 `knowledge`。契约来源 `docs/specs/knowledge-application-contract.md` 不存在。因此真实能力按 **blocked/unknown** 记录，验证只使用“Fleet 契约兼容”的替身提供方，不假设跨项目能力已可用。

## 实现摘要

- `server/modules/cockpit/cockpit-knowledge-reading.ts`：`knowledge` 块与 `decision`/`plan` 的容错读取；缺 `caseId`/修订号即视为不可读（卡片仍显示，但不可确认）。
- `server/modules/cockpit/cockpit-knowledge-decision.ts`：服务端签发 HMAC 引用；绑定 provider、cardId、revision、caseId、两组修订、factsFingerprint 与 option→decision；调用者自述身份拒绝；派生 feedbackId。
- 投影把提供方的 `knowledge`、`decision`、`plan` 原样透传，`group` 不重写。
- 动作通道：知识卡确认必须带引用；计划缺失 / 证据缺失 / 未声明执行器 / 陈旧修订 / 已接受重复均按稳定错误码拒绝；陈旧绑定会先刷新 provider，再回答当前 revision。
- 反馈 overlay 持久化 `confirmationRef` / `decision` / `knowledgeCaseId`，下次读卡片回读可信链；`verification` 只来自 provider。
- 前端 controller 把卡片上的 `knowledge.confirmationRef` 原样带入确认请求；`REVISION_CONFLICT` 后重新读取；发布 `knowledgeState` / `knowledgeVerificationState` 供场景运行器断言。
- 卡片 UI 增加知识状态行（`data-testid="cockpit-card-knowledge"`，带 `data-knowledge-state` / `data-verification-state`）。

## AC1 — 新判据

```bash
npx tsx --tsconfig server/tsconfig.json --test \
  server/modules/cockpit/tests/cockpit-knowledge-decision-handoff.test.ts
```

结果：**16 passed / 0 failed**（`duration_ms` 1789）。覆盖：

- 投影透传 case、计划、逐选项 decision；信息类卡保持 `notify` 组；畸形 case 块不臆造。
- 服务端签发引用；调用者 `by: "human"` 被拒（`CALLER_ATTESTATION_REJECTED`）且执行器 0 次。
- 缺引用 `MISSING_CONFIRMATION`、伪造引用 `INVALID_CONFIRMATION`、同修订重放证据 `STALE_CONFIRMATION`、陈旧修订 `REVISION_CONFLICT`（provider 刷新计数 1）、计划缺失 `KNOWLEDGE_PLAN_MISSING`、证据缺失 `KNOWLEDGE_EVIDENCE_MISSING`、未声明执行器 `EXECUTOR_NOT_DECLARED`。
- 完整计划随反馈交付；feedbackId 形如 `kf-<32 hex>`；重复确认 `ALREADY_CONFIRMED` 且执行器仅 1 次；重发复用同一 feedbackId 且不重跑动作。
- overlay 回读 `confirmationRef` / `decision` / `knowledgeCaseId`；后续 provider 读数才带 `verifying → reported` 与 verification，overlay 自身不含核验字段。

## AC2 — 既有反馈判据

```bash
npx tsx --tsconfig server/tsconfig.json --test \
  server/modules/cockpit/tests/cockpit-card-feedback.test.ts
```

结果：**19 passed / 0 failed**（含陈旧 revision、重复 feedbackId 的重发幂等、缺失确认身份、未知执行器反例）。前端 controller 判据 `npx vitest run src/modules/cockpit/tests/cockpitCardController.test.ts`：**69 passed / 0 failed**（含新增 5 条知识腿）。

## AC3 — 真实页面操作（无 MCP 浏览器的等价路径）

本会话没有浏览器 MCP（`ToolSearch` 无匹配），按既有约定使用一次性 Playwright 脚本驱动真实页面，所有交互都是真实 DOM 指针事件，未拦截网络、未注入卡片数据：

```bash
node tmp/mcp-evidence/drive-knowledge.mjs \
  http://127.0.0.1:5199 tmp/iso-knowledge/auth-token http://127.0.0.1:3137
```

页面读数（脚本输出）：

```
before  {"state":"pending","verification":null,"text":"待执行"}
decided knowledge:apply    apply          {"state":"verifying","verification":"pending","text":"核验中 running the criterion the criterion is running"}
decided knowledge:modify   modify         {"state":"verifying","verification":"pending", ...}
decided knowledge:defer    defer          {"state":"verifying","verification":"pending", ...}
decided knowledge:na       not-applicable {"state":"verifying","verification":"pending", ...}
after   all four: {"state":"reported","verification":"passed","text":"已核验 criterion finished the criterion exited 0"}
```

截图（`tmp/mcp-evidence/`，已在证据中检查画面内容）：

- `01-four-knowledge-proposals-pending.png` — 四张知识建议卡，状态「待执行」。
- `02-knowledge-apply-apply-verifying.png` — 应用后「核验中 / the criterion is running」，并显示「Sent: apply · waiting for the fleet to confirm receipt」「Handed to the provider」。
- `02-knowledge-modify-modify-verifying.png`、`02-knowledge-defer-defer-verifying.png`、`02-knowledge-na-not-applicable-verifying.png` — 其余三种决定的同一进行中读数。
- `03-all-reported-passed.png`、`04-apply-card-reported-passed.png` — 重新读取后四张卡均「已核验 / the criterion exited 0」。
- `cards-after.json`、`provider-state-after.json`、`page-readings.json` — 页面读数与 provider 状态文件对照。

运行环境：

- 隔离实例：`scripts/isolated-instance.sh start`，端口 `3137`，`SERVER_ENTRY=tmp/iso-entry.cjs`（合并 `cockpit.enabled=true`、`fixtureCards=false`、`fleetCards.enabled=true`、`fleetCards.ttlMs=1`），`QUAY_FLEET_BIN=tmp/fleet-knowledge/quay-fleet`，`FAKE_FLEET_STATE=tmp/fleet-knowledge/state.json`，`residentRestore.enabled=false`。
- 前端：worktree 的 Vite dev（`:5199`，`SERVER_PORT=3137`，`VITE_CACHE_DIR=tmp/vite-cache`），页面代码来自本任务版本。
- 替身提供方仅实现 `cockpit cards --json`、`rescue executors --json`、`rescue exec <id> --params <json> --json`；`verifying → reported` 由读取推进，所以核验结果只可能来自提供方。

## AC4 — 场景运行器

先确定现行参数（`--help` 输出用法，因缺必填参数退出 2；这一步是“确定参数”，不是通过判据）：

```bash
node scripts/ui-scenario.mjs --help
# ui-scenario: a scenario file is required
# usage: node scripts/ui-scenario.mjs <scenario.json> --base-url <url> --auth-token <token> \
#        --project <name> --session <name> [--out <dir>]
```

再运行场景（隔离实例 + Vite dev 代理）：

```bash
node scripts/ui-scenario.mjs scripts/ui-scenarios/cockpit-knowledge-application.json \
  --base-url http://127.0.0.1:5199 \
  --auth-token "$(cat tmp/iso-knowledge/auth-token)" \
  --project claudecodeui --session knowledge-session \
  --out tmp/scenario-knowledge
```

结果：**退出码 0，passed (15 steps, 25602ms, 5 checkpoint(s))**。报告 `tmp/scenario-knowledge/report.json`，步进读数包含：

- 首步 `visibleCardIds = knowledge:apply / modify / defer / na`，四卡 `knowledgeState=pending`。
- 应用确认后 `knowledgeState=verifying`、`knowledgeVerification=pending`。
- 重载后 `knowledgeState=reported`、`knowledgeVerification=passed`。
- 修改 / 推迟 / 不适用三次确认同样读到 `verifying`，最终全部 `reported + passed`。

检查点截图：`step-1-open-cockpit-cards.png`、`step-4-drive-cockpitCard.confirm.png`、`step-5-reload.png`、`step-14-drive-cockpitCard.confirm.png`、`step-15-reload.png`（均在 `tmp/scenario-knowledge/`）。

## 限制与后续

- 真实 `quay-fleet` 知识建议能力未交付（见上）；本任务交付的是 cockpit 侧的契约、可信确认和状态呈现，F10 生产验收需在真实 fleet 能力落地后复核。
- 真实开发者确认属于 F10，不在本任务冒充；本任务中的“确认”由验证脚本代表开发者在隔离实例上完成。
- `verification` 的推进依赖提供方读数；若提供方不提供，卡片稳定显示 `unknown`/无核验，不会由 cockpit 推断。

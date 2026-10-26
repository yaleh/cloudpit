---
id: cockpit-session-ask-brief
title: 驾驶舱卡片简报：卡片浮出时网关单次生成 BriefSpec、宿主检查最多 3 轮、不过回落默认卡，单条 30k 与每日 0.5M token
  上限经 server.settings.json
status: done
labels:
  - feature
  - cockpit
parent: null
children: []
extra:
  schema: execution
depends_on:
  - observation-session-ask-decision-digest
  - cockpit-card-provider-contract-and-registry
goal_ac: AC-427
---
## Proposal

来源：本会话 2026-10-27 简报实验 E2（报告与脚本在主检出 `/data/home/yale/work/claudecodeui/experiments/cockpit-briefing/`，尚未提交，worktree 里按绝对路径读）。结论：网关单次调用 + 宿主检查（最多 3 轮）8/8 通过，p90 16 s，约 1.3 万 token/条；短 Claude Code 会话约 11 倍成本、6/8 通过。用户看过 6 张盲评对照，认为两者「基本都可以接受，差异不大」，确认产品化单次版本。

简报是卡片的内容（ContentResolver 一侧），不是语义：什么时候算「在等你」由 quay-fleet 决定（满 3 分钟才把 ask 投影成卡片）。所以触发点是「一张带 `cloudcli.session-ask` 内容引用的卡片被浮出」，CloudCLI 不自己计时。

做什么：

- `server/modules/cockpit/cockpit-brief-spec.ts`：把实验里的 `brief-check.mjs`（185 行）移植成 TS——BriefSpec v0 的预置形式（radar、compare-table、diffstat、checklist、timeline、graph、callout）、`checkBrief`、`defaultBrief`、`LIMITS`、必带雷达轴 rev 与 evid、按显示宽度计的最短长度（CJK 算 2）、`radarSemantic` 简写展开（实验里修过：CLI 曾漏展开）。按 E2 建议把 checklist 的 `done` 改为可选、默认 false。canvas 两臂都没用过，v0 先不移植 canvas。
- `server/modules/cockpit/cockpit-brief.service.ts`：一个带生命周期的类。输入为卡片的内容引用（sessionId、messageId）与 `observation-session-ask-decision-digest` 产出的决策摘要；读转写尾部，问题以最后一条助手消息为准，不取 digest 的 `askingYou` 摘录（E2 里 2/8 因此问错了问题）。经现有 `llm-gateway` 模块调用网关（模型与网关设置复用回复建议与会话 digest 的做法，不新建通道），提示词带 schema、骨架、一份完整示例（参照实验的 `e2-b1.py`）。宿主检查不过就把错误回给模型，最多 3 轮；仍不过返回 `defaultBrief`，并记录失败规则与原始输出（E2 的 `unparseable-json` 因没留原文而无法分析）。结果按 askId 与 revision 缓存。
- 预算：`server/modules/cockpit/cockpit-brief-settings.ts` 读 server.settings.json 的 `cockpit.brief` 块（`enabled` 默认关、`perBriefTokenCap` 默认 30000、`dailyTokenCap` 默认 500000），用 `server/shared/settings-file.ts` 的块读取器；输入输出 token（含缓存读写）都计入。超单条上限停止并回落默认简报；当日达到上限后新卡片直接回落默认简报，不调用网关。
- 读口：`GET /api/cockpit/cards/:id/brief` 返回简报或默认简报，带 `generated | fallback` 与原因；挂在 `server/modules/cockpit/cockpit.module.ts`。

不做：简报的界面渲染（卡片 Details 里的雷达、对照表等）留给后续界面任务；短 Claude Code 会话版本不上线。

## AC

- [x] `npx tsx --tsconfig server/tsconfig.json --test server/modules/cockpit/tests/cockpit-brief.test.ts` 退出 0（AC-427 判据）：网关客户端桩掉；覆盖首轮通过即缓存（同一 askId 与 revision 第二次请求网关调用数仍为 1）、两轮失败后第 3 轮通过、3 轮都失败回落默认简报并记录失败规则与原始输出、单条上限、每日上限、问题取最后一条助手消息而非 digest 摘录。
- [x] 假形态各自变红：检查失败仍返回模型输出 ⇒ 用例红；允许第 4 次调用网关 ⇒ 用例红；达到每日上限仍调用网关 ⇒ 用例红；把 cache_read 与 cache_creation token 排除在计数外 ⇒ 预算用例红。每个假形态改完即还原。
- [x] `npx tsx --tsconfig server/tsconfig.json --test server/modules/cockpit/tests/cockpit-brief-spec.test.ts` 退出 0：移植实验 `brief-check.test.mjs` 的 18 条用例（canvas 相关的除外，并在完成记录写明除外了哪几条），另加 checklist 缺 `done` 时通过的用例。
- [x] `npx tsx --tsconfig server/tsconfig.json --test server/shared/tests/server-import-cycle-budget.test.ts` 与 `npx tsx --tsconfig server/tsconfig.json --test server/shared/tests/architecture-ratchet.test.ts` 均退出 0。
- [x] `npm run typecheck` 与 `npm run lint` 退出 0（lint 仅既有 warning）。

## DoD

在隔离实例里打开 `cockpit.brief.enabled` 与 `cockpit.fixtureCards`，用 workers 网关的最便宜模型（不打印密钥，网关主机打码）对本机会话库里 3 个以提问结束的真实会话各生成一次简报：贴出每份简报 JSON、检查轮数、耗时与 token 数（含缓存读写），确认问题都对应最后一条助手消息。再把 `dailyTokenCap` 临时设为低于一条的值，请求一张新卡片的简报，贴出 `fallback` 响应与原因，且网关调用数没有增加。实例用毕 `scripts/isolated-instance.sh stop`。

## 实施记录（2026-10-27）

### 落地内容

- BriefSpec v0 按关注点拆成四件：`cockpit-brief-core.ts`（词汇、`displayWidth`、长度/类型读取器）、`cockpit-brief-radar-preset.ts`、`cockpit-brief-presets.ts`（其余六个预置）、`cockpit-brief-spec.ts`（`expandBrief`/`checkBrief`/`defaultBrief`）。实验里 185 行的 `brief-check.mjs` 分成 125 + 233 + 294 + 266 行，避免单文件越过后端标准的约 260 行关注点上限。
- 服务侧同样拆分：`cockpit-brief.service.ts`（生命周期类：缓存、UTC 日账、3 轮循环）、`cockpit-brief-result.ts`（结果/身份/token 求和）、`cockpit-brief-prompt.ts`（系统提示、骨架、完整示例、修复轮、解析）、`cockpit-brief-settings.ts`（`cockpit.brief` 块，默认关、30000、500000）。
- 预算合计把 `input + output + cacheRead + cacheCreation` 一次算进单条与当日两个上限：单条上限在每次调用前与调用后各查一次（调用后超限即停，哪怕答案本可通过），当日上限在循环每次调用前与新卡片进入时各查一次。缓存键 `askId#revision`；生成成功与「3 轮检查都失败」都写缓存，预算/传输类瞬时回落不写缓存。
- 读口 `GET /api/cockpit/cards/:id/brief` 只认 `contentRef.resolver === 'cloudcli.session-ask'`；别的卡片返回 `unsupported-content` 的默认简报，非本模块内容不猜会话。卡片不存在返回 404。
- 问题权威性：服务只把转写的最后一条助手消息作为问题，`ask.context` 只做背景；seam 不读 digest 的 `askingYou`。判据里给 ask 结构上挂一个 `askingYou` 摘录，断言它从不进入提示词。
- 网关用量字段：`llm-protocols.ts` 的 `LlmCompletion` 增加可选的 `cacheReadInputTokens`/`cacheCreationInputTokens`（anthropic 读 `cache_read_input_tokens`/`cache_creation_input_tokens`，openai 两格为 null），文档写明它们只上报、不并入 `inputTokens`；既有测试逐字段断言，不受影响。
- 架构约束：`modules/cockpit` 在 AC-394 下是叶子（不在 `MANIFEST_PIN` 内的新目录不得被兄弟模块导入），所以网关/观察/数据库的读取以注入函数从组合根进入；绑定放在新文件 `server/cockpit-brief-wiring.ts`，避免把已超限的 `server/index.ts`（基线 2769 行）再加长——首版内联接线把该文件顶到 2821 行，ratchet 直接红，抽出后恢复 2769 行、`typecheck`/`build:server` 均绿。

### AC 复验读数（worktree `cockpit-session-ask-brief`，逐条原命令）

- AC1：`cockpit-brief.test.ts` ⇒ `tests 6 / pass 6 / fail 0`，退出 0。
- AC3：`cockpit-brief-spec.test.ts` ⇒ `tests 16 / pass 16 / fail 0`，退出 0。移植 15 条实验用例；**除外的 3 条 canvas 用例逐字为**：「canvas: a clean temporary form passes」「canvas: script, handler, external url and bad elements are rejected」「canvas without alt/rationale is rejected」（v0 不上 canvas，E2 两臂也从未产出）。另加 1 条「checklist 缺 `done` 通过且 builder 默认 false」。
- AC4：`server-import-cycle-budget.test.ts` ⇒ `pass 11 / fail 0`，退出 0；`architecture-ratchet.test.ts` ⇒ `pass 6 / fail 0`，退出 0。
- AC5：`npm run typecheck` 退出 0（三个 tsc 工程）；`npm run lint` 退出 0，仅既有 warning（`grep cockpit-brief|brief-wiring|llm-protocols` 在 lint 输出里零命中）。
- 收集数钉子：两个新测试文件使 `scripts/test.sh` 收集的 server 测试文件从 453 变 455，`quay-test-script.test.ts` 的 AC2/AC3 钉改为 `unknown=452`/`unknown=454`（注释同步写明 453 + 2 = 455）；`scripts/suite-duration-baseline.tsv` 追加两行实测（2618ms/2536ms），90% 覆盖地板复绿（`pass 14 / fail 0`）。

### 假形态（每条改完即还原，还原后 AC1 复跑 6/6 绿）

1. 检查失败仍返回模型输出：把 `if (checked.ok && expanded !== null)` 改成 `if (expanded !== null)` ⇒ 「两轮失败后第 3 轮通过」与「3 轮都失败回落」两条红，退出 1。
2. 允许第 4 次调用网关：`while (rounds < MAX_ITERATIONS)` → `<=` ⇒ 「3 轮都失败回落」红（第 4 次调用让桩抛「unexpected gateway call」，结果变成 `model-call-failed`），退出 1。
3. 达到每日上限仍调用网关：把循环前与循环内的两道 `dayTokens >= dailyTokenCap` 判断都短路 ⇒ 「每日上限后新卡片不调用网关」红（第二张卡片真的打到网关），退出 1。
4. 把 cache_read / cache_creation 排除在计数外：`addTokens` 的 `spent` 改为 `input + output` ⇒ 「单条上限把缓存读算进去」红（110 → 50，不再回落），退出 1。

### 隔离实例 DoD（真实网关，4 个真实会话）

实例：`scripts/isolated-instance.sh start`（state 目录在 worktree 的 `tmp/dod-brief-instance`，源库 `~/.cloudcli/auth.db` 的副本，residentRestore off、scope sweep off），设置文件同时打开 `cockpit.enabled`、`cockpit.fixtureCards`、`cockpit.brief`（`enabled:true`、单条 30000、每日 500000）。网关沿用本机回复建议的 workers 网关设置（`protocol=anthropic`、`baseUrl=http://<已打码>/`、`model=v4.1flash`、`disableThinking=true`；密钥只从 `apiKeyFile` 读，未打印），另用一份临时设置副本把 `maxOutputTokens` 提到 2000、`timeoutMs` 到 120000（回复建议的默认 400 对整份 BriefSpec 太小）。

**诚实说明（临时工装，均已还原并从 `dist-server` 重建）**：当前树里还没有把真实会话投影成卡片的提供方（唯一已接线的提供方是夹具），所以 4 张卡片由一份临时、未提交的提供方给出（读 4 个真实 sessionId/messageId 的 `contentRef`，跑完删除、`server/index.ts` 与 `scripts/isolated-instance.sh` 从备份恢复、`dist-server` 重建后不再含它）；「网关调用数」由临时挂在 `complete` seam 上的调用流水记录（文件行数），同样已还原。除这两处工装外，卡片读取、转写读取、问题判定、预算与网关调用都是 shipped 代码。

三份简报（均为 `status: generated`，网关调用流水 5 行 = 1 + 2 + 2 轮）：

**dod:1** — 会话 `700a2850-d316-4960-af0f-20f7f43d6cf1`；`rounds=1`、`durationMs=5114`、`tokens={input:3105, output:1050, cacheRead:0, cacheCreation:0, total:4155}`、`cached:false`、`failures:[]`：

```json
{"v":0,"itemRef":"cloudcli://session/700a2850-d316-4960-af0f-20f7f43d6cf1#1e595b58-85c2-4fcb-ac70-feb299624ae8","headline":"登录后先检查哪个界面：聊天视图、某个会话，还是 WebSocket？","options":[{"id":"chat","label":"聊天视图","does":"打开聊天视图，确认消息能正常加载、发送与渲染，验证前端主流程是否可用","consequence":[{"kind":"reversible","text":"只是浏览，随时可切换"},{"kind":"no-effect","text":"不改变服务端状态"}],"evidenceRefs":["e1"]},{"id":"session","label":"某个具体会话","does":"打开一个已有会话（如 archguard 或 claudecodeui 下的会话），检查历史消息与工具调用是否完整","consequence":[{"kind":"reversible","text":"只读查看，可随时退出"},{"kind":"costs","text":"需要先选定一个会话，耗时略多"}],"evidenceRefs":["e1"]},{"id":"ws","label":"WebSocket","does":"检查 WebSocket 连接是否建立、有无断线重连或鉴权失败，确认实时通道正常","consequence":[{"kind":"reversible","text":"观察连接状态，不影响数据"},{"kind":"blocks","text":"若 WS 异常，后续实时功能都不可用"}],"evidenceRefs":["e1"]},{"id":"rotate","label":"先轮换 token","does":"在继续检查前先作废并重新签发 token，避免明文 token 留在会话历史中","consequence":[{"kind":"irreversible","text":"旧 token 作废后无法恢复"},{"kind":"blocks","text":"轮换后需重新注入浏览器才能继续检查"}],"evidenceRefs":["e1"]}],"recommendation":{"optionId":"ws","why":["登录已确认可用，剩余风险集中在实时通道而非页面渲染","WebSocket 若鉴权失败，聊天与会话视图都会表现为空或卡住，先排除它最省事"]},"evidence":[{"id":"e1","label":"助手报告 token 在 localhost:3001 与公网 URL 上 GET /api/auth/user 均返回 200，浏览器已显示项目列表","mechanical":false}],"blocks":[{"id":"radar-rev-evid-cover-risk","type":"radar","title":"检查路径对比","axes":[{"id":"rev","label":"可逆性","definition":"操作能否无损撤销；高表示只是查看、随时可退出，低表示会产生不可恢复的副作用","basis":"llm"},{"id":"evid","label":"证据强度","definition":"该路径的结论有多少实测支撑；高表示有明确接口返回或日志，低表示只能靠推断","basis":"llm"},{"id":"cover","label":"覆盖范围","definition":"一次检查能顺带验证多少功能面；高表示能连带确认多个模块，低表示只覆盖单点","basis":"llm"},{"id":"risk","label":"风险暴露","definition":"该路径可能暴露的问题严重程度；高表示一旦失败影响核心功能，低表示影响局部","basis":"llm"}],"series":[{"optionId":"chat","values":{"rev":95,"evid":55,"cover":60,"risk":50}},{"optionId":"session","values":{"rev":95,"evid":55,"cover":50,"risk":40}},{"optionId":"ws","values":{"rev":95,"evid":50,"cover":80,"risk":75}},{"optionId":"rotate","values":{"rev":20,"evid":60,"cover":20,"risk":60}}]}]}
```

**dod:2** — 会话 `e7aa9eec-ec8f-477b-b315-e58abe98b446`（DB 的 `jsonl_path` 指向 `a78977a4-….jsonl`）；`rounds=2`、`durationMs=11244`、`tokens={input:4259, output:2938, cacheRead:2816, cacheCreation:0, total:10013}`、`cached:false`。第 1 轮宿主检查失败（`timeline-events`、`table-row-label`/`table-cell` ×9、`unknown-option` ×2），把错误与原文回给模型后第 2 轮通过：

```json
{"v":0,"itemRef":"cloudcli://session/e7aa9eec-ec8f-477b-b315-e58abe98b446#87b59d9b-f7b6-4b40-a1bb-5f11fc93cd78","headline":"继续盯下一轮 fan-in 确认转绿，还是就此收手？","options":[{"id":"watch","label":"继续盯下一轮 fan-in","does":"保持监控，等 promotion-driver 晋升 8 个 todo、worker-driver 派发后，观察下一轮 fan-in 的 suite 是否在修好的 test.sh 上判绿并 ff 落地，再回报结果","consequence":[{"kind":"costs","text":"需要再等一轮 fan-in 周期（约数分钟到十几分钟）"},{"kind":"reversible","text":"随时可以停止监控，不影响已落地的修复"},{"kind":"blocks","text":"在确认前不会把这一轮视为收尾"}],"evidenceRefs":["e1","e2"]},{"id":"stop","label":"到此收手","does":"结束本轮推进，不再主动监控；把后续交给 promotion-driver 与 worker-driver 自动链，等下次需要时再检查","consequence":[{"kind":"reversible","text":"之后仍可随时重新检查计数与 fan-in 结果"},{"kind":"no-effect","text":"不改变已落地的 watchdog 修复与 needs-human 归零"},{"kind":"costs","text":"若下一轮 fan-in 仍判红，发现会延迟"}],"evidenceRefs":["e1"]},{"id":"spot-check","label":"只做一次快速抽查","does":"不持续盯，只在下一次检查点看一次 needs-human 计数与 ready 池派发情况，若异常再决定是否深入","consequence":[{"kind":"costs","text":"一次抽查，成本低于持续监控"},{"kind":"reversible","text":"抽查后可随时升级为持续监控"},{"kind":"blocks","text":"抽查间隔内的失败不会被立即发现"}],"evidenceRefs":["e1","e2"]}],"recommendation":{"optionId":"watch","why":["三个根因刚修到 develop，下一轮 fan-in 是第一次真实验证，值得确认转绿","若仍判红，早发现能避免 8 个 todo 再次被打回 needs-human"]},"evidence":[{"id":"e1","label":"助手报告 watchdog 修复已于 07:11:56 落地 develop 的 scripts/test.sh","mechanical":false},{"id":"e2","label":"助手报告的最终计数：needs-human 0、todo 8、ready 1、done 1084","mechanical":false}],"blocks":[{"id":"next-chain","type":"timeline","title":"接下来的自动链","events":[{"at":"2026-10-27T07:12:00Z","label":"promotion-driver 把 8 个 todo 机械晋升 ready（~1 分钟）","state":"neutral"},{"at":"2026-10-27T07:13:00Z","label":"worker-driver 从 ready 池派发","state":"neutral"},{"at":"2026-10-27T07:20:00Z","label":"各 fan-in 的 suite 跑在修好的 test.sh 上，watchdog 不再留 sleep 2","state":"neutral"},{"at":"2026-10-27T07:30:00Z","label":"预期判绿并 ff 落地","state":"ok"}]},{"id":"roots-fixed","type":"checklist","title":"已修到 develop 的三个根因","items":[{"text":"--list-files 探针","done":true},{"text":"live-voice/S2 env 泄漏","done":true},{"text":"watchdog sleep 2 泄漏","done":true}]},{"id":"counts","type":"compare-table","title":"当前计数","columns":["watch","stop","spot-check"],"rows":[{"label":"needs-human","cells":{"watch":"0","stop":"0","spot-check":"0"}},{"label":"todo","cells":{"watch":"8","stop":"8","spot-check":"8"}},{"label":"ready","cells":{"watch":"1","stop":"1","spot-check":"1"}},{"label":"done","cells":{"watch":"1084","stop":"1084","spot-check":"1084"}}]},{"id":"radar-rev-evid-cost-catch","type":"radar","title":"后果对比","axes":[{"id":"rev","label":"可逆性","definition":"越高表示选择后越容易无损撤回，越低表示一旦执行就难以回头","basis":"llm"},{"id":"evid","label":"证据强度","definition":"越高表示结论被实测命令或文件内容支持，越低表示仅凭模型推断","basis":"llm"},{"id":"cost","label":"时间成本","definition":"越高表示需要投入的等待与检查时间越多，越低表示几乎不占额外时间","basis":"llm"},{"id":"catch","label":"早发现能力","definition":"越高表示越能在失败扩散前发现下一轮 fan-in 判红，越低表示发现越滞后","basis":"llm"}],"series":[{"optionId":"watch","values":{"rev":90,"evid":55,"cost":70,"catch":95}},{"optionId":"stop","values":{"rev":90,"evid":55,"cost":5,"catch":20}},{"optionId":"spot-check","values":{"rev":90,"evid":55,"cost":30,"catch":55}}]}]}
```

**dod:3** — 会话 `e8e04efa-538b-4053-89d5-f6da7df19c5b`（`jsonl_path` 指向 `a007259f-….jsonl`）；`rounds=2`、`durationMs=9848`、`tokens={input:4589, output:2414, cacheRead:2816, cacheCreation:0, total:9819}`、`cached:false`。第 1 轮 `timeline-events` 失败，第 2 轮通过：

```json
{"v":0,"itemRef":"cloudcli://session/e8e04efa-538b-4053-89d5-f6da7df19c5b#d3fba023-c9a5-4250-83d7-2800c0bd8164","headline":"重进 Live Voice 验证后，要不要我盯服务端日志确认 ack/小结？","options":[{"id":"watch-logs","label":"你重进，我盯日志","does":"你重进 Live Voice 连发几条短消息，我在服务端日志里核对 queued → idle 那轮的 run-end-ack / run-end-summary 是否出现，并回报结果","consequence":[{"kind":"reversible","text":"只读日志，不改任何状态"},{"kind":"costs","text":"需要你配合发几条短消息"}],"evidenceRefs":["e1","e2"]},{"id":"self-test","label":"你自己试，先不盯","does":"你重进后自行连发短消息听 ack 与小结，有问题再回来找我查日志","consequence":[{"kind":"no-effect","text":"不占用额外时间，但漏了要二次排查"}],"evidenceRefs":["e1"]},{"id":"rollback","label":"先回滚到旧 dist","does":"把服务切回修复前的产物，等验证计划更完整再上线","consequence":[{"kind":"blocks","text":"queued → idle 漏小结的问题会重新出现"},{"kind":"costs","text":"需要再重启一次，断开当前连接"}],"evidenceRefs":["e2"]}],"recommendation":{"optionId":"watch-logs","why":["修复刚上线，日志是唯一能确认 queued → idle 真的走到 deferAck 分支的实测证据","只读日志、零副作用，且能立刻定位是否还有漏"]},"evidence":[{"id":"e1","label":"新 dist 中 deferAck 命中 4 次（build 于 12:40:55 完成）","mechanical":true,"ref":"grep -c deferAck dist-server/server/modules/voice-realtime/voice-realtime-ws-proxy.service.js","observedAt":"2026-10-27T04:41:08Z"},{"id":"e2","label":"服务 active (running)，新 MainPID 2610222，启动 12:41:08 CST","mechanical":true,"ref":"systemctl --user status claudecodeui-server","observedAt":"2026-10-27T04:41:08Z"}],"blocks":[{"id":"verify-checklist","type":"checklist","title":"重进后的验证步骤","items":[{"text":"重进 Live Voice，确认连接建立"},{"text":"连发三条短消息（一句 / 再一句 / 第三句）"},{"text":"确认听到 ack「好的」+ 小结"},{"text":"我在日志里核对 run-end-ack / run-end-summary 出现"}]},{"id":"timeline","type":"timeline","title":"上线时间线","events":[{"at":"2026-10-27T04:40:55Z","label":"build:server 完成，新 dist 就位","state":"ok"},{"at":"2026-10-27T04:41:08Z","label":"server 重启，加载新 dist","state":"ok"},{"at":"2026-10-27T04:41:08Z","label":"等待重进 Live Voice 验证","state":"neutral"}]},{"id":"radar-rev-evid-risk","type":"radar","title":"后果对比","axes":[{"id":"rev","label":"可逆性","definition":"撤销该选项的代价，越高越容易恢复原状","basis":"llm"},{"id":"evid","label":"证据强度","definition":"该选项能产出多少实测证据，越高越能确认修复生效","basis":"mechanical","evidenceRefs":["e1","e2"]},{"id":"risk","label":"回归风险","definition":"该选项让漏小结问题重新出现的可能性，越高越危险","basis":"llm"}],"series":[{"optionId":"watch-logs","values":{"rev":95,"evid":90,"risk":5}},{"optionId":"self-test","values":{"rev":95,"evid":40,"risk":30}},{"optionId":"rollback","values":{"rev":60,"evid":20,"risk":90}}]}]}
```

问题对应最后一条助手消息（用同一 `readSessionAsk` 独立读库逐条比对，三项均为 `true`）：`messageId` 相同、`askId` 相同、`question === ask.current.assistantText`；三条问题分别以「…or the WebSocket?」「…还是到这里收手？」「…是否出现吗？」结尾。

缓存：同一 `dod:1` 再请求一次 ⇒ `cached:true`、`durationMs=5`、`HTTP 200 in 0.0054s`，简报内容逐字相同，网关调用流水仍 5 行。

每日上限：把实例设置文件的 `dailyTokenCap` 改为 1（低于任一条的 4155/10013/9819），请求未用过的 `dod:4` ⇒ `status:"fallback"`、`reason:"daily-token-cap-reached"`、`rounds:0`、`durationMs:6`、`tokens` 五个字段全 0、`fallback:true`、`options:[]`、`blocks:[]`；网关调用流水仍 5 行（没有新增调用）。完整回落响应如下（`brief` 为 `defaultBrief`，headline 取该会话最后一条助手消息）：

```json
{"cardId":"dod:4","sessionId":"5b80cdd3-0058-4458-b88e-1f03e6f6fc14","askId":"5b80cdd3-0058-4458-b88e-1f03e6f6fc14:1f374469-d942-4ab2-8aa4-dcf18c4b23de","revision":1,"messageId":"1f374469-d942-4ab2-8aa4-dcf18c4b23de","status":"fallback","reason":"daily-token-cap-reached","cached":false,"question":"<该会话最后一条助手消息，与 readSessionAsk 逐字相同>","rounds":0,"failures":[],"tokens":{"input":0,"output":0,"cacheRead":0,"cacheCreation":0,"total":0},"durationMs":6,"brief":{"v":0,"itemRef":"cloudcli://session/5b80cdd3-0058-4458-b88e-1f03e6f6fc14#1f374469-d942-4ab2-8aa4-dcf18c4b23de","headline":"<该会话最后一条助手消息，已按 LIMITS.headline 截断>","fallback":true,"options":[],"blocks":[],"evidence":[]}}
```

（上面这份回落响应里 `question`/`headline` 的原文是会话内容，遵 DoD 只贴读数与结构；`question` 与库中最后一条助手消息逐字相同。`scripts/isolated-instance.sh stop` ⇒ `{"stopped_scopes":"","port_still_serving":false,"ok":true}`，随后 `status` ⇒ `running:false`、`healthy:false`；state 目录已删除。）

缓存读写读数：`cacheRead` 在 dod:2/dod:3 各 2816，证明缓存读计入了总数（10013 = 4259 + 2938 + 2816；9819 = 4589 + 2414 + 2816）；`cacheCreation` 三次都是 0，因为该 workers 网关的响应没有上报 `cache_creation_input_tokens`（解析器按可缺省处理，不写 NaN）。

## ADR-007 轴记录

- 该轴仍暗,理由:本任务只新增卡片简报的生成、宿主检查与预算读口，不改变决策轴的立项/晋升数据，L_D 与 L_G 没有可读数值；验证由 AC 判据与隔离实例真实网关读数覆盖。

## Touches

- tasks/cockpit-session-ask-brief.md
- server/index.ts
- server/cockpit-brief-wiring.ts (new)
- server/modules/llm-gateway/llm-protocols.ts
- server/modules/cockpit/cockpit.module.ts
- server/modules/cockpit/index.ts
- server/modules/cockpit/cockpit-brief-core.ts (new)
- server/modules/cockpit/cockpit-brief-presets.ts (new)
- server/modules/cockpit/cockpit-brief-prompt.ts (new)
- server/modules/cockpit/cockpit-brief-radar-preset.ts (new)
- server/modules/cockpit/cockpit-brief-result.ts (new)
- server/modules/cockpit/cockpit-brief-settings.ts (new)
- server/modules/cockpit/cockpit-brief-spec.ts (new)
- server/modules/cockpit/cockpit-brief.service.ts (new)
- server/modules/cockpit/tests/cockpit-brief.test.ts (new)
- server/modules/cockpit/tests/cockpit-brief-spec.test.ts (new)
- server/shared/tests/quay-test-script.test.ts
- scripts/suite-duration-baseline.tsv

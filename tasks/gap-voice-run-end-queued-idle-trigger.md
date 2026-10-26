---
id: gap-voice-run-end-queued-idle-trigger
title: run-end 小结/ack 只在 running→idle 触发：queued→idle（连发短消息时排队消息被消化）漏发；放宽为任意非
  idle→idle，ack 单独 gate 在真实工作产出上
status: ready
labels:
  - gap
  - voice
  - defect
parent: null
children: []
extra:
  schema: execution
---
## Proposal

**现象（实机 2026-10-26）**：Live Voice 连发多条短消息（「那我切回」「刚才出问题的环境切回…」「对啊」）时，run-end 小结和 ack 整轮不出现。服务端相位序列：`running(seq=3) → queued(seq=5,7,8) → idle(seq=9)`——最后一步是 `queued → idle`，而触发条件只认 `running → idle`，所以 ack/summary 都没发。对照单轮场景（`running(seq=12) → idle(seq=13)`）则正常发声。

**根因**（`server/modules/voice-realtime/voice-realtime-ws-proxy.service.ts` 的 `noteStatus`，约 1724 行）：触发条件是 `beforePhase === 'running' && execStatus.reading().phase === 'idle'`。当 `session_send` 返回 `queued:true`（忙时 hold / coalescing 窗口，见 `deliverSessionSend` 约 2879 行 `phase: queuedResult ? 'queued' : 'running'`）时相位是 `queued`；排队消息随后被消化、直接到 `idle`，中间没有一次 `running` 观测（宿主状态轮询 `pollRunEnd` 错过，或 run 太短），于是 `queued → idle` 不满足触发条件。

**修法**：把触发放宽为「任意非 idle → idle」：`beforePhase !== 'idle' && execStatus.reading().phase === 'idle'`。但 ack 不能对 `queued → idle` 无脑发——排队消息可能被 coalescing 合并/丢弃、根本没产生 run，此时说「好的」是假确认。因此语义定为：

- `running → idle`：ack 仍在 transition 立即发（`running` 本身就是「有真实工作」的证据），summary 随后——现状不变。
- `queued → idle`：ack **不**立即发，**推迟到 run_output 回执确认非空输出后**再发（与 summary 同一条队列、ack 在 summary 前）；空输出 / 页面不回答 ⇒ 不发 ack、也不发 summary。
- `running → queued`：仍不触发（follow-up supersede，维持现状）。

「真实工作」的判据复用现有 `run_output` 回执：非空 `output` = 有产出 = 有真实工作；空串 / 无回执 = 无。实现上 `speakRunEndAck` 在 `queued → idle` 路径延后到 `summarizeRunOutput` 判定 `source.trim() !== ''` 之后调用，且用 transition 时捕获的 runId（现有 `scheduleRunEndSummary`/`requestRunOutput` 已捕获 runId/generation，可复用）。

## AC

- [x] AC1（红先行）：在 `server/modules/voice-realtime/tests/voice-realtime-run-end-summary.test.ts` 新增用例 `queued → idle with a non-empty run_output speaks the ack then the summary`：驱动 session_send 返回 `queued:true`（phase=queued）→ `pollRunEnd` 观测到 idle → 页面以非空 run_output 回答；断言 ack 与 summary 各恰好一次、ack 在 summary 之前。当前树上该用例**红**（`queued → idle` 现在不触发）：`npx tsx --tsconfig server/tsconfig.json --import ./scripts/undici-blocked-ports-preload.mjs --test server/modules/voice-realtime/tests/voice-realtime-run-end-summary.test.ts` 以非零退出。（原 AC 写的 `npx vitest run <该文件>` 在本仓无法运行 server 测试：vitest include 仅 `src/**`，实测 `No test files found` 且 exit 1；已改为 docs/operations/process-isolation-and-memory-caps.md 的单文件跑法，判据意图不变。）
- [x] AC2：修好后 AC1 同一用例转绿，`npx tsx --tsconfig server/tsconfig.json --import ./scripts/undici-blocked-ports-preload.mjs --test server/modules/voice-realtime/tests/voice-realtime-run-end-summary.test.ts` exit 0。
- [x] AC3（ack gate，空输出）：新增用例 `queued → idle with an empty run_output speaks nothing`：同上驱动，页面回答空串；断言**不** speak ack、**不** inject summary；日志有明确跳过行。
- [x] AC4（ack gate，无回执）：新增用例 `queued → idle with a page that never answers speaks nothing`：同上驱动，页面不回答（等满 `runEndOutputWaitMs` 超时）；断言不 speak ack、不 inject summary。
- [x] AC5（running→idle 不回退）：既有 `running → idle` 用例保持绿，且「empty / null / 被 quality gate 拒绝时 ack 仍 speak」的既有用例（`per-run output (c)`、`per-run output (d)`、`a null summary answer still speaks the ack`、`a summary refused by the quality gate still speaks the ack`）语义不变、exit 0。
- [x] AC6（supersede 不回退）：既有 `running → queued` 不触发、新 run bump `runEndGeneration` 使迟到 summary 被丢弃的语义不变；`per-run output (b)`（两次 run 两次 summary）仍绿。
- [x] AC7（静态/回归）：`npm run typecheck` exit 0；`npx oxlint server/modules/voice-realtime/voice-realtime-ws-proxy.service.ts server/modules/voice-realtime/tests/voice-realtime-run-end-summary.test.ts` exit 0；该测试文件全部用例 exit 0。

## DoD

- [x] AC1 先红后绿（贴红时判词与绿后结果）；AC2–AC7 全绿。
- [x] 回归：`npx tsx --tsconfig server/tsconfig.json --import ./scripts/undici-blocked-ports-preload.mjs --test server/modules/voice-realtime/tests/voice-realtime-run-end-summary.test.ts` 全绿（新增 + 既有）；兄弟测试 `server/modules/voice-realtime/tests/voice-realtime-ws-proxy.real-transport.test.ts` 与 `server/modules/voice-realtime/tests/voice-realtime-caption-item-attribution.test.ts` 不因本改动红。
- [x] `npm run typecheck` exit 0；被改文件的 `npx oxlint` exit 0。
- [x] 不跑全套（backend 改动，按 process-isolation 规则只跑该文件与兄弟回归）；`git diff --stat` 只出现 ## Touches 声明的文件。

## Evidence

- **AC1 红（修前，先把触发条件临时还原为 `beforePhase === 'running'` 再跑同一文件）**：`✖ queued → idle with a non-empty run_output speaks the ack then the summary`，`AssertionError: the non-empty answer is summarized exactly once / 0 !== 1`；同轮两条空输出/无回执用例也红（无 skip 日志），进程 `EXIT=1`。
- **AC2–AC7（修后）**：`npx tsx --tsconfig server/tsconfig.json --import ./scripts/undici-blocked-ports-preload.mjs --test server/modules/voice-realtime/tests/voice-realtime-run-end-summary.test.ts` → `tests 22 / pass 22 / fail 0`，`EXIT=0`。
- **兄弟回归**：`voice-realtime-ws-proxy.real-transport.test.ts` + `voice-realtime-caption-item-attribution.test.ts` → `tests 26 / pass 26 / fail 0`，`EXIT=0`。
- **静态**：`npm run typecheck` `EXIT=0`；`npx oxlint`（两个被改文件）`EXIT=0`。

## Touches

- server/modules/voice-realtime/voice-realtime-ws-proxy.service.ts
- server/modules/voice-realtime/tests/voice-realtime-run-end-summary.test.ts
- tasks/gap-voice-run-end-queued-idle-trigger.md

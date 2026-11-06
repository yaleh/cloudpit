---
id: gap-voice-transient-upstream-failure-retry
title: 语音一次上游 502 即丢整段话：客户端把瞬时 502/503/504（UPSTREAM_UNAVAILABLE）当成 definitive
  refusal 记住，pipeline 的两次重试只空转不上传；改为可重试分类 + 四类网络适配器对纯传输失败各重试一次（2026-11-06 12.12s
  真语音只剩 1 条 capture 行）
status: todo
labels:
  - gap
  - defect
parent: null
children: []
extra:
  schema: execution
---
## Proposal

### 现象（2026-11-06 14:25 CST 的实测）

今天只有两次语音输入，均失败，没有一次成功转写：

- `audio-16741o3rwu-1`：0.60 s / 19,244 B，mean −72.8 dB、max −50.3 dB，静音；上游 200，模型判无可辨识语音、content 为空；adapter 将空文本映射为 `NO_SPEECH_DETECTED`，服务端答 422。**该分类正确，不是本任务的对象。**
- `audio-16741o3rwu-2`：12.12 s / 387,884 B，mean −24.1 dB、max 0 dB，真实说话；请求在 1.02 s 时抛传输异常，记录 `upstream: null`、`branch=upstream-failure`，对外 502。对应日志：`voice.transcribe providerId=dashscope-omni-relay outcome=fail status=502 latencyMs=1022 captureId=audio-16741o3rwu-2`。
- 关键读数：这一次 listen 只有 **1 条** `voice.transcribe` / capture 行。客户端明明有两次重试预算，却没有换来第二次上传。

### 机制一（客户端）：瞬时拒绝被当成 definitive，重试空转

- `src/modules/chat-voice/hooks/useVoiceInput.ts:965-969` 对**任何** `!response.ok` 都先 `session.refusals.set(job.index, refusal)` 再抛。
- `src/modules/chat-voice/hooks/useVoiceInput.ts:1095-1097` 下一次重试进来先查 `session.refusals`，命中就直接重抛，不再发请求。
- `runSegmentPipeline` 的 `maxRetries: 2`（`SEGMENT_MAX_RETRIES`，250 ms → 500 ms 退避）因此只对“抛异常且没有写进 refusals”的失败有效；服务端把上游失败包成 502 响应后，客户端把它当成了 definitive。
- 结果：一次 502 丢整段话；`attempts` 遥测还会记成 3，而真实上传是 1。

### 机制二（服务端）：出网失败只试一次

- `shared/asr/list/dashscope-omni-relay/dashscope-omni-relay.asr-provider.ts:315-330` 只调用一次 `fetchImpl`，catch 后直接返回 `UPSTREAM_UNAVAILABLE`；`server/modules/voice/voice.service.ts` 与 route 层都没有重试。
- 四个网络适配器（openai-compatible、multimodal、dashscope-omni、dashscope-omni-relay）都是这个形状，缺陷属于同一机制而不是单个 provider。

### 本任务要做什么

1. **客户端：把“记住拒绝”和“是否短路重试”拆开。** `session.refusals` 继续保存最后一次失败供提示使用；在 `CaptureSession` 上新增一个 session-local 的 ordinal 集合，只标记 **definitive** 拒绝。分类规则：`code === 'UPSTREAM_UNAVAILABLE'`，或 `status ∈ {502, 503, 504}` ⇒ 可重试（不加入 definitive 集合，让已有的 pipeline 真正重发）；`NO_SPEECH_DETECTED`、413/415/422、其余 4xx ⇒ definitive（保持一次上传）。⛔ 不改 `SEGMENT_MAX_RETRIES` 与退避；⛔ 不往 `src/shared/types.ts` 的 `VoiceTranscriptionFailure` 加字段（用 session-local 集合，避免共享形状变宽打红兄弟 pin）。
2. **服务端：在 `shared/asr/transcriptionWire.ts` 增加 `fetchWithTransportRetry(fetchImpl, url, init, retries = 1)`。** 行为：只对**非 AbortError** 的 fetch 抛错重试一次；`init.signal` 已 abort 或 `error.name === 'AbortError'` 不重试；任何已拿到 HTTP 响应的失败（401/403/429/5xx 等）不重试；两次都失败时抛最后一个错误。四个网络适配器都改用该 helper。⛔ 不新建 `shared/asr` 模块文件：`scripts/asr-*-check.test.mjs` 的 `SHIPPING_FILES` 是钉死的，新文件会让 fixture 加载失败。⛔ 不放进 `shared/asr/asrContract.ts`：该文件 develop 上已 786 行，越过 800 行会红 `server/shared/tests/architecture-ratchet.test.ts` 的 oversize 硬线；`transcriptionWire.ts` 在全部 fixture 清单里且只有 312 行。
3. **记录面保持不变。** 重试发生在 adapter 内部，`voice.service.ts` 仍是一次逻辑调用，因此仍是一条 `voice.transcribe` 行 / 一条 capture 行；两次都失败时 `upstream: null` 的语义不变。不要为每次重试新增 capture 行。

### 非目标

- 不重试 AbortError / 超时（300 s 上限不能被放大成 600 s）；不重试任何已经拿到 HTTP 响应的失败。
- 不改错误码表、状态码、用户文案、`NO_SPEECH_DETECTED` 语义；不改客户端设备识别器的 fallback 逻辑。
- 不改 `SEGMENT_MAX_RETRIES` / 退避。
- 不新增 `server/**/*.test.ts`（避免 `server/shared/tests/quay-test-script.test.ts` 的两条文件数 pin 与 `scripts/suite-duration-baseline.tsv` 的覆盖率地板；若确需新增，必须同时更新并声明这两个文件）。
- 不改 `src/shared/types.ts` 的共享失败形状。

### 测试与验证面

- 新增 `src/modules/chat/tests/voiceTransientRefusalRetry.test.tsx`：真实 `ChatComposer` + `createFakeVoiceCapture`，只 double `transcribeVoice`。三条读数：
  - 502 `UPSTREAM_UNAVAILABLE` 两次、第三次 200 ⇒ `transcribeVoice` 被调用 **3** 次，文本进入 composer。
  - 422 `NO_SPEECH_DETECTED` ⇒ 被调用 **1** 次。
  - 502 持续 ⇒ 被调用 **3** 次，失败提示带 502 / `UPSTREAM_UNAVAILABLE`。
- 扩展 `server/modules/voice/tests/voice-provider-dispatch.test.ts`：经真实 service + 真实 relay adapter，transport double 先 reject 一次再返回 chat answer ⇒ fetch 2 次、`ok:true`；一直 reject ⇒ 2 次、`UPSTREAM_UNAVAILABLE`；AbortError ⇒ 1 次；HTTP 500 ⇒ 1 次。
- Ratchet：`useVoiceInput.ts` 的 oversize 基线是 1609 行。优先在同文件等量压缩注释使 `wc -l` ≤ 1609；若必须增长，按 RECORDED CHANGE 在 `server/shared/tests/architecture-ratchet.baseline.json` 的 note 追加一段并把该条数值改到实测，且该 JSON 已在 Touches 中声明。
- 类型检查：`npm run typecheck`。

## Touches

- tasks/gap-voice-transient-upstream-failure-retry.md
- src/modules/chat-voice/hooks/useVoiceInput.ts
- src/modules/chat/tests/voiceTransientRefusalRetry.test.tsx (new)
- shared/asr/transcriptionWire.ts
- shared/asr/list/openai-compatible/openai-compatible.asr-provider.ts
- shared/asr/list/dashscope-omni-relay/dashscope-omni-relay.asr-provider.ts
- shared/asr/list/dashscope-omni/dashscope-omni.asr-provider.ts
- shared/asr/list/multimodal/multimodal.asr-provider.ts
- server/modules/voice/tests/voice-provider-dispatch.test.ts
- server/shared/tests/architecture-ratchet.baseline.json

## AC

- [ ] AC1 客户端瞬时重试：`npx vitest run src/modules/chat/tests/voiceTransientRefusalRetry.test.tsx` exit 0；完成记录逐字给出三条读数——502 两次后第三次成功 ⇒ `transcribeVoice` 3 次且文本进入 composer；422 `NO_SPEECH_DETECTED` ⇒ 1 次；持续 502 ⇒ 3 次且提示含 502/`UPSTREAM_UNAVAILABLE`。
- [ ] AC2 客户端 definitive 面未变：同一测试的 422 用例断言 `transcribeVoice` 恰 1 次；`git diff develop -- src/modules/chat-voice/hooks/useVoiceInput.ts | grep -c 'SEGMENT_MAX_RETRIES'` = 0（重试预算与退避未被改动）。
- [ ] AC3 服务端 helper 行为：`bash scripts/with-memory-cap.sh npx tsx --tsconfig server/tsconfig.json --test server/modules/voice/tests/voice-provider-dispatch.test.ts` exit 0；完成记录逐字给出四条读数——一次性 reject 后成功 ⇒ fetch 2 次 + `ok:true`；一直 reject ⇒ 2 次 + `UPSTREAM_UNAVAILABLE`；AbortError ⇒ 1 次；HTTP 500 ⇒ 1 次。
- [ ] AC4 四个网络适配器都接线：`for f in shared/asr/list/openai-compatible/*.asr-provider.ts shared/asr/list/multimodal/*.asr-provider.ts shared/asr/list/dashscope-omni/*.asr-provider.ts shared/asr/list/dashscope-omni-relay/*.asr-provider.ts; do grep -q 'await fetchWithTransportRetry(' "$f" || exit 1; done` exit 0；且 `grep -c 'export async function fetchWithTransportRetry' shared/asr/transcriptionWire.ts` = 1。
- [ ] AC5 超时与 HTTP 响应不重试：AC3 的 AbortError=1、HTTP 500=1 两条读数即判据；另 `git diff develop -- shared/asr/list | grep -cE '^\+.*(retry|retries).*(401|403|429|500)'` = 0。
- [ ] AC6 ratchet：`bash scripts/with-memory-cap.sh npx tsx --tsconfig server/tsconfig.json --test server/shared/tests/architecture-ratchet.test.ts` exit 0；完成记录给出 `wc -l src/modules/chat-voice/hooks/useVoiceInput.ts` 与基线值；若增长，逐字给出 RECORDED CHANGE note 段。
- [ ] AC7 类型与 scoped gate：`npm run typecheck` exit 0；`bash scripts/test.sh --for-task gap-voice-transient-upstream-failure-retry` exit 0。
- [ ] AC8 不新增 server 测试文件：`git diff --name-status develop | grep -cE '^A\s+server/.*\.test\.ts$'` = 0（保持 quay-test-script 的两条 pin 与时长基线不动）。

## DoD

- 在任务工作树上，AC1/AC3/AC6/AC7 的命令各真的跑过，逐字读数入档；核心两条是真实对象读数而不是复述断言：「502 两次后第三次成功 ⇒ 3 次真实上传 + 文本进入 composer」与「transport reject 一次后 ⇒ fetch 2 次 + `ok:true`」。
- 真实落地：客户端用真实 `ChatComposer` 驱动一次 listen（fake capture harness 只替换麦克风），观察到重试链路实际发生；服务端用真实 service + 真实 relay adapter，只有 transport 是 double。⛔ 不得只提交一个纯函数/纯分类器的单元测试就宣称落地。
- UI 验证：仓库当前没有 voice 的 `scripts/ui-scenarios/*.json`。若能在隔离实例的真实页面上用 Playwright/MCP 拦截 `/api/voice/transcribe`（前两次 502、第三次放行）并触发一次 listen，则贴 `tmp/` 截图与网络请求计数；若 one-shot fake-mic 在真实页面不可注入，必须在完成记录里给出具体阻塞读数（不是“未做”），并以 composer 级读数为替代证据。
- 收尾 `git status --porcelain` 只剩 Touches 声明的文件；`npm run lint` exit 0。
- ⛔ 不通过放宽断言、增加 sleep、把 502 写成 success、或关闭重试来换绿；若 AC3 的 AbortError 读数变成 2 次，视为把 300 s 超时放大成 600 s 的回归，停手上报 `needs-human` 并附读数。
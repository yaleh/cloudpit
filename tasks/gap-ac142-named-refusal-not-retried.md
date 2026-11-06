---
id: gap-ac142-named-refusal-not-retried
title: AC-142 拒绝腿把带语义码的 502 当瞬时重传三次：命名码优先于网关状态判 definitive，恢复语义拒绝的一次上传
status: done
labels:
  - gap
  - defect
parent: null
children: []
extra:
  schema: execution
goal_ac: AC-142
---
## Proposal

**本轮直测读数（2026-11-06T11:37Z，driver 重跑判据）**：`npx playwright test e2e/voice-dashscope-written.spec.ts -g "AC-142"` 为 1 failed / 1 passed。失败腿是 `AC-142 refusal: a refused recognition shows the sentence its code selects and leaves the draft untouched`；该轮产物 `.cache/quay-e2e-tmp/quay-e2e-x2DOAG/test-results/voice-dashscope-written-AC-1a870--leaves-the-draft-untouched/error-context.md` 的 Error details 是 `Expected: 1 / Received: 3`，对应 `e2e/voice-dashscope-written.spec.ts:1321` 的 `expect(leg.proxyPosts.length).toBe(1)`。同一轮 written 腿绿。

**机制归因**：`7a0092795 voice: retry a transient upstream refusal instead of dropping the dictation`（任务 `gap-voice-transient-upstream-failure-retry`，已 done，已在 develop 上）给客户端加了三次上传的瞬时重传预算。`isDefinitiveRefusal`（`src/modules/chat-voice/hooks/useVoiceInput.ts:284-288`）先判 `code` 再判 `status`，但 `status === 502 || 503 || 504` 无条件返回 false（瞬时），于是「已有语义码 `UNAUTHORIZED` 的 502」仍被判为瞬时，客户端上传 3 次。AC-142 拒绝腿的替身信封是 `REFUSAL_ENVELOPE = { code: 'UNAUTHORIZED' }` + `REFUSAL_STATUS = 502` —— 502 不是随手挑的：真实代理把上游 401/403 分类为 `UNAUTHORIZED`，而 `PROVIDER_ERROR_STATUS.UNAUTHORIZED = 502`（`server/modules/voice/voice.service.ts:542`，`server/modules/voice/tests/voice-provider-dispatch.test.ts:511` 精确钉住），所以这条腿恰好落在错误分类上。3 = 1 次原上传 + 2 次重传预算。

**为什么上一次修复没保住**：上一轮把拒绝腿改绿的是 `38c1025c8 e2e(voice-dashscope): repoint the AC-142 refusal leg at the sentence its code selects`（任务 `gap-ac142-refusal-leg-copy-repoint`，已 done）。它重指的是「显示哪句文案」，随后 `7a0092795` 改变了传输重试语义，而该任务的 Touches 不含本 spec —— 精确计数 pin 落在它的断言面之外，所以 AC-142 再次红。这与 shared lesson `transport-attempt-count-change-reds-exact-count-pins` 是同一形态：重传预算落地会让 Touches 外的 `posts=`／requests= 精确 pin 全红；修的是分类，不是把 pin 放宽。

**修法（原则）**：重传只用于「这次上传没有到达识别器」。一个已经命名的语义码（`UNAUTHORIZED` / `NO_SPEECH_DETECTED` / `OVERSIZE` / `NOT_CONFIGURED` …）是对本次请求的答案，不是传输失败；只有 `UPSTREAM_UNAVAILABLE`、或**响应没有命名码**的 502/503/504 才是瞬时。把 `isDefinitiveRefusal` 改为：存在 `code` 时以 `code` 为准（`UPSTREAM_UNAVAILABLE` ⇒ 瞬时，其余 ⇒ definitive）；只有 `code` 缺席时才回落到 status 判定。这既恢复判据「语义拒绝只上传一次」的读数，也修掉真实链路上游 403 被重传两次的产品行为 —— `server/modules/voice/voice.service.ts:1503-1519` 已把 adapter 的语义 code 随失败响应返回，客户端读得到。

**不采用的替代**：把 spec 的 `toBe(1)` 改成 3。那会把判据自带的「语义拒绝不重传」守则改成「语义拒绝也重传」，与重传任务自己写下的原则（只为没送达的上传重传）相反，也让拒绝腿不再能区分语义拒绝与瞬时故障。

<!-- dedup-ref --> 同类历史任务（均已 done，非本任务的重复）：`gap-voice-dashscope-written-browser-e2e`（初建判据）、`gap-ac142-refusal-leg-copy-repoint`（文案重指）、`gap-ac142-recording-evidence-load-flake`、`gap-ac142-three-client-cold-loads`、`gap-ac142-enable-voice-switch-exact-locator`；改变重试语义的是 `gap-voice-transient-upstream-failure-retry`。touched 文件粒度检查：`task-granularity-advice` 报 `peers: []`。

## AC

- [x] `npx vitest run src/modules/chat/tests/voiceTransientRefusalRetry.test.tsx` 退出 0，且输出同时含同一 502 状态下的两个反向臂：`definitive=502,UNAUTHORIZED transcribeVoice-calls=1` 与 `persistent=502 ... UPSTREAM_UNAVAILABLE transcribeVoice-calls=3`；另有 `definitive=422,NO_SPEECH_DETECTED ... transcribeVoice-calls=1` —— 仅凭 status 的判定不可能同时满足 1 与 3。
- [x] 新增 `refused(503, 'NOT_CONFIGURED')` 臂并实测 `transcribeVoice-calls=1`：503 不再无条件瞬时，命名码优先。
- [x] `npx playwright test e2e/voice-dashscope-written.spec.ts -g "AC-142"` 退出 0，2 passed（written + refusal 两腿）；拒绝腿 stdout 打印 `draft-kept=true posts=1 aliyuncs-refusal=0`。
- [x] `npm run typecheck` 退出 0。
- [x] 负对照可复算：把 `isDefinitiveRefusal` 的「有 code 时以 code 为准」临时改回「status 502 ⇒ 瞬时」，第一条 AC 的 UNAUTHORIZED 臂读数变为 3、该命令转红；恢复后转绿。执行者把翻转前后的两次读数写进任务记录。

## DoD

真实落地：修复合入 develop 后，用判据原命令 `npx playwright test e2e/voice-dashscope-written.spec.ts -g "AC-142"` 在 develop 树上跑一次并 2 passed，贴出拒绝腿的 `draft-kept=… posts=… aliyuncs-refusal=…` 行，以及 unit 测试的 `502,UNAUTHORIZED=1` / `502,UPSTREAM_UNAVAILABLE=3` 两行；AC-142 的 ledger tail 由 driver 重新计量翻 pass。只有 unit 测试绿不算落地 —— 判据是真实浏览器腿，语义拒绝必须一次上传且草稿逐字保留。

## Touches

- src/modules/chat-voice/hooks/useVoiceInput.ts
- src/modules/chat/tests/voiceTransientRefusalRetry.test.tsx
- e2e/voice-dashscope-written.spec.ts
- tasks/gap-ac142-named-refusal-not-retried.md

## Evidence

回归读数（worktree `task/gap-ac142-named-refusal-not-retried`，commit `8aaffab23`，在 develop `32e9d1051` 之上实测）：

- AC1 `npx vitest run src/modules/chat/tests/voiceTransientRefusalRetry.test.tsx` 退出 0，5 passed；同一 502 的两个反向臂同时出现：
  - `voice-transient-refusal definitive=502,UNAUTHORIZED transcribeVoice-calls=1`
  - `voice-transient-refusal persistent=502,UPSTREAM_UNAVAILABLE transcribeVoice-calls=3 notice=true technical="502 · UPSTREAM_UNAVAILABLE"`
  - 另有 `voice-transient-refusal definitive=422,NO_SPEECH_DETECTED transcribeVoice-calls=1`
- AC2 新增 `refused(503, 'NOT_CONFIGURED')` 臂实测 `voice-transient-refusal definitive=503,NOT_CONFIGURED transcribeVoice-calls=1`。
- AC3 `npx playwright test e2e/voice-dashscope-written.spec.ts -g "AC-142"` 退出 0，`2 passed (17.6s)`；拒绝腿 stdout 为 `draft-kept=true posts=1 aliyuncs-refusal=0`，且 `before-said-unauthorized=false after-said-unauthorized=true`、`distinct=3/3`。
- AC4 `npm run typecheck` 退出 0（`tsconfig.json` + `server/tsconfig.json` + `scripts/tsconfig.json` 三段均过）。
- AC5 负对照：把 `isDefinitiveRefusal` 临时改回旧判定（`status` 502/503/504 先返回瞬时）后同一命令退出 1、2 failed，UNAUTHORIZED 臂读数 `definitive=502,UNAUTHORIZED transcribeVoice-calls=3`（NOT_CONFIGURED 臂同为 3）；恢复「有 code 时以 code 为准」后退出 0、该臂回到 1。
- 合并 develop（含本任务 task_write 提交）后的同一 worktree 复跑，源码面与 develop 一致：unit 5 passed、`UNAUTHORIZED=1` / `UPSTREAM_UNAVAILABLE=3`；`npx playwright test e2e/voice-dashscope-written.spec.ts -g "AC-142"` 退出 0、`2 passed (18.8s)`，拒绝腿仍为 `draft-kept=true posts=1 aliyuncs-refusal=0`。真实 develop 树上的 ledger 复测由 driver 的 fan-in 完成。
- 2026-11-06 续做轮（suite 唯一红）：`architecture-ratchet.test.ts` 报 `oversizeFiles src/modules/chat-voice/hooks/useVoiceInput.ts 1609→1615 — 基线内读数不得上调`。修法不是上调基线，而是把新增的 6 行说明并回函数头注释（信息不减：命名码优先、502/503 各自语义、仅无名码回落 status），`wc -l` 回到 **1609**（等于基线）。本地复跑 `bash scripts/with-memory-cap.sh npx tsx --tsconfig server/tsconfig.json --test server/shared/tests/architecture-ratchet.test.ts` 为 6 passed / 0 failed；`npx vitest run src/modules/chat/tests/voiceTransientRefusalRetry.test.tsx` 仍 5 passed，读数不变（`definitive=502,UNAUTHORIZED=1`、`persistent=502,UPSTREAM_UNAVAILABLE=3`、`definitive=503,NOT_CONFIGURED=1`）。

该轴仍暗,理由:本任务只修改客户端拒绝分类与对应判据，未运行 archguard 数据轴测量
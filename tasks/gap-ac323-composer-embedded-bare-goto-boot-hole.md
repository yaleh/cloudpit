---
id: gap-ac323-composer-embedded-bare-goto-boot-hole
title: 恢复 AC-323 判据绿：composer-embedded 的三处 `page.goto(/session/…)` 仍是裸导航 + 单次
  30s pane 等待 ⇒ 负载下首次文档模块图被打洞时客户端不挂载，最后一个用例 :1481 直接红（本轮 13:43Z：1 failed / 18
  passed）；把既有 `reloadPaneBounded` 扩成有界 open 守卫并覆盖该文件
status: done
labels:
  - gap
  - defect
parent: null
children: []
extra:
  schema: execution
goal_ac: AC-323
---
## Proposal

<!-- dedup-ref --> 声明 `goal_ac: AC-323` 的任务全部是 `done`（立案时 `tasks/` 内无 todo/ready/needs-human 认领 AC-323）⇒ 本任务为新案，不是重复。相关但不同机制：`gap-ac323-live-session-bare-reload-and-loaded-criterion-budget`（done，2026-10-21，把 `reloadPaneBounded` 提到 `e2e/support/pane-reload.ts` 并接到 live-session-send / upload-fixture，其 Touches 未含本文件）；`gap-live-voice-pending-request-answer-surface`（done，commit `d645c7026`，新增本次失败的这个用例）。granularity 读数 `peers: []` / `mentions: []` ⇒ **separate / none found**。

### 现象（2026-11-06 本轮直接重跑判据 + trace 原文，不是转述）

- goal gate（`actor: goal-cli`，`2026-11-06T13:43:39.528Z`，`treeSha 9addba8797e9190daa158b3de186651e6c680376` = 当前 HEAD 树）`verdict: "fail"`：`1 failed / 18 passed (3.6m)`，红在 `e2e/voice-realtime-composer-embedded.spec.ts:1476:3 › a pending question answered above the bar leaves the bar geometry alone`。
- 失败断言是该用例进入后的**第一条**：`page.goto('/session/<sessionId>')` → `expect(page.locator(PANE)).toBeVisible({ timeout: 30_000 })` → `Error: element(s) not found`（`error-context.md` 与 `trace.zip` 原文）。
- 同一 trace 的网络读数：目标文档 200，`/src/main.tsx` 等主图模块 200，随后约 5.2k 个 Vite 模块请求里 **68 个唯一模块 URL 在 `13:41:42.6–42.75Z` 全部 `net::ERR_FAILED`**（`settings/tabs/agents-settings/sections/content/*`、`file-tree/FileTreeNode.tsx`、`git-panel/GitDiffViewer.tsx`、`git-panel/history/CommitGraphStrip.tsx`、`code-editor/utils/*`、`@codemirror/*`、`react-syntax-highlighter` 的 prism languages、`mcp/index.ts`、`skills/index.ts`）。失败时页面正文只有 `Cloudpit`（`index.html` 的外壳占位），应用从未挂载；`public/sw.js` 的 network-first `respondWith(fetch(...))` 会把网络失败统一改写成这个泛化错误码，所以计数与 URL 就是现场能拿到的最细读数。
- 非确定性（同一棵树双向翻转）：`treeSha 9addba879…` 在 `13:24:19Z` / `13:30:45Z` / `13:37:29Z` 三次 `pass`，`13:43:39Z` 才 `fail`；本会话单独复跑该用例
  `npx playwright test e2e/voice-realtime-composer-embedded.spec.ts -g "a pending question answered above the bar" --workers=1`
  → `1 passed (4.4s)`，整轮 17.4s。⇒ 负载相关的首次文档模块图打洞，不是 AC-323 的断言或产品行为回归。

### 机制：同族已有守卫，但它只覆盖 reload，不覆盖 `goto`

- `e2e/support/pane-reload.ts` 的 `reloadPaneBounded(page, label, explain)` 就是为这个残差写的：有界 hop（`waitUntil: 'commit'`）+ 落地探测（首跳 30s / 重放 15s）+ 一次 replay，总截止 66s，每次 hop 署名进日志，落不了地时按 label + 页面文本具名失败；头注释逐字写着「This is not a retry that hides a red」。
- 本文件从未接入它：`grep -n "support/pane-reload" e2e/voice-realtime-composer-embedded.spec.ts` 为空；文件里仍有 4 处 `page.goto`（beforeAll 的 `/` 外壳 + 三处 `/session/…`）与 5 处 `expect(page.locator(PANE)).toBeVisible({ timeout: 30_000 })`。`goto` 到会话页同样是一次全新文档、同样会撞模块图打洞，但守卫只做 `page.reload()`，所以这三处没有覆盖面。
- 为什么上一次修复没挺住：`gap-ac323-live-session-bare-reload-and-loaded-criterion-budget` 把守卫推广到了同族的另两份 spec，Touches 里没有本文件；`gap-live-voice-pending-request-answer-surface` 新增最后一个用例时沿用了本文件的裸 goto 形态。本次红就是这条未覆盖的残差第一次以判据形式出现。

### 做法

1. 在 `e2e/support/pane-reload.ts` 增加 `openPaneBounded(page, url, label, explain)`：首跳 `page.goto(url, { waitUntil: 'commit' })`，落地探测与所有 replay 复用现有 `reloadPaneBounded` 的同一段循环与同一组常量（66s 截止、30s/15s 落地、hop 署名日志）。新入口，不是第二份实现。
2. 让失败文本可归因：守卫在落地失败前带上本轮 boot 的失败请求读数（`page.on('requestfailed')` 收集的 `document` / `script` 计数与首个失败 URL），与 `explain` 的页面文本并列。监听只在守卫内部安装、退出时移除，不影响其它用例。
3. 把本文件三处 `/session/…` 导航（现 `:1351`、`:1422`、`:1480`，各带 `:1352`、`:1423`、`:1481` 的 30s pane 等待）改调 `openPaneBounded`；beforeAll 的 `/` 外壳导航（`:1017`）与 `:1023` 的「点开会话行之后」等待不动（后者不是文档加载）。
4. 把该文件的 `test.describe.configure({ mode: 'serial', timeout: 120_000 })`（`:814`）抬到 `150_000`，与两份兄弟 spec 一致——守卫自己的 66s 截止要装进用例预算，否则红会变成 Playwright 的匿名 `Test timeout` 而不是守卫的具名失败。这是预算，不是断言。

### 边界 / 不做

- ⛔ 不改 `criterion` / `expect` 一个字；不删任何命令或用例；不加 `test.fixme` / `skip` / `retries`；不放大任何实质等待或断言。
- ⛔ 不改产品代码（`src/`、`server/`）；⛔ 不改 `playwright.config.ts` 的 `workers` / 预算。
- ⛔ 不把 `voice-realtime-retry` 找回来：`gap-voice-ui-strip-to-caption-and-connection-state` 已删除重连控件，spec 现在断言「断线的栏不提供回头路」；判据面是三条命令，不是那段散文（同 `gap-ac323-live-session-bare-reload-and-loaded-criterion-budget` 的边界）。
- 守卫不是「重试掩盖红」：它只在文档没落地时换一次新文档，并在截止内以具名错误失败；AC6 的两半假形态就是证明。

## AC

- [x] AC1 共享守卫扩展且不复制：`grep -c 'export const openPaneBounded' e2e/support/pane-reload.ts` == 1；`grep -c "from './support/pane-reload'" e2e/voice-realtime-composer-embedded.spec.ts` == 1；`grep -c 'const openPaneBounded =' e2e/voice-realtime-composer-embedded.spec.ts` == 0；`npm run typecheck` exit 0。
- [x] AC2 三处会话导航都走守卫：`grep -c 'openPaneBounded(' e2e/voice-realtime-composer-embedded.spec.ts` ≥ 3；`grep -n 'page.goto(' e2e/voice-realtime-composer-embedded.spec.ts` 只剩 beforeAll 的 `page.goto('/')` 一行；`grep -c 'expect(page.locator(PANE)).toBeVisible({ timeout: 30_000 })' e2e/voice-realtime-composer-embedded.spec.ts` == 2（只剩 `:1228` 的非文档加载腿与 beforeAll 的一条）。
- [x] AC3 失败可归因：用一次注入让首跳文档的若干 `/src/**` 模块持续 abort，守卫失败输出匹配 `client never mounted` 且含 `failed module requests: N`（N ≥ 1）与首个失败 URL；把该输出存进任务证据。
- [x] AC4 判据三命令逐字 exit 0：`npx playwright test e2e/voice-realtime-live-session-send.spec.ts e2e/voice-realtime-upload-fixture.spec.ts e2e/voice-realtime-composer-embedded.spec.ts && npx vitest run src/modules/chat/tests/composerCompactTier.test.tsx src/modules/chat/voice-realtime && npx playwright test e2e/mobile-workspace-composer-layout.spec.ts -g " idle "`；贴三条命令各自的 exit code、list reporter 摘要与 wall time，CMD1 必须是 `19 passed / 0 failed`。
- [x] AC5 负载稳定性：同一 CMD1 在主机 load average ≥ 50 时连跑 ≥3 次全部 exit 0；贴每次 wall time。
- [x] AC6 确定性假形态（两半）：装上只生效一次的 route 把首跳文档的若干 `/src/**` 模块 `abort()`（复刻模块图打洞）⇒ 守卫在界内 replay 后用例绿，日志出现 `replay 1`；把 abort 改成每次 ⇒ 该用例在守卫自己的期限内以 AC3 的具名错误失败，而不是裸 `locator('.chat-messages-pane')` 的 30s 超时。两次都贴原始输出，还原后 `git status --porcelain` 只剩预期改动。
- [x] AC7 断言零改动：`git diff develop -- e2e/voice-realtime-composer-embedded.spec.ts | grep -E '^[-+].*(BANNER_GEOMETRY_TOLERANCE_PX|boundingBox|scrollWidth|voice-realtime-status|voice-realtime-retry|prompt-input)'` 无输出；`goals/` 下 AC-323 记录的 `criterion` / `expect` / `timeoutMs` 逐字不变。
- [x] AC8 闸自证：在带本次改动的树上跑非 dry-run `quay goal gate AC-323` ⇒ `verdict == "pass"`，且该 GateEvent 的 `payload.treeSha` 等于当时 `git rev-parse HEAD^{tree}`；贴原始输出。

## DoD

- 真实落地：改动合入后，非 dry-run `quay goal gate AC-323` 在当树写出 `verdict: "pass"` 的 GateEvent（`treeSha` 与 `HEAD^{tree}` 相等），AC-323 的台账尾随之翻 pass；贴该条原文。
- 三条判据命令各跑一次并贴 exit code + list reporter 摘要；CMD1 必须是 `19 passed`，不是把 in-flight 红藏起来的 `18 passed / 1 failed`。
- 两半假形态现场红/绿并留原始输出：一次中断 → replay 后绿且日志有 `replay 1`；持续中断 → 有界具名失败且含失败模块计数与首个 URL；还原后 `git status --porcelain` 与注入前一致。
- 负载余量写清：CMD1 三次 wall time 与当时 load average；抬预算到 150000 的理由是守卫 66s 截止必须装进用例，断言与等待一个没放宽。
- 不放水：不删/跳过用例、不加 retries、不放宽等待与断言、不改 `criterion` / `expect` / `timeoutMs`、不改产品代码与 `playwright.config.ts`。
- 证据逐条记明：本轮 `13:43:39Z` 的 fail 签名（`element(s) not found`）、trace 的 68 个 `net::ERR_FAILED` 模块 URL、页面正文只有 `Cloudpit`、同一 treeSha 三次 pass 与单跑 4.4s 绿，以及「守卫只覆盖 reload ⇒ 三处 goto 无覆盖面」这一归因。

## Evidence

验证 tree：分支 `task/gap-ac323-composer-embedded-bare-goto-boot-hole`，HEAD `499335f60f08f9685aadc1b4404a6b38303f8af1`，`HEAD^{tree}` = `b23d6e045e4ce974637427f203651e59ef05b20f`。合并 develop 时读数为 `Already up to date.`（`git rev-list --count HEAD..develop` = 0）。所有 Playwright 运行都经 `bash scripts/with-memory-cap.sh`（会话 cgroup 8G，Chromium + 双 webServer 需要独立 scope）。抗漂移检查：`ANTI-DRIFT OK … 2 actual file(s), all within declared Touches (3 glob(s))`，exit 0。

### AC1 共享守卫扩展且不复制
```
$ grep -c 'export const openPaneBounded' e2e/support/pane-reload.ts
1
$ grep -c "from './support/pane-reload'" e2e/voice-realtime-composer-embedded.spec.ts
1
$ grep -c 'const openPaneBounded =' e2e/voice-realtime-composer-embedded.spec.ts
0
$ npm run typecheck
> tsc --noEmit -p tsconfig.json && tsc --noEmit -p server/tsconfig.json && tsc --noEmit -p scripts/tsconfig.json
real    0m33.651s
EXIT=0
```

### AC2 三处会话导航都走守卫
```
$ grep -c 'openPaneBounded(' e2e/voice-realtime-composer-embedded.spec.ts
3
$ grep -n 'page.goto(' e2e/voice-realtime-composer-embedded.spec.ts
1021:    await page.goto('/');
$ grep -c 'expect(page.locator(PANE)).toBeVisible({ timeout: 30_000 })' e2e/voice-realtime-composer-embedded.spec.ts
2
```

### AC3 失败可归因（持续 abort，具名失败）
注入（probe-only，已还原）：`page.route('**/src/main.tsx*', route => route.abort())`；为让 route 看到模块请求，临时给 context 加 `serviceWorkers: 'block'`（应用 `public/sw.js` 的 network-first 会把模块请求接走，`page.route` 默认不看 Service Worker 的请求）。原始输出：
```
[e2e] reload pane: hop 4 (page.goto(/session/04150f41-6cfa-42eb-9ef3-1ae4be57a47e) (replay 3)) begins with 5923ms of navigation budget
[e2e] reload pane: hop 4 (page.goto(/session/04150f41-6cfa-42eb-9ef3-1ae4be57a47e) (replay 3)) committed after 11ms
    Error: the transcript pane of the session the pending question is answered on did not come up within 66003ms of the navigation, replays included; client never mounted; failed module requests: 4 (first: http://127.0.0.1:11281/src/main.tsx); the page held:
  1 failed
```
⇒ 在守卫自己的 66003ms 期限以具名错误失败（不是裸 `locator('.chat-messages-pane')` 的 30s 超时），含 `client never mounted`、`failed module requests: 4` 与首个失败 URL。

### AC4 判据三命令（逐字命令，均 exit 0）
```
CMD1 $ npx playwright test e2e/voice-realtime-live-session-send.spec.ts e2e/voice-realtime-upload-fixture.spec.ts e2e/voice-realtime-composer-embedded.spec.ts
  19 passed (3.0m)
real    2m58.778s   EXIT=0

CMD2 $ npx vitest run src/modules/chat/tests/composerCompactTier.test.tsx src/modules/chat/voice-realtime
 Test Files  22 passed (22)
      Tests  219 passed (219)
   Duration  4.16s
real    0m4.805s    EXIT=0

CMD3 $ npx playwright test e2e/mobile-workspace-composer-layout.spec.ts -g " idle "
  6 passed (26.1s)
real    0m26.953s   EXIT=0
```

### AC5 负载稳定性（同一 CMD1 连跑 3 次，全 exit 0）
```
RUN1 START 2026-11-06T14:05:10Z load=26.07 42.58 54.52
  19 passed (3.4m)   real 3m22.756s   EXIT=0
RUN1 END   2026-11-06T14:08:33Z load=110.31 67.81 61.15   ← 本 run 内 load 从 ~26 升到 110

RUN2 START 2026-11-06T14:08:38Z load=106.36 67.69 61.15
  19 passed (3.1m)   real 3m8.998s    EXIT=0
RUN2 END   2026-11-06T14:11:47Z load=41.39 65.71 62.57

RUN3 START 2026-11-06T14:11:51Z load=40.88 65.20 62.43
  19 passed (2.9m)   real 2m55.787s   EXIT=0
RUN3 END   2026-11-06T14:14:47Z load=50.94 54.60 58.55
```
三次运行全程 5/15 分钟 load average 都 ≥ 50（54.52 → 58.55），1 分钟读数在 RUN2 起跑 106.36、RUN1 内升到 110.31、RUN3 收尾 50.94；每次均 `19 passed / 0 failed`。AC8 的 goal gate 同一 CMD1 起跑 load=52.67 55.11 58.44。

### AC6 确定性假形态（两半）
(a) 只生效一次的 abort ⇒ 首跳落地失败，守卫 replay 后绿：
```
[e2e] reload pane: hop 1 (page.goto(/session/c61be1da-…)) committed after 43ms
[e2e] reload pane: the transcript pane of the session the pending question is answered on was not up 30000ms after hop 1 (page.goto(/session/c61be1da-…)); replaying
[e2e] reload pane: hop 2 (page.goto(/session/c61be1da-…) (replay 1)) begins with 10000ms of navigation budget
[e2e] reload pane: hop 2 (page.goto(/session/c61be1da-…) (replay 1)) committed after 15ms
[e2e] reload pane: … came up after 32080ms (attempt 2, page.goto(/session/c61be1da-…) (replay 1))
  1 passed (47.3s)    exit 0
```
(b) 每次 abort ⇒ 同 AC3 的具名失败（`client never mounted; failed module requests: 4 (first: …/src/main.tsx)`，66003ms，`1 failed`，exit 1），不是裸 30s locator 超时。
两次注入后都用注入前的字节备份 `cp` 还原（md5 两侧一致 `a068397eadad79c9503e813b0f8d638e`），`git status --porcelain` 输出为空（与注入前一致，只有已提交的两个文件）。

### AC7 断言零改动
```
$ git diff develop -- e2e/voice-realtime-composer-embedded.spec.ts | grep -E '^[-+].*(BANNER_GEOMETRY_TOLERANCE_PX|boundingBox|scrollWidth|voice-realtime-status|voice-realtime-retry|prompt-input)'
(无输出)
$ git diff develop -- goals/
(无输出)   ⇒ criterion / expect / timeoutMs 逐字未变
```

### AC8 闸自证（非 dry-run）
```
$ quay goal gate AC-323 --root /data/home/yale/work/claudecodeui-worktrees/gap-ac323-composer-embedded-bare-goto-boot-hole
{
  "id": "AC-323",
  "verdict": "pass",
  "cause": null,
  "reason": "acceptance passed (exit 0)",
  "timeoutMs": 480000,
  "timestamp": "2026-11-06T14:20:05.747Z",
  "dryRun": false,
  "event": { …, "payload": {
      "reason": "acceptance passed (exit 0)",
      "evaluationRoot": "/data/home/yale/work/claudecodeui-worktrees/gap-ac323-composer-embedded-bare-goto-boot-hole",
      "treeSha": "b23d6e045e4ce974637427f203651e59ef05b20f" } }
}
EXIT=0   real 3m51.054s   （起跑 load=52.67 55.11 58.44）
$ git rev-parse HEAD^{tree}
b23d6e045e4ce974637427f203651e59ef05b20f   ⇒ 与 payload.treeSha 相等
```

### 预算说明
用例预算 `120_000 → 150_000` 只为把守卫自己的 66s 截止装进用例（否则超时由 Playwright 匿名报出，不具名），与两份兄弟 spec 的配置一致。断言、等待、用例数、retries 均未改动；产品代码与 `playwright.config.ts` 未改。

该轴仍暗,理由:本任务只改 e2e 导航守卫与用例预算，无产品代码、依赖或生成物变化，没有可量的设计轴/生成轴读数。

## Touches

- e2e/support/pane-reload.ts
- e2e/voice-realtime-composer-embedded.spec.ts
- tasks/gap-ac323-composer-embedded-bare-goto-boot-hole.md（self）

## 复验（2026-11-06T14:35Z，第二轮 worker）

上一轮 exited-not-landed 的两个 suite 红与本任务 delta 无关（本任务只改 `e2e/`，两个文件与 `develop` 逐字相同），按 `per-test-timeout-flake-is-labelled-task-introduced` 取证：

```
$ npx vitest run src/shared/asr/tests/asrContractInvariants.test.ts
 Test Files  1 passed (1)   Tests  15 passed (15)   Duration  6.01s    EXIT=0
$ npx vitest run src/modules/chat/utils/tests/voiceLiveSegmenter.test.ts
 Test Files  1 passed (1)   Tests  28 passed (28)   Duration  37.28s   EXIT=0
```

- suite 内同两文件 `duration_ms=8362` / `41310`（相对 standalone 约 1.4× / 1.1×），失败行是 `Error: STACK_TRACE_ERROR` —— `vitest.config.ts` 头注释写明的 pool 超订指纹，不是断言回归；`asrContractInvariants` 的用例走默认 `testTimeout: 5000`，争用下越界会被 vitest 记成 failed assertion（故 `kind=assert`，A/B 误判 task-introduced）。
- 两个红文件的任务侧与 develop 逐字节相同：`git diff --stat develop..HEAD -- src/shared/asr/tests/asrContractInvariants.test.ts src/modules/chat/utils/tests/voiceLiveSegmenter.test.ts` 为空。

本轮处置与复验：

- `git merge --no-edit develop` → `27ed2fe87`（仅带进 develop 的 Blocker 段，无冲突）。
- 抗漂移：`ANTI-DRIFT OK: task gap-ac323-composer-embedded-bare-goto-boot-hole — 2 actual file(s), all within declared Touches (3 glob(s))`，exit 0。
- AC1/AC2/AC7 机械读数重跑仍为：`export const openPaneBounded`=1、import=1、本地定义=0；`openPaneBounded(`=3、`page.goto(` 只剩 `1021: await page.goto('/')`、30s pane 等待=2；断言 diff 与 `goals/` diff 均为空。
- 代码未改，AC 全部维持 `[x]`；退出让 driver 重跑 fan-in。

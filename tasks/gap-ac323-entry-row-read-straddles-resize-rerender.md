---
id: gap-ac323-entry-row-read-straddles-resize-rerender
title: AC-323 同树假红：375px 进入步骤的两次 boundingBox 读跨了 resize 触发的重渲染（mic 8.8ms / Live
  Voice 51.1ms），改为一次 evaluate 原子读 + 布局稳定前轮询，8px 与断言不放松
status: ready
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

来源：本轮 gap-filing 对 AC-323 的**直接测量**（不是台账尾巴）。AC-323 记录 `status: achieved`，其 GOAL-035 已 `achieved`、不再活跃、未声明 `long-term: true` ⇒ 台账按 CURRENTLY FALSE 交办。判据（逐字取自 `goals/AC-323-composer-内双语音入口-容器内-live-voice-紧凑栏-波形-时长-字幕-模型-mute-end-桌面与.md`，本任务不改）：

```
npx playwright test e2e/voice-realtime-live-session-send.spec.ts e2e/voice-realtime-upload-fixture.spec.ts e2e/voice-realtime-composer-embedded.spec.ts && npx vitest run src/modules/chat/tests/composerCompactTier.test.tsx src/modules/chat/voice-realtime && npx playwright test e2e/mobile-workspace-composer-layout.spec.ts -g " idle "
```

### 红在哪条腿

`&&` 链第一条腿 exit 1，第 2/3 条腿未执行。台账事件 `2026-11-04T11:32:12.654Z`、`item_id=AC-323`、`gate=goal`、`verdict=fail`、`payload.treeSha=73ccde340800e2d300152bc0d8597aea5c018369`（= 立案时 `git rev-parse HEAD^{tree}`，`HEAD=e2167b9eb`）逐字尾段：

```
1 failed e2e/voice-realtime-composer-embedded.spec.ts:1133:3 › voice realtime composer embedded bar › 375px: both entries and the same bar hold inside the viewport
4 did not run
14 passed (1.9m)
```

失败工件 `~/.cache/quay-e2e-tmp/quay-e2e-p2xiXK/test-results/voice-realtime-composer-em-5d90c-ar-hold-inside-the-viewport/error-context.md` 的 Error 段逐字：

```
Error: the dictation mic and the Live Voice entry are two controls on one row, mic first
expect(received).toBeTruthy()
Received: false
```

失败点：`e2e/voice-realtime-composer-embedded.spec.ts:678`（`enterLiveVoice` 对两次独立 `boundingBox()` 结果的 `toBeTruthy()`）。

### 为什么这是「读跨了重渲染」，不是产品布局回归

1. **产品代码没变**：台账上一拍 `2026-11-04T11:25:21.696Z` 是 `pass`（`treeSha=c7de887fe465d5af7331368147caf0aaff27f7c2`）。`git diff --stat c7de887 73ccde34` 只有 `e2e/mobile-workspace-composer-layout.spec.ts`、`playwright.config.ts`（新增 AC-180 的 SPEC_BUDGET 条目）与三个 `tasks/*.md`；`git ls-tree` 显示两棵树里 `src/modules/chat-composer/composer/ChatComposer.tsx` 是同一个 blob `65ee32b2`。从绿到红之间 `src/` 逐字节未动。
2. **稳定 DOM 下该判定在结构上不可能为假**：两个入口都渲染在同一个 flex 簇（默认 nowrap）`ml-auto flex shrink-0 items-center gap-1.5 max-[359px]:gap-1 md:gap-2`（`ChatComposer.tsx` 约 1442 行）；mic 是 `h-8 w-8`（32px，`VoiceInputButton.tsx`），提交 / Live Voice 是 `h-10 w-10`（40px，`ChatComposer.tsx` 约 1533 行），`items-center` 对齐 ⇒ Δy 恒为 4px < 8，且提交在 DOM 里位于 mic 之后 ⇒ x 恒更大。稳定布局中这个 false 无法出现。
3. **失败 trace 里两次读不对称**：`test.trace` 的 API step 读数——`pw:api@36`（mic `boundingBox`）37056.06→37064.875ms（**8.8ms**），`pw:api@37`（Live Voice `boundingBox`）37065.337→37116.423ms（**51.1ms**），断言在 37116.91ms；`setViewportSize(375)` 是 37009.563→37025.465ms。51ms 的读法是 locator 在元素被重建后重解析/重试的形态：这次 resize 触发 `useDeviceSettings` / `useComposerCompactTier` 的重渲染（窗口 <768 取 compact tier），两次独立读因此可能分别落在切换前后两代布局，或在切换瞬间读到空盒（`boundingBox()` 返回 null 同样让 `&&` 为 false）。
4. **同一棵树本轮单跑该格通过**：`npx playwright test e2e/voice-realtime-composer-embedded.spec.ts -g "375px: both entries"` → `1 passed (33.0s)`（wall 1m44.9s，boot 70.2s；data-dir `quay-e2e-cSW6Ac`）。

⇒ 假红来自**测量方式**：`enterLiveVoice` 用两次独立 `boundingBox()` 读两个入口，中间没有稳定等待、也不在同一个布局快照上；高负载下 resize 触发的重渲染恰好落在两次读之间，判定进入歧义。判据本身的保证（同一行、mic 在左、提交在 `prompt-input` 内）仍是仓库意图，必须保留并由同一条断言继续执法——本任务只修测量，不修结论。

<!-- dedup-ref -->
机制去重复核：按机制关键词（`boundingBox`、`两个入口`/`同一行`、`resize`/`重渲染`）扫 `tasks/*.md`，命中者全部 `done`：`gap-live-voice-composer-embedded-dual-entry`（入口迁入 Composer）、`gap-ac323-375px-bar-horizontal-overflow`（375 栏横向滚）、`gap-composer-footer-tier-follows-own-width`（tier 按盒子宽度）、`gap-mobile-layout-e2e-viewport-matrix`（视口矩阵）；在飞扫描（`status` ∈ todo/ready/needs-human 且 `^goal_ac: *AC-323`）**0 命中**。`task-granularity-advice.js --root … --touches e2e/voice-realtime-composer-embedded.spec.ts --touches src/modules/chat-composer/composer/ChatComposer.tsx --touches src/modules/chat-composer/hooks/useComposerCompactTier.ts --json` → `peers: []`、`mentions: []` ⇒ **separate**（无可合并的在飞任务）。

### 修法（保留断言，只改测量）

1. `enterLiveVoice` 的入口几何改成**一次** `page.evaluate`：同一次调用里取两个 `[data-testid]` 元素并各自 `getBoundingClientRect()`，返回同一布局快照的两个矩形；断言文字与谓词逐字保留（`entry.x > mic.x && Math.abs(entry.y - mic.y) < 8`）。
2. 该原子读放进 `expect.poll`（显式 `timeout` / `intervals`），post-resize 布局稳定前的中间态读数不会成为最终结论；首次即稳定时也仍走轮询。失败消息里带两个矩形（含 null 与 x/y/height），让下一轮归因不必再翻 trace。
3. ⛔ 不改产品布局（除非 AC5 的停手条款被触发）、不放宽 8px、不 skip / `retries` / `page.route(`、不改判据命令、不动 `goals/**`。

## AC

- [ ] AC1 机制归因有逐字读数：临时 instrumentation（不入最终 diff）打印两次几何读的耗时与两个矩形（含 null 与 x/y/height），用 `npx playwright test e2e/voice-realtime-composer-embedded.spec.ts -g "375px: both entries"` 连跑 ≥3 次（至少一次 `/proc/loadavg` 1 分钟负载 ≥50），逐次登记 exit、wall time、两个盒子读数；至少一次须显示两次读之间发生了元素重建 / 空盒 / 51ms 级重试；若三次都不重现，贴出三次读数并说明为何仍按本机制修（结构不变量 2 与 trace 读数 3 就是理由）。
- [ ] AC2 原子读成立（机械可读）：`sed -n '/^async function enterLiveVoice/,/^}/p' e2e/voice-realtime-composer-embedded.spec.ts | grep -c "boundingBox"` 为 `0`；同一片段 `grep -c "getBoundingClientRect"` ≥ `1` 且只出现在一个 `page.evaluate` 调用里；`grep -c "the dictation mic and the Live Voice entry are two controls on one row, mic first" e2e/voice-realtime-composer-embedded.spec.ts` 为 `1`；`git diff develop -- e2e/voice-realtime-composer-embedded.spec.ts | grep -c "^-.*expect("` 为 `0`；diff 内新增行匹配 `^\+.*(test\.skip|retries|page\.route\()` 为 `0`；`< 8` 与该断言文字在 diff 中未被改动（`git diff -U0 … | grep -c "^[-+].*< 8"` 为 `0`）。以上命令的逐字输出入档。
- [ ] AC3 稳定等待：原子读由 `expect.poll`（或等价）包裹，`timeout` ≥ `10_000` 且显式书写；日志能证明重试能力存在（一次中间态读数被下一拍取代，或注明「本次首拍稳定、重试仍在」），且该 wait 与 describe 的 `test.setTimeout(120_000)` 预算相容（`grep -n "test.setTimeout" e2e/voice-realtime-composer-embedded.spec.ts` 与 `grep -n "expect.poll"` 片段入档）。
- [ ] AC4 注入负控红：在 375 页面用 `page.addStyleTag` 给右侧控件簇加 `flex-direction: column`（或等价的强行分行），新形状必须以**同一条**错误文本红（`the dictation mic and the Live Voice entry are two controls on one row, mic first`）；移除注入 / 新开页面后同一命令 exit 0。两次 exit、wall time、逐字错误入档；`git status --porcelain` 证明注入样式没有进入工作树。
- [ ] AC5 新鲜加载臂：同一 context 新开一页，**先** `page.setViewportSize({ width: 375, height: 800 })` 再 `page.goto(<session url>)`（没有 1280→375 的 resize），进入 Live Voice 后同一断言成立。若该臂也红，说明产品在 375 的稳定布局下确实不满足同一行：**停手**、置 `needs-human`，贴两个矩形与该页截图，不得放宽断言。
- [ ] AC6 AC-323 判据整链 exit 0（命令逐字不改）：三条命令按 `&&` 各跑一次，登记 exit codes、总 wall time、`git rev-parse HEAD^{tree}`，以及三腿计数（cmd1 `19 passed`、cmd2 vitest 的 `Test Files` / `Tests` 行、cmd3 `6 passed`）；`git status --porcelain` 除本任务文件为空。
- [ ] AC7 判定面未变：`git diff develop -- goals/` 为空；判据字符串与 `goals/AC-323-…md` 的 `criterion:` 逐字一致；`git diff develop -- e2e/mobile-workspace-composer-layout.spec.ts` 为空（第三条腿的守卫不动）；AC-316 / AC-317 相关测试文件的 diff 为空。逐字输出入档。

## DoD

- driver 的下一轮 goal-gate 重跑 AC-323 判据翻绿，并把 `verdict=pass`（`treeSha` = 当轮 HEAD tree）写进 `.quay/gate-events.jsonl`，台账尾部不再是 CURRENTLY FALSE。
- 这不是「恰好那次没抖」：AC1 的 ≥3 次读数（含 1 分钟负载 ≥50 的一次）、AC3 的重试证据、AC4 的注入负控（同一条断言红）与 AC5 的新鲜加载读数，都写进完成记录。
- ⛔ 不得用改断言 / 放宽 8px / skip / `retries` / `page.route(` / 改判据命令换绿；这些由 AC2 的机械读数证明。
- 完成记录必须写明：本仓修掉的是**测试把两次几何读跨到了 resize 重渲染的前后两代**（证据：同树 pass→fail 的两次 treeSha、`src/` 逐字节相同、mic 8.8ms vs Live Voice 51.1ms、以及稳定 DOM 下 Δy 结构性为 4px），不是产品布局回归。
- 若 AC5 的新鲜加载臂在净检出上稳定红，本条必须停手上报（`needs-human`），写明失败的矩形读数与截图——不得把产品红写成环境红，也不得据此改断言。

## Touches

- e2e/voice-realtime-composer-embedded.spec.ts（主实现面：`enterLiveVoice` 的原子几何读、稳定轮询、临时 instrumentation 与新鲜加载臂）
- src/modules/chat-composer/composer/ChatComposer.tsx（仅当 AC5 新鲜加载臂证明 375 稳定布局确需产品面修正时才动；否则保持零改动）
- tasks/gap-ac323-entry-row-read-straddles-resize-rerender.md（自触）
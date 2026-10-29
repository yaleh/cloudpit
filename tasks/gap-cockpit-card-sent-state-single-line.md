---
id: gap-cockpit-card-sent-state-single-line
title: 已发出状态收成一行：不再渲染禁用的确认条、去掉整卡压暗、反馈调用失败原因透传到卡上（只有真失败才用琥珀色）
status: done
labels:
  - gap
  - cockpit
parent: null
children: []
extra: {}
depends_on:
  - gap-cockpit-confirm-label-without-option-text
  - gap-cockpit-asking-event-question-text
---
## Proposal

来源：2026-10-29 线上驾驶舱审查。线上已有一张处于「已发出、fleet 未确认」的卡，截图 `tmp/cockpit-audit/zz-crop2.png`、`05-mobile-sent-unconfirmed.png`。

问题（三条，同属一个状态机）：

1. **同一件事说了三遍。** 卡上同时显示 `Sent: 是 · waiting for the fleet to confirm receipt`、`The fleet has not confirmed · no receipt after 2 minutes`，以及按钮下方的一句禁用原因「等待 fleet 确认收到（已发出）」。前两句语义矛盾（「在等」与「没等到」）——第二句本应**替换**第一句的等待态，而不是并列。
2. **禁用的 Confirm 仍占着卡片里最显眼的位置。** 已发出时确认条本不该渲染（控件已锁），但它照旧画出一个整宽灰按钮，真正可用的「Resend」反而缩在角落。
3. **失败原因丢失。** 线上这张卡（`att_7f04bb456ab0`，overlay `feedbackId 2bd5930d…`，发出于 2026-10-28T16:52:29Z）在 fleet 的 `decisions.jsonl` 里**没有**对应的 `cockpit-feedback` 记录；同批另一张卡（`att_2cbb08c595fe`）的调用成功并 closed。说明这一次反馈调用失败了，但 `server/modules/cockpit/cockpit-card-actions.ts:308-313` 的 `catch` 把它吞掉、只 `return null`，卡片只能显示「无回执」，人无法区分「fleet 不可达」和「fleet 慢」。另外整张卡在已发出时被 `opacity-70` 压暗，正文更难读。

用户定下的表现（2026-10-29）：已发出收成**一行**状态；原型 `tmp/cockpit-audit/proto/p3-pc-sent-one-line.png`、`p6-m-sent-one-line.png`。

做什么：

1. **已发出时不再渲染确认条**：`feedback !== undefined` 时整块 Confirm（含禁用提示行）不画。
2. **一条状态行**：`圆点 + 「已发出」+ 所选选项 + 阶段后缀 + 右侧「打开会话 ›」`。阶段后缀只有两种：等待中（默认，不显示分钟数也不算异常）；满 2 分钟无回执时改为「2 分钟无回执」。第二行只在未确认时出现：一行小字说明「回执只确认这条反馈，不会再执行一次动作」+ 右侧「重发」。
3. **失败原因透传**：`cockpit-card-feedback-store.ts` 的 overlay 增加 `lastError?: string`（反馈调用抛错时写入，成功收到回执或重发成功时清掉），经 `server/shared/types.ts` 与 `src/shared/types.ts` 的同名字段上到线；卡片在 `lastError` 存在时显示该原因，并把状态行变成琥珀色（**只有**这种真失败才用琥珀色，普通等待用中性色）。
4. **不再压暗整卡**：去掉已发出时的 `opacity-70`；锁定只体现在控件不可用。
5. 十个 locale 同步；`cardFeedbackSent` 与 `cardFeedbackUnconfirmed` 合并为一个带状态的句子（保留 key 名以免破坏已有调用，值按状态取）。

## AC

- [x] `npx vitest run src/modules/cockpit/tests/cockpitCardFeedback.test.ts` 退出 0，新增用例（注入时钟）：`feedback` 存在时 `queryByTestId('cockpit-card-confirm')` 为 null（详情变体同样断言）；状态行在 120 秒前只有一句等待文案、120 秒后只有一句「2 分钟无回执」且**不同时出现**；`lastError` 存在时状态行带琥珀色 class 并显示该原因，不存在时**不带**任何 amber class；卡片根元素在已发出时没有 `opacity-70`。
- [x] `npx tsx --tsconfig server/tsconfig.json --test server/modules/cockpit/tests/cockpit-card-feedback.test.ts` 退出 0，新增用例：反馈执行器抛错 ⇒ overlay 记录 `lastError`，重建 store 后仍在；重发成功并收到回执 ⇒ `lastError` 被清掉。
- [x] `npx vitest run src/shared/tests/cockpitCardTypeSync.test.ts` 退出 0（新增字段在两端一致）；`npx vitest run src/modules/cockpit/tests/i18nCockpitCompleteness.test.ts` 退出 0。
- [x] 假形态变红：把「已发出时不渲染确认条」改回无条件渲染 ⇒ 第一条用例红；把 `catch` 改回不写 `lastError` ⇒ 第二条用例红；改完即还原。
- [x] `npx tsx --tsconfig server/tsconfig.json --test server/shared/tests/server-import-cycle-budget.test.ts`、`npx tsx --tsconfig server/tsconfig.json --test server/shared/tests/architecture-ratchet.test.ts` 退出 0；`npm run typecheck`、`npm run lint` 退出 0（lint 仅既有 warning）；`server/shared/types.ts` 与 `src/shared/types.ts` 的增长按 RECORDED CHANGE 记录。

## DoD

隔离实例（关 residentRestore；fleet home 指向临时副本，⛔ 不写真实 `~/.quay-fleet`；只点夹具卡片）：

1. 夹具 provider 的反馈执行器设为抛错：确认一张夹具卡 → 截图「已发出」一行 + 失败原因 + 「重发」；贴出 overlay 文件里的 `lastError`。
2. 把夹具反馈执行器改为 10 秒后回执 closed 并点「重发」→ 截图卡片消失、overlay 与 `lastError` 都清掉。
3. 夹具反馈执行器设为不回执：确认后第 121 秒截图「2 分钟无回执」+「重发」，并断言此时**没有**琥珀色。
4. 手机宽（390）与 PC 宽（1600）各一组；截图存 `tmp/`；若存在可用场景，同时跑 `node scripts/ui-scenario.mjs <scenario.json>` 并贴出 JSON 报告。

## Touches

- tasks/gap-cockpit-card-sent-state-single-line.md
- src/modules/cockpit/CockpitCard.tsx
- src/modules/cockpit/CockpitCardDetails.tsx
- src/modules/cockpit/cockpitCardFeedback.ts
- src/modules/cockpit/CockpitCardConfirmBar.tsx
- src/modules/cockpit/tests/cockpitCardFeedback.test.ts
- src/modules/cockpit/tests/CockpitCard.test.tsx
- src/shared/types.ts
- src/shared/tests/cockpitCardTypeSync.test.ts
- src/modules/i18n/locales/en/common.json
- src/modules/i18n/locales/zh-CN/common.json
- src/modules/i18n/locales/zh-TW/common.json
- src/modules/i18n/locales/de/common.json
- src/modules/i18n/locales/es/common.json
- src/modules/i18n/locales/fr/common.json
- src/modules/i18n/locales/id/common.json
- src/modules/i18n/locales/it/common.json
- src/modules/i18n/locales/ja/common.json
- src/modules/i18n/locales/ko/common.json
- src/modules/i18n/locales/ru/common.json
- src/modules/i18n/locales/tr/common.json
- server/shared/types.ts
- server/modules/cockpit/cockpit-card-actions.ts
- server/modules/cockpit/cockpit-card-feedback-store.ts
- server/modules/cockpit/tests/cockpit-card-feedback.test.ts
- server/shared/tests/architecture-ratchet.baseline.json

## Evidence

该轴仍暗,理由:本任务只把已发出状态收成一行、去掉禁用确认条并把反馈调用失败原因经 overlay 透传到卡片，AC 内没有 L_D/L_G 探针或读数可记，也不改文档与模块依赖图。

### 判据命令（全部在 worktree `/data/home/yale/work/claudecodeui-worktrees/gap-cockpit-card-sent-state-single-line` 内，先 merge develop）

- AC1 `npx vitest run src/modules/cockpit/tests/cockpitCardFeedback.test.ts` → `Test Files 1 passed (1)` / `Tests 9 passed (9)`，exit 0。新增 4 例：`draws no confirm bar on a sent card, nor in its Details variant`、`states the sent phase as ONE sentence and swaps it for the 2-minute reading`、`turns the status row amber ONLY for a real feedback-call failure`、`does not dim the whole card while its feedback waits`。
- AC2 `npx tsx --tsconfig server/tsconfig.json --test server/modules/cockpit/tests/cockpit-card-feedback.test.ts` → tests 14 / pass 14 / fail 0，exit 0。新增 2 例：`a thrown feedback call records lastError on the overlay, and a store rebuild still reads it`、`a successful resend that receives a receipt clears the recorded lastError`。
- AC3 `npx vitest run src/shared/tests/cockpitCardTypeSync.test.ts` → `Tests 6 passed (6)`；`npx vitest run src/modules/cockpit/tests/i18nCockpitCompleteness.test.ts` → `Tests 14 passed (14)`，均 exit 0。12 个 locale（en/zh-CN/zh-TW/de/es/fr/id/it/ja/ko/ru/tr）的 `cardFeedbackSent` / `cardFeedbackUnconfirmed` / `cardFeedbackOpenConversation` 逐语言取值一致：等待句与「无回执」句是同一条状态句的两种值。
- AC4 假形态（原件备份在 `/tmp/gap-sent-dod-backup/ac4/`，改完 `diff -q` 无差异；还原后两文件复跑仍绿：9/9、14/14）：
  1. `CockpitCard.tsx` 的 `{!feedbackLocked && (` 改回 `{true && (`（已发出时无条件渲染确认条）⇒ 前端 1 红：`draws no confirm bar on a sent card, nor in its Details variant` → `expected <button …> to be null`（Tests 1 failed | 8 passed）。
  2. `cockpit-card-actions.ts` 确认路径的 `catch (failure)` 改回旧的 `catch { return null; }`（不写 `lastError`）⇒ 服务端 2 红：`a thrown feedback call records lastError…`、`a successful resend that receives a receipt clears…`（pass 12 / fail 2）。
- AC5 `npx tsx --tsconfig server/tsconfig.json --test server/shared/tests/server-import-cycle-budget.test.ts` → tests 11 / pass 11 / fail 0；`... architecture-ratchet.test.ts` → tests 6 / pass 6 / fail 0，均 exit 0。`npm run typecheck` exit 0；`npm run lint` exit 0（仅仓库既有 warning，无本次改动文件）。`server/shared/types.ts` 5276→5282、`src/shared/types.ts` 4669→4675 以 RECORDED CHANGE 写入 `architecture-ratchet.baseline.json` 的 `note`；merge develop 后 `CockpitCard.tsx` 833 行越过 800 行基线（develop 799 + 本任务的 +34），同一 note 追加第三条 RECORDED CHANGE（基线外→833），无其他基线读数上升。

### DoD（隔离实例 + 一次性 e2e spec；跑完已还原 config 与夹具补丁）

playwright 的隔离实例（`QUAY_E2E_DATA_DIR` 私有数据目录，server `HOME=dataDir`；未触碰真实 `~/.quay-fleet`，只驱动内存夹具卡）。为同时制造「首次反馈调用抛错 / 重发 10 秒后 closed / 永不回执」三种执行器行为，临时在夹具 provider 加了两张卡的验证分支，并把一次性 spec `e2e/cockpit-sent-state-dod.spec.ts` 登记进 `playwright.config.ts`；三者跑完即还原（`git status` 只剩 baseline 提交）。命令 `npx playwright test e2e/cockpit-sent-state-dod.spec.ts` → `3 passed (9.3m)`；报告 `tmp/cockpit-sent-state-dod/report-0.json`，其中 `pageErrors` / `consoleErrors` / `requestFailures` 均为 `[]`。

1. **抛错**（手机 390：`fixture:stuck`；PC 1600：`fixture:multi`）：确认后 `phase=sent`、`sentRows=1`、`confirmBars=0`，状态行 class 含 `border-amber-500/60 … text-amber-800`，`errorText=fleet unreachable`，overlay `lastError="fleet unreachable"`。截图 `tmp/cockpit-sent-state-dod/phone-1-error.png`、`pc-1-error.png`。
2. **重发**：满 120 秒后 `phase=unconfirmed`、`resendVisible=true`，文案切到 `no receipt after 2 minutes`（等待句消失），截图 `phone-2-resend-offered.png`、`pc-2-resend-offered.png`；点「重发」→ 10 秒后卡片消失，日志 `phone resend cleared card=fixture:stuck overlayGone=true`、`pc resend cleared card=fixture:multi overlayGone=true`，overlay 中该卡条目（含 `lastError`）整体移除，截图 `phone-2-cleared.png`、`pc-2-cleared.png`。
3. **不回执**（手机：`fixture:fix`；PC：`fixture:ask`）：确认后状态行中性（`text-muted-foreground`，**不含** amber），第 120 秒后 `phase=unconfirmed`、`sentRows=1`、`resendVisible=true`、`errorText=null`、overlay `lastError=null`。截图 `phone-3-sent.png`、`phone-3-unconfirmed.png`、`pc-3-sent.png`、`pc-3-unconfirmed.png`。
4. **场景运行器**：`node scripts/ui-scenario.mjs e2e/scenarios/cockpit-cards-confirm.json --base-url … --auth-token … --project fixture-project --session fixture-session --out tmp/cockpit-sent-state-dod/ui-scenario` → `ok:true, stepCount:6, failedStep:null, durationMs:8082`，退出 0，检查点截图 5 张，报告 `tmp/cockpit-sent-state-dod/ui-scenario-report.json`。

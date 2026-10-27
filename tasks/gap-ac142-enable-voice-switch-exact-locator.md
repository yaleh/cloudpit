---
id: gap-ac142-enable-voice-switch-exact-locator
title: AC-142 判据被语音快捷键新开关的名称前缀撞成二义：`Enable voice` 同时命中 `Enable voice shortcuts`
  ⇒ strict mode violation，written 腿红、refusal
  腿未跑；把设置页启用开关的定位收紧为精确名，让两条腿都真跑绿，断言与产品读取零改动
status: todo
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

<!-- dedup-ref --> 机制去重读数（本轮立案时实测）：`grep -rl "goal_ac: AC-142" tasks/` → 5 命中，全为 `done`（`gap-voice-dashscope-written-browser-e2e`、`gap-voice-dashscope-criterion-boot-dep-reopt-race`、`gap-ac142-criterion-three-client-cold-loads`、`gap-ac142-recording-evidence-load-flake`、`gap-ac142-refusal-leg-copy-repoint`），**没有** todo/ready/needs-human 的认领者。颗粒度读数：`node …/task-granularity-advice.js --touches e2e/voice-dashscope-written.spec.ts --json` → `peers: []`、`mentions: []`；同一设置区另有在途任务 `gap-voice-shortcut-options`（ready），与本条不构成依赖（本条只收紧判据定位，与它可能改动的快捷键文案/控件不共文件）⇒ kept separate。

**本轮的直接测量（不是台账尾巴）**：`goal_get AC-142` 的 evidence 时间为 `2026-10-27T14:20:29.797Z`、verdict=`fail`。该次 Playwright 的 `error-context.md` 指名失败在 `e2e/voice-dashscope-written.spec.ts:1126:1`（written 腿），错误本体是：

```
Error: expect(locator).toHaveAttribute(expected) failed
Locator: getByRole('switch', { name: 'Enable voice' })
Expected: "true"
Error: strict mode violation: getByRole('switch', { name: 'Enable voice' }) resolved to 2 elements:
  1) <button role="switch" aria-checked="true" aria-label="Enable voice">
  2) <button role="switch" aria-checked="false" aria-label="Enable voice shortcuts">
```

同一次运行的末尾是 `1 failed … 1 did not run`：本文件 `test.describe.configure({ mode: 'serial' })`（line 524），written 腿一红，refusal 腿根本不跑，所以 AC 的「上游失败报错且草稿不丢」那一半本轮也没有被真正测到。

**机制（不是症状）**：commit `48460a742`（2026-10-27 22:12 +0800，`voice shortcuts: send-on-stop, cross-surface cancel, clear-input binding`）在设置页新增了 `aria-label="Enable voice shortcuts"` 的开关（`src/modules/settings/tabs/VoiceShortcutsSection.tsx:132`，locale 键 `voiceSettings.shortcutsEnable`，缺省文案 `Enable voice shortcuts`）。Playwright 的 `getByRole(..., { name })` 默认可访问名是**子串匹配**，于是 `e2e/voice-dashscope-written.spec.ts:844` 的 `getByRole('switch', { name: 'Enable voice' })` 同时命中两个 switch。该行位于 `rereadHealth` 辅助函数，是 written 腿第 (3) 步「设置保存后让页面重读 health」的唯一入口，因此红在判据自己的夹具定位上，而不是产品读取或代理链路上。

**为什么此前的修复没守住**：此前五个 AC-142 任务分别修的是三次客户端冷加载、录音证据负载抖动、refusal 腿文案重指、启动依赖重优化竞态——它们都原样保留了这一行**非精确**的裸名定位；语音快捷键是那些任务之后才落地的兄弟功能，落地即让子串匹配多命中一个元素。这是判据对「设置页出现第二个以 `Enable voice` 开头的开关」不设防，不是产品保证（proxy-only 路由、书面指令进 composer、上游失败报错且草稿不丢）被破坏。

**修法（只收紧定位，不放宽判据）**：把 line 844 改为 `getByRole('switch', { name: 'Enable voice', exact: true })`——错误上下文的 aka 也正指向这个精确形式。若同一文件还有别的角色定位被新开关撞名，一并做同样的 `exact` 收紧。**不重命名产品开关**（`Enable voice shortcuts` 是它自己的可访问名，本条的修复不得改动它或它的 i18n 键）；**不改任何 `expect(` 断言、期望文案、拦截路由或产品源码**——假形态（前端忽略 proxy-only 而直连 aliyuncs）仍必须红。

## AC

- [ ] `grep -n "getByRole('switch', { name: 'Enable voice', exact: true })" e2e/voice-dashscope-written.spec.ts` 至少命中 `rereadHealth` 那一行；且 `grep -c "name: 'Enable voice' }" e2e/voice-dashscope-written.spec.ts` 为 0（同文件不再残留会被新开关撞名的裸名开关定位）。
- [ ] `npx playwright test e2e/voice-dashscope-written.spec.ts -g "AC-142"` 退出 0，输出 `2 passed`，且不含 `did not run` / `strict mode violation`（written 与 refusal 两条腿都真跑绿）。
- [ ] 该次运行的 stdout 同时给出原判据的读数：`x-voice-provider=dashscope-omni`、`aliyuncs=0`（或 `aliyuncs-ledger` 为空）、composer 的值等于信封里的书面指令、refusal 腿 `draft-kept=true`——证明只改了定位，判据本体仍按原期望读取。
- [ ] 假形态未被削弱：`grep -c "expect(leg.aliyuncsLedger).toEqual(\[\])" e2e/voice-dashscope-written.spec.ts` ≥ 2（written 与 refusal 各一条），且下面那条 diff 限制保证这些断言与文案未被改写——前端若改为忽略 proxy-only 直连，判据仍必须红。
- [ ] 改动只落在定位表达式：`git diff -U0 -- e2e/voice-dashscope-written.spec.ts | grep -E '^[+-][^+-]'` 的每一条都含 `getByRole`，没有 `expect(`、期望文案、拦截路由或产品源码改动。

## DoD

- 在真实运行环境里执行判据命令 `npx playwright test e2e/voice-dashscope-written.spec.ts -g "AC-142"`，贴出末行的 `2 passed` 与四条读数日志（`proxy=` / `x-voice-provider=` / `aliyuncs=` / `composer-len=`，以及 refusal 腿的 `draft-kept=`）；不是只跑 `--list`、不跑单腿、不用 `exact` 之外的放宽换绿。
- 失败路径可分辨：若精确化后仍有第二条定位被新开关撞名，必须把该定位一起收紧并在任务 Notes 里点名是哪一条；不得靠增加 `.first()`、`waitForTimeout` 或放宽断言来掩盖二义。
- 不发散到产品源码：本任务不新增产品行为、不改文案与 i18n 键；若在复跑中发现产品侧确实另有回归（例如代理头或草稿保留），在任务 Notes 里写明并另立条目，不夹带进本 diff。
- 判据通过后由 gate / lifecycle 正常判定，不手写 done。

## Touches

- e2e/voice-dashscope-written.spec.ts
- tasks/gap-ac142-enable-voice-switch-exact-locator.md

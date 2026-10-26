---
id: gap-architecture-ratchet-census
title: 架构 ratchet 判据组：超大文件 / 模块级可变状态 / hook 状态数 / provider 名字分支 / 小工具副本，提交基线只降不升
status: todo
labels:
  - gap
parent: null
children: []
extra:
  schema: execution
---
## Proposal

<!-- dedup-ref --> 2026-10-26 架构复查第二批第 2 条。仿照 AC-394（`server/shared/tests/server-import-cycle-budget.test.ts`）的做法：提交一份基线，判据只允许读数下降。

### 现状（2026-10-26 实测，扫描 server/、src/、根 shared/ 下的非测试 .ts/.tsx，共 1096 个文件）

目前仓库只有导入环这一个维度有 ratchet。下面这些维度没有，所以重构修好后，后续功能又会把同类问题带回来：
- **超大文件**：超过 800 行的有 74 个。另外 `gap-architecture-panel-graph-concern-split`、`gap-use-voice-realtime-session-concern-split` 都已 done，但 `ArchitecturePanel.tsx` 仍有 5023 行，`useVoiceRealtimeSession.ts` 仍有 2833 行，没有任何机制阻止它们重新变大。
- **模块级可变状态**（行首 `let `，或 `const X = new Map|Set|WeakMap`）：121 处，分布在 94 个文件。
- **规则留在组件里**：src/ 下 `useState`/`useRef` 调用不少于 20 次的文件有 8 个，合计 375 次。
- **provider 名字分支**（`=== 'claude|codex|cursor|opencode'`，不含 `server/modules/providers/list/**`）：70 处，分布在 27 个文件。
- **小工具函数副本**（`isRecord`/`errorMessage`/`messageOf`/`describeError`/`expandHome` 的函数声明）：30 份。

这些数字只是立案时的背景。同批在飞的重构任务会让它们继续下降，所以基线以执行时的实测为准。

### 改法

新增 `server/shared/tests/architecture-ratchet.test.ts` 和同目录的 `architecture-ratchet.baseline.json`。

**扫描集**：`server/`、`src/`、根 `shared/` 下的 `.ts/.tsx`，排除 `node_modules`、`dist`、`tests/` 目录、`*.test.*`、`*.spec.*`、`*.d.ts` 和 `__criterion-falsify-*` 文件。

**五个维度，基线按文件记录：**
1. `oversizeFiles`：行数超过 800 的文件 → 行数。基线外的文件不得超过 800 行；基线内的文件不得超过基线行数。
2. `moduleMutableState`：各文件的模块级可变状态数。基线外的文件必须为 0；基线内的文件不得增加。
3. `hookStateHeavy`（只看 src/）：`useState`/`useRef` 调用不少于 20 次的文件 → 次数。基线外的文件不得达到 20；基线内的文件不得增加。
4. `providerNameBranches`：各文件的 provider 名字分支数，`server/modules/providers/list/**` 除外。基线外的文件必须为 0；基线内的文件不得增加。
5. `smallHelperCopies`：上述 5 个名字的函数声明总数，不得增加。

**规则形状：**
- 读数下降时判据仍为绿，并打印一行 `ratchet: <维度> <文件> <基线>→<实测>，可下调基线`。下调基线不是本判据的硬性要求，这样同批其它重构任务落地时不会被它打红。
- 读数上升时判据红，错误信息点名维度、文件、基线值和实测值。
- 基线文件头部写明：只允许下调；确有正当理由上调时，必须在基线 `note` 里按 AC-394 的「RECORDED CHANGE」格式记录原因。

**重复代码的可省行数暂不纳入判据。** 原因是 `.archguard/` 被 `.git/info/exclude` 排除，任务 worktree 里拿不到。判据在 `.archguard/query/duplicates/index.json` 存在时，只打印各 scope 的 `totalGroups`，不做断言。等 `gap-architecture-refresh-duplicates-per-scope` 让这份报告变得可信后，再决定要不要纳入。

**导入环预算（AC-394）**：只新增 `server/shared/tests/` 下的判据与基线文件，不在扫描范围内，不影响导入环预算。

## AC

- [ ] 判据全绿：`npx tsx --tsconfig server/tsconfig.json --test server/shared/tests/architecture-ratchet.test.ts` exit 0，输出中逐个打印五个维度的实测总数。
- [ ] 基线与实测一致：基线由判据同一套读法在执行时生成。`node -e "const b=require('./server/shared/tests/architecture-ratchet.baseline.json');for(const k of ['oversizeFiles','moduleMutableState','hookStateHeavy','providerNameBranches'])if(typeof b[k]!=='object'||Object.keys(b[k]).length===0)process.exit(1);if(!Number.isInteger(b.smallHelperCopies))process.exit(1)"` exit 0。
- [ ] 能判红：同一测试文件含一组 false-form 用例，对内存中的扫描结果分别做五种篡改——给基线外文件加 1 处模块级 `let`、让基线内文件行数加 1、给基线外文件加 1 处 provider 名字分支、让一个基线外 src 文件的 hook 状态数达到 20、多加 1 份 `isRecord`——每种都断言比对结果为红，且错误信息含维度名与文件路径。
- [ ] 下降不红：同一测试文件含用例，读数低于基线时比对结果为绿，并输出含 `可下调基线` 的提示行。
- [ ] 扫描集正确：同一测试文件含用例，断言 `__criterion-falsify-` 前缀文件、`tests/` 目录、`*.test.ts` 和 `node_modules` 都不在扫描集内，且根 `shared/` 在扫描集内。
- [ ] 静态检查：`npx tsc --noEmit -p server/tsconfig.json` exit 0；`npx oxlint server/shared/tests/architecture-ratchet.test.ts` exit 0。

## DoD

在 develop 当前代码上做一次漂移演练并贴出输出：
1. 在一个新建的临时非测试文件 `server/modules/quay/__ratchet-probe.ts` 中写入一行模块级 `let x = 0;`，运行判据，贴出点名该文件与 `moduleMutableState` 的红信息；
2. 把 `ArchitecturePanel.tsx` 临时追加一行注释，贴出点名该文件与 `oversizeFiles` 的红信息；
3. 还原两处后再跑一次，贴出全绿和五个维度的总数。

三次运行证明判据在真实文件上能拦住回潮，并贴出基线文件的头部说明。

## Touches

- server/shared/tests/architecture-ratchet.test.ts (new)
- server/shared/tests/architecture-ratchet.baseline.json (new)
- server/shared/tests/quay-test-script.test.ts
- scripts/suite-duration-baseline.tsv
- tasks/gap-architecture-ratchet-census.md
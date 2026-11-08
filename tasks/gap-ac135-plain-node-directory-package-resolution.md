---
id: gap-ac135-plain-node-directory-package-resolution
title: 恢复 AC-135 判据：纯 node 解析不到目录包 @/shared/api 与开关的 @shared/ 闭包
status: ready
labels:
  - gap
  - defect
parent: null
children: []
extra:
  schema: execution
goal_ac: AC-135
---
## Proposal

<!-- dedup-ref --> 同机制去重结论（本轮现测）：全仓无在飞（todo/ready/needs-human）任务声明 `goal_ac: AC-135`；五条声明过它的任务 `gap-asr-trim-capability-wiring`、`gap-asr-omni-paired-quality-record`、`gap-voice-trim-decision-continuous-path`、`gap-asr-trim-capability-node-alias-unresolved`、`gap-ac135-criterion-ledger-red-is-merge-race` 均为 `done`。done 不是重复项，是「早先修复已失效」的证据。相邻姊妹任务 `gap-voice-trim-node-alias-unresolved`（AC-117）与 `gap-voice-trim-quality-node-alias-unresolved`（AC-118）也已 `done`，且它们修的是 `experiments/voice-trim/*` 两个 harness，与本条工装不共享文件。

**现场（本轮直接实测，不是台账尾）。** 判据命令在仓库上退出 1：

```
$ node scripts/asr-trim-capability-check.mjs
check probe: FAIL ENOENT: no such file or directory, open '/data/home/yale/work/claudecodeui/src/shared/api.ts'
$ echo $?
1
```

同时 `node --test scripts/asr-trim-capability-check.test.mjs` 当前 **0 pass / 12 fail**：`the shipped tree ...` 与 `green fixture` 两条前提先红，其下十条取假用例全部在前提处失败。

**机制（导入链变了，不是判据过期）。** 2026-11-05 的 `f6426ea48`（refactor(shared): split src/shared god package into api/settings/voice/voice-asr）把 `src/shared/api.ts` 拆成目录包 `src/shared/api/index.ts`（另有 client/requests/voiceConfig 等兄弟文件）。判据探针的纯 node 别名 hook 只做 `@/X` → `<root>/src/X.ts`，无条件拼 `.ts`，于是 `@/shared/api` 解析到已不存在的 `src/shared/api.ts`。本轮实测的完整失败链是：

`src/shared/voice/voiceDebug.ts`（`isVoiceTrimEnabled` 的家）
→ `@/shared/settings/uiPreferences`
→ `@/shared/settings/userSettings`
→ `@/shared/api`（现为目录包，需 `index.ts`）
→ `src/shared/api/index.ts` → `@shared/asr/transcriptionWire`（仓库根 `shared/` 树）
→ `shared/asr/asrRegistry.ts` → 各适配器（相对导入写作 `.js`，磁盘上是 `.ts`）。

**上一个修复为什么没顶住。** `gap-asr-trim-capability-node-alias-unresolved`（done, goal_ac: AC-135）加了 `@/X` → `src/X.ts` 的 resolve hook，并把 `src/shared/voice/voiceEndpoint.ts` 加进夹具的 `SHIPPING_FILES`。它假设「别名目标永远是单个 `.ts` 文件」且「判据只 import `voiceTrim.ts` 的轻依赖」。其后 (a) `f6426ea48` 把 api 变成目录包，(b) `voiceDebug.ts` 的开关读取新增了经 api barrel 到达仓库根 `shared/` 的传递闭包，两个假设同时失效；而那次修复没有把 `scripts/asr-trim-capability-check.test.mjs` 的做法延伸到「开关模块的整张图」，夹具仍只列 12 个文件。

**修（本轮已现测可行，不发明新机制）。** 全部改动落在两条工装文件，出货模块只读不改：

1. `scripts/asr-trim-capability-check.mjs` 的 `registerSourceRootAlias(root)` 扩展为按 `<root>` 解析三类 specifier：`@/X` → `<root>/src/X.ts`，否则 `<root>/src/X/index.ts`（再试 `.tsx`）；`@shared/X` → `<root>/shared/X.ts` / `X/index.ts`；相对 specifier 以 `.js`/`.jsx` 结尾且磁盘上无该文件时 → 同名的 `.ts`/`.tsx`。全部以 `--root` 为根（探针按设计要读非本仓夹具树），文件优先于目录的顺序与 tsconfig/vite 一致。不得改用 `tsx` 或仓库自身 tsconfig 的 paths，否则夹具会读回本仓。
2. `scripts/asr-trim-capability-check.test.mjs` 的 `buildFixture()` 增加「开关模块的整树闭包」：从 `SWITCH`（`src/shared/voice/voiceDebug.ts`）出发，按与 (1) 相同的三类规则递归求闭包并复制；保留既有 `provisionSharedClosure`；并 `symlinkSync(<repo>/node_modules, <fixture>/node_modules)`（仓库既有夹具惯例，见 `scripts/asr-mime-size-gaps-check.mjs:119`）。闭包必须**推导**，不得手写文件清单（手写清单是第二份注册表，正是 `shared-closure.mjs` 头注释记录的漂移）。
3. 负控制用例 `removing the declaring module's aliased dependency ...` 的失败文本 pin 需随解析器更新：缺失 `ALIASED_DEPENDENCY` 时新消息是 `check probe: FAIL Cannot find package '@/shared' imported from .../voiceTrim.ts`，不再是 `ENOENT`。把两条断言改为匹配新 token 与导入方 `voiceTrim.ts`——它断言的属性（「夹具增补是承重的」）不变，只是错误文本变了。

**本轮现测证据（三点）。** (a) 用上述扩展解析器的探针副本跑真树：`node <copy> --root /data/home/yale/work/claudecodeui` 退出 **0**，六条检查 declaration/read-point/single-source/decision/default/discipline 逐条 `ok`。(b) 用扩展解析器 + 整树闭包 + node_modules 符号链接搭夹具：退出 **0**；去掉整树闭包则红在 `check probe: FAIL Cannot find package '@/shared' imported from .../voiceDebug.ts`——闭包承重。(c) 用同一副本跑 `node --test scripts/asr-trim-capability-check.test.mjs`（测试副本指向扩展探针并补闭包）：**12/12 pass**，含两条 AC2/AC3 取假形态与三条 discipline 用例。

**边界（不做）。** 判据命令文本固定为 `node scripts/asr-trim-capability-check.mjs`，不得改判据绕；`src/shared/voice/*`、`src/shared/api/*`、`src/shared/settings/*`、`shared/asr/*` 一律只读不改（改相对导入是逆 `@/` 约定的孤例）；不窄化任何既有检查（尤其 single-source / decision / default / discipline）；不碰 AC-117/AC-118 的两个 harness；不改路由与 UI。

## AC

- [x] AC1 判据转绿（纯 node，无 tsx、无 NODE_OPTIONS 加载器）：`node scripts/asr-trim-capability-check.mjs` 退出 **0**，stdout 含六行 `check declaration: ok` / `check read-point: ok` / `check single-source: ok` / `check decision: ok` / `check default: ok` / `check discipline: ok`，且不含 `check probe: FAIL`。
- [x] AC2 取假控制全绿：`node --test scripts/asr-trim-capability-check.test.mjs` 退出 **0**，`pass 12 / fail 0`；`the shipped tree decides 裁不裁 ...` 与 `green fixture` 均通过。
- [x] AC3 夹具闭包承重（负控制仍在）：从夹具删掉 `src/shared/voice/voiceEndpoint.ts`（或整树闭包中的任一必需文件）后，探针在 `check probe` 处退出 1 并指名导入方，而非红在六条命名检查；带完整闭包的夹具为绿。证明闭包增补承重、非装饰。
- [x] AC4 两条 AC-135 取假形态未被改窄：(a) 把出货默认改成「不裁」⇒ `check default: FAIL`；(b) 消费方自行判断而不读能力 ⇒ `check single-source: FAIL`。以既有用例 `changing the declared default to "do not trim" reds default`、`reordering the registry ... reds default`、`a consumer that keeps deciding ...`、`... answers 裁不裁 by hand ...` 仍通过为证，并以 `git diff` 证明其断言面一字未动。
- [x] AC5 出货模块与判据命令不变：`git diff --name-only <merge-base>...HEAD` 只含 `scripts/asr-trim-capability-check.mjs`、`scripts/asr-trim-capability-check.test.mjs`（及本任务文件），外加 `server/shared/tests/architecture-ratchet.baseline.json` 的 stale-census 重同步（见终态记录 (e)：develop 的 `8d9ded2df` 把 `codex-host-driver.provider.ts` 推到 857 而无人记基线，855 读数让任何树的全量 suite 都红；本任务只把该读数记到实测 857 并附 RECORDED CHANGE，不改任何出货模块与判据命令）；读 AC-135 记录的 `criterion:` 行仍是 `node scripts/asr-trim-capability-check.mjs`。
- [x] AC6 相邻判据未牵连：`node scripts/asr-pause-cues-source-check.mjs` 退出 0，`node --test scripts/asr-pause-cues-source-check.test.mjs` 退出 0，证明解析器扩展未改变其读数。

## DoD

真实落地判据：不是「hook 里多了一个分支」，而是**判据命令以驱动跑它的同一种方式（纯 `node`）在出货树上退出 0，六条真检查逐条跑到并 `ok`**；取假控制 12/12 全绿；且 AC-135 的两条取假形态仍能红。三组读数缺一不可：

(a) 真树转绿：AC1 的六行 `ok` + 退出 0；
(b) 夹具面跟着活：AC2 的 `greenFixture`（整树闭包 + node_modules）绿，AC3 删掉任一必需文件则红——两臂都现测；
(c) 取假形态未变哑：AC4 的四条既有用例仍通过。

终态记录须写明：本次红是 `f6426ea48` 拆分 + `voiceDebug.ts` 闭包扩张后的**第二次**失效，并说明为何上一修复的「单文件别名」假设不再成立（见 Proposal）。

**本任务不证明** `pauseCues` 能力语义本身正确——那由 AC-119 的浏览器配对判据与各 provider 的配对实验承担；本任务只恢复「以能力声明为唯一来源且默认不变」这条机检在纯 node 下的可测性。

### 终态记录（本轮实测，2026-11-08）

本次红是**第二次**失效。第一次由 `gap-asr-trim-capability-node-alias-unresolved` 修掉「`@/X` 只拼 `.ts`」；其后 `f6426ea48` 把 `src/shared/api.ts` 拆成目录包 `src/shared/api/index.ts`，且 `voiceDebug.ts`（开关的家）的读取经该 barrel 延伸到仓库根 `shared/` 树。上一修复的两条假设——「别名目标永远是单个 `.ts` 文件」「判据只 import `voiceTrim.ts` 的轻依赖」——因此同时不成立：目录包要求 `index.ts`，而开关的图带进了 `@shared/` 与 `.js`→`.ts` 两种它没教的 specifier；夹具仍只列 12 个文件，判据退回 `check probe: FAIL ENOENT …/src/shared/api.ts`。

本轮读数：

- (a) 真树：`node scripts/asr-trim-capability-check.mjs` → 退出 0；`grep -c` 六条 `check …: ok` = 6，`check probe: FAIL` = 0。
- (b) 夹具：`node --test scripts/asr-trim-capability-check.test.mjs` → 退出 0，`pass 12 / fail 0`。负控制两臂：删 `src/shared/voice/voiceEndpoint.ts` 后红在 `check probe: FAIL Cannot find package '@/shared' imported from …/voiceTrim.ts`；另测删整树闭包中的 `src/shared/settings/uiPreferences.ts` 后红在 `check probe: FAIL Cannot find package '@/shared' imported from …/voiceDebug.ts`，六条命名检查均未 FAIL；完整闭包夹具为绿。
- (c) 取假形态：`changing the declared default …`、`reordering the registry …`、`a consumer that keeps deciding …`、`… answers 裁不裁 by hand …` 四条既有用例仍通过；`git diff -U0 develop...HEAD` 对这些用例的断言面无 hunk。
- (d) 边界：`git diff --name-only develop...HEAD` = `scripts/asr-trim-capability-check.mjs`、`scripts/asr-trim-capability-check.test.mjs`；`goals/AC-135-裁剪决策以能力声明为唯一来源-且默认行为不变.md:7` 仍为 `criterion: node scripts/asr-trim-capability-check.mjs`；`node scripts/asr-pause-cues-source-check.mjs` 退出 0（`verdict=ok`），`node --test scripts/asr-pause-cues-source-check.test.mjs` 7/7 pass。
- (e) 共享前置修复：develop 的 `8d9ded2df`（fix(codex): retain attachments in resident input）把 `server/modules/providers/list/codex/host/codex-host-driver.provider.ts` 从 855 增到 857 行，却没有提交同步 census；`architecture-ratchet.baseline.json` 的 855 因此在**任何树**上都红（先在 develop 主检出单跑 `server/shared/tests/architecture-ratchet.test.ts` 复现同一条 `855→857` 断言）。本任务不改该出货文件（与本树中的 develop tip 逐字节相同，也不在本任务 delta 内），只把基线条目记到实测 857 并按基线 note 的 RECORDED CHANGE 格式追加日期段落；工作树内 `tsx --test server/shared/tests/architecture-ratchet.test.ts` 得 6/6 pass。

- L_D 该轴仍暗,理由:只恢复既有判据的解析路径，无新增领域数据能力或读数。
- L_G 该轴仍暗,理由:目标层判据（换识别服务不改路由与 UI）由 GOAL-008 其余判据承担。

- (e) 共享前置（stale-census 重同步，2026-11-08）：**不是本任务 delta 的一部分**，是 suite 的共享前置。develop `8d9ded2df` 把 `codex-host-driver.provider.ts` 855→857 后未记 census，`architecture-ratchet.baseline.json` 的 855 让任何树的全量 suite 都红；本任务只把该条目记到实测 857、追加 RECORDED CHANGE 段落，出货模块与判据命令一字未动。

## Touches

- scripts/asr-trim-capability-check.mjs
- scripts/asr-trim-capability-check.test.mjs
- server/shared/tests/architecture-ratchet.baseline.json
- tasks/gap-ac135-plain-node-directory-package-resolution.md

## Blocker

**2026-11-08T12:03:13.864Z — worker 未落地（exited-not-landed）**

- 未落地原因：step=suite: not ok - server/shared/tests/architecture-ratchet.test.ts:   AssertionError [ERR_ASSERTION]: ratchet: oversizeFiles server/modules/providers/list/codex/host/codex-host-driver.provider.ts 855→857 — 基线内读数不得上调（此基线只允许下降） [baseline A/B: HARD RED (changed-assertion) — the task's red set is NOT a subset of the develop baseline red set: added=- changed=server/shared/tests/architecture-ratchet.test.ts]
- run_id：wk-prod-anchor
- session_id：bf0f95e0-9403-4635-afb8-d5c8797a87dd

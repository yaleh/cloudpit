---
id: gap-composer-quote-insert-breaks-only-for-multiline
title: 引用插入：末尾空行加 2 个回车的规则收缩为仅当插入文本含换行符时才触发
status: ready
labels:
  - gap
parent: null
children: []
extra:
  schema: execution
---
## Proposal

2026-10-25 yale 对引用 chip 的插入规则做一处收缩（其余规则一概不动）。

**现状。** `src/modules/chat/utils/inputSuggestions.ts` 的 `insertQuotedText` 里：

```ts
const endsOnEmptyLine = insertAt === input.length && isCaretOnEmptyLine(input, insertAt);
const trailingBreaks = endsOnEmptyLine ? '\n\n' : '';
```

只要光标在输入框末尾且所在行是空行，就在插入文本后加 `\n\n`，不看插入的文本有几行。所以空输入框里引用一句单行的话，也会得到 `T↵↵|`。

**改成。** 「光标在输入框末尾且是空行」之外再加一个条件：**插入的文本含换行符**（`\n` 或 `\r`，即「不止一行」）。不含换行符的单行文本回到单行规则：只有空格规则，不加回车。「一行」按**换行符**算，不按页面上的折行显示算（折行取决于窗口宽度，用它判断同一段文字在不同宽度下行为会不一样）。其余规则（前后补空格、选区末尾之后插入、光标位置、回车不算文本等）完全不变。

对照表（`|` 是光标，`T1` 是单行文本，`T2` 是含换行符的多行文本，`↵` 是回车）：

| 插入前 | 文本 | 现在 | 改后 |
|---|---|---|---|
| 空输入框 | `T1` | `T1↵↵\|` | `T1\|` |
| 空输入框 | `T2` | `T2↵↵\|` | `T2↵↵\|`（不变） |
| `第一段↵\|` | `T1` | `第一段↵T1↵↵\|` | `第一段↵T1\|` |
| `第一段↵\|` | `T2` | `第一段↵T2↵↵\|` | 不变 |
| `我同意\|`（末尾，所在行非空） | `T2` | `我同意 T2\|` | 不变 |
| `前面\|后面` | `T2` | 只加空格，不加回车 | 不变 |
| `我同意\|` | `T1` | `我同意 T1\|` | 不变 |

单行文本紧贴光标：例如空框引用 `T1` 后接着打字会得到 `T1我同意`，这是规则字面推出的结果，yale 已确认可以，不加额外规则。

**范围外**：其他任何插入规则；chip 的呈现与退场；发送去末尾空格与回车（仍需要，多行文本时末尾仍有两个回车）。

## AC

- [x] 插入规则的纯函数通过：`bash scripts/with-memory-cap.sh vitest run src/modules/chat/tests/quoteInsertion.test.ts` 退出码 0（沿用既有文件）；独立用例逐行对应上面的对照表：(a) 空框、单行：新文本 `T1`，光标在 `T1` 之后；(b) 空框、多行：新文本 `T2↵↵`，光标在末尾；(c) `第一段↵|`、单行；(d) `第一段↵|`、多行；(e) 末尾但所在行非空、多行：不加回车；(f) 光标在文字中间、多行：不加回车；(g) 含 `\r\n` 的文本也算多行；(h) 文本末尾只有一个换行符（选区钩子已去首尾空格，所以不会出现，但函数本身收到时按含换行符处理）；(i) 原有的前后补空格、选区末尾之后插入、标点算文本、回车不算文本、UTF-16 下标等既有用例全部保持通过，断言不放宽。
- [x] 条件只有一处改动：`grep -nE "trailingBreaks" src/modules/chat/utils/inputSuggestions.ts` 的输出里，条件同时包含「在末尾且空行」与「文本含换行符」；函数的文档注释同步改成新规则，不再写「At the end of an empty line the passage opens a new paragraph」的旧表述。
- [x] 接受契约与点击测试同步：`bash scripts/with-memory-cap.sh vitest run src/modules/chat/tests/suggestionChipAcceptContract.test.tsx src/modules/chat/tests/chatComposerReplyChips.test.tsx` 退出码 0；原先断言空框引用后文本为 `T↵↵` 的用例，改为单行得 `T`、多行得 `T↵↵`，两种各一条；不删用例、不放宽断言（`git diff --stat` 的删除与新增行数贴在 DoD，并说明每处删除的原因）。
- [x] 发送去末尾空格与回车的既有用例仍然通过：`bash scripts/with-memory-cap.sh vitest run src/modules/chat/tests/inputSuggestionsComposer.test.tsx` 退出码 0。
- [x] 静态门：`npm run typecheck`、`npm run lint` 退出码均为 0。

## DoD

真实页面读数；用**隔离实例**（自己的端口与 `DATABASE_PATH`，`SERVER_SETTINGS_PATH` 指向 `{"residentRestore":{"enabled":false}}`，后端用真实网关的设置副本，不碰常驻 :3001，不重启常驻服务）；真页上**不要按 Escape**；测试会话的提示词里写明「不要写代码、不要调用任何工具」，结束后核对没有留下测试产物。读 `textarea.value`、`selectionStart`、`selectionEnd` 贴出。

- [x] 空输入框引用一句单行的话：新内容就是这句话本身，光标在其末尾，没有回车；贴读数与截图。
- [x] 空输入框引用跨段落的多行文本（transcript 里选中跨两段的文字）：内容末尾有两个回车，光标在末尾；贴读数。
- [x] 输入框内容以回车结尾（`第一段↵|`）时，分别引用单行与多行，各贴一次读数，与对照表逐行一致。
- [x] 其余对照表中不变的行（末尾非空行、文字中间）各做一次，读数与改动前一致。
- [x] 空输入框单行引用后直接发送：贴网络请求里的消息内容，与该句话一致，末尾没有空格与回车。

## Evidence

**实现。** `src/modules/chat/utils/inputSuggestions.ts:235`（唯一改动的一处条件）：

```ts
const trailingBreaks = endsOnEmptyLine && /[\r\n]/.test(quoted) ? '\n\n' : '';
```

`endsOnEmptyLine`（上一行）= 光标在输入框末尾且所在行为空行；`/[\r\n]/` = 插入文本含换行符。函数文档注释已改为「At the end of an empty line, a passage that itself contains a line break opens a new paragraph with two line breaks under it; a one-line passage stays on the line it was inserted on.」，旧表述「At the end of an empty line the passage opens a new paragraph」不再存在。

**AC-2 的 grep 读数：**

```
$ grep -nE "trailingBreaks" src/modules/chat/utils/inputSuggestions.ts
235:  const trailingBreaks = endsOnEmptyLine && /[\r\n]/.test(quoted) ? '\n\n' : '';
236:  const inserted = `${leadingSpace}${quoted}${trailingSpace}${trailingBreaks}`;
```

**AC-1/3/4 的命令读数（worktree 内，`with-memory-cap.sh`）：**

- `bash scripts/with-memory-cap.sh vitest run src/modules/chat/tests/quoteInsertion.test.ts` → exit 0，18 tests passed。
- `bash scripts/with-memory-cap.sh vitest run src/modules/chat/tests/suggestionChipAcceptContract.test.tsx src/modules/chat/tests/chatComposerReplyChips.test.tsx` → exit 0，50 tests passed（12 + 38）。
- `bash scripts/with-memory-cap.sh vitest run src/modules/chat/tests/inputSuggestionsComposer.test.tsx` → exit 0，49 tests passed。

**AC-5：** `npm run typecheck` → exit 0；`npm run lint` → exit 0（既有文件的 371 条 warning，四个被改文件零 warning）。

**AC-3 的 diff（`git diff 440e5dcbd..HEAD`，440e5dcbd 是开工时的 develop 尖端）：**

```
 src/modules/chat/tests/chatComposerReplyChips.test.tsx       | 33 +++++-
 src/modules/chat/tests/suggestionChipAcceptContract.test.tsx | 66 +++++++++--
```

numstat：chatComposerReplyChips `+29/−4`；suggestionChipAcceptContract `+56/−10`；用例数只增不减（两文件从 38/11 变为 38/12）。新增用例：`(quoted, multi-line)`、`(c2)` 空框多行、`(d4)` 第一段↵ 后多行。逐处删除原因——全部是**旧规则的期望值、断言与注释**，没有删除任何用例：(1) `'选中的原文\n\n'` 与 `'第一段\n选中的原文\n\n'` 两处 `expectedDraft`/`expectedCaret` 改为单行结果；(2) 三条用例标题由「opens a new paragraph」改为「one-line passage: … no paragraph break」；(3) 两段「the passage lands there, followed by the two line breaks」的注释改写。断言没有放宽：单行分支严格等于 `T`（连同 caret 与聚焦），多行分支仍然严格等于 `T↵↵`，且多行用例是新加的一条，不是把旧断言改宽。

**DoD 环境（隔离实例）：**

- 自建隔离实例 `http://127.0.0.1:25845`（随机空闲端口）：
  - `DATABASE_PATH=/data/home/yale/work/gap-composer-quote-dod/auth.db`（live DB 的 better-sqlite3 online backup，仅对该副本重置本实例一次性口令）；
  - `SERVER_SETTINGS_PATH=/data/home/yale/work/gap-composer-quote-dod/server.settings.json` = 真实 `~/.config/claudecodeui/server.settings.json` 的副本 + `residentRestore.enabled=false`，内容 `{"residentRestore":{"enabled":false,"max":16,"maxAgeMs":86400000}}`；
  - `HOME=/data/home/yale/work/gap-composer-quote-dod/home`（测试 transcript `~/.claude/projects/quote-insert-dod-workspace/quote-insert-dod-session.jsonl` 在服务启动前 seed）；`CLAUDE_SESSION_SCOPE_SWEEP=off`；
  - 服务用 **worktree 自己的** `dist-server/` + `dist/` 启动；`/health` 回的 `buildSha=82b4c5a969fffdca6d9c681db1334a3557a0bde8` 是本任务分支 HEAD；
  - 启动日志无任何 `[resident-restore]` 行；该 server pid 名下 `claudecodeui-session-<pid>-*` scope 数为 **0**；常驻 :3001 未触碰、未重启；验证后实例已停止（按精确 pid TERM，端口关闭）并删除。
- 测试会话的 user turn 文本为「这是一条测试会话：请不要写代码、不要调用任何工具。」；全程没有 provider turn（`chat.send` 在 WS 层被记录后不转发给服务端），结束后 `workspace` 文件数 **0**（无测试产物）。
- 真页操作：真实 Chromium 打开 `/session/quote-insert-dod-session`，用真实 DOM Range 选中 transcript 文本，点真实 `button[data-chip-source="quoted"]`，读活 textarea。**未按 Escape。**

**DoD 读数（`textarea.value` / `selectionStart` / `selectionEnd`）：**

| 腿 | 场景 | textarea.value（JSON） | start/end |
|---|---|---|---|
| 1 | 空框、单行 | `"今天的天气不错，适合出门散步。"` | 15 / 15 |
| 2 | 空框、跨段多行 | `"今天的天气不错，适合出门散步。\n第二段会用来验证跨段落的选择。\n\n"` | 33 / 33 |
| 3a | `第一段↵`、单行 | `"第一段\n今天的天气不错，适合出门散步。"` | 19 / 19 |
| 3b | `第一段↵`、多行 | `"第一段\n今天的天气不错，适合出门散步。\n第二段会用来验证跨段落的选择。\n\n"` | 37 / 37 |
| 4a | 末尾非空行、多行 | `"我同意 今天的天气不错，适合出门散步。\n第二段会用来验证跨段落的选择。"` | 35 / 35 |
| 4b | 文字中间、多行 | `"前面 今天的天气不错，适合出门散步。\n第二段会用来验证跨段落的选择。 后面"` | 35 / 35 |
| 5 | 空框单行后发送 | 发送前 `"今天的天气不错，适合出门散步。"` | 15 / 15 |

腿 5 的发送帧（客户端 → 服务端 socket 上捕获的 `chat.send`）：

```json
{"type":"chat.send","sessionId":"quote-insert-dod-session","content":"今天的天气不错，适合出门散步。"}
```

与选中句逐字一致，末尾没有空格、没有回车。

页内异常读数：`pageErrors=[]`、`unhandledRejections=[]`；只有 2 条 `Failed to load resource: 403` 的资源加载行（静态资源，与本次交互无关）。完整读数 JSON：`tmp/quote-insert-dod/report.json`（`"ok": true`）。

**截图**（仓库内 `tmp/quote-insert-dod/`，gitignored）：

- `leg-1-empty-single-line.png`
- `leg-2-empty-multi-line.png`
- `leg-3a-first-paragraph-single-line.png`
- `leg-3b-first-paragraph-multi-line.png`
- `leg-4a-end-nonempty-line-multi-line.png`
- `leg-4b-middle-multi-line.png`
- `leg-5-before-send.png`

**第 2 轮复核（2026-10-25T14:56Z）：前一轮 suite 红是 develop 侧，不是本任务 delta。**

前一轮 blocker 的 `server/modules/mcp-gateway/tests/mcp-session-lifecycle.test.ts` 本轮在 worktree 内单跑（`node --import tsx --import ./scripts/undici-blocked-ports-preload.mjs --test`，包在 `scripts/with-memory-cap.sh` 里）仍 exit 1：`the returned runId must be the registry current run verbatim`（actual `'null'`）与 `the run registry must record the aborted terminal state`（actual `'unknown'`）⇒ 不是一次性负载抖动。但读驱动自己的 develop 基线跑 `.quay/fan-in-suite-gap-composer-quote-insert-breaks-only-for-multiline~wk-prod-anchor~baseline-1792939760749-22e83a.log`（跑在 `.baseline-red-gap-composer-quote-insert-breaks-only-for-multiline-wk-prod-anchor/` 的纯 develop 检出里），同一批文件逐字 `passed=false`：`mcp-session-lifecycle`、`mcp-session-send`、`mcp-cancel-queued`、`debug-agent-control-queue`、`claude-resident-busy-input`；兄弟任务 `gap-quay-snapshot-loop-status-version-drain-orphan` 的 Blocker 也是同一条 `claude-resident-busy-input`。⇒ 红在 develop 侧且跨任务复现；本任务 delta 只含 `src/modules/chat/**` 的 4 个前端文件，与这些文件没有导入交集，未改也未碰它们。

本轮复核读数：AC-1 `quoteInsertion.test.ts` → exit 0，18 passed；AC-3 `suggestionChipAcceptContract.test.tsx` + `chatComposerReplyChips.test.tsx` → exit 0，50 passed（12 + 38）；AC-4 `inputSuggestionsComposer.test.tsx` → exit 0，49 passed；AC-5 `npm run typecheck` exit 0、`npm run lint` exit 0（仅既有 warning）。`git merge develop` 干净（只带进两份 task 文件的 blocker 记录），worktree clean。

## Notes

**第 3 轮复核（2026-10-26T01:55Z）：被点名的红用驱动自己的 rerun 形式复跑全绿；红在 develop 侧，且驱动的 rerun / baseline-red 300s 窗口装不下 15 个红文件。**

- 本轮 `git merge develop` 干净；`anti-drift-touches-check` exit 0（4 个实际文件全在 Touches）；`task_check` AC 5/5、DoD 5/5。分支交付物完整，**无需重实现**。
- 上一条 Blocker 点名的 `server/modules/mcp-gateway/tests/mcp-session-lifecycle.test.ts`，在本 worktree 用**驱动 rerun 的同一形式**（`bash scripts/test.sh <file>`）复跑：`__PERFILE__ … passed=true`、`# tests 1 / pass 1 / fail 0`、exit 0（40.2s）。
- 同轮另抽 3 个被点名文件，同形式同结果全绿：`claude-resident-addressable`（14.4s）、`voice-realtime-uplink-vad-hold-open`（4.4s）、`debug-agent-control-queue`（42.6s）；`claude-resident-busy-input` 用 `node --import tsx --import ./scripts/undici-blocked-ports-preload.mjs --test` 单跑 1/1 绿（8.3s）。
- 驱动自己的 develop 基线跑 `.quay/fan-in-suite-gap-composer-quote-insert-breaks-only-for-multiline~wk-prod-anchor~baseline-1792946844495-f58569.log`（纯 develop 检出 `.baseline-red-gap-composer-quote-insert-breaks-only-for-multiline-wk-prod-anchor/`）逐字红同一批文件、同一批断言文本（`the returned runId must be the registry current run verbatim`、`the leg-2 frame must be readable with its own uuid`、`probe child (queue) exited non-zero` 等）⇒ 红在 develop 侧，与只改 `src/modules/chat/**` 4 个前端文件的本 delta 无关。
- **结构性问题：驱动的 `rerun` 与 `baseline-red` 两步各有 300s 上限**（`.quay/fan-in-gap-composer-quote-insert-breaks-only-for-multiline-wk-prod-anchor.log`：`state=rerun-not-evaluated` / `reason:"rerun-aborted"` / `verdict=not-evaluated` / `reason:"baseline rerun aborted"`）。该轮 15 个红文件 × 实测 ~27s/个 ≈ 400s，**即使全部复跑绿也装不进 300s** ⇒ 只要 suite 一次点出 ≥12 个无关红，本任务每轮都必然 `exited-not-landed`，与分支内容无关。需驱动侧提高 rerun / baseline-red 时限（或并行复跑）。
- 负载读数：本轮宿主 load average 84/128、`pgrep -c node` = 52；同一批测试在 suite 的 16 路并发下红、单跑绿 ⇒ lane-load 敏感（与 `.quay/baseline-red-rounds.jsonl` 中 `cockpit-grid-pos-and-remote-focus-label` 复现的同一 `claude-resident-addressable` / `unattended-turn` 签名同族）。
- 本任务落地状态：develop 修绿（或驱动窗口放宽、suite 红降到 <12 个）后，`git merge develop` 即可直接 ff；否则按 needs-human 手工落地配方快进即可。

**第 4 轮复核（2026-10-26T06:25Z）：suite 红的真因是分支滞后丢了 `scripts/test.sh --list-files`；已由 `git merge develop` 修复，本任务 delta 未变。**

- 上一轮 suite 日志 `.quay/fan-in-suite-gap-composer-quote-insert-breaks-only-for-multiline~wk-prod-anchor~1792951012388-4d3fbf.log`：761 个用例 **761 pass / 0 fail**；红因是 `[full-suite-runner]` 的 plan probe 超时：`plan probe failed (.../scripts/test.sh --list-files): spawnSync bash ETIMEDOUT`（`source=probe-failed`、`completeness=not-evaluated`）。**不是测试失败。**
- 根因：本 worktree 的 `scripts/test.sh` 当时落后 develop 72 个提交，缺 develop 的两处内容——`--list-files` 分支（`b36150f7f feat(test-sh): implement --list-files for the full-suite-runner plan probe`）与 host-env 隔离块。runner 用 `--list-files` 探测计划文件集时脚本不认识该 flag，于是真的把整个 suite 跑起来，超过 probe 的 120s 预算 ⇒ `ETIMEDOUT` ⇒ suite 判红（即使 761 个用例全绿）。
- 修复（本轮）：`git merge --no-edit develop` 干净无冲突；`git diff develop -- scripts/test.sh` 现为空；`bash scripts/test.sh --list-files` 现在 **4.3s 返回 441 行、rc=0**，probe 不再超时。
- 合并后复跑本任务判据：AC-1 `quoteInsertion.test.ts` → 18 passed；AC-3 `suggestionChipAcceptContract` + `chatComposerReplyChips` → 50 passed（12 + 38）；AC-4 `inputSuggestionsComposer.test.tsx` → 49 passed；AC-5 `npm run typecheck` rc=0、`npm run lint` rc=0（仅既有 warning）；AC-2 grep 读数不变（`235: const trailingBreaks = endsOnEmptyLine && /[\r\n]/.test(quoted) ? '\n\n' : '';`）。
- `anti-drift-touches-check` exit 0（4 个实际文件全在 Touches）；`task_check` AC 5/5、DoD 5/5；worktree clean。分支交付物完整，**无需重实现**。

**第 5 轮复核（Fleet 案卷 case_8cd07849c98e 的短期 dev 会话，2026-10-25T22:41Z）：suite 全绿却在套件末尾被判 aborted；判红的唯一读数是 develop 侧残留的一个 `sleep 2`，不是本任务 delta。**

- 本轮 fan-in（run_id `wk-prod-anchor`，worker session `cad08ca7-2155-4adf-905a-cfc0989dfaa2`）的 suite 日志 `.quay/fan-in-suite-gap-composer-quote-insert-breaks-only-for-multiline~wk-prod-anchor~1792967222276-86e8fd.log`：`# tests 761` / `# pass 761` / `# fail 0`，末行 `[full-suite-runner] SUITE-PLAN planned=441 terminal=761 missing=0 source=probe:test.sh --list-files plan_error=null completeness=not-evaluated oomKill=0 telemetry=ok laneCount=127`；驱动随后写 `# suite red aborted`。
- 同一轮在 `.quay/verification-round.jsonl`（round 1570）的读数：`state:"red"`、`reason:"aborted"`、`notEvaluated:"leaked-processes (1)"`、`leakedProcesses:[{"pid":704526,"ppid":319121,"startedAt":"2026-10-25T22:36:52.140Z","cmdline":"sleep 2","cwd":"/data/home/yale/work/claudecodeui-worktrees/gap-composer-quote-insert-breaks-only-for-multiline"}]` ⇒ 判红不是任何断言失败，而是套件进程组里残留了一个 `sleep 2`。
- 该签名在 develop 侧跨任务复现：同一本台账里 `notEvaluated:"leaked-processes (1)"` 共 20 轮、12 个不同任务（2026-10-25T17:28Z–22:36Z），每一条的 `cmdline` 都逐字是 `sleep 2`，cwd 都是当轮任务的 worktree。
- 产生者读数：全库唯一的字面 `sleep 2` 命令在 `server/modules/providers/tests/claude-resident-cli-contract.test.ts:608`（`const IN_FLIGHT_BASH = 'sleep 2; echo CLI_CONTRACT_IN_FLIGHT_DONE';`），AC-379 的任务正文也逐字记着「场景里唯一的 Bash 是 `sleep 2; echo CLI_CONTRACT_IN_FLIGHT_DONE`」。该真 claude 哨兵结束后，工具派生的 `sleep 2` 子进程留在套件自己的进程组里；`full-suite-runner` 的 leak 扫描在 suite 子进程退出后按 pgid 枚举成员，扫到它就整轮标 `not-evaluated`。
- 因此本任务 Needs-Human 段里的判词（suite red 归因不出）是**后果**：`fail 0` 时归因器读到 `0 of 0 failing lines` 是正确行为，没有可归因的文件；不是本任务 delta 的缺陷。本任务 4 个实际文件全在 Touches 内、worktree clean、分支内容与第 4 轮一致。
- 处置：本任务维持 needs-human，不重派；这个遗留进程缺陷已另立任务记录（主检出 `tasks/gap-cli-contract-sentinel-sleep2-bash-child-leaks-into-suite-leak-sweep.md`）。该缺陷修好后本分支可直接 `git merge develop` 再 ff。

## Touches

- `src/modules/chat/utils/inputSuggestions.ts`
- `src/modules/chat/tests/quoteInsertion.test.ts`
- `src/modules/chat/tests/suggestionChipAcceptContract.test.tsx`
- `src/modules/chat/tests/chatComposerReplyChips.test.tsx`
- `src/modules/chat/tests/inputSuggestionsComposer.test.tsx`
- `tasks/gap-composer-quote-insert-breaks-only-for-multiline.md`

## Needs-Human

**执行 2026-10-25T22:36:58.029Z — 停派终止（失败无法归因，⛔ 不再重派）**

- 阻碍原因：exited-not-landed 失败无法归因（基建/契约疑似，非实现缺陷）——停止重派，⛔ 不再拿新会话撞同一堵墙：suite red could not be attributed to any failing test file in 2 consecutive rounds (bounded to at most one retry) — infra/contract suspected, not an implementable defect (parser extracted 0 of 0 failing lines and attributed none to a file); stopping instead of spending another worker session
- 失败步/判词：step=suite: # fail 0
- run_id：wk-prod-anchor
- session_id：cad08ca7-2155-4adf-905a-cfc0989dfaa2
- suite 日志：/data/home/yale/work/claudecodeui/.quay/fan-in-suite-gap-composer-quote-insert-breaks-only-for-multiline~wk-prod-anchor~1792967222276-86e8fd.log
- fan-in 日志：/data/home/yale/work/claudecodeui/.quay/fan-in-gap-composer-quote-insert-breaks-only-for-multiline-wk-prod-anchor.log

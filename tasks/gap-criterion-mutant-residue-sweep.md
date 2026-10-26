---
id: gap-criterion-mutant-residue-sweep
title: 判据假形态副本的残留清理：被杀掉的测试进程留在源码树里的 __criterion-falsify-* 文件，由 suite 开头按 pid 存活情况清扫
status: ready
labels:
  - gap
  - defect
parent: null
children: []
extra:
  schema: execution
---
## Proposal

<!-- dedup-ref --> 2026-10-26 架构复查第二批第 6 条。archguard 侧另有 `gap-duplicates-scan-untracked-residual-files`（让扫描器不读未跟踪文件），在 archguard 的 task store；本任务处理的是本仓库产生残留的源头，两者互补。

### 现状（2026-10-26 实测）

- 主检出里出现过一个未跟踪的 `server/modules/voice/__criterion-falsify-legacy-attempt-id-1276453.ts`（56 KB，10-26 01:45 写出）。它是 `server/modules/voice/tests/voice-capture-audio.false-forms.test.ts:636` 写出的变异副本：判据把 `voice-capture.ts` 改掉一处后，写到被测模块的同一目录，为的是让相对 import 能解析。该判据在 `finally`（`:653-654`）里删除副本，所以只有进程被强杀（超时看门狗、OOM、SIGKILL）时才会留下。写出它的进程 1276453 已不存在。该文件已于 10-26 手工删除。
- 同样做法的判据共 33 个文件：`voice-realtime/tests` 20 个、`voice/tests` 10 个，`debug-agent`、`mcp-gateway`、`providers` 各 1 个。副本名大多以 `-<pid>.ts` 结尾。
- `server/tsconfig.json:77-100` 已按文件名排除 `./**/__criterion-falsify-*`，所以副本不会进构建产物。但 ArchGuard 分析、`git status`、以及其它按 `git status --porcelain` 判断「是否干净」的判据都会读到它：ArchGuard 当天 server 的低阈值重复报告里，85 组中有 14 组来自这个残留文件。
- 目前没有任何机制清理被强杀后留下的副本。

### 改法

1. 新增 `scripts/sweep-criterion-residue.mjs`：在 `server/` 与 `src/` 下（跳过 `node_modules`、`dist`）查找名字以 `__criterion-falsify-` 开头的文件与目录。
   - 从名字末尾解析 `-<pid>`（`.ts` 文件或目录名）；若该 pid 已不存活（`process.kill(pid, 0)` 抛 `ESRCH`），就把它列为残留。
   - pid 仍存活、或名字里解析不出 pid 的，只报告、不删除——宁可漏删，不误删正在运行的判据的副本。
   - 默认只列出；加 `--apply` 才删除。退出码恒为 0，每条输出一行 `residue: <路径> pid=<pid> state=<dead|alive|unknown> action=<removed|kept>`。
2. `scripts/test.sh` 在第一个 stage（`run_stage_bg typecheck`，约 `:862`）之前调用一次 `node scripts/sweep-criterion-residue.mjs --apply`，并把输出写进 suite 日志。这一步失败不影响后续 stage。
3. 新增 `scripts/sweep-criterion-residue.test.mjs`（`test:scripts` 的 glob 会自动收进）。

不做：改动 33 个判据的副本写法。副本必须放在被测模块旁边才能解析相对 import，这是它们的设计前提。

### 导入环预算（AC-394）

只改 `scripts/` 下的文件，不在 AC-394 的扫描范围内，基线不受影响。

## AC

- [x] 清扫器判据：`node --test scripts/sweep-criterion-residue.test.mjs` exit 0。在临时目录中放置四种夹具：(a) 以已退出进程 pid 结尾的 `.ts` 副本；(b) 以当前测试进程 pid 结尾的副本；(c) 名字里没有 pid 的副本；(d) 以已退出 pid 结尾的目录。断言 `--apply` 后只有 (a) 和 (d) 被删除，(b)、(c) 保留；不加 `--apply` 时四者都保留；每条都有对应的 `residue:` 输出行。
- [x] 不越界：同一测试文件含用例，`node_modules/` 与 `dist/` 下同名前缀的文件不被列出；不以 `__criterion-falsify-` 开头的文件即使以 `-<死 pid>.ts` 结尾也不被列出。
- [x] 接入 suite：`grep -n "sweep-criterion-residue.mjs --apply" scripts/test.sh` 命中一行，且它的行号小于 `grep -n "run_stage_bg typecheck" scripts/test.sh` 的行号。
- [x] suite 入口契约不受影响：`QUAY_TEST_DRY=1 bash scripts/test.sh --buckets server --run-id probe` exit 0。
- [x] 脚本测试清单：`node scripts/list-script-tests.mjs | grep -c "sweep-criterion-residue.test.mjs"` 输出 1。

## DoD

在主检出之外的一个任务 worktree 里复现并清扫一次真实残留：
1. 启动 `npx tsx --tsconfig server/tsconfig.json --test server/modules/voice/tests/voice-capture-audio.false-forms.test.ts`，在它写出 `__criterion-falsify-*-<pid>.ts` 后立即对该进程发 SIGKILL；
2. 贴出 `git status --porcelain server/` 中出现的残留行；
3. 运行 `node scripts/sweep-criterion-residue.mjs --apply`，贴出 `residue: … state=dead action=removed` 行；
4. 再贴一次 `git status --porcelain server/`，结果为空。

## Touches

- scripts/sweep-criterion-residue.mjs (new)
- scripts/sweep-criterion-residue.test.mjs (new)
- scripts/test.sh
- tasks/gap-criterion-mutant-residue-sweep.md

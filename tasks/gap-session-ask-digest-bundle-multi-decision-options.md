---
id: gap-session-ask-digest-bundle-multi-decision-options
title: session-ask 摘要把多子决定压平成 6 条单选：改为打包成 3–5 个组合选项
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

cockpit 的 session-ask 卡，其选项来自 CloudCLI 的 T1 决策摘要（`server/modules/observation/session-ask-decision-answer.ts`：SYSTEM_PROMPT 让模型产出选项，`buildAskDecision`/`withStableOptionIds` 规整）。当助手一次消息问的是「三个相互独立的设计点，每个都要选 A 还是 B」时，当前 prompt 的 options 规则「为每一项给出一条 option」会让模型把 6 个半方向各列成一条 option；而 cockpit 的选项 UI 是单选（`CockpitCardOptions.tsx` 的 radio group + 单 confirm），于是这张卡列 6 个选项、却只能选 1 个，人无法一次定下 3 个方向。

这是回归、不是常态。活库 179 条 evaluated 摘要里 options ≥5 的只有 1 条（真·单选五选一）；多数多部分问题已被模型自发打包成 3–4 个组合选项（如「两个都立 / 只立 A 侧 / 只立 B 侧」「(a)+(b) 先查再决定」）。根因是 prompt 的 options 规则在压平方向推了一把，而打包只是涌现、从未被要求。卡片的两项职责（指出问题存在；提供降低认知/操作负载的选择）里，第一项已达成，第二项应由「组合选项」达成——单选 UI 保持不变，只让摘要层把多子决定打包成几个自洽组合。

方案（只改摘要 prompt，契约/类型/解析器/UI/fleet 一律不动）：

1. 把 options 规则从「为每一项给出一条 option」收窄为「仅当问题只有一个选择维度时才逐一列出」。
2. 新增一条「多个相互独立的子决定」规则：不要拆成 2N 条半方向、更不要穷举 2^N 种组合；打包成 3–5 个自洽的组合选项，每个 option 覆盖全部子决定（label 用「①…+②…+③…」合取写法，does 写清每个子决定的取值）；优先保留助手讨论过/最可能被选的组合，并含「全部保持现状」「全部按助手建议推进」这类自然端点。
3. 在 `server/modules/observation/tests/session-ask-decision-digest.test.ts` 补一条夹具：经注入的 `complete` 缝返回一个「多子决定 → 3 个组合选项」的模型答案，断言 digest 输出 `evaluated`、options 数量与 label 顺序逐字保留（证明 parser/摘要管线不拒绝组合形状、stable id 仍按 label 派生）。

两处 prompt 措辞逐字如下（只改 `SYSTEM_PROMPT` 数组，行内字符串用单引号包、与前文一致）：

A. 现 options 行替换为：
  '- options：当问题只有一个选择维度（从若干互斥项里选一个）时，助手原文用编号或项目符号列出多少项就给出多少条 option（label 用原文的选项名）；原文没有列出选择才用空数组 []。does 是选它会发生什么，tags 是后果标签（kind 用 consequence / risk / cost / benefit）。',

B. 在该行之后新增：
  '- 多个相互独立的子决定（例如「三个设计点，每个都要选 A 还是 B」）不要拆成 2N 条半方向、更不要穷举 2^N 种组合：打包成 3–5 个自洽的组合选项，每个 option 覆盖全部子决定（label 用「①…+②…+③…」这种合取写法，does 写清每个子决定的取值）；优先保留助手自己讨论过或最可能被选的组合，并含「全部保持现状」「全部按助手建议推进」这类自然端点。',

边界：不改 `parseAskDecisionAnswer` / `buildAskDecision` / `withStableOptionIds`；不改 `server/shared/types.ts` 的 `SessionAskDecisionOption`；不改 cockpit UI 与 fleet 侧；不新增选项数量上限的机械校验（打包靠 prompt，parser 仍接受任意数量的选项）。

## AC

- [x] `grep -n "只有一个选择维度" server/modules/observation/session-ask-decision-answer.ts` 命中；`grep -n "多个相互独立的子决定" server/modules/observation/session-ask-decision-answer.ts` 命中，且两行都位于 `SYSTEM_PROMPT` 数组内。
- [x] 新夹具用例通过：注入的「多子决定 → 3 个组合选项」模型答案经 digest 输出 `state:"evaluated"`，`options.length === 3`，`options[].label` 顺序逐字等于夹具里声明的顺序（stable id 不改变 label）。
- [x] `node_modules/.bin/tsx --tsconfig server/tsconfig.json --import ./scripts/undici-blocked-ports-preload.mjs --test server/modules/observation/tests/session-ask-decision-digest.test.ts` 退出 0（既有用例 + 新夹具全部绿）。

## DoD

- 贴出新夹具用例的通过读数（`tests N / pass N / fail 0` 或等价末行），并贴出两条 `grep` 命中行原文。
- 说明单选 UI 未被改动：`git diff --stat` 只涉及 `server/modules/observation/session-ask-decision-answer.ts`、`server/modules/observation/tests/session-ask-decision-digest.test.ts`、`tasks/gap-session-ask-digest-bundle-multi-decision-options.md`。
- 不涉及 UI，不需要 MCP 浏览器截图。

## Evidence

- 单文件测试：`tests 58 / pass 58 / fail 0`；其中 `✔ multi-subdecision: three composite options survive the digest verbatim, ids derived from labels`。
- `277:  '- options：当问题只有一个选择维度（从若干互斥项里选一个）时，助手原文用编号或项目符号列出多少项就给出多少条 option（label 用原文的选项名）；原文没有列出选择才用空数组 []。does 是选它会发生什么，tags 是后果标签（kind 用 consequence / risk / cost / benefit）。',`
- `278:  '- 多个相互独立的子决定（例如「三个设计点，每个都要选 A 还是 B」）不要拆成 2N 条半方向、更不要穷举 2^N 种组合：打包成 3–5 个自洽的组合选项，每个 option 覆盖全部子决定（label 用「①…+②…+③…」这种合取写法，does 写清每个子决定的取值）；优先保留助手自己讨论过或最可能被选的组合，并含「全部保持现状」「全部按助手建议推进」这类自然端点。',`（两行均位于 `SYSTEM_PROMPT` 数组 264–283 行内）
- `git diff --stat`（实现提交 `05e1956d1`）只涉及 `server/modules/observation/session-ask-decision-answer.ts`、`server/modules/observation/tests/session-ask-decision-digest.test.ts`；cockpit 单选 UI 与 fleet 侧零改动。

## Dark axis

该轴仍暗,理由:本任务只改摘要 prompt 措辞与夹具，没有可量化的落地轴读数。

## Touches

- server/modules/observation/session-ask-decision-answer.ts
- server/modules/observation/tests/session-ask-decision-digest.test.ts
- tasks/gap-session-ask-digest-bundle-multi-decision-options.md

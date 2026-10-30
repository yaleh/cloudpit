---
id: gap-codex-resident-send-no-response-two-root-causes
title: 修复 codex resident 会话「发送无响应」两个根因：effort default 透传 + 冷启动误用 this.host
status: ready
labels: []
parent: null
children: []
extra:
  schema: execution
---
## 背景

生产 :3001（构建 `aa5e582f`，GOAL-051 已部署）上人 yale 多次创建 resident codex 会话，发消息后无响应。日志两个会话、两个根因：

1. `2026-10-30T02:14:40Z` 会话 `01a18a96`：`turn/start` 被 codex app-server 0.153.4 拒绝 400 —— `Invalid value: 'default'. Supported values are: 'none', 'minimal', 'low', 'medium', 'high', 'xhigh', and 'max'.`（`codexErrorInfo: 'other'`）。
2. `2026-10-30T02:24:43Z` 会话 `74c9a75e`：`[Chat] Provider runtime "codex" failed { error: 'No Codex resident session is bound for "74c9a75e-…".' }`。

两者都在 `server/modules/providers/list/codex/` 的 resident 驱动里。

## 根因 1：effort 'default' 原样透传

`server/modules/providers/list/codex/codex-host-driver.contract.ts:206-213` 的 `turnParams`：

```
const effort = turn.options.effort;
return {
  threadId,
  input: [{ type: 'text', text: turn.command }],
  ...(typeof effort === 'string' ? { effort } : {}),
};
```

它把 CloudCLI 的 effort 词表（含 `'default'`，表示「用模型默认」）原样发给 `turn/start`；codex app-server 只收 none/minimal/low/medium/high/xhigh/max，`'default'` 不是合法值 → 400 → turn 落空。

## 根因 2：冷启动判断误用 this.host

`server/modules/providers/list/codex/codex-host-driver.provider.ts:452` 的 `run`：

```
if (!this.host || this.closed || this.host.state === 'closed') {
  await this.startResidentSession(appSessionId, {...});
}
```

驱动是 provider 级单例（multiplexedHost=false），但 `this.host` 是单字段。第一个 resident 会话（`01a18a96`）的 app-server（pid 1915327）仍存活时，第二个新会话（`74c9a75e`）进来：`this.host` 非空、非 closed ⇒ 跳过冷启动 ⇒ `requireSession(74c9a75e)` 在 `this.sessions` 里找不到 ⇒ 抛 `No Codex resident session is bound`。冷启动该按「本会话是否有活宿主」（`this.liveHostFor(appSessionId)` / `this.sessions.has(appSessionId)`），不是「驱动有没有任意宿主」。

## 修复

1. `turnParams`：`'default'` 不写进 `turn/start` 的 `effort` 字段（省略，让 app-server 用其默认）；其余 CloudCLI 合法 effort 值映射到 codex 词表（low/medium/high 直通；不属于 codex 词表的省略或映射，映射表要在代码里注明来源）。`thread/start` 的 `threadParams` 若同样透传 effort，一并处理。
2. `run` 冷启动：改成 per-session 判断——本会话没有活宿主才 `startResidentSession`（同时保留 `this.closed` 语义）；第二个 resident 会话须得到自己的宿主与绑定，不能复用第一个会话的 `this.host`。

## AC

- [ ] AC1 **effort 'default' 不再透传**：`npx tsx --tsconfig server/tsconfig.json --test server/modules/providers/tests/codex-host-driver-persistent.test.ts` 退出 0 且 fail 0；新增/改写的用例断言 `turnParams(threadId, { command, options: { effort: 'default' } })` 的返回对象**不含** `effort` 键，`effort: 'high'` 时含 `effort: 'high'`。假形态：临时把 `'default'` 恢复为原样透传 ⇒ 该用例红；抄下逐字失败行后还原。
- [ ] AC2 **第二个 resident 会话能绑定**：`npx tsx --tsconfig server/tsconfig.json --test server/modules/providers/tests/codex-host-driver-persistent.test.ts` 退出 0 且 fail 0；新增用例用注入的内存假 app-server transport，对同一 driver 实例先后 `run` 两个不同 appSessionId（第一个宿主仍存活），断言第二个会话不再抛 `No Codex resident session is bound`、且 `this.sessions` 里两个 sessionId 都在（或等价读数）。假形态：临时把冷启动条件改回 `!this.host || …` ⇒ 该用例红；抄下逐字失败行后还原。
- [ ] AC3 **不新增 server 测试文件**：两条修复的测试都加进既有 `server/modules/providers/tests/codex-host-driver-persistent.test.ts`（或既有 codex-host-driver-* 测试文件），不新建 `*.test.ts`，避免连带 quay-test-script 的 collected/unknown 钉子与 suite-duration-baseline 覆盖率下限（见记忆 `adding-a-server-test-file-bumps-the-quay-test-script-unknown-pin`）。
- [ ] AC4 **typecheck 无回归**：`npm run typecheck` 退出 0。

## DoD

AC1/AC2 各自的假形态都实测过（先红后绿），完成记录贴出每条判据的 tests/pass/fail 与逐字失败行。修完后生产 :3001 上人 yale 能创建 resident codex 会话并发消息得到响应（真实 app-server，不是注入替身）。

## Touches

- server/modules/providers/list/codex/codex-host-driver.contract.ts
- server/modules/providers/list/codex/codex-host-driver.provider.ts
- server/modules/providers/tests/codex-host-driver-persistent.test.ts
- tasks/gap-codex-resident-send-no-response-two-root-causes.md
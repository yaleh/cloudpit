---
id: gap-server-features-store-encapsulation
title: 把 useServerFeatures 的 4 个模块级可变状态收进 ServerFeaturesStore 类
status: done
labels:
  - gap
parent: null
children: []
extra:
  schema: execution
---
## Proposal

<!-- dedup-ref --> 先例 `gap-session-hosts-store-encapsulation`（done）：把 6 个模块级 `let` 收成 `SessionHostsStore` 类 + 显式单例。本任务把同一先例套到 `useServerFeatures`，机制相同（模块级可变状态收进类），kept separate（不同文件、不同状态簇）。

`src/shared/hooks/useServerFeatures.ts` 现用 4 个模块级可变状态（`let reading`、`const listeners = new Set()`、`let inFlight`、`let settled`）+ 4 个 free function（`publish/subscribe/getSnapshot/loadServerFeatures`）实现一个 boot-static、fail-closed 的共享读数——正是「模块级可变状态散在顶层、无属主、无法实例化/注入/测试」的缺陷类。修法：收成 `ServerFeaturesStore` 类（私有字段 + `subscribe/getSnapshot/load`），导出显式单例供 hook 与测试使用；`useServerFeatures` 变薄，只 `useSyncExternalStore` 订阅 + `useEffect` 触发 `load`。行为保持：单请求、fail-closed、loading 视为 off、值 boot-static 不重试。

## AC

- [x] 状态收进类：`grep -n "export class ServerFeaturesStore" src/shared/hooks/useServerFeatures.ts` 命中，且该类含 `subscribe`/`getSnapshot`/`load` 方法。
- [x] 模块级可变状态清零：`grep -nE '^(let reading|let inFlight|let settled|const listeners)' src/shared/hooks/useServerFeatures.ts` 无输出。
- [x] 规则可离 React 测试：新增 `src/shared/tests/useServerFeatures.test.tsx`，用真实 `ServerFeaturesStore` 类 + 注入假 `api.settings.serverFeatures` 覆盖「首次订阅只发一次请求」「失败/非 JSON/缺 cockpit 块 → cockpitEnabled=false」「loading 期间读数为 off」；`npx vitest run src/shared/tests/useServerFeatures.test.tsx` exit 0。
- [x] 消费方不回归：`npx vitest run src/modules/sidebar/tests/SidebarModeSwitch.test.tsx src/modules/command-palette/tests/CommandPalette.test.tsx` exit 0。
- [x] 类型检查：`npx tsc --noEmit -p tsconfig.json` exit 0；`npx oxlint src/shared/hooks src/shared/tests` exit 0。

## DoD

用真实 `ServerFeaturesStore` 类（从 `useServerFeatures.ts` 导入真实类，仅注入假 `api.settings.serverFeatures`）驱动三条规则并贴测试输出：首次订阅只发一次请求；请求失败/返回非 JSON/缺 `cockpit` 块时 `cockpitEnabled=false`；`loading` 期间读数为 off。`npm run build:client` exit 0；`SidebarModeSwitch`/`CommandPalette` 测试 green（贴命令输出）。

## Evidence

实现提交 `a0dcf08c9` on `task/gap-server-features-store-encapsulation`：`useServerFeatures.ts` 的 4 个模块级状态收进 `ServerFeaturesStore`（`subscribe`/`getSnapshot`/`load`），`useServerFeatures` 只保留 `useSyncExternalStore` + `useEffect`；新增 `src/shared/tests/useServerFeatures.test.tsx`。

```
$ npx vitest run src/shared/tests/useServerFeatures.test.tsx
 ✓ src/shared/tests/useServerFeatures.test.tsx (7 tests) 78ms
 Test Files  1 passed (1)
      Tests  7 passed (7)          exit 0

$ npx vitest run src/modules/sidebar/tests/SidebarModeSwitch.test.tsx src/modules/command-palette/tests/CommandPalette.test.tsx
 ✓ src/modules/command-palette/tests/CommandPalette.test.tsx (5 tests)
 ✓ src/modules/sidebar/tests/SidebarModeSwitch.test.tsx (9 tests)
 Test Files  2 passed (2)
      Tests  14 passed (14)        exit 0

$ npx tsc --noEmit -p tsconfig.json                                   exit 0
$ npx oxlint src/shared/hooks src/shared/tests                         exit 0 (仅既有 warning)
$ npm run build:client                                                exit 0 (built in 24.08s)
```

```
$ grep -n "export class ServerFeaturesStore" src/shared/hooks/useServerFeatures.ts
52:export class ServerFeaturesStore {
66:  subscribe(listener: () => void): () => void {
74:  getSnapshot(): ServerFeaturesReading {
84:  load(): Promise<void> {

$ grep -nE '^(let reading|let inFlight|let settled|const listeners)' src/shared/hooks/useServerFeatures.ts
(no output, exit 1)
```

用例覆盖（仅 `api.settings.serverFeatures` 被注入假实现，解析/共享 in-flight/settled 规则都是生产代码）：两个消费者一起挂载只发一次请求；单个 hook 挂载只发一次请求；`loading` 期间读数为 off；请求被拒 / 返回非 JSON / 缺 `cockpit` 块均使 `cockpitEnabled=false`；settled 后不再请求（boot-static）。

## Touches

- src/shared/hooks/useServerFeatures.ts
- src/shared/tests/useServerFeatures.test.tsx (new)
- tasks/gap-server-features-store-encapsulation.md
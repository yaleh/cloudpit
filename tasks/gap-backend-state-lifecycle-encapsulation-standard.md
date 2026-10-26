---
id: gap-backend-state-lifecycle-encapsulation-standard
title: 把「模块级可变状态必须收进带生命周期的类/对象」写成 backend 模块标准强制规则
status: done
labels:
  - gap
parent: null
children: []
extra:
  schema: execution
---
## Proposal

<!-- dedup-ref --> 兄弟任务 `gap-service-line-ratchet-module-standard` 只写「260 行 ratchet + 前端 React-free controller 规则」，本任务单独写 backend 的「状态/生命周期封装」规则——机制不同（行数 vs 状态封装），kept separate；两者共享 `.agents/skills/backend-module-standards/SKILL.md` 一个文件，调度器会按 Touches 串行，无并行冲突。

本仓库已用 18 个 `gap-*-encapsulation` + 10 个 `gap-*lifecycle` 任务（全 done，2026-10-22/23 起）修掉一类反复出现的缺陷：模块级可变状态（`const x = new Map()`、模块级 `let` 的 timer/inFlight/state 等）散在模块顶层，被 free function 与类方法两处读写，无属主、无生命周期、无法实例化/注入/测试。修法是逐个收进 class——私有字段 + 显式生命周期方法（start/stop/dispose/register/lookup/flush）+ 单一写路径。代表：`SessionsWatcher`、`PluginProcessManager`、`ProviderCapabilitiesRegistry`、`DebugAgentReleaseRegistry`、`ClaudeResidentSessionRegistries`、`SessionHostsStore`、`VoiceClientAsrEngine`。但这条纪律只沉淀在任务与 memory，`backend-module-standards/SKILL.md` 里没有（frontend 标准反而已有 controller + dispose）。本任务把它写成 backend 标准的一条强制规则，以这些类为正例，不改任何运行代码。

## AC

- [x] 规则落地：`grep -niE "module-level|mutable state" .agents/skills/backend-module-standards/SKILL.md` 命中一条规则，要求「有内部状态/生命周期的模块级可变状态（缓存、注册表、timer）必须收进带显式生命周期方法的类或工厂对象，禁止散在模块顶层被 free function 读写」。
- [x] 点名正例：`grep -nE "SessionsWatcher|PluginProcessManager|ProviderCapabilitiesRegistry|VoiceClientAsrEngine" .agents/skills/backend-module-standards/SKILL.md` 至少命中一个正例类名。
- [x] 仅改标准：`git diff --stat -- .agents/skills/` 只含 `backend-module-standards/SKILL.md`；`git diff --name-only -- server/ src/` 无输出。

## DoD

贴出 `backend-module-standards/SKILL.md` 的 diff；用新规则逐条自检 `server/modules/providers/services/sessions-watcher.service.ts`——`SessionsWatcher` 已把 5 个模块级 `let` 收进私有字段 + `start()/stop()/scheduleUpdate()/flush()`，应判为「符合」——证明该规则能机械判定这个正例。

## Touches

- .agents/skills/backend-module-standards/SKILL.md
- tasks/gap-backend-state-lifecycle-encapsulation-standard.md
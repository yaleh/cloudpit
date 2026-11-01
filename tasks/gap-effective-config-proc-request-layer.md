---
id: gap-effective-config-proc-request-layer
title: effective_config 契约暴露 /proc 启动 argv 请求层
status: done
labels:
  - gap
  - knowledge-application
parent: null
children: []
extra:
  schema: execution
  acceptance: npx tsx --tsconfig server/tsconfig.json --test
    server/modules/mcp-gateway/tests/knowledge-effective-config-launch-request.test.ts
  applicationProgram:
    project: quay-fleet
    goal: GOAL-010
    ac: AC-090
  runtimeIntegration: true
---
## Proposal

2026-11-01 生产探针（quay-fleet 的 `effective-config-check` 知识，case `probe-effective-config-20261101`）暴露了一个契约缺口：运行期语义评估判 `check` 而不是 `propose`，其具名未知项第一条是「知识指定的 request 来源 `/proc/<pid>/cmdline`（`--model` / `--settings` / `--permission-mode`）尚未读取」——`effective_config` 事实只回了 provider transcript 一侧，进程的启动 argv 不在契约里。

transcript 与 argv 是**两种不同证据**：reconfigure 送到运行中的进程会改变下一轮请求，但不会改变进程的启动 argv；重新拉起进程则相反。把两者合并会让「这个进程被什么档案启动」冒充「这一轮请求了什么」。因此本切片新增一个独立的 `launchRequest` 读数，而不是把 argv 塞进 transcript 的判定里。

边界：`verified` 仍按 provider transcript 定义；`launchRequest` 缺失**不**把已验证的读数降级，它自己的 `state` 说明有没有读到。读不到（进程已死、/proc 不可读、没有活的 host）一律是具名 `unknown`；读取失败进 `readErrors`，绝不变成空 evidence。

## AC

- [x] `npx tsx --tsconfig server/tsconfig.json --test server/modules/mcp-gateway/tests/knowledge-effective-config-launch-request.test.ts` 退出 0：覆盖两种写法的 flag 解析、缺省 flag 是真 null、对**本进程真实** `/proc/<pid>/cmdline` 的读取（source=`proc-cmdline`、真实 sourceRef 与 argv）、死 pid 的具名 unknown + `readErrors` 条目、以及没有 live host 时的具名 unknown。
- [x] `npx tsx --tsconfig server/tsconfig.json --test server/modules/mcp-gateway/tests/knowledge-effective-config-proof.test.ts` 退出 0：原有 12 个正/负例不变（新增读数不进 `unknown`/`verified`，不改变 transcript 判定语义）。
- [x] `npx tsx --tsconfig server/tsconfig.json --test server/modules/mcp-gateway/tests/mcp-knowledge-facts.test.ts` 退出 0；`npx tsc --noEmit -p server/tsconfig.json` 退出 0。

## DoD

`knowledge_facts` 的 `effective_config` 读数在真实运行进程上带回 `launchRequest`：`{pid, argv, model, settings, permissionMode}`，来源 `proc-cmdline`、sourceRef 为 `/proc/<pid>/cmdline`。进程不存在或不可读时该字段是具名 `unknown`，读取失败在 `readErrors` 里点名；`verified` 的语义与既有 field-by-field 判定一字未改。上述三条测试与 typecheck 在本切片上真实通过。

## Touches

- server/shared/knowledge-facts.ts
- server/knowledge-facts-wiring.ts
- server/modules/mcp-gateway/tests/knowledge-effective-config-launch-request.test.ts
- tasks/gap-effective-config-proc-request-layer.md

## Evidence

2026-11-01/02 本切片（分支 `task/gap-effective-config-proc-request-layer`，commit `9be415857`）：

- 新判据：5/5 pass（parser 两种写法；缺省/null；本进程真实 `/proc` 读取；死 pid；无 host）。
- 原判据：`knowledge-effective-config-proof.test.ts` 12/12 pass；`mcp-knowledge-facts.test.ts` 7/7 pass。
- `npx tsc --noEmit -p server/tsconfig.json` 退出 0。
- 触发来源：quay-fleet 的 `docs/evidence`-侧探针会话 `e3ddbd0c-0054-4ad8-8cbe-2d26baca3734`（resident，pid 238115）在 15:54:57 的 judgment（`check`）逐字点名该缺口。

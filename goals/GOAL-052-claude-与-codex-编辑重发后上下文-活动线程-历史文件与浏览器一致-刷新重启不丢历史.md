---
id: GOAL-052
title: Claude 与 Codex 编辑重发后上下文、活动线程、历史文件与浏览器一致，刷新重启不丢历史
status: draft
kind: goal
origin: 人 yale 2026-10-31 本会话授权：对照 Claude Code 的编辑回退、resident 重建与身份回写，修复 Codex
  历史消失；采纳一个 goal、三个顺序依赖 task 的方案并要求创建和激活。实测应用会话
  0f0cf753-c01e-4b26-93de-b13f418710f9 的
  provider_session_id=01a18fa6-3a32-7391-a3df-5b21e0183f03，但 jsonl_path 指向分叉
  01a19003-6b28-7910-9bf2-39ed4276635e；原始对话仍在原文件。
---
## 目标

Claude 与 Codex 会话编辑重发后，模型上下文、活动线程、历史文件和浏览器显示保持一致；刷新、切换会话及服务重启后结果仍正确。覆盖 per-run 与 resident。应用会话身份稳定；编辑首条允许合法更换 provider 线程。

## 来源与现状

人 yale 2026-10-31 本会话授权：对照 Claude Code 的编辑回退、resident 重建与身份回写，修复 Codex 历史消失；采纳一个 goal、三个顺序依赖 task 的方案并要求创建和激活。实测应用会话 0f0cf753-c01e-4b26-93de-b13f418710f9 的 provider_session_id=01a18fa6-3a32-7391-a3df-5b21e0183f03，但 jsonl_path 指向分叉 01a19003-6b28-7910-9bf2-39ed4276635e；原始对话仍在原文件。

公共编辑网关把 provider 回退与 resident 关闭写成互斥分支，遗漏 Codex resident 的组合。身份回写可以单独覆盖线程 ID 并保留异线程路径。host manager 吞掉 driver.closeHost 异常，需要为编辑路径提供明确关闭结果。实际分叉文件仅含元数据的原因及当前 resident transcript 的保留前缀完整性仍待验证，不预设为同一根因。

## 范围和封装

- 工厂与依赖注入封装公共编辑编排：验证/准入、广播截断、关闭旧 resident 上下文、provider 回退准备、读取最新绑定启动、失败统一结算。生命周期与 provider 策略独立组合。
- Claude 保留 resumeSessionAt 与 parentUuid 分支过滤；Codex 保留 turnId/fork 与首条新线程；以明确准备结果表达差异，不增 provider 名字分支。
- 收口绑定替换与身份登记，维护 provider ID、路径、superseded 与缓存，隔离旧 run/host 回写，支持合法首次创建和恢复。
- 恢复本会话正确索引，操作前复核最新绑定与活动 host，保留修复前后读数和原文件，不覆盖后续合法编辑。
- 当前 CLI、跨模块和浏览器验证；前端复用已有统一消息协议。

## 退出条件

- AC-445：Claude/Codex × per-run/resident 均覆盖中间和首条编辑。仅获执行资格后变更；resident 旧 host 完成关闭后才 provider 准备并运行。明确区分恢复锚点与替换绑定；关闭失败、回退失败、启动失败不追加到旧上下文且统一结算，拒绝编辑零副作用；Claude 既有 resumeSessionAt/分支裁剪不回归。反向控制恢复互斥分支或吞关闭失败必须红。
- AC-446：区分首次登记/确认与主动绑定替换，后者原子维护 provider ID、路径、superseded 并失效相关缓存。旧 run/host、superseded 身份和异线程路径不能覆盖新绑定；覆盖合法首次创建、编辑首条、零回合恢复、watcher 竞争与迟到事件。本会话 0f0cf753-c01e-4b26-93de-b13f418710f9 修复前后真实读数可核对；保留早期排查、两次部署复验及讨论，刷新重启后仍可读；不改写原文件，不覆盖修复前新发生的合法绑定变更。
- AC-447：新增有界验收入口，执行跨模块 session-edit-continuity.test.ts 与浏览器回归并检查报告，不用仅静态字符串/文件存在判绿。覆盖 Claude/Codex × per-run/resident，多轮→编辑中间/首条→续聊→刷新→切换→隔离实例重启；原保留历史完整，被替换分支不复活，无重复。当前 resident 生成的真实 Codex transcript 以实际 CLI 分叉/恢复证明保留前缀与模型上下文；MCP 浏览器实际操作截图存 tmp/；存在可用场景同时提交 ui-scenario JSON 和检查点截图。真实证据缺失不能以替身或 skip 宣称达成。

三项均需可重跑判据与证据。服务/接口数量不是退出条件，子项完成不能代替组合验收。UI 验证包含 MCP 浏览器实际操作、tmp/ 截图；存在可用场景同时提交运行器 JSON 与检查点截图。

## 执行划分

gap-session-edit-preparation → gap-session-binding-consistency → gap-session-edit-continuity-e2e，三个 task 顺序依赖。抽象封装随前两项完成，不另建架构重构任务。

## 非目标与约束

不改写原始 transcript，不统一 provider 存储/分支算法，不扩展其他 provider 的新编辑能力，不构建通用工作流框架。不以重启共享生产服务验证隔离实例重启场景。遵守仓库后端/前端模块规范及有界测试内存规则，完整 suite 交给 quay fan-in。
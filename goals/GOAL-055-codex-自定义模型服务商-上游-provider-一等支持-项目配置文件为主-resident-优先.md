---
id: GOAL-055
title: Codex 自定义模型服务商（上游 provider）一等支持：项目配置文件为主、resident 优先
status: active
kind: goal
origin: 人 yale 2026-11-02 会话裁定。三条方向：① 项目运行 codex 以本项目提供的设置为准，用户 ~/.codex profile
  仅兼容、不为主场景；② 配置主要用配置文件管理（settings 文件 + 0600 tokenFile
  secret），环境变量是最后临时手段（secret 只在 spawn 时经 env_key 交给子进程，不进 argv）；③ 优先 resident
  实现，per-run 为第二路径。四问题裁决：Q1 provider 注册表为项目级一等配置（不 inline、不复活 launch profile）；Q2
  用户 profile 只读导入；Q3 换 provider 拒绝 + 一键 fork；Q4 wire_api 仅 responses。secret 用
  tokenFile。
activatedAt: 2026-11-02T09:10:23.901Z
statusLog:
  - at: 2026-11-02T09:10:23.901Z
    from: draft
    to: active
    actor: goal-cli
    reason: ""
---
## 背景

per-run Codex 用 @openai/codex-sdk 的 startThread/resumeThread/runStreamed（server/modules/providers/list/codex/codex-runtime.provider.ts），resident 用长驻 app-server（codex-host-driver.provider.ts）。两条路径今天都不读模型库的自定义模型配置：provider_models 的 config.env 是 Claude 专用白名单（ANTHROPIC_*/CLAUDE_CODE_*/CLAUDE_AUTOCOMPACT_*，server/modules/providers/services/launch-spec.service.ts），Codex runtime 从不消费它、从不调用 resolveModelLaunchSpec；换端点只能手改 ~/.codex/config.toml，全实例共用同一份。Codex 0.166.0 有一等的上游 provider 接口（model_provider + [model_providers.<id>]，app-server thread/start|resume 有 modelProvider/config，SDK 有 CodexOptions.config/env）。本 goal 把 Codex 自定义服务商做成一等设置。

## 范围

- 项目级 Codex provider 配置面：settings 文件 + 0600 + tokenFile secret + 读写路由（版本冲突）。
- 模型条目挂 codexProviderId；未声明 = 继承 Codex 全局（现行为）。
- 会话记录 model_provider_id；换 provider 拒绝 + 一键 fork；删除/改名被引用 provider 保护。
- resident：app-server spawn 时 -c model_provider + -c model_providers.<id>={...}；secret 经 env_key 交给子进程，不进 argv；restore/resume 从会话 provider id 重注入；缺配置给可读错误，绝不静默回落 openai。
- per-run：new Codex({ config, env })。
- UI：Settings → Agents → Codex 服务商设置 + 模型编辑器 provider 区。

## 非目标（本期）

- Chat Completions-only 网关翻译（wire_api 只接受 responses）。
- Bedrock/Vertex/命令式 auth（auth.command）。
- model_catalog_url / effort 元数据 / 上下文窗口（列 AC-467 的 P2 任务）。
- 写入用户 ~/.codex/config.toml / profile（只读导入兼容）。
- 端点共享实体（provider 注册表已是项目级一等配置，模型条目只引用 providerId，不复活 launch profile）。

## 退出条件

- AC-460 配置面：provider 写入校验（保留 id openai/ollama/lmstudio 拒绝、wire_api 非 responses 拒绝、未知字段如 api 告警）、secret 只写、settings 文件 0600、tokenFile 只读、版本冲突可读。
- AC-461 模型条目挂 provider：可声明 codexProviderId；未声明继承全局；声明不存在/已删 provider 可读拒绝；目录显示 model · provider。
- AC-462 会话记录 provider id：首发送落库 model_provider_id；换 provider 拒绝 + 一键 fork；删除/改名被引用 provider 保护。
- AC-463 resident 注入 + restore/resume：真实 app-server 把请求打到本地 mock /v1/responses，Authorization 来自 tokenFile secret、宿主 env 哨兵不泄漏、secret 不进 argv；residentRestore 后同 provider id 可 resume。
- AC-464 per-run SDK 注入：真实 mock E2E 同 AC-463 的 wire 事实。
- AC-465 UI：Settings → Agents → Codex 服务商 CRUD + 模型编辑器 provider 区，secret 掩码、Responses-only 提示；真实浏览器 MCP + 场景运行器。
- AC-466 兼容导入：只读导入用户 ~/.codex/config.toml / <name>.config.toml 的 provider（name/base_url/env_key，不读 secret），绑定为 providerId；项目文件仍是唯一写入点。
- AC-467 连接测试 + 高级字段：http_headers/env_http_headers/query_params/request_max_retries/stream_max_retries/stream_idle_timeout_ms/model_catalog_url + effort/上下文窗口（P2）。

## 关键约束（已实测，任务 DoD 必须遵守）

- provider 是进程级绑定：只在 thread/start 传 modelProvider 会 start 成功、turn 才 modelProviderMismatch（currentModelProvider 仍是 openai）；必须 spawn 时 -c。（0.166.0 实测）
- resume 要求同 provider id 配置仍在：缺配置 modelProviderNotConfigured、不匹配 modelProviderMismatch；同 id 改端点可重启 host 后 resume，换 id 必须新会话/fork。
- codex app-server 不支持 -p/--profile，profile="..." 是 legacy 拒绝。
- wire_api="chat" 在 0.166 直接拒绝加载。
- 自定义 provider 下 model/list 仍返回 OpenAI 目录；自定义 model id 可直接传 model 字段。
- secret 永不进 argv（不写 experimental_bearer_token）；tokenFile 只读、0600。
- 架构红线：后端不新增 provider-id 分支到 server/modules/providers/list/ 之外；前端 provider 差异走 PROVIDER_DESCRIPTORS 数据，不写 provider === 'codex'。
- 测试预算：新 server 测试文件撞时长基线/未知 pin，优先扩既有文件。

## 任务映射

- AC-460 ← codex-provider-config-surface
- AC-461 ← codex-model-entry-provider-binding
- AC-462 ← codex-session-provider-id-binding
- AC-463 ← codex-resident-provider-injection
- AC-464 ← codex-perrun-provider-injection
- AC-465 ← codex-provider-settings-ui
- AC-466 ← codex-provider-import-user-profile
- AC-467 ← codex-provider-advanced-capabilities
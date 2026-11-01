---
id: gap-claudecodeui-fix-worker-meta-cc-blacklist
title: claudecodeui dev-tree profiles：fix-worker 补拉黑 meta-cc，与 shipped 载体对齐
status: todo
labels:
  - gap
parent: null
children: []
extra:
  schema: execution
---
## Proposal

对端（quay 项目会话）已排查确认 fix-worker 不依赖 meta-cc：fix-worker 是短命 ABI 立案/修任务代理，promotion-driver `buildFixWorkerPrompt`、goal-driver `buildGapWorkerPrompt`、quality-gate-driver 三处 gap-filing agent 的 prompt 均无 meta-cc；fan-in 语义兜底是 worker-driver 驱动的 workflow，不是 fix-worker 会话。刚落地的 `gap-claudecodeui-profiles-driver-token-slim` 在 fix-worker 上留了「meta-cc 暂不拉黑（对端排查中）」，现在结论已出：补上即可。改动只有一处——dev-tree `.quay/profiles.yml` 的 `fix-worker.mcpBlacklist` 追加 `meta-cc`，并把该处「meta-cc 暂不拉黑」注释更新为已确认结论，使 dev-tree 与 shipped `plugin/.quay/profiles.yml`（对端已含 meta-cc）两份载体同构，避免 profiles-role-coverage-check 报两份 carrier 漂移。

## AC

- [ ] python3 -c "import yaml;d=yaml.safe_load(open('.quay/profiles.yml'));r=d['roles'];assert 'meta-cc' in r['fix-worker']['mcpBlacklist'],'fix-worker 未拉黑 meta-cc'"

## DoD

dev-tree `.quay/profiles.yml` 已提交：fix-worker 的 `mcpBlacklist` 含 meta-cc，与 shipped 载体一致；两份 carrier 的 fix-worker 黑名单集合相同（profiles-role-coverage-check 不报漂移）。

## Touches

- .quay/profiles.yml
- tasks/gap-claudecodeui-fix-worker-meta-cc-blacklist.md
---
id: gap-test-runner-unsets-host-live-voice-and-s2-env
title: test-runner unsets host live voice/S2 env before running tests
  (RESIDENT_RUN_IS_TURN / VOICE_REALTIME_* / VOICE_CAPTURE / SENSEVOICE_*)
status: ready
labels:
  - gap
parent: null
children: []
extra:
  schema: execution
---
## Proposal

现状（2026-10-26 实测，已确认）：quay anchor 从启动它的 shell 继承了 claudecodeui-server.service 的 live 环境——`RESIDENT_RUN_IS_TURN=1`（来自 `~/.config/systemd/user/claudecodeui-server.service.d/40-resident-run-is-turn.conf`）、`VOICE_REALTIME_*` 与 `VOICE_CAPTURE`、`SENSEVOICE_*`（来自 20/30/50/60-*.conf）。anchor 把这些变量传给 worker-driver → fan-in suite。而 `scripts/test.sh` 里没有任何 `env -u` / `unset` 清除它们，于是 15 个按「出厂默认」写的测试文件确定性红：10 个 S2 flag-off 语义（mcp-gateway×3、debug-agent×1、claude-resident×5、websocket×1）＋ 5 个 voice（silence_duration_ms 断言默认 800，实际读到 live settings 的 1500）。实证：`env -u RESIDENT_RUN_IS_TURN -u VOICE_REALTIME_* ... node --import tsx --import ./scripts/undici-blocked-ports-preload.mjs --test server/modules/mcp-gateway/tests/mcp-session-lifecycle.test.ts` → 15/15 pass；voice-realtime-uplink-vad-arm-point → 28/28 pass。即 15 个红 100% 是宿主 env 泄漏，不是代码回归。

要做：让测试运行器与宿主 env 解耦——在 `scripts/test.sh` 的 server/client 测试执行路径前统一 `unset` 这些宿主开关（`RESIDENT_RUN_IS_TURN`、`VOICE_REALTIME_*`、`VOICE_CAPTURE`、`SENSEVOICE_*`），使 suite 无论 anchor 从什么 shell 起都按出厂默认跑。只改运行器，不改任何测试文件与被测代码，也不改服务端生产 drop-ins（它们对 live server 是对的）。`scripts/quay-rerun-failed.sh` 已把 server 文件交给 test.sh，自动覆盖，不改它；e2e lane（playwright）不消费这些变量，也不在本次 15 个红文件里，不改。

范围外：把 S2（run=turn）相关测试迁到 flag-on 语义——那是「生产 flag-on 而测试 flag-off」的语义漂移，需要另一个单独裁定，本任务不碰；改 drop-ins；改被测代码。

## AC

- [ ] `grep -nE 'RESIDENT_RUN_IS_TURN|VOICE_REALTIME|VOICE_CAPTURE|SENSEVOICE' scripts/test.sh` 的输出里，出现把这些变量从环境里清除的语句（`unset` 或 `env -u`，写在测试执行之前，不是注释里）。
- [ ] 取假钉（证明不清理就红）：在显式带上 live env 的 shell 里 `env RESIDENT_RUN_IS_TURN=1 VOICE_REALTIME_SETTINGS_PATH=/data/home/yale/.config/claudecodeui/voice-realtime.settings.json bash scripts/test.sh --root <worktree> server/modules/mcp-gateway/tests/mcp-session-lifecycle.test.ts` exit 0（该文件 15/15 pass）——若 test.sh 没有清 env，这条会确定性红。
- [ ] 同上带 voice env 跑 `env RESIDENT_RUN_IS_TURN=1 VOICE_REALTIME_UPLINK_VAD=silero VOICE_REALTIME_SETTINGS_PATH=/data/home/yale/.config/claudecodeui/voice-realtime.settings.json bash scripts/test.sh --root <worktree> server/modules/voice-realtime/tests/voice-realtime-uplink-vad-arm-point.test.ts` exit 0（28/28 pass）。
- [ ] 不带这些 env 时也仍然绿：`env -u RESIDENT_RUN_IS_TURN -u VOICE_REALTIME_SETTINGS_PATH -u VOICE_REALTIME_UPLINK_VAD -u VOICE_CAPTURE bash scripts/test.sh --root <worktree> server/modules/mcp-gateway/tests/mcp-session-lifecycle.test.ts server/modules/voice-realtime/tests/voice-realtime-uplink-vad-arm-point.test.ts` exit 0。
- [ ] 最小改动：`git diff --stat` 只动 `scripts/test.sh` 与本任务文件，不含任何 `server/**`、`src/**`、测试文件的改动；`bash -n scripts/test.sh` exit 0。

## DoD

在真实 worktree 里留证（截图/命令读数贴任务）：(1) 带 live env 的 shell 里跑上面 mcp-session-lifecycle 与 voice 两条，贴 exit 0 与 pass 数；(2) 不带 env 的 shell 里各再跑一次，贴 exit 0（证明两态都绿）；(3) 贴 `git diff -- scripts/test.sh` 的完整 diff 与 `grep -nE 'RESIDENT_RUN_IS_TURN|VOICE_REALTIME|VOICE_CAPTURE|SENSEVOICE' scripts/test.sh` 的读数。仅描述不算完成，必须有真实命令读数。

## Touches

- scripts/test.sh
- tasks/gap-test-runner-unsets-host-live-voice-and-s2-env.md

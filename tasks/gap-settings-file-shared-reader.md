---
id: gap-settings-file-shared-reader
title: 把 4 份近似克隆的 server.settings 读取器收敛到 server/shared/settings-file.ts（叶子，不动导入环预算）
status: ready
labels:
  - gap
parent: null
children: []
extra:
  schema: execution
---
## Proposal

<!-- dedup-ref --> 同批 6 条重构的第 1 条（2026-10-26 架构复查）；`gap-llm-gateway-leaf-module` 与 `gap-shared-utils-small-helpers-dedup` 与本任务共享若干文件，已用 depends_on 串行。

### 现状（2026-10-26 实测）

四个模块各自手写一份「读一份 JSON 设置文件中的某个 block」——三份读 `server.settings.json`（`cockpit.counterVoice`、`observation.sessionDigest`、`architecture.refresh`），reply-suggestions 读它自己的设置文件（`REPLY_SUGGESTIONS_SETTINGS_PATH` 指向的那份）：
- `server/modules/quay/counter-voice-settings.ts`（394 行）
- `server/modules/observation/session-digest-llm-settings.ts`（387 行）
- `server/modules/reply-suggestions/reply-suggestions-settings.ts`（627 行）
- `server/modules/architecture/refresh-settings.ts`（299 行）

前两份有 138 行非平凡代码逐行相同；`resolveApiKey` / `readBoolean` / `readString` / `readInteger` 逐字节一致；`expandHome` 在 `refresh-settings.ts` 中再抄一份；`isRecord`、`errorMessage`、`defaultServerSettingsPath` 各抄 3–4 次。后端标准要求两处以上使用的工具进 `server/shared/`，这里没做。

### 改法

新增 `server/shared/settings-file.ts`：导出 `expandHome`、`defaultServerSettingsPath`、`readBoolean/readString/readInteger/readEnum`（带 problems sink）、`resolveApiKey`，以及 `createSettingsBlockSource({ settingsPath, homeDir, block, parse })`（`settingsPath` 由调用方给出，因此同时适用于 `server.settings.json` 与 reply-suggestions 的独立设置文件）——按 mtime+size 缓存、文件变化重读、解析失败 fail-closed 返回默认值并记 problem。四个读取器只保留各自 block 的 schema（`parse` 回调）与对外类型，公开签名不变。

### 导入环预算（AC-394）

新文件位于既有目录 `server/shared`，**是叶子**：只 import `node:*` 与 `server/shared/**`，不 import 任何 `server/modules/**`。因此 `directoryManifest`、`nodeCount`（56）、`cycleGroups`、`unresolvedInternalBudget`（19）全部不变，基线 JSON 与 `MANIFEST_PIN` 不得改动。

## AC

- [ ] 共享读取器落地：`grep -nE "export function (createSettingsBlockSource|resolveApiKey|readBoolean|readString|readInteger|expandHome)" server/shared/settings-file.ts` 命中全部 6 个导出，且各带 consumer 注释。
- [ ] 叶子形态：`grep -nE "from '" server/shared/settings-file.ts | grep -vE "from '(node:[a-z/]+|@/shared/[^']+|\./[^']+)'"` 无输出（只依赖 node 内置与 server/shared）。
- [ ] 克隆消失：`grep -nE "^function (resolveApiKey|readBoolean|readString|readInteger|expandHome|isRecord|defaultServerSettingsPath)\(" server/modules/quay/counter-voice-settings.ts server/modules/observation/session-digest-llm-settings.ts server/modules/reply-suggestions/reply-suggestions-settings.ts server/modules/architecture/refresh-settings.ts` 无输出。
- [ ] 体量下降：`cat server/modules/quay/counter-voice-settings.ts server/modules/observation/session-digest-llm-settings.ts server/modules/reply-suggestions/reply-suggestions-settings.ts server/modules/architecture/refresh-settings.ts | wc -l` ≤ 1250（现 1707）。
- [ ] 新判据：`npx tsx --tsconfig server/tsconfig.json --import ./scripts/undici-blocked-ports-preload.mjs --test server/shared/tests/settings-file.test.ts` exit 0，覆盖 mtime 未变不重读、文件变化重读、缺文件/坏 JSON 返回默认值并记 problem、`~` 展开、`apiKeyFile` 解析。
- [ ] 行为不回归：`npx tsx --tsconfig server/tsconfig.json --import ./scripts/undici-blocked-ports-preload.mjs --test server/modules/quay/tests/counter-voice.test.ts server/modules/observation/tests/session-digest-llm.test.ts server/modules/reply-suggestions/tests/reply-suggestions-settings.test.ts server/modules/architecture/tests/refreshJob.test.ts` exit 0。
- [ ] 导入环预算不变：`npx tsx --tsconfig server/tsconfig.json --test server/shared/tests/server-import-cycle-budget.test.ts` exit 0，且 `git diff --quiet HEAD -- server/shared/tests/server-import-cycle-budget.baseline.json server/shared/tests/server-import-cycle-budget.test.ts` exit 0（基线与 MANIFEST_PIN 一字未改）。
- [ ] 静态检查：`npx tsc --noEmit -p server/tsconfig.json` exit 0；`npx oxlint server/shared server/modules/quay server/modules/observation server/modules/reply-suggestions server/modules/architecture` exit 0。

## DoD

用 `npm run build:server` 产出的 dist 在一个临时 HOME 下真实读一次：写一份含 `cockpit.counterVoice`、`observation.sessionDigest`、`architecture.refresh` 三个 block 的 `server.settings.json`，再写一份 reply-suggestions 设置文件，分别调用四个 `create*SettingsSource()` 读数并贴出；改写文件（mtime 变化）后再读一次，贴出读数变化；最后删掉文件再读，贴出 fail-closed 默认值与 problem 文本。三次读数证明共享读取器在真实 fs 上替换了四份克隆且行为不变。

## Touches

- server/shared/settings-file.ts (new)
- server/shared/tests/settings-file.test.ts (new)
- server/modules/quay/counter-voice-settings.ts
- server/modules/observation/session-digest-llm-settings.ts
- server/modules/reply-suggestions/reply-suggestions-settings.ts
- server/modules/architecture/refresh-settings.ts
- server/shared/tests/quay-test-script.test.ts
- scripts/suite-duration-baseline.tsv
- tasks/gap-settings-file-shared-reader.md
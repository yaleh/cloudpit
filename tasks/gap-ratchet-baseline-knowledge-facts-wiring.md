---
id: gap-ratchet-baseline-knowledge-facts-wiring
title: 补 architecture-ratchet 基线：server/knowledge-facts-wiring.ts
  基线外→842（RECORDED CHANGE），让 architecture-ratchet 判据转绿
status: ready
labels:
  - gap
parent: null
children: []
extra:
  schema: execution
---
## Proposal

`server/knowledge-facts-wiring.ts` 由 `9be415857`（effective_config launchRequest 切片）引入，当前 842 行，超过 800 行的 oversize 上限，且不在 `server/shared/tests/architecture-ratchet.baseline.json` 的 `oversizeFiles` 里。于是 `npx tsx --tsconfig server/tsconfig.json --test server/shared/tests/architecture-ratchet.test.ts` 在 develop 上稳定红：

    ratchet: oversizeFiles server/knowledge-facts-wiring.ts 基线外→842 — 基线外的文件不得超过 800 行

2026-11-02 复核：该文件在 HEAD 上就是 842 行，基线里没有这个键，红色与任何在办任务的 delta 无关；它会让整套 suite 的 architecture-ratchet 判据一直红。本任务按既有的 RECORDED CHANGE 程序把它登记进基线，而不是拆分文件——拆分是另一条独立的重构，不在本切片内。

做什么：

1. 在 `server/shared/tests/architecture-ratchet.baseline.json` 的 `oversizeFiles` 增加 `"server/knowledge-facts-wiring.ts": 842`。
2. 在同一个文件的 `note` 里按 AC-394 的 RECORDED CHANGE 格式追加一段：日期 2026-11-02、点名该文件、读数 `基线外→842`、并说明为什么这是诚实的形状（该文件是 effective-config 切片的 wiring 组合根，842 是其随任务交付的真实行数；本任务只登记既有交付，不扩大文件）。
3. 不改 `server/knowledge-facts-wiring.ts`，不拆分，不调整其它基线条目。

<!-- dedup-ref --> 机制去重（2026-11-02，root=/data/home/yale/work/claudecodeui）：`grep -rln 'knowledge-facts-wiring' tasks/*.md` 只命中 4 个机制不同的任务（effective_config 契约与 knowledge 证明），没有任务认领 architecture-ratchet 基线；`grep -rln 'architecture-ratchet.baseline' tasks/*.md` 命中的都是各自实现期登记自己读数的任务。`task-granularity-advice.js --touches server/shared/tests/architecture-ratchet.baseline.json --touches server/shared/tests/architecture-ratchet.test.ts --json` 返回 `peers: []`（基线文件被工具排除），决定 separate。

## AC

- [x] `npx tsx --tsconfig server/tsconfig.json --test server/shared/tests/architecture-ratchet.test.ts` 退出 0；stdout 不再出现 `server/knowledge-facts-wiring.ts 基线外→842`，贴出 `# tests` / `# pass` / `# fail` 逐字读数（实现前同一命令在该树红，逐字为 `ratchet: oversizeFiles server/knowledge-facts-wiring.ts 基线外→842 — 基线外的文件不得超过 800 行`）。
- [x] `node -e "const b=require('./server/shared/tests/architecture-ratchet.baseline.json'); if(b.oversizeFiles['server/knowledge-facts-wiring.ts']!==842) process.exit(1); if(!b.note.includes('knowledge-facts-wiring.ts')||!b.note.includes('基线外→842')||!b.note.includes('RECORDED CHANGE (2026-11-02')) process.exit(2);"` 退出 0（条目值恰为 842，note 含当天日期的 RECORDED CHANGE 且点名该文件与读数）。
- [x] 假形态变红：临时删掉 `oversizeFiles` 里的这条条目 ⇒ 第一条判据红并逐字重新出现 `ratchet: oversizeFiles server/knowledge-facts-wiring.ts 基线外→842`；改完即还原并复跑为绿，贴出红/绿两次读数。

## DoD

在交付树上真实运行 `npx tsx --tsconfig server/tsconfig.json --test server/shared/tests/architecture-ratchet.test.ts`，贴出 `# tests` / `# pass` / `# fail` 与「无 `knowledge-facts-wiring.ts 基线外→842` 行」的逐字证据；`node -e` 读回基线 JSON 的条目值为 842 且 note 含 RECORDED CHANGE；`git diff --stat` 只含本任务声明的文件（基线 + 任务文件），`server/knowledge-facts-wiring.ts` 零改动。不涉及 UI。

该轴仍暗,理由:本任务只登记既有的 oversize 行数读数与 note 文本，不产生可测的 L_D/L_G 读数变化。

## Touches

- server/shared/tests/architecture-ratchet.baseline.json
- server/shared/tests/architecture-ratchet.test.ts
- tasks/gap-ratchet-baseline-knowledge-facts-wiring.md

---
id: gap-ratchet-baseline-knowledge-facts-wiring
title: 补 architecture-ratchet 基线：server/knowledge-facts-wiring.ts
  基线外→842（RECORDED CHANGE），让 architecture-ratchet 判据转绿
status: done
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

在交付树上真实运行 `npx tsx --tsconfig server/tsconfig.json --test server/shared/tests/architecture-ratchet.test.ts`，贴出 `# tests` / `# pass` / `# fail` 与「无 `knowledge-facts-wiring.ts 基线外→842` 行」的逐字证据；`node -e` 读回基线 JSON 的条目值为 842 且 note 含 RECORDED CHANGE；`git diff --stat` 只含本任务声明的文件（基线 + pin/时长基线 + 任务文件），`server/knowledge-facts-wiring.ts` 零改动。不涉及 UI。

该轴仍暗,理由:本任务只登记既有的 oversize 行数读数与 note 文本，不产生可测的 L_D/L_G 读数变化。

## Touches

- server/shared/tests/architecture-ratchet.baseline.json
- server/shared/tests/architecture-ratchet.test.ts
- server/shared/tests/quay-test-script.test.ts
- scripts/suite-duration-baseline.tsv
- tasks/gap-ratchet-baseline-knowledge-facts-wiring.md

## Evidence

2026-11-02（续跑轮，分支 `task/gap-ratchet-baseline-knowledge-facts-wiring`）：

- 本任务交付不变：`architecture-ratchet.baseline.json` 的 `oversizeFiles["server/knowledge-facts-wiring.ts"]=842` 与 RECORDED CHANGE note 已在 commit `66c6981aa`；`server/knowledge-facts-wiring.ts` 零改动。
- AC1 复跑：`npx tsx --tsconfig server/tsconfig.json --test server/shared/tests/architecture-ratchet.test.ts` → `# tests 6` / `# pass 6` / `# fail 0`，stdout 无 `server/knowledge-facts-wiring.ts 基线外→842`。
- AC2 复跑：`node -e ...` 退出 0（条目 842，note 含 RECORDED CHANGE (2026-11-02)）。
- 续跑附带修复 develop 全局红（与任何在办任务 delta 无关；`.quay/develop-red-set.json` 已把 `quay-test-script.test.ts` 记为空签名红）：`9be415857` 新增 `knowledge-effective-config-launch-request.test.ts` 后没有移动 `quay-test-script.test.ts` 的两条 count pin，也没有补时长基线行，导致 develop tip 上 AC2/AC3 实读 `unknown=494`/`496` 而钉 `493`/`495`、AC7 实读 `447/497=89.94%` 低于 90%。本分支把它修绿：pin 移 493→494 / 495→496，时长基线追加该文件实测 `1863ms` 行（`448/497=90.14%`）。单文件复跑 `server/shared/tests/quay-test-script.test.ts`：`# tests 14` / `# pass 14` / `# fail 0`。

---
id: gap-ac425-card-viz-and-zone-coverage
title: AC-425 判据命令已在 develop 绿（CockpitCard.test.tsx 9 passed），但 expect
  的小可视化条款无实现（cockpitCardDescriptors 的 viz 无消费者、CockpitCard 类型无 viz
  字段），选中选项完整说明与四区分别点按也未被判据覆盖——补齐描述表驱动的 viz 渲染与判据，并用顶层 goal_ac 认领 AC-425
status: ready
labels:
  - gap
parent: null
children: []
extra:
  schema: execution
goal_ac: AC-425
---
## Proposal

<!-- dedup-ref --> 机制去重读数（本轮立案实测，2026-10-27）：`grep -E '^goal_ac: *AC-425' tasks/*.md` 命中 **0**；在飞集合（status 为 todo / ready / needs-human）里正文提到 AC-425 的任务 **0**。唯一同名物是 cockpit-card-ui-core（done，顶层 goal_ac 为 AC-424），它把 AC-425 判据作为自己 AC 清单的第二条实现并勾选，是这条判据的实现先例，不是在飞认领者。粒度工具 `task-granularity-advice.js` 报 peers 只有 cockpit-fleet-card-provider（ready），共享文件仅 src/shared/types.ts 与 server/shared/types.ts 两份线上类型镜像；它做的是 fleet 提供方投影（AC-432），与本条的卡片渲染判据是不同机制、独立验收，故分开立案，二者由 Touches 串行化，不合并。

判据物（goal 文件逐字）：`npx vitest run src/modules/cockpit/tests/CockpitCard.test.tsx`。

本轮现测（主检出 /data/home/yale/work/claudecodeui，branch author，HEAD 3cf5f3c4e）：该命令 **exit 0**，`Test Files 1 passed (1) / Tests 9 passed (9)`；文件已存在于 develop（f5883099f `feat(cockpit): cards view with a controller-bound confirm flow`）。⇒ 判据命令并不红。AC 现在的缺口是 (a) 没有任务带顶层 `goal_ac: AC-425`；(b) expect 里有句子没有被现有实现或判据真正覆盖。

expect 逐句对照：

| expect 句 | 现状 |
| --- | --- |
| 点按头部、问题、情境或事实区域即请求打开 Details | 实现是一个整体 A 区；判据只点 `cockpit-card-zone-a`，没有分别点四个子区域 |
| 卡片上不存在独立的 Alternatives 或 Details 按钮 | 已覆盖 |
| 下拉每一项显示富文本说明（做什么与后果标签），末项是带编辑框的「自己的回复」 | 已覆盖（提供方声明 `ownReply` 的卡片） |
| 选中的选项在卡片上显示完整说明 | 组件有 `cockpit-card-shown-option` 渲染 `does`/`why`，判据只断言了下拉项与触发器，没断言这一块 |
| 确认条的标签带该选项名 | 已覆盖 |
| 不可逆选项的确认条为警示样式 | 已覆盖 |
| 卡片类型与小可视化按描述表渲染 | **未实现**：`cockpitCardDescriptors.ts` 的 `viz` 字段无任何消费者（`grep -rn '\.viz\b' src/ server/` 只命中定义处），`CockpitCard` 线上类型也没有 `viz` 字段，提供方无处传数据 |
| 未知类型走默认渲染而不报错 | 已覆盖（但只断言了徽标，没有断言「无 viz」） |

做什么：

- 共享类型两侧（`src/shared/types.ts` 与 `server/shared/types.ts`，逐字镜像）加固定词汇的类型：

  ```ts
  export type CockpitCardVizKind = 'attempts' | 'steps' | 'history' | 'size' | 'parts';

  export type CockpitCardViz = {
    kind: CockpitCardVizKind;
    /** attempts：尝试次数；steps：1 起的三步位置；parts：子决定数。 */
    count?: number;
    /** history：三段堆叠条的三个非负权重。 */
    history?: { yes: number; no: number; other: number };
    /** size：一个读数与其上限，total 必须 > 0。 */
    size?: { current: number; total: number };
  };
  ```

  `CockpitCard` 加可选字段 `viz?: CockpitCardViz`。`src/modules/cockpit/cockpitCardDescriptors.ts` 改为从共享类型导入并再导出 `CockpitCardVizKind`，使 `CockpitCardDescriptor.viz` 与卡片数据用同一套词汇。TypeSync 测试的 ROWS 补 `CockpitCardVizKind`（union）与 `CockpitCardViz`（object）两行，两侧字段集必须一致。
- 新文件 `src/modules/cockpit/CockpitCardViz.tsx`：按描述表选择形状，不按卡片 kind 或 provider 分支。`descriptor.viz === null`、`card.viz` 缺失、或 `card.viz.kind !== descriptor.viz` 时都不渲染、不抛错；否则渲染 `data-testid="cockpit-card-viz"` 与 `data-viz-kind`，并按词汇提供可机械读取的读数属性：
  - `attempts`：`data-viz-count` 与同样数目的圆点；
  - `steps`：三个节点，`data-viz-step` 为 1 起的位置，当前节点带 `data-viz-current="true"`；
  - `history`：三段 `data-viz-segment="yes|no|other"` 的堆叠条，宽度按权重；
  - `size`：轨道与填充，`data-viz-ratio` 为 current/total；
  - `parts`：`count` 个编号圆点（①②③…）。

  图形是装饰（`aria-hidden="true"`），读数以 `data-*` 与卡片 facts 文本为准，不新增 locale key。
- `server/modules/cockpit/cockpit-fixture-card-provider.ts` 给六张夹具卡各带 `viz` 数据（need→size、stuck→attempts、fix→steps、ask→history、multi→parts、decision→history），供 DoD 在真实页面看到描述表渲染；夹具仍是六张已知 kind，不新增第七张，以免改变已有场景 `cockpit-cards-confirm` 钉住的可见卡片读数。
- `src/modules/cockpit/tests/CockpitCard.test.tsx` 补齐 expect 的每一句：分别点按头部、问题、情境、事实四个子区域；未展开时 `cockpit-card-shown-option` 含选中项的完整 `does`；对每个已知 kind 断言徽标与描述表 viz；未知 kind 断言默认徽标、无 viz、不抛错。
- `server/shared/tests/architecture-ratchet.baseline.json`：两份 types.ts 都是 oversize 基线内文件，加行会红；按基线 note 自带的 RECORDED CHANGE 格式按实测值重录这两条并写明为何增加是该改动的诚实形态。

如实记录的偏差：`ownReply` 编辑框只在提供方声明 `ownReply` 的卡片上渲染（服务端对未声明的卡片拒绝 `replyText`），判据沿用声明了 `ownReply` 的夹具；viz 不新增 i18n key，图形本身 `aria-hidden`，判据读 `data-*`。

## AC

- [ ] `npx vitest run src/modules/cockpit/tests/CockpitCard.test.tsx` 退出 0（AC-425 判据），且该文件覆盖 expect 的每一句：头部、问题、情境、事实四个子区域分别点按各请求一次打开 Details；卡片上没有名为 Alternatives/Details 的按钮；下拉每一项显示 `does` 与后果标签，末项是带 `textarea` 的「自己的回复」；未展开时 `cockpit-card-shown-option` 含选中项的完整 `does`；确认条标签带选项名；不可逆选项 `data-irreversible="true"` 且带警示样式；每个已知 kind 渲染描述表徽标与 `data-viz-kind` 等于该 kind 的 `descriptor.viz`；未知 kind 渲染默认徽标、无 `cockpit-card-viz` 且不抛错。
- [ ] 假形态各自变红并还原：删掉 `ShownOptionExplanation` ⇒ 选中说明用例红；让 viz 渲染忽略 `descriptor.viz`/`card.viz` ⇒ viz 用例红；在卡片上加一个独立的 Details 按钮 ⇒ 无独立按钮用例红。每条改完即还原。
- [ ] `npx vitest run src/shared/tests/cockpitCardTypeSync.test.ts` 退出 0（两份 shared/types.ts 的 `CockpitCardVizKind` 成员与 `CockpitCardViz` 字段集一致）。
- [ ] `npx vitest run src/modules/cockpit/tests` 退出 0，既有用例数不减少。
- [ ] `npx tsx --tsconfig server/tsconfig.json --test server/shared/tests/architecture-ratchet.test.ts` 退出 0；两份 types.ts 的行数按基线 note 的 RECORDED CHANGE 格式按实测值重录并写明理由。
- [ ] `npm run typecheck` 与 `npm run lint` 退出 0（lint 仅既有 warning）。

## DoD

在隔离实例（`scripts/isolated-instance.sh start`）里打开 `cockpit.fixtureCards`，用 MCP 浏览器在 390 与 1280 两个宽度打开 `/cockpit?view=cards`，逐张确认小可视化真的画出来：stuck 卡的尝试圆点、fix 卡的三步节点、ask 与 decision 卡的三段堆叠条、multi 卡的编号圆点、need 卡的规模条；未知 kind 的分支由判据文件覆盖（夹具保持六张已知 kind 的卡）。每一步截图存 `tmp/`，在完成记录里贴出。

场景运行器：`node scripts/ui-scenario.mjs e2e/scenarios/cockpit-cards-confirm.json`，贴出 JSON 报告与检查点截图，证明卡片视图既有交互未被本次渲染改动破坏。隔离实例用毕 `scripts/isolated-instance.sh stop`。

## Touches

- tasks/gap-ac425-card-viz-and-zone-coverage.md
- src/shared/types.ts
- server/shared/types.ts
- src/shared/tests/cockpitCardTypeSync.test.ts
- src/modules/cockpit/cockpitCardDescriptors.ts
- src/modules/cockpit/CockpitCard.tsx
- src/modules/cockpit/CockpitCardViz.tsx (new)
- src/modules/cockpit/index.ts
- src/modules/cockpit/tests/CockpitCard.test.tsx
- server/modules/cockpit/cockpit-fixture-card-provider.ts
- server/shared/tests/architecture-ratchet.baseline.json

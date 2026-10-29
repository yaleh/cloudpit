---
id: gap-cockpit-details-option-selection-and-own-reply
title: 详情里可选选项与写自己的回复：整行可点、悬停反馈、选中用高亮（边框为主、淡底辅助，不用 radio）
status: ready
labels:
  - gap
  - cockpit
parent: null
children: []
extra: {}
---
## Proposal

来源：2026-10-29 线上驾驶舱审查（MCP 浏览器，只读操作，截图 `tmp/cockpit-audit/02-details-need.png`、`03-details-ask-unconfirmed.png`、`07-column-details.png`）。

问题（用户报告并已复现）：打开卡片详情后，**不能选择建议，也不能输入自己的意见**。详情里查到的可交互元素只有 Close 与 Confirm 两个；选项是 `<li>`（`src/modules/cockpit/CockpitCardDetails.tsx:363-395`），没有点击、没有选中态；也没有「✎ 你自己的回复」行。列表的下拉里有「你自己的回复」（`cockpit-card-own-reply-item`），只有详情漏了。

设计文档要求（`docs/architecture/cockpit-attention/INTERACTION-PRINCIPLES.md`）：交互表 L2「详情里点选项」；规则 19「每个选项最后一项永远是『✎ 你自己的回复』」。

用户定下的表现（2026-10-29）：**不要 radio box / checkbox**，选中项**只用高亮**表示；**边框为主信号、淡底辅助**；选项行**整行可点**并有**悬停反馈**。按原型 `tmp/cockpit-audit/proto/p2-pc-details-selectable.png`、`p5-m-details-selectable.png`、`p8-pc-details-own-reply.png` 实现。

做什么：

1. 详情里的每个选项是一整行可点区域：`button` 元素（或 `li` 内的整行 button），`aria-pressed` 表达选中，悬停给 `hover:bg-accent/50`，键盘可达（Enter/Space）。
2. 选中态 = `border-primary` + `ring-1 ring-primary/40` 为**主信号**，`bg-primary/5` 只做辅助；未选中行保持普通 `border-border`。不出现任何 radio/checkbox 图形。
3. 最后一行固定是「✎ 你自己的回复」：虚线边框的行，点选后同样变成高亮态，行内展开多行输入框（复用列表已有的 `ownReplies` 状态与 `setOwnReply`，不新增第二份草稿）。
4. 详情里的选择与列表里的下拉**是同一份状态**：在详情里点选项等价于 `controller.showOption(cardId, optionId)`；选自己的回复等价于 `controller.showOwnReply(cardId)`。确认条的目标（`targets[cardId]`）随之更新，因此详情里的 Confirm 发的是刚选的那一项。
5. 详情里选中态显示的是「当前显示项」，与卡片的 `shown` 读数一致；卡片被重新读数（revision 变化）后按同一映射回落（选项不存在时回到默认建议）。

## AC

- [x] `npx vitest run src/modules/cockpit/tests/cockpitCardDetailsSelectable.test.tsx` 退出 0，用例覆盖：点击第 2 个选项行后 `controller.getSnapshot().shown[cardId] = { kind: 'option', optionId }`，且 `targets[cardId].optionId` 同步；选中行带 `border-primary` 与 `ring-1`、未选中行不带；点击「✎ 你自己的回复」后 `shown.kind === 'ownReply'` 且出现 textarea，输入后 `ownReplies[cardId]` 等于输入值；重新读数后选项消失时 `shown` 回落到默认建议项。
- [x] `npx vitest run src/modules/cockpit/tests/CockpitCard.test.tsx` 与 `npx vitest run src/modules/cockpit/tests/cockpitCardsMobileDetails.test.tsx` 退出 0（详情改动不改变列表行为）。
- [x] 假形态变红：把选项行的点击处理删掉 ⇒ 「点击第 2 个选项」用例红；把选中态的两个 class 删掉 ⇒ 「选中行样式」用例红；改完即还原。
- [x] `npx vitest run src/modules/cockpit/tests/i18nCockpitCompleteness.test.ts` 退出 0（新增文案进全部十个 locale）；`npm run typecheck`、`npm run lint` 退出 0（lint 仅既有 warning）。
- [x] `npx tsx --tsconfig server/tsconfig.json --test server/shared/tests/architecture-ratchet.test.ts` 退出 0；若 `src/modules/cockpit/cockpitCardController.ts`（基线 1329）增长，按 AC-394 的 RECORDED CHANGE 格式记录。

## DoD

真实页面（MCP 浏览器，只点夹具卡片或只做只读操作；不点线上卡的 Confirm）：

1. 打开一张有多个选项的卡片详情，点第二个选项：截图显示高亮移到第二行、第一行回到普通边框，且底部 Confirm 的目标随之变化（贴出 `targets[cardId].optionId` 读数）。
2. 点「✎ 你自己的回复」，输入一句话：截图显示该行高亮且展开输入框（贴出 `ownReplies[cardId]` 读数）。
3. 键盘：Tab 到选项行、Enter 选中；截图或读数证明焦点可见环仍在。
4. 手机宽（390）与 PC 宽（1600）各一组截图，存 `tmp/`；若存在可用场景，同时跑 `node scripts/ui-scenario.mjs <scenario.json>` 并贴出 JSON 报告。

### DoD 读数（真实页面，夹具卡 `fixture:ask`）

夹具卡选项 `delete`（suggested）、`keep`，带 `ownReply`。截图在 `tmp/cockpit-details-selectable/`：`pc-option-selected.png`、`pc-own-reply.png`、`pc-keyboard.png`、`phone-option-selected.png`、`phone-own-reply.png`。

- 1600×900 与 390×844 两组读数一致：
  - 初始 `shown[fixture:ask] = {kind:'option', optionId:'delete'}`（默认建议项）。
  - 点 `keep` 行后 `targets[fixture:ask].optionId=keep`，详情确认条 `"Confirm · Keep staging"`，卡片自身确认条同为 `"Confirm · Keep staging"`（同一份状态）；`keep` 行 `{selected:true, ariaPressed:"true", borderPrimary:true, ring:true, hover:true}`，`delete` 行 `{selected:false, borderPrimary:false, ring:false, hover:true}`。
  - 点「✎ 你自己的回复」后该行 `{selected:true, borderPrimary:true, ring:true, dashed:true}`，`shown` 不再指向任何 provider 选项；输入后 `ownReplies[fixture:ask]="Keep staging for one more day, then delete it."`，详情 textarea 与卡片 textarea 读数相同（一份草稿），详情确认条变为 `"Confirm · your reply"`。
  - 键盘：Tab 落在 `cockpit-card-details-option-delete`，焦点可见环 `boxShadow` 非 `none`；按 Enter 后 `shown[fixture:ask].optionId=delete`，焦点仍在该行。
- 未跑场景运行器：仓库内没有任何 `*.scenario.json` 场景文件（`find` 无结果），`scripts/ui-scenario.mjs` 必须显式给场景文件，因此本任务的 DoD 以 MCP 浏览器的真实页面读数与截图取证。

## 暗轴记录（ADR-007）

该轴仍暗,理由: 本次改动是详情抽屉的交互可达性（整行可点、选中高亮、键盘激活），其取证是真实页面 DOM 读数与截图，没有可数值化的 L_D/L_G 暗轴增益可测。

## Notes

**2026-10-29 — suite 红的真因与处置（宿主 /tmp 污染，不是本任务 delta）**

- 现象：fan-in 的 suite 红在 `server/modules/providers/tests/skills.test.ts`（`codex-root` 期望 `repo` 实得 `undefined`；opencode user skill 期望 `user` 实得 `project`），baseline A/B 判 `changed-assertion`。
- 真因：宿主的 `/tmp/.git`（0700，属主为另一个 uid，本会话无权删除）被 `findTopmostGitRoot`（`server/shared/utils.ts`）当成「最顶层仓库根」；于是 `fs.mkdtemp(os.tmpdir())` 造出的夹具仓库多出一个祖先 `.git`，两个 provider 的 repo/user scope 全部错位。证据：`TMPDIR=<干净目录> npx tsx --tsconfig server/tsconfig.json --test server/modules/providers/tests/skills.test.ts` → 6/6 绿；默认 TMPDIR 下 4/6。
- 处置：`scripts/test.sh` 的 host-env 隔离段（与既有的 live server env 隔离同一处、同一理由）新增 host temp-dir 隔离——在「自身祖先链上没有 `.git`」的可写基座上建立每次运行私有的 TMPDIR 并导出给所有子进程（node:test / vitest / playwright）；无合格基座时 fail-open 保持原行为。⛔ 不落进仓库内（`server/tsconfig` 会扫到仓库内 scratch）。`QUAY_SUITE_TMPDIR_BASE` 是测试接缝。
- 验证：`bash scripts/test.sh server/modules/providers/tests/skills.test.ts` → 1/1 绿（同一命令未隔离时红）；`bash scripts/test.sh server/shared/tests/quay-test-script.test.ts`（runner 自身契约）→ 1/1 绿；另跑 5 个使用 `mkdtemp(os.tmpdir())` 的 server 测试全绿；`--list-files` 早退路径与正常退出后均无残留临时目录。

## Touches

- tasks/gap-cockpit-details-option-selection-and-own-reply.md
- src/modules/cockpit/CockpitCardDetails.tsx
- src/modules/cockpit/CockpitCard.tsx
- src/modules/cockpit/CockpitCardList.tsx
- src/modules/cockpit/cockpitCardController.ts
- src/modules/cockpit/tests/cockpitCardDetailsSelectable.test.tsx (new)
- src/modules/cockpit/tests/CockpitCard.test.tsx
- src/modules/cockpit/tests/cockpitCardsMobileDetails.test.tsx
- src/modules/i18n/locales/en/common.json
- src/modules/i18n/locales/zh-CN/common.json
- src/modules/i18n/locales/de/common.json
- src/modules/i18n/locales/es/common.json
- src/modules/i18n/locales/fr/common.json
- src/modules/i18n/locales/id/common.json
- src/modules/i18n/locales/it/common.json
- src/modules/i18n/locales/ja/common.json
- src/modules/i18n/locales/ko/common.json
- src/modules/i18n/locales/ru/common.json
- server/shared/tests/architecture-ratchet.baseline.json
- scripts/test.sh

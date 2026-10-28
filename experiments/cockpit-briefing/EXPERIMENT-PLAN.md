# E2 — 简报（briefing）可行性：格式、工具、机械检查、延迟、成本

> 状态：**工具与示例简报已就绪（17 个检查器测试通过），LLM 臂未跑**。预算：≤ 2M token。
> 归属：驾驶舱「统一指挥面」子目标；与 `experiments/cockpit-decision-judge/`（E1）并列。

## 1. 要回答的问题

1. 一个**短的、只读的 Claude Code 会话**，能否在 **2 分钟内**（事项出现 → 简报可见）产出**通过机械检查**的简报？
2. 会话只写**语义**（轴、分数、理由、证据），表现形式由工具负责，这个分工在实践中站得住吗？
3. 会话自己设计的**临时展现形式**（`canvas`）有多常用、质量如何？它是不是预置形式的候选来源？
4. 简报给出的证据，**机械可核的占多少**？雷达图的轴你觉得有用吗？
5. 成本：每个事项多少 token / 多少钱？每日上限怎么设？

## 2. 简报格式 BriefSpec v0（机器可校验，前端统一渲染）

实现：`brief-check.mjs`（纯 ESM、无依赖，之后可原样提升为 `server/modules/` 里的共享模块；16 个测试，`node --test brief-check.test.mjs`）。

```
{ v:0, itemRef, headline(≤80),
  recommendation:{ optionId, why:[≤3 条, 各≤140] },
  options:[{ id, label, does, consequence:[{kind: reversible|irreversible|costs|blocks|no-effect, text}], evidenceRefs? }]  // 2–5 个
  evidence:[{ id, kind, label, ref?, observedAt?, mechanical:boolean }],   // mechanical:true ⇒ 必须带 ref(命令/文件:行/sha) 与 observedAt
  blocks:[ ≤6 个，类型见下 ] }
```

**预置展现形式**（会话只给语义，构建器负责结构）：`radar` · `compare-table` · `diffstat` · `checklist` · `timeline` · `graph` · `callout`。
- `radar`：轴由会话**按事项自定**（3–8 条，每条带定义和依据 mechanical|llm）；`rev`（可逆）与 `evid`（证据）为**必带通用轴**，保证不同事项之间可比；`mechanical` 轴必须引用 mechanical 证据；每个选项在每条轴上都要有 0–100 的整数分。
- **新增一种预置形式** = 一个 preset 条目（describe / example / build / check）+ 渲染器 + 一条测试；注册表是叶子模块。

**临时展现形式**：`canvas` = 受限 SVG（元素白名单；禁止 script、事件属性、href/xlink、`<image>`、`<use>`、`foreignObject`、外部 `url()`；≤6000 字符），必须带 `alt`（文本替代，渲染失败时就显示它）和 `rationale`（为什么没有预置形式可用）。`rationale` 被记录，**同类理由反复出现 = 该升格为预置形式**。

## 3. 会话内外的工具支撑

会话通过 Bash 调用 `brief-cli.mjs`（不用 MCP：MCP 工具在 spawn 失败时整组消失，CLI 更稳）：

| 命令 | 作用 |
|---|---|
| `schema [type]` | 列出预置形式与限额；打印某一形式的语义输入示例 |
| `skeleton` | 打印待填的空简报 |
| `build <type> --doc f` | **语义进、结构出**：读 stdin 的语义 JSON，产出已校验结构的 block（雷达自动补齐每个选项的 series） |
| `check <file｜->` | **机械格式检查**：返回 `{ok, errors:[{path, rule, message, fix}]}`；失败 exit 2 |
| `submit <file> --out dir` | 检查通过才落盘；失败达 `MAX_ITERATIONS`(3) 后提示放弃 |

**会话外（宿主）**：宿主**重新跑一遍同一个 checker**，不信任会话自称的通过；3 轮仍不通过 → 用确定性的**默认卡**（`defaultBrief`）顶上，并记录失败规则，作为改进提示词与工具的数据。**默认卡永远先显示，简报通过后原位升级**，不挪动焦点。

## 4. 延迟预算（你给的上限：事件 → 简报可见 < 2 分钟）

| 段 | 预算 |
|---|---|
| 观察层发现提问并入队 | ≤ 10 s |
| 会话取证 + 写简报 | ≤ 75 s（工具白名单只读、`--max-turns` 封顶） |
| 机械检查与迭代（≤3 轮） | ≤ 25 s |
| 发布观察修订并经 hub 推送 | ≤ 10 s |

重事项到达即预生成；中等事项选中后防抖再生成；轻事项只用确定性模板，不跑模型。

## 5. 实验设计

- **输入**：当前观察墙上的 **12 条真实提问**（`tmp/cockpit-briefing/items.json`，已备好）。
- **臂**
  - B0：默认卡（无 LLM），作对照；
  - B1：网关直连单次生成（提示词里带 schema 与示例，宿主检查 + 最多 3 轮修复）；
  - B2：`claude-fjdac -p` 短会话（只读工具 + `brief-cli`），cwd 为该项目主检出，模型 v4.1flash，`--max-turns` 封顶。
- **度量**：通过率与迭代轮数；事件→可见延迟 p50/p90 对 120 s；token 与花费；mechanical 证据占比；`canvas` 使用率与 `rationale`；**你对 6 条的盲评**（B1 vs B2，1–5 分，以及「会不会直接点建议」）。
- **已知事实**：一次最小的 `claude-fjdac -p` 调用输入 token 约 **1.3 万**（系统提示加工具定义），且无缓存读取；多轮会话的 token 近似线性放大。成本主要由「固定前缀 × 轮数」决定，所以 `--max-turns` 是主要的成本旋钮。

## 6. 过关线（进入产品化的条件）

- B2 在 12 条里 ≥ 10 条于 3 轮内通过检查；
- 事件→可见 p90 < 120 s；
- 单条成本在预算折算内；
- 你的盲评里 B2 对 B0 有明显优势（至少 4/6 条「会点建议」）。

## 7. 预算口径（已定）

按 **token 上限**执行：**E2 ≤ 2M token（目标 1–2M，含每个会话约 1.3 万的固定前缀）**。日志实时累计，到 90% 自动停；先用 1 个事项测出单条 token 再决定样本数。

## 8. 复现

```
cd experiments/cockpit-briefing && node --test brief-check.test.mjs
node brief-cli.mjs schema            # 会话看到的第一屏
node brief-cli.mjs skeleton | node brief-cli.mjs check -
```

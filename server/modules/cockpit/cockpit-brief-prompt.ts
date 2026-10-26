/**
 * The briefing prompt: one system message carrying the BriefSpec v0 schema, skeleton and a full
 * example, plus the per-card user message and the repair turns.
 *
 * WHY THE QUESTION IS SEPARATED. The experiment measured the failure this prompt exists to
 * prevent: the observation layer's `askingYou` excerpt lagged the turn in 2 of 8 sampled
 * sessions, so a model that lifted its question from the digest asked about the previous turn.
 * The user message therefore names the LAST assistant message as the only authoritative source
 * and marks the surrounding transcript as background that must not supply another question.
 *
 * WHY THE SCHEMA IS SPELLED OUT. The host checker (`cockpit-brief-spec.ts`) is mechanical: a
 * model that has to infer the shape fails on field names, not on judgement. The prompt pays the
 * tokens for the full shape and one complete example; the same schema text is what E2's winning
 * arm used (8/8 inside three rounds).
 *
 * Consumers: `cockpit-brief.service.ts` (every round and every repair turn) and
 * `tests/cockpit-brief.test.ts` (the "question comes from the last assistant message" case reads
 * the user prompt the stub receives).
 */

/** The BriefSpec v0 skeleton shown to the model, before any content. */
const SKELETON = `{
  "v": 0,
  "itemRef": "<从输入原样复制>",
  "headline": "<一句话说清在问什么，<=80 字符>",
  "options": [
    {
      "id": "a",
      "label": "<短名，<=60>",
      "does": "<选它会做什么，<=200>",
      "consequence": [{ "kind": "reversible|irreversible|costs|blocks|no-effect", "text": "<<=80>" }],
      "evidenceRefs": ["e1"]
    }
  ],
  "recommendation": { "optionId": "a", "why": ["<=140 字符的理由"] },
  "evidence": [
    { "id": "e1", "label": "<这条证据是什么>", "mechanical": true, "ref": "<命令、file:line 或 sha>", "observedAt": "<ISO 日期>" }
  ],
  "blocks": [
    // 可选，0–6 个；每个预置形式见下
  ],
  "radarSemantic": {
    // 可选简写：宿主会用它构建一个 radar block，无需自己写 blocks
    "title": "后果对比",
    "axes": [
      { "id": "rev", "label": "可逆性", "definition": "<高与低各意味着什么，12–160 字符>", "basis": "mechanical", "evidenceRefs": ["e1"] },
      { "id": "evid", "label": "证据强度", "definition": "<高与低各意味着什么，12–160 字符>", "basis": "mechanical", "evidenceRefs": ["e1"] },
      { "id": "scope", "label": "覆盖范围", "definition": "<高与低各意味着什么，12–160 字符>", "basis": "llm" }
    ],
    "scores": { "a": { "rev": 95, "evid": 60, "scope": 90 }, "b": { "rev": 95, "evid": 60, "scope": 40 } }
  }
}`;

/** A complete, checker-passing example. E2 showed one full example is worth more than rules. */
const EXAMPLE = `{
  "v": 0,
  "itemRef": "cloudcli://session/sess-1#msg-9",
  "headline": "清理是否直接删除暂存目录？",
  "options": [
    {
      "id": "delete",
      "label": "直接删除",
      "does": "删除 staging 目录及其中的草稿文件，释放空间但不可恢复",
      "consequence": [
        { "kind": "irreversible", "text": "删除后无法从本机恢复" },
        { "kind": "costs", "text": "约 2 分钟" }
      ],
      "evidenceRefs": ["e1"]
    },
    {
      "id": "keep",
      "label": "先移到备份区",
      "does": "把 staging 移入 .trash 保留 7 天，再决定是否删除",
      "consequence": [{ "kind": "reversible", "text": "7 天内可以原样移回" }],
      "evidenceRefs": ["e2"]
    }
  ],
  "recommendation": { "optionId": "keep", "why": ["目录里还有未提交的草稿，删除不可逆", "移动成本很低"] },
  "evidence": [
    { "id": "e1", "label": "staging 内文件清单", "mechanical": true, "ref": "ls -la /tmp/staging", "observedAt": "2026-10-27T02:10:00Z" },
    { "id": "e2", "label": "git status 显示未跟踪草稿", "mechanical": true, "ref": "git status --short", "observedAt": "2026-10-27T02:10:00Z" }
  ],
  "blocks": [
    {
      "id": "cleanup-checklist",
      "type": "checklist",
      "title": "删除前确认",
      "items": [{ "text": "确认草稿已另有备份" }, { "text": "确认目录不属于运行中的任务" }]
    }
  ],
  "radarSemantic": {
    "title": "后果对比",
    "axes": [
      { "id": "rev", "label": "可逆性", "definition": "撤销这次操作的代价，越高越容易恢复", "basis": "mechanical", "evidenceRefs": ["e1"] },
      { "id": "evid", "label": "证据强度", "definition": "结论被实测或文件清单支持的程度，越高越可信", "basis": "mechanical", "evidenceRefs": ["e2"] },
      { "id": "space", "label": "释放空间", "definition": "操作完成后能腾出的磁盘空间，越高越多", "basis": "llm" }
    ],
    "scores": {
      "delete": { "rev": 10, "evid": 70, "space": 90 },
      "keep": { "rev": 95, "evid": 70, "space": 0 }
    }
  }
}`;

/** The fixed instructions; the same text is sent every round. */
export const BRIEF_SYSTEM_PROMPT = [
  '你是 CloudCLI 驾驶舱的简报生成器。为一张等待用户决定的卡片写一份 BriefSpec v0 JSON。',
  '',
  '只输出 JSON 对象本身：不要代码围栏，不要解释，不要前后缀文字。',
  '',
  '## 必须遵守',
  '',
  '- 决策问题只能来自「最后一条助手消息」；近期对话只是背景，绝不能从背景里另选一个问题。',
  '- `itemRef` 从输入原样复制。',
  '- 2–5 个真实备选；`recommendation.optionId` 必须指向其中一个，`why` 给 1–3 条理由。',
  '- 每个 option 至少一条 consequence，`kind` 只能取 reversible / irreversible / costs / blocks / no-effect。',
  '- `mechanical: true` 的证据必须带 `ref`（命令、file:line 或 sha）与 `observedAt`（ISO 日期）；没有实测依据就用模型判断，不要伪造机械证据。',
  '- radar 的轴 3–8 条，必须含 `rev`（可逆性）与 `evid`（证据强度）；每条轴都要有 12–160 字符的 definition，说明高与低各意味着什么；分数是 0–100 的整数。',
  '- `basis: "mechanical"` 的轴必须引用 `mechanical: true` 的证据。',
  '- 可用预置：radar（用 `radarSemantic` 简写）、compare-table、diffstat、checklist、timeline、graph、callout。最多 6 个 blocks。',
  '- checklist 的 `done` 可省略（默认 false）。',
  '- v0 不支持 canvas，不要输出 canvas。',
  '- 会话是中文时，简报文字用中文；不要把实验数据或臆造的事实写成证据。',
  '',
  '## 骨架',
  '',
  SKELETON,
  '',
  '## 完整示例',
  '',
  EXAMPLE,
  '',
  '再次强调：只输出 JSON 对象本身。',
].join('\n');

/** One card's authoritative question plus the transcript tail that gives it context. */
export type BriefPromptInput = {
  itemRef: string;
  /** The LAST assistant message's text — the only source for the question. */
  question: string;
  /** The bounded recent-turn rendering from the observation reading; background only. */
  context: string;
};

/**
 * The first-round user message.
 *
 * The question and the background are separate fenced blocks on purpose: the ordering and the
 * labels are what let a model (and the criterion) tell which one is authoritative.
 */
export function buildBriefUserPrompt(input: BriefPromptInput): string {
  return [
    `条目：${input.itemRef}`,
    '',
    '决策问题（唯一权威：最后一条助手消息的原文）：',
    '"""',
    input.question,
    '"""',
    '',
    '近期对话（仅作背景；不得从中另选问题）：',
    '"""',
    input.context,
    '"""',
    '',
    '现在输出 BriefSpec v0 JSON。',
  ].join('\n');
}

/**
 * A repair turn for rounds 2 and 3.
 *
 * The gateway client has ONE user turn, so the previous answer and the checker's errors are
 * flattened into the same message instead of adding a fake assistant turn. The previous raw text
 * is kept verbatim: E2 could not analyse its two `unparseable-json` failures precisely because
 * the raw answer was not retained.
 */
export function buildBriefRepairPrompt(previous: string, errors: unknown): string {
  return [
    '你上一次输出：',
    '"""',
    previous,
    '"""',
    '',
    '宿主检查未通过，错误如下（JSON）：',
    JSON.stringify(errors, null, 2),
    '',
    '修正列出的每一处问题，输出完整的 JSON 对象。只输出 JSON 对象本身。',
  ].join('\n');
}

/**
 * Pull a JSON object out of a model answer: strip a code fence if present, then take the first
 * `{` through the last `}`. Returns null when no object parses — the caller records the raw text.
 */
export function parseBriefAnswer(text: string): Record<string, unknown> | null {
  const unfenced = text
    .trim()
    .replace(/^```(?:json)?\s*/i, '')
    .replace(/```\s*$/, '');
  const start = unfenced.indexOf('{');
  const end = unfenced.lastIndexOf('}');
  if (start < 0 || end <= start) return null;
  try {
    const parsed: unknown = JSON.parse(unfenced.slice(start, end + 1));
    return parsed !== null && typeof parsed === 'object' && !Array.isArray(parsed)
      ? (parsed as Record<string, unknown>)
      : null;
  } catch {
    return null;
  }
}

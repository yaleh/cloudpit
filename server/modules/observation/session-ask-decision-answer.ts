/**
 * The model-answer half of the T1 decision digest: the prompt, the shape parser, and the
 * normalisation rules that keep a suggestion honest.
 *
 * Split from `session-ask-decision-digest.ts` by concern: that file reads the transcript and owns
 * the call, this one owns what an acceptable answer IS. Everything here is pure — no client, no
 * clock, no filesystem — so the criteria can drive each rule without a model.
 *
 * THE SUGGESTION HAS TWO SOURCES, IN PRIORITY ORDER. The assistant's own recommendation wins when
 * its text carries a cue AND the model named that option (`source: 'assistant'`). When it does
 * not, the judge — the same call, a second field pair in the same JSON answer — picks the most
 * likely option and states one line of why (`source: 'judge'`). The judge never overrides the
 * assistant and never labels its own pick as the assistant's.
 *
 * Consumers: `session-ask-decision-digest.ts` (the summariser's one call) and
 * `tests/session-ask-decision-digest.test.ts`, `tests/session-ask-judge-default.test.ts`.
 */
import type { SessionAskDecisionOption, SessionAskDecisionReading } from '@/shared/types.js';

/**
 * The model's answer before the normalisation rules are applied.
 *
 * `isAsking` is the semantic verdict this call exists to produce. A `false` answer is complete on
 * its own — the model was told not to invent an `ask`/`situation`/`options` for a message that is
 * not a question — so the discriminator lets the parser demand the full decision shape only when
 * the verdict is `true`.
 */
export type ParsedAskAnswer =
  | { isAsking: false }
  | {
      isAsking: true;
      ask: string;
      situation: string;
      incomplete: boolean;
      recommendedOptionId: string | null;
      /** The judge's pick from the SAME answer; null when the model omitted it or it named nothing. */
      judgeOptionId: string | null;
      /** The judge's one-line reason; null when absent. A pick without a reason is not a judge. */
      judgeReason: string | null;
      options: Array<{
        id: string;
        label: string;
        does: string;
        tags: Array<{ kind: string; text: string }>;
        source: SessionAskDecisionOption['source'];
      }>;
    };

/** The positive arm of {@link ParsedAskAnswer}: the fields a real question's answer carries. */
export type ParsedAskingAnswer = Extract<ParsedAskAnswer, { isAsking: true }>;

/** Immutable config, not caches: a frozen array avoids the module-level mutable-state ratchet. */
const OPTION_SOURCES: readonly SessionAskDecisionOption['source'][] = ['assistant', 'judge', 'provider'];

/** A non-empty trimmed string, or null. */
function nonEmpty(value: unknown): string | null {
  return typeof value === 'string' && value.trim() !== '' ? value.trim() : null;
}

/**
 * Rejects anything that is not the declared shape; the caller turns the throw into `unevaluated`.
 *
 * Fields that decide meaning (ask, situation, incomplete, option id/label/does) are required.
 * Decoration the model may legitimately omit (`tags`, `source`) defaults rather than failing,
 * because a missing consequence label must not cost the whole digest.
 */
export function parseAskDecisionAnswer(text: string): ParsedAskAnswer {
  const withoutFence = text.replace(/^\s*```(?:json)?\s*/i, '').replace(/\s*```\s*$/, '');
  const start = withoutFence.indexOf('{');
  const end = withoutFence.lastIndexOf('}');
  if (start < 0 || end <= start) throw new Error('模型输出中没有 JSON 对象');
  let parsed: unknown;
  try {
    parsed = JSON.parse(withoutFence.slice(start, end + 1));
  } catch (failure) {
    throw new Error(`模型输出不是合法 JSON: ${failure instanceof Error ? failure.message : String(failure)}`);
  }
  if (parsed === null || typeof parsed !== 'object' || Array.isArray(parsed)) throw new Error('模型输出的 JSON 不是对象');
  const record = parsed as Record<string, unknown>;

  // THE VERDICT COMES FIRST. A `false` answer needs no ask/situation/options — demanding them
  // would make the model invent a question in order to say there is none, which is exactly the
  // false-card defect this gate removes. An ABSENT field is the pre-gate answer shape: those
  // answers were only ever produced for messages already read as candidates, so they mean `true`.
  const rawIsAsking = record.isAsking;
  if (rawIsAsking !== undefined && typeof rawIsAsking !== 'boolean') {
    throw new Error('模型输出的 isAsking 不是布尔值');
  }
  if (rawIsAsking === false) return { isAsking: false };

  const ask = nonEmpty(record.ask);
  if (ask === null) throw new Error('模型输出缺少非空的 ask');
  const situation = nonEmpty(record.situation);
  if (situation === null) throw new Error('模型输出缺少非空的 situation');
  if (typeof record.incomplete !== 'boolean') throw new Error('模型输出缺少布尔 incomplete');
  if (!Array.isArray(record.options)) throw new Error('模型输出缺少 options 数组');

  const seenIds = new Set<string>();
  const options = record.options.map((raw, index): ParsedAskingAnswer['options'][number] => {
    if (raw === null || typeof raw !== 'object' || Array.isArray(raw)) throw new Error(`options[${index}] 不是对象`);
    const option = raw as Record<string, unknown>;
    const id = nonEmpty(option.id);
    if (id === null) throw new Error(`options[${index}] 缺少非空 id`);
    if (seenIds.has(id)) throw new Error(`options 出现重复 id: ${id}`);
    seenIds.add(id);
    const label = nonEmpty(option.label);
    if (label === null) throw new Error(`options[${index}] 缺少非空 label`);
    const does = nonEmpty(option.does);
    if (does === null) throw new Error(`options[${index}] 缺少非空 does`);
    const source = option.source === undefined ? 'assistant' : option.source;
    if (typeof source !== 'string' || !OPTION_SOURCES.includes(source as SessionAskDecisionOption['source'])) {
      throw new Error(`options[${index}] 的 source 不在 assistant/judge/provider 之内`);
    }
    const rawTags = option.tags === undefined ? [] : option.tags;
    if (!Array.isArray(rawTags)) throw new Error(`options[${index}] 的 tags 不是数组`);
    const tags = rawTags.map((tag, tagIndex) => {
      if (tag === null || typeof tag !== 'object' || Array.isArray(tag)) throw new Error(`options[${index}].tags[${tagIndex}] 不是对象`);
      const kind = nonEmpty((tag as Record<string, unknown>).kind);
      const tagText = nonEmpty((tag as Record<string, unknown>).text);
      if (kind === null || tagText === null) throw new Error(`options[${index}].tags[${tagIndex}] 需要非空 kind 与 text`);
      return { kind, text: tagText };
    });
    return { id, label, does, tags, source: source as SessionAskDecisionOption['source'] };
  });

  const rawRecommended = record.recommendedOptionId;
  let recommendedOptionId: string | null = null;
  if (rawRecommended !== undefined && rawRecommended !== null) {
    if (typeof rawRecommended !== 'string' || !seenIds.has(rawRecommended)) {
      throw new Error(`模型给出的 recommendedOptionId 不是任何选项的 id: ${String(rawRecommended)}`);
    }
    recommendedOptionId = rawRecommended;
  }

  // THE JUDGE IS OPTIONAL AND TOLERANT. An older model (or one that skipped the field) leaves both
  // values null, and the digest then simply has no judge suggestion. A pick that names no listed
  // option — including the yes/no ids the caller synthesises AFTER parsing — is ignored here and
  // resolved against the final option list in `buildAskDecision`; a pick without a reason is not
  // a judge at all, because the reason is what the card shows.
  const judgeOptionId = nonEmpty(record.judgeOptionId);
  const judgeReason = nonEmpty(record.judgeReason);

  return {
    isAsking: true,
    ask,
    situation,
    incomplete: record.incomplete,
    recommendedOptionId,
    judgeOptionId,
    judgeReason,
    options,
  };
}

/**
 * A recommendation cue in the assistant's own words. Deliberately conservative: it lets a real
 * recommendation through and refuses to invent one, so the worst case is a missed suggestion,
 * never a fabricated one. 「不建议」 is excluded by the preceding-character class.
 */
const RECOMMENDATION_CUE =
  /(?:^|[^不])(?:建议|推荐|倾向(?:于)?|我会选|我选|不妨)|I (?:recommend|suggest)|I'd (?:pick|choose|go with)/i;

/**
 * A yes/no question in the assistant's own words.
 *
 * Deliberately narrow: only the shapes this repo's sessions actually ask in — 「是否要…」,
 * 「要不要…」, 「要我…吗」, 「Should I…?」 — trigger the two-option synthesis. A multi-choice
 * question (「先补测试还是先改实现？」) matches nothing here and is therefore never rewritten.
 */
const YES_NO_QUESTION =
  /(?:是否|要不要|需不需要|用不用|能不能|可不可以|该不该|会不会|有没有|是不是)|(?:吗|么)\s*[?？]?\s*$|\b(?:should|shall|can|could|may|would|will|do|does|is|are|did)\b[^?？]*[?？]/i;

/** The two options a yes/no question gets when the assistant listed none of its own. */
const YES_NO_OPTIONS: ParsedAskingAnswer['options'] = [
  {
    id: 'yes',
    label: '是',
    does: '确认按助手的提议执行。',
    tags: [{ kind: 'consequence', text: '继续推进' }],
    source: 'assistant',
  },
  {
    id: 'no',
    label: '否',
    does: '不按助手的提议执行，保持现状。',
    tags: [{ kind: 'consequence', text: '保持现状' }],
    source: 'assistant',
  },
];

/**
 * Adds the two yes/no options when the question is yes/no-shaped AND the assistant listed none.
 *
 * The generated options carry no suggestion of their own: the suggestion is applied afterwards,
 * either from the assistant's cue + the model's `recommendedOptionId`, or from the judge's
 * `judgeOptionId` (which may name `yes`/`no`). The worst case is a missed suggestion, never a
 * fabricated one.
 */
function withYesNoOptions(parsed: ParsedAskingAnswer, assistantText: string): ParsedAskingAnswer['options'] {
  if (parsed.options.length > 0) return parsed.options;
  return YES_NO_QUESTION.test(assistantText.trim()) ? YES_NO_OPTIONS : parsed.options;
}

/**
 * Applies the suggestion rules to one parsed answer and returns the reading the digest carries.
 *
 * PRIORITY. The assistant's own recommendation is accepted only when BOTH signals agree: the
 * assistant's text carries a cue AND the model named an existing option. When that does not hold
 * (no cue, or the cue named nothing), the judge's pick becomes the suggestion — but only when it
 * names one of the final options and carries a reason, and only when the digest is complete. The
 * judge therefore never overrides the assistant, and its option is sourced `judge` rather than
 * `assistant`.
 *
 * `incomplete` clears every suggestion either way, which is the "we do not know enough to advise"
 * reading rather than a guessed one.
 */
export function buildAskDecision(
  parsed: ParsedAskingAnswer,
  identity: { askId: string; revision: number },
  assistantText: string,
  usage: { inputTokens: number | null; outputTokens: number | null },
): SessionAskDecisionReading {
  const options = withYesNoOptions(parsed, assistantText);
  const assistantRecommendedId =
    parsed.incomplete || !RECOMMENDATION_CUE.test(assistantText) ? null : parsed.recommendedOptionId;
  const assistantSuggestion =
    assistantRecommendedId !== null && options.some((option) => option.id === assistantRecommendedId)
      ? assistantRecommendedId
      : null;
  const judgeSuggestion =
    assistantSuggestion === null && !parsed.incomplete && parsed.judgeReason !== null
      ? (options.find((option) => option.id === parsed.judgeOptionId)?.id ?? null)
      : null;
  const suggestedId = assistantSuggestion ?? judgeSuggestion;
  const suggestedSource: SessionAskDecisionOption['source'] =
    assistantSuggestion === null ? 'judge' : 'assistant';
  const judgeWhy = assistantSuggestion === null && judgeSuggestion !== null ? parsed.judgeReason : null;

  const readingOptions: SessionAskDecisionOption[] = options.map((option) => {
    const suggested = option.id === suggestedId;
    return {
      id: option.id,
      label: option.label,
      does: option.does,
      tags: option.tags,
      suggested,
      source: suggested ? suggestedSource : option.source,
      ...(suggested && judgeWhy !== null ? { why: judgeWhy } : {}),
    };
  });
  return {
    state: 'evaluated',
    isAsking: true,
    ...identity,
    ask: parsed.ask,
    situation: parsed.situation,
    options: readingOptions,
    incomplete: parsed.incomplete,
    ...usage,
  };
}

/** The system instruction: decide first, then JSON only, restate rather than copy, never invent. */
export const SYSTEM_PROMPT = [
  '你在为驾驶舱判定「助手最后一条消息是否在向用户提问」，并在是提问时生成结构化决策摘要。只依据给出的对话原文；原文没有的不要补。',
  '判定是语义判断，不看位置：决策点可能在中段，最后一段可能只是附注/免责声明。判断标准是「助手是否把某个决定交给用户、等用户回答后才能继续」。',
  '只输出 JSON。不是提问时输出 {"isAsking":false}，不要写 ask/situation/options，绝不编造问题或选项。',
  '是提问时输出：{"isAsking":true,"ask":"…","situation":"…","incomplete":false,"recommendedOptionId":null,"judgeOptionId":null,"judgeReason":null,"options":[{"id":"…","label":"…","does":"…","tags":[{"kind":"consequence","text":"…"}],"source":"assistant"}]}',
  '- ask：把助手消息里真正的待决问题重述成一个问句，保留原文的限定条件；不要整段照抄。问题可能来自中段的「值得优先/下一步/是否…」清单，最后一段只是附注时也要从前面取出它。',
  '- situation：回答这个问题需要知道的情境（在做什么、卡在哪、已试过什么），只写原文有的事实。',
  '- options：助手原文用编号或项目符号列出若干选择时，必须为每一项给出一条 option（label 用原文的选项名）；原文没有列出选择才用空数组 []。does 是选它会发生什么，tags 是后果标签（kind 用 consequence / risk / cost / benefit）。',
  '- 是/否提问：当助手消息是「是否要…」「要不要…」「要我…吗」「Should I…?」这类只能答是或否的问题、且原文没有列出选项时，给出两个 option：id 分别为 "yes"（label 「是」）和 "no"（label 「否」），各写一句 does 与一个 consequence 标签。',
  '- recommendedOptionId：仅当助手原文明确推荐了某个选项时填它的 id；原文没有推荐就填 null。',
  '- judgeOptionId：当原文没有明确推荐时，从 options 里挑出最可能被选的一项填它的 id（是/否题填 "yes" 或 "no"）；原文已有明确推荐时必须填 null，不得覆盖助手的推荐。',
  '- judgeReason：judgeOptionId 非 null 时，用一句话说明为什么选它（依据原文的事实）；judgeOptionId 为 null 时也填 null。',
  '- incomplete：仅当这个问题依赖更早的上下文，而那些内容不在给出的对话里时填 true。',
].join('\n');

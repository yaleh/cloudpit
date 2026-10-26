/**
 * The model-answer half of the T1 decision digest: the prompt, the shape parser, and the three
 * normalisation rules that keep a suggestion honest.
 *
 * Split from `session-ask-decision-digest.ts` by concern: that file reads the transcript and owns
 * the call, this one owns what an acceptable answer IS. Everything here is pure — no client, no
 * clock, no filesystem — so the criteria can drive each rule without a model.
 *
 * Consumers: `session-ask-decision-digest.ts` (the summariser's one call) and
 * `tests/session-ask-decision-digest.test.ts`.
 */
import type { SessionAskDecisionOption, SessionAskDecisionReading } from '@/shared/types.js';

/** The model's answer before the three rules are applied. */
export type ParsedAskAnswer = {
  ask: string;
  situation: string;
  incomplete: boolean;
  recommendedOptionId: string | null;
  options: Array<{
    id: string;
    label: string;
    does: string;
    tags: Array<{ kind: string; text: string }>;
    source: SessionAskDecisionOption['source'];
  }>;
};

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

  const ask = nonEmpty(record.ask);
  if (ask === null) throw new Error('模型输出缺少非空的 ask');
  const situation = nonEmpty(record.situation);
  if (situation === null) throw new Error('模型输出缺少非空的 situation');
  if (typeof record.incomplete !== 'boolean') throw new Error('模型输出缺少布尔 incomplete');
  if (!Array.isArray(record.options)) throw new Error('模型输出缺少 options 数组');

  const seenIds = new Set<string>();
  const options = record.options.map((raw, index): ParsedAskAnswer['options'][number] => {
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

  return { ask, situation, incomplete: record.incomplete, recommendedOptionId, options };
}

/**
 * A recommendation cue in the assistant's own words. Deliberately conservative: it lets a real
 * recommendation through and refuses to invent one, so the worst case is a missed suggestion,
 * never a fabricated one. 「不建议」 is excluded by the preceding-character class.
 */
const RECOMMENDATION_CUE =
  /(?:^|[^不])(?:建议|推荐|倾向(?:于)?|我会选|我选|不妨)|I (?:recommend|suggest)|I'd (?:pick|choose|go with)/i;

/**
 * Applies the three rules to one parsed answer and returns the reading the digest carries.
 *
 * The recommendation is accepted only when BOTH signals agree: the assistant's own text carries
 * a cue AND the model named an existing option. `incomplete` clears every suggestion either way,
 * which is the "we do not know enough to advise" reading rather than a guessed one.
 */
export function buildAskDecision(
  parsed: ParsedAskAnswer,
  identity: { askId: string; revision: number },
  assistantText: string,
  usage: { inputTokens: number | null; outputTokens: number | null },
): SessionAskDecisionReading {
  const recommendedId =
    parsed.incomplete || !RECOMMENDATION_CUE.test(assistantText) ? null : parsed.recommendedOptionId;
  const options: SessionAskDecisionOption[] = parsed.options.map((option) => {
    const suggested = option.id === recommendedId;
    return {
      id: option.id,
      label: option.label,
      does: option.does,
      tags: option.tags,
      suggested,
      source: suggested ? 'assistant' : option.source,
    };
  });
  return {
    state: 'evaluated',
    ...identity,
    ask: parsed.ask,
    situation: parsed.situation,
    options,
    incomplete: parsed.incomplete,
    ...usage,
  };
}

/** The system instruction: JSON only, restate rather than copy, never invent. */
export const SYSTEM_PROMPT = [
  '你在为驾驶舱生成「会话提问」的结构化决策摘要。只依据给出的对话原文；原文没有的不要补。',
  '只输出 JSON：{"ask":"…","situation":"…","incomplete":false,"recommendedOptionId":null,"options":[{"id":"…","label":"…","does":"…","tags":[{"kind":"consequence","text":"…"}],"source":"assistant"}]}',
  '- ask：把助手最后一条消息里的提问重述成一个问句，保留原文的限定条件；不要整段照抄。',
  '- situation：回答这个问题需要知道的情境（在做什么、卡在哪、已试过什么），只写原文有的事实。',
  '- options：助手原文用编号或项目符号列出若干选择时，必须为每一项给出一条 option（label 用原文的选项名）；原文没有列出选择才用空数组 []。does 是选它会发生什么，tags 是后果标签（kind 用 consequence / risk / cost / benefit）。',
  '- recommendedOptionId：仅当原文明确推荐了某个选项时填它的 id；原文没有推荐就填 null。',
  '- incomplete：仅当这个问题依赖更早的上下文，而那些内容不在给出的对话里时填 true。',
].join('\n');

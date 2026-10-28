/**
 * Turn extraction shared by the retrieval probes.
 *
 * One "turn" is a human message paired with the message window before it. The
 * probes rebuild the DRAFT by removing the verbatim passage the person quoted,
 * so the remainder is what they actually typed around it.
 *
 * All of this is heuristic and the report says so: paragraphs are split on
 * blank lines, fences and headings; a "quote" is a ≥20-character normalised run.
 */

import { normalizeReferenceTarget } from '@/modules/chat/utils/transcript/referenceTargets';

export const MIN_RUN = 20;
export const MAX_MESSAGE_CHARS = 5_000;
export const MAX_USER_CHARS = 2_000;
export const MIN_DRAFT_CHARS = 5;

export type Passage = {
  id: string;
  text: string;
  normalized: string;
  /** Character offset of the passage inside its message, for prompt sizing. */
  chars: number;
};

export type WindowMessage = {
  role: 'user' | 'assistant';
  text: string;
  normalized: string;
  index: number;
  passages: Passage[];
};

const SKIP_USER = /(task-notification|cross-session|Caveat:|^\[|^\/|tool_use|Request interrupted|^<)/;
// Worker/agent prompts are long, agent-shaped, and not human chat.
const AGENT_PROMPT = /^(You are (?:a|an)\b|你是(?:一个|一名)|任务正文|##\s*任务|#\s*任务|Task:)/i;

export function humanText(record: Record<string, unknown>): string | null {
  if (record.isMeta || record.isSidechain) {
    return null;
  }
  const message = record.message as { content?: unknown } | undefined;
  let content = message?.content;
  if (Array.isArray(content)) {
    content = content
      .filter((block): block is { type: string; text?: string } => typeof block === 'object' && block !== null && (block as { type?: string }).type === 'text')
      .map((block) => block.text ?? '')
      .join(' ');
  }
  if (typeof content !== 'string') {
    return null;
  }
  const text = content.trim();
  if (!text || text.length > MAX_USER_CHARS) {
    return null;
  }
  if (SKIP_USER.test(text) || AGENT_PROMPT.test(text)) {
    return null;
  }
  if (!/[一-鿿A-Za-z]/.test(text)) {
    return null;
  }
  return text;
}

export function assistantText(record: Record<string, unknown>): string | null {
  const message = record.message as { content?: unknown } | undefined;
  let content = message?.content;
  if (Array.isArray(content)) {
    content = content
      .filter((block): block is { type: string; text?: string } => typeof block === 'object' && block !== null && (block as { type?: string }).type === 'text')
      .map((block) => block.text ?? '')
      .filter(Boolean)
      .join('\n');
  }
  if (typeof content !== 'string' || !content.trim()) {
    return null;
  }
  return content.slice(0, MAX_MESSAGE_CHARS);
}

/** Normalises into the matching alphabet, keeping a raw-index map. */
export function normalizeWithMap(value: string): { text: string; map: number[] } {
  let text = '';
  const map: number[] = [];
  for (let index = 0; index < value.length; index += 1) {
    const char = value[index].toLowerCase();
    if (/[0-9a-z一-鿿]/.test(char)) {
      text += char;
      map.push(index);
    }
  }
  return { text, map };
}

export type Run = { length: number; aStart: number; bStart: number };

/** Longest common normalised run; length 0 when below MIN_RUN. */
export function longestRunWithPositions(a: string, b: string): Run {
  if (a.length < MIN_RUN || b.length < MIN_RUN) {
    return { length: 0, aStart: -1, bStart: -1 };
  }
  const positions = new Map<string, number[]>();
  for (let index = 0; index + MIN_RUN <= b.length; index += 1) {
    const shingle = b.slice(index, index + MIN_RUN);
    const bucket = positions.get(shingle);
    if (bucket) {
      if (bucket.length < 3) {
        bucket.push(index);
      }
    } else {
      positions.set(shingle, [index]);
    }
  }
  let best: Run = { length: 0, aStart: -1, bStart: -1 };
  for (let index = 0; index + MIN_RUN <= a.length; index += 1) {
    const bucket = positions.get(a.slice(index, index + MIN_RUN));
    if (!bucket) {
      continue;
    }
    for (const start of bucket) {
      let length = MIN_RUN;
      while (index + length < a.length && start + length < b.length && a[index + length] === b[start + length]) {
        length += 1;
      }
      if (length > best.length) {
        best = { length, aStart: index, bStart: start };
      }
    }
  }
  return best;
}

/** Splits one message into passages: paragraphs, list items, headings, code blocks. */
export function segmentPassages(message: WindowMessage): Passage[] {
  const lines = message.text.split(/\r?\n/);
  const passages: Passage[] = [];
  let block: string[] = [];
  let inFence = false;
  let fence: string[] = [];
  let counter = 0;
  const push = (text: string): void => {
    const normalized = normalizeReferenceTarget(text);
    if (normalized.length < 8) {
      return;
    }
    counter += 1;
    passages.push({ id: `${message.index}:${counter}`, text: text.slice(0, 2_000), normalized, chars: text.length });
  };
  const flush = (): void => {
    if (block.length > 0) {
      push(block.join('\n').trim());
      block = [];
    }
  };
  for (const line of lines) {
    if (/^\s{0,3}(?:```|~~~)/.test(line)) {
      if (inFence) {
        push(fence.join('\n').trim());
        fence = [];
        inFence = false;
      } else {
        flush();
        inFence = true;
      }
      continue;
    }
    if (inFence) {
      fence.push(line);
      continue;
    }
    if (!line.trim()) {
      flush();
      continue;
    }
    if (/^\s*\|/.test(line)) {
      flush();
      continue;
    }
    if (/^#{1,6}\s+/.test(line) || /^\s*(?:[-*+]|\d{1,2}[.)、）])\s+/.test(line)) {
      flush();
      push(line.trim());
      continue;
    }
    block.push(line);
  }
  flush();
  if (fence.length > 0) {
    push(fence.join('\n').trim());
  }
  return passages;
}

export function bigrams(text: string): Map<string, number> {
  const counts = new Map<string, number>();
  for (let index = 0; index + 1 < text.length; index += 1) {
    const gram = text.slice(index, index + 2);
    counts.set(gram, (counts.get(gram) ?? 0) + 1);
  }
  return counts;
}

export function dice(left: Map<string, number>, right: Map<string, number>): number {
  let overlap = 0;
  let leftTotal = 0;
  let rightTotal = 0;
  for (const count of left.values()) {
    leftTotal += count;
  }
  for (const [gram, count] of right) {
    rightTotal += count;
    overlap += Math.min(count, left.get(gram) ?? 0);
  }
  return leftTotal + rightTotal === 0 ? 0 : (2 * overlap) / (leftTotal + rightTotal);
}

/** One reconstructed turn: the draft, the quoted run, and the window before it. */
export type GroundTruthTurn = {
  draft: string;
  draftNormalized: string;
  quotedRun: string;
  /** The raw selected span, when the caller kept it (probe-export does). */
  selectedText?: string;
  sourceMessageIndex: number;
  sourcePassage: Passage;
  distance: number;
  quotedLength: number;
  window: WindowMessage[];
  rawUserText: string;
  extraRuns: number;
};

/**
 * Exports a small probe set for the gateway experiment.
 *
 * 16 turns, one per transcript file where possible: 8 with the source within 3
 * messages ("near") and 8 farther back ("far"). For each turn two candidate
 * pools are exported:
 *
 *   · oracle-neighbors — the source message ±1 (a three-message viewport);
 *   · naive-12         — the last twelve messages, prefiltered to the lexical
 *                        top-20 (what a composer without a scroll signal can
 *                        afford to send).
 *
 * Ground truth is the passage carrying the quoted run. Each pool also carries
 * the lexical top-3, so the gateway run can be compared on the same sample.
 *
 * Run: npx tsx --tsconfig=tsconfig.json experiments/caret-item-matching/probe-export.mts
 */

import { createReadStream, readdirSync, statSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import { createInterface } from 'node:readline';

import { normalizeReferenceTarget } from '@/modules/chat/utils/transcript/referenceTargets';

import { DEFAULT_CORPUS_ROOT } from './corpus.mts';
import {
  MIN_DRAFT_CHARS,
  MIN_RUN,
  assistantText,
  bigrams,
  dice,
  humanText,
  longestRunWithPositions,
  normalizeWithMap,
  segmentPassages,
} from './turn-extract.mts';
import type { GroundTruthTurn, Passage, WindowMessage } from './turn-extract.mts';

const DAYS = Number(process.env.DAYS ?? 21);
const WINDOW = 12;
const PER_BUCKET = 8;
const MAX_PASSAGE_CHARS = 420;

type ExportedPassage = {
  id: string;
  role: 'assistant' | 'user';
  text: string;
};

type ExportedTurn = {
  id: string;
  sessionFile: string;
  draft: string;
  quotedRun: string;
  /** The raw selected span (the normalised run loses punctuation). */
  selectedText: string;
  /** Tail of the message the selection came from, for the chip prompt. */
  sourceTail: string;
  distance: number;
  sourceRole: 'assistant' | 'user';
  truthPassageId: string;
  pools: {
    'oracle-neighbors': {
      passages: ExportedPassage[];
      truthInPool: boolean;
      lexicalTop3: string[];
    };
    'naive-12': {
      passages: ExportedPassage[];
      truthInPool: boolean;
      lexicalTop3: string[];
    };
    'tight-12': {
      passages: ExportedPassage[];
      truthInPool: boolean;
      lexicalTop3: string[];
    };
  };
};

function trimPassage(passage: Passage): string {
  const text = passage.text.replace(/\s+/g, ' ').trim();
  return text.length > MAX_PASSAGE_CHARS ? `${text.slice(0, MAX_PASSAGE_CHARS)}…` : text;
}

function toExported(messages: WindowMessage[]): ExportedPassage[] {
  const out: ExportedPassage[] = [];
  for (const message of messages) {
    for (const passage of message.passages) {
      out.push({ id: passage.id, role: message.role, text: trimPassage(passage) });
    }
  }
  return out;
}

function lexicalTop(turn: GroundTruthTurn, passages: ExportedPassage[], limit: number): string[] {
  const draft = bigrams(turn.draftNormalized);
  return passages
    .map((passage) => ({ id: passage.id, score: dice(draft, bigrams(normalizeReferenceTarget(passage.text))) }))
    .sort((left, right) => right.score - left.score)
    .slice(0, limit)
    .map((row) => row.id);
}

async function main(): Promise<void> {
  const cutoff = Date.now() - DAYS * 86_400_000;
  const files = readdirSync(DEFAULT_CORPUS_ROOT)
    .filter((name) => name.endsWith('.jsonl'))
    .map((name) => path.join(DEFAULT_CORPUS_ROOT, name))
    .filter((file) => statSync(file).mtimeMs >= cutoff);

  const turns: { turn: GroundTruthTurn; file: string }[] = [];
  const seenDrafts = new Set<string>();

  for (const file of files) {
    const window: WindowMessage[] = [];
    let messageIndex = 0;
    let taken = false;
    const reader = createInterface({ input: createReadStream(file, { encoding: 'utf8' }), crlfDelay: Infinity });
    for await (const line of reader) {
      if (taken || !line.includes('"type"')) {
        continue;
      }
      let record: Record<string, unknown>;
      try {
        record = JSON.parse(line) as Record<string, unknown>;
      } catch {
        continue;
      }
      if (record.type === 'assistant') {
        const text = assistantText(record);
        if (text) {
          messageIndex += 1;
          const message: WindowMessage = {
            role: 'assistant', text, normalized: normalizeReferenceTarget(text), index: messageIndex, passages: [],
          };
          message.passages = segmentPassages(message);
          window.push(message);
          if (window.length > WINDOW) {
            window.shift();
          }
        }
        continue;
      }
      if (record.type !== 'user') {
        continue;
      }
      const text = humanText(record);
      if (!text) {
        continue;
      }
      messageIndex += 1;
      const { text: normalized, map } = normalizeWithMap(text);
      let best: { message: WindowMessage; distance: number; run: ReturnType<typeof longestRunWithPositions> } | null = null;
      for (let index = 0; index < window.length; index += 1) {
        const message = window[index];
        const run = longestRunWithPositions(normalized, message.normalized);
        if (run.length >= MIN_RUN && (best === null || run.length > best.run.length)) {
          best = { message, distance: window.length - index, run };
        }
      }
      if (best !== null) {
        const rawStart = map[best.run.aStart];
        const rawEnd = map[best.run.aStart + best.run.length - 1] + 1;
        const draft = `${text.slice(0, rawStart)} ${text.slice(rawEnd)}`.trim();
        const draftNormalized = normalizeReferenceTarget(draft);
        if (draftNormalized.length >= MIN_DRAFT_CHARS && !seenDrafts.has(draft)) {
          const quotedRun = best.message.normalized.slice(best.run.bStart, best.run.bStart + best.run.length);
          let ground: { passage: Passage; overlap: number } | null = null;
          for (const passage of best.message.passages) {
            const overlap = longestRunWithPositions(quotedRun, passage.normalized).length;
            if (overlap > 0 && (ground === null || overlap > ground.overlap)) {
              ground = { passage, overlap };
            }
          }
          if (ground !== null) {
            seenDrafts.add(draft);
            turns.push({
              turn: {
                draft,
                draftNormalized,
                quotedRun,
                selectedText: text.slice(rawStart, rawEnd),
                sourceMessageIndex: best.message.index,
                sourcePassage: ground.passage,
                distance: best.distance,
                quotedLength: best.run.length,
                window: [...window],
                rawUserText: text,
                extraRuns: 0,
              },
              file: path.basename(file),
            });
            taken = true;
          }
        }
      }
      const userMessage: WindowMessage = { role: 'user', text, normalized, index: messageIndex, passages: [] };
      userMessage.passages = segmentPassages(userMessage);
      window.push(userMessage);
      if (window.length > WINDOW) {
        window.shift();
      }
    }
  }

  const near = turns.filter((entry) => entry.turn.distance <= 3).slice(0, PER_BUCKET);
  const far = turns.filter((entry) => entry.turn.distance > 3).slice(0, PER_BUCKET);
  const selected = [...near, ...far];

  const exported: ExportedTurn[] = selected.map((entry, index) => {
    const turn = entry.turn;
    const sourceAt = turn.window.findIndex((message) => message.index === turn.sourceMessageIndex);
    const neighbors = sourceAt < 0 ? [] : turn.window.slice(Math.max(0, sourceAt - 1), sourceAt + 2);
    const lastTwelve = turn.window.slice(-12);

    const oracleAll = toExported(neighbors);
    const oracleById = new Map(oracleAll.map((passage) => [passage.id, passage]));
    // The oracle pool always carries the truth, then the lexical top-24, capped
    // at 32 so one huge message cannot blow the prompt budget.
    const truthPassage = oracleById.get(turn.sourcePassage.id);
    const oracleTop = lexicalTop(turn, oracleAll, 24);
    const oracleSeen = new Set<string>();
    const oraclePassages: ExportedPassage[] = [];
    for (const passage of [truthPassage, ...oracleTop.map((id) => oracleById.get(id))]) {
      if (passage && !oracleSeen.has(passage.id)) {
        oracleSeen.add(passage.id);
        oraclePassages.push(passage);
      }
    }
    const oracleIds = new Set(oraclePassages.map((passage) => passage.id));
    const naiveAll = toExported(lastTwelve);
    const naiveTop = lexicalTop(turn, naiveAll, 20);
    const naiveById = new Map(naiveAll.map((passage) => [passage.id, passage]));
    const naivePassages = naiveTop
      .map((id) => naiveById.get(id))
      .filter((passage): passage is ExportedPassage => passage !== undefined);
    const tightPassages = lexicalTop(turn, naiveAll, 12)
      .map((id) => naiveById.get(id))
      .filter((passage): passage is ExportedPassage => passage !== undefined);

    return {
      id: `T${String(index + 1).padStart(2, '0')}`,
      sessionFile: entry.file,
      draft: turn.draft,
      quotedRun: turn.quotedRun,
      selectedText: turn.selectedText ?? turn.quotedRun,
      sourceTail: (turn.window[sourceAt]?.text ?? '').slice(-2_000),
      distance: turn.distance,
      sourceRole: turn.window[sourceAt]?.role ?? 'assistant',
      truthPassageId: turn.sourcePassage.id,
      pools: {
        'oracle-neighbors': {
          passages: oraclePassages,
          truthInPool: oracleIds.has(turn.sourcePassage.id),
          lexicalTop3: lexicalTop(turn, oraclePassages, 3),
        },
        'naive-12': {
          passages: naivePassages,
          truthInPool: naivePassages.some((passage) => passage.id === turn.sourcePassage.id),
          lexicalTop3: lexicalTop(turn, naivePassages, 3),
        },
        'tight-12': {
          passages: tightPassages,
          truthInPool: tightPassages.some((passage) => passage.id === turn.sourcePassage.id),
          lexicalTop3: lexicalTop(turn, tightPassages, 3),
        },
      },
    };
  });

  const out = path.join(path.dirname(new URL(import.meta.url).pathname), 'PROBE-SET.json');
  writeFileSync(out, `${JSON.stringify({
    schema: 'caret-item-matching/probe-set/1',
    createdAt: new Date().toISOString(),
    corpus: { root: DEFAULT_CORPUS_ROOT, days: DAYS, files: files.length },
    counts: { near: near.length, far: far.length, total: exported.length },
    turns: exported,
  }, null, 2)}\n`);
  process.stdout.write(`wrote ${out}: ${exported.length} turns (near ${near.length}, far ${far.length})\n`);
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});

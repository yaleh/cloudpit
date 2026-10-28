/**
 * Lexical passage retrieval from the typed opinion, by candidate pool.
 *
 * THE DECOMPOSITION. A keyboard quote-suggestion has to get two things right:
 * the passage must be in the candidate pool at all, and the ranker must put it
 * first. This probe separates them by reranking the same 390 turns under five
 * pools:
 *
 *   · source-only       — the message the passage came from (perfect viewport,
 *                         one message): isolates intra-message ranking;
 *   · source-neighbors  — that message ±1: a three-message viewport centred on
 *                         the reading position;
 *   · last-3/5/12       — the pool a composer sees without any scroll signal.
 *
 * The gap between `source-neighbors` and `last-3` is the value of knowing where
 * the person is reading. The gap between `source-only` and `source-neighbors`
 * is the cost of not knowing exactly which message.
 *
 * Ranker is deliberately cheap (character-bigram Dice + distance prior); §11.2
 * of REPORT.md already showed it is a lower bound, not the answer.
 *
 * Run: npx tsx --tsconfig=tsconfig.json experiments/caret-item-matching/retrieval-probe.mts
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

type Pool = { key: string; pick: (turn: GroundTruthTurn) => WindowMessage[] };

const pools: Pool[] = [
  {
    key: 'source-only',
    pick: (turn) => turn.window.filter((message) => message.index === turn.sourceMessageIndex),
  },
  {
    key: 'source-neighbors',
    pick: (turn) => {
      const at = turn.window.findIndex((message) => message.index === turn.sourceMessageIndex);
      return at < 0 ? [] : turn.window.slice(Math.max(0, at - 1), at + 2);
    },
  },
  { key: 'last-3', pick: (turn) => turn.window.slice(-3) },
  { key: 'last-5', pick: (turn) => turn.window.slice(-5) },
  { key: 'last-12', pick: (turn) => turn.window.slice(-12) },
];

function rank(turn: GroundTruthTurn, pool: WindowMessage[]): {
  top1: boolean;
  top3: boolean;
  topScore: number;
  candidates: number;
  candidateChars: number;
} {
  const candidates: { passage: Passage; score: number; distance: number }[] = [];
  let candidateChars = 0;
  for (let index = 0; index < pool.length; index += 1) {
    const message = pool[index];
    const distance = pool.length - index;
    for (const passage of message.passages) {
      candidateChars += passage.chars;
      candidates.push({
        passage,
        score: dice(bigrams(turn.draftNormalized), bigrams(passage.normalized)) + 0.02 / distance,
        distance,
      });
    }
  }
  candidates.sort((left, right) => right.score - left.score || left.distance - right.distance);
  const top = candidates.slice(0, 3);
  return {
    top1: top[0]?.passage.id === turn.sourcePassage.id,
    top3: top.some((candidate) => candidate.passage.id === turn.sourcePassage.id),
    topScore: top[0]?.score ?? 0,
    candidates: candidates.length,
    candidateChars,
  };
}

type Row = { turns: number; top1: number; top3: number; candidates: number; candidateChars: number };
const stats: Record<string, Row> = {};
const bump = (key: string, reading: ReturnType<typeof rank>): void => {
  const row = stats[key] ?? { turns: 0, top1: 0, top3: 0, candidates: 0, candidateChars: 0 };
  row.turns += 1;
  row.top1 += reading.top1 ? 1 : 0;
  row.top3 += reading.top3 ? 1 : 0;
  row.candidates += reading.candidates;
  row.candidateChars += reading.candidateChars;
  stats[key] = row;
};

async function main(): Promise<void> {
  const cutoff = Date.now() - DAYS * 86_400_000;
  const files = readdirSync(DEFAULT_CORPUS_ROOT)
    .filter((name) => name.endsWith('.jsonl'))
    .map((name) => path.join(DEFAULT_CORPUS_ROOT, name))
    .filter((file) => statSync(file).mtimeMs >= cutoff);
  const started = performance.now();
  let bytes = 0;
  const counts = {
    turns: 0,
    quoteTurns: 0,
    quoteOnlyTurns: 0,
    opinionTurns: 0,
    opinionWithGroundTruth: 0,
    skippedNoGroundTruth: 0,
    multiQuoteTurns: 0,
    opinionChars: [] as number[],
    distances: [] as number[],
  };
  const examples: Record<string, unknown[]> = { hit: [], miss: [] };

  for (const [fileIndex, file] of files.entries()) {
    bytes += statSync(file).size;
    const window: WindowMessage[] = [];
    let messageIndex = 0;
    const reader = createInterface({ input: createReadStream(file, { encoding: 'utf8' }), crlfDelay: Infinity });
    for await (const line of reader) {
      if (!line.includes('"type"')) {
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
      counts.turns += 1;
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
        counts.quoteTurns += 1;
        const rawStart = map[best.run.aStart];
        const rawEnd = map[best.run.aStart + best.run.length - 1] + 1;
        const draft = `${text.slice(0, rawStart)} ${text.slice(rawEnd)}`.trim();
        const draftNormalized = normalizeReferenceTarget(draft);
        const quotedRun = best.message.normalized.slice(best.run.bStart, best.run.bStart + best.run.length);

        if (draftNormalized.length < MIN_DRAFT_CHARS) {
          counts.quoteOnlyTurns += 1;
        } else {
          counts.opinionTurns += 1;
          let ground: { passage: Passage; overlap: number } | null = null;
          for (const passage of best.message.passages) {
            const overlap = longestRunWithPositions(quotedRun, passage.normalized).length;
            if (overlap > 0 && (ground === null || overlap > ground.overlap)) {
              ground = { passage, overlap };
            }
          }
          if (ground === null) {
            counts.skippedNoGroundTruth += 1;
          } else {
            counts.opinionWithGroundTruth += 1;
            counts.opinionChars.push(draft.length);
            counts.distances.push(best.distance);
            const extra = longestRunWithPositions(draftNormalized, best.message.normalized);
            if (extra.length >= MIN_RUN) {
              counts.multiQuoteTurns += 1;
            }
            const turn: GroundTruthTurn = {
              draft,
              draftNormalized,
              quotedRun,
              sourceMessageIndex: best.message.index,
              sourcePassage: ground.passage,
              distance: best.distance,
              quotedLength: best.run.length,
              window: [...window],
              rawUserText: text,
              extraRuns: extra.length >= MIN_RUN ? 1 : 0,
            };
            for (const pool of pools) {
              const reading = rank(turn, pool.pick(turn));
              bump(pool.key, reading);
              const far = best.distance > 3 ? 'far' : 'near';
              bump(`${pool.key}-${far}`, reading);
            }
            const wide = rank(turn, turn.window);
            if (examples.hit.length < 5 && wide.top1) {
              examples.hit.push({ draft: draft.slice(0, 140), quoted: quotedRun.slice(0, 140), distance: best.distance });
            }
            if (examples.miss.length < 5 && !wide.top3) {
              examples.miss.push({ draft: draft.slice(0, 140), quoted: quotedRun.slice(0, 140), distance: best.distance });
            }
          }
        }
      }

      const userMessage: WindowMessage = {
        role: 'user', text, normalized, index: messageIndex, passages: [],
      };
      userMessage.passages = segmentPassages(userMessage);
      window.push(userMessage);
      if (window.length > WINDOW) {
        window.shift();
      }
    }
    if ((fileIndex + 1) % 400 === 0) {
      process.stderr.write(`scanned ${fileIndex + 1}/${files.length} files, ${counts.turns} turns\n`);
    }
  }

  const rates = Object.fromEntries(
    Object.entries(stats).map(([key, row]) => [key, {
      turns: row.turns,
      top1: Number((row.top1 / Math.max(1, row.turns)).toFixed(3)),
      top3: Number((row.top3 / Math.max(1, row.turns)).toFixed(3)),
      meanCandidates: Number((row.candidates / Math.max(1, row.turns)).toFixed(1)),
      meanCandidateChars: Number((row.candidateChars / Math.max(1, row.turns)).toFixed(0)),
    }]),
  );
  const sortedChars = [...counts.opinionChars].sort((left, right) => left - right);
  const sortedDistances = [...counts.distances].sort((left, right) => left - right);
  const at = (values: number[], q: number): number =>
    values.length === 0 ? 0 : values[Math.min(values.length - 1, Math.floor(values.length * q))];

  const report = {
    schema: 'caret-item-matching/retrieval-probe/2',
    ranAt: new Date().toISOString(),
    corpus: {
      root: DEFAULT_CORPUS_ROOT,
      days: DAYS,
      files: files.length,
      megabytes: Number((bytes / 1048576).toFixed(1)),
      scanSeconds: Number(((performance.now() - started) / 1000).toFixed(1)),
      windowMessages: WINDOW,
      minRun: MIN_RUN,
    },
    counts: {
      turns: counts.turns,
      quoteTurns: counts.quoteTurns,
      quoteOnlyTurns: counts.quoteOnlyTurns,
      opinionTurns: counts.opinionTurns,
      opinionWithGroundTruth: counts.opinionWithGroundTruth,
      skippedNoGroundTruth: counts.skippedNoGroundTruth,
      multiQuoteTurns: counts.multiQuoteTurns,
      draftChars: { p50: at(sortedChars, 0.5), p90: at(sortedChars, 0.9), max: sortedChars[sortedChars.length - 1] ?? 0 },
      sourceDistance: { p50: at(sortedDistances, 0.5), p90: at(sortedDistances, 0.9), max: sortedDistances[sortedDistances.length - 1] ?? 0 },
    },
    rates,
    examples,
  };
  const out = path.join(path.dirname(new URL(import.meta.url).pathname), 'RETRIEVAL-RESULT.json');
  writeFileSync(out, `${JSON.stringify(report, null, 2)}\n`);
  process.stdout.write(`${JSON.stringify(report, null, 2)}\n`);
  process.stderr.write(`wrote ${out}\n`);
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});

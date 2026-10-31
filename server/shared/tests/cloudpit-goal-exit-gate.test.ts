/**
 * AC-455 — GOAL-053's EXIT STRUCTURAL GATE, as a runnable criterion.
 *
 * GOAL-053's exit condition #4 reads: "相关单测、typecheck、lint 绿；不新增模块目录，不往
 * `server/shared/utils.ts` 加行（避免 AC-394 与 oversize 棘轮）". Before this file no
 * in-domain AC ran any of those structural checks: AC-448/449/450 cover the dark pipeline
 * capabilities, and the task-level ACs are not what the sufficiency judge reads. This
 * criterion is the missing in-domain reader.
 *
 * It pins exactly the two STRUCTURAL facts the exit condition names:
 *
 *   1. ZERO NEW MODULE DIRECTORIES. The same scanner AC-394 budgets
 *      (`collectServerSources` + `scanImportGraph`) reports the tree's directory set; every
 *      measured directory must be named by the frozen baseline
 *      (`cloudpit-goal-exit-gate.baseline.json.moduleDirectories`). `extra=[]` is green.
 *      The reading is MONOTONIC: a directory may disappear (a sibling task shrinking the tree
 *      must not red this criterion), so `missing=[]` is printed but NOT asserted, and the
 *      count is not required to equal AC-394's roster — that manifest may only shrink too.
 *   2. `server/shared/utils.ts` DID NOT GROW. Its physical line count must stay `<=` the
 *      frozen `utilsLineCount` AND `<=` the committed oversize reading in
 *      `architecture-ratchet.baseline.json.oversizeFiles['server/shared/utils.ts']`. Again
 *      monotonic: the file may only shrink.
 *
 * Why not just run `architecture-ratchet.test.ts`? Because it reds on unrelated develop
 * movement across five dimensions; the exit condition needs a stable, goal-scoped reading.
 * The exact utils.ts line pin is therefore carried here, and this file reads the ratchet
 * baseline rather than running the ratchet criterion.
 *
 * FALSE FORM: the `structuralGateViolations` function below is the single assertion path used
 * by BOTH real-tree arms AND the negative control. The control feeds it a synthetic
 * directory set with one extra directory and a synthetic line count with one extra line and
 * asserts each is reported as a violation — so `extra=[]` cannot be vacuously green.
 */
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import test from 'node:test';
import { fileURLToPath } from 'node:url';

import { collectServerSources, scanImportGraph, type Graph } from '@/shared/import-graph.js';

const TEST_DIR = path.dirname(fileURLToPath(import.meta.url));
const REPO_ROOT = path.resolve(TEST_DIR, '../../..');
const SERVER_DIR = path.join(REPO_ROOT, 'server');
const UTILS_PATH = path.join(SERVER_DIR, 'shared', 'utils.ts');

const GATE_BASELINE_PATH = path.join(TEST_DIR, 'cloudpit-goal-exit-gate.baseline.json');
const CYCLE_BASELINE_PATH = path.join(TEST_DIR, 'server-import-cycle-budget.baseline.json');
const RATCHET_BASELINE_PATH = path.join(TEST_DIR, 'architecture-ratchet.baseline.json');

const UTILS_RATCHET_KEY = 'server/shared/utils.ts';

// ---------------------------------------------------------------------------
// Readings
// ---------------------------------------------------------------------------

/** The frozen exit-gate baseline. `moduleDirectories` is a set upper bound; `utilsLineCount` a ceiling. */
type GateBaseline = {
  measuredAt: string;
  note: string;
  moduleDirectories: string[];
  utilsLineCount: number;
};

/** One structural reading — real or synthetic — fed to the single assertion path below. */
type GateReading = {
  measuredDirectories: readonly string[];
  frozenDirectories: readonly string[];
  measuredUtilsLines: number;
  frozenUtilsLines: number;
  ratchetUtilsLines: number;
};

/** A parsed JSON object, with the non-object shape rejected where it is read. */
function readJsonObject(filePath: string): Record<string, unknown> {
  const raw: unknown = JSON.parse(fs.readFileSync(filePath, 'utf8'));
  assert.ok(
    typeof raw === 'object' && raw !== null && !Array.isArray(raw),
    `${path.basename(filePath)} must be a JSON object`,
  );
  return raw as Record<string, unknown>;
}

/** Reads and validates the frozen exit-gate baseline — every field checked, no `any`. */
function readGateBaseline(): GateBaseline {
  const record = readJsonObject(GATE_BASELINE_PATH);

  const measuredAt = record.measuredAt;
  assert.ok(
    typeof measuredAt === 'string' && /^\d{4}-\d{2}-\d{2}/.test(measuredAt),
    'gate baseline measuredAt must carry a date (YYYY-MM-DD)',
  );

  const note = record.note;
  assert.ok(typeof note === 'string' && note.length > 0, 'gate baseline note must explain the monotonic reading');

  const moduleDirectories = record.moduleDirectories;
  assert.ok(
    Array.isArray(moduleDirectories) && moduleDirectories.length > 0 && moduleDirectories.every((entry) => typeof entry === 'string'),
    'gate baseline moduleDirectories must be a non-empty array of strings',
  );
  const directories = moduleDirectories as string[];
  assert.equal(new Set(directories).size, directories.length, 'gate baseline moduleDirectories must not carry duplicates');

  const utilsLineCount = record.utilsLineCount;
  assert.ok(
    typeof utilsLineCount === 'number' && Number.isInteger(utilsLineCount) && utilsLineCount > 0,
    'gate baseline utilsLineCount must be a positive integer',
  );

  return { measuredAt, note, moduleDirectories: directories, utilsLineCount };
}

/** AC-394's committed directory roster — printed as a cross-reading, not asserted (it may only shrink). */
function readDirectoryManifest(): string[] {
  const record = readJsonObject(CYCLE_BASELINE_PATH);
  const manifest = record.directoryManifest;
  assert.ok(
    Array.isArray(manifest) && manifest.every((entry) => typeof entry === 'string'),
    'server-import-cycle-budget.baseline.json.directoryManifest must be an array of strings',
  );
  return manifest as string[];
}

/** The committed oversize ceiling for `server/shared/utils.ts` from the architecture ratchet. */
function readUtilsRatchetLineCount(): number {
  const record = readJsonObject(RATCHET_BASELINE_PATH);
  const oversize = record.oversizeFiles;
  assert.ok(typeof oversize === 'object' && oversize !== null, 'architecture-ratchet.baseline.json.oversizeFiles must be an object');
  const reading = (oversize as Record<string, unknown>)[UTILS_RATCHET_KEY];
  assert.ok(
    typeof reading === 'number' && Number.isInteger(reading) && reading > 0,
    `architecture-ratchet.baseline.json.oversizeFiles['${UTILS_RATCHET_KEY}'] must be a positive integer`,
  );
  return reading;
}

/** The real server tree, scanned once per run — the scan is not repeated per assertion. */
const realGraphOnce = (() => {
  let cached: Graph | undefined;
  return (): Graph => (cached ??= scanImportGraph(collectServerSources(SERVER_DIR)));
})();

/**
 * Physical line count of a text file. `split('\n').length - 1` is the reading AC-455's
 * criterion text names (a newline-terminated file reports the same count as `wc -l`).
 */
function lineCount(text: string): number {
  return text.split('\n').length - 1;
}

// ---------------------------------------------------------------------------
// The single assertion path (real tree AND negative control)
// ---------------------------------------------------------------------------

/** Every measured directory the frozen baseline does not name. */
function unexpectedDirectories(measured: readonly string[], frozen: readonly string[]): string[] {
  const known = new Set(frozen);
  return measured.filter((directory) => !known.has(directory));
}

/**
 * The exit gate's structural reading. Returns one message per violation; `[]` means green.
 * Both real-tree arms and the false form go through this function, so the control cannot
 * pass by exercising a different code path than the criterion.
 */
function structuralGateViolations(reading: GateReading): string[] {
  const violations: string[] = [];

  const extra = unexpectedDirectories(reading.measuredDirectories, reading.frozenDirectories);
  if (extra.length > 0) {
    violations.push(
      `new module director${extra.length === 1 ? 'y' : 'ies'} outside the frozen baseline: ${extra.join(', ')} — ` +
        `GOAL-053's exit gate forbids adding module directories (AC-394 only requires a new leaf; this gate forbids the directory at all)`,
    );
  }

  if (reading.measuredUtilsLines > reading.frozenUtilsLines) {
    violations.push(
      `server/shared/utils.ts grew to ${reading.measuredUtilsLines} lines, over the frozen exit-gate baseline of ` +
        `${reading.frozenUtilsLines} — GOAL-053's exit gate forbids adding lines to this file`,
    );
  }

  if (reading.measuredUtilsLines > reading.ratchetUtilsLines) {
    violations.push(
      `server/shared/utils.ts grew to ${reading.measuredUtilsLines} lines, over the architecture-ratchet oversize ` +
        `baseline of ${reading.ratchetUtilsLines}`,
    );
  }

  return violations;
}

// ---------------------------------------------------------------------------
// AC2 — zero new module directories
// ---------------------------------------------------------------------------

test('AC2: every directory in the server tree is named by the frozen exit-gate baseline', () => {
  const baseline = readGateBaseline();
  const graph = realGraphOnce();
  const manifest = readDirectoryManifest();

  const extra = unexpectedDirectories(graph.nodes, baseline.moduleDirectories);
  const missing = baseline.moduleDirectories.filter((directory) => !graph.nodes.includes(directory));

  console.log(
    `[ac455] directory arm: measured=${graph.nodes.length} frozen=${baseline.moduleDirectories.length} ` +
      `cycleManifest=${manifest.length} extra=${JSON.stringify(extra)} missing=${JSON.stringify(missing)}`,
  );
  assert.ok(graph.nodes.length > 0, 'the scan must have seen directories — an empty tree would make the subset check vacuous');
  assert.ok(baseline.moduleDirectories.length > 0, 'the frozen baseline must name directories');
  assert.deepEqual(
    extra,
    [],
    `a directory outside the frozen baseline is a NEW module directory: ${extra.join(', ')}. ` +
      `Do not raise the baseline — GOAL-053's exit gate forbids new module directories.`,
  );

  const violations = structuralGateViolations({
    measuredDirectories: graph.nodes,
    frozenDirectories: baseline.moduleDirectories,
    measuredUtilsLines: baseline.utilsLineCount,
    frozenUtilsLines: baseline.utilsLineCount,
    ratchetUtilsLines: readUtilsRatchetLineCount(),
  });
  assert.deepEqual(violations, [], violations.join('\n'));
});

// ---------------------------------------------------------------------------
// AC3 — server/shared/utils.ts did not grow
// ---------------------------------------------------------------------------

test('AC3: server/shared/utils.ts is not longer than the frozen exit-gate baseline or the oversize ratchet', () => {
  const baseline = readGateBaseline();
  const ratchetLines = readUtilsRatchetLineCount();
  const measured = lineCount(fs.readFileSync(UTILS_PATH, 'utf8'));

  console.log(`[ac455] utils arm: measured=${measured} frozen=${baseline.utilsLineCount} ratchet=${ratchetLines}`);
  assert.ok(measured > 0, 'the utils.ts reading must not be a zero-line file');
  assert.ok(
    measured <= baseline.utilsLineCount,
    `server/shared/utils.ts is ${measured} lines, over the frozen exit-gate baseline of ${baseline.utilsLineCount} — add the helper elsewhere; this file may only shrink`,
  );
  assert.ok(
    measured <= ratchetLines,
    `server/shared/utils.ts is ${measured} lines, over the architecture-ratchet oversize baseline of ${ratchetLines}`,
  );

  const violations = structuralGateViolations({
    measuredDirectories: realGraphOnce().nodes,
    frozenDirectories: baseline.moduleDirectories,
    measuredUtilsLines: measured,
    frozenUtilsLines: baseline.utilsLineCount,
    ratchetUtilsLines: ratchetLines,
  });
  assert.deepEqual(violations, [], violations.join('\n'));
});

// ---------------------------------------------------------------------------
// False form — the negative control proves the gate can red
// ---------------------------------------------------------------------------

test('AC2/AC3 false form: a synthetic extra directory and a synthetic extra line each red the gate', () => {
  const baseline = readGateBaseline();
  const ratchetLines = readUtilsRatchetLineCount();

  const syntheticDirectory = 'modules/__ac455-false-form';
  const syntheticDirectories = [...baseline.moduleDirectories, syntheticDirectory];
  const syntheticText = 'export const a = 1;\n';
  const syntheticLines = lineCount(syntheticText);

  const clean = structuralGateViolations({
    measuredDirectories: baseline.moduleDirectories,
    frozenDirectories: baseline.moduleDirectories,
    measuredUtilsLines: syntheticLines,
    frozenUtilsLines: syntheticLines,
    ratchetUtilsLines: syntheticLines,
  });
  assert.deepEqual(clean, [], 'the synthetic control must start green, otherwise the red assertions below prove nothing');

  const directoryViolations = structuralGateViolations({
    measuredDirectories: syntheticDirectories,
    frozenDirectories: baseline.moduleDirectories,
    measuredUtilsLines: syntheticLines,
    frozenUtilsLines: syntheticLines,
    ratchetUtilsLines: syntheticLines,
  });
  console.log(`[ac455] false form (extra directory): ${JSON.stringify(directoryViolations)}`);
  assert.ok(directoryViolations.length > 0, 'one extra directory must red the gate');
  assert.ok(
    directoryViolations.some((message) => message.includes(syntheticDirectory)),
    'the directory violation must name the extra directory',
  );

  const lineViolations = structuralGateViolations({
    measuredDirectories: baseline.moduleDirectories,
    frozenDirectories: baseline.moduleDirectories,
    measuredUtilsLines: syntheticLines + 1,
    frozenUtilsLines: syntheticLines,
    ratchetUtilsLines: syntheticLines,
  });
  console.log(`[ac455] false form (extra line): ${JSON.stringify(lineViolations)}`);
  assert.ok(lineViolations.length > 0, 'one extra utils.ts line must red the gate');
  assert.ok(
    lineViolations.some((message) => message.includes('over the frozen exit-gate baseline')),
    'the line violation must name the frozen exit-gate baseline it exceeded',
  );
  assert.ok(
    lineViolations.some((message) => message.includes('architecture-ratchet oversize baseline')),
    'the line violation must also name the oversize ratchet it exceeded',
  );

  // The real ceiling is the tighter of the two, so the committed relationship is meaningful:
  // frozen <= ratchet means the exact exit-gate pin is the one that fires first.
  console.log(`[ac455] ceilings: frozen=${baseline.utilsLineCount} ratchet=${ratchetLines}`);
});

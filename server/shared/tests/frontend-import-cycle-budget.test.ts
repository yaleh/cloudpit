/**
 * The frontend DIRECTORY-level import-cycle ratchet for `src/`.
 *
 * The architecture-analysis routine reported five non-trivial directory SCCs in `src`
 * (finding `src-import-cycles-unpinned`, runId `architecture-analysis-1793381097836`,
 * 2026-10-30): chat/tools ↔ chat/tools/ContentRenderers ↔ chat/transcript;
 * cockpit ↔ cockpit/hooks ↔ project-workspace; git-panel ↔ git-panel/changes ↔
 * git-panel/history; architecture ↔ architecture/hooks; settings/hooks ↔ settings/tabs.
 * The backend already had AC-394's directory budget, but `src` had no cycle criterion and
 * `.oxlintrc.json` enables no `import/no-cycle`, so those five could widen unmeasured.
 *
 * This criterion pins them. It reads the tree with `server/shared/import-graph.ts` — the
 * SAME walk, resolver and Tarjan core AC-394 uses, never a second copy — passing `src` as
 * the scan root, so `@/` resolves to `src/` exactly as the bundler and vitest resolve it.
 *
 * THE RATCHET: the groups below may only SHRINK. A shrink is recorded by lowering this
 * constant AND the committed baseline JSON; the two must name the same groups, so a wider
 * cycle cannot be blessed by editing the JSON alone. A new non-trivial SCC — or a new
 * member joining one of the five — reds this file on the first commit that carries it.
 *
 * The counts in the JSON are PROVENANCE (re-measured on the date named there), not a gate:
 * a new acyclic import is ordinary feature work and must not red this criterion. What IS
 * gated is non-vacuity — a walk that matched no files would otherwise report "zero cycles"
 * and pass, so the real-tree case asserts a floor on files, directories and resolved edges.
 */
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import test from 'node:test';
import { fileURLToPath } from 'node:url';

import { collectTypeScriptSources, scanImportGraph, type Graph, type SourceFile } from '@/shared/import-graph.js';

const TEST_DIR = path.dirname(fileURLToPath(import.meta.url));
const REPO_ROOT = path.resolve(TEST_DIR, '../../..');
const SRC_DIR = path.join(REPO_ROOT, 'src');
const BASELINE_PATH = path.join(TEST_DIR, 'frontend-import-cycle-budget.baseline.json');

/**
 * The ratchet pin, spelled member by member so a widened cycle cannot be blessed by editing
 * the JSON alone. Each group is the exact member set measured on the merged tree; lowering
 * one (a cycle closed by a port/leaf extraction) is a deliberate edit here and in the JSON.
 */
const CYCLE_GROUPS: readonly string[][] = [
  ['modules/chat/tools', 'modules/chat/tools/ContentRenderers', 'modules/chat/transcript'],
  ['modules/cockpit', 'modules/cockpit/hooks', 'modules/project-workspace'],
  ['modules/git-panel', 'modules/git-panel/changes', 'modules/git-panel/history'],
  ['modules/architecture', 'modules/architecture/hooks'],
  ['modules/settings/hooks', 'modules/settings/tabs'],
];

/**
 * A walk that returns far fewer files, directories or edges than the tree carries is a broken
 * reading, not a clean one. These floors sit well below the measured 688 files / 108 directories
 * / 2144 resolved static edges (2026-10-31) so they only fire on a collapsed scan.
 */
const MIN_FILES = 600;
const MIN_DIRECTORIES = 100;
const MIN_STATIC_FILE_EDGES = 2000;

type Baseline = {
  measuredAt: string;
  scope: string;
  cycleGroups: string[][];
  readings: Record<string, number>;
};

/** Member order inside a group and the order between groups are not part of the reading. */
function normalize(groups: readonly string[][]): string[][] {
  return groups
    .map((group) => [...group].sort())
    .sort((a, b) => b.length - a.length || a[0].localeCompare(b[0]));
}

/**
 * The ratchet itself, driven by the same call in every case: the real tree must equal the
 * pinned groups, a planted cycle must NOT, and an acyclic fixture must equal the empty pin.
 * Equality (not subset) is what makes a shrink an explicit lowering of both pins instead of
 * a silent pass, matching AC-394's server criterion.
 */
function assertCycleBudget(graph: Graph, pinned: readonly string[][]): void {
  assert.deepEqual(
    normalize(graph.nonTrivialSccs),
    normalize(pinned),
    'src directory cycles do not match the committed baseline. A cycle may only shrink: ' +
      'when one is genuinely closed, lower CYCLE_GROUPS here and the committed JSON in the ' +
      'same commit. Never add a member or a group to accommodate a red reading.',
  );
}

/** Scan a synthetic tree through the shared scanner, so controls exercise the production reading. */
function scanFixture(files: Record<string, string>): Graph {
  const sources: SourceFile[] = Object.entries(files).map(([filePath, text]) => ({ path: filePath, text }));
  return scanImportGraph(sources, { includeDynamic: false });
}

test('the current src tree carries exactly the five pinned directory cycles', () => {
  const sources = collectTypeScriptSources(SRC_DIR);
  const graph = scanImportGraph(sources, { includeDynamic: false });

  assert.ok(graph.files >= MIN_FILES, `src scan read ${graph.files} files (< ${MIN_FILES}) — a collapsed walk is not a clean one`);
  assert.ok(
    graph.nodes.length >= MIN_DIRECTORIES,
    `src scan found ${graph.nodes.length} directories (< ${MIN_DIRECTORIES}) — a collapsed walk is not a clean one`,
  );
  assert.ok(
    graph.staticFileEdges >= MIN_STATIC_FILE_EDGES,
    `src scan resolved ${graph.staticFileEdges} static file edges (< ${MIN_STATIC_FILE_EDGES}) — the graph is not being read`,
  );
  assert.ok(
    !sources.some((source) => /\.(test|spec)\.(ts|tsx)$/.test(source.path)),
    'the ratchet reads the shipping tree; test/spec files must be dropped by the walk',
  );

  assertCycleBudget(graph, CYCLE_GROUPS);

  const baseline = JSON.parse(fs.readFileSync(BASELINE_PATH, 'utf8')) as Baseline;
  assert.deepEqual(
    normalize(baseline.cycleGroups),
    normalize(CYCLE_GROUPS),
    'the committed JSON and the in-file pin must name the same groups, or a wider reading could be blessed by editing one of them',
  );
  assert.match(baseline.scope, /src\//, 'the baseline must declare that its scope is the frontend tree');
  assert.match(baseline.measuredAt, /^\d{4}-\d{2}-\d{2}$/, 'the baseline must date its reading');
});

test('positive control: a planted two-directory cycle reds the ratchet, including an @/-resolved edge', () => {
  const graph = scanFixture({
    'alpha/a.ts': "import '../beta/b.js';\n",
    'beta/b.ts': "import '@/alpha/a.js';\n",
  });

  assert.deepEqual(
    graph.nonTrivialSccs,
    [['alpha', 'beta']],
    'the shared scanner must see the planted cycle: one relative edge and one @/ edge (the src alias)',
  );
  assert.throws(
    () => assertCycleBudget(graph, CYCLE_GROUPS),
    /do not match the committed baseline/,
    'a cycle outside the pin must red the same assertion the real tree uses',
  );
});

test('negative control: a one-way import is a resolved edge, not a cycle', () => {
  const graph = scanFixture({
    'alpha/a.ts': "import '../beta/b.js';\n",
    'beta/b.ts': 'export const b = 1;\n',
  });

  assert.deepEqual(graph.nonTrivialSccs, [], 'a one-way import cannot close a cycle');
  assert.equal(graph.staticFileEdges, 1, 'the edge must resolve — an unresolved import would make the empty SCC list vacuous');
  assert.doesNotThrow(() => assertCycleBudget(graph, []), 'an acyclic reading matches the empty pin');
});

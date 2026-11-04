/**
 * The frontend DIRECTORY-level import-cycle ratchet for `src/`.
 *
 * The architecture-analysis routine reported five non-trivial directory SCCs in `src`
 * (finding `src-import-cycles-unpinned`, runId `architecture-analysis-1793381097836`,
 * 2026-10-30): chat/tools ↔ chat/tools/ContentRenderers ↔ chat/transcript;
 * cockpit ↔ cockpit/hooks ↔ project-workspace; git-panel ↔ git-panel/changes ↔
 * git-panel/history; architecture ↔ architecture/hooks; settings/hooks ↔ settings/tabs.
 * RE-READ 2026-11-02 (task gap-routine-architecture-analysis-god-package-src-cockpit): the
 * cockpit god-package split moved its card and workspace files into `cockpit/cards` and
 * `cockpit/workspace`. Those files already imported each other, so the same dependency web is
 * now read across four cockpit directories plus project-workspace; the group was re-measured and
 * re-pinned member-for-member rather than dropped. This is the mandated re-read for a structural
 * split, not a widened dependency: the module-level SCC below is unchanged.
 * RE-READ 2026-11-04 (task gap-routine-architecture-analysis-god-package-src-architecture): the
 * architecture god-package split moved every implementation file out of `modules/architecture`
 * into the `render/`, `layout/` and `dom/` leaves, leaving the root as the barrel. The former
 * `architecture <-> architecture/hooks` dependency now runs root -> hooks -> dom, so that group
 * was re-measured and LOWERED out of the pin; no new group or member appeared.
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
 * member joining one of the pinned groups — reds this file on the first commit that carries it.
 *
 * The counts in the JSON are PROVENANCE (re-measured on the date named there), not a gate:
 * a new acyclic import is ordinary feature work and must not red this criterion. What IS
 * gated is non-vacuity — a walk that matched no files would otherwise report "zero cycles"
 * and pass, so the real-tree case asserts a floor on files, directories and resolved edges.
 *
 * MODULE GRANULARITY (finding `src-module-scc-cockpit-hub`). The directory reading above is
 * finer than the question the architecture review asks: "which FEATURES depend on each other?"
 * A node there is `modules/<name>` (the scope `.oxlintrc.json` calls `frontend-module`), and an
 * edge is any cross-module import, collapsed from the same walk and resolved with the same
 * resolver — no second scanner. The second reading must see at most a two-module cycle; today it
 * is exactly cockpit ↔ project-workspace, and the cockpit's leaf contract is its own top-level
 * module so the chat/sidebar/ui-scenario edges into it cannot pull those modules back into the
 * cockpit's SCC. A new module cycle, or a leaf contract that grows an out-edge, reds this file.
 */
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import test from 'node:test';
import { fileURLToPath } from 'node:url';

import {
  collectTypeScriptSources,
  scanImportGraph,
  strongComponents,
  type Graph,
  type SourceFile,
} from '@/shared/import-graph.js';

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
  // Re-read after the cockpit god-package split (2026-11-02): the card, workspace and hooks
  // directories share one dependency web with the root barrel and project-workspace.
  ['modules/cockpit', 'modules/cockpit/cards', 'modules/cockpit/hooks', 'modules/cockpit/workspace', 'modules/project-workspace'],
  ['modules/git-panel', 'modules/git-panel/changes', 'modules/git-panel/history'],
  // Lowered 2026-11-04 (architecture god-package split): the root <-> hooks edge now runs
  // through the leaves (root -> hooks -> dom), so this group no longer exists.
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

/**
 * The module-level pin (finding `src-module-scc-cockpit-hub`): the ONLY non-trivial SCC in the
 * `modules/<name>` graph is cockpit ↔ project-workspace. The task's acceptance criterion is "at
 * most 2 members", but this pin spells the exact two so a shrink is a deliberate lowering (the
 * same ratchet rule as the directory groups above), and so a NEW module cycle cannot hide behind
 * the word "at most".
 */
const MODULE_SCC_GROUPS: readonly string[][] = [['modules/cockpit', 'modules/project-workspace']];

/**
 * Non-vacuity for the module reading: the merged tree carries 29 module nodes and 53
 * cross-module import pairs (2026-10-31, the same walk after the leaf-contract extraction).
 * The floors sit far below so only a collapsed scan trips them.
 */
const MIN_MODULES = 25;
const MIN_CROSS_MODULE_EDGES = 30;

type Baseline = {
  measuredAt: string;
  scope: string;
  cycleGroups: string[][];
  moduleSccGroups?: string[][];
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

/** `modules/cockpit/hooks` → `modules/cockpit`; `null` for anything outside `src/modules/`. */
function moduleOf(directory: string): string | null {
  if (!directory.startsWith('modules/')) return null;
  const [name] = directory.slice('modules/'.length).split('/');
  return name ? `modules/${name}` : null;
}

/**
 * Collapse the directory graph to the module graph: nodes are `modules/<name>`, an edge is any
 * import crossing two of them. Intra-module imports (`modules/cockpit/hooks` → `modules/cockpit`)
 * are the module's own business and drop out; paths under `src/shared`, `src/` root files etc.
 * are not feature modules and are outside this reading. The SCC pass is the SAME
 * `strongComponents` the directory reading uses, so the two granularities cannot diverge.
 */
function moduleGraph(graph: Graph): { nodes: string[]; adjacency: Map<string, string[]>; edges: number } {
  const nodes = new Set<string>();
  const adjacency = new Map<string, Set<string>>();
  const pairs = new Set<string>();
  for (const edge of graph.dirEdges) {
    const from = moduleOf(edge.from);
    const to = moduleOf(edge.to);
    if (from === null || to === null || from === to) continue;
    nodes.add(from);
    nodes.add(to);
    pairs.add(`${from}\u0000${to}`);
    const targets = adjacency.get(from) ?? new Set<string>();
    targets.add(to);
    adjacency.set(from, targets);
  }
  return {
    nodes: [...nodes].sort(),
    adjacency: new Map([...adjacency].map(([from, targets]) => [from, [...targets].sort()])),
    edges: pairs.size,
  };
}

/** The non-trivial SCCs of the module graph, largest first — the same Tarjan pass, coarser nodes. */
function moduleSccs(graph: Graph): string[][] {
  const { nodes, adjacency } = moduleGraph(graph);
  return strongComponents(nodes, adjacency).filter((component) => component.length >= 2);
}

/** The module ratchet: the pin may only shrink, by lowering both this constant and the JSON. */
function assertModuleSccBudget(measured: readonly string[][], pinned: readonly string[][]): void {
  assert.deepEqual(
    normalize(measured),
    normalize(pinned),
    'the src MODULE cycle budget changed. A module SCC may only shrink: when one is genuinely ' +
      'closed, lower MODULE_SCC_GROUPS here and moduleSccGroups in the committed JSON in the ' +
      'same commit. Never add a module (or move a leaf contract back inside a feature module) ' +
      'to accommodate a red reading.',
  );
}

/** Scan a synthetic tree through the shared scanner, so controls exercise the production reading. */
function scanFixture(files: Record<string, string>): Graph {
  const sources: SourceFile[] = Object.entries(files).map(([filePath, text]) => ({ path: filePath, text }));
  return scanImportGraph(sources, { includeDynamic: false });
}

test('the current src tree carries exactly the pinned directory cycles', () => {
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

// ── The module-level reading (finding `src-module-scc-cockpit-hub`) ─────────────

test('the current src module graph carries exactly the pinned two-module cycle', () => {
  const sources = collectTypeScriptSources(SRC_DIR);
  const graph = scanImportGraph(sources, { includeDynamic: false });
  const { nodes, adjacency, edges } = moduleGraph(graph);

  assert.ok(nodes.length >= MIN_MODULES, `module reading saw ${nodes.length} modules (< ${MIN_MODULES}) — a collapsed scan is not a clean one`);
  assert.ok(
    edges >= MIN_CROSS_MODULE_EDGES,
    `module reading saw ${edges} cross-module import pairs (< ${MIN_CROSS_MODULE_EDGES}) — the module graph is not being read`,
  );
  assert.ok(nodes.includes('modules/cockpit-contract'), 'the cockpit leaf contract must be its own top-level module');

  // The leaf contract's whole point: it has no out-edge into a feature module, so importing it
  // from chat/sidebar/ui-scenario cannot pull anything into a cycle.
  assert.deepEqual(
    adjacency.get('modules/cockpit-contract') ?? [],
    [],
    'the cockpit leaf contract grew an out-edge to a feature module — it is no longer a leaf',
  );

  assertModuleSccBudget(moduleSccs(graph), MODULE_SCC_GROUPS);

  // Two-place pin: the committed JSON and the in-file constant must name the same SCC groups.
  const baseline = JSON.parse(fs.readFileSync(BASELINE_PATH, 'utf8')) as Baseline;
  assert.deepEqual(
    normalize(baseline.moduleSccGroups ?? []),
    normalize(MODULE_SCC_GROUPS),
    'the committed JSON and the in-file module pin must name the same groups, or a wider reading could be blessed by editing one of them',
  );
});

test('positive control: a planted two-module cycle reds the module ratchet', () => {
  const graph = scanFixture({
    'modules/alpha/a.ts': "import '@/modules/beta/b.js';\n",
    'modules/beta/b.ts': "import '../alpha/a.js';\n",
  });

  assert.deepEqual(moduleSccs(graph), [['modules/alpha', 'modules/beta']], 'the module reading must see the planted @/-resolved cycle');
  assert.throws(
    () => assertModuleSccBudget(moduleSccs(graph), MODULE_SCC_GROUPS),
    /MODULE cycle budget changed/,
    'a module cycle outside the pin must red the same assertion the real tree uses',
  );
});

test('control: a shared leaf module imported by two modules closes no cycle', () => {
  const acyclic = scanFixture({
    'modules/alpha/a.ts': "import '@/modules/leaf/index.js';\n",
    'modules/beta/b.ts': "import '@/modules/leaf/index.js';\n",
    'modules/leaf/index.ts': 'export const x = 1;\n',
  });
  assert.deepEqual(moduleSccs(acyclic), [], 'a leaf imported by two modules is a fan-in, not a cycle');

  // The discriminating twin: the same two importers DO red when the "leaf" imports one back.
  const cyclic = scanFixture({
    'modules/alpha/a.ts': "import '@/modules/leaf/index.js';\n",
    'modules/leaf/index.ts': "export { a } from '@/modules/alpha/a.js';\n",
  });
  assert.deepEqual(
    moduleSccs(cyclic),
    [['modules/alpha', 'modules/leaf']],
    'a contract that imports a feature module must join its SCC — otherwise the leaf guard would be vacuous',
  );
});

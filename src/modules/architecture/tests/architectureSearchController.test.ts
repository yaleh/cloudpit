/**
 * `createArchitectureSearchController` — the architecture tab's search, hover
 * and deep-link rules, exercised without React, `window` or a wall clock.
 *
 * What the criterion names:
 * - typing debounces the ranking and the candidates follow the documented
 *   importance order (hop distance, then in-degree), with the fold/filter state
 *   reported per row;
 * - arrow keys move the active option and wrap at both ends;
 * - Enter chooses the active (or first) match, closes the list and clears the
 *   active option; a project-wide row is reported by its own index;
 * - the hover reading appears only after the dwell threshold and disappears
 *   immediately on leaving;
 * - a `?entity=` deep link is applied at most once, and an analysis is re-aligned
 *   at most once (the first apply counts as that analysis's alignment);
 * - `dispose` releases the debounce and dwell timers.
 */
import assert from 'node:assert/strict';

import { describe, it } from 'vitest';

import {
  createArchitectureSearchController,
  HOVER_HINT_DWELL_MS,
  SEARCH_QUERY_DEBOUNCE_MS,
  type ArchitectureSearchController,
  type ArchitectureSearchReading,
} from '@/modules/architecture/architectureSearchController';
import type {
  ArchitectureRendererEdge,
  ArchitectureRendererHover,
  ArchitectureRendererNode,
} from '@/modules/architecture/rendererContract';
import type { Clock } from '@/shared/types';

type Timer = {
  handle: number;
  callback: () => void;
  due: number;
};

/** A deterministic clock: timers fire only when `advance` moves past them. */
function createFakeClock(): {
  clock: Clock;
  advance: (milliseconds: number) => Promise<void>;
  pending: () => number;
} {
  let now = 1_000_000;
  let nextHandle = 1;
  const timers = new Map<number, Timer>();

  const clock: Clock = {
    now: () => now,
    setTimeout: (callback, milliseconds) => {
      const handle = nextHandle;
      nextHandle += 1;
      timers.set(handle, { handle, callback, due: now + milliseconds });
      return handle;
    },
    clearTimeout: (handle) => {
      timers.delete(handle as number);
    },
    setInterval: () => {
      throw new Error('the search controller must not need an interval');
    },
    clearInterval: () => {},
  };

  const flush = async (): Promise<void> => {
    for (let index = 0; index < 8; index += 1) await Promise.resolve();
  };

  const advance = async (milliseconds: number): Promise<void> => {
    const target = now + milliseconds;
    for (;;) {
      let next: Timer | undefined;
      for (const timer of timers.values()) {
        if (timer.due <= target && (next === undefined || timer.due < next.due)) next = timer;
      }
      if (next === undefined) break;
      now = next.due;
      timers.delete(next.handle);
      next.callback();
      await flush();
    }
    now = target;
    await flush();
  };

  return { clock, advance, pending: () => timers.size };
}

const NODES: readonly ArchitectureRendererNode[] = [
  // Every node matches `alpha`; the order below is deliberately NOT payload
  // order, so the ranking assertions can only pass if the importance order ran.
  { id: 'src/zzz.ts.AlphaDeep', label: 'AlphaDeep', distance: 2 },
  { id: 'src/a.ts.AlphaStore', label: 'AlphaStore', distance: 1 },
  { id: 'src/a.ts.Alpha', label: 'Alpha', distance: 0 },
  { id: 'src/b.ts.AlphaHelper', label: 'AlphaHelper', distance: 1 },
];

const EDGES: readonly ArchitectureRendererEdge[] = [
  // AlphaStore has two incoming edges; AlphaHelper one; AlphaDeep none.
  { from: 'src/a.ts.Alpha', to: 'src/a.ts.AlphaStore', relationType: 'dependency' },
  { from: 'src/b.ts.AlphaHelper', to: 'src/a.ts.AlphaStore', relationType: 'call' },
  { from: 'src/a.ts.Alpha', to: 'src/b.ts.AlphaHelper', relationType: 'dependency' },
];

/** The expected order: distance 0 first, then distance 1 by in-degree, then 2. */
const EXPECTED_ORDER = [
  'src/a.ts.Alpha',
  'src/a.ts.AlphaStore',
  'src/b.ts.AlphaHelper',
  'src/zzz.ts.AlphaDeep',
];

function createReading(options: {
  readonly key?: string;
  readonly nodes?: readonly ArchitectureRendererNode[];
  readonly activeNodeIds?: ReadonlySet<string>;
  readonly retainedNodeIds?: ReadonlySet<string> | null;
} = {}): ArchitectureSearchReading {
  const nodes = options.nodes ?? NODES;
  return {
    key: options.key ?? 'session-1:entity:2',
    nodes,
    edges: EDGES,
    activeNodeIds: options.activeNodeIds ?? new Set(nodes.map((node) => node.id)),
    retainedNodeIds: options.retainedNodeIds === undefined
      ? new Set(nodes.map((node) => node.id))
      : options.retainedNodeIds,
  };
}

function createHover(): ArchitectureRendererHover {
  return { node: NODES[2], relations: ['call', 'dependency'] };
}

/** Type a query and let the debounce settle. */
async function typeQuery(
  controller: ArchitectureSearchController,
  advance: (milliseconds: number) => Promise<void>,
  query: string,
): Promise<void> {
  controller.setQuery(query);
  await advance(SEARCH_QUERY_DEBOUNCE_MS);
}

describe('createArchitectureSearchController', () => {
  it('debounces the query, then ranks the matches by importance', async () => {
    const { clock, advance } = createFakeClock();
    const controller = createArchitectureSearchController({ clock });
    controller.setReading(createReading());

    try {
      controller.setQuery('alpha');
      let snapshot = controller.getSnapshot();
      assert.equal(snapshot.pending, true, 'the ranking waits for the debounce');
      assert.equal(snapshot.candidates.length, 0, 'stale rows never stand in for a new query');

      await advance(SEARCH_QUERY_DEBOUNCE_MS - 1);
      assert.equal(controller.getSnapshot().candidates.length, 0, 'not before the deadline');

      await advance(1);
      snapshot = controller.getSnapshot();
      assert.equal(snapshot.pending, false, 'the deadline commits the query');
      assert.deepEqual(
        snapshot.candidates.map((candidate) => candidate.node.id),
        EXPECTED_ORDER,
        'ranking is hop distance, then in-degree, then id',
      );
      assert.equal(snapshot.candidates[0].inGraph, true);
      assert.equal(snapshot.candidates[0].inRange, true);
    } finally {
      controller.dispose();
    }
  });

  it('reports a folded candidate as out of range and a filtered one as not drawn', async () => {
    const { clock, advance } = createFakeClock();
    const retained = new Set(['src/a.ts.Alpha', 'src/a.ts.AlphaStore', 'src/b.ts.AlphaHelper']);
    const active = new Set(['src/a.ts.Alpha', 'src/a.ts.AlphaStore', 'src/b.ts.AlphaHelper']);
    const controller = createArchitectureSearchController({ clock });
    controller.setReading(createReading({ activeNodeIds: active, retainedNodeIds: retained }));

    try {
      await typeQuery(controller, advance, 'alphadeep');
      const [deep] = controller.getSnapshot().candidates;
      assert.equal(deep.node.id, 'src/zzz.ts.AlphaDeep');
      assert.equal(deep.inGraph, false, 'the filter removed it from the drawing');
      assert.equal(deep.inRange, false);
    } finally {
      controller.dispose();
    }
  });

  it('moves the active option with arrow keys and wraps at both ends', async () => {
    const { clock, advance } = createFakeClock();
    const controller = createArchitectureSearchController({ clock });
    controller.setReading(createReading());

    try {
      await typeQuery(controller, advance, 'alpha');
      const optionCount = 6; // four in-graph matches + two project hits
      controller.moveActive(1, optionCount);
      assert.equal(controller.getSnapshot().activeIndex, 0, 'the first ArrowDown lands on the first option');
      for (let index = 0; index < optionCount; index += 1) controller.moveActive(1, optionCount);
      assert.equal(controller.getSnapshot().activeIndex, 0, 'ArrowDown wraps from the last option');
      controller.moveActive(-1, optionCount);
      assert.equal(controller.getSnapshot().activeIndex, optionCount - 1, 'ArrowUp from -1 wraps to the last option');
      controller.moveActive(0, 0);
      assert.equal(
        controller.getSnapshot().activeIndex,
        optionCount - 1,
        'an empty option list is a no-op, not a reset',
      );
    } finally {
      controller.dispose();
    }
  });

  it('commits the active match, closes the list and clears the active option', async () => {
    const { clock, advance } = createFakeClock();
    const controller = createArchitectureSearchController({ clock });
    controller.setReading(createReading());

    try {
      await typeQuery(controller, advance, 'alpha');
      controller.moveActive(1, 6);
      const chosen = controller.commit({ optionCount: 6 });
      assert.equal(chosen?.kind, 'candidate');
      if (chosen?.kind !== 'candidate') throw new Error('expected a candidate commit');
      assert.equal(chosen.candidate.node.id, 'src/a.ts.Alpha');
      assert.equal(chosen.drill, false);
      const snapshot = controller.getSnapshot();
      assert.equal(snapshot.open, false, 'choosing closes the list');
      assert.equal(snapshot.activeIndex, -1, 'the transient focus is cleared');
      assert.equal(snapshot.query, 'alpha', 'the typed text survives the choice');

      // Enter with no active option keeps picking the first in-graph match.
      controller.setQuery('alpha');
      await advance(SEARCH_QUERY_DEBOUNCE_MS);
      const first = controller.commit({ optionCount: 6 });
      assert.equal(first?.kind, 'candidate');
      if (first?.kind !== 'candidate') throw new Error('expected the first match');
      assert.equal(first.candidate.node.id, EXPECTED_ORDER[0]);

      // A row from the project group is reported by its own index.
      controller.setQuery('alpha');
      await advance(SEARCH_QUERY_DEBOUNCE_MS);
      for (let index = 0; index < 6; index += 1) controller.moveActive(1, 6);
      const project = controller.commit({ optionCount: 6 });
      assert.deepEqual(project, { kind: 'project', projectIndex: 1 });

      // Nothing to choose is not a choice.
      controller.setQuery('');
      await advance(SEARCH_QUERY_DEBOUNCE_MS);
      assert.equal(controller.commit({ optionCount: 0 }), null);
    } finally {
      controller.dispose();
    }
  });

  it('shows the hover reading only after the dwell threshold and hides it immediately on leave', async () => {
    const { clock, advance, pending } = createFakeClock();
    const controller = createArchitectureSearchController({ clock });
    controller.setReading(createReading());

    try {
      const hover = createHover();
      controller.setHover('session-1:entity:2', hover);
      assert.equal(controller.getSnapshot().hover?.node.id, NODES[2].id, 'the reading is known immediately');
      assert.equal(controller.getSnapshot().hoverVisible, false, 'but it is not painted before the dwell');
      assert.equal(pending(), 1, 'the dwell timer is armed');

      await advance(HOVER_HINT_DWELL_MS - 1);
      assert.equal(controller.getSnapshot().hoverVisible, false, 'a pointer crossing a node never flashes');

      await advance(1);
      assert.equal(controller.getSnapshot().hoverVisible, true, 'resting on the node paints the hint');

      // The renderer re-reports the same node on every pointer move; that must
      // not restart (and so indefinitely postpone) the dwell.
      controller.setHover('session-1:entity:2', createHover());
      assert.equal(controller.getSnapshot().hoverVisible, true, 'a repeated report keeps the hint');
      assert.equal(pending(), 0, 'and does not arm another timer');

      controller.setHover('session-1:entity:2', null);
      assert.equal(controller.getSnapshot().hover, null);
      assert.equal(controller.getSnapshot().hoverVisible, false, 'leaving hides it without waiting');
      assert.equal(pending(), 0);
    } finally {
      controller.dispose();
    }
  });

  it('discards a hover reported for a different graph', () => {
    const { clock } = createFakeClock();
    const controller = createArchitectureSearchController({ clock });
    controller.setReading(createReading({ key: 'session-1:entity:2' }));

    try {
      controller.setHover('session-2:file:1', createHover());
      assert.equal(controller.getSnapshot().hover, null, 'a reading from another graph is not shown against this one');

      // A reading switch drops a hover that was already shown.
      controller.setHover('session-1:entity:2', createHover());
      controller.setReading(createReading({ key: 'session-1:file:2' }));
      assert.equal(controller.getSnapshot().hover, null);
      assert.equal(controller.getSnapshot().hoverVisible, false);
    } finally {
      controller.dispose();
    }
  });

  it('applies the deep-link entity once, only once it is drawn', () => {
    const { clock } = createFakeClock();
    const controller = createArchitectureSearchController({ clock });

    try {
      const input = {
        entity: 'src/a.ts.Alpha',
        mode: 'neighbourhood' as const,
        analysisKey: 'analysis-1',
        nodeIds: ['src/a.ts.Alpha'],
        retainedNodeIds: null,
      };
      assert.equal(
        controller.applyDeepLink({ ...input, loaded: false }),
        null,
        'an entity is not applied before its reading arrives',
      );
      const first = controller.applyDeepLink({ ...input, loaded: true });
      assert.deepEqual(first, {
        nodeId: 'src/a.ts.Alpha',
        outOfRange: false,
        drill: true,
      });
      assert.equal(
        controller.applyDeepLink({ ...input, loaded: true }),
        null,
        'the URL is a first-open instruction, not a permanent leash',
      );
    } finally {
      controller.dispose();
    }
  });

  it('ignores a deep-link entity the graph does not carry until a reading does', () => {
    const { clock } = createFakeClock();
    const controller = createArchitectureSearchController({ clock });

    try {
      const base = {
        entity: 'src/a.ts.Alpha',
        mode: null,
        loaded: true,
        analysisKey: 'analysis-1',
        retainedNodeIds: null,
      };
      assert.equal(controller.applyDeepLink({ ...base, nodeIds: ['src/other.ts.Other'] }), null);
      assert.notEqual(
        controller.applyDeepLink({ ...base, nodeIds: ['src/a.ts.Alpha'] }),
        null,
        'a later reading that carries the entity may still apply the link',
      );
    } finally {
      controller.dispose();
    }
  });

  it('re-aligns the deep-linked entity once per analysis, never twice', () => {
    const { clock } = createFakeClock();
    const controller = createArchitectureSearchController({ clock });
    const nodeIds = ['src/a.ts.Alpha'];

    try {
      const applied = controller.applyDeepLink({
        entity: 'src/a.ts.Alpha',
        mode: null,
        loaded: true,
        analysisKey: 'analysis-1',
        nodeIds,
        retainedNodeIds: null,
      });
      assert.notEqual(applied, null);

      assert.equal(
        controller.reconcileAnalysis({ analysisKey: 'analysis-1', nodeIds, retainedNodeIds: null }),
        null,
        'the first apply already aligned this analysis',
      );

      const realigned = controller.reconcileAnalysis({
        analysisKey: 'analysis-2',
        nodeIds,
        retainedNodeIds: null,
      });
      assert.deepEqual(realigned, { nodeId: 'src/a.ts.Alpha', outOfRange: false, drill: false });

      assert.equal(
        controller.reconcileAnalysis({ analysisKey: 'analysis-2', nodeIds, retainedNodeIds: null }),
        null,
        'the same analysis is aligned only once',
      );

      // A manual refresh forgets the reconciled analysis so the next reading aligns.
      controller.resetReconcile();
      assert.notEqual(
        controller.reconcileAnalysis({ analysisKey: 'analysis-2', nodeIds, retainedNodeIds: null }),
        null,
      );
    } finally {
      controller.dispose();
    }
  });

  it('makes a folded deep-linked entity out of range', () => {
    const { clock } = createFakeClock();
    const controller = createArchitectureSearchController({ clock });

    try {
      const applied = controller.applyDeepLink({
        entity: 'src/a.ts.Alpha',
        mode: null,
        loaded: true,
        analysisKey: 'analysis-1',
        nodeIds: ['src/a.ts.Alpha'],
        retainedNodeIds: new Set(['src/other.ts.Other']),
      });
      assert.deepEqual(applied, { nodeId: 'src/a.ts.Alpha', outOfRange: true, drill: false });
    } finally {
      controller.dispose();
    }
  });

  it('dispose releases the debounce and dwell timers', async () => {
    const { clock, advance, pending } = createFakeClock();
    const controller = createArchitectureSearchController({ clock });
    controller.setReading(createReading());
    controller.setQuery('alpha');
    controller.setHover('session-1:entity:2', createHover());
    assert.equal(pending(), 2, 'both timers are armed');

    controller.dispose();
    assert.equal(pending(), 0, 'dispose clears both timers');

    await advance(SEARCH_QUERY_DEBOUNCE_MS + HOVER_HINT_DWELL_MS);
    const snapshot = controller.getSnapshot();
    assert.equal(snapshot.candidates.length, 0, 'the cancelled debounce never ranks');
    assert.equal(snapshot.hoverVisible, false, 'the cancelled dwell never paints');
  });
});

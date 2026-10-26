import assert from 'node:assert/strict';

import { afterEach, describe, it, vi } from 'vitest';

import {
  NOTICES_POLL_INTERVAL_MS,
  createNoticesController,
} from '@/modules/notices/noticesController';
import type {
  Notice,
  NoticeDismissPort,
  NoticeListPort,
  NoticesClock,
} from '@/modules/notices/noticesController';

/**
 * The notices controller, one leg per rule the task names — with no React render, no network and
 * no wall clock. The list port, the dismissal port and the scheduler are all injected, so every
 * assertion below is about the controller's own decisions: when it reads, what a failure does
 * before and after a good reading, how a 409 dismissal re-reads, and what `dispose` ends.
 */

const REVISION = 'a'.repeat(40);

function notice(overrides: Partial<Notice> = {}): Notice {
  return {
    id: 'deploy:pending-build',
    source: 'deploy',
    lifecycle: 'condition',
    severity: 'attention',
    revision: REVISION,
    scope: 'global',
    title: 'notices.deploy.pendingBuild.title',
    params: { count: 1 },
    raisedAt: '2026-10-24T12:00:00.000Z',
    ...overrides,
  };
}

function okResponse(): Response {
  return { ok: true, status: 200 } as unknown as Response;
}

function conflictResponse(): Response {
  return { ok: false, status: 409 } as unknown as Response;
}

type FakeClock = {
  clock: NoticesClock;
  /** Runs every interval callback currently registered, as one period elapsing would. */
  fire: () => void;
  /** The periods of the registered timers, in creation order. */
  periods: () => number[];
  pending: () => number;
};

/** A scheduler the test drives by hand: no 15 s wait in the suite. */
function makeClock(): FakeClock {
  let nextId = 1;
  const timers = new Map<number, { callback: () => void; period: number }>();
  const clock: NoticesClock = {
    setInterval: (callback, milliseconds) => {
      const id = nextId;
      nextId += 1;
      timers.set(id, { callback, period: milliseconds });
      return id;
    },
    clearInterval: (handle) => {
      timers.delete(handle as number);
    },
  };
  return {
    clock,
    fire: () => {
      for (const { callback } of [...timers.values()]) callback();
    },
    periods: () => [...timers.values()].map(({ period }) => period),
    pending: () => timers.size,
  };
}

/** Lets every pending microtask chain (read -> publish) settle. */
async function flush(): Promise<void> {
  for (let turn = 0; turn < 10; turn += 1) {
    await Promise.resolve();
  }
}

type Deferred<T> = {
  promise: Promise<T>;
  resolve: (value: T) => void;
};

function deferred<T>(): Deferred<T> {
  let resolve!: (value: T) => void;
  const promise = new Promise<T>((res) => {
    resolve = res;
  });
  return { promise, resolve };
}

type Harness = {
  controller: ReturnType<typeof createNoticesController>;
  listCalls: () => number;
  setList: (impl: NoticeListPort) => void;
  dismissCalls: () => Array<{ id: string; revision: string }>;
  setDismiss: (impl: NoticeDismissPort) => void;
  clock: FakeClock;
};

function createHarness(options: {
  list?: NoticeListPort;
  dismiss?: NoticeDismissPort;
} = {}): Harness {
  let listCount = 0;
  let listImpl: NoticeListPort =
    options.list ?? (async () => ({ active: [notice()], dismissed: [] }));
  const dismissRequests: Array<{ id: string; revision: string }> = [];
  let dismissImpl: NoticeDismissPort = options.dismiss ?? (async () => okResponse());
  const clock = makeClock();

  const controller = createNoticesController({
    list: async () => {
      listCount += 1;
      return listImpl();
    },
    dismiss: async (id, revision) => {
      dismissRequests.push({ id, revision });
      return dismissImpl(id, revision);
    },
    clock: clock.clock,
  });

  return {
    controller,
    listCalls: () => listCount,
    setList: (impl) => {
      listImpl = impl;
    },
    dismissCalls: () => dismissRequests,
    setDismiss: (impl) => {
      dismissImpl = impl;
    },
    clock,
  };
}

afterEach(() => {
  vi.restoreAllMocks();
});

describe('noticesController polling', () => {
  it('(a) reads once immediately and then once per poll period', async () => {
    const harness = createHarness();
    await flush();

    assert.equal(harness.listCalls(), 1, 'the first reading happens at creation');
    assert.deepEqual(
      harness.clock.periods(),
      [NOTICES_POLL_INTERVAL_MS],
      'the poll period is unchanged at 15 s',
    );

    harness.clock.fire();
    await flush();
    assert.equal(harness.listCalls(), 2);

    harness.clock.fire();
    await flush();
    assert.equal(harness.listCalls(), 3);

    const reading = harness.controller.getSnapshot();
    assert.equal(reading.status, 'ready');
    assert.deepEqual(
      reading.status === 'ready' ? reading.active.map((entry) => entry.id) : [],
      ['deploy:pending-build'],
    );
  });

  it('(b) reports the first failure as unavailable, then keeps the last good reading', async () => {
    const errorLog = vi.spyOn(console, 'error').mockImplementation(() => {});
    const harness = createHarness({
      list: async () => {
        throw new Error('gateway down');
      },
    });
    await flush();

    const first = harness.controller.getSnapshot();
    assert.equal(first.status, 'unavailable');
    assert.equal(first.status === 'unavailable' ? first.reason : '', 'gateway down');

    // A good reading lands: the surface becomes usable.
    harness.setList(async () => ({ active: [notice({ id: 'notice:good' })], dismissed: [] }));
    harness.clock.fire();
    await flush();
    const good = harness.controller.getSnapshot();
    assert.equal(good.status, 'ready');
    assert.deepEqual(
      good.status === 'ready' ? good.active.map((entry) => entry.id) : [],
      ['notice:good'],
    );

    // The next poll fails: the good reading survives, untouched.
    harness.setList(async () => {
      throw new Error('second failure');
    });
    harness.clock.fire();
    await flush();
    assert.equal(
      harness.controller.getSnapshot(),
      good,
      'a later failure keeps the same good reading rather than erasing the notice',
    );
    assert.ok(errorLog.mock.calls.length > 0, 'the failure is logged instead of published');
  });
});

describe('noticesController dismissal', () => {
  it('(c) re-reads silently when the dismissal answers 409', async () => {
    const errorLog = vi.spyOn(console, 'error').mockImplementation(() => {});
    const harness = createHarness();
    await flush();
    assert.equal(harness.listCalls(), 1);

    harness.setDismiss(async () => conflictResponse());
    await harness.controller.dismiss(notice());
    await flush();

    assert.deepEqual(
      harness.dismissCalls(),
      [{ id: 'deploy:pending-build', revision: REVISION }],
      'the dismissal names the revision the reading carried',
    );
    assert.equal(harness.listCalls(), 2, 'a 409 re-reads the list');
    assert.equal(harness.controller.getSnapshot().status, 'ready');
    assert.equal(errorLog.mock.calls.length, 0, 'a 409 is not reported as an error');
  });

  it('(d) re-reads after a successful dismissal', async () => {
    const harness = createHarness();
    await flush();
    assert.equal(harness.listCalls(), 1);

    await harness.controller.dismiss(notice());
    await flush();

    assert.equal(harness.listCalls(), 2);
  });

  it('(e) leaves the reading in place when the dismissal itself fails', async () => {
    const errorLog = vi.spyOn(console, 'error').mockImplementation(() => {});
    const harness = createHarness({
      dismiss: async () => {
        throw new Error('network down');
      },
    });
    await flush();
    const before = harness.controller.getSnapshot();

    await harness.controller.dismiss(notice());
    await flush();

    assert.equal(harness.listCalls(), 1, 'a dismissal that did not land does not re-read');
    assert.equal(harness.controller.getSnapshot(), before);
    assert.ok(errorLog.mock.calls.length > 0);
  });
});

describe('noticesController disposal', () => {
  it('(f) clears the poll timer and drops a reading that lands afterwards', async () => {
    const harness = createHarness();
    await flush();
    assert.equal(harness.clock.pending(), 1);

    let notifications = 0;
    harness.controller.subscribe(() => {
      notifications += 1;
    });
    const lastReading = harness.controller.getSnapshot();

    harness.controller.dispose();
    assert.equal(harness.clock.pending(), 0, 'the timer was cleared');
    harness.clock.fire();
    await flush();
    assert.equal(harness.listCalls(), 1, 'a cleared timer never polls');

    const reading = deferred<{ active: Notice[]; dismissed: Notice[] }>();
    harness.setList(() => reading.promise);
    void harness.controller.refresh();
    reading.resolve({ active: [notice({ id: 'late' })], dismissed: [] });
    await flush();

    assert.equal(notifications, 0, 'a disposed controller does not notify');
    assert.equal(
      harness.controller.getSnapshot(),
      lastReading,
      'the last published reading stays readable',
    );
  });
});

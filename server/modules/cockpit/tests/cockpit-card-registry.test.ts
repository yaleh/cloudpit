/**
 * AC-421 / AC-422's server-side criterion: the cockpit card contract's registry,
 * action channel and HTTP face.
 *
 * The cases map one-to-one onto the task's acceptance criteria:
 *
 *   · the projection returns OPEN cards in provider `group`/`rank` order, and
 *     `resolved` / `expired` cards never appear (the `waitingSince` values are
 *     deliberately the reverse of that order, so a clock-based re-sort reds);
 *   · registering a second provider — one class plus one `register` line — makes
 *     its cards appear;
 *   · confirming an option calls the DECLARED executor exactly once with the
 *     option's declared params verbatim, and a duplicate of the same confirmation
 *     is refused without a second call;
 *   · an executor id no provider declared is refused with a clear code;
 *   · a stale revision is a conflict and calls the executor zero times;
 *   · the `cockpit.fixtureCards` switch decides whether the HTTP route answers an
 *     empty list or the six fixture cards (both values in this file), and a
 *     stale re-send after a fixture confirmation is a 409 that does not execute.
 *
 * Run directly:
 *   npx tsx --tsconfig server/tsconfig.json --test \
 *     server/modules/cockpit/tests/cockpit-card-registry.test.ts
 */
import assert from 'node:assert/strict';
import { once } from 'node:events';
import type { AddressInfo } from 'node:net';
import test from 'node:test';

import express, {
  type Express,
  type NextFunction,
  type Request,
  type Response,
  type Router,
} from 'express';

import { createCockpitCardActions } from '@/modules/cockpit/cockpit-card-actions.js';
import { createCockpitCardRegistry } from '@/modules/cockpit/cockpit-card-registry.js';
import { createCockpitCardsModule } from '@/modules/cockpit/cockpit.module.js';
import type { ICockpitActionExecutor, ICockpitCardProvider } from '@/shared/interfaces.js';
import type { CockpitCard, CockpitCardOption } from '@/shared/types.js';
import { AppError } from '@/shared/utils.js';

/** A provider whose cards never change: the smallest implementation of the capability. */
class StaticCardProvider implements ICockpitCardProvider {
  readonly id: string;
  private readonly cards: readonly CockpitCard[];
  private readonly executors: readonly string[];

  constructor(id: string, cards: readonly CockpitCard[], executors: readonly string[] = []) {
    this.id = id;
    this.cards = cards;
    this.executors = executors;
  }

  listCards(): CockpitCard[] {
    return this.cards.map((card) => structuredClone(card));
  }

  declaredExecutors(): readonly string[] {
    return this.executors;
  }
}

/** One valid card, with every field a caller does not care about filled in. */
function makeCard(overrides: Partial<CockpitCard> & Pick<CockpitCard, 'id'>): CockpitCard {
  return {
    provider: 'test',
    revision: 1,
    kind: 'ask',
    group: 'ruling',
    rank: 1,
    state: 'open',
    waitingSince: '2026-10-27T00:00:00.000Z',
    surfacedAt: '2026-10-27T00:00:01.000Z',
    subject: { uri: `cloudcli://test/${overrides.id}` },
    facts: [],
    options: [],
    ...overrides,
  };
}

/** One option that names `executorId`; params are the caller's exact declared object. */
function makeOption(input: {
  id: string;
  executorId: string;
  params: Record<string, unknown>;
  suggested?: boolean;
  source?: CockpitCardOption['source'];
}): CockpitCardOption {
  return {
    id: input.id,
    label: input.id,
    does: `${input.id} does the thing`,
    suggested: input.suggested ?? false,
    source: input.source ?? 'provider',
    action: { executor: input.executorId, params: input.params },
  };
}

/** An executor that records the params it was handed, in order. */
function recordExecutor(id: string, calls: Array<Record<string, unknown>>): ICockpitActionExecutor {
  return {
    id,
    execute: (params) => {
      calls.push(params);
      return { ok: true };
    },
  };
}

/** True when `failure` is an `AppError` carrying `code`. */
function isAppError(code: string): (failure: unknown) => boolean {
  return (failure) => failure instanceof AppError && failure.code === code;
}

// ---------------------------------------------------------------------------
// Projection
// ---------------------------------------------------------------------------

test('the projection never drops or hides an open card locally', async () => {
  const registry = createCockpitCardRegistry([
    new StaticCardProvider('one', [
      makeCard({ id: 'alpha', kind: 'ask', group: 'rescue', rank: 1 }),
      // A second kind: a cockpit-local "hide this kind" rule would drop it.
      makeCard({ id: 'beta', kind: 'decision', group: 'ruling', rank: 1 }),
      makeCard({ id: 'resolved', state: 'resolved', group: 'rescue', rank: 0 }),
      makeCard({ id: 'expired', state: 'expired', group: 'rescue', rank: 0 }),
    ]),
  ]);

  const cards = await registry.listCards();
  assert.deepEqual(
    cards.map((card) => card.id),
    ['alpha', 'beta'],
    'every open card must be visible — no cockpit-local rule may hide one by kind',
  );
  assert.ok(cards.every((card) => card.state === 'open'), 'resolved/expired cards must not be projected');
  assert.equal(cards[0]?.revision, 1, 'the revision must pass through unchanged');
});

test('the projection orders open cards by provider group then rank, not the clock', async () => {
  const registry = createCockpitCardRegistry([
    new StaticCardProvider('one', [
      // waitingSince runs in the REVERSE of the expected order: a re-sort by the
      // clock instead of by group/rank would answer `late, mid, early`.
      makeCard({ id: 'late', group: 'ruling', rank: 2, waitingSince: '2026-10-27T00:00:00.000Z' }),
      makeCard({ id: 'early', group: 'rescue', rank: 1, waitingSince: '2026-10-27T00:09:00.000Z' }),
      makeCard({ id: 'mid', group: 'rescue', rank: 2, waitingSince: '2026-10-27T00:05:00.000Z' }),
    ]),
  ]);

  const cards = await registry.listCards();
  assert.deepEqual(
    cards.map((card) => card.id),
    ['early', 'mid', 'late'],
    'open cards must follow the provider group then rank — not the clock',
  );
});

test('a second provider is one class plus one register; its cards appear', async () => {
  const registry = createCockpitCardRegistry([
    new StaticCardProvider('one', [makeCard({ id: 'first', group: 'rescue', rank: 1 })]),
  ]);
  assert.deepEqual((await registry.listCards()).map((card) => card.id), ['first']);

  registry.register(
    new StaticCardProvider('two', [makeCard({ id: 'second', group: 'ruling', rank: 1 })], ['second.run']),
  );

  assert.deepEqual(
    (await registry.listCards()).map((card) => card.id),
    ['first', 'second'],
    'cards from a later-registered provider must be projected too',
  );
  assert.ok(registry.declaredExecutors().has('second.run'), 'the declared set is the union of the providers');
});

// ---------------------------------------------------------------------------
// Action channel
// ---------------------------------------------------------------------------

test('confirming an option calls the declared executor once with the declared params', async () => {
  const calls: Array<Record<string, unknown>> = [];
  const card = makeCard({
    id: 'confirm-once',
    options: [
      makeOption({
        id: 'accept',
        executorId: 'test.run',
        params: { answer: 'yes', count: 3 },
        suggested: true,
        source: 'assistant',
      }),
    ],
  });
  const registry = createCockpitCardRegistry([
    new StaticCardProvider('test', [card], ['test.run']),
  ]);
  const actions = createCockpitCardActions({ registry, executors: [recordExecutor('test.run', calls)] });

  const result = await actions.confirm({ cardId: 'confirm-once', optionId: 'accept', revision: 1 });

  assert.equal(calls.length, 1, 'one confirmation must call the executor exactly once');
  assert.deepEqual(calls[0], { answer: 'yes', count: 3 }, 'the executor receives the declared params verbatim');
  assert.equal(result.ok, true);
  assert.equal(result.executor, 'test.run');

  await assert.rejects(
    actions.confirm({ cardId: 'confirm-once', optionId: 'accept', revision: 1 }),
    isAppError('ALREADY_CONFIRMED'),
    'a duplicate confirmation must be refused',
  );
  assert.equal(calls.length, 1, 'the duplicate must not execute a second time');
});

test('an undeclared executor id is refused and never reached', async () => {
  const calls: Array<Record<string, unknown>> = [];
  const card = makeCard({
    id: 'undeclared',
    options: [makeOption({ id: 'go', executorId: 'ghost.run', params: { reason: 'nope' } })],
  });
  const registry = createCockpitCardRegistry([new StaticCardProvider('test', [card], [])]);
  const actions = createCockpitCardActions({ registry, executors: [recordExecutor('ghost.run', calls)] });

  await assert.rejects(
    actions.confirm({ cardId: 'undeclared', optionId: 'go', revision: 1 }),
    (failure) => {
      assert.ok(failure instanceof AppError, `unexpected failure: ${String(failure)}`);
      assert.equal(failure.code, 'EXECUTOR_NOT_DECLARED');
      assert.match(failure.message, /ghost\.run/, 'the error must name the undeclared executor');
      return true;
    },
  );
  assert.equal(calls.length, 0, 'an undeclared executor must never be called');
});

test('a stale revision is a conflict and the executor is called zero times', async () => {
  const calls: Array<Record<string, unknown>> = [];
  const card = makeCard({
    id: 'stale',
    revision: 4,
    options: [makeOption({ id: 'go', executorId: 'test.run', params: {} })],
  });
  const registry = createCockpitCardRegistry([
    new StaticCardProvider('test', [card], ['test.run']),
  ]);
  const actions = createCockpitCardActions({ registry, executors: [recordExecutor('test.run', calls)] });

  await assert.rejects(
    actions.confirm({ cardId: 'stale', optionId: 'go', revision: 3 }),
    isAppError('REVISION_CONFLICT'),
    'an old revision must be reported as a conflict',
  );
  assert.equal(calls.length, 0, 'a stale confirmation must not execute');
});

// ---------------------------------------------------------------------------
// HTTP face and the fixture switch
// ---------------------------------------------------------------------------

/** The process error middleware, reduced to what this module's `AppError`s need. */
function errorHandler(error: unknown, _req: Request, res: Response, _next: NextFunction): void {
  const status = error instanceof AppError ? error.statusCode : 500;
  const code = error instanceof AppError ? error.code : 'INTERNAL_ERROR';
  res.status(status).json({
    success: false,
    error: { code, message: error instanceof Error ? error.message : 'error' },
  });
}

function createApp(router: Router): Express {
  const app = express();
  app.use(express.json());
  app.use('/api/cockpit/cards', router);
  app.use(errorHandler);
  return app;
}

async function listen(app: Express): Promise<{ baseUrl: string; stop: () => Promise<void> }> {
  const server = app.listen(0, '127.0.0.1');
  await once(server, 'listening');
  const address = server.address() as AddressInfo;
  return {
    baseUrl: `http://127.0.0.1:${address.port}/api/cockpit/cards`,
    stop: async () => {
      server.close();
      await once(server, 'close');
    },
  };
}

const EXPECTED_FIXTURE_ORDER = [
  'fixture:need',
  'fixture:stuck',
  'fixture:fix',
  'fixture:ask',
  'fixture:multi',
  'fixture:decision',
];

test('the cockpit.fixtureCards switch decides whether fixtures are served', async () => {
  // (a) shipped default: off → the route honestly answers an empty list.
  const off = await listen(createApp(createCockpitCardsModule({ fixtureCards: false }).router));
  try {
    const response = await fetch(off.baseUrl);
    assert.equal(response.status, 200);
    assert.deepEqual(await response.json(), { cards: [] }, 'with the switch off the registry is empty');
  } finally {
    await off.stop();
  }

  // (b) on → six fixture cards in group/rank order, covering every known kind,
  // with at least one recommendation and at least one card that has none.
  const onModule = createCockpitCardsModule({ fixtureCards: true });
  const on = await listen(createApp(onModule.router));
  try {
    const response = await fetch(on.baseUrl);
    assert.equal(response.status, 200);
    const body = (await response.json()) as { cards: CockpitCard[] };

    assert.deepEqual(
      body.cards.map((card) => card.id),
      EXPECTED_FIXTURE_ORDER,
      'fixture order must equal the fixture group/rank order',
    );
    const kinds = new Set(body.cards.map((card) => card.kind));
    for (const kind of ['ask', 'multi', 'need', 'stuck', 'fix', 'decision']) {
      assert.ok(kinds.has(kind), `the fixture must cover kind ${kind}`);
    }
    assert.ok(
      body.cards.some((card) => card.options.some((option) => option.suggested)),
      'the fixture must include a card with a recommendation',
    );
    assert.ok(
      body.cards.some((card) => card.options.length > 0 && card.options.every((option) => !option.suggested)),
      'the fixture must include a card with no recommendation',
    );

    // (c) confirm a recommended option, then re-send the now-stale revision.
    const ask = body.cards.find((card) => card.id === 'fixture:ask');
    assert.ok(ask, 'the fixture ask card must be present');
    const request = { cardId: 'fixture:ask', optionId: 'delete', revision: ask.revision };

    const confirmed = await fetch(`${on.baseUrl}/confirm`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify(request),
    });
    assert.equal(confirmed.status, 200);
    const confirmedBody = (await confirmed.json()) as {
      ok: boolean;
      executor: string;
      params: Record<string, unknown>;
      result: { recorded: { cardId: string; optionId: string | null }; total: number };
    };
    assert.equal(confirmedBody.ok, true);
    assert.equal(confirmedBody.executor, 'fixture.record');
    assert.deepEqual(confirmedBody.params, { cardId: 'fixture:ask', optionId: 'delete' });
    assert.equal(confirmedBody.result.recorded.cardId, 'fixture:ask');
    assert.equal(confirmedBody.result.recorded.optionId, 'delete');
    assert.equal(confirmedBody.result.total, 1, 'the fixture log holds exactly the one confirmation');

    const stale = await fetch(`${on.baseUrl}/confirm`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify(request),
    });
    assert.equal(stale.status, 409, 'an old revision must be a conflict');
    const staleBody = (await stale.json()) as { error: { code: string } };
    assert.equal(staleBody.error.code, 'REVISION_CONFLICT');
  } finally {
    await on.stop();
  }
});

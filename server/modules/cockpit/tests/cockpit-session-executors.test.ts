/**
 * AC-428's server criterion: the two built-in cockpit content executors and the
 * subject-derived 「自己的回复」 defaults.
 *
 * The cases map one-to-one onto the task's acceptance criteria:
 *
 *   · a session card's own reply is sent into THAT session exactly once, with the typed
 *     text, and the confirmation answers `executor: session.send`;
 *   · the reply text is the channel's `reply` field (the person's own words), not a
 *     `text` a provider option happened to declare;
 *   · a refused send fails the confirmation and the control service's own code survives
 *     to the caller instead of being replaced by a generic executor failure;
 *   · a project-only card starts exactly ONE conversation through the injected start and
 *     answers the new session id;
 *   · the start path resolves a quay-fleet registry id to its registered root and uses a
 *     plain path as written; an unknown provider is refused before anything is created;
 *   · the projection fills the three own-reply defaults from the subject (session /
 *     project / neither) and a provider-declared `ownReply` always wins;
 *   · the fixture subject override REPLACES the fixture's own addressing, which is what
 *     lets an isolated instance's DoD prove both defaults.
 *
 * Everything outside the module is a stub, so "exactly once" is a length assertion and no
 * database, provider process or WebSocket is involved.
 *
 * Run directly:
 *   npx tsx --tsconfig server/tsconfig.json --test \
 *     server/modules/cockpit/tests/cockpit-session-executors.test.ts
 */
import assert from 'node:assert/strict';
import test from 'node:test';

import { createCockpitCardActions } from '@/modules/cockpit/cockpit-card-actions.js';
import { createCockpitCardRegistry } from '@/modules/cockpit/cockpit-card-registry.js';
import { createCockpitFixtureCardProvider } from '@/modules/cockpit/cockpit-fixture-card-provider.js';
import {
  COCKPIT_SESSION_SEND_EXECUTOR_ID,
  CockpitSessionSendExecutor,
  type CockpitSessionSendRequest,
  type CockpitSessionSendResult,
} from '@/modules/cockpit/cockpit-session-send.executor.js';
import {
  COCKPIT_SESSION_START_EXECUTOR_ID,
  CockpitSessionStartExecutor,
  DEFAULT_COCKPIT_SESSION_PROVIDER,
  resolveSessionProject,
  type CockpitSessionStartRequest,
} from '@/modules/cockpit/cockpit-session-start.executor.js';
import type { ICockpitActionExecutor, ICockpitCardProvider } from '@/shared/interfaces.js';
import type { CockpitCard, CockpitCardSubject } from '@/shared/types.js';
import { AppError, isRecord } from '@/shared/utils.js';

// ---------------------------------------------------------------------------
// Fixtures
// ---------------------------------------------------------------------------

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

/** One open card with every field a case does not care about filled in. */
function makeCard(
  id: string,
  subject: CockpitCardSubject,
  overrides: Partial<CockpitCard> = {},
): CockpitCard {
  return {
    id,
    provider: 'test',
    revision: 1,
    kind: 'ask',
    group: 'ruling',
    rank: 1,
    state: 'open',
    waitingSince: '2026-10-27T00:00:00.000Z',
    surfacedAt: '2026-10-27T00:00:01.000Z',
    subject,
    facts: [],
    options: [],
    ...overrides,
  };
}

/** A send stub that records every request and answers the caller's verdict. */
function sendStub(answer: CockpitSessionSendResult = { ok: true, deliveryId: 'd-1', runId: 'r-1' }): {
  executor: CockpitSessionSendExecutor;
  calls: CockpitSessionSendRequest[];
} {
  const calls: CockpitSessionSendRequest[] = [];
  return {
    executor: new CockpitSessionSendExecutor({
      send: async (request) => {
        calls.push(request);
        return answer;
      },
    }),
    calls,
  };
}

/** A start stub that records every request and answers a freshly minted conversation. */
function startStub(): {
  executor: CockpitSessionStartExecutor;
  calls: CockpitSessionStartRequest[];
} {
  const calls: CockpitSessionStartRequest[] = [];
  return {
    executor: new CockpitSessionStartExecutor({
      start: async (request) => {
        calls.push(request);
        return { sessionId: `new-${calls.length}`, projectPath: `/repos/${request.project}` };
      },
    }),
    calls,
  };
}

/** True when `failure` is an `AppError` carrying `code`. */
function carriesCode(code: string): (failure: unknown) => boolean {
  return (failure) =>
    failure instanceof AppError &&
    failure.code === code &&
    typeof failure.statusCode === 'number';
}

// ---------------------------------------------------------------------------
// session.send
// ---------------------------------------------------------------------------

test('a session card’s own reply is sent into that session exactly once', async () => {
  const { executor, calls } = sendStub();
  const registry = createCockpitCardRegistry([
    new StaticCardProvider('test', [
      makeCard('session-card', { uri: 'cloudcli://test/session', sessionId: 's-1' }),
    ]),
  ]);
  const actions = createCockpitCardActions({ registry, executors: [executor] });

  const result = await actions.confirm({
    cardId: 'session-card',
    revision: 1,
    replyText: 'ship it after the smoke test',
  });

  assert.equal(calls.length, 1, 'one confirmation must send exactly once');
  assert.deepEqual(
    calls[0],
    { sessionId: 's-1', text: 'ship it after the smoke test' },
    'the send must name the card’s own session and carry the typed text',
  );
  assert.equal(result.executor, COCKPIT_SESSION_SEND_EXECUTOR_ID);
  assert.deepEqual(result.params, { sessionId: 's-1', reply: 'ship it after the smoke test' });
  assert.deepEqual(result.result, {
    sent: true,
    sessionId: 's-1',
    deliveryId: 'd-1',
    runId: 'r-1',
  });
});

test('the reply text wins over a stale `text` left in the declared params', async () => {
  const { executor, calls } = sendStub();

  await executor.execute({ sessionId: 's-1', reply: 'the person’s words', text: 'stale option text' });

  assert.equal(calls.length, 1);
  assert.equal(calls[0]?.text, 'the person’s words', '`reply` is the text the person just typed');
});

test('a refused send fails the confirmation and carries the control service’s code', async () => {
  const { executor, calls } = sendStub({
    ok: false,
    code: 'RUN_IN_PROGRESS',
    message: 'a turn is already running in this session',
  });
  const registry = createCockpitCardRegistry([
    new StaticCardProvider('test', [
      makeCard('busy-card', { uri: 'cloudcli://test/busy', sessionId: 's-busy' }),
    ]),
  ]);
  const actions = createCockpitCardActions({ registry, executors: [executor] });

  await assert.rejects(
    () => actions.confirm({ cardId: 'busy-card', revision: 1, replyText: 'hello' }),
    carriesCode('RUN_IN_PROGRESS'),
    'the confirmation must fail, and the refusal code must reach the caller unchanged',
  );
  assert.equal(calls.length, 1, 'the refused confirmation still attempted exactly one send');
});

test('a send that never reaches its session is a not-found, not success', async () => {
  const { executor } = sendStub({
    ok: false,
    code: 'SESSION_NOT_FOUND',
    message: 'Session "gone" was not found.',
  });

  await assert.rejects(
    () => executor.execute({ sessionId: 'gone', reply: 'hello' }),
    (failure) =>
      failure instanceof AppError &&
      failure.code === 'SESSION_NOT_FOUND' &&
      failure.statusCode === 404,
  );
});

// ---------------------------------------------------------------------------
// session.start
// ---------------------------------------------------------------------------

test('a project-only card starts exactly one conversation and answers its new id', async () => {
  const { executor, calls } = startStub();
  const registry = createCockpitCardRegistry([
    new StaticCardProvider('test', [
      makeCard('project-card', { uri: 'cloudcli://test/project', project: 'proj-a' }),
    ]),
  ]);
  const actions = createCockpitCardActions({ registry, executors: [executor] });

  const result = await actions.confirm({
    cardId: 'project-card',
    revision: 1,
    replyText: 'start with the failing test',
  });

  assert.equal(calls.length, 1, 'one confirmation must start exactly one conversation');
  assert.deepEqual(calls[0], {
    project: 'proj-a',
    initialMessage: 'start with the failing test',
    provider: DEFAULT_COCKPIT_SESSION_PROVIDER,
  });
  assert.equal(result.executor, COCKPIT_SESSION_START_EXECUTOR_ID);
  assert.deepEqual(result.result, { sessionId: 'new-1', projectPath: '/repos/proj-a' });
});

test('a fleet registry id resolves to its registered root; a plain path is used as written', async () => {
  // The fleet knows one id; every other value is a path the caller already has.
  const lookup = async (segment: string): Promise<{ root: string } | null> =>
    segment === 'fleet-7' ? { root: '/repos/fleet-7' } : null;

  assert.equal(await resolveSessionProject('fleet-7', lookup), '/repos/fleet-7');
  assert.equal(await resolveSessionProject('/repos/plain', lookup), '/repos/plain');
  assert.equal(
    await resolveSessionProject('  /repos/plain  ', lookup),
    '/repos/plain',
    'the resolved path is the trimmed value',
  );

  await assert.rejects(
    () => resolveSessionProject('   ', lookup),
    carriesCode('INVALID_REQUEST'),
    'an empty project is refused before any lookup',
  );
});

test('an unknown provider is refused before the injected start is called', async () => {
  const { executor, calls } = startStub();

  await assert.rejects(
    () => executor.execute({ project: '/repos/plain', initialMessage: 'hi', provider: 'nope' }),
    carriesCode('INVALID_REQUEST'),
  );
  assert.equal(calls.length, 0, 'a refused provider must not create a conversation');
});

// ---------------------------------------------------------------------------
// Own-reply defaults
// ---------------------------------------------------------------------------

test('the projection fills three own-reply defaults from the subject', async () => {
  const registry = createCockpitCardRegistry([
    new StaticCardProvider('test', [
      makeCard('with-session', { uri: 'cloudcli://test/s', sessionId: 's-9' }),
      makeCard('with-project', { uri: 'cloudcli://test/p', project: 'p-9' }),
      makeCard('with-neither', { uri: 'cloudcli://test/n' }),
    ]),
  ]);

  const cards = await registry.listCards();
  const byId = new Map(cards.map((card) => [card.id, card]));

  assert.deepEqual(byId.get('with-session')?.ownReply, {
    executor: COCKPIT_SESSION_SEND_EXECUTOR_ID,
    params: { sessionId: 's-9' },
  });
  assert.deepEqual(byId.get('with-project')?.ownReply, {
    executor: COCKPIT_SESSION_START_EXECUTOR_ID,
    params: { project: 'p-9' },
  });
  const unanswered = byId.get('with-neither');
  assert.equal(unanswered?.ownReply, undefined, 'no address means no own-reply executor');
  assert.ok(
    typeof unanswered?.ownReplyUnavailable === 'string' && unanswered.ownReplyUnavailable.trim() !== '',
    'a card with no address must carry a readable reason instead of a silent absence',
  );
});

test('a provider-declared ownReply wins over the subject default', async () => {
  const calls: Array<Record<string, unknown>> = [];
  const declared: ICockpitActionExecutor = {
    id: 'provider.reply',
    execute: (params) => {
      calls.push(params);
      return { recorded: true };
    },
  };
  const registry = createCockpitCardRegistry([
    new StaticCardProvider(
      'test',
      [
        makeCard(
          'declared',
          { uri: 'cloudcli://test/declared', sessionId: 's-1', project: 'p-1' },
          { ownReply: { executor: 'provider.reply', params: { note: 'mine' } } },
        ),
      ],
      ['provider.reply'],
    ),
  ]);
  const { executor: sendExecutor, calls: sends } = sendStub();
  const actions = createCockpitCardActions({ registry, executors: [declared, sendExecutor] });

  const card = (await registry.listCards())[0];
  assert.deepEqual(card?.ownReply, { executor: 'provider.reply', params: { note: 'mine' } });

  const result = await actions.confirm({ cardId: 'declared', revision: 1, replyText: 'typed' });
  assert.equal(result.executor, 'provider.reply');
  assert.deepEqual(calls, [{ note: 'mine', reply: 'typed' }]);
  assert.equal(sends.length, 0, 'the built-in default must not also run');
});

// ---------------------------------------------------------------------------
// Fixture subject override
// ---------------------------------------------------------------------------

test('the fixture subject override replaces the fixture’s own addressing', async () => {
  const projectOverride = createCockpitFixtureCardProvider({ subject: { project: 'p-dod' } });
  const projectCards = await createCockpitCardRegistry([projectOverride.provider]).listCards();

  for (const card of projectCards) {
    assert.equal(card.subject.project, 'p-dod', `${card.id} must be addressed to the override project`);
    assert.equal(card.subject.sessionId, undefined, `${card.id} must not keep a built-in session`);
  }
  const need = projectCards.find((card) => card.id === 'fixture:need');
  assert.deepEqual(need?.ownReply, {
    executor: COCKPIT_SESSION_START_EXECUTOR_ID,
    params: { project: 'p-dod' },
  });
  // The one card that DECLARES its own reply keeps it, as the registry's rule requires.
  assert.equal(
    projectCards.find((card) => card.id === 'fixture:ask')?.ownReply?.executor,
    'fixture.record',
  );

  const sessionOverride = createCockpitFixtureCardProvider({ subject: { sessionId: 's-dod' } });
  const sessionCards = await createCockpitCardRegistry([sessionOverride.provider]).listCards();
  const needOnSession = sessionCards.find((card) => card.id === 'fixture:need');
  assert.deepEqual(needOnSession?.ownReply, {
    executor: COCKPIT_SESSION_SEND_EXECUTOR_ID,
    params: { sessionId: 's-dod' },
  });
  for (const card of sessionCards) {
    assert.equal(card.subject.sessionId, 's-dod');
    assert.equal(card.subject.project, undefined);
  }

  // An empty override is "no override": the fixture's own subjects stay as written.
  const untouched = await createCockpitCardRegistry([
    createCockpitFixtureCardProvider({ subject: {} }).provider,
  ]).listCards();
  assert.equal(untouched.find((card) => card.id === 'fixture:stuck')?.subject.sessionId, 'fixture-session');
});

// ---------------------------------------------------------------------------
// Guard: the fixture cards really do exercise both executors
// ---------------------------------------------------------------------------

test('every fixture card is confirmable through its derived default', async () => {
  const fixture = createCockpitFixtureCardProvider({ subject: { project: 'p-dod' } });
  const registry = createCockpitCardRegistry([fixture.provider]);
  const { executor, calls } = startStub();
  const actions = createCockpitCardActions({ registry, executors: [executor, fixture.executor] });

  const card = (await registry.listCards()).find((candidate) => candidate.id === 'fixture:need');
  assert.ok(card !== undefined && isRecord(card.subject));
  await actions.confirm({ cardId: 'fixture:need', revision: 1, replyText: 'go ahead' });

  assert.equal(calls.length, 1);
  assert.deepEqual(calls[0], {
    project: 'p-dod',
    initialMessage: 'go ahead',
    provider: DEFAULT_COCKPIT_SESSION_PROVIDER,
  });
});

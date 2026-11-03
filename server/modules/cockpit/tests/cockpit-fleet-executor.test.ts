/**
 * The quay-fleet disposal executors' criterion.
 *
 * The cases drive every seam with a STUBBED child runner, so no fleet installation is needed:
 *
 *   · the declaration set comes from `rescue executors --json` — three declared ids register
 *     THREE executors, and none of the ids is named by this repo (the false form — hard-coding
 *     the four shipped ids — reds this case);
 *   · a missing CLI answers an empty set plus a readable reason;
 *   · a hold success returns the fleet's own success document verbatim;
 *   · exit 2 throws an `AppError` carrying the fleet's `code`/`message` (the false form — exiting
 *     2 still being treated as success — reds this case);
 *   · exit 3 is named "项目未在 fleet 登记";
 *   · a non-JSON answer, or any other exit code, is an explicit `FLEET_EXEC_FAILED`;
 *   · a person's own typed text reaches `fleet.log` as `text` (the false form — forwarding the
 *     channel's `reply` spelling — reds this case);
 *   · a fleet card with no session gets the provider's `fleet.log` own-reply declaration, while a
 *     card that names a session keeps the registry's `session.send` default;
 *   · the action channel reaches a declared fleet executor through its late binding.
 *
 * Run directly:
 *   npx tsx --tsconfig server/tsconfig.json --test \
 *     server/modules/cockpit/tests/cockpit-fleet-executor.test.ts
 */
import assert from 'node:assert/strict';
import test from 'node:test';

import type { CockpitCard } from '@/shared/types.js';
import { AppError } from '@/shared/utils.js';

import { createCockpitCardActions } from '../cockpit-card-actions.js';
import { createCockpitCardRegistry } from '../cockpit-card-registry.js';
import {
  createCockpitFleetCardProvider,
  type CockpitFleetCardProvider,
} from '../cockpit-fleet-card-provider.js';
import {
  COCKPIT_FLEET_EXECUTORS_ARGS,
  COCKPIT_FLEET_LOG_EXECUTOR_ID,
  COCKPIT_MOLTEN_DECIDE_EXECUTOR_ID,
  CockpitFleetExecutor,
  readCockpitFleetExecutors,
  type CockpitFleetCommandResult,
  type CockpitFleetExecutorDeclaration,
} from '../cockpit-fleet-executor.js';

const WAITING = '2026-10-27T00:01:00.000Z';
const SURFACED = '2026-10-27T00:01:05.000Z';

/** Three ids, none of which this repo knows: the declaration must be the only source. */
const DECLARATION_DOCUMENT = {
  ok: true,
  executors: [
    {
      id: 'fleet.hold',
      action: 'hold',
      does: 'ack and keep open',
      params: [
        { name: 'attentionId', type: 'string', required: true },
        { name: 'reason', type: 'string', required: false },
      ],
    },
    {
      id: 'fleet.custom-alpha',
      action: 'alpha',
      does: 'a first executor only the stub declares',
      params: [{ name: 'alphaId', type: 'string', required: true }],
    },
    {
      id: 'fleet.custom-beta',
      action: 'beta',
      does: 'a second executor only the stub declares',
      params: [],
    },
  ],
};

const DECLARED_IDS = DECLARATION_DOCUMENT.executors.map((executor) => executor.id);

/** One card that names a task/project but NO session: the own-reply path is `fleet.log`. */
const NO_SESSION_CARD = {
  id: 'att-need-1',
  provider: 'quay-fleet',
  revision: 2,
  kind: 'need',
  group: 'ruling',
  rank: 1,
  state: 'open',
  waitingSince: WAITING,
  surfacedAt: SURFACED,
  subject: { project: 'proj-1', taskId: 'task-9', uri: 'quay://proj-1/task/task-9' },
  facts: [],
  options: [
    {
      id: 'hold',
      label: '挂起',
      does: 'ack and keep open',
      suggested: false,
      source: 'provider',
      action: { executor: 'fleet.hold', params: { attentionId: 'att-need-1' } },
    },
  ],
};

/** One card that names a session: the registry's `session.send` default must survive. */
const SESSION_CARD = {
  id: 'att-ask-1',
  provider: 'quay-fleet',
  revision: 3,
  kind: 'ask',
  group: 'ruling',
  rank: 2,
  state: 'open',
  waitingSince: WAITING,
  surfacedAt: SURFACED,
  subject: {
    project: 'proj-1',
    taskId: 'task-8',
    sessionId: 'sess-8',
    uri: 'cloudcli://session/sess-8',
  },
  facts: [],
  options: [],
};

const CARDS_STDOUT = `${JSON.stringify(NO_SESSION_CARD)}\n${JSON.stringify(SESSION_CARD)}\n`;

function declarationRunner(
  document: unknown = DECLARATION_DOCUMENT,
  calls: string[][] = [],
): (args: readonly string[]) => Promise<CockpitFleetCommandResult> {
  return async (args) => {
    calls.push([...args]);
    return { exitCode: 0, stdout: JSON.stringify(document), stderr: '' };
  };
}

function providerWith(
  overrides: Partial<Parameters<typeof createCockpitFleetCardProvider>[0]> = {},
): CockpitFleetCardProvider {
  return createCockpitFleetCardProvider({
    runCards: async () => ({ exitCode: 0, stdout: CARDS_STDOUT, stderr: '' }),
    runExecutors: declarationRunner(),
    readSessionAsk: () => null,
    ...overrides,
  });
}

function byId(cards: readonly CockpitCard[], id: string): CockpitCard {
  const card = cards.find((candidate) => candidate.id === id);
  assert.ok(card !== undefined, `expected card ${id} in ${cards.map((card) => card.id).join(', ')}`);
  return card;
}

/** A declaration the cases drive one executor with. */
function holdDeclaration(): CockpitFleetExecutorDeclaration {
  return {
    id: 'fleet.hold',
    action: 'hold',
    does: 'ack and keep open',
    params: [
      { name: 'attentionId', type: 'string', required: true },
      { name: 'reason', type: 'string', required: false },
    ],
  };
}

/** One executor over a stub that answers a fixed child result. */
function executorReturning(
  result: CockpitFleetCommandResult,
  calls: string[][] = [],
): CockpitFleetExecutor {
  return new CockpitFleetExecutor(holdDeclaration(), {
    runFleet: async (args) => {
      calls.push([...args]);
      return result;
    },
  });
}

function isAppError(code: string, message?: RegExp): (failure: unknown) => boolean {
  return (failure) =>
    failure instanceof AppError &&
    failure.code === code &&
    (message === undefined || message.test(failure.message));
}

// ---------------------------------------------------------------------------
// The declaration port
// ---------------------------------------------------------------------------

test('AC: the declaration set comes from `rescue executors --json`, one executor per entry', async () => {
  const calls: string[][] = [];
  const fleet = providerWith({ runExecutors: declarationRunner(DECLARATION_DOCUMENT, calls) });

  const reading = await fleet.executorReading();
  assert.deepEqual(calls, [COCKPIT_FLEET_EXECUTORS_ARGS], 'the declaration port is the read-only argv');
  assert.deepEqual(
    reading.declarations.map((declaration) => declaration.id),
    DECLARED_IDS,
  );
  // The CLI's reading above stays verbatim; the provider's DECLARED set adds the one cockpit-side
  // contract (the molten decision executor the fleet has not shipped yet), which is what keeps a
  // molten card's options confirmable.
  assert.deepEqual(fleet.provider.declaredExecutors(), [
    ...DECLARED_IDS,
    COCKPIT_MOLTEN_DECIDE_EXECUTOR_ID,
  ]);

  // Every declared id resolves to an executor whose own id is the declared one. The third id is
  // not a fleet-shipped id, so a hard-coded four would fail to produce it at all.
  const resolved: string[] = [];
  for (const id of DECLARED_IDS) {
    const executor = await fleet.provider.resolveExecutor(id);
    assert.ok(executor !== null, `expected a declared implementation for ${id}`);
    assert.equal(executor.id, id);
    resolved.push(executor.id);
  }
  assert.deepEqual(resolved, DECLARED_IDS);
  assert.equal(await fleet.provider.resolveExecutor('fleet.not-declared'), null);
});

test('AC: an unavailable CLI answers an empty declaration set plus a readable reason', async () => {
  const fleet = providerWith({
    runExecutors: async () => ({
      exitCode: null,
      stdout: '',
      stderr: '',
      error:
        'quay-fleet was not found (checked QUAY_FLEET_BIN, PATH and ~/.quay-fleet/bin/quay-fleet)',
    }),
  });

  const reading = await fleet.executorReading();
  assert.deepEqual(reading.declarations, []);
  assert.match(reading.reason ?? '', /quay-fleet was not found/);
  assert.deepEqual(fleet.provider.declaredExecutors(), []);
});

test('AC: a declaration run that is not JSON is a reading, not a throw', async () => {
  const fleet = providerWith({
    runExecutors: async () => ({ exitCode: 0, stdout: 'rescue executors: 4', stderr: '' }),
  });
  const reading = await fleet.executorReading();
  assert.deepEqual(reading.declarations, []);
  assert.match(reading.reason ?? '', /did not answer a JSON document/);
});

// ---------------------------------------------------------------------------
// Exit-code classification
// ---------------------------------------------------------------------------

test('AC: a hold success returns the fleet success document and the exact declared argv', async () => {
  const calls: string[][] = [];
  const document = {
    ok: true,
    state: 'held',
    executorId: 'fleet.hold',
    action: 'hold',
    params: { attentionId: 'att-1' },
    at: '2026-10-27T00:10:00.000Z',
    rule: 'rescue.v0',
    result: { attentionId: 'att-1', entryState: 'acked', changed: true },
  };
  const executor = executorReturning(
    { exitCode: 0, stdout: JSON.stringify(document), stderr: '' },
    calls,
  );

  const result = await executor.execute({ attentionId: 'att-1' });
  assert.deepEqual(result, document);
  assert.deepEqual(calls, [
    ['rescue', 'exec', 'fleet.hold', '--params', '{"attentionId":"att-1"}', '--json'],
  ]);
});

test('AC: exit 2 is a refusal carrying the fleet code and message, never a success', async () => {
  const executor = executorReturning({
    exitCode: 2,
    stdout: JSON.stringify({
      ok: false,
      state: 'refused',
      executorId: 'fleet.hold',
      params: {},
      code: 'invalid-params',
      message: 'fleet.hold requires params.attentionId (a non-empty string)',
    }),
    stderr: '',
  });

  await assert.rejects(
    executor.execute({}),
    isAppError('invalid-params', /requires params\.attentionId/),
  );
});

test('AC: exit 3 is mapped to "项目未在 fleet 登记"', async () => {
  const documented = executorReturning({
    exitCode: 3,
    stdout: JSON.stringify({
      ok: false,
      state: 'refused',
      executorId: 'fleet.redispatch',
      params: {},
      code: 'project-not-registered',
      message: 'no registered project "proj-x" in /tmp/home/registry.json',
    }),
    stderr: '',
  });
  await assert.rejects(
    documented.execute({}),
    isAppError('project-not-registered', /no registered project/),
  );

  // The exit code alone names the condition when the document is unreadable.
  const bare = executorReturning({ exitCode: 3, stdout: 'usage: quay-fleet …', stderr: '' });
  await assert.rejects(bare.execute({}), isAppError('project-not-registered', /项目未在 fleet 登记/));
});

test('AC: a non-JSON success or any other exit is an explicit execution failure', async () => {
  const nonJson = executorReturning({ exitCode: 0, stdout: 'held: fleet.hold\n', stderr: '' });
  await assert.rejects(nonJson.execute({ attentionId: 'att-1' }), isAppError('FLEET_EXEC_FAILED'));

  const wrongOk = executorReturning({
    exitCode: 0,
    stdout: JSON.stringify({ ok: false, state: 'refused' }),
    stderr: '',
  });
  await assert.rejects(wrongOk.execute({ attentionId: 'att-1' }), isAppError('FLEET_EXEC_FAILED'));

  const unexpected = executorReturning({
    exitCode: 1,
    stdout: '',
    stderr: 'quay-fleet failed: boom\nmore detail',
  });
  await assert.rejects(unexpected.execute({ attentionId: 'att-1' }), isAppError('FLEET_EXEC_FAILED', /boom/));
});

// ---------------------------------------------------------------------------
// Free text and own-reply
// ---------------------------------------------------------------------------

test('AC: a person\'s own text reaches fleet.log as `text`, never as `reply`', async () => {
  const calls: string[][] = [];
  const executor = new CockpitFleetExecutor(
    {
      id: COCKPIT_FLEET_LOG_EXECUTOR_ID,
      action: 'log',
      does: 'append one decision record',
      params: [{ name: 'text', type: 'string', required: true }],
    },
    {
      runFleet: async (args) => {
        calls.push([...args]);
        return {
          exitCode: 0,
          stdout: JSON.stringify({ ok: true, state: 'logged', executorId: 'fleet.log' }),
          stderr: '',
        };
      },
    },
  );

  await executor.execute({
    attentionId: 'att-need-1',
    taskId: 'task-9',
    projectId: 'proj-1',
    // The confirmation channel's spelling for the person's own words.
    reply: '先别动，我自己看',
  });

  assert.equal(calls.length, 1);
  const args = calls[0];
  assert.ok(args !== undefined);
  assert.deepEqual(args.slice(0, 3), ['rescue', 'exec', 'fleet.log']);
  const params = JSON.parse(args[4] ?? '{}') as Record<string, unknown>;
  assert.deepEqual(params, {
    attentionId: 'att-need-1',
    taskId: 'task-9',
    projectId: 'proj-1',
    text: '先别动，我自己看',
  });
  assert.equal('reply' in params, false, 'the fleet names the free text `text`');
});

test('AC: a no-session fleet card gets fleet.log own-reply; a session card keeps session.send', async () => {
  const fleet = providerWith();

  const cards = await fleet.provider.listCards();
  const noSession = byId(cards, 'att-need-1');
  assert.deepEqual(noSession.ownReply, {
    executor: 'fleet.log',
    params: { attentionId: 'att-need-1', taskId: 'task-9', projectId: 'proj-1' },
  });
  assert.equal(byId(cards, 'att-ask-1').ownReply, undefined, 'a session card declares nothing here');

  // The registry's defaults: a session card is answered in its conversation, and the provider's
  // declaration wins over the project default on the no-session card.
  const registry = createCockpitCardRegistry([fleet.provider]);
  const projected = await registry.listCards();
  assert.deepEqual(byId(projected, 'att-need-1').ownReply, {
    executor: 'fleet.log',
    params: { attentionId: 'att-need-1', taskId: 'task-9', projectId: 'proj-1' },
  });
  const session = byId(projected, 'att-ask-1');
  assert.equal(session.ownReply?.executor, 'session.send');
  assert.deepEqual(session.ownReply?.params, { sessionId: 'sess-8' });
});

// ---------------------------------------------------------------------------
// The action channel's late binding
// ---------------------------------------------------------------------------

test('AC: the action channel reaches a DECLARED fleet executor through the late binding', async () => {
  const execCalls: string[][] = [];
  const fleet = createCockpitFleetCardProvider({
    runCards: async () => ({ exitCode: 0, stdout: CARDS_STDOUT, stderr: '' }),
    runExecutors: async (args) => {
      if (args[0] === 'rescue' && args[1] === 'executors') {
        return { exitCode: 0, stdout: JSON.stringify(DECLARATION_DOCUMENT), stderr: '' };
      }
      execCalls.push([...args]);
      return {
        exitCode: 0,
        stdout: JSON.stringify({
          ok: true,
          state: 'held',
          executorId: 'fleet.hold',
          action: 'hold',
          params: { attentionId: 'att-need-1' },
          at: '2026-10-27T00:10:00.000Z',
          rule: 'rescue.v0',
          result: { attentionId: 'att-need-1', entryState: 'acked', changed: true },
        }),
        stderr: '',
      };
    },
    readSessionAsk: () => null,
  });

  // The card read is what the cockpit's GET performs first; it also caches the declarations.
  await fleet.provider.listCards();
  const registry = createCockpitCardRegistry([fleet.provider]);
  const actions = createCockpitCardActions({
    registry,
    executors: [],
    resolveExecutor: (id) => fleet.provider.resolveExecutor(id),
  });

  const result = await actions.confirm({ cardId: 'att-need-1', revision: 2, optionId: 'hold' });
  assert.equal(result.executor, 'fleet.hold');
  assert.deepEqual(result.params, { attentionId: 'att-need-1' });
  assert.equal((result.result as { state?: unknown }).state, 'held');
  assert.deepEqual(execCalls, [
    ['rescue', 'exec', 'fleet.hold', '--params', '{"attentionId":"att-need-1"}', '--json'],
  ]);
});

// ---------------------------------------------------------------------------
// The reader itself
// ---------------------------------------------------------------------------

test('AC: the declaration reader tolerates entries without an id or a param name', () => {
  const reading = readCockpitFleetExecutors({
    exitCode: 0,
    stdout: JSON.stringify({
      ok: true,
      executors: [
        { id: 'kept', action: 'a', does: 'd', params: [{ name: 'x' }, { type: 'string' }] },
        { action: 'no-id' },
        null,
      ],
    }),
    stderr: '',
  });
  assert.deepEqual(reading.declarations, [
    { id: 'kept', action: 'a', does: 'd', params: [{ name: 'x' }] },
  ]);
  assert.equal(reading.reason, null);
});

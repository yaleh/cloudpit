/**
 * gap-cockpit-session-start-model-settings — a card-started conversation runs its FIRST
 * turn under the model/effort the operator configured, and a selection it cannot honour is
 * refused before any session row exists.
 *
 * The shipped `cockpit.sessionStart` block used to name only a lifecycle mode and a
 * permission mode, so every card-started conversation launched under the provider's own
 * default even when the operator's model lived in the custom model library. This criterion
 * reads both halves of the fix, over the REAL services the composition root binds:
 *
 *   (1) the parser — shipped `model: 'default'`, an effort that is absent by default, legal
 *       values preserved, a malformed field reported and falling back on its own.
 *   (2) the shipped default — the row records `model = 'default'`, no effort, and the first
 *       run's launch options + compiled spawn options are exactly what they were before the
 *       preference existed (the provider's own default, no effort).
 *   (3) a model-library entry — the row records the entry, the opening send states it, and
 *       the first run resolves that model AND the entry's env keys.
 *   (4) an unknown or since-deleted library id — refused with a readable AppError BEFORE
 *       `createAppSession`, so no orphan row and no run.
 *   (5) effort — accepted and carried on the row, the opening send and the compiled spawn
 *       options when the provider/model offers it; refused by the provider capability
 *       matrix (cursor) or the model's own effort table otherwise.
 *   (6) the regression surface — a scheduled message to an EXISTING session still sends
 *       exactly its own options: no model/effort are injected from the session-start block,
 *       and the existing row is untouched.
 *
 * The start body under test is the SAME `createCockpitSessionStarter` the composition root
 * (`server/cockpit-executors-wiring.ts`) binds, over the REAL `sessionsService`,
 * `providerModelsService` and `providerCapabilitiesService` and a real SQLite database. The
 * binding is written out here rather than imported because that seam is a root-level
 * `server/*.ts` file, which the `boundaries` lint rules do not register as an element (its
 * own pass-through is pinned by `cockpit-session-executors.test.ts`); the services are the
 * production singletons either way. Only the chat control service is a recorder, because
 * what it receives (the opening send's options) is a reading this criterion needs. The
 * start path's selection never passes through it — the row is the authority — which is why
 * a recorder here cannot mask a dropped preference.
 */

import assert from 'node:assert/strict';
import { mkdirSync, mkdtempSync, writeFileSync } from 'node:fs';
import { mkdtemp, rm } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import test from 'node:test';

import { AppError } from '@/shared/utils.js';

const SCRATCH = mkdtempSync(path.join(os.tmpdir(), 'cockpit-session-start-model-'));
const SCRATCH_HOME = path.join(SCRATCH, 'home');
process.env.HOME = SCRATCH_HOME;
process.env.JWT_SECRET = 'cockpit-session-start-model-selection-test-secret';
delete process.env.VITE_IS_PLATFORM;
mkdirSync(SCRATCH_HOME, { recursive: true });

const {
  closeConnection,
  initializeDatabase,
  providerModelsDb,
  scheduledMessagesDb,
  sessionsDb,
  userDb,
} = await import('@/modules/database/index.js');
const {
  mapCliOptionsToSDK,
  providerCapabilitiesService,
  providerModelsService,
  sessionsService,
} = await import('@/modules/providers/index.js');
const { CockpitSessionStartExecutor, createCockpitSessionStarter } = await import(
  '@/modules/cockpit/index.js'
);
const { dispatchDueScheduledMessages } = await import('@/modules/scheduled-messages/index.js');
const { loadServerSettings } = await import('@/modules/settings/index.js');

/** One line of this criterion's readings. The readings are the evidence. */
function say(line: string): void {
  console.log(`cockpit-session-start-model ${line}`);
}

// =====================================================================
// fixtures: an isolated database, a settings file, and a project path
// =====================================================================

async function withDatabase(run: () => Promise<void>): Promise<void> {
  const previousDatabasePath = process.env.DATABASE_PATH;
  closeConnection();
  const directory = await mkdtemp(path.join(SCRATCH, 'db-'));
  process.env.DATABASE_PATH = path.join(directory, 'criterion.db');
  await initializeDatabase();
  try {
    await run();
  } finally {
    closeConnection();
    if (previousDatabasePath === undefined) delete process.env.DATABASE_PATH;
    else process.env.DATABASE_PATH = previousDatabasePath;
    await rm(directory, { recursive: true, force: true });
  }
}

let settingsFileCounter = 0;

/** Writes one settings document and reads it through the production loader. */
function settingsFrom(record: unknown): ReturnType<typeof loadServerSettings> {
  settingsFileCounter += 1;
  const file = path.join(SCRATCH, `server.settings.${settingsFileCounter}.json`);
  writeFileSync(file, JSON.stringify(record));
  return loadServerSettings({ settingsPath: file, env: {} });
}

/** Writes no file at the default path: the shipped defaults, with no problem. */
function shippedSettings(): ReturnType<typeof loadServerSettings> {
  return loadServerSettings({
    defaultPath: path.join(SCRATCH, 'absent', 'server.settings.json'),
    env: {},
  });
}

function makeProject(name: string): string {
  const directory = path.join(SCRATCH, 'projects', name);
  mkdirSync(directory, { recursive: true });
  return directory;
}

// =====================================================================
// the recorder and the real wiring
// =====================================================================

type CapturedSend = {
  caller: unknown;
  sessionId: string;
  content: string;
  options: Record<string, unknown>;
};

/**
 * Records every send the shared control service is asked for and answers `ok` with a run
 * id, exactly as the real service does for an idle session. The completion promise settles
 * immediately, which is enough for the scheduled-message arm's await.
 */
function captureControl() {
  const sends: CapturedSend[] = [];
  const control = {
    send: async (
      caller: { userId: string | number | null; via: string },
      input: { sessionId: string; content: string; options?: Record<string, unknown> },
    ) => {
      sends.push({
        caller,
        sessionId: input.sessionId,
        content: input.content,
        options: input.options ?? {},
      });
      return {
        ok: true as const,
        deliveryId: `delivery-${sends.length}`,
        runId: `run-${sends.length}`,
        queued: false,
        queuedMessageUuid: null,
        completion: Promise.resolve({ started: true, error: null }),
      };
    },
  };
  return { control, sends };
}

/**
 * The composition root's two-line binding, over the real services:
 * `createCockpitSessionStarter` wrapped in the executor the card actions call. The
 * `resolveProjectPath`/`resolveUserId` seams are injected; everything the task is about
 * (the row writer, the catalog reader, the capability matrix) is the production singleton.
 */
function makeStart(
  sessionStart: ReturnType<typeof loadServerSettings>['cockpit']['sessionStart'],
  control: ReturnType<typeof captureControl>['control'],
) {
  const start = createCockpitSessionStarter({
    sessions: sessionsService,
    models: providerModelsService,
    capabilities: providerCapabilitiesService,
    control,
    preferences: sessionStart,
    resolveUserId: () => 1,
    resolveProjectPath: async (project) => project,
  });
  return new CockpitSessionStartExecutor({ start });
}

async function runStart(
  start: ReturnType<typeof makeStart>,
  project: string,
  initialMessage: string,
  provider = 'claude',
): Promise<string> {
  const answer = (await start.execute({ project, initialMessage, provider })) as {
    sessionId?: unknown;
  };
  assert.equal(typeof answer.sessionId, 'string', 'session.start must answer the minted id');
  return answer.sessionId as string;
}

/**
 * The first turn as the resident driver compiles it.
 *
 * Mirrors `claude-host-driver.provider.ts`: resolve the model from the session row first
 * (`resolveResumeModel`), read the merged provider catalog for effort validation, then
 * compile the send options with the runtime's own `mapCliOptionsToSDK`. Reading it this way
 * is what makes "the first turn is the configured one" a measurement of production's two
 * public halves rather than of this criterion's arithmetic.
 */
async function readFirstTurn(
  sessionId: string,
  sendOptions: Record<string, unknown>,
): Promise<{
  row: ReturnType<typeof sessionsDb.getSessionById>;
  resolvedModel: string | undefined;
  spawnModel: unknown;
  spawnEffort: unknown;
  spawnEnv: Record<string, string>;
}> {
  const row = sessionsDb.getSessionById(sessionId);
  const requestedModel = typeof sendOptions.model === 'string' ? sendOptions.model : undefined;
  const resolvedModel = await providerModelsService.resolveResumeModel(
    'claude',
    sessionId,
    requestedModel,
  );
  const effortModels = await providerModelsService.getProviderModels('claude');
  const sdkOptions = mapCliOptionsToSDK({
    ...sendOptions,
    model: resolvedModel ?? sendOptions.model,
    effortModels,
  }) as { model?: unknown; effort?: unknown; env?: Record<string, string> };
  return {
    row,
    resolvedModel,
    spawnModel: sdkOptions.model,
    spawnEffort: sdkOptions.effort,
    spawnEnv: sdkOptions.env ?? {},
  };
}

async function expectAppError(
  promise: Promise<unknown>,
  code: string,
  statusCode: number,
): Promise<AppError> {
  let caught: unknown;
  try {
    await promise;
  } catch (failure) {
    caught = failure;
  }
  assert.ok(caught instanceof AppError, `expected an AppError ${code}, got ${String(caught)}`);
  assert.equal(caught.code, code, `expected code ${code}, got ${caught.code} (${caught.message})`);
  assert.equal(caught.statusCode, statusCode, `expected HTTP ${statusCode}, got ${caught.statusCode}`);
  return caught;
}

// =====================================================================
// (1) the parser
// =====================================================================

test('the shipped sessionStart block carries model `default` and no effort', () => {
  const settings = shippedSettings();
  say(
    `(1) shipped=${JSON.stringify(settings.cockpit.sessionStart)} problems=${JSON.stringify(settings.problems)}`,
  );
  assert.deepEqual(settings.cockpit.sessionStart, {
    lifecycleMode: 'resident',
    permissionMode: 'bypassPermissions',
    model: 'default',
  });
  assert.equal(
    Object.prototype.hasOwnProperty.call(settings.cockpit.sessionStart, 'effort'),
    false,
    'an absent effort is the shipped "let the launch infer it" reading',
  );
  assert.deepEqual(settings.problems, []);
});

test('legal model and effort values are preserved, and a blank effort means "unstated"', () => {
  const legal = settingsFrom({
    cockpit: { sessionStart: { model: ' v4.1flash-library ', effort: ' high ' } },
  });
  say(`(1) legal=${JSON.stringify(legal.cockpit.sessionStart)}`);
  assert.equal(legal.cockpit.sessionStart.model, 'v4.1flash-library');
  assert.equal(legal.cockpit.sessionStart.effort, 'high');
  assert.deepEqual(legal.problems, []);

  const blankEffort = settingsFrom({
    cockpit: { sessionStart: { model: 'default', effort: '   ' } },
  });
  say(`(1) blankEffort=${JSON.stringify(blankEffort.cockpit.sessionStart)}`);
  assert.equal(
    Object.prototype.hasOwnProperty.call(blankEffort.cockpit.sessionStart, 'effort'),
    false,
    'the template spells "no effort" as an empty string; it must read as absent',
  );
  assert.deepEqual(blankEffort.problems, []);
});

test('a malformed model/effort is reported and each field falls back on its own', () => {
  const malformed = settingsFrom({
    cockpit: { sessionStart: { model: '', effort: 5 } },
  });
  say(`(1) malformed=${JSON.stringify(malformed.cockpit.sessionStart)} problems=${JSON.stringify(malformed.problems)}`);
  assert.equal(malformed.cockpit.sessionStart.model, 'default', 'a blank model falls back to the shipped sentinel');
  assert.equal(
    Object.prototype.hasOwnProperty.call(malformed.cockpit.sessionStart, 'effort'),
    false,
  );
  assert.ok(
    malformed.problems.includes('`cockpit.sessionStart.model` must be a non-empty string'),
    'the blank model must be reported',
  );
  assert.ok(
    malformed.problems.includes('`cockpit.sessionStart.effort` must be a string'),
    'a non-string effort must be reported',
  );

  const notAnObject = settingsFrom({ cockpit: { sessionStart: 'resident' } });
  assert.ok(
    notAnObject.problems.includes('`cockpit.sessionStart` must be a JSON object'),
    'a non-object block must be reported',
  );
  assert.equal(notAnObject.cockpit.sessionStart.model, 'default');
});

// =====================================================================
// (2) the shipped default: old launch semantics, now recorded
// =====================================================================

test('the shipped `default` model is recorded and the first turn launches exactly as before', { concurrency: false }, async () => {
  await withDatabase(async () => {
    const settings = shippedSettings();
    const { control, sends } = captureControl();
    const start = makeStart(settings.cockpit.sessionStart, control);
    const project = makeProject('shipped-default');

    const sessionId = await runStart(start, project, 'first turn under the shipped default');
    const first = await readFirstTurn(sessionId, sends[0]!.options);
    say(
      `(2) row model=${first.row?.model ?? null} effort=${first.row?.effort ?? null} sendOptions=${JSON.stringify(
        sends[0]!.options,
      )} resolvedModel=${JSON.stringify(first.resolvedModel)} spawnModel=${JSON.stringify(
        first.spawnModel,
      )} spawnEffort=${JSON.stringify(first.spawnEffort)}`,
    );

    assert.equal(first.row?.model, 'default', 'the row must record the configured sentinel');
    assert.equal(first.row?.effort ?? null, null, 'no effort was configured, so none may be recorded');
    assert.deepEqual(
      sends[0]!.options,
      { permissionMode: 'bypassPermissions', model: 'default' },
      'the opening send states the recorded model and no effort',
    );
    assert.equal(first.resolvedModel, 'default', "the first run resolves the row's model");
    assert.equal(first.spawnModel, 'default', 'the compiled spawn model is unchanged from the pre-preference path');
    assert.equal(first.spawnEffort, undefined, 'no effort means the launch keeps its own inference');
  });
});

// =====================================================================
// (3) a custom model-library entry
// =====================================================================

/** The custom model id the criterion selects; it is not in any predefined catalog. */
const LIBRARY_MODEL_ID = 'v4.1flash-library-probe';
/**
 * Env key names the entry carries. Only names are asserted — never a value — and they are
 * deliberately keys the host environment is not carrying, which the shipped-default arm
 * above already shows by having no such keys in its compiled env.
 */
const LIBRARY_ENV_KEYS = ['ANTHROPIC_CARD_START_PROBE_BASE_URL', 'ANTHROPIC_CARD_START_PROBE_TOKEN'] as const;

function seedLibraryEntry(): void {
  providerModelsDb.createCustomProviderModel('claude', {
    id: LIBRARY_MODEL_ID,
    model: 'v4.1flash (library)',
    config: {
      env: [
        { key: LIBRARY_ENV_KEYS[0], kind: 'value', value: 'https://v41-card-start.example.invalid/v1' },
        { key: LIBRARY_ENV_KEYS[1], kind: 'secret', value: 'placeholder-not-asserted' },
      ],
    },
  });
}

test('a model-library selection is recorded and the first turn runs under it with its env', { concurrency: false }, async () => {
  await withDatabase(async () => {
    seedLibraryEntry();
    const settings = settingsFrom({ cockpit: { sessionStart: { model: LIBRARY_MODEL_ID } } });
    const { control, sends } = captureControl();
    const start = makeStart(settings.cockpit.sessionStart, control);
    const project = makeProject('library-model');

    const sessionId = await runStart(start, project, 'first turn under the library model');
    const first = await readFirstTurn(sessionId, sends[0]!.options);
    const envKeys = Object.keys(first.spawnEnv).filter((key) => key.startsWith('ANTHROPIC_CARD_START_PROBE_'));
    say(
      `(3) row model=${first.row?.model ?? null} sendOptions=${JSON.stringify(
        sends[0]!.options,
      )} resolvedModel=${JSON.stringify(first.resolvedModel)} spawnModel=${JSON.stringify(
        first.spawnModel,
      )} envKeys=${JSON.stringify(envKeys)}`,
    );

    assert.equal(first.row?.model, LIBRARY_MODEL_ID, 'the row must record the library entry, not NULL');
    assert.deepEqual(
      sends[0]!.options,
      { permissionMode: 'bypassPermissions', model: LIBRARY_MODEL_ID },
      'the opening send states the library model the row carries',
    );
    assert.equal(first.resolvedModel, LIBRARY_MODEL_ID);
    assert.equal(first.spawnModel, LIBRARY_MODEL_ID, "the child's spawn options must name the library model");
    for (const key of LIBRARY_ENV_KEYS) {
      assert.ok(
        Object.prototype.hasOwnProperty.call(first.spawnEnv, key),
        `the child's spawn env must carry the entry's key ${key} (keys only; no value is read)`,
      );
    }
  });
});

// =====================================================================
// (4) unknown / deleted ids are refused before any row exists
// =====================================================================

test('an unknown or deleted model is refused before createAppSession and mints no row', { concurrency: false }, async () => {
  await withDatabase(async () => {
    const deleted = providerModelsDb.createCustomProviderModel('claude', {
      id: LIBRARY_MODEL_ID,
      model: 'v4.1flash (library)',
    });
    providerModelsDb.deleteCustomProviderModel('claude', deleted.recordId, 'sonnet');

    const project = makeProject('unknown-model');
    const sessionsBefore = sessionsDb.getAllSessions().length;

    for (const model of [LIBRARY_MODEL_ID, 'v4.1flash-typo-not-a-model']) {
      const settings = settingsFrom({ cockpit: { sessionStart: { model } } });
      const { control, sends } = captureControl();
      const start = makeStart(settings.cockpit.sessionStart, control);

      const refusal = await expectAppError(
        start.execute({ project, initialMessage: 'must never open a run', provider: 'claude' }),
        'MODEL_UNKNOWN',
        400,
      );
      say(`(4) model=${model} code=${refusal.code} message=${JSON.stringify(refusal.message)}`);

      assert.ok(
        refusal.message.includes('Supported models:'),
        'the refusal must list what the catalog does offer',
      );
      const supported = (refusal.details as { supported?: unknown } | undefined)?.supported;
      assert.ok(Array.isArray(supported) && supported.length > 0, 'the refusal carries the catalog values');
      assert.equal(sends.length, 0, 'a refused start must not open a run');
      assert.equal(
        sessionsDb.getAllSessions().length,
        sessionsBefore,
        'a refused start must mint no row (the incident this rule prevents)',
      );
    }
  });
});

// =====================================================================
// (5) effort
// =====================================================================

test('a set effort is carried on the row and the first turn when the model offers it', { concurrency: false }, async () => {
  await withDatabase(async () => {
    const settings = settingsFrom({
      cockpit: { sessionStart: { model: 'default', effort: 'high' } },
    });
    const { control, sends } = captureControl();
    const start = makeStart(settings.cockpit.sessionStart, control);
    const project = makeProject('effort-accepted');

    const sessionId = await runStart(start, project, 'first turn at high effort');
    const first = await readFirstTurn(sessionId, sends[0]!.options);
    say(
      `(5) row model=${first.row?.model ?? null} effort=${first.row?.effort ?? null} sendOptions=${JSON.stringify(
        sends[0]!.options,
      )} spawnEffort=${JSON.stringify(first.spawnEffort)}`,
    );

    assert.equal(first.row?.model, 'default');
    assert.equal(first.row?.effort, 'high', 'the configured effort must land on the row');
    assert.deepEqual(
      sends[0]!.options,
      { permissionMode: 'bypassPermissions', model: 'default', effort: 'high' },
      'the opening send states the effort a per-run runtime reads',
    );
    assert.equal(first.spawnEffort, 'high', 'the compiled spawn options must carry the effort, not drop it');
  });
});

test('an effort the model or provider does not offer is refused before any row exists', { concurrency: false }, async () => {
  await withDatabase(async () => {
    const project = makeProject('effort-refused');
    const sessionsBefore = sessionsDb.getAllSessions().length;

    // The claude `default` entry offers low/medium/high/max; "nonsense" is silently
    // DROPPED by the runtime, so accepting it here would report a choice never made.
    const notInTable = settingsFrom({
      cockpit: { sessionStart: { model: 'default', effort: 'nonsense' } },
    });
    {
      const { control, sends } = captureControl();
      const start = makeStart(notInTable.cockpit.sessionStart, control);
      const refusal = await expectAppError(
        start.execute({ project, initialMessage: 'must never open a run', provider: 'claude' }),
        'EFFORT_NOT_SUPPORTED',
        400,
      );
      say(`(5) nonsense code=${refusal.code} message=${JSON.stringify(refusal.message)}`);
      assert.ok(refusal.message.includes('low, medium, high, max'), 'the refusal lists the offered efforts');
      assert.equal(sends.length, 0);
    }

    // Cursor declares supportsEffort: false, so even the catalog default cannot take one.
    const cursor = settingsFrom({
      cockpit: { sessionStart: { model: 'default', effort: 'high' } },
    });
    {
      const { control, sends } = captureControl();
      const start = makeStart(cursor.cockpit.sessionStart, control);
      const refusal = await expectAppError(
        start.execute({ project, initialMessage: 'must never open a run', provider: 'cursor' }),
        'EFFORT_NOT_SUPPORTED',
        400,
      );
      say(`(5) cursor code=${refusal.code} message=${JSON.stringify(refusal.message)}`);
      assert.equal(sends.length, 0);
    }

    assert.equal(
      sessionsDb.getAllSessions().length,
      sessionsBefore,
      'neither refused start may mint a row',
    );
  });
});

// =====================================================================
// (6) the regression surface: scheduled messages inject nothing
// =====================================================================

test('a scheduled message to an existing session carries no model/effort and leaves its row alone', { concurrency: false }, async () => {
  await withDatabase(async () => {
    const user = userDb.createUser('card-start-scheduler', 'hash-not-asserted');
    const project = makeProject('scheduled-regression');
    const existing = sessionsService.createAppSession('claude', project, 'existing conversation', {
      model: 'sonnet',
    });
    const sessionsBefore = sessionsDb.getAllSessions().length;

    // The production repository the scheduling service writes through; the row is a
    // FIXTURE here — what this arm reads is the dispatcher's send, not how it was scheduled.
    scheduledMessagesDb.create({
      userId: Number(user.id),
      sessionId: existing.sessionId,
      content: 'nightly message',
      options: {},
      scheduledFor: new Date(Date.now() - 60_000),
    });

    const { control, sends } = captureControl();
    const dispatched = await dispatchDueScheduledMessages(control);
    say(
      `(6) dispatched=${dispatched} sendOptions=${JSON.stringify(sends[0]?.options)} rowModel=${
        sessionsDb.getSessionById(existing.sessionId)?.model ?? null
      }`,
    );

    assert.equal(dispatched, 1, 'the due message must be dispatched');
    assert.equal(sends.length, 1);
    assert.equal(sends[0]!.sessionId, existing.sessionId, 'the scheduled turn targets the existing session');
    assert.equal(sends[0]!.content, 'nightly message');
    assert.deepEqual(
      sends[0]!.options,
      {},
      'no model/effort may be injected: the message carries its own options, not the session-start block',
    );
    assert.equal(
      sessionsDb.getSessionById(existing.sessionId)?.model,
      'sonnet',
      "the existing session's model must be untouched",
    );
    assert.equal(sessionsDb.getAllSessions().length, sessionsBefore, 'the scheduled turn opens no new session');
  });
});

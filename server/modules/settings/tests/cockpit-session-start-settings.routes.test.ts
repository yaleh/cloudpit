/**
 * `/api/settings/cockpit/session-start` criterion.
 *
 * The cockpit's new-conversation launch selection is the one server settings field the UI
 * writes. Three things make it worth a criterion of its own:
 *
 *   - the file is the DEPLOYMENT's config, so a save must change two whitelist fields and
 *     nothing else — unknown keys, other `cockpit` fields and the lifecycle/permission modes
 *     survive byte-for-byte;
 *   - the running process must NOT change under itself. A save is reported beside the reading
 *     THIS boot loaded (`effective*`) and only a new boot of the same file moves that reading;
 *   - a second editor is a conflict, not an overwrite: every write carries the content hash it
 *     was based on, writes are serialised in-process, and the replace is atomic.
 *
 * Everything below is driven through the production seams: the real settings router behind the
 * real `authenticateToken`, the real file reader/writer and the real boot loader over a temp
 * file, and the real `session.start` executor for the shared-field reading. Only the database
 * rows the auth middleware needs and the executor's outside world are stubs.
 *
 * `auth.middleware.ts` resolves `JWT_SECRET` at module-load time, and `shared/utils.ts` freezes
 * `IS_PLATFORM`; both are read on first import, and static imports are hoisted, so the
 * environment is set first and the aliased modules come in dynamically — the order
 * `session-hosts-routes.test.ts` established.
 */
import assert from 'node:assert/strict';
import { createHmac } from 'node:crypto';
import { once } from 'node:events';
import { mkdirSync, readdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { mkdtemp } from 'node:fs/promises';
import type { AddressInfo } from 'node:net';
import os from 'node:os';
import path from 'node:path';
import test from 'node:test';

import express, {
  type NextFunction,
  type Request as ExpressRequest,
  type Response as ExpressResponse,
} from 'express';

import type { ServerSettings } from '@/modules/settings/server-settings.js';
import type { SessionLaunchSelection } from '@/shared/types.js';

const TEST_JWT_SECRET = 'cockpit-session-start-settings-routes-secret';
process.env.JWT_SECRET = TEST_JWT_SECRET;
delete process.env.VITE_IS_PLATFORM;

const { closeConnection, getConnection, initializeDatabase } = await import('@/modules/database/index.js');
const { authenticateToken } = await import('@/modules/auth/index.js');
const { createSettingsRouter } = await import('@/modules/settings/settings.routes.js');
const { createSettingsService } = await import('@/modules/settings/settings.service.js');
const { DEFAULT_COCKPIT_SESSION_START_MODEL, loadServerSettings } =
  await import('@/modules/settings/server-settings.js');
const {
  readCockpitSessionStart,
  readCockpitSessionStartBoot,
  writeCockpitSessionStart,
} = await import('@/modules/settings/server-settings-file.js');
const { createCockpitSessionStarter } = await import('@/modules/cockpit/index.js');
const { AppError } = await import('@/shared/utils.js');

const USER_ID = 1;
const SETTINGS_FILE_NAME = 'server.settings.json';

/** What the temp directory's settings path starts as. */
type FileSetup =
  | { kind: 'missing' }
  | { kind: 'document'; document: unknown }
  | { kind: 'raw'; text: string }
  | { kind: 'directory' };

type Reply = {
  status: number;
  body: Record<string, unknown>;
  text: string;
  etag: string | null;
};

type Harness = {
  baseUrl: string;
  filePath: string;
  token: string;
  /** What `loadServerSettings` answered for THIS boot, before the server started serving. */
  bootReading: ServerSettings;
  request: (
    method: string,
    routePath: string,
    options?: { body?: unknown; token?: string | null; headers?: Record<string, string> },
  ) => Promise<Reply>;
  /** The current read of the settings API, with the auth token attached. */
  get: () => Promise<Reply>;
  put: (body: Record<string, unknown>, headers?: Record<string, string>) => Promise<Reply>;
  patch: (body: Record<string, unknown>, headers?: Record<string, string>) => Promise<Reply>;
  /** The settings file's bytes, read straight from disk. */
  fileText: () => string;
  /** The boot registry's reading, i.e. what the running process reports as effective. */
  boot: () => { model: string; effort: string } | null;
};

function signToken(payload: { userId: number; username: string }): string {
  const issuedAt = Math.floor(Date.now() / 1000);
  const encode = (value: unknown) => Buffer.from(JSON.stringify(value)).toString('base64url');
  const header = encode({ alg: 'HS256', typ: 'JWT' });
  const body = encode({ ...payload, iat: issuedAt, exp: issuedAt + 3600 });
  const signature = createHmac('sha256', TEST_JWT_SECRET)
    .update(`${header}.${body}`)
    .digest('base64url');
  return `${header}.${body}.${signature}`;
}

/** Mirrors `settings.module.ts`: a saved reading with the shipped default filled in. */
function cockpitSessionStartPort(filePath: string) {
  const project = (reading: { model: string | null; effort: string | null; version: string }) => ({
    model: reading.model ?? DEFAULT_COCKPIT_SESSION_START_MODEL,
    effort: reading.effort ?? '',
    version: reading.version,
  });
  return {
    read: () => project(readCockpitSessionStart(filePath)),
    write: async (input: {
      model?: string | undefined;
      effort?: string | undefined;
      expectedVersion: string;
    }) => project(await writeCockpitSessionStart(filePath, input)),
    effective: () => {
      const boot = readCockpitSessionStartBoot();
      return boot === null ? null : { model: boot.model, effort: boot.effort };
    },
  };
}

/**
 * Serves the production settings router over a temp database and a temp settings file, mounts
 * the production `authenticateToken` in front of it, and records what the boot loader read.
 */
async function withHarness(
  setup: FileSetup,
  run: (harness: Harness) => Promise<void>,
): Promise<void> {
  const previousDatabasePath = process.env.DATABASE_PATH;
  const tempDirectory = await mkdtemp(path.join(os.tmpdir(), 'cockpit-session-start-'));
  const filePath = path.join(tempDirectory, SETTINGS_FILE_NAME);

  closeConnection();
  process.env.DATABASE_PATH = path.join(tempDirectory, 'auth.db');
  await initializeDatabase();
  getConnection()
    .prepare('INSERT INTO users (id, username, password_hash) VALUES (?, ?, ?)')
    .run(USER_ID, 'tester', 'hash');
  const token = signToken({ userId: USER_ID, username: 'tester' });

  if (setup.kind === 'document') {
    writeFileSync(filePath, `${JSON.stringify(setup.document, null, 2)}\n`);
  } else if (setup.kind === 'raw') {
    writeFileSync(filePath, setup.text);
  } else if (setup.kind === 'directory') {
    mkdirSync(filePath, { recursive: true });
  }

  // The ONE boot read. Everything the API reports as "in effect" comes from this call.
  const bootReading = loadServerSettings({ settingsPath: filePath, env: {} });

  const service = createSettingsService({
    credentials: { list: () => [], create: () => ({}), remove: () => false, toggle: () => false },
    notifications: {
      getPreferences: () => undefined,
      updatePreferences: () => ({}),
      createEnabledEvent: () => ({}),
      notifyUser: () => undefined,
    },
    pushSubscriptions: { save: () => undefined, remove: () => undefined },
    getVapidPublicKey: () => null,
    accessTokens: {
      list: () => [],
      findById: () => undefined,
      issue: () => ({ ok: false, reason: 'unused' }),
      revoke: () => false,
    },
    cockpitSessionStart: cockpitSessionStartPort(filePath),
  });

  const app = express();
  app.use(express.json());
  app.get('/api/health', (_req, res) => res.json({ ok: true }));
  app.use('/api/settings', authenticateToken, createSettingsRouter(service));
  app.use((error: unknown, _req: ExpressRequest, res: ExpressResponse, _next: NextFunction) => {
    if (error instanceof AppError) {
      res.status(error.statusCode).json({
        success: false,
        error: { code: error.code, message: error.message, details: error.details },
      });
      return;
    }
    res.status(500).json({ success: false, error: { code: 'INTERNAL_ERROR', message: 'Internal server error' } });
  });

  const server = app.listen(0, '127.0.0.1');
  await once(server, 'listening');
  const baseUrl = `http://127.0.0.1:${(server.address() as AddressInfo).port}`;

  const request: Harness['request'] = async (method, routePath, options = {}) => {
    const headers: Record<string, string> = { ...(options.headers ?? {}) };
    if (options.body !== undefined) headers['content-type'] = 'application/json';
    const bearer = options.token === undefined ? token : options.token;
    if (bearer !== null) headers.authorization = `Bearer ${bearer}`;
    const response = await fetch(`${baseUrl}${routePath}`, {
      method,
      headers,
      ...(options.body === undefined ? {} : { body: JSON.stringify(options.body) }),
    });
    const text = await response.text();
    let body: Record<string, unknown> = {};
    try { body = JSON.parse(text) as Record<string, unknown>; } catch { body = {}; }
    return { status: response.status, body, text, etag: response.headers.get('etag') };
  };

  const harness: Harness = {
    baseUrl,
    filePath,
    token,
    bootReading,
    request,
    get: () => request('GET', '/api/settings/cockpit/session-start'),
    put: (body, headers) => request('PUT', '/api/settings/cockpit/session-start', { body, headers }),
    patch: (body, headers) => request('PATCH', '/api/settings/cockpit/session-start', { body, headers }),
    fileText: () => readFileSync(filePath, 'utf8'),
    boot: () => {
      const boot = readCockpitSessionStartBoot();
      return boot === null ? null : { model: boot.model, effort: boot.effort };
    },
  };

  try {
    await run(harness);
  } finally {
    await new Promise<void>((resolve) => server.close(() => resolve()));
    closeConnection();
    if (previousDatabasePath === undefined) {
      delete process.env.DATABASE_PATH;
    } else {
      process.env.DATABASE_PATH = previousDatabasePath;
    }
    rmSync(tempDirectory, { recursive: true, force: true });
  }
}

/** An error's machine-readable code, from the settings router's AppError envelope. */
function errorCode(reply: Reply): unknown {
  const error = reply.body.error as { code?: unknown } | undefined;
  return error?.code;
}

/** The file as parsed JSON, for a preservation reading. */
function readDocument(harness: Harness): Record<string, unknown> {
  return JSON.parse(harness.fileText()) as Record<string, unknown>;
}

/** A document with every other kind of configuration in it, so preservation is observable. */
const FULL_DOCUMENT = {
  credentials: { apiKey: 'secret-value' },
  cockpit: {
    enabled: true,
    counterVoice: { speech: 'alpha' },
    sessionStart: {
      lifecycleMode: 'per-run',
      permissionMode: 'default',
      model: 'model-original',
      effort: 'low',
    },
  },
  unknownFutureKnob: { keep: 'me' },
};

test('AC1: real auth rejects anonymous and invalid callers; the GET is an allowlist', async () => {
  await withHarness({ kind: 'document', document: FULL_DOCUMENT }, async (harness) => {
    // A neighbour route that needs no token proves the 401s are the auth mount, not a 404.
    const health = await harness.request('GET', '/api/health', { token: null });
    assert.equal(health.status, 200);
    for (const method of ['GET', 'PUT', 'PATCH']) {
      const anonymous = await harness.request(method, '/api/settings/cockpit/session-start', {
        token: null,
        ...(method === 'GET' ? {} : { body: { model: 'x' } }),
      });
      assert.equal(anonymous.status, 401, `${method} without a token must be 401`);
      assert.equal(anonymous.text.includes('model-original'), false);
      const forged = await harness.request(method, '/api/settings/cockpit/session-start', {
        token: 'not-a-jwt',
        ...(method === 'GET' ? {} : { body: { model: 'x' } }),
      });
      assert.equal(forged.status, 401, `${method} with an invalid token must be 401`);
    }

    const reading = await harness.get();
    assert.equal(reading.status, 200);
    // The wire projection is an allowlist: nothing from the rest of the file, no env values.
    assert.deepEqual(Object.keys(reading.body).sort(), [
      'effectiveEffort',
      'effectiveModel',
      'effort',
      'model',
      'restartRequired',
      'version',
    ]);
    assert.equal(reading.text.includes('secret-value'), false);
    assert.equal(reading.text.includes('unknownFutureKnob'), false);
    assert.equal(reading.text.includes('counterVoice'), false);
    assert.equal(reading.body.model, 'model-original');
    assert.equal(reading.body.effort, 'low');
    assert.equal(reading.body.effectiveModel, 'model-original');
    assert.equal(reading.body.restartRequired, false);
    assert.equal(reading.etag, `"${String(reading.body.version)}"`, 'the ETag is the content hash');

    // Illegal fields and values are refused with a code the client can translate.
    const version = String(reading.body.version);
    const cases: Array<{ label: string; reply: Reply; code: string }> = [
      { label: 'unknown top-level field', reply: await harness.put({ model: 'x', expectedVersion: version, sessionStart: {} }), code: 'UNKNOWN_FIELD' },
      { label: 'unknown nested field', reply: await harness.patch({ effort: 'high', expectedVersion: version, cockpit: {} }), code: 'UNKNOWN_FIELD' },
      { label: 'non-string model', reply: await harness.put({ model: 42, expectedVersion: version }), code: 'INVALID_MODEL' },
      { label: 'non-string effort', reply: await harness.patch({ effort: 5, expectedVersion: version }), code: 'INVALID_EFFORT' },
      { label: 'missing version', reply: await harness.put({ model: 'x' }), code: 'VERSION_REQUIRED' },
      { label: 'PUT without a model', reply: await harness.put({ effort: 'high', expectedVersion: version }), code: 'MODEL_REQUIRED' },
      { label: 'empty PATCH', reply: await harness.patch({ expectedVersion: version }), code: 'NOTHING_TO_UPDATE' },
    ];
    for (const probe of cases) {
      assert.equal(probe.reply.status, 400, `${probe.label} must be 400`);
      assert.equal(errorCode(probe.reply), probe.code, `${probe.label} must carry ${probe.code}`);
    }
    // Everything refused above left the file exactly as it was.
    assert.deepEqual(readDocument(harness), FULL_DOCUMENT);
    console.log(`(AC1) keys=[${Object.keys(reading.body).sort()}] etag=${reading.etag} refusals=${cases.map((probe) => probe.code).join(',')}`);
  });
});

test('AC2: PUT/PATCH change only the whitelist and preserve every other key', async () => {
  await withHarness({ kind: 'document', document: FULL_DOCUMENT }, async (harness) => {
    const before = await harness.get();
    const put = await harness.put({
      model: 'model-next',
      effort: 'medium',
      expectedVersion: String(before.body.version),
    });
    assert.equal(put.status, 200);
    assert.equal(put.body.model, 'model-next');
    assert.equal(put.body.effort, 'medium');
    assert.equal(put.etag, `"${String(put.body.version)}"`, 'the write answers with the new hash');

    const afterPut = readDocument(harness);
    assert.deepEqual(afterPut, {
      credentials: { apiKey: 'secret-value' },
      cockpit: {
        enabled: true,
        counterVoice: { speech: 'alpha' },
        sessionStart: {
          lifecycleMode: 'per-run',
          permissionMode: 'default',
          model: 'model-next',
          effort: 'medium',
        },
      },
      unknownFutureKnob: { keep: 'me' },
    });

    // PATCH touches only the field it names.
    const patch = await harness.patch({
      effort: 'high',
      expectedVersion: String(put.body.version),
    });
    assert.equal(patch.status, 200);
    assert.equal(patch.body.model, 'model-next');
    assert.equal(patch.body.effort, 'high');
    const afterPatch = readDocument(harness);
    assert.deepEqual(afterPatch, {
      ...afterPut,
      cockpit: {
        ...(afterPut.cockpit as Record<string, unknown>),
        sessionStart: {
          lifecycleMode: 'per-run',
          permissionMode: 'default',
          model: 'model-next',
          effort: 'high',
        },
      },
    });

    // A stale version is a 409 and the file is left byte-identical.
    const bytesBeforeConflict = harness.fileText();
    const stale = await harness.put({
      model: 'model-lost',
      expectedVersion: String(before.body.version),
    });
    assert.equal(stale.status, 409);
    assert.equal(errorCode(stale), 'VERSION_CONFLICT');
    assert.equal(harness.fileText(), bytesBeforeConflict, 'a conflict must not write anything');

    console.log(`(AC2) put=${put.status} patch=${patch.status} stale=${stale.status} file=${JSON.stringify(afterPatch)}`);
  });
});

test('AC2: concurrent stale writes admit exactly one winner and leave no temp file', async () => {
  await withHarness({ kind: 'document', document: FULL_DOCUMENT }, async (harness) => {
    const reading = await harness.get();
    const version = String(reading.body.version);
    const efforts = ['e0', 'e1', 'e2', 'e3', 'e4', 'e5', 'e6', 'e7'];
    const replies = await Promise.all(
      efforts.map((effort) => harness.patch({ effort, expectedVersion: version })),
    );
    const winners = replies.filter((reply) => reply.status === 200);
    const conflicts = replies.filter((reply) => reply.status === 409);
    assert.equal(winners.length, 1, 'exactly one writer may win a shared version');
    assert.equal(conflicts.length, efforts.length - 1);

    const document = readDocument(harness) as {
      cockpit: { sessionStart: { effort: string; model: string; lifecycleMode: string; permissionMode: string } };
    };
    assert.ok(efforts.includes(document.cockpit.sessionStart.effort));
    assert.equal(document.cockpit.sessionStart.model, 'model-original');
    assert.equal(document.cockpit.sessionStart.lifecycleMode, 'per-run');
    assert.equal(document.cockpit.sessionStart.permissionMode, 'default');

    const leftovers = readdirSync(path.dirname(harness.filePath)).filter((name) => name.includes('.tmp'));
    assert.deepEqual(leftovers, [], 'an atomic replace leaves no temp file behind');

    console.log(`(AC2) winners=${winners.length} conflicts=${conflicts.length} finalEffort=${document.cockpit.sessionStart.effort} tempFiles=${leftovers.length}`);
  });
});

test('AC2: read and write failures are visible, and a malformed block is never overwritten', async () => {
  // Invalid JSON: the API reports it rather than disguising it as the defaults.
  await withHarness({ kind: 'raw', text: '{ not json' }, async (harness) => {
    const reply = await harness.get();
    assert.equal(reply.status, 500);
    assert.equal(errorCode(reply), 'SERVER_SETTINGS_INVALID_JSON');
    assert.match(reply.text, /not valid JSON/);
    console.log(`(AC2) invalid json -> ${reply.status} ${String(errorCode(reply))}`);
  });

  // A path that is a directory cannot be read.
  await withHarness({ kind: 'directory' }, async (harness) => {
    const reply = await harness.get();
    assert.equal(reply.status, 500);
    assert.equal(errorCode(reply), 'SERVER_SETTINGS_READ_FAILED');
    console.log(`(AC2) directory -> ${reply.status} ${String(errorCode(reply))}`);
  });

  // A `cockpit` block that is not an object is READ as "nothing saved" but never OVERWRITTEN.
  await withHarness({ kind: 'document', document: { cockpit: 'operator-typo', keep: 1 } }, async (harness) => {
    const reading = await harness.get();
    assert.equal(reading.status, 200);
    assert.equal(reading.body.model, DEFAULT_COCKPIT_SESSION_START_MODEL);
    const bytesBefore = harness.fileText();
    const reply = await harness.put({
      model: 'model-next',
      expectedVersion: String(reading.body.version),
    });
    assert.equal(reply.status, 500);
    assert.equal(errorCode(reply), 'SERVER_SETTINGS_INVALID_SHAPE');
    assert.equal(harness.fileText(), bytesBefore, 'the operator’s block is preserved');
    console.log(`(AC2) malformed cockpit block -> ${reply.status} ${String(errorCode(reply))}`);
  });
});

test('AC3: a save is pending until a new boot loads the same file', async () => {
  await withHarness(
    { kind: 'document', document: { cockpit: { sessionStart: { model: 'model-boot' } } } },
    async (harness) => {
      const first = await harness.get();
      assert.equal(first.body.model, 'model-boot');
      assert.equal(first.body.effectiveModel, 'model-boot');
      assert.equal(first.body.restartRequired, false);
      assert.deepEqual(harness.boot(), { model: 'model-boot', effort: '' });

      const saved = await harness.put({
        model: 'model-pending',
        effort: 'medium',
        expectedVersion: String(first.body.version),
      });
      assert.equal(saved.status, 200);
      assert.equal(saved.body.model, 'model-pending');
      assert.equal(saved.body.effectiveModel, 'model-boot', 'the running process did not change');
      assert.equal(saved.body.effectiveEffort, '');
      assert.equal(saved.body.restartRequired, true);

      // The boot registry still carries the FIRST boot's reading until the file is loaded again.
      const stillRunning = await harness.get();
      assert.equal(stillRunning.body.effectiveModel, 'model-boot');
      assert.deepEqual(harness.boot(), { model: 'model-boot', effort: '' });

      // A NEW boot of the SAME file is the only thing that changes the effective reading.
      const secondBoot = loadServerSettings({ settingsPath: harness.filePath, env: {} });
      assert.equal(secondBoot.cockpit.sessionStart.model, 'model-pending');
      assert.equal(secondBoot.cockpit.sessionStart.effort, 'medium');
      const afterRestart = await harness.get();
      assert.equal(afterRestart.body.effectiveModel, 'model-pending');
      assert.equal(afterRestart.body.effectiveEffort, 'medium');
      assert.equal(afterRestart.body.restartRequired, false);
      assert.deepEqual(harness.boot(), { model: 'model-pending', effort: 'medium' });

      console.log(`(AC3) before=${String(first.body.effectiveModel)} save=${String(saved.body.model)} stillRunning=${String(stillRunning.body.effectiveModel)} afterBoot=${String(afterRestart.body.effectiveModel)} restartRequired=false`);
    },
  );
});

test('AC5: the settings API and the card session.start executor read the same server field', async () => {
  await withHarness(
    {
      kind: 'document',
      document: {
        cockpit: {
          sessionStart: {
            lifecycleMode: 'resident',
            permissionMode: 'bypassPermissions',
            model: 'model-shared',
            effort: 'high',
          },
        },
      },
    },
    async (harness) => {
      const reading = await harness.get();
      assert.equal(reading.body.effectiveModel, 'model-shared');
      assert.equal(reading.body.effectiveEffort, 'high');

      const created: Array<{ selection: SessionLaunchSelection | undefined }> = [];
      const sends: Array<{ options?: { model?: string; effort?: string; permissionMode?: string } }> = [];
      const start = createCockpitSessionStarter({
        sessions: {
          createAppSession: (_provider, _projectPath, _initialMessage, selection) => {
            created.push({ selection });
            return { sessionId: 'session-shared' };
          },
          switchSessionLifecycleMode: () => true,
        },
        models: {
          setSessionPermissionMode: () => true,
          getProviderModels: async () => ({
            DEFAULT: 'default',
            OPTIONS: [
              { value: 'model-shared', label: 'Shared', effort: { values: [{ value: 'high' }] } },
            ],
          }),
        },
        capabilities: {
          getProviderCapabilities: () => ({
            permissionModes: ['bypassPermissions'],
            lifecycleModes: ['resident', 'per-run'],
            supportsEffort: true,
          }),
        },
        control: {
          send: async (_caller, input) => {
            sends.push(input);
            return { ok: true };
          },
        },
        // EXACTLY what `server/cockpit-executors-wiring.ts` passes: the boot reading's field.
        preferences: harness.bootReading.cockpit.sessionStart,
        resolveUserId: () => USER_ID,
        resolveProjectPath: async (project) => project,
      });

      await start({ project: '/repo/a', initialMessage: 'hello', provider: 'claude' });

      assert.deepEqual(created[0]?.selection, { model: 'model-shared', effort: 'high' });
      assert.equal(sends[0]?.options?.model, 'model-shared');
      assert.equal(sends[0]?.options?.effort, 'high');
      assert.equal(sends[0]?.options?.permissionMode, 'bypassPermissions');
      // The API's effective reading and the row the executor minted name the same field.
      assert.equal(reading.body.effectiveModel, created[0]?.selection?.model);
      console.log(`(AC5) effective=${String(reading.body.effectiveModel)} rowSelection=${JSON.stringify(created[0]?.selection)} sendOptions=${JSON.stringify(sends[0]?.options)}`);
    },
  );
});

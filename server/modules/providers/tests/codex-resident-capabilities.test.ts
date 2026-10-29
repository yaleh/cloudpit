/**
 * Criterion for the Codex resident capability declaration (AC-442).
 *
 * The subject is the capability matrix's codex row and the refusal that reads
 * it. Three facts are asserted together, because any one of them alone is a
 * shape that could be satisfied while the product still cannot run a resident
 * codex session:
 *
 *   1. the matrix says `resident`, and says it with the values the phase-0
 *      app-server experiments actually measured (E1–E8 in
 *      `tmp/codex-appserver-exp-NuPHhk/REPORT.md`) — including the verbs that
 *      were NOT measured, which stay `false`;
 *   2. the declaration is carried by the driver the provider really mounts
 *      (AC-441's `CodexHostDriver`), not by a table entry alone;
 *   3. every other provider that has no such driver is still refused when a
 *      caller tries to write `resident`, and the refusal follows the session's
 *      own provider rather than the id in the URL.
 *
 * The criterion is hermetic: it never spawns `codex`, never opens a socket, and
 * never reads the developer's home. Sessions live in a `mkdtemp` database and
 * the service calls are the same ones the route handler makes. The only file
 * writes are the falsifying copies leg (e) builds beside the module it copies
 * — that is the "must go red" half of the criterion, not a side effect of the
 * passing one.
 */
import assert from 'node:assert/strict';
import { access, mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import test from 'node:test';
import { fileURLToPath, pathToFileURL } from 'node:url';

import type { IProviderHostDriver } from '@/shared/interfaces.js';
import type { HostMode, LLMProvider, ResidentFeatures } from '@/shared/types.js';

// `auth.middleware.ts` resolves the secret at module-load time and
// `shared/utils.ts` freezes `IS_PLATFORM` on first import, so the environment is
// set before the aliased modules below are evaluated — the same ordering
// `lifecycle-mode.test.ts` established.
const TEST_JWT_SECRET = 'codex-resident-capabilities-test-secret';
process.env.JWT_SECRET = TEST_JWT_SECRET;
delete process.env.VITE_IS_PLATFORM;

const { closeConnection, initializeDatabase, sessionsDb } = await import('@/modules/database/index.js');
const { providerCapabilitiesService, providerRegistry, sessionsService } = await import(
  '@/modules/providers/index.js'
);
const { AppError } = await import('@/shared/utils.js');

/** The row shape the matrix reader returns, narrowed to what this criterion reads. */
type MatrixRow = {
  lifecycleModes: HostMode[];
  multiplexedHost: boolean;
  residentFeatures?: ResidentFeatures & { stopTask?: boolean };
};

/** The provider mount this criterion inspects; `hostDriver` is the whole subject. */
type ProviderMount = {
  id?: string;
  hostDriver?: IProviderHostDriver;
};

/** What the locked `@openai/codex 0.153.4` app-server was measured to do — see the table in the task body. */
const EXPECTED_CODEX_RESIDENT_FEATURES = {
  interruptKeepsProcess: true, // E3
  liveReconfigure: ['model', 'effort'], // E4
  unattendedTurns: true, // E2
  addressable: true, // E1, E6
  inputWhileBusy: true, // E2
  cancelQueuedInput: true, // E2
  backgroundTasks: false, // E5b: unmeasured
  authoritativeLeases: false, // unmeasured
  stopTask: false, // unmeasured (AC-438/AC-439)
  remoteControl: false, // unmeasured
} as const;

const HERE = path.dirname(fileURLToPath(import.meta.url));
const SHIPPING_SERVICE_MODULE = path.resolve(HERE, '../services/provider-capabilities.service.ts');
const SERVICE_DIRECTORY = path.dirname(SHIPPING_SERVICE_MODULE);

// ---------------------------
//--------------- ISOLATED DATABASE ------------
async function withIsolatedDatabase(run: () => void | Promise<void>): Promise<void> {
  const previousDatabasePath = process.env.DATABASE_PATH;
  const directory = await mkdtemp(path.join(os.tmpdir(), 'codex-resident-capabilities-'));

  closeConnection();
  process.env.DATABASE_PATH = path.join(directory, 'auth.db');
  await initializeDatabase();

  try {
    await run();
  } finally {
    closeConnection();
    if (previousDatabasePath === undefined) {
      delete process.env.DATABASE_PATH;
    } else {
      process.env.DATABASE_PATH = previousDatabasePath;
    }
    await rm(directory, { recursive: true, force: true });
  }
}

/** Creates one session row the way the gateway does, under the given provider. */
function seedSession(sessionId: string, provider: LLMProvider): void {
  const now = new Date().toISOString();
  sessionsDb.createSession(
    sessionId,
    provider,
    '/workspace/ac442-codex-resident-capabilities',
    `Capabilities ${sessionId}`,
    now,
    now,
    null,
  );
}

// ---------------------------
//--------------- THE SHARED READINGS ------------
/**
 * The matrix reading, reusable by the shipping row and by the falsified copies.
 *
 * It is one function on purpose: leg (e) must fail the *same* assertion the
 * shipping row passes, or "the mutant is red" would only mean the mutant was
 * read by a different rig.
 */
function assertMatrixReading(row: MatrixRow): void {
  const modes = [...row.lifecycleModes].sort();
  assert.deepEqual(modes, ['per-run', 'resident'], `codex must declare per-run and resident, got ${modes.join(',')}`);
  assert.equal(row.multiplexedHost, false, 'codex owns one app-server per session, so the host is not multiplexed');

  const features = row.residentFeatures;
  assert.ok(features, 'a provider declaring resident must say what its resident process can do');
  assert.deepEqual(features, EXPECTED_CODEX_RESIDENT_FEATURES, 'the matrix must state exactly the measured features');
}

/** The mounting reading: the declaration is carried by the driver, not just the table. */
function assertHostDriverMounted(provider: ProviderMount): void {
  const driver = provider.hostDriver;
  assert.ok(driver, 'the provider must mount a host driver for the resident declaration to mean anything');
  assert.equal(driver.multiplexedHost, false, 'the mounted driver must state one conversation per process');
  assert.equal(
    typeof driver.startResidentSession,
    'function',
    'the mounted driver must carry the on-demand start verb the host route reads',
  );
}

/** Asserts one thrown value is the lifecycle refusal, by code and status, not by prose. */
function isLifecycleModeRefusal(error: unknown): boolean {
  return (
    error instanceof AppError
    && error.code === 'LIFECYCLE_MODE_NOT_SUPPORTED'
    && error.statusCode === 409
  );
}

// ---------------------------
//--------------- (a) THE MATRIX ------------
test('(a) codex declares resident with the measured feature matrix', () => {
  const row = providerCapabilitiesService.getProviderCapabilities('codex') as MatrixRow;
  const modes = [...row.lifecycleModes].sort();

  console.log(
    `provider=codex lifecycleModes=${modes.join(',')} multiplexedHost=${row.multiplexedHost} `
      + `residentFeatures=${JSON.stringify(row.residentFeatures)}`,
  );
  for (const [field, value] of Object.entries(row.residentFeatures ?? {})) {
    console.log(`[codex-resident] feature ${field}=${JSON.stringify(value)}`);
  }

  assertMatrixReading(row);
});

// ---------------------------
//--------------- (b) THE REFUSAL AND ITS POSITIVE CONTROL ------------
test('(b) per-run-only providers refuse resident and codex/claude accept it', async () => {
  await withIsolatedDatabase(() => {
    for (const provider of ['cursor', 'opencode'] as const) {
      const sessionId = `ac442-refuse-${provider}`;
      seedSession(sessionId, provider);

      let thrown: unknown;
      try {
        sessionsService.switchSessionLifecycleMode(provider, sessionId, 'resident');
      } catch (error) {
        thrown = error;
      }

      assert.ok(thrown, `provider=${provider} must refuse resident, but the write returned`);
      assert.ok(
        isLifecycleModeRefusal(thrown),
        `provider=${provider} must throw LIFECYCLE_MODE_NOT_SUPPORTED/409, got ${String(thrown)}`,
      );
      assert.equal(
        sessionsDb.getSessionLifecycleMode(sessionId),
        'per-run',
        `provider=${provider}: a refused write must not have stored anything`,
      );

      const refusal = thrown as InstanceType<typeof AppError>;
      console.log(
        `provider=${provider} code=${refusal.code} status=${refusal.statusCode} `
          + `stored=${sessionsDb.getSessionLifecycleMode(sessionId)}`,
      );
    }

    // Positive controls: the same call, for providers that do declare resident,
    // must succeed and be readable back. Without this the refusal above could be
    // "this service always refuses" rather than a capability decision.
    for (const provider of ['codex', 'claude'] as const) {
      const sessionId = `ac442-accept-${provider}`;
      seedSession(sessionId, provider);

      const result = sessionsService.switchSessionLifecycleMode(provider, sessionId, 'resident');
      assert.equal(result.changed, true, `provider=${provider}: the write must move the preference`);
      assert.equal(
        sessionsDb.getSessionLifecycleMode(sessionId),
        'resident',
        `provider=${provider}: the accepted mode must be stored`,
      );
      console.log(`provider=${provider} stored=${sessionsDb.getSessionLifecycleMode(sessionId)}`);
    }
  });
});

// ---------------------------
//--------------- (c) WHOSE MATRIX DECIDES: THE SESSION'S, NOT THE PATH'S ------------
test('(c) the matrix follows the session provider, not the provider in the path', async () => {
  await withIsolatedDatabase(() => {
    const sessionId = 'ac442-path-vs-session';
    seedSession(sessionId, 'cursor');

    let thrown: unknown;
    try {
      // The route family passes the path provider as a label; `codex` now
      // declares resident, so a matrix read off the path would accept this.
      sessionsService.switchSessionLifecycleMode('codex', sessionId, 'resident');
    } catch (error) {
      thrown = error;
    }

    assert.ok(thrown, 'naming codex in the path must not make a cursor session resident');
    assert.ok(isLifecycleModeRefusal(thrown), `the refusal must be the lifecycle one, got ${String(thrown)}`);
    assert.equal(
      sessionsDb.getSessionLifecycleMode(sessionId),
      'per-run',
      'the disguised write must not land either',
    );

    const refusal = thrown as InstanceType<typeof AppError>;
    console.log(
      `pathProvider=codex sessionProvider=cursor code=${refusal.code} `
        + `stored=${sessionsDb.getSessionLifecycleMode(sessionId)}`,
    );
  });
});

// ---------------------------
//--------------- (d) THE DECLARATION IS CARRIED BY THE MOUNTED DRIVER ------------
test('(d) codex mounts the resident driver its declaration claims', () => {
  const codex = providerRegistry.resolveProvider('codex') as ProviderMount;

  assertHostDriverMounted(codex);

  // Reverse control: the same assertion, fed a row with no driver, must reject.
  // Otherwise "mounted=true" would be true of any object handed to the helper.
  const reverseRejected = (() => {
    try {
      assertHostDriverMounted({ id: 'codex', hostDriver: undefined });
      return false;
    } catch {
      return true;
    }
  })();
  assert.equal(reverseRejected, true, 'the mounting assertion must reject a row without a driver');

  console.log(
    `mounted=${Boolean(codex.hostDriver)} multiplexedHost=${String(codex.hostDriver?.multiplexedHost)} `
      + `reverseRejected=${reverseRejected}`,
  );
});

// ---------------------------
//--------------- (e) AN UNMEASURED CAPABILITY MUST GO RED ------------
/**
 * Reads the codex row out of a copy of the shipping service with one field
 * flipped.
 *
 * Each arm gets its OWN file name because ESM caches a module by URL: writing
 * the second mutant over the first copy's path would import the already-
 * evaluated first module and measure the wrong thing. Both names carry the
 * `__criterion-falsify-` prefix `server/tsconfig.json` excludes, and both are
 * removed in `finally`.
 *
 * The anchor includes the codex-specific comment, so `split(anchor)` must hit
 * exactly once. A zero-hit mutation (the shipping text drifted) is a criterion
 * failure rather than a silent green: a false form that replaces nothing tests
 * nothing.
 */
async function readFalsifiedCodexRow(slug: string, anchor: string): Promise<MatrixRow> {
  const source = await readFile(SHIPPING_SERVICE_MODULE, 'utf8');
  const hits = source.split(anchor).length - 1;
  assert.equal(hits, 1, `the falsifying mutation must hit exactly one line (hit ${hits}): ${anchor}`);

  const copyPath = path.join(
    SERVICE_DIRECTORY,
    `__criterion-falsify-resident-features-${slug}-${process.pid}.ts`,
  );
  await writeFile(copyPath, source.replace(anchor, anchor.replace(': false', ': true')), 'utf8');

  try {
    const mutated = (await import(pathToFileURL(copyPath).href)) as {
      providerCapabilitiesService: { getProviderCapabilities(provider: 'codex'): MatrixRow };
    };
    return mutated.providerCapabilitiesService.getProviderCapabilities('codex');
  } finally {
    await rm(copyPath, { force: true });
    await assert.rejects(access(copyPath), 'the falsifying copy must be gone after the arm');
  }
}

test('(e) claiming an unmeasured capability turns the matrix reading red', async () => {
  const shipping = providerCapabilitiesService.getProviderCapabilities('codex') as MatrixRow;
  assert.doesNotThrow(() => assertMatrixReading(shipping), 'the shipping row must clear the reading');

  const falsifiedBackground = await readFalsifiedCodexRow(
    'background',
    'backgroundTasks: false, // E5b: unmeasured',
  );
  assert.equal(
    falsifiedBackground.residentFeatures?.backgroundTasks,
    true,
    'the mutation must really change the copied row',
  );
  const backgroundRed = (() => {
    try {
      assertMatrixReading(falsifiedBackground);
      return false;
    } catch {
      return true;
    }
  })();
  assert.equal(backgroundRed, true, 'the reading must reject a row that claims unmeasured backgroundTasks');

  const falsifiedLeases = await readFalsifiedCodexRow(
    'leases',
    'authoritativeLeases: false, // unmeasured: no CLI liveness event',
  );
  const leasesRed = (() => {
    try {
      assertMatrixReading(falsifiedLeases);
      return false;
    } catch {
      return true;
    }
  })();
  assert.equal(leasesRed, true, 'the reading must reject a row that claims unmeasured authoritativeLeases');

  console.log(
    `shippingBackgroundTasks=${String(shipping.residentFeatures?.backgroundTasks)} `
      + `falsifiedBackgroundTasks=${String(falsifiedBackground.residentFeatures?.backgroundTasks)} `
      + `redOnCraft=${backgroundRed && leasesRed}`,
  );
});

// ---------------------------
//--------------- (f) liveReconfigure DOES NOT OVER-CLAIM ------------
test('(f) liveReconfigure names only the verbs E4 measured', () => {
  const features = (providerCapabilitiesService.getProviderCapabilities('codex') as MatrixRow).residentFeatures;
  assert.ok(features, 'codex must carry residentFeatures');

  assert.deepEqual(features.liveReconfigure, ['model', 'effort']);
  assert.ok(
    !features.liveReconfigure.includes('permissionMode'),
    'E4 never measured an online permissionMode → (approvalPolicy, sandboxPolicy) mapping',
  );

  console.log(
    `liveReconfigure=${JSON.stringify(features.liveReconfigure)} `
      + `includesPermissionMode=${features.liveReconfigure.includes('permissionMode')}`,
  );
});

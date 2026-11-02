/**
 * AC (d) of `gap-server-root-browser-use-cycle-relocate-mcp-entry` — the MCP stdio entrypoint
 * still starts, and it still installs the server root's environment bootstrap.
 *
 * The task moved the entry from `server/modules/browser-use/browser-use-mcp.ts` into
 * `server/modules/cli/` so that `modules/browser-use` no longer imports the root bootstrap (the
 * `.` ↔ `modules/browser-use` SCC). A relocation that quietly dropped the `../../load-env.js`
 * import would satisfy the import-cycle ratchet and break the feature — the bootstrap supplies
 * `.env` and the default `DATABASE_PATH` the executable reads on start-up — so this criterion
 * drives the entry as a real subprocess instead of reading the file's text:
 *
 *   · leg 1 spawns the entry, writes ONE newline-delimited JSON-RPC `initialize` request to its
 *     stdin, and asserts the reply's `serverInfo.name`;
 *   · leg 2 imports the entry in a child that does NOT set `DATABASE_PATH` and asserts the
 *     bootstrap's user-level default (`~/.cloudpit/auth.db`) is in `process.env`, which is the
 *     deterministic observable of "load-env ran" — the presence of a `.env` file is not
 *     guaranteed, so the bootstrap itself cannot be observed through it.
 *
 * Both legs run the TypeScript source through `tsx` from the repository root: the entry is an
 * ESM module whose relative `../../load-env.js` resolves the same way from source and from the
 * built tree.
 */
import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import http from 'node:http';
import { mkdtemp, rm, writeFile } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import test from 'node:test';
import { fileURLToPath, pathToFileURL } from 'node:url';

const TEST_DIRECTORY = path.dirname(fileURLToPath(import.meta.url));
const APPLICATION_ROOT = path.resolve(TEST_DIRECTORY, '..', '..', '..', '..');
const TSX_CLI = path.join(APPLICATION_ROOT, 'node_modules', 'tsx', 'dist', 'cli.mjs');
const SERVER_TSCONFIG = path.join(APPLICATION_ROOT, 'server', 'tsconfig.json');
const ENTRY_PATH = path.join(APPLICATION_ROOT, 'server', 'modules', 'cli', 'browser-use-mcp.ts');

/** The expected MCP server identity, pinned at `browser-use-mcp.ts`'s `initialize` handler. */
const EXPECTED_SERVER_NAME = 'cloudpit-browser';

/** The default the root bootstrap installs when `DATABASE_PATH` is unset (`server/load-env.ts`). */
function expectedDefaultDatabasePath(homeDirectory: string): string {
  return path.join(homeDirectory, '.cloudpit', 'auth.db');
}

/** Prepended to leg 2's probe output so it is locatable in a stream that may carry other lines. */
const BOOTSTRAP_PROBE_MARKER = '__CLOUDCLI_MCP_BOOTSTRAP__';

/**
 * A child environment with no inherited `DATABASE_PATH` and an isolated HOME. The isolated HOME
 * matters: the bootstrap's Cloudpit default migrates a legacy layout, and a probe must not touch
 * the developer's real `~/.cloudcli`.
 */
function environmentWithoutDatabasePath(homeDirectory?: string): NodeJS.ProcessEnv {
  const environment: NodeJS.ProcessEnv = { ...process.env };
  delete environment.DATABASE_PATH;
  if (homeDirectory !== undefined) environment.HOME = homeDirectory;
  return environment;
}

/** spawn()s `tsx <entry>`; the caller owns the child. */
function spawnWithTsx(scriptPath: string, environment: NodeJS.ProcessEnv) {
  return spawn(process.execPath, [TSX_CLI, '--tsconfig', SERVER_TSCONFIG, scriptPath], {
    cwd: APPLICATION_ROOT,
    env: environment,
    stdio: ['pipe', 'pipe', 'pipe'],
  });
}

/**
 * Leg 1: starts the entry exactly as a host would, asks `initialize`, and returns the whole
 * reply line as well as its parsed `result` (the raw line is what the task asks to paste).
 */
function requestInitialize(timeoutMs = 60_000): Promise<{ rawLine: string; result: Record<string, unknown> }> {
  return mkdtemp(path.join(os.tmpdir(), 'cloudpit-mcp-entry-home-')).then((isolatedHome) => new Promise<{ rawLine: string; result: Record<string, unknown> }>((resolve, reject) => {
    const child = spawnWithTsx(ENTRY_PATH, environmentWithoutDatabasePath(isolatedHome));
    let stdout = '';
    let stderr = '';
    let settled = false;

    const finish = (error: Error | null, value?: { rawLine: string; result: Record<string, unknown> }) => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      child.kill('SIGKILL');
      if (error) reject(error);
      else resolve(value as { rawLine: string; result: Record<string, unknown> });
    };

    const timer = setTimeout(() => {
      finish(new Error(`the MCP entry did not answer initialize within ${timeoutMs}ms\nstdout:\n${stdout}\nstderr:\n${stderr}`));
    }, timeoutMs);

    child.stdout.setEncoding('utf8');
    child.stdout.on('data', (chunk: string) => {
      stdout += chunk;
      for (const line of stdout.split('\n')) {
        if (!line.trim()) continue;
        let parsed: unknown;
        try {
          parsed = JSON.parse(line);
        } catch {
          continue; // Not a JSON-RPC frame (e.g. an interleaved diagnostic); keep reading.
        }
        const frame = parsed as { result?: Record<string, unknown>; error?: unknown };
        if (frame.result) finish(null, { rawLine: line, result: frame.result });
        if (frame.error) finish(new Error(`the MCP entry answered initialize with an error: ${line}`));
      }
    });
    child.stderr.setEncoding('utf8');
    child.stderr.on('data', (chunk: string) => {
      stderr += chunk;
    });
    child.on('error', (error) => finish(error instanceof Error ? error : new Error(String(error))));
    child.on('exit', (code) => {
      finish(new Error(`the MCP entry exited (code ${String(code)}) before answering initialize\nstdout:\n${stdout}\nstderr:\n${stderr}`));
    });

    // MCP stdio framing: one JSON-RPC message per line, no Content-Length header.
    child.stdin.write(`${JSON.stringify({
      jsonrpc: '2.0',
      id: 1,
      method: 'initialize',
      params: {
        protocolVersion: '2024-11-05',
        capabilities: {},
        clientInfo: { name: 'browser-use-mcp-entry-smoke', version: '0.0.0' },
      },
    })}\n`);
  }).finally(() => rm(isolatedHome, { recursive: true, force: true })));
}

/**
 * Leg 2: imports the entry in a fresh child, then prints what the bootstrap left in the
 * environment. The probe is a `.mts` file in a temp directory because `tsx` only transforms
 * files, not `--eval` strings, and it must not be collected by the suite's `*.test.ts` walk.
 */
async function readBootstrapEnvironment(): Promise<{ databasePath: string | null; homeDirectory: string }> {
  const probeDirectory = await mkdtemp(path.join(os.tmpdir(), 'cloudcli-mcp-bootstrap-'));
  try {
    const probePath = path.join(probeDirectory, 'bootstrap-probe.mts');
    const probeSource = [
      `import ${JSON.stringify(pathToFileURL(ENTRY_PATH).href)};`,
      '',
      '// The entry listens on stdin for JSON-RPC frames. Reading the environment and exiting is the',
      '// probe\'s whole job, so it must not wait for a frame that will never arrive.',
      `process.stdout.write(${JSON.stringify(BOOTSTRAP_PROBE_MARKER)} + JSON.stringify({`,
      '  databasePath: process.env.DATABASE_PATH ?? null,',
      `}) + "\\n");`,
      'process.exit(0);',
      '',
    ].join('\n');
    await writeFile(probePath, probeSource, 'utf8');

    const stdout = await new Promise<string>((resolve, reject) => {
      // HOME is the probe directory: the default is still the bootstrap's, but the migration it
      // may run cannot touch the developer's real `~/.cloudcli`.
      const child = spawnWithTsx(probePath, environmentWithoutDatabasePath(probeDirectory));
      let collected = '';
      let stderr = '';
      const timer = setTimeout(() => {
        child.kill('SIGKILL');
        reject(new Error(`the bootstrap probe did not finish within 60s\nstdout:\n${collected}\nstderr:\n${stderr}`));
      }, 60_000);
      child.stdout.setEncoding('utf8');
      child.stdout.on('data', (chunk: string) => {
        collected += chunk;
      });
      child.stderr.setEncoding('utf8');
      child.stderr.on('data', (chunk: string) => {
        stderr += chunk;
      });
      child.on('error', (error) => {
        clearTimeout(timer);
        reject(error instanceof Error ? error : new Error(String(error)));
      });
      child.on('exit', (code) => {
        clearTimeout(timer);
        if (code === 0) resolve(collected);
        else reject(new Error(`the bootstrap probe exited with code ${String(code)}\nstdout:\n${collected}\nstderr:\n${stderr}`));
      });
    });

    const markerLine = stdout.split('\n').find((line) => line.includes(BOOTSTRAP_PROBE_MARKER));
    assert.ok(markerLine, `the bootstrap probe printed nothing — the entry never finished importing\nstdout:\n${stdout}`);
    return {
      ...(JSON.parse(markerLine.slice(markerLine.indexOf(BOOTSTRAP_PROBE_MARKER) + BOOTSTRAP_PROBE_MARKER.length)) as {
        databasePath: string | null;
      }),
      homeDirectory: probeDirectory,
    };
  } finally {
    await rm(probeDirectory, { recursive: true, force: true });
  }
}

// ── brand-env wiring legs (gap-cloudpit-brand-env-reader-wiring) ───────────

/** One HTTP request the MCP entry forwarded to the Browser API. */
type CapturedApiRequest = {
  path: string;
  authorization: string | undefined;
};

/**
 * Start a fake Browser API that records what the entry forwards.
 *
 * `browser_list_sessions` needs no arguments and reaches the API immediately,
 * so an authorize/path reading here is a direct observation of the
 * `apiUrl`/`apiToken` the entry resolved on start-up.
 */
async function startBrowserApiCapture(): Promise<{
  baseUrl: string;
  requests: CapturedApiRequest[];
  close: () => Promise<void>;
}> {
  const requests: CapturedApiRequest[] = [];
  const server = http.createServer((request, response) => {
    let body = '';
    request.setEncoding('utf8');
    request.on('data', (chunk: string) => {
      body += chunk;
    });
    request.on('end', () => {
      requests.push({ path: request.url || '', authorization: request.headers.authorization });
      response.writeHead(200, { 'Content-Type': 'application/json' });
      response.end(JSON.stringify({ success: true, data: [] }));
    });
  });

  await new Promise<void>((resolve, reject) => {
    server.once('error', reject);
    server.listen(0, '127.0.0.1', () => resolve());
  });

  const address = server.address();
  if (!address || typeof address === 'string') {
    await new Promise<void>((resolve) => server.close(() => resolve()));
    throw new Error('the fake Browser API did not bind to a TCP port');
  }

  return {
    baseUrl: `http://127.0.0.1:${address.port}`,
    requests,
    close: () => new Promise<void>((resolve) => server.close(() => resolve())),
  };
}

/** Every browser-use brand variable this criterion controls. */
const BROWSER_USE_BRAND_ENV_KEYS = [
  'CLOUDPIT_BROWSER_USE_API_URL',
  'CLOUDCLI_BROWSER_USE_API_URL',
  'CLOUDPIT_BROWSER_USE_MCP_TOKEN',
  'CLOUDCLI_BROWSER_USE_MCP_TOKEN',
  'CLOUDPIT_BROWSER_USE_API_TIMEOUT_MS',
  'CLOUDCLI_BROWSER_USE_API_TIMEOUT_MS',
];

/** A child environment with every browser-use brand variable cleared, then `overrides`. */
function browserUseEnvironment(
  overrides: Record<string, string>,
  homeDirectory: string,
): NodeJS.ProcessEnv {
  const environment = environmentWithoutDatabasePath(homeDirectory);
  for (const key of BROWSER_USE_BRAND_ENV_KEYS) {
    delete environment[key];
  }
  return { ...environment, ...overrides };
}

/** Call `browser_list_sessions` through the entry and return the child's output. */
function requestBrowserListSessions(
  environment: NodeJS.ProcessEnv,
  timeoutMs = 60_000,
): Promise<{ stdout: string; stderr: string }> {
  return new Promise((resolve, reject) => {
    const child = spawnWithTsx(ENTRY_PATH, environment);
    let stdout = '';
    let stderr = '';
    let settled = false;

    const finish = (error: Error | null) => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      child.kill('SIGKILL');
      if (error) reject(error);
      else resolve({ stdout, stderr });
    };

    const timer = setTimeout(() => {
      finish(new Error(`the MCP entry did not answer tools/call within ${timeoutMs}ms\nstdout:\n${stdout}\nstderr:\n${stderr}`));
    }, timeoutMs);

    child.stdout.setEncoding('utf8');
    child.stdout.on('data', (chunk: string) => {
      stdout += chunk;
      for (const line of stdout.split('\n')) {
        if (!line.trim()) continue;
        let parsed: unknown;
        try {
          parsed = JSON.parse(line);
        } catch {
          continue; // Not a JSON-RPC frame; keep reading.
        }
        const frame = parsed as { id?: unknown };
        if (frame.id === 2) finish(null);
      }
    });
    child.stderr.setEncoding('utf8');
    child.stderr.on('data', (chunk: string) => {
      stderr += chunk;
    });
    child.on('error', (error) => finish(error instanceof Error ? error : new Error(String(error))));
    child.on('exit', (code) => {
      finish(new Error(`the MCP entry exited (code ${String(code)}) before answering tools/call\nstdout:\n${stdout}\nstderr:\n${stderr}`));
    });

    child.stdin.write(`${JSON.stringify({
      jsonrpc: '2.0',
      id: 1,
      method: 'initialize',
      params: {},
    })}\n`);
    child.stdin.write(`${JSON.stringify({
      jsonrpc: '2.0',
      id: 2,
      method: 'tools/call',
      params: { name: 'browser_list_sessions', arguments: {} },
    })}\n`);
  });
}

/** Count non-overlapping occurrences of `needle` in `haystack`. */
function countOccurrences(haystack: string, needle: string): number {
  return haystack.split(needle).length - 1;
}

test('the relocated MCP entry answers initialize as cloudpit-browser', async () => {
  const reply = await requestInitialize();
  console.log(`(d) initialize reply: ${reply.rawLine}`);

  const serverInfo = reply.result.serverInfo as { name?: unknown; version?: unknown } | undefined;
  assert.ok(serverInfo && typeof serverInfo === 'object', `the initialize result must carry serverInfo: ${reply.rawLine}`);
  assert.equal(serverInfo.name, EXPECTED_SERVER_NAME, `serverInfo.name must stay ${EXPECTED_SERVER_NAME}: ${reply.rawLine}`);
  assert.equal(reply.result.protocolVersion, '2024-11-05', 'the MCP protocol version must stay pinned');
});

test('the relocated MCP entry still installs the root environment bootstrap', async () => {
  const reading = await readBootstrapEnvironment();
  const expectedDefault = expectedDefaultDatabasePath(reading.homeDirectory);
  console.log(`(d) bootstrap DATABASE_PATH=${String(reading.databasePath)} expected=${expectedDefault}`);
  console.log(`(d) probe legs: entry=${path.relative(APPLICATION_ROOT, ENTRY_PATH)}, DATABASE_PATH unset in the child`);

  // NOTE: this assertion is exact on purpose. It holds when neither the child environment nor a
  // repository `.env` sets DATABASE_PATH; no `.env` is committed (`git check-ignore .env`), and the
  // suite runs in worktrees that carry none, so the bootstrap's default is the only source.
  assert.equal(
    reading.databasePath,
    expectedDefault,
    'importing the entry must run server/load-env.ts, which installs the user-level default DATABASE_PATH',
  );
});

test('AC5: CLOUDPIT_* supplies the MCP entry API URL and token', async () => {
  const capture = await startBrowserApiCapture();
  const homeDirectory = await mkdtemp(path.join(os.tmpdir(), 'cloudpit-mcp-brand-env-'));
  try {
    const output = await requestBrowserListSessions(browserUseEnvironment({
      CLOUDPIT_BROWSER_USE_API_URL: `${capture.baseUrl}/api/new`,
      CLOUDPIT_BROWSER_USE_MCP_TOKEN: 'new-token',
      CLOUDCLI_BROWSER_USE_API_URL: `${capture.baseUrl}/api/old`,
      CLOUDCLI_BROWSER_USE_MCP_TOKEN: 'old-token',
    }, homeDirectory));

    assert.equal(
      capture.requests.length,
      1,
      `the entry must reach the fake API exactly once\nstdout:\n${output.stdout}\nstderr:\n${output.stderr}`,
    );
    assert.equal(
      capture.requests[0].path,
      '/api/new/tools/browser_list_sessions',
      'the CLOUDPIT_BROWSER_USE_API_URL spelling must win',
    );
    assert.equal(capture.requests[0].authorization, 'Bearer new-token');
  } finally {
    await capture.close();
    await rm(homeDirectory, { recursive: true, force: true });
  }
});

test('AC5: the legacy spelling still works and warns once per key', async () => {
  const capture = await startBrowserApiCapture();
  const homeDirectory = await mkdtemp(path.join(os.tmpdir(), 'cloudpit-mcp-brand-env-'));
  try {
    const output = await requestBrowserListSessions(browserUseEnvironment({
      CLOUDCLI_BROWSER_USE_API_URL: `${capture.baseUrl}/api/legacy`,
      CLOUDCLI_BROWSER_USE_MCP_TOKEN: 'legacy-token',
    }, homeDirectory));

    assert.equal(
      capture.requests.length,
      1,
      `the entry must reach the fake API exactly once\nstdout:\n${output.stdout}\nstderr:\n${output.stderr}`,
    );
    assert.equal(capture.requests[0].path, '/api/legacy/tools/browser_list_sessions');
    assert.equal(capture.requests[0].authorization, 'Bearer legacy-token');

    assert.equal(
      countOccurrences(output.stderr, 'CLOUDCLI_BROWSER_USE_API_URL is deprecated'),
      1,
      `the legacy API URL must warn exactly once\nstderr:\n${output.stderr}`,
    );
    assert.equal(
      countOccurrences(output.stderr, 'CLOUDCLI_BROWSER_USE_MCP_TOKEN is deprecated'),
      1,
      `the legacy token must warn exactly once\nstderr:\n${output.stderr}`,
    );
  } finally {
    await capture.close();
    await rm(homeDirectory, { recursive: true, force: true });
  }
});

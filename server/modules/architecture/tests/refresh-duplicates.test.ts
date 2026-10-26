/**
 * The per-scope duplicate report criterion (`refresh-duplicates.ts`).
 *
 * Every leg drives the real refresh job over a throwaway project with two injected
 * children: the analysis stand-in writes the staged `query/` artifacts, and the
 * ArchGuard MCP stand-in speaks the same newline-delimited JSON-RPC the released CLI
 * speaks. Legs (a) and (b) differ only in where the MCP stand-in persists its report
 * (flat files vs. the per-scope directory), which is exactly the old/new ArchGuard
 * seam this module has to bridge. Leg (c) proves a broken duplicate step leaves the
 * refresh `succeeded` with the reason in the stderr tail.
 *
 * Run directly:
 *   npx tsx --tsconfig server/tsconfig.json --import ./scripts/undici-blocked-ports-preload.mjs \
 *     --test server/modules/architecture/tests/refresh-duplicates.test.ts
 */
import assert from 'node:assert/strict';
import { EventEmitter } from 'node:events';
import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import test from 'node:test';
import { PassThrough } from 'node:stream';
import type { ChildProcess } from 'node:child_process';

import {
  createArchguardRefreshJob,
  type RefreshDuplicates,
  type RefreshSpawn,
} from '../refreshJob.js';

const CURRENT_KEY = 'aaaaaaaa';
const SECOND_KEY = 'cccccccc';
const STALE_KEY = 'bbbbbbbb';
const OLD_GENERATED_AT = '2026-10-01T00:00:00.000Z';
const NEW_GENERATED_AT = '2026-10-26T09:00:00.000Z';

type SpawnCall = {
  readonly command: string;
  readonly args: readonly string[];
  readonly options: Record<string, unknown>;
};

type JsonRpcRequest = { id?: number; method?: string; params?: Record<string, unknown> };

/** A child stand-in with the three stdio pipes the MCP client talks over. */
class FakeMcpChild extends EventEmitter {
  readonly pid = 999_999_998;
  readonly stdin = new PassThrough();
  readonly stdout = new PassThrough();
  readonly stderr = new PassThrough();
  readonly killSignals: NodeJS.Signals[] = [];

  kill(signal: NodeJS.Signals = 'SIGTERM'): boolean {
    this.killSignals.push(signal);
    setImmediate(() => this.emit('close', null));
    return true;
  }
}

function writeJson(filePath: string, value: unknown): void {
  mkdirSync(path.dirname(filePath), { recursive: true });
  writeFileSync(filePath, `${JSON.stringify(value, null, 2)}\n`, 'utf8');
}

function readJson(filePath: string): unknown {
  return JSON.parse(readFileSync(filePath, 'utf8')) as unknown;
}

type Project = {
  readonly projectPath: string;
  readonly settingsPath: string;
  readonly liveQuery: string;
  readonly srcDir: string;
};

/** A project with a real `.archguard/query` tree, flat duplicates and a stale scope. */
function createProject(t: { after: (fn: () => void) => void }): Project {
  const projectPath = mkdtempSync(path.join(tmpdir(), 'archguard-refresh-duplicates-'));
  t.after(() => rmSync(projectPath, { recursive: true, force: true }));
  const srcDir = path.join(projectPath, 'src');
  mkdirSync(srcDir, { recursive: true });
  mkdirSync(path.join(projectPath, 'server'), { recursive: true });

  const liveQuery = path.join(projectPath, '.archguard', 'query');
  writeJson(path.join(liveQuery, 'manifest.json'), {
    version: '1.0',
    generatedAt: OLD_GENERATED_AT,
    globalScopeKey: CURRENT_KEY,
    scopes: [
      { key: CURRENT_KEY, label: 'src (typescript)', language: 'typescript', sources: [srcDir] },
      { key: STALE_KEY, label: 'chat (typescript)', language: 'typescript', sources: [path.join(srcDir, 'chat')] },
    ],
  });
  writeJson(path.join(liveQuery, CURRENT_KEY, 'arch-index.json'), { archJsonHash: 'old' });
  writeJson(path.join(liveQuery, 'duplicates', 'manifest.json'), {
    version: '1',
    generatedAt: OLD_GENERATED_AT,
    sources: [srcDir],
    scannedFiles: 1,
    scannedFunctions: 1,
    totalGroups: 0,
  });
  writeJson(path.join(liveQuery, 'duplicates', 'groups.json'), []);
  writeJson(path.join(liveQuery, 'duplicates', CURRENT_KEY, 'manifest.json'), { stale: true });
  writeJson(path.join(liveQuery, 'duplicates', STALE_KEY, 'manifest.json'), { stale: true });
  writeJson(path.join(liveQuery, 'git-history', 'commits.json'), { kept: true });
  writeJson(path.join(liveQuery, 'shape-smells', 'report.json'), { kept: true });

  const fakeCli = path.join(projectPath, 'fake-cli.mjs');
  writeFileSync(fakeCli, '// injected spawn only\n', 'utf8');
  const settingsPath = path.join(projectPath, 'server.settings.json');
  writeJson(settingsPath, {
    architecture: { refresh: { cliPath: fakeCli, timeoutMs: 5_000, memoryLimitMb: 0 } },
  });
  return { projectPath, settingsPath, liveQuery, srcDir };
}

/** The new manifest the analysis stand-in publishes (two live scopes). */
function writeStagedManifest(projectPath: string, args: readonly string[]): void {
  const index = args.indexOf('--work-dir');
  assert.ok(index >= 0, 'the analysis child must be told a --work-dir');
  const workDir = args[index + 1];
  assert.ok(workDir !== undefined);
  writeJson(path.join(workDir, 'query', 'manifest.json'), {
    version: '1.0',
    generatedAt: NEW_GENERATED_AT,
    globalScopeKey: CURRENT_KEY,
    scopes: [
      {
        key: CURRENT_KEY,
        label: 'src (typescript)',
        language: 'typescript',
        sources: [path.join(projectPath, 'src')],
      },
      {
        key: SECOND_KEY,
        label: 'server (typescript)',
        language: 'typescript',
        sources: [path.join(projectPath, 'server')],
      },
    ],
  });
  writeJson(path.join(workDir, 'query', CURRENT_KEY, 'arch-index.json'), { archJsonHash: 'new' });
  writeJson(path.join(workDir, 'query', SECOND_KEY, 'arch-index.json'), { archJsonHash: 'new' });
}

/** The fake child pair: analysis writes staged artifacts; MCP lines go to `onRequest`. */
function makeSpawns(onRequest: (request: JsonRpcRequest, child: FakeMcpChild, projectPath: string) => void): {
  spawn: RefreshSpawn;
  calls: SpawnCall[];
} {
  const calls: SpawnCall[] = [];
  const spawn = ((command: string, args: readonly string[], options: Record<string, unknown>) => {
    calls.push({ command, args: [...args], options });
    if (args[1] === 'mcp') {
      const child = new FakeMcpChild();
      const projectPath = String(options.cwd ?? '');
      let buffer = '';
      child.stdin.on('data', (chunk: Buffer) => {
        buffer += chunk.toString('utf8');
        for (let index = buffer.indexOf('\n'); index >= 0; index = buffer.indexOf('\n')) {
          const line = buffer.slice(0, index).trim();
          buffer = buffer.slice(index + 1);
          if (line === '') continue;
          const request = JSON.parse(line) as JsonRpcRequest;
          if (request.method === 'initialize') {
            child.stdout.write(`${JSON.stringify({
              jsonrpc: '2.0',
              id: request.id,
              result: {
                protocolVersion: '2024-11-05',
                capabilities: {},
                serverInfo: { name: 'archguard', version: 'fake' },
              },
            })}\n`);
          } else if (request.method === 'tools/call') {
            onRequest(request, child, projectPath);
          }
        }
      });
      return child as unknown as ChildProcess;
    }

    const analysis = new EventEmitter() as EventEmitter & {
      pid: number; stderr: EventEmitter; kill: (signal?: string) => boolean;
    };
    analysis.pid = 999_999_997;
    analysis.stderr = new EventEmitter();
    analysis.kill = () => true;
    writeStagedManifest(String(options.cwd ?? ''), args);
    setImmediate(() => analysis.emit('close', 0));
    return analysis as unknown as ChildProcess;
  }) as unknown as RefreshSpawn;
  return { spawn, calls };
}

function respond(child: FakeMcpChild, request: JsonRpcRequest, payload: unknown): void {
  child.stdout.write(`${JSON.stringify({
    jsonrpc: '2.0',
    id: request.id,
    result: { content: [{ type: 'text', text: JSON.stringify(payload) }] },
  })}\n`);
}

function waitFor(predicate: () => boolean, timeoutMs = 5_000): Promise<void> {
  const startedAt = Date.now();
  return new Promise((resolve, reject) => {
    const tick = (): void => {
      if (predicate()) return resolve();
      if (Date.now() - startedAt > timeoutMs) return reject(new Error('condition did not hold before the deadline'));
      setTimeout(tick, 5);
    };
    tick();
  });
}

const STUB_DUPLICATES: RefreshDuplicates = {
  refresh: async () => ({ ok: true, index: { version: '1.0', generatedAt: '', entries: [] } }),
};

test('legacy flat reports are relocated per scope and indexed one-to-one', async (t) => {
  const { projectPath, settingsPath, liveQuery, srcDir } = createProject(t);
  const serverDir = path.join(projectPath, 'server');
  const byScope: Record<string, { manifest: Record<string, unknown>; groups: unknown[] }> = {
    [CURRENT_KEY]: {
      manifest: {
        version: '1',
        generatedAt: NEW_GENERATED_AT,
        sources: [srcDir],
        scannedFiles: 12,
        scannedFunctions: 5,
        totalGroups: 2,
      },
      groups: [{ hash: 'h1', tokenCount: 60, savableLines: 9 }],
    },
    [SECOND_KEY]: {
      manifest: {
        version: '1',
        generatedAt: NEW_GENERATED_AT,
        sources: [serverDir],
        scannedFiles: 30,
        scannedFunctions: 11,
        totalGroups: 4,
      },
      groups: [{ hash: 'h2', tokenCount: 90, savableLines: 20 }],
    },
  };
  const { spawn } = makeSpawns((request, child, root) => {
    const scope = String((request.params?.arguments as Record<string, unknown> | undefined)?.scope ?? '');
    const data = byScope[scope];
    assert.ok(data !== undefined, `unexpected scope ${scope}`);
    // The released CLI's own persist step: one flat pair, overwritten per scope.
    writeJson(path.join(root, '.archguard', 'query', 'duplicates', 'manifest.json'), data.manifest);
    writeJson(path.join(root, '.archguard', 'query', 'duplicates', 'groups.json'), data.groups);
    respond(child, request, data);
  });
  const job = createArchguardRefreshJob({
    resolveProjectPath: () => projectPath,
    settingsPath,
    spawnImpl: spawn,
    hasSystemdRun: () => false,
  });

  job.start('project-1');
  await waitFor(() => job.status('project-1').state === 'succeeded');

  for (const [key, label, sources] of [
    [CURRENT_KEY, 'src (typescript)', srcDir],
    [SECOND_KEY, 'server (typescript)', serverDir],
  ] as const) {
    const scopeDir = path.join(liveQuery, 'duplicates', key);
    const scopeManifest = readJson(path.join(scopeDir, 'manifest.json')) as Record<string, unknown>;
    assert.equal(scopeManifest.scopeKey, key, 'the relocated manifest carries its scope key');
    assert.equal(scopeManifest.label, label, 'and the manifest label');
    assert.deepEqual(readJson(path.join(scopeDir, 'groups.json')), byScope[key]?.groups);
    assert.deepEqual(scopeManifest.sources, [sources], 'each scope keeps its own sources');
  }
  assert.ok(
    !existsSync(path.join(liveQuery, 'duplicates', 'manifest.json')),
    'the flat manifest must not survive the relocation',
  );
  assert.ok(
    !existsSync(path.join(liveQuery, 'duplicates', 'groups.json')),
    'the flat groups must not survive the relocation',
  );

  const index = readJson(path.join(liveQuery, 'duplicates', 'index.json')) as {
    entries: Array<Record<string, unknown>>;
  };
  assert.deepEqual(index.entries, [
    {
      scopeKey: CURRENT_KEY,
      label: 'src (typescript)',
      sources: [srcDir],
      scannedFiles: 12,
      scannedFunctions: 5,
      totalGroups: 2,
      generatedAt: NEW_GENERATED_AT,
    },
    {
      scopeKey: SECOND_KEY,
      label: 'server (typescript)',
      sources: [serverDir],
      scannedFiles: 30,
      scannedFunctions: 11,
      totalGroups: 4,
      generatedAt: NEW_GENERATED_AT,
    },
  ]);
});

test('a report the tool wrote per scope itself is left byte-for-byte untouched', async (t) => {
  const { projectPath, settingsPath, liveQuery, srcDir } = createProject(t);
  const serverDir = path.join(projectPath, 'server');
  const written = new Map<string, string>();
  const { spawn } = makeSpawns((request, child, root) => {
    const scope = String((request.params?.arguments as Record<string, unknown> | undefined)?.scope ?? '');
    const sources = scope === CURRENT_KEY ? [srcDir] : [serverDir];
    const scopeDir = path.join(root, '.archguard', 'query', 'duplicates', scope);
    const manifest = {
      version: '1',
      scopeKey: scope,
      label: scope === CURRENT_KEY ? 'src (typescript)' : 'server (typescript)',
      generatedAt: NEW_GENERATED_AT,
      sources,
      scannedFiles: 7,
      scannedFunctions: 3,
      totalGroups: 1,
    };
    const groups = [{ hash: `new-format-${scope}`, savableLines: 4 }];
    writeJson(path.join(scopeDir, 'manifest.json'), manifest);
    writeJson(path.join(scopeDir, 'groups.json'), groups);
    written.set(`${scope}-manifest`, readFileSync(path.join(scopeDir, 'manifest.json'), 'utf8'));
    written.set(`${scope}-groups`, readFileSync(path.join(scopeDir, 'groups.json'), 'utf8'));
    respond(child, request, { manifest, groups });
  });
  const job = createArchguardRefreshJob({
    resolveProjectPath: () => projectPath,
    settingsPath,
    spawnImpl: spawn,
    hasSystemdRun: () => false,
  });

  job.start('project-1');
  await waitFor(() => job.status('project-1').state === 'succeeded');

  for (const scope of [CURRENT_KEY, SECOND_KEY]) {
    const scopeDir = path.join(liveQuery, 'duplicates', scope);
    assert.equal(
      readFileSync(path.join(scopeDir, 'manifest.json'), 'utf8'),
      written.get(`${scope}-manifest`),
      `scope ${scope}: the manifest the tool wrote must not be rewritten`,
    );
    assert.equal(
      readFileSync(path.join(scopeDir, 'groups.json'), 'utf8'),
      written.get(`${scope}-groups`),
      `scope ${scope}: the groups the tool wrote must not be rewritten`,
    );
  }
  assert.ok(!existsSync(path.join(liveQuery, 'duplicates', 'manifest.json')));
  const index = readJson(path.join(liveQuery, 'duplicates', 'index.json')) as {
    entries: Array<Record<string, unknown>>;
  };
  assert.deepEqual(index.entries.map((entry) => entry.scopeKey), [CURRENT_KEY, SECOND_KEY]);
});

test('a failing MCP server keeps the refresh succeeded and records the reason in the stderr tail', async (t) => {
  const { projectPath, settingsPath } = createProject(t);
  const { spawn } = makeSpawns((request, child) => {
    child.stdout.write(`${JSON.stringify({
      jsonrpc: '2.0',
      id: request.id,
      result: { isError: true, content: [{ type: 'text', text: 'scope scan exploded' }] },
    })}\n`);
  });
  const job = createArchguardRefreshJob({
    resolveProjectPath: () => projectPath,
    settingsPath,
    spawnImpl: spawn,
    hasSystemdRun: () => false,
  });

  job.start('project-1');
  await waitFor(() => job.status('project-1').state === 'succeeded');

  const status = job.status('project-1');
  assert.equal(status.state, 'succeeded', 'the analysis succeeded even though duplicate detection did not');
  assert.equal(status.error, null);
  assert.ok(
    status.stderrTail.some((line) => line.includes('duplicates refresh failed') && line.includes('scope scan exploded')),
    `stderr tail must carry the reason: ${JSON.stringify(status.stderrTail)}`,
  );
});

test('publishing drops the flat duplicates pair and a stale scope but keeps live scopes and other carriers', async (t) => {
  const { projectPath, settingsPath, liveQuery } = createProject(t);
  const { spawn } = makeSpawns(() => {
    throw new Error('duplicate detection must not run in this leg');
  });
  const job = createArchguardRefreshJob({
    resolveProjectPath: () => projectPath,
    settingsPath,
    spawnImpl: spawn,
    hasSystemdRun: () => false,
    duplicatesRefresh: STUB_DUPLICATES,
  });

  job.start('project-1');
  await waitFor(() => job.status('project-1').state === 'succeeded');

  const duplicatesRoot = path.join(liveQuery, 'duplicates');
  assert.ok(!existsSync(path.join(duplicatesRoot, 'manifest.json')), 'no flat manifest after publish');
  assert.ok(!existsSync(path.join(duplicatesRoot, 'groups.json')), 'no flat groups after publish');
  assert.ok(!existsSync(path.join(duplicatesRoot, STALE_KEY)), 'a scope the new manifest dropped is discarded');
  assert.ok(existsSync(path.join(duplicatesRoot, CURRENT_KEY, 'manifest.json')), 'a live scope carrier is kept');
  assert.deepEqual(readJson(path.join(liveQuery, 'git-history', 'commits.json')), { kept: true });
  assert.deepEqual(readJson(path.join(liveQuery, 'shape-smells', 'report.json')), { kept: true });
});

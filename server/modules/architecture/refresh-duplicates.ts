/**
 * Per-scope duplicate reports for the manual ArchGuard refresh.
 *
 * WHY THIS EXISTS. `archguard analyze` writes the query manifest and the scope
 * artifacts, but not the duplicate report — `duplicates/` used to be a one-off MCP
 * call's leftovers that every refresh carried forward unchanged, which is how a
 * server-only 10-20 report came to be read as "the whole project has few
 * duplicates". This step recomputes the report once per scope after the analysis
 * has been published.
 *
 * THE CLI IS A CHILD PROCESS, NEVER A SHELL. `archguard` has no duplicate
 * subcommand, so the only entry point is its stdio MCP server: the child is
 * `node <cli> mcp` spawned as an argv array, spoken to with newline-delimited
 * JSON-RPC (`initialize`, then one `archguard_detect_duplicates` per scope).
 *
 * THE ON-DISK SHAPE (the contract agreed with ArchGuard; see the task's Proposal):
 *   duplicates/index.json            { version, generatedAt, entries: [...] }
 *   duplicates/<scopeKey>/manifest.json   the DuplicateManifest + scopeKey + label
 *   duplicates/<scopeKey>/groups.json     DuplicateGroup[]
 * A new ArchGuard writes those scope directories itself; the released CLI still
 * writes the flat `duplicates/{manifest,groups}.json`, which this module relocates
 * after each call. The scope directory and the flat pair are cleared before a call
 * so "the tool already wrote it" always means *this* call, never a stale carry.
 *
 * FAILURE IS NOT THE REFRESH'S FAILURE. Every error is returned as
 * `{ ok: false, error }`; `refreshJob.ts` records it in the stderr tail and logs a
 * line, but still finishes the job `succeeded` — the analysis itself was fine.
 *
 * Consumers: `refreshJob.ts` (the success path, after the staged query is
 * installed); `tests/refresh-duplicates.test.ts` injects the spawn.
 */
import { promises as fsPromises } from 'node:fs';
import path from 'node:path';

import { readObjectRecord } from '@/shared/utils.js';

import { spawnChildProcess, type ChildProcess, type RefreshSpawn } from './refresh-spawn.js';

/** One manifest scope this step detects duplicates for. */
type DuplicatesScope = { readonly key: string; readonly label: string };

/** One `index.json` entry: the manifest fields the tab reads, per scope. */
export type DuplicatesIndexEntry = {
  readonly scopeKey: string;
  readonly label: string;
  readonly sources: readonly string[];
  readonly scannedFiles: number;
  readonly scannedFunctions: number;
  readonly totalGroups: number;
  readonly generatedAt: string;
};

/** The per-scope index written under `.archguard/query/duplicates/index.json`. */
export type DuplicatesIndex = {
  readonly version: string;
  readonly generatedAt: string;
  readonly entries: readonly DuplicatesIndexEntry[];
};

/** The result the job records; a failure never rejects and never fails the job. */
export type RefreshDuplicatesResult =
  | { readonly ok: true; readonly index: DuplicatesIndex }
  | { readonly ok: false; readonly error: string };

/** The surface the refresh job composes. */
export type RefreshDuplicates = {
  refresh(projectPath: string, cliPath: string): Promise<RefreshDuplicatesResult>;
};

/** The MCP request ceiling; the duplicate scan of a large scope is the slow part. */
const DEFAULT_REQUEST_TIMEOUT_MS = 5 * 60 * 1000;

const DUPLICATES_DIR = path.join('.archguard', 'query', 'duplicates');

function finiteNumber(value: unknown): number {
  return typeof value === 'number' && Number.isFinite(value) ? value : 0;
}

function stringArray(value: unknown): string[] {
  return Array.isArray(value) ? value.filter((item): item is string => typeof item === 'string') : [];
}

async function readJson(filePath: string): Promise<unknown> {
  return JSON.parse(await fsPromises.readFile(filePath, 'utf8')) as unknown;
}

async function exists(filePath: string): Promise<boolean> {
  try {
    await fsPromises.access(filePath);
    return true;
  } catch {
    return false;
  }
}

async function writeJson(filePath: string, value: unknown): Promise<void> {
  await fsPromises.mkdir(path.dirname(filePath), { recursive: true });
  await fsPromises.writeFile(filePath, `${JSON.stringify(value, null, 2)}\n`, 'utf8');
}

/** The scopes the new manifest declares; a missing/unreadable manifest is an error. */
async function readScopes(projectPath: string): Promise<DuplicatesScope[]> {
  const manifestPath = path.join(projectPath, '.archguard', 'query', 'manifest.json');
  const parsed = readObjectRecord(await readJson(manifestPath));
  if (parsed === null || !Array.isArray(parsed.scopes)) {
    throw new Error(`${manifestPath} has no scopes array`);
  }
  const scopes: DuplicatesScope[] = [];
  for (const rawScope of parsed.scopes) {
    const scope = readObjectRecord(rawScope);
    if (scope === null || typeof scope.key !== 'string' || scope.key === '') continue;
    scopes.push({
      key: scope.key,
      label: typeof scope.label === 'string' && scope.label !== '' ? scope.label : scope.key,
    });
  }
  if (scopes.length === 0) throw new Error(`${manifestPath} declares no scope keys`);
  return scopes;
}

/** The text block of an MCP `tools/call` result (an `isError` result is a failure). */
function toolResultText(result: Record<string, unknown>): string {
  const content = Array.isArray(result.content) ? result.content : [];
  for (const item of content) {
    const block = readObjectRecord(item);
    if (block !== null && block.type === 'text' && typeof block.text === 'string') return block.text;
  }
  return '';
}

type PendingRequest = {
  resolve: (result: Record<string, unknown>) => void;
  reject: (failure: Error) => void;
  timer: NodeJS.Timeout;
};

/**
 * A minimal newline-delimited JSON-RPC client for the child's stdio.
 *
 * Only stdout lines are parsed; anything that is not a JSON object with a numeric
 * id (log lines, progress notifications) is ignored. A child `error` or `close`
 * rejects every in-flight request, so a broken server can never hang the job.
 */
function createMcpClient(child: ChildProcess, timeoutMs: number): {
  request(method: string, params: Record<string, unknown>): Promise<Record<string, unknown>>;
  notify(method: string, params: Record<string, unknown>): void;
} {
  const pending = new Map<number, PendingRequest>();
  let nextId = 1;
  let buffer = '';
  const stderrTail: string[] = [];

  function rejectAll(reason: string): void {
    for (const entry of pending.values()) {
      clearTimeout(entry.timer);
      entry.reject(new Error(reason));
    }
    pending.clear();
  }

  // A server that dies mid-write must surface through `close`, not as an
  // unhandled stream error on stdin.
  child.stdin?.on('error', () => {});
  child.stdout?.on('error', () => {});
  child.stdout?.on('data', (chunk: Buffer) => {
    buffer += chunk.toString('utf8');
    for (let index = buffer.indexOf('\n'); index >= 0; index = buffer.indexOf('\n')) {
      const line = buffer.slice(0, index).trim();
      buffer = buffer.slice(index + 1);
      if (line === '') continue;
      let message: unknown;
      try {
        message = JSON.parse(line);
      } catch {
        continue;
      }
      const response = readObjectRecord(message);
      if (response === null || typeof response.id !== 'number') continue;
      const entry = pending.get(response.id);
      if (entry === undefined) continue;
      pending.delete(response.id);
      clearTimeout(entry.timer);
      const rpcError = readObjectRecord(response.error);
      if (rpcError !== null) {
        entry.reject(new Error(String(rpcError.message ?? 'MCP request failed')));
      } else {
        entry.resolve(readObjectRecord(response.result) ?? {});
      }
    }
  });
  child.stderr?.on('data', (chunk: Buffer) => {
    for (const line of chunk.toString('utf8').split(/\r?\n/)) {
      if (line.trim() !== '') stderrTail.push(line.trim());
    }
    if (stderrTail.length > 5) stderrTail.splice(0, stderrTail.length - 5);
  });
  child.on('error', (failure) => {
    const reason = failure instanceof Error ? failure.message : String(failure);
    rejectAll(`could not start the ArchGuard MCP server: ${reason}`);
  });
  child.on('close', (code) => {
    if (pending.size === 0) return;
    const detail = stderrTail.at(-1);
    rejectAll(
      `the ArchGuard MCP server closed (exit ${code ?? 'null'})`
      + (detail === undefined ? '' : `: ${detail}`),
    );
  });

  return {
    request(method, params) {
      const id = nextId;
      nextId += 1;
      return new Promise<Record<string, unknown>>((resolve, reject) => {
        const timer = setTimeout(() => {
          pending.delete(id);
          reject(new Error(`the ArchGuard MCP server did not answer ${method} within ${timeoutMs} ms`));
        }, timeoutMs);
        pending.set(id, { resolve, reject, timer });
        child.stdin?.write(`${JSON.stringify({ jsonrpc: '2.0', id, method, params })}\n`);
      });
    },
    notify(method, params) {
      child.stdin?.write(`${JSON.stringify({ jsonrpc: '2.0', method, params })}\n`);
    },
  };
}

/**
 * Clears the scope's target and the legacy flat pair before a call, so the
 * post-call existence check means "written by THIS call" rather than a stale
 * directory the publish step carried over.
 */
async function clearScopeArtifacts(projectPath: string, scopeKey: string): Promise<void> {
  const duplicatesRoot = path.join(projectPath, DUPLICATES_DIR);
  await fsPromises.rm(path.join(duplicatesRoot, scopeKey), { recursive: true, force: true });
  await fsPromises.rm(path.join(duplicatesRoot, 'manifest.json'), { force: true });
  await fsPromises.rm(path.join(duplicatesRoot, 'groups.json'), { force: true });
}

function toEntry(scope: DuplicatesScope, manifest: Record<string, unknown>): DuplicatesIndexEntry {
  return {
    scopeKey: scope.key,
    label: scope.label,
    sources: stringArray(manifest.sources),
    scannedFiles: finiteNumber(manifest.scannedFiles),
    scannedFunctions: finiteNumber(manifest.scannedFunctions),
    totalGroups: finiteNumber(manifest.totalGroups),
    generatedAt: typeof manifest.generatedAt === 'string' ? manifest.generatedAt : '',
  };
}

/**
 * Reads the scope's report into `duplicates/<scopeKey>/`.
 *
 * A directory the tool wrote is left byte-for-byte as it is. Otherwise the legacy
 * flat pair is relocated (the response's own copy is the fallback when the tool
 * could not persist), with `scopeKey`/`label` added to its manifest.
 */
async function collectScope(
  projectPath: string,
  scope: DuplicatesScope,
  analysis: Record<string, unknown>,
): Promise<DuplicatesIndexEntry> {
  const duplicatesRoot = path.join(projectPath, DUPLICATES_DIR);
  const scopeDir = path.join(duplicatesRoot, scope.key);
  const scopeManifestPath = path.join(scopeDir, 'manifest.json');

  if (await exists(scopeManifestPath)) {
    const parsed = readObjectRecord(await readJson(scopeManifestPath));
    if (parsed === null) throw new Error(`${scopeManifestPath} is not a JSON object`);
    return toEntry(scope, parsed);
  }

  const flatManifestPath = path.join(duplicatesRoot, 'manifest.json');
  const flatGroupsPath = path.join(duplicatesRoot, 'groups.json');
  const flatManifestRaw = (await exists(flatManifestPath)) ? await readJson(flatManifestPath) : analysis.manifest;
  const flatGroups = (await exists(flatGroupsPath)) ? await readJson(flatGroupsPath) : analysis.groups;
  const flatManifest = readObjectRecord(flatManifestRaw);
  if (flatManifest === null) {
    throw new Error(`the duplicate report for scope ${scope.key} has no manifest object`);
  }

  const manifest = { ...flatManifest, scopeKey: scope.key, label: scope.label };
  await writeJson(scopeManifestPath, manifest);
  await writeJson(path.join(scopeDir, 'groups.json'), Array.isArray(flatGroups) ? flatGroups : []);
  await fsPromises.rm(flatManifestPath, { force: true });
  await fsPromises.rm(flatGroupsPath, { force: true });
  return toEntry(scope, manifest);
}

/** Ends the child's stdin and makes sure a real process cannot outlive the step. */
function terminate(child: ChildProcess): void {
  try {
    child.stdin?.end();
  } catch {
    // Already closed.
  }
  try {
    child.kill('SIGTERM');
  } catch {
    // Already gone.
  }
  const timer = setTimeout(() => {
    try {
      child.kill('SIGKILL');
    } catch {
      // Already gone.
    }
  }, 2_000);
  timer.unref();
}

/**
 * Creates the per-scope duplicate refresh step.
 *
 * Consumers: `refreshJob.ts` (composition; `refresh` on the published analysis);
 * `tests/refresh-duplicates.test.ts` injects `spawnImpl`, `nodePath` and a short
 * `requestTimeoutMs`.
 */
export function createRefreshDuplicates(options: {
  spawnImpl?: RefreshSpawn;
  nodePath?: string;
  requestTimeoutMs?: number;
  now?: () => number;
} = {}): RefreshDuplicates {
  const spawnChild = options.spawnImpl ?? spawnChildProcess;
  const nodePath = options.nodePath ?? process.execPath;
  const requestTimeoutMs = options.requestTimeoutMs ?? DEFAULT_REQUEST_TIMEOUT_MS;
  const now = options.now ?? Date.now;

  return {
    async refresh(projectPath: string, cliPath: string): Promise<RefreshDuplicatesResult> {
      let child: ChildProcess | null = null;
      try {
        const scopes = await readScopes(projectPath);
        child = spawnChild(nodePath, [cliPath, 'mcp'], {
          cwd: projectPath,
          stdio: ['pipe', 'pipe', 'pipe'],
        });
        if (!child.stdin || !child.stdout) {
          terminate(child);
          return { ok: false, error: 'the ArchGuard MCP child has no stdio pipes' };
        }
        const client = createMcpClient(child, requestTimeoutMs);
        await client.request('initialize', {
          protocolVersion: '2024-11-05',
          capabilities: {},
          clientInfo: { name: 'claudecodeui-architecture-refresh', version: '1.0.0' },
        });
        client.notify('notifications/initialized', {});

        const entries: DuplicatesIndexEntry[] = [];
        for (const scope of scopes) {
          await clearScopeArtifacts(projectPath, scope.key);
          const result = await client.request('tools/call', {
            name: 'archguard_detect_duplicates',
            arguments: { projectRoot: projectPath, scope: scope.key },
          });
          if (result.isError === true) {
            throw new Error(`duplicate detection failed for scope ${scope.key}: ${toolResultText(result)}`);
          }
          const text = toolResultText(result);
          let analysis: unknown = {};
          try {
            analysis = JSON.parse(text) as unknown;
          } catch {
            throw new Error(`the duplicate report for scope ${scope.key} is not JSON`);
          }
          entries.push(await collectScope(projectPath, scope, readObjectRecord(analysis) ?? {}));
        }

        const index: DuplicatesIndex = {
          version: '1.0',
          generatedAt: new Date(now()).toISOString(),
          entries,
        };
        await writeJson(path.join(projectPath, DUPLICATES_DIR, 'index.json'), index);
        return { ok: true, index };
      } catch (failure) {
        return {
          ok: false,
          error: failure instanceof Error ? failure.message : String(failure),
        };
      } finally {
        if (child !== null) terminate(child);
      }
    },
  };
}

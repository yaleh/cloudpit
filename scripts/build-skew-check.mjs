#!/usr/bin/env node
// Compares the two build fingerprints this installation ships:
//   dist/build-info.json         — the browser bundle (scripts/write-client-build-info.mjs)
//   dist-server/build-info.json  — the server build   (scripts/write-build-info.mjs)
//
// WHY. A restart applies whatever is on disk. When only one half was rebuilt (the 2026-10-27
// incident: `npm run build:client` alone, then a deferred restart), the fresh browser bundle calls
// `/api/...` routes the old server does not have; the SPA fallback answers `index.html`, and the
// client reports `Unexpected token '<'`. Every restart entrypoint therefore asks this tool first,
// and refuses to stop the service unless both halves name the same commit.
//
// It is READ-ONLY: it never builds, restarts, or writes anything.
//
// Verdicts and exit codes:
//   0  same     — both records name the same commit.
//   1  skew     — both records are readable and name different commits.
//   2  missing  — a record is absent, unreadable, malformed, or carries no gitSha.
//      usage error also exits 2.
//
// USAGE  node scripts/build-skew-check.mjs [--root <app-root>] [--json]
//   --root  the app root holding dist/ and dist-server/ (default: this checkout)
//   --json  one JSON document on stdout: { verdict, clientSha, serverSha, clientBuiltAt, serverBuiltAt }
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const USAGE = 'usage: node scripts/build-skew-check.mjs [--root <app-root>] [--json]';
const DEFAULT_ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const CLIENT_BUILD_INFO = path.join('dist', 'build-info.json');
const SERVER_BUILD_INFO = path.join('dist-server', 'build-info.json');

/**
 * One build fingerprint as both build scripts write it. A missing or malformed record reads as
 * `{gitSha: null, builtAt: null}`, the same convention `deploy-readiness.service.ts` uses.
 *
 * @typedef {{ gitSha: string | null, builtAt: string | null }} BuildFingerprint
 */

/**
 * The verdict the restart preflights branch on.
 *
 * @typedef {'same' | 'skew' | 'missing'} SkewVerdict
 */

/**
 * The machine reading. `clientSha`/`serverSha` are null only when that side has no readable sha.
 *
 * @typedef {{
 *   verdict: SkewVerdict,
 *   clientSha: string | null,
 *   serverSha: string | null,
 *   clientBuiltAt: string | null,
 *   serverBuiltAt: string | null,
 * }} SkewReading
 */

/**
 * Parses the argv this tool accepts. `--help` prints usage and exits 0.
 *
 * @param {string[]} argv
 * @returns {{ root: string, json: boolean }}
 */
function parseArgs(argv) {
  const options = { root: DEFAULT_ROOT, json: false };
  for (let i = 0; i < argv.length; i += 1) {
    const arg = argv[i];
    if (arg === '--help' || arg === '-h') {
      console.log(USAGE);
      process.exit(0);
    }
    if (arg === '--json') {
      options.json = true;
      continue;
    }
    if (arg === '--root') {
      const next = argv.at(i + 1);
      if (next === undefined || next === '') {
        throw new Error(`missing value for --root\n${USAGE}`);
      }
      options.root = next;
      i += 1;
      continue;
    }
    if (arg.startsWith('--root=')) {
      options.root = arg.slice('--root='.length);
      continue;
    }
    throw new Error(`unknown argument: ${arg}\n${USAGE}`);
  }
  return options;
}

/**
 * Reads one build fingerprint. A missing, unreadable, non-JSON, or shapeless record is the
 * `missing` state rather than an exception: the callers print it and refuse the restart.
 *
 * @param {string} filePath absolute path of the `build-info.json` file
 * @returns {BuildFingerprint}
 */
function readFingerprint(filePath) {
  try {
    /** @type {unknown} */
    const parsed = JSON.parse(fs.readFileSync(filePath, 'utf8'));
    if (typeof parsed !== 'object' || parsed === null) {
      return { gitSha: null, builtAt: null };
    }
    const record = /** @type {{ gitSha?: unknown, builtAt?: unknown }} */ (parsed);
    return {
      gitSha: typeof record.gitSha === 'string' && record.gitSha !== '' ? record.gitSha : null,
      builtAt: typeof record.builtAt === 'string' ? record.builtAt : null,
    };
  } catch {
    return { gitSha: null, builtAt: null };
  }
}

/**
 * The one comparison rule, kept as a free function so the criterion exercises exactly the
 * production decision rather than a re-implementation.
 *
 * @param {BuildFingerprint} client
 * @param {BuildFingerprint} server
 * @returns {SkewReading}
 */
export function compareBuildFingerprints(client, server) {
  const verdict = client.gitSha === null || server.gitSha === null
    ? 'missing'
    : client.gitSha === server.gitSha
      ? 'same'
      : 'skew';
  return {
    verdict,
    clientSha: client.gitSha,
    serverSha: server.gitSha,
    clientBuiltAt: client.builtAt,
    serverBuiltAt: server.builtAt,
  };
}

/**
 * The human line the restart preflights log. It always names both readings (or which side is
 * unreadable) and the one fix.
 *
 * @param {SkewReading} reading
 * @param {string} root
 * @returns {string}
 */
export function describeSkew(reading, root) {
  const client = reading.clientSha ?? '<missing>';
  const server = reading.serverSha ?? '<missing>';
  switch (reading.verdict) {
    case 'same':
      return `SAME client=${client} server=${server}`;
    case 'skew':
      return `SKEW client=${client} server=${server} — dist/build-info.json and dist-server/build-info.json name different commits; run 'npm run build' (full build) before restarting`;
    default: {
      const missing = [
        reading.clientSha === null ? `client (${path.join(root, CLIENT_BUILD_INFO)})` : null,
        reading.serverSha === null ? `server (${path.join(root, SERVER_BUILD_INFO)})` : null,
      ].filter((side) => side !== null);
      return `MISSING ${missing.join(' and ')} client=${client} server=${server} — run 'npm run build' (full build) before restarting`;
    }
  }
}

function main() {
  let options;
  try {
    options = parseArgs(process.argv.slice(2));
  } catch (error) {
    console.error(error instanceof Error ? error.message : String(error));
    process.exit(2);
  }

  const reading = compareBuildFingerprints(
    readFingerprint(path.join(options.root, CLIENT_BUILD_INFO)),
    readFingerprint(path.join(options.root, SERVER_BUILD_INFO)),
  );

  if (options.json) {
    console.log(JSON.stringify(reading));
  } else {
    console.log(describeSkew(reading, options.root));
  }

  process.exit(reading.verdict === 'same' ? 0 : reading.verdict === 'skew' ? 1 : 2);
}

/**
 * Only run when this file is the entrypoint. A criterion may import `compareBuildFingerprints`
 * without the CLI reading the host's own build-info files. Both sides are compared through
 * `realpath`, so a harness that invokes the script through a symlink still counts as the entrypoint.
 *
 * @returns {boolean}
 */
function isEntrypoint() {
  const invoked = process.argv[1];
  if (invoked === undefined) {
    return false;
  }
  try {
    return fs.realpathSync(invoked) === fs.realpathSync(fileURLToPath(import.meta.url));
  } catch {
    return false;
  }
}

if (isEntrypoint()) {
  main();
}

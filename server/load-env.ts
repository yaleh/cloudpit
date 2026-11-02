// Load environment variables from .env before other imports execute.
import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';

import { installTimestampedConsole } from './modules/logging/index.js';
import { resolveDataRoots } from './shared/data-root.js';

// Date every line the process writes from here on. It is installed HERE, and not in
// `server/index.ts`, because module bodies run before the entry point's own statements: an
// install in `index.ts` would leave every log written while a later import evaluated
// un-stamped. This file is the one module `server/index.ts`, `cli.ts` and `browser-use-mcp.ts`
// all import first, and the import it adds reads no environment at evaluation (the rule the
// `shared/utils.ts` note below is about) — it is a `node:util` wrapper and nothing more.
installTimestampedConsole(console);

// This bootstrap cannot import shared/utils.ts: that module reads environment
// defaults during evaluation, before this file has loaded `.env`.
function getBootstrapApplicationRoot(importMetaUrl: string) {
  const moduleDirectory = path.dirname(fileURLToPath(importMetaUrl));
  let serverRoot = moduleDirectory;
  while (path.basename(serverRoot) !== 'server') {
    const parent = path.dirname(serverRoot);
    if (parent === serverRoot) throw new Error('Could not resolve server root');
    serverRoot = parent;
  }
  const parent = path.dirname(serverRoot);
  return path.basename(parent) === 'dist-server' ? path.dirname(parent) : parent;
}

// Resolve the repo/app root via the nearest /server folder so this file keeps finding the
// same top-level .env file from both /server/load-env.ts and /dist-server/server/load-env.js.
const APP_ROOT = getBootstrapApplicationRoot(import.meta.url);

try {
  const envPath = path.join(APP_ROOT, '.env');
  const envFile = fs.readFileSync(envPath, 'utf8');
  envFile.split('\n').forEach(line => {
    const trimmedLine = line.trim();
    if (trimmedLine && !trimmedLine.startsWith('#')) {
      const [key, ...valueParts] = trimmedLine.split('=');
      if (key && valueParts.length > 0 && !process.env[key]) {
        process.env[key] = valueParts.join('=').trim();
      }
    }
  });
} catch (e: any) {
  console.error('No .env file found or error reading it:', e.message);
}

// Resolve the data root AFTER `.env` was read (module imports are hoisted, but this call is not),
// so `CLOUDPIT_HOME` from the file is honoured. The Cloudpit default (`~/.cloudpit`) is the only
// default and migrates a legacy `~/.cloudcli` layout once; a failed migration is reported below
// and does NOT fall back to the old root (v3.0). Exported so `server/index.ts` reuses this single
// resolution instead of migrating a second time.
export const DATA_ROOTS = resolveDataRoots();

if (DATA_ROOTS.migrationError !== null) {
  // v3.0: a failed one-time migration is an explicit error, never a silent fallback to
  // `~/.cloudcli`. The server keeps running on the Cloudpit root so the operator can fix
  // the cause (e.g. an occupied SQLite database) and restart.
  console.error(
    `Cloudpit data-root migration failed (${DATA_ROOTS.reason}): ${DATA_ROOTS.migrationError}. ` +
      `Continuing with ${DATA_ROOTS.activeRoot}; the legacy root was left untouched.`,
  );
}

if (!process.env.DATABASE_PATH) {
  process.env.DATABASE_PATH = DATA_ROOTS.authDatabasePath;
}

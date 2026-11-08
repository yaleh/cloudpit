import fs from 'node:fs';
import path from 'node:path';
import readline from 'node:readline';
import { fileURLToPath } from 'node:url';

// ---------------------------
//----------------- SESSION SYNCHRONIZER JSONL PARSING HELPERS ------------
/**
 * Builds a first-seen key/value lookup map from a JSONL file.
 *
 * Use this for provider index files where session id -> display name metadata
 * is stored line-by-line. The first value for each key wins, preserving the
 * earliest known label while avoiding repeated map overwrites.
 */
export async function buildLookupMap(
  filePath: string,
  keyField: string,
  valueField: string
): Promise<Map<string, string>> {
  const lookup = new Map<string, string>();

  try {
    const fileStream = fs.createReadStream(filePath);
    const lineReader = readline.createInterface({ input: fileStream, crlfDelay: Infinity });

    for await (const line of lineReader) {
      const trimmed = line.trim();
      if (!trimmed) {
        continue;
      }

      const parsed = JSON.parse(trimmed) as Record<string, unknown>;
      const key = parsed[keyField];
      const value = parsed[valueField];

      if (typeof key === 'string' && typeof value === 'string' && !lookup.has(key)) {
        lookup.set(key, value);
      }
    }
  } catch {
    // Missing or unreadable lookup files should not block session sync.
  }

  return lookup;
}

/**
 * Reads a JSONL file and returns the first extracted payload that matches caller criteria.
 *
 * The caller supplies an `extractor` that validates provider-specific row
 * shapes. This helper centralizes line-by-line parsing and lets indexers stop
 * scanning as soon as one valid row is found.
 */
export async function extractFirstValidJsonlData<T>(
  filePath: string,
  extractor: (parsedJson: unknown) => T | null | undefined
): Promise<T | null> {
  try {
    const fileStream = fs.createReadStream(filePath);
    const lineReader = readline.createInterface({ input: fileStream, crlfDelay: Infinity });

    for await (const line of lineReader) {
      const trimmed = line.trim();
      if (!trimmed) {
        continue;
      }

      const parsed = JSON.parse(trimmed);
      const extracted = extractor(parsed);
      if (extracted) {
        lineReader.close();
        fileStream.close();
        return extracted;
      }
    }
  } catch {
    // Ignore malformed or missing artifacts so full scans keep progressing.
  }

  return null;
}

// ---------------------------
//----------------- CLI PROMPT ARGUMENT UTILITIES ------------
/**
 * Makes a prompt safe to pass as one CLI argument to `.cmd`-shimmed tools on
 * Windows (cursor-agent and opencode installed via npm-style shims).
 *
 * cmd.exe cannot carry newlines inside an argument: everything after the
 * first newline is silently dropped before the target CLI ever sees it, which
 * truncates multi-line prompts and any appended `<images_input>` block.
 * Collapsing newline runs to single spaces loses formatting but never loses
 * content, so runtimes should call this on win32 right before spawning.
 *
 * Used by the cursor and opencode spawn runtimes.
 */
export function flattenPromptForWindowsShell(prompt: string): string {
  if (process.platform !== 'win32' || typeof prompt !== 'string') {
    return prompt;
  }
  return prompt.replace(/\s*\r?\n\s*/g, ' ').trim();
}

// ---------------------------
//----------------- TERMINAL OUTPUT UTILITIES ------------
/**
 * Matches the escape sequences a CLI emits when it believes it is writing to a
 * terminal, in the three shapes those tools actually produce:
 * - OSC (`ESC ]` … terminated by BEL or ST), used for titles and hyperlinks.
 * - CSI (`ESC [`, or the 8-bit `\u009B` introducer that stands in for both
 *   bytes), used for SGR colors and cursor control.
 * - any other ECMA-48 escape sequence: `ESC`, optional intermediate bytes
 *   (`0x20`-`0x2F`), one final byte (`0x30`-`0x7E`), such as `ESC ( B`.
 *
 * OSC and CSI are listed first so their terminators are consumed by the
 * specific alternative rather than by the generic one.
 */
const ANSI_ESCAPE_SEQUENCE_REGEX =
  /\u001B\][^\u0007\u001B]*(?:\u0007|\u001B\\)|(?:\u001B\[|\u009B)[0-?]*[ -/]*[@-~]|\u001B[ -/]*[0-~]/g;

/**
 * Removes ANSI escape sequences from text captured off a CLI's stdout or
 * stderr. Provider runtimes, session readers, and the shell WebSocket share
 * this because every one of them forwards captured process output to a web
 * client that renders plain text: left in, the escapes show up verbatim
 * (`[93m[1m!`) instead of as styling.
 *
 * The result can be empty when the input was styling only, so callers that
 * forward the text should re-check for emptiness after cleaning.
 */
export function stripAnsiSequences(value: string): string {
  return value.replace(ANSI_ESCAPE_SEQUENCE_REGEX, '');
}

const ANSI_TERMINAL_STYLES = {
  reset: '\x1b[0m',
  bright: '\x1b[1m',
  dim: '\x1b[2m',
  cyan: '\x1b[36m',
  green: '\x1b[32m',
  yellow: '\x1b[33m',
  blue: '\x1b[34m',
} as const;

/**
 * Applies the small, consistent ANSI style vocabulary used by backend
 * terminal output. The CLI and server bootstrap share these formatters so
 * status, warning, and startup messages use one implementation. Callers
 * should pass complete display strings and write the returned value directly
 * to stdout or stderr; the reset suffix prevents styling subsequent output.
 */
export const terminalTextStyles = {
  info: (text: string): string =>
    `${ANSI_TERMINAL_STYLES.cyan}${text}${ANSI_TERMINAL_STYLES.reset}`,
  ok: (text: string): string =>
    `${ANSI_TERMINAL_STYLES.green}${text}${ANSI_TERMINAL_STYLES.reset}`,
  warn: (text: string): string =>
    `${ANSI_TERMINAL_STYLES.yellow}${text}${ANSI_TERMINAL_STYLES.reset}`,
  error: (text: string): string =>
    `${ANSI_TERMINAL_STYLES.yellow}${text}${ANSI_TERMINAL_STYLES.reset}`,
  tip: (text: string): string =>
    `${ANSI_TERMINAL_STYLES.blue}${text}${ANSI_TERMINAL_STYLES.reset}`,
  bright: (text: string): string =>
    `${ANSI_TERMINAL_STYLES.bright}${text}${ANSI_TERMINAL_STYLES.reset}`,
  dim: (text: string): string =>
    `${ANSI_TERMINAL_STYLES.dim}${text}${ANSI_TERMINAL_STYLES.reset}`,
};

// ---------------------------
//----------------- ACCESS-TOKEN LAST-USED THROTTLE UTILITIES ------------
/**
 * Minimum age of a token's recorded `last_used` before an accepted verification
 * rewrites it.
 *
 * `/mcp` verifies a bearer token on every request, so stamping `last_used` on
 * every acceptance would turn a busy client into one database write per call.
 * Throttling to at most one write per window keeps the reading useful — it still
 * answers "when was this token last used?" — without the write amplification.
 * The interval is a product decision, deliberately not configurable.
 */
const LAST_USED_STAMP_INTERVAL_MS = 60 * 1000;

/**
 * The ISO instant an accepted verification should record as `last_used`, or
 * `null` when the existing stamp is still inside the throttle window and the
 * write should be skipped.
 *
 * `previousLastUsed` is the value currently stored on the row (null when the
 * token or grant has never been used); `now` is the caller's injected clock, so
 * the decision is deterministic under test. A stored value that does not parse
 * as a date is treated as stale, so a corrupt row self-heals on the next use.
 *
 * Consumers: the OAuth module's `access-tokens.service.ts` (personal-access-token
 * verification) and `oauth-provider.service.ts` (OAuth access-token verification,
 * which throttles the owning grant with the same window). Both verify paths call
 * this one helper rather than each carrying its own comparison, so the two cannot
 * drift apart.
 */
export function lastUsedStamp(previousLastUsed: string | null, now: Date): string | null {
  if (previousLastUsed !== null) {
    const previous = new Date(previousLastUsed).getTime();
    if (!Number.isNaN(previous) && now.getTime() - previous < LAST_USED_STAMP_INTERVAL_MS) {
      return null;
    }
  }
  return now.toISOString();
}

// ---------------------------
//----------------- RUNTIME PATH RESOLUTION UTILITIES ------------
/**
 * Resolves the directory containing an ES module from `import.meta.url`.
 * Backend entrypoints and feature composition roots use this instead of
 * recreating CommonJS `__dirname` logic.
 */
export function getModuleDirectory(importMetaUrl: string): string {
  return path.dirname(fileURLToPath(importMetaUrl));
}

/**
 * Walks upward to the nearest `server` directory in either source or compiled
 * output. Callers use this stable anchor for server-relative resources.
 */
export function findServerRoot(startDirectory: string): string {
  let currentDirectory = startDirectory;
  while (path.basename(currentDirectory) !== 'server') {
    const parentDirectory = path.dirname(currentDirectory);
    if (parentDirectory === currentDirectory) {
      throw new Error(`Could not resolve the backend server root from "${startDirectory}".`);
    }
    currentDirectory = parentDirectory;
  }
  return currentDirectory;
}

/**
 * Resolves the application root from a source or `dist-server/server` path so
 * package-level resources work identically before and after compilation.
 */
export function findApplicationRoot(startDirectory: string): string {
  const serverRoot = findServerRoot(startDirectory);
  const parentDirectory = path.dirname(serverRoot);
  return path.basename(parentDirectory) === 'dist-server'
    ? path.dirname(parentDirectory)
    : parentDirectory;
}

/**
 * Overlays a compiled launch spec onto a spawn environment and returns a new
 * object: `spec.env` is merged over `base`, then every `spec.unsetEnv` key is
 * deleted. Used by the Claude SDK runtime (sdkOptions.env, which replaces the
 * child env) and the shell pty spawn so `unset` rows take effect on the final
 * env object in both paths. Never mutates `base`.
 */
export function applyLaunchSpecEnv<TBase extends Record<string, string | undefined>>(
  base: TBase,
  spec: { env: Record<string, string | undefined>; unsetEnv?: string[] },
): Record<string, string | undefined> {
  const merged: Record<string, string | undefined> = { ...base, ...spec.env };
  for (const key of spec.unsetEnv ?? []) {
    delete merged[key];
  }
  return merged;
}


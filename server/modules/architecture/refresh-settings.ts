/**
 * The `architecture.refresh` settings block for the manual re-analysis job.
 *
 * WHY THIS MODULE READS THE FILE ITSELF. `modules/architecture` is a leaf in the
 * server import graph (AC-394), so it cannot reach the `modules/settings` barrel.
 * The block lives in the same deployment-editable server settings file the other
 * server knobs use (`SERVER_SETTINGS_PATH`, then
 * `~/.config/claudecodeui/server.settings.json`), and this module reads it
 * directly. The file machinery (the `~` expansion, the mtime cache and the block
 * selector) is `server/shared/settings-file.ts`; this module keeps only the
 * block's schema.
 *
 * A missing file at the DEFAULT path is the ordinary "keep the shipped defaults"
 * state; a file named explicitly that cannot be read is reported in `problems`
 * and keeps the defaults — a bad knob must never stop a refresh from being
 * attempted.
 *
 * Consumers: `refreshJob.ts`, which composes one reader per job instance;
 * `tests/refreshJob.test.ts` and `tests/refreshRoutes.test.ts`, which point it
 * at settings files they own.
 */
import fs from 'node:fs';
import { createRequire } from 'node:module';
import os from 'node:os';
import path from 'node:path';

import {
  createSettingsBlockSource,
  defaultServerSettingsPath,
  expandHome,
  resolveSettingsPath,
  type SettingsBlockContext,
} from '@/shared/settings-file.js';

/** The environment variable naming the server settings file (the same literal `modules/settings` reads). */
export const SERVER_SETTINGS_PATH_ENV = 'SERVER_SETTINGS_PATH';

/** The package whose CLI the manual refresh runs. */
const ARCHGUARD_PACKAGE = '@yalehwang/archguard';

/** The CLI entry inside the package (the same path `mcp-launcher.mjs` resolves). */
const ARCHGUARD_CLI_RELATIVE = path.join('dist', 'cli', 'index.js');

/** The settings-file operations this module needs; injectable so a criterion can fake them. */
export type RefreshSettingsFs = Pick<typeof fs, 'existsSync' | 'statSync' | 'readFileSync'>;

/**
 * The criterion's fault lever. `no-coalesce` makes a concurrent start spawn its own
 * job (the absent single-flight); `no-preserve` runs the CLI against the LIVE
 * `.archguard` (the absent staging/swap, so a failure leaves partial artifacts).
 * Empty is the shipped behaviour; the e2e control arm drives these through the
 * settings file.
 */
export type ArchitectureRefreshDefect = '' | 'no-coalesce' | 'no-preserve';

/**
 * One reading of the `architecture.refresh` block.
 *
 * Consumers: `refreshJob.ts` (the state machine reads it once per start) and
 * `refresh-spawn.ts` (the CLI resolver and the analyze argv).
 */
export type RefreshSettings = {
  /** Explicit CLI entry path; empty means "resolve it the way the launcher does". */
  readonly cliPath: string;
  /** Whole-child ceiling in milliseconds. */
  readonly timeoutMs: number;
  /** `MemoryMax` for the child's scope; 0 disables the cap (and the systemd-run wrapper). */
  readonly memoryLimitMb: number;
  /** The criterion seam; empty in production. */
  readonly defect: ArchitectureRefreshDefect;
  /** The file this reading came from, or null when no file was consulted. */
  readonly path: string | null;
  /** `default` when nothing was configured (or the file could not be read). */
  readonly source: 'default' | 'file';
  /** Every value that fell back to its shipped default, oldest first. */
  readonly problems: readonly string[];
};

/**
 * The mtime-cached reader the job holds.
 *
 * Consumer: `refreshJob.ts` (`start` reads it once, then hands the reading to the
 * spawner so one start never sees two different settings states).
 */
export type RefreshSettingsSource = {
  read(): RefreshSettings;
};

/** Shipped `architecture.refresh` values. Mirrors `config/server.settings.example.json`. */
const DEFAULT_REFRESH_SETTINGS: {
  cliPath: string; timeoutMs: number; memoryLimitMb: number; defect: ArchitectureRefreshDefect;
} = {
  cliPath: '',
  timeoutMs: 20 * 60 * 1000,
  memoryLimitMb: 6144,
  defect: '',
};

function isPositiveInteger(value: unknown): value is number {
  return typeof value === 'number' && Number.isInteger(value) && value > 0;
}

/**
 * Resolves the CLI entry named by `architecture.refresh.cliPath` the way
 * `mcp-launcher.mjs` does: `createRequire` from the project first, then a walk up its
 * ancestors looking at `node_modules` and the sibling `npm-cache/node_modules`, then
 * the plugin cache under the process home. Returns a readable reason instead of
 * throwing, because an unresolvable CLI is a failed job the tab must explain — never
 * a crash.
 *
 * Consumer: `refresh-spawn.ts` (`createRefreshSpawner` exposes it as `resolveCli`).
 */
export function resolveArchguardCli(
  projectPath: string,
  explicitPath: string,
  homeDir: string,
  fsImpl: Pick<typeof fs, 'existsSync'> = fs,
): { cliPath: string } | { error: string } {
  if (explicitPath.trim() !== '') {
    const resolved = expandHome(explicitPath.trim(), homeDir);
    if (fsImpl.existsSync(resolved)) return { cliPath: resolved };
    return {
      error: `architecture.refresh.cliPath names ${resolved}, which does not exist`,
    };
  }

  try {
    const requireFromProject = createRequire(path.join(projectPath, 'package.json'));
    const resolved = requireFromProject.resolve(`${ARCHGUARD_PACKAGE}/${ARCHGUARD_CLI_RELATIVE.split(path.sep).join('/')}`);
    return { cliPath: resolved };
  } catch {
    // Fall through to the ancestor walk: the launcher's cache is not on the
    // project's require path.
  }

  for (let current = path.resolve(projectPath); ; current = path.dirname(current)) {
    for (const candidate of [
      path.join(current, 'node_modules', ARCHGUARD_PACKAGE, ARCHGUARD_CLI_RELATIVE),
      path.join(current, 'npm-cache', 'node_modules', ARCHGUARD_PACKAGE, ARCHGUARD_CLI_RELATIVE),
    ]) {
      if (fsImpl.existsSync(candidate)) return { cliPath: candidate };
    }
    if (path.dirname(current) === current) break;
  }

  const pluginCache = path.join(
    homeDir,
    '.claude',
    'plugins',
    'npm-cache',
    'node_modules',
    ARCHGUARD_PACKAGE,
    ARCHGUARD_CLI_RELATIVE,
  );
  if (fsImpl.existsSync(pluginCache)) return { cliPath: pluginCache };

  return {
    error:
      `Could not resolve ${ARCHGUARD_PACKAGE} (tried the project's node_modules, `
      + `each ancestor's node_modules and npm-cache/node_modules, and ${pluginCache}). `
      + 'Set architecture.refresh.cliPath in the server settings file to the CLI entry.',
  };
}

/**
 * Builds one reading from the already-selected `architecture.refresh` block.
 *
 * Unknown keys are ignored and a malformed known value falls back field by field, so
 * a typo in `timeoutMs` cannot silently disable the whole refresh entry.
 */
function buildRefreshSettings(
  block: Record<string, unknown> | null,
  context: SettingsBlockContext,
): RefreshSettings {
  const problems = context.problems;
  const settings = {
    cliPath: DEFAULT_REFRESH_SETTINGS.cliPath,
    timeoutMs: DEFAULT_REFRESH_SETTINGS.timeoutMs,
    memoryLimitMb: DEFAULT_REFRESH_SETTINGS.memoryLimitMb,
    defect: DEFAULT_REFRESH_SETTINGS.defect as ArchitectureRefreshDefect,
    path: context.path,
    source: context.source,
    problems: problems as readonly string[],
  };
  if (block === null) return settings;

  if (block.cliPath !== undefined) {
    if (typeof block.cliPath === 'string') settings.cliPath = block.cliPath;
    else problems.push('`architecture.refresh.cliPath` must be a string');
  }
  if (block.timeoutMs !== undefined) {
    if (isPositiveInteger(block.timeoutMs)) settings.timeoutMs = block.timeoutMs;
    else problems.push('`architecture.refresh.timeoutMs` must be a positive integer');
  }
  if (block.memoryLimitMb !== undefined) {
    if (isPositiveInteger(block.memoryLimitMb)) settings.memoryLimitMb = block.memoryLimitMb;
    else problems.push('`architecture.refresh.memoryLimitMb` must be a positive integer');
  }
  if (block.defect !== undefined) {
    if (block.defect === '' || block.defect === 'no-coalesce' || block.defect === 'no-preserve') {
      settings.defect = block.defect;
    } else {
      problems.push('`architecture.refresh.defect` must be "", "no-coalesce" or "no-preserve"');
    }
  }
  return settings;
}

/**
 * Builds the mtime-cached settings reader.
 *
 * Consumers: `refreshJob.ts`, and through it the two refresh test files. The test
 * seam is `settingsPath` (a file the test owns) plus an optional `fsImpl`.
 */
export function createRefreshSettingsSource(options: {
  settingsPath?: string | null;
  env?: Record<string, string | undefined>;
  homeDir?: string;
  fsImpl?: RefreshSettingsFs;
}): RefreshSettingsSource {
  const env = options.env ?? process.env;
  const homeDir = options.homeDir ?? os.homedir();
  const fsImpl = options.fsImpl ?? fs;
  const { filePath, explicit } = resolveSettingsPath({
    settingsPath: options.settingsPath,
    env,
    envVar: SERVER_SETTINGS_PATH_ENV,
    homeDir,
    defaultPath: defaultServerSettingsPath,
  });

  return createSettingsBlockSource({
    settingsPath: filePath,
    homeDir,
    block: 'architecture.refresh',
    explicit,
    fsImpl,
    parse: (block, context) => buildRefreshSettings(block, context),
  });
}

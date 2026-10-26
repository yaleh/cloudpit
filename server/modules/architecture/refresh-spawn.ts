/**
 * Spawning the ArchGuard analysis child for the manual refresh job.
 *
 * THE CLI IS A CHILD PROCESS, NEVER A SHELL. The argv is
 * `node <archguard>/dist/cli/index.js analyze -s <sources…> --lang <language>
 * -f json --work-dir <staging>`, spawned as an argv array (`shell` unset).
 * `-f json` is deliberate: the Mermaid/SVG renderer is not part of what the tab
 * reads, and it can fail on a headless host (`CSSStyleSheet is not defined`) while
 * still writing correct `query/` artifacts. The JSON form exits 0 and produces the
 * same `query/**`.
 *
 * THE MEMORY CAP. When `memoryLimitMb` is positive and a systemd user manager
 * answers, the child is started through `systemd-run --user --scope -p MemoryMax=…M
 * -p MemorySwapMax=0`, the same pattern as `scripts/with-memory-cap.sh`; the child
 * is spawned detached so the job can kill its whole process group without matching
 * a command line (and without missing the CLI's own worker processes).
 *
 * This module also resolves the two inputs the spawn needs: the CLI entry (the same
 * walk `mcp-launcher.mjs` does) and the source directories one whole-project
 * refresh re-analyses (the current manifest's scopes, outermost wins).
 *
 * Consumers: `refreshJob.ts` (one spawner per job instance);
 * `tests/refreshJob.test.ts` and `tests/refreshRoutes.test.ts` inject their own
 * `spawnImpl` through it.
 */
import { spawn, spawnSync, type ChildProcess } from 'node:child_process';
import fs, { promises as fsPromises } from 'node:fs';
import os from 'node:os';
import path from 'node:path';

import { isRecord } from '@/shared/utils.js';

import { resolveArchguardCli } from './refresh-settings.js';

/** The spawn signature this module uses; injectable so a criterion can count calls. */
export type RefreshSpawn = typeof spawn;

/** The filesystem operations this module needs; injectable so a criterion can fake them. */
export type RefreshSpawnFs = Pick<typeof fs, 'existsSync' | 'statSync' | 'realpathSync'> & {
  readonly promises: Pick<typeof fsPromises, 'readFile'>;
};

/** The source set one whole-project refresh re-analyses. */
export type RefreshSources = {
  readonly sources: readonly string[];
  readonly language: string;
};

/** What the job asks this module to spawn. */
export type RefreshSpawnInput = {
  readonly projectPath: string;
  readonly cliPath: string;
  readonly sources: readonly string[];
  readonly language: string;
  readonly workDir: string;
  readonly memoryLimitMb: number;
};

/**
 * The spawn-side surface the refresh job composes.
 *
 * Consumers: `refreshJob.ts` only (`start` resolves the CLI; `runJob` resolves the
 * sources and spawns; the timeout/shutdown paths call `killGroup`).
 */
export type RefreshSpawner = {
  /** Resolve the CLI entry, or return a readable reason instead of throwing. */
  resolveCli(projectPath: string, explicitPath: string): { cliPath: string } | { error: string };
  /** The manifest's outermost scope sources, with a bootstrap fallback. */
  resolveSources(projectPath: string): Promise<RefreshSources>;
  /** Spawn the analysis detached with stderr piped; the caller attaches its tail. */
  spawnAnalysis(input: RefreshSpawnInput): ChildProcess;
  /** Kill the child's whole process group (the CLI may have worker children). */
  killGroup(child: ChildProcess, signal: NodeJS.Signals): void;
};

function realpathOrSelf(filePath: string): string {
  try {
    return fs.realpathSync(filePath);
  } catch {
    return filePath;
  }
}

/** True when `child` is `parent` or lives beneath it. */
function isWithin(parent: string, child: string): boolean {
  return child === parent || child.startsWith(`${parent}${path.sep}`);
}

/**
 * The source directories one whole-project refresh re-analyses.
 *
 * The current manifest is the authority: each scope's existing sources are reused,
 * which is what keeps the scope keys (`hashSources(sources, language)`) stable across
 * a refresh. Sources outside the project root and sources nested inside another
 * scope's source are dropped — the latter is what retires the legacy
 * `src/modules/chat` scope, whose artifacts the server's own merge already subsumes
 * into `src`. With no manifest at all (the tab would not be reachable), the project's
 * two source trees are used as a bootstrap; failing both, the project root itself.
 */
async function resolveRefreshSources(
  projectPath: string,
  fsImpl: RefreshSpawnFs,
): Promise<RefreshSources> {
  const manifestPath = path.join(projectPath, '.archguard', 'query', 'manifest.json');
  let language = 'typescript';
  const candidates: string[] = [];
  try {
    const parsed: unknown = JSON.parse(await fsImpl.promises.readFile(manifestPath, 'utf8'));
    if (isRecord(parsed) && Array.isArray(parsed.scopes)) {
      for (const scope of parsed.scopes) {
        if (!isRecord(scope)) continue;
        if (typeof scope.language === 'string' && scope.language.trim() !== '') {
          language = scope.language;
        }
        if (!Array.isArray(scope.sources)) continue;
        for (const source of scope.sources) {
          if (typeof source !== 'string' || source.trim() === '') continue;
          const absolute = realpathOrSelf(
            path.isAbsolute(source) ? source : path.resolve(projectPath, source),
          );
          if (!isWithin(projectPath, absolute)) continue;
          try {
            if (!fsImpl.statSync(absolute).isDirectory()) continue;
          } catch {
            continue;
          }
          if (!candidates.includes(absolute)) candidates.push(absolute);
        }
      }
    }
  } catch {
    // No manifest (or an unreadable one): fall through to the bootstrap list.
  }

  // A nested source is already indexed by its ancestor scope: keep the outermost.
  const ordered = [...candidates].sort((a, b) => a.length - b.length);
  const outermost: string[] = [];
  for (const candidate of ordered) {
    if (outermost.some((kept) => isWithin(kept, candidate))) continue;
    outermost.push(candidate);
  }

  if (outermost.length > 0) return { sources: outermost, language };

  for (const relative of ['src', 'server']) {
    const absolute = path.join(projectPath, relative);
    try {
      if (fsImpl.statSync(absolute).isDirectory()) outermost.push(absolute);
    } catch {
      // Not every project has both trees.
    }
  }
  return { sources: outermost.length === 0 ? [projectPath] : outermost, language };
}

/**
 * The argv the CLI is invoked with. `-f json` keeps the Mermaid/SVG renderer out of a
 * run the tab does not consume (see the module header). `--work-dir` is always
 * absolute, because ArchGuard derives the project root from its parent.
 */
function buildCliArgs(
  sources: readonly string[],
  language: string,
  workDir: string,
): string[] {
  return [
    'analyze',
    '-s',
    ...sources,
    '--lang',
    language,
    '-f',
    'json',
    '--work-dir',
    workDir,
  ];
}

/**
 * The command to spawn: the CLI directly, or the same command behind
 * `systemd-run --user --scope` when a memory cap was configured and the host has a
 * usable user manager.
 */
function buildSpawnCommand(
  nodePath: string,
  cliPath: string,
  cliArgs: readonly string[],
  memoryLimitMb: number,
  useSystemd: boolean,
): { command: string; args: string[] } {
  if (memoryLimitMb > 0 && useSystemd) {
    return {
      command: 'systemd-run',
      args: [
        '--user',
        '--scope',
        '--quiet',
        '-p',
        `MemoryMax=${memoryLimitMb}M`,
        '-p',
        'MemorySwapMax=0',
        '--',
        nodePath,
        cliPath,
        ...cliArgs,
      ],
    };
  }
  return { command: nodePath, args: [cliPath, ...cliArgs] };
}

/** A default systemd-user probe; `systemd-run --version` is cheap and side-effect free. */
function defaultHasSystemdRun(): boolean {
  try {
    return spawnSync('systemd-run', ['--version'], { stdio: 'ignore', timeout: 2_000 }).status === 0;
  } catch {
    return false;
  }
}

/** Kills the child's whole process group (the CLI may have worker children). */
function killChildGroup(child: ChildProcess, signal: NodeJS.Signals): void {
  if (child.pid === undefined) return;
  try {
    process.kill(-child.pid, signal);
    return;
  } catch {
    // Fall back to the child itself (a non-detached or already-reaped group).
  }
  try {
    child.kill(signal);
  } catch {
    // Already gone: nothing to kill.
  }
}

/**
 * Creates the spawn-side half of the refresh job.
 *
 * Consumers: `refreshJob.ts`; the two refresh test files inject `spawnImpl` and
 * `hasSystemdRun` through the job's own options. `nodePath` defaults to the running
 * node binary so the CLI is never started through a shell.
 */
export function createRefreshSpawner(options: {
  spawnImpl?: RefreshSpawn;
  hasSystemdRun?: () => boolean;
  nodePath?: string;
  homeDir?: string;
  fsImpl?: RefreshSpawnFs;
} = {}): RefreshSpawner {
  const spawnChild = options.spawnImpl ?? spawn;
  const hasSystemdRun = options.hasSystemdRun ?? defaultHasSystemdRun;
  const nodePath = options.nodePath ?? process.execPath;
  const homeDir = options.homeDir ?? os.homedir();
  const fsImpl = options.fsImpl ?? fs;

  return {
    resolveCli(projectPath: string, explicitPath: string): { cliPath: string } | { error: string } {
      return resolveArchguardCli(projectPath, explicitPath, homeDir, fsImpl);
    },

    resolveSources(projectPath: string): Promise<RefreshSources> {
      return resolveRefreshSources(projectPath, fsImpl);
    },

    spawnAnalysis(input: RefreshSpawnInput): ChildProcess {
      const cliArgs = buildCliArgs(input.sources, input.language, input.workDir);
      const { command, args } = buildSpawnCommand(
        nodePath,
        input.cliPath,
        cliArgs,
        input.memoryLimitMb,
        hasSystemdRun(),
      );
      return spawnChild(command, args, {
        cwd: input.projectPath,
        // A group of its own so a timeout/shutdown reaches the CLI's workers too.
        detached: true,
        stdio: ['ignore', 'ignore', 'pipe'],
      });
    },

    killGroup(child: ChildProcess, signal: NodeJS.Signals): void {
      killChildGroup(child, signal);
    },
  };
}

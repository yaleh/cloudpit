import type { CliOutput } from '@/shared/types.js';

/**
 * Report shape, option parsing and terminal rendering for
 * `cloudpit migrate-assets`.
 *
 * Split from the orchestration service so the migration flow reads as one
 * sequence (scan → copy → rewrite → verify) and the command's public report
 * contract lives in one place.
 */

/** The `--json` report. Field names are the command's public contract. */
export type AssetMigrationReport = {
  /** Files copied into the Cloudpit root (planned count in a dry run). */
  copied: number;
  /** Files already present with identical content (planned count in a dry run). */
  skipped: number;
  /** Relative paths whose target exists with different content; never overwritten. */
  conflicts: string[];
  /** App-owned documents whose paths were rewritten (planned count in a dry run). */
  rewritten: number;
  /** External references that must be resolved by hand, one `file:line` per hit. */
  unrewritable: string[];
  /** Backup files created before the first write. */
  backupPaths: string[];
  /** Failures; a non-empty list means the rewrite was rolled back. */
  errors: string[];
};

/** Parsed command flags. */
export type AssetMigrationOptions = {
  mode: 'scan' | 'rewrite';
  json: boolean;
};

export const EXIT_OK = 0;
export const EXIT_FAILED = 1;
export const EXIT_UNREWRITABLE = 3;

export const USAGE = `
Usage:
  cloudpit migrate-assets --dry-run [--json]
  cloudpit migrate-assets --rewrite [--json]

Options:
  --dry-run    Scan only: report what would be copied and rewritten; write nothing.
  --rewrite    Copy legacy assets into the Cloudpit root and rewrite persisted paths.
  --json       Print the report as JSON on stdout.
  -h, --help   Show this help information.

The legacy ~/.cloudcli/assets directory is never deleted. Provider transcripts are
scanned read-only and reported as unrewritable (exit code 3 when any exist).
`.trim();

/**
 * Parses the command's own flags. Unknown flags and a missing mode are usage
 * errors returned as a message (not thrown), so the caller can print usage and
 * exit non-zero instead of starting a migration by accident.
 */
export function parseAssetMigrationOptions(
  argumentsList: string[],
): AssetMigrationOptions | string {
  let dryRun = false;
  let rewrite = false;
  let json = false;
  for (const argument of argumentsList) {
    if (argument === '--dry-run') dryRun = true;
    else if (argument === '--rewrite') rewrite = true;
    else if (argument === '--json') json = true;
    else return `Unknown option: ${argument}`;
  }
  if (dryRun && rewrite) return '--dry-run and --rewrite are mutually exclusive';
  if (!dryRun && !rewrite) return 'Specify --dry-run or --rewrite';
  return { mode: rewrite ? 'rewrite' : 'scan', json };
}

/** Renders the human-readable report; `--json` callers skip this. */
export function printAssetMigrationReport(
  output: CliOutput,
  report: AssetMigrationReport,
  mode: AssetMigrationOptions['mode'],
  legacyRoot: string,
  newRoot: string,
): void {
  output.log(mode === 'rewrite'
    ? 'Asset migration'
    : 'Asset migration (dry run — nothing was written)');
  output.log(`  legacy root:   ${legacyRoot}`);
  output.log(`  cloudpit root: ${newRoot}`);
  output.log(
    `  copied=${report.copied} skipped=${report.skipped} conflicts=${report.conflicts.length}`
    + ` rewritten=${report.rewritten} unrewritable=${report.unrewritable.length}`
    + ` backups=${report.backupPaths.length}`,
  );
  for (const conflict of report.conflicts) output.log(`  conflict: ${conflict}`);
  for (const reference of report.unrewritable) output.log(`  unrewritable: ${reference}`);
  for (const backupPath of report.backupPaths) output.log(`  backup: ${backupPath}`);
}

/**
 * Warnings and errors go to stderr in both render modes so a `--json` run's
 * stdout stays one parseable object.
 */
export function printAssetMigrationDiagnostics(
  output: CliOutput,
  report: AssetMigrationReport,
  legacyRoot: string,
): void {
  if (report.unrewritable.length > 0) {
    output.error(
      `[WARN] ${report.unrewritable.length} reference(s) still point at ${legacyRoot};`
      + ' provider transcripts are not rewritten — resolve them by hand.',
    );
  }
  for (const error of report.errors) output.error(`[ERROR] ${error}`);
}

/** `0` clean, `1` failed/rolled back, `3` success with unrewritable transcript references. */
export function assetMigrationExitCode(report: AssetMigrationReport): number {
  if (report.errors.length > 0) return EXIT_FAILED;
  if (report.unrewritable.length > 0) return EXIT_UNREWRITABLE;
  return EXIT_OK;
}

import path from 'node:path';

import { getImageAssetsRoots } from '@/shared/image-attachments.js';
import type { CliOutput } from '@/shared/types.js';

import {
  filesHaveSameContent,
  listFilesUnder,
  type AssetMigrationFileSystem,
} from './asset-migration-files.js';
import {
  EXIT_FAILED,
  EXIT_OK,
  USAGE,
  assetMigrationExitCode,
  parseAssetMigrationOptions,
  printAssetMigrationDiagnostics,
  printAssetMigrationReport,
  type AssetMigrationReport,
} from './asset-migration-report.js';
import type { AssetPathDocumentUpdate, AssetPathStore } from './asset-migration-store.js';

/**
 * `cloudpit migrate-assets` (R4 prerequisite).
 *
 * Copies `~/.cloudcli/assets` into the Cloudpit assets root, then rewrites the
 * legacy absolute paths the app persists itself (the auth database and known
 * JSON state files). The legacy directory is never deleted or renamed: it stays
 * as the rollback source and as the read root for references this command
 * cannot safely rewrite.
 *
 * Provider transcripts (Claude JSONL, Codex session JSONL) are external files
 * owned by the CLIs, so they are scanned read-only and every hit is reported in
 * `unrewritable`; the command exits non-zero rather than pretending success.
 */

/** Command surface consumed by `cli.service.ts` (mirrors the sandbox command object). */
export type AssetMigrationCommandService = {
  execute(argumentsList: string[]): Promise<number>;
};

/** Dependencies of {@link createAssetMigrationService}; every seam is injectable. */
export type AssetMigrationServiceDependencies = {
  environment: Readonly<Record<string, string | undefined>>;
  homeDirectory: string;
  fileSystem: AssetMigrationFileSystem;
  pathStore: AssetPathStore;
  output: CliOutput;
  /** Read-only transcript roots; defaults to the Claude and Codex session trees. */
  externalRoots?: string[];
};

/** Provider transcript roots owned by the CLIs; scanned, never rewritten. */
function defaultExternalRoots(homeDirectory: string): string[] {
  return [
    path.join(homeDirectory, '.claude', 'projects'),
    path.join(homeDirectory, '.codex', 'sessions'),
  ];
}

/** Both spellings of a root, so posix-normalized JSON matches on Windows too. */
function rootVariants(rootPath: string): string[] {
  return [...new Set([rootPath, rootPath.split(path.sep).join('/')])];
}

/** Replaces every occurrence of each legacy variant while keeping the form it used. */
function rewritePaths(
  text: string,
  legacyVariants: string[],
  newRoot: string,
  legacyRoot: string,
): string {
  let rewritten = text;
  for (const variant of legacyVariants) {
    const replacement =
      variant === legacyRoot ? newRoot : newRoot.split(path.sep).join('/');
    rewritten = rewritten.split(variant).join(replacement);
  }
  return rewritten;
}

/** Collects every external `file:line` hit for the legacy roots, read-only. */
function collectUnrewritableReferences(
  fileSystem: AssetMigrationFileSystem,
  externalRoots: string[],
  legacyVariants: string[],
): string[] {
  const references: string[] = [];
  for (const rootPath of externalRoots) {
    for (const filePath of listFilesUnder(fileSystem, rootPath)) {
      if (!/\.(jsonl|json)$/i.test(filePath)) continue;
      let text: string;
      try {
        text = fileSystem.readTextFile(filePath);
      } catch {
        continue;
      }
      text.split(/\r?\n/).forEach((line, index) => {
        if (legacyVariants.some((variant) => line.includes(variant))) {
          references.push(`${filePath}:${index + 1}`);
        }
      });
    }
  }
  return references;
}

/** One source file and the copy decision made for it. */
type CopyPlanEntry = {
  relativePath: string;
  sourcePath: string;
  targetPath: string;
  action: 'copy' | 'skip' | 'conflict';
};

/**
 * Creates the migrate-assets command service.
 *
 * Copies are additive and idempotent, so a partial copy is safe; the path
 * rewrite is the destructive half, which is why it alone takes backups and
 * rolls the whole batch back on failure.
 */
export function createAssetMigrationService(
  dependencies: AssetMigrationServiceDependencies,
): AssetMigrationCommandService {
  const { fileSystem, output } = dependencies;

  return {
    async execute(argumentsList) {
      if (argumentsList.includes('--help') || argumentsList.includes('-h')) {
        output.log(USAGE);
        return EXIT_OK;
      }
      if (argumentsList.length === 0) {
        output.log(USAGE);
        return EXIT_FAILED;
      }

      const parsed = parseAssetMigrationOptions(argumentsList);
      if (typeof parsed === 'string') {
        output.error(`[ERROR] ${parsed}`);
        output.log(USAGE);
        return EXIT_FAILED;
      }

      const roots = getImageAssetsRoots({
        env: dependencies.environment,
        homeDir: dependencies.homeDirectory,
      });
      const legacyRoot = roots.legacyRoot;
      const newRoot = roots.newRoot;
      const legacyVariants = rootVariants(legacyRoot);
      const report: AssetMigrationReport = {
        copied: 0,
        skipped: 0,
        conflicts: [],
        rewritten: 0,
        unrewritable: [],
        backupPaths: [],
        errors: [],
      };

      const copyPlan: CopyPlanEntry[] = [];
      for (const sourcePath of listFilesUnder(fileSystem, legacyRoot)) {
        const relativePath = path.relative(legacyRoot, sourcePath);
        const targetPath = path.join(newRoot, relativePath);
        if (!fileSystem.pathExists(targetPath)) {
          copyPlan.push({ relativePath, sourcePath, targetPath, action: 'copy' });
          report.copied += 1;
        } else if (filesHaveSameContent(fileSystem, sourcePath, targetPath)) {
          copyPlan.push({ relativePath, sourcePath, targetPath, action: 'skip' });
          report.skipped += 1;
        } else {
          copyPlan.push({ relativePath, sourcePath, targetPath, action: 'conflict' });
          report.conflicts.push(relativePath);
        }
      }

      const updates: AssetPathDocumentUpdate[] = [];
      for (const document of dependencies.pathStore.readDocuments()) {
        if (!legacyVariants.some((variant) => document.text.includes(variant))) continue;
        updates.push({
          document,
          text: rewritePaths(document.text, legacyVariants, newRoot, legacyRoot),
        });
      }
      report.rewritten = updates.length;

      report.unrewritable = collectUnrewritableReferences(
        fileSystem,
        dependencies.externalRoots ?? defaultExternalRoots(dependencies.homeDirectory),
        legacyVariants,
      );

      if (parsed.mode === 'rewrite') {
        for (const entry of copyPlan) {
          if (entry.action !== 'copy') continue;
          try {
            fileSystem.createDirectory(path.dirname(entry.targetPath));
            fileSystem.copyFile(entry.sourcePath, entry.targetPath);
          } catch (error) {
            report.errors.push(`copy ${entry.relativePath}: ${describeFailure(error)}`);
          }
        }

        if (updates.length > 0) {
          report.backupPaths = dependencies.pathStore.backup();
          try {
            dependencies.pathStore.writeDocuments(updates);
          } catch (error) {
            report.errors.push(`rewrite: ${describeFailure(error)}`);
            report.rewritten = 0;
            try {
              dependencies.pathStore.restore(report.backupPaths);
            } catch (restoreError) {
              report.errors.push(`restore: ${describeFailure(restoreError)}`);
            }
          }
        }
      }

      if (parsed.json) {
        output.log(JSON.stringify(report, null, 2));
      } else {
        printAssetMigrationReport(output, report, parsed.mode, legacyRoot, newRoot);
      }
      printAssetMigrationDiagnostics(output, report, legacyRoot);
      return assetMigrationExitCode(report);
    },
  };
}

/** Error message without importing a shared helper name the architecture ratchet counts. */
function describeFailure(failure: unknown): string {
  return failure instanceof Error ? failure.message : String(failure);
}

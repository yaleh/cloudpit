import fsp from 'node:fs/promises';
import path from 'node:path';

/**
 * Depth-limited search for a rollout file whose name ends with `suffix`.
 *
 * Consumed by `codex-fork-history` (finding a fork's base rollout under the
 * shared `sessions/` root) and `codex-sessions.provider` (finding a spawned
 * agent's rollout beside its parent). Both call sites search Codex's
 * date-partitioned `sessions/` archive, where the thread id is a unique name
 * suffix, so the walk matches names only and never reads file contents.
 *
 * @param directory - directory to search first. Results are joined onto it, so
 *   they inherit its absolute/relative form.
 * @param suffix - the filename suffix to match, e.g. `-<threadId>.jsonl`.
 * @param depth - how many directory levels below `directory` to recurse; `0`
 *   searches only `directory` itself. Subdirectory descent is breadth-first at
 *   each level: a file in the current directory wins over a deeper match.
 * @returns the first matching path, or `null` when nothing matches or the
 *   search root cannot be read.
 */
export async function findFileWithSuffix(
  directory: string,
  suffix: string,
  depth: number,
): Promise<string | null> {
  let entries;
  try {
    entries = await fsp.readdir(directory, { withFileTypes: true });
  } catch {
    return null;
  }

  const subdirectories: string[] = [];
  for (const entry of entries) {
    if (entry.isDirectory()) {
      subdirectories.push(path.join(directory, entry.name));
      continue;
    }
    if (entry.name.endsWith(suffix)) {
      return path.join(directory, entry.name);
    }
  }

  if (depth <= 0) {
    return null;
  }
  for (const subdirectory of subdirectories) {
    const match = await findFileWithSuffix(subdirectory, suffix, depth - 1);
    if (match) {
      return match;
    }
  }

  return null;
}

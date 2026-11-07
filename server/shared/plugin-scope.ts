import path from 'node:path';

//----------------- PLUGIN INSTALL SCOPES ------------

/**
 * The three Claude Code plugin install scopes a record in
 * `~/.claude/plugins/installed_plugins.json` can carry.
 *
 * A `user` record applies to every workspace; `project` and `local` records belong to the one
 * project named by their `projectPath`.
 */
export type PluginInstallScope = 'local' | 'project' | 'user';

/**
 * One install record of a plugin, read from an `installed_plugins.json` `plugins[<id>]` array.
 *
 * `installPath` is the installed release directory and `version` is its release string; the two
 * belong together because the cache keeps every release side by side. `projectPath` and
 * `lastUpdated` are only meaningful for filtering and ordering: the former scopes a
 * project/local record to its workspace, the latter breaks ties inside one scope.
 */
export type PluginInstallRecord = {
  scope: PluginInstallScope;
  installPath: string;
  version: string;
  projectPath: string | null;
  lastUpdated: string | null;
};

/** One record that applies to a workspace, with its scope's enabled state already resolved. */
export type PluginScopeCandidate = {
  record: PluginInstallRecord;
  enabled: boolean;
};

/** One settings file's `enabledPlugins[pluginId]` reading per scope; absent means "said nothing". */
export type PluginEnabledFlags = Partial<Record<PluginInstallScope, boolean>>;

/** The enabled state of each scope, after the fallback chain has been applied. */
export type PluginEnabledScopes = Record<PluginInstallScope, boolean>;

/** The inputs that turn a plugin's install records into an ordered, applicability-filtered list. */
export type PluginScopeSelection = {
  /** Absolute or relative workspace root the project/local records are compared against. */
  projectRoot: string;
  records: readonly PluginInstallRecord[];
  enabledByScope: PluginEnabledScopes;
};

/** Local records outrank project records, which outrank user records. */
const PLUGIN_SCOPE_RANK: Record<PluginInstallScope, number> = {
  local: 3,
  project: 2,
  user: 1,
};

/** A non-empty trimmed string, otherwise `null`. */
const readScopeString = (value: unknown): string | null =>
  typeof value === 'string' && value.trim() !== '' ? value.trim() : null;

/** Whether an unknown JSON value is one of the three install scopes. */
const isPluginInstallScope = (value: unknown): value is PluginInstallScope =>
  value === 'local' || value === 'project' || value === 'user';

/**
 * Reads one plugin's install records out of an `installed_plugins.json` `plugins[pluginId]`
 * value. Malformed entries — an unknown scope, a missing `installPath`, or anything that is not
 * an object — are dropped rather than throwing, because a hand-edited registry must not take the
 * plugin listing down.
 *
 * Consumers: `modules/quay/quay-entrypoint-resolver.ts` (which `quay@quay` release drives the
 * CLI) and `modules/providers/list/claude/claude-skills.provider.ts` (which installed release's
 * payload supplies the menu's plugin skills).
 */
export function parsePluginInstallRecords(rawValue: unknown): PluginInstallRecord[] {
  if (!Array.isArray(rawValue)) {
    return [];
  }

  const records: PluginInstallRecord[] = [];
  for (const raw of rawValue) {
    if (typeof raw !== 'object' || raw === null || Array.isArray(raw)) {
      continue;
    }
    const record = raw as Record<string, unknown>;
    if (!isPluginInstallScope(record.scope)) {
      continue;
    }
    const installPath = readScopeString(record.installPath);
    if (installPath === null) {
      continue;
    }
    records.push({
      scope: record.scope,
      installPath,
      version: readScopeString(record.version) ?? '',
      projectPath: readScopeString(record.projectPath),
      lastUpdated: readScopeString(record.lastUpdated),
    });
  }
  return records;
}

/**
 * Reads one settings document's `enabledPlugins[pluginId]` boolean.
 *
 * `undefined` means the document said nothing about this plugin — a missing file, an unrelated
 * plugin key, or a malformed `enabledPlugins` value all read the same way, because the caller's
 * fallback chain, not the reader, decides what "nothing" means. A non-boolean value is likewise
 * treated as absent instead of guessing.
 *
 * Consumers: the resolver (per-file reads through its injectable filesystem) and the Claude
 * skills provider (per-file reads through `readJsonConfig`).
 */
export function readPluginEnabledFlag(
  settingsDocument: unknown,
  pluginId: string,
): boolean | undefined {
  if (
    typeof settingsDocument !== 'object'
    || settingsDocument === null
    || Array.isArray(settingsDocument)
  ) {
    return undefined;
  }
  const enabledPlugins = (settingsDocument as Record<string, unknown>).enabledPlugins;
  if (
    typeof enabledPlugins !== 'object'
    || enabledPlugins === null
    || Array.isArray(enabledPlugins)
  ) {
    return undefined;
  }
  const value = (enabledPlugins as Record<string, unknown>)[pluginId];
  return typeof value === 'boolean' ? value : undefined;
}

/**
 * Applies Claude's `enabledPlugins` precedence: a scope that says nothing inherits the next
 * lower scope, and a deployment that configured none of them keeps the plugin enabled.
 *
 * `local` (`.claude/settings.local.json`) is the project's final word, then
 * `.claude/settings.json`, then the user settings. The fallback — not a per-scope default of
 * `true` — is what makes a project's explicit `false` also disable an unconfigured local record.
 *
 * Consumers: the quay entrypoint resolver and the Claude skills provider; both read the same
 * three files, only their filesystem seam differs.
 */
export function resolveEnabledPluginScopes(flags: PluginEnabledFlags): PluginEnabledScopes {
  const user = flags.user ?? true;
  const project = flags.project ?? user;
  const local = flags.local ?? project;
  return { user, project, local };
}

/**
 * Filters a plugin's install records down to the ones that apply to `projectRoot` and orders
 * them by the CLI's own priority: local, then project, then user; inside one scope the most
 * recently updated record wins.
 *
 * A `user` record applies everywhere. A `project` or `local` record whose `projectPath` is not
 * this workspace belongs to some other project and is dropped — that filter is what keeps one
 * project's local install out of another project's plugin list. The enabled state is attached
 * per scope so the caller's next-record degradation (skip a dead or disabled record) stays its
 * own decision.
 *
 * Consumers: `createQuayEntrypointResolver` takes the first usable candidate, and the Claude
 * skills provider takes the first candidate whose `installPath` still exists.
 */
export function selectPluginScopeCandidates(
  selection: PluginScopeSelection,
): PluginScopeCandidate[] {
  const resolvedProjectRoot = path.resolve(selection.projectRoot);

  return selection.records
    .filter((record) => {
      if (record.scope === 'user') {
        return true;
      }
      return (
        record.projectPath !== null
        && path.resolve(record.projectPath) === resolvedProjectRoot
      );
    })
    .sort((left, right) => {
      const rank = PLUGIN_SCOPE_RANK[right.scope] - PLUGIN_SCOPE_RANK[left.scope];
      if (rank !== 0) {
        return rank;
      }
      return (right.lastUpdated ?? '').localeCompare(left.lastUpdated ?? '');
    })
    .map((record) => ({ record, enabled: selection.enabledByScope[record.scope] }));
}

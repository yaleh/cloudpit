import { readFile, readdir, stat } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';

import { SkillsProvider } from '@/modules/providers/shared/skills/skills.provider.js';
import { parseFrontMatter } from '@/shared/frontmatter.js';
import {
  parsePluginInstallRecords,
  readPluginEnabledFlag,
  resolveEnabledPluginScopes,
  selectPluginScopeCandidates,
} from '@/shared/plugin-scope.js';
import type { PluginScopeCandidate } from '@/shared/plugin-scope.js';
import type {
  ProviderSkill,
  ProviderSkillListOptions,
  ProviderSkillSource,
} from '@/shared/types.js';
import {
  findProviderSkillMarkdownFiles,
  readJsonConfig,
  readObjectRecord,
  readOptionalString,
  readProviderSkillMarkdownDefinition,
} from '@/shared/utils.js';

const getClaudeHomePath = (): string => path.join(os.homedir(), '.claude');

const getClaudePluginName = (pluginId: string): string | null => {
  const normalizedPluginId = pluginId.trim();
  if (!normalizedPluginId || normalizedPluginId === '@') {
    return null;
  }

  const [pluginName] = normalizedPluginId.split('@');
  return readOptionalString(pluginName) ?? null;
};

const stripMarkdownExtension = (filename: string): string =>
  filename.replace(/\.md$/i, '');

const pathExistsAsDirectory = async (directoryPath: string): Promise<boolean> => {
  try {
    const directoryStats = await stat(directoryPath);
    return directoryStats.isDirectory();
  } catch {
    return false;
  }
};

const listChildDirectories = async (directoryPath: string): Promise<string[]> => {
  try {
    const entries = await readdir(directoryPath, { withFileTypes: true });
    return entries
      .filter((entry) => entry.isDirectory())
      .map((entry) => path.join(directoryPath, entry.name))
      .sort((left, right) => left.localeCompare(right));
  } catch {
    return [];
  }
};

/** A directory name that looks like a cached plugin release (e.g. `0.31.1`, `0.26.0-dev`). */
const SEMVER_DIRECTORY_PATTERN = /^\d+\.\d+\.\d+(?:[-+][0-9A-Za-z.]+)*$/;

const hasPluginPayload = async (pluginFolder: string): Promise<boolean> => {
  const commandsPath = path.join(pluginFolder, 'commands');
  if (await pathExistsAsDirectory(commandsPath)) {
    return true;
  }
  return pathExistsAsDirectory(path.join(pluginFolder, 'skills'));
};

/**
 * Resolves the folders that carry one install record's plugin payload.
 *
 * Claude's cache keeps every release of a plugin beside the others
 * (`cache/<marketplace>/<plugin>/0.30.0`, `0.31.1`, …), and `installPath`
 * points at the one the user installed. That folder is the payload: scanning
 * its siblings resurrects old releases whose front matter still names former
 * commands. Only when `installPath` carries neither `commands/` nor `skills/`
 * do we fall back to the sibling layout, and then a semver sibling must match
 * the install record's own `version` — non-semver siblings (`builtin`,
 * `legacy777`) are kept for historical layouts.
 */
const resolvePluginPayloadFolders = async (
  installPath: string,
  installVersion: string | undefined,
): Promise<string[]> => {
  if (await hasPluginPayload(installPath)) {
    return [installPath];
  }

  const siblingFolders = await listChildDirectories(path.dirname(installPath));
  return siblingFolders.filter((pluginFolder) => {
    const folderName = path.basename(pluginFolder);
    if (!SEMVER_DIRECTORY_PATTERN.test(folderName)) {
      return true;
    }
    return installVersion !== undefined && folderName === installVersion;
  });
};

const readClaudePluginName = async (
  installPath: string,
  pluginId: string,
): Promise<string | null> => {
  try {
    const pluginConfig = await readJsonConfig(
      path.join(installPath, '.claude-plugin', 'plugin.json'),
    );

    // Older or partial plugin installs may not have plugin.json yet. Falling
    // back keeps discovery useful without inventing a separate namespace.
    return readOptionalString(pluginConfig.name) ?? getClaudePluginName(pluginId);
  } catch {
    return getClaudePluginName(pluginId);
  }
};

export class ClaudeSkillsProvider extends SkillsProvider {
  constructor() {
    super('claude');
  }

  async listSkills(options?: ProviderSkillListOptions): Promise<ProviderSkill[]> {
    const workspacePath = path.resolve(options?.workspacePath ?? process.cwd());
    return [
      ...(await super.listSkills(options)),
      ...(await this.listPluginSkills(getClaudeHomePath(), workspacePath)),
    ];
  }

  protected async getSkillSources(workspacePath: string): Promise<ProviderSkillSource[]> {
    const claudeHomePath = getClaudeHomePath();

    return [
      {
        scope: 'user',
        rootDir: path.join(claudeHomePath, 'skills'),
        commandPrefix: '/',
      },
      {
        scope: 'project',
        rootDir: path.join(workspacePath, '.claude', 'skills'),
        commandPrefix: '/',
      },
    ];
  }

  protected async getGlobalSkillSource(): Promise<ProviderSkillSource> {
    return {
      scope: 'user',
      rootDir: path.join(getClaudeHomePath(), 'skills'),
      commandPrefix: '/',
    };
  }

  /**
   * Lists the commands and skills of every installed plugin that applies to `workspacePath`.
   *
   * Claude's registry can hold several records for one plugin — one per install scope — and its
   * cache holds every release. Only the highest-priority applicable, enabled record is the
   * installed payload. Walking every record instead is what surfaced a `scope: local` install
   * belonging to a different project and what listed one plugin's commands twice; the
   * applicability and precedence rules live in `server/shared/plugin-scope.ts` so this provider
   * and the quay entrypoint resolver cannot drift apart.
   */
  private async listPluginSkills(
    claudeHomePath: string,
    workspacePath: string,
  ): Promise<ProviderSkill[]> {
    const installedConfig = await readJsonConfig(
      path.join(claudeHomePath, 'plugins', 'installed_plugins.json'),
    );
    const installedPlugins = readObjectRecord(installedConfig.plugins);
    if (!installedPlugins) {
      return [];
    }

    // The three files that may carry each plugin's enabled state, read once for the listing.
    // A plugin absent from all three follows the shared rule's default (enabled).
    const [userSettings, projectSettings, projectLocalSettings] = await Promise.all([
      readJsonConfig(path.join(claudeHomePath, 'settings.json')),
      readJsonConfig(path.join(workspacePath, '.claude', 'settings.json')),
      readJsonConfig(path.join(workspacePath, '.claude', 'settings.local.json')),
    ]);

    const skills: ProviderSkill[] = [];
    const pluginIds = Object.keys(installedPlugins).sort((left, right) =>
      left.localeCompare(right),
    );
    for (const pluginId of pluginIds) {
      const enabledByScope = resolveEnabledPluginScopes({
        user: readPluginEnabledFlag(userSettings, pluginId),
        project: readPluginEnabledFlag(projectSettings, pluginId),
        local: readPluginEnabledFlag(projectLocalSettings, pluginId),
      });
      const candidate = await this.selectInstalledPluginRecord(
        selectPluginScopeCandidates({
          projectRoot: workspacePath,
          records: parsePluginInstallRecords(installedPlugins[pluginId]),
          enabledByScope,
        }),
      );
      if (candidate === null) {
        continue;
      }

      const { installPath, version: installVersion } = candidate.record;
      const pluginFolders = await resolvePluginPayloadFolders(installPath, installVersion);
      const visitedPluginFolders = new Set<string>();
      for (const pluginFolder of pluginFolders) {
        const pluginFolderKey = `${pluginId}:${path.resolve(pluginFolder)}`;
        if (visitedPluginFolders.has(pluginFolderKey)) {
          continue;
        }
        visitedPluginFolders.add(pluginFolderKey);

        const pluginName = await readClaudePluginName(pluginFolder, pluginId);
        if (!pluginName) {
          continue;
        }

        // A plugin may ship commands, skills, or both, and the CLI offers
        // both halves. Reading only the first folder found hid every skill
        // that sits beside a commands folder -- and hid the whole plugin when
        // its commands are in a format this reader does not take.
        const commandsPath = path.join(pluginFolder, 'commands');
        if (await pathExistsAsDirectory(commandsPath)) {
          skills.push(
            ...(await this.listPluginCommandSkills(commandsPath, pluginId, pluginName)),
          );
        }

        const skillsPath = path.join(pluginFolder, 'skills');
        if (!(await pathExistsAsDirectory(skillsPath))) {
          continue;
        }

        skills.push(
          ...(await this.listPluginSkillMarkdowns(pluginFolder, pluginId, pluginName)),
        );
      }
    }

    return skills;
  }

  /**
   * The first enabled candidate whose `installPath` is still a directory, or `null`.
   *
   * A record whose release directory was cleaned up must degrade to the next scope — the same
   * fallback the quay entrypoint resolver performs — instead of hiding a lower-scope install
   * that still exists.
   */
  private async selectInstalledPluginRecord(
    candidates: readonly PluginScopeCandidate[],
  ): Promise<PluginScopeCandidate | null> {
    for (const candidate of candidates) {
      if (!candidate.enabled) {
        continue;
      }
      if (await pathExistsAsDirectory(candidate.record.installPath)) {
        return candidate;
      }
    }
    return null;
  }

  private async listPluginCommandSkills(
    commandsPath: string,
    pluginId: string,
    pluginName: string,
  ): Promise<ProviderSkill[]> {
    const skills: ProviderSkill[] = [];

    try {
      const entries = await readdir(commandsPath, { withFileTypes: true });
      const commandFiles = entries
        .filter((entry) => entry.isFile() && entry.name.toLowerCase().endsWith('.md'))
        .sort((left, right) => left.name.localeCompare(right.name));

      for (const commandFile of commandFiles) {
        const sourcePath = path.join(commandsPath, commandFile.name);
        try {
          const definition = await this.readPluginCommandDefinition(sourcePath);
          skills.push({
            provider: this.provider,
            name: definition.name,
            description: definition.description,
            command: `/${pluginName}:${definition.name}`,
            scope: 'plugin',
            sourcePath,
            pluginName,
            pluginId,
          });
        } catch {
          // Malformed command markdown should not block sibling plugin commands.
        }
      }
    } catch {
      // Missing or unreadable command folders are treated as empty plugin command sets.
    }

    return skills;
  }

  private async readPluginCommandDefinition(
    commandPath: string,
  ): Promise<{ name: string; description: string }> {
    const content = await readFile(commandPath, 'utf8');
    const parsed = parseFrontMatter(content);
    const data = readObjectRecord(parsed.data) ?? {};

    return {
      name: stripMarkdownExtension(path.basename(commandPath)),
      description: readOptionalString(data.description) ?? '',
    };
  }

  private async listPluginSkillMarkdowns(
    installPath: string,
    pluginId: string,
    pluginName: string,
  ): Promise<ProviderSkill[]> {
    const skillFiles = await findProviderSkillMarkdownFiles(path.join(installPath, 'skills'), {
      recursive: true,
    });
    const skills: ProviderSkill[] = [];

    for (const skillPath of skillFiles) {
      try {
        const definition = await readProviderSkillMarkdownDefinition(skillPath);
        skills.push({
          provider: this.provider,
          name: definition.name,
          description: definition.description,
          command: `/${pluginName}:${definition.name}`,
          scope: 'plugin',
          sourcePath: skillPath,
          pluginName,
          pluginId,
        });
      } catch {
        // A bad plugin skill file should not block other installed plugin skills.
      }
    }

    return skills;
  }
}

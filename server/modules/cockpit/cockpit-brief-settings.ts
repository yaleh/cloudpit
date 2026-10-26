/**
 * The cockpit brief's budget and switch: the shipped defaults, the ONE environment entry
 * (`SERVER_SETTINGS_PATH`, the same contract `server/modules/settings/server-settings.ts`
 * reads), and a reader that re-reads the file whenever its modification time changes.
 *
 * WHERE THE BLOCK LIVES. `cockpit.brief` in the SERVER settings file — next to
 * `cockpit.enabled` and `cockpit.fixtureCards`, which the boot loader already reads. The block
 * deliberately carries only the knobs that are about THIS feature: the switch and the two token
 * ceilings. The model and the gateway are NOT duplicated here; they come from the
 * reply-suggestions settings file through the composition root's injected `readGateway`, the same
 * way the session-digest LLM tier reuses them. A second channel or a second key spelling would
 * be exactly the drift the shared settings reader exists to prevent.
 *
 * THE READING IS NEVER FATAL. A missing file is the normal "feature off" state; a malformed
 * known key falls back to its shipped default and is named in `problems`; an unknown key is
 * ignored. Nothing here throws, because a bad knob must never stop the server.
 *
 * Consumers: `cockpit-brief.service.ts` (through `readSettings`) and
 * `tests/cockpit-brief.test.ts` (the budget cases drive the reader over files they own).
 */
import os from 'node:os';

import {
  createSettingsBlockSource,
  defaultServerSettingsPath,
  readBoolean,
  readInteger,
  resolveSettingsPath,
  type SettingsBlockContext,
} from '@/shared/settings-file.js';

/**
 * The environment variable naming the server settings file.
 *
 * Kept as a literal rather than imported from `modules/settings`: `modules/settings` imports
 * feature barrels, so reaching back into it from this leaf would close a directory import cycle
 * (AC-394). The string is the contract; this comment is the tie to its owner.
 */
export const SERVER_SETTINGS_PATH_ENV = 'SERVER_SETTINGS_PATH';

/**
 * The shipped `cockpit.brief` values.
 *
 * 30 000 tokens per brief and 500 000 per day are the E2 experiment's measured recommendation:
 * one gateway brief cost about 13 000 tokens at p90, so 30k leaves room for three repair rounds
 * while the daily cap keeps a runaway fleet from spending without bound.
 */
const DEFAULT_COCKPIT_BRIEF = {
  enabled: false,
  perBriefTokenCap: 30_000,
  dailyTokenCap: 500_000,
} as const;

/** One reading of the block, with every knob resolved to a concrete value. */
export type CockpitBriefSettings = {
  /** The switch exactly as the file states it; gateway availability is checked per call. */
  enabled: boolean;
  /** Input + output + cache-read + cache-creation tokens one brief may spend. */
  perBriefTokenCap: number;
  /** The same total, summed across every brief in one UTC day. */
  dailyTokenCap: number;
  source: 'default' | 'file';
  path: string | null;
  problems: string[];
};

/** The stateful reader the service and the criterion share. */
export type CockpitBriefSettingsSource = {
  read(): CockpitBriefSettings;
};

/** Builds one reading from the already-selected `cockpit.brief` block (null means absent). */
function buildReading(block: Record<string, unknown> | null, context: SettingsBlockContext): CockpitBriefSettings {
  const problems = context.problems;
  return {
    enabled:
      block === null
        ? DEFAULT_COCKPIT_BRIEF.enabled
        : readBoolean(block, 'enabled', DEFAULT_COCKPIT_BRIEF.enabled, problems),
    perBriefTokenCap:
      block === null
        ? DEFAULT_COCKPIT_BRIEF.perBriefTokenCap
        : readInteger(block, 'perBriefTokenCap', DEFAULT_COCKPIT_BRIEF.perBriefTokenCap, { minimum: 1, maximum: 10_000_000 }, problems),
    dailyTokenCap:
      block === null
        ? DEFAULT_COCKPIT_BRIEF.dailyTokenCap
        : readInteger(block, 'dailyTokenCap', DEFAULT_COCKPIT_BRIEF.dailyTokenCap, { minimum: 1, maximum: 1_000_000_000 }, problems),
    source: context.source,
    path: context.path,
    problems,
  };
}

/**
 * Builds a stateful reader over the server settings file.
 *
 * `settingsPath` follows the same resolution order as the boot loader: an explicit path, then
 * `SERVER_SETTINGS_PATH`, then `~/.config/claudecodeui/server.settings.json`.
 *
 * Consumers: `cockpit-brief.service.ts` (its default `readSettings`) and
 * `tests/cockpit-brief.test.ts`.
 */
export function createCockpitBriefSettingsSource(
  options: {
    /** `undefined` = env-or-default, `null` = no file at all, a string = explicitly named. */
    settingsPath?: string | null;
    env?: Record<string, string | undefined>;
    homeDir?: string;
  } = {},
): CockpitBriefSettingsSource {
  const env = options.env ?? process.env;
  const homeDir = options.homeDir ?? os.homedir();
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
    block: 'cockpit.brief',
    explicit,
    parse: buildReading,
  });
}

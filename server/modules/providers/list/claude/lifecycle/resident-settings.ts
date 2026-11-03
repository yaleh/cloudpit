/**
 * The user-level settings and Remote Control gate the resident launch reads.
 * Extracted from `claude-host-driver.provider.ts`; see
 * `lifecycle/resident-process.types.ts` for why this directory is a sink.
 */

import { spawn as nodeSpawn } from 'node:child_process';
import { randomUUID } from 'node:crypto';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import type { Writable } from 'node:stream';

import { query } from '@anthropic-ai/claude-agent-sdk';
import type { SpawnOptions as SdkSpawnOptions, SpawnedProcess } from '@anthropic-ai/claude-agent-sdk';

import { createNotificationEvent, notifyUserIfEnabled } from '@/modules/notifications/index.js';
import type { SessionHostManager } from '@/modules/session-hosts/index.js';
import type { IProviderHostDriver, IProviderHostDriverSink } from '@/shared/interfaces.js';
import type {
  AnyRecord,
  BackgroundWorkTrigger,
  ChatRunSource,
  ClaudeResidentDeliveryReason,
  ClaudeResidentDeliveryState,
  CommandLifecycleEvent,
  CommandLifecycleState,
  DeliveryEntry,
  DeliveryEntryReason,
  HostBindErrorCode,
  HostCloseReason,
  HostInputPriority,
  HostLease,
  HostPendingQueuedInputs,
  HostQueuedInputCancelResult,
  HostReconfigurePatch,
  HostResidentLaunch,
  HostResidentStartResult,
  HostTurnInput,
  LLMProvider,
  ProcessHost,
  ProviderRuntimeContext,
  ProviderRuntimeWriter,
  RemoteControlIsolation,
  ResidentDeliveryLookup,
  ResidentLedger,
  ResidentLedgerAnomaly,
  ResidentLedgerClosedTurn,
  ResidentLedgerDelivery,
  ResidentLedgerTurn,
  SessionBinding,
} from '@/shared/types.js';
import { DELIVERY_SOURCE_OPTION, DELIVERY_TEXT_MAX_CHARS, isTerminalDeliveryState } from '@/shared/types.js';
import { readVoiceRulesPort } from '@/shared/ports/voice-rules.port.js';
import type {
  ResidentLedgerEffect,
  ResidentLedgerEvent,
} from '@/modules/resident-ledger/index.js';
import {
  applyLedgerEvent,
  createResidentLedger,
  ledgerClosedTurns,
  ledgerDeliveries,
  ledgerDeliveryByUuid,
  ledgerPendingStart,
  ledgerTurn,
} from '@/modules/resident-ledger/index.js';
import {
  ClaudeSessionOccupiedError,
  createCompleteMessage,
  createNormalizedMessage,
  findBackgroundSessionOwner,
  residentRunIsTurn,
  resolveClaudeConfigDir,
} from '@/shared/utils.js';

import {
  RESIDENT_PERMISSION_MODE,
  UNATTENDED_REFUSAL
} from './resident-process.types.js';

/**
 * How long a launched process is given to state its own name, and how often it
 * is asked.
 *
 * The name is written to the process's transcript as an `agent-name` entry, and
 * that entry is the only reading of it that proves the process really registered
 * the address rather than merely being launched with the flag. The budget is
 * short because the entry is written at startup: a process that has already
 * emitted its session id has been up long enough that a name which has not
 * appeared by the end of this window is one that is not coming.
 */
export const CLAUDE_RESIDENT_IDENTITY_BUDGET_MS = 5_000;
export const CLAUDE_RESIDENT_IDENTITY_POLL_MS = 50;

// `resolveClaudeConfigDir` now lives in `server/shared/utils.ts`: the per-run
// runtime resolves the same directory for its own occupancy gate, so the one
// definition is shared rather than copied.

// ------------------------- The Remote Control gate -------------------------
//
// A resident process is launched under `bypassPermissions` (see
// `RESIDENT_PERMISSION_MODE`), and a Claude CLI with the user's own
// `remoteControlAtStartup` on is reachable from *other machines*: Remote Control
// bridges it to Anthropic's backend, where a peer session on another host can
// drive it. A resident process that nobody is watching, running under bypass,
// therefore has a trust boundary that is wider than the Unix user this
// application's whole process model assumes — which is the boundary the proposal
// promised. The gate below is the conservative branch of that promise.
//
// ## Why "refuse" and not "turn it off"
//
// The obvious fix — state `remoteControlAtStartup: false` in the launch's own
// settings and rely on it — is *also* done (see `CLAUDE_REMOTE_CONTROL_FLAGS`),
// but it is not what the refusal rests on, because this build has no reading
// that the flag wins: E9 §9.7 asked the running process what its settings were
// and got no answer at all (`get_settings` never responded), so "the flag
// overrides the user's file" is an assumption rather than a measurement. A gate
// that assumed it would be claiming a security property from an unmeasured
// precedence rule. So the user's *file* is read first, and if it says on, no
// process is started at all: the refusal is a fact this side owns, where the
// precedence is not. The two flags are still passed on every launch that *does*
// happen — defence in depth, and stated as such, never as evidence.
//
// ## What is read, and what is not
//
// User-level settings only: `<CLAUDE_CONFIG_DIR>/settings.json`. Project-level,
// local and managed settings are **not** read by this gate — that is a known gap,
// not an oversight, and it is recorded as one here because the reading has to be
// honest about its own scope. The file is read at launch time, on the config
// directory the process will actually be given, so what is read is what the
// child sees.
//
// A missing file, a missing key, an unparseable file and a `false` all read as
// "not on": only a literal `true` refuses. That is a deliberate asymmetry — this
// gate does not turn a file it cannot read into a permission it never granted —
// and it is why the reading is three-valued (`null` for "not stated") rather
// than a boolean: a criterion has to be able to tell `false` from "the key was
// not there at all".

/** The file inside a Claude config directory that holds the user-level settings. */
export const CLAUDE_USER_SETTINGS_FILE = 'settings.json';

/** The user-level key that turns Remote Control on at startup. */
export const CLAUDE_REMOTE_CONTROL_KEY = 'remoteControlAtStartup';

/**
 * The user-level key that requires an explicit approval before `SendMessage` can
 * reach a peer session on another machine.
 */
export const CLAUDE_ISOLATE_PEERS_KEY = 'isolatePeerMachines';

/**
 * The words the refusal's copy carries, named as constants for the same reason
 * `UNATTENDED_REFUSAL` is: the sentence is a user-facing statement this build
 * makes in exactly one place, and a criterion has to be able to hold it to those
 * words rather than to a paraphrase of them.
 */
export const REMOTE_CONTROL_ENABLED_REFUSAL = 'Remote Control 已开启';
export const REMOTE_CONTROL_BYPASS_REASON = '以 bypass 运行的常驻进程会被跨机器驱动';

/**
 * The two flags every resident launch states, requested and launched alike.
 *
 * `remoteControlAtStartup: false` is the defence-in-depth half and
 * `isolatePeerMachines: true` is the peer half — measured out of the SDK's own
 * type (`sdk.d.ts`: "Require explicit approval before SendMessage can reach a
 * peer session on another machine via Remote Control"). Both travel together
 * because the SDK's `settings` is one object; a launch that stated only one of
 * them would be a build that dropped half the sentence.
 */
export const CLAUDE_REMOTE_CONTROL_FLAGS: ClaudeRemoteControlFlags = {
  remoteControlAtStartup: false,
  isolatePeerMachines: true,
};

export type ClaudeRemoteControlFlags = {
  remoteControlAtStartup: boolean;
  isolatePeerMachines: boolean;
};

/**
 * What one user-level settings file said, key by key.
 *
 * `path` is carried so a reading can be printed next to the file it came from —
 * the criterion's negative half ("nothing under `~/.claude` was touched") is only
 * checkable if every reading names its source.
 */
export type ClaudeUserSettingsReading = {
  path: string;
  /** `true` only for a literal `true`; `false` for a literal `false`; else `null`. */
  remoteControlAtStartup: boolean | null;
  isolatePeerMachines: boolean | null;
};

/**
 * Why a resident start was refused, and what the user is told about it.
 *
 * `code` is a member of the application's refusal vocabulary (`HostBindErrorCode`)
 * rather than a word this file invents, so a caller branches on it the same way
 * it branches on the manager's two placement refusals; `message` is the
 * interface copy verbatim — the sentence a client renders is *this* string, not
 * a second one written beside it.
 */
export type ClaudeRemoteControlRefusal = {
  code: Extract<HostBindErrorCode, 'remote-control-enabled'>;
  message: string;
  /** The settings file the reading that refused came from, verbatim. */
  settingsPath: string;
  /** When the refusal was made, in host clock terms. */
  at: number;
};

/**
 * The refusal, as something a caller can catch.
 *
 * Thrown rather than returned because the refusal happens inside a *run*, whose
 * signature (`Promise<void>`) has no room for an answer, and because the caller
 * that has to branch on it — the application dispatch — already handles a
 * rejected run. `code` and `settingsPath` are carried as fields rather than
 * folded into the message so the branch is on a value, not on prose.
 */
export class ClaudeRemoteControlRefusalError extends Error {
  readonly code: ClaudeRemoteControlRefusal['code'];
  readonly settingsPath: string;

  constructor(refusal: ClaudeRemoteControlRefusal) {
    super(refusal.message);
    this.name = 'ClaudeRemoteControlRefusalError';
    this.code = refusal.code;
    this.settingsPath = refusal.settingsPath;
  }
}

/** The refusal's copy, built once so every caller gets the same sentence. */
export function remoteControlRefusalMessage(): string {
  return (
    `${REMOTE_CONTROL_ENABLED_REFUSAL}：${REMOTE_CONTROL_BYPASS_REASON}，` +
    '已拒绝以 bypass 启动常驻进程。请在用户级 settings 里关闭 Remote Control 后重试。'
  );
}

/** True for exactly the two JSON values this gate reads as a statement. */
export function readSettingsFlag(value: unknown): boolean | null {
  return value === true ? true : value === false ? false : null;
}

/**
 * Reads one user-level settings file, as the gate sees it.
 *
 * The three "not stated" paths — no such file, unreadable file, unparseable
 * JSON — all answer `null` for both keys rather than throwing, because the gate
 * that calls this is deciding whether to *allow* a launch: a settings file this
 * process cannot make sense of is not a file that said "on", and refusing every
 * launch on a machine with a malformed file would trade a real feature for
 * nothing. What that costs is stated above: the reading's scope is one file.
 */
export function readClaudeUserSettings(settingsPath: string): ClaudeUserSettingsReading {
  let raw: string;
  try {
    raw = readFileSync(settingsPath, 'utf8');
  } catch {
    return { path: settingsPath, remoteControlAtStartup: null, isolatePeerMachines: null };
  }

  let parsed: unknown;
  try {
    parsed = JSON.parse(raw);
  } catch {
    return { path: settingsPath, remoteControlAtStartup: null, isolatePeerMachines: null };
  }
  if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) {
    return { path: settingsPath, remoteControlAtStartup: null, isolatePeerMachines: null };
  }

  const record = parsed as Record<string, unknown>;
  return {
    path: settingsPath,
    remoteControlAtStartup: readSettingsFlag(record[CLAUDE_REMOTE_CONTROL_KEY]),
    isolatePeerMachines: readSettingsFlag(record[CLAUDE_ISOLATE_PEERS_KEY]),
  };
}

/** The two Remote Control keys of an SDK `settings` object, as the launch stated them. */
export function readLaunchedRemoteControlSettings(
  settings: unknown,
): { remoteControlAtStartup?: boolean; isolatePeerMachines?: boolean } | null {
  if (!settings || typeof settings !== 'object') {
    return null;
  }
  const record = settings as Record<string, unknown>;
  const launched: { remoteControlAtStartup?: boolean; isolatePeerMachines?: boolean } = {};
  if (typeof record[CLAUDE_REMOTE_CONTROL_KEY] === 'boolean') {
    launched.remoteControlAtStartup = record[CLAUDE_REMOTE_CONTROL_KEY] as boolean;
  }
  if (typeof record[CLAUDE_ISOLATE_PEERS_KEY] === 'boolean') {
    launched.isolatePeerMachines = record[CLAUDE_ISOLATE_PEERS_KEY] as boolean;
  }
  // A bag that carried NEITHER key recorded nothing about Remote Control, and that is a null
  // reading rather than an empty one. `settings` is present for reasons that have nothing to do
  // with these two flags — the Live Voice `UserPromptSubmit` hook is written into the same object,
  // and `applyClaudeEffort` writes its own marker there — so keying the reading off the bag's
  // *existence* would report `{}` for a launch that stated nothing. `{}` is a shape no consumer
  // asked for and one the false-form arm cannot tell from a real reading; `null` keeps the launch
  // that stated nothing reading as "never read back".
  if (launched.remoteControlAtStartup === undefined && launched.isolatePeerMachines === undefined) {
    return null;
  }
  return launched;
}

/**
 * One live Claude CLI process, as the CLI's own registry describes it.
 *
 * Only the fields this driver has a use for are modelled; the file carries more
 * (`startedAt`, `tmux`, `peerFeatures`, …) and unmodelled keys are ignored
 * rather than rejected.
 */
export type ClaudeCliSessionRegistration = {
  pid: number;
  sessionId: string | null;
  /** The address other sessions reach this process at, or null when it has none. */
  name: string | null;
  /** Who chose that name: `derived` (the CLI itself) or `user` (a person). */
  nameSource: string | null;
  /** The socket the address resolves to; its presence is what makes it reachable. */
  messagingSocketPath: string | null;
};

/**
 * The name a live Claude CLI process registered for itself, from the CLI's own
 * registry.
 *
 * `~/.claude/sessions/<pid>.json` is the record the CLI writes for each process
 * on the host: the `name` other sessions address it by, the `nameSource` that
 * says who chose it (`derived` for the CLI's own per-process name, `user` for a
 * name a person set), the provider `sessionId` and the `messagingSocketPath` the
 * address resolves to. It is the *only* reading of the address that is the CLI's
 * own: this app no longer hands the process a name, so there is nothing on its
 * side to compare a requested name against, and — unlike the old arrangement —
 * nothing the app wrote that could show up in the transcript instead.
 *
 * Keyed by pid, because that is how the CLI keys it and because a fresh process
 * derives a fresh name: the record for *this* process is the one under this
 * process's pid. A file that names a different `sessionId` than the conversation
 * this host is running is treated as absent — pids are recycled on a busy host,
 * and a stale record must not hand this binding an address that answers for
 * somebody else.
 *
 * A missing or unparseable file is `null`, not an error: the process writes it
 * at startup, so a caller polls rather than assuming the first read is final.
 */
export function readCliSessionRegistration(
  configDir: string,
  pid: number,
  providerSessionId?: string | null,
): ClaudeCliSessionRegistration | null {
  let raw: string;
  try {
    raw = readFileSync(join(configDir, 'sessions', `${pid}.json`), 'utf8');
  } catch {
    // No registry entry yet, or a registry this process cannot see.
    return null;
  }
  let row: AnyRecord;
  try {
    row = JSON.parse(raw);
  } catch {
    return null;
  }
  if (typeof row?.pid !== 'number' || row.pid !== pid) {
    return null;
  }
  const sessionId = typeof row.sessionId === 'string' && row.sessionId ? row.sessionId : null;
  if (providerSessionId && sessionId && sessionId !== providerSessionId) {
    return null;
  }
  return {
    pid,
    sessionId,
    name: typeof row.name === 'string' && row.name ? row.name : null,
    nameSource: typeof row.nameSource === 'string' ? row.nameSource : null,
    messagingSocketPath:
      typeof row.messagingSocketPath === 'string' && row.messagingSocketPath ? row.messagingSocketPath : null,
  };
}

// The occupancy registry readers and their refusal now live in `server/shared`,
// because the per-run runtime refuses the same occupied session the resident
// launch does. `findBackgroundSessionOwner` / `ClaudeSessionOccupiedError` are
// imported below for this driver's own launch gate; these two are re-exported
// so the providers barrel (`readClaudeSessionOccupancy`, `ClaudeSessionOccupancy`)
// keeps resolving unchanged.
export { readClaudeSessionOccupancy } from '@/shared/utils.js';
export type { ClaudeSessionOccupancy } from '@/shared/types.js';

/**
 * The SDK option bag one resident launch is built from, extracted from
 * `claude-host-driver.provider.ts`.
 *
 * The shared Claude option mapper is a PARAMETER rather than an import: the
 * mapper lives in `claude-runtime.provider.ts` (the package root), and importing
 * it here would make `lifecycle/ -> claude` an edge and close a directory cycle.
 * The driver names it at the one call site.
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
  ClaudeResidentPermissions,
  RESIDENT_PERMISSION_MODE
} from './resident-process.types.js';
import {
  ClaudeRemoteControlFlags
} from './resident-settings.js';

/**
 * The real SDK, plus the one fact the SDK does not expose: the child pid.
 *
 * The launch options are the runtime's own — `mapCliOptionsToSDK` is the same
 * builder a per-run turn goes through, so a resident process is launched with
 * the same env overlay, executable resolution, effort and permission mapping the
 * per-run path produces. What is added is a spawn hook that wraps whatever hook
 * the builder installed (the memory-capped systemd scope, when this host has
 * one) and keeps the child it returns.
 */
/**
 * The SDK options one resident launch is built from, decided in one place.
 *
 * Split out of {@link createSdkResidentProcess} so the *decisions* about a
 * resident launch can be read without a CLI: the factory's remaining body is the
 * spawn hook, the pid capture and the raw-stdin writer, none of which a reading
 * needs, while the mode and the three entries are exactly what a criterion has to
 * hold the driver to. A factory that substitutes a scripted stream calls this and
 * reads them back; so does the real one, which is what keeps the two from being
 * two different option bags.
 */
export type ClaudeResidentOptionMapper = (options: AnyRecord) => AnyRecord;

export function buildResidentSdkOptions(
  input: {
    options: AnyRecord;
    permissions?: ClaudeResidentPermissions;
    remoteControlFlags?: ClaudeRemoteControlFlags;
  },
  mapOptions: ClaudeResidentOptionMapper,
): AnyRecord {
  const sdkOptions = mapOptions(input.options) as unknown as AnyRecord;

  // The Remote Control flags, merged into whatever `settings` the shared builder
  // already produced rather than assigned over it: `applyClaudeEffort` writes an
  // `ultracode` marker into the same object, and a launch that lost it would be
  // trading one launch option for another. The resident bag is the only one that
  // states these — a per-run turn has no resident process to isolate — so they
  // arrive on the input rather than being read out of the option bag.
  if (input.remoteControlFlags) {
    sdkOptions.settings = {
      ...((sdkOptions.settings as AnyRecord | undefined) ?? {}),
      ...input.remoteControlFlags,
    };
  }

  // The launch mode is stated *after* the shared builder, not asked of it: the
  // builder maps a caller's `permissionMode` for the per-run path, where a turn
  // ends and a person can be asked; a resident process is launched under the
  // mode this file owns (see `RESIDENT_PERMISSION_MODE`) and moves it live if it
  // ever should. Both options are written together because the SDK requires
  // `allowDangerouslySkipPermissions` alongside `bypassPermissions`.
  sdkOptions.permissionMode = RESIDENT_PERMISSION_MODE;
  sdkOptions.allowDangerouslySkipPermissions = true;

  // The three human-facing entries, installed verbatim. The host builds them
  // (`createPermissionEntries`) and this factory only hands them to the SDK —
  // which is the whole reason they travel on the factory input rather than being
  // built here: the policy is the driver's, the installation is the launch's.
  if (input.permissions) {
    sdkOptions.canUseTool = input.permissions.canUseTool;
    sdkOptions.onElicitation = input.permissions.onElicitation;
    sdkOptions.onUserDialog = input.permissions.onUserDialog;
  }

  return sdkOptions;
}

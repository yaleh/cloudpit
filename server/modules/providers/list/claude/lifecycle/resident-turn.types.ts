/**
 * The turn/lifecycle readings and the unattended-turn record — extracted from
 * `claude-host-driver.provider.ts`.
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
  readCliSessionRegistration
} from './resident-settings.js';

/**
 * The unattended-turn entry, named where the run it opens would have to live.
 *
 * `openUnattendedRun` is on the manager's surface rather than in this file for
 * the same reason the rest of the port is: what opens a *run* is the websocket
 * module's registry, and the providers module already imports the websocket
 * module — so an edge back from here would close a cycle. The manager carries
 * the seam (`setUnattendedRunOpener`) and the composition root fills it; the
 * driver only calls it. What it answers with is the writer the turn's frames
 * belong to, or null when no run could be opened (no seam installed, or one
 * already in flight for the session).
 */
export type ClaudeResidentUnattendedRun = {
  /** The open run's writer; frames the host routes to it are client-facing frames. */
  writer: ProviderRuntimeWriter;
};

/**
 * The notification an unattended turn's end makes.
 *
 * The per-run background-work report's own shape, plus the one fact only the
 * host can reconcile: what the reporting turn was *for*. A resident process that
 * opens a turn of its own sends no request, so nothing in the turn says why it
 * happened; the trigger is derived from the `Stop` hook's task list as it read
 * when the turn opened (see {@link deriveBackgroundWorkTrigger}) and carried
 * here, rather than guessed from the turn's contents.
 *
 * Declared structurally rather than as `Omit<ClaudeBackgroundWorkEvent, 'userId'>`
 * because that source type lives in the per-run driver, which is outside the
 * `lifecycle/` sink; the shape is byte-identical.
 */
export type ClaudeUnattendedWorkEvent = {
  appSessionId: string;
  provider: LLMProvider;
  userId: string | number | null;
  sessionId: string | null;
  sessionName: string | null;
  trigger: BackgroundWorkTrigger;
};

/**
 * The identification of an unattended turn, read off a live resident host.
 *
 * The whole record exists because the two halves of "a turn nobody pushed" live
 * on opposite sides of the process boundary: the uuids this host stamped are
 * only known here (the stream never echoes one), while the uuid the CLI minted
 * for the turn's opener is only known to the CLI. Neither is a readable fact
 * from a transcript or a frame, so a reader that has to prove a turn was
 * unattended reads them together, from the host that holds both.
 *
 * Read-only by construction: it is a copy, taken on demand, and the caller is a
 * test that reports what it saw rather than one that can change it. The
 * `server/modules/providers/tests/claude-resident-unattended-turn.test.ts`
 * criterion is its consumer — the identification and the tool-table readings the
 * criterion prints come from here.
 */
export type ClaudeUnattendedReading = {
  /** Every uuid this host stamped on a user frame it pushed, in push order. */
  pushedUuids: string[];
  /** The last of them, or `null` when nothing was ever pushed. */
  lastPushedUuid: string | null;
  /** The opener uuid of the last unattended turn this host opened, if any. */
  unattendedCommandUuid: string | null;
  /** The tool names the process reported at `system/init`. */
  initTools: string[];
  /** The `system/task_started` task type, if the process started one. */
  backgroundTaskType: string | null;
};

/** The `cron` member of the lease union, named once so the held list can be typed. */
export type CronLease = Extract<HostLease, { kind: 'cron' }>;
/** The two background-work members of the lease union, named for the same reason. */
export type BackgroundTaskLease = Extract<HostLease, { kind: 'background-task' | 'monitor' }>;

/**
 * What a live resident host holds, and what it had to guess.
 *
 * The manager's own snapshot reports the union of a binding's leases, which is
 * the surface every reader of "why is this process still here" should prefer.
 * This reading exists for the one thing the snapshot cannot carry: the driver's
 * *own* account of how it arrived at that union — which list was the authority,
 * which reason was inferred from a tool call instead, and which `system`
 * subtypes it passed through without acting on. A criterion that has to tell
 * "the CLI named this job" from "this build guessed at it" reads it here; in
 * production nothing consumes it.
 *
 * A copy, and `null` for a session this driver is not hosting — the same two
 * properties {@link ClaudeUnattendedReading} has, for the same reason.
 */
export type ClaudeResidentLifecycleReading = {
  /** The live host this reading is about. */
  hostId: string;
  /** The `cron` reasons this driver currently reports, in report order. */
  crons: CronLease[];
  /** The background-work reasons it currently reports, in report order. */
  backgroundTasks: BackgroundTaskLease[];
  /**
   * `system` subtypes the read loop saw and did not act on, in arrival order.
   *
   * A frame named here was forwarded to the client untouched and changed nothing
   * about the process's lifetime; the loop's survival across one is the point
   * (see {@link HELD_WORK_SYSTEM_SUBTYPES}).
   */
  unhandledSystemSubtypes: string[];
  /** True once a `Stop` firing had named the cron list (`session_crons`). */
  cronsAuthoritative: boolean;
  /** True once a `Stop` firing had named the background-task list. */
  tasksAuthoritative: boolean;
};

/**
 * What made a turn nobody pushed, from the CLI's own account of what it holds.
 *
 * Only two things can make this CLI open a turn by itself: a background task
 * finishing, or a session cron firing. Both are reported by the `Stop` hook, so
 * both are readable — and everything else is `non-user`, which is the reading
 * for a turn with no list to explain it rather than a claim about who asked.
 *
 * `non-user` is the whole of the fallback on purpose: an unreadable hook, a
 * missing field and an empty list are the same fact from this side (nothing the
 * CLI holds explains the turn), and three names for it would be three ways for a
 * reader to disagree about which one they got.
 */
export function deriveBackgroundWorkTrigger(
  readings: { backgroundTasks?: unknown; sessionCrons?: unknown } | null,
): BackgroundWorkTrigger {
  const tasks = Array.isArray(readings?.backgroundTasks) ? readings.backgroundTasks : [];
  if (tasks.length > 0) {
    return 'background-task';
  }
  const crons = Array.isArray(readings?.sessionCrons) ? readings.sessionCrons : [];
  if (crons.length > 0) {
    return 'session-cron';
  }
  return 'non-user';
}

// The address a resident process answers to used to be *computed* here and
// handed to the CLI as `--name`. That is gone: in the CLI's ladder a launch name
// is both the session's `agent-name` and its `custom-title`, so writing one
// pinned the session's name at launch, let a Cloudpit-invented address outrank
// an `ai-title` the session had earned, and grew another `-<id6>` on every
// restart. The app no longer names anything; it reads the name the CLI derived
// for the process, in `readCliSessionRegistration` below.

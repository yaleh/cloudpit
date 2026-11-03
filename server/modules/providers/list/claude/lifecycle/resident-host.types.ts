/**
 * One resident host's live state, and the records it is built from. Extracted
 * from `claude-host-driver.provider.ts`; the reading handlers beside the driver
 * import `ResidentHostState` from here.
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
  ClaudeBusyInputReading,
  ClaudePermissionScope,
  ClaudeQueuedInput,
  ClaudeResidentProcess,
  ClaudeResidentQuery
} from './resident-process.types.js';
import {
  BackgroundTaskLease,
  ClaudeResidentLifecycleReading,
  CronLease
} from './resident-turn.types.js';
import {
  BackgroundWorkLedger,
  ClaudeResidentReconcileBeat,
  ResidentDeliveryRuntime,
  ResidentInputQueue,
  ResidentRound
} from './resident-ledger-runtime.js';
import {
  ClaudeResidentOutcomeContext
} from './claude-resident-outcome-registry.js';

/**
 * One resident host: the process, the queue it reads, and the turns waiting on it.
 *
 * Per host rather than per driver because all four are per-process facts. The
 * manager's host record stays the manager's; this is what the driver needs to
 * deliver a turn and to answer for the process's lifetime.
 *
 * Exported for the reading handlers beside this file
 * (`claude-resident-outcome-handlers.ts`), which read host state through
 * `ClaudeResidentOutcomeContext.hosts`. It is a type-only export: nothing outside
 * this file can construct or mutate one, and the driver remains its one owner.
 */
export type ResidentHostState = {
  hostId: string;
  appSessionId: string;
  sink: IProviderHostDriverSink;
  queue: ResidentInputQueue;
  process: ClaudeResidentProcess;
  /**
   * The delivery/turn ledger: the host's own account of every send it made and
   * every turn the CLI ran for it. It is the authority the rest of this state is
   * derived from.
   *
   * READ-ONLY here, and that is the type rather than a manner (AC-395 (c)): the
   * transitions live in `modules/resident-ledger` and this driver hands the
   * whole ledger to them as an argument. There is no field of it this file
   * touches — the compiler refuses, and the criterion counts the AST to prove
   * nobody went around the compiler.
   */
  turnLedger: ResidentLedger;
  /**
   * The driver's own half of every delivery, indexed by `commandUuid`.
   *
   * The dispatcher's round, the manager lease and the run writer — the facts the
   * ledger deliberately does not carry (AC-395 (d)). Entries are opened with the
   * delivery and never removed: a terminal delivery's round is what a late
   * by-id read resolves, exactly as the ledger keeps its terminal rows.
   */
  runtimes: Map<string, ResidentDeliveryRuntime>;
  /**
   * The runs still awaiting their turn to end, in the order they were armed.
   *
   * A **projection of the ledger** (`ledger.deliveries` with `runOpen`), kept as
   * its own list because it is the shape every reader of this state already
   * asks for: the front entry is the turn in flight, so `rounds[0].writer` is
   * the writer the current turn's frames belong to and `rounds.length > 0` is
   * "this process is busy". Nothing is added to or removed from it by position
   * logic any more — `openRun`/`closeRun` keep it in step with the ledger.
   */
  rounds: ResidentRound[];
  /** The last runtime context seen, so frames arriving outside a round still normalize. */
  context: ProviderRuntimeContext | null;
  /** The last writer seen, for frames no round owns. */
  writer: ProviderRuntimeWriter | null;
  /**
   * Every uuid this host has stamped on a user frame it pushed.
   *
   * The host's own mark on the turns it sent. It is not the CLI's id for a turn
   * — the stream never echoes a pushed uuid (measured: a pushed uuid appears in
   * no message the SDK emits) — so the set can only ever be read from this side,
   * and that is the reading it is for: a turn whose opener carries a uuid that
   * is not in this set was not pushed by anyone here.
   */
  pushedUuids: Set<string>;
  /** The `Stop` hook's own account of what this process is holding. */
  ledger: BackgroundWorkLedger;
  /**
   * The held-work reasons this driver has reported, so convergence is a diff.
   *
   * Kept here rather than read back off the manager because the manager reports
   * leases *by kind* — "the cron reason" — while this driver reconciles them by
   * id, and a rule that has to decide whether a `Stop` firing changed anything
   * needs the list it last reported, not the union the manager derived from it.
   */
  heldCrons: CronLease[];
  heldBackgroundTasks: BackgroundTaskLease[];
  /**
   * Whether the CLI's own list has ever named each kind of held work.
   *
   * The two flags are the whole of "is this build guessing?". Until a `Stop`
   * firing has carried `session_crons`, the only account of the crons available
   * is what the stream's tool calls imply, and anything read that way is marked
   * `inferred`; the same for `background_tasks`. Observed independently because
   * the lists are observed independently — E9's hook always carried both, but a
   * firing that carried one says nothing about the other.
   */
  cronsAuthoritative: boolean;
  tasksAuthoritative: boolean;
  /** See {@link ClaudeResidentLifecycleReading.unhandledSystemSubtypes}. */
  unhandledSystemSubtypes: string[];
  /** The user and session name of the last armed round, for a report no round owns. */
  lastUserId: string | number | null;
  lastSessionName: string | null;
  /**
   * The three human-facing entries this process answers for, and their log.
   *
   * Carried on the host state rather than rebuilt per request because it is one
   * value with one owner: the entries close over it, `startHost` points it at
   * this state, and the reading reads its decisions. See
   * {@link ClaudePermissionScope}.
   */
  permissions: ClaudePermissionScope;
  /** The turn this process opened by itself, while it is open. */
  unattended: {
    /** The CLI-minted uuid of the turn's opener: the value no push accounts for. */
    commandUuid: string;
    /** What the `Stop` hook said the process held when the turn opened. */
    trigger: BackgroundWorkTrigger;
    /** The run's writer. */
    writer: ProviderRuntimeWriter;
  } | null;
  /**
   * The opener uuid of the last unattended turn, kept after that turn ends.
   *
   * The live `unattended` record is cleared when its turn finishes, but the
   * identification it carries outlives it: a reader asking "did this process
   * open a turn nobody pushed?" is asking after the fact, once the turn's text
   * has landed. Held separately so the answer does not depend on the timing.
   */
  lastUnattendedCommandUuid: string | null;
  /**
   * The run of the DELIVERED turn that is open, and its writer — run=turn only.
   *
   * Set when the CLI announces a turn this host pushed (`system/init`, through
   * the host layer's `openTurn`) and refreshed when a later command folds into an
   * already-open turn; CLEARED when that turn closes (`closeTurn`), so the frames
   * arriving between one turn's `RESULT` and the next turn's `init` — the
   * `command_lifecycle started` of a command the CLI drained at the boundary —
   * follow whatever `observe` falls back to rather than a run that has ended. An
   * unattended turn never sets it: that path's writer lives on `state.unattended`.
   *
   * Null on the flag-off path, where frames are routed by position
   * (`state.rounds[0].writer`) exactly as they were before S2.
   */
  turnRun: { runId: string; writer: ProviderRuntimeWriter; startedAt: number } | null;
  /**
   * The key of the unattended turn's own lease while it is reported, else `null`
   * (SPEC §5.4).
   *
   * The one lease with no delivery behind it: an unattended turn holds the `turn`
   * kind open by itself, so the "already reported" test cannot be read off the
   * deliveries' flags the way the per-run leases are.
   */
  unattendedLeaseId: string | null;
  /**
   * The tool names the process reported at `system/init`.
   *
   * Recorded because the tool table is a launch decision, not a stream fact —
   * it is what says whether a trigger could have been a tool call at all, and
   * it is otherwise unreadable from outside the process.
   */
  initTools: string[];
  /** The `system/task_started` task type, when the process started one. */
  backgroundTaskType: string | null;
  /**
   * Every frame this host pushed while the process was already busy.
   *
   * Busy means a round or an unattended turn was in flight at the push: that is
   * the only state in which a frame is *not* the thing the process is about to
   * work on, and so the only state in which what it was written under (a tier,
   * a queue position) is a fact worth keeping. A cold start's frames are the
   * process's first work and are not recorded here.
   */
  queuedInputs: ClaudeQueuedInput[];
  /** Every `command_lifecycle` event read off the stream, in arrival order. */
  lifecycle: CommandLifecycleEvent[];
  /** Every control frame written to the process's stdin, in write order. */
  controlFrames: Array<{ at: number; requestId: string; frame: AnyRecord }>;
  /** Every `control_response` the CLI sent back, in arrival order. */
  controlResponses: Array<{ at: number; requestId: string | null }>;
  /** When each turn's `result` was read; see {@link ClaudeBusyInputReading.resultTimes}. */
  resultTimes: number[];
  /** How many `session_state_changed` messages the stream carried. */
  sessionStateChanged: number;
  /** Provider-native session id, captured once from the stream. */
  providerSessionId: string | null;
  /**
   * The pid of the process this host holds, when the spawn hook reported one.
   *
   * It is the key to the CLI's own registry (`~/.claude/sessions/<pid>.json`),
   * which is where the process's address is read from: this app no longer hands
   * the CLI a name, so the pid is the only handle it has on the name the CLI
   * derived for itself. Null when the driver could not observe a pid, in which
   * case no address can be read and the binding reports none.
   */
  pid: number | null;
  /**
   * Where this process's CLI keeps its state, as the process itself was told.
   *
   * Read from the environment the child really receives — the launch builder
   * builds `sdkOptions.env` from the host's own environment and ignores any
   * `env` a caller puts in the option bag, so reading the bag here would be
   * reading something that never reached the process.
   */
  configDir: string;
  /**
   * The working directory this process was launched in, or null when the turn
   * stated none.
   *
   * Kept for the same reason `configDir` is: it is the other half of the path to
   * this process's transcript (see `claudeProjectTranscriptPath`), and the title
   * mirror reads that transcript directly rather than through a session row.
   */
  projectPath: string | null;
  /** See {@link ResidentTitleMirror}. */
  titleMirror: ResidentTitleMirror;
  /** True once the identity read-back has been started, so it starts only once. */
  identityReadbackStarted: boolean;
  /**
   * The last address this host published through `sink.identity`, or null for none.
   *
   * The address is read back more than once over a host's life — once at startup,
   * and again after the title mirror moves the process's registered name — so the
   * last value is kept to publish only a *change*. Writing the same value twice
   * would tell the manager the address moved when it did not, and a re-read that
   * finds nothing (the rename frame never landed, or landed late) must leave the
   * address where the last successful read put it rather than blank it.
   */
  reportedIdentity: string | null;
  /**
   * The session's own title this process was launched with, or null for none.
   *
   * See {@link PendingHost.launchedTitle}: it is what tells the read-back that a
   * `derived` reading is a process mid-rewrite rather than a settled answer.
   */
  launchedTitle: string | null;
  /** True when this process was launched resuming an existing conversation. */
  resumed: boolean;
  sessionCreatedSent: boolean;
  assistantBudgetSent: boolean;
  modelContextWindow: string | undefined;
  /**
   * The pending `T_int` watchdog: armed by an interrupt request, cleared by the
   * `RESULT` that answers it.
   *
   * The one thing about an interrupt that is a *wait* rather than a state. The
   * ledger is left exactly as the CLI's own frames leave it (§6.3) — nothing is
   * synthesized and no lease is taken away — so what keeps an unanswered
   * interrupt from reading as work still in progress is this deadline turning
   * the silence into a named anomaly. `turnId` is the turn the request was
   * placed on, kept for the anomaly's detail rather than re-read at fire time.
   */
  interruptWatchdog: { timer: ReturnType<typeof setTimeout>; turnId: string | null } | null;
  /**
   * When this host's ledger last moved, as the injected clock read it (§10.1).
   *
   * `T_q` is measured against this rather than against "when did the last frame
   * arrive", because the reconcile check has to be able to see the one state it
   * is for: a ledger that has STOPPED moving while the registry still says a run
   * is going. Written wherever a transition reports `changed`.
   */
  ledgerChangedAt: number;
  /**
   * The last delivery state each `[ledger]` line stated, keyed by `commandUuid`.
   *
   * The line is emitted on a CHANGE, so the emission needs the value it last
   * stated — a projection is re-read on every frame, and a line per read rather
   * than per transition would be noise about nothing having happened.
   */
  loggedDeliveryStates: Map<string, string>;
  /** The turn whose `[turn]` open line was written, so the close names the same one. */
  loggedOpenTurnId: string | null;
  /**
   * The phantom runs this host has already reported, by run id.
   *
   * The check runs repeatedly over the same standing divergence (every beat
   * while the registry still reports the run), and §10.2's reading is one line
   * per anomaly rather than one per check: without this, `mode=log` — which
   * changes nothing, so the divergence stands — would restate the same fact on
   * every beat.
   */
  reportedPhantomRuns: Set<string>;
  /**
   * The host's own reconcile beat, armed at `startHost` and stopped at close.
   *
   * Per host because that is the lifetime the ledger and the run registry have:
   * the beat asks "does this host's ledger still agree with the registry", so it
   * must start when the host does and stop when the host goes. `null` means no
   * beat is armed (a non-positive `reconcileBeatMs`, or a host already closed).
   */
  reconcileBeat: ClaudeResidentReconcileBeat | null;
  /** Set once the manager closed this host or the stream ended under it. */
  closed: boolean;
  /** The failure the stream ended with, when it ended on its own. */
  loopError: Error | null;
};

/** The next resident process's state, handed to `startHost` through `openHost`. */
export type PendingHost = {
  queue: ResidentInputQueue;
  process: ClaudeResidentProcess;
  modelContextWindow: string | undefined;
  /** The hook ledger built for this process, carried over with the queue. */
  ledger: BackgroundWorkLedger;
  /**
   * The process's pid, and the directory its CLI keeps state in — both read
   * facts for the address read-back, both settled before `openHost` adopts the
   * host. Carried here rather than recomputed at adoption because the config dir
   * is derived from the environment the child was actually launched under, which
   * `startHost` never sees.
   */
  pid: number | null;
  configDir: string;
  /** The working directory this process was launched in, or null when none was stated. */
  projectPath: string | null;
  /** The one slot this process's `Stop` hook can reach before its host exists. */
  stopHook: StopHookSink;
  /**
   * The permission scope built for this process, adopted with it.
   *
   * Travels beside the ledger and the `Stop` sink for the same reason: all three
   * are created before the spawn — they have to be, or the first turn's own
   * request would be answered into nothing — while the host state they belong to
   * is built one `openHost` later.
   */
  permissions: ClaudePermissionScope;
  /**
   * What this launch asked and read about Remote Control, adopted with the host.
   *
   * Built before `openHost` — the reading is taken before the spawn, because the
   * whole point of the gate is that a refused launch never reaches it — and
   * written onto the live host record by `startHost`, which is the only moment
   * the driver holds that record (see {@link ProcessHost.remoteControl}).
   */
  remoteControl: RemoteControlIsolation;
  /**
   * The session's own title this launch handed the CLI, or null for none.
   *
   * Carried to the host record because it is the one thing the address read-back
   * cannot learn from the registry alone: a process launched *with* a title
   * writes its entry twice — once under the derived name as it starts, once
   * under the adopted title a moment later — so a `derived` reading on such a
   * process is a state it is on its way out of, not its address.
   */
  launchedTitle: string | null;
};

/**
 * Where a process's `Stop` hook writes until its host state exists.
 *
 * The hook is installed before the spawn — it has to be, or the first turn's
 * firing would be lost — while the host state it reconciles into is built by
 * `startHost`, one `openHost` later. The two orderings cannot be made the same,
 * so a firing that lands in the gap is buffered here and replayed on adoption
 * instead of being dropped or, worse, reconciled against nothing.
 */
export type StopHookSink = {
  /** The adopted state, or null while the host is still being opened. */
  state: ResidentHostState | null;
  /** Firings that arrived before it was adopted, replayed in arrival order. */
  buffered: AnyRecord[];
};

/**
 * The SDK's `transformMessage`, inlined.
 *
 * The runtime's own transformer is module-private and its whole body is this one
 * copy: subagent traffic carries `parent_tool_use_id` and every frame the
 * normalizer makes of such a message needs it as `parentToolUseId` to stay
 * grouped under the tool card that spawned it. Copying it here rather than
 * exporting it keeps a `.js` file outside this task's touched set untouched.
 */
export function transformResidentMessage(message: AnyRecord): AnyRecord {
  if (message?.parent_tool_use_id) {
    return { ...message, parentToolUseId: message.parent_tool_use_id };
  }
  return message;
}

/** Interrupts a query, treating a refused interrupt as the turn having moved on. */
export async function stopResidentTurn(queryStream: ClaudeResidentQuery): Promise<void> {
  try {
    await queryStream.interrupt();
  } catch {
    // The turn is going away either way; a refused interrupt is not a failure to
    // stop, so there is nothing left for the caller to branch on.
  }
}

// ------------------------- The live peer-name mirror -------------------------

/**
 * How often a resident host re-reads its transcript for a settled title, and how
 * long the settle window after one turn lasts.
 *
 * The window is bounded rather than open-ended: a process whose session never
 * earns an `ai-title` must not cost a transcript read every few hundred
 * milliseconds for the whole life of the host, so a turn that produces no title
 * spends its window and stops, and the next turn opens a fresh one.
 */
export const CLAUDE_RESIDENT_TITLE_MIRROR_POLL_MS = 300;
export const CLAUDE_RESIDENT_TITLE_MIRROR_WINDOW_MS = 20_000;

/**
 * What one host has read of its session's generated title, and what it did with
 * it.
 *
 * `lastSeen` is the previous observation's value, which is what turns "read the
 * title" into "read the *settled* title": the frame goes out only when a value
 * repeats, so a title still being written, or a first draft the CLI later
 * replaces, is not mistaken for the finished one. `mirrored` is the value
 * already written into the registry, and its presence is what makes the frame a
 * one-time act — a host that has mirrored never mirrors again, however many
 * times the CLI appends the same title afterwards.
 */
export type ResidentTitleMirror = {
  /** The `ai-title` read at the previous observation, or null. */
  lastSeen: string | null;
  /** The title already written into the registry, or null while none has. */
  mirrored: string | null;
  /** The pending settle-window timer, or null when none is armed. */
  timer: ReturnType<typeof setTimeout> | null;
  /**
   * True while a window is armed or one of its reads is in flight.
   *
   * The window is opened from every stream message, so without this a busy turn
   * would start a read per message: the flag makes the message a *prompt* to open
   * a window rather than a new window, and keeps the read cost at one poll per
   * interval for the window's whole life.
   */
  open: boolean;
  /**
   * True once a window has been opened for the turn in flight.
   *
   * The trigger moved off the `result` and onto the stream, where messages are
   * frequent; this is what holds the cost to *one* window per turn. It is cleared
   * at each `result`, so the next turn opens its own window at its own first
   * message — the old per-turn cadence, opened early enough to catch a title that
   * lands while the turn is still running.
   */
  openedForTurn: boolean;
};

/**
 * Owns the process lifetime of Claude's `resident` hosts.
 *
 * Constructed per provider (one instance serves every session, because a driver
 * holds no per-process state outside its maps). See the file header for what it
 * reports, what it never decides, and what it deliberately does not own.
 */
/**
 * The ledger's `processing` predicate for one session, as its other readers read
 * it (SPEC §4.3, I6).
 *
 * THE SINGLE WRITER. `processing` is not a reading any consumer computes for
 * itself any more: it is this projection of the ledger, and the run registry —
 * and through it the running-sessions API, the heartbeat, the MCP overview and
 * the scheduled-message dispatcher — reads *this* rather than each deciding from
 * a run's `status`. Two facts make it the ledger's to answer: the window between
 * a send being accepted and the CLI's `system/init` (a `pushed` or `queued`
 * delivery is work owed to somebody, whether or not a run has been minted yet),
 * and the window between a turn's `RESULT` and the next turn's `init` (commands
 * the CLI drained out of the queue are still owed, while the run they were
 * dispatched behind has already ended — the "差一格" shape, read positively).
 *
 * `startedAt` is §4.3's own rule: the turn's start, or the acceptance time of the
 * earliest delivery that has not reached a terminal.
 */
export type ClaudeResidentProcessingReading = {
  processing: boolean;
  provider: LLMProvider;
  startedAt: number;
  /** The deliveries still owed a terminal, in the order the sends were accepted. */
  deliveryIds: string[];
};

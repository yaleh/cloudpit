/**
 * The resident host's process/queue/permission vocabulary — extracted from
 * `claude-host-driver.provider.ts` into the `lifecycle/` subpackage.
 *
 * Everything here is a type, a constant, or a pure helper the host driver and
 * its lifecycle collaborators share. Nothing in this file imports back into
 * `modules/providers/list/claude`, which is what keeps `lifecycle/` a sink of
 * the package rather than a second cycle member (AC-394).
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
  ClaudeRemoteControlFlags
} from './resident-settings.js';
import {
  ClaudeUnattendedReading
} from './resident-turn.types.js';
import {
  ResidentHostState
} from './resident-host.types.js';
import {
  buildResidentSdkOptions
} from './resident-launch.js';

/**
 * The notification record builder, viewed with the argument shape it really takes.
 *
 * `createNotificationEvent` lives in a `.js` module and `checkJs` is off, so
 * TypeScript infers its destructured parameters from their defaults alone: it
 * presents `sessionId` and `dedupeKey` as `null | undefined` even though its own
 * body stores whatever it is handed. The assertion is that true contract, made
 * once here rather than cast at the call site, and it is only a widening — a
 * record built through it is the same record, with the refusal's own words in
 * `meta` reaching the user unchanged.
 */
export const buildNotificationEvent = createNotificationEvent as (event: {
  provider: LLMProvider;
  sessionId?: string | null;
  kind?: string;
  code?: string;
  meta?: AnyRecord;
  severity?: string;
  dedupeKey?: string | null;
  requiresUserAction?: boolean;
}) => AnyRecord;

/**
 * How long a resident process is given to leave on its own before the SDK query
 * is closed under it.
 *
 * Deliberately far longer than a graceful exit: a Claude CLI told EOF stops in
 * well under a second, so an exit observed inside any ordinary assertion window
 * is the EOF's doing. A shorter backstop would let a kill masquerade as the
 * graceful path this driver exists to provide.
 */
export const CLAUDE_RESIDENT_EXIT_GRACE_MS = 15_000;

/**
 * How long a withdrawal waits for the queue to say a message was cancelled.
 *
 * A budget, not a timeout with a meaning: the queue answers in the same read
 * loop this driver is already consuming, so the wait is over either as soon as
 * the event arrives or when the budget runs out — and running out is not
 * evidence of anything except that no `cancelled` was seen. The verdict is
 * computed from the reading after the wait, never from the wait's expiry.
 */
export const CLAUDE_CANCEL_VERDICT_WAIT_MS = 5_000;

/** How often the withdrawal re-reads the queue while waiting. */
export const CLAUDE_CANCEL_VERDICT_POLL_MS = 25;

/**
 * How long an interrupt request waits for the CLI's own `RESULT` before the host
 * records `interrupt-no-result`.
 *
 * An interrupt is a request and nothing else (§6.3): the CLI's `RESULT` is what
 * ends the turn, and the measured gap is about 10 ms. This is the bound on
 * waiting for it — long enough that no working CLI reaches it, and short enough
 * that a turn whose `RESULT` is never coming reads as the anomaly `§10` names
 * rather than as work still in progress.
 */
export const CLAUDE_RESIDENT_INTERRUPT_RESULT_TIMEOUT_MS = 5_000;

/**
 * The arm a host runs when its caller states none: it only says so.
 *
 * `enforce` — closing a phantom run as `aborted` with `reason: reconciled` — is
 * the switch a plant turns on once it has watched the log for a while (§10.1),
 * so the shipped default is `log`: every `[reconcile]` line reports `mode=log`
 * and changes no state. A criterion that drives the `enforce` arm states it on
 * the driver it builds ({@link ClaudeResidentHostDriverOptions.reconcileMode}).
 */
export const CLAUDE_RESIDENT_RECONCILE_MODE: ClaudeResidentReconcileMode = 'log';

/**
 * The permission mode a resident process is launched under.
 *
 * Always `bypassPermissions`, and that is a statement about the mode rather than
 * a default a caller may override: a resident process is one nobody is
 * guaranteed to be watching — it runs cron and background turns of its own — so
 * a launch that stopped at the CLI's own permission step would park such a turn
 * on a person who is not there. The three callbacks below are where a
 * human-facing request is answered instead; they are what makes "nobody is
 * there" a policy this host applies rather than a hang it causes. A session that
 * wants another mode moves it on the *running* process (`reconfigure` →
 * `setPermissionMode`), which is the one place the mode may change, because a
 * switch keeps the process and a relaunch would not.
 *
 * The SDK requires the second option alongside the first — a `bypassPermissions`
 * launch must also set `allowDangerouslySkipPermissions` (`sdk.d.ts:1664`) — so
 * the two are stated together here and read back together by the criterion.
 */
export const RESIDENT_PERMISSION_MODE = 'bypassPermissions';

/**
 * The words every unattended refusal carries.
 *
 * A constant rather than a literal at each of the three entries because the
 * three refusals are one statement — this host has nobody to ask — and a
 * criterion has to be able to hold them to the same words. It is also the
 * notification's own reason text, so what the user is told and what the CLI was
 * told cannot drift.
 */
export const UNATTENDED_REFUSAL = '当前无人值守';

/**
 * The refusal one entry is answered with when nobody is there to ask.
 *
 * Names what was refused as well as why, and always contains
 * {@link UNATTENDED_REFUSAL} verbatim: the message is what reaches the CLI (and
 * through it the transcript), so it is the only place a reader of a refused turn
 * can learn that the refusal was about attendance rather than about the request.
 */
export function unattendedRefusalMessage(entry: ClaudePermissionEntry, toolName: string | null): string {
  const subject =
    entry === 'canUseTool'
      ? `工具 ${toolName ?? 'unknown'}`
      : entry === 'onElicitation'
        ? 'MCP elicitation 请求'
        : 'request_user_dialog 对话框';
  return `${UNATTENDED_REFUSAL}：已自动拒绝 ${subject}。`;
}

/**
 * How long a session cron is taken to live, from when the CLI created it.
 *
 * The CLI's own receipt for `CronCreate` states it verbatim — "Session-only (not
 * written to disk, dies when Claude exits). Auto-expires after 7 days. Use
 * CronDelete to cancel sooner." (E9, `claude-resident-sessions-experiments.md`
 * §9.4) — and neither the stream nor the hook names an instant, so the seven
 * days are counted here from the moment the job is first read. A job the CLI
 * keeps naming keeps the expiry it was first given rather than restarting the
 * week (see `cronsFromStopList`), and the manager reads that instant as the
 * point the `cron` lease stops deferring the idle close.
 *
 * Exported so a criterion places the deadline from the same value the driver
 * uses instead of restating the number, the way `RESIDENT_IDLE_TIMEOUT` is.
 */
export const CRON_MAX_AGE_MS = 7 * 24 * 60 * 60 * 1000;

/**
 * The slice of the SDK's `Query` a resident process uses.
 *
 * Wider than the per-run driver's stream, because a resident process is
 * reconfigured rather than replaced: the live verbs are optional so a criterion
 * can hand in a scripted stream, and absent means `reconfigure` answers
 * `next-turn` for what it would have applied.
 */
export type ClaudeResidentQuery = AsyncIterable<AnyRecord> & {
  /** Stops the turn in flight; the process itself stays up. */
  interrupt(): Promise<void>;
  /** Backstop teardown, used only after {@link CLAUDE_RESIDENT_EXIT_GRACE_MS}. */
  close?(): void;
  /** Live model switch, SDK permitting. */
  setModel?(model?: string): Promise<void>;
  /** Live permission-mode switch, SDK permitting. */
  setPermissionMode?(mode: string): Promise<void>;
  /**
   * Stops one named background task, leaving the turn in flight and the process
   * up (the SDK's own `Query.stopTask`).
   *
   * Optional like the other live verbs so a criterion can hand in a scripted
   * stream: a stream that exposes no verb makes the driver's `stopTask` answer
   * "not placed" rather than throwing.
   */
  stopTask?(taskId: string): Promise<void>;
  /**
   * Promotes the named *foreground* tool to a background task, leaving the turn
   * in flight and the process up (the SDK's own `Query.backgroundTasks`).
   *
   * Deliberately takes the `toolUseId` as a required string: the SDK method's
   * parameter is optional (its no-arg form backgrounds *every* foreground tool),
   * and AC-197 exposes only the single-task form — calling it with no id would
   * background tools the caller never named. The SDK's boolean is returned as-is;
   * `false` means the process held no matching foreground tool.
   *
   * Optional like the other live verbs so a criterion can hand in a scripted
   * stream: a stream that exposes no verb makes the driver's `background` answer
   * "not placed" rather than throwing.
   */
  backgroundTasks?(toolUseId: string): Promise<boolean>;
};

/**
 * One resident process: the SDK query, plus the pid the manager's record needs.
 *
 * `pid` is a getter rather than a value so a caller can read it after the
 * spawn hook has run, however many ticks later that is.
 */
export type ClaudeResidentProcess = {
  query: ClaudeResidentQuery;
  readonly pid: number | null;
  /**
   * Writes one raw frame to the process's stdin, when this process has a stdin
   * this driver can reach.
   *
   * The SDK's `Query` interface exposes no verb for most of
   * `SDKControlRequestInner` — `cancel_async_message` among them (measured: the
   * `Query` methods are interrupt / setPermissionMode / setModel /
   * setMaxThinkingTokens / applyFlagSettings / stopTask / backgroundTasks /
   * streamInput / rewindFiles, and nothing else) — so a control frame the SDK has no method
   * for is reachable only by writing the stream-json line itself, which is
   * exactly how the protocol's behavior was measured in the first place
   * (`docs/proposals/claude-resident-sessions-experiments.md` §9).
   *
   * Optional because a process seam may not carry one: a scripted stream has no
   * stdin to write to, and a driver that assumed otherwise would be claiming a
   * capability its own seam never gave it. Absent means the withdrawal entry
   * answers `unknown` rather than pretending to have written anything.
   */
  writeRaw?(frame: AnyRecord): void;
  /**
   * The `settings` object this process's launch handed the SDK, as it was handed
   * over; null when the launch stated none.
   *
   * Reported by the factory rather than guessed by the driver, because the
   * driver never sees the built bag: `buildResidentSdkOptions` produces it and
   * `query` consumes it, both inside `createSdkResidentProcess`. That is the only
   * boundary at which "what did the launch really state" can be read at all, and
   * it is the reading the Remote Control criterion asks for — the request is the
   * driver's, the launched bag is the SDK's.
   *
   * Optional for the same reason `writeRaw` is: a substituted factory has no bag
   * to report, and absent means the host record's `launched` half is `null`
   * rather than a claim built from the request.
   */
  launchSettings?: { remoteControlAtStartup?: boolean; isolatePeerMachines?: boolean } | null;
};

/**
 * The tier every message a busy host pushes is written under.
 *
 * `later` is what makes a busy message behave the way the interactive CLI's
 * does: it waits for the turn in flight, is then run as a turn of its own, and
 * is never merged into the turn it arrived during. Measured on the real binary
 * (`§9.2`): pushed under this tier, a message landed in the sixth real agent
 * turn — a later turn, not the one it was pushed during — and the tier that
 * "never lands" is `next`, not this one. `now` exists in the CLI's vocabulary
 * and is deliberately not used: it jumps the queue ahead of other `later`
 * messages, which is not what a message sent during someone else's turn asked
 * for.
 */
export const CLAUDE_QUEUED_INPUT_PRIORITY: HostInputPriority = 'later';

/**
 * The turn option a caller uses to name the tier ONE busy write is made under instead.
 *
 * WHY IT EXISTS. The default above is the right tier for a message a PERSON typed while
 * something else was running: they asked for it to happen after, and it does. It is the
 * wrong tier for the Live Voice relay's busy release, where the person is standing in
 * front of the session and the words they just spoke are meant for the turn already
 * running — the X3' replay (2026-10-15) measured a p90 delivery delay of 10.8–18.5 s and
 * a p90 first-reaction of 14.0–22.5 s under `later`, against 1.6 s / 8.4 s under `next`
 * on the same 84 readings, because `later` makes the running turn finish without ever
 * having heard the instruction.
 *
 * The relay therefore names the tier on the turn it dispatches, and this host honours it
 * for that write — and only for that write. An option bag that names none (every send
 * that is not the relay's release, including every browser and MCP send and every
 * scheduled message) keeps {@link CLAUDE_QUEUED_INPUT_PRIORITY} exactly as before.
 *
 * Read through {@link readRequestedPriority}: the bag is the caller's own `AnyRecord`, so
 * a value that is not one of the CLI's three tiers is ignored rather than written — a
 * frame carrying a tier the process cannot honor is worse than one carrying the default.
 */
export const CLAUDE_TURN_PRIORITY_OPTION = 'priority';

/**
 * The CLI's three tiers, in the vocabulary {@link HostInputPriority} declares.
 *
 * Restated as a runtime list because the type is erased: a caller hands this host an
 * `AnyRecord`, and the check that keeps a mistyped tier off the wire has to happen on a
 * value, not on a type.
 */
export const HOST_INPUT_PRIORITIES: readonly HostInputPriority[] = ['now', 'next', 'later'];

/**
 * The tier a caller named for THIS turn, or `null` when it named none this host can use.
 *
 * Consumers: {@link ClaudeResidentHostDriver.turnMessages}, which writes the value onto
 * the frame when the process is busy and falls back to `CLAUDE_QUEUED_INPUT_PRIORITY`
 * when this answers `null`.
 */
export function readRequestedPriority(options: AnyRecord): HostInputPriority | null {
  const requested = options[CLAUDE_TURN_PRIORITY_OPTION];
  return typeof requested === 'string' && (HOST_INPUT_PRIORITIES as readonly string[]).includes(requested)
    ? (requested as HostInputPriority)
    : null;
}

/**
 * One user frame this host wrote into the process while the process was busy.
 *
 * The reading exists because the frame's own facts are unreadable from
 * anywhere else once it has been written: the moment it was handed to the
 * process, the tier it was written under, and the uuid the host assigned it
 * (which is also the CLI's `command_uuid` for it) are all host-side facts.
 * `queuedBeforeResult` is the precomputed half of the AC's write-timing
 * reading — whether the frame reached the process before the turn in flight
 * ended — kept here rather than in the criterion so the two timestamps it
 * compares come from the same clock on the same side.
 */
export type ClaudeQueuedInput = {
  uuid: string;
  /** When this host handed the frame to the process input, in host clock terms. */
  at: number;
  /** The tier the frame was written under. */
  priority: string | null;
  /** The frame verbatim, as it was written. */
  frame: AnyRecord;
  /**
   * When the CLI dequeued this message into a turn of its own, or `null` while
   * it is still queued.
   */
  startedAt: number | null;
  /**
   * How many turns had ended when the frame was pushed. The turn in flight at
   * that moment is the one whose `result` this index points at, so
   * `resultTimes[resultsSeenAtPush]` is the `turnResultAt` of the AC's
   * write-timing reading.
   */
  resultsSeenAtPush: number;
  /** Whether the frame reached the process before that turn's `result`. */
  queuedBeforeResult: boolean | null;
};

/**
 * What a live resident host knows about the messages it pushed while busy, the
 * queue's own account of them, and the control frames it wrote.
 *
 * A copy, like {@link ClaudeUnattendedReading}, and `null` for a session this
 * driver is not hosting. Everything in it is read off the host that owns the
 * process: the push moments and tiers are the host's own marks, the lifecycle
 * list is the CLI's answer as this host read it, and the control frames are the
 * bytes this host wrote.
 */
export type ClaudeBusyInputReading = {
  /** Every frame this host pushed while the process was already busy, in push order. */
  queuedInputs: ClaudeQueuedInput[];
  /** Every `command_lifecycle` event this host read, in arrival order. */
  lifecycle: CommandLifecycleEvent[];
  /** Every control frame this host wrote to the process, in write order. */
  controlFrames: Array<{ at: number; requestId: string; frame: AnyRecord }>;
  /** Every `control_response` the CLI sent back, in arrival order. */
  controlResponses: Array<{ at: number; requestId: string | null }>;
  /**
   * When each turn's `result` was read, in arrival order.
   *
   * Indexed by turns *ended*, which is the same index
   * {@link ClaudeQueuedInput.resultsSeenAtPush} counts, so the two line up
   * without either side knowing a round's identity.
   */
  resultTimes: number[];
  /** How many `session_state_changed` messages the stream carried (E9 §9.1: none). */
  sessionStateChanged: number;
  /**
   * How many rounds are still waiting for a turn to end — `state.rounds`, the
   * driver's FIFO of turns it has armed and not yet settled.
   *
   * Read by the criterion for the merged-turn settlement
   * (`claude-resident-merged-queued-turn.test.ts`): a `result` that carries a
   * merged turn has to drain every round the CLI merged into it, so the queue
   * reading is what shows the FIFO is empty at rest rather than one off. Nothing
   * in production consumes it.
   */
  roundsOpen: number;
  /** The host process's pid, or null when the seam did not report one. */
  hostPid: number | null;
};

/**
 * Builds one resident process.
 *
 * Injected for the same reason the per-run driver injects its query factory: the
 * SDK's `query` is a module-level function, so there is no seam to stub. The
 * default is the real SDK plus the pid capture; a criterion that wants a
 * scripted stream — or a fake process that really dies — hands in its own.
 */
/**
 * Readings the driver takes out of the process it is about to spawn.
 *
 * The `Stop` hook is the only place the CLI says what it is still holding
 * (`background_tasks`, `session_crons`), and it is not on the message stream:
 * the SDK delivers it to a callback, so the only way to have it is to install
 * one. Installing it through the process factory rather than inside the driver
 * is what keeps the seam honest — the factory owns the SDK options, so a
 * criterion that substitutes a factory is also the thing that decides whether
 * the hook ever runs, instead of the driver reading a hook it quietly added.
 */
export type ClaudeResidentProcessSeams = {
  /** Called with every `Stop` hook input verbatim, in arrival order. */
  onStop?: (input: AnyRecord) => void;
};

/**
 * One place a turn can need a person, named once so every reading agrees.
 *
 * The three are the SDK's own three callbacks, and they are the whole of this
 * host's answer to "who does a turn ask when it needs a human": `side_question`
 * is deliberately absent — it travels host→CLI, so it is a question *this* side
 * asks, and E9 read the CLI accepting the subtype with no `control_response`
 * ever coming back (see the README's resident-permission section).
 */
export type ClaudePermissionEntry = 'canUseTool' | 'onElicitation' | 'onUserDialog';

/**
 * The three callbacks a resident process is launched with, structurally typed.
 *
 * `canUseTool`'s signature is the SDK's (`toolName`, `input`, `{ signal }` →
 * `PermissionResult`); the other two take their own request object verbatim and
 * answer in their own result shape. All three are typed as `AnyRecord` in and
 * out on purpose: this file's promise is *where* the callback comes from and
 * *what this host decides*, and restating the SDK's union types here would be a
 * second copy of a contract the SDK already publishes (`sdk.d.ts`).
 */
export type ClaudeResidentPermissions = {
  canUseTool: (toolName: string, input: AnyRecord, options: AnyRecord) => Promise<AnyRecord>;
  onElicitation: (request: AnyRecord, options: AnyRecord) => Promise<AnyRecord>;
  onUserDialog: (request: AnyRecord, options: AnyRecord) => Promise<AnyRecord>;
};

/**
 * One decision one of the three entries made, as a reader can re-read it.
 *
 * Kept because none of the three answers is readable anywhere else after the
 * fact: the SDK consumes the callback's return value, the wire carries only the
 * *request*, and a refusal produces no frame at all. A criterion therefore has
 * to read what the host decided from the host.
 */
export type ClaudePermissionDecision = {
  /** Which entry answered. */
  entry: ClaudePermissionEntry;
  /** The tool name the entry was given, or null for the two request-shaped ones. */
  toolName: string | null;
  /** The request as the callback received it, verbatim. */
  request: AnyRecord;
  /**
   * The answer this host returned, verbatim.
   *
   * Null when the client flow timed out — the third outcome of a wait that the
   * per-run path has always branched on, and `null` rather than an invented
   * object is what keeps that branch readable from here.
   */
  answer: AnyRecord | null;
  /** True when the answer was the unattended refusal. */
  refused: boolean;
  /** True when the answer came from the client's request-frame flow. */
  viaClient: boolean;
  /** The request id the client flow used, or null when no frame was sent. */
  requestId: string | null;
  /** The refusal wording, or null when this was not a refusal. */
  reason: string | null;
  /** When the decision was made, in host clock terms. */
  at: number;
};

/**
 * What a live resident host knows about the requests it answered for a person.
 *
 * A copy, and `null` for a session this driver is not hosting — the same two
 * properties every other reading here has. `permissionMode` is this host's own
 * account of the mode the process is under (it is the value the three entries
 * consult, and the value `setPermissionMode` moved), not a re-read of the
 * launch's option bag, which stops being the truth after the first switch.
 */
export type ClaudePermissionReading = {
  permissionMode: string;
  decisions: ClaudePermissionDecision[];
  /** The browser count this host last consulted; see {@link ClaudeResidentHostDriverOptions.connectedClientCount}. */
  lastConnectedCount: number;
};

/**
 * One resident process's permission state, alive from before its spawn.
 *
 * The three callbacks are installed on the SDK options *before* `query()` is
 * called, while the host state they report into is adopted one `openHost` later
 * — the same ordering problem the `Stop` sink has, and solved the same way: the
 * scope exists first, carries its own decision log so a request answered in that
 * gap is still readable, and is pointed at the host state by `startHost`.
 *
 * `mode` is this host's own account of the mode its process is under. It starts
 * at {@link RESIDENT_PERMISSION_MODE} and moves only when `reconfigure` really
 * moved it, because a value written before the call returned would be a claim
 * about a process that may not have taken it.
 */
export type ClaudePermissionScope = {
  state: ResidentHostState | null;
  mode: string;
  decisions: ClaudePermissionDecision[];
  lastConnectedCount: number;
};

/**
 * What one entry got back for one request: a refusal, or the client's own answer.
 *
 * The refusal is a shape of its own rather than a `deny` decision because it
 * never travelled through the client flow at all — the distinction the criterion
 * reads, and the reason the two cannot be collapsed into "the answer object".
 * `decision` is the client's answer verbatim, which is `null` when the wait
 * timed out and `{cancelled: true}` when it was aborted; both are the client
 * flow's own outcomes and each entry branches on them itself.
 */
export type ClaudePermissionAnswer =
  | { kind: 'refused'; message: string }
  | { kind: 'client'; decision: AnyRecord | null };

export type ClaudeResidentProcessFactory = (input: {
  prompt: AsyncIterable<AnyRecord>;
  options: AnyRecord;
  seams?: ClaudeResidentProcessSeams;
  /**
   * The three human-facing entries this host answers for, when it has any.
   *
   * Carried on the factory input rather than built inside the factory because
   * the *policy* is this driver's — whether the host is unattended, which writer
   * a request belongs on, what the refusal says — while the *installation* is
   * the launch's, because the SDK options belong to whoever calls `query`. The
   * default factory puts them on the SDK options verbatim; a criterion's factory
   * can read them without the SDK being involved at all.
   */
  permissions?: ClaudeResidentPermissions;
  /**
   * The two Remote Control flags this launch must state for the SDK.
   *
   * On the factory input for the same reason `permissions` is: the *request* is
   * this driver's policy decision (it is the half of the gate the driver owns
   * once the user's settings have said "not enabled"), while *stating* it on the
   * SDK options is the launch's job. The default factory writes them into
   * `sdkOptions.settings`; the driver records the same object on the host record,
   * so the request and the launched bag can be compared against each other.
   *
   * Absent means "state nothing", which is what a build that dropped the
   * defence-in-depth half does — the mutant the criterion's arm (b) expresses.
   */
  remoteControlFlags?: ClaudeRemoteControlFlags;
}) => ClaudeResidentProcess;

/**
 * The manager surface this driver needs, as a port rather than the singleton.
 *
 * `openHost` is how a resident session gets a process (see the file header for
 * why not `bindSession`), `snapshot` is how the driver finds the host a later
 * turn belongs to, and `bindSession` is only ever passed through to the per-run
 * driver this one composes. Taking it as a constructor option is what lets a
 * criterion inject a manager with its own clock — the quiet ceiling a resident
 * host is held under is that manager's policy, not a number this file knows.
 */
export type ClaudeResidentHostPort = Pick<
  SessionHostManager,
  'openHost' | 'snapshot' | 'bindSession' | 'openUnattendedRun' | 'openTurn'
>;

/**
 * The notification a resident turn's end makes.
 *
 * The same shape the runtime's own run reports, so a resident turn stops the
 * same way a per-run one does and nothing downstream has to learn a second
 * vocabulary. `sessionId` is the *application* session id, which is what the
 * runtime passes (it prefers the app id over the provider-native one here), and
 * `sessionName` comes from the turn's own options.
 */
export type ClaudeResidentRunStoppedEvent = {
  userId: string | number | null;
  provider: LLMProvider;
  sessionId: string | null;
  sessionName: string | null;
  stopReason: 'completed' | 'aborted';
};

/**
 * Which arm of §10.1 this host is running.
 *
 * `log` — the shipped arm — states a divergence and changes nothing; `enforce`
 * closes a phantom run. §10.1 makes the order a rule rather than an option:
 * "先只打日志（`mode=log`），观察一段时间无误报后再启用 `mode=enforce`", because a
 * wrong decision under `enforce` settles work that was real. The ship default is
 * therefore `log` ({@link CLAUDE_RESIDENT_RECONCILE_MODE}), and a criterion that
 * drives the `enforce` arm states it on the driver it builds.
 */
export type ClaudeResidentReconcileMode = 'log' | 'enforce';

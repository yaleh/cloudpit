/**
 * The bottom layer of the resident host driver: every field, the constructor,
 * and the readings that answer from host state alone.
 *
 * This file is part of the `lifecycle/` sink extracted from
 * `claude-host-driver.provider.ts`. It imports nothing from the claude package
 * (see `resident-process.types.ts`), so the only edge is the package root into
 * here — never the reverse.
 */

import { randomUUID } from 'node:crypto';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import type { Writable } from 'node:stream';

import type { SpawnOptions as SdkSpawnOptions, SpawnedProcess } from '@anthropic-ai/claude-agent-sdk';

import { notifyUserIfEnabled } from '@/modules/notifications/index.js';
import type { SessionHostManager } from '@/modules/session-hosts/index.js';
import type { IProviderHostDriverSink } from '@/shared/interfaces.js';
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
  HostCloseReason,
  HostInputPriority,
  HostLease,
  HostPendingQueuedInputs,
  HostQueuedInputCancelResult,
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
} from '@/shared/utils.js';
import { readVoiceRulesPort } from '@/shared/ports/voice-rules.port.js';

import {
  CLAUDE_RESIDENT_INTERRUPT_RESULT_TIMEOUT_MS,
  CLAUDE_RESIDENT_RECONCILE_MODE,
  ClaudeBusyInputReading,
  ClaudePermissionAnswer,
  ClaudePermissionEntry,
  ClaudePermissionReading,
  ClaudePermissionScope,
  ClaudeResidentHostPort,
  ClaudeResidentProcess,
  ClaudeResidentProcessFactory,
  ClaudeResidentReconcileMode,
  ClaudeResidentRunStoppedEvent
} from './resident-process.types.js';
import {
  ClaudeRemoteControlRefusal
} from './resident-settings.js';
import {
  BackgroundTaskLease,
  ClaudeResidentLifecycleReading,
  ClaudeUnattendedReading,
  ClaudeUnattendedWorkEvent,
  CronLease
} from './resident-turn.types.js';
import {
  CLAUDE_RESIDENT_QUIESCE_MS,
  CLAUDE_RESIDENT_RECONCILE_BEAT_MS,
  ClaudeResidentLedgerReading,
  ClaudeResidentRunRegistryPort,
  NO_RESIDENT_RUN_REGISTRY,
  ResidentRound
} from './resident-ledger-runtime.js';
import {
  ClaudeResidentSessionRegistries,
  residentSessionRegistries
} from './resident-deliveries.js';
import {
  ClaudeResidentProcessingReading,
  PendingHost,
  ResidentHostState
} from './resident-host.types.js';
import type { ClaudeResidentOutcomeName } from './claude-resident-outcome-registry.js';
import type { ClaudeResidentLifecycleOutcomeName, ClaudeResidentLifecycleOutcomePayload } from './claude-resident-lifecycle-outcome-registry.js';

/**
 * What the base layers read off the driver's option bag.
 *
 * `createProcess` is required here, not optional: the default is
 * `createSdkResidentProcess`, which lives beside the concrete driver (it needs
 * the shared option mapper from `claude-runtime.provider.ts`), so the concrete
 * class resolves it before calling `super` and a base layer never reaches into
 * the package root.
 */
export type ClaudeResidentHostDriverBaseOptions = {
  host: ClaudeResidentHostPort;
  notifyRunStopped: (event: ClaudeResidentRunStoppedEvent) => void;
  notifyUnattendedWork: (event: ClaudeUnattendedWorkEvent) => void;
  createProcess: ClaudeResidentProcessFactory;
  now?: () => number;
  interruptResultTimeoutMs?: number;
  reconcileMode?: ClaudeResidentReconcileMode;
  quiesceMs?: number;
  reconcileBeatMs?: number;
  runRegistry?: ClaudeResidentRunRegistryPort;
  logSink?: (line: string) => void;
  connectedClientCount?: () => number;
  notifyUser?: (delivery: { userId: string | number | null; event: AnyRecord }) => void;
  userSettingsPath?: string | null;
};

export abstract class ClaudeResidentHostStateBase {
  protected readonly provider: LLMProvider = 'claude';

  /**
   * One conversation per process. Stated rather than left absent because the
   * manager reads this as `=== true`, and because it is the reason a second
   * resident session gets its own process instead of a second binding.
   */
  readonly multiplexedHost = false;

  protected readonly host: ClaudeResidentHostPort;

  protected readonly notifyRunStopped: (event: ClaudeResidentRunStoppedEvent) => void;

  protected readonly notifyUnattendedWork: (event: ClaudeUnattendedWorkEvent) => void;

  protected readonly createProcess: ClaudeResidentProcessFactory;

  /** The instant a held-work reason is dated from; see {@link ClaudeResidentHostDriverOptions.now}. */
  protected readonly now: () => number;

  /**
   * How long an interrupt waits for its `RESULT`; see
   * {@link ClaudeResidentHostDriverOptions.interruptResultTimeoutMs}.
   */
  protected readonly interruptResultTimeoutMs: number;

  /** Which arm of §10.1 this host runs; see {@link ClaudeResidentHostDriverOptions.reconcileMode}. */
  protected readonly reconcileMode: ClaudeResidentReconcileMode;

  /** `T_q` — the standing-still grace; see {@link ClaudeResidentHostDriverOptions.quiesceMs}. */
  protected readonly quiesceMs: number;

  /** How often each host's own reconcile beat runs; see {@link ClaudeResidentHostDriverOptions.reconcileBeatMs}. */
  protected readonly reconcileBeatMs: number;

  /** The run registry as read and acted on; see {@link ClaudeResidentHostDriverOptions.runRegistry}. */
  protected readonly runRegistry: ClaudeResidentRunRegistryPort;

  /** Where §10.2's `[ledger]` / `[turn]` lines go; see {@link ClaudeResidentHostDriverOptions.logSink}. */
  protected readonly logSink: (line: string) => void;

  /** How many browsers are connected; see {@link ClaudeResidentHostDriverOptions.connectedClientCount}. */
  protected readonly connectedClientCount: () => number;

  /** Where a permission notification goes; see {@link ClaudeResidentHostDriverOptions.notifyUser}. */
  protected readonly notifyUser: (delivery: { userId: string | number | null; event: AnyRecord }) => void;

  /**
   * The user-level settings file the gate reads; null means "resolve it at
   * launch time from the config directory the process will run under".
   */
  protected readonly userSettingsPath: string | null;

  /**
   * The refusals this driver has made, newest last per session.
   *
   * Kept because a refusal leaves no host behind — that is the point of it — so
   * there is nothing in `snapshot()` to carry the code and the copy to a reader.
   * The caller that caught the thrown error has them already; this is for the
   * caller that did not, which is every caller that reached the run through the
   * application dispatch (`chat.send`): there the rejection is logged and the
   * turn ends with a terminal frame, and the *reason* would otherwise be
   * unreadable from outside. The same shape the permission log has, and for the
   * same reason: a decision nothing else records.
   */
  protected readonly refusals = new Map<string, ClaudeRemoteControlRefusal>();

  /** The live state per host. */
  protected readonly hosts = new Map<string, ResidentHostState>();

  /**
   * The per-session readings this driver publishes through.
   *
   * The process-wide instance ({@link residentSessionRegistries}) the exported
   * readers in this module share — the readings belong to the server rather
   * than to one host, so this is ownership of the same object, not a cache per
   * driver. `publishDeliveries` installs the session's delivery, turn-run,
   * by-id and `processing` readings here.
   */
  protected readonly registries: ClaudeResidentSessionRegistries;

  /** What the next `startHost` should adopt, since `openHost` decides the host id. */
  protected pending: PendingHost | null = null;

  /** Counted turn ids: one per armed round, so a reading of the lease is repeatable. */
  protected serial = 0;

  protected constructor(options: ClaudeResidentHostDriverBaseOptions) {
    this.host = options.host;
    this.notifyRunStopped = options.notifyRunStopped;
    this.notifyUnattendedWork = options.notifyUnattendedWork;
    this.createProcess = options.createProcess;
    this.now = options.now ?? (() => Date.now());
    this.interruptResultTimeoutMs =
      options.interruptResultTimeoutMs ?? CLAUDE_RESIDENT_INTERRUPT_RESULT_TIMEOUT_MS;
    this.reconcileMode = options.reconcileMode ?? CLAUDE_RESIDENT_RECONCILE_MODE;
    this.quiesceMs = options.quiesceMs ?? CLAUDE_RESIDENT_QUIESCE_MS;
    this.reconcileBeatMs = options.reconcileBeatMs ?? CLAUDE_RESIDENT_RECONCILE_BEAT_MS;
    this.runRegistry = options.runRegistry ?? NO_RESIDENT_RUN_REGISTRY;
    this.logSink = options.logSink ?? (() => undefined);
    this.connectedClientCount = options.connectedClientCount ?? (() => 0);
    this.notifyUser =
      options.notifyUser ?? (({ userId, event }) => notifyUserIfEnabled({ userId, event }));
    this.userSettingsPath = options.userSettingsPath ?? null;
    this.registries = residentSessionRegistries;
  }

  /**
   * The six reactions the driver class implements and the base layers call.
   *
   * Declared here because a base class cannot name a derived member, and a
   * `protected abstract` signature is what keeps the call graph one-way: every
   * body below this line may call these, and only the concrete driver answers.
   */
  protected abstract startResidentHost(
    appSessionId: string,
    messages: AnyRecord[],
    turn: HostTurnInput,
    context: ProviderRuntimeContext,
  ): Promise<ResidentHostState>;

  protected abstract turnMessages(turn: HostTurnInput, queuedBehindTurn: boolean): Promise<AnyRecord[]>;

  protected abstract publishDeliveries(state: ResidentHostState): void;

  protected abstract observeFrame(state: ResidentHostState, message: AnyRecord): void;

  protected abstract abandonUnattendedTurn(state: ResidentHostState, exitCode: number): void;

  protected abstract dispatchReading<TResult>(
    name: ClaudeResidentOutcomeName,
    appSessionId: string,
  ): TResult | null;

  protected abstract dispatchLifecycle<
    TResult = unknown,
    TName extends ClaudeResidentLifecycleOutcomeName = ClaudeResidentLifecycleOutcomeName,
  >(
    name: TName,
    state: ResidentHostState,
    payload: ClaudeResidentLifecycleOutcomePayload[TName],
  ): TResult | null;

  protected abstract answerPermissionRequest(input: {
    appSessionId: string;
    scope: ClaudePermissionScope;
    entry: ClaudePermissionEntry;
    toolName: string | null;
    request: AnyRecord;
    signal?: AbortSignal;
  }): Promise<ClaudePermissionAnswer>;

  /**
   * Cancels the pending `T_int` watchdog, if one is armed.
   *
   * Called at the two moments the wait stops being a wait: the `RESULT` that
   * answers the request, and every path that ends the host — the same moments
   * {@link stopTitleMirror} is called at, for the same reason.
   */
  protected stopInterruptWatchdog(state: ResidentHostState): void {
    if (state.interruptWatchdog) {
      clearTimeout(state.interruptWatchdog.timer);
      state.interruptWatchdog = null;
    }
  }

  /** Stops this host's reconcile beat. Idempotent; called on every close path. */
  protected stopReconcileBeat(state: ResidentHostState): void {
    state.reconcileBeat?.stop();
    state.reconcileBeat = null;
  }

  /**
   * Reports what a live resident host knows about pushes and unattended turns.
   *
   * A copy, so the caller cannot reach into host state, and `null` for a session
   * this driver is not hosting — both properties a reading has to have to be
   * worth printing. The uuids are the point: the pushed set is the host's own
   * mark and the opener uuid is the CLI's, and a turn whose opener is absent from
   * the set is one nobody pushed (see {@link ResidentHostState.pushedUuids}).
   * `initTools` and `backgroundTaskType` ride along because they are facts of the
   * same process that nothing outside it can read.
   */
  unattendedReading(appSessionId: string): ClaudeUnattendedReading | null {
    return this.dispatchReading<ClaudeUnattendedReading | null>('unattendedReading', appSessionId);
  }

  /**
   * Reports what a live resident host knows about its busy-time writes.
   *
   * A copy, and `null` for a session this driver is not hosting — the same two
   * properties {@link unattendedReading} has, for the same reason. What is in
   * it is everything the write side of this driver produces that nothing else
   * can read: when each frame was handed over and under which tier, the CLI's
   * own queue account of it, the control frames this host wrote, and the
   * responses that came back to them.
   */
  busyInputReading(appSessionId: string): ClaudeBusyInputReading | null {
    return this.dispatchReading<ClaudeBusyInputReading | null>('busyInputReading', appSessionId);
  }

  /**
   * Reports the delivery/turn ledger for a session this driver is hosting, or
   * `null` for one it is not.
   *
   * A copy, like every other reading here, and the whole of what a criterion
   * needs to judge the host's own account of its sends: which deliveries it
   * made and where each has got to, which commands are foreign, the turn that
   * is open (and its kind), every turn that has closed with the ending it read,
   * the commands waiting to be bound, and every anomaly the ledger recorded.
   *
   * Consumed by the AC-378 criterion
   * (`tests/claude-resident-ledger-invariants.test.ts`), which drives a real
   * host through seeded frame sequences and asserts I1–I6 from these readings
   * rather than from the driver's private fields. Nothing in production consumes
   * it.
   *
   * Unlike every other reading here it stays readable after the host has ended —
   * see {@link ledgerStateFor} — because "nothing was left open" is a question
   * about a dead host as much as a live one, and the exit leg of that criterion
   * asks it.
   */
  ledgerReading(appSessionId: string): ClaudeResidentLedgerReading | null {
    return this.dispatchReading<ClaudeResidentLedgerReading | null>('ledgerReading', appSessionId);
  }

  /**
   * The uuid of the newest message this host queued while busy, or null.
   *
   * The id `cancelQueuedInput` withdraws a message by, read off the same
   * `state.queuedInputs` record {@link busyInputReading} reports: an entry's
   * uuid is the CLI's own `command_uuid` for that message (the CLI's
   * `command_lifecycle` reports it back), so it is the value a control caller
   * must hold to withdraw the message. "Newest and not started" is the message
   * a withdrawal can still reach — a `started` entry has been dequeued into a
   * turn of its own and can no longer be taken back, and an older unstarted
   * entry is unreachable behind the newest for the same reason.
   *
   * Synchronous because the queue is this driver's own memory; the message is
   * written before the dispatch that queued it resolves, so there is no I/O to
   * await. `null` for a session this driver is not hosting, a closed host, or a
   * queue with nothing left to withdraw — the conservative direction, so a
   * caller that reads it never holds an id no withdrawal can match. Consumed by
   * the runtime gateway's `queuedInputUuid` (`provider-runtime.service.ts`),
   * which the websocket control service's busy-send branch reads
   * (`chat-control.service.ts`).
   */
  queuedInputUuid(appSessionId: string): string | null {
    return this.dispatchReading<string | null>('queuedInputUuid', appSessionId);
  }

  /**
   * How much of the person's text the CLI's own queue is still holding, or null.
   *
   * THE READING A RELAY CANNOT PRODUCE ITSELF. The CLI holds its own command
   * queue and drains it at a turn boundary — measured 2026-10-12, seven entries
   * dequeued in one millisecond into a single turn — so a relay that counts its
   * own accepted deliveries can only ever grow, and reported `queued=8→9→10`
   * against a real depth that peaked at seven and then fell to two. The truth
   * lives here, and this is it handed out.
   *
   * RECONCILED FROM BOTH READINGS, not one. `queuedInputs` carries the bytes —
   * the CLI's `command_lifecycle` says nothing about how long a message is — and
   * `lifecycle` carries the dequeue: a message is still WAITING only when this
   * host pushed it (`queuedInputs`), the CLI has not dequeued it (`startedAt`
   * still null), and no `started`/`completed`/`cancelled` was read for its uuid.
   * Taking only `queuedInputs` would count a withdrawn message forever; taking
   * only `lifecycle` would lose the byte reading. The two together are the
   * acknowledged double-entry.
   *
   * `null` for a session this driver is not hosting — the same conservative
   * direction {@link queuedInputUuid} takes, so a caller reads "cannot say"
   * rather than a fabricated empty queue. Synchronous: the queue is this
   * driver's own memory. Consumed by the runtime gateway's
   * `pendingQueuedInputs` (`provider-runtime.service.ts`), which the voice relay
   * samples to reconcile its reported depth (`voice-realtime-ws-proxy.service.ts`).
   */
  pendingQueuedInputs(appSessionId: string): HostPendingQueuedInputs | null {
    return this.dispatchReading<HostPendingQueuedInputs | null>('pendingQueuedInputs', appSessionId);
  }

  /**
   * The `commandUuid`s the CLI has already dequeued into a turn, or null.
   *
   * THE OTHER HALF OF THE SAME `command_lifecycle` RECORD. {@link pendingQueuedInputs}
   * reads it for what is STILL WAITING (any state but `queued` means the message
   * left the queue); this reads it for what has LEFT — the `started` events, in
   * arrival order — which is the reading an interrupt fence needs and cannot
   * derive from anything else. A proxy knows the messages it sent; only the CLI
   * knows which of them it took up, and the turn boundary that does the taking-up
   * is precisely the moment nothing tells the proxy about. Without this reading a
   * stop for a sentence the current run already carries cannot be told from a stop
   * for a run that has not reached it yet, and the model's second thought aborts
   * the very turn that is answering it (SPEC §0.3 D-7's repeated-interrupt churn).
   *
   * DEDUPLICATED, because the caller's use is a set membership test (`coveredSeqs`
   * in `voice-realtime-ws-proxy.service.ts`): a uuid the CLI reported `started`
   * twice is one dequeued command, not two. The terminal states are deliberately
   * NOT filtered out — a command that started and then completed was carried by
   * that turn, which is exactly what "the run covers this sentence" means.
   *
   * `null` for a session this driver is not hosting — the same conservative
   * direction {@link pendingQueuedInputs} takes, so a caller reads "cannot say"
   * rather than a fabricated empty list (an empty list is a REAL reading: this
   * host holds a process that has dequeued nothing). Synchronous: the lifecycle
   * list is this driver's own memory. Consumed by the runtime gateway's
   * `startedQueuedCommands` (`provider-runtime.service.ts`), which the voice
   * relay's interrupt fence samples through its `hostCommandLifecycle` seam
   * (`voice-realtime-ws-proxy.service.ts`, wired in `server/index.ts`).
   */
  startedQueuedCommands(appSessionId: string): readonly string[] | null {
    return this.dispatchReading<readonly string[] | null>('startedQueuedCommands', appSessionId);
  }

  /**
   * Whether a turn is IN FLIGHT for a session this driver hosts, or `null` when it hosts none.
   *
   * THE AUTHORITY THE TURN-PHASE READING LACKS. `state.rounds` is this driver's own FIFO of the turns
   * the CLI has armed — the front one is the turn in flight, and an interrupted round stays until its
   * `result` — so `rounds.length > 0` is the resident process's own account of "busy", read from the
   * process that knows it. The activity store's turn phase is a REDUCTION of stream traffic
   * (`claude-turn-phase.service.ts`): it has no "turn began" signal, so it only leaves `idle` on the
   * first `thinking_tokens`/text/`tool_use` and returns to `phaseBeforeTool` after a `tool_result` —
   * which is why the 2026-10-14 evening reading saw the relay release its ONE held message mid-turn
   * four times, dropping the words into the CLI's own queue. The composition root's `hostRunActivity`
   * (`server/index.ts`) prefers this reading and keeps the phase reading only for the sessions this
   * driver does not host.
   *
   * `null` for a session this driver is not hosting — the same conservative direction
   * {@link pendingQueuedInputs} takes, so a caller reads "cannot say" and keeps the older reading
   * rather than a fabricated `false`. Synchronous: the rounds list is this driver's own memory.
   * Consumed by the runtime gateway's `runInFlight` (`provider-runtime.service.ts`), which the
   * composition root samples inside `hostRunActivity` (`server/index.ts`); read into one place by
   * {@link composeHostRunActivityReading} (`voice-realtime-ws-proxy.service.ts`).
   */
  runInFlight(appSessionId: string): boolean | null {
    return this.dispatchReading<boolean | null>('runInFlight', appSessionId);
  }

  /**
   * Reports what a live resident host is holding, and how it came to hold it.
   *
   * The manager's snapshot already answers "what reasons does this binding
   * carry"; what it cannot carry is this driver's own account of *how* each one
   * was arrived at — whether the CLI named it or a tool call implied it, and
   * which stream subtypes passed through unread. Read by the criterion in
   * `tests/claude-resident-idle.test.ts`, which has to tell those apart;
   * nothing in production consumes it.
   */
  lifecycleReading(appSessionId: string): ClaudeResidentLifecycleReading | null {
    return this.dispatchReading<ClaudeResidentLifecycleReading | null>('lifecycleReading', appSessionId);
  }

  /**
   * Reports the mode a live resident host is under, and what it decided for whom.
   *
   * A copy, and `null` for a session this driver is not hosting — the same two
   * properties every other reading here has, for the same reason. Nothing on the
   * wire carries either half: the SDK consumes a callback's return value, the
   * frames carry only the *request*, and a refusal produces no frame at all — so
   * "was this refused, and with what words?" is only answerable from the host
   * that answered. `lastConnectedCount` rides along so the browser half of the
   * attendance test is a reading rather than an inference from the other half.
   */
  permissionReading(appSessionId: string): ClaudePermissionReading | null {
    return this.dispatchReading<ClaudePermissionReading | null>('permissionReading', appSessionId);
  }

  /**
   * The Remote Control refusal this driver made for a session, or null.
   *
   * Read from a map keyed by session rather than from a host, because a refusal
   * is precisely the case where no host exists: the gate refuses *before*
   * `openHost`, so there is no record in `snapshot()` to carry the code or the
   * copy. A caller that caught the thrown error does not need this; the caller
   * that drove the run through the application dispatch — where the rejection is
   * logged and the turn ends with a terminal frame — does, because otherwise the
   * reason is unreadable from outside the process.
   *
   * Last-write-wins per session, like the permission log: a session refused,
   * then allowed after the user turned Remote Control off, reads `null` — which
   * is the truth, and the pair of readings is why the map is cleared on a launch
   * that gets past the gate.
   */
  remoteControlRefusal(appSessionId: string): ClaudeRemoteControlRefusal | null {
    return this.dispatchReading<ClaudeRemoteControlRefusal | null>('remoteControlRefusal', appSessionId);
  }

  /** Thin delegation to the shipped `dropRound` handler; see `claude-resident-lifecycle-outcome-handlers.ts`. */
  protected dropRound(state: ResidentHostState, round: ResidentRound): void {
    this.dispatchLifecycle('dropRound', state, { round });
  }

  /** Thin delegation to the shipped `endWithdrawnRun` handler; see `claude-resident-lifecycle-outcome-handlers.ts`. */
  protected endWithdrawnRun(state: ResidentHostState, deliveryId: string): void {
    this.dispatchLifecycle('endWithdrawnRun', state, { deliveryId });
  }

  /** Thin delegation to the shipped `settleCrons` handler; see `claude-resident-lifecycle-outcome-handlers.ts`. */
  protected settleCrons(state: ResidentHostState, desired: CronLease[]): void {
    this.dispatchLifecycle('settleCrons', state, { desired });
  }

  /** Thin delegation to the shipped `settleBackgroundTasks` handler; see `claude-resident-lifecycle-outcome-handlers.ts`. */
  protected settleBackgroundTasks(state: ResidentHostState, desired: BackgroundTaskLease[]): void {
    this.dispatchLifecycle('settleBackgroundTasks', state, { desired });
  }

  /** Thin delegation to the shipped `reconcileHeldWork` handler; see `claude-resident-lifecycle-outcome-handlers.ts`. */
  protected reconcileHeldWork(state: ResidentHostState, input: AnyRecord): void {
    this.dispatchLifecycle('reconcileHeldWork', state, { input });
  }

  /** Thin delegation to the shipped `observeHeldWorkEvent` handler; see `claude-resident-lifecycle-outcome-handlers.ts`. */
  protected observeHeldWorkEvent(state: ResidentHostState, message: AnyRecord): void {
    this.dispatchLifecycle('observeHeldWorkEvent', state, { message });
  }

  /** Thin delegation to the shipped `inferHeldWork` handler; see `claude-resident-lifecycle-outcome-handlers.ts`. */
  protected inferHeldWork(state: ResidentHostState, message: AnyRecord): void {
    this.dispatchLifecycle('inferHeldWork', state, { message });
  }

  /**
   * The pid, once the spawn hook has run.
   *
   * The SDK spawns eagerly for a streaming prompt, so the hook has almost always
   * fired by the time `query()` returns; the extra tick is for a build that
   * defers it by a microtask, and a pid that never appears is recorded as the
   * truth (`null`) rather than waited on.
   */
  protected async resolvePid(process: ClaudeResidentProcess): Promise<number | null> {
    if (process.pid !== null) {
      return process.pid;
    }
    await new Promise<void>((resolve) => setImmediate(resolve));
    return process.pid;
  }

  /** One round record, with the settlement its dispatcher awaits. */
  protected createRound(
    appSessionId: string,
    turn: HostTurnInput,
    writer: ProviderRuntimeWriter,
    context: ProviderRuntimeContext,
  ): ResidentRound {
    let resolveDone: () => void = () => {};
    let rejectDone: (error: Error) => void = () => {};
    const done = new Promise<void>((resolve, reject) => {
      resolveDone = resolve;
      rejectDone = reject;
    });

    const round: ResidentRound = {
      appSessionId,
      turn,
      writer,
      context,
      done,
      settled: false,
      interrupted: false,
      settle(): void {
        if (round.settled) {
          return;
        }
        round.settled = true;
        resolveDone();
      },
      fail(error: Error): void {
        if (round.settled) {
          return;
        }
        round.settled = true;
        rejectDone(error);
      },
    };

    return round;
  }

  /** Thin delegation to the shipped `emitLedgerLines` handler; see `claude-resident-lifecycle-outcome-handlers.ts`. */
  protected emitLedgerLines(state: ResidentHostState): void {
    this.dispatchLifecycle('emitLedgerLines', state, undefined);
  }

  /** Thin delegation to the shipped `writeReconcileLine` handler; see `claude-resident-lifecycle-outcome-handlers.ts`. */
  protected writeReconcileLine(state: ResidentHostState, anomaly: string, detail: string): void {
    this.dispatchLifecycle('writeReconcileLine', state, { anomaly, detail });
  }

  /**
   * The ledger's `processing` predicate for one host (SPEC §4.3).
   *
   * `turn.open` covers the unattended turn — a turn nothing was pushed for still
   * means the process is working — and the non-terminal deliveries cover both the
   * `pushed` window (a send accepted before the CLI has said anything about it)
   * and the drained-queue window (commands still owed after their dispatcher's
   * turn ended, waiting for the turn that will run them). Reading the *delivery
   * states* rather than `runOpen` is deliberate: a delivered command's run closes
   * at its turn's `RESULT` while its own terminal may arrive later (C-3), and the
   * process is not idle in that gap either.
   */
  protected processingReadingOf(state: ResidentHostState): ClaudeResidentProcessingReading {
    const ledger = state.turnLedger;
    const live = ledgerDeliveries(ledger).filter((delivery) => !isTerminalDeliveryState(delivery.state));
    const startedAt = live.length > 0
      ? Math.min(...live.map((delivery) => delivery.enqueuedAt))
      : (state.turnRun?.startedAt ?? this.now());
    return {
      processing: ledgerTurn(ledger)?.open === true || live.length > 0,
      provider: this.provider,
      startedAt,
      deliveryIds: live.map((delivery) => delivery.commandUuid),
    };
  }

  /**
   * Recomputes the host's `turn` leases from the ledger, and reports only a change
   * (SPEC §5.4).
   *
   * Two things can make the host busy, and both are the ledger's to state:
   *
   *  - an **open run** — a delivery the CLI was handed and has not finished;
   *  - an **open turn with no open run** — the unattended turn. Nothing at this
   *    end pushed it, so there is no delivery to carry the lease, and keying the
   *    projection on open runs alone reported the host idle while it ran a turn
   *    of the CLI's own (the merger's `phantom-run`, read the other way round).
   *    Its lease is keyed by the turn's id.
   *
   * The per-open-run leases are kept rather than collapsed into one per turn
   * because that is what the S0 criteria measure — a round arming its OWN lease is
   * how "the CLI was handed this work" is read at the moment it is written — so the
   * projection is extended where it was silent, not replaced where it spoke.
   */
  protected syncTurnLeases(state: ResidentHostState): void {
    const open = ledgerDeliveries(state.turnLedger).filter((delivery) => delivery.runOpen);
    const turn = ledgerTurn(state.turnLedger);
    const unattendedLeaseId = open.length === 0 && turn?.open === true ? turn.id : null;
    // Whether a delivery's lease is already reported is the DRIVER's fact, not
    // the ledger's (`leaseHeld` lives in `state.runtimes`): the ledger states
    // that a run is open, and the convergence below is what keeps the manager's
    // view of it from being re-announced on every frame.
    const held = (delivery: ResidentLedgerDelivery): boolean =>
      state.runtimes.get(delivery.commandUuid)?.leaseHeld === true;
    const heldRunLeases = ledgerDeliveries(state.turnLedger).filter(held);
    if (
      heldRunLeases.length === open.length
      && open.every(held)
      && state.unattendedLeaseId === unattendedLeaseId
    ) {
      return;
    }

    state.sink.leaseRemoved(state.appSessionId, 'turn');
    for (const runtime of state.runtimes.values()) {
      runtime.leaseHeld = false;
    }
    state.unattendedLeaseId = null;
    for (const delivery of open) {
      const runtime = state.runtimes.get(delivery.commandUuid);
      if (!runtime) {
        continue;
      }
      state.sink.leaseAdded(state.appSessionId, { kind: 'turn', runId: runtime.leaseId });
      runtime.leaseHeld = true;
    }
    if (unattendedLeaseId !== null) {
      state.sink.leaseAdded(state.appSessionId, { kind: 'turn', runId: unattendedLeaseId });
      state.unattendedLeaseId = unattendedLeaseId;
    }
  }

  /**
   * The reason a `cancelled` belongs to, read off what this host asked for.
   *
   * The CLI's `cancelled` does not say *why* — it is the same frame whether a
   * person withdrew a queued message or an interrupt took a running one — so the
   * reason is this side's own record of the request, computed here and handed to
   * the ledger as the event's payload (AC-395 (g): an input the transition would
   * otherwise have to reach back into the driver for). The residual (`cli`) is
   * the CLI cancelling something nobody here asked about, which is a fact worth
   * keeping rather than folding into one of the three requests.
   */
  protected cancelledReason(state: ResidentHostState, commandUuid: string): ClaudeResidentDeliveryReason {
    const delivery = ledgerDeliveryByUuid(state.turnLedger, commandUuid);
    if (delivery?.withdrawalRequested) {
      return 'withdrawn';
    }
    if (ledgerTurn(state.turnLedger)?.interruptRequested) {
      return 'interrupt';
    }
    return 'cli';
  }
}

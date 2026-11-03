/**
 * The stream layer: the CLI read loop, frame observation and the exit report.
 *
 * Extracted from `claude-host-driver.provider.ts` into the `lifecycle/` sink.
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

import { ClaudeResidentRunBase } from './resident-run.base.js';
import {
  ResidentRound
} from './resident-ledger-runtime.js';
import {
  ResidentHostState
} from './resident-host.types.js';
export abstract class ClaudeResidentStreamBase extends ClaudeResidentRunBase {
  /**
   * Dispatches one turn for one session, and answers when the turn is over.
   *
   * This is the resident counterpart to `IProviderRuntime.run`, and the
   * application dispatch awaits it for exactly the reason it awaits the
   * runtime's own promise: the websocket layer's run settles with this turn, and
   * a driver that returned as soon as the messages were written would report
   * every resident turn as instantly complete.
   *
   * The process is found or started first. A session with a live resident host is
   * one whose process is already reading stdin, so the turn is written to it —
   * that is the pid stability this mode is made of. A session without one gets a
   * process of its own, brought up on this turn's messages.
   */
  async run(
    appSessionId: string,
    turn: HostTurnInput,
    writer: ProviderRuntimeWriter,
    context: ProviderRuntimeContext,
  ): Promise<void> {
    const existing = this.liveStateFor(appSessionId);
    if (existing) {
      const round = this.createRound(appSessionId, turn, writer, context);
      // A later turn is more stdin on the stream that is already open: the
      // messages go into the queue the process has been reading since it
      // started, which is the whole of "the pid does not change".
      //
      // Busy is read *now*, before the await that builds the messages, and it
      // is read off the two things that make the process busy rather than off
      // the turn count: a round in flight, or an unattended turn the process
      // opened for itself. Either one means the frame being written is not the
      // process's next piece of work but a queue entry behind one — which is
      // the fact the tier states and the fact the criterion reads the write
      // moment against.
      const busy = existing.rounds.length > 0 || Boolean(existing.unattended);
      this.armRound(existing, round, await this.turnMessages(turn, busy), false);
      await round.done;
      return;
    }

    const round = this.createRound(appSessionId, turn, writer, context);
    const messages = await this.turnMessages(turn, false);
    const state = await this.startResidentHost(appSessionId, messages, turn, context);
    // The first round's messages are already in the queue — they seeded it before
    // the process was spawned — so this only arms the round and its lease.
    this.armRound(state, round, messages, true);
    await round.done;
  }

  /**
   * Arms the `T_int` watchdog for an interrupt request just placed.
   *
   * Re-arming replaces any pending one: a process runs one turn at a time, so a
   * second request is the same wait restarted rather than a second wait. The
   * timer is unref'd for the reason the exit backstop is — a host waiting out a
   * deadline must not be what keeps the process alive.
   */
  protected armInterruptWatchdog(state: ResidentHostState): void {
    this.stopInterruptWatchdog(state);
    const turnId = ledgerTurn(state.turnLedger)?.id ?? null;
    const timer = setTimeout(() => {
      state.interruptWatchdog = null;
      this.reportInterruptNoResult(state, turnId);
    }, this.interruptResultTimeoutMs);
    timer.unref?.();
    state.interruptWatchdog = { timer, turnId };
  }

  /**
   * Arms one round: its messages into the queue, its lease into the manager.
   *
   * `messages` are passed rather than rebuilt because the cold-start path has
   * already spent them seeding the queue before the process existed.
   */
  protected armRound(
    state: ResidentHostState,
    round: ResidentRound,
    messages: AnyRecord[],
    alreadyQueued: boolean,
  ): void {
    state.context = round.context;
    state.writer = round.writer;
    // What an unattended report needs when no round is left to ask: who to
    // report to, and what to call the session. Kept here rather than read off
    // the round at report time because by then the round is gone.
    state.lastUserId = round.writer.userId ?? null;
    const sessionName = round.turn.options?.sessionSummary;
    state.lastSessionName = typeof sessionName === 'string' ? sessionName : null;
    for (const message of messages) {
      if (typeof message?.uuid === 'string' && message.uuid) {
        state.pushedUuids.add(message.uuid);
      }
    }
    // Both readings are taken here, before the push below: `rounds` is appended
    // to at the end of this method, and the frame's tier and its write moment
    // have to be judged against the process's state as it was when the frame was
    // handed over, not after this round joined. Read once — `resultsSeenAtPush`
    // and the write moment are one statement about one moment, so they must not
    // be two reads of `state.resultTimes`.
    //
    // `busy` is the *write* reading only: whether this frame is a queue entry
    // behind a turn in flight, which is what decides its tier and whether it
    // gets a queue record. Which turn it runs in is a different question, and it
    // is answered by the ledger from the CLI's own `command_lifecycle` rather
    // than guessed at here from the count of turns that have ended.
    const busy = state.rounds.length > 0 || Boolean(state.unattended);
    const resultsSeenAtArm = state.resultTimes.length;
    if (!alreadyQueued) {
      const at = Date.now();
      for (const message of messages) {
        if (busy && typeof message?.uuid === 'string' && message.uuid) {
          state.queuedInputs.push({
            uuid: message.uuid,
            at,
            priority: typeof message.priority === 'string' ? message.priority : null,
            frame: message,
            startedAt: null,
            resultsSeenAtPush: resultsSeenAtArm,
            // Read off the turn's own `result` once it has one; the frame is
            // written strictly earlier by construction, and leaving this null
            // until then is what keeps the reading from being an assertion
            // dressed up as a measurement.
            queuedBeforeResult: null,
          });
        }
      }
      state.queue.push(...messages);
    }
    state.rounds.push(round);
    // The ledger's record of the send, and the only place a run is opened. The
    // lease is not balanced here any more: it is recomputed from the ledger, so
    // arming a run is one state change (`runOpen` going true) and one
    // projection (`syncTurnLeases`), not a manual add that a later site has to
    // remember to undo.
    this.openRun(state, round, messages);
  }

  /**
   * Reads the queue facts off one stream message.
   *
   * Three readings, and each is kept for a different reason: the lifecycle
   * list is the CLI's own account of what became of a message this host wrote,
   * the `control_response` list is what came back to a control frame (measured:
   * nothing does for `cancel_async_message` — `§9.2` — so this list exists to
   * let the criterion say so from a reading rather than from an absence), and
   * the `session_state_changed` count is the boundary check that the stream
   * says nothing about turn starts or ends (`§9.1`).
   *
   * The lifecycle event's shape is accepted in both plausible encodings — a
   * top-level `command_lifecycle` type and a `system` subtype — because §9
   * records the event's name and payload but not which envelope carried it, and
   * a parser that picked one would silently read nothing on the other. The
   * fields it needs are the same either way: `command_uuid` and `state`.
   */
  protected recordQueueFacts(state: ResidentHostState, message: AnyRecord): void {
    if (message?.type === 'system' && message.subtype === 'session_state_changed') {
      state.sessionStateChanged += 1;
    }

    if (message?.type === 'control_response') {
      const inner = message.response as AnyRecord | undefined;
      const requestId =
        typeof inner?.request_id === 'string'
          ? inner.request_id
          : typeof message.request_id === 'string'
            ? message.request_id
            : null;
      state.controlResponses.push({ at: Date.now(), requestId });
      return;
    }

    const isLifecycle =
      message?.type === 'command_lifecycle' ||
      (message?.type === 'system' && message.subtype === 'command_lifecycle');
    const commandUuid = typeof message?.command_uuid === 'string' ? message.command_uuid : null;
    const lifecycleState = typeof message?.state === 'string' ? message.state : null;
    if (!isLifecycle || !commandUuid || !lifecycleState) {
      return;
    }

    const at = Date.now();
    state.lifecycle.push({
      commandUuid,
      state: lifecycleState as CommandLifecycleState,
      at,
    });

    // The first `started` for a uuid is the dequeue moment — the point after
    // which a withdrawal can no longer succeed. A re-started uuid (there is no
    // such event today) does not move it.
    if (lifecycleState === 'started') {
      const input = state.queuedInputs.find(
        (candidate) => candidate.uuid === commandUuid && candidate.startedAt === null,
      );
      if (input) {
        input.startedAt = at;
      }
    }

    // And the same event into the ledger, which is where the command's turn is
    // decided: the CLI's own `started`/`completed`/`cancelled`, applied by id.
    // This is the only writer of a delivery's state and of a turn binding, so
    // the reading above and the reconciliation below cannot disagree — the
    // reading is what the stream said, the ledger is what it moved.
    this.applyLifecycle(state, commandUuid, lifecycleState as CommandLifecycleState, at);
  }

  /** Runs the read loop detached, with a rejection sink so nothing floats unhandled. */
  protected consume(state: ResidentHostState): void {
    this.readStream(state).catch(() => undefined);
  }

  /**
   * Reads one host's stream to its end.
   *
   * Not stopped when the manager closes the host: the close ends the *input*, and
   * the stream's own end is the fact being watched for — breaking out early would
   * drop whatever the CLI says on its way out. Continuing is safe, because the
   * sink's verbs refuse once the manager has closed the host.
   */
  protected async readStream(state: ResidentHostState): Promise<void> {
    try {
      for await (const message of state.process.query) {
        this.observe(state, message);
      }
    } catch (error) {
      state.loopError = error instanceof Error ? error : new Error(String(error));
    }
    this.reportExit(state);
  }

  /**
   * Reports a stream that ended on its own, unless the manager already closed
   * the host.
   *
   * Every round still waiting has lost its process, so each is failed rather
   * than left hanging: the dispatcher that awaits one has to be able to report a
   * run that died, and a promise that never settles is not that. `error` is the
   * closest detail the close vocabulary carries for a stream that ended by
   * itself; `oom` and `signal` are kernel facts this layer cannot see.
   */
  protected reportExit(state: ResidentHostState): void {
    if (state.closed) {
      return;
    }
    state.closed = true;
    this.stopReconcileBeat(state);
    this.stopTitleMirror(state);

    const error = state.loopError ?? new Error('The resident Claude process ended before the turn did.');
    this.endLedger(state, 'process-exit', error);
    this.abandonUnattendedTurn(state, 1);

    state.sink.exited({ hostId: state.hostId, detail: 'error' });
  }

  /**
   * Handles one frame off the process's stream, then announces what it changed.
   *
   * The pairing is the delivery state channel's one and only stream-side entry:
   * every ledger change a frame can cause — a `started` binding a command to a
   * turn, an `init` opening one, a terminal settling a delivery — happens inside
   * {@link observeFrame}, and the publication below runs after all of them. That
   * is what keeps the tick's count a fact about changes rather than about call
   * sites: this wrapper fires on every frame, and the signature comparison inside
   * `publishDeliveries` decides whether anything actually moved.
   */
  protected observe(state: ResidentHostState, message: AnyRecord): void {
    this.observeFrame(state, message);
    // The lease is the projection of the same predicate the channel publishes, so
    // it is recomputed wherever the ledger can have moved — this one entry covers
    // every frame-driven change, the terminal `command_lifecycle` above all:
    // that frame ends a delivery, which can be the last thing making the session
    // processing, and nothing else about the host changes when it does. Off the
    // flag this is still the ledger's projection (S1 made it so); the flag only
    // decides whether the ledger reaches the wire.
    this.syncTurnLeases(state);
    this.publishDeliveries(state);
    this.recordFrameWithoutTurn(state, message);
    if (message?.type === 'result') {
      // §10.1's first check point: the reconcile runs at a `RESULT` as well as on
      // the heartbeat. It is a CHECK, not a trigger — the ledger moved a moment
      // ago, so `T_q` has not elapsed and this call names nothing unless a
      // divergence was already standing when the turn ended.
      this.reconcileTick(state.appSessionId);
    }
  }
}

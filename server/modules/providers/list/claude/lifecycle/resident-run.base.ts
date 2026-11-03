/**
 * The run layer: the per-round interrupt/cancel/reconcile verbs.
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

import { ClaudeResidentTurnBase } from './resident-turn.base.js';
import {
  ClaudeResidentProcess
} from './resident-process.types.js';
import {
  ResidentRound
} from './resident-ledger-runtime.js';
import {
  readDeliverySource
} from './resident-deliveries.js';
import {
  ResidentHostState,
  transformResidentMessage
} from './resident-host.types.js';
export abstract class ClaudeResidentRunBase extends ClaudeResidentTurnBase {
  /**
   * Records an interrupt the CLI never answered (§6.3 by way of §10).
   *
   * Both halves are the reconciler's own vocabulary: the anomaly goes on the
   * ledger, so a reader after the fact finds it beside the state it is about,
   * and the `[reconcile]` line is §10.2's shape at this stage's `mode=log`
   * (§10.1) — the mode that observes and changes nothing.
   *
   * Nothing is closed here, and that is the point: synthesizing the interrupted
   * turn's ending is exactly the invention §6.3 takes away from the interrupt
   * path, and the run it would end is still the process's to finish. What the
   * line buys is that the residue is *stated* rather than silently left.
   */
  protected reportInterruptNoResult(state: ResidentHostState, turnId: string | null): void {
    const detail = turnId
      ? `turn ${turnId} got no RESULT within ${this.interruptResultTimeoutMs}ms of the interrupt request`
      : `no RESULT within ${this.interruptResultTimeoutMs}ms of the interrupt request`;
    // The record IS the line here, and that is the shape this stage leaves all
    // four ledger-side codes in: the ledger's `recordAnomaly` is the one entry
    // point, and the driver's `runLedgerEffect` turns its effect into §10.2's
    // `[reconcile]` line at the one site that knows the session and the mode. So
    // the double-`init`, the never-arrived terminal and this unanswered
    // interrupt reach the log by the same path rather than by three hand-written
    // pushes, and `mode=` is read there rather than pinned to one spelling.
    this.applyLedger(state, { kind: 'anomaly', code: 'interrupt-no-result', detail });
  }

  /**
   * Withdraws a message this host wrote, if the CLI still has it queued.
   *
   * The frame is written by hand because the SDK's `Query` has no verb for
   * `cancel_async_message` (see `ClaudeResidentProcess.writeRaw`), and the
   * verdict is read from the queue's own account rather than from a response:
   * measured at all three timings — still queued, already dequeued, uuid that
   * never existed — the CLI answers this frame with **no** `control_response`
   * at all (`§9.2`). The one thing that changes when the withdrawal worked is
   * a `state=cancelled` event for that uuid, so that is what is waited for.
   *
   * Returns `unknown` when there is no live process to write to or no raw
   * write seam on it: a driver that cannot write has not withdrawn anything,
   * and reporting `already-started` there would be claiming knowledge of a
   * queue it never reached.
   */
  async cancelQueuedInput(
    appSessionId: string,
    messageUuid: string,
  ): Promise<HostQueuedInputCancelResult> {
    const state = this.liveStateFor(appSessionId);
    if (!state || state.closed || !messageUuid) {
      return 'unknown';
    }
    const writeRaw = state.process.writeRaw;
    if (typeof writeRaw !== 'function') {
      return 'unknown';
    }

    const requestId = randomUUID();
    const frame: AnyRecord = {
      type: 'control_request',
      request_id: requestId,
      request: { subtype: 'cancel_async_message', message_uuid: messageUuid },
    };
    // Recorded before the write so the reading holds the bytes even if the
    // process dies mid-write.
    state.controlFrames.push({ at: Date.now(), requestId, frame });
    // The ledger's record of the request, written before the frame goes out: the
    // CLI's `cancelled` says a command was cancelled but never says who asked,
    // so the reason a terminal carries is this side's own mark, and a mark
    // written after the frame was on the wire could miss the answer to it.
    this.applyLedger(state, { kind: 'withdraw-request', commandUuid: messageUuid });
    writeRaw.call(state.process, frame);

    const withdrawn = await this.waitForLifecycle(state, messageUuid, 'cancelled');
    if (withdrawn) {
      this.applyLedger(state, { kind: 'withdrawn-run', commandUuid: messageUuid });
      return 'withdrawn';
    }
    // No `cancelled`, so the message was not withdrawn. It is only
    // `already-started` if the CLI actually dequeued it; a uuid this process
    // never queued is `unknown`, which is a different answer and stays one.
    const dequeued = state.lifecycle.some(
      (event) => event.commandUuid === messageUuid && event.state === 'started',
    );
    return dequeued ? 'already-started' : 'unknown';
  }

  /**
   * Forwards one event to the ledger, does what the ledger asked for, and runs
   * the fixed tail (AC-395 (e), (g)).
   *
   * This is the driver's WHOLE relationship with the ledger: it never reads a
   * field of it into a write, and it never carries a per-transition copy of the
   * lease sync or the delivery publish. Four things happen, in this order, and
   * the order is the contract:
   *
   *  1. the ledger applies the event and answers `{changed, effects}`;
   *  2. every effect is executed — the awaited and the timed work the ledger
   *     deliberately cannot do (writing a run's terminal frame, opening the
   *     turn's run through the host layer, settling a dispatcher, logging);
   *  3. the `turn` lease is re-projected from the ledger;
   *  4. the delivery channel is republished (which is a no-op unless the
   *     ledger's own signature of the snapshot moved).
   *
   * Steps 3 and 4 run for EVERY event rather than being an effect some
   * transitions remember to ask for: a transition that forgot its lease sync
   * would be a stuck `Working…`, which is the whole class of defect the ledger
   * exists to remove.
   */
  protected applyLedger(
    state: ResidentHostState,
    event: ResidentLedgerEvent,
    runEnd: { readonly failWith: Error | null } = { failWith: null },
  ): ResidentLedgerEffect[] {
    const transition = applyLedgerEvent(state.turnLedger, event);
    for (const effect of transition.effects) {
      this.runLedgerEffect(state, effect, runEnd);
    }
    this.syncTurnLeases(state);
    this.publishDeliveries(state);
    // The tail's two log-facing readings, both taken from the transition rather
    // than from a re-derivation: `changed` is what §10.1's `T_q` counts down
    // from, and the state each delivery and turn is now in is what §10.2's lines
    // state. Taken here because this is the one place every ledger move passes
    // through (I6) — a site that emitted its own line would be a second account
    // of the same fact.
    if (transition.changed) {
      state.ledgerChangedAt = this.now();
    }
    this.emitLedgerLines(state);
    return [...transition.effects];
  }

  /**
   * Records one accepted send in the ledger and opens its run.
   *
   * The identity is the CLI's: the uuids are the ones the frames were written
   * under, and `commandUuid` is the one the CLI will name them by — the last
   * frame, which carries the prompt (an attachment-carrying turn writes the
   * blocks first and the text last). Every uuid is indexed so a lifecycle event
   * finds this delivery whichever frame it names.
   */
  protected openRun(state: ResidentHostState, round: ResidentRound, messages: AnyRecord[]): void {
    const uuids = messages
      .map((message) => (typeof message?.uuid === 'string' ? message.uuid : null))
      .filter((uuid): uuid is string => uuid !== null && uuid.length > 0);
    const commandUuid = uuids.at(-1) ?? randomUUID();
    // The tier read off the frame that was actually written, not recomputed from
    // the turn's options: `turnMessages` is what decides a busy write's effective
    // tier (its caller's, or the default queue tier), and a ledger that formed
    // its own answer could disagree with the bytes the CLI received.
    const written = messages.at(-1);
    const priority = typeof written?.priority === 'string' ? written.priority : null;
    // The driver's own half is registered FIRST, because the uniform tail the
    // transition runs afterwards (the lease projection above all) reads it: the
    // lease a delivery holds is keyed by this record's `leaseId`.
    state.runtimes.set(commandUuid, {
      round,
      leaseId: `turn-${++this.serial}`,
      leaseHeld: false,
    });
    // Who asked, as the dispatch stated it. The option key is the websocket
    // dispatch's own (written only on the run=turn path), and an option bag that
    // does not carry it — every caller that predates the state channel, and every
    // criterion that drives this driver directly — answers `user`, which is the
    // shape of the one path that reaches a resident process today.
    this.applyLedger(state, {
      kind: 'send',
      at: this.now(),
      commandUuid,
      uuids,
      text: round.turn.command,
      source: readDeliverySource(round.turn.options),
      priority,
    });
  }

  /**
   * Ends every open run and turn the ledger is carrying, for a host going away.
   *
   * The process is gone (or the manager closed the host, or the session that
   * asked for the turn detached), so no `RESULT` and no `command_lifecycle` is
   * coming: what is left is to say so. Every run still open is ended here — by
   * failing it when the stream died under it, which is how the dispatcher learns
   * its run did not finish, and by settling it when the host is being closed
   * deliberately — and every command still without a terminal is written
   * `cancelled(process-exit)`, which is the honest name for "the process that
   * was going to answer went away". An open turn reads `aborted` for the same
   * reason: it never reached a `RESULT`.
   */
  protected endLedger(
    state: ResidentHostState,
    reason: ClaudeResidentDeliveryReason,
    failure: Error | null,
  ): void {
    // A host that is ending will not answer an interrupt either: the turn it was
    // waiting on is closed here as `aborted` (below), which is the honest name
    // for it, so a watchdog outliving this call could only restate it wrongly.
    this.stopInterruptWatchdog(state);
    // Every run still open is closed by the transition's own effects, and each
    // one learns there through `failWith` whether the stream died under it or the
    // host is being wound down deliberately: the ledger states that a run ended,
    // the dispatcher's promise is the driver's to fail or settle. Nothing is
    // announced on a writer — the stream that would carry the terminal frame is
    // the thing that just went away, and the Registry is told nothing it could act
    // on (`announced: false`).
    this.applyLedger(state, { kind: 'process-exit', at: this.now(), reason }, { failWith: failure });
    state.rounds.splice(0);
  }

  /**
   * Applies one `command_lifecycle` event to the ledger.
   *
   * `queued` and `started` are statements about a command this host pushed; a
   * uuid nothing here has a record for can only be the CLI's own (a cron
   * firing), so it is noted as foreign and otherwise left alone.
   *
   * `started` is also where a command's turn is decided, and the rule is the
   * CLI's own (C-2): a command started while a turn is open is folded into it;
   * one started while no turn is open belongs to the turn that opens next, so it
   * waits in `pendingStart` for that turn's `init`. Nothing is read from how
   * many turns have ended — an id bound here is an id, not an offset.
   */
  protected applyLifecycle(
    state: ResidentHostState,
    commandUuid: string,
    lifecycleState: CommandLifecycleState,
    at: number,
  ): void {
    // The one thing the transition cannot read for itself: which request this
    // host made, so a `cancelled` the CLI states without saying why gets the
    // reason this side recorded (AC-395 (g)).
    this.applyLedger(state, {
      kind: 'lifecycle',
      at,
      commandUuid,
      lifecycle: lifecycleState,
      cancelledReason: this.cancelledReason(state, commandUuid),
    });
  }

  /**
   * Opens the ledger's turn for one `system/init`, if that is what this is.
   *
   * Everything the frame decides — the I4 boundary it is read at, the
   * double-`init` anomaly when a turn is already open, the turn it mints and the
   * commands it binds — is one transition in the ledger
   * (`{ kind: 'turn-init' }`), and the run binding arrives back as an effect.
   */
  protected openTurnAtInit(state: ResidentHostState, message: AnyRecord): void {
    if (message?.type !== 'system' || message.subtype !== 'init') {
      return;
    }
    this.applyLedger(state, {
      kind: 'turn-init',
      at: this.now(),
      initFrameUuid: String(message.uuid ?? ''),
    });
  }

  /**
   * Closes the open turn at its `RESULT`, settling the runs it covered.
   *
   * The runs are the deliveries bound to this turn — a folded command is bound
   * by its `started` (C-2), and a cold opener by the `init` that announced it.
   * Nothing is closed by position, so a command the CLI drains into a *later*
   * turn (`pendingStart`, or simply not started yet) keeps its run: it never
   * became part of this turn.
   *
   * A `RESULT` with no open turn is still the CLI saying a turn just ended — the
   * announcement of that turn's `init` is a frame this build may not have read
   * (a scripted stream, or a stream that began mid-turn) — so the turn is opened
   * and closed at once around the commands waiting for it rather than dropped on
   * the floor. The outcome is read from the one place it is stated: `is_error`
   * on this message, together with whether this host asked for the interrupt
   * (C-5, §6.3).
   */
  protected closeTurn(state: ResidentHostState, result: AnyRecord): void {
    // One transition closes the turn and every run bound to it — the same
    // transition the unattended path reaches (`closeLedgerTurnOnly`), so the two
    // paths state the same terminal for the same ending (AC-395 (c)).
    this.applyLedger(state, { kind: 'turn-result', at: this.now(), isError: result?.is_error === true });
    // A run that closed here is no longer owed its turn's ending, but it may
    // still be owed the CLI's terminal for its own command (C-3) — that is what
    // `owed` carries, and the next boundary's `owed-boundary` is what settles it.
  }

  /**
   * Records the §5.2 anomaly for a turn-bearing frame that arrived with no turn
   * open, and does nothing else about it.
   *
   * §5.2: "助手 / 工具等帧 … 无 turn 时记异常 `frame-without-turn`，沿用最近
   * writer". The frame is still forwarded (the routing below this call is
   * unchanged); what is added is the record, because a frame that belongs to no
   * turn is the shape that says the ledger and the stream have parted company.
   *
   * `assistant` and `user` are the two turn-bearing types: an assistant message
   * is the turn's own output, and a `user` message on this stream is the tool
   * result coming back into it. Everything else the loop reads — `system`,
   * `result`, `command_lifecycle`, the control frames — is either a turn's own
   * boundary (which is how a turn opens and closes, so requiring one to be open
   * would be circular) or not a turn's frame at all.
   *
   * Recorded through the ledger's ONE anomaly entry point, so the line it
   * produces is §10.2's shape by construction rather than by a second push here.
   */
  protected recordFrameWithoutTurn(state: ResidentHostState, message: AnyRecord): void {
    if (message?.parent_tool_use_id) {
      // Subagent (Task) traffic is relayed into the parent's stream-json with
      // `parent_tool_use_id`, and it arrives between the parent's turns by
      // construction: it belongs to the subagent, not to a turn this ledger
      // opened. "No turn open" therefore says nothing about the ledger and the
      // stream having parted company — recording it would drown the real
      // divergence in normal traffic. The forwarding path already excludes
      // these frames from the prompt echo (`isSubagentPromptEcho`); this is the
      // anomaly record's half of the same rule. Snake_case because this call
      // reads the raw stream frame, before `transformResidentMessage` maps it.
      return;
    }
    const type = typeof message?.type === 'string' ? message.type : '';
    if (type !== 'assistant' && type !== 'user') {
      return;
    }
    if (ledgerTurn(state.turnLedger)?.open === true) {
      return;
    }
    this.applyLedger(state, {
      kind: 'anomaly',
      code: 'frame-without-turn',
      detail: `${type} frame ${String(message.uuid ?? '-')} arrived with no turn open`,
    });
  }

  /**
   * Closes the ledger's open turn for an ending somebody else already handled.
   *
   * The unattended turn's run is ended by `finishUnattendedTurn`, which owns its
   * frame and its notification; what is left for the ledger is the turn record
   * itself, so a reader after the fact sees the same two facts the delivered
   * path leaves: the turn is shut, and its outcome is the one the CLI stated.
   */
  protected closeLedgerTurnOnly(state: ResidentHostState, result: AnyRecord): void {
    // Nothing open to close: the delivered path's transition would mint and close
    // a turn of its own here, which is right for a `RESULT` nobody announced and
    // wrong for this one — `finishUnattendedTurn` has already reported the turn
    // this ending belongs to, and an invented second one would be a record of a
    // turn that never ran.
    if (ledgerTurn(state.turnLedger)?.open !== true) {
      return;
    }
    // The SAME transition the delivered path takes. It differs here only in what
    // it finds open — an unattended turn has no delivery for a `run-closed`
    // effect to name, so this call produces none — and in what the driver has
    // already done around it (`finishUnattendedTurn` owns that turn's run). The
    // closed-turn record is therefore byte-identical across the two paths, which
    // is the property the criterion reads.
    this.applyLedger(state, { kind: 'turn-result', at: this.now(), isError: result?.is_error === true });
  }
}

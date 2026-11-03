/**
 * The turn/ledger layer: the transitions that open, bind and close turns and deliveries.
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

import { ClaudeResidentReadingsBase } from './resident-readings.base.js';
import {
  ClaudeResidentReconcileReading,
  startResidentReconcileBeat
} from './resident-ledger-runtime.js';
import {
  ResidentHostState
} from './resident-host.types.js';
export abstract class ClaudeResidentTurnBase extends ClaudeResidentReadingsBase {
  /**
   * Opens this session's own resident process, with no turn behind it.
   *
   * The entry the on-demand [Start] control needs, and the one this driver's
   * absence made unreachable: a fresh resident session cannot be placed through
   * `bindSession` (this driver declares `multiplexedHost = false`, so any live
   * claude host refuses the second conversation) and cannot be placed through
   * `openHost` either (`startHost` throws when there is no process, and a resident
   * process is brought up by `run`). This is that launch with the turn left out.
   *
   * It reuses {@link startResidentHost} rather than growing a second launch path:
   * the Remote Control gate, the model resolution, the ledger, the `Stop` hook,
   * the permission scope, the spawn and the `openHost` are all turn-independent,
   * and the only thing a cold start does differently is seed the input queue with
   * nothing. The host is therefore left holding one binding, no round and no
   * writer — `idle` with the resident policy's quiet ceiling armed, which is
   * exactly what "started, nothing asked of it yet" should read as. Every read of
   * `state.writer`/`state.context` is null-safe (they are only ever dereferenced
   * through `?.` or a round that armed them), which is what makes a host with no
   * round safe to leave running.
   *
   * Idempotent by the same rule the route applies: a session that already has a
   * live host answers with that host, so a second start is a success that spawns
   * nothing.
   */
  async startResidentSession(
    appSessionId: string,
    launch: HostResidentLaunch,
  ): Promise<HostResidentStartResult> {
    const existing = this.liveStateFor(appSessionId);
    if (existing) {
      return { hostId: existing.hostId, pid: existing.pid };
    }

    // No messages and no command: the queue is what the process reads from, and
    // an empty one is a process that is up and waiting rather than one that has
    // been given work. `options` is the caller's assembled bag (see
    // `HostResidentLaunch`) — this file never reads a session row to build one.
    const state = await this.startResidentHost(
      appSessionId,
      [],
      { command: '', options: launch.options },
      launch.context,
    );

    return { hostId: state.hostId, pid: state.pid };
  }

  /**
   * Stops one named background task the resident process is running.
   *
   * This is the SDK's own `Query.stopTask`, not an interrupt: the turn in flight
   * keeps running, the process keeps running, and only the named task is asked to
   * end. The confirmation is not here — the SDK answers a stop of an id it does
   * not hold silently, so "the task really stopped" is a fact the task table
   * learns from the `task_notification(stopped)` frame, never from this call's
   * return.
   *
   * Returns `true` when the live process was really asked, and `false` when this
   * session has no live resident process or its query exposes no stop verb. A
   * `false` is "cannot place the request", never "the task stopped".
   */
  async stopTask(appSessionId: string, taskId: string): Promise<boolean> {
    const state = this.liveStateFor(appSessionId);
    const stop = state?.process.query.stopTask;
    if (!state || typeof stop !== 'function') {
      return false;
    }
    await stop.call(state.process.query, taskId);
    return true;
  }

  /**
   * Promotes one named *foreground* tool the resident process is running to a
   * background task.
   *
   * This is the SDK's own `Query.backgroundTasks`, not an interrupt and not a
   * stop: the turn in flight keeps running, the process keeps running, and the
   * named foreground tool is detached so the turn may continue past it. The verb
   * is called with the `toolUseId` always supplied — the no-argument form the SDK
   * also accepts (background *everything*) is deliberately never reached, so a
   * caller cannot background tools it did not name.
   *
   * The SDK's boolean is returned as-is: `true` when the live process agreed the
   * id was a foreground tool it has now backgrounded, `false` when this session
   * has no live resident process, its query exposes no `backgroundTasks` verb, or
   * the process held no matching foreground tool. A `false` is "there was no
   * matching foreground tool to place on", never a claim one was backgrounded.
   * Whether the task subsequently appears in the task table is the reducer's
   * business — it is driven by the `task_started` +
   * `task_updated{is_backgrounded:true}` frames the CLI emits, never by this
   * call's return.
   */
  async background(appSessionId: string, toolUseId: string): Promise<boolean> {
    const state = this.liveStateFor(appSessionId);
    const background = state?.process.query.backgroundTasks;
    if (!state || typeof background !== 'function') {
      return false;
    }
    return (await background.call(state.process.query, toolUseId)) === true;
  }

  /**
   * Arms this host's reconcile beat (§10.1's second check point).
   *
   * The beat is the host's own, not a client's: it is armed when the host starts
   * and runs for as long as the host is live, so a phantom run is read even when
   * nobody has a browser subscribed. That independence is the whole fix — the
   * defect this exists to close was a check point that only existed on a
   * per-socket heartbeat, i.e. only while somebody was watching.
   *
   * Each tick asks {@link reconcileTick} for THIS host's session. The callback
   * re-reads `state.closed` because a beat can be in flight while the host is
   * being torn down; the stop below is the ordering that makes that rare, and
   * the guard keeps a beat that already fired from reading a dead host.
   */
  protected armReconcileBeat(state: ResidentHostState): void {
    state.reconcileBeat?.stop();
    state.reconcileBeat = startResidentReconcileBeat(this.reconcileBeatMs, () => {
      if (state.closed) {
        return;
      }
      this.reconcileTick(state.appSessionId);
    });
  }

  /**
   * Thin delegation to the shipped `reconcileTick` handler; see
   * `claude-resident-lifecycle-outcome-handlers.ts`. The lookup stays here
   * because "no live host" is the driver's own conservative null, not a handler
   * answer.
   */
  reconcileTick(appSessionId: string): ClaudeResidentReconcileReading | null {
    const state = this.liveStateFor(appSessionId);
    if (!state) {
      return null;
    }
    return this.dispatchLifecycle<ClaudeResidentReconcileReading>('reconcileTick', state, { appSessionId });
  }

  /**
   * Does the driver's half of one ledger effect.
   *
   * Each case is the work the ledger's answer names and cannot perform itself:
   * it knows a run ended, not which writer its terminal frame goes to; it knows
   * a turn opened, not how the host layer mints a run. Nothing here writes the
   * ledger — the effect is the ledger's own statement about work that is the
   * driver's to do.
   */
  protected runLedgerEffect(
    state: ResidentHostState,
    effect: ResidentLedgerEffect,
    runEnd: { readonly failWith: Error | null },
  ): void {
    switch (effect.kind) {
      case 'delivery-opened':
      case 'turn-opened':
        // Records, not actions. The ledger's own state is already written, and
        // the channel statement is the tail's job.
        break;
      case 'anomaly': {
        // EVERY ledger anomaly becomes §10.2's `[reconcile]` line here, and this
        // is the only place one is written: the ledger's `recordAnomaly` is the
        // single entry point for the double-`init`, the never-arrived terminal
        // and the unanswered interrupt (§10.1), so the three of them cannot
        // drift into three shapes of the same fact — nor can a fourth code be
        // added without appearing in the log, which is what this stage is for.
        this.writeReconcileLine(state, effect.code, effect.detail);
        break;
      }
      case 'bind-turn-run': {
        this.bindTurnRun(state, ledgerTurn(state.turnLedger), [...effect.deliveryIds]);
        break;
      }
      case 'run-closed': {
        if (effect.ending === 'turn-result') {
          this.closeRun(state, effect.deliveryId, state.providerSessionId);
        } else if (effect.ending === 'withdrawn') {
          this.endWithdrawnRun(state, effect.deliveryId);
        } else {
          this.endRunSilently(state, effect.deliveryId, runEnd.failWith);
        }
        break;
      }
      case 'turn-closed': {
        // The turn that held the frame routing is over. Run=turn clears it here so
        // the next turn's frames are never attributed to this run by default: the
        // frames that follow belong to whatever opens next (a new turn's run, or
        // an unattended turn's, which `observe` prefers while it is open), and
        // leaving a stale writer here would send an unattended turn's text into
        // the run of a turn that has already ended.
        //
        // Closing the turn also closes the run that turn minted — the invariant
        // this branch, rather than `closeRun`, is the only place that can state.
        // `closeRun` reaches the run through the DELIVERY's runtime, so a
        // delivery whose runtime never carried the turn's writer (a withdrawal
        // wrote on the round's writer, a host ending wrote nothing at all) would
        // leave the registry's run `running` forever while the ledger already
        // reads `turn.phase=idle`, `turn.runId=null` — the ghost of the
        // 2026-10-17 defect. The per-delivery leg and this one are the same
        // writer whenever the former works; the registry keeps only the FIRST
        // terminal for a run (`decorateAndRecordEvent` drops every later one), so
        // on the ordinary path this frame is that dropped duplicate and no client
        // sees a second ending.
        const turnRun = residentRunIsTurn() ? state.turnRun : null;
        if (turnRun) {
          turnRun.writer.send(
            createCompleteMessage({
              provider: this.provider,
              sessionId: state.providerSessionId || state.appSessionId,
              exitCode: 0,
              aborted: effect.outcome === 'aborted',
            }),
          );
        }
        state.turnRun = null;
        break;
      }
    }
  }

  /**
   * Closes one run: its turn has ended, so its dispatcher is settled here.
   *
   * The driver's half of the ledger's `run-closed` effect. The ledger has already
   * written `runOpen = false` and the `owed` cross-check C-3 requires — this
   * method is the work it cannot do: the terminal frame, the round-end report and
   * the settlement, in the order the existing contract needs them.
   *
   * The terminal frame is written first, because it is what flips the run in the
   * registry and a frame written after the settle would race the dispatch's own
   * safety net. The round is settled second, which resolves the dispatcher's
   * await.
   *
   * `owed` is not an error — a folded command's `completed` arrives *before* its
   * turn's `RESULT`, and a first command's arrives after it, so both orders are
   * normal.
   */
  protected closeRun(
    state: ResidentHostState,
    deliveryId: string,
    providerSessionId: string | null,
  ): void {
    const runtime = state.runtimes.get(deliveryId);
    if (!runtime) {
      return;
    }
    const aborted = runtime.round.interrupted;
    // Run=turn: the run is the TURN, so its terminal frame goes to the turn's run
    // writer when the host layer gave this delivery one. A run's
    // exactly-one-complete contract is unaffected: a turn with several deliveries
    // writes its `complete` once per delivery through the SAME run writer, and
    // the registry drops every terminal event after the first
    // (`decorateAndRecordEvent`), which is the same rule it applies to a runtime
    // that completes twice on its own.
    const terminalWriter =
      residentRunIsTurn() && runtime.turnWriter ? runtime.turnWriter : runtime.round.writer;
    terminalWriter.send(
      createCompleteMessage({
        provider: 'claude',
        sessionId: providerSessionId || runtime.round.appSessionId || null,
        exitCode: 0,
        aborted,
      }),
    );
    this.reportRoundEnd(runtime.round, aborted ? 'aborted' : 'completed', providerSessionId);
    runtime.round.settle();

    this.dropRound(state, runtime.round);
  }

  /**
   * Ends one run with nobody to tell: the process is gone, so the ending is the
   * dispatcher's promise and nothing else.
   *
   * The `announced: false` half of the ledger's `run-closed` effect — the host is
   * going away, so there is no writer left to state a terminal through and the
   * only thing that can still be wrong is a dispatch awaiting a promise that will
   * never resolve. A stream that died under the run fails it (`failure`); a host
   * being closed deliberately settles it, because nothing went wrong there.
   */
  protected endRunSilently(state: ResidentHostState, deliveryId: string, failure: Error | null): void {
    const runtime = state.runtimes.get(deliveryId);
    if (!runtime) {
      return;
    }
    if (failure) {
      runtime.round.fail(failure);
    } else {
      runtime.round.settle();
    }
    this.dropRound(state, runtime.round);
  }
}

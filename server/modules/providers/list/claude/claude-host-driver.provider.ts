/**
 * Claude's resident host driver: one CLI process held across turns, behind
 * `IProvider.hostDriver`, which is what makes `lifecycle_mode = 'resident'` a
 * process the user keeps rather than one they restart on every message.
 *
 * ## What one resident host is
 *
 * One SDK query whose prompt iterable never finishes. `submit` does not build a
 * query — it writes the turn's messages into the input queue the process has
 * been reading since it started, which is the whole of "the pid does not
 * change": a second turn is more stdin on the stream that has been open all
 * along. The queue is closed only when the host is, and closing it is stdin EOF,
 * which is the CLI's own graceful exit path. `closeHost` is that and nothing
 * else; the query's own `close` is a backstop for a CLI that does not take the
 * hint (see `CLAUDE_RESIDENT_EXIT_GRACE_MS`).
 *
 * ## Turn boundaries
 *
 * A turn ends at its `result`, exactly as the runtime's own read loop reads it
 * (`claude-runtime.provider.js`), and each round submitted expects one —
 * including an interrupted round, which is why the runtime checks its abort flag
 * at `result` time rather than at the interrupt. So rounds are a FIFO: `submit`
 * appends, a `result` shifts, and the shifted round's own `run` promise settles.
 * That promise is the one the dispatch awaits, so it resolves when the turn
 * really ended — an interrupt asks for the ending, it does not stand in for one.
 * The interrupted round stays in the queue as a tombstone until then, so its
 * `result` is consumed by the turn it belongs to instead of being mistaken for a
 * later turn's; and the terminal `complete` — `aborted` for that round — is
 * written at that same moment, before the round settles, so the run the dispatch
 * is watching is already completed by the time its own safety net runs.
 *
 * ## What it reports, and what it never decides
 *
 * Leases, through the sink `openHost` hands over: `turn` while a round is in
 * flight (dropped at its own `result`), `resident-policy` — the mode's
 * statement that the process is meant to sit between turns — and the held-work
 * reasons the CLI's own `Stop` hook reports (`cron` for each `session_crons`
 * entry, `background-task` for each `background_tasks` one), reconciled by id so
 * a firing that changes nothing reports nothing. `resident-policy` is the
 * manager's whole reading of "resident": with it an otherwise empty binding
 * derives `idle` and arms the mode's quiet ceiling, where a per-run host would
 * have closed; the held-work leases are the reading that overrides it — the
 * manager defers the idle close while an unexpired `cron` lease is held, and
 * re-counts the window from that lease's own `expiresAt`. Nothing here decides a
 * close: the resident policy is
 * `supersedeOnNewTurn: false`, so a new turn on a bound session is written to
 * the process that is already there, and the host ends only when the manager
 * says so (a quiet ceiling, the close route, a shutdown).
 *
 * Unlike the per-run driver, this one does emit frames: `HostTurnInput` carries
 * no writer, so a resident turn's writer and runtime context arrive through this
 * class's own `run` entry, which the application dispatch calls. What it does
 * *not* emit is the runtime's interactive half — permission prompts, the
 * notification hook and MCP config loading live in `claude-runtime.provider.js`
 * and are deliberately not duplicated here; a resident turn's tool approvals are
 * therefore resolved by the permission mode alone. That is a known boundary of
 * the mode, not an oversight, and it is why the criterion drives turns whose
 * permission mode needs no prompt.
 *
 * ## Why a fresh start asks for a host rather than a binding
 *
 * `openHost`, not `bindSession`. A session's first resident turn needs the
 * manager to open a process *for that session*, and the manager's `bindSession`
 * is a different question — "which live process can take this conversation" —
 * whose answer for a driver that does not multiplex is a refusal. `openHost`
 * also takes the pid, and the manager accepts a pid only at open time, which is
 * why `run` brings the process up *before* asking for the host record: the
 * record is opened knowing the real pid rather than backfilling it later.
 *
 * The same launch is reachable with no turn at all, through
 * {@link ClaudeResidentHostDriver.startResidentSession}: a user asking for the
 * process before sending anything is asking for the state `run` would have
 * produced, and the only thing missing is the messages. Both entries share one
 * launch path, so "started by the button" and "started by the first turn" cannot
 * come up under different gates or different options.
 *
 * Consumed by `ClaudeProvider`, which mounts it as `IProvider.hostDriver`, and by
 * the criterion in `tests/claude-resident-process.test.ts`, which drives it
 * against the real `claude` binary.
 */
import { spawn as nodeSpawn } from 'node:child_process';
import { randomUUID } from 'node:crypto';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import type { Writable } from 'node:stream';
import { fileURLToPath } from 'node:url';

import { query } from '@anthropic-ai/claude-agent-sdk';
import type { SpawnOptions as SdkSpawnOptions, SpawnedProcess } from '@anthropic-ai/claude-agent-sdk';

import {
  ClaudePerRunHostDriver,
  type ClaudeBackgroundWorkEvent,
} from '@/modules/providers/list/claude/claude-per-run-host-driver.provider.js';
import {
  type ClaudeResidentLifecycleOutcomeContext,
  type ClaudeResidentLifecycleOutcomeName,
  type ClaudeResidentLifecycleOutcomePayload,
  type ClaudeResidentLifecycleOutcomeRegistry,
} from '@/modules/providers/list/claude/claude-resident-lifecycle-outcome-registry.js';
import { createDefaultClaudeResidentLifecycleOutcomeRegistry } from '@/modules/providers/list/claude/claude-resident-lifecycle-outcome-handlers.js';
import {
  type ClaudeResidentOutcomeContext,
  type ClaudeResidentOutcomeName,
  type ClaudeResidentOutcomeRegistry,
} from '@/modules/providers/list/claude/claude-resident-outcome-registry.js';
import { createDefaultClaudeResidentOutcomeRegistry } from '@/modules/providers/list/claude/claude-resident-outcome-handlers.js';
import { createNotificationEvent, notifyUserIfEnabled } from '@/modules/notifications/index.js';
import {
  TOOLS_REQUIRING_INTERACTION,
  buildPromptMessages,
  extractCumulativeTokenBudget,
  extractTokenBudget,
  forwardNormalizedFrames,
  mapCliOptionsToSDK,
  notifyActivityChange,
  requestClientToolDecision,
  resolveClaudeSessionTitle,
} from '@/modules/providers/list/claude/claude-runtime.provider.js';
import { resolveModelContextWindowRow } from '@/modules/providers/services/model-launch-spec.service.js';
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
// The Live Voice rules seam is a shared PORT (see the `UserPromptSubmit` block
// below): this module reads whatever the voice-realtime barrel installed, so no
// import of that module — static or dynamic — appears in this file.
import { readVoiceRulesPort } from '@/shared/ports/voice-rules.port.js';
// The ledger is a LEAF module now (AC-396): this driver reaches it only through
// the barrel, and the barrel only re-exports what this file and the ledger's own
// criterion import. No deep path into `modules/resident-ledger/**` appears here,
// which is what keeps the driver's cycle membership from being re-tied to the
// ledger's internals.
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
// `residentRunIsTurn` is the shared evaluation leaf: the websocket registry
// reads the same one, and neither side imports the other (the edge would close
// the cycle this file header states), so the predicate lives in `@/shared/utils.js`
// where both can reach it. See its own comment there for the cycle and the
// call-time-read constraint.
import {
  ClaudeSessionOccupiedError,
  createCompleteMessage,
  createNormalizedMessage,
  findBackgroundSessionOwner,
  residentRunIsTurn,
  resolveClaudeConfigDir,
} from '@/shared/utils.js';
import {
  CLAUDE_CANCEL_VERDICT_POLL_MS,
  CLAUDE_CANCEL_VERDICT_WAIT_MS,
  CLAUDE_QUEUED_INPUT_PRIORITY,
  CLAUDE_RESIDENT_EXIT_GRACE_MS,
  CLAUDE_RESIDENT_INTERRUPT_RESULT_TIMEOUT_MS,
  CLAUDE_RESIDENT_RECONCILE_MODE,
  CLAUDE_TURN_PRIORITY_OPTION,
  CRON_MAX_AGE_MS,
  ClaudeBusyInputReading,
  ClaudePermissionAnswer,
  ClaudePermissionDecision,
  ClaudePermissionEntry,
  ClaudePermissionReading,
  ClaudePermissionScope,
  ClaudeResidentHostPort,
  ClaudeResidentPermissions,
  ClaudeResidentProcess,
  ClaudeResidentProcessFactory,
  ClaudeResidentProcessSeams,
  ClaudeResidentQuery,
  ClaudeResidentReconcileMode,
  ClaudeResidentRunStoppedEvent,
  RESIDENT_PERMISSION_MODE,
  buildNotificationEvent,
  readRequestedPriority,
  unattendedRefusalMessage,
} from './lifecycle/resident-process.types.js';
import {
  CLAUDE_REMOTE_CONTROL_FLAGS,
  CLAUDE_RESIDENT_IDENTITY_BUDGET_MS,
  CLAUDE_RESIDENT_IDENTITY_POLL_MS,
  CLAUDE_USER_SETTINGS_FILE,
  ClaudeRemoteControlFlags,
  ClaudeRemoteControlRefusal,
  ClaudeRemoteControlRefusalError,
  readClaudeUserSettings,
  readCliSessionRegistration,
  readLaunchedRemoteControlSettings,
  remoteControlRefusalMessage,
} from './lifecycle/resident-settings.js';
import {
  BackgroundTaskLease,
  ClaudeResidentLifecycleReading,
  ClaudeUnattendedReading,
  ClaudeUnattendedWorkEvent,
  CronLease,
  deriveBackgroundWorkTrigger,
} from './lifecycle/resident-turn.types.js';
import {
  CLAUDE_RESIDENT_QUIESCE_MS,
  CLAUDE_RESIDENT_RECONCILE_BEAT_MS,
  ClaudeResidentLedgerReading,
  ClaudeResidentProcessHandle,
  ClaudeResidentReconcileReading,
  ClaudeResidentRunRegistryPort,
  NO_RESIDENT_RUN_REGISTRY,
  RESIDENT_RECONCILED_REASON,
  ResidentDeliveryRuntime,
  ResidentRound,
  createBackgroundWorkLedger,
  createResidentInputQueue,
  spawnResidentCli,
  startResidentReconcileBeat,
} from './lifecycle/resident-ledger-runtime.js';
import {
  ClaudeResidentSessionRegistries,
  deliveryChannelSignature,
  lookupDelivery,
  projectDeliveries,
  readDeliverySource,
  residentSessionRegistries,
} from './lifecycle/resident-deliveries.js';
import {
  CLAUDE_RESIDENT_TITLE_MIRROR_POLL_MS,
  CLAUDE_RESIDENT_TITLE_MIRROR_WINDOW_MS,
  ClaudeResidentProcessingReading,
  PendingHost,
  ResidentHostState,
  StopHookSink,
  stopResidentTurn,
  transformResidentMessage,
} from './lifecycle/resident-host.types.js';
import {
  buildResidentSdkOptions,
} from './lifecycle/resident-launch.js';

/**
 * The `system` subtypes this driver's read loop reads for held work.
 *
 * Everything else the CLI puts on the stream is forwarded untouched and read by
 * nobody here, which is the property the loop has to have: the CLI emits
 * subtypes this build has never seen (`task_updated`, `control_request_progress`,
 * and `scheduled_task_fire`, which E9 never observed but the binary carries), and
 * a loop that only advances on a closed vocabulary stops the moment the CLI
 * learns a new word. The set is the loop's own reading vocabulary, not a claim
 * about the CLI's — a subtype absent from it is recorded
 * ({@link ClaudeResidentLifecycleReading.unhandledSystemSubtypes}) and passed
 * through, never treated as an error.
 */
const HELD_WORK_SYSTEM_SUBTYPES = new Set([
  'init',
  'task_started',
  'task_notification',
  'background_tasks_changed',
]);

/**
 * The file this driver was defined in.
 *
 * The mirror of `HANDLERS_SOURCE` in `claude-resident-outcome-handlers.ts`: a
 * criterion compares a registered handler's `source` with this value to show the
 * handler came from outside the driver rather than from here. Read off the
 * module's own URL so both sides survive the compiled layout (where each ends in
 * `.js`) without either hard-coding a checkout location.
 */
export const CLAUDE_RESIDENT_HOST_DRIVER_SOURCE = fileURLToPath(import.meta.url);

export type ClaudeResidentHostDriverOptions = {
  host: ClaudeResidentHostPort;
  /** Background-work completion, forwarded to the per-run driver this one composes. */
  notifyBackgroundWork: (event: ClaudeBackgroundWorkEvent) => void;
  /**
   * Background work reported by a turn the process opened by itself.
   *
   * A separate verb from `notifyBackgroundWork` because the two carry different
   * facts, not because they are different notifications: the per-run report has
   * no trigger to give (its turn arrived as a request, so there is nothing to
   * reconcile) and this one always does. Both reach the same notification in
   * production; a host that composes this driver names where each goes.
   */
  notifyUnattendedWork: (event: ClaudeUnattendedWorkEvent) => void;
  /** Called once per completed round, mirroring the runtime's own stop notification. */
  notifyRunStopped: (event: ClaudeResidentRunStoppedEvent) => void;
  /** Process seam; defaults to the real SDK with the pid capture installed. */
  createProcess?: ClaudeResidentProcessFactory;
  /**
   * How many browsers are connected right now; defaults to none.
   *
   * Taken as a port rather than imported because the connection registry lives in
   * the websocket module, which imports this one, so an edge from here would
   * close a cycle — the gap the file header states and the structural reading in
   * `claude-resident-unattended-turn.test.ts` holds this file to (zero imports of
   * `modules/websocket`). The composition root, the one place both modules are in
   * scope, installs it over the registry's own set.
   *
   * The default is `() => 0` — nobody — because that is the answer that refuses:
   * a host that cannot reach the registry must not conclude that a person is
   * watching. It is also why the other half of the same test has to stand on its
   * own; see {@link ClaudeResidentHostDriver.isUnattended}.
   */
  connectedClientCount?: () => number;
  /**
   * Delivers one permission notification to the session's user.
   *
   * The same delivery the per-run path uses (`notifyUserIfEnabled`, through the
   * notifications barrel), taken as a seam because a resident host's notification
   * has no connection to be addressed through: the event is the notification
   * layer's own record and the user is the one the last round carried. A
   * criterion substitutes its own to read *that* a notification was made, which
   * is otherwise only observable as a channel side effect.
   */
  notifyUser?: (delivery: { userId: string | number | null; event: AnyRecord }) => void;
  /**
   * The instant a held-work reason is dated from, defaults to the wall clock.
   *
   * The only thing this driver puts a *date* on is a cron's `expiresAt` (the
   * CLI names no instant; see {@link CRON_MAX_AGE_MS}), and that date decides
   * when the manager stops deferring the idle close. Taking it as an option is
   * what lets a criterion reach the seven-day expiry without waiting it out —
   * and it is injected alongside the manager's own `now` so both layers read one
   * clock rather than two.
   */
  now?: () => number;
  /**
   * How long an interrupt request waits for the CLI's own `RESULT` before the
   * host records `interrupt-no-result`; defaults to
   * {@link CLAUDE_RESIDENT_INTERRUPT_RESULT_TIMEOUT_MS}.
   *
   * A seam for the same reason the other waits here are: a criterion has to
   * reach the deadline without spending five seconds of wall clock on it, and
   * the reading it takes is the anomaly line rather than the wait.
   */
  interruptResultTimeoutMs?: number;
  /**
   * Which arm of §10.1 this host runs; defaults to
   * {@link CLAUDE_RESIDENT_RECONCILE_MODE} (`log`, the shipped one).
   *
   * A seam rather than a module-level switch because the two arms have to be
   * comparable inside one run: the criterion drives the same injected divergence
   * through a `log` host and an `enforce` host and reads that the first changed
   * nothing and the second closed the run.
   */
  reconcileMode?: ClaudeResidentReconcileMode;
  /**
   * How long the ledger may stand still before a registry run reads as phantom;
   * defaults to {@link CLAUDE_RESIDENT_QUIESCE_MS}.
   *
   * A seam for the reason every wait here is one: a criterion has to reach `T_q`
   * without spending ten seconds of wall clock on it, and what it reads across
   * the deadline is the anomaly line rather than the wait.
   */
  quiesceMs?: number;
  /**
   * How often this driver's own per-host reconcile beat runs; defaults to
   * {@link CLAUDE_RESIDENT_RECONCILE_BEAT_MS} (5 s).
   *
   * A seam for the same reason the other waits here are: a criterion has to
   * watch several beats inside a test budget, and what it reads across them is
   * the `[reconcile]` line or the close rather than the wait.
   *
   * `0` (or any non-positive value) arms no beat, which is the disabled arm a
   * criterion uses as the false form for "the beat exists". Production never
   * passes it — a host that cannot beat is exactly the defect this option's
   * default closes.
   */
  reconcileBeatMs?: number;
  /**
   * The run registry, as read and acted on; see
   * {@link ClaudeResidentRunRegistryPort}.
   *
   * Defaults to {@link NO_RESIDENT_RUN_REGISTRY} — "nothing is running" — which
   * is the answer that refuses to act, for the same reason
   * `connectedClientCount`'s default refuses to conclude somebody is watching.
   */
  runRegistry?: ClaudeResidentRunRegistryPort;
  /**
   * Where §10.2's `[ledger]` / `[turn]` lines go; defaults to nothing.
   *
   * A SINK, not `console.log`, because these lines are per-turn traffic: a host
   * that printed them itself would put a line on stdout for every delivery
   * state, in every resident session, forever. The reconcile lines keep their
   * own stdout channel (§10.2 is the operator's reading of an anomaly, and the
   * existing AC-380 criterion reads them there) — this sink is an *additional*
   * channel for them, which is how a criterion observes all three line families
   * without capturing the global console.
   */
  logSink?: (line: string) => void;
  /**
   * The user-level settings file the Remote Control gate reads, when it is not
   * the one the process will run under.
   *
   * Defaults to `<CLAUDE_CONFIG_DIR>/settings.json` resolved *at launch time*,
   * which is the only file whose answer decides what the child is launched with
   * — so production never sets this. It is a seam for the same reason the
   * filesystem is normally reached through one: a criterion has to be able to
   * drive the gate against a temp directory, and to express the mutant where the
   * gate reads something other than the settings the process runs under (see the
   * Remote Control section above).
   */
  userSettingsPath?: string;
  /**
   * The reading registry this driver dispatches through.
   *
   * Defaults to {@link createDefaultClaudeResidentOutcomeRegistry} — the shipped
   * handlers beside this file, which is the production set. It is a seam because
   * the criterion has to register a probe handler from its own file and observe
   * the driver call it (handler source path ≠ this file), and because replacing
   * the registry must not require touching the driver.
   *
   * Optional, like every other seam here: a caller that does not name one gets
   * the shipped registry, so existing constructor call sites are unchanged.
   */
  outcomes?: ClaudeResidentOutcomeRegistry;
  /**
   * The lifecycle-outcome registry this driver dispatches through.
   *
   * The second extension point: run/turn endings, the reconcile reaction,
   * held-work reconciliation, the `[ledger]` writers and the title mirror are
   * handlers beside this file (see
   * {@link createDefaultClaudeResidentLifecycleOutcomeRegistry}), and this
   * option is how a criterion registers a probe from its own path and observes
   * the driver dispatch to it. Optional, like every other seam: omitting it
   * gives the shipped registry, so existing constructor call sites are
   * unchanged.
   */
  lifecycleOutcomes?: ClaudeResidentLifecycleOutcomeRegistry;
};

/**
 * The SDK entry point one resident launch goes through.
 *
 * `query` is a module-level function — the per-run driver's `ClaudeHostQueryFactory`
 * states the same problem for the same reason — so there is no seam to stub and
 * no module-mocking precedent in this repository. A caller that wants to *read*
 * the options a launch is built with hands in its own, and that is the only way
 * the reading can come from the production path rather than from a second copy
 * of it: the option bag is built by {@link buildResidentSdkOptions}, handed
 * straight to this, and the default is the SDK.
 */
export type ClaudeResidentQueryFactory = (input: {
  prompt: AsyncIterable<AnyRecord>;
  options: AnyRecord;
}) => ClaudeResidentQuery;

/** The real SDK, at the one boundary where its wide type meets this module's narrow one. */
const sdkResidentQuery: ClaudeResidentQueryFactory = (input) =>
  query(input as unknown as Parameters<typeof query>[0]) as unknown as ClaudeResidentQuery;

export function createSdkResidentProcess(
  input: {
    prompt: AsyncIterable<AnyRecord>;
    options: AnyRecord;
    seams?: ClaudeResidentProcessSeams;
    permissions?: ClaudeResidentPermissions;
    remoteControlFlags?: ClaudeRemoteControlFlags;
  },
  launchSeams: { createQuery?: ClaudeResidentQueryFactory } = {},
): ClaudeResidentProcess {
  const sdkOptions = buildResidentSdkOptions(input, mapCliOptionsToSDK);
  const installedSpawn = sdkOptions.spawnClaudeCodeProcess as
    | ((options: SdkSpawnOptions) => SpawnedProcess)
    | undefined;
  let pid: number | null = null;
  let stdin: Writable | null = null;

  // The `Stop` hook, appended to whatever `hooks` the launch builder produced —
  // the same way the spawn hook below wraps whatever hook it found — so nothing
  // the builder set is replaced. The callback returns an empty object, which is
  // the hook contract's "no decision": a hook that answered anything else here
  // would change the turn it is only supposed to be read from.
  //
  // The write goes through a record view because `hooks` is not part of the
  // builder's declared return; it is still the same object that is handed to
  // `query`, which reads `hooks` off it at runtime like any other option.
  const launchOptions = sdkOptions as unknown as Record<string, unknown>;

  // Raw CLI flags, carried through from the caller's option bag.
  //
  // The shared launch builder maps options field by field and has no passthrough
  // for `extraArgs`, which is deliberate: it is the builder every per-run turn
  // goes through, and a per-run turn has no launch-time address to state. The
  // resident factory is where that gap belongs, because it is the factory that
  // owns what a *resident* process is launched with — so the flag is copied here
  // rather than taught to the shared builder.
  const extraArgs = (input.options as AnyRecord)?.extraArgs;
  if (extraArgs && typeof extraArgs === 'object') {
    launchOptions.extraArgs = extraArgs;
  }

  const onStop = input.seams?.onStop;
  if (onStop) {
    const installedHooks = (launchOptions.hooks ?? {}) as Record<string, unknown>;
    const installedStop = Array.isArray(installedHooks.Stop) ? installedHooks.Stop : [];
    launchOptions.hooks = {
      ...installedHooks,
      Stop: [
        ...installedStop,
        {
          hooks: [
            async (hookInput: AnyRecord) => {
              onStop(hookInput);
              return {};
            },
          ],
        },
      ],
    };
  }

  // THE LIVE VOICE RULES HOOK — a `UserPromptSubmit` CALLBACK appended to the SDK's `hooks` bag, the
  // same way the `Stop` callback above is: a spread of what was already there, never a replacement.
  //
  // WHY A CALLBACK AND NOT A COMMAND IN `settings`. The `hooks` option bag is the SDK's IN-PROCESS
  // channel: `query()` walks each matcher's `hooks` array, registers every entry under a generated
  // `hookCallbackId`, and later INVOKES it — so an entry has to be a callback function. A
  // `{ type: 'command', command }` object put there is never run: handed to the CLI's callback dispatch
  // as a callee, it reports `Error in hook callback hook_0: … n is not a function` while the command
  // never fires (measured). The command form is the CLI's SETTINGS schema, and that is exactly what
  // this replaces — a command in the settings layer runs in a SEPARATE PROCESS, so every prompt
  // spawned a node process purely to decide whether to print seven lines.
  //
  // GATED BY THE RELAY'S OWN STATE, NOT BY A FILE. The callback asks the process-level registry
  // (`voice-realtime-active.ts`) whether THIS session has a Live Voice connection at this instant. The
  // relay marks a session as a connection is handled and clears it on every path that ends one, so "in
  // voice" is a fact about live memory rather than about a file a killed relay could leave behind —
  // which is what the start-up sweep the file gate needed was papering over. A session with no
  // connection returns `{}`, the hook contract's "no decision", and reads byte-for-byte as it did
  // before this hook existed.
  //
  // WHY THIS READS A PORT INSTEAD OF IMPORTING THE VOICE MODULE. A static import of the
  // voice-realtime barrel from this module closes an initialization cycle —
  // `voice-realtime/index` → `voice-realtime-live-executor` → `mcp-gateway/index` → `providers/index`
  // → `provider.registry` → this file — and the module that closes it throws
  // `ReferenceError: Cannot access 'ClaudeResidentHostDriver' before initialization` before the server
  // can start at all (measured). The previous fix moved the same edge inside the submit callback as a
  // dynamic `import()`, which avoided the start-up TDZ but left the dependency in place: the
  // voice-realtime module and this one still constrained each other's initialization. The port removes
  // the edge outright. `voice-realtime/index.ts` installs `isVoiceSessionActive` / `rulesFor` into
  // `@/shared/ports/voice-rules.port.js` while it evaluates, and `server/index.ts` names the same
  // installation in the composition root; this callback reads what was installed. The shared port
  // imports nothing, so it cannot close a loop of its own.
  //
  // A process that never loads the voice-realtime barrel (a focused resident-launch criterion) reads
  // null, which is treated exactly like an inactive session: `{}`, the hook contract's "no decision".
  // That is the same reading the callback had before any connection was marked.
  //
  // THE TWO EXPERIMENTAL SWITCHES STAY. `VOICE_MODE_HOOK_FORCE=1` injects regardless of the registry and
  // `VOICE_MODE_RULES_VARIANT` selects the rules arm; both are read HERE, at submit time, so a launch's
  // arm is a property of the environment the process runs under.
  const launchHooks = (launchOptions.hooks ?? {}) as Record<string, unknown>;
  const installedUserPromptSubmit = Array.isArray(launchHooks.UserPromptSubmit)
    ? launchHooks.UserPromptSubmit
    : [];
  launchOptions.hooks = {
    ...launchHooks,
    UserPromptSubmit: [
      ...installedUserPromptSubmit,
      {
        hooks: [
          async (hookInput: AnyRecord): Promise<AnyRecord> => {
            const voiceRules = readVoiceRulesPort();
            const sessionId = typeof hookInput.session_id === 'string' ? hookInput.session_id : '';
            const forced = process.env.VOICE_MODE_HOOK_FORCE === '1';
            if (voiceRules === null) {
              return {};
            }
            if (!forced && !voiceRules.isSessionActive(sessionId)) {
              return {};
            }
            return {
              hookSpecificOutput: {
                hookEventName: 'UserPromptSubmit',
                additionalContext: voiceRules.rulesFor(process.env.VOICE_MODE_RULES_VARIANT),
              },
            };
          },
        ],
      },
    ],
  };

  sdkOptions.spawnClaudeCodeProcess = (spawnOptions: SdkSpawnOptions): SpawnedProcess => {
    const child = installedSpawn
      ? (installedSpawn(spawnOptions) as ClaudeResidentProcessHandle)
      : spawnResidentCli(spawnOptions);
    if (typeof child?.pid === 'number') {
      pid = child.pid;
    }
    // The stdin the SDK writes its own prompt messages to. Kept because a
    // control frame the SDK's `Query` has no verb for has to be written to the
    // same stream by hand (see `ClaudeResidentProcess.writeRaw`). Both writers
    // go through one `Writable`, which preserves write order and writes each
    // chunk whole — a JSON line is far inside the pipe's atomic-write bound.
    if (child?.stdin) {
      stdin = child.stdin;
    }
    return child;
  };

  const stream = (launchSeams.createQuery ?? sdkResidentQuery)({
    prompt: input.prompt,
    options: sdkOptions,
  });

  return {
    query: stream,
    get pid() {
      return pid;
    },
    writeRaw(frame: AnyRecord): void {
      if (!stdin || stdin.destroyed) {
        return;
      }
      stdin.write(`${JSON.stringify(frame)}\n`);
    },
    // Read off the bag that was just handed to `query`, not off the request: the
    // point of reporting it is that it is the SDK's copy of the fact rather than
    // the driver's, and the two are only the same number when the launch really
    // stated what it was asked to state.
    launchSettings: readLaunchedRemoteControlSettings(sdkOptions.settings),
  };
}

/**
 * Publishes one session's delivery reading and announces a real change.
 *
 * Called from the driver's own ledger-mutating sites through
 * `ClaudeResidentHostDriver.publishDeliveries`; it registers into the
 * process-wide {@link residentSessionRegistries} instance the driver also holds.
 * The tick is `notifyActivityChange`, which is the *existing*
 * `setActivityChangeNotifier` seam the composition root installs — the same one a
 * task or schedule change already uses — so there is one announcement path, not a
 * second one built beside it.
 */
export function publishSessionDeliveries(
  sessionId: string,
  reading: () => DeliveryEntry[],
  signature: string,
): void {
  if (residentSessionRegistries.registerDeliveries(sessionId, reading, signature)) {
    notifyActivityChange(sessionId);
  }
}

export class ClaudeResidentHostDriver implements IProviderHostDriver {
  private readonly provider: LLMProvider = 'claude';
  /**
   * One conversation per process. Stated rather than left absent because the
   * manager reads this as `=== true`, and because it is the reason a second
   * resident session gets its own process instead of a second binding.
   */
  readonly multiplexedHost = false;
  private readonly host: ClaudeResidentHostPort;
  private readonly notifyRunStopped: (event: ClaudeResidentRunStoppedEvent) => void;
  private readonly notifyUnattendedWork: (event: ClaudeUnattendedWorkEvent) => void;
  private readonly createProcess: ClaudeResidentProcessFactory;
  /** The instant a held-work reason is dated from; see {@link ClaudeResidentHostDriverOptions.now}. */
  private readonly now: () => number;
  /**
   * How long an interrupt waits for its `RESULT`; see
   * {@link ClaudeResidentHostDriverOptions.interruptResultTimeoutMs}.
   */
  private readonly interruptResultTimeoutMs: number;
  /** Which arm of §10.1 this host runs; see {@link ClaudeResidentHostDriverOptions.reconcileMode}. */
  private readonly reconcileMode: ClaudeResidentReconcileMode;
  /** `T_q` — the standing-still grace; see {@link ClaudeResidentHostDriverOptions.quiesceMs}. */
  private readonly quiesceMs: number;
  /** How often each host's own reconcile beat runs; see {@link ClaudeResidentHostDriverOptions.reconcileBeatMs}. */
  private readonly reconcileBeatMs: number;
  /** The run registry as read and acted on; see {@link ClaudeResidentHostDriverOptions.runRegistry}. */
  private readonly runRegistry: ClaudeResidentRunRegistryPort;
  /** Where §10.2's `[ledger]` / `[turn]` lines go; see {@link ClaudeResidentHostDriverOptions.logSink}. */
  private readonly logSink: (line: string) => void;
  /** How many browsers are connected; see {@link ClaudeResidentHostDriverOptions.connectedClientCount}. */
  private readonly connectedClientCount: () => number;
  /** Where a permission notification goes; see {@link ClaudeResidentHostDriverOptions.notifyUser}. */
  private readonly notifyUser: (delivery: { userId: string | number | null; event: AnyRecord }) => void;
  /**
   * The user-level settings file the gate reads; null means "resolve it at
   * launch time from the config directory the process will run under".
   */
  private readonly userSettingsPath: string | null;
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
  private readonly refusals = new Map<string, ClaudeRemoteControlRefusal>();
  /**
   * The per-run facet, composed rather than replaced.
   *
   * The provider mounts exactly one `hostDriver`, so whoever holds the slot
   * serves every mode its capabilities declare — and `claude` declares both. A
   * `per-run` host opened by anyone (the criterion in `claude-host-per-run.test.ts`
   * is one) must still have working verbs, and the file that already implements
   * them owns the per-run process rules; reimplementing them here would be a
   * second copy to keep in step. Nothing on the per-run *dispatch* path goes
   * through a host driver at all — the manager's default wrapper owns it — so
   * this is about the facet being complete, not about per-run turn routing.
   */
  private readonly perRun: ClaudePerRunHostDriver;
  /** The live state per host. */
  private readonly hosts = new Map<string, ResidentHostState>();
  /**
   * The per-session readings this driver publishes through.
   *
   * The process-wide instance ({@link residentSessionRegistries}) the exported
   * readers in this module share — the readings belong to the server rather
   * than to one host, so this is ownership of the same object, not a cache per
   * driver. `publishDeliveries` installs the session's delivery, turn-run,
   * by-id and `processing` readings here.
   */
  private readonly registries: ClaudeResidentSessionRegistries;
  /**
   * The reading registry every reading method dispatches through.
   *
   * The extension point this file grew so that adding a reading is a handler
   * beside it rather than another method in it. Defaults to the shipped
   * registry; see {@link ClaudeResidentHostDriverOptions.outcomes}.
   */
  private readonly outcomes: ClaudeResidentOutcomeRegistry;
  /**
   * The view of host state a handler sees — the two maps the readings read.
   *
   * Built once, holding references to the live `hosts`/`refusals` maps, so a
   * handler reads current state without the driver copying anything per call.
   */
  private readonly outcomeContext: ClaudeResidentOutcomeContext;
  /**
   * The lifecycle-outcome registry every reaction method dispatches through.
   *
   * The second extension point: the write/react half of the driver is a handler
   * beside this file rather than another method in it. Defaults to the shipped
   * registry; see {@link ClaudeResidentHostDriverOptions.lifecycleOutcomes}.
   */
  private readonly lifecycle: ClaudeResidentLifecycleOutcomeRegistry;
  /**
   * The seams a lifecycle handler may reach — the injected ports and constants
   * the moved bodies used, never this driver.
   *
   * The host state a reaction mutates is passed to the handler as an argument;
   * this view exists so a handler cannot close over a driver private.
   */
  private readonly lifecycleContext: ClaudeResidentLifecycleOutcomeContext;
  /** What the next `startHost` should adopt, since `openHost` decides the host id. */
  private pending: PendingHost | null = null;
  /** Counted turn ids: one per armed round, so a reading of the lease is repeatable. */
  private serial = 0;

  constructor(options: ClaudeResidentHostDriverOptions) {
    this.host = options.host;
    this.notifyRunStopped = options.notifyRunStopped;
    this.notifyUnattendedWork = options.notifyUnattendedWork;
    this.createProcess = options.createProcess ?? createSdkResidentProcess;
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
    this.outcomes = options.outcomes ?? createDefaultClaudeResidentOutcomeRegistry();
    this.outcomeContext = { hosts: this.hosts, refusals: this.refusals };
    this.lifecycle = options.lifecycleOutcomes ?? createDefaultClaudeResidentLifecycleOutcomeRegistry();
    this.lifecycleContext = {
      provider: this.provider,
      now: this.now,
      logSink: this.logSink,
      notifyUnattendedWork: this.notifyUnattendedWork,
      reconcileMode: this.reconcileMode,
      quiesceMs: this.quiesceMs,
      runRegistry: this.runRegistry,
      cronMaxAgeMs: CRON_MAX_AGE_MS,
      reconciledReason: RESIDENT_RECONCILED_REASON,
      readCliSessionRegistration,
      identityBudgetMs: CLAUDE_RESIDENT_IDENTITY_BUDGET_MS,
      identityPollMs: CLAUDE_RESIDENT_IDENTITY_POLL_MS,
      titleMirrorWindowMs: CLAUDE_RESIDENT_TITLE_MIRROR_WINDOW_MS,
      titleMirrorPollMs: CLAUDE_RESIDENT_TITLE_MIRROR_POLL_MS,
    };
    this.perRun = new ClaudePerRunHostDriver({
      host: options.host,
      notify: options.notifyBackgroundWork,
    });
  }

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
   * Remembers the sink this host reports through, and adopts the process `run`
   * brought up for it.
   *
   * `startHost` is reached from `openHost`, after the record exists and before
   * the first binding is written, which is the one moment the manager and the
   * driver can be introduced. The process itself is already running: the manager
   * takes a pid only at open time, so a driver that wanted its record to carry
   * one has to have the child in hand before it asks for the host (see the file
   * header).
   */
  async startHost(host: ProcessHost, sink: IProviderHostDriverSink): Promise<ProcessHost> {
    if (host.mode !== 'resident') {
      return this.perRun.startHost(host, sink);
    }

    const pending = this.pending;
    this.pending = null;
    if (!pending) {
      throw new Error(
        `Resident host ${host.hostId} was opened without a process; a resident host is started by the driver's run entry.`,
      );
    }

    // The launch's Remote Control facts, onto the live record.
    //
    // Written here because this is the one moment the driver holds the record
    // itself: `run` gets a copy back from `openHost`, and `snapshot()` hands out
    // copies, so a value written anywhere else would never be visible to a
    // reader. `pid` is the manager's own field and is written the same way, for
    // the same reason.
    host.remoteControl = pending.remoteControl;

    this.hosts.set(host.hostId, {
      hostId: host.hostId,
      appSessionId: host.bindings.keys().next().value as string,
      sink,
      queue: pending.queue,
      process: pending.process,
      turnLedger: createResidentLedger(),
      runtimes: new Map<string, ResidentDeliveryRuntime>(),
      rounds: [],
      context: null,
      writer: null,
      pushedUuids: new Set<string>(),
      ledger: pending.ledger,
      heldCrons: [],
      heldBackgroundTasks: [],
      cronsAuthoritative: false,
      tasksAuthoritative: false,
      unhandledSystemSubtypes: [],
      lastUserId: null,
      lastSessionName: null,
      permissions: pending.permissions,
      unattended: null,
      lastUnattendedCommandUuid: null,
      turnRun: null,
      unattendedLeaseId: null,
      initTools: [],
      backgroundTaskType: null,
      queuedInputs: [],
      lifecycle: [],
      controlFrames: [],
      controlResponses: [],
      resultTimes: [],
      sessionStateChanged: 0,
      providerSessionId: null,
      pid: pending.pid,
      configDir: pending.configDir,
      projectPath: pending.projectPath,
      titleMirror: { lastSeen: null, mirrored: null, timer: null, open: false, openedForTurn: false },
      identityReadbackStarted: false,
      reportedIdentity: null,
      launchedTitle: pending.launchedTitle,
      resumed: false,
      sessionCreatedSent: false,
      assistantBudgetSent: false,
      modelContextWindow: pending.modelContextWindow,
      interruptWatchdog: null,
      ledgerChangedAt: this.now(),
      loggedDeliveryStates: new Map<string, string>(),
      loggedOpenTurnId: null,
      reportedPhantomRuns: new Set<string>(),
      reconcileBeat: null,
      closed: false,
      loopError: null,
    });

    // The host is live from here: arm §10.1's heartbeat check point on its own
    // server-side beat. It belongs to the host's lifetime rather than to any
    // client's subscription — the per-socket activity heartbeat is not a
    // reconcile trigger (it only exists while somebody is watching).
    const state = this.hosts.get(host.hostId);
    if (state) {
      this.armReconcileBeat(state);
    }
    // The hook could have fired while the record was being opened — the process
    // is already reading stdin by then. Adoption is what makes those firings
    // reconcilable, so they are replayed here in the order they arrived rather
    // than left in the buffer forever.
    pending.stopHook.state = state ?? null;
    // The permission scope is the third thing this adoption is for: the entries
    // installed before the spawn have been able to refuse into their own log
    // since the CLI first spoke, and from here they can see the rounds and the
    // writer that decide whether there is anybody to ask.
    pending.permissions.state = state ?? null;
    if (state) {
      for (const input of pending.stopHook.buffered.splice(0)) {
        this.reconcileHeldWork(state, input);
      }
    }

    return host;
  }

  /** Records which session this host serves. One binding per resident host. */
  async bind(host: ProcessHost, binding: SessionBinding): Promise<void> {
    if (host.mode !== 'resident') {
      return this.perRun.bind(host, binding);
    }

    const state = this.hosts.get(host.hostId);
    if (state) {
      state.appSessionId = binding.appSessionId;
    }
  }

  /**
   * Delivers one turn with no client-facing writer.
   *
   * A resident turn's frames belong to the run that dispatched it, and a run's
   * writer arrives through this class's own `run` entry — `HostTurnInput` is the
   * command and its options and nothing else. So a call that reaches a resident
   * host here has no writer to send frames to, and writing the turn anyway would
   * run it blind: the CLI would take the turn and no client would ever see it.
   * Refusing and naming the entry that can serve it is the honest answer; for a
   * per-run host the sibling driver's rule applies instead.
   */
  async submit(host: ProcessHost, appSessionId: string, turn: HostTurnInput): Promise<void> {
    if (host.mode !== 'resident') {
      return this.perRun.submit(host, appSessionId, turn);
    }

    throw new Error(
      `A resident turn needs the writer and runtime context its frames belong to; dispatch it through this driver's run entry instead of submit.`,
    );
  }

  /**
   * Asks the CLI to stop the turn in flight, leaving the process up.
   *
   * This is the whole of what abort means in resident mode: the SDK's own
   * interrupt, which does not end the process. Nothing else is done here — the
   * ledger is not changed, no terminal is synthesized, and no lease is taken
   * away, because the CLI is the only thing that knows whether the interrupted
   * command actually stopped.
   *
   * C-5 is the measured reason: an interrupt stops the command that is running
   * and nothing else, and what follows is stated by the CLI — the in-flight
   * command is `cancelled`, the turn ends with an `is_error` `RESULT`, and a
   * queued command carries on in a new turn. Writing any of that here would be
   * this side inventing an ending, and it is what left a stale round and an open
   * turn behind when the CLI had already moved on.
   *
   * The two marks it does leave are the run's own (its terminal frame has to say
   * `aborted`) and the turn's request flag (the `RESULT` that follows reads
   * `aborted` from `is_error ∧ interruptRequested`, §5.2). The request goes out
   * before its answer can be read, so the flag is set first.
   *
   * What it adds to the request is a deadline rather than a state: the `RESULT`
   * is the CLI's to send, and one that never arrives would leave this round
   * indistinguishable from a turn still being worked on. The `T_int` watchdog
   * states that case in the reconciler's own vocabulary rather than acting on it
   * — see {@link reportInterruptNoResult}.
   */
  async interrupt(host: ProcessHost, appSessionId: string): Promise<boolean> {
    if (host.mode !== 'resident') {
      return this.perRun.interrupt(host, appSessionId);
    }

    const state = this.hosts.get(host.hostId);
    const round = state?.rounds[0];
    if (!state || !round || round.appSessionId !== appSessionId) {
      return false;
    }

    round.interrupted = true;
    // The ledger's whole part of an interrupt: the request is marked, and
    // nothing else moves (C-5). The state the abort produces is stated by the
    // `cancelled` and the `RESULT` that follow, never synthesized here.
    this.applyLedger(state, { kind: 'interrupt-request' });
    await stopResidentTurn(state.process.query);
    this.armInterruptWatchdog(state);
    return true;
  }

  /**
   * Arms the `T_int` watchdog for an interrupt request just placed.
   *
   * Re-arming replaces any pending one: a process runs one turn at a time, so a
   * second request is the same wait restarted rather than a second wait. The
   * timer is unref'd for the reason the exit backstop is — a host waiting out a
   * deadline must not be what keeps the process alive.
   */
  private armInterruptWatchdog(state: ResidentHostState): void {
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
   * Cancels the pending `T_int` watchdog, if one is armed.
   *
   * Called at the two moments the wait stops being a wait: the `RESULT` that
   * answers the request, and every path that ends the host — the same moments
   * {@link stopTitleMirror} is called at, for the same reason.
   */
  private stopInterruptWatchdog(state: ResidentHostState): void {
    if (state.interruptWatchdog) {
      clearTimeout(state.interruptWatchdog.timer);
      state.interruptWatchdog = null;
    }
  }

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
  private reportInterruptNoResult(state: ResidentHostState, turnId: string | null): void {
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
  private armReconcileBeat(state: ResidentHostState): void {
    state.reconcileBeat?.stop();
    state.reconcileBeat = startResidentReconcileBeat(this.reconcileBeatMs, () => {
      if (state.closed) {
        return;
      }
      this.reconcileTick(state.appSessionId);
    });
  }

  /** Stops this host's reconcile beat. Idempotent; called on every close path. */
  private stopReconcileBeat(state: ResidentHostState): void {
    state.reconcileBeat?.stop();
    state.reconcileBeat = null;
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
   * Applies a live setting change where the SDK has a verb for it, and defers
   * everything else to the next turn.
   *
   * A resident process is the mode's reason to have a live surface at all, so the
   * two settings the SDK can change under a running turn are applied here:
   * `setModel` and `setPermissionMode`. Effort is a launch argument — it is
   * folded into the SDK options' env and effort flags when the process starts —
   * so a patch that names one is answered `next-turn` rather than claimed as
   * live. A verb the SDK build does not have is answered the same way, and the
   * answer is never `live` on faith: only a call that returned without throwing
   * is reported as applied.
   */
  async reconfigure(
    host: ProcessHost,
    appSessionId: string,
    patch: HostReconfigurePatch,
  ): Promise<'live' | 'next-turn'> {
    if (host.mode !== 'resident') {
      return this.perRun.reconfigure();
    }

    const state = this.hosts.get(host.hostId);
    if (!state || state.closed) {
      return 'next-turn';
    }

    let applied = false;
    if (typeof patch.model === 'string' && typeof state.process.query.setModel === 'function') {
      try {
        await state.process.query.setModel(patch.model);
        applied = true;
      } catch {
        // The verb is there but the process refused it; the next turn's options
        // carry the model again, so nothing is lost by deferring.
      }
    }
    if (
      typeof patch.permissionMode === 'string' &&
      typeof state.process.query.setPermissionMode === 'function'
    ) {
      try {
        await state.process.query.setPermissionMode(patch.permissionMode);
        // Only after the call returned: the host's own account of the mode is
        // what a later reading reports, and writing it before the process took
        // it would publish a mode the CLI may not be in. Nothing else moves it
        // — a switch is the one way the launch mode changes, and it does not
        // touch the process (see `RESIDENT_PERMISSION_MODE`).
        state.permissions.mode = patch.permissionMode;
        applied = true;
      } catch {
        // As above.
      }
    }

    return applied ? 'live' : 'next-turn';
  }

  /**
   * Detaches one session from the host.
   *
   * A resident host serves one conversation, so the detach is followed by the
   * manager's own close (a host with no bindings left is closed under the same
   * reason) and ending the process is that close's job, not this verb's. What
   * this does is settle whatever run was in flight: the session that asked for
   * it is gone, so nobody is waiting for its answer any more.
   */
  async unbind(host: ProcessHost, appSessionId: string, reason: HostCloseReason): Promise<void> {
    if (host.mode !== 'resident') {
      return this.perRun.unbind(host, appSessionId);
    }

    const state = this.hosts.get(host.hostId);
    if (!state) {
      return;
    }

    this.endLedger(state, 'process-exit', null);
  }

  /**
   * Ends the host: stdin EOF first, the query's own close only as a backstop.
   *
   * The graceful path is the input queue's `end`, which the SDK turns into stdin
   * EOF and the CLI answers by winding down. The `close` that follows is not a
   * second attempt at the same thing — it is the SDK's transport teardown, the
   * one that escalates to SIGTERM and SIGKILL — and it is deliberately late
   * enough ({@link CLAUDE_RESIDENT_EXIT_GRACE_MS}) that an exit observed inside
   * an ordinary assertion window is the EOF's doing rather than this. It is
   * unref'd so a host held at shutdown cannot keep the server's event loop alive.
   */
  async closeHost(host: ProcessHost, reason: HostCloseReason): Promise<void> {
    if (host.mode !== 'resident') {
      return this.perRun.closeHost(host, reason);
    }

    const state = this.hosts.get(host.hostId);
    this.hosts.delete(host.hostId);
    if (!state) {
      return;
    }
    // The beat's lifetime is the host's: stop it even when `reportExit` already
    // marked the state closed, so a timer cannot outlive the map entry that owns
    // it either way.
    this.stopReconcileBeat(state);
    if (state.closed) {
      return;
    }
    state.closed = true;
    this.stopTitleMirror(state);

    // Every run still waiting has lost the process that was going to answer it;
    // the close is that answer, and an unattended turn still open loses the same
    // thing — its `result` — so its run is ended here rather than left open.
    this.endLedger(state, 'process-exit', null);
    this.abandonUnattendedTurn(state, 1);

    state.queue.end();
    const backstop = setTimeout(() => {
      try {
        state.process.query.close?.();
      } catch {
        // The process is on its way out either way.
      }
    }, CLAUDE_RESIDENT_EXIT_GRACE_MS);
    backstop.unref?.();
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

  /** Thin delegation to the shipped `dropRound` handler; see `claude-resident-lifecycle-outcome-handlers.ts`. */
  private dropRound(state: ResidentHostState, round: ResidentRound): void {
    this.dispatchLifecycle('dropRound', state, { round });
  }

  /** Thin delegation to the shipped `endWithdrawnRun` handler; see `claude-resident-lifecycle-outcome-handlers.ts`. */
  private endWithdrawnRun(state: ResidentHostState, deliveryId: string): void {
    this.dispatchLifecycle('endWithdrawnRun', state, { deliveryId });
  }

  /** Thin delegation to the shipped `settleCrons` handler; see `claude-resident-lifecycle-outcome-handlers.ts`. */
  private settleCrons(state: ResidentHostState, desired: CronLease[]): void {
    this.dispatchLifecycle('settleCrons', state, { desired });
  }

  /** Thin delegation to the shipped `settleBackgroundTasks` handler; see `claude-resident-lifecycle-outcome-handlers.ts`. */
  private settleBackgroundTasks(state: ResidentHostState, desired: BackgroundTaskLease[]): void {
    this.dispatchLifecycle('settleBackgroundTasks', state, { desired });
  }

  /** Thin delegation to the shipped `reconcileHeldWork` handler; see `claude-resident-lifecycle-outcome-handlers.ts`. */
  private reconcileHeldWork(state: ResidentHostState, input: AnyRecord): void {
    this.dispatchLifecycle('reconcileHeldWork', state, { input });
  }

  /** Thin delegation to the shipped `observeHeldWorkEvent` handler; see `claude-resident-lifecycle-outcome-handlers.ts`. */
  private observeHeldWorkEvent(state: ResidentHostState, message: AnyRecord): void {
    this.dispatchLifecycle('observeHeldWorkEvent', state, { message });
  }

  /** Thin delegation to the shipped `inferHeldWork` handler; see `claude-resident-lifecycle-outcome-handlers.ts`. */
  private inferHeldWork(state: ResidentHostState, message: AnyRecord): void {
    this.dispatchLifecycle('inferHeldWork', state, { message });
  }

  /**
   * Starts one resident process and asks the manager to track it.
   *
   * The order is forced by what the manager accepts: the record's pid is written
   * when the host is opened, so the child has to exist first — which is also why
   * the first turn's messages are in the queue before the process is spawned. The
   * host is then read back from `snapshot()` because `openHost` answers with a
   * copy; `startHost` has already put the live state in `hosts`.
   */
  private async startResidentHost(
    appSessionId: string,
    messages: AnyRecord[],
    turn: HostTurnInput,
    context: ProviderRuntimeContext,
  ): Promise<ResidentHostState> {
    const options = turn.options;

    // The Remote Control gate, first and before anything is built.
    //
    // Before the model lookup and before the queue, the ledger and the process:
    // a refused launch must leave no trace of one, and "no `/v1/messages`, no
    // child, no host" is only a meaningful reading if nothing that could produce
    // any of the three has run yet. The config directory is resolved here rather
    // than taken from `options` for the reason `resolveClaudeConfigDir` states:
    // the child's environment is built from `process.env`, so the file this reads
    // is the one the process would have been launched under.
    const configDir = resolveClaudeConfigDir();
    const settingsPath = this.userSettingsPath ?? join(configDir, CLAUDE_USER_SETTINGS_FILE);
    const detected = readClaudeUserSettings(settingsPath);
    if (detected.remoteControlAtStartup === true) {
      const refusal: ClaudeRemoteControlRefusal = {
        code: 'remote-control-enabled',
        message: remoteControlRefusalMessage(),
        settingsPath,
        at: this.now(),
      };
      this.refusals.set(appSessionId, refusal);
      throw new ClaudeRemoteControlRefusalError(refusal);
    }
    // A launch that got past the gate clears the last refusal: the reading is
    // "what this driver last said about this session", and a user who turned
    // Remote Control off and started again must not keep reading the old no.
    this.refusals.delete(appSessionId);

    // The occupancy gate: a conversation a Claude Code background job is running
    // cannot be resumed (the CLI exits 1 on stderr, which this app drops), so
    // the launch is refused before anything is built or spawned. Asked of the
    // CLI's own registry, the same one `readCliSessionRegistration` reads.
    const occupant = findBackgroundSessionOwner(configDir, context.resolveProviderSessionId(appSessionId));
    if (occupant) {
      throw new ClaudeSessionOccupiedError(occupant);
    }

    const resolvedModel = await context.resolveResumeModel(appSessionId, options.model);
    let effortModels: unknown;
    try {
      effortModels = await context.getProviderModels();
    } catch {
      // The runtime warns and carries on with the predefined effort table; the
      // launch must not fail because the model catalogue could not be read.
      effortModels = undefined;
    }

    const queue = createResidentInputQueue();
    queue.push(...messages);
    // One ledger per process, created before the spawn so the hook installed on
    // it can never fire into nowhere: the first turn can end before this method
    // returns, and its `Stop` reading is the one an unattended turn will need.
    const ledger = createBackgroundWorkLedger();
    // The same reason, one step further: the host state the hook reconciles into
    // does not exist until `openHost` has answered, so firings that beat that are
    // buffered for `startHost` rather than dropped.
    const stopHook: StopHookSink = { state: null, buffered: [] };

    // No name is *invented* here. What is handed over is the session's own
    // Claude Code title, read from the transcript the CLI itself wrote
    // (`resolveClaudeSessionTitle`), so the process registers under
    // `nameSource: "auto"` — the rung the CLI reserves for a title it adopted —
    // and answers to the same phrase the session already shows instead of the
    // directory-plus-two-characters name it derives when given nothing. The app
    // still names nothing: it passes the authority back, never a string of its
    // own, which is why the display name cached on the session row is not an
    // input here.
    //
    // A cold start with no provider session id yet is handed nothing at all, and
    // that is deliberate rather than incidental: the SDK suppresses its own
    // title generation when a title is passed, so a launch that supplied one
    // before the session had one would leave it with nothing to adopt. The
    // read-back below (`readCliSessionRegistration`, `startIdentityReadback`)
    // keeps its job — the process's address is still whatever the CLI registered,
    // and is still read rather than predicted.

    // The permission scope, created here and not in the factory: whether a
    // request is answered from a browser or refused outright is this driver's
    // policy, and the factory's job is only to install what it is handed (see
    // `buildResidentSdkOptions`). It exists before the spawn so a request that
    // arrives in the window before `startHost` adopts cannot fall through to an
    // unanswered promise.
    const permissions: ClaudePermissionScope = {
      state: null,
      mode: RESIDENT_PERMISSION_MODE,
      decisions: [],
      lastConnectedCount: 0,
    };

    // Read before the process is created, because the SDK takes the title as a
    // launch option rather than something it can be told afterwards: a resident
    // process holds one name for its whole life, so this is the only moment it
    // can be handed over.
    const providerSessionId = context.resolveProviderSessionId(appSessionId);
    const sessionTitle = await resolveClaudeSessionTitle(providerSessionId, options.cwd);

    const process = await this.createProcess({
      prompt: queue.stream,
      options: {
        ...options,
        providerSessionId,
        sessionTitle,
        model: resolvedModel || options.model,
        effortModels,
      },
      permissions: this.createPermissionEntries(appSessionId, permissions),
      // The defence-in-depth half of the gate: the settings above said "not on",
      // so the launch goes ahead — stating both flags as well, without ever
      // reading their effect back as a fact (see the Remote Control section).
      remoteControlFlags: { ...CLAUDE_REMOTE_CONTROL_FLAGS },
      seams: {
        onStop: (input) => {
          ledger.record(input);
          const state = stopHook.state;
          if (!state) {
            stopHook.buffered.push(input);
            return;
          }
          this.reconcileHeldWork(state, input);
        },
      },
    });

    // The pid is the key to the CLI's own registry, so it is resolved once and
    // shared: the pending host carries it for the address read-back, and
    // `openHost` records it on the binding.
    const pid = await this.resolvePid(process);

    this.pending = {
      queue,
      process,
      modelContextWindow: resolveModelContextWindowRow('claude', resolvedModel || options.model),
      ledger,
      pid,
      configDir,
      projectPath: typeof options.cwd === 'string' && options.cwd ? options.cwd : null,
      launchedTitle: sessionTitle,
      stopHook,
      permissions,
      remoteControl: {
        requested: { ...CLAUDE_REMOTE_CONTROL_FLAGS },
        detected: {
          remoteControlAtStartup: detected.remoteControlAtStartup,
          isolatePeerMachines: detected.isolatePeerMachines,
        },
        settingsPath,
        launched: process.launchSettings ?? null,
      },
    };

    const host = await this.host.openHost({
      provider: this.provider,
      mode: 'resident',
      appSessionId,
      driver: this,
      pid,
    });

    const state = this.hosts.get(host.hostId);
    if (!state) {
      throw new Error(`Resident host ${host.hostId} was opened but its driver state was not adopted.`);
    }

    state.resumed = Boolean((options.resume as string | undefined) || (options.providerSessionId as string | null));
    this.consume(state);
    return state;
  }

  /**
   * The pid, once the spawn hook has run.
   *
   * The SDK spawns eagerly for a streaming prompt, so the hook has almost always
   * fired by the time `query()` returns; the extra tick is for a build that
   * defers it by a microtask, and a pid that never appears is recorded as the
   * truth (`null`) rather than waited on.
   */
  private async resolvePid(process: ClaudeResidentProcess): Promise<number | null> {
    if (process.pid !== null) {
      return process.pid;
    }
    await new Promise<void>((resolve) => setImmediate(resolve));
    return process.pid;
  }

  /**
   * Builds one turn's prompt messages through the runtime's own builder, each
   * stamped with the uuid this host pushes it under.
   *
   * The stamp is the host's mark on the turn and is recorded in the host's own
   * pushed set (see `armRound`). It is deliberately *not* claimed to be the
   * CLI's id for the turn: the stream echoes no pushed uuid, so the set answers
   * one question only — "did this host push this turn?" — which is the question
   * an unattended turn's opener has to be measured against.
   */
  private async turnMessages(turn: HostTurnInput, queuedBehindTurn: boolean): Promise<AnyRecord[]> {
    const options = turn.options;
    const messages = await buildPromptMessages(turn.command, options.images, options.files, options.cwd);
    // The caller's own tier for THIS write, when it named a usable one (see
    // `CLAUDE_TURN_PRIORITY_OPTION`). Read only for a busy write, because a tier is a
    // statement about a queue and only a busy write has one to be behind.
    const requested = queuedBehindTurn ? readRequestedPriority(options) : null;
    return messages.map((message) => ({
      ...message,
      uuid: randomUUID(),
      // A frame written while the process is busy is written under the tier that
      // makes it wait for the turn in flight and then run as a turn of its own —
      // unless its caller named one of the CLI's three tiers for it, which is how the
      // Live Voice relay's quiet-window release gets `next` (merged into the turn in
      // flight at its next tool boundary) without changing what any other busy write
      // does. A cold start's frame is the process's first work, so it carries no tier:
      // there is nothing for it to queue behind, and stating one anyway would make the
      // frame say something about a queue that does not exist yet.
      ...(queuedBehindTurn ? { priority: requested ?? CLAUDE_QUEUED_INPUT_PRIORITY } : {}),
    }));
  }

  /** One round record, with the settlement its dispatcher awaits. */
  private createRound(
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

  /**
   * Arms one round: its messages into the queue, its lease into the manager.
   *
   * `messages` are passed rather than rebuilt because the cold-start path has
   * already spent them seeding the queue before the process existed.
   */
  private armRound(
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
  private applyLedger(
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

  /** Thin delegation to the shipped `emitLedgerLines` handler; see `claude-resident-lifecycle-outcome-handlers.ts`. */
  private emitLedgerLines(state: ResidentHostState): void {
    this.dispatchLifecycle('emitLedgerLines', state, undefined);
  }



  /** Thin delegation to the shipped `writeReconcileLine` handler; see `claude-resident-lifecycle-outcome-handlers.ts`. */
  private writeReconcileLine(state: ResidentHostState, anomaly: string, detail: string): void {
    this.dispatchLifecycle('writeReconcileLine', state, { anomaly, detail });
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
  private runLedgerEffect(
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
   * Records one accepted send in the ledger and opens its run.
   *
   * The identity is the CLI's: the uuids are the ones the frames were written
   * under, and `commandUuid` is the one the CLI will name them by — the last
   * frame, which carries the prompt (an attachment-carrying turn writes the
   * blocks first and the text last). Every uuid is indexed so a lifecycle event
   * finds this delivery whichever frame it names.
   */
  private openRun(state: ResidentHostState, round: ResidentRound, messages: AnyRecord[]): void {
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
   * Publishes this host's deliveries to the activity channel, and announces a
   * change to them (SPEC §7.1).
   *
   * Two things happen here, and they are deliberately separate:
   *
   *  - the session's **reading** is installed or replaced, so the activity
   *    protocol's snapshot — and the REST route that hands the same body to a
   *    late joiner — carry the ledger as it stands at the moment of the read;
   *  - the **tick** is fired, but only when the ledger's own signature of what the
   *    snapshot states differs from the last one announced. That comparison is why
   *    this can be called from every stream frame and from every ledger-writing
   *    site without the revision advancing for frames that changed nothing: an
   *    assistant message, a tool result and a duplicate lifecycle statement all
   *    leave the projection identical and therefore cost no `rev`.
   *
   * Run=turn only, and the gate is read at call time like every other reading of
   * the flag: with S2 off, the ledger still runs (S1 made it the authority
   * internally) but nothing about it reaches the wire, which is what keeps the
   * flag-off behaviour byte-for-byte the behaviour before this channel existed.
   */
  private publishDeliveries(state: ResidentHostState): void {
    if (!residentRunIsTurn()) {
      return;
    }
    const sessionId = state.appSessionId;
    this.registries.registerTurnRun(sessionId, () => {
      const turnRun = state.turnRun;
      return turnRun
        ? { runId: turnRun.runId, startedAt: turnRun.startedAt }
        : { runId: null, startedAt: null };
    });
    if (this.registries.registerDeliveries(
      sessionId,
      () => projectDeliveries(state, this.now()),
      deliveryChannelSignature(state),
    )) {
      notifyActivityChange(sessionId);
    }
    // The by-id face of the same ledger: what a caller holding only a
    // `deliveryId` reads, which no session-keyed projection can answer.
    this.registries.registerDeliveryLookup(sessionId, () =>
      ledgerDeliveries(state.turnLedger).map((delivery) => lookupDelivery(state, delivery)));
    // The single writer's own publication (I6): the `processing` predicate the
    // run registry, the running-sessions API, the heartbeat, the MCP overview and
    // the scheduled-message dispatcher all read. Installed as a live closure like
    // the two above, so a read always answers the ledger as it stands *now* —
    // which is what makes those readers agree by construction rather than by
    // every consumer re-deriving the rule.
    this.registries.registerProcessing(sessionId, () => this.processingReadingOf(state));
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
  private processingReadingOf(state: ResidentHostState): ClaudeResidentProcessingReading {
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
  private syncTurnLeases(state: ResidentHostState): void {
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
  private closeRun(
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
  private endLedger(
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
   * Ends one run with nobody to tell: the process is gone, so the ending is the
   * dispatcher's promise and nothing else.
   *
   * The `announced: false` half of the ledger's `run-closed` effect — the host is
   * going away, so there is no writer left to state a terminal through and the
   * only thing that can still be wrong is a dispatch awaiting a promise that will
   * never resolve. A stream that died under the run fails it (`failure`); a host
   * being closed deliberately settles it, because nothing went wrong there.
   */
  private endRunSilently(state: ResidentHostState, deliveryId: string, failure: Error | null): void {
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
  private cancelledReason(state: ResidentHostState, commandUuid: string): ClaudeResidentDeliveryReason {
    const delivery = ledgerDeliveryByUuid(state.turnLedger, commandUuid);
    if (delivery?.withdrawalRequested) {
      return 'withdrawn';
    }
    if (ledgerTurn(state.turnLedger)?.interruptRequested) {
      return 'interrupt';
    }
    return 'cli';
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
  private applyLifecycle(
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
  private openTurnAtInit(state: ResidentHostState, message: AnyRecord): void {
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
   * Binds a delivered turn to its run, through the host layer (run=turn only).
   *
   * Called at the two moments the ledger learns a delivery belongs to a turn —
   * the `init` that opens it (`openTurnAtInit`) and a `started` that folds a
   * command into a turn already open (`applyLifecycle`) — because the run's
   * delivery set and the writer its frames belong on are the same answer, and the
   * registry is the only place that can give it: the run registry lives across an
   * import edge this file may not cross, so the call goes through the manager's
   * turn seam the composition root has filled.
   *
   * `null` (no seam installed, or nothing to adopt and nothing to open) leaves the
   * state alone: frames then fall back to the round's writer, which is the
   * behaviour this mode had before the seam existed.
   */
  private bindTurnRun(
    state: ResidentHostState,
    turn: ResidentLedgerTurn | null,
    deliveryIds?: string[],
  ): void {
    if (!residentRunIsTurn() || !turn) {
      return;
    }
    // An unattended turn's run is opened by the OTHER seam
    // (`openUnattendedTurnIfOwn`, with `kind: 'unattended'`): binding it here as a
    // delivered turn would mint a second run for a turn no delivery belongs to,
    // and the turn's frames would follow the wrong one. The ledger decides this
    // (`kind`), because the ledger is where "did anything of ours open this turn"
    // is answered (I5).
    if (turn.kind !== 'delivered') {
      return;
    }
    const ids =
      deliveryIds
      ?? ledgerDeliveries(state.turnLedger)
        .filter((delivery) => delivery.turnId === turn.id)
        .map((delivery) => delivery.commandUuid);
    const handle = this.host.openTurn({
      provider: this.provider,
      appSessionId: state.appSessionId,
      providerSessionId: state.providerSessionId,
      userId: state.lastUserId,
      sessionName: state.lastSessionName,
      kind: 'delivered',
      deliveryIds: ids,
    });
    if (!handle) {
      return;
    }
    state.turnRun = { runId: handle.runId, writer: handle.writer, startedAt: this.now() };
    // Every delivery of this turn keeps its terminal frame on this run's writer,
    // however the delivery was dispatched: the writer is driver-side bookkeeping
    // and lives with the rest of it, indexed by `commandUuid`.
    for (const delivery of ledgerDeliveries(state.turnLedger)) {
      if (delivery.turnId !== turn.id) {
        continue;
      }
      const runtime = state.runtimes.get(delivery.commandUuid);
      if (runtime) {
        runtime.turnWriter = handle.writer;
      }
    }
    // The run the delivery's turn is executing as, kept on the delivery so a
    // by-id read can still name it once the turn (and `state.turnRun`) is gone.
    // Applied directly rather than through `applyLedger`: this runs inside an
    // effect of a transition that is already running, and the tail that call
    // would run is the one the outer transition runs a moment from now.
    applyLedgerEvent(state.turnLedger, { kind: 'run-bound', turnId: turn.id, runId: handle.runId });
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
  private closeTurn(state: ResidentHostState, result: AnyRecord): void {
    // One transition closes the turn and every run bound to it — the same
    // transition the unattended path reaches (`closeLedgerTurnOnly`), so the two
    // paths state the same terminal for the same ending (AC-395 (c)).
    this.applyLedger(state, { kind: 'turn-result', at: this.now(), isError: result?.is_error === true });
    // A run that closed here is no longer owed its turn's ending, but it may
    // still be owed the CLI's terminal for its own command (C-3) — that is what
    // `owed` carries, and the next boundary's `owed-boundary` is what settles it.
  }

  /**
   * Opens a run for a turn the process started by itself, at the moment that
   * turn announces itself.
   *
   * The reading is structural and has to be: a turn nobody pushed sends no
   * request, so there is nothing to correlate a run with. What the CLI does say
   * is that a conversation turn is beginning (`system/init`) at a moment when
   * **nothing this host pushed is waiting to be bound to it** and under a uuid
   * this host never pushed. The first half is the ledger's `pendingStart` — the
   * command uuids the CLI's own `started` named while no turn was open (C-2),
   * which is exactly I5's "no `started` waiting to be bound" — and it is the
   * ledger that answers it rather than a count of rounds in flight. That
   * distinction is the whole criterion: a merged turn leaves stale bookkeeping
   * on the FIFO, and reading `state.rounds.length` let one stale round mask
   * every later unattended turn — a background task's follow-up, a cron firing,
   * a peer message — so nothing reported that the work had finished.
   *
   * A command the CLI started under a uuid nothing here pushed (a cron firing,
   * E9 §9.4) is `foreign`, not a delivery waiting for a turn, so it never makes
   * the turn delivered; its uuid stays out of everything this host exposes.
   *
   * Never throws and never reports. An unattended turn that cannot be opened is
   * not a failure: the run registry may already hold a run for the session, and
   * in that case the frames stay with the last writer, which is what this mode
   * did before it could open runs at all.
   */
  private openUnattendedTurnIfOwn(
    state: ResidentHostState,
    message: AnyRecord,
    sessionId: string | null,
    commandsWaitingForTurn: number,
  ): void {
    if (state.closed || state.unattended) {
      return;
    }
    if (message?.type !== 'system' || message.subtype !== 'init') {
      return;
    }
    // I5, read off the ledger rather than off the round FIFO. A command of ours
    // whose `started` the CLI stated while no turn was open is waiting for this
    // turn and makes it a delivered one; with nothing waiting, the turn is the
    // process's own. The count is passed in rather than read here because
    // `openTurn` has already bound — and so emptied — that waiting list by the
    // time this runs.
    if (commandsWaitingForTurn > 0) {
      return;
    }
    const commandUuid = typeof message.uuid === 'string' ? message.uuid : null;
    if (!commandUuid || state.pushedUuids.has(commandUuid)) {
      return;
    }

    // Run=turn states the same request through the generalized seam: the run
    // belongs to the TURN, so it is opened as an `unattended` turn's run rather
    // than as "a run nobody dispatched" — an unattended turn binds no delivery,
    // which is the fact the S2 criterion reads back as `deliveryIds` empty. With
    // the flag off the older, writer-shaped seam answers exactly as before.
    const handle = residentRunIsTurn()
      ? this.host.openTurn({
          provider: this.provider,
          appSessionId: state.appSessionId,
          providerSessionId: sessionId,
          userId: state.lastUserId,
          sessionName: state.lastSessionName,
          kind: 'unattended',
        })
      : this.host.openUnattendedRun({
          provider: this.provider,
          appSessionId: state.appSessionId,
          providerSessionId: sessionId,
          userId: state.lastUserId,
          sessionName: state.lastSessionName,
        });
    if (!handle) {
      return;
    }

    // Read at the opener and not at the end: the hook fires at every turn's
    // end, so by the time this turn's own `result` arrives the newest reading
    // is the empty list the turn itself left behind.
    const trigger = deriveBackgroundWorkTrigger(state.ledger.latest());
    state.unattended = { commandUuid, trigger, writer: handle.writer };
    state.lastUnattendedCommandUuid = commandUuid;
    if (sessionId) {
      handle.writer.setSessionId?.(sessionId);
    }
  }

  /** Thin delegation to the shipped `startIdentityReadback` handler; see `claude-resident-lifecycle-outcome-handlers.ts`. */
  private startIdentityReadback(state: ResidentHostState, sessionId: string): void {
    this.dispatchLifecycle('startIdentityReadback', state, { sessionId });
  }

  /** Thin delegation to the shipped `publishIdentity` handler; see `claude-resident-lifecycle-outcome-handlers.ts`. */
  private publishIdentity(state: ResidentHostState, value: string | null): void {
    this.dispatchLifecycle('publishIdentity', state, { value });
  }

  /** Thin delegation to the shipped `refreshIdentityAfterRename` handler; see `claude-resident-lifecycle-outcome-handlers.ts`. */
  private refreshIdentityAfterRename(state: ResidentHostState): void {
    this.dispatchLifecycle('refreshIdentityAfterRename', state, undefined);
  }

  /** Thin delegation to the shipped `stopTitleMirror` handler; see `claude-resident-lifecycle-outcome-handlers.ts`. */
  private stopTitleMirror(state: ResidentHostState): void {
    this.dispatchLifecycle('stopTitleMirror', state, undefined);
  }

  /** Thin delegation to the shipped `scheduleTitleMirror` handler; see `claude-resident-lifecycle-outcome-handlers.ts`. */
  private scheduleTitleMirror(state: ResidentHostState): void {
    this.dispatchLifecycle('scheduleTitleMirror', state, undefined);
  }



  /** Thin delegation to the shipped `mirrorResidentTitle` handler; see `claude-resident-lifecycle-outcome-handlers.ts`. */
  private mirrorResidentTitle(state: ResidentHostState, title: string): void {
    this.dispatchLifecycle('mirrorResidentTitle', state, { title });
  }

  /** Thin delegation to the shipped `finishUnattendedTurn` handler; see `claude-resident-lifecycle-outcome-handlers.ts`. */
  private finishUnattendedTurn(state: ResidentHostState, sessionId: string | null, result: AnyRecord): void {
    this.dispatchLifecycle('finishUnattendedTurn', state, { sessionId, result });
  }

  /** Thin delegation to the shipped `abandonUnattendedTurn` handler; see `claude-resident-lifecycle-outcome-handlers.ts`. */
  private abandonUnattendedTurn(state: ResidentHostState, exitCode: number): void {
    this.dispatchLifecycle('abandonUnattendedTurn', state, { exitCode });
  }

  /**
   * Runs the handler registered for one reading, or answers `null` when none is.
   *
   * The whole of what every reading method does now: the registry decides what
   * answers, and "nothing registered" degrades to the same conservative `null` a
   * reading already gives for a session this driver is not hosting. The handler
   * set lives in `claude-resident-outcome-handlers.ts`; this method names no
   * reading logic of its own.
   */
  /**
   * Runs the handler registered for one lifecycle outcome, or answers `null`
   * when none is.
   *
   * The whole of what every reaction method does now: the registry decides what
   * happens, and "nothing registered" degrades to "this reaction did not
   * happen" rather than to a crash. The handler set lives in
   * `claude-resident-lifecycle-outcome-handlers.ts`; this method names no
   * reaction logic of its own.
   */
  private dispatchLifecycle<
    TResult = unknown,
    TName extends ClaudeResidentLifecycleOutcomeName = ClaudeResidentLifecycleOutcomeName,
  >(
    name: TName,
    state: ResidentHostState,
    payload: ClaudeResidentLifecycleOutcomePayload[TName],
  ): TResult | null {
    const answer = this.lifecycle.dispatch<TResult>(name, this.lifecycleContext, state, payload);
    return answer ? answer.value : null;
  }

  private dispatchReading<TResult>(name: ClaudeResidentOutcomeName, appSessionId: string): TResult | null {
    const answer = this.outcomes.dispatch<TResult>(name, this.outcomeContext, appSessionId);
    return answer ? answer.value : null;
  }

  /** The live resident state for a session, or null when it has no process. */
  private liveStateFor(appSessionId: string): ResidentHostState | null {
    return this.dispatchReading<ResidentHostState | null>('liveState', appSessionId);
  }

  /**
   * The host state for a session whose ledger is still worth reading.
   *
   * The same lookup as {@link liveStateFor} with one difference, and it is the
   * difference between "what is this host doing" and "what did this host have
   * open when it stopped": a host that has ended — its stream finished under it,
   * or the manager closed it — keeps its ledger readable. Everything else this
   * driver reports is about a process it is still holding, which is why the live
   * readings refuse a closed host; the ledger is frozen at that point instead,
   * and it is the answer to "did anything stay open when it died?".
   *
   * The body is the `ledgerState` handler beside this file; the reading method
   * that used it ({@link ClaudeResidentHostDriver.ledgerReading}) now delegates to
   * that same handler directly.
   */
  private ledgerStateFor(appSessionId: string): ResidentHostState | null {
    return this.dispatchReading<ResidentHostState | null>('ledgerState', appSessionId);
  }

  /**
   * Builds the three entries one resident process is launched with.
   *
   * One builder for the three because they are one policy — the same
   * attendance test, the same notification, the same decision log — and only the
   * *answer shape* differs: `canUseTool` speaks the SDK's `PermissionResult`,
   * `onElicitation` speaks `ElicitResult`, and `onUserDialog` speaks the dialog
   * result union. Those shapes are the SDK's own (`sdk.d.ts`) and are produced
   * here, in the one place that knows what the client's answer was.
   *
   * The per-run path's non-interactive branch is deliberately *not* mirrored. It
   * has an allow/deny list to consult before asking; a resident host launches
   * under `bypassPermissions` (where the CLI never refers a non-interactive tool
   * to a callback at all) and only reaches this branch after an explicit live
   * switch to a mode that means "ask me". Asking, there, is what the mode means.
   */
  private createPermissionEntries(
    appSessionId: string,
    scope: ClaudePermissionScope,
  ): ClaudeResidentPermissions {
    const ask = async (
      entry: ClaudePermissionEntry,
      toolName: string | null,
      request: AnyRecord,
      options: AnyRecord,
    ): Promise<ClaudePermissionAnswer> =>
      this.answerPermissionRequest({
        appSessionId,
        scope,
        entry,
        toolName,
        request,
        signal: options?.signal as AbortSignal | undefined,
      });

    return {
      canUseTool: async (toolName, input, options) => {
        const answer = await ask('canUseTool', toolName, input, options);
        if (answer.kind === 'refused') {
          return { behavior: 'deny', message: answer.message };
        }
        const decision = answer.decision;
        if (!decision) {
          return { behavior: 'deny', message: 'Permission request timed out' };
        }
        if (decision.cancelled) {
          return { behavior: 'deny', message: 'Permission request cancelled' };
        }
        if (decision.allow) {
          return { behavior: 'allow', updatedInput: decision.updatedInput ?? input };
        }
        return {
          behavior: 'deny',
          message: typeof decision.message === 'string' ? decision.message : 'User denied tool use',
        };
      },

      onElicitation: async (request, options) => {
        const answer = await ask('onElicitation', null, request, options);
        // A refusal, an aborted wait and a timed-out one all have the same
        // meaning to the server that asked: no answer is coming. `cancel` is the
        // SDK's word for exactly that (`ElicitResult.action`).
        if (answer.kind === 'refused' || !answer.decision?.allow) {
          return { action: 'cancel' };
        }
        return typeof answer.decision.content === 'object' && answer.decision.content !== null
          ? { action: 'accept', content: answer.decision.content }
          : { action: 'accept' };
      },

      onUserDialog: async (request, options) => {
        const answer = await ask('onUserDialog', null, request, options);
        // `cancelled` is the answer the SDK documents as the safe one: for a
        // dialog kind the client did not fill in, the CLI applies the dialog's
        // own default rather than being told a result nobody produced.
        if (answer.kind === 'refused' || !answer.decision?.allow) {
          return { behavior: 'cancelled' };
        }
        return { behavior: 'completed', result: answer.decision.result ?? null };
      },
    };
  }

  /**
   * One request, answered: refused when nobody is there, asked when somebody is.
   *
   * The refusal never enters the client flow at all, and that is the reading the
   * criterion takes of it: the per-run protocol's own pending list
   * (`getPendingApprovalsForSession`) stays empty for a session this host refused
   * for, and the entry returns inside the budget instead of waiting on a
   * `timeoutMs: 0` that would never fire. The client's answer, by contrast, comes
   * back through a promise this method is the only holder of — so it is recorded
   * here, before it is returned, or it would be readable nowhere.
   */
  private async answerPermissionRequest(input: {
    appSessionId: string;
    scope: ClaudePermissionScope;
    entry: ClaudePermissionEntry;
    toolName: string | null;
    request: AnyRecord;
    signal?: AbortSignal;
  }): Promise<ClaudePermissionAnswer> {
    const { appSessionId, scope, entry, toolName, request, signal } = input;
    const writer = this.permissionWriter(scope);

    if (this.isUnattended(scope, writer)) {
      const message = unattendedRefusalMessage(entry, toolName);
      this.notifyPermission(appSessionId, scope, { entry, toolName, reason: message });
      this.recordPermissionDecision(scope, {
        entry,
        toolName,
        request,
        answer: entry === 'canUseTool' ? { behavior: 'deny', message } : { action: 'cancel' },
        refused: true,
        viaClient: false,
        requestId: null,
        reason: message,
      });
      return { kind: 'refused', message };
    }

    // Non-null by the guard above: `isUnattended` answers true for a host with no
    // writer, so reaching here means there is one to send the request on.
    const requestId = randomUUID();
    const decision = await requestClientToolDecision({
      // The frame's `toolName` is the protocol's own label for the request; the
      // two request-shaped entries have no tool, so they carry their entry name
      // and the whole request travels in `input` (the README's resident-permission
      // section says so, and the per-run protocol is otherwise unchanged).
      toolName: toolName ?? entry,
      input: request,
      requiresInteraction:
        entry !== 'canUseTool' || TOOLS_REQUIRING_INTERACTION.has(toolName ?? ''),
      requestId,
      ws: writer,
      emitNotification: (event: AnyRecord) =>
        this.notifyUser({ userId: scope.state?.lastUserId ?? null, event }),
      sessionId: appSessionId,
      sessionSummary: scope.state?.lastSessionName ?? null,
      signal,
    });
    this.recordPermissionDecision(scope, {
      entry,
      toolName,
      request,
      answer: decision,
      refused: false,
      viaClient: true,
      requestId,
      reason: null,
    });
    return { kind: 'client', decision };
  }

  /**
   * Whether this host has nobody to ask about one request.
   *
   * Two facts, and the conjunction is the whole of the mode's arrival at
   * "unattended": nobody is connected *and* no user turn is in flight. Neither
   * half stands alone — a browser watching while the process runs a cron turn of
   * its own is somebody who could answer, and a turn this host armed came from a
   * client even if that client has since gone (its prompt is buffered for
   * replay, exactly as a per-run prompt's is) — so the test is
   * `connected <= 0 && no round`.
   *
   * A host with no adopted state, or with no writer yet, is unattended by this
   * reading: the callbacks can fire in the window between `query()` and
   * `openHost` answering, and refusing there is what keeps that window from
   * parking a turn on a person this driver cannot reach.
   *
   * `writer` is passed in rather than looked up again so the one caller that has
   * to *use* it keeps the same value this decision was made about.
   */
  private isUnattended(
    scope: ClaudePermissionScope,
    writer: ProviderRuntimeWriter | null,
  ): boolean {
    const connected = this.connectedClientCount();
    scope.lastConnectedCount = connected;
    const state = scope.state;
    if (!state || !writer) {
      return true;
    }
    if (state.rounds.length > 0) {
      return false;
    }
    return connected <= 0;
  }

  /**
   * The writer one request's frames belong on, or null when there is none yet.
   *
   * The unattended turn's own writer wins while it is open, for the reason the
   * read loop prefers it: that turn is the one running, so a request from it is
   * addressed to whoever opened *it*. After that the round in flight owns its
   * requests, and a host between turns falls back to the last writer it saw —
   * which is what lets a browser that is still watching answer for a process
   * running a turn of its own.
   */
  private permissionWriter(scope: ClaudePermissionScope): ProviderRuntimeWriter | null {
    const state = scope.state;
    if (!state) {
      return null;
    }
    return state.unattended?.writer ?? state.rounds[0]?.writer ?? state.writer;
  }

  /**
   * Tells the session's user that a request was refused because nobody was there.
   *
   * The same `action_required` notification the per-run flow emits for a request
   * it is waiting on, under a code of its own: the user has to be able to tell
   * "Claude is waiting for you" from "Claude was told to carry on without you",
   * and the refusal's own words travel in the event rather than being restated.
   */
  private notifyPermission(
    appSessionId: string,
    scope: ClaudePermissionScope,
    fact: { entry: ClaudePermissionEntry; toolName: string | null; reason: string },
  ): void {
    this.notifyUser({
      userId: scope.state?.lastUserId ?? null,
      event: buildNotificationEvent({
        provider: this.provider,
        sessionId: appSessionId,
        kind: 'action_required',
        code: 'permission.unattended_refused',
        meta: {
          entry: fact.entry,
          toolName: fact.toolName,
          sessionName: scope.state?.lastSessionName ?? null,
          reason: fact.reason,
        },
        severity: 'warning',
        requiresUserAction: true,
        // One per entry per refusal, so a turn that hits the same wall three
        // times does not collapse into a single notification.
        dedupeKey: `claude:permission-refused:${appSessionId}:${fact.entry}:${scope.decisions.length}`,
      }),
    });
  }

  /** Appends one answered request to its scope's log, dated on the host's clock. */
  private recordPermissionDecision(
    scope: ClaudePermissionScope,
    decision: Omit<ClaudePermissionDecision, 'at'>,
  ): void {
    scope.decisions.push({ ...decision, at: this.now() });
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
  private recordQueueFacts(state: ResidentHostState, message: AnyRecord): void {
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

  /**
   * Waits for a specific lifecycle state to be read for a specific uuid.
   *
   * Polls the reading rather than being woken by the read loop: the stream is
   * consumed by one loop this class owns, and handing the queue a callback
   * registry so a withdrawal could be notified would make the wait a second
   * consumer of the same state. `true` only when the state was actually read;
   * the budget expiring is `false`, which the caller must interpret (and does,
   * from the reading — never from the expiry).
   */
  private async waitForLifecycle(
    state: ResidentHostState,
    commandUuid: string,
    wanted: CommandLifecycleState,
  ): Promise<boolean> {
    const deadline = Date.now() + CLAUDE_CANCEL_VERDICT_WAIT_MS;
    for (;;) {
      if (state.lifecycle.some((event) => event.commandUuid === commandUuid && event.state === wanted)) {
        return true;
      }
      if (state.closed || Date.now() >= deadline) {
        return false;
      }
      await new Promise<void>((resolve) => {
        setTimeout(resolve, CLAUDE_CANCEL_VERDICT_POLL_MS);
      });
    }
  }

  /** Runs the read loop detached, with a rejection sink so nothing floats unhandled. */
  private consume(state: ResidentHostState): void {
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
  private async readStream(state: ResidentHostState): Promise<void> {
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
   * Reports one round's ending to the notification layer.
   *
   * The call the runtime's own read loop makes at its turn boundary, made from
   * the same place here for the same reason: a client listening for run-ended
   * events has to hear about a stopped resident turn as well as a completed one,
   * and this driver is where either ending is reached. The application session id
   * is preferred over the provider-native one (mirroring the runtime, which
   * prefers the app id in this report and the native one in the frame), and a
   * turn that carried no session name reports none rather than inventing one.
   */
  private reportRoundEnd(
    round: ResidentRound,
    stopReason: 'completed' | 'aborted',
    providerSessionId: string | null,
  ): void {
    const sessionName = round.turn.options?.sessionSummary;
    this.notifyRunStopped({
      userId: round.writer.userId ?? null,
      provider: 'claude',
      sessionId: round.appSessionId || providerSessionId,
      sessionName: typeof sessionName === 'string' ? sessionName : null,
      stopReason,
    });
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
  private reportExit(state: ResidentHostState): void {
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
   * Folds one SDK message into the host's reported state.
   *
   * The order is the runtime's own read loop, minus the interactive half this
   * mode does not carry (see the file header): capture the provider session id
   * once, hand the normalized frames to the current writer, publish the token
   * budget, mark the binding active, and read a `result` as the end of a turn.
   */
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
  private observe(state: ResidentHostState, message: AnyRecord): void {
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
  private recordFrameWithoutTurn(state: ResidentHostState, message: AnyRecord): void {
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

  private observeFrame(state: ResidentHostState, message: AnyRecord): void {
    const round = state.rounds[0] ?? null;
    const writer = round?.writer ?? state.writer;
    const context = round?.context ?? state.context;

    if (typeof message?.session_id === 'string' && message.session_id && !state.providerSessionId) {
      state.providerSessionId = message.session_id;
      writer?.setSessionId?.(message.session_id);
      // This message is what names the transcript, so it is the first moment the
      // address the process was launched under can be read back out of it.
      this.startIdentityReadback(state, message.session_id);
      if (!state.resumed && !state.sessionCreatedSent) {
        state.sessionCreatedSent = true;
        writer?.send(
          createNormalizedMessage({
            kind: 'session_created',
            newSessionId: message.session_id,
            sessionId: message.session_id,
            provider: 'claude',
          }),
        );
      }
    }

    const sessionId = state.providerSessionId;

    // Two launch facts the stream states and nothing else can answer for: which
    // tools this process was given, and what kind of background task it started.
    // The tool table is a launch decision, so "no tool here could have made that
    // trigger" is only readable next to it; the task type is the CLI's own word
    // for the work the hook ledger reports as a bare id. Both outlive the turn
    // that reported them, so they are recorded as they arrive.
    if (message?.type === 'system' && message.subtype === 'init' && Array.isArray(message.tools)) {
      state.initTools = message.tools.filter((tool: unknown): tool is string => typeof tool === 'string');
    }
    if (message?.type === 'system' && message.subtype === 'task_started' && typeof message.task_type === 'string') {
      state.backgroundTaskType = message.task_type;
    }
    this.recordQueueFacts(state, message);

    // Held work is read from two places: the `Stop` hook's own lists (through
    // the seam installed on the process) and these stream frames. A `system`
    // subtype this build does not read is *passed through* — recorded, so a
    // reader can see the loop met one, and otherwise untouched. Throwing or
    // stopping here would end the read loop, and with it the process's whole
    // lifetime, on a frame the CLI is entitled to invent.
    if (message?.type === 'system') {
      const subtype = typeof message.subtype === 'string' ? message.subtype : '';
      if (subtype && !HELD_WORK_SYSTEM_SUBTYPES.has(subtype)) {
        state.unhandledSystemSubtypes.push(subtype);
      }
      this.observeHeldWorkEvent(state, message);
    }
    this.inferHeldWork(state, message);

    // The CLI's own statement that a turn is beginning — the ledger's one
    // moment for opening a turn, and for deciding whether it is a turn anybody
    // here sent (I5). The two readings agree by construction rather than each
    // forming its own account of "is anything of ours running": I5's reading is
    // the commands of ours whose `started` the CLI has already stated and that
    // are waiting for this turn, and that waiting list is exactly what
    // `openTurnAtInit` consumes to bind them. So it is taken here, before the
    // call — asking the ledger afterwards would ask a list this same frame had
    // just emptied, and then every ordinary turn would read as the process's
    // own.
    const commandsWaitingForTurn = ledgerPendingStart(state.turnLedger).length;
    this.openTurnAtInit(state, message);

    // A turn this host did not push announces itself here, and from this point
    // its frames are that run's. Read before the forwarding below so the
    // opener's own frames reach the run it opened instead of the last round's.
    this.openUnattendedTurnIfOwn(state, message, sessionId, commandsWaitingForTurn);

    // The unattended turn comes first while it is open, because the CLI runs
    // one turn at a time: a round armed during an unattended turn is queued
    // *behind* it, and the frames still arriving belong to the turn that is
    // actually running. Preferring the round would send the unattended turn's
    // own frames — its text, its tool calls, its `result` — into a run that has
    // not started, and leave the run the turn really belongs to empty. After
    // that, the round in flight owns its frames; a turn nothing owns belongs to
    // the run opened for it, and only then to the last writer this host saw.
    //
    // Run=turn inserts the delivered turn's own run between the two, and it is
    // what makes the turn's frames land on the turn: while a delivered turn is
    // open the frames arriving are that turn's, and the front round is NOT it — a
    // command the CLI drained into this turn was dispatched behind an earlier one,
    // so `rounds[0].writer` belongs to a run that has already ended. Writing the
    // turn's frames there would file them under the previous run, which is the
    // misattribution SPEC §6.2 removes. The field is null whenever no delivered
    // turn is open, so off that path — and off the flag — the expression reduces to
    // the one it was.
    const frameWriter =
      state.unattended?.writer ?? state.turnRun?.writer ?? round?.writer ?? state.writer;
    if (frameWriter && context) {
      forwardNormalizedFrames({
        transformedMessage: transformResidentMessage(message),
        // The frames are routed by the provider-native id (`sessionId`), but the
        // turn phase has to be keyed by the **app session id**: the activity
        // heartbeat reads it back with the id the browser subscribes with
        // (`activity-heartbeat.service.ts` → `readSessionTurn`), and on the
        // resident path those are two different id spaces. Without this the
        // tracker is fed the provider id while every reader uses the app id, so
        // every read misses and answers `idle` for a turn that is really running.
        // Same seam, same reason, as the per-run path in `claude-runtime.provider.ts`.
        turnSessionId: state.appSessionId,
        sessionId,
        normalizeMessage: context.normalizeMessage,
        writer: frameWriter,
      });
    }

    const tokenBudget =
      extractTokenBudget(message, state.modelContextWindow) ||
      (state.assistantBudgetSent ? null : extractCumulativeTokenBudget(message, state.modelContextWindow));
    if (tokenBudget && frameWriter) {
      if (message.type === 'assistant') {
        state.assistantBudgetSent = true;
      }
      frameWriter.send(
        createNormalizedMessage({
          kind: 'status',
          text: 'token_budget',
          tokenBudget,
          sessionId,
          provider: 'claude',
        }),
      );
    }

    // Every message is real work on the binding: a streamed frame, a tool call, a
    // turn boundary. This is what holds the quiet ceiling off a process that is
    // actively being used.
    state.sink.activity(state.appSessionId);

    // A title can land while a turn is still running: the CLI writes its
    // `ai-title` row early in the first turn, before the first assistant message.
    // So every message is a prompt to open the settle window that mirrors a
    // generated title onto the process's registered name — a message arriving
    // while a window is open is not a second window, and a turn opens only one
    // (see {@link scheduleTitleMirror}).
    this.scheduleTitleMirror(state);

    if (message?.type !== 'result') {
      return;
    }

    // Whatever the CLI says about the turn here, an interrupt waiting on it has
    // its answer: the deadline is cancelled before the turn is closed, so a
    // `RESULT` that arrives inside `T_int` can never also be reported as one
    // that never came (§6.3).
    this.stopInterruptWatchdog(state);
    state.resultTimes.push(Date.now());
    // The turn that just ended is over for windowing too: the *next* turn opens
    // its own window at its own first message.
    state.titleMirror.openedForTurn = false;
    // Every queued frame whose turn in flight has now ended gets its write-timing
    // reading closed out here, at the only moment both timestamps exist.
    for (const input of state.queuedInputs) {
      if (input.queuedBeforeResult === null && state.resultTimes.length > input.resultsSeenAtPush) {
        input.queuedBeforeResult = input.at < (state.resultTimes[input.resultsSeenAtPush] as number);
      }
    }

    // The unattended turn's own `result`, and it has to be read as such before
    // the ledger's turn is closed. The CLI runs one turn at a time, so a result
    // arriving while an unattended turn is open is *that* turn's ending — any
    // run armed since was pushed behind it and has not started yet. Closing the
    // ledger's open turn here instead would settle a run on a turn it never ran,
    // and that run's own `RESULT` would then find nothing open and be read as
    // another ending of the unattended turn.
    if (state.unattended) {
      // The `result` travels with the ending here too: the unattended turn can
      // itself have come from a peer, and the origin that says so is stated on
      // this message and nowhere else.
      this.finishUnattendedTurn(state, sessionId, message);
      this.closeLedgerTurnOnly(state, message);
      return;
    }

    // A `RESULT` with no ledger turn and no open run at all is one nobody here
    // is waiting for: the process pushed a turn of its own — the resident shape
    // of the background-work follow-up, whose `init` this build did not read, or
    // read before it knew the turn had a run. The mode already holds the process
    // open, so there is no lease to drop, and the frames above have reached the
    // client. What there is to do is end the run the opener made for that turn,
    // if this driver made one — handing over the `result` itself, because that
    // message is the only place the turn's origin is stated and the origin is
    // what names the trigger.
    if (state.rounds.length === 0 && ledgerTurn(state.turnLedger)?.open !== true) {
      this.finishUnattendedTurn(state, sessionId, message);
      return;
    }

    // The `result` ends one turn, and which runs that turn covered is read from
    // the ledger's own bindings — never from a position. A command the CLI folded
    // into this turn was bound to it by its `started` (C-2); a command it drains
    // into a *later* turn has no binding here and keeps its run, which is the
    // negative case the old merge scan had to be told apart by an offset count.
    //
    // Every run this closes writes its own terminal frame, interrupted or not,
    // and it is written before the run settles. Both halves matter: the frame is
    // what flips the run in the registry, so writing it first keeps the
    // dispatch's safety net (`completeRunIfCurrent`) from reporting an
    // interrupted turn as a normal exit; and an interrupted run has to carry
    // `aborted`, which is only known here, at its `RESULT`. A run folded into
    // this turn has no `RESULT` of its own, so this is the only terminal frame
    // it ever gets — which is exactly why it has to be written here.
    this.closeTurn(state, message);
  }

  /**
   * Closes the ledger's open turn for an ending somebody else already handled.
   *
   * The unattended turn's run is ended by `finishUnattendedTurn`, which owns its
   * frame and its notification; what is left for the ledger is the turn record
   * itself, so a reader after the fact sees the same two facts the delivered
   * path leaves: the turn is shut, and its outcome is the one the CLI stated.
   */
  private closeLedgerTurnOnly(state: ResidentHostState, result: AnyRecord): void {
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


export * from './lifecycle/resident-process.types.js';
export * from './lifecycle/resident-settings.js';
export * from './lifecycle/resident-turn.types.js';
export * from './lifecycle/resident-ledger-runtime.js';
export * from './lifecycle/resident-deliveries.js';
export * from './lifecycle/resident-host.types.js';
export * from './lifecycle/resident-launch.js';

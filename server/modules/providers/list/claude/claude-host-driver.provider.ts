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

import { ClaudeResidentStreamBase } from './lifecycle/resident-stream.base.js';
import {
  CLAUDE_QUEUED_INPUT_PRIORITY,
  CLAUDE_RESIDENT_EXIT_GRACE_MS,
  CLAUDE_RESIDENT_INTERRUPT_RESULT_TIMEOUT_MS,
  CLAUDE_RESIDENT_RECONCILE_MODE,
  CLAUDE_TURN_PRIORITY_OPTION,
  CRON_MAX_AGE_MS,
  ClaudePermissionAnswer,
  ClaudePermissionEntry,
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
  ClaudeResidentLifecycleReading,
  ClaudeUnattendedWorkEvent,
} from './lifecycle/resident-turn.types.js';
import {
  CLAUDE_RESIDENT_QUIESCE_MS,
  CLAUDE_RESIDENT_RECONCILE_BEAT_MS,
  ClaudeResidentProcessHandle,
  ClaudeResidentRunRegistryPort,
  NO_RESIDENT_RUN_REGISTRY,
  RESIDENT_RECONCILED_REASON,
  ResidentDeliveryRuntime,
  createBackgroundWorkLedger,
  createResidentInputQueue,
  spawnResidentCli,
} from './lifecycle/resident-ledger-runtime.js';
import {
  deliveryChannelSignature,
  lookupDelivery,
  projectDeliveries,
  residentSessionRegistries,
} from './lifecycle/resident-deliveries.js';
import {
  CLAUDE_RESIDENT_TITLE_MIRROR_POLL_MS,
  CLAUDE_RESIDENT_TITLE_MIRROR_WINDOW_MS,
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

/**
 * Owns the process lifetime of Claude's `resident` hosts.
 *
 * Constructed per provider (one instance serves every session, because a driver
 * holds no per-process state outside its maps). See the file header for what it
 * reports, what it never decides, and what it deliberately does not own.
 */
export class ClaudeResidentHostDriver extends ClaudeResidentStreamBase implements IProviderHostDriver {
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
  constructor(options: ClaudeResidentHostDriverOptions) {
    super({
      host: options.host,
      notifyRunStopped: options.notifyRunStopped,
      notifyUnattendedWork: options.notifyUnattendedWork,
      createProcess: options.createProcess ?? createSdkResidentProcess,
      now: options.now,
      interruptResultTimeoutMs: options.interruptResultTimeoutMs,
      reconcileMode: options.reconcileMode,
      quiesceMs: options.quiesceMs,
      reconcileBeatMs: options.reconcileBeatMs,
      runRegistry: options.runRegistry,
      logSink: options.logSink,
      connectedClientCount: options.connectedClientCount,
      notifyUser: options.notifyUser,
      userSettingsPath: options.userSettingsPath,
    });
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
   * Starts one resident process and asks the manager to track it.
   *
   * The order is forced by what the manager accepts: the record's pid is written
   * when the host is opened, so the child has to exist first — which is also why
   * the first turn's messages are in the queue before the process is spawned. The
   * host is then read back from `snapshot()` because `openHost` answers with a
   * copy; `startHost` has already put the live state in `hosts`.
   */
  protected async startResidentHost(
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
   * Builds one turn's prompt messages through the runtime's own builder, each
   * stamped with the uuid this host pushes it under.
   *
   * The stamp is the host's mark on the turn and is recorded in the host's own
   * pushed set (see `armRound`). It is deliberately *not* claimed to be the
   * CLI's id for the turn: the stream echoes no pushed uuid, so the set answers
   * one question only — "did this host push this turn?" — which is the question
   * an unattended turn's opener has to be measured against.
   */
  protected async turnMessages(turn: HostTurnInput, queuedBehindTurn: boolean): Promise<AnyRecord[]> {
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
  protected publishDeliveries(state: ResidentHostState): void {
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

  /** Thin delegation to the shipped `abandonUnattendedTurn` handler; see `claude-resident-lifecycle-outcome-handlers.ts`. */
  protected abandonUnattendedTurn(state: ResidentHostState, exitCode: number): void {
    this.dispatchLifecycle('abandonUnattendedTurn', state, { exitCode });
  }

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
  protected dispatchLifecycle<
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

  protected dispatchReading<TResult>(name: ClaudeResidentOutcomeName, appSessionId: string): TResult | null {
    const answer = this.outcomes.dispatch<TResult>(name, this.outcomeContext, appSessionId);
    return answer ? answer.value : null;
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
  protected async answerPermissionRequest(input: {
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

  protected observeFrame(state: ResidentHostState, message: AnyRecord): void {
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
}


export * from './lifecycle/resident-host.base.js';
export * from './lifecycle/resident-readings.base.js';
export * from './lifecycle/resident-turn.base.js';
export * from './lifecycle/resident-run.base.js';
export * from './lifecycle/resident-stream.base.js';
export * from './lifecycle/resident-process.types.js';
export * from './lifecycle/resident-settings.js';
export * from './lifecycle/resident-turn.types.js';
export * from './lifecycle/resident-ledger-runtime.js';
export * from './lifecycle/resident-deliveries.js';
export * from './lifecycle/resident-host.types.js';
export * from './lifecycle/resident-launch.js';

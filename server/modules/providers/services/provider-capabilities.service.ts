import type {
  HostMode,
  LLMProvider,
  ResidentFeatures,
  RuntimeProviderCapabilities,
} from '@/shared/types.js';

/**
 * The resident-feature matrix, extended with the control-plane verbs this
 * module is the single source of truth for.
 *
 * `stopTask` is stated as an extension of the shared `ResidentFeatures` shape
 * rather than by moving the shape itself: it is a verb AC-196's control handler
 * reads and nothing in the frontend's contract does, so the shared vocabulary
 * stays the frontend's. `backgroundTasks` is the counter-example — it was
 * promoted into `ResidentFeatures` itself (AC-197) because it describes the
 * resident process rather than one control verb's private seam, and the matrix
 * still is the single place its value is stated.
 */
type ResidentFeatureMatrix = ResidentFeatures & {
  /**
   * Whether a resident process can stop one named background task without
   * ending its turn or its process.
   *
   * Default `false` and set `true` only where a driver was measured to hold the
   * verb — the same "unmeasured means unsupported" discipline
   * `authoritativeLeases` still follows. A `false` here is what the stop-task
   * control plane answers `unsupported` for, before it reaches any driver.
   */
  stopTask?: boolean;
};

/**
 * Static, backend-owned description of what one provider integration supports.
 *
 * The frontend renders its composer UI (permission mode picker, image upload,
 * abort button, ...) purely from this shape, which is what keeps the frontend
 * free of per-provider conditionals. New provider features should be exposed
 * here instead of branching on the provider id in React components.
 */
type ProviderCapabilities = {
  provider: LLMProvider;
  /** Permission modes the provider runtime understands, in cycle order. */
  permissionModes: string[];
  defaultPermissionMode: string;
  /** Whether image attachments can be included in a chat.send. */
  supportsImages: boolean;
  /** Whether general file attachments can be included in a chat.send. */
  supportsFiles: boolean;
  /** Whether an in-flight run can be cancelled via chat.abort. */
  supportsAbort: boolean;
  /** Whether interactive tool permission prompts can reach the UI. */
  supportsPermissionRequests: boolean;
  /** Whether the token-usage endpoint has data for this provider. */
  supportsTokenUsage: boolean;
  /** Whether the provider runtime can accept model-level reasoning effort. */
  supportsEffort: boolean;
  /**
   * Whether an already-sent message can be replaced, which requires the
   * provider to re-run a conversation truncated at a chosen point.
   */
  supportsMessageEditing: boolean;
  /**
   * Whether a session's transcript can be branched into an independent one.
   */
  supportsSessionForking: boolean;
  /**
   * Host lifecycle modes the provider's driver implements.
   *
   * `per-run` is universal: every provider here is driven by the session-host
   * manager's default per-run wrapper, which opens one process per turn and
   * never needs a driver at all. A mode beyond that is a statement about the
   * provider's own `IProviderHostDriver`, and it is written here only when the
   * driver the provider mounts really serves that mode — `claude` declares
   * `resident` because its host driver owns the process across turns, and the
   * dispatch in `provider-runtime.service` reads this list before it routes a
   * turn anywhere but the default wrapper.
   *
   * A provider not in the `LLMProvider` union states its own list through
   * `declareRuntimeProviderCapabilities` instead of being added to this table,
   * so this record stays a complete description of the union.
   */
  lifecycleModes: HostMode[];
  /**
   * The lifecycle mode a NEW session of this provider is created with when the
   * caller names none.
   *
   * Deliberately separate from {@link lifecycleModes}: supporting a mode is not
   * the same as defaulting to it. Both facts are stated here, in the one matrix
   * every entry point (the web session gateway, the MCP `session_create` tool,
   * Live Voice's allocation) reads, so no frontend or tool carries its own
   * provider-id branch for "what should a new session be".
   *
   * A provider not in the `LLMProvider` union states its own default through
   * `RuntimeProviderCapabilities.defaultLifecycleMode`; absent there reads as
   * `per-run`, which keeps every provider that never declared one unchanged.
   */
  defaultLifecycleMode: HostMode;
  /**
   * Whether one process may serve several sessions at once. False for every
   * provider in the union: the default wrapper opens one process per turn and
   * never reuses a host, so a second binding is refused rather than multiplexed.
   */
  multiplexedHost: boolean;
  /**
   * What this provider's resident process can do, when it has one.
   *
   * Absent for every provider whose `lifecycleModes` is `['per-run']`: there is
   * no process to describe, and an entry here would be a claim about a driver
   * that does not exist. Present exactly when `lifecycleModes` includes
   * `resident` — see `ResidentFeatures` for why an unmeasured field reads
   * `false` rather than the expected value.
   */
  residentFeatures?: ResidentFeatureMatrix;
};

/**
 * The capability matrix mirrors what each runtime actually implements today:
 * - permission modes match the option sets accepted by each CLI/SDK.
 * - only the Claude SDK integration surfaces interactive permission requests.
 * - Cursor has no token usage endpoint support (its store.db has no usage rows).
 */
const PROVIDER_CAPABILITIES: Record<LLMProvider, ProviderCapabilities> = {
  claude: {
    provider: 'claude',
    permissionModes: ['default', 'auto', 'acceptEdits', 'bypassPermissions', 'plan'],
    defaultPermissionMode: 'default',
    supportsImages: true,
    supportsFiles: true,
    supportsAbort: true,
    supportsPermissionRequests: true,
    supportsTokenUsage: true,
    supportsEffort: true,
    // `resumeSessionAt` re-runs a conversation truncated at a message, and
    // `forkSession` copies a transcript prefix into a new session file.
    supportsMessageEditing: true,
    supportsSessionForking: true,
    // `per-run` is the default wrapper's mode. `resident` is the SDK's held-input
    // protocol: a never-ending prompt stream keeps one CLI alive across turns,
    // and `claude-host-driver.provider.ts` is the driver that owns it. A new
    // session starts resident unless the caller explicitly asks for per-run.
    lifecycleModes: ['per-run', 'resident'],
    defaultLifecycleMode: 'resident',
    multiplexedHost: false,
    // The five measured entries come from the phase-0 experiments E1–E8
    // (`docs/proposals/claude-resident-sessions.md`, "阶段 0 结论"), each with
    // its own experiment number kept beside it. `cancelQueuedInput` was measured
    // after them by E9 and E10/U4, so it carries an experiment number too; the
    // remaining unmeasured entry (`authoritativeLeases`) states the conservative
    // value: a capability nobody measured is not a capability this matrix may
    // promise.
    residentFeatures: {
      interruptKeepsProcess: true, // E4
      // Measured by AC-272's criterion
      // (`server/modules/mcp-gateway/tests/mcp-session-reconfigure.test.ts`),
      // which drives the real resident driver with a scripted query and reads
      // the live verbs off the running process: a `session_reconfigure` patch
      // naming `model` reaches `query.setModel` and one naming `permissionMode`
      // reaches `query.setPermissionMode`, both on the *same* host id and pid as
      // the driver's own `claude-resident-permissions.test.ts` (AC-168). `effort`
      // is deliberately NOT in the list: it is a launch argument folded into the
      // process's env/flags at spawn (see the driver's `reconfigure` comment), so
      // a patch naming it is answered `next-turn` — the same split the MCP tool's
      // `liveSupported` reading reports.
      liveReconfigure: ['model', 'permissionMode'],
      unattendedTurns: true, // E1, E3
      addressable: true, // E6
      inputWhileBusy: true, // E2
      // Measured after E1–E8, in two readings. E9 (2026-09-26) withdrew the
      // *most recently* queued message: the host wrote `cancel_async_message`
      // and the CLI answered a `cancelled` event for exactly that entry. E10/U4
      // (`docs/proposals/claude-resident-sessions-experiments.md`, §E10) withdrew
      // a queued message that was NOT the newest one, and the CLI answered the
      // same `cancelled` event — so the verb is not a special case of "last in".
      // The driver really carries it: `claude-host-driver.provider.ts`'s
      // `cancelQueuedInput()` writes the frame and reads `state=cancelled` as the
      // verdict, and `chat-control.service.ts`'s `cancelQueued`, the MCP
      // `session_cancel_queued` tool (AC-271) and the chat UI's pending-row button
      // all reach it. Nothing in the runtime reads this slot (it is a declaration
      // and the premise the SPEC's inference rests on), so stating the measured
      // value changes no behaviour — it stops the comment trail from reasoning
      // off a value that was never a measurement.
      cancelQueuedInput: true, // E9 (newest queued), E10/U4 (non-newest queued)
      authoritativeLeases: false, // not covered by E1–E8
      // Measured 2026-10-04, which is what moves this off the "unmeasured ⇒
      // false" default the verb above it still takes. A real `query()` against
      // a real CLI (2.1.289, gateway-backed), driven with the resident
      // never-ending stream input, was asked for a background Bash task and then
      // had `Query.stopTask(taskId)` called on it. The CLI answered
      // `task_updated{patch:{status:'killed'}}` + `task_notification{status:'stopped'}`
      // ~1.0s after the call, and the task's own process — alive immediately
      // before the call — was gone immediately after it. Both readings are the
      // ones the dock's stop contract needs (AC-196's event-driven confirmation
      // and AC-199's "the event, not the click, settles the row"), so the verb is
      // a measured capability rather than an inferred one.
      stopTask: true, // measured 2026-10-04: real resident query, stopped in ~1.0s
      // The SDK's `Query.backgroundTasks` verb, which the 2026-10-01 foreground-
      // Bash capture observed answering both `true` (a matching foreground tool)
      // and `false` (not) — but the *resident* control channel's wiring of that
      // verb was never exercised by E1–E8, so it stays off until it is measured.
      // The background-task control plane reads this before any driver: `false`
      // answers `unsupported`, and only a criterion that injects `true` reaches
      // the driver. Same conservative default the other unmeasured verbs take.
      backgroundTasks: false, // not covered by E1–E8
      remoteControl: false, // reserved; forced off for resident processes (§9)
    },
  },
  cursor: {
    provider: 'cursor',
    permissionModes: ['default', 'acceptEdits', 'bypassPermissions', 'plan'],
    defaultPermissionMode: 'default',
    supportsImages: true,
    supportsFiles: true,
    supportsAbort: true,
    supportsPermissionRequests: false,
    supportsTokenUsage: false,
    supportsEffort: false,
    supportsMessageEditing: false,
    supportsSessionForking: false,
    lifecycleModes: ['per-run'],
    defaultLifecycleMode: 'per-run',
    multiplexedHost: false,
  },
  codex: {
    provider: 'codex',
    permissionModes: ['default', 'acceptEdits', 'bypassPermissions'],
    defaultPermissionMode: 'default',
    supportsImages: true,
    supportsFiles: true,
    supportsAbort: true,
    supportsPermissionRequests: false,
    supportsTokenUsage: true,
    supportsEffort: true,
    // Not from the Codex SDK, which only starts and resumes threads: both ride
    // the same CLI's `app-server` protocol, whose `thread/fork` copies a
    // thread up to a chosen turn. Editing is that fork plus a new prompt,
    // which is how Codex's own IDE clients do it.
    supportsMessageEditing: true,
    supportsSessionForking: true,
    // `resident` is the app-server protocol: one process per session held
    // across turns, driven by `codex-host-driver.provider.ts` (AC-441). It is
    // stated here only because that driver really serves the mode. Like Claude,
    // a new Codex session starts resident unless the caller asks for per-run.
    lifecycleModes: ['per-run', 'resident'],
    defaultLifecycleMode: 'resident',
    // One conversation per app-server process — the same reading the driver's
    // own field states (`CodexHostDriver.multiplexedHost`), per yale's ruling
    // that one session owns one app-server.
    multiplexedHost: false,
    // What the locked `@openai/codex 0.153.4` app-server was measured to do
    // (`tmp/codex-appserver-exp-NuPHhk/REPORT.md` E1–E8, 2026-10-29). Each
    // measured entry names the experiment that produced it. A verb no
    // experiment reached stays `false` — the same "unmeasured means
    // unsupported" discipline the claude row follows, so an untested verb is
    // never mistaken for one the driver carries.
    residentFeatures: {
      // E3: after `turn/interrupt` the turn reads `interrupted` and the
      // app-server pid is unchanged for the whole run.
      interruptKeepsProcess: true, // E3
      // E4: `thread/settings/update` is accepted both idle and active and
      // answers `thread/settings/updated`. `turn/settings/update` needs
      // `step_model_switching`, which 0.153.4 reports as "under development:
      // false", so `permissionMode` is NOT listed: E4 never measured an online
      // `permissionMode → (approvalPolicy, sandboxPolicy)` mapping (that is
      // AC-437's subject).
      liveReconfigure: ['model', 'effort'], // E4
      // E2: after a normal `turn/completed` the next queued turn starts with
      // no client action.
      unattendedTurns: true, // E2
      // E1/E6: the same thread id resumes after the first turn and still
      // resumes across app-server processes.
      addressable: true, // E1, E6
      // E2: `thread/queue/add` is accepted while `status=active`.
      inputWhileBusy: true, // E2
      // E2: `thread/queue/delete` removes one named entry and `queue/list`
      // then shows only the other one.
      cancelQueuedInput: true, // E2
      // E5b: an agent-initiated background terminal was never observed. E5's
      // `process/spawn` is client-owned and does not appear in
      // `thread/backgroundTerminals/list`. Unmeasured ⇒ false.
      backgroundTasks: false, // E5b: unmeasured ⇒ false
      // No CLI event declares why a resident app-server is held alive; the
      // busy state is derived by the driver from the turn stream (AC-441).
      // Unmeasured ⇒ false.
      authoritativeLeases: false, // unmeasured: no CLI liveness event ⇒ false
      // E5's `process/kill` only proves a client-owned process can be killed.
      // The resident background-task ledger lands in AC-438/AC-439 and is not
      // wired here, so the driver holds no such verb. Unmeasured ⇒ false.
      stopTask: false, // unmeasured: resident task ledger is AC-438/AC-439 ⇒ false
      // Reserved: reachability through the provider's own remote-control
      // bridge; never measured for codex. Unmeasured ⇒ false.
      remoteControl: false, // unmeasured ⇒ false
    },
  },
  opencode: {
    provider: 'opencode',
    // Mapped by the runtime onto OpenCode's controls: `--agent plan` (plan),
    // `--auto` (bypassPermissions) and the OPENCODE_PERMISSION env var
    // (acceptEdits). See resolveOpenCodePermissionOptions in the OpenCode runtime adapter.
    permissionModes: ['default', 'acceptEdits', 'bypassPermissions', 'plan'],
    defaultPermissionMode: 'default',
    supportsImages: true,
    supportsFiles: true,
    supportsAbort: true,
    supportsPermissionRequests: false,
    supportsTokenUsage: true,
    supportsEffort: true,
    supportsMessageEditing: false,
    supportsSessionForking: false,
    lifecycleModes: ['per-run'],
    defaultLifecycleMode: 'per-run',
    multiplexedHost: false,
  },
};

/**
 * Capabilities stated by providers that are not in the `LLMProvider` union.
 *
 * A separate store, not extra keys in `PROVIDER_CAPABILITIES`, and that
 * separation is the point: the union-keyed table is read by routes that
 * validate a provider id against the union first, so an entry for a
 * CLI-less/SDK-less provider placed there would be unreachable at best and, at
 * worst, would tempt a reader into widening `LLMProvider` to include a provider
 * that cannot serve any user-facing request. Declarations here are made by the
 * provider's own construction path at boot and are absent until then, which is
 * also how a build with the provider gated off reads: no declaration, no row.
 *
 * The registry owns the mutable container as a private field; it used to be a
 * module-level `Map`, and it lives here so every write and read goes through a
 * named method. One instance is created at module scope
 * ({@link runtimeProviderCapabilities}) because the declarations are made by
 * each provider's construction path at boot and read by the same process's
 * routes; a test that needs a clean slate imports the module fresh.
 */
class ProviderCapabilitiesRegistry {
  /** Declarations keyed by provider id; absent means "never declared". */
  private readonly declarations = new Map<string, RuntimeProviderCapabilities>();

  /**
   * Records one declaration as a detached copy.
   *
   * Idempotent and last-write-wins: the declaration is derived from the
   * provider's own driver, so re-declaring the same provider at a second
   * construction point (tests build the registry more than once per process)
   * must not fail or accumulate.
   */
  declare(capabilities: RuntimeProviderCapabilities): void {
    this.declarations.set(capabilities.provider, copyRuntimeCapabilities(capabilities));
  }

  /**
   * Reads one declaration as a detached copy, or `undefined` when nothing
   * declared it — either the provider is gated off in this build, or its
   * construction path never ran.
   */
  get(provider: string): RuntimeProviderCapabilities | undefined {
    const declared = this.declarations.get(provider);
    if (!declared) {
      return undefined;
    }

    return copyRuntimeCapabilities(declared);
  }
}

/** The single capability registry this module's readers and writers share. */
const runtimeProviderCapabilities = new ProviderCapabilitiesRegistry();

/**
 * A detached copy of one declaration.
 *
 * The nested arrays are copied, not just the record: a caller that received the
 * stored declaration and sorted `lifecycleModes` in place would otherwise be
 * editing the matrix every later reader sees. `residentFeatures` and its
 * `liveReconfigure` list get the same treatment for the same reason.
 */
function copyRuntimeCapabilities(
  declared: RuntimeProviderCapabilities,
): RuntimeProviderCapabilities {
  return {
    ...declared,
    lifecycleModes: [...declared.lifecycleModes],
    ...(declared.residentFeatures
      ? {
          residentFeatures: {
            ...declared.residentFeatures,
            liveReconfigure: [...declared.residentFeatures.liveReconfigure],
          },
        }
      : {}),
  };
}

/**
 * Application service exposing the provider capability matrix.
 */
export const providerCapabilitiesService = {
  getProviderCapabilities(provider: LLMProvider): ProviderCapabilities {
    return PROVIDER_CAPABILITIES[provider];
  },

  /**
   * The lifecycle mode a new session of `provider` is created with when the
   * caller states none.
   *
   * The ONE answer the session gateway, the MCP `session_create` adapter and
   * every other creation path share. Reads the union matrix first and the
   * runtime registry second, so a provider outside `LLMProvider` that declared
   * a default is honoured; a provider that declared nothing (or an unknown id)
   * reads as `per-run`, which is the row's own DB default and the behaviour
   * every provider had before this declaration existed.
   */
  resolveDefaultLifecycleMode(provider: string): HostMode {
    const declared = PROVIDER_CAPABILITIES[provider as LLMProvider]?.defaultLifecycleMode
      ?? runtimeProviderCapabilities.get(provider)?.defaultLifecycleMode;
    return declared ?? 'per-run';
  },

  /**
   * The lifecycle modes `provider` implements, read the same way
   * {@link resolveDefaultLifecycleMode} reads the default: the union matrix
   * first, the runtime registry second.
   *
   * Creation validates an explicitly requested mode against this list, so a
   * provider outside the union (the debug agent, a plugin host) is refused or
   * accepted on its OWN declaration rather than looking like a provider that
   * implements nothing. A provider nobody declared reads as the empty list.
   */
  resolveLifecycleModes(provider: string): HostMode[] {
    const declared = PROVIDER_CAPABILITIES[provider as LLMProvider]?.lifecycleModes
      ?? runtimeProviderCapabilities.get(provider)?.lifecycleModes;
    return declared === undefined ? [] : [...declared];
  },

  listAllProviderCapabilities(): ProviderCapabilities[] {
    return Object.values(PROVIDER_CAPABILITIES);
  },

  /**
   * Records the lifecycle facts of one non-union provider via the registry;
   * see {@link ProviderCapabilitiesRegistry.declare} for the copy and
   * last-write-wins semantics.
   */
  declareRuntimeProviderCapabilities(capabilities: RuntimeProviderCapabilities): void {
    runtimeProviderCapabilities.declare(capabilities);
  },

  /**
   * Reads one non-union provider's declaration via the registry; the returned
   * row is a detached copy, or `undefined` when nothing declared it.
   */
  getRuntimeProviderCapabilities(provider: string): RuntimeProviderCapabilities | undefined {
    return runtimeProviderCapabilities.get(provider);
  },
};

/**
 * The upstream-provider binding a session carries (AC-462).
 *
 * WHY A SESSION HAS ONE. A custom model entry may name the Codex provider it
 * dials (`codexProviderId`, AC-461). Codex records that provider inside the
 * thread it starts and checks it again on every resume: a thread started under
 * provider `bob` refuses a turn when the process is launched under `alice`
 * (`modelProviderMismatch`). The binding therefore belongs to the SESSION, not
 * only to the model currently selected — changing the model of a running
 * session to one from another provider does not switch providers, it breaks
 * the conversation. A session that has run under a bound provider must be
 * forked or recreated to run under a different one.
 *
 * WHAT THIS FILE OWNS. The three answers every reader needs, and nothing else:
 *   1. which provider id a selected model resolves to;
 *   2. whether a recorded id still names a provider the project defines (a
 *      deleted or renamed provider is MARKED, never silently replaced by the
 *      provider default);
 *   3. whether a switch from the recorded id to the requested one is allowed.
 *
 * TWO ABSENCES ARE DIFFERENT. `model_provider_id` NULL means "no binding has
 * been recorded" — an unbound model, a session from before the column, or one
 * that has never been sent on. NULL is NOT "the default provider", so a
 * selection may establish a binding on such a session; once recorded, the
 * binding only ever changes through a new session. A model that declares no
 * provider resolves to NULL, and moving a BOUND session to it is a switch
 * (it would run under Codex's process-global provider) and is refused.
 *
 * WHAT THIS FILE DOES NOT DO. It never writes rows, never reads settings, and
 * never imports a feature module: the registry is handed in as a reading (the
 * shared port's `CodexProviderRegistryReading`) and the catalog as the one
 * lookup it needs. `provider-models.service.ts` composes it with both.
 *
 * Consumers: `provider-models.service.ts` (recording and resolving a session's
 * selection) and, through it, `chat-websocket.service.ts` (the pre-admission
 * refusal of a send that would switch providers).
 */
import type { CodexProviderRegistryReading } from '@/shared/ports/codex-provider-registry.port.js';
import type { CustomProviderModelRecord, LLMProvider } from '@/shared/types.js';
import { AppError } from '@/shared/utils.js';

/** The catalog lookup a binding reading needs; `providerModelsDb` satisfies it. */
export type SessionProviderBindingCatalog = {
  findCustomProviderModelByModelId(
    provider: LLMProvider,
    modelId: string,
  ): CustomProviderModelRecord | null;
};

/**
 * A recorded binding as a reader should see it.
 *
 * `modelProviderProblem` is the explicit mark the AC asks for instead of a
 * silent fallback: it is non-null only when the session carries an upstream
 * provider id the registry no longer defines, and it names the id and the way
 * out. `modelProviderId` is always the recorded value, unchanged — a provider
 * that disappeared must not make the session look unbound.
 */
export type SessionProviderBinding = {
  modelProviderId: string | null;
  modelProviderProblem: string | null;
};

/**
 * The upstream provider a selected model runs under, or null when it declares
 * none (the entry inherits the provider's own default).
 *
 * The value is read from the model entry, never from the session: the session
 * only records what the entry said at the time it first ran.
 */
export function resolveModelProviderId(
  catalog: SessionProviderBindingCatalog,
  provider: LLMProvider,
  modelId: string,
): string | null {
  const record = catalog.findCustomProviderModelByModelId(provider, modelId);
  return record?.config?.codexProviderId?.trim() || null;
}

/**
 * Whether the registry defines this id.
 *
 * A project entry and a Codex built-in both count: a model may bind either
 * (`RESERVED_CODEX_PROVIDER_IDS` is the settings source's list, carried here as
 * data). An absent reading cannot judge, so it answers true — refusing every
 * selection merely because the composition root has not installed the port yet
 * would break the callers that ran before this feature existed.
 */
function isKnownProvider(registry: CodexProviderRegistryReading | null, providerId: string): boolean {
  if (registry === null) {
    return true;
  }
  return registry.reservedIds.includes(providerId)
    || registry.providers.some((provider) => provider.id === providerId);
}

/**
 * Reads a recorded provider id plus, when the registry no longer defines it,
 * the readable mark that says so.
 *
 * The model itself is NEVER re-resolved here: a session whose provider was
 * deleted keeps the model it ran with, so every reader still shows what the
 * conversation actually used. Falling back to the catalog default is the exact
 * silent change this mark exists to prevent.
 */
export function readRecordedProviderBinding(
  registry: CodexProviderRegistryReading | null,
  providerId: string | null,
): SessionProviderBinding {
  if (!providerId) {
    return { modelProviderId: null, modelProviderProblem: null };
  }
  if (isKnownProvider(registry, providerId)) {
    return { modelProviderId: providerId, modelProviderProblem: null };
  }
  return {
    modelProviderId: providerId,
    modelProviderProblem:
      `This session is bound to provider "${providerId}", which is no longer defined. `
      + 'Fork this session or start a new one to run it under another provider.',
  };
}

/**
 * Refuses moving an already-bound session to a selection that runs under a
 * different upstream provider.
 *
 * Returns silently when the session has no recorded binding (any selection may
 * establish one), or when the requested model resolves to the same id (another
 * model on the same provider is an ordinary model switch).
 *
 * The refusal names both ids and the action, because "cannot switch" without
 * "here is what to do instead" leaves the person with a dead composer.
 */
export function assertProviderSwitchAllowed(
  recordedProviderId: string | null,
  requestedProviderId: string | null,
  requestedModel: string,
): void {
  if (!recordedProviderId || requestedProviderId === recordedProviderId) {
    return;
  }
  const attempted = requestedProviderId === null
    ? 'a model that inherits the provider default'
    : `provider "${requestedProviderId}"`;
  throw new AppError(
    `This session is bound to provider "${recordedProviderId}"; `
    + `model "${requestedModel}" runs under ${attempted}. A session cannot change upstream `
    + 'provider in place — fork this session or start a new one to switch.',
    { code: 'SESSION_PROVIDER_MISMATCH', statusCode: 409 },
  );
}

/**
 * Refuses recording a binding the registry does not know.
 *
 * A model entry can outlive the provider it names (the provider registry is a
 * full-file replacement, so deleting or renaming an entry leaves every model
 * entry bound to the old id pointing at nothing). Recording such an id would
 * make a fresh session look bound to a provider that cannot be launched, so the
 * selection is refused with the id and the two ways out.
 */
export function assertProviderAvailable(
  registry: CodexProviderRegistryReading | null,
  providerId: string | null,
  requestedModel: string,
): void {
  if (!providerId || isKnownProvider(registry, providerId)) {
    return;
  }
  throw new AppError(
    `Model "${requestedModel}" is bound to provider "${providerId}", which no longer exists. `
    + 'Pick another model, or restore the provider in the Codex provider settings.',
    { code: 'SESSION_PROVIDER_UNKNOWN', statusCode: 409 },
  );
}

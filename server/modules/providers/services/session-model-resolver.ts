/**
 * Which model — and which upstream provider binding — one session runs with.
 *
 * WHY IT IS ITS OWN FILE. The answer has four sources of truth in a fixed
 * precedence (the recorded row, the provider's own session state, the client's
 * requested default, the provider catalog default), and it must agree across
 * the `/models` picker, `/cost`, `/status`, the active-model route and both
 * runtimes. Keeping it beside the catalog CRUD made `provider-models.service.ts`
 * the module's every-concern file; this is the display/resume half, with the
 * catalog and row access injected so the service stays the composition root.
 *
 * THE UPSTREAM PROVIDER RIDES ALONG. A session may record the upstream
 * provider its model was bound to (`model_provider_id`). A reader gets that id
 * back unchanged, plus the explicit mark when the registry no longer defines it
 * — the model is never re-resolved from the catalog default because a provider
 * disappeared. See `session-provider-binding.ts`.
 *
 * Consumers: `provider-models.service.ts` only. Every other module reaches
 * these answers through `providerModelsService`, which composes this factory.
 */
import type { CodexProviderRegistryReading } from '@/shared/ports/codex-provider-registry.port.js';
import type {
  LLMProvider,
  ProviderCurrentActiveModel,
  ProviderModelsDefinition,
  ProviderSessionModel,
} from '@/shared/types.js';

import { readRecordedProviderBinding } from './session-provider-binding.js';

/**
 * The selection recorded on one session row, as the resolver reads it.
 *
 * NULL in any member means "not recorded", which is a real answer for each:
 * the model falls through to the provider's own state, the effort and
 * permission mode have no provider-side source, and the provider id means no
 * binding was ever established for this conversation.
 */
export type RecordedSessionSelection = {
  model: string | null;
  effort: string | null;
  permissionMode: string | null;
  modelProviderId: string | null;
};

/** The reads a model resolution needs, injected by the composition root. */
export type SessionModelResolverDependencies = {
  /** The session row's recorded selection, or null when no row has that id. */
  readRecordedSelection(sessionId: string): RecordedSessionSelection | null;
  /** The installed upstream-provider registry, or null when none is wired. */
  readCodexRegistry(): CodexProviderRegistryReading | null;
  /** The provider's catalog merged with its custom model rows. */
  getProviderModels(provider: LLMProvider): Promise<ProviderModelsDefinition>;
  /** The model the provider itself reports for one of its session ids. */
  getCurrentActiveModel(provider: LLMProvider, sessionId?: string): Promise<ProviderCurrentActiveModel>;
};

export function createSessionModelResolver(dependencies: SessionModelResolverDependencies) {
  const { readRecordedSelection, readCodexRegistry, getProviderModels, getCurrentActiveModel } = dependencies;

  /**
   * Answers "which model is this session using?" for every display surface.
   *
   * Precedence, highest first:
   *   1. the model recorded on the session row;
   *   2. the provider's own session state for externally-created sessions;
   *   3. `requestedModel`, the client's current default;
   *   4. the source-controlled provider catalog default.
   *
   * The permission mode rides along unchanged: it has no provider-side source
   * and no client-supplied fallback (the client is not allowed to persist one),
   * so the only two answers are the recorded mode or NULL for "never sent one".
   *
   * The upstream provider id and its problem mark come from the session row
   * alone (see the file header): no branch below ever rewrites the model
   * because the provider it was bound to is gone.
   */
  const resolveSessionModel = async (
    provider: LLMProvider,
    options: { sessionId?: string | null; requestedModel?: string | null } = {},
  ): Promise<ProviderSessionModel> => {
    const normalizedSessionId = typeof options.sessionId === 'string' ? options.sessionId.trim() : '';
    const normalizedRequestedModel = typeof options.requestedModel === 'string'
      ? options.requestedModel.trim()
      : '';

    if (normalizedSessionId) {
      const recordedSelection = readRecordedSelection(normalizedSessionId);
      const binding = readRecordedProviderBinding(
        readCodexRegistry(),
        recordedSelection?.modelProviderId ?? null,
      );
      if (recordedSelection?.model) {
        return {
          provider,
          sessionId: normalizedSessionId,
          model: recordedSelection.model,
          effort: recordedSelection.effort,
          permissionMode: recordedSelection.permissionMode,
          ...binding,
          source: 'session',
        };
      }

      const providerCatalog = await getProviderModels(provider);
      const providerModel = await getCurrentActiveModel(provider, normalizedSessionId);
      const resolvedProviderModel = providerModel.model?.trim();
      if (resolvedProviderModel && resolvedProviderModel !== providerCatalog.DEFAULT) {
        return {
          provider,
          sessionId: normalizedSessionId,
          model: resolvedProviderModel,
          effort: recordedSelection?.effort ?? null,
          permissionMode: recordedSelection?.permissionMode ?? null,
          ...binding,
          source: 'provider',
        };
      }

      return {
        provider,
        sessionId: normalizedSessionId,
        model: normalizedRequestedModel || providerCatalog.DEFAULT,
        effort: recordedSelection?.effort ?? null,
        permissionMode: recordedSelection?.permissionMode ?? null,
        ...binding,
        source: normalizedRequestedModel ? 'session' : 'default',
      };
    }

    if (normalizedRequestedModel) {
      return {
        provider,
        sessionId: null,
        model: normalizedRequestedModel,
        effort: null,
        permissionMode: null,
        modelProviderId: null,
        modelProviderProblem: null,
        source: 'session',
      };
    }

    const providerCatalog = await getProviderModels(provider);
    return {
      provider,
      sessionId: null,
      model: providerCatalog.DEFAULT,
      effort: null,
      permissionMode: null,
      modelProviderId: null,
      modelProviderProblem: null,
      source: 'default',
    };
  };

  /**
   * Picks the model one resumed provider run should use.
   *
   * Provider-global state is deliberately ignored because it must never
   * override the model explicitly selected in the composer.
   */
  const resolveResumeModel = async (
    provider: LLMProvider,
    sessionId: string | undefined,
    requestedModel?: string | null,
  ): Promise<string | undefined> => {
    void provider;
    const normalizedRequestedModel = typeof requestedModel === 'string' ? requestedModel.trim() : '';
    const normalizedSessionId = sessionId?.trim();
    if (!normalizedSessionId) {
      return normalizedRequestedModel || undefined;
    }

    const recordedModel = readRecordedSelection(normalizedSessionId)?.model;
    return recordedModel || normalizedRequestedModel || undefined;
  };

  return { resolveSessionModel, resolveResumeModel };
}

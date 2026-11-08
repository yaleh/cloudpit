

//----------------- PROVIDER MESSAGE MODEL ------------
/**
 * Providers supported by the unified server runtime.
 *
 * Use this as the source of truth whenever a function or payload needs to identify
 * a specific LLM integration.
 */
export type LLMProvider = 'claude' | 'codex' | 'cursor' | 'opencode';

/**
 * The user- or assistant-authored prose one provider transcript row carries.
 *
 * This is the provider-neutral contract for "what did this conversation SAY", used by readers
 * that only need the message text and its instant (the Quay session-mentions reading). It is
 * deliberately narrower than `NormalizedMessage`: no ids, tool calls, attachments or origin, so a
 * consumer cannot mistake a rendered transcript row for something the conversation mentioned.
 * Only the provider that owns a transcript format can produce it — each provider implements
 * `IProviderSessions.readTranscriptMessage`.
 *
 * `text` is the prose of the row after the provider's own visibility rules (internal injections,
 * tool calls/results, thinking/reasoning, command wrappers and duplicate carriers are already
 * excluded). `timestamp` is the row's own instant as the transcript printed it, or `null` when
 * the row carries none.
 */
export type ProviderTranscriptMessage = {
  role: 'user' | 'assistant';
  text: string;
  timestamp: string | null;
};

/**
 * One selectable model row in a provider model catalog.
 */
export type ProviderModelOption = {
  value: string;
  label: string;
  description?: string;
  /** Stable SQLite row id used only by model-management actions. */
  recordId?: number;
  /** True for user-created rows; false for immutable Cloudpit defaults. */
  isCustom?: boolean;
  /** Custom-model env config as returned to clients; secret values are never included. */
  config?: ProviderModelPublicConfig | null;
  /**
   * The upstream provider this row runs under (a Codex `model_providers.<id>`
   * id). Absent means the row inherits the provider's own default. A built-in
   * model is offered once bare (absent) and once per registered provider, so
   * those rows share `value` and differ only by this field.
   */
  modelProviderId?: string;
  effort?: {
    default?: string;
    values: {
      value: string;
      description?: string;
    }[];
  };
  /**
   * The context window a catalog entry declares for this model, in tokens.
   * When present it is the fact source a Codex launch passes as
   * `model_context_window`, the same tier a Claude profile's window occupies.
   */
  contextWindow?: number;
  /** The catalog entry's auto-compaction threshold (`model_auto_compact_token_limit`). */
  autoCompactTokenLimit?: number;
};

/**
 * Provider model catalog returned by `GET /api/providers/:provider/models`.
 */
export type ProviderModelsDefinition = {
  OPTIONS: ProviderModelOption[];
  DEFAULT: string;
};

/**
 * One persisted custom-model row in the provider model library.
 *
 * Provider modules use this shape at the database boundary. Predefined models
 * never use this type because they remain source-controlled in provider
 * adapters. `modelId` is sent to the provider runtime, while `model` is the
 * user-supplied display name shown in pickers.
 */
export type CustomProviderModelRecord = {
  recordId: number;
  provider: LLMProvider;
  modelId: string;
  model: string;
  sortOrder: number;
  config: ProviderModelConfig | null;
};

/**
 * User-editable values accepted when creating or changing a custom model.
 *
 * `id` must be the exact provider-facing model identifier and cannot contain
 * whitespace. `model` is a concise display name. The provider is supplied by
 * the route path so a row can never be moved across providers accidentally.
 */
export type CustomProviderModelInput = {
  id: string;
  model: string;
  /** `undefined` leaves stored config untouched (update) or none (create); `null` clears it. */
  config?: ProviderModelConfig | null;
};

/**
 * One env row of a custom model's config. `kind` selects the semantics:
 * `value` sets a literal, `secret` sets a write-only literal, `envref` reads
 * the host variable named in `value`, and `unset` removes the variable (no
 * `value`). `key` must pass the launch env allowlist.
 */
export type ProviderModelEnvRow = {
  key: string;
  kind: 'value' | 'secret' | 'envref' | 'unset';
  value?: string;
};

/**
 * Client-facing env row: identical to the stored row except that a secret
 * carries only `isSet` and never its value.
 */
export type ProviderModelPublicEnvRow =
  | { key: string; kind: 'value' | 'envref'; value?: string }
  | { key: string; kind: 'unset' }
  | { key: string; kind: 'secret'; isSet: true };

export type ProviderModelPublicConfig = {
  /**
   * The project Codex upstream provider a Codex model entry runs against.
   * Absent means "inherit the Codex global default" (`openai`), which is the
   * behaviour every pre-existing row keeps. Never a secret: it is a provider
   * id from the project-owned Codex provider registry.
   */
  codexProviderId?: string;
  env: ProviderModelPublicEnvRow[];
};

/**
 * Per-model config stored in `provider_models.config_json`. `env` is ordered
 * and each key may appear at most once.
 *
 * `codexProviderId` names the project-owned Codex upstream provider this model
 * entry runs against. It is optional: an entry that omits it inherits the Codex
 * global default, which is what every row written before the provider registry
 * existed does. The Providers service refuses a value that names no existing
 * registry entry (409) rather than persisting a dangling reference, so the id
 * is resolved against the live registry at write time.
 */
export type ProviderModelConfig = {
  codexProviderId?: string;
  env: ProviderModelEnvRow[];
};

// ---------------------------

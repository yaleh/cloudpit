import { readFile } from 'node:fs/promises';
import { createRequire } from 'node:module';
import os from 'node:os';
import path from 'node:path';

import TOML from '@iarna/toml';

import {
  codexAppServer,
  type CodexModelDescriptor,
} from '@/modules/providers/list/codex/app-server/index.js';
import type { IProviderModels } from '@/shared/interfaces.js';
import {
  readCodexProviderRegistryPort,
  type CodexProviderRegistryReading,
  type CodexUpstreamProviderResolution,
  type ResolvedCodexUpstreamProvider,
} from '@/shared/ports/codex-provider-registry.port.js';
import type {
  ProviderCurrentActiveModel,
  ProviderModelOption,
  ProviderModelsDefinition,
} from '@/shared/types.js';
import {
  buildDefaultProviderCurrentActiveModel,
  readObjectRecord,
  readOptionalString,
} from '@/shared/utils.js';

/**
 * Curated Codex catalog, now the FALLBACK for live discovery.
 *
 * `CodexProviderModels` reads the packaged CLI's own `model/list` and only
 * answers this constant when that read fails, times out, or comes back empty.
 * The entries are the `hidden === false` half of the `model/list` reply measured
 * on `@openai/codex 0.166.0` (2026-10-30) against the signed-in account. That
 * reading is 8 models; the bundled catalog of the same version also lists
 * `gpt-5.5`, which the account refresh drops, so it is deliberately absent here
 * — the picker offers what the runtime will accept, not what the offline bundle
 * happens to ship. Value, label, description, each model's default effort and
 * its supported effort values are copied from the reply, and `DEFAULT` is the
 * one entry the CLI marks `isDefault`. The membership claim is what
 * `provider-models.service.test.ts` re-reads against the packaged CLI, so a
 * refresh is only ever a re-measurement — never a hand-curated guess.
 */
export const CODEX_PREDEFINED_MODELS: ProviderModelsDefinition = {
  OPTIONS: [
    {
      value: 'gpt-6.1-sol',
      label: 'GPT-6.1-Sol',
      description: 'Latest workhorse model for coding and everyday work.',
      effort: {
        default: 'low',
        values: [
          { value: 'low' },
          { value: 'medium' },
          { value: 'high' },
          { value: 'xhigh' },
          { value: 'max' },
          { value: 'ultra' },
        ],
      },
    },
    {
      value: 'gpt-6-astra',
      label: 'GPT-6-Astra',
      description: 'Frontier intelligence for the most demanding work.',
      effort: {
        default: 'low',
        values: [
          { value: 'low' },
          { value: 'medium' },
          { value: 'high' },
          { value: 'xhigh' },
          { value: 'max' },
          { value: 'ultra' },
        ],
      },
    },
    {
      value: 'gpt-6-sol',
      label: 'GPT-6-Sol',
      description: 'Previous generation workhorse model.',
      effort: {
        default: 'medium',
        values: [
          { value: 'low' },
          { value: 'medium' },
          { value: 'high' },
          { value: 'xhigh' },
          { value: 'max' },
          { value: 'ultra' },
        ],
      },
    },
    {
      value: 'gpt-6-luna',
      label: 'GPT-6-Luna',
      description: 'Fast and affordable model for easier tasks.',
      effort: {
        default: 'medium',
        values: [
          { value: 'low' },
          { value: 'medium' },
          { value: 'high' },
          { value: 'xhigh' },
          { value: 'max' },
        ],
      },
    },
    {
      value: 'gpt-5.6-sol',
      label: 'GPT-5.6-Sol',
      description: 'Older generation workhorse model.',
      effort: {
        default: 'low',
        values: [
          { value: 'low' },
          { value: 'medium' },
          { value: 'high' },
          { value: 'xhigh' },
          { value: 'max' },
          { value: 'ultra' },
        ],
      },
    },
    {
      value: 'gpt-6.1-terra',
      label: 'GPT-6.1 Terra',
      description: 'GPT-6.1 Terra Codex model.',
      effort: {
        default: 'low',
        values: [
          { value: 'low' },
          { value: 'medium' },
          { value: 'high' },
          { value: 'xhigh' },
          { value: 'max' },
          { value: 'ultra' },
        ],
      },
    },
    {
      value: 'gpt-5.6-terra',
      label: 'GPT-5.6-Terra',
      description: 'Older balanced model for straightforward work.',
      effort: {
        default: 'medium',
        values: [
          { value: 'low' },
          { value: 'medium' },
          { value: 'high' },
          { value: 'xhigh' },
          { value: 'max' },
          { value: 'ultra' },
        ],
      },
    },
    {
      value: 'gpt-5.6-luna',
      label: 'GPT-5.6-Luna',
      description: 'Older fast and efficient model.',
      effort: {
        default: 'medium',
        values: [
          { value: 'low' },
          { value: 'medium' },
          { value: 'high' },
          { value: 'xhigh' },
          { value: 'max' },
        ],
      },
    },
  ],
  DEFAULT: 'gpt-6.1-sol',
};

const CODEX_CONFIG_PATH = path.join(os.homedir(), '.codex', 'config.toml');

/** Where the catalog answered by the most recent read came from. */
export type CodexCatalogSource = 'live' | 'cache' | 'fallback';

/** Injection seams for the discovery read, its clock, and the provider registry. */
export type CodexProviderModelsDependencies = {
  listModels?: () => Promise<CodexModelDescriptor[] | null>;
  now?: () => number;
  cacheKey?: () => string;
  /** The project-registered upstream providers the picker expands variants for. */
  readProviders?: () => CodexProviderRegistryReading | null;
  /** Resolves one registered provider to its endpoint + secret (the spawn-time lookup). */
  resolveProvider?: (id: string) => CodexUpstreamProviderResolution | null;
  /** Fetch seam for reading a provider's own model list; defaults to the global fetch. */
  fetchFn?: typeof fetch;
};

/** How long a successfully discovered catalog is reused. */
const CATALOG_TTL_MS = 5 * 60_000;

/**
 * How long a failed discovery is remembered.
 *
 * Not the full TTL: a transient spawn failure must not hide a working CLI for
 * five minutes, but a broken one must not be respawned on every keystroke.
 */
const CATALOG_FAILURE_TTL_MS = 30_000;

type CatalogCacheEntry = {
  key: string;
  models: ProviderModelsDefinition;
  source: 'live' | 'fallback';
  expiresAt: number;
};

const resolvePackagedCliVersion = (): string => {
  try {
    const require_ = createRequire(import.meta.url);
    const pkg = require_('@openai/codex/package.json') as { version?: unknown };
    return readOptionalString(pkg.version) ?? 'unknown';
  } catch {
    return 'unknown';
  }
};

/**
 * The catalog is a property of one CLI binary in one Codex home: a different
 * packaged version ships a different catalog, and `CODEX_HOME` can point at a
 * different account. Both are read per call so a test (or a settings change)
 * that swaps either is not served a stale entry.
 */
const defaultCatalogCacheKey = (): string => `${resolvePackagedCliVersion()}|${process.env.CODEX_HOME ?? ''}`;

const toCodexModelOption = (model: CodexModelDescriptor): ProviderModelOption => {
  const effortValues = (model.supportedReasoningEfforts ?? [])
    .filter((effort): effort is { reasoningEffort: string; description?: string } => (
      typeof effort.reasoningEffort === 'string' && effort.reasoningEffort.length > 0
    ))
    .map((effort) => ({
      value: effort.reasoningEffort,
      ...(effort.description === undefined ? {} : { description: effort.description }),
    }));

  return {
    value: model.id,
    label: model.displayName ?? model.id,
    ...(model.description === undefined ? {} : { description: model.description }),
    ...(effortValues.length === 0 ? {} : {
      effort: {
        ...(model.defaultReasoningEffort === undefined
          ? {}
          : { default: model.defaultReasoningEffort }),
        values: effortValues,
      },
    }),
    // A catalog entry's own window/threshold is the fact source for the launch
    // when it declares one; the Codex runtime lifts these into
    // `model_context_window` / `model_auto_compact_token_limit` overrides.
    ...(model.modelContextWindow === undefined
      ? {}
      : { contextWindow: model.modelContextWindow }),
    ...(model.modelAutoCompactTokenLimit === undefined
      ? {}
      : { autoCompactTokenLimit: model.modelAutoCompactTokenLimit }),
  };
};

/**
 * Maps the CLI's descriptors to the picker contract.
 *
 * Only `hidden === false` entries are offered; `isDefault` names `DEFAULT`.
 * `ProviderModelsDefinition` requires a format, so the caller guarantees a
 * non-empty list.
 */
const toProviderModelsDefinition = (models: CodexModelDescriptor[]): ProviderModelsDefinition => {
  const options = models.map(toCodexModelOption);
  return {
    OPTIONS: options,
    DEFAULT: models.find((model) => model.isDefault === true)?.id ?? options[0].value,
  };
};

/** How long a provider's own model list is reused. */
const PROVIDER_MODELS_TTL_MS = 5 * 60_000;

/**
 * Reads one registered provider's OWN model list, or null when it cannot be
 * read.
 *
 * A custom provider serves its own models, not the Codex default catalog, so a
 * variant row must be a model that endpoint actually accepts. The endpoint is
 * the provider's `model_catalog_url` when it declares one, otherwise its
 * `base_url`'s `/v1/models`; the token-file secret authenticates the read and
 * never leaves this function. A non-2xx, a non-`{data:[{id}]}` shape, a
 * timeout, or a transport error all answer null — a provider whose models
 * cannot be read contributes no variant rows, never a fabricated one.
 */
const fetchProviderModels = async (
  provider: ResolvedCodexUpstreamProvider,
  fetchFn: typeof fetch,
): Promise<string[] | null> => {
  const catalogUrl = provider.modelCatalogUrl?.trim()
    || `${provider.baseUrl.replace(/\/+$/, '')}/models`;
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), 5_000);
  try {
    const response = await fetchFn(catalogUrl, {
      signal: controller.signal,
      headers: {
        ...(provider.secret === '' ? {} : { Authorization: `Bearer ${provider.secret}` }),
        ...(provider.httpHeaders ?? {}),
      },
    });
    if (!response.ok) {
      return null;
    }
    const body = await response.json() as { data?: unknown };
    if (!Array.isArray(body.data)) {
      return null;
    }
    const ids = body.data
      .map((entry) => (entry as { id?: unknown }).id)
      .filter((id): id is string => typeof id === 'string' && id.trim() !== '');
    return ids.length === 0 ? null : ids;
  } catch {
    return null;
  } finally {
    clearTimeout(timeout);
  }
};

/**
 * Provider registry model adapter for Codex.
 *
 * The source-controlled catalog is no longer the only source: the adapter asks
 * the packaged CLI's app-server for `model/list` and answers that when it can
 * (5-minute memory cache, single-flight, no persistence). The static catalog is
 * the offline fallback, and a failed read is cached for 30 seconds so a broken
 * CLI is not respawned on every catalog read.
 */
export class CodexProviderModels implements IProviderModels {
  /**
   * Codex threads record the upstream provider they started under, so a model
   * selection may name one; the model write path records it on the session row.
   */
  readonly bindsUpstreamProvider = true;

  private readonly listModels: () => Promise<CodexModelDescriptor[] | null>;

  private readonly now: () => number;

  private readonly cacheKey: () => string;

  private readonly readProviders: () => CodexProviderRegistryReading | null;

  private readonly resolveProvider: (id: string) => CodexUpstreamProviderResolution | null;

  private readonly fetchFn: typeof fetch;

  /** Per-provider model lists, keyed by provider id; only successes are cached. */
  private readonly providerModelsCache = new Map<string, { models: string[]; expiresAt: number }>();

  private cached: CatalogCacheEntry | null = null;

  private inflight: { key: string; promise: Promise<ProviderModelsDefinition> } | null = null;

  private source: CodexCatalogSource = 'fallback';

  constructor(dependencies: CodexProviderModelsDependencies = {}) {
    this.listModels = dependencies.listModels ?? (() => codexAppServer.listModels());
    this.now = dependencies.now ?? Date.now;
    this.cacheKey = dependencies.cacheKey ?? defaultCatalogCacheKey;
    // Read lazily like every other port consumer: the settings module installs
    // the reading at boot, which may evaluate after this adapter is constructed.
    this.readProviders = dependencies.readProviders ?? (() => readCodexProviderRegistryPort()?.read() ?? null);
    this.resolveProvider = dependencies.resolveProvider
      ?? ((id) => readCodexProviderRegistryPort()?.resolve?.(id) ?? null);
    this.fetchFn = dependencies.fetchFn ?? fetch;
  }

  /**
   * Source of the catalog the most recent `getSupportedModels()` answered.
   *
   * DoD reads this to prove a read really came from the CLI rather than from
   * the constant. A cached live catalog reads `cache`; a cached failure reads
   * `fallback` (the answer is the constant either way).
   */
  lastCatalogSource(): CodexCatalogSource {
    return this.source;
  }

  /**
   * The picker catalog: the discovered/fallback built-ins (bare, inherit the
   * Codex default) plus, for each project-registered provider, that provider's
   * OWN models as `(model, provider id)` rows.
   *
   * A custom provider does not serve the Codex default catalog, so its variants
   * are read from the provider's endpoint — never from the built-in list. The
   * expansion is applied to the ANSWER, not to the cache: discovery is a
   * property of the CLI binary and account, while the registered providers come
   * from the settings file and change independently of it.
   */
  async getSupportedModels(): Promise<ProviderModelsDefinition> {
    const definition = await this.readCatalog();
    const providerIds = [...new Set(
      (this.readProviders()?.providers ?? [])
        .map((provider) => provider.id.trim())
        .filter((id) => id.length > 0),
    )];
    if (providerIds.length === 0) {
      return definition;
    }

    const variants: ProviderModelOption[] = [];
    for (const providerId of providerIds) {
      const models = await this.readProviderModels(providerId);
      if (models === null) {
        continue;
      }
      for (const modelId of models) {
        variants.push({
          value: modelId,
          label: `${modelId} · ${providerId}`,
          modelProviderId: providerId,
          isCustom: false,
        });
      }
    }

    return {
      OPTIONS: [...definition.OPTIONS, ...variants],
      DEFAULT: definition.DEFAULT,
    };
  }

  /** Reads one provider's own models, cached; a failed read answers null. */
  private async readProviderModels(providerId: string): Promise<string[] | null> {
    const cached = this.providerModelsCache.get(providerId);
    if (cached && this.now() < cached.expiresAt) {
      return cached.models;
    }
    const resolved = this.resolveProvider(providerId);
    if (!resolved?.ok) {
      return null;
    }
    const models = await fetchProviderModels(resolved.provider, this.fetchFn);
    if (models !== null) {
      this.providerModelsCache.set(providerId, {
        models,
        expiresAt: this.now() + PROVIDER_MODELS_TTL_MS,
      });
    }
    return models;
  }

  private async readCatalog(): Promise<ProviderModelsDefinition> {
    const key = this.cacheKey();
    if (this.cached?.key === key && this.now() < this.cached.expiresAt) {
      this.source = this.cached.source === 'live' ? 'cache' : 'fallback';
      // One line per read, so an operator can tell a cached answer from a
      // fresh CLI spawn without a debugger attached.
      console.log(`[codex-models] catalog read source=${this.source} models=${this.cached.models.OPTIONS.length}`);
      return this.cached.models;
    }

    // Single-flight: a concurrent cold read joins the discovery in progress
    // instead of spawning a second CLI. The joined read reports the source the
    // discovery itself recorded.
    const inflight = this.inflight;
    if (inflight?.key === key) {
      return inflight.promise;
    }

    const promise = this.discover(key);
    this.inflight = { key, promise };
    try {
      return await promise;
    } finally {
      if (this.inflight?.promise === promise) {
        this.inflight = null;
      }
    }
  }

  private async discover(key: string): Promise<ProviderModelsDefinition> {
    console.log('[codex-models] model/list discovery started');
    let models: CodexModelDescriptor[] | null = null;
    try {
      models = await this.listModels();
    } catch {
      models = null;
    }

    const visible = (models ?? []).filter((model) => model.hidden === false);
    console.log(`[codex-models] model/list discovery ${visible.length === 0 ? 'empty-or-failed' : 'ok'} visible=${visible.length}`);
    if (visible.length === 0) {
      this.cached = {
        key,
        models: CODEX_PREDEFINED_MODELS,
        source: 'fallback',
        expiresAt: this.now() + CATALOG_FAILURE_TTL_MS,
      };
      this.source = 'fallback';
      return CODEX_PREDEFINED_MODELS;
    }

    const discovered = toProviderModelsDefinition(visible);
    this.cached = {
      key,
      models: discovered,
      source: 'live',
      expiresAt: this.now() + CATALOG_TTL_MS,
    };
    this.source = 'live';
    return discovered;
  }

  async getCurrentActiveModel(): Promise<ProviderCurrentActiveModel> {
    try {
      const raw = await readFile(CODEX_CONFIG_PATH, 'utf8');
      const parsed = readObjectRecord(TOML.parse(raw));
      const model = readOptionalString(parsed?.model);
      if (!model) {
        return buildDefaultProviderCurrentActiveModel(await this.getSupportedModels());
      }

      return {
        model,
      };
    } catch {
      return buildDefaultProviderCurrentActiveModel(await this.getSupportedModels());
    }
  }
}

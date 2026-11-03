import { readFile } from 'node:fs/promises';
import { createRequire } from 'node:module';
import os from 'node:os';
import path from 'node:path';

import TOML from '@iarna/toml';

import {
  codexAppServer,
  type CodexModelDescriptor,
} from '@/modules/providers/list/codex/codex-app-server.client.js';
import type { IProviderModels } from '@/shared/interfaces.js';
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

/** Injection seams for the discovery read and its clock. */
export type CodexProviderModelsDependencies = {
  listModels?: () => Promise<CodexModelDescriptor[] | null>;
  now?: () => number;
  cacheKey?: () => string;
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
  private readonly listModels: () => Promise<CodexModelDescriptor[] | null>;

  private readonly now: () => number;

  private readonly cacheKey: () => string;

  private cached: CatalogCacheEntry | null = null;

  private inflight: { key: string; promise: Promise<ProviderModelsDefinition> } | null = null;

  private source: CodexCatalogSource = 'fallback';

  constructor(dependencies: CodexProviderModelsDependencies = {}) {
    this.listModels = dependencies.listModels ?? (() => codexAppServer.listModels());
    this.now = dependencies.now ?? Date.now;
    this.cacheKey = dependencies.cacheKey ?? defaultCatalogCacheKey;
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

  async getSupportedModels(): Promise<ProviderModelsDefinition> {
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

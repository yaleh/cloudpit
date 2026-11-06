/**
 * Builds the `CodexOptions` a per-run Codex SDK process needs to talk to a
 * project-owned upstream provider.
 *
 * WHY THIS IS A SEPARATE CAPABILITY. The Codex SDK constructor takes the
 * endpoint as `config.model_provider` + `config.model_providers.<id>` and the
 * credential as an environment variable named by the provider's `env_key`.
 * Passing only `ThreadOptions.modelProvider` is not enough: Codex 0.166 reports
 * `modelProviderMismatch` unless the process itself was launched under the
 * provider, so the options must exist at `new Codex(...)` time. This module is
 * the one place that turns a resolved registry entry into that shape, so the
 * resident injection path can reuse it instead of growing a second compiler.
 *
 * THE SECRET TRAVELS IN ENV, NEVER IN ARGV. The SDK serialises `config` into
 * `--config key=value` arguments; `env_key` is only the variable NAME. The
 * secret is placed in the child environment (`env`), which is also why a host
 * sentinel must not survive: the SDK replaces `process.env` entirely whenever
 * `env` is supplied, so the child sees only the plumbing allowlist plus the one
 * provider credential.
 *
 * Consumed by `codex-runtime.provider.ts` (queryCodex, the per-run SDK path)
 * and `codex-host-driver.provider.ts` (the resident app-server path, which needs
 * `-c` spawn args instead of constructor options). The resolver is read from the
 * shared port at call time; neither consumer imports the settings module (that
 * edge would close the AC-394 providers/settings cycle).
 */
import type { CodexOptions } from '@openai/codex-sdk';

import type { CodexAppServerLaunch } from '@/modules/providers/list/codex/app-server/codex-app-server.connection.js';
import {
  readCodexProviderRegistryPort,
  type ResolvedCodexUpstreamProvider,
} from '@/shared/ports/codex-provider-registry.port.js';
import { AppError } from '@/shared/utils.js';

/**
 * Host variables a non-interactive Codex process needs that are plumbing, not
 * credentials. Anything outside this list (API keys, arbitrary operator
 * exports, test sentinels) is deliberately dropped: when the SDK is handed an
 * `env`, it stops inheriting `process.env`, and that is exactly the isolation
 * this injection promises.
 */
const CODEX_CHILD_ENV_ALLOWLIST: readonly string[] = [
  'PATH',
  'HOME',
  'TMPDIR',
  'TMP',
  'TEMP',
  'LANG',
  'LC_ALL',
  'LC_CTYPE',
  'TZ',
  'TERM',
  'USER',
  'LOGNAME',
  'SHELL',
  'CODEX_HOME',
  'XDG_CONFIG_HOME',
  'XDG_DATA_HOME',
  'XDG_CACHE_HOME',
  'XDG_STATE_HOME',
  'SSL_CERT_FILE',
  'SSL_CERT_DIR',
  'NODE_EXTRA_CA_CERTS',
  'HTTP_PROXY',
  'HTTPS_PROXY',
  'ALL_PROXY',
  'NO_PROXY',
  'http_proxy',
  'https_proxy',
  'all_proxy',
  'no_proxy',
];

/**
 * The child environment for one injected provider: the plumbing allowlist plus
 * the token-file secret under the provider's own `env_key`.
 *
 * A host variable that happens to share the provider's `env_key` is overwritten
 * by the resolved secret, so a stale operator credential can never win.
 */
export function buildCodexProviderEnv(
  provider: ResolvedCodexUpstreamProvider,
  source: Record<string, string | undefined> = process.env,
): Record<string, string> {
  const env: Record<string, string> = {};
  for (const key of CODEX_CHILD_ENV_ALLOWLIST) {
    const value = source[key];
    if (typeof value === 'string' && value.length > 0) {
      env[key] = value;
    }
  }
  // `env_http_headers` maps a header to the NAME of a variable Codex reads from
  // its own environment. Because this injection replaces the child environment,
  // those variables have to be carried across explicitly or the headers would
  // silently vanish. Only names the entry itself declares are forwarded.
  for (const variable of Object.values(provider.envHttpHeaders ?? {})) {
    const value = source[variable];
    if (typeof value === 'string' && value.length > 0) {
      env[variable] = value;
    }
  }
  env[provider.envKey] = provider.secret;
  return env;
}

/**
 * The `[model_providers.<id>]` advanced settings in Codex's snake_case spelling.
 *
 * Only fields the entry declared are present, so an entry with none produces
 * exactly the config it produced before these settings existed (and the AC-464
 * criterion's strict deep-equal keeps its shape).
 */
function providerAdvancedConfig(
  provider: ResolvedCodexUpstreamProvider,
): Record<string, unknown> {
  return {
    ...(provider.httpHeaders === undefined ? {} : { http_headers: provider.httpHeaders }),
    ...(provider.envHttpHeaders === undefined ? {} : { env_http_headers: provider.envHttpHeaders }),
    ...(provider.queryParams === undefined ? {} : { query_params: provider.queryParams }),
    ...(provider.requestMaxRetries === undefined
      ? {}
      : { request_max_retries: provider.requestMaxRetries }),
    ...(provider.streamMaxRetries === undefined
      ? {}
      : { stream_max_retries: provider.streamMaxRetries }),
    ...(provider.streamIdleTimeoutMs === undefined
      ? {}
      : { stream_idle_timeout_ms: provider.streamIdleTimeoutMs }),
    ...(provider.modelCatalogUrl === undefined
      ? {}
      : { model_catalog_url: provider.modelCatalogUrl }),
  };
}

/**
 * A selected model entry's own window and auto-compaction threshold, the tier
 * that wins over the provider entry's defaults.
 */
export type CodexModelLimits = {
  contextWindow?: number | undefined;
  autoCompactTokenLimit?: number | undefined;
};

/**
 * The context-window overrides one launch carries.
 *
 * Codex keeps `model_context_window` / `model_auto_compact_token_limit` at the
 * TOP LEVEL of its config, not inside `[model_providers.<id>]`. The selected
 * model entry is the most specific fact source (the same tier Claude's launch
 * profile occupies), then the provider entry's own default.
 */
function codexWindowConfig(
  provider: ResolvedCodexUpstreamProvider,
  limits: CodexModelLimits = {},
): Record<string, number> {
  const contextWindow = limits.contextWindow ?? provider.modelContextWindow;
  const autoCompactTokenLimit = limits.autoCompactTokenLimit ?? provider.modelAutoCompactTokenLimit;
  return {
    ...(contextWindow === undefined ? {} : { model_context_window: contextWindow }),
    ...(autoCompactTokenLimit === undefined
      ? {}
      : { model_auto_compact_token_limit: autoCompactTokenLimit }),
  };
}

/**
 * The SDK options for one resolved provider.
 *
 * `wire_api` is carried as the schema's literal `responses`: Codex 0.166
 * refuses to load a provider that asks for Chat Completions, and the settings
 * schema already rejects that value at write time.
 */
export function codexOptionsForProvider(
  provider: ResolvedCodexUpstreamProvider,
  limits: CodexModelLimits = {},
): CodexOptions {
  return {
    config: {
      ...codexWindowConfig(provider, limits),
      model_provider: provider.id,
      model_providers: {
        [provider.id]: {
          name: provider.name,
          base_url: provider.baseUrl,
          env_key: provider.envKey,
          wire_api: provider.wireApi,
          ...providerAdvancedConfig(provider),
        },
      },
    },
    env: buildCodexProviderEnv(provider),
  };
}

/**
 * Resolves one provider id against the installed project registry.
 *
 * Throws a readable error instead of falling back to Codex's `openai` default:
 * after a user bound a model to a custom endpoint, dialling the default one
 * silently would send the conversation to a different account and endpoint.
 * The `CODEX_PROVIDER_NOT_CONFIGURED` code is what a launch surface maps to the
 * app-server's own `modelProviderNotConfigured` reading; the sentence is the
 * registry's (it names the id and the settings file). An unwired registry is
 * reported the same way — a focused test that never installed the port cannot
 * accidentally "pass" by omitting the injection.
 */
export function resolveCodexUpstreamProvider(providerId: string): ResolvedCodexUpstreamProvider {
  const registry = readCodexProviderRegistryPort();
  if (registry === null || typeof registry.resolve !== 'function') {
    throw new AppError(
      `Codex provider "${providerId}" cannot be resolved: the project Codex provider registry is not wired in this process.`,
      { code: 'CODEX_PROVIDER_NOT_CONFIGURED', statusCode: 409 },
    );
  }

  const resolution = registry.resolve(providerId);
  if (!resolution.ok) {
    throw new AppError(resolution.problem, {
      code: 'CODEX_PROVIDER_NOT_CONFIGURED',
      statusCode: 409,
    });
  }
  return resolution.provider;
}

/** A TOML basic string, so a value Codex reads as config cannot break the `-c` line. */
function tomlBasicString(value: string): string {
  return `"${value.replace(/\\/g, '\\\\').replace(/"/g, '\\"')}"`;
}

/** A TOML inline table of string values (`{ "X-Header" = "v" }`). */
function tomlInlineMap(map: Record<string, string>): string {
  const entries = Object.entries(map)
    .map(([key, value]) => `${tomlBasicString(key)} = ${tomlBasicString(value)}`)
    .join(', ');
  return `{ ${entries} }`;
}

/**
 * The `-c` overrides a resident `codex app-server` is spawned with.
 *
 * Codex 0.166 refuses `turn/start` with `modelProviderMismatch` when the
 * provider is only named on `thread/start`; the process-global provider has to
 * be selected at spawn time. The endpoint table is written as an inline TOML
 * table because that is the same document `~/.codex/config.toml` carries, and
 * the secret is deliberately NOT here: `env_key` only names the child
 * environment variable (see {@link buildCodexProviderEnv}), because an argv
 * value is visible to every `ps` on the machine.
 *
 * Advanced settings are appended INSIDE that same table; a value whose key is
 * not valid in a bare TOML key is quoted. The two context-window keys are
 * top-level in Codex's config, so they get their own `-c` lines.
 */
export function codexProviderSpawnArgs(
  provider: ResolvedCodexUpstreamProvider,
  limits: CodexModelLimits = {},
): string[] {
  const entry = [
    `name = ${tomlBasicString(provider.name)}`,
    `base_url = ${tomlBasicString(provider.baseUrl)}`,
    `env_key = ${tomlBasicString(provider.envKey)}`,
    `wire_api = ${tomlBasicString(provider.wireApi)}`,
    ...(provider.httpHeaders === undefined
      ? []
      : [`http_headers = ${tomlInlineMap(provider.httpHeaders)}`]),
    ...(provider.envHttpHeaders === undefined
      ? []
      : [`env_http_headers = ${tomlInlineMap(provider.envHttpHeaders)}`]),
    ...(provider.queryParams === undefined
      ? []
      : [`query_params = ${tomlInlineMap(provider.queryParams)}`]),
    ...(provider.requestMaxRetries === undefined
      ? []
      : [`request_max_retries = ${provider.requestMaxRetries}`]),
    ...(provider.streamMaxRetries === undefined
      ? []
      : [`stream_max_retries = ${provider.streamMaxRetries}`]),
    ...(provider.streamIdleTimeoutMs === undefined
      ? []
      : [`stream_idle_timeout_ms = ${provider.streamIdleTimeoutMs}`]),
    ...(provider.modelCatalogUrl === undefined
      ? []
      : [`model_catalog_url = ${tomlBasicString(provider.modelCatalogUrl)}`]),
  ].join(', ');
  const windows = codexWindowConfig(provider, limits);
  return [
    '-c', `model_provider=${tomlBasicString(provider.id)}`,
    '-c', `model_providers.${provider.id}={ ${entry} }`,
    ...Object.entries(windows).flatMap(([key, value]) => ['-c', `${key}=${value}`]),
  ];
}

/**
 * The launch one resident app-server is spawned with for a bound provider.
 *
 * `base` is the driver-wide transport launch (working directory and the like);
 * the provider overrides are appended to its args. The environment is REPLACED
 * with the plumbing allowlist plus the one provider credential rather than
 * merged with `base.env`: `spawn` treats an explicit env as the whole child
 * environment, and a host sentinel surviving into the child is exactly what the
 * isolation reading forbids. The MCP-gateway wrapper composes its own variable
 * on top of this launch afterwards.
 */
export function compileCodexProviderLaunch(
  providerId: string,
  base: CodexAppServerLaunch = {},
): CodexAppServerLaunch {
  const provider = resolveCodexUpstreamProvider(providerId);
  return {
    ...base,
    args: [...(base.args ?? []), ...codexProviderSpawnArgs(provider)],
    env: buildCodexProviderEnv(provider),
  };
}

/** Resolves one model's `codexProviderId` and compiles its per-run SDK options. */
export function compileCodexProviderOptions(
  providerId: string,
  limits: CodexModelLimits = {},
): CodexOptions {
  return codexOptionsForProvider(resolveCodexUpstreamProvider(providerId), limits);
}

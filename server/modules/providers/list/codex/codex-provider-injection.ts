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
 * Consumed by `codex-runtime.provider.ts` (queryCodex). The resolver is read
 * from the shared port at call time; the runtime never imports the settings
 * module (that edge would close the AC-394 providers/settings cycle).
 */
import type { CodexOptions } from '@openai/codex-sdk';

import {
  readCodexProviderRegistryPort,
  type ResolvedCodexUpstreamProvider,
} from '@/shared/ports/codex-provider-registry.port.js';

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
  env[provider.envKey] = provider.secret;
  return env;
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
): CodexOptions {
  return {
    config: {
      model_provider: provider.id,
      model_providers: {
        [provider.id]: {
          name: provider.name,
          base_url: provider.baseUrl,
          env_key: provider.envKey,
          wire_api: provider.wireApi,
        },
      },
    },
    env: buildCodexProviderEnv(provider),
  };
}

/**
 * Resolves one model's `codexProviderId` and compiles its launch options.
 *
 * Throws a readable error instead of falling back to Codex's `openai` default:
 * after a user bound a model to a custom endpoint, dialling the default one
 * silently would send the conversation to a different account and endpoint.
 * An unwired registry is reported the same way — a focused test that never
 * installed the port cannot accidentally "pass" by omitting the injection.
 */
export function compileCodexProviderOptions(providerId: string): CodexOptions {
  const registry = readCodexProviderRegistryPort();
  if (registry === null || typeof registry.resolve !== 'function') {
    throw new Error(
      `Codex provider "${providerId}" cannot be resolved: the project Codex provider registry is not wired in this process.`,
    );
  }

  const resolution = registry.resolve(providerId);
  if (!resolution.ok) {
    throw new Error(resolution.problem);
  }
  return codexOptionsForProvider(resolution.provider);
}

/**
 * The neutral accessor for the project-owned Codex upstream-provider registry.
 *
 * WHY THIS FILE EXISTS. `provider-models.service.ts` must refuse a custom Codex
 * model entry whose `codexProviderId` names no provider the project actually
 * defines. Naming the settings module directly from the providers module would
 * close the `providers -> settings -> mcp-gateway -> providers` directory cycle
 * AC-394 pins (the settings barrel evaluates `settings.module.ts`, which imports
 * the MCP gateway, which imports the providers barrel). The registry reading is
 * needed when a model is written, not while either module evaluates, so it is
 * installed rather than imported: the shared layer imports no feature module,
 * and the composition root wires the two ends together.
 *
 * WHAT THE PORT ANSWERS. `read()` returns the ids the project registry defines
 * plus the ids Codex itself reserves for its built-ins. Both are data, not
 * vocabulary this file re-states: the settings source owns the reserved list
 * (`RESERVED_CODEX_PROVIDER_IDS`) and the provider entries, so a change there
 * reaches every caller without a second copy drifting.
 *
 * A MISSING INSTALL IS NOT AN ERROR. A focused criterion that drives the models
 * service over an injected fake never installs this port; the service treats an
 * absent install as "no provider is known" and refuses a declared binding with
 * a readable error. In production `settings.module.ts` installs the real source
 * at boot, and `read()` re-reads the settings file on every call, so a provider
 * added or removed through the settings API is seen by the next model write.
 *
 * Consumers: `modules/providers/services/provider-models.service.ts` (the
 * `codexProviderId` reference check), `modules/providers/list/codex/` (the
 * per-run spawn-time `resolve`), and `modules/settings/settings.module.ts`
 * (installs the production reading and resolution).
 */

/** One provider id the project registry defines; the model entry binds by id only. */
export type CodexProviderIdEntry = { id: string };

/**
 * The registry reading a model-entry validation needs: the project providers and
 * the built-in ids Codex always accepts.
 */
export type CodexProviderRegistryReading = {
  /** Provider ids the project settings file defines, as the registry read them. */
  providers: CodexProviderIdEntry[];
  /** Ids Codex reserves for its built-in providers; a project entry may never replace one. */
  reservedIds: readonly string[];
};

/**
 * One provider resolved for a spawn-time injection: the endpoint fields Codex's
 * `model_providers.<id>` config needs plus the secret read from its token file.
 *
 * The secret is handed to the caller in memory, under the provider's `envKey`;
 * it never appears in a config document or on a command line.
 */
export type ResolvedCodexUpstreamProvider = {
  id: string;
  name: string;
  baseUrl: string;
  envKey: string;
  wireApi: 'responses';
  secret: string;
};

/**
 * A spawn-time lookup. A false `ok` always carries the readable line a run
 * reports instead of silently dialling Codex's default endpoint.
 */
export type CodexUpstreamProviderResolution =
  | { ok: true; provider: ResolvedCodexUpstreamProvider }
  | { ok: false; problem: string };

/**
 * The registry surface the providers module reads.
 *
 * `read()` answers the model-write reference check; `resolve()` is the
 * per-run/resident spawn-time lookup. `resolve` is optional so an install that
 * only answers reference checks keeps working; a Codex run that needs an
 * injection treats its absence as "the registry cannot resolve providers".
 */
export type CodexProviderRegistryPort = {
  read(): CodexProviderRegistryReading;
  resolve?(id: string): CodexUpstreamProviderResolution;
};

/**
 * The installed port behind a lifecycle owner rather than a module-scope `let`.
 *
 * It holds one reference with one write path (`install`) and one read path, so
 * the process-wide wiring is explicit and the architecture ratchet sees no
 * module-level mutable binding.
 */
class CodexProviderRegistrySlot {
  #installed: CodexProviderRegistryPort | null = null;

  install(port: CodexProviderRegistryPort): void {
    this.#installed = port;
  }

  read(): CodexProviderRegistryPort | null {
    return this.#installed;
  }
}

const codexProviderRegistrySlot = new CodexProviderRegistrySlot();

/**
 * Installs the process's Codex provider registry reading.
 *
 * Called once by `settings.module.ts` at boot. Re-installing replaces the port,
 * which is what a criterion driving a fake relies on; production installs once.
 */
export function installCodexProviderRegistryPort(port: CodexProviderRegistryPort): void {
  codexProviderRegistrySlot.install(port);
}

/**
 * Reads the installed registry, or null when the composition root has not wired
 * one yet. Callers treat null as "no provider is known" rather than throwing, so
 * merely evaluating the models service never depends on settings-module order.
 */
export function readCodexProviderRegistryPort(): CodexProviderRegistryPort | null {
  return codexProviderRegistrySlot.read();
}

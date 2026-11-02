import { Download, ShieldCheck } from 'lucide-react';

import { Button } from '@/shared/ui';

/**
 * One `[model_providers.<id>]` block the server read from the operator's own `~/.codex` TOML
 * files. Structural mirror of the server's `CodexUserProviderImport`: only the field NAMES are
 * carried — `envKey` is the variable name, never its value, and no token ever appears here.
 */
export type CodexUserProviderImport = {
  id: string;
  name: string;
  baseUrl: string;
  envKey: string;
  wireApi: string;
  /** The user TOML file the block came from. */
  source: string;
  /** False when importing it would shadow a Codex built-in or use an unsupported dialect. */
  bindable: boolean;
  warnings: string[];
};

/** The whole import view, mirroring the server's `CodexUserProviderImportReading`. */
export type CodexUserProviderImportReading = {
  directory: string;
  files: string[];
  providers: CodexUserProviderImport[];
  warnings: string[];
};

type CodexProviderImportProps = {
  /** The server's read-only import view; `null` while it is loading. */
  reading: CodexUserProviderImportReading | null;
  /** Binds one imported provider as a model entry's `codexProviderId`. */
  onBind: (providerId: string) => void;
  busy?: boolean;
};

/**
 * Rendered inside Settings → Agents → Codex, beside the project-owned provider registry: the
 * read-only view of the operator's `~/.codex` providers, with a one-click bind per row.
 *
 * The two invariants are drawn on the page rather than only enforced server-side:
 * `env_key` is shown as a NAME (never a value), and the panel says plainly that importing
 * writes into the project settings file and never back into `~/.codex`.
 *
 * The `data-codex-import-*` attributes declare this panel's state for `scripts/ui-scenario.mjs`
 * and the criterion; the bind button is the same control a person presses.
 */
export default function CodexProviderImport({
  reading,
  onBind,
  busy = false,
}: CodexProviderImportProps) {
  const providers = reading?.providers ?? [];
  const bindable = providers.filter((provider) => provider.bindable);

  return (
    <section
      className="rounded-2xl border border-border/70 bg-muted/20 p-4 shadow-sm"
      data-codex-import={reading === null ? 'loading' : 'ready'}
      data-codex-import-count={String(providers.length)}
      data-codex-import-bindable={String(bindable.length)}
      data-codex-import-directory={reading?.directory ?? ''}
    >
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div>
          <p className="text-sm font-semibold text-foreground">Import from your Codex profile</p>
          <p className="mt-1 max-w-2xl text-xs leading-5 text-muted-foreground">
            Providers declared in your own <code className="font-mono">~/.codex</code> TOML files.
            The import is read-only: it never reads a secret and never writes back to those files.
            Binding copies the provider into this project&apos;s settings, which stays the only
            write target.
          </p>
        </div>
        <span
          className="inline-flex items-center gap-1 rounded-full border border-border/70 px-2 py-1 text-[11px] text-muted-foreground"
          data-testid="codex-import-read-only"
        >
          <ShieldCheck className="h-3.5 w-3.5" />
          read-only
        </span>
      </div>

      {reading !== null && reading.directory !== '' && (
        <p className="mt-2 break-all text-[11px] text-muted-foreground" data-testid="codex-import-directory">
          {reading.directory}
          {reading.files.length === 0 ? ' — no TOML files found' : ` — ${reading.files.length} file(s)`}
        </p>
      )}

      {reading === null && (
        <p className="mt-3 text-xs text-muted-foreground">Reading your Codex profile…</p>
      )}

      {(reading?.warnings.length ?? 0) > 0 && (
        <ul className="mt-3 space-y-1" data-testid="codex-import-file-warnings">
          {reading?.warnings.map((warning, index) => (
            <li
              key={`${index}:${warning}`}
              className="rounded-lg border border-amber-500/30 bg-amber-500/10 px-3 py-1.5 text-[11px] text-amber-700 dark:text-amber-300"
              data-testid="codex-import-file-warning"
            >
              {warning}
            </li>
          ))}
        </ul>
      )}

      {reading !== null && providers.length === 0 && reading.warnings.length === 0 && (
        <p className="mt-3 text-xs text-muted-foreground" data-testid="codex-import-empty">
          No <code className="font-mono">[model_providers.*]</code> blocks were found in your Codex
          profile.
        </p>
      )}

      {providers.length > 0 && (
        <ul className="mt-3 space-y-2">
          {providers.map((provider) => (
            <li
              key={`${provider.source}:${provider.id}`}
              className="rounded-xl border border-border/70 bg-background/70 p-3"
              data-codex-import-provider={provider.id}
              data-codex-import-provider-bindable={String(provider.bindable)}
            >
              <div className="flex flex-wrap items-start justify-between gap-2">
                <div className="min-w-0">
                  <p className="font-mono text-xs font-semibold text-foreground">
                    {provider.id}
                    {provider.name !== provider.id && (
                      <span className="ml-2 font-sans font-normal text-muted-foreground">
                        {provider.name}
                      </span>
                    )}
                  </p>
                  <dl className="mt-1 grid gap-x-4 gap-y-0.5 text-[11px] text-muted-foreground sm:grid-cols-2">
                    <div className="flex min-w-0 gap-1">
                      <dt>base_url</dt>
                      <dd className="truncate font-mono text-foreground">{provider.baseUrl}</dd>
                    </div>
                    <div className="flex min-w-0 gap-1">
                      <dt>env_key</dt>
                      {/* The variable NAME only; the value is never read. */}
                      <dd className="font-mono text-foreground">{provider.envKey}</dd>
                    </div>
                    <div className="flex gap-1">
                      <dt>wire_api</dt>
                      <dd className="font-mono text-foreground">{provider.wireApi}</dd>
                    </div>
                    <div className="flex min-w-0 gap-1">
                      <dt>source</dt>
                      <dd className="truncate font-mono text-foreground">{provider.source}</dd>
                    </div>
                  </dl>
                </div>
                <Button
                  type="button"
                  variant="outline"
                  size="sm"
                  className="rounded-xl"
                  data-codex-import-bind={provider.id}
                  disabled={busy || !provider.bindable}
                  onClick={() => onBind(provider.id)}
                >
                  <Download className="h-3.5 w-3.5" />
                  Bind
                </Button>
              </div>

              {provider.warnings.length > 0 && (
                <ul className="mt-2 space-y-1" data-testid="codex-import-provider-warnings">
                  {provider.warnings.map((warning, index) => (
                    <li
                      key={`${index}:${warning}`}
                      className="rounded-lg border border-amber-500/30 bg-amber-500/10 px-3 py-1.5 text-[11px] text-amber-700 dark:text-amber-300"
                      data-testid="codex-import-provider-warning"
                    >
                      {warning}
                    </li>
                  ))}
                </ul>
              )}
            </li>
          ))}
        </ul>
      )}
    </section>
  );
}

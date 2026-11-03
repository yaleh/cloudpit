import { FlaskConical, Loader2, Plus, Trash2 } from 'lucide-react';

import type {
  CodexConnectionOutcome,
  CodexConnectionTest,
  CodexProviderDraft,
  CodexProviderKeyValue,
} from '@/modules/settings/utils/codexProvidersController';
import { CODEX_CONNECTION_BILLING_NOTE } from '@/modules/settings/utils/codexProvidersController';
import { Button, Input } from '@/shared/ui';

/**
 * One provider row's advanced connection settings and its connection-test control.
 *
 * Used by `CodexProvidersContent` for every row: `http_headers`, `env_http_headers`,
 * `query_params`, the two retry counts, the stream idle timeout and `model_catalog_url` are
 * Codex's own `[model_providers.<id>]` fields, and the probe button is the only way to learn
 * whether the configured endpoint is actually reachable.
 *
 * The panel owns no rules: every edit is handed to the controller as a draft patch, and the
 * probe's answer arrives as a snapshot reading. The billable sentence is drawn BEFORE the
 * button is pressed (the server's answer carries it too), because the probe is a real request.
 */

type KeyValueEditorProps = {
  title: string;
  description: string;
  fieldLabel: string;
  addLabel: string;
  testId: string;
  rows: CodexProviderKeyValue[];
  disabled: boolean;
  onChange: (rows: CodexProviderKeyValue[]) => void;
};

/** The row-list editor one map field (`http_headers`, `query_params`, ...) is drawn with. */
function KeyValueEditor({
  title,
  description,
  fieldLabel,
  addLabel,
  testId,
  rows,
  disabled,
  onChange,
}: KeyValueEditorProps) {
  const replaceRow = (index: number, patch: Partial<CodexProviderKeyValue>): void => {
    onChange(rows.map((row, current) => (current === index ? { ...row, ...patch } : row)));
  };
  return (
    <div data-testid={testId}>
      <div className="flex items-start justify-between gap-2">
        <div>
          <p className="text-xs font-semibold text-foreground">{title}</p>
          <p className="mt-0.5 text-[11px] leading-4 text-muted-foreground">{description}</p>
        </div>
        <Button
          type="button"
          variant="outline"
          size="sm"
          className="h-7 rounded-lg"
          data-testid={`${testId}-add`}
          disabled={disabled}
          onClick={() => onChange([...rows, { name: '', value: '' }])}
        >
          <Plus className="h-3 w-3" />
          {addLabel}
        </Button>
      </div>
      {rows.length === 0 && (
        <p className="mt-1.5 text-[11px] text-muted-foreground">None configured.</p>
      )}
      <div className="mt-1.5 space-y-1.5">
        {rows.map((row, index) => (
          <div key={`${testId}:${index}`} className="flex items-center gap-1.5">
            <Input
              value={row.name}
              aria-label={`${fieldLabel} name ${index + 1}`}
              data-testid={`${testId}-name-${index}`}
              className="h-8 rounded-lg bg-background font-mono text-xs"
              disabled={disabled}
              placeholder="Name"
              autoComplete="off"
              spellCheck={false}
              onChange={(event) => replaceRow(index, { name: event.target.value })}
            />
            <Input
              value={row.value}
              aria-label={`${fieldLabel} value ${index + 1}`}
              data-testid={`${testId}-value-${index}`}
              className="h-8 rounded-lg bg-background font-mono text-xs"
              disabled={disabled}
              placeholder="Value"
              autoComplete="off"
              spellCheck={false}
              onChange={(event) => replaceRow(index, { value: event.target.value })}
            />
            <Button
              type="button"
              variant="ghost"
              size="icon"
              className="h-8 w-8 shrink-0 rounded-lg text-muted-foreground hover:bg-destructive/10 hover:text-destructive"
              aria-label={`Remove ${fieldLabel} ${index + 1}`}
              data-testid={`${testId}-remove-${index}`}
              disabled={disabled}
              onClick={() => onChange(rows.filter((_, current) => current !== index))}
            >
              <Trash2 className="h-3.5 w-3.5" />
            </Button>
          </div>
        ))}
      </div>
    </div>
  );
}

/** The human label for each outcome the server may answer with. */
const OUTCOME_LABELS: Record<CodexConnectionOutcome, string> = {
  ok: 'Connected — the endpoint answered like a Responses API',
  dns: 'DNS — the host of the base URL could not be resolved',
  unauthorized: 'Reachable — the credential was refused (401/403)',
  'not-found': 'Not found (404) — check the base URL path',
  'not-responses': 'Reachable — but the reply is not a Responses-API body',
  'server-error': 'Upstream server error (5xx)',
  unreachable: 'Unreachable — no HTTP answer',
};

type CodexProviderAdvancedProps = {
  draft: CodexProviderDraft;
  /** True while the registry is loading or saving; every control is inert then. */
  disabled: boolean;
  /** True only when this row's id names a provider the server has ALREADY saved. */
  canTest: boolean;
  /** True while this panel's own probe is in flight. */
  testing: boolean;
  /** The answer for THIS row, or null when the last probe was another row's (or none). */
  connection: CodexConnectionTest | null;
  onChange: (patch: Partial<CodexProviderDraft>) => void;
  onTestConnection: () => void;
};

export default function CodexProviderAdvanced({
  draft,
  disabled,
  canTest,
  testing,
  connection,
  onChange,
  onTestConnection,
}: CodexProviderAdvancedProps) {
  return (
    <section
      className="mt-4 space-y-4 rounded-xl border border-border/60 bg-muted/10 p-3"
      data-testid="codex-provider-advanced"
      data-codex-advanced-provider={draft.id}
      data-codex-connection-status={testing ? 'testing' : (connection === null ? 'idle' : 'ready')}
      data-codex-connection-outcome={connection?.probe.outcome ?? ''}
    >
      <div>
        <p className="text-sm font-semibold text-foreground">Advanced connection settings</p>
        <p className="mt-1 max-w-2xl text-[11px] leading-5 text-muted-foreground">
          Optional Codex <code className="font-mono">model_providers</code> keys. Leave a field
          empty to inherit Codex&apos;s own default.
        </p>
      </div>

      <KeyValueEditor
        title="HTTP headers"
        description="Static headers sent with every request to this provider."
        fieldLabel="HTTP header"
        addLabel="Add header"
        testId="codex-advanced-http-headers"
        rows={draft.httpHeaders}
        disabled={disabled}
        onChange={(httpHeaders) => onChange({ httpHeaders })}
      />

      <KeyValueEditor
        title="Header environment variables"
        description="Header name → the environment variable Codex reads that header's value from."
        fieldLabel="Header environment variable"
        addLabel="Add variable"
        testId="codex-advanced-env-headers"
        rows={draft.envHttpHeaders}
        disabled={disabled}
        onChange={(envHttpHeaders) => onChange({ envHttpHeaders })}
      />

      <KeyValueEditor
        title="Query parameters"
        description="Appended to every request's URL."
        fieldLabel="Query parameter"
        addLabel="Add parameter"
        testId="codex-advanced-query-params"
        rows={draft.queryParams}
        disabled={disabled}
        onChange={(queryParams) => onChange({ queryParams })}
      />

      <div className="grid gap-3 sm:grid-cols-3">
        <label className="block text-xs font-semibold text-foreground">
          Request max retries
          <Input
            type="number"
            min={0}
            value={draft.requestMaxRetries}
            aria-label="Request max retries"
            className="mt-1.5 h-9 rounded-lg bg-background font-mono text-xs"
            disabled={disabled}
            placeholder="inherit"
            onChange={(event) => onChange({ requestMaxRetries: event.target.value })}
          />
        </label>
        <label className="block text-xs font-semibold text-foreground">
          Stream max retries
          <Input
            type="number"
            min={0}
            value={draft.streamMaxRetries}
            aria-label="Stream max retries"
            className="mt-1.5 h-9 rounded-lg bg-background font-mono text-xs"
            disabled={disabled}
            placeholder="inherit"
            onChange={(event) => onChange({ streamMaxRetries: event.target.value })}
          />
        </label>
        <label className="block text-xs font-semibold text-foreground">
          Stream idle timeout (ms)
          <Input
            type="number"
            min={1}
            value={draft.streamIdleTimeoutMs}
            aria-label="Stream idle timeout (ms)"
            className="mt-1.5 h-9 rounded-lg bg-background font-mono text-xs"
            disabled={disabled}
            placeholder="inherit"
            onChange={(event) => onChange({ streamIdleTimeoutMs: event.target.value })}
          />
        </label>
      </div>

      <label className="block text-xs font-semibold text-foreground">
        Model catalog URL
        <Input
          value={draft.modelCatalogUrl}
          aria-label="Model catalog URL"
          className="mt-1.5 h-9 rounded-lg bg-background font-mono text-xs"
          disabled={disabled}
          placeholder="https://catalog.example/models.json"
          autoComplete="off"
          spellCheck={false}
          onChange={(event) => onChange({ modelCatalogUrl: event.target.value })}
        />
      </label>

      <div className="border-t border-border/60 pt-3">
        <div className="flex flex-wrap items-start gap-2">
          <Button
            type="button"
            variant="outline"
            size="sm"
            className="rounded-xl"
            data-testid="codex-connection-test"
            disabled={disabled || testing || !canTest}
            onClick={onTestConnection}
          >
            {testing
              ? <Loader2 className="h-3.5 w-3.5 animate-spin" />
              : <FlaskConical className="h-3.5 w-3.5" />}
            Test connection
          </Button>
          <p
            className="max-w-md text-[11px] leading-4 text-muted-foreground"
            data-testid="codex-connection-note"
          >
            {CODEX_CONNECTION_BILLING_NOTE}
          </p>
        </div>

        {!canTest && (
          <p className="mt-1.5 text-[11px] text-muted-foreground" data-testid="codex-connection-unsaved">
            Save this provider before testing it — the probe uses the server&apos;s saved entry.
          </p>
        )}

        {connection !== null && (
          <div
            role="status"
            className={`mt-2 rounded-xl border px-3 py-2 text-xs ${
              connection.probe.ok
                ? 'border-emerald-500/30 bg-emerald-500/10 text-emerald-700 dark:text-emerald-300'
                : 'border-amber-500/30 bg-amber-500/10 text-amber-700 dark:text-amber-300'
            }`}
            data-testid="codex-provider-connection-outcome"
            data-outcome={connection.probe.outcome}
          >
            <p className="font-semibold">{OUTCOME_LABELS[connection.probe.outcome]}</p>
            <p className="mt-1 break-all font-mono text-[11px]">{connection.probe.url}</p>
            <p className="mt-1 text-[11px]">{connection.probe.detail}</p>
            {connection.probe.status !== undefined && (
              <p className="mt-1 text-[11px]">HTTP {connection.probe.status}</p>
            )}
          </div>
        )}
      </div>
    </section>
  );
}

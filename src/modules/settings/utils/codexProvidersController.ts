import { errorMessage } from '@/shared/utils';
import type {
  CodexModelProvider,
  CodexModelProvidersReading,
} from '@/shared/types';

/**
 * One provider entry a save sends to `PUT /api/settings/codex/model-providers`.
 *
 * `wireApi` is the only dialect the server accepts; `token` is write-only and is persisted to
 * the entry's token file, never back into the settings document (omit it to keep the stored
 * secret). This is the controller's dependency-seam type, so the hook imports it from here —
 * `src/shared/types.ts` is an oversize-ratchet file whose baseline may only fall.
 */
export type CodexModelProviderWrite = {
  id: string;
  name: string;
  baseUrl: string;
  envKey: string;
  tokenFile: string;
  wireApi: 'responses';
  token?: string;
  /** Static request headers (`http_headers`); omitted when the form has no rows. */
  httpHeaders?: Record<string, string>;
  /** Header name → environment variable holding that header's value. */
  envHttpHeaders?: Record<string, string>;
  /** Query parameters appended to every request (`query_params`). */
  queryParams?: Record<string, string>;
  requestMaxRetries?: number;
  streamMaxRetries?: number;
  streamIdleTimeoutMs?: number;
  modelCatalogUrl?: string;
};

/** One key/value row of an advanced map field (`http_headers`, `query_params`, ...). */
export type CodexProviderKeyValue = {
  name: string;
  value: string;
};

/**
 * What a connection probe concluded. A structural mirror of the server's
 * `CodexConnectionOutcome` (`codex-model-providers.settings.ts`), defined here for the same
 * reason as the import types above: `src/shared/types.ts` is an oversize-ratchet file whose
 * baseline may only fall. The server is the one that decides the outcome; the panel only
 * translates it.
 */
export type CodexConnectionOutcome =
  | 'ok'
  | 'dns'
  | 'unauthorized'
  | 'not-found'
  | 'not-responses'
  | 'server-error'
  | 'unreachable';

/**
 * One connection-test answer, mirroring the server's `CodexConnectionProbe`. `billable` is
 * always true: the probe is a REAL `POST /responses`, so the panel must show `billingNote`
 * beside the button BEFORE the operator presses it.
 */
export type CodexConnectionProbe = {
  outcome: CodexConnectionOutcome;
  ok: boolean;
  url: string;
  status?: number;
  billable: true;
  billingNote: string;
  detail: string;
};

/** The last probe, keyed by the SAVED provider id it tested. */
export type CodexConnectionTest = {
  providerId: string;
  probe: CodexConnectionProbe;
};

/**
 * The sentence the connection-test button must show; it is the server's
 * `CODEX_CONNECTION_BILLING_NOTE` verbatim. Duplicated rather than imported because the
 * frontend bundle cannot read server code, and kept here so the panel and its criterion read
 * one value.
 */
export const CODEX_CONNECTION_BILLING_NOTE =
  'This connection test sends one real request to your upstream provider; the provider may bill it.';

/**
 * One `[model_providers.<id>]` block the server read from the operator's own `~/.codex` TOML
 * files. Structural mirror of the server's `CodexUserProviderImport`: only field NAMES are
 * carried — `envKey` is the variable name, never its value, and no token ever appears here.
 * Defined here (the pure rules layer) so the panel and the controller share one definition;
 * `src/shared/types.ts` is an oversize-ratchet file whose baseline may only fall.
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

/** The whole read-only import view, mirroring the server's `CodexUserProviderImportReading`. */
export type CodexUserProviderImportReading = {
  directory: string;
  files: string[];
  providers: CodexUserProviderImport[];
  warnings: string[];
};

/**
 * The Settings → Agents → Codex provider registry form's rules.
 *
 * WHY A CONTROLLER. Three things here are rules rather than rendering, and each is a bug if it
 * lives in JSX: the editable rows start from the SERVER reading (never a local default), a save
 * is a full replacement carrying the exact `version` the reading arrived with, and a stale
 * version is a visible conflict that keeps the draft instead of overwriting a second editor.
 * The panel is only the drawing of this snapshot.
 *
 * THE SECRET IS WRITE-ONLY. A draft's `token` belongs to this form only; a save sends it when it
 * is non-empty (the server writes it to the provider's token file) and omits it otherwise, which
 * keeps the stored secret. The reading exposes `tokenSet`, never a value.
 */

/**
 * One editable provider row. `token` is write-only; `''` means "keep the stored secret".
 *
 * The advanced fields are held as the FORM edits them: maps are row lists (so a key can be
 * added or removed before it is a valid record), and the three integer fields are strings so
 * an empty box means "unset" rather than zero. `draftToWrite` is the one place that turns
 * these shapes into the wire record, dropping blank rows.
 */
export type CodexProviderDraft = {
  id: string;
  name: string;
  baseUrl: string;
  envKey: string;
  tokenFile: string;
  token: string;
  /** Whether the token file currently holds a secret, as the reading reported it. */
  tokenSet: boolean;
  httpHeaders: CodexProviderKeyValue[];
  envHttpHeaders: CodexProviderKeyValue[];
  queryParams: CodexProviderKeyValue[];
  requestMaxRetries: string;
  streamMaxRetries: string;
  streamIdleTimeoutMs: string;
  modelCatalogUrl: string;
};

/** Why the form could not read or save. The panel translates each kind. */
export type CodexProvidersError = {
  kind: 'load' | 'save' | 'conflict';
  message: string;
};

export type CodexProvidersSnapshot = {
  status: 'loading' | 'ready' | 'saving' | 'failed';
  /** The server reading the form was built from, or `null` before the first load. */
  reading: CodexModelProvidersReading | null;
  /** The editable rows; a save replaces the whole registry with these. */
  drafts: CodexProviderDraft[];
  error: CodexProvidersError | null;
  /** The read-only user-profile import view, or `null` before the first read. */
  imports: CodexUserProviderImportReading | null;
  /** The import panel's own lifecycle; independent of the registry save state. */
  importStatus: 'loading' | 'ready' | 'importing' | 'failed';
  /** Why the last import read or bind failed, or `null`. Never a secret value. */
  importError: string | null;
  /** The last connection-test answer, or `null` before the first one. */
  connection: CodexConnectionTest | null;
  /** The connection test's in-flight state; independent of the registry/import statuses. */
  connectionStatus: 'idle' | 'testing';
  /** Why the last connection test could not run or answer, or `null`. Never a secret value. */
  connectionError: string | null;
};

/** What the outside world hands the controller; the settings API is the shipped binding. */
export type CodexProvidersDeps = {
  read: () => Promise<CodexModelProvidersReading>;
  save: (input: {
    providers: CodexModelProviderWrite[];
    expectedVersion: string;
  }) => Promise<CodexModelProvidersReading>;
  /** The operator's own Codex providers (server: `GET .../model-providers/import`). */
  readImports: () => Promise<CodexUserProviderImportReading>;
  /** Binds the named user-profile rows (server: `POST .../model-providers/import`). */
  importProviders: (input: {
    ids: string[];
    expectedVersion: string;
  }) => Promise<CodexModelProvidersReading>;
  /**
   * Probes the SAVED provider's endpoint (server: `POST .../model-providers/test`). The server
   * resolves the token-file secret itself, so the form never carries a secret to this call.
   */
  testConnection: (providerId: string) => Promise<CodexConnectionProbe>;
};

export type CodexProvidersController = {
  getSnapshot: () => CodexProvidersSnapshot;
  subscribe: (listener: () => void) => () => void;
  /** Reads the registry; safe to call again after a conflict. */
  load: () => Promise<void>;
  /** Appends an empty row (the server validates it on save). */
  addDraft: () => void;
  /** Replaces fields of one row; an out-of-range index is ignored. */
  updateDraft: (index: number, patch: Partial<CodexProviderDraft>) => void;
  removeDraft: (index: number) => void;
  /** Saves every draft against the version the current reading carries. */
  save: () => Promise<void>;
  /** Reads the user-profile import view (read-only; no secret value is ever returned). */
  loadImports: () => Promise<void>;
  /**
   * Binds one imported provider into the project registry, then refreshes the drafts from the
   * answer so the model editor's provider picker sees it immediately.
   */
  bindImportedProvider: (providerId: string) => Promise<void>;
  /**
   * Probes one SAVED provider's endpoint and publishes the answer. The draft's unsaved edits
   * are deliberately not sent: the server tests the registry entry it can resolve, secret
   * included.
   */
  testConnection: (providerId: string) => Promise<void>;
  /** Re-arms the SAME controller after React StrictMode's cleanup/setup pass. */
  activate: () => void;
  dispose: () => void;
};

/** Turns a wire map into the form's row list, preserving the document's key order. */
function pairsFromRecord(record: Record<string, string> | undefined): CodexProviderKeyValue[] {
  return Object.entries(record ?? {}).map(([name, value]) => ({ name, value }));
}

/** `''` means "unset"; the server rejects a non-integer, so a typo stays visible rather than silent. */
function integerFromText(text: string): number | undefined {
  const trimmed = text.trim();
  return trimmed === '' ? undefined : Number(trimmed);
}

/** `undefined` when no row carries a key, so an untouched form never writes empty maps. */
function recordFromPairs(pairs: CodexProviderKeyValue[]): Record<string, string> | undefined {
  const record: Record<string, string> = {};
  for (const pair of pairs) {
    const name = pair.name.trim();
    if (name === '') continue;
    record[name] = pair.value;
  }
  return Object.keys(record).length === 0 ? undefined : record;
}

/** A draft starts from the reading, with no typed secret and the stored one flagged. */
function draftFromProvider(provider: CodexModelProvider): CodexProviderDraft {
  return {
    id: provider.id,
    name: provider.name,
    baseUrl: provider.baseUrl,
    envKey: provider.envKey,
    tokenFile: provider.tokenFile,
    token: '',
    tokenSet: provider.tokenSet,
    httpHeaders: pairsFromRecord(provider.httpHeaders),
    envHttpHeaders: pairsFromRecord(provider.envHttpHeaders),
    queryParams: pairsFromRecord(provider.queryParams),
    requestMaxRetries: provider.requestMaxRetries === undefined ? '' : String(provider.requestMaxRetries),
    streamMaxRetries: provider.streamMaxRetries === undefined ? '' : String(provider.streamMaxRetries),
    streamIdleTimeoutMs: provider.streamIdleTimeoutMs === undefined
      ? ''
      : String(provider.streamIdleTimeoutMs),
    modelCatalogUrl: provider.modelCatalogUrl ?? '',
  };
}

/** The write entry one draft sends; trimmed, with `wire_api` fixed to the one accepted dialect. */
export function draftToWrite(draft: CodexProviderDraft): CodexModelProviderWrite {
  const token = draft.token.trim();
  const httpHeaders = recordFromPairs(draft.httpHeaders);
  const envHttpHeaders = recordFromPairs(draft.envHttpHeaders);
  const queryParams = recordFromPairs(draft.queryParams);
  const requestMaxRetries = integerFromText(draft.requestMaxRetries);
  const streamMaxRetries = integerFromText(draft.streamMaxRetries);
  const streamIdleTimeoutMs = integerFromText(draft.streamIdleTimeoutMs);
  const modelCatalogUrl = draft.modelCatalogUrl.trim();
  return {
    id: draft.id.trim(),
    name: draft.name.trim(),
    baseUrl: draft.baseUrl.trim(),
    envKey: draft.envKey.trim(),
    tokenFile: draft.tokenFile.trim(),
    wireApi: 'responses',
    ...(token === '' ? {} : { token }),
    ...(httpHeaders === undefined ? {} : { httpHeaders }),
    ...(envHttpHeaders === undefined ? {} : { envHttpHeaders }),
    ...(queryParams === undefined ? {} : { queryParams }),
    ...(requestMaxRetries === undefined ? {} : { requestMaxRetries }),
    ...(streamMaxRetries === undefined ? {} : { streamMaxRetries }),
    ...(streamIdleTimeoutMs === undefined ? {} : { streamIdleTimeoutMs }),
    ...(modelCatalogUrl === '' ? {} : { modelCatalogUrl }),
  };
}

/** A stale write is the server's 409; duck-typed so this module needs no fetch implementation. */
function isVersionConflict(error: unknown): boolean {
  return (
    typeof error === 'object'
    && error !== null
    && (error as { status?: unknown }).status === 409
  );
}

const INITIAL: CodexProvidersSnapshot = {
  status: 'loading',
  reading: null,
  drafts: [],
  error: null,
  imports: null,
  importStatus: 'loading',
  importError: null,
  connection: null,
  connectionStatus: 'idle',
  connectionError: null,
};

const EMPTY_DRAFT: CodexProviderDraft = {
  id: '',
  name: '',
  baseUrl: '',
  envKey: '',
  tokenFile: '',
  token: '',
  tokenSet: false,
  httpHeaders: [],
  envHttpHeaders: [],
  queryParams: [],
  requestMaxRetries: '',
  streamMaxRetries: '',
  streamIdleTimeoutMs: '',
  modelCatalogUrl: '',
};

/**
 * Creates the controller for the Codex provider settings panel. Used by
 * `useCodexProviders`; the hook is the React binding only.
 */
export function createCodexProvidersController(
  deps: CodexProvidersDeps,
): CodexProvidersController {
  let snapshot: CodexProvidersSnapshot = INITIAL;
  const listeners = new Set<() => void>();
  let disposed = false;
  let saving = false;
  let importing = false;
  let testingConnection = false;

  const publish = (next: CodexProvidersSnapshot): void => {
    if (disposed) return;
    snapshot = next;
    for (const listener of listeners) listener();
  };

  /** Replaces the draft rows from a reading; a save drops typed secrets this way too. */
  const applyReading = (
    reading: CodexModelProvidersReading,
    status: CodexProvidersSnapshot['status'],
  ): void => {
    publish({
      ...snapshot,
      status,
      reading,
      drafts: reading.providers.map(draftFromProvider),
      error: null,
    });
  };

  const load = async (): Promise<void> => {
    publish({ ...snapshot, status: 'loading', error: null });
    try {
      applyReading(await deps.read(), 'ready');
    } catch (error) {
      publish({
        ...snapshot,
        status: 'failed',
        error: { kind: 'load', message: errorMessage(error, 'unknown error') },
      });
    }
  };

  const addDraft = (): void => {
    publish({ ...snapshot, drafts: [...snapshot.drafts, { ...EMPTY_DRAFT }] });
  };

  const updateDraft = (index: number, patch: Partial<CodexProviderDraft>): void => {
    if (index < 0 || index >= snapshot.drafts.length) return;
    publish({
      ...snapshot,
      drafts: snapshot.drafts.map((draft, current) => (
        current === index ? { ...draft, ...patch } : draft
      )),
    });
  };

  const removeDraft = (index: number): void => {
    if (index < 0 || index >= snapshot.drafts.length) return;
    publish({
      ...snapshot,
      drafts: snapshot.drafts.filter((_, current) => current !== index),
    });
  };

  const save = async (): Promise<void> => {
    const reading = snapshot.reading;
    if (saving || reading === null) return;
    saving = true;
    publish({ ...snapshot, status: 'saving', error: null });
    try {
      const saved = await deps.save({
        providers: snapshot.drafts.map(draftToWrite),
        expectedVersion: reading.version,
      });
      applyReading(saved, 'ready');
    } catch (error) {
      // A conflict keeps the DRAFT and the OLD reading: the person can copy their rows, reload
      // to see the file that won, and save again. A plain failure stays retryable.
      const conflict = isVersionConflict(error);
      publish({
        ...snapshot,
        status: conflict ? 'ready' : 'failed',
        error: {
          kind: conflict ? 'conflict' : 'save',
          message: errorMessage(error, 'unknown error'),
        },
      });
    } finally {
      saving = false;
    }
  };

  /**
   * Reads the user-profile import view. A failure is the panel's own line and leaves the project
   * registry (and its drafts) untouched.
   */
  const loadImports = async (): Promise<void> => {
    publish({ ...snapshot, importStatus: 'loading', importError: null });
    try {
      const imports = await deps.readImports();
      publish({ ...snapshot, imports, importStatus: 'ready', importError: null });
    } catch (error) {
      publish({
        ...snapshot,
        importStatus: 'failed',
        importError: errorMessage(error, 'unknown error'),
      });
    }
  };

  /**
   * Binds one imported provider. The request carries the version of the registry the panel read
   * (so a stale bind is the same 409 a save gets); the answer replaces the drafts, which is what
   * makes the new provider appear in the model editor's picker.
   */
  const bindImportedProvider = async (providerId: string): Promise<void> => {
    const reading = snapshot.reading;
    if (importing || reading === null) return;
    importing = true;
    publish({ ...snapshot, importStatus: 'importing', importError: null });
    try {
      const saved = await deps.importProviders({
        ids: [providerId],
        expectedVersion: reading.version,
      });
      applyReading(saved, 'ready');
      publish({ ...snapshot, importStatus: 'ready', importError: null });
    } catch (error) {
      // A conflict is the SAVE path's presentation (the drafts are kept so the person can
      // reload and bind again); any other refusal belongs to the import panel.
      if (isVersionConflict(error)) {
        publish({
          ...snapshot,
          importStatus: 'ready',
          error: { kind: 'conflict', message: errorMessage(error, 'unknown error') },
        });
      } else {
        publish({
          ...snapshot,
          importStatus: 'failed',
          importError: errorMessage(error, 'unknown error'),
        });
      }
    } finally {
      importing = false;
    }
  };

  return {
    getSnapshot: () => snapshot,
    subscribe: (listener) => {
      listeners.add(listener);
      return () => {
        listeners.delete(listener);
      };
    },
    load,
    addDraft,
    updateDraft,
    removeDraft,
    save,
    loadImports,
    bindImportedProvider,
    /**
     * Runs one connection probe against a SAVED provider. A failure is the panel's own line
     * (`connectionError`) and leaves the registry and its drafts untouched; the previous probe
     * is cleared at the start so a network failure never leaves an old outcome on screen.
     */
    testConnection: async (providerId: string): Promise<void> => {
      const id = providerId.trim();
      if (testingConnection || id === '') return;
      testingConnection = true;
      publish({
        ...snapshot,
        connection: null,
        connectionStatus: 'testing',
        connectionError: null,
      });
      try {
        const probe = await deps.testConnection(id);
        publish({
          ...snapshot,
          connection: { providerId: id, probe },
          connectionStatus: 'idle',
          connectionError: null,
        });
      } catch (error) {
        publish({
          ...snapshot,
          connectionStatus: 'idle',
          connectionError: errorMessage(error, 'unknown error'),
        });
      } finally {
        testingConnection = false;
      }
    },
    activate: () => {
      disposed = false;
    },
    dispose: () => {
      disposed = true;
      listeners.clear();
    },
  };
}

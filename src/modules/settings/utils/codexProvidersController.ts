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

/** One editable provider row. `token` is write-only; `''` means "keep the stored secret". */
export type CodexProviderDraft = {
  id: string;
  name: string;
  baseUrl: string;
  envKey: string;
  tokenFile: string;
  token: string;
  /** Whether the token file currently holds a secret, as the reading reported it. */
  tokenSet: boolean;
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
};

/** What the outside world hands the controller; the settings API is the shipped binding. */
export type CodexProvidersDeps = {
  read: () => Promise<CodexModelProvidersReading>;
  save: (input: {
    providers: CodexModelProviderWrite[];
    expectedVersion: string;
  }) => Promise<CodexModelProvidersReading>;
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
  /** Re-arms the SAME controller after React StrictMode's cleanup/setup pass. */
  activate: () => void;
  dispose: () => void;
};

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
  };
}

/** The write entry one draft sends; trimmed, with `wire_api` fixed to the one accepted dialect. */
export function draftToWrite(draft: CodexProviderDraft): CodexModelProviderWrite {
  const token = draft.token.trim();
  return {
    id: draft.id.trim(),
    name: draft.name.trim(),
    baseUrl: draft.baseUrl.trim(),
    envKey: draft.envKey.trim(),
    tokenFile: draft.tokenFile.trim(),
    wireApi: 'responses',
    ...(token === '' ? {} : { token }),
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
};

const EMPTY_DRAFT: CodexProviderDraft = {
  id: '',
  name: '',
  baseUrl: '',
  envKey: '',
  tokenFile: '',
  token: '',
  tokenSet: false,
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
    activate: () => {
      disposed = false;
    },
    dispose: () => {
      disposed = true;
      listeners.clear();
    },
  };
}

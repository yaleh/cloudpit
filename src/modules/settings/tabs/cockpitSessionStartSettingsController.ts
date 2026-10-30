import { errorMessage } from '@/shared/utils';
import type {
  CockpitSessionStartSettingsReading,
  LLMProvider,
  ProviderModelsDefinition,
} from '@/shared/types';

/**
 * The Settings → Cockpit → "new conversation" form's rules: what the model/effort pickers may
 * offer, which values the form starts from, and what a save means.
 *
 * WHY A CONTROLLER. Three things here are rules rather than rendering, and each one is a bug if
 * it lives in JSX: the pickers are populated from the PROVIDER CATALOG (so a deleted model can
 * never be chosen), the draft starts from the SAVED reading rather than from a local default,
 * and a save carries the exact `version` the reading arrived with — a stale version is a visible
 * conflict, never a silent overwrite. The tab is only the drawing of this snapshot.
 */

/** Why the form could not read or save. The tab translates each kind. */
export type CockpitSessionStartSettingsError =
  /** The catalog or the reading could not be loaded; nothing is editable until it is. */
  | { kind: 'load'; message: string }
  /** The save failed for a reason other than a stale version. */
  | { kind: 'save'; message: string }
  /** Another editor saved first; the draft is kept and the person must reload to see it. */
  | { kind: 'conflict'; message: string };

/** One reasoning-effort choice the draft model's catalog entry offers. */
export type CockpitEffortOption = { value: string; description?: string };

/** One model choice the picker offers. */
export type CockpitModelOption = { value: string; label: string };

export type CockpitSessionStartSettingsSnapshot = {
  status: 'loading' | 'ready' | 'saving' | 'failed';
  /** The server reading the form was built from, or `null` before the first load. */
  reading: CockpitSessionStartSettingsReading | null;
  /** The provider catalog the model/effort pickers are drawn from. */
  catalog: ProviderModelsDefinition | null;
  /** The model picker's choices: the catalog, plus the saved value if the catalog dropped it. */
  modelOptions: CockpitModelOption[];
  /** The value the model picker is showing. */
  draftModel: string;
  /** The value the effort picker is showing; `''` means "the provider's own default". */
  draftEffort: string;
  /** The efforts the DRAFT model's catalog entry offers; empty means the provider decides. */
  effortOptions: CockpitEffortOption[];
  error: CockpitSessionStartSettingsError | null;
};

/** What the outside world hands the controller; the settings API is the shipped binding. */
export type CockpitSessionStartSettingsDeps = {
  read: () => Promise<CockpitSessionStartSettingsReading>;
  save: (input: {
    model: string;
    effort?: string;
    expectedVersion: string;
  }) => Promise<CockpitSessionStartSettingsReading>;
  readCatalog: () => Promise<ProviderModelsDefinition>;
  /** The provider whose catalog is offered; the card start path's own default is `claude`. */
  provider: LLMProvider;
};

export type CockpitSessionStartSettingsController = {
  getSnapshot: () => CockpitSessionStartSettingsSnapshot;
  subscribe: (listener: () => void) => () => void;
  /** Reads the catalog and the current reading; safe to call again after a conflict. */
  load: () => Promise<void>;
  setDraftModel: (value: string) => void;
  setDraftEffort: (value: string) => void;
  /** Saves the draft against the version the current reading carries. */
  save: () => Promise<void>;
  /** Re-arms the SAME controller after React StrictMode's cleanup/setup pass. */
  activate: () => void;
  dispose: () => void;
};

const EMPTY_EFFORT_OPTIONS: CockpitEffortOption[] = [];

/**
 * The model picker's choices. The SAVED value is kept visible even when the catalog no longer
 * lists it — a model deleted from the library must be changeable from this page, not hidden.
 */
export function cockpitModelOptions(
  catalog: ProviderModelsDefinition | null,
  currentModel: string,
): CockpitModelOption[] {
  const options = (catalog?.OPTIONS ?? []).map((option) => ({
    value: option.value,
    label: option.label || option.value,
  }));
  if (currentModel !== '' && !options.some((option) => option.value === currentModel)) {
    options.unshift({ value: currentModel, label: currentModel });
  }
  return options;
}

/**
 * The effort choices a model offers, from the catalog. An unknown/blank model falls back to the
 * catalog's DEFAULT entry, which is what the launch itself would fall back to.
 */
export function cockpitEffortOptions(
  catalog: ProviderModelsDefinition | null,
  model: string,
): CockpitEffortOption[] {
  if (catalog === null) return EMPTY_EFFORT_OPTIONS;
  const selected = catalog.OPTIONS.find((option) => option.value === model);
  const option = selected ?? catalog.OPTIONS.find((entry) => entry.value === catalog.DEFAULT);
  return option?.effort?.values ?? EMPTY_EFFORT_OPTIONS;
}

/** A stale write is the server's 409; duck-typed so this module needs no fetch implementation. */
function isVersionConflict(error: unknown): boolean {
  return (
    typeof error === 'object'
    && error !== null
    && (error as { status?: unknown }).status === 409
  );
}

const INITIAL: CockpitSessionStartSettingsSnapshot = {
  status: 'loading',
  reading: null,
  catalog: null,
  modelOptions: [],
  draftModel: '',
  draftEffort: '',
  effortOptions: EMPTY_EFFORT_OPTIONS,
  error: null,
};

/**
 * Creates the controller for the Settings → Cockpit tab. Used by
 * `useCockpitSessionStartSettings`; the hook is the React binding only.
 */
export function createCockpitSessionStartSettingsController(
  deps: CockpitSessionStartSettingsDeps,
): CockpitSessionStartSettingsController {
  let snapshot: CockpitSessionStartSettingsSnapshot = INITIAL;
  const listeners = new Set<() => void>();
  let disposed = false;
  let saving = false;

  const publish = (next: CockpitSessionStartSettingsSnapshot): void => {
    if (disposed) return;
    snapshot = next;
    for (const listener of listeners) listener();
  };

  const load = async (): Promise<void> => {
    publish({ ...snapshot, status: 'loading', error: null });
    try {
      const [reading, catalog] = await Promise.all([deps.read(), deps.readCatalog()]);
      publish({
        status: 'ready',
        reading,
        catalog,
        // The SAVED values, not the effective ones: this form edits what the next boot applies.
        modelOptions: cockpitModelOptions(catalog, reading.model),
        draftModel: reading.model,
        draftEffort: reading.effort,
        effortOptions: cockpitEffortOptions(catalog, reading.model),
        error: null,
      });
    } catch (error) {
      publish({ ...snapshot, status: 'failed', error: { kind: 'load', message: errorMessage(error, 'unknown error') } });
    }
  };

  const setDraftModel = (value: string): void => {
    // A model change re-reads that model's effort table. An effort the new model does not offer
    // is CLEARED rather than kept: keeping it would submit a value the launch silently drops.
    const effortOptions = cockpitEffortOptions(snapshot.catalog, value);
    const draftEffort = effortOptions.some((option) => option.value === snapshot.draftEffort)
      ? snapshot.draftEffort
      : '';
    publish({ ...snapshot, draftModel: value, draftEffort, effortOptions });
  };

  const setDraftEffort = (value: string): void => {
    publish({ ...snapshot, draftEffort: value });
  };

  const save = async (): Promise<void> => {
    const reading = snapshot.reading;
    if (saving || reading === null) return;
    const model = snapshot.draftModel.trim();
    if (model === '') {
      publish({
        ...snapshot,
        status: 'failed',
        error: { kind: 'save', message: 'the model must not be empty' },
      });
      return;
    }

    saving = true;
    const draftEffort = snapshot.draftEffort.trim();
    publish({ ...snapshot, status: 'saving', error: null });
    try {
      const saved = await deps.save({
        model,
        ...(draftEffort === '' ? {} : { effort: draftEffort }),
        expectedVersion: reading.version,
      });
      // The server answers with the same saved-beside-effective reading, so `restartRequired`
      // and the effective values shown after a save are the server's, not a local guess.
      publish({
        status: 'ready',
        reading: saved,
        catalog: snapshot.catalog,
        modelOptions: cockpitModelOptions(snapshot.catalog, saved.model),
        draftModel: saved.model,
        draftEffort: saved.effort,
        effortOptions: cockpitEffortOptions(snapshot.catalog, saved.model),
        error: null,
      });
    } catch (error) {
      // A conflict keeps the DRAFT and the OLD reading: the person can copy their choice, reload
      // to see the file that won, and save again. A plain failure says so and stays retryable.
      publish({
        ...snapshot,
        status: isVersionConflict(error) ? 'ready' : 'failed',
        error: {
          kind: isVersionConflict(error) ? 'conflict' : 'save',
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
    setDraftModel,
    setDraftEffort,
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

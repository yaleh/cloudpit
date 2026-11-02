/**
 * Settings → Agents → Codex's scenario reading and its `codexProvider.*` / `modelLibrary.*`
 * drive verbs.
 *
 * WHY THIS IS A SIBLING FILE. The Codex provider registry and its bound model editor are one
 * self-contained slice of the scenario surface: a reading taken from the `data-codex-*` /
 * `data-model-library-*` attributes the panels already draw, and verbs that press the same
 * inputs and buttons a person presses. `scenarioSurface` imports it and nothing else does — the
 * same split as {@link ./settingsSurface}.
 *
 * THE READING IS THE PAGE'S OWN DECLARATION. The registry root publishes its status, error,
 * row count and path; each row publishes its id and whether a secret is stored (never a
 * value); the model editor publishes its provider picker and save state. An absent attribute
 * is `null`, never a fabricated value.
 *
 * THE VERBS PRESS THE PRODUCT'S CONTROLS. Inputs are set through their own `input`/`change`
 * events and buttons through their own click, so a reading can only change because the page's
 * controller handled the press. Nothing here writes an attribute.
 */

/** The Codex provider panel's reading, projected for a scenario. */
export type ScenarioCodexProvidersReading = {
  /** True when the Codex provider panel is mounted. */
  open: boolean;
  /** The panel's own status: `loading` / `ready` / `saving` / `failed`, or `null`. */
  status: string | null;
  /** The visible error kind (`load` / `save` / `conflict`), or `null`. */
  error: string | null;
  /** The number of editable provider rows on screen. */
  count: number;
  /** Every row's `providerId`, in draw order. */
  ids: string[];
  /** Per row, whether its token file currently holds a secret (never the secret itself). */
  tokenSet: boolean[];
  /** Every warning the page shows (unknown fields, unusable token files, document warnings). */
  warnings: string[];
  /** The Responses-only notice's text, or `null` when it is not drawn. */
  responsesOnly: string | null;
  /** The model editor's selected upstream provider ('' = inherit the Codex default), or `null`. */
  modelProvider: string | null;
  /** The model editor's provider options, in draw order. */
  modelProviderOptions: string[];
  /** The model library form's own status: `idle` / `saving` / `saved` / `failed`, or `null`. */
  modelLibraryStatus: string | null;
  /** The model library's last notice (for example "X was added."), or `null`. */
  modelLibraryNotice: string | null;
  /** The model library's visible error, or `null`. */
  modelLibraryError: string | null;
  /** The custom model ids the library lists, in draw order. */
  modelIds: string[];
  /** The custom models' labels as drawn (a bound model reads `model · provider`). */
  modelLabels: string[];
};

const ROOT = '[data-codex-providers]';
const ROW = '[data-codex-provider-index]';
const RESPONSES_ONLY = '[data-testid="codex-responses-only"]';
const WARNING = '[data-testid="codex-provider-warning"]';
const MODEL_LIBRARY = '[data-model-library-status]';
const MODEL_PROVIDER_SELECT = '[data-testid="model-codex-provider-select"]';
const MODEL_NAME = '#custom-model-name';
const MODEL_ID = '#custom-model-id';
const MODEL_SAVE = '[data-model-library-save]';
const MODEL_ROW = '[data-model-library-model]';

/** One attribute as a string, or `null` when the element/attribute is absent. */
function attribute(element: Element | null, name: string): string | null {
  return element?.getAttribute(name) ?? null;
}

/** `''` is the "not loaded yet" state; a scenario reads it as absent. */
function nonEmpty(value: string | null): string | null {
  return value === null || value === '' ? null : value;
}

/** The panel root, or `null` when the Codex provider settings are not mounted. */
function rootElement(): Element | null {
  return document.querySelector(ROOT);
}

/** Reads the panel's own published state. */
export function readCodexProvidersReading(): ScenarioCodexProvidersReading {
  const root = rootElement();
  if (root === null) {
    return {
      open: false,
      status: null,
      error: null,
      count: 0,
      ids: [],
      tokenSet: [],
      warnings: [],
      responsesOnly: null,
      modelProvider: null,
      modelProviderOptions: [],
      modelLibraryStatus: null,
      modelLibraryNotice: null,
      modelLibraryError: null,
      modelIds: [],
      modelLabels: [],
    };
  }
  const rows = [...document.querySelectorAll(ROW)];
  const select = document.querySelector(MODEL_PROVIDER_SELECT) as HTMLSelectElement | null;
  const modelLibrary = document.querySelector(MODEL_LIBRARY);
  return {
    open: true,
    status: attribute(root, 'data-codex-providers'),
    error: nonEmpty(attribute(root, 'data-codex-providers-error')),
    count: rows.length,
    ids: rows.map((row) => attribute(row, 'data-codex-provider-id') ?? ''),
    tokenSet: rows.map((row) => attribute(row, 'data-codex-provider-token-set') === 'true'),
    warnings: [...document.querySelectorAll(WARNING)]
      .map((node) => node.textContent?.trim() ?? '')
      .filter((text) => text !== ''),
    responsesOnly: nonEmpty(document.querySelector(RESPONSES_ONLY)?.textContent?.trim() ?? null),
    modelProvider: select === null ? null : select.value,
    modelProviderOptions: select === null ? [] : Array.from(select.options).map((option) => option.value),
    modelLibraryStatus: attribute(modelLibrary, 'data-model-library-status'),
    modelLibraryNotice: nonEmpty(attribute(modelLibrary, 'data-model-library-notice')),
    modelLibraryError: nonEmpty(attribute(modelLibrary, 'data-model-library-error')),
    modelIds: [...document.querySelectorAll(MODEL_ROW)]
      .map((row) => attribute(row, 'data-model-library-model') ?? ''),
    modelLabels: [...document.querySelectorAll(MODEL_ROW)]
      .map((row) => attribute(row, 'data-model-library-model-label') ?? ''),
  };
}

/** One step this slice can drive. Each carries exactly one action. */
export type CodexProviderDriveStep =
  | { 'codexProvider.add': true }
  | {
    'codexProvider.fill': {
      index: number;
      field: 'id' | 'name' | 'baseUrl' | 'envKey' | 'tokenFile' | 'token';
      value: string;
    };
  }
  | { 'codexProvider.save': true }
  | { 'modelLibrary.setField': { field: 'name' | 'id'; value: string } }
  | { 'modelLibrary.selectCodexProvider': string }
  | { 'modelLibrary.save': true };

/** True when the step carries one of this slice's commands. */
export function isCodexProviderStep(step: object): step is CodexProviderDriveStep {
  return Object.keys(step).some(
    (key) => key.startsWith('codexProvider.') || key.startsWith('modelLibrary.'),
  );
}

/** Dispatches one step's real presses and answers the action name for the timing report. */
export function dispatchCodexProviderStep(step: CodexProviderDriveStep): string {
  if ('codexProvider.add' in step) {
    pressAddCodexProvider();
    return 'codexProvider.add';
  }
  if ('codexProvider.fill' in step) {
    const fill = step['codexProvider.fill'];
    fillCodexProviderField(fill.index, fill.field, fill.value);
    return 'codexProvider.fill';
  }
  if ('codexProvider.save' in step) {
    pressSaveCodexProviders();
    return 'codexProvider.save';
  }
  if ('modelLibrary.setField' in step) {
    const fill = step['modelLibrary.setField'];
    fillModelLibraryField(fill.field, fill.value);
    return 'modelLibrary.setField';
  }
  if ('modelLibrary.selectCodexProvider' in step) {
    selectModelCodexProvider(step['modelLibrary.selectCodexProvider']);
    return 'modelLibrary.selectCodexProvider';
  }
  pressModelLibrarySave();
  return 'modelLibrary.save';
}

/**
 * Sets one controlled input's value and fires the events React's `onChange` listens to.
 *
 * THE NATIVE SETTER IS THE MECHANISM. React installs a value tracker on each controlled input;
 * writing `input.value` directly updates that tracker, so the following `input` event looks
 * unchanged and `onChange` never runs (the DOM shows the typed text while the component state
 * stays empty). Calling the prototype setter bypasses the tracker, exactly as a real keypress
 * does — the same technique Playwright's `fill` uses.
 */
function setInput(selector: string, value: string): void {
  const input = document.querySelector(selector) as HTMLInputElement | null;
  if (input === null || input.disabled) {
    return;
  }
  const setter = Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value')?.set;
  if (setter !== undefined) {
    setter.call(input, value);
  } else {
    input.value = value;
  }
  input.dispatchEvent(new Event('input', { bubbles: true }));
  input.dispatchEvent(new Event('change', { bubbles: true }));
}

/** Presses one button by selector, ignoring a disabled control. */
function press(selector: string): void {
  const button = document.querySelector(selector) as HTMLButtonElement | null;
  if (button === null || button.disabled) {
    return;
  }
  button.click();
}

/** Appends an empty provider row. */
export function pressAddCodexProvider(): void {
  press('[data-codex-providers-add]');
}

/** Types one field of the provider row at `index`. */
export function fillCodexProviderField(
  index: number,
  field: 'id' | 'name' | 'baseUrl' | 'envKey' | 'tokenFile' | 'token',
  value: string,
): void {
  setInput(`[data-codex-provider-index="${index}"] [data-codex-provider-field="${field}"]`, value);
}

/** Saves the whole registry. */
export function pressSaveCodexProviders(): void {
  press('[data-codex-providers-save]');
}

/** Types the model editor's name (`name`) or id (`id`) field. */
export function fillModelLibraryField(field: 'name' | 'id', value: string): void {
  setInput(field === 'name' ? MODEL_NAME : MODEL_ID, value);
}

/** Chooses the upstream provider a new model binds to ('' = the Codex global default). */
export function selectModelCodexProvider(value: string): void {
  const select = document.querySelector(MODEL_PROVIDER_SELECT) as HTMLSelectElement | null;
  if (select === null || select.disabled) {
    return;
  }
  const setter = Object.getOwnPropertyDescriptor(HTMLSelectElement.prototype, 'value')?.set;
  if (setter !== undefined) {
    setter.call(select, value);
  } else {
    select.value = value;
  }
  select.dispatchEvent(new Event('input', { bubbles: true }));
  select.dispatchEvent(new Event('change', { bubbles: true }));
}

/** Submits the model editor's form. */
export function pressModelLibrarySave(): void {
  press(MODEL_SAVE);
}

/**
 * Crosses the task boundary the panels' own updates need, and waits out an in-flight save.
 *
 * Both the registry save and the model save answer over the network; polling each panel's own
 * published status keeps a scenario's next `read()` from catching a request mid-flight. The
 * timeout is a scenario failure, not a hang. A panel that is not mounted is a no-op.
 */
export async function settleCodexProvidersStep(): Promise<void> {
  const deadline = Date.now() + 10_000;
  while (Date.now() < deadline) {
    await new Promise((resolve) => setTimeout(resolve, 10));
    const registryStatus = attribute(rootElement(), 'data-codex-providers');
    const libraryStatus = attribute(document.querySelector(MODEL_LIBRARY), 'data-model-library-status');
    if (registryStatus !== 'loading' && registryStatus !== 'saving'
      && libraryStatus !== 'saving') {
      // One more boundary so the commit that left those states is what the next read sees.
      await new Promise((resolve) => setTimeout(resolve, 0));
      return;
    }
  }
}

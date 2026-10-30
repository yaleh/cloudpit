/**
 * The Settings → Cockpit form's scenario reading and its `settings.*` drive verbs.
 *
 * WHY THIS IS A SIBLING FILE. The form is one self-contained slice of the scenario surface: a
 * reading taken from the `data-cockpit-session-start*` attributes the tab already draws, and three
 * verbs that press the selects and the Save button a person presses. `scenarioSurface` imports it
 * and nothing else does — the same split as {@link ./cockpitCardsSurface}.
 *
 * THE READING IS THE FORM'S OWN DECLARATION. The tab publishes its status, the draft values, the
 * saved and effective readings and the restart flag on its root, so a scenario reads the page
 * rather than inferring "a save is pending" from a rendered sentence. An absent attribute is
 * `null`, never a fabricated value.
 *
 * THE VERBS PRESS THE PRODUCT'S CONTROLS. A select is set through its own `change` event and the
 * Save button through its own click, so the reading can only change because the tab's controller
 * handled the press. Nothing here writes the attributes.
 *
 * SETTLE WAITS FOR THE SAVE'S ANSWER. `drive` is synchronous and the save is a request, so after a
 * `settings.save` step the runner's `settle` polls the form's status until it leaves `saving` — the
 * same task-boundary rule the card steps follow.
 */

/** The form's reading, projected for a scenario. Every field is what the page shows. */
export type ScenarioSettingsReading = {
  /** True when the Settings dialog's cockpit tab is mounted. */
  open: boolean;
  /** The form's own status: `loading` / `ready` / `saving` / `failed`, or `null` when unmounted. */
  status: string | null;
  /** The model the picker is showing (`''` when the list has not loaded a model yet). */
  draftModel: string | null;
  /** The effort the picker is showing; `''` is "the provider's own default". */
  draftEffort: string | null;
  /** The model/effort a saved file holds, as the page reports them. */
  savedModel: string | null;
  savedEffort: string | null;
  /** The model/effort THIS boot is running, as the page reports them. */
  effectiveModel: string | null;
  effectiveEffort: string | null;
  /** True while the saved reading differs from the one in effect. */
  restartRequired: boolean | null;
  /** The visible error kind (`load` / `save` / `conflict`), or `null`. */
  error: string | null;
};

const ROOT = '[data-cockpit-session-start]';
const MODEL_SELECT = '[data-cockpit-session-start-model-select]';
const EFFORT_SELECT = '[data-cockpit-session-start-effort-select]';
const SAVE = '[data-cockpit-session-start-save]';

/** The `data-cockpit-session-start` root, or `null` when the tab is not mounted. */
function formElement(): HTMLElement | null {
  return document.querySelector(ROOT) as HTMLElement | null;
}

/** One attribute as a string, or `null` when the attribute is absent. */
function attribute(element: HTMLElement, name: string): string | null {
  const value = element.getAttribute(name);
  return value === null ? null : value;
}

/** One attribute as a value, with `''` (the "not loaded yet" state) answering `null`. */
function nonEmpty(value: string | null): string | null {
  return value === null || value === '' ? null : value;
}

/** Reads the form's state off the attributes the tab already draws. */
export function readSettingsReading(): ScenarioSettingsReading | null {
  const form = formElement();
  if (form === null) {
    return null;
  }
  const restart = attribute(form, 'data-cockpit-session-start-restart');
  return {
    open: true,
    status: attribute(form, 'data-cockpit-session-start'),
    draftModel: nonEmpty(attribute(form, 'data-cockpit-session-start-draft-model')),
    draftEffort: attribute(form, 'data-cockpit-session-start-draft-effort'),
    savedModel: nonEmpty(attribute(form, 'data-cockpit-session-start-saved-model')),
    savedEffort: attribute(form, 'data-cockpit-session-start-saved-effort'),
    effectiveModel: nonEmpty(attribute(form, 'data-cockpit-session-start-effective-model')),
    effectiveEffort: attribute(form, 'data-cockpit-session-start-effective-effort'),
    restartRequired: restart === null || restart === '' ? null : restart === 'true',
    error: nonEmpty(attribute(form, 'data-cockpit-session-start-error')),
  };
}

/**
 * Sets a native select's value and fires the event React's `onChange` listens to.
 *
 * A disabled select is left alone: during `loading`/`saving` the product disables the pickers, and
 * a scenario step that ran then is a real failure rather than something to force through.
 */
function pressSelect(selector: string, value: string): void {
  const select = document.querySelector(selector) as HTMLSelectElement | null;
  if (select === null || select.disabled) {
    return;
  }
  select.value = value;
  select.dispatchEvent(new Event('input', { bubbles: true }));
  select.dispatchEvent(new Event('change', { bubbles: true }));
}

/** Chooses one model in the form's model picker. */
export function selectSettingsModel(value: string): void {
  pressSelect(MODEL_SELECT, value);
}

/** Chooses one reasoning effort (or `''` for the provider default) in the effort picker. */
export function selectSettingsEffort(value: string): void {
  pressSelect(EFFORT_SELECT, value);
}

/** Presses the form's Save button. */
export function pressSettingsSave(): void {
  const button = document.querySelector(SAVE) as HTMLButtonElement | null;
  if (button === null || button.disabled) {
    return;
  }
  button.click();
}

/**
 * Crosses the task boundary the form's own updates need, and waits out an in-flight save.
 *
 * React commits a select's `onChange` in a microtask; a save answers over the network. Polling the
 * published status keeps a scenario's next `read()` from catching the form mid-request, and the
 * timeout is a failure of the scenario, not a hang. When the tab is not mounted this is a no-op.
 */
export async function settleSettingsStep(): Promise<void> {
  if (formElement() === null) {
    return;
  }
  const deadline = Date.now() + 10_000;
  for (;;) {
    await new Promise((resolve) => setTimeout(resolve, 10));
    const status = attribute(formElement() ?? document.createElement('div'), 'data-cockpit-session-start');
    if (status !== 'loading' && status !== 'saving') {
      // One more boundary so the commit that left those states is what the next read sees.
      await new Promise((resolve) => setTimeout(resolve, 0));
      return;
    }
    if (Date.now() >= deadline) {
      return;
    }
  }
}

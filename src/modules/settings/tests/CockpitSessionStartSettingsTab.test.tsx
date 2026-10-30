import assert from 'node:assert/strict';

import { fireEvent, render, waitFor } from '@testing-library/react';
import React from 'react';
import { beforeEach, expect, test, vi } from 'vitest';

import CockpitSessionStartSettingsTab from '@/modules/settings/tabs/CockpitSessionStartSettingsTab';
import type * as SharedApi from '@/shared/api';
import type {
  CockpitSessionStartSettingsReading,
  ProviderModelsDefinition,
} from '@/shared/types';

/**
 * Settings → Cockpit: the form that edits the model (and optional reasoning effort) a NEW
 * conversation opens with when it is started from a cockpit card.
 *
 * FOUR READINGS, each taken off what the form actually did:
 *
 *  1. The pickers are the PROVIDER CATALOG, the form starts on the SAVED values, and the page
 *     shows the saved reading beside the one the running process is still using — with the
 *     「restart to take effect」 notice while they differ.
 *  2. A save sends exactly the edited model/effort with the VERSION the reading arrived with,
 *     and the server's answer replaces the readings (so the pending state is the server's).
 *  3. A save failure is visible text, not a silent no-op.
 *  4. A stale version is a CONFLICT (409), reported as such, with the draft kept so the choice
 *     is not lost while the person reloads.
 *
 * The api module is replaced at the `api` object only: `readApiJson` stays the real one, so the
 * error cases drive the same envelope parsing production does.
 */

const apiMocks = vi.hoisted(() => ({
  cockpitSessionStart: vi.fn(),
  saveCockpitSessionStart: vi.fn(),
  models: vi.fn(),
}));

vi.mock('@/shared/api', async (importOriginal) => {
  const actual = await importOriginal<typeof SharedApi>();
  return {
    ...actual,
    api: {
      ...actual.api,
      settings: {
        ...actual.api.settings,
        cockpitSessionStart: apiMocks.cockpitSessionStart,
        saveCockpitSessionStart: apiMocks.saveCockpitSessionStart,
      },
      providers: { ...actual.api.providers, models: apiMocks.models },
    },
  };
});

vi.mock('react-i18next', async (importOriginal) => ({
  ...(await importOriginal() as object),
  // The key itself is the readable label, so a case asserts the exact key rendered.
  useTranslation: () => ({ t: (key: string) => key }),
}));

const READINGS: CockpitSessionStartSettingsReading = {
  model: 'sonnet-x',
  effort: 'high',
  effectiveModel: 'sonnet-old',
  effectiveEffort: '',
  version: 'version-1',
  restartRequired: true,
};

const CATALOG: ProviderModelsDefinition = {
  DEFAULT: 'sonnet-x',
  OPTIONS: [
    {
      value: 'sonnet-x',
      label: 'Sonnet X',
      effort: { values: [{ value: 'low' }, { value: 'high' }] },
    },
    {
      value: 'haiku-y',
      label: 'Haiku Y',
      effort: { values: [{ value: 'low' }] },
    },
  ],
};

const ok = (data: unknown) => Promise.resolve({ ok: true, json: async () => data } as Response);

/** A failed envelope, answered through the REAL `readApiJson` so its status reaches the form. */
const failure = (status: number, code: string, message: string) => Promise.resolve({
  ok: false,
  status,
  json: async () => ({ success: false, error: { code, message } }),
} as Response);

beforeEach(() => {
  apiMocks.cockpitSessionStart.mockReset();
  apiMocks.saveCockpitSessionStart.mockReset();
  apiMocks.models.mockReset();
  apiMocks.cockpitSessionStart.mockImplementation(() => ok({ ...READINGS }));
  apiMocks.models.mockImplementation(() => ok({ success: true, data: { models: CATALOG } }));
});

/** The model and effort pickers, selected by the accessible labels the tab gives them. */
const pickers = (view: ReturnType<typeof render>) => ({
  model: view.getByLabelText('cockpitSessionStart.modelLabel') as HTMLSelectElement,
  effort: view.getByLabelText('cockpitSessionStart.effortLabel') as HTMLSelectElement,
});

test('reads the catalog, starts on the saved values, and shows effective beside saved', async () => {
  const view = render(<CockpitSessionStartSettingsTab />);

  await waitFor(() => assert.equal(pickers(view).model.value, 'sonnet-x'));

  const { model, effort } = pickers(view);
  assert.deepEqual(
    Array.from(model.options).map((option) => option.value),
    ['sonnet-x', 'haiku-y'],
    'the model picker is the provider catalog',
  );
  assert.deepEqual(
    Array.from(effort.options).map((option) => option.value),
    ['', 'low', 'high'],
    'the effort picker is the DRAFT model’s catalog entry',
  );
  assert.equal(effort.value, 'high', 'the form starts on the SAVED effort');

  // Saved vs effective: the page must show both, because a save does not change this process.
  assert.ok(view.getByText(/sonnet-old/), 'the effective model is shown');
  assert.ok(view.getByText(/sonnet-x \/ high/), 'the saved model/effort is shown');
  assert.ok(view.getByText('cockpitSessionStart.restartRequired'), 'the restart notice is shown');

  console.log(`(1) models=[${Array.from(model.options).map((option) => option.value)}] efforts=[${Array.from(effort.options).map((option) => option.value)}]`);
});

test('switching to a model that does not offer the draft effort clears the effort', async () => {
  const view = render(<CockpitSessionStartSettingsTab />);
  await waitFor(() => assert.equal(pickers(view).model.value, 'sonnet-x'));

  fireEvent.change(pickers(view).model, { target: { value: 'haiku-y' } });

  await waitFor(() => assert.equal(pickers(view).model.value, 'haiku-y'));
  assert.equal(pickers(view).effort.value, '', 'an unavailable effort is not submitted silently');
  assert.deepEqual(
    Array.from(pickers(view).effort.options).map((option) => option.value),
    ['', 'low'],
  );
});

test('a save sends the edited values with the version it read, and adopts the server answer', async () => {
  const saved: CockpitSessionStartSettingsReading = {
    model: 'haiku-y',
    effort: 'low',
    effectiveModel: 'sonnet-old',
    effectiveEffort: '',
    version: 'version-2',
    restartRequired: true,
  };
  apiMocks.saveCockpitSessionStart.mockImplementation(() => ok(saved));

  const view = render(<CockpitSessionStartSettingsTab />);
  await waitFor(() => assert.equal(pickers(view).model.value, 'sonnet-x'));

  fireEvent.change(pickers(view).model, { target: { value: 'haiku-y' } });
  fireEvent.change(pickers(view).effort, { target: { value: 'low' } });
  fireEvent.click(view.getByText('cockpitSessionStart.save'));

  await waitFor(() => expect(apiMocks.saveCockpitSessionStart).toHaveBeenCalledTimes(1));
  assert.deepEqual(apiMocks.saveCockpitSessionStart.mock.calls[0][0], {
    model: 'haiku-y',
    effort: 'low',
    expectedVersion: 'version-1',
  });

  await waitFor(() => assert.equal(pickers(view).model.value, 'haiku-y'));
  assert.equal(pickers(view).effort.value, 'low');
  assert.ok(view.getByText(/haiku-y \/ low/), 'the saved reading is the server’s answer');
  assert.ok(view.getByText('cockpitSessionStart.restartRequired'), 'the change is still pending');
  console.log(`(2) sent=${JSON.stringify(apiMocks.saveCockpitSessionStart.mock.calls[0][0])}`);
});

test('a save failure is visible text', async () => {
  apiMocks.saveCockpitSessionStart.mockImplementation(() =>
    failure(500, 'SERVER_SETTINGS_WRITE_FAILED', 'disk full'),
  );

  const view = render(<CockpitSessionStartSettingsTab />);
  await waitFor(() => assert.equal(pickers(view).model.value, 'sonnet-x'));

  fireEvent.click(view.getByText('cockpitSessionStart.save'));

  const alert = await waitFor(() => view.getByRole('alert'));
  assert.match(alert.textContent ?? '', /cockpitSessionStart\.saveFailed/);
  assert.match(alert.textContent ?? '', /disk full/);
  console.log(`(3) alert=${alert.textContent}`);
});

test('a stale version is reported as a conflict and keeps the draft', async () => {
  apiMocks.saveCockpitSessionStart.mockImplementation(() =>
    failure(409, 'VERSION_CONFLICT', 'The settings file changed since it was read; reload and save again.'),
  );

  const view = render(<CockpitSessionStartSettingsTab />);
  await waitFor(() => assert.equal(pickers(view).model.value, 'sonnet-x'));

  fireEvent.change(pickers(view).effort, { target: { value: 'low' } });
  fireEvent.click(view.getByText('cockpitSessionStart.save'));

  const alert = await waitFor(() => view.getByRole('alert'));
  assert.match(alert.textContent ?? '', /cockpitSessionStart\.versionConflict/);
  assert.equal(pickers(view).effort.value, 'low', 'the draft survives the conflict');
  assert.ok(view.getByText('cockpitSessionStart.reload'), 'a reload affordance is on screen');
  console.log(`(4) conflict alert=${alert.textContent}`);
});

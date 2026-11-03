import assert from 'node:assert/strict';

import { fireEvent, render, waitFor } from '@testing-library/react';
import React from 'react';
import { beforeEach, test, vi } from 'vitest';

import AgentCategoryContentSection from '@/modules/settings/tabs/agents-settings/sections/AgentCategoryContentSection';
import type { CodexUserProviderImportReading } from '@/modules/settings/utils/codexProvidersController';
import type * as SharedApi from '@/shared/api';
import type {
  CodexModelProvidersReading,
  CustomProviderModelInput,
  ProviderModelsDefinition,
} from '@/shared/types';

/**
 * The PARENT WIRING of the read-only Codex profile import (this task), as opposed to the
 * reader and the presentational panel delivered earlier:
 *
 *  1. MOUNTED: Settings → Agents → Codex draws the import panel at all. A panel that is
 *     exported but never rendered leaves this reading empty, so this leg reds.
 *  2. WIRED: pressing one row's Bind does two things, in this order — it writes the provider
 *     into the PROJECT registry (the existing mechanism), and it selects that provider in the
 *     model editor's upstream picker. Before this task the picker stayed on "Codex default",
 *     so the person had to select the provider a second time; that is the defect this file
 *     pins. The saved entry then carries `config.codexProviderId`, and re-opening the entry
 *     pre-fills the picker with it (the read-back).
 *  3. NEGATIVE ARM: a row the server marked `bindable: false` has a disabled Bind, sends no
 *     import request, and never moves the picker — the binding is only ever offered for a
 *     provider the registry accepts.
 */

const apiMocks = vi.hoisted(() => ({
  fetch: vi.fn(),
  models: vi.fn(),
  updateModel: vi.fn(),
  createModel: vi.fn(),
  duplicateModel: vi.fn(),
  deleteModel: vi.fn(),
  modelEnvStatus: vi.fn(),
}));

vi.mock('@/shared/api', async (importOriginal) => {
  const actual = await importOriginal<typeof SharedApi>();
  return {
    ...actual,
    // The registry/import slice goes through `authenticatedFetch`; `readApiJson` stays real so
    // the answers are parsed exactly as production parses them.
    authenticatedFetch: apiMocks.fetch,
    api: {
      ...actual.api,
      providers: {
        ...actual.api.providers,
        models: apiMocks.models,
        createModel: apiMocks.createModel,
        updateModel: apiMocks.updateModel,
        duplicateModel: apiMocks.duplicateModel,
        deleteModel: apiMocks.deleteModel,
        modelEnvStatus: apiMocks.modelEnvStatus,
      },
    },
  };
});

vi.mock('@/modules/mcp', () => ({ McpServers: () => null }));
vi.mock('@/modules/skills', () => ({ ProviderSkills: () => null }));
vi.mock('react-i18next', () => ({
  useTranslation: () => ({ t: (key: string) => key }),
}));

const ok = (data: unknown) => Promise.resolve({ ok: true, json: async () => data } as Response);

/** The registry starts EMPTY, which is the state in which a bind is the only way to get a provider. */
const EMPTY_READING: CodexModelProvidersReading = {
  path: '/home/tester/.cloudpit/codex.settings.json',
  version: 'version-0',
  providers: [],
  warnings: [],
};

/** The answer the import POST gets: the registry after the bind. */
const BOUND_READING: CodexModelProvidersReading = {
  path: '/home/tester/.cloudpit/codex.settings.json',
  version: 'version-1',
  providers: [
    {
      id: 'bob',
      name: 'BOB API',
      baseUrl: 'https://bob.example/v1',
      envKey: 'BOB_API_KEY',
      tokenFile: '/home/tester/.cloudpit/codex.secrets/bob.token',
      wireApi: 'responses',
      tokenSet: false,
      warnings: [],
    },
  ],
  warnings: [],
};

/**
 * The read-only user-profile view: one bindable row and one the server refuses (a built-in id
 * would be shadowed). Only variable NAMES appear; no secret value exists in this reading.
 */
const IMPORT_READING: CodexUserProviderImportReading = {
  directory: '/home/tester/.codex',
  files: ['/home/tester/.codex/config.toml'],
  providers: [
    {
      id: 'bob',
      name: 'BOB API',
      baseUrl: 'https://bob.example/v1',
      envKey: 'BOB_API_KEY',
      wireApi: 'responses',
      source: '/home/tester/.codex/config.toml',
      bindable: true,
      warnings: [],
    },
    {
      id: 'openai',
      name: 'OpenAI',
      baseUrl: 'https://api.openai.com/v1',
      envKey: 'OPENAI_API_KEY',
      wireApi: 'responses',
      source: '/home/tester/.codex/config.toml',
      bindable: false,
      warnings: ['provider "openai" would shadow a Codex built-in'],
    },
  ],
  warnings: [],
};

/** The catalog after the save: the entry the server stored with its provider binding. */
const SAVED_CATALOG: ProviderModelsDefinition = {
  DEFAULT: 'gpt-5',
  OPTIONS: [
    { value: 'gpt-5', label: 'GPT-5', isCustom: false },
    {
      value: 'wired-model',
      label: 'Wired Model · bob',
      recordId: 41,
      isCustom: true,
      config: { codexProviderId: 'bob', env: [] },
    },
  ],
};

/** Every import POST body, captured from the intercepted transport. */
let importBodies: Array<{ ids: string[]; expectedVersion: string }> = [];

beforeEach(() => {
  Object.values(apiMocks).forEach((mock) => mock.mockReset());
  importBodies = [];
  apiMocks.fetch.mockImplementation((url: string, options: { method?: string; body?: string } = {}) => {
    if (url === '/api/settings/codex/model-providers/import') {
      if (options.method === 'POST') {
        importBodies.push(JSON.parse(options.body ?? '{}'));
        return ok(BOUND_READING);
      }
      return ok(IMPORT_READING);
    }
    if (url !== '/api/settings/codex/model-providers') {
      return Promise.resolve({ ok: false, status: 404, json: async () => ({}) } as Response);
    }
    return ok(EMPTY_READING);
  });
  apiMocks.models.mockImplementation(() => Promise.resolve({ ok: true, json: async () => ({ data: { models: { DEFAULT: 'gpt-5', OPTIONS: [] } } }) }));
  apiMocks.createModel.mockImplementation(() => ok({ success: true, data: { models: SAVED_CATALOG } }));
  apiMocks.modelEnvStatus.mockImplementation(() => ok({ success: true, data: { status: {} } }));
});

const renderCodexSettings = () => render(
  <AgentCategoryContentSection
    selectedAgent="codex"
    selectedCategory="models"
    agentContextById={{} as never}
    claudePermissions={{ allowedTools: [], disallowedTools: [], skipPermissions: false }}
    onClaudePermissionsChange={() => {}}
    cursorPermissions={{ allowedCommands: [], disallowedCommands: [], skipPermissions: false }}
    onCursorPermissionsChange={() => {}}
    codexPermissionMode="default"
    onCodexPermissionModeChange={() => {}}
    projects={[]}
  />,
);

const pickerOf = (view: ReturnType<typeof renderCodexSettings>) =>
  view.getByTestId('model-codex-provider-select') as HTMLSelectElement;

test('one Bind selects the imported provider in the model editor and the saved entry carries it', async () => {
  const view = renderCodexSettings();

  // 1. MOUNTED: the settings page itself draws the import panel (not merely exports it).
  await waitFor(() => assert.ok(view.getByText('Import from your Codex profile')));
  await waitFor(() => assert.ok(view.getByText('BOB API')));

  // The registry is empty, so the picker offers only the inherit-default choice.
  assert.deepEqual(
    Array.from(pickerOf(view).options).map((option) => option.value),
    [''],
    'before the bind there is no project provider to select',
  );

  // 2. WIRED: one press, then BOTH effects are observable.
  fireEvent.click(view.container.querySelector('[data-codex-import-bind="bob"]') as HTMLElement);

  await waitFor(() => assert.equal(importBodies.length, 1));
  assert.deepEqual(importBodies[0], { ids: ['bob'], expectedVersion: 'version-0' });

  // ...the provider is in the registry (the pre-existing mechanism)...
  await waitFor(() => assert.equal(
    (view.getAllByLabelText('Provider ID')[0] as HTMLInputElement).value,
    'bob',
  ));
  // ...AND the model editor's picker now holds it without a second selection.
  await waitFor(() => assert.equal(pickerOf(view).value, 'bob'));
  assert.deepEqual(
    Array.from(pickerOf(view).options).map((option) => option.value),
    ['', 'bob'],
  );

  // The save the person then makes carries the binding.
  fireEvent.change(view.getByLabelText('Model name'), { target: { value: 'Wired Model' } });
  fireEvent.change(view.getByLabelText('Model ID'), { target: { value: 'wired-model' } });
  fireEvent.click(view.getByText('Add model'));

  await waitFor(() => assert.equal(apiMocks.createModel.mock.calls.length, 1));
  const [provider, input] = apiMocks.createModel.mock.calls[0] as [string, CustomProviderModelInput];
  assert.equal(provider, 'codex');
  assert.deepEqual(input, {
    model: 'Wired Model',
    id: 'wired-model',
    config: { env: [], codexProviderId: 'bob' },
  });

  // Read-back: the stored entry is on the page, and re-opening it pre-fills the picker with bob.
  await waitFor(() => assert.ok(view.getByText('Wired Model · bob')));
  fireEvent.click(view.getByLabelText('Edit Wired Model · bob'));
  assert.equal(pickerOf(view).value, 'bob');
});

test('a non-bindable import row keeps Bind disabled and never moves the model editor', async () => {
  const view = renderCodexSettings();
  await waitFor(() => assert.ok(view.getByText('Import from your Codex profile')));
  await waitFor(() => assert.ok(view.getByText('OpenAI')));

  const refused = view.container.querySelector('[data-codex-import-bind="openai"]') as HTMLButtonElement | null;
  assert.ok(refused, 'the refused row is drawn');
  assert.equal(refused.disabled, true, 'the server marked it non-bindable, so Bind is disabled');

  fireEvent.click(refused);
  // No request, and the picker stays on the inherit-default choice.
  assert.equal(importBodies.length, 0);
  assert.equal(pickerOf(view).value, '');
});

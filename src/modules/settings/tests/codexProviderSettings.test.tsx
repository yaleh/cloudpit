import assert from 'node:assert/strict';

import { fireEvent, render, waitFor } from '@testing-library/react';
import React from 'react';
import { afterEach, beforeEach, test, vi } from 'vitest';

import AgentCategoryContentSection from '@/modules/settings/tabs/agents-settings/sections/AgentCategoryContentSection';
import type {
  CodexModelProviderWrite,
  CodexUserProviderImportReading,
} from '@/modules/settings/utils/codexProvidersController';
import type * as SharedApi from '@/shared/api';
import { PROVIDER_DESCRIPTORS } from '@/shared/constants';
import type {
  CodexModelProvidersReading,
  ProviderModelsDefinition,
} from '@/shared/types';

/**
 * Settings → Agents → Codex: the project-owned upstream provider registry and the model
 * editor's provider picker (AC-465).
 *
 * FIVE READINGS, each taken off what the page actually did:
 *
 *  1. The provider CRUD form is drawn from the settings route: fields for provider id,
 *     baseUrl, envKey and tokenFile, a MASKED secret (only "stored" is shown), the
 *     unknown-field warning the reading carried, and the Responses-only notice with
 *     `wire_api` locked to `responses`.
 *  2. A save is the FULL replacement built from the edited rows, carrying the exact
 *     `expectedVersion` the reading arrived with; a typed secret travels as `token`, while
 *     a stored one is omitted so the file keeps it.
 *  3. The model editor for Codex shows the provider picker (options from the settings
 *     reading) INSTEAD of the env editor, and an edit sends the chosen `codexProviderId`;
 *     choosing "Codex default" omits it so the binding is cleared.
 *  4. The negative arm: both the panel choice and the picker follow PROVIDER_DESCRIPTORS
 *     data. Swapping the descriptor fields moves the panels, so a fake form that branched
 *     on `provider === 'codex'` (bypassing the table) would fail these cases.
 *  5. A stale save (409) is a visible conflict and the draft survives, never a silent
 *     overwrite.
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
    // The registry slice goes through `authenticatedFetch`; its own transport is the only
    // request this file intercepts. `readApiJson` stays real so a 409 arrives as an
    // ApiRequestError exactly as production parses it.
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
const failure = (status: number, code: string, message: string) => Promise.resolve({
  ok: false,
  status,
  json: async () => ({ success: false, error: { code, message } }),
} as Response);

const READING: CodexModelProvidersReading = {
  path: '/home/tester/.cloudpit/codex.settings.json',
  version: 'version-1',
  providers: [
    {
      id: 'bob',
      name: 'Bob',
      baseUrl: 'https://bob.example/v1',
      envKey: 'BOB_API_KEY',
      tokenFile: '/home/tester/.cloudpit/bob.token',
      wireApi: 'responses',
      tokenSet: true,
      warnings: ['provider "bob" has unknown field `api`; it is ignored'],
    },
  ],
  warnings: [],
};

/**
 * The read-only user-profile view. Only field NAMES appear: `envKey` is the variable name and no
 * secret value exists anywhere in this reading, which is what the once-hidden import panel draws.
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
  ],
  warnings: [],
};

/** A registry reading with no providers, for the import case's starting point. */
const EMPTY_READING: CodexModelProvidersReading = {
  path: '/home/tester/.cloudpit/codex.settings.json',
  version: 'version-0',
  providers: [],
  warnings: [],
};

const CATALOG: ProviderModelsDefinition = {
  DEFAULT: 'gpt-5',
  OPTIONS: [
    { value: 'gpt-5', label: 'GPT-5', isCustom: false },
    {
      value: 'bob-model',
      // A bound model's catalog label carries the provider suffix; the EDIT FORM must prefill
      // the bare name or the next save would rename the row to include it.
      label: 'Bob Model · bob',
      recordId: 9,
      isCustom: true,
      config: { codexProviderId: 'bob', env: [] },
    },
  ],
};

/** Every PUT body the panel sent, captured through the intercepted transport. */
let saveBodies: Array<{ providers: CodexModelProviderWrite[]; expectedVersion: string }> = [];
/** Every import POST body, captured the same way; the bind must carry the read version. */
let importBodies: Array<{ ids: string[]; expectedVersion: string }> = [];
/** The answer a PUT gets; a case swaps it to drive a conflict. */
let saveResponder: () => Promise<Response> = () => ok(READING);
/** The answer a registry GET gets; the import case starts from an empty registry. */
let registryResponder: () => Promise<Response> = () => ok(READING);
/** The answer the import POST gets; a bind refreshes the drafts from this reading. */
let importResponder: () => Promise<Response> = () => ok(READING);

beforeEach(() => {
  Object.values(apiMocks).forEach((mock) => mock.mockReset());
  saveBodies = [];
  importBodies = [];
  saveResponder = () => ok(READING);
  registryResponder = () => ok(READING);
  importResponder = () => ok(READING);
  apiMocks.fetch.mockImplementation((url: string, options: { method?: string; body?: string } = {}) => {
    if (url === '/api/settings/codex/model-providers/import') {
      if (options.method === 'POST') {
        importBodies.push(JSON.parse(options.body ?? '{}'));
        return importResponder();
      }
      return ok(IMPORT_READING);
    }
    if (url !== '/api/settings/codex/model-providers') {
      return Promise.resolve({ ok: false, status: 404, json: async () => ({}) } as Response);
    }
    if (options.method === 'PUT') {
      saveBodies.push(JSON.parse(options.body ?? '{}'));
      return saveResponder();
    }
    return registryResponder();
  });
  apiMocks.models.mockImplementation(() => ok({ success: true, data: { models: CATALOG } }));
  apiMocks.updateModel.mockImplementation(() => ok({ success: true, data: { models: CATALOG } }));
  apiMocks.createModel.mockImplementation(() => ok({ success: true, data: { models: CATALOG } }));
  apiMocks.modelEnvStatus.mockImplementation(() => ok({ success: true, data: { status: {} } }));
});

/**
 * The descriptor rows these cases mutate are restored after each case, so one case's swap
 * cannot leak into another.
 */
const ORIGINAL_CODEX_DESCRIPTOR = { ...PROVIDER_DESCRIPTORS.codex };
const ORIGINAL_CURSOR_DESCRIPTOR = { ...PROVIDER_DESCRIPTORS.cursor };

afterEach(() => {
  PROVIDER_DESCRIPTORS.codex = { ...ORIGINAL_CODEX_DESCRIPTOR };
  PROVIDER_DESCRIPTORS.cursor = { ...ORIGINAL_CURSOR_DESCRIPTOR };
});

const renderModels = (agent: 'claude' | 'codex' | 'cursor' | 'opencode' = 'codex') => render(
  <AgentCategoryContentSection
    selectedAgent={agent}
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

test('the Codex models category draws the provider CRUD form from the settings reading', async () => {
  const view = renderModels('codex');

  await waitFor(() => assert.ok(view.getByText('Codex providers')));

  // 1. The row's fields are the reading's values, including the masked secret.
  assert.equal((view.getByLabelText('Provider ID') as HTMLInputElement).value, 'bob');
  assert.equal((view.getByLabelText('Base URL') as HTMLInputElement).value, 'https://bob.example/v1');
  assert.equal((view.getByLabelText('Env key') as HTMLInputElement).value, 'BOB_API_KEY');
  assert.equal(
    (view.getByLabelText('Token file') as HTMLInputElement).value,
    '/home/tester/.cloudpit/bob.token',
  );

  const token = view.getByTestId('codex-provider-token') as HTMLInputElement;
  assert.equal(token.type, 'password', 'the secret is a masked input');
  assert.equal(token.value, '', 'no stored secret value is ever drawn into the form');
  assert.match(view.getByTestId('codex-provider-token-set').textContent ?? '', /stored/);
  assert.ok(!view.container.textContent?.includes('super-secret'), 'no secret value is rendered');

  // 2. `wire_api` is locked to responses and the Responses-only notice is on the page.
  const wireApi = view.getByLabelText('Wire API') as HTMLInputElement;
  assert.equal(wireApi.value, 'responses');
  assert.equal(wireApi.disabled, true);
  assert.match(view.getByTestId('codex-responses-only').textContent ?? '', /responses/);
  assert.match(view.getByTestId('codex-responses-only').textContent ?? '', /Chat Completions/);

  // 3. The unknown field the file carried is reported, and the page names the file it edits.
  assert.match(view.getByTestId('codex-provider-warning').textContent ?? '', /unknown field `api`/);
  assert.equal(view.getByTestId('codex-providers-path').textContent, READING.path);
});

test('a save is a full replacement carrying the reading version, and only typed secrets', async () => {
  const view = renderModels('codex');
  await waitFor(() => assert.ok(view.getByText('Codex providers')));

  fireEvent.click(view.getByText('Add provider'));

  fireEvent.change(view.getAllByLabelText('Provider ID')[1], { target: { value: 'carol' } });
  fireEvent.change(view.getAllByLabelText('Display name')[1], { target: { value: 'Carol' } });
  fireEvent.change(view.getAllByLabelText('Base URL')[1], { target: { value: 'https://carol.example/v1' } });
  fireEvent.change(view.getAllByLabelText('Env key')[1], { target: { value: 'CAROL_API_KEY' } });
  fireEvent.change(view.getAllByLabelText('Token file')[1], { target: { value: '/home/tester/carol.token' } });
  fireEvent.change(view.getAllByTestId('codex-provider-token')[1], { target: { value: 'sk-carol' } });

  fireEvent.click(view.getByText('Save providers'));

  await waitFor(() => assert.equal(saveBodies.length, 1));
  const payload = saveBodies[0]!;

  assert.equal(payload.expectedVersion, 'version-1', 'the save proves which file it was based on');
  assert.deepEqual(payload.providers, [
    {
      id: 'bob',
      name: 'Bob',
      baseUrl: 'https://bob.example/v1',
      envKey: 'BOB_API_KEY',
      tokenFile: '/home/tester/.cloudpit/bob.token',
      wireApi: 'responses',
      // No `token`: leaving the field blank keeps the stored secret.
    },
    {
      id: 'carol',
      name: 'Carol',
      baseUrl: 'https://carol.example/v1',
      envKey: 'CAROL_API_KEY',
      tokenFile: '/home/tester/carol.token',
      wireApi: 'responses',
      token: 'sk-carol',
    },
  ]);
});

test('the Codex model editor shows the provider picker instead of the env editor', async () => {
  const view = renderModels('codex');
  await waitFor(() => assert.ok(view.getByText('Bob Model · bob')));

  fireEvent.click(view.getByLabelText('Edit Bob Model · bob'));

  assert.equal(
    (view.getByLabelText('Model name') as HTMLInputElement).value,
    'Bob Model',
    'the edit form prefills the bare name, not the catalog display label',
  );

  const picker = view.getByTestId('model-codex-provider-select') as HTMLSelectElement;
  assert.equal(picker.value, 'bob', 'the picker starts on the stored binding');
  assert.deepEqual(
    Array.from(picker.options).map((option) => option.value),
    ['', 'bob'],
    'the options are the settings reading plus the inherit-default choice',
  );
  assert.match(picker.options[1]?.textContent ?? '', /Bob/);
  assert.equal(view.queryAllByTestId('model-env-row').length, 0, 'no env editor for Codex');

  // Clearing the binding sends `config` without `codexProviderId`, which is how the server
  // persists "inherit the Codex global default".
  fireEvent.change(picker, { target: { value: '' } });
  fireEvent.click(view.getByText('Save changes'));

  await waitFor(() => assert.equal(apiMocks.updateModel.mock.calls.length, 1));
  const [provider, recordId, input] = apiMocks.updateModel.mock.calls[0];
  assert.equal(provider, 'codex');
  assert.equal(recordId, 9, 'the edit targets the stored row');
  assert.deepEqual(input, {
    model: 'Bob Model',
    id: 'bob-model',
    config: { env: [] },
  });
});

test('the negative arm: descriptor data chooses the panel and the editor, not a provider-id branch', async () => {
  // If the dispatcher branched on `selectedAgent === 'codex'`, a cursor selection carrying a
  // codex-like descriptor would still draw the plain model library.
  PROVIDER_DESCRIPTORS.cursor = {
    ...PROVIDER_DESCRIPTORS.cursor,
    showsUpstreamProviderRegistry: true,
    modelConfigKind: 'codex-provider',
  };
  const fromData = renderModels('cursor');
  await waitFor(() => assert.ok(fromData.getByText('Codex providers')));
  await waitFor(() => assert.ok(fromData.getByText('Bob Model · bob')));
  fireEvent.click(fromData.getByLabelText('Edit Bob Model · bob'));
  assert.ok(fromData.getByTestId('model-codex-provider-select'));
  fromData.unmount();

  // And the opposite direction: a codex selection whose descriptor says `env` must draw the
  // env editor and no picker — a hardcoded provider check would ignore this.
  PROVIDER_DESCRIPTORS.codex = {
    ...PROVIDER_DESCRIPTORS.codex,
    showsUpstreamProviderRegistry: false,
    modelConfigKind: 'env',
    modelEnvGatewayTemplate: false,
  };
  const fromDataToo = renderModels('codex');
  await waitFor(() => assert.ok(fromDataToo.getByText('Bob Model · bob')));
  assert.equal(fromDataToo.queryByText('Codex providers'), null);
  fireEvent.click(fromDataToo.getByLabelText('Edit Bob Model · bob'));
  assert.equal(fromDataToo.queryByTestId('model-codex-provider-select'), null);
  assert.ok(fromDataToo.getByTestId('model-env-editor'), 'the env editor is what this descriptor asks for');
});

test('one-click import binds the user-profile provider into the project registry', async () => {
  registryResponder = () => ok(EMPTY_READING);
  importResponder = () => ok(READING);
  const view = renderModels('codex');

  // The panel is WIRED INTO the page (not merely exported): it draws the profile's rows, with
  // the `env_key` variable NAME and no secret value anywhere in the DOM.
  await waitFor(() => assert.ok(view.getByText('Import from your Codex profile')));
  await waitFor(() => assert.ok(view.getByText('BOB API')));
  assert.ok(view.getByText('BOB_API_KEY'));
  assert.ok(!view.container.textContent?.includes('sk-'), 'no secret value is ever drawn');

  // The registry starts empty, so the model picker only offers the inherit-default choice.
  assert.equal(view.queryAllByLabelText('Provider ID').length, 0);
  fireEvent.click(view.getByLabelText('Edit Bob Model · bob'));
  assert.deepEqual(
    Array.from((view.getByTestId('model-codex-provider-select') as HTMLSelectElement).options)
      .map((option) => option.value),
    [''],
  );

  // The Bind press is the product control; it POSTs the selected id with the READ version.
  fireEvent.click(view.getByText('Bind'));
  await waitFor(() => assert.equal(importBodies.length, 1));
  assert.deepEqual(importBodies[0], { ids: ['bob'], expectedVersion: 'version-0' });

  // The answer refreshed the drafts, so the provider row is on the page...
  await waitFor(() => assert.equal(
    (view.getAllByLabelText('Provider ID')[0] as HTMLInputElement).value,
    'bob',
  ));
  // ...and the model editor's picker can now bind to it.
  assert.deepEqual(
    Array.from((view.getByTestId('model-codex-provider-select') as HTMLSelectElement).options)
      .map((option) => option.value),
    ['', 'bob'],
  );
});

test('a stale save is a visible conflict and the edited rows survive', async () => {
  saveResponder = () => failure(409, 'VERSION_CONFLICT', 'changed since read');
  const view = renderModels('codex');
  await waitFor(() => assert.ok(view.getByText('Codex providers')));

  fireEvent.change(view.getAllByLabelText('Base URL')[0], { target: { value: 'https://edited.example/v1' } });
  fireEvent.click(view.getByText('Save providers'));

  await waitFor(() => assert.match(view.getByRole('alert').textContent ?? '', /Another editor changed/));
  assert.equal(
    (view.getAllByLabelText('Base URL')[0] as HTMLInputElement).value,
    'https://edited.example/v1',
    'the draft is kept so the person can reload and save again',
  );
  assert.equal(view.getByTestId('codex-provider-token') instanceof HTMLInputElement, true);
});

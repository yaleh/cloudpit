import assert from 'node:assert/strict';

import { fireEvent, render, waitFor } from '@testing-library/react';
import React from 'react';
import { beforeEach, test, vi } from 'vitest';

import AgentCategoryContentSection from '@/modules/settings/tabs/agents-settings/sections/AgentCategoryContentSection';
import type {
  CodexConnectionProbe,
  CodexModelProviderWrite,
  CodexUserProviderImportReading,
} from '@/modules/settings/utils/codexProvidersController';
import type * as SharedApi from '@/shared/api';
import type {
  CodexModelProvidersReading,
  ProviderModelsDefinition,
} from '@/shared/types';

/**
 * Settings → Agents → Codex: the provider row's ADVANCED form and connection-test control
 * (codex-provider-advanced-ui).
 *
 * FOUR READINGS, each taken off what the page actually did:
 *
 *  1. RENDERED FROM THE READING. `http_headers`, `env_http_headers`, `query_params`, the two
 *     retry counts, the stream idle timeout and `model_catalog_url` are drawn from the saved
 *     provider, and the billable sentence is on screen BEFORE the probe is pressed.
 *  2. SAVE + READBACK. An edit becomes the advanced fields of the full-replacement PUT, and a
 *     reload restores exactly what the server reading carried — so the form and the wire agree
 *     in both directions. An untouched form writes NO advanced keys (no fabricated empty maps).
 *  3. CONNECTION TEST IS WIRED. The button POSTs the provider id (never a secret), and the
 *     answer's outcome/detail are drawn from the server's probe reading.
 *  4. NEGATIVE ARM. A provider that is not saved yet has its probe disabled with a reason —
 *     a form that drew the button without wiring it would POST for an id the server cannot
 *     resolve. The render assertions also fail if the panel is not mounted at all.
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
    // Every Codex registry call goes through `authenticatedFetch`; it is the one transport
    // this file intercepts. `readApiJson` stays real so the answers parse as production does.
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
      httpHeaders: { 'X-Advanced': 'yes' },
      envHttpHeaders: { 'X-Tenant': 'TENANT_ENV' },
      queryParams: { 'api-version': '2026-01-01' },
      requestMaxRetries: 1,
      streamMaxRetries: 2,
      streamIdleTimeoutMs: 3000,
      modelCatalogUrl: 'https://catalog.example/models.json',
      tokenSet: true,
      warnings: [],
    },
  ],
  warnings: [],
};

/** The reading a reload returns after the save in case 2; the same values the form sent. */
const SAVED_READING: CodexModelProvidersReading = {
  ...READING,
  version: 'version-2',
  providers: [
    {
      ...READING.providers[0]!,
      httpHeaders: { 'X-Advanced': 'no' },
      queryParams: { 'api-version': '2026-01-01', tenant: 'acme' },
      requestMaxRetries: 4,
      modelCatalogUrl: 'https://catalog2.example/models.json',
    },
  ],
};

const IMPORT_READING: CodexUserProviderImportReading = {
  directory: '/home/tester/.codex',
  files: [],
  providers: [],
  warnings: [],
};

const CATALOG: ProviderModelsDefinition = {
  DEFAULT: 'gpt-5',
  OPTIONS: [{ value: 'gpt-5', label: 'GPT-5', isCustom: false }],
};

const UNAUTHORIZED_PROBE: CodexConnectionProbe = {
  outcome: 'unauthorized',
  ok: false,
  url: 'https://bob.example/v1/responses',
  status: 401,
  billable: true,
  billingNote: 'This connection test sends one real request to your upstream provider; the provider may bill it.',
  detail: 'the endpoint answered 401: the token-file secret or its scope was refused',
};

const OK_PROBE: CodexConnectionProbe = {
  outcome: 'ok',
  ok: true,
  url: 'https://bob.example/v1/responses',
  status: 200,
  billable: true,
  billingNote: 'This connection test sends one real request to your upstream provider; the provider may bill it.',
  detail: 'Responses-shaped reply received',
};

/** Every PUT body the panel sent, captured through the intercepted transport. */
let saveBodies: Array<{ providers: CodexModelProviderWrite[]; expectedVersion: string }> = [];
/** Every probe POST body; the id is the only thing the browser may send. */
let testBodies: Array<{ id: string }> = [];
let saveResponder: () => Promise<Response> = () => ok(READING);
let registryResponder: () => Promise<Response> = () => ok(READING);
let testResponder: () => Promise<Response> = () => ok(UNAUTHORIZED_PROBE);

beforeEach(() => {
  Object.values(apiMocks).forEach((mock) => mock.mockReset());
  saveBodies = [];
  testBodies = [];
  saveResponder = () => ok(READING);
  registryResponder = () => ok(READING);
  testResponder = () => ok(UNAUTHORIZED_PROBE);
  apiMocks.fetch.mockImplementation((url: string, options: { method?: string; body?: string } = {}) => {
    if (url === '/api/settings/codex/model-providers/import') {
      return ok(IMPORT_READING);
    }
    if (url === '/api/settings/codex/model-providers/test') {
      if (options.method !== 'POST') {
        return Promise.resolve({ ok: false, status: 404, json: async () => ({}) } as Response);
      }
      testBodies.push(JSON.parse(options.body ?? '{}'));
      return testResponder();
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

const renderModels = () => render(
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

/** The mounted advanced panel, after the registry reading has settled. */
const renderedPanel = async () => {
  const view = renderModels();
  await waitFor(() => assert.ok(view.getByText('Codex providers')));
  await waitFor(() => assert.ok(view.getByTestId('codex-provider-advanced')));
  return view;
};

test('the advanced form is drawn from the reading and shows the billable note before probing', async () => {
  const view = await renderedPanel();

  // 1. Every advanced field the server stores is on the page with the reading's value.
  assert.equal((view.getByLabelText('HTTP header name 1') as HTMLInputElement).value, 'X-Advanced');
  assert.equal((view.getByLabelText('HTTP header value 1') as HTMLInputElement).value, 'yes');
  assert.equal(
    (view.getByLabelText('Header environment variable name 1') as HTMLInputElement).value,
    'X-Tenant',
  );
  assert.equal(
    (view.getByLabelText('Header environment variable value 1') as HTMLInputElement).value,
    'TENANT_ENV',
  );
  assert.equal((view.getByLabelText('Query parameter name 1') as HTMLInputElement).value, 'api-version');
  assert.equal((view.getByLabelText('Request max retries') as HTMLInputElement).value, '1');
  assert.equal((view.getByLabelText('Stream max retries') as HTMLInputElement).value, '2');
  assert.equal((view.getByLabelText('Stream idle timeout (ms)') as HTMLInputElement).value, '3000');
  assert.equal(
    (view.getByLabelText('Model catalog URL') as HTMLInputElement).value,
    'https://catalog.example/models.json',
  );

  // 2. The billing sentence is visible BEFORE any probe answer exists, and the saved provider's
  //    button is live.
  assert.match(view.getByTestId('codex-connection-note').textContent ?? '', /one real request/);
  assert.match(view.getByTestId('codex-connection-note').textContent ?? '', /may bill it/);
  const button = view.getByTestId('codex-connection-test') as HTMLButtonElement;
  assert.equal(button.disabled, false, 'a saved provider can be tested');
  assert.equal(view.queryByTestId('codex-provider-connection-outcome'), null, 'no fabricated outcome');
});

test('an advanced edit is saved on the wire and a reload restores the server reading', async () => {
  const view = await renderedPanel();

  fireEvent.change(view.getByLabelText('HTTP header value 1'), { target: { value: 'no' } });
  fireEvent.click(view.getByTestId('codex-advanced-query-params-add'));
  fireEvent.change(view.getByLabelText('Query parameter name 2'), { target: { value: 'tenant' } });
  fireEvent.change(view.getByLabelText('Query parameter value 2'), { target: { value: 'acme' } });
  fireEvent.change(view.getByLabelText('Request max retries'), { target: { value: '4' } });
  fireEvent.change(
    view.getByLabelText('Model catalog URL'),
    { target: { value: 'https://catalog2.example/models.json' } },
  );

  saveResponder = () => ok(SAVED_READING);
  fireEvent.click(view.getByText('Save providers'));
  await waitFor(() => assert.equal(saveBodies.length, 1));

  const saved = saveBodies[0]!.providers[0]!;
  assert.equal(saveBodies[0]!.expectedVersion, 'version-1', 'the save proves which file it edited');
  assert.deepEqual(saved.httpHeaders, { 'X-Advanced': 'no' });
  assert.deepEqual(saved.envHttpHeaders, { 'X-Tenant': 'TENANT_ENV' });
  assert.deepEqual(saved.queryParams, { 'api-version': '2026-01-01', tenant: 'acme' });
  assert.equal(saved.requestMaxRetries, 4);
  assert.equal(saved.streamMaxRetries, 2);
  assert.equal(saved.streamIdleTimeoutMs, 3000);
  assert.equal(saved.modelCatalogUrl, 'https://catalog2.example/models.json');

  // A local edit followed by Reload must return to what the GET reading says — this is the
  // readback half of the round trip, not just the save answer being echoed.
  fireEvent.change(
    view.getByLabelText('Model catalog URL'),
    { target: { value: 'https://unsaved.example/x' } },
  );
  registryResponder = () => ok(SAVED_READING);
  fireEvent.click(view.getByText('Reload'));
  await waitFor(() => assert.equal(
    (view.getByLabelText('Model catalog URL') as HTMLInputElement).value,
    'https://catalog2.example/models.json',
  ));
  assert.equal((view.getByLabelText('HTTP header value 1') as HTMLInputElement).value, 'no');
  assert.equal((view.getByLabelText('Query parameter value 2') as HTMLInputElement).value, 'acme');
});

test('the connection test POSTs the saved provider id and draws the server outcome', async () => {
  const view = await renderedPanel();

  fireEvent.click(view.getByTestId('codex-connection-test'));
  await waitFor(() => assert.equal(testBodies.length, 1));
  assert.deepEqual(testBodies[0], { id: 'bob' }, 'the browser sends the id, never a secret');

  await waitFor(() => {
    const outcome = view.getByTestId('codex-provider-connection-outcome');
    assert.equal(outcome.getAttribute('data-outcome'), 'unauthorized');
  });
  const outcome = view.getByTestId('codex-provider-connection-outcome');
  assert.match(outcome.textContent ?? '', /credential was refused/);
  assert.match(outcome.textContent ?? '', /401/);
  assert.match(outcome.textContent ?? '', /bob\.example\/v1\/responses/);

  // The same control renders a successful answer from its data, not from a hardcoded string.
  testResponder = () => ok(OK_PROBE);
  fireEvent.click(view.getByTestId('codex-connection-test'));
  await waitFor(() => assert.equal(testBodies.length, 2));
  await waitFor(() => assert.equal(
    view.getByTestId('codex-provider-connection-outcome').getAttribute('data-outcome'),
    'ok',
  ));
  assert.match(
    view.getByTestId('codex-provider-connection-outcome').textContent ?? '',
    /Responses API/,
  );
});

test('the negative arm: an untouched form writes no advanced keys and an unsaved provider cannot be probed', async () => {
  const view = await renderedPanel();

  // Clear every advanced row/field and save: the wire record must omit them, not carry empty
  // maps or zeroes that would override Codex's own defaults.
  fireEvent.click(view.getByTestId('codex-advanced-http-headers-remove-0'));
  fireEvent.click(view.getByTestId('codex-advanced-env-headers-remove-0'));
  fireEvent.click(view.getByTestId('codex-advanced-query-params-remove-0'));
  fireEvent.change(view.getByLabelText('Request max retries'), { target: { value: '' } });
  fireEvent.change(view.getByLabelText('Stream max retries'), { target: { value: '' } });
  fireEvent.change(view.getByLabelText('Stream idle timeout (ms)'), { target: { value: '' } });
  fireEvent.change(view.getByLabelText('Model catalog URL'), { target: { value: '' } });

  fireEvent.click(view.getByText('Save providers'));
  await waitFor(() => assert.equal(saveBodies.length, 1));
  const saved = saveBodies[0]!.providers[0]!;
  for (const key of [
    'httpHeaders',
    'envHttpHeaders',
    'queryParams',
    'requestMaxRetries',
    'streamMaxRetries',
    'streamIdleTimeoutMs',
    'modelCatalogUrl',
  ]) {
    assert.equal(
      Object.prototype.hasOwnProperty.call(saved, key),
      false,
      `${key} must be omitted when unset`,
    );
  }

  // A row that exists only in the form has no server-side entry to resolve, so the probe is
  // disabled with the reason. Clicking it must not POST anything.
  fireEvent.click(view.getByText('Add provider'));
  const buttons = view.getAllByTestId('codex-connection-test') as HTMLButtonElement[];
  assert.equal(buttons[1]!.disabled, true);
  assert.match(view.getByTestId('codex-connection-unsaved').textContent ?? '', /Save this provider/);
  fireEvent.click(buttons[1]!);
  assert.equal(testBodies.length, 0);
});

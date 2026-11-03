import assert from 'node:assert/strict';

import { fireEvent, render, within } from '@testing-library/react';
import i18next from 'i18next';
import React from 'react';
import { initReactI18next } from 'react-i18next';
import { beforeEach, test, vi } from 'vitest';

import ProviderSelectionEmptyState from '@/modules/chat/transcript/ProviderSelectionEmptyState';
import enChat from '@/modules/i18n/locales/en/chat.json';
import type {
  LLMProvider,
  ProviderModelActions,
  ProviderModelsDefinition,
} from '@/shared/types';

/**
 * The new-session Model Selector offers one choice per MODEL × PROVIDER.
 *
 * A Codex catalog now answers a built-in model once bare (inherit the Codex
 * default) and once per project-registered upstream provider, with the rows
 * sharing `value` and differing only by `modelProviderId`; a custom entry stays
 * one row, bound to its own provider. The picker therefore has to group by
 * model, spell the provider id beside the model name, and hand BOTH halves back
 * to the host — the value alone cannot say which row was clicked.
 *
 * The last two cases are the falsifying ones: a picker that kept the old
 * one-branch-per-provider layout, or that opened a second provider dropdown,
 * fails them.
 */

// jsdom ships neither API that cmdk's list subscribes to on mount.
class NoopResizeObserver {
  observe() {}
  unobserve() {}
  disconnect() {}
}
globalThis.ResizeObserver = NoopResizeObserver as unknown as typeof ResizeObserver;
if (typeof Element.prototype.scrollIntoView !== 'function') {
  Element.prototype.scrollIntoView = () => {};
}

await i18next.use(initReactI18next).init({
  lng: 'en',
  fallbackLng: 'en',
  ns: ['chat'],
  defaultNS: 'chat',
  resources: { en: { chat: enChat } },
  interpolation: { escapeValue: false },
  react: { useSuspense: false },
});

const definition = (
  options: ProviderModelsDefinition['OPTIONS'],
  fallback: string,
): ProviderModelsDefinition => ({ OPTIONS: options, DEFAULT: fallback });

/**
 * The Codex catalog as the provider-bound composition answers it: each built-in
 * model has a bare row plus one ` · provider` row per registered provider, and
 * a custom entry is a single row already bound to its own provider.
 */
const CODEX_CATALOG = definition([
  { value: 'gpt-5.6-terra', label: 'GPT-5.6-Terra', description: 'balanced workhorse' },
  { value: 'gpt-5.6-terra', label: 'GPT-5.6-Terra · fjdac', modelProviderId: 'fjdac' },
  { value: 'gpt-5.6-terra', label: 'GPT-5.6-Terra · bob', modelProviderId: 'bob' },
  { value: 'gpt-6.1-sol', label: 'GPT-6.1-Sol' },
  {
    value: 'house-model',
    label: 'House Model · fjdac',
    modelProviderId: 'fjdac',
    isCustom: true,
    config: { env: [], codexProviderId: 'fjdac' },
  },
], 'gpt-5.6-terra');

/** A provider that binds no upstream provider: its branch stays one per provider. */
const CLAUDE_CATALOG = definition([
  { value: 'claude-sonnet-4-5', label: 'Claude Sonnet 4.5' },
  { value: 'claude-haiku-4-5', label: 'Claude Haiku 4.5' },
], 'claude-sonnet-4-5');

const EMPTY_CATALOG = definition([], '');

const CATALOG: Partial<Record<LLMProvider, ProviderModelsDefinition>> = {
  claude: CLAUDE_CATALOG,
  cursor: EMPTY_CATALOG,
  codex: CODEX_CATALOG,
  opencode: EMPTY_CATALOG,
};

const PROVIDER_MODELS: Record<LLMProvider, string> = {
  claude: 'claude-sonnet-4-5',
  cursor: '',
  codex: 'gpt-5.6-terra',
  opencode: '',
};

type EmptyStateProps = React.ComponentProps<typeof ProviderSelectionEmptyState>;

function renderEmptyState(overrides: Partial<EmptyStateProps> = {}) {
  const setProvider = vi.fn();
  const setProviderModel = vi.fn();
  const view = render(
    <ProviderSelectionEmptyState
      selectedSession={null}
      currentSessionId={null}
      provider="codex"
      setProvider={setProvider}
      textareaRef={{ current: null }}
      providerModels={PROVIDER_MODELS}
      setProviderModel={setProviderModel}
      providerModelCatalog={CATALOG}
      providerModelActions={{} as ProviderModelActions}
      providerModelsLoading={false}
      tasksEnabled={false}
      isTaskMasterInstalled={null}
      setInput={() => undefined}
      canRunResident={false}
      residentEnabled={false}
      onToggleResident={() => undefined}
      {...overrides}
    />,
  );
  return { view, setProvider, setProviderModel };
}

/** Opens the picker the way a person does: press the collapsed model card. */
function openPicker(view: ReturnType<typeof renderEmptyState>['view']) {
  fireEvent.click(view.getByRole('button', { name: /Click to change model/i }));
}

const groupHeadings = () => Array.from(
  document.querySelectorAll<HTMLElement>('[data-model-group-key]'),
);

const groupKeysFor = (provider: LLMProvider) => groupHeadings()
  .filter((heading) => heading.getAttribute('data-model-group-provider') === provider)
  .map((heading) => heading.getAttribute('data-model-group-key'));

/** One rendered row, addressed by its full identity — two rows may share the model id. */
const row = (model: string, providerId: string | null = null): HTMLElement => {
  const found = Array.from(document.querySelectorAll<HTMLElement>('[data-model-value]')).find(
    (element) => element.getAttribute('data-model-value') === model
    && element.getAttribute('data-model-provider-id') === providerId,
  );
  assert.ok(found, `the picker must render the row ${model}${providerId === null ? '' : ` (${providerId})`}`);
  return found;
};

beforeEach(() => {
  vi.restoreAllMocks();
});

test('(a) a provider-bound catalog is grouped by model, one branch per model instead of one per provider', () => {
  const { view } = renderEmptyState();
  openPicker(view);

  assert.deepEqual(
    groupKeysFor('codex'),
    [
      'codex:model:gpt-5.6-terra',
      'codex:model:gpt-6.1-sol',
      'codex:model:house-model',
    ],
    'the Codex catalog must be grouped by model, in catalog order',
  );
  assert.equal(
    groupKeysFor('codex').includes('codex'),
    false,
    'a provider-keyed Codex branch is the pre-change layout and must not render',
  );

  // The variant rows all live under the model they run, not under a provider heading.
  const terraGroup = row('gpt-5.6-terra').closest('[cmdk-group]');
  assert.equal(
    terraGroup?.querySelector('[data-model-group-key]')?.getAttribute('data-model-group-key'),
    'codex:model:gpt-5.6-terra',
    'the bare row and its variants must sit in the branch named after their model',
  );
  assert.deepEqual(
    groupHeadings()
      .filter((heading) => heading.getAttribute('data-model-group-provider') === 'codex')
      .map((heading) => heading.textContent?.replace(/\d+$/, '').trim()),
    ['GPT-5.6-Terra', 'GPT-6.1-Sol', 'House Model'],
    'a model branch is named after the model, with the server’s ` · provider` suffix read off',
  );
});

test('(b) built-in rows spell the provider id and the custom entry stays a single row', () => {
  const { view } = renderEmptyState();
  openPicker(view);

  const terraRows = Array.from(
    document.querySelectorAll<HTMLElement>('[data-model-value="gpt-5.6-terra"]'),
  );
  assert.deepEqual(
    terraRows.map((element) => element.getAttribute('data-model-provider-id')),
    [null, 'fjdac', 'bob'],
    'the built-in model must be offered bare, then once per registered provider',
  );

  for (const providerId of ['fjdac', 'bob']) {
    assert.match(
      row('gpt-5.6-terra', providerId).textContent ?? '',
      new RegExp(`\\(${providerId}\\)`),
      `the ${providerId} variant must show its provider id beside the model name`,
    );
  }
  assert.doesNotMatch(
    row('gpt-5.6-terra').textContent ?? '',
    /\(/,
    'the bare row inherits the default provider and must not print one',
  );

  const customRows = document.querySelectorAll<HTMLElement>('[data-model-value="house-model"]');
  assert.equal(customRows.length, 1, 'a custom entry is one row, never expanded into variants');
  assert.match(customRows[0].textContent ?? '', /\(fjdac\)/);
});

test('(c) selecting a variant hands back provider + model + modelProviderId', () => {
  const { view, setProvider, setProviderModel } = renderEmptyState();
  openPicker(view);

  fireEvent.click(row('gpt-5.6-terra', 'fjdac'));

  assert.equal(setProvider.mock.calls.length, 1);
  assert.deepEqual(setProvider.mock.calls[0], ['codex']);
  assert.deepEqual(
    setProviderModel.mock.calls[0],
    ['codex', 'gpt-5.6-terra', 'fjdac'],
    'the clicked row’s provider id must travel with the model it belongs to',
  );

  // The collapsed card names the row that was clicked, not just its model.
  assert.match(
    within(view.container).getByRole('button', { name: /Click to change model/i }).textContent ?? '',
    /GPT-5\.6-Terra \(fjdac\)/,
    'after a pick the card must show the composite label for the picked variant',
  );

  // A fresh render: the bare row is a different identity from its variants.
  view.unmount();
  const bare = renderEmptyState();
  openPicker(bare.view);
  fireEvent.click(row('gpt-5.6-terra'));

  assert.deepEqual(
    bare.setProviderModel.mock.calls[0],
    ['codex', 'gpt-5.6-terra', null],
    'the bare row inherits the default provider and must send no provider id',
  );
  assert.doesNotMatch(
    within(bare.view.container).getByRole('button', { name: /Click to change model/i }).textContent ?? '',
    /\(/,
    'a bare pick must leave the card without a provider suffix',
  );
});

test('(d) the collapsed card composes the label from the selected identity', () => {
  const explicit = renderEmptyState({ currentModelProviderId: 'fjdac' });
  const card = within(explicit.view.container)
    .getByRole('button', { name: /Click to change model/i });
  assert.match(card.textContent ?? '', /GPT-5\.6-Terra \(fjdac\)/);
  assert.match(card.textContent ?? '', /Codex/);
  explicit.view.unmount();

  // No host-supplied id: a catalog with exactly one row for the active model is
  // unambiguous, so the binding still shows rather than one being guessed.
  const derived = renderEmptyState({ providerModels: { ...PROVIDER_MODELS, codex: 'house-model' } });
  const derivedCard = within(derived.view.container)
    .getByRole('button', { name: /Click to change model/i });
  assert.match(
    derivedCard.textContent ?? '',
    /House Model \(fjdac\)/,
    'a custom entry bound to a provider is the only row for its model, so its id is readable',
  );
});

test('(e) only the selected variant is ticked; its same-model siblings are not', () => {
  const { view } = renderEmptyState({ currentModelProviderId: 'bob' });
  openPicker(view);

  const ticked = Array.from(
    document.querySelectorAll<HTMLElement>('[data-model-selected="true"]'),
  );
  assert.deepEqual(
    ticked.map((element) => element.getAttribute('data-model-provider-id')),
    ['bob'],
    'the model id alone is shared by three rows; the tick must follow the provider too',
  );
});

test('(f) providers that bind no upstream provider keep their one branch per provider', () => {
  const { view } = renderEmptyState();
  openPicker(view);

  assert.deepEqual(groupKeysFor('claude'), ['claude']);
  const claudeHeading = groupHeadings().find(
    (heading) => heading.getAttribute('data-model-group-key') === 'claude',
  );
  assert.match(claudeHeading?.textContent ?? '', /Anthropic/);
  assert.equal(
    claudeHeading?.closest('[cmdk-group]')?.querySelectorAll('[data-model-provider-id]').length,
    0,
    'a catalog with no provider binding must not grow provider rows of its own',
  );

  // A variant of a provider the catalog does not offer is not invented here.
  assert.equal(document.body.textContent?.includes('(ghost)'), false);
  assert.equal(document.querySelector('[data-model-provider-id="ghost"]'), null);
});

test('(g) the false forms fail: provider-grouped Codex, or a second (provider) dropdown', () => {
  const { view } = renderEmptyState();
  openPicker(view);

  assert.ok(
    groupKeysFor('codex').length > 1,
    'grouping Codex under its provider would leave a single branch and fail this count',
  );
  assert.equal(
    document.querySelector('[data-model-group-key="codex"]'),
    null,
    'there must be no provider-keyed Codex branch',
  );

  // One picker, and the provider is part of each row rather than a control of its own.
  assert.equal(document.querySelectorAll('[cmdk-root]').length, 1, 'the picker is one list');
  assert.equal(document.querySelectorAll('select').length, 0, 'there is no separate provider dropdown');
  assert.equal(document.querySelectorAll('[role="dialog"]').length, 1, 'one dialog, not two');
});

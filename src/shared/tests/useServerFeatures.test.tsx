import assert from 'node:assert/strict';

import { renderHook, waitFor } from '@testing-library/react';
import { beforeEach, test, vi } from 'vitest';

/**
 * The rules the shared server-features reading runs on, driven through the real
 * `ServerFeaturesStore` class.
 *
 * The store used to be four module-level `let`s operated on by module-level functions, which
 * made these rules untestable without the module's singleton lifetime leaking between cases.
 * A fresh `ServerFeaturesStore` per test pins them directly: one request for every consumer
 * that mounts together, fail-closed readings, and "loading" reading as off. Only the network
 * seam (`api.settings.serverFeatures`) is faked; the parsing, the in-flight sharing and the
 * settled/retry rule are the production code.
 */

const serverFeaturesMock = vi.hoisted(() => vi.fn());

vi.mock('@/shared/api', () => ({
  api: { settings: { serverFeatures: serverFeaturesMock } },
}));

/** A fresh module — and so a fresh exported singleton — for each test. */
const loadStoreModule = async () => {
  vi.resetModules();
  return import('@/shared/hooks/useServerFeatures');
};

/** The parts of `Response` the store reads. */
const answer = (body: unknown): Response => ({ ok: true, json: async () => body }) as unknown as Response;
const refusal = (): Response => ({ ok: false, json: async () => ({}) }) as unknown as Response;
const unreadable = (): Response =>
  ({
    ok: true,
    json: async () => {
      throw new SyntaxError('Unexpected token < in JSON at position 0');
    },
  }) as unknown as Response;

beforeEach(() => {
  serverFeaturesMock.mockReset();
});

test('two consumers mounting together share the first load: one request', async () => {
  const { ServerFeaturesStore } = await loadStoreModule();
  const store = new ServerFeaturesStore();
  serverFeaturesMock.mockResolvedValue(answer({ cockpit: { enabled: true } }));

  const first: string[] = [];
  const second: string[] = [];
  store.subscribe(() => first.push('changed'));
  store.subscribe(() => second.push('changed'));

  // Subscribing alone asks the server nothing; the mounted consumer's effect starts the load.
  assert.equal(serverFeaturesMock.mock.calls.length, 0);

  await Promise.all([store.load(), store.load()]);

  assert.equal(serverFeaturesMock.mock.calls.length, 1, 'the shared request must not be repeated');
  assert.deepEqual(store.getSnapshot(), { status: 'loaded', cockpitEnabled: true });
  assert.deepEqual(first, ['changed']);
  assert.deepEqual(second, ['changed']);
});

test('one mounted consumer starts exactly one request', async () => {
  const { useServerFeatures } = await loadStoreModule();
  serverFeaturesMock.mockResolvedValue(answer({ cockpit: { enabled: false } }));

  const { result } = renderHook(() => useServerFeatures());
  await waitFor(() => assert.equal(result.current.status, 'loaded'));

  assert.equal(serverFeaturesMock.mock.calls.length, 1);
  assert.equal(result.current.cockpitEnabled, false);
});

test('while the first request is in flight the reading is off', async () => {
  const { ServerFeaturesStore } = await loadStoreModule();
  const store = new ServerFeaturesStore();

  let reply!: (response: Response) => void;
  serverFeaturesMock.mockReturnValue(
    new Promise<Response>((resolve) => {
      reply = resolve;
    }),
  );

  assert.deepEqual(store.getSnapshot(), { status: 'loading', cockpitEnabled: false });
  const pending = store.load();
  assert.deepEqual(store.getSnapshot(), { status: 'loading', cockpitEnabled: false }, 'loading must read as off');

  reply(answer({ cockpit: { enabled: true } }));
  await pending;

  assert.deepEqual(store.getSnapshot(), { status: 'loaded', cockpitEnabled: true });
});

test('a refused request leaves the cockpit off', async () => {
  const { ServerFeaturesStore } = await loadStoreModule();
  const store = new ServerFeaturesStore();
  serverFeaturesMock.mockResolvedValue(refusal());

  await store.load();

  assert.deepEqual(store.getSnapshot(), { status: 'error', cockpitEnabled: false });
});

test('an answer that is not JSON leaves the cockpit off', async () => {
  const { ServerFeaturesStore } = await loadStoreModule();
  const store = new ServerFeaturesStore();
  serverFeaturesMock.mockResolvedValue(unreadable());

  await store.load();

  assert.deepEqual(store.getSnapshot(), { status: 'error', cockpitEnabled: false });
});

test('an answer without the cockpit block leaves the cockpit off', async () => {
  const { ServerFeaturesStore } = await loadStoreModule();
  const store = new ServerFeaturesStore();
  serverFeaturesMock.mockResolvedValue(answer({}));

  await store.load();

  assert.deepEqual(store.getSnapshot(), { status: 'loaded', cockpitEnabled: false });
});

test('a settled reading is boot-static: later loads ask nothing', async () => {
  const { ServerFeaturesStore } = await loadStoreModule();
  const store = new ServerFeaturesStore();
  serverFeaturesMock.mockResolvedValue(answer({ cockpit: { enabled: true } }));

  await store.load();
  await store.load();

  assert.equal(serverFeaturesMock.mock.calls.length, 1);
  assert.deepEqual(store.getSnapshot(), { status: 'loaded', cockpitEnabled: true });
});

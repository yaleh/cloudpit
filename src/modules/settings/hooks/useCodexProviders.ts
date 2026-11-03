import { useEffect, useMemo, useSyncExternalStore } from 'react';

import { authenticatedFetch, readApiJson } from '@/shared/api';
import type { CodexModelProvidersReading } from '@/shared/types';
import {
  createCodexProvidersController,
  type CodexConnectionProbe,
  type CodexModelProviderWrite,
  type CodexProviderDraft,
  type CodexProvidersSnapshot,
  type CodexUserProviderImportReading,
} from '@/modules/settings/utils/codexProvidersController';

/**
 * The Settings → Agents → Codex provider registry's React binding: one controller per panel,
 * subscribed through `useSyncExternalStore`, with the settings API as the only outside world.
 * Every rule (rows from the server reading, version-carrying full replacement, conflict
 * handling) lives in `codexProvidersController`.
 *
 * THE ENDPOINT IS NAMED HERE rather than in `src/shared/api.ts`: that file is an oversize file
 * whose architecture-ratchet baseline may only FALL, and the two calls are this panel's whole
 * transport surface. `authenticatedFetch` and `readApiJson` are still the shared helpers, so
 * auth headers and the error envelope behave exactly as every other settings call.
 */

/** The one route this slice reads and replaces. */
const CODEX_PROVIDERS_ROUTE = '/api/settings/codex/model-providers';

async function readCodexProviders(): Promise<CodexModelProvidersReading> {
  return readApiJson<CodexModelProvidersReading>(await authenticatedFetch(CODEX_PROVIDERS_ROUTE));
}

async function saveCodexProviders(input: {
  providers: CodexModelProviderWrite[];
  expectedVersion: string;
}): Promise<CodexModelProvidersReading> {
  return readApiJson<CodexModelProvidersReading>(await authenticatedFetch(CODEX_PROVIDERS_ROUTE, {
    method: 'PUT',
    body: JSON.stringify(input),
  }));
}

/** The read-only view of the operator's own `~/.codex` providers; names only, never secrets. */
const CODEX_PROVIDER_IMPORT_ROUTE = `${CODEX_PROVIDERS_ROUTE}/import`;

async function readCodexProviderImports(): Promise<CodexUserProviderImportReading> {
  return readApiJson<CodexUserProviderImportReading>(
    await authenticatedFetch(CODEX_PROVIDER_IMPORT_ROUTE),
  );
}

async function importCodexProviders(input: {
  ids: string[];
  expectedVersion: string;
}): Promise<CodexModelProvidersReading> {
  return readApiJson<CodexModelProvidersReading>(await authenticatedFetch(CODEX_PROVIDER_IMPORT_ROUTE, {
    method: 'POST',
    body: JSON.stringify(input),
  }));
}

/**
 * The connection probe for one SAVED provider. The server resolves the provider and its
 * token-file secret and sends the real request, so the form never carries a secret here.
 */
const CODEX_PROVIDER_CONNECTION_TEST_ROUTE = `${CODEX_PROVIDERS_ROUTE}/test`;

async function testCodexProviderConnection(providerId: string): Promise<CodexConnectionProbe> {
  return readApiJson<CodexConnectionProbe>(
    await authenticatedFetch(CODEX_PROVIDER_CONNECTION_TEST_ROUTE, {
      method: 'POST',
      body: JSON.stringify({ id: providerId }),
    }),
  );
}

export type UseCodexProvidersResult = {
  snapshot: CodexProvidersSnapshot;
  load: () => Promise<void>;
  addDraft: () => void;
  updateDraft: (index: number, patch: Partial<CodexProviderDraft>) => void;
  removeDraft: (index: number) => void;
  save: () => Promise<void>;
  loadImports: () => Promise<void>;
  bindImportedProvider: (providerId: string) => Promise<void>;
  testConnection: (providerId: string) => Promise<void>;
};

export function useCodexProviders(): UseCodexProvidersResult {
  const controller = useMemo(
    () => createCodexProvidersController({
      read: readCodexProviders,
      save: saveCodexProviders,
      readImports: readCodexProviderImports,
      importProviders: importCodexProviders,
      testConnection: testCodexProviderConnection,
    }),
    [],
  );
  const snapshot = useSyncExternalStore(
    controller.subscribe,
    controller.getSnapshot,
    controller.getSnapshot,
  );

  useEffect(() => {
    // React's development StrictMode cleans this effect up and sets it up again on the same
    // controller; re-arming before the read keeps that pass from leaving a dead controller.
    controller.activate();
    void controller.load();
    void controller.loadImports();
    return () => controller.dispose();
  }, [controller]);

  return {
    snapshot,
    load: controller.load,
    addDraft: controller.addDraft,
    updateDraft: controller.updateDraft,
    removeDraft: controller.removeDraft,
    save: controller.save,
    loadImports: controller.loadImports,
    bindImportedProvider: controller.bindImportedProvider,
    testConnection: controller.testConnection,
  };
}

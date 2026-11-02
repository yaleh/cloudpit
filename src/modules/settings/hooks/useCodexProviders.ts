import { useEffect, useMemo, useSyncExternalStore } from 'react';

import { authenticatedFetch, readApiJson } from '@/shared/api';
import type { CodexModelProvidersReading } from '@/shared/types';
import {
  createCodexProvidersController,
  type CodexModelProviderWrite,
  type CodexProviderDraft,
  type CodexProvidersSnapshot,
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

export type UseCodexProvidersResult = {
  snapshot: CodexProvidersSnapshot;
  load: () => Promise<void>;
  addDraft: () => void;
  updateDraft: (index: number, patch: Partial<CodexProviderDraft>) => void;
  removeDraft: (index: number) => void;
  save: () => Promise<void>;
};

export function useCodexProviders(): UseCodexProvidersResult {
  const controller = useMemo(
    () => createCodexProvidersController({
      read: readCodexProviders,
      save: saveCodexProviders,
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
    return () => controller.dispose();
  }, [controller]);

  return {
    snapshot,
    load: controller.load,
    addDraft: controller.addDraft,
    updateDraft: controller.updateDraft,
    removeDraft: controller.removeDraft,
    save: controller.save,
  };
}

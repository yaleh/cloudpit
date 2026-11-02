import { useEffect, useMemo, useSyncExternalStore } from 'react';

import { api, readApiJson } from '@/shared/api';
import type { CodexModelProviderWrite, CodexModelProvidersReading } from '@/shared/types';
import {
  createCodexProvidersController,
  type CodexProviderDraft,
  type CodexProvidersSnapshot,
} from '@/modules/settings/utils/codexProvidersController';

/**
 * The Settings → Agents → Codex provider registry's React binding: one controller per panel,
 * subscribed through `useSyncExternalStore`, with the settings API as the only outside world.
 * Every rule (rows from the server reading, version-carrying full replacement, conflict
 * handling) lives in `codexProvidersController`.
 */

async function readCodexProviders(): Promise<CodexModelProvidersReading> {
  return readApiJson<CodexModelProvidersReading>(await api.settings.codexModelProviders());
}

async function saveCodexProviders(input: {
  providers: CodexModelProviderWrite[];
  expectedVersion: string;
}): Promise<CodexModelProvidersReading> {
  return readApiJson<CodexModelProvidersReading>(await api.settings.saveCodexModelProviders(input));
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

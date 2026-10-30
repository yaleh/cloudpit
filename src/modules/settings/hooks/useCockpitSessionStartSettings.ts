import { useEffect, useMemo, useSyncExternalStore } from 'react';

import { api, readApiJson } from '@/shared/api';
import type {
  CockpitSessionStartSettingsReading,
  LLMProvider,
  ProviderModelsDefinition,
} from '@/shared/types';
import {
  createCockpitSessionStartSettingsController,
  type CockpitSessionStartSettingsSnapshot,
} from '@/modules/settings/tabs/cockpitSessionStartSettingsController';

/**
 * The Settings → Cockpit tab's React binding: one controller per tab, subscribed through
 * `useSyncExternalStore`, with the settings API as the only outside world it touches. Every
 * rule (catalog-derived pickers, version-carrying save, conflict handling) lives in
 * `cockpitSessionStartSettingsController`.
 */

/** The catalog envelope `GET /api/providers/:provider/models` answers with. */
type ProviderModelsEnvelope = { data?: { models?: ProviderModelsDefinition } };

async function readSettingsReading(): Promise<CockpitSessionStartSettingsReading> {
  return readApiJson<CockpitSessionStartSettingsReading>(await api.settings.cockpitSessionStart());
}

async function saveSettingsReading(input: {
  model: string;
  effort?: string;
  expectedVersion: string;
}): Promise<CockpitSessionStartSettingsReading> {
  return readApiJson<CockpitSessionStartSettingsReading>(
    await api.settings.saveCockpitSessionStart(input),
  );
}

async function readModelCatalog(provider: LLMProvider): Promise<ProviderModelsDefinition> {
  const envelope = await readApiJson<ProviderModelsEnvelope>(await api.providers.models(provider));
  return envelope.data?.models ?? { OPTIONS: [], DEFAULT: '' };
}

export type UseCockpitSessionStartSettingsResult = {
  snapshot: CockpitSessionStartSettingsSnapshot;
  load: () => Promise<void>;
  setDraftModel: (value: string) => void;
  setDraftEffort: (value: string) => void;
  save: () => Promise<void>;
};

export function useCockpitSessionStartSettings(
  provider: LLMProvider,
): UseCockpitSessionStartSettingsResult {
  const controller = useMemo(
    () => createCockpitSessionStartSettingsController({
      read: readSettingsReading,
      save: saveSettingsReading,
      readCatalog: () => readModelCatalog(provider),
      provider,
    }),
    [provider],
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
    setDraftModel: controller.setDraftModel,
    setDraftEffort: controller.setDraftEffort,
    save: controller.save,
  };
}

import { useEffect, useMemo, useSyncExternalStore } from 'react';

import type { LLMProvider, ProviderLifecycleDefault, SessionLifecycleMode } from '@/shared/types';
import { createNewSessionLifecycleController } from '@/modules/chat/utils/newSessionLifecycleController';

/**
 * The React binding for the next-new-session lifecycle selection.
 *
 * Used by `ChatInterface`: the empty state's switch renders `mode`, the send and
 * Live Voice paths read `lifecycleModeForCreate`, and a successful creation
 * calls `spend`. Every rule (following the provider default, clearing across a
 * provider change, spending the override) lives in the controller; this hook
 * only mirrors its snapshot and hands it the capability row.
 */
export function useNewSessionLifecycle(
  provider: LLMProvider,
  lifecycle: ProviderLifecycleDefault | null,
): {
  mode: SessionLifecycleMode | null;
  canToggle: boolean;
  toggle: () => void;
  spend: () => void;
  lifecycleModeForCreate: () => SessionLifecycleMode | undefined;
} {
  const controller = useMemo(() => createNewSessionLifecycleController(provider), []);
  const snapshot = useSyncExternalStore(controller.subscribe, controller.getSnapshot);

  // The capability row arrives asynchronously and the provider changes on the
  // provider picker; the controller keeps the override only when both are for
  // the same provider, so the switch can never state one provider's choice
  // while the creation is for another.
  useEffect(() => {
    controller.syncProvider(provider, lifecycle);
  }, [controller, provider, lifecycle]);

  return {
    mode: snapshot.mode,
    canToggle: snapshot.canToggle,
    toggle: controller.toggle,
    spend: controller.spend,
    lifecycleModeForCreate: controller.lifecycleModeForCreate,
  };
}

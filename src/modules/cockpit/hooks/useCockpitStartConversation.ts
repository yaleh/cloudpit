import { useCallback, useEffect, useMemo, useSyncExternalStore } from 'react';

import { api } from '@/shared/api';
import type { CockpitCard, LLMProvider, QuayFleetSummary } from '@/shared/types';
import { createChatSession } from '@/modules/chat';
import { createCockpitStartConversationController } from '@/modules/cockpit/cockpitCardStartConversation';
import type {
  CockpitStartConversationCreated,
  CockpitStartConversationProject,
  CockpitStartConversationSnapshot,
} from '@/modules/cockpit/cockpitCardStartConversation';

/** The LLM a card-started conversation runs on when the surface names none. */
export const DEFAULT_COCKPIT_CARD_SESSION_PROVIDER: LLMProvider = 'claude';

/**
 * Reads the registered cockpit projects — the same fleet registry the cockpit's project strip
 * and project resolver use. Read on demand (only when a person presses the card button) so the
 * card list keeps its one existing read.
 */
async function readRegisteredCockpitProjects(): Promise<readonly CockpitStartConversationProject[]> {
  const response = await api.quayFleetSummary();
  if (!response.ok) {
    throw new Error(`Failed to read the registered projects (${response.status})`);
  }
  const summary = (await response.json()) as QuayFleetSummary;
  return (summary.projects ?? []).map((project) => ({
    projectId: project.projectId,
    fleetProjectId: project.fleetProjectId ?? null,
    projectPath: project.projectPath,
  }));
}

export type UseCockpitStartConversationOptions = {
  /** The registered projects the surface already read, or `null` to read them on demand. */
  registeredProjects?: readonly CockpitStartConversationProject[] | null;
  /** Registers the created session where the surface has a project-state seam. */
  onCreated?: (created: CockpitStartConversationCreated) => void;
  /** Opens the created session through the surface's own navigation. */
  onNavigate?: (sessionId: string) => void;
  /** The provider the new conversation runs on; production leaves the server's default. */
  provider?: LLMProvider;
};

/**
 * The cards list's start-conversation binding: one controller per list, subscribed through
 * `useSyncExternalStore`, with the surface's registry/registration/navigation handed over in one
 * effect. Every rule lives in {@link createCockpitStartConversationController}.
 *
 * Used by `CockpitCardList`; the card Details drawer draws the snapshot it returns.
 */
export function useCockpitStartConversation(
  options: UseCockpitStartConversationOptions = {},
): {
  snapshot: CockpitStartConversationSnapshot;
  start: (card: CockpitCard) => void;
} {
  const provider = options.provider ?? DEFAULT_COCKPIT_CARD_SESSION_PROVIDER;
  const controller = useMemo(
    () => createCockpitStartConversationController({ createSession: createChatSession, provider }),
    [provider],
  );
  const snapshot = useSyncExternalStore(
    controller.subscribe,
    controller.getSnapshot,
    controller.getSnapshot,
  );

  // The surface's callbacks may change with its own render; handing them over again keeps the
  // controller alive (a recreated controller would drop an in-flight start's answer).
  const registeredProjects = options.registeredProjects ?? null;
  const { onCreated = null, onNavigate = null } = options;
  useEffect(() => {
    // React's development StrictMode cleans the mount effect up and sets it up again on the same
    // controller instance; re-arming here keeps that pass from leaving a dead controller behind.
    controller.activate();
    controller.setContext({
      registeredProjects,
      // THE REGISTRY IS READ ONLY WHEN THE SURFACE DID NOT HAND ONE OVER. The page has already
      // read the fleet; the overlay and the column ask on the first press.
      loadRegisteredProjects:
        registeredProjects === null ? readRegisteredCockpitProjects : null,
      onCreated,
      onNavigate,
    });
  }, [controller, onCreated, onNavigate, registeredProjects]);

  useEffect(() => () => controller.dispose(), [controller]);

  const start = useCallback((card: CockpitCard) => controller.start(card), [controller]);
  return { snapshot, start };
}

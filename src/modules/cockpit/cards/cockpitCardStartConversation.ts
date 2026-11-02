import type { CockpitCard, LLMProvider } from '@/shared/types';

/**
 * The card button that starts a NEW conversation about a card: which project it may run in, the
 * one creation call it makes, and the two visible outcomes (a registered project that matches, or
 * an error the person can read and retry).
 *
 * WHY A CONTROLLER. Whether a second press may issue a second `POST /api/providers/sessions`,
 * which value names the project, and what happens between the gateway's answer and the navigation
 * are rules, not rendering. They live here so a criterion can drive them with injected callbacks
 * and no React, and the component only draws the snapshot.
 *
 * NO FALLBACK PROJECT. The card names the project it wants to talk about; when that value is not
 * an actually registered project the start FAILS visibly. Falling back to the project the cockpit
 * happens to be showing would create a session in a project the card never named — the one failure
 * this flow must never make silently.
 */

/**
 * The part of a registered cockpit project this flow reads: the two ids a card may address it by,
 * and the root a session is created in. `CockpitProject` satisfies it structurally.
 */
export type CockpitStartConversationProject = {
  projectId: string;
  fleetProjectId?: string | null;
  projectPath: string;
};

/** Why a start attempt did not produce a session. The component translates each kind. */
export type CockpitStartConversationError =
  /** The card names no project at all — there is nowhere to create the session. */
  | { kind: 'no-project' }
  /** The card's project does not resolve to a registered project. `project` is the value as stated. */
  | { kind: 'unregistered'; project: string }
  /** The gateway (or the registry read) failed. `reason` is the thrown message. */
  | { kind: 'failed'; reason: string };

/** What the card's start button is doing right now. */
export type CockpitStartConversationSnapshot = {
  /** The card this reading belongs to, or `null` before the first press. */
  cardId: string | null;
  status: 'idle' | 'starting' | 'failed' | 'started';
  error: CockpitStartConversationError | null;
  /** The registered project's own id once one resolved, else `null`. */
  projectId: string | null;
  /** The session the last successful start created, else `null`. */
  sessionId: string | null;
};

/** The session one successful start created, with the project it was created in. */
export type CockpitStartConversationCreated = {
  sessionId: string;
  sessionName: string;
  provider: LLMProvider;
  project: CockpitStartConversationProject;
};

/** What the outside world hands the controller; the gateway is the shipped creation path. */
export type CockpitStartConversationDeps = {
  /** `createChatSession`, narrowed to the fields this flow passes (an EMPTY session). */
  createSession: (payload: {
    provider: LLMProvider;
    projectPath: string;
    model?: string;
    effort?: string;
  }) => Promise<{ sessionId: string; sessionName: string }>;
  /**
   * The server's EFFECTIVE `cockpit.sessionStart` selection for a new conversation.
   *
   * This is the same server config field the card `session.start` executor reads, so the
   * card's button and an action/`ownReply` open conversations on the same model. A failed
   * read fails the start visibly: a local default would open the conversation on a different
   * model than the settings page just reported.
   */
  readEffectiveSelection: () => Promise<{ model?: string; effort?: string }>;
  /** The LLM a card-started conversation runs on; the server's own default is `claude`. */
  provider: LLMProvider;
};

/** The readings a surface owns and hands over on every render (the controller owns no hooks). */
export type CockpitStartConversationContext = {
  /** The registered projects the surface already read, or `null` to read them on demand. */
  registeredProjects: readonly CockpitStartConversationProject[] | null;
  /** The on-demand registry read, used only when `registeredProjects` is `null`. */
  loadRegisteredProjects: (() => Promise<readonly CockpitStartConversationProject[]>) | null;
  /** Registers the new session where the surface has a project-state seam; absent elsewhere. */
  onCreated: ((created: CockpitStartConversationCreated) => void) | null;
  /** Opens the created session; absent means the surface owns no navigation. */
  onNavigate: ((sessionId: string) => void) | null;
};

export type CockpitStartConversationController = {
  getSnapshot: () => CockpitStartConversationSnapshot;
  subscribe: (listener: () => void) => () => void;
  setContext: (context: CockpitStartConversationContext) => void;
  /** The card button's one command. A press while a start is in flight is ignored. */
  start: (card: CockpitCard) => void;
  /**
   * Re-arms the SAME controller after its mount effect was cleaned up and set up again — React's
   * development StrictMode does exactly that, and a controller disposed by the first cleanup would
   * otherwise ignore every press for the rest of the page's life. Production never cleans up a
   * live mount, so this is a no-op there.
   */
  activate: () => void;
  dispose: () => void;
};

const IDLE: CockpitStartConversationSnapshot = {
  cardId: null,
  status: 'idle',
  error: null,
  projectId: null,
  sessionId: null,
};

/**
 * The value the card names, in priority order: the conversation's `startInProject` wins over the
 * subject's project. Both are trimmed; an absent or blank value stays `''` (no project named).
 */
export function cockpitStartConversationProjectOf(card: CockpitCard): string {
  return (card.conversation?.startInProject ?? card.subject.project ?? '').trim();
}

/**
 * The registered project a card value addresses: an exact `projectId`, else a case-insensitive
 * `fleetProjectId` — the same two readings the cockpit's own project resolver uses. `null` when
 * neither matches, which is the ONLY result that turns into the visible error.
 */
function registeredProjectOf(
  projects: readonly CockpitStartConversationProject[],
  value: string,
): CockpitStartConversationProject | null {
  return (
    projects.find((project) => project.projectId === value)
    ?? projects.find(
      (project) => (project.fleetProjectId ?? '') !== ''
        && (project.fleetProjectId ?? '').toLowerCase() === value.toLowerCase(),
    )
    ?? null
  );
}

function reasonOf(error: unknown): string {
  return error instanceof Error && error.message.trim() !== '' ? error.message : 'unknown error';
}

/**
 * Creates the controller for ONE cockpit surface (the cards list). Used by
 * `useCockpitStartConversation`; the hook is the React binding only.
 */
export function createCockpitStartConversationController(
  deps: CockpitStartConversationDeps,
): CockpitStartConversationController {
  let snapshot: CockpitStartConversationSnapshot = IDLE;
  const listeners = new Set<() => void>();
  let context: CockpitStartConversationContext = {
    registeredProjects: null,
    loadRegisteredProjects: null,
    onCreated: null,
    onNavigate: null,
  };
  let disposed = false;
  // A start is NOT re-entrant: the guard is the controller's state, not a component flag, so the
  // same rule holds for every surface and every repeated press.
  let inFlight = false;

  const publish = (next: CockpitStartConversationSnapshot): void => {
    if (disposed) return;
    snapshot = next;
    for (const listener of listeners) listener();
  };

  const start = (card: CockpitCard): void => {
    if (disposed || inFlight) return;
    // One session per card: a press after a success would allocate a second empty conversation
    // and leave the first one unopened.
    if (snapshot.cardId === card.id && snapshot.status === 'started') return;

    const declared = cockpitStartConversationProjectOf(card);
    if (declared === '') {
      publish({ cardId: card.id, status: 'failed', error: { kind: 'no-project' }, projectId: null, sessionId: null });
      return;
    }

    inFlight = true;
    publish({ cardId: card.id, status: 'starting', error: null, projectId: null, sessionId: null });

    void (async () => {
      try {
        let projects = context.registeredProjects;
        if (projects === null && context.loadRegisteredProjects !== null) {
          projects = await context.loadRegisteredProjects();
        }
        const project = registeredProjectOf(projects ?? [], declared);
        if (project === null) {
          publish({
            cardId: card.id,
            status: 'failed',
            error: { kind: 'unregistered', project: declared },
            projectId: null,
            sessionId: null,
          });
          return;
        }

        // An EMPTY session: no initial message — the person starts talking once it is open.
        // Its LAUNCH SELECTION is the server's effective `cockpit.sessionStart` reading, the
        // same field the card `session.start` executor uses. Blank values are omitted rather
        // than sent as `''`, so the provider keeps its own launch default.
        const selection = await deps.readEffectiveSelection();
        const model = selection.model?.trim() ?? '';
        const effort = selection.effort?.trim() ?? '';
        const created = await deps.createSession({
          provider: deps.provider,
          projectPath: project.projectPath,
          ...(model === '' ? {} : { model }),
          ...(effort === '' ? {} : { effort }),
        });
        const started: CockpitStartConversationCreated = {
          sessionId: created.sessionId,
          sessionName: created.sessionName,
          provider: deps.provider,
          project,
        };
        publish({
          cardId: card.id,
          status: 'started',
          error: null,
          projectId: project.projectId,
          sessionId: created.sessionId,
        });
        // Registered BEFORE navigating: the destination reads the project state, and a session
        // that lands in the sidebar only after the route changed would flash an empty workspace.
        context.onCreated?.(started);
        context.onNavigate?.(created.sessionId);
      } catch (error) {
        publish({
          cardId: card.id,
          status: 'failed',
          error: { kind: 'failed', reason: reasonOf(error) },
          projectId: null,
          sessionId: null,
        });
      } finally {
        inFlight = false;
      }
    })();
  };

  return {
    getSnapshot: () => snapshot,
    subscribe: (listener) => {
      listeners.add(listener);
      return () => {
        listeners.delete(listener);
      };
    },
    setContext: (next) => {
      context = next;
    },
    start,
    activate: () => {
      disposed = false;
    },
    dispose: () => {
      disposed = true;
      listeners.clear();
    },
  };
}

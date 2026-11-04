import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import type { TFunction } from 'i18next';

import { api } from '@/shared/api';
import { useWebSocket } from '@/shared/context/WebSocketContext';
import { getSessionTitle } from '@/shared/utils';
import type {
  ActiveSidebarRename,
  ArchivedProjectListItem,
  ArchivedSessionListItem,
  LLMProvider,
  PendingSidebarDeletion,
  Project,
  ProjectSession,
  RecentConversationListItem,
  ServerEvent,
  SessionHiddenByProjectFilter,
  SessionWithProvider,
  SidebarSearchMode,
} from '@/shared/types';
import { getAllSessions } from '@/modules/sidebar/utils/sidebarProjectFormatting';

type ArchivedSessionsApiPayload = {
  success?: boolean;
  data?: {
    sessions?: ArchivedSessionListItem[];
  };
};

type ArchivedProjectsApiPayload = {
  success?: boolean;
  data?: {
    projects?: ArchivedProjectListItem[];
  };
};

type RecentConversationsApiPayload = {
  success?: boolean;
  data?: {
    conversations?: RecentConversationListItem[];
    total?: number;
    hasMore?: boolean;
  };
};

/**
 * The `kind: session_upserted` delta as the Conversations list needs it: which
 * session changed and what row the server now reports for it.
 *
 * Built on the wire by
 * `server/modules/websocket/services/session-upsert-broadcast.service.ts`,
 * which emits nothing at all for an archived row.
 */
type SessionUpsertedEvent = ServerEvent & {
  sessionId?: string;
  provider?: LLMProvider;
  session?: ProjectSession;
  project?: { projectId: string; displayName: string } | null;
};

type UseSidebarSessionsConcernArgs = {
  projects: Project[];
  t: TFunction;
  onRefresh: () => Promise<void> | void;
  onSessionSelect: (session: ProjectSession) => void;
  onSessionDelete?: (sessionId: string) => void;
  isSessionHiddenByProjectFilter?: SessionHiddenByProjectFilter;
  searchMode: SidebarSearchMode;
  debouncedSearchQuery: string;
  pendingDeletion: PendingSidebarDeletion | null;
  setPendingDeletion: (value: PendingSidebarDeletion | null) => void;
  setActiveRename: (value: ActiveSidebarRename | null) => void;
  setIsRefreshing: (value: boolean) => void;
  handleProjectSelect: (project: Project) => void;
};

/**
 * Everything the sidebar reads about sessions: the Conversations feed and its
 * live upserts, the archived lists, per-session rename/delete/fork/restore, and
 * the one refresh command that reloads all three feeds. Consumed by
 * `useSidebarController`, which composes it with the project and dialog
 * concerns into one public surface.
 */
export function useSidebarSessionsConcern({
  projects,
  t,
  onRefresh,
  onSessionSelect,
  onSessionDelete,
  isSessionHiddenByProjectFilter,
  searchMode,
  debouncedSearchQuery,
  pendingDeletion,
  setPendingDeletion,
  setActiveRename,
  setIsRefreshing,
  handleProjectSelect,
}: UseSidebarSessionsConcernArgs) {
  // The app-wide event stream, read here so a rename made anywhere reaches the
  // Conversations list. Same subscription the project-workspace module takes.
  const { subscribe } = useWebSocket();
  // Projects and standalone sessions the archive holds.
  const [archivedProjects, setArchivedProjects] = useState<ArchivedProjectListItem[]>([]);
  const [archivedSessions, setArchivedSessions] = useState<ArchivedSessionListItem[]>([]);
  // Whether the archive fetch is in flight.
  const [isArchivedSessionsLoading, setIsArchivedSessionsLoading] = useState(false);
  // The Conversations feed's loaded pages and its server-reported paging state.
  const [recentConversations, setRecentConversations] = useState<RecentConversationListItem[]>([]);
  const [recentConversationsTotal, setRecentConversationsTotal] = useState(0);
  const [recentConversationsHasMore, setRecentConversationsHasMore] = useState(false);
  // Whether the first page / a load-more page of Conversations is in flight.
  const [isRecentConversationsLoading, setIsRecentConversationsLoading] = useState(false);
  const [isLoadingMoreRecentConversations, setIsLoadingMoreRecentConversations] = useState(false);
  // Whether the last Conversations page request failed, so the list can offer retry.
  const [recentConversationsError, setRecentConversationsError] = useState(false);
  // Monotonic page-request id; a stale page response is discarded instead of appended.
  const recentConversationsSeqRef = useRef(0);

  const fetchArchivedSessions = useCallback(async () => {
    setIsArchivedSessionsLoading(true);

    try {
      const [archivedProjectsResponse, archivedSessionsResponse] = await Promise.all([
        api.archivedProjects(),
        api.getArchivedSessions(),
      ]);

      if (!archivedProjectsResponse.ok) {
        throw new Error(`Failed to load archived projects: ${archivedProjectsResponse.status}`);
      }

      if (!archivedSessionsResponse.ok) {
        throw new Error(`Failed to load archived sessions: ${archivedSessionsResponse.status}`);
      }

      const archivedProjectsPayload = (await archivedProjectsResponse.json()) as ArchivedProjectsApiPayload;
      const archivedSessionsPayload = (await archivedSessionsResponse.json()) as ArchivedSessionsApiPayload;
      const nextProjects = Array.isArray(archivedProjectsPayload.data?.projects) ? archivedProjectsPayload.data.projects : [];
      const archivedProjectIds = new Set(nextProjects.map((project) => project.projectId));
      const nextStandaloneSessions = Array.isArray(archivedSessionsPayload.data?.sessions)
        ? archivedSessionsPayload.data.sessions.filter((session) => !session.projectId || !archivedProjectIds.has(session.projectId))
        : [];

      setArchivedProjects(nextProjects);
      setArchivedSessions(nextStandaloneSessions);
    } catch (error) {
      console.error('[Sidebar] Failed to load archived sessions:', error);
    } finally {
      setIsArchivedSessionsLoading(false);
    }
  }, []);

  const fetchRecentConversationsPage = useCallback(async (offset: number, append: boolean) => {
    const requestSequence = ++recentConversationsSeqRef.current;
    if (append) {
      setIsLoadingMoreRecentConversations(true);
    } else {
      setIsRecentConversationsLoading(true);
    }
    setRecentConversationsError(false);

    try {
      const response = await api.recentConversations({ limit: 40, offset });
      if (!response.ok) {
        throw new Error(`Failed to load recent conversations: ${response.status}`);
      }

      const payload = (await response.json()) as RecentConversationsApiPayload;
      const conversations = Array.isArray(payload.data?.conversations)
        ? payload.data.conversations
        : [];

      if (requestSequence !== recentConversationsSeqRef.current) {
        return;
      }

      setRecentConversations((previous) => {
        if (!append) {
          return conversations;
        }

        const existingIds = new Set(previous.map((conversation) => conversation.sessionId));
        return [
          ...previous,
          ...conversations.filter((conversation) => !existingIds.has(conversation.sessionId)),
        ];
      });
      setRecentConversationsTotal(Number(payload.data?.total ?? conversations.length));
      setRecentConversationsHasMore(Boolean(payload.data?.hasMore));
    } catch (error) {
      if (requestSequence !== recentConversationsSeqRef.current) {
        return;
      }
      console.error('[Sidebar] Failed to load recent conversations:', error);
      setRecentConversationsError(true);
    } finally {
      if (requestSequence === recentConversationsSeqRef.current) {
        setIsRecentConversationsLoading(false);
        setIsLoadingMoreRecentConversations(false);
      }
    }
  }, []);

  const reloadRecentConversations = useCallback(() => {
    void fetchRecentConversationsPage(0, false);
  }, [fetchRecentConversationsPage]);

  const loadMoreRecentConversations = useCallback(() => {
    if (isLoadingMoreRecentConversations || !recentConversationsHasMore) {
      return;
    }
    void fetchRecentConversationsPage(recentConversations.length, true);
  }, [
    fetchRecentConversationsPage,
    isLoadingMoreRecentConversations,
    recentConversations.length,
    recentConversationsHasMore,
  ]);

  useEffect(() => {
    void fetchArchivedSessions();
  }, [fetchArchivedSessions]);

  // A session renamed or created anywhere — this client, another browser, the
  // CLI — arrives as a `session_upserted`. The Conversations list holds its own
  // copy of every row, so without this it kept showing the name a session had
  // when the page was last listed. Patching in place (rather than reloading the
  // feed) also preserves the pages loaded past the first.
  //
  // The project's name rules apply to this feed exactly as they do to a reload:
  // a session whose current name matches is neither inserted nor kept, so a
  // worker session created while the user sits on Conversations never appears.
  // The predicate and the project rows come from the parent (see
  // SessionHiddenByProjectFilter); judging is done by the delta's own summary,
  // which for a session row is the same coalesced name the reload filters on.
  //
  // Archived rows are deliberately not covered: the server's upsert builder
  // returns null for an archived row, so no event for one ever reaches a client.
  // A rename made here is patched locally by `updateSessionSummary` instead; a
  // rename made from another client is out of scope (see the task Evidence).
  useEffect(() => subscribe((event) => {
    if (event.kind !== 'session_upserted') {
      return;
    }

    const upsert = event as SessionUpsertedEvent;
    const sessionId = upsert.sessionId;
    if (!sessionId || !upsert.session) {
      return;
    }

    // The same authority the workspace header uses. The delta carries no
    // `__provider`, so stamp the event's provider on before asking it.
    const title = getSessionTitle({ ...upsert.session, __provider: upsert.provider });
    // The Conversations feed has to match what a reload of the same feed returns, and
    // `GET /api/providers/sessions/recent` applies the project's name rules with
    // neither of the Projects list's exemptions: no keepSessionIds, no browser-local
    // "show hidden". Judging with an empty set and `isShowingHidden = false` is what
    // keeps the live list from being the more permissive of the two — being more
    // permissive is exactly the reported bug.
    const noExemptSessionIds: ReadonlySet<string> = new Set();

    setRecentConversations((previous) => {
      const index = previous.findIndex(
        (conversation) => conversation.sessionId === sessionId,
      );
      const byRecency = (a: RecentConversationListItem, b: RecentConversationListItem) => {
        const left = Date.parse(a.lastActivity ?? '');
        const right = Date.parse(b.lastActivity ?? '');
        return (Number.isFinite(right) ? right : 0) - (Number.isFinite(left) ? left : 0);
      };

      // Which project's rules judge this row: the one the delta names, else the
      // one the row already belongs to. No project means no rules, and a row the
      // reload would not list either way; the rest of the handler decides.
      const claimedProjectId = upsert.project?.projectId
        ?? (index >= 0 ? previous[index].projectId : null);
      const judgedProject = claimedProjectId
        ? projects.find((candidate) => candidate.projectId === claimedProjectId)
        : undefined;
      // Unlike the Projects list there is no fall-back to a known earlier title: a
      // live-inserted row is titled by the session id when it has no name, and a
      // rule may legitimately match ids, so falling back would keep a row the
      // reload drops — the asymmetry this feed is being brought in line with.
      const summary = typeof upsert.session?.summary === 'string' ? upsert.session.summary : '';
      const isHidden = Boolean(
        judgedProject
        && isSessionHiddenByProjectFilter?.(
          judgedProject,
          { id: String(sessionId), summary },
          noExemptSessionIds,
          false,
        ),
      );

      if (index < 0) {
        // Nothing to insert: the reload this feed must match would not list it.
        if (isHidden) {
          return previous;
        }
        // A session created while this list was already loaded (New Session →
        // first message) is in no page the list holds. The delta carries the
        // project, so insert the row and let recency place it. Without a project
        // identity the row cannot be opened, so it is left for the next reload.
        if (!upsert.project || !upsert.provider) {
          return previous;
        }

        const inserted = [
          ...previous,
          {
            sessionId,
            provider: upsert.provider,
            projectId: upsert.project.projectId,
            projectDisplayName: upsert.project.displayName,
            sessionTitle: title,
            lastActivity: upsert.session?.lastActivity ?? new Date().toISOString(),
            forkedFromSessionId: null,
          } satisfies RecentConversationListItem,
        ].sort(byRecency);

        // A full page whose newest-sorted slot is the tail means the row belongs
        // to a page not loaded yet; load-more will bring it in.
        if (previous.length >= 40 && inserted[inserted.length - 1].sessionId === sessionId) {
          return previous;
        }
        return inserted;
      }

      // A row that has since been named into a rule leaves the list. The header
      // count is left alone: it is re-derived from the server by the next reload,
      // and the membership is what has to match.
      if (isHidden) {
        return previous.filter((conversation) => conversation.sessionId !== sessionId);
      }

      // Input/output in a session bumps its `lastActivity` on the server; take
      // it only when it moves forward so a stale delta never rewinds a row.
      const incomingActivity = upsert.session?.lastActivity;
      const incomingTime = incomingActivity ? Date.parse(String(incomingActivity)) : Number.NaN;
      const currentTimeValue = Date.parse(previous[index].lastActivity ?? '');
      const activityAdvanced = Number.isFinite(incomingTime)
        && (!Number.isFinite(currentTimeValue) || incomingTime > currentTimeValue);

      // An unchanged title and activity must keep the previous array so an unrelated upsert does not re-render.
      if (previous[index].sessionTitle === title && !activityAdvanced) {
        return previous;
      }

      const next = [...previous];
      next[index] = {
        ...next[index],
        sessionTitle: title,
        ...(activityAdvanced ? { lastActivity: String(incomingActivity) } : {}),
      };

      if (!activityAdvanced) {
        return next;
      }

      // The list is ordered by recency, so a row that just moved forward goes
      // to its sorted place. Stable sort keeps rows with equal times in order.
      return next.sort(byRecency);
    });
    // `projects` is a dependency rather than a ref: the handler judges new deltas
    // against the rules it was last rendered with, and a rules edit re-subscribes
    // instead of leaving a window where a stale rule set decides.
  }), [subscribe, projects, isSessionHiddenByProjectFilter]);

  useEffect(() => {
    if (searchMode !== 'conversations' || debouncedSearchQuery.length >= 2) {
      return;
    }

    reloadRecentConversations();
  }, [debouncedSearchQuery, reloadRecentConversations, searchMode]);

  useEffect(() => {
    if (searchMode !== 'archived') {
      return;
    }

    // Refresh archive contents when the archived tab opens so restore actions
    // and background synchronizer updates are reflected without a full reload.
    void fetchArchivedSessions();
  }, [fetchArchivedSessions, searchMode]);

  const filteredArchivedSessions = useMemo(() => {
    const normalizedSearch = debouncedSearchQuery.trim().toLowerCase();
    if (!normalizedSearch) {
      return archivedSessions;
    }

    return archivedSessions.filter((session) => {
      const searchableFields = [
        session.sessionTitle,
        session.projectDisplayName,
        session.projectPath ?? '',
        session.provider,
      ];

      return searchableFields.some((value) => value.toLowerCase().includes(normalizedSearch));
    });
  }, [archivedSessions, debouncedSearchQuery]);

  const filteredArchivedProjects = useMemo(() => {
    const normalizedSearch = debouncedSearchQuery.trim().toLowerCase();
    if (!normalizedSearch) {
      return archivedProjects;
    }

    return archivedProjects.filter((project) => {
      const projectMatches = [
        project.displayName,
        project.fullPath || '',
      ].some((value) => value.toLowerCase().includes(normalizedSearch));

      if (projectMatches) {
        return true;
      }

      return getAllSessions(project).some((session) => {
        const sessionSummary =
          typeof session.summary === 'string' && session.summary.trim().length > 0
            ? session.summary
            : typeof session.name === 'string'
              ? session.name
              : '';

        return [
          sessionSummary,
          session.__provider,
        ].some((value) => value.toLowerCase().includes(normalizedSearch));
      });
    });
  }, [archivedProjects, debouncedSearchQuery]);

  const handleSessionClick = useCallback(
    (session: SessionWithProvider, projectId: string) => {
      // Tag the session with its owning projectId so downstream handlers
      // can correlate it with the selectedProject in the app state.
      onSessionSelect({ ...session, __projectId: projectId });
    },
    [onSessionSelect],
  );

  const openArchivedSession = useCallback((session: ArchivedSessionListItem) => {
    const activeProject = session.projectId
      ? projects.find((candidate) => candidate.projectId === session.projectId)
      : null;
    const archivedProject = session.projectId
      ? archivedProjects.find((candidate) => candidate.projectId === session.projectId)
      : null;
    const matchingProject = activeProject ?? archivedProject ?? null;
    const sessionPayload: ProjectSession = {
      id: session.sessionId,
      summary: session.sessionTitle,
      __provider: session.provider,
      __projectId: matchingProject?.projectId ?? session.projectId ?? undefined,
    };

    // Archived sessions still need a selected project context. Active projects
    // come from the normal sidebar list, while archived-project sessions resolve
    // through the archive payload loaded by this controller.
    if (matchingProject) {
      handleProjectSelect(matchingProject);
    }

    onSessionSelect(sessionPayload);
  }, [archivedProjects, handleProjectSelect, onSessionSelect, projects]);

  const restoreArchivedProject = useCallback(async (projectId: string) => {
    try {
      const response = await api.restoreProject(projectId);
      if (!response.ok) {
        const errorText = await response.text();
        console.error('[Sidebar] Failed to restore project:', {
          status: response.status,
          error: errorText,
        });
        alert(t('messages.restoreProjectFailed', 'Failed to restore project. Please try again.'));
        return;
      }

      await Promise.all([
        Promise.resolve(onRefresh()),
        fetchArchivedSessions(),
      ]);
    } catch (error) {
      console.error('[Sidebar] Error restoring project:', error);
      alert(t('messages.restoreProjectError', 'Error restoring project. Please try again.'));
    }
  }, [fetchArchivedSessions, onRefresh, t]);

  const restoreArchivedSession = useCallback(async (sessionId: string) => {
    try {
      const response = await api.restoreSession(sessionId);
      if (!response.ok) {
        const errorText = await response.text();
        console.error('[Sidebar] Failed to restore session:', {
          status: response.status,
          error: errorText,
        });
        alert(t('messages.restoreSessionFailed', 'Failed to restore session. Please try again.'));
        return;
      }

      await Promise.all([
        Promise.resolve(onRefresh()),
        fetchArchivedSessions(),
      ]);
    } catch (error) {
      console.error('[Sidebar] Error restoring session:', error);
      alert(t('messages.restoreSessionError', 'Error restoring session. Please try again.'));
    }
  }, [fetchArchivedSessions, onRefresh, t]);

  const refreshProjects = useCallback(async () => {
    setIsRefreshing(true);
    try {
      await Promise.all([
        Promise.resolve(onRefresh()),
        fetchArchivedSessions(),
        searchMode === 'conversations'
          ? fetchRecentConversationsPage(0, false)
          : Promise.resolve(),
      ]);
    } finally {
      setIsRefreshing(false);
    }
  }, [fetchArchivedSessions, fetchRecentConversationsPage, onRefresh, searchMode, setIsRefreshing]);

  const updateSessionSummary = useCallback(
    // `_projectId` and `_provider` are preserved for compatibility with
    // existing sidebar callback signatures; backend rename only needs sessionId.
    async (_projectId: string, sessionId: string, summary: string, _provider: LLMProvider) => {
      const trimmed = summary.trim();
      if (!trimmed) {
        setActiveRename(null);
        return;
      }
      try {
        const response = await api.renameSession(sessionId, trimmed);
        if (response.ok) {
          // onRefresh reloads projects, not the recents feed, so a row renamed
          // from the Conversations list kept its old title until the next fetch.
          // Patching in place also preserves the pages already loaded past the
          // first, which refetching page zero would discard.
          setRecentConversations((previous) => previous.map((conversation) => (
            conversation.sessionId === sessionId
              ? { ...conversation, sessionTitle: trimmed }
              : conversation
          )));
          // The archived list holds its own copy of the title too, and the
          // rename produced no event it could follow: the server's upsert
          // builder emits nothing for an archived row. Patch it here, or a
          // session renamed while archived keeps its old name in that list.
          setArchivedSessions((previous) => previous.map((session) => (
            session.sessionId === sessionId
              ? { ...session, sessionTitle: trimmed }
              : session
          )));
          await onRefresh();
        } else {
          console.error('[Sidebar] Failed to rename session:', response.status);
          alert(t('messages.renameSessionFailed'));
        }
      } catch (error) {
        console.error('[Sidebar] Error renaming session:', error);
        alert(t('messages.renameSessionError'));
      } finally {
        setActiveRename(null);
      }
    },
    [onRefresh, setActiveRename, t],
  );

  /**
   * Branches a session and opens the copy.
   *
   * The new row arrives over the websocket as a `session_upserted`, so nothing
   * is refetched here — the sidebar already has it by the time this navigates.
   */
  const forkSession = useCallback(
    async (session: SessionWithProvider) => {
      try {
        const response = await api.forkSession(session.id);
        const payload = await response.json();
        const forkedSessionId = payload?.data?.sessionId;
        if (!response.ok || typeof forkedSessionId !== 'string') {
          throw new Error(payload?.message || `HTTP ${response.status}`);
        }

        onSessionSelect({
          id: forkedSessionId,
          summary: payload.data.sessionName,
          __provider: session.__provider,
          __projectId: session.__projectId,
        } as ProjectSession);
      } catch (error) {
        console.error('[Sidebar] Error forking session:', error);
        alert(t('messages.forkSessionError'));
      }
    },
    [onSessionSelect, t],
  );

  const startEditingSession = useCallback(
    (projectId: string, sessionId: string, initialName: string) => {
      setActiveRename({ target: 'session', id: sessionId, projectId, draft: initialName });
    },
    [setActiveRename],
  );

  const showDeleteSessionConfirmation = useCallback(    (
      sessionId: string,
      sessionTitle: string,
      options: { isArchived?: boolean } = {},
    ) => {
      setPendingDeletion({
        kind: 'session',
        sessionId,
        sessionTitle,
        isArchived: Boolean(options.isArchived),
      });
    },
    [setPendingDeletion],
  );

  const confirmDeleteSession = useCallback(async (hardDelete = false) => {
    if (pendingDeletion?.kind !== 'session') {
      return;
    }

    const { sessionId } = pendingDeletion;
    setPendingDeletion(null);

    try {
      const response = await api.deleteSession(sessionId, hardDelete);

      if (response.ok) {
        onSessionDelete?.(sessionId);
        // Same gap as rename: nothing refetched the recents feed, so the row the
        // user just archived stayed in the list. Archiving keeps the session, so
        // only the non-archived total moves.
        setRecentConversations((previous) => {
          const remaining = previous.filter((conversation) => conversation.sessionId !== sessionId);
          if (remaining.length !== previous.length) {
            setRecentConversationsTotal((total) => Math.max(0, total - 1));
          }
          return remaining;
        });
        await fetchArchivedSessions();
      } else {
        const errorText = await response.text();
        console.error('[Sidebar] Failed to delete session:', {
          status: response.status,
          error: errorText,
        });
        alert(t('messages.deleteSessionFailed'));
      }
    } catch (error) {
      console.error('[Sidebar] Error deleting session:', error);
      alert(t('messages.deleteSessionError'));
    }
  }, [fetchArchivedSessions, onSessionDelete, pendingDeletion, setPendingDeletion, t]);

  return {
    archivedProjects,
    archivedSessions,
    filteredArchivedProjects,
    filteredArchivedSessions,
    isArchivedSessionsLoading,
    recentConversations,
    recentConversationsTotal,
    recentConversationsHasMore,
    isRecentConversationsLoading,
    isLoadingMoreRecentConversations,
    recentConversationsError,
    reloadRecentConversations,
    loadMoreRecentConversations,
    handleSessionClick,
    openArchivedSession,
    restoreArchivedProject,
    restoreArchivedSession,
    refreshProjects,
    updateSessionSummary,
    forkSession,
    startEditingSession,
    showDeleteSessionConfirmation,
    confirmDeleteSession,
  };
}

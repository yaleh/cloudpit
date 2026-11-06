import { useCallback, useEffect, useRef, useState } from 'react';

import { api } from '@/shared/api';
import type {
  ConversationProjectResult,
  ConversationSearchResults,
  SearchProgress,
  SessionTitleSearchResult,
  SidebarSearchMode,
} from '@/shared/types';

type UseSidebarConversationSearchArgs = {
  searchMode: SidebarSearchMode;
  debouncedSearchQuery: string;
};

/**
 * The Conversations tab's server-side search: it streams project results over
 * one EventSource and exposes the accumulated rows, progress and a cancel
 * command. Consumed by `useSidebarController`, which composes it with the
 * project and session concerns into one public surface.
 */
export function useSidebarConversationSearch({
  searchMode,
  debouncedSearchQuery,
}: UseSidebarConversationSearchArgs) {
  // The accumulated conversation search rows for the current query.
  const [conversationResults, setConversationResults] = useState<ConversationSearchResults | null>(null);
  // Whether the search EventSource is open and no `done`/`error` has arrived yet.
  const [isSearching, setIsSearching] = useState(false);
  // How many projects the in-flight search has scanned, for the progress line.
  const [searchProgress, setSearchProgress] = useState<SearchProgress | null>(null);
  // Monotonic request id; a stale handler that observes a newer id closes itself.
  const searchSeqRef = useRef(0);
  // The live EventSource for the current query, so a mode/query change can close it.
  const eventSourceRef = useRef<EventSource | null>(null);

  // Debounced conversation search with SSE streaming
  useEffect(() => {
    if (eventSourceRef.current) {
      eventSourceRef.current.close();
      eventSourceRef.current = null;
    }

    const query = debouncedSearchQuery;
    if (searchMode !== 'conversations' || query.length < 2) {
      searchSeqRef.current += 1;
      setConversationResults(null);
      setSearchProgress(null);
      setIsSearching(false);
      return;
    }

    setIsSearching(true);
    setConversationResults(null);
    setSearchProgress(null);
    const seq = ++searchSeqRef.current;

    if (seq !== searchSeqRef.current) {
      return;
    }

    const url = api.searchConversationsUrl(query);
    const es = new EventSource(url);
    eventSourceRef.current = es;

    const accumulated: ConversationProjectResult[] = [];
    let titleResults: SessionTitleSearchResult[] = [];
    let totalMatches = 0;

    // One terminal transition shared by the `done` and `error` events: either way the
    // stream is over, so release the EventSource and publish the accumulated rows.
    const finishSearch = () => {
      es.close();
      eventSourceRef.current = null;
      setIsSearching(false);
      setSearchProgress(null);
      setConversationResults({
        results: [...accumulated],
        titleResults: [...titleResults],
        totalMatches,
        query,
      });
    };

    es.addEventListener('title-results', (evt) => {
      if (seq !== searchSeqRef.current) { es.close(); return; }
      try {
        const data = JSON.parse(evt.data) as { titleResults: SessionTitleSearchResult[] };
        titleResults = Array.isArray(data.titleResults) ? data.titleResults : [];
        setConversationResults({
          results: [...accumulated],
          titleResults: [...titleResults],
          totalMatches,
          query,
        });
      } catch {
        // Ignore malformed SSE data
      }
    });

    es.addEventListener('result', (evt) => {
      if (seq !== searchSeqRef.current) { es.close(); return; }
      try {
        const data = JSON.parse(evt.data) as {
          projectResult: ConversationProjectResult;
          totalMatches: number;
          scannedProjects: number;
          totalProjects: number;
        };
        accumulated.push(data.projectResult);
        totalMatches = data.totalMatches;
        setConversationResults({
          results: [...accumulated],
          titleResults: [...titleResults],
          totalMatches,
          query,
        });
        setSearchProgress({ scannedProjects: data.scannedProjects, totalProjects: data.totalProjects });
      } catch {
        // Ignore malformed SSE data
      }
    });

    es.addEventListener('progress', (evt) => {
      if (seq !== searchSeqRef.current) { es.close(); return; }
      try {
        const data = JSON.parse(evt.data) as { totalMatches: number; scannedProjects: number; totalProjects: number };
        totalMatches = data.totalMatches;
        setSearchProgress({ scannedProjects: data.scannedProjects, totalProjects: data.totalProjects });
      } catch {
        // Ignore malformed SSE data
      }
    });

    es.addEventListener('done', () => {
      if (seq !== searchSeqRef.current) { es.close(); return; }
      finishSearch();
    });

    es.addEventListener('error', () => {
      if (seq !== searchSeqRef.current) { es.close(); return; }
      finishSearch();
    });

    return () => {
      if (eventSourceRef.current) {
        eventSourceRef.current.close();
        eventSourceRef.current = null;
      }
    };
  }, [debouncedSearchQuery, searchMode]);

  const clearConversationResults = useCallback(() => {
    searchSeqRef.current += 1;
    if (eventSourceRef.current) {
      eventSourceRef.current.close();
      eventSourceRef.current = null;
    }
    setIsSearching(false);
    setSearchProgress(null);
    setConversationResults(null);
  }, []);

  return {
    conversationResults,
    isSearching,
    searchProgress,
    clearConversationResults,
  };
}

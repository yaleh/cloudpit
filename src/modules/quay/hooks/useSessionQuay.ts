import { useEffect, useRef, useState } from 'react';

import { api } from '@/shared/api';
import type {
  QuaySessionMentionsReading,
  SessionTaskChainReading,
} from '@/shared/types';

/**
 * The Quay tab's session column reading: what this conversation mentioned, and which tasks it
 * started. Both are read on the same cadence and fail independently — a failed mention list must
 * never blank the task-chain block, and vice versa.
 *
 * The hook lives with its React state rather than behind a React-free controller because the
 * surrounding quay hooks (`useSessionPulse`, `useSessionMentions`) keep their read loops here
 * too; it decides nothing about the data beyond when to fetch and which reply is current.
 */

/** The poll interval, aligned with the lanes/mention TTL used elsewhere in the module. */
export const SESSION_QUAY_POLL_INTERVAL_MS = 30_000;

export type SessionMentionsReadingState =
  | { status: 'idle' }
  | { status: 'loading' }
  | { status: 'error'; message: string }
  | { status: 'loaded'; reading: QuaySessionMentionsReading };

/**
 * The task-chain block's state. `unavailable` is its own reading: `503`/`404` means the
 * endpoint or the project/session is not available, and the panel hides only this block and
 * states why — it is not the same as a transient read error.
 */
export type SessionTaskChainReadingState =
  | { status: 'idle' }
  | { status: 'loading' }
  | { status: 'unavailable'; reason: string }
  | { status: 'error'; message: string }
  | { status: 'loaded'; reading: SessionTaskChainReading };

type UseSessionQuayResult = {
  mentions: SessionMentionsReadingState;
  taskChain: SessionTaskChainReadingState;
};

/**
 * Reads one session's quay readings: once on mount (the Quay tab becoming active), then every
 * 30 seconds, pausing while the page is hidden and catching up when it becomes visible again.
 *
 * `refreshSignal` is an externally driven re-read trigger (the panel's Refresh button bumps it).
 * Every effect run owns a request id, so switching session/project — or asking again before a
 * slow reply lands — discards the older reply instead of letting it overwrite the current one.
 */
export function useSessionQuay(
  projectId: string | null,
  sessionId: string | null,
  enabled: boolean,
  refreshSignal = 0,
): UseSessionQuayResult {
  const [mentions, setMentions] = useState<SessionMentionsReadingState>({ status: 'idle' });
  const [taskChain, setTaskChain] = useState<SessionTaskChainReadingState>({ status: 'idle' });
  // Monotonic across effect runs; a reply tagged with a stale id is dropped.
  const runIdRef = useRef(0);

  useEffect(() => {
    if (!enabled || !projectId || !sessionId) {
      setMentions({ status: 'idle' });
      setTaskChain({ status: 'idle' });
      return;
    }

    const runId = (runIdRef.current += 1);
    let disposed = false;
    let timer: ReturnType<typeof setTimeout> | null = null;

    const isCurrent = () => !disposed && runIdRef.current === runId;

    const loadMentions = async () => {
      try {
        const response = await api.quaySessionMentions(projectId, sessionId);
        if (!isCurrent()) {
          return;
        }
        if (!response.ok) {
          setMentions({ status: 'error', message: `Failed to load session mentions (HTTP ${response.status})` });
          return;
        }
        const reading = (await response.json()) as QuaySessionMentionsReading;
        if (!isCurrent()) {
          return;
        }
        setMentions({ status: 'loaded', reading });
      } catch (error) {
        if (!isCurrent()) {
          return;
        }
        setMentions({
          status: 'error',
          message: error instanceof Error ? error.message : 'Failed to load session mentions',
        });
      }
    };

    const loadTaskChain = async () => {
      try {
        const response = await api.quaySessionTaskChain(projectId, sessionId);
        if (!isCurrent()) {
          return;
        }
        if (!response.ok) {
          if (response.status === 503 || response.status === 404) {
            setTaskChain({ status: 'unavailable', reason: `HTTP ${response.status}` });
            return;
          }
          setTaskChain({ status: 'error', message: `Failed to load the session task chain (HTTP ${response.status})` });
          return;
        }
        const reading = (await response.json()) as SessionTaskChainReading;
        if (!isCurrent()) {
          return;
        }
        setTaskChain({ status: 'loaded', reading });
      } catch (error) {
        if (!isCurrent()) {
          return;
        }
        setTaskChain({
          status: 'error',
          message: error instanceof Error ? error.message : 'Failed to load the session task chain',
        });
      }
    };

    const loadAll = () => {
      void loadMentions();
      void loadTaskChain();
    };

    // A session/project switch (or a manual refresh) is a NEW reading: clear the previous
    // session's rows rather than drawing them under the new session's heading.
    setMentions({ status: 'loading' });
    setTaskChain({ status: 'loading' });
    loadAll();

    const schedule = () => {
      timer = setTimeout(() => {
        // A hidden tab must not keep spawning quay CLI reads. The visibility listener performs
        // the catch-up read instead, so no reading is simply skipped.
        if (typeof document === 'undefined' || document.visibilityState !== 'hidden') {
          loadAll();
        }
        schedule();
      }, SESSION_QUAY_POLL_INTERVAL_MS);
    };
    schedule();

    const handleVisibilityChange = () => {
      if (typeof document !== 'undefined' && document.visibilityState === 'visible') {
        loadAll();
        if (timer !== null) {
          clearTimeout(timer);
        }
        schedule();
      }
    };
    if (typeof document !== 'undefined') {
      document.addEventListener('visibilitychange', handleVisibilityChange);
    }

    return () => {
      disposed = true;
      // Invalidate anything still in flight for this effect run.
      runIdRef.current += 1;
      if (timer !== null) {
        clearTimeout(timer);
      }
      if (typeof document !== 'undefined') {
        document.removeEventListener('visibilitychange', handleVisibilityChange);
      }
    };
  }, [enabled, projectId, refreshSignal, sessionId]);

  return { mentions, taskChain };
}

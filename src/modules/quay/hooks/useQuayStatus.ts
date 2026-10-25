import { useCallback, useEffect, useRef, useState } from 'react';

import { api } from '@/shared/api';
import type { QuaySnapshot } from '@/shared/types';

/**
 * The four states `QuayPanel` renders. Kept as a discriminated union so the
 * panel can never show a snapshot and an error at once.
 */
export type QuayPanelView =
  | { status: 'not-configured' }
  | { status: 'loading' }
  | { status: 'error'; message: string }
  | { status: 'loaded'; snapshot: QuaySnapshot };

type UseQuayStatusResult = {
  view: QuayPanelView;
  /** Re-fetches the snapshot, bypassing the backend's TTL cache. */
  refresh: () => void;
  /** The Loop pulse time window currently selected, in hours. */
  windowHours: number;
  /**
   * Requests a different Loop pulse window. The window is a *data* filter, so this re-reads
   * rather than rescaling what is already on screen: the interval set for 12h genuinely
   * contains runs a 1h window never read. The re-read happens IN PLACE — the view stays
   * `loaded` and the gantt card keeps its selector — so a window switch never blanks the
   * panel or drops the very control that triggered it.
   */
  setWindowHours: (hours: number) => void;
  /** True while a window change is being re-read; the panel stays loaded and its card shows it. */
  ganttRefreshing: boolean;
};

/** The Loop pulse windows the card offers, mirroring the backend's closed set. */
const WINDOW_HOURS = [1, 3, 6, 12] as const;
const DEFAULT_WINDOW_HOURS = 3;

/**
 * localStorage key prefix for `quay-tab-window:<projectId>` (one value per project).
 *
 * This is deliberately a DIFFERENT key from the title-bar popover's
 * `quay-pulse-window:<projectId>`: the two surfaces are separate settings, and changing one
 * must not move the other.
 */
const TAB_WINDOW_STORAGE_PREFIX = 'quay-tab-window:';

/**
 * Coerces a persisted/requested window to one the card offers, falling back to the default.
 * The set is closed for the same reason the backend closes it: the window drives how far back
 * the read goes, and the card has a button for exactly these four values — anything else (a
 * `5` written into localStorage, an old URL param) reads as "not a window I offer".
 */
function normalizeWindowHours(value: unknown): number {
  const parsed = typeof value === 'string' ? Number(value) : value;
  if (typeof parsed !== 'number' || !Number.isFinite(parsed)) {
    return DEFAULT_WINDOW_HOURS;
  }
  return (WINDOW_HOURS as readonly number[]).includes(parsed) ? parsed : DEFAULT_WINDOW_HOURS;
}

/** Reads one project's persisted window; an absent, unreadable or illegal value reads as 3. */
function readWindowHours(projectId: string | null): number {
  if (projectId === null || typeof window === 'undefined') {
    return DEFAULT_WINDOW_HOURS;
  }
  try {
    return normalizeWindowHours(
      window.localStorage.getItem(`${TAB_WINDOW_STORAGE_PREFIX}${projectId}`),
    );
  } catch {
    // A browser that denies localStorage must not take the panel down: the window simply does
    // not persist, and the default is still a valid reading.
    return DEFAULT_WINDOW_HOURS;
  }
}

/**
 * Persists one project's selected window. localStorage only — the Quay tab no longer reads or
 * writes a `quayWindow` URL parameter, so an old `?quayWindow=6` link is ignored and choosing a
 * window leaves the address bar unchanged.
 */
function persistWindowHours(projectId: string | null, hours: number): void {
  if (projectId === null || typeof window === 'undefined') {
    return;
  }
  try {
    window.localStorage.setItem(`${TAB_WINDOW_STORAGE_PREFIX}${projectId}`, String(hours));
  } catch {
    // Same as the read path: persistence is a convenience, not a premise.
  }
}

/**
 * Loads one project's Tier-2 quay snapshot for `QuayPanel`.
 *
 * The fetch only runs while the Quay tab is active and the project actually has
 * a `.quay/config.yml`; both conditions are the caller's gate against spawning
 * the quay CLI for a project that never opted in. Responses are tagged with a
 * request id so a slow reply for a previously selected project cannot overwrite
 * the current one's view.
 */
export function useQuayStatus(
  projectId: string | null,
  hasQuayConfig: boolean,
  isActive: boolean,
): UseQuayStatusResult {
  const [fetchedView, setFetchedView] = useState<QuayPanelView>({ status: 'loading' });
  // The selected window is per-project: the initial read uses the project this hook mounted
  // with, and the effect below re-reads each newly selected project's OWN value rather than
  // carrying the previous project's window across.
  const [windowHours, setWindowHoursState] = useState<number>(() => readWindowHours(projectId));
  // The window lives in a ref as well as state so the mount effect can read the persisted
  // value WITHOUT taking `windowHours` as a dependency: a dependency there would re-enter the
  // loading path on every window change, which is exactly the unmounting this hook fixes.
  const [ganttRefreshing, setGanttRefreshing] = useState(false);
  const windowHoursRef = useRef(windowHours);
  windowHoursRef.current = windowHours;
  const projectIdRef = useRef(projectId);
  const requestIdRef = useRef(0);

  // Re-read the window when the project changes. Declared BEFORE the load effect so the ref it
  // writes is already the new project's value when that effect runs in the same commit.
  useEffect(() => {
    if (projectIdRef.current === projectId) {
      return;
    }
    projectIdRef.current = projectId;
    const next = readWindowHours(projectId);
    windowHoursRef.current = next;
    setWindowHoursState(next);
  }, [projectId]);

  /**
   * Loads the snapshot at `hours`. `keepLoaded` is the whole distinction between the two
   * callers: a project switch or a manual refresh may show the loading branch, while a window
   * change must keep the loaded panel (and the gantt card's selector) mounted and only mark
   * the card busy — the window is one card's data filter, not a reason to blank the panel.
   */
  const load = useCallback(async (refresh: boolean, hours: number, keepLoaded: boolean) => {
    if (!projectId) {
      return;
    }

    const requestId = (requestIdRef.current += 1);
    if (keepLoaded) {
      setGanttRefreshing(true);
    } else {
      setFetchedView({ status: 'loading' });
    }

    try {
      const response = await api.quaySnapshot(projectId, { refresh, hours });
      if (requestIdRef.current !== requestId) {
        return;
      }

      if (!response.ok) {
        setFetchedView({ status: 'error', message: `Failed to load quay status (HTTP ${response.status})` });
        return;
      }

      const snapshot = (await response.json()) as QuaySnapshot;
      if (requestIdRef.current !== requestId) {
        return;
      }

      setFetchedView({ status: 'loaded', snapshot });
    } catch (error) {
      if (requestIdRef.current !== requestId) {
        return;
      }
      setFetchedView({ status: 'error', message: error instanceof Error ? error.message : 'Failed to load quay status' });
    } finally {
      // Only the newest request clears the busy marker; a superseded one must not hide the
      // marker the request that replaced it is still showing.
      if (keepLoaded && requestIdRef.current === requestId) {
        setGanttRefreshing(false);
      }
    }
  }, [projectId]);

  useEffect(() => {
    if (!projectId || !hasQuayConfig || !isActive) {
      return;
    }

    void load(false, windowHoursRef.current, false);
  }, [projectId, hasQuayConfig, isActive, load]);

  const refresh = useCallback(() => {
    void load(true, windowHoursRef.current, false);
  }, [load]);

  const setWindowHours = useCallback((hours: number) => {
    const normalized = normalizeWindowHours(hours);
    setWindowHoursState(normalized);
    windowHoursRef.current = normalized;
    persistWindowHours(projectId, normalized);
    void load(false, normalized, true);
  }, [load, projectId]);

  // The not-configured reading is derived during render rather than pushed into
  // state, so a project without quay never even transiently shows a stale snapshot.
  const view: QuayPanelView = (!projectId || !hasQuayConfig)
    ? { status: 'not-configured' }
    : fetchedView;

  return { view, refresh, windowHours, setWindowHours, ganttRefreshing };
}

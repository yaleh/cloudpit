import { useCallback, useEffect, useMemo, useRef, useState } from 'react';

import { authenticatedFetch } from '@/shared/api';
import { useWebSocketOptional } from '@/shared/context/WebSocketContext';
import {
  OBSERVATION_BASE,
  observationPinnedUris,
  primeObservationPins,
  setObservationWatch,
  toggleObservationPin,
  useObservationPin,
} from '@/modules/cockpit/contract';

/**
 * The observation wall's client half.
 *
 * The server (`/api/observation`) owns the model: every observed object, its revision log, the
 * per-user seen cursor, the watch list, the block cap and the producer liveness reading. This
 * module is a thin reader/writer over those four routes plus ONE piece of shared browser state —
 * the pin cache — so a sidebar row and a wall tile cannot disagree about whether an object is
 * pinned without a second source of truth.
 *
 * WHY `authenticatedFetch` AND NOT `api.*`: the shared API client is a big module with one
 * method per endpoint; adding observation methods there would widen a file this task does not
 * own, and the observation module is meant to stay a leaf. The exported helper carries the auth
 * token and the refresh/expiry handling, which is the only part worth reusing.
 *
 * PUSH IS AN OPTIMISATION, NOT THE CONTRACT. The store publishes `observation.update` frames
 * over the cockpit hub's socket. This hook subscribes and re-reads the wall so a change made on
 * another device appears here without a reload; every read still works when the socket is down,
 * because the wall is fetched over HTTP on mount and on demand.
 */

/** The four-state reading every observed object and producer carries. */
export type ObservationStatusState = 'ok' | 'attention' | 'red' | 'unevaluated';

/** The object kinds the observation layer models. */
export type ObservationKind = 'session' | 'project' | 'architecture';

export type ObservedStatus = {
  state: ObservationStatusState;
  /** Required by the store for `unevaluated`; non-null exactly when the state is not `ok`. */
  reason?: string;
};

export type ObservedProvenance = {
  producer: string;
  tier: 'deterministic' | 'llm';
  evaluatedAt: number;
};

export type ObservedObject = {
  uri: string;
  kind: ObservationKind;
  title: string;
  status: ObservedStatus;
  digest: Record<string, unknown>;
  /**
   * What this projection cannot see: the kind's defaults plus any producer additions, always
   * non-empty. The preview renders it; a tile never does.
   */
  blindSpots: string[];
  revision: number;
  updatedAt: number;
  provenance: ObservedProvenance;
};

export type ObservationWallEntry = {
  object: ObservedObject;
  pinned: boolean;
  seenRevision: number;
  deltaItems: string[];
};

/** One producer's liveness reading, as the server resolved it at read time. */
export type ObservationProducerReading = {
  producer: string;
  state: ObservationStatusState;
  stale: boolean;
  reason: string | null;
  lastAttemptAt: number | null;
  lastWriteAt: number | null;
  expectedIntervalMs: number;
};

export type ObservationWall = {
  entries: ObservationWallEntry[];
  collapsedCount: number;
  producers: ObservationProducerReading[];
  self: { title: string; state: string; reason: string } | null;
};

/** One observation-layer liveness problem, derived from `producers[]` (never from `self`). */
export type ObservationSelfReading = {
  /** Every producer that is not `ok`, in the order the server sorted them (non-ok first). */
  offenders: ObservationProducerReading[];
  state: 'attention' | 'red' | 'unevaluated';
  reason: string;
  /** The most recent attempt across all producers, or null when none has ever run. */
  lastRunAt: number | null;
};

/** The wall as the page reads it: a discriminated union, so a failed read is never drawn empty. */
export type ObservationWallView =
  | { status: 'loading' }
  | { status: 'loaded'; wall: ObservationWall }
  | { status: 'error'; message: string };

function messageFrom(error: unknown): string {
  return error instanceof Error ? error.message : 'Failed to read the observation wall';
}

async function readJson<T>(path: string): Promise<T> {
  const response = await authenticatedFetch(`${OBSERVATION_BASE}${path}`);
  if (!response.ok) throw new Error(`HTTP ${response.status}`);
  return (await response.json()) as T;
}

/** `GET /api/observation/wall` — the object list, the folded count and producer liveness. */
export async function fetchObservationWall(): Promise<ObservationWall> {
  return readJson<ObservationWall>('/wall');
}

/** `POST /api/observation/seen` — advances the cross-device cursor for one object. */
export async function markObservationSeen(uri: string, revision: number): Promise<void> {
  const response = await authenticatedFetch(`${OBSERVATION_BASE}/seen`, {
    method: 'POST',
    body: JSON.stringify({ uri, revision }),
  });
  if (!response.ok) throw new Error(`HTTP ${response.status}`);
}

/**
 * The layer's own reading, derived from `producers[]`.
 *
 * THE UI DERIVES IT RATHER THAN TRUSTING `wall.self`. The store sends both, and the tile must
 * appear exactly when a producer is not `ok`; deriving the tile from the same array the wall
 * renders means one stub (`producers: [{state: 'attention', stale: true, …}]`) is enough to
 * exercise it, and there is no second rule that can disagree with the row it is drawn beside.
 */
export function deriveSelfReading(
  producers: readonly ObservationProducerReading[],
): ObservationSelfReading | null {
  const offenders = producers.filter((producer) => producer.state !== 'ok');
  if (offenders.length === 0) return null;
  const state: ObservationSelfReading['state'] = offenders.some((producer) => producer.state === 'red')
    ? 'red'
    : offenders.some((producer) => producer.state === 'unevaluated')
      ? 'unevaluated'
      : 'attention';
  const lastRunAt = producers.reduce<number | null>((latest, producer) => {
    const candidate = producer.lastAttemptAt ?? producer.lastWriteAt;
    if (candidate === null) return latest;
    return latest === null ? candidate : Math.max(latest, candidate);
  }, null);
  return {
    offenders,
    state,
    reason: offenders
      .map((producer) => `${producer.producer}: ${producer.state}${producer.reason === null ? '' : ` (${producer.reason})`}`)
      .join('; '),
    lastRunAt,
  };
}

// The pin cache lives in the cockpit's leaf contract (contract/observationPin) so the sidebar
// rows and the wall button read one store without importing this package's barrel. Re-exported
// here because the cockpit's page and barrel already import these from this module.
export {
  observationPinnedUris,
  setObservationWatch,
  toggleObservationPin,
  useObservationPin,
};

// ── The wall hook ───────────────────────────────────────────────────────────

export type ObservationWallConnection = {
  view: ObservationWallView;
  /** Re-reads the wall, bypassing nothing (the route is not cached). */
  reload: () => Promise<void>;
  /**
   * Advances the cursor locally after a successful `POST seen`: the object's deltas clear now,
   * on every device, because the cursor is the server's.
   */
  applySeen: (uri: string, revision: number) => void;
};

/** The `observation.update` frame the store pushes over the cockpit hub's socket. */
function isObservationFrame(frame: unknown): boolean {
  return (
    frame !== null &&
    typeof frame === 'object' &&
    (frame as { kind?: unknown }).kind === 'observation.update'
  );
}

/** Reads the wall on mount and re-reads it whenever an observation frame arrives. */
export function useObservationWall(): ObservationWallConnection {
  const [view, setView] = useState<ObservationWallView>({ status: 'loading' });
  const socket = useWebSocketOptional();
  // A read that resolves after the component unmounted must not set state.
  const mountedRef = useRef(true);
  useEffect(() => {
    mountedRef.current = true;
    return () => {
      mountedRef.current = false;
    };
  }, []);

  const reload = useCallback(async () => {
    try {
      const wall = await fetchObservationWall();
      if (!mountedRef.current) return;
      primeObservationPins(wall);
      setView({ status: 'loaded', wall });
    } catch (error) {
      if (!mountedRef.current) return;
      setView({ status: 'error', message: messageFrom(error) });
    }
  }, []);

  useEffect(() => {
    void reload();
  }, [reload]);

  useEffect(() => {
    if (socket === null) return undefined;
    return socket.subscribe((frame) => {
      if (isObservationFrame(frame)) void reload();
    });
  }, [reload, socket]);

  const applySeen = useCallback((uri: string, revision: number) => {
    setView((current) => {
      if (current.status !== 'loaded') return current;
      const entries = current.wall.entries.map((entry) =>
        entry.object.uri === uri
          ? {
              ...entry,
              seenRevision: Math.max(entry.seenRevision, revision),
              // The store's delta is "revisions after the cursor"; advancing the cursor to the
              // object's own revision clears them all.
              deltaItems: entry.object.revision <= revision ? [] : entry.deltaItems,
            }
          : entry,
      );
      return { status: 'loaded', wall: { ...current.wall, entries } };
    });
  }, []);

  return useMemo(() => ({ view, reload, applySeen }), [applySeen, reload, view]);
}

/** The most recent producer attempt, used by the page header's quiet "last updated" line. */
export function latestProducerRunAt(wall: ObservationWall | null): number | null {
  if (wall === null) return null;
  return wall.producers.reduce<number | null>((latest, producer) => {
    const candidate = producer.lastAttemptAt ?? producer.lastWriteAt;
    if (candidate === null) return latest;
    return latest === null ? candidate : Math.max(latest, candidate);
  }, null);
}

import { useCallback, useState, useSyncExternalStore } from 'react';
import { useTranslation } from 'react-i18next';

import { authenticatedFetch } from '@/shared/api';
import { cn, createExternalStore } from '@/shared/utils';

/**
 * The observation pin surface: the one shared pin cache, the hook a row reads it through, and
 * the star button both the sidebar rows and the wall tiles render.
 *
 * WHY THIS IS A LEAF CONTRACT. The sidebar's project and session rows render `WatchPinToggle`
 * and mount `useObservationPin`; the cockpit wall mounts the same button so a pin toggled in
 * the sidebar and a pin toggled on the wall cannot disagree. Reaching those through
 * `@/modules/cockpit` would put the sidebar and the cockpit in one package cycle (the cockpit
 * imports the sidebar's mode switch). This module is the leaf both sides import: it depends on
 * `src/shared` and React only, never on another feature module.
 */

/** The base of the observation routes this module reads/writes. */
export const OBSERVATION_BASE = '/api/observation';

/** `PUT | DELETE /api/observation/watch/:uri` — pins or unpins one object. */
export async function setObservationWatch(uri: string, watched: boolean): Promise<void> {
  const response = await authenticatedFetch(
    `${OBSERVATION_BASE}/watch/${encodeURIComponent(uri)}`,
    { method: watched ? 'PUT' : 'DELETE' },
  );
  if (!response.ok) throw new Error(`HTTP ${response.status}`);
}

// ── The shared pin cache ─────────────────────────────────────────────────────
//
// A sidebar row and a wall tile both render "pinned / not pinned" for the same URI. Two
// independent reads would be two truths; a module-level cache is the one truth, written by the
// wall read and by every successful toggle, and subscribed to by `useObservationPin`.
//
// It is deliberately a CACHE, not a fetcher: a row mounts in a sidebar that knows nothing about
// the observation API, and mounting must not fire an HTTP request per row. The cache is filled
// by the cockpit's wall read (which the person opens to use the wall at all) and by writes the
// person performs here.

/**
 * The one pinned-URI set every sidebar row and wall tile reads. Replaced with a
 * new set on every change so a reader's snapshot identity tracks the change.
 */
const pinStore = createExternalStore<ReadonlySet<string>>(new Set());

function publishPins(next: ReadonlySet<string>): void {
  pinStore.set(next);
}

/**
 * The part of a wall read this module needs: each entry's object URI and whether it is pinned.
 * Stated structurally so the contract does not import the wall hook's types (that would point
 * the contract at the cockpit package again).
 */
export type PinnableWall = {
  entries: readonly { pinned: boolean; object: { uri: string } }[];
};

/** Replaces the cache from a wall read. Consumers not mentioned by the read are left alone. */
export function primeObservationPins(wall: PinnableWall): void {
  // Only the entries the server returned are known; a pinned object that did not fit the cap
  // is still pinned but is not in `entries`, so the read adds rather than replaces. An unpin
  // performed here is what removes an entry, and it publishes its own update.
  const next = new Set(pinStore.getSnapshot());
  for (const entry of wall.entries) {
    if (entry.pinned) next.add(entry.object.uri);
  }
  publishPins(next);
}

/** The pinned set as the last read/write left it. Exported for tests and the sidebar rows. */
export function observationPinnedUris(): ReadonlySet<string> {
  return pinStore.getSnapshot();
}

const subscribePins = pinStore.subscribe;

/** Pins or unpins one object and updates the shared cache on success. */
export async function toggleObservationPin(uri: string, watched: boolean): Promise<void> {
  await setObservationWatch(uri, watched);
  const next = new Set(pinStore.getSnapshot());
  if (watched) next.add(uri);
  else next.delete(uri);
  publishPins(next);
}

/** What a sidebar row sees for one URI. Rendering reads the cache; toggling writes it. */
export function useObservationPin(uri: string): {
  pinned: boolean;
  pending: boolean;
  toggle: () => Promise<void>;
} {
  const pinned = useSyncExternalStore(
    subscribePins,
    () => pinStore.getSnapshot().has(uri),
    () => false,
  );
  const [pending, setPending] = useState(false);
  const toggle = useCallback(async () => {
    setPending(true);
    try {
      await toggleObservationPin(uri, !pinStore.getSnapshot().has(uri));
    } finally {
      setPending(false);
    }
  }, [uri]);
  return { pinned, pending, toggle };
}

/**
 * The star button that pins one observed object. It reads the shared cache (so every row and
 * tile agree) and calls the same write the wall's row action calls.
 */
export function WatchPinToggle({
  uri,
  className,
  testId = 'observation-watch-toggle',
}: {
  uri: string;
  className?: string;
  testId?: string;
}) {
  const { t } = useTranslation();
  const { pinned, pending, toggle } = useObservationPin(uri);
  const label = pinned ? t('cockpit.observationUnpin') : t('cockpit.observationPin');
  return (
    <button
      type="button"
      onClick={(event) => {
        event.stopPropagation();
        void toggle();
      }}
      disabled={pending}
      title={label}
      aria-label={label}
      aria-pressed={pinned}
      className={cn(
        'flex min-h-11 min-w-11 items-center justify-center rounded text-xs text-muted-foreground',
        'hover:bg-accent disabled:opacity-50 sm:min-h-0 sm:min-w-0 sm:h-6 sm:w-6',
        className,
      )}
      data-testid={testId}
      data-observation-uri={uri}
      data-pinned={pinned ? 'true' : 'false'}
    >
      {/* A star is the same affordance the sidebar already uses for "keep this". */}
      <span aria-hidden>{pinned ? '★' : '☆'}</span>
    </button>
  );
}

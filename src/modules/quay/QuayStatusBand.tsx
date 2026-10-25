import { useTranslation } from 'react-i18next';

import type {
  QuayDriverState,
  QuayInFlightPhase,
  QuayLoopStatus,
  QuaySnapshot,
} from '@/shared/types';
import { QUAY_IN_FLIGHT_PHASE_META } from '@/shared/constants';
import { cn } from '@/shared/utils';

/**
 * The Quay tab's overall running-status band: one compact row above everything else.
 *
 * Consumed by `QuayPanel` only. Every reading comes from the snapshot; the band never spawns a
 * request of its own. It draws only marks the product already has (badge palette, phase colours,
 * relative-time text) and adds no new visual encoding.
 *
 * HONESTY RULES the band is built around:
 *
 * - `snapshot.loop` absent or `null` means the loop status was not read. The band then draws NO
 *   version, drain, orphan or pointer element and never says anything that reads as "normal".
 * - `not-evaluated` is a grey 「could not tell」, never folded into `current`.
 * - A drain flag that is `null` (unreadable) is not listed as either draining or running.
 * - An unread in-flight carrier (`null`) prints no count; `[]` is a real zero and does.
 */

/** The badge palette the panel header already uses for the same four driver readings. */
const DRIVER_CLASSES: Record<QuayDriverState, string> = {
  running: 'bg-green-50 text-green-700 dark:bg-green-950 dark:text-green-300',
  idle: 'bg-blue-50 text-blue-700 dark:bg-blue-950 dark:text-blue-300',
  stale: 'bg-amber-50 text-amber-700 dark:bg-amber-950 dark:text-amber-300',
  'not-configured': 'bg-gray-100 text-gray-600 dark:bg-gray-900 dark:text-gray-400',
  unavailable: 'bg-gray-100 text-gray-600 dark:bg-gray-900 dark:text-gray-400',
};

const DRIVER_LABEL_KEYS: Record<QuayDriverState, string> = {
  running: 'quayTab.driverRunning',
  idle: 'quayTab.driverIdle',
  stale: 'quayTab.driverStale',
  'not-configured': 'quayTab.driverNotConfigured',
  unavailable: 'quayTab.driverUnavailable',
};

/**
 * The literal Tailwind class for each phase dot, keyed by the palette name
 * `QUAY_IN_FLIGHT_PHASE_META` publishes. Literal strings (not `bg-${color}-500`) so Tailwind's
 * scanner actually emits them; `IN_FLIGHT_PHASE_META.color` stays the single source of the
 * colour name, and the test pins the two together.
 */
const PHASE_DOT_CLASSES: Record<string, string> = {
  blue: 'bg-blue-500',
  violet: 'bg-violet-500',
  amber: 'bg-amber-500',
  green: 'bg-green-500',
};

const DAY_MS = 86_400_000;

/** Relative time measured against an INJECTED instant, so a criterion reads a fixed clock. */
function relativeTo(iso: string, nowMs: number, locale: string): string {
  const at = Date.parse(iso);
  if (Number.isNaN(at)) {
    return '';
  }
  const seconds = Math.round((at - nowMs) / 1000);
  const steps: readonly [Intl.RelativeTimeFormatUnit, number][] = [
    ['year', 31_536_000],
    ['month', 2_592_000],
    ['day', 86_400],
    ['hour', 3_600],
    ['minute', 60],
    ['second', 1],
  ];
  const formatter = new Intl.RelativeTimeFormat(locale, { numeric: 'auto' });
  for (const [unit, size] of steps) {
    if (Math.abs(seconds) >= size || unit === 'second') {
      return formatter.format(Math.round(seconds / size), unit);
    }
  }
  return formatter.format(seconds, 'second');
}

/** The most recent heartbeat in the snapshot — driver record or any in-flight task. */
function latestHeartbeat(snapshot: QuaySnapshot): string | null {
  const candidates: string[] = [];
  if (snapshot.driver?.lastRecordAt) {
    candidates.push(snapshot.driver.lastRecordAt);
  }
  for (const task of snapshot.inFlight ?? []) {
    if (task.lastHeartbeat) {
      candidates.push(task.lastHeartbeat);
    }
  }
  let best: string | null = null;
  let bestMs = Number.NEGATIVE_INFINITY;
  for (const candidate of candidates) {
    const parsed = Date.parse(candidate);
    if (!Number.isNaN(parsed) && parsed > bestMs) {
      bestMs = parsed;
      best = candidate;
    }
  }
  return best;
}

/** The drain flags that read `true`, in the panel's own fixed driver order. */
function drainingDrivers(loop: QuayLoopStatus): Array<'worker' | 'promotion' | 'quality'> {
  return (['worker', 'promotion', 'quality'] as const).filter((kind) => loop.drain[kind] === true);
}

export type QuayStatusBandProps = {
  snapshot: QuaySnapshot;
  /**
   * The instant relative readings are taken against. Defaults to the snapshot's own
   * `generatedAt`, so the band's age readings are a property of the snapshot rather than of
   * when the component happened to render.
   */
  nowIso?: string;
  /** How old a heartbeat may read before it is marked stale. Matches the in-flight card. */
  staleAfterMs?: number;
};

/** The Quay tab's always-on running-status band. Consumed by `QuayPanel`. */
export function QuayStatusBand({
  snapshot,
  nowIso = snapshot.generatedAt,
  staleAfterMs = 300_000,
}: QuayStatusBandProps) {
  const { t, i18n } = useTranslation();
  // A caller that injects an unparseable clock still gets a usable reading; the fallback is the
  // wall clock, never `NaN` arithmetic.
  const parsedNow = Date.parse(nowIso);
  const nowMs = Number.isNaN(parsedNow) ? Date.now() : parsedNow;
  const driverState: QuayDriverState = snapshot.driver === null ? 'unavailable' : snapshot.driver.state;
  const loop = snapshot.loop ?? null;

  // `current` is a determinate reading, so it is drawn (subtly) when the loop WAS read. This is
  // what makes the honesty rule testable: a missing `loop` draws no kernel element at all, while
  // a future "default the missing reading to current" would draw this one and go red.
  const kernel = loop === null ? null : loop.kernel;
  const orphan = loop !== null && loop.orphan.state === 'marked' ? loop.orphan : null;
  const draining = loop === null ? [] : drainingDrivers(loop);
  const loopPointer = loop?.pointer ?? null;
  const pointer = loopPointer !== null
    && (loopPointer.state === 'behind' || loopPointer.state === 'ahead')
    ? loopPointer
    : null;

  // Phase counts from the in-flight carrier. `null` is "no reading": no count and no dots.
  const phaseCounts = new Map<QuayInFlightPhase, number>();
  for (const task of snapshot.inFlight ?? []) {
    phaseCounts.set(task.phase, (phaseCounts.get(task.phase) ?? 0) + 1);
  }

  const heartbeat = latestHeartbeat(snapshot);
  const heartbeatAgeMs = heartbeat === null || Number.isNaN(nowMs) ? null : nowMs - Date.parse(heartbeat);
  const heartbeatStale = heartbeatAgeMs !== null && heartbeatAgeMs > staleAfterMs;

  const suite = snapshot.tests.current;

  return (
    <div
      data-testid="quay-status-band"
      className="flex flex-wrap items-center gap-x-3 gap-y-1.5 rounded-lg border border-border/60 bg-muted/30 px-3 py-2 text-[11px] text-muted-foreground"
    >
      <span
        data-testid="quay-status-band-driver"
        data-state={driverState}
        className={cn('rounded-full px-2 py-0.5 text-[10px] font-medium uppercase tracking-wide', DRIVER_CLASSES[driverState])}
      >
        {t(DRIVER_LABEL_KEYS[driverState])}
      </span>

      {kernel !== null && (
        <span
          data-testid="quay-status-band-kernel"
          data-relation={kernel.relation}
          className={cn(
            'font-medium',
            kernel.relation === 'behind' || kernel.relation === 'ahead'
              ? 'text-amber-700 dark:text-amber-300'
              : kernel.relation === 'current'
                ? 'text-green-700 dark:text-green-300'
                : 'text-muted-foreground',
          )}
        >
          {kernel.relation === 'current' && t('quayTab.kernelCurrent', {
            loaded: kernel.loaded ?? '—',
            installed: kernel.installed ?? '—',
          })}
          {kernel.relation === 'behind' && t('quayTab.kernelBehind', {
            loaded: kernel.loaded ?? '—',
            installed: kernel.installed ?? '—',
          })}
          {kernel.relation === 'ahead' && t('quayTab.kernelAhead', {
            loaded: kernel.loaded ?? '—',
            installed: kernel.installed ?? '—',
          })}
          {kernel.relation === 'not-evaluated' && t('quayTab.kernelNotEvaluated')}
        </span>
      )}

      {orphan !== null && (
        <span
          data-testid="quay-status-band-orphan"
          data-state="marked"
          data-remove-after={orphan.removeAfter ?? undefined}
          className="font-medium text-amber-700 dark:text-amber-300"
        >
          {(() => {
            if (orphan.removeAfter === null) {
              return t('quayTab.orphanMarkedUnknown');
            }
            const removeAfterMs = Date.parse(orphan.removeAfter);
            if (Number.isNaN(removeAfterMs)) {
              return t('quayTab.orphanMarkedUnknown');
            }
            if (!Number.isNaN(nowMs) && nowMs >= removeAfterMs) {
              return t('quayTab.orphanExpired');
            }
            const days = Math.max(0, Math.ceil((removeAfterMs - nowMs) / DAY_MS));
            return t('quayTab.orphanMarked', { days });
          })()}
        </span>
      )}

      {draining.length > 0 && (
        <span data-testid="quay-status-band-drain" data-drivers={draining.join(',')} className="font-medium text-amber-700 dark:text-amber-300">
          {t('quayTab.draining', { drivers: draining.join(', ') })}
        </span>
      )}

      {pointer !== null && (
        <span data-testid="quay-status-band-pointer" data-state={pointer.state}>
          {t('quayTab.pointerDeviation', {
            state: pointer.state,
            link: pointer.linkVersion ?? '—',
            core: pointer.coreVersion ?? '—',
          })}
        </span>
      )}

      {snapshot.inFlight !== null && (
        <span data-testid="quay-status-band-inflight" data-count={snapshot.inFlight.length} className="flex items-center gap-1.5">
          <span>{t('quayTab.inFlightCount', { count: snapshot.inFlight.length })}</span>
          {(Object.keys(QUAY_IN_FLIGHT_PHASE_META) as QuayInFlightPhase[]).map((phase) => {
            const count = phaseCounts.get(phase) ?? 0;
            if (count === 0) {
              return null;
            }
            const meta = QUAY_IN_FLIGHT_PHASE_META[phase];
            return (
              <span
                key={phase}
                data-testid={`quay-status-band-phase-${phase}`}
                data-count={count}
                data-color={meta.color}
                title={meta.label}
                className="flex items-center gap-0.5"
              >
                <span className={cn('h-2 w-2 rounded-full', PHASE_DOT_CLASSES[meta.color] ?? 'bg-gray-400')} />
                <span>{count}</span>
              </span>
            );
          })}
        </span>
      )}

      {snapshot.tasks !== null && (
        <>
          <span data-testid="quay-status-band-needs-human" data-count={snapshot.tasks.needsHuman}>
            {t('quayTab.needsHumanCount', { count: snapshot.tasks.needsHuman })}
          </span>
          <span data-testid="quay-status-band-ready" data-count={snapshot.tasks.ready}>
            {t('quayTab.readyCount', { count: snapshot.tasks.ready })}
          </span>
        </>
      )}

      {suite !== null && (
        <span data-testid="quay-status-band-suite" data-state={suite.state}>
          {t('quayTab.suiteState', { state: suite.state })}
          {(() => {
            const whenIso = suite.finishedAt !== null
              ? new Date(suite.finishedAt * 1000).toISOString()
              : suite.startedAt;
            if (whenIso === null || Number.isNaN(nowMs)) {
              return null;
            }
            const when = relativeTo(whenIso, nowMs, i18n.language);
            return when.length === 0 ? null : ` · ${when}`;
          })()}
        </span>
      )}

      {heartbeat !== null && (
        <span
          data-testid="quay-status-band-heartbeat"
          data-heartbeat={heartbeat}
          data-stale={heartbeatStale ? 'true' : 'false'}
          className={cn(heartbeatStale && 'font-medium text-red-700 dark:text-red-300')}
        >
          {relativeTo(heartbeat, Number.isNaN(nowMs) ? Date.now() : nowMs, i18n.language)}
        </span>
      )}
    </div>
  );
}

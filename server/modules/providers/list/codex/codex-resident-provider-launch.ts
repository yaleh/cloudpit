/**
 * How one resident session's provider binding becomes an app-server spawn launch.
 *
 * WHY THIS IS ITS OWN FILE. `CodexHostDriver` keeps the process, the thread and
 * the turn state; the question "which command line does this host start with"
 * is a data transformation that only needs the session's launch bag and the
 * registry credential. Keeping it beside the driver pushed that file over the
 * architecture ratchet's committed line count for no structural gain, so the
 * transformation lives here — the same seam pattern as
 * `codex-resident-steer.ts` and `codex-resident-blocked-events.ts`.
 *
 * TWO CALL POINTS, ONE READING. `startResidentSession` compiles the provider id
 * recorded on the session row; `startHost` has to place the result on the host
 * id because `openHost` starts the process BEFORE it binds the session. Both
 * read the id from the same field (`modelProviderId`), so the two paths cannot
 * disagree about what a "bound session" is.
 *
 * A blank id is "no binding", not a provider named "": the driver then keeps
 * its unbound launch byte-for-byte, which is the negative control for the
 * injection.
 */
import type { CodexAppServerLaunch } from '@/modules/providers/list/codex/codex-app-server.connection.js';
import type {
  PendingResidentLaunch,
} from '@/modules/providers/list/codex/codex-host-driver.contract.js';
import { compileCodexProviderLaunch } from '@/modules/providers/list/codex/codex-provider-injection.js';
import type { AnyRecord, ProcessHost } from '@/shared/types.js';

/** The upstream provider id a resident launch bag records, or null. */
export function residentProviderIdFromLaunchOptions(options: AnyRecord): string | null {
  const value = options.modelProviderId;
  return typeof value === 'string' && value.trim() ? value.trim() : null;
}

/**
 * The process launch one resident session's host must be spawned with.
 *
 * Null is the unbound arm (the driver-wide launch, unchanged). A recorded id is
 * compiled into `-c` args plus the child environment's one credential; an id
 * the registry cannot resolve throws the readable
 * `CODEX_PROVIDER_NOT_CONFIGURED` error before any process starts, so a
 * restarted host never silently falls back to Codex's `openai`.
 */
export function residentLaunchForOptions(
  options: AnyRecord,
  driverLaunch: CodexAppServerLaunch,
): CodexAppServerLaunch | null {
  const providerId = residentProviderIdFromLaunchOptions(options);
  return providerId === null ? null : compileCodexProviderLaunch(providerId, driverLaunch);
}

/**
 * The launch this host's first binding carried, if the host was opened on demand.
 *
 * `openHost` registers the binding and then calls `startHost`, so this is the
 * only moment the pending launch is reachable: the request that it belongs to
 * (`bind`) runs afterwards, by which time the process — and its argv — already
 * exist.
 */
export function pendingLaunchForHost(
  host: ProcessHost,
  launches: ReadonlyMap<string, PendingResidentLaunch>,
): CodexAppServerLaunch | null {
  for (const appSessionId of host.bindings.keys()) {
    const launch = launches.get(appSessionId)?.launch;
    if (launch) {
      return launch;
    }
  }
  return null;
}

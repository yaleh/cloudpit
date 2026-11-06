/**
 * The navigation path's decision window, bounded — and left with room inside it for a replay.
 *
 * Both ways a case can ask for a fresh document use this one guard: `reloadPaneBounded` for
 * `page.reload()` and `openPaneBounded` for `page.goto(url)`. They are the same boot of the same
 * module graph; only the verb differs.
 *
 * WHY THIS MODULE EXISTS. The residual it closes read as an UNREPRODUCIBLE intermittent:
 * `.chat-messages-pane` timing out 30s after a `page.reload()`, `element(s) not found` — the same
 * signature the ledger's reds carry. It is not unreproducible, it is unbounded: the reloaded
 * document's boot requests can be held or interrupted past any window the case is willing to wait.
 * Before the guard a case had one way to spend its window — wait it out, and red — with no second
 * ask in it.
 *
 * WHY IT IS SHARED. The guard first landed in `voice-realtime-upload-fixture.spec.ts` (AC-315,
 * 2026-10-10) and was never carried to `voice-realtime-live-session-send.spec.ts`, whose two
 * historical reloads stayed bare and kept paying the same residual red (2026-10-21 04:02Z, same
 * `:767` signature). Two copies of a replay guard drift; one exported guard is the mechanism.
 *
 * WHAT A HOP WAITS FOR. A hop waits for the document's response to COMMIT (`waitUntil: 'commit'`), not for
 * `load`. The cold boot this pane needs continues after commit: on a loaded host the reloaded document still
 * had ~300 Vite dev module requests outstanding when the old 5s hop gave up inside its own navigation, so
 * waiting for `load` spent the hop's whole budget on a fact the landing probe reads better. Whether the pane
 * actually mounted is the landing probe's reading — one reader per fact.
 *
 * WHAT IT IS NOT. This is not a retry that hides a red. It only replaces the document when the
 * reload itself did not land — exactly what recovers from a document whose boot requests were held
 * or interrupted once — and a run that cannot land still ends HERE, by name, inside this guard's
 * own deadline, with the page's own text.
 */
import type { Page, Request } from '@playwright/test';

/**
 * How long ONE reload hop — the case's own reload and every replay of it alike — is given to COMMIT.
 *
 * `commit` is the earliest navigation milestone: the response has started and the document is being handed
 * over. It is the right bound for a hop, because the fact a hop can prove is that a fresh document arrived;
 * the pane's mount is the landing probe's reading, and the two are deliberately not confused.
 */
const PANE_RELOAD_HOP_MS = 10_000;
/** How long the FIRST hop's landing is given on its own, before the guard starts replaying. */
const PANE_FIRST_LANDING_MS = 30_000;
/** How long each REPLAY's landing is given. Shorter: a replay is a re-ask of a document already served once. */
const PANE_REPLAY_LANDING_MS = 15_000;
/**
 * The bound the replay budget is spent out of. A deadline rather than a replay count, because it is the SUM that
 * has to fit — spelled out, because this sum is the whole of why the guard can replay at all:
 *
 *   first hop        PANE_RELOAD_HOP_MS      = 10_000
 * + first landing    PANE_FIRST_LANDING_MS   = 30_000
 * + replay hop       PANE_RELOAD_HOP_MS      = 10_000
 * + replay landing   PANE_REPLAY_LANDING_MS  = 15_000
 *   ───────────────────────────────────────────────
 *   worst case                               = 65_000  ≤  PANE_RELOAD_DEADLINE_MS = 66_000
 *
 * The first landing is the order of this page's own cold-start budget — `CLIENT_WARM_DEADLINE_MS = 30_000` in
 * `e2e/voice-realtime-upload-fixture.spec.ts`, which is the same Vite module graph booted from the same cold
 * server. The value this replaces (4_000) sat below that boot under host load, so the guard interrupted a
 * landing that was still arriving and spent its replay on a shorter window.
 *
 * WHO LIVES INSIDE WHOSE BUDGET. The guard alone may spend `66_000`, beside the case's own work (pre-navigation
 * gestures, post-navigation assertions), so every calling spec raises its per-test budget to `150_000` in its
 * `test.describe.configure` — a guard that outlived its own test would report Playwright's `Test timeout`,
 * which names no landing. Healthy runs never approach either bound; the raised per-test budget is only the
 * room a loaded run needs to reach this guard's named failure instead of the runner's anonymous one.
 */
const PANE_RELOAD_DEADLINE_MS = 66_000;

/** The pane every caller of this guard reads across its navigation. */
const PANE = '.chat-messages-pane';

/**
 * A spec's own page narrating failure (`explain(page, what)`): it throws, and its text carries the page's
 * own body text. Passed in rather than re-implemented here so there is exactly one page-text reader per
 * spec and the guard's named failure reads in the spec's own voice.
 */
export type PageExplainer = (page: Page, what: string) => Promise<never>;

/** Whether `locator` showed up within `timeoutMs`. */
const appears = async (locator: ReturnType<Page['locator']>, timeoutMs: number): Promise<boolean> =>
  locator.waitFor({ state: 'visible', timeout: timeoutMs }).then(() => true, () => false);

/**
 * The loop BOTH entry points below run. It is the one implementation: the two callers differ only in
 * the verb that starts a hop (`page.reload()` against `page.goto(url)`), so budget, landing probes,
 * replay numbering and failure shape cannot drift apart between them.
 *
 * `navigate` is handed the hop's own budget, and `hopKind` is what this run's log calls the hop.
 * `failureReading` is evaluated ONLY at the deadline — so a boot's failed-request count describes
 * the hop that failed, not anything the case did before the guard was called.
 *
 * One hop's navigation failing is a landing that did not arrive, not an error of its own: a document that never
 * finishes loading and one that loads without ever mounting the session are the same failure from here, and
 * both end at the same named error.
 *
 * Every hop is signed into this run's own output — which hop it is, what it was given, when it returned, and
 * whether the pane came up — because the replay this guard exists to make has to be READABLE in the log as a
 * replay (hop 1 is the case's own navigation, every later one is a replay by number), not inferred from the source.
 */
const chasePane = async (params: {
  page: Page;
  hopKind: string;
  navigate: (budgetMs: number) => Promise<unknown>;
  label: string;
  explain: PageExplainer;
  failureReading?: () => string;
}): Promise<void> => {
  const { page, hopKind, navigate, label, explain, failureReading } = params;
  const startedAt = Date.now();
  const deadline = startedAt + PANE_RELOAD_DEADLINE_MS;
  const budgetMs = () => Math.max(1, deadline - Date.now());
  let navigationFailure: string | null = null;
  for (let attempt = 1; ; attempt += 1) {
    const hop = attempt === 1 ? hopKind : `${hopKind} (replay ${attempt - 1})`;
    const hopBudget = Math.min(PANE_RELOAD_HOP_MS, budgetMs());
    const hopStartedAt = Date.now();
    console.log(`[e2e] reload pane: hop ${attempt} (${hop}) begins with ${hopBudget}ms of navigation budget`);
    try {
      await navigate(hopBudget);
      navigationFailure = null;
      console.log(`[e2e] reload pane: hop ${attempt} (${hop}) committed after ${Date.now() - hopStartedAt}ms`);
    } catch (error) {
      navigationFailure = error instanceof Error ? error.message : String(error);
      console.log(`[e2e] reload pane: hop ${attempt} (${hop}) did not commit in ${hopBudget}ms: ${navigationFailure}`);
    }
    const landingBudget = Math.min(attempt === 1 ? PANE_FIRST_LANDING_MS : PANE_REPLAY_LANDING_MS, budgetMs());
    if (await appears(page.locator(PANE), landingBudget)) {
      console.log(`[e2e] reload pane: ${label} came up after ${Date.now() - startedAt}ms (attempt ${attempt}, ${hop})`);
      return;
    }
    if (Date.now() >= deadline) {
      await explain(
        page,
        `${label} did not come up within ${Date.now() - startedAt}ms of the navigation, replays included`
        + `${navigationFailure === null ? '' : ` (the last navigation did not commit either: ${navigationFailure})`}`
        + `${failureReading === undefined ? '' : `; ${failureReading()}`}`,
      );
    }
    console.log(`[e2e] reload pane: ${label} was not up ${landingBudget}ms after hop ${attempt} (${hop}); replaying`);
  }
};

/** The boot's own failed document/script requests, as read when the guard's deadline is spent. */
type BootFailure = { failedModuleRequests: number; firstFailedUrl: string | null };

/**
 * Watches THIS page's boot requests for the lifetime of one guard call. Only `document` and `script`
 * resources are counted: they are the module graph whose hole leaves the shell's placeholder text on
 * screen instead of a mounted client. An interrupted request and a route that aborts one both surface
 * as `requestfailed`, which is the reading AC3's false form injects. Installed inside the guard and
 * removed in its own `finally`, so no sibling case sees the listener.
 */
const watchBootFailures = (page: Page): { read: () => BootFailure; stop: () => void } => {
  const failedUrls: string[] = [];
  const onFailed = (request: Request): void => {
    const resourceType = request.resourceType();
    if (resourceType === 'document' || resourceType === 'script') failedUrls.push(request.url());
  };
  page.on('requestfailed', onFailed);
  return {
    read: () => ({ failedModuleRequests: failedUrls.length, firstFailedUrl: failedUrls[0] ?? null }),
    stop: () => page.off('requestfailed', onFailed),
  };
};

/**
 * What this replaces: a bare `page.reload()` and then the pane's 30s window. The reload is bounded, the pane
 * it should bring back is probed with a bound of its own, and a probe that does not land has the reload
 * REPLAYED — a fresh document, which is exactly what recovers from a document whose boot requests were held
 * or interrupted once — until the deadline above is spent.
 */
export const reloadPaneBounded = async (page: Page, label: string, explain: PageExplainer): Promise<void> =>
  chasePane({
    page,
    hopKind: 'page.reload',
    navigate: (budgetMs) => page.reload({ waitUntil: 'commit', timeout: budgetMs }),
    label,
    explain,
  });

/**
 * The same bounded, replayable settle for a navigation that starts a NEW document, not a reload.
 *
 * WHY IT EXISTS. A `page.goto('/session/…')` boots the same Vite module graph a reload does, and the
 * residual this file guards against — boot requests held or interrupted once, leaving the shell's
 * placeholder on screen and no pane at all — hits it identically. The three navigations in
 * `voice-realtime-composer-embedded.spec.ts` were bare for exactly that reason: the guard it could
 * call only knew how to reload.
 *
 * WHAT IT ADDS ON FAILURE. The failed-request reading above, so a red names what the boot was missing
 * (`failed module requests: N`, with the first failed URL) instead of only the page's leftover text.
 */
export const openPaneBounded = async (
  page: Page,
  url: string,
  label: string,
  explain: PageExplainer,
): Promise<void> => {
  const boot = watchBootFailures(page);
  try {
    await chasePane({
      page,
      hopKind: `page.goto(${url})`,
      navigate: (budgetMs) => page.goto(url, { waitUntil: 'commit', timeout: budgetMs }),
      label,
      explain,
      failureReading: () => {
        const { failedModuleRequests, firstFailedUrl } = boot.read();
        return `client never mounted; failed module requests: ${failedModuleRequests}`
          + `${firstFailedUrl === null ? '' : ` (first: ${firstFailedUrl})`}`;
      },
    });
  } finally {
    boot.stop();
  }
};

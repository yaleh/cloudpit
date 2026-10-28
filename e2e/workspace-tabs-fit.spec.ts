import fs from 'node:fs';
import path from 'node:path';

import { expect, request, test } from '@playwright/test';
import type { APIRequestContext, Browser, BrowserContext, Page } from '@playwright/test';

import { writeArchitectureFixture } from './support/architectureFixture';
import { awaitClientMounted, warmClientStartup } from './support/client-startup-warmup';
import type { ClientStartupEvidence } from './support/client-startup-warmup';

/**
 * The workspace header's tab strip, measured on a real page.
 *
 * WHY THIS FILE EXISTS. The unit case can only assert the order from props and the label mode
 * from stubbed widths; neither says whether the header a person actually gets at 1280, 1440 or
 * 1920 has every built-in tab on screen. The defect this task fixes was exactly a real-header
 * width problem (five tabs visible, Architecture behind `>`), so the criterion has to read the
 * boxes a browser laid out.
 *
 * THE FIXTURE. A workspace carrying both `.quay/config.yml` (so the Quay tab is offered) and
 * the `.archguard` cache `writeArchitectureFixture` writes (so the Architecture tab is
 * offered), armed through the debug-agent scenario the architecture specs use so the run has a
 * real session whose project is this workspace. Both carriers are written before the scenario
 * is armed, because the project listing reads them per request.
 *
 * THE SECOND CASE drives the same header at 1024 with the plugin tabs installed, where the
 * strip cannot fit and the overflow menu has to keep every hidden view reachable by name. The plugin manifests are
 * written into this run's isolated HOME before any page exists: the registry scans the
 * directory per request, so both cases list them, and their labels are what push the
 * full-label width past a 1280 header's room in the first place.
 */

const USERNAME = 'workspace-tabs-fit-e2e';
const PASSWORD = 'workspace-tabs-fit-e2e-pass';
const FIXTURE_WORKSPACE = 'workspace-tabs-fit-workspace';

/** Tags the console output, so a reading in a failing gate's tail says which leg produced it. */
const TAG = '[workspace-tabs-fit]';

/** The plugin tabs the 1024 arm installs. More than two, as the criterion asks. */
const PLUGIN_NAMES = ['fit-probe-one', 'fit-probe-two', 'fit-probe-three'] as const;

/** The three widths the "every built-in fits" arm drives, all with the sidebar open. */
const FIT_VIEWPORTS = [
  { width: 1280, height: 800 },
  { width: 1440, height: 900 },
  { width: 1920, height: 1080 },
] as const;

/** The narrow desktop width the overflow floor is measured at. */
const OVERFLOW_VIEWPORT = { width: 1024, height: 768 } as const;

/** The title block's cap after this task: `md:max-w-[min(34%,16rem)]` = 256 px. */
const TITLE_BLOCK_MAX_PX = 256;

let baseURL = '';
let token = '';
let sessionId = '';
let workspace = '';

/** Page/console/request evidence, so a mount failure names the run that produced it. */
const startupEvidence: ClientStartupEvidence = {
  pageErrors: [],
  consoleErrors: [],
  requestFailures: [],
  warmup: null,
};

/* ── the fixture and the session ────────────────────────────────────────────── */

/** Creates the account (or signs in on a re-run against the same data directory). */
async function createAccount(api: APIRequestContext): Promise<string> {
  const register = await api.post('/api/auth/register', { data: { username: USERNAME, password: PASSWORD } });
  const registered = await register.json().catch(() => null);
  if (typeof registered?.token === 'string') {
    await api.post('/api/user/complete-onboarding', {
      headers: { Authorization: `Bearer ${registered.token}` },
    });
    return registered.token;
  }

  const login = await api.post('/api/auth/login', { data: { username: USERNAME, password: PASSWORD } });
  const loggedIn = await login.json().catch(() => null);
  if (typeof loggedIn?.token !== 'string') {
    throw new Error(
      `could not create or sign in as ${USERNAME}: register ${register.status()} ${JSON.stringify(registered)}, `
        + `login ${login.status()} ${JSON.stringify(loggedIn)}`,
    );
  }
  return loggedIn.token;
}

/** Arms one debug-agent scenario in `projectPath` and answers the session id it was indexed under. */
async function armScenario(
  api: APIRequestContext,
  projectPath: string,
  userText: string,
  mustContain: string,
): Promise<string> {
  const scenario = {
    version: 1,
    dialect: 'claude',
    home: 'gate',
    transcript: { mode: 'per-row-jsonl' },
    seed: { title: 'Workspace tabs fit', userText },
    steps: [{ at: 0, op: 'wait' }],
    expect: { rows: { delta: 0 }, content: { mustContain: [mustContain] } },
  };
  const response = await api.post('/api/debug-agent/scenarios', { data: { projectPath, scenario } });
  const body = await response.json().catch(() => null);
  if (!response.ok()) {
    throw new Error(`arming failed (${response.status()}): ${JSON.stringify(body)}`);
  }
  const id = body?.data?.sessionId;
  if (typeof id !== 'string') {
    throw new Error(`arming returned no sessionId: ${JSON.stringify(body)}`);
  }
  return id;
}

/** Writes the plugin manifests into the run's isolated HOME (`~/.claude-code-ui/plugins`). */
function installPlugins(): void {
  const dataDir = process.env.QUAY_E2E_DATA_DIR;
  if (!dataDir) throw new Error('playwright.config.ts must publish QUAY_E2E_DATA_DIR');
  const pluginsDir = path.join(dataDir, '.claude-code-ui', 'plugins');
  for (const [index, name] of PLUGIN_NAMES.entries()) {
    const dir = path.join(pluginsDir, name);
    fs.mkdirSync(dir, { recursive: true });
    fs.writeFileSync(
      path.join(dir, 'manifest.json'),
      `${JSON.stringify({
        name,
        displayName: `Fit Probe ${index + 1}`,
        version: '1.0.0',
        description: 'workspace tab fit e2e',
        author: 'e2e',
        type: 'module',
        slot: 'tab',
        entry: 'index.js',
        permissions: [],
      }, null, 2)}\n`,
      'utf8',
    );
    // Never loaded: the criterion only needs the tab to exist, and the tab's own view is not
    // opened. The scanner requires the entry to be a relative, traversal-free path.
    fs.writeFileSync(path.join(dir, 'index.js'), 'export default {};\n', 'utf8');
  }
}

test.describe.configure({ mode: 'serial' });

test.beforeAll(async () => {
  baseURL = test.info().project.use.baseURL ?? '';
  if (baseURL === '') throw new Error('playwright.config.ts must give this project a baseURL');

  const fixtureHome = process.env.QUAY_E2E_DEBUG_AGENT_HOME;
  if (!fixtureHome) {
    throw new Error(
      'playwright.config.ts must publish QUAY_E2E_DEBUG_AGENT_HOME for this selection '
        + '(workspace-tabs-fit.spec.ts is listed in DEBUG_AGENT_SPEC_FILES)',
    );
  }
  const dataDir = process.env.QUAY_E2E_DATA_DIR;
  if (!dataDir) throw new Error('playwright.config.ts must publish QUAY_E2E_DATA_DIR');

  workspace = path.join(fixtureHome, FIXTURE_WORKSPACE);
  const fixture = writeArchitectureFixture(workspace, { variant: 'node-size' });
  // The Tier-1 Quay gate is a pure path check for this file (`detectQuayConfig`).
  fs.mkdirSync(path.join(workspace, '.quay'), { recursive: true });
  fs.writeFileSync(
    path.join(workspace, '.quay', 'config.yml'),
    'version: 1\nloop:\n  concurrency: 1\n',
    'utf8',
  );
  // The plugin tabs are installed for the whole file. They are what makes the full-label
  // strip wider than a 1280 header's room (so that width really drops to icons), and the
  // 1024 arm is the same header with the overflow arrows.
  installPlugins();

  const bootstrap = await request.newContext({ baseURL });
  token = await createAccount(bootstrap);
  await bootstrap.dispose();

  const api = await request.newContext({
    baseURL,
    extraHTTPHeaders: { Authorization: `Bearer ${token}` },
  });
  const userText =
    'Please review the workspace tab strip. '
    + `Start at ${fixture.seedIdentifiers.map((name) => `\`${name}\``).join(', ')}.`;
  sessionId = await armScenario(api, workspace, userText, fixture.seedIdentifiers[0]);
  await api.dispose();

  // Take this run's first dependency optimization out of the measurement window before any
  // page exists (the same guard the architecture specs use). Without it the first document
  // can be replaced by Vite's full reload and every measurement would be of a blank page.
  startupEvidence.warmup = await warmClientStartup(baseURL, dataDir);

  fs.mkdirSync(path.join(process.cwd(), 'tmp'), { recursive: true });
  console.log(`${TAG} fixture.workspace=${workspace}`);
  console.log(`${TAG} session=${sessionId}`);
  console.log(`${TAG} warmup=${startupEvidence.warmup.elapsedMs}ms`);
});

/* ── opening a page and reading the header ─────────────────────────────────── */

/** Opens a signed-in page on the seeded session and waits for the real tab strip. */
async function openWorkspacePage(
  browser: Browser,
  viewport: { width: number; height: number },
): Promise<{ context: BrowserContext; page: Page }> {
  const context = await browser.newContext({ baseURL, viewport });
  await context.addInitScript(
    ({ authToken }: { authToken: string }) => {
      window.localStorage.setItem('auth-token', authToken);
      window.localStorage.setItem('userLanguage', 'en');
    },
    { authToken: token },
  );
  const page = await context.newPage();
  page.on('pageerror', (error) => startupEvidence.pageErrors.push(String(error)));
  page.on('console', (message) => {
    if (message.type() === 'error') startupEvidence.consoleErrors.push(message.text());
  });
  page.on('requestfailed', (request) => {
    startupEvidence.requestFailures.push({
      url: request.url(),
      failureText: request.failure()?.errorText ?? 'no error text',
    });
  });

  // The document may be replaced mid-load by the optimizer; the mount guard reports that by
  // name rather than leaving a locator timeout with no page behind it.
  await page.goto(`/session/${sessionId}`, { waitUntil: 'domcontentloaded', timeout: 20_000 }).catch(() => undefined);
  await awaitClientMounted(page, '[role="tablist"]', 30_000, startupEvidence);
  // Both carriers are read per request, so this waits for the listing that makes both tabs
  // exist rather than assuming the deep-link copy already carried them. "Exist" is read off the
  // off-screen measuring copy, which lists every view: at a narrow viewport the lowest-priority
  // views sit behind the overflow menu and are not on the strip itself.
  await expect(
    page.locator('[data-workspace-tab-measure="quay"]'),
    'the seeded workspace carries .quay/config.yml, so the Quay tab must be offered',
  ).toBeAttached({ timeout: 20_000 });
  await expect(
    page.locator('[data-workspace-tab-measure="architecture"]'),
    'the seeded workspace carries an .archguard cache, so the Architecture tab must be offered',
  ).toBeAttached({ timeout: 20_000 });
  return { context, page };
}

type HeaderReading = {
  mode: string | null;
  viewport: { width: number; height: number };
  /** The tablist's own scroll container, in viewport pixels. */
  scroll: { left: number; right: number; width: number };
  /** The flex item that owns the strip: the room the icon/full decision is taken against. */
  roomWidth: number | null;
  /** The empty grow cell that now takes the slack between the title block and the pulse trigger. */
  spacerWidth: number | null;
  /** The Loop Pulse trigger's box, so its own 110→43 px switch point can be scanned too. */
  pulseWidth: number | null;
  /** The header's own width: the pulse trigger's breakpoint is measured against this, not the viewport. */
  headerWidth: number | null;
  /** Whether the strip offers its "More views" overflow menu. */
  overflowTrigger: boolean;
  /** Every view the strip knows, from the off-screen measuring copy: on the strip or in the menu. */
  allIds: string[];
  titleWidth: number | null;
  tablistWidth: number;
  tabs: {
    id: string | null;
    plugin: boolean;
    left: number;
    right: number;
    width: number;
    labelVisible: boolean;
  }[];
};

/** One structured reading of the desktop header, taken in a single round trip. */
const readHeader = (page: Page): Promise<HeaderReading> =>
  page.evaluate(() => {
    const tablist = document.querySelector<HTMLElement>('[role="tablist"]');
    if (tablist === null) throw new Error('the desktop tablist is not in the document');
    const scroll = tablist.parentElement as HTMLElement;
    const scrollRect = scroll.getBoundingClientRect();
    const header = document.querySelector<HTMLElement>('header[data-app-header]');
    const titleBlock = header?.firstElementChild as HTMLElement | null;
    const room = document.querySelector<HTMLElement>('[data-workspace-tabs-room]');
    const spacer = document.querySelector<HTMLElement>('[data-workspace-tabs-spacer]');
    const pulse = document.querySelector<HTMLElement>('[data-testid="quay-pulse-trigger"]');

    return {
      mode: tablist.getAttribute('data-workspace-tabs-mode'),
      viewport: { width: window.innerWidth, height: window.innerHeight },
      scroll: { left: scrollRect.left, right: scrollRect.right, width: scrollRect.width },
      roomWidth: room === null ? null : room.getBoundingClientRect().width,
      spacerWidth: spacer === null ? null : spacer.getBoundingClientRect().width,
      pulseWidth: pulse === null ? null : pulse.getBoundingClientRect().width,
      headerWidth: header === null ? null : header.getBoundingClientRect().width,
      overflowTrigger: document.querySelector('[aria-label="More views"]') !== null,
      allIds: Array.from(document.querySelectorAll<HTMLElement>('[data-workspace-tab-measure]'))
        .map((pill) => pill.getAttribute('data-workspace-tab-measure') ?? ''),
      titleWidth: titleBlock === null ? null : titleBlock.getBoundingClientRect().width,
      tablistWidth: tablist.getBoundingClientRect().width,
      tabs: Array.from(tablist.querySelectorAll<HTMLElement>('[role="tab"]')).map((tab) => {
        const rect = tab.getBoundingClientRect();
        const label = tab.querySelector<HTMLElement>('[data-workspace-tab-label]');
        const id = tab.getAttribute('data-workspace-tab');
        return {
          id,
          plugin: (id ?? '').startsWith('plugin:'),
          left: rect.left,
          right: rect.right,
          width: rect.width,
          labelVisible: label !== null && window.getComputedStyle(label).display !== 'none',
        };
      }),
    };
  });

/** Waits until the mode and the tab boxes hold still for a beat, then answers the reading. */
async function settleViewport(page: Page, expectedMode?: string): Promise<HeaderReading> {
  const deadline = Date.now() + 8_000;
  let reading = await readHeader(page);
  let signature = '';
  let stableSince = Date.now();
  while (Date.now() < deadline) {
    const nextSignature = `${reading.mode}|${reading.overflowTrigger}|`
      + reading.tabs.map((tab) => `${tab.id}:${tab.width.toFixed(1)}`).join(',');
    if (nextSignature !== signature) {
      signature = nextSignature;
      stableSince = Date.now();
    }
    const settled = Date.now() - stableSince >= 250;
    if (settled && (expectedMode === undefined || reading.mode === expectedMode)) return reading;
    await page.waitForTimeout(100);
    reading = await readHeader(page);
  }
  return reading;
}

/**
 * What the adjacency criterion measures, in one round trip.
 *
 * `gap` is the header's own computed column gap — the distance the flex row leaves between any
 * two of its children. The distance that matters is from the Loop Pulse trigger's right edge to
 * the tablist's left edge; the tab container has no resting padding at desktop, so it is also
 * the container's left edge, whether or not the strip has an overflow menu.
 */
type AdjacencyReading = {
  gap: number;
  pulseRight: number;
  tablistLeft: number;
  tablistRight: number;
  roomLeft: number | null;
  roomRight: number | null;
  viewportWidth: number;
  mode: string | null;
  overflowTrigger: boolean;
};

const readAdjacency = (page: Page): Promise<AdjacencyReading> =>
  page.evaluate(() => {
    const header = document.querySelector<HTMLElement>('header[data-app-header]');
    const pulse = document.querySelector<HTMLElement>('[data-testid="quay-pulse-trigger"]');
    const tablist = document.querySelector<HTMLElement>('[role="tablist"]');
    const room = document.querySelector<HTMLElement>('[data-workspace-tabs-room]');
    if (header === null || pulse === null || tablist === null) {
      throw new Error('the desktop header, pulse trigger and tablist must all be in the document');
    }
    const headerStyle = window.getComputedStyle(header);
    const tablistRect = tablist.getBoundingClientRect();
    const roomRect = room === null ? null : room.getBoundingClientRect();
    return {
      gap: Number.parseFloat(headerStyle.columnGap || headerStyle.gap || '0'),
      pulseRight: pulse.getBoundingClientRect().right,
      tablistLeft: tablistRect.left,
      tablistRight: tablistRect.right,
      roomLeft: roomRect === null ? null : roomRect.left,
      roomRight: roomRect === null ? null : roomRect.right,
      viewportWidth: window.innerWidth,
      mode: tablist.getAttribute('data-workspace-tabs-mode'),
      overflowTrigger: document.querySelector('[aria-label="More views"]') !== null,
    };
  });

/** The desktop header's gap, as `gap-2` and `md:gap-3` compose it. */
const DESKTOP_HEADER_GAP_PX = 12;

/** One line per width, so a red gate's tail can read the numbers the assertions used. */
function printReading(label: string, reading: HeaderReading): void {
  console.log(
    `${TAG} ${label} viewport=${reading.viewport.width}x${reading.viewport.height} mode=${reading.mode} `
      + `scroll=[${reading.scroll.left.toFixed(1)},${reading.scroll.right.toFixed(1)}] `
      + `room=${reading.roomWidth === null ? '<none>' : reading.roomWidth.toFixed(1)} `
      + `title=${reading.titleWidth === null ? '<none>' : reading.titleWidth.toFixed(1)} `
      + `overflow=${reading.overflowTrigger} `
      + `tabs=${JSON.stringify(reading.tabs.map((tab) => ({
        id: tab.id,
        box: [Number(tab.left.toFixed(1)), Number(tab.right.toFixed(1))],
        label: tab.labelVisible,
      })))}`,
  );
}

/* ── the two criteria ──────────────────────────────────────────────────────── */

test('every built-in tab fits at 1280/1440/1920 with Quay and Architecture right after Chat', async ({ browser }) => {
  test.setTimeout(120_000);
  const { context, page } = await openWorkspacePage(browser, FIT_VIEWPORTS[0]);
  try {
    const readings = new Map<number, HeaderReading>();
    for (const viewport of FIT_VIEWPORTS) {
      await page.setViewportSize(viewport);
      const reading = await settleViewport(page);
      readings.set(viewport.width, reading);
      printReading('fit', reading);

      const ids = reading.tabs.map((tab) => tab.id);
      // The off-screen copy lists every view in display order; the strip shows a subsequence of it.
      expect(reading.allIds.slice(0, 3), 'display order: Chat, Quay, Architecture first').toEqual(['chat', 'quay', 'architecture']);
      const shown = reading.allIds.filter((id) => ids.includes(id));
      expect(ids, `the strip must keep display order; got ${JSON.stringify(ids)}`).toEqual(shown);

      // Every view is either on the strip or in the overflow menu: nothing is scrolled away.
      expect(
        reading.tabs.length > 0 && reading.allIds.length >= reading.tabs.length,
        `the strip can only show views it knows; visible ${JSON.stringify(ids)} of ${JSON.stringify(reading.allIds)}`,
      ).toBe(true);
      expect(
        reading.overflowTrigger,
        `at ${viewport.width}px the overflow menu must exist exactly when some view is off the strip; `
          + `visible ${reading.tabs.length} of ${reading.allIds.length}`,
      ).toBe(reading.tabs.length < reading.allIds.length);
      expect(ids, `Chat is the highest-priority tab and must stay on the strip at ${viewport.width}px`).toContain('chat');

      for (const tab of reading.tabs) {
        expect(tab.left, `"${tab.id}" must start inside the strip at ${viewport.width}px`).toBeGreaterThanOrEqual(reading.scroll.left - 1);
        expect(tab.right, `"${tab.id}" must end inside the strip at ${viewport.width}px`).toBeLessThanOrEqual(reading.scroll.right + 1);
        expect(tab.left, `"${tab.id}" must start inside the viewport at ${viewport.width}px`).toBeGreaterThanOrEqual(0);
        expect(tab.right, `"${tab.id}" must end inside the viewport at ${viewport.width}px`).toBeLessThanOrEqual(reading.viewport.width);
      }

      await page.locator('header[data-app-header]').screenshot({
        path: path.join('tmp', `workspace-tabs-fit-${viewport.width}.png`),
      });
    }

    expect(
      readings.get(1280)?.mode,
      'the 1280 header cannot spell every name',
    ).not.toBe('full');
    expect(
      readings.get(1920)?.mode,
      'the 1920 header must have room for full labels',
    ).toBe('full');
  } finally {
    await context.close();
  }
});

test('at 1024 with plugins the overflow menu names every hidden view and the title block stays at 16rem', async ({ browser }) => {
  test.setTimeout(120_000);

  const { context, page } = await openWorkspacePage(browser, OVERFLOW_VIEWPORT);
  try {
    const reading = await settleViewport(page, 'overflow');
    printReading('overflow', reading);

    expect(
      reading.allIds.filter((id) => id.startsWith('plugin:')).length,
      `the installed plugin tabs must be listed; got ${JSON.stringify(reading.allIds)}`,
    ).toBeGreaterThanOrEqual(2);
    expect(reading.mode, 'at 1024 with plugin tabs the strip cannot hold every tab').toBe('overflow');
    expect(reading.overflowTrigger, 'an overflowing strip must offer the menu').toBe(true);
    expect(
      await page.locator('[aria-label*="Scroll tabs"]').count(),
      'the strip no longer scrolls, so it must not draw scroll arrows',
    ).toBe(0);
    expect(
      reading.titleWidth ?? Number.POSITIVE_INFINITY,
      'the title block must be capped at 16rem (256px)',
    ).toBeLessThanOrEqual(TITLE_BLOCK_MAX_PX);

    await page.locator('[aria-label="More views"]').click();
    const items = page.locator('[role="menu"] [role="menuitem"]');
    await expect(items, 'the menu lists exactly the views that left the strip').toHaveCount(reading.allIds.length - reading.tabs.length);
    await page.locator('header[data-app-header]').screenshot({
      path: path.join('tmp', 'workspace-tabs-fit-1024-plugins.png'),
    });

    // The last view is a plugin: choosing it from the menu must activate it.
    await items.last().click();
    await expect(
      page.locator('[role="tab"][aria-selected="true"]'),
      'the view chosen from the menu must become the active tab on the strip',
    ).toHaveAttribute('data-workspace-tab', /^plugin:/);
  } finally {
    await context.close();
  }
});

/* ── the adjacency criteria ────────────────────────────────────────────────── */

/** The three viewport widths the fit-regime adjacency criterion drives. */
const ADJACENCY_VIEWPORTS = [1200, 1440, 1920] as const;

/**
 * The Loop Pulse trigger is the header's own flex child immediately before the tab container, so
 * the visible distance from its right edge to the strip's left edge is the header's gap. The
 * container is content-sized and has no resting padding at desktop, so the tablist's outer box
 * IS the container's left edge; measuring the tablist here would catch a regression that
 * reintroduced padding between the two.
 */
test('the pulse trigger sits one header gap before the tablist at 1200/1440/1920', async ({ browser }) => {
  test.setTimeout(120_000);
  const { context, page } = await openWorkspacePage(browser, { width: ADJACENCY_VIEWPORTS[0], height: 900 });
  try {
    for (const width of ADJACENCY_VIEWPORTS) {
      await page.setViewportSize({ width, height: 900 });
      const settled = await settleViewport(page);
      printReading('adjacency', settled);
      const reading = await readAdjacency(page);
      console.log(
        `${TAG} adjacency width=${width} gap=${reading.gap} mode=${reading.mode} overflow=${reading.overflowTrigger} `
          + `pulseRight=${reading.pulseRight.toFixed(1)} tablistLeft=${reading.tablistLeft.toFixed(1)} `
          + `distance=${(reading.tablistLeft - reading.pulseRight).toFixed(1)}`,
      );

      expect(
        Math.abs(reading.gap - DESKTOP_HEADER_GAP_PX),
        `the desktop header gap must be ${DESKTOP_HEADER_GAP_PX}px at ${width}px; got ${reading.gap}`,
      ).toBeLessThanOrEqual(0.5);
      const distance = reading.tablistLeft - reading.pulseRight;
      expect(
        Math.abs(distance - reading.gap),
        `the pulse trigger's right edge must be one header gap (${reading.gap}px) before the tablist at ${width}px; `
          + `it was ${distance.toFixed(1)}px`,
      ).toBeLessThanOrEqual(1);

      await page.locator('header[data-app-header]').screenshot({
        path: path.join('tmp', `workspace-tabs-adjacency-${width}.png`),
      });
    }
  } finally {
    await context.close();
  }
});

/**
 * The overflow regime is the other half: once the strip cannot hold every tab, the lowest-priority
 * ones move into the menu and the strip is sized to what is left. The pulse must still be exactly
 * one header gap from the container, and the container must stay inside the viewport rather than
 * being pushed off the right edge.
 */
test('in the overflow regime the pulse trigger stays one header gap from the tab container', async ({ browser }) => {
  test.setTimeout(120_000);
  const { context, page } = await openWorkspacePage(browser, OVERFLOW_VIEWPORT);
  try {
    const settled = await settleViewport(page, 'overflow');
    printReading('overflow-adjacency', settled);
    const reading = await readAdjacency(page);
    console.log(
      `${TAG} overflow-adjacency gap=${reading.gap} mode=${reading.mode} overflow=${reading.overflowTrigger} `
        + `pulseRight=${reading.pulseRight.toFixed(1)} roomLeft=${reading.roomLeft?.toFixed(1)} `
        + `roomRight=${reading.roomRight?.toFixed(1)} tablistLeft=${reading.tablistLeft.toFixed(1)} `
        + `tablistRight=${reading.tablistRight.toFixed(1)} viewport=${reading.viewportWidth}`,
    );

    expect(reading.overflowTrigger, 'the narrow viewport must overflow the strip so the menu renders').toBe(true);
    expect(reading.roomLeft, 'the tab container must be in the document').not.toBeNull();
    const distance = (reading.roomLeft ?? Number.NaN) - reading.pulseRight;
    expect(
      Math.abs(distance - reading.gap),
      `the pulse trigger's right edge must be one header gap (${reading.gap}px) before the tab container; `
        + `it was ${distance.toFixed(1)}px`,
    ).toBeLessThanOrEqual(1);

    expect(
      reading.roomRight ?? Number.POSITIVE_INFINITY,
      `the tab container must stay inside the viewport (${reading.viewportWidth}px), not be pushed off the right edge`,
    ).toBeLessThanOrEqual(reading.viewportWidth + 1);
    expect(
      reading.tablistRight,
      'the strip, menu trigger included, must fit the room the planner gave it',
    ).toBeLessThanOrEqual((reading.roomRight ?? Number.POSITIVE_INFINITY) + 1);
    expect(reading.tablistLeft, 'the tablist must start inside the viewport').toBeGreaterThanOrEqual(0);

    await page.locator('header[data-app-header]').screenshot({
      path: path.join('tmp', 'workspace-tabs-adjacency-overflow.png'),
    });
  } finally {
    await context.close();
  }
});

/* ── the switch-point scan ─────────────────────────────────────────────────── */

/**
 * The grid the switch-point criterion is measured on: 10 px steps across the whole desktop range.
 *
 * It has to hold BOTH switches the header makes on its own: the Loop Pulse trigger's 43→110 px
 * shape (its breakpoint is a 960 px HEADER, not a viewport) and the tab strip's layout levels
 * (overflow → icon → partial → full). A coarse grid would let a shifted switch hide between two
 * samples, so the step is 10 px.
 */
const SCAN_WIDTHS: readonly number[] = Array.from({ length: 127 }, (_, index) => 800 + index * 10);

/**
 * Where the two switches sat BEFORE the strip learned to degrade in levels.
 *
 * MEASURED 2026-10-26 on this exact grid (10 px steps, 800–2060, plugin tabs installed), against
 * the two-mode `WorkspaceHeader` on `develop`:
 *   - label mode: icon at 1640, full at 1650  → the first FULL sample.
 *   - pulse shape: 43 px at 1280, 110 px at 1290 → `PULSE_WIDE_AT` is the first 110 px sample.
 *
 * The "every name spelled" boundary is the same arithmetic as before (strip width + 4 px slack),
 * so the first FULL sample may only move by the 12 px upgrade margin and one grid step. The pulse
 * switch is the control arm: it is the trigger's own header-width breakpoint and must not move.
 */
const BASELINE_FULL_AT_PX = 1650;
const FULL_AT_TOLERANCE_PX = 40;
const BASELINE_PULSE_WIDE_AT_PX = 1290;

/** How much of the strip a level shows; a wider header can only move UP this ladder. */
const MODE_RANK: Readonly<Record<string, number>> = { overflow: 0, icon: 1, partial: 2, full: 3 };

type ScanRow = {
  width: number;
  mode: string | null;
  pulseWidth: number | null;
  headerWidth: number | null;
};

type Transition<T> = { at: number; from: T; to: T };

/** Every place `key` changes between consecutive 10 px samples, with the width it changed at. */
function transitionsOf<T>(rows: readonly ScanRow[], key: (row: ScanRow) => T): Transition<T>[] {
  const out: Transition<T>[] = [];
  for (let index = 1; index < rows.length; index += 1) {
    const from = key(rows[index - 1]);
    const to = key(rows[index]);
    if (from !== to) out.push({ at: rows[index].width, from, to });
  }
  return out;
}

test('scan: the strip climbs its levels with width and the pulse-shape switch stays on the baseline', async ({ browser }) => {
  test.setTimeout(300_000);
  const { context, page } = await openWorkspacePage(browser, { width: SCAN_WIDTHS[0], height: 900 });
  try {
    const rows: ScanRow[] = [];
    for (const width of SCAN_WIDTHS) {
      await page.setViewportSize({ width, height: 900 });
      const reading = await settleViewport(page);
      rows.push({
        width,
        mode: reading.mode,
        pulseWidth: reading.pulseWidth === null ? null : Math.round(reading.pulseWidth),
        headerWidth: reading.headerWidth === null ? null : Math.round(reading.headerWidth),
      });
    }

    const modeSwitches = transitionsOf(rows, (row) => row.mode);
    const pulseSwitches = transitionsOf(rows, (row) => row.pulseWidth);
    console.log(`${TAG} scan mode-switches=${JSON.stringify(modeSwitches)}`);
    console.log(`${TAG} scan pulse-switches=${JSON.stringify(pulseSwitches)}`);
    console.log(`${TAG} scan rows=${JSON.stringify(rows)}`);

    const pulseSwitch = pulseSwitches.find((transition) => transition.to === 110);
    expect(pulseSwitch, `the pulse-shape switch must be inside the scan grid; got ${JSON.stringify(pulseSwitches)}`).toBeTruthy();
    expect(
      pulseSwitches.length,
      `the pulse shape must switch exactly once across 800–2060 px; got ${JSON.stringify(pulseSwitches)}`,
    ).toBe(1);
    expect(
      Math.abs((pulseSwitch?.at ?? -1) - BASELINE_PULSE_WIDE_AT_PX),
      `the pulse-shape switch is the control arm and must stay at ${BASELINE_PULSE_WIDE_AT_PX}px (±1); it moved to ${pulseSwitch?.at}px`,
    ).toBeLessThanOrEqual(1);

    // Every level is a known one, the narrowest sample is the overflow level and the widest is full.
    for (const row of rows) expect(MODE_RANK[row.mode ?? ''], `unknown mode "${row.mode}" at ${row.width}px`).toBeDefined();
    expect(rows[0].mode, 'the narrowest desktop sample must overflow').toBe('overflow');
    expect(rows[rows.length - 1].mode, 'the widest sample must spell every name').toBe('full');

    // A wider header can only show more. The one legitimate step DOWN is the pulse trigger growing
    // from 43 to 110 px, which takes 67 px of room from the strip at that very width.
    for (const transition of modeSwitches) {
      const rose = MODE_RANK[transition.to ?? ''] > MODE_RANK[transition.from ?? ''];
      expect(
        rose || transition.at === pulseSwitch?.at,
        `at ${transition.at}px the mode went ${transition.from} → ${transition.to}; it may only fall at the pulse switch (${pulseSwitch?.at}px)`,
      ).toBe(true);
    }

    // The "every name spelled" boundary stays where the two-mode strip had it.
    const fullAt = rows.find((row) => row.mode === 'full')?.width ?? -1;
    expect(
      Math.abs(fullAt - BASELINE_FULL_AT_PX),
      `the first full-label sample must stay within ${FULL_AT_TOLERANCE_PX}px of ${BASELINE_FULL_AT_PX}px; it is ${fullAt}px`,
    ).toBeLessThanOrEqual(FULL_AT_TOLERANCE_PX);
  } finally {
    await context.close();
  }
});

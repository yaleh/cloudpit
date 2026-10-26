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
 * strip cannot fit and the `>` fallback has to reach the last tab. The plugin manifests are
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
  // exist rather than assuming the deep-link copy already carried them.
  await expect(
    page.locator('[role="tab"][data-workspace-tab="quay"]'),
    'the seeded workspace carries .quay/config.yml, so the Quay tab must be offered',
  ).toBeVisible({ timeout: 20_000 });
  await expect(
    page.locator('[role="tab"][data-workspace-tab="architecture"]'),
    'the seeded workspace carries an .archguard cache, so the Architecture tab must be offered',
  ).toBeVisible({ timeout: 20_000 });
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
  scrollRightButton: boolean;
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
      scrollRightButton: document.querySelector('[aria-label*="Scroll tabs right"]') !== null,
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
async function settleViewport(page: Page, expectedMode?: 'full' | 'icon'): Promise<HeaderReading> {
  const deadline = Date.now() + 8_000;
  let reading = await readHeader(page);
  let signature = '';
  let stableSince = Date.now();
  while (Date.now() < deadline) {
    const nextSignature = `${reading.mode}|${reading.scrollRightButton}|`
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
 * two of its children. The two distances that matter are from the Loop Pulse trigger's right edge
 * to (a) the tablist's left edge when the strip fits, and (b) the tab container's left edge when
 * it overflows and the tabs scroll inside the container.
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
  scrollRightButton: boolean;
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
      scrollRightButton: document.querySelector('[aria-label*="Scroll tabs right"]') !== null,
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
      + `arrow=${reading.scrollRightButton} `
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
      expect(ids[0], `the first tab must be Chat; got ${JSON.stringify(ids)}`).toBe('chat');
      expect(ids[1], `Quay must follow Chat directly; got ${JSON.stringify(ids)}`).toBe('quay');
      expect(ids[2], `Architecture must follow Quay directly; got ${JSON.stringify(ids)}`).toBe('architecture');
      const firstPlugin = reading.tabs.findIndex((tab) => tab.plugin);
      expect(firstPlugin, `the plugin tabs must follow the built-ins; got ${JSON.stringify(ids)}`).toBeGreaterThan(0);
      expect(
        ids[firstPlugin - 1],
        `Shell must be the last built-in tab, directly before the plugin group; got ${JSON.stringify(ids)}`,
      ).toBe('shell');

      expect(
        reading.scrollRightButton,
        `at ${viewport.width}px every tab must fit, so the right scroll arrow must not render; got ${JSON.stringify(reading.tabs)}`,
      ).toBe(false);

      for (const tab of reading.tabs.filter((candidate) => !candidate.plugin)) {
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
      'the 1280 header must drop to icon-only labels',
    ).toBe('icon');
    expect(
      readings.get(1920)?.mode,
      'the 1920 header must have room for full labels',
    ).toBe('full');
  } finally {
    await context.close();
  }
});

test('at 1024 with plugins the overflow arrow still reaches the last tab and the title block stays at 16rem', async ({ browser }) => {
  test.setTimeout(120_000);

  const { context, page } = await openWorkspacePage(browser, OVERFLOW_VIEWPORT);
  try {
    const reading = await settleViewport(page, 'icon');
    printReading('overflow', reading);

    const pluginTabs = reading.tabs.filter((tab) => tab.plugin);
    expect(
      pluginTabs.length,
      `the installed plugin tabs must be listed; got ${JSON.stringify(reading.tabs.map((tab) => tab.id))}`,
    ).toBeGreaterThanOrEqual(2);

    expect(
      reading.scrollRightButton,
      'at 1024 with plugin tabs the strip must overflow, so the right arrow must render',
    ).toBe(true);
    expect(
      reading.titleWidth ?? Number.POSITIVE_INFINITY,
      'the title block must be capped at 16rem (256px)',
    ).toBeLessThanOrEqual(TITLE_BLOCK_MAX_PX);

    const lastTab = reading.tabs[reading.tabs.length - 1];
    expect(lastTab.plugin, 'the last tab must be a plugin tab').toBe(true);

    await page.locator('[aria-label*="Scroll tabs right"]').click();
    await expect
      .poll(
        async () => {
          const after = await readHeader(page);
          const last = after.tabs[after.tabs.length - 1];
          return last.left >= after.scroll.left - 1 && last.right <= after.scroll.right + 1;
        },
        {
          timeout: 8_000,
          message: 'the right arrow must scroll the last tab fully into the strip',
        },
      )
      .toBe(true);

    await page.locator('header[data-app-header]').screenshot({
      path: path.join('tmp', 'workspace-tabs-fit-1024-plugins.png'),
    });
  } finally {
    await context.close();
  }
});

/* ── the adjacency criteria ────────────────────────────────────────────────── */

/** The three viewport widths the fit-regime adjacency criterion drives. */
const ADJACENCY_VIEWPORTS = [1200, 1440, 1920] as const;

/**
 * The Loop Pulse trigger is the header's own flex child immediately before the tab container, so
 * the visible distance from its right edge to the strip's left edge is the header's gap. In the
 * fit regime the container is content-sized and the scroll container has no resting padding, so
 * the tablist's outer box IS the container's left edge; measuring the tablist here would catch a
 * regression that reintroduced padding between the two.
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
        `${TAG} adjacency width=${width} gap=${reading.gap} mode=${reading.mode} arrow=${reading.scrollRightButton} `
          + `pulseRight=${reading.pulseRight.toFixed(1)} tablistLeft=${reading.tablistLeft.toFixed(1)} `
          + `distance=${(reading.tablistLeft - reading.pulseRight).toFixed(1)}`,
      );

      expect(
        Math.abs(reading.gap - DESKTOP_HEADER_GAP_PX),
        `the desktop header gap must be ${DESKTOP_HEADER_GAP_PX}px at ${width}px; got ${reading.gap}`,
      ).toBeLessThanOrEqual(0.5);
      expect(
        reading.scrollRightButton,
        `at ${width}px the strip must be in the fit regime (no scroll arrow) for the tablist's left edge to be the strip's edge`,
      ).toBe(false);

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
 * The overflow regime is the other half: once the strip cannot fit, the container is clipped to
 * the available width and the tabs scroll inside it. The pulse must still be exactly one header
 * gap from the CONTAINER (the strip's scroll padding lives inside it, for the arrows), and the
 * container itself must stay inside the viewport rather than being pushed off the right edge.
 */
test('in the overflow regime the pulse trigger stays one header gap from the tab container', async ({ browser }) => {
  test.setTimeout(120_000);
  const { context, page } = await openWorkspacePage(browser, OVERFLOW_VIEWPORT);
  try {
    const settled = await settleViewport(page, 'icon');
    printReading('overflow-adjacency', settled);
    const reading = await readAdjacency(page);
    console.log(
      `${TAG} overflow-adjacency gap=${reading.gap} mode=${reading.mode} arrow=${reading.scrollRightButton} `
        + `pulseRight=${reading.pulseRight.toFixed(1)} roomLeft=${reading.roomLeft?.toFixed(1)} `
        + `roomRight=${reading.roomRight?.toFixed(1)} tablistLeft=${reading.tablistLeft.toFixed(1)} `
        + `viewport=${reading.viewportWidth}`,
    );

    expect(reading.scrollRightButton, 'the narrow viewport must overflow the strip so the right arrow renders').toBe(true);
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
    expect(reading.tablistLeft, 'the tablist must start inside the viewport').toBeGreaterThanOrEqual(0);
    expect(reading.tablistLeft, 'the tablist must not start past the viewport').toBeLessThan(reading.viewportWidth);

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
 * shape (its breakpoint is a 960 px HEADER, not a viewport) and the tab strip's icon↔full label
 * mode. A coarse grid would let a shifted switch hide between two samples, so the step is 10 px
 * — the criterion's own tolerance is 1 px against a recorded baseline taken on this same grid.
 */
const SCAN_WIDTHS: readonly number[] = Array.from({ length: 127 }, (_, index) => 800 + index * 10);

/**
 * The two switch widths this fixture produced BEFORE the header's spacer change.
 *
 * MEASURED 2026-10-26 on this exact grid (10 px steps, 800–2060, plugin tabs installed), against
 * the pre-change `WorkspaceHeader` on `develop`:
 *   - label mode: icon at 1640, full at 1650  → `LABEL_MODE_FULL_AT` is the first FULL sample.
 *   - pulse shape: 43 px at 1280, 110 px at 1290 → `PULSE_WIDE_AT` is the first 110 px sample.
 *
 * The adjacency change moves width between the grow spacer and the tab container but leaves their
 * SUM — the decision's input — untouched, so neither switch may move. The pulse switch is the
 * trigger's own header-width breakpoint (960 px of header CONTENT, which is why it lands at a
 * 1290 px viewport) and is recorded here as the control arm: it must not move either.
 */
const BASELINE_LABEL_MODE_FULL_AT_PX = 1650;
const BASELINE_PULSE_WIDE_AT_PX = 1290;

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

test('scan: label-mode and pulse-shape switch points stay on the recorded baseline', async ({ browser }) => {
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

    // The scan is only meaningful if both switches are inside it.
    const labelSwitch = modeSwitches.find((transition) => transition.to === 'full');
    const pulseSwitch = pulseSwitches.find((transition) => transition.to === 110);
    expect(labelSwitch, `the tab-label switch must be inside the scan grid; got ${JSON.stringify(modeSwitches)}`).toBeTruthy();
    expect(pulseSwitch, `the pulse-shape switch must be inside the scan grid; got ${JSON.stringify(pulseSwitches)}`).toBeTruthy();

    // Exactly one switch of each across the whole grid: neither signal may flip back and forth.
    expect(
      modeSwitches.length,
      `the label mode must switch exactly once across 800–2060 px; got ${JSON.stringify(modeSwitches)}`,
    ).toBe(1);
    expect(
      pulseSwitches.length,
      `the pulse shape must switch exactly once across 800–2060 px; got ${JSON.stringify(pulseSwitches)}`,
    ).toBe(1);

    // Against the pre-change baseline, on the same grid and fixture (1 px tolerance; the grid
    // itself is 10 px, so a moved switch shows up as a different sample).
    const labelDelta = Math.abs((labelSwitch?.at ?? -1) - BASELINE_LABEL_MODE_FULL_AT_PX);
    expect(
      labelDelta,
      `the full-label switch must stay at ${BASELINE_LABEL_MODE_FULL_AT_PX}px (±1); it moved to ${labelSwitch?.at}px`,
    ).toBeLessThanOrEqual(1);
    const pulseDelta = Math.abs((pulseSwitch?.at ?? -1) - BASELINE_PULSE_WIDE_AT_PX);
    expect(
      pulseDelta,
      `the pulse-shape switch is the control arm and must stay at ${BASELINE_PULSE_WIDE_AT_PX}px (±1); it moved to ${pulseSwitch?.at}px`,
    ).toBeLessThanOrEqual(1);

    // ±20 px around the label-mode switch: one boundary, and no mode flips on either side.
    const around = rows.filter((row) => Math.abs(row.width - BASELINE_LABEL_MODE_FULL_AT_PX) <= 20);
    expect(around.map((row) => row.width), 'the scan grid must cover ±20 px around the switch').toEqual([
      BASELINE_LABEL_MODE_FULL_AT_PX - 20,
      BASELINE_LABEL_MODE_FULL_AT_PX - 10,
      BASELINE_LABEL_MODE_FULL_AT_PX,
      BASELINE_LABEL_MODE_FULL_AT_PX + 10,
      BASELINE_LABEL_MODE_FULL_AT_PX + 20,
    ]);
    for (const row of around) {
      const expected = row.width >= BASELINE_LABEL_MODE_FULL_AT_PX ? 'full' : 'icon';
      expect(
        row.mode,
        `at ${row.width}px, within ±20 px of the ${BASELINE_LABEL_MODE_FULL_AT_PX}px switch, the mode must be ${expected}; got ${row.mode}`,
      ).toBe(expected);
    }
  } finally {
    await context.close();
  }
});


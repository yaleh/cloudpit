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

    return {
      mode: tablist.getAttribute('data-workspace-tabs-mode'),
      viewport: { width: window.innerWidth, height: window.innerHeight },
      scroll: { left: scrollRect.left, right: scrollRect.right, width: scrollRect.width },
      roomWidth: room === null ? null : room.getBoundingClientRect().width,
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

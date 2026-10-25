import path from 'node:path';

import { expect, request, test } from '@playwright/test';
import type { APIRequestContext, Browser, BrowserContext, Page } from '@playwright/test';

import {
  awaitClientMounted,
  warmClientStartup,
  type RequestFailure,
} from './support/client-startup-warmup';
import {
  writeFitContractFixture,
  type FitContractFixtureReading,
} from './support/architectureFixture';

/**
 * The architecture panel's compact chrome, on a real page.
 *
 * At 1440×900 with the sidebar expanded the panel is about 1126px wide. The
 * desktop toolbar used to wrap into two rows there (its right-hand controls —
 * Fullscreen / Export ▾ / Legend — were the overflow), and the in-flow readout
 * row spent a second line on the filter reading. Both cost the drawing height.
 *
 * This criterion reads the two chrome boxes and their contents:
 *
 *  1. `[data-architecture-toolbar]` is ONE row: its height is at most 52px and
 *     every visible toolbar action's `getBoundingClientRect().top` agrees;
 *  2. `[data-architecture-canvas-header]` (the in-flow readout row) is at most
 *     40px tall, with the collapsed readout's second line (Show all / Reset
 *     filters) absent until the toggle is pressed;
 *  3. Export and Legend are behind the one `⋯` trigger rather than two
 *     top-level buttons, and the three controls that stayed each carry an
 *     accessible name.
 *
 * THE FIXTURE. `writeFitContractFixture` writes the same 55-class, five-package
 * hub-and-spoke tree the fit-contract and overlay criteria measure, under the
 * run's debug-agent fixture home; the seeded user text names the hub and one
 * leader per package so the server resolves them.
 */

// The server is single-user, so every architecture criterion that may share an
// invocation signs in as the same account: the second file's `createAccount`
// then takes its login branch instead of failing on the 403.
const USERNAME = 'e2euser';
const PASSWORD = 'e2epassword';
const WORKSPACE_DIR = 'architecture-compact-chrome-workspace';

const SHOTS_DIR = path.resolve(process.cwd(), 'tmp', 'architecture-compact-chrome');

const SEL = {
  panel: '[data-workspace-view="architecture"] [data-architecture-panel]',
  toolbar: '[data-architecture-toolbar]',
  canvasHeader: '[data-architecture-canvas-header]',
  readoutToggle: '[data-architecture-readout-toggle]',
  filterShowAll: '[data-architecture-filter-show-all]',
  filterReset: '[data-architecture-filter-reset]',
  overflow: '[data-architecture-overflow-toggle]',
  overflowMenu: '[data-architecture-export-menu]',
  exportItem: '[data-architecture-export-item]',
  legendEntry: '[data-architecture-legend-entry]',
  openInNewTab: '[data-architecture-open-in-new-tab]',
  textToggle: '[data-architecture-text-toggle]',
  fullscreenToggle: '[data-architecture-fullscreen-toggle]',
  graphRoot: '[data-architecture-plantuml-graph]',
  host: '[data-architecture-plantuml]',
  node: '.uml-node[data-entity-id]',
} as const;

/* ── the fixture ─────────────────────────────────────────────────────────────────────────── */

let reading: FitContractFixtureReading | null = null;
let sessionId = '';
let token = '';
let baseURL = '';

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

/** Arm a session whose seeded user text names the fixture's hub and leaders. */
async function armScenario(
  api: APIRequestContext,
  projectPath: string,
  seedIdentifiers: readonly string[],
): Promise<string> {
  const mentioned = seedIdentifiers.map((name) => `\`${name}\``).join(', ');
  const scenario = {
    version: 1,
    dialect: 'claude',
    home: 'gate',
    transcript: { mode: 'per-row-jsonl' },
    seed: { title: 'Architecture compact chrome', userText: `Review ${mentioned} before the refactor.` },
    steps: [{ at: 0, op: 'wait' }],
    expect: { rows: { delta: 0 }, content: { mustContain: [seedIdentifiers[0] ?? ''] } },
  };
  let body: { data?: { sessionId?: unknown } } | null = null;
  let status = 0;
  for (let attempt = 0; attempt < 2; attempt += 1) {
    const response = await api.post('/api/debug-agent/scenarios', { data: { projectPath, scenario } });
    body = await response.json().catch(() => null);
    status = response.status();
    if (response.ok()) break;
    await new Promise<void>((resolve) => setTimeout(resolve, 500));
  }
  if (status < 200 || status >= 300) throw new Error(`arming failed (${status}): ${JSON.stringify(body)}`);
  const id = body?.data?.sessionId;
  if (typeof id !== 'string') throw new Error(`arming returned no sessionId: ${JSON.stringify(body)}`);
  return id;
}

test.beforeAll(async () => {
  baseURL = test.info().project.use.baseURL ?? '';
  if (baseURL === '') throw new Error('playwright.config.ts must give this project a baseURL');
  const fixtureHome = process.env.QUAY_E2E_DEBUG_AGENT_HOME;
  if (!fixtureHome) {
    throw new Error(
      'playwright.config.ts must publish QUAY_E2E_DEBUG_AGENT_HOME for this selection '
        + '(the spec is listed in DEBUG_AGENT_SPEC_FILES)',
    );
  }

  const bootstrap = await request.newContext({ baseURL });
  token = await createAccount(bootstrap);
  await bootstrap.dispose();

  const api = await request.newContext({ baseURL, extraHTTPHeaders: { Authorization: `Bearer ${token}` } });
  try {
    const workspace = path.join(fixtureHome, WORKSPACE_DIR);
    reading = writeFitContractFixture(workspace, {
      entityCount: 55,
      entityKind: 'class',
      packageCount: 5,
      labelStem: 'Compact',
    });
    sessionId = await armScenario(api, workspace, reading.seedIdentifiers);
    console.log(
      `[compact-chrome] fixture entities=${reading.entityTotal} seeds=${reading.seedIdentifiers.length} session=${sessionId}`,
    );
  } finally {
    await api.dispose();
  }
});

/* ── page driving ───────────────────────────────────────────────────────────────────────── */

let warmClientPromise: Promise<unknown> | null = null;

async function openContext(browser: Browser): Promise<BrowserContext> {
  const dataDir = process.env.QUAY_E2E_DATA_DIR;
  if (!dataDir) throw new Error('playwright.config.ts must publish QUAY_E2E_DATA_DIR');
  warmClientPromise ??= warmClientStartup(baseURL, dataDir);
  await warmClientPromise;
  // Exactly the reading the task names: 1440×900, fine pointer, no mobile flag.
  // The sidebar starts expanded at this viewport, which is the worst case.
  const context = await browser.newContext({
    baseURL,
    viewport: { width: 1440, height: 900 },
    hasTouch: false,
    isMobile: false,
  });
  await context.addInitScript(
    ({ authToken }: { authToken: string }) => {
      window.localStorage.setItem('auth-token', authToken);
      window.localStorage.setItem('userLanguage', 'en');
    },
    { authToken: token },
  );
  return context;
}

const startupEvidence: {
  pageErrors: string[];
  consoleErrors: string[];
  requestFailures: RequestFailure[];
  warmup: null;
} = { pageErrors: [], consoleErrors: [], requestFailures: [], warmup: null };

async function openSession(context: BrowserContext): Promise<Page> {
  const page = await context.newPage();
  page.on('pageerror', (error) => startupEvidence.pageErrors.push(String(error)));
  page.on('console', (message) => {
    if (message.type() === 'error') startupEvidence.consoleErrors.push(message.text());
  });
  page.on('requestfailed', (request_) => {
    startupEvidence.requestFailures.push({
      url: request_.url(),
      failureText: request_.failure()?.errorText ?? 'no error text',
    });
  });
  await page.goto(`/session/${sessionId}`, { waitUntil: 'domcontentloaded', timeout: 30_000 });
  try {
    await page.waitForFunction(
      () => [...document.querySelectorAll('[data-workspace-tab]')].some((element) => {
        const rect = element.getBoundingClientRect();
        const style = getComputedStyle(element);
        return rect.width > 0 && rect.height > 0
          && style.display !== 'none' && style.visibility !== 'hidden';
      }),
      undefined,
      { timeout: 60_000 },
    );
  } catch (error) {
    await awaitClientMounted(page, '[data-workspace-tab]', 1_000, startupEvidence);
    throw error;
  }
  return page;
}

async function settle(page: Page, ms = 350): Promise<void> {
  await page.evaluate(() => new Promise<void>((resolve) => {
    requestAnimationFrame(() => requestAnimationFrame(() => resolve()));
  }));
  await page.waitForTimeout(ms);
}

async function enterArchitecture(page: Page): Promise<void> {
  const tab = page.locator('[role="tab"][data-workspace-tab="architecture"]').first();
  await expect(tab).toBeVisible({ timeout: 30_000 });
  await tab.click();
  await expect(page.locator(SEL.panel)).toBeVisible({ timeout: 30_000 });
  await page.waitForFunction(
    ({ root, host, node }) => Number(document.querySelector(root)?.getAttribute('data-architecture-visible-nodes') ?? '0') > 0
      && (document.querySelector(host)?.querySelectorAll(node).length ?? 0) > 0,
    { root: SEL.graphRoot, host: SEL.host, node: SEL.node },
    { timeout: 40_000 },
  );
  await settle(page, 600);
}

/* ── the reading ────────────────────────────────────────────────────────────────────────── */

type ChromeReading = {
  toolbarHeight: number;
  toolbarWraps: boolean;
  actionTops: { name: string; top: number; height: number }[];
  canvasHeaderHeight: number;
  readoutExpanded: string | null;
  secondLinePresent: boolean;
  overflowPresent: boolean;
  exportTopLevelPresent: boolean;
  legendTopLevelPresent: boolean;
  actionNames: Record<string, string | null>;
  sidebarExpanded: boolean;
  panelWidth: number;
  visibleButtons: { name: string; top: number; height: number }[];
};

/** One structured read of the two chrome boxes and the controls inside them. */
async function readChrome(page: Page): Promise<ChromeReading> {
  return page.evaluate((sel) => {
    const toolbar = document.querySelector(sel.toolbar);
    if (!(toolbar instanceof HTMLElement)) throw new Error('the architecture toolbar is not on screen');
    const header = document.querySelector(sel.canvasHeader);
    if (!(header instanceof HTMLElement)) throw new Error('the in-flow readout row is not on screen');

    const toolbarRect = toolbar.getBoundingClientRect();
    // The four actions the one-line row has to keep aligned. Each is a marker
    // rather than a class walk: the group disclosures sit in their own boxes.
    const actionSelectors = [
      ['open-in-new-tab', sel.openInNewTab],
      ['text', sel.textToggle],
      ['fullscreen', sel.fullscreenToggle],
      ['overflow', sel.overflow],
    ] as const;
    const actionTops = actionSelectors.map(([name, selector]) => {
      const element = toolbar.querySelector(selector);
      if (!(element instanceof HTMLElement)) throw new Error(`the ${name} control is missing from the toolbar`);
      const rect = element.getBoundingClientRect();
      return { name, top: rect.top, height: rect.height };
    });

    return {
      toolbarHeight: toolbarRect.height,
      toolbarWraps: actionTops.some((action) => Math.abs(action.top - actionTops[0].top) > 1),
      actionTops,
      canvasHeaderHeight: header.getBoundingClientRect().height,
      readoutExpanded: document.querySelector(sel.readoutToggle)?.getAttribute('aria-expanded') ?? null,
      secondLinePresent: document.querySelector(sel.filterShowAll) !== null
        || document.querySelector(sel.filterReset) !== null,
      overflowPresent: document.querySelector(sel.overflow) !== null,
      exportTopLevelPresent: toolbar.querySelector('[data-architecture-export="true"]') !== null,
      legendTopLevelPresent: toolbar.querySelector('[data-architecture-legend-toggle]') !== null,
      actionNames: {
        openInNewTab: document.querySelector(sel.openInNewTab)?.getAttribute('aria-label') ?? null,
        text: document.querySelector(sel.textToggle)?.getAttribute('aria-label') ?? null,
        fullscreen: document.querySelector(sel.fullscreenToggle)?.getAttribute('aria-label') ?? null,
        overflow: document.querySelector(sel.overflow)?.getAttribute('aria-label') ?? null,
      },
      sidebarExpanded: document.querySelectorAll('[data-sidebar="expanded"], aside').length > 0,
      panelWidth: document.querySelector(sel.panel)?.getBoundingClientRect().width ?? 0,
      // Every button the toolbar draws, so the reading can say whether the row
      // really is one band rather than only that the four remembered actions are.
      visibleButtons: [...toolbar.querySelectorAll('button')]
        .map((button) => {
          const rect = button.getBoundingClientRect();
          return {
            name: button.getAttribute('aria-label') ?? button.textContent?.trim().slice(0, 24) ?? '',
            top: Math.round(rect.top * 10) / 10,
            height: Math.round(rect.height * 10) / 10,
          };
        })
        .filter((button) => button.height > 0),
    };
  }, SEL);
}

test('the architecture chrome is one toolbar row and one readout line at 1440x900 with the sidebar open', async ({ browser }) => {
  const context = await openContext(browser);
  try {
    const page = await openSession(context);
    await enterArchitecture(page);

    const chrome = await readChrome(page);
    console.log(`[compact-chrome] ${JSON.stringify(chrome)}`);
    await page.screenshot({ path: path.join(SHOTS_DIR, 'desktop-one-line.png') });

    // ① The toolbar is one row.
    expect(chrome.panelWidth, `the expanded sidebar must leave the panel ~1126px (got ${chrome.panelWidth})`).toBeLessThan(1200);
    expect(chrome.toolbarHeight, `the toolbar must be one 52px row; got ${chrome.toolbarHeight}px`).toBeLessThanOrEqual(52);
    expect(chrome.toolbarWraps, `every toolbar action must share one row top; got ${JSON.stringify(chrome.actionTops)}`).toBe(false);

    // ② Export and Legend moved behind the one `⋯`; the three controls that
    //    stayed keep their accessible names.
    expect(chrome.overflowPresent).toBe(true);
    expect(chrome.exportTopLevelPresent).toBe(false);
    expect(chrome.legendTopLevelPresent).toBe(false);
    for (const [name, label] of Object.entries(chrome.actionNames)) {
      expect(label, `the ${name} control must have an accessible name`).toBeTruthy();
    }

    // ③ The in-flow readout row is one line: collapsed, with its second line
    //    (Show all / Reset filters) absent from the DOM.
    expect(chrome.canvasHeaderHeight, `the readout row must be at most 40px; got ${chrome.canvasHeaderHeight}px`).toBeLessThanOrEqual(40);
    expect(chrome.readoutExpanded).toBe('false');
    expect(chrome.secondLinePresent).toBe(false);
    // Nothing in the toolbar may start a second band: the tallest-to-shortest
    // button top is under 2px (a wrapped row would be ~20px apart). The four
    // remembered actions are held to EXACT equality above.
    const tops = chrome.visibleButtons.map((button) => button.top);
    expect(
      Math.max(...tops) - Math.min(...tops),
      `every toolbar button must sit on one band; got ${JSON.stringify(chrome.visibleButtons)}`,
    ).toBeLessThanOrEqual(2);
    expect(await page.locator('[data-architecture-readout-detail="true"]').count()).toBe(0);

    // ④ The overflow really holds the five formats and the legend door, and
    //    the legend opens from it.
    await page.locator(SEL.overflow).click();
    const menu = page.locator(SEL.overflowMenu);
    await expect(menu).toBeVisible({ timeout: 10_000 });
    expect(await menu.locator(SEL.exportItem).count()).toBe(5);
    await expect(menu.locator(SEL.legendEntry)).toBeVisible();
    await page.screenshot({ path: path.join(SHOTS_DIR, 'desktop-overflow-menu.png') });
    await menu.locator(SEL.legendEntry).click();
    await expect(page.locator('[data-architecture-legend="true"]')).toBeVisible({ timeout: 10_000 });
    await page.screenshot({ path: path.join(SHOTS_DIR, 'desktop-legend-from-overflow.png') });

    // ⑤ Expanding the readout brings its detail back without changing the
    //    toolbar row.
    await page.keyboard.press('Escape');
    await settle(page, 250);
    await expect(page.locator('[data-architecture-legend="true"]')).toHaveCount(0);
    await page.locator(SEL.readoutToggle).click();
    await expect(page.locator('[data-architecture-readout-detail="true"]')).toBeVisible({ timeout: 10_000 });
    const expanded = await readChrome(page);
    expect(expanded.readoutExpanded).toBe('true');
    expect(expanded.toolbarHeight, 'opening the readout must not wrap the toolbar').toBeLessThanOrEqual(52);
    expect(expanded.canvasHeaderHeight, 'the expanded readout is the taller state').toBeGreaterThan(chrome.canvasHeaderHeight);
    await page.screenshot({ path: path.join(SHOTS_DIR, 'desktop-readout-expanded.png') });

    // The page threw nothing across the whole walk. Resource-level console
    // noise (the fixture's project has no real sources, so some endpoints
    // answer 4xx) is logged, not asserted: it says nothing about the chrome.
    expect(startupEvidence.pageErrors, `page errors: ${JSON.stringify(startupEvidence.pageErrors)}`).toEqual([]);
    if (startupEvidence.consoleErrors.length > 0) {
      console.log(`[compact-chrome] console noise (ignored): ${JSON.stringify(startupEvidence.consoleErrors)}`);
    }
  } finally {
    await context.close();
  }
});

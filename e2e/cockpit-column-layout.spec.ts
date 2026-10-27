import fs from 'node:fs';
import path from 'node:path';

import { expect, request, test } from '@playwright/test';
import type { APIRequestContext, Browser, BrowserContext, Page } from '@playwright/test';

import {
  awaitClientMounted,
  navigateClientBounded,
  warmClientStartup,
} from './support/client-startup-warmup';
import type { ClientStartupEvidence } from './support/client-startup-warmup';

/**
 * The PC cockpit column's page geometry, read from a real browser.
 *
 * THE THREE READINGS THIS FILE EXISTS FOR — none of them visible to jsdom:
 *
 *   1. SQUEEZE (≥1280): the expanded column runs from the top of the page to the bottom
 *      (`top ≤ 1`, `height ≥ viewport − 1`) and the session header ENDS where the column begins
 *      (`header.right ≤ column.left + 1`). Both follow from the column being a sibling of the whole
 *      session area (header + views + composer) rather than a child of the content row. Collapsing
 *      it returns the header to exactly the right edge it had before expanding.
 *   2. OVERLAY (900–1279): the column still covers the full page height, and the chat's
 *      input-outline handle yields while it does — the handle is anchored to the session area's
 *      right edge, which the overlay paints over. Collapsing the column brings the handle back.
 *
 * THE FIXTURE. A debug-agent scenario arms one real session in a workspace under the run's fixture
 * home, exactly like `workspace-tabs-fit.spec.ts`; the cockpit itself is switched on by the run's
 * server-settings file, which `playwright.config.ts` writes because this file is named in
 * `COCKPIT_SPEC_FILES`.
 */

const USERNAME = 'cockpit-column-layout-e2e';
const PASSWORD = 'cockpit-column-layout-e2e-pass';
const FIXTURE_WORKSPACE = 'cockpit-column-layout-workspace';

/** Tags console evidence so a failing gate's tail names the leg that produced it. */
const TAG = '[cockpit-column-layout]';

/** The two viewports the criterion names. */
const SQUEEZE_VIEWPORT = { width: 1440, height: 900 } as const;
const OVERLAY_VIEWPORT = { width: 1100, height: 800 } as const;

/** Where the DoD's screenshots land; `tmp/` is git-ignored. */
const SHOT_DIR = path.join(process.cwd(), 'tmp');

let baseURL = '';
let token = '';
let sessionId = '';

/** Page/console/request evidence, so a mount failure names the run that produced it. */
const startupEvidence: ClientStartupEvidence = {
  pageErrors: [],
  consoleErrors: [],
  requestFailures: [],
  warmup: null,
};

/** One DOM box, in viewport pixels. */
type Box = { top: number; left: number; right: number; bottom: number; width: number; height: number };

type LayoutReading = {
  viewport: { width: number; height: number };
  column: Box | null;
  header: Box | null;
  /** The input-outline handle's box, or null when it is not rendered at all. */
  outlineHandle: Box | null;
};

/* ── the fixture and the session ────────────────────────────────────────────── */

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
    seed: { title: 'Cockpit column layout', userText },
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

test.describe.configure({ mode: 'serial' });

test.beforeAll(async () => {
  baseURL = test.info().project.use.baseURL ?? '';
  if (baseURL === '') throw new Error('playwright.config.ts must give this project a baseURL');

  const fixtureHome = process.env.QUAY_E2E_DEBUG_AGENT_HOME;
  if (!fixtureHome) {
    throw new Error(
      'playwright.config.ts must publish QUAY_E2E_DEBUG_AGENT_HOME for this selection '
        + '(cockpit-column-layout.spec.ts is listed in DEBUG_AGENT_SPEC_FILES)',
    );
  }
  const dataDir = process.env.QUAY_E2E_DATA_DIR;
  if (!dataDir) throw new Error('playwright.config.ts must publish QUAY_E2E_DATA_DIR');

  const workspace = path.join(fixtureHome, FIXTURE_WORKSPACE);
  fs.mkdirSync(workspace, { recursive: true });

  const bootstrap = await request.newContext({ baseURL });
  token = await createAccount(bootstrap);
  await bootstrap.dispose();

  const api = await request.newContext({
    baseURL,
    extraHTTPHeaders: { Authorization: `Bearer ${token}` },
  });
  sessionId = await armScenario(
    api,
    workspace,
    'Please review the cockpit column layout on this session page.',
    'cockpit column layout',
  );
  await api.dispose();

  // Take the run's first dependency optimization out of the measurement window before any page
  // exists; the same guard `workspace-tabs-fit.spec.ts` uses, so a replaced document cannot read
  // as a layout red.
  startupEvidence.warmup = await warmClientStartup(baseURL, dataDir);

  fs.mkdirSync(SHOT_DIR, { recursive: true });
  console.log(`${TAG} session=${sessionId}`);
  console.log(`${TAG} warmup=${startupEvidence.warmup.elapsedMs}ms`);
});

/* ── opening a page and reading the boxes ──────────────────────────────────── */

async function openSessionPage(
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
  page.on('requestfailed', (request_) => {
    startupEvidence.requestFailures.push({
      url: request_.url(),
      failureText: request_.failure()?.errorText ?? 'no error text',
    });
  });

  await navigateClientBounded(page, `/session/${sessionId}`, 'header[data-app-header]', startupEvidence);
  await expect(
    page.getByTestId('cockpit-header-button'),
    'the cockpit is enabled for this run, so the session header offers its entry point',
  ).toBeVisible({ timeout: 20_000 });
  await awaitClientMounted(page, '[role="tablist"]', 30_000, startupEvidence);
  return { context, page };
}

/** One structured reading of the boxes this criterion is about, in a single round trip. */
const readLayout = (page: Page): Promise<LayoutReading> =>
  page.evaluate(() => {
    const boxOf = (element: Element | null): Box | null => {
      if (!(element instanceof HTMLElement)) return null;
      const rect = element.getBoundingClientRect();
      return {
        top: rect.top,
        left: rect.left,
        right: rect.right,
        bottom: rect.bottom,
        width: rect.width,
        height: rect.height,
      };
    };
    return {
      viewport: { width: window.innerWidth, height: window.innerHeight },
      column: boxOf(document.querySelector('[data-testid="cockpit-column"]')),
      header: boxOf(document.querySelector('header[data-app-header]')),
      outlineHandle: boxOf(document.querySelector('[data-input-outline-handle]')),
    };
  });

test('1440×900: the squeeze column runs head-to-foot and the session header ends at its left edge', async ({
  browser,
}) => {
  const { context, page } = await openSessionPage(browser, SQUEEZE_VIEWPORT);
  try {
    const before = await readLayout(page);
    expect(before.header, 'the session header is measured before expanding').not.toBeNull();

    await page.getByTestId('cockpit-header-button').click();
    const column = page.getByTestId('cockpit-column');
    await expect(column).toBeVisible();
    await expect(column).toHaveAttribute('data-cockpit-column-layout', 'squeeze');

    const open = await readLayout(page);
    await page.screenshot({ path: path.join(SHOT_DIR, 'cockpit-pc-column-1440-open.png'), fullPage: true });
    console.log(`${TAG} squeeze-open ${JSON.stringify(open)}`);

    expect(open.column, 'the expanded column is on the page').not.toBeNull();
    expect(open.header, 'the session header still renders beside the column').not.toBeNull();
    // Head to foot: the column starts at the page top and is as tall as the viewport.
    expect(open.column!.top, JSON.stringify(open)).toBeLessThanOrEqual(1);
    expect(open.column!.height, JSON.stringify(open)).toBeGreaterThanOrEqual(open.viewport.height - 1);
    // The header gives up exactly the column's width: it ends where the column begins.
    expect(open.header!.right, JSON.stringify(open)).toBeLessThanOrEqual(open.column!.left + 1);

    // Collapse from the column's OWN title row, then read the header's restored width.
    await page.getByTestId('cockpit-column-collapse').click();
    await expect(page.getByTestId('cockpit-column')).toHaveCount(0);
    const after = await readLayout(page);
    await page.screenshot({ path: path.join(SHOT_DIR, 'cockpit-pc-column-1440-closed.png'), fullPage: true });
    console.log(`${TAG} squeeze-closed ${JSON.stringify(after)}`);

    expect(after.header, 'the header renders after collapsing').not.toBeNull();
    expect(
      Math.abs(after.header!.right - before.header!.right),
      `header right before=${before.header!.right} after=${after.header!.right} (reading ${JSON.stringify({ before, after })})`,
    ).toBeLessThanOrEqual(1);
  } finally {
    await context.close();
  }
});

test('1100×800: the overlay column is full height and the input-outline handle yields while it is open', async ({
  browser,
}) => {
  const { context, page } = await openSessionPage(browser, OVERLAY_VIEWPORT);
  try {
    // Closed: the handle is the session's own edge control and is on screen.
    await expect(page.locator('[data-input-outline-handle]')).toHaveCount(1);
    const before = await readLayout(page);
    expect(before.column).toBeNull();

    await page.getByTestId('cockpit-header-button').click();
    const column = page.getByTestId('cockpit-column');
    await expect(column).toBeVisible();
    await expect(column).toHaveAttribute('data-cockpit-column-layout', 'overlay');

    const open = await readLayout(page);
    await page.screenshot({ path: path.join(SHOT_DIR, 'cockpit-pc-column-1100-open.png'), fullPage: true });
    console.log(`${TAG} overlay-open ${JSON.stringify(open)}`);

    // Full-height coverage, from the page top.
    expect(open.column).not.toBeNull();
    expect(open.column!.top, JSON.stringify(open)).toBeLessThanOrEqual(1);
    expect(open.column!.height, JSON.stringify(open)).toBeGreaterThanOrEqual(open.viewport.height - 1);
    // The handle must not sit on the cards: not rendered, so nothing intersects.
    expect(open.outlineHandle, JSON.stringify(open)).toBeNull();
    await expect(page.locator('[data-input-outline-handle]')).toHaveCount(0);

    // Closing the column gives the session its edge handle back.
    await page.getByTestId('cockpit-column-collapse').click();
    await expect(page.getByTestId('cockpit-column')).toHaveCount(0);
    await expect(page.locator('[data-input-outline-handle]')).toHaveCount(1);
    const after = await readLayout(page);
    await page.screenshot({ path: path.join(SHOT_DIR, 'cockpit-pc-column-1100-closed.png'), fullPage: true });
    console.log(`${TAG} overlay-closed ${JSON.stringify(after)}`);
    expect(after.outlineHandle, JSON.stringify(after)).not.toBeNull();
  } finally {
    await context.close();
  }
});

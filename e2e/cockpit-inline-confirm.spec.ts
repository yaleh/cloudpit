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
 * The cockpit's in-place confirmation, measured on a real page.
 *
 * WHAT ONLY A BROWSER CAN SAY. The criterion is a DISTANCE: the button a person presses to open
 * the confirm state and the button they press again to send must be the same pixels, so a
 * confirmation is two presses in one spot rather than a caret jump to a dialog at the window's
 * bottom. jsdom has no layout, so the unit suites can only prove the element is the same node;
 * this file reads `getBoundingClientRect()` on both sides of the first press, at the two
 * viewports the design names, and prints both centres in the failure message.
 *
 * The fixture is the server's own: `cockpit.fixtureCards` is switched on for this selection only
 * (`playwright.config.ts`), so the cards, their two-step confirm and the `fixture.record`
 * executor's running total are the product's, not a page-side stub. The executor's `total` in
 * the `/api/cockpit/cards/confirm` answer is how "exactly one record was added" is read — there
 * is no read endpoint for the log, and counting the responses would not prove the executor ran.
 *
 * TWO VIEWPORTS, ONE RULE. 1440×900 opens the PC column from a session page (the column is the
 * PC surface); 390×844 is the phone's cards page (`/cockpit?view=cards`). Both read the same
 * distance, the same single record, and the same automatic retreat.
 */

const USERNAME = 'cockpit-inline-confirm-e2e';
const PASSWORD = 'cockpit-inline-confirm-e2e-pass';
const FIXTURE_WORKSPACE = 'cockpit-inline-confirm-workspace';

/** Tags console evidence so a failing gate's tail names the leg that produced it. */
const TAG = '[cockpit-inline-confirm]';

const PC_VIEWPORT = { width: 1440, height: 900 } as const;
const PHONE_VIEWPORT = { width: 390, height: 844 } as const;

/** The retreat window is 6 s; the wait below leaves room for a slow turn on a loaded host. */
const RETREAT_WAIT_MS = 15_000;
/** The criterion's tolerance for "the same spot". */
const CENTER_TOLERANCE_PX = 1;

const SHOT_DIR = path.join(process.cwd(), 'tmp');

let baseURL = '';
let token = '';
let sessionId = '';

/**
 * The executor's running total as of the last confirmation this file sent. The two legs share one
 * server process, so the phone leg's total continues the PC leg's; the spec tracks what IT has
 * sent rather than assuming the log started empty.
 */
let recordsSent = 0;

const startupEvidence: ClientStartupEvidence = {
  pageErrors: [],
  consoleErrors: [],
  requestFailures: [],
  warmup: null,
};

type Point = { x: number; y: number };

/** One reading of a card's confirm bar, in viewport pixels, taken in a single round trip. */
type ConfirmReading = {
  cardId: string;
  /** The action button's centre — the SAME button in both states. */
  center: Point;
  rect: { top: number; left: number; width: number; height: number };
  mode: string | null;
  /** The card whose bar publishes the confirm state, or null when no bar is pending. */
  pendingCardId: string | null;
  /** The removed dialog's testid, read so its absence is evidence rather than an assumption. */
  panelPresent: boolean;
  /** The computed `position` of the bar that holds the button (`fixed` would be the defect). */
  barPosition: string;
  /** The confirm button's own computed `position`. */
  buttonPosition: string;
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
    seed: { title: 'Cockpit inline confirm', userText },
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
        + '(cockpit-inline-confirm.spec.ts is listed in DEBUG_AGENT_SPEC_FILES)',
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
    'Open the cockpit column and confirm a card in place.',
    'cockpit inline confirm',
  );
  await api.dispose();

  startupEvidence.warmup = await warmClientStartup(baseURL, dataDir);

  fs.mkdirSync(SHOT_DIR, { recursive: true });
  console.log(`${TAG} session=${sessionId}`);
  console.log(`${TAG} warmup=${startupEvidence.warmup.elapsedMs}ms`);
});

/* ── the page, and the two readings ────────────────────────────────────────── */

async function openPage(
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
  return { context, page };
}

/** Reads one card's confirm bar: the button's box and state, in viewport pixels. */
const readConfirm = (page: Page, cardId: string): Promise<ConfirmReading | null> =>
  page.evaluate((id) => {
    const card = Array.from(document.querySelectorAll('[data-cockpit-card-id]')).find(
      (candidate) => candidate.getAttribute('data-cockpit-card-id') === id,
    );
    if (!(card instanceof HTMLElement)) return null;
    const button = card.querySelector('[data-testid="cockpit-card-confirm"]');
    if (!(button instanceof HTMLElement)) return null;
    const rect = button.getBoundingClientRect();
    const pendingBar = document.querySelector('[data-confirm-pending="true"]');
    const bar = button.closest('[data-testid$="confirm-bar"]');
    return {
      cardId: id,
      center: { x: rect.left + rect.width / 2, y: rect.top + rect.height / 2 },
      rect: { top: rect.top, left: rect.left, width: rect.width, height: rect.height },
      mode: button.getAttribute('data-confirm-mode'),
      pendingCardId:
        pendingBar instanceof HTMLElement ? pendingBar.getAttribute('data-card-id') : null,
      panelPresent: document.querySelector('[data-testid="cockpit-card-confirm-panel"]') !== null,
      barPosition: bar instanceof HTMLElement ? getComputedStyle(bar).position : 'absent',
      buttonPosition: getComputedStyle(button).position,
    };
  }, cardId);

const distance = (a: Point, b: Point): number => Math.hypot(a.x - b.x, a.y - b.y);

/**
 * The two presses, with the distance read around them.
 *
 * The first press opens the state in place; the second sends. The measurement is taken between
 * exactly those two presses — the state the criterion is about is the one that exists while the
 * person is deciding whether to press again. The button is scrolled into view BEFORE the first
 * reading, so the press's own auto-scroll cannot be mistaken for the state moving the button.
 */
async function pressOpenAndMeasure(page: Page, cardId: string): Promise<{
  before: ConfirmReading;
  pending: ConfirmReading;
  gap: number;
  button: ReturnType<Page['locator']>;
}> {
  const button = page
    .locator(`[data-cockpit-card-id="${cardId}"]`)
    .getByTestId('cockpit-card-confirm');
  await button.scrollIntoViewIfNeeded();
  await expect(button).toBeVisible();

  const before = await readConfirm(page, cardId);
  expect(before, `the fixture card ${cardId} draws its confirm bar`).not.toBeNull();
  expect(before!.mode, 'the bar is idle before the first press').toBe('open');
  expect(before!.panelPresent, 'no confirm dialog is on the page before the press').toBe(false);

  await button.click();
  await expect(button).toHaveAttribute('data-confirm-mode', 'send');

  const pending = await readConfirm(page, cardId);
  expect(pending).not.toBeNull();
  return { before: before!, pending: pending!, gap: distance(before!.center, pending!.center), button };
}

function describeReading(reading: ConfirmReading): string {
  return JSON.stringify({
    center: reading.center,
    rect: reading.rect,
    mode: reading.mode,
    pendingCardId: reading.pendingCardId,
  });
}

/**
 * Asserts the in-place rule on one reading pair. The message carries BOTH centres, which is what
 * the criterion asks a failure to print.
 */
function expectSameSpot(gap: number, before: ConfirmReading, pending: ConfirmReading): void {
  expect(
    gap,
    `confirm button moved between the two presses: before=${describeReading(before)} `
      + `pending=${describeReading(pending)} distance=${gap}px`,
  ).toBeLessThanOrEqual(CENTER_TOLERANCE_PX);
  expect(pending.panelPresent, 'no fixed confirm panel is mounted').toBe(false);
  expect(pending.barPosition, 'the bar is not position:fixed').not.toBe('fixed');
  expect(pending.buttonPosition, 'the button itself is not position:fixed').not.toBe('fixed');
  expect(pending.pendingCardId, 'the card itself publishes its confirm state').toBe(pending.cardId);
}

/** Reads the executor's running total out of the confirmation answer this click produced. */
async function sendAndReadTotal(page: Page, button: ReturnType<Page['locator']>): Promise<number> {
  const [answer] = await Promise.all([
    page.waitForResponse(
      (response) =>
        response.url().includes('/api/cockpit/cards/confirm')
        && response.request().method() === 'POST',
    ),
    button.click(),
  ]);
  expect(answer.ok(), `the confirmation answered ${answer.status()}`).toBe(true);
  const body = (await answer.json()) as { result?: { total?: unknown } };
  expect(typeof body.result?.total, `the answer names the executor total: ${JSON.stringify(body)}`).toBe(
    'number',
  );
  return body.result!.total as number;
}

/**
 * Waits for the confirm state to retreat on its own, then proves it sent nothing.
 *
 * The retreat is read two ways, neither of them a clock: the button returns to `open` with NO
 * outcome in its bar (a send would have left one), and a real send afterwards moves the
 * executor's total by exactly one. If the retreat had sent, that later total would be two
 * higher — the reading is the server's log, not the spec's own bookkeeping.
 */
async function expectRetreatThenSend(
  page: Page,
  cardId: string,
  totalBefore: number,
  shotPath: string,
): Promise<number> {
  const card = page.locator(`[data-cockpit-card-id="${cardId}"]`);
  const button = card.getByTestId('cockpit-card-confirm');
  await button.scrollIntoViewIfNeeded();
  await button.click();
  await expect(button).toHaveAttribute('data-confirm-mode', 'send');
  const armed = await readConfirm(page, cardId);
  expect(armed?.pendingCardId, 'the second card publishes its own confirm state').toBe(cardId);
  console.log(`${TAG} armed ${cardId} ${JSON.stringify(armed?.center)}`);

  await expect(button).toHaveAttribute('data-confirm-mode', 'open', { timeout: RETREAT_WAIT_MS });
  await expect(card.getByTestId('cockpit-card-confirm-outcome')).toHaveCount(0);
  const retreated = await readConfirm(page, cardId);
  expect(retreated, 'the card is still drawn after the retreat').not.toBeNull();
  expect(retreated!.pendingCardId, 'no bar is in its confirm state any more').toBeNull();
  expect(retreated!.center, 'the retreated state is the idle state, in the same spot').toEqual(
    armed!.center,
  );
  console.log(`${TAG} retreated ${cardId} ${JSON.stringify(retreated!.center)}`);
  await page.screenshot({ path: shotPath });

  await button.click();
  await expect(button).toHaveAttribute('data-confirm-mode', 'send');
  const total = await sendAndReadTotal(page, button);
  expect(
    total,
    `the retreat added no record: before=${totalBefore} afterTheNextSend=${total}`,
  ).toBe(totalBefore + 1);
  return total;
}

/* ── the two legs ──────────────────────────────────────────────────────────── */

test('1440×900 PC column: the two presses are the same pixels and add exactly one record', async ({
  browser,
}) => {
  const { context, page } = await openPage(browser, PC_VIEWPORT);
  try {
    await navigateClientBounded(page, `/session/${sessionId}`, 'header[data-app-header]', startupEvidence);
    await expect(page.getByTestId('cockpit-header-button')).toBeVisible({ timeout: 20_000 });
    await awaitClientMounted(page, '[role="tablist"]', 30_000, startupEvidence);
    await page.getByTestId('cockpit-header-button').click();
    const column = page.getByTestId('cockpit-column');
    await expect(column).toBeVisible();
    await expect(column).toHaveAttribute('data-cockpit-column-layout', 'squeeze');

    const need = page.locator('[data-cockpit-card-id="fixture:need"]');
    await expect(need).toBeVisible({ timeout: 20_000 });
    await expect(need.getByTestId('cockpit-card-confirm')).toBeVisible();

    const { before, pending, gap, button } = await pressOpenAndMeasure(page, 'fixture:need');
    console.log(
      `${TAG} pc before=${JSON.stringify(before.center)} pending=${JSON.stringify(pending.center)} gap=${gap}`,
    );
    expectSameSpot(gap, before, pending);
    await page.screenshot({ path: path.join(SHOT_DIR, 'cockpit-inline-confirm-pc-open.png') });

    const total = await sendAndReadTotal(page, button);
    expect(total, 'exactly one fixture executor record was added').toBe(recordsSent + 1);
    recordsSent = total;

    // Success is reported in the card's own bar, not in a dialog or a page-level banner.
    await expect(need.getByTestId('cockpit-card-confirm-outcome')).toHaveText('Sent ✓');
    await page.screenshot({ path: path.join(SHOT_DIR, 'cockpit-inline-confirm-pc-sent.png') });

    recordsSent = await expectRetreatThenSend(
      page,
      'fixture:stuck',
      recordsSent,
      path.join(SHOT_DIR, 'cockpit-inline-confirm-pc-retreated.png'),
    );

    expect(startupEvidence.pageErrors, JSON.stringify(startupEvidence)).toEqual([]);
  } finally {
    await context.close();
  }
});

test('390×844 phone cards page: the two presses are the same pixels and add exactly one record', async ({
  browser,
}) => {
  const { context, page } = await openPage(browser, PHONE_VIEWPORT);
  try {
    await navigateClientBounded(
      page,
      '/cockpit?view=cards',
      '[data-cockpit-card-id="fixture:need"]',
      startupEvidence,
    );
    const need = page.locator('[data-cockpit-card-id="fixture:need"]');
    await expect(need.getByTestId('cockpit-card-confirm')).toBeVisible();

    const { before, pending, gap, button } = await pressOpenAndMeasure(page, 'fixture:need');
    console.log(
      `${TAG} phone before=${JSON.stringify(before.center)} pending=${JSON.stringify(pending.center)} gap=${gap}`,
    );
    expectSameSpot(gap, before, pending);
    await page.screenshot({ path: path.join(SHOT_DIR, 'cockpit-inline-confirm-phone-open.png') });

    const total = await sendAndReadTotal(page, button);
    expect(total, 'exactly one fixture executor record was added').toBe(recordsSent + 1);
    recordsSent = total;

    await expect(need.getByTestId('cockpit-card-confirm-outcome')).toHaveText('Sent ✓');
    await page.screenshot({ path: path.join(SHOT_DIR, 'cockpit-inline-confirm-phone-sent.png') });

    recordsSent = await expectRetreatThenSend(
      page,
      'fixture:stuck',
      recordsSent,
      path.join(SHOT_DIR, 'cockpit-inline-confirm-phone-retreated.png'),
    );

    expect(startupEvidence.pageErrors, JSON.stringify(startupEvidence)).toEqual([]);
  } finally {
    await context.close();
  }
});

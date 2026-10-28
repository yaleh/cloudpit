import fs from 'node:fs';
import path from 'node:path';

import { expect, request, test } from '@playwright/test';
import type { APIRequestContext, Browser, BrowserContext, Page, Response } from '@playwright/test';

import {
  awaitClientMounted,
  navigateClientBounded,
  warmClientStartup,
} from './support/client-startup-warmup';
import type { ClientStartupEvidence } from './support/client-startup-warmup';

/**
 * The cockpit's in-place confirmation, measured on a real page.
 *
 * WHAT ONLY A BROWSER CAN SAY. The criterion is a DISTANCE: the button a person presses to open a
 * confirmation and the button they press again (to cancel a countdown, or to send an irreversible
 * option) must be the same pixels. jsdom has no layout, so the unit suites can only prove the
 * element is the same node; this file reads `getBoundingClientRect()` around the press, at the two
 * viewports the design names, and prints both centres in the failure message.
 *
 * TWO FLOWS, ONE BAR. A reversible option gets ONE press: the same button becomes the countdown
 * (「正在发送 · 点击取消（N s）」 with a progress fill) and the send leaves when the five seconds
 * run out — unless the person presses the same button again, which cancels without sending. An
 * irreversible option keeps the old two-press confirmation; its ⚠ caption floats ABOVE the button
 * (`absolute bottom-full`) so neither flow moves the button. Both flows draw no idle hint row.
 *
 * THE FIXTURE IS THE SERVER'S OWN: `cockpit.fixtureCards` is switched on for this selection only
 * (`playwright.config.ts`), so the cards, their options and the `fixture.record` executor's running
 * total are the product's, not a page-side stub. The executor's `total` in the
 * `/api/cockpit/cards/confirm` answer is how "exactly one record was added" (and "the cancelled
 * countdown added none") is read — there is no read endpoint for the log, and counting responses
 * would not prove the executor ran.
 *
 * TWO VIEWPORTS, ONE RULE. 1440×900 opens the PC column from a session page (the column is the PC
 * surface); 390×844 is the phone's cards page (`/cockpit?view=cards`). Both run the same three
 * legs: a countdown send, a cancelled countdown proven by a later send, and the irreversible
 * two-press flow on `fixture:stuck`'s Park option.
 */

const USERNAME = 'cockpit-inline-confirm-e2e';
const PASSWORD = 'cockpit-inline-confirm-e2e-pass';
const FIXTURE_WORKSPACE = 'cockpit-inline-confirm-workspace';

/** Tags console evidence so a failing gate's tail names the leg that produced it. */
const TAG = '[cockpit-inline-confirm]';

const PC_VIEWPORT = { width: 1440, height: 900 } as const;
const PHONE_VIEWPORT = { width: 390, height: 844 } as const;

/** The product's countdown; the floor below is what "it really waited" is read against. */
const COUNTDOWN_MS = 5_000;
const COUNTDOWN_FLOOR_MS = COUNTDOWN_MS - 500;
/** The countdown send happens 5 s after the press, plus the request's own round trip. */
const CONFIRM_ANSWER_TIMEOUT_MS = 20_000;
/** Waiting past the deadline after a cancel is the point: a missed cancel would send here. */
const CANCEL_GUARD_MS = COUNTDOWN_MS + 1_500;
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
type Rect = { top: number; left: number; width: number; height: number };

/** One reading of a card's confirm bar, in viewport pixels, taken in a single round trip. */
type ConfirmReading = {
  cardId: string;
  /** The action button's centre — the SAME button in every state. */
  center: Point;
  rect: Rect;
  mode: string | null;
  /** The countdown label's seconds reading, present only while counting. */
  seconds: number | null;
  /** The card whose bar publishes the confirm state, or null when no bar is pending. */
  pendingCardId: string | null;
  /** The removed dialog's testid, read so its absence is evidence rather than an assumption. */
  panelPresent: boolean;
  /** The computed `position` of the bar that holds the button (`fixed` would be the defect). */
  barPosition: string;
  /** The confirm button's own computed `position`. */
  buttonPosition: string;
  /** The removed idle hint row: it must never be drawn, in either state. */
  hintPresent: boolean;
  /** The floating caption row's text, when one is drawn (irreversible pending state only). */
  captionText: string | null;
  /** The floating caption row's computed `position` and box. */
  captionPosition: string | null;
  captionRect: Rect | null;
  /** The card's own top edge: if it moved with the button, the page scrolled, not the bar. */
  cardTop: number;
  /** The summed scrollTop of the button's ancestors — a scroll between readings, not a reflow. */
  scrollOffset: number;
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

/* ── the page, and the readings ────────────────────────────────────────────── */

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
    const hint = card.querySelector('[data-testid="cockpit-card-confirm-hint"]');
    const caption = card.querySelector('[data-testid="cockpit-card-confirm-message"]');
    const captionRow = caption instanceof HTMLElement ? caption.parentElement : null;
    const captionRect = captionRow instanceof HTMLElement ? captionRow.getBoundingClientRect() : null;
    const seconds = button.getAttribute('data-confirm-seconds');
    let scrollOffset = document.scrollingElement instanceof HTMLElement
      ? document.scrollingElement.scrollTop
      : window.scrollY;
    for (let node = button.parentElement; node !== null; node = node.parentElement) {
      scrollOffset += node.scrollTop;
    }
    return {
      cardId: id,
      center: { x: rect.left + rect.width / 2, y: rect.top + rect.height / 2 },
      rect: { top: rect.top, left: rect.left, width: rect.width, height: rect.height },
      mode: button.getAttribute('data-confirm-mode'),
      seconds: seconds === null ? null : Number(seconds),
      pendingCardId:
        pendingBar instanceof HTMLElement ? pendingBar.getAttribute('data-card-id') : null,
      panelPresent: document.querySelector('[data-testid="cockpit-card-confirm-panel"]') !== null,
      barPosition: bar instanceof HTMLElement ? getComputedStyle(bar).position : 'absent',
      buttonPosition: getComputedStyle(button).position,
      hintPresent: hint !== null,
      captionText: caption instanceof HTMLElement ? (caption.textContent ?? '').trim() : null,
      captionPosition: captionRow instanceof HTMLElement ? getComputedStyle(captionRow).position : null,
      captionRect: captionRect === null
        ? null
        : {
            top: captionRect.top,
            left: captionRect.left,
            width: captionRect.width,
            height: captionRect.height,
          },
      cardTop: card.getBoundingClientRect().top,
      scrollOffset,
    };
  }, cardId);

const distance = (a: Point, b: Point): number => Math.hypot(a.x - b.x, a.y - b.y);

function describeReading(reading: ConfirmReading): string {
  return JSON.stringify({
    center: reading.center,
    rect: reading.rect,
    mode: reading.mode,
    seconds: reading.seconds,
    pendingCardId: reading.pendingCardId,
    captionText: reading.captionText,
    captionRect: reading.captionRect,
    cardTop: reading.cardTop,
    scrollOffset: reading.scrollOffset,
  });
}

/**
 * Asserts the in-place rule on one reading pair. The message carries BOTH centres, which is what
 * the criterion asks a failure to print, and the same absence checks apply to every state: no
 * confirm panel, no fixed bar, no idle hint row, and the card itself publishes its confirm state.
 */
function expectSameSpot(gap: number, before: ConfirmReading, pending: ConfirmReading): void {
  expect(
    gap,
    `confirm button moved between the two states: before=${describeReading(before)} `
      + `pending=${describeReading(pending)} distance=${gap}px`,
  ).toBeLessThanOrEqual(CENTER_TOLERANCE_PX);
  expect(pending.panelPresent, 'no fixed confirm panel is mounted').toBe(false);
  expect(pending.barPosition, 'the bar is not position:fixed').not.toBe('fixed');
  expect(pending.buttonPosition, 'the button itself is not position:fixed').not.toBe('fixed');
  expect(pending.pendingCardId, 'the card itself publishes its confirm state').toBe(pending.cardId);
  expect(pending.hintPresent, 'the redundant idle hint row is not drawn').toBe(false);
  expect(before.hintPresent, 'the idle bar draws no hint row').toBe(false);
}

const isConfirmResponse = (response: Response): boolean =>
  response.url().includes('/api/cockpit/cards/confirm')
  && response.request().method() === 'POST';

/** Reads the executor's running total out of a confirmation answer. */
async function readTotal(answer: Response): Promise<number> {
  expect(answer.ok(), `the confirmation answered ${answer.status()}`).toBe(true);
  const body = (await answer.json()) as { result?: { total?: unknown } };
  expect(typeof body.result?.total, `the answer names the executor total: ${JSON.stringify(body)}`).toBe(
    'number',
  );
  return body.result!.total as number;
}

function confirmButton(page: Page, cardId: string) {
  return page
    .locator(`[data-cockpit-card-id="${cardId}"]`)
    .getByTestId('cockpit-card-confirm');
}

async function scrollToConfirm(page: Page, cardId: string) {
  const button = confirmButton(page, cardId);
  await button.scrollIntoViewIfNeeded();
  await expect(button).toBeVisible();
  return button;
}

/* ── the three legs ────────────────────────────────────────────────────────── */

type CountdownSendReading = {
  total: number;
  before: ConfirmReading;
  counting: ConfirmReading;
  gap: number;
  waitedMs: number;
};

/**
 * A reversible option: ONE press, the bar's own button becomes the countdown, and the request
 * leaves when the five seconds run out. The response wait is armed BEFORE the press, because the
 * send happens five seconds after it.
 */
async function expectCountdownSend(
  page: Page,
  cardId: string,
  shotPath: string,
): Promise<CountdownSendReading> {
  const button = await scrollToConfirm(page, cardId);
  const before = await readConfirm(page, cardId);
  expect(before, `the fixture card ${cardId} draws its confirm bar`).not.toBeNull();
  expect(before!.mode, 'the bar is idle before the first press').toBe('open');
  expect(before!.panelPresent, 'no confirm dialog is on the page before the press').toBe(false);

  const answerPromise = page.waitForResponse(isConfirmResponse, {
    timeout: CONFIRM_ANSWER_TIMEOUT_MS,
  });
  const startedAt = Date.now();
  await button.click();
  await expect(button).toHaveAttribute('data-confirm-mode', 'cancel');

  const counting = await readConfirm(page, cardId);
  expect(counting).not.toBeNull();
  const gap = distance(before!.center, counting!.center);
  console.log(
    `${TAG} countdown ${cardId} before=${JSON.stringify(before!.center)} `
      + `counting=${JSON.stringify(counting!.center)} gap=${gap}`,
  );
  expectSameSpot(gap, before!, counting!);
  expect(counting!.seconds, 'the countdown label carries its seconds reading').not.toBeNull();
  expect(counting!.captionText, 'the countdown state draws no caption row').toBeNull();
  await page.screenshot({ path: shotPath });

  const answer = await answerPromise;
  const waitedMs = Date.now() - startedAt;
  expect(
    waitedMs,
    `the request left after the countdown, not with the press (waited ${waitedMs}ms)`,
  ).toBeGreaterThanOrEqual(COUNTDOWN_FLOOR_MS);

  return { total: await readTotal(answer), before: before!, counting: counting!, gap, waitedMs };
}

/**
 * A cancelled countdown. The executor's total is only visible in a confirmation answer, so "the
 * cancelled countdown sent nothing" is read by sending afterwards: the answer's total must be
 * exactly one above the pre-cancel reading. A countdown that had fired during the guard window
 * would make it two.
 */
async function expectCancelSendsNothing(
  page: Page,
  cardId: string,
  totalBefore: number,
  shotPath: string,
): Promise<number> {
  const button = await scrollToConfirm(page, cardId);
  await button.click();
  await expect(button).toHaveAttribute('data-confirm-mode', 'cancel');
  await page.waitForTimeout(1_000);
  await button.click();
  await expect(button).toHaveAttribute('data-confirm-mode', 'open');
  await expect(page.locator(`[data-cockpit-card-id="${cardId}"]`)
    .getByTestId('cockpit-card-confirm-outcome')).toHaveCount(0);
  await page.screenshot({ path: shotPath });
  console.log(`${TAG} cancelled ${cardId} after ${1_000}ms of countdown`);

  await page.waitForTimeout(CANCEL_GUARD_MS);
  await expect(button).toHaveAttribute('data-confirm-mode', 'open');

  const answerPromise = page.waitForResponse(isConfirmResponse, {
    timeout: CONFIRM_ANSWER_TIMEOUT_MS,
  });
  await button.click();
  await expect(button).toHaveAttribute('data-confirm-mode', 'cancel');
  const total = await readTotal(await answerPromise);
  expect(
    total,
    `the cancelled countdown added no record: before=${totalBefore} afterTheNextSend=${total}`,
  ).toBe(totalBefore + 1);
  return total;
}

/** Opens a card's option dropdown and presses one option. */
async function selectOption(page: Page, cardId: string, optionId: string): Promise<void> {
  const card = page.locator(`[data-cockpit-card-id="${cardId}"]`);
  await card.getByTestId('cockpit-card-option-trigger').click();
  await card.getByTestId(`cockpit-card-option-${optionId}`).click();
}

/**
 * An irreversible option keeps the two-press confirmation: the first press arms it, the second
 * sends. The ⚠ caption row floats above the button, so the button's centre does not move.
 */
async function expectIrreversibleTwoPresses(
  page: Page,
  cardId: string,
  optionId: string,
  totalBefore: number,
  shotPath: string,
): Promise<number> {
  await selectOption(page, cardId, optionId);
  const button = await scrollToConfirm(page, cardId);
  const before = await readConfirm(page, cardId);
  expect(before, `the fixture card ${cardId} draws its confirm bar`).not.toBeNull();
  expect(before!.mode, 'the bar is idle before the first press').toBe('open');
  expect(before!.captionText, 'the idle state draws no caption row').toBeNull();

  await button.click();
  await expect(button).toHaveAttribute('data-confirm-mode', 'send');
  const pending = await readConfirm(page, cardId);
  expect(pending).not.toBeNull();
  const gap = distance(before!.center, pending!.center);
  console.log(
    `${TAG} irreversible ${cardId} before=${JSON.stringify(before!.center)} `
      + `pending=${JSON.stringify(pending!.center)} gap=${gap}`,
  );
  expectSameSpot(gap, before!, pending!);
  expect(pending!.seconds, 'the irreversible state is not a countdown').toBeNull();
  expect(pending!.captionText, 'the irreversible state keeps its ⚠ caption').toContain('⚠');
  expect(pending!.captionPosition, 'the caption row floats').toBe('absolute');
  expect(pending!.captionRect, 'the caption row is measured').not.toBeNull();
  // Floating ABOVE the button: its box ends at (or above) the button's top edge.
  expect(
    pending!.captionRect!.top + pending!.captionRect!.height,
    `the caption sits above the button: caption=${JSON.stringify(pending!.captionRect)} `
      + `button=${JSON.stringify(pending!.rect)}`,
  ).toBeLessThanOrEqual(pending!.rect.top + CENTER_TOLERANCE_PX);
  await page.screenshot({ path: shotPath });

  const answerPromise = page.waitForResponse(isConfirmResponse, {
    timeout: CONFIRM_ANSWER_TIMEOUT_MS,
  });
  await button.click();
  const total = await readTotal(await answerPromise);
  expect(
    total,
    `the irreversible second press added exactly one record: before=${totalBefore} after=${total}`,
  ).toBe(totalBefore + 1);
  return total;
}

/* ── the two legs ──────────────────────────────────────────────────────────── */

test('1440×900 PC column: countdown send, cancelled countdown, and the irreversible two-press', async ({
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

    // 1. an irreversible option first, BEFORE any card carries a 「Sent ✓」 outcome row: the
    //    criterion is that the caption does not push THIS card's button, and a previous card's
    //    outcome disappearing is a layout change of a different card (not the bar under test).
    recordsSent = await expectIrreversibleTwoPresses(
      page,
      'fixture:stuck',
      'park',
      recordsSent,
      path.join(SHOT_DIR, 'cockpit-inline-confirm-pc-irreversible.png'),
    );

    // 2. a reversible option: one press, countdown, one record.
    const sent = await expectCountdownSend(
      page,
      'fixture:need',
      path.join(SHOT_DIR, 'cockpit-inline-confirm-pc-countdown.png'),
    );
    console.log(`${TAG} pc countdown waitedMs=${sent.waitedMs} total=${sent.total}`);
    expect(sent.total, 'exactly one fixture executor record was added').toBe(recordsSent + 1);
    recordsSent = sent.total;

    // Success is reported in the card's own bar, not in a dialog or a page-level banner.
    await expect(need.getByTestId('cockpit-card-confirm-outcome')).toHaveText('Sent ✓');
    await page.screenshot({ path: path.join(SHOT_DIR, 'cockpit-inline-confirm-pc-sent.png') });

    // 3. the same card: cancel inside the countdown, wait past the deadline, send, +1 only.
    recordsSent = await expectCancelSendsNothing(
      page,
      'fixture:need',
      recordsSent,
      path.join(SHOT_DIR, 'cockpit-inline-confirm-pc-cancelled.png'),
    );

    expect(startupEvidence.pageErrors, JSON.stringify(startupEvidence)).toEqual([]);
  } finally {
    await context.close();
  }
});

test('390×844 phone cards page: countdown send, cancelled countdown, and the irreversible two-press', async ({
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

    recordsSent = await expectIrreversibleTwoPresses(
      page,
      'fixture:stuck',
      'park',
      recordsSent,
      path.join(SHOT_DIR, 'cockpit-inline-confirm-phone-irreversible.png'),
    );

    const sent = await expectCountdownSend(
      page,
      'fixture:need',
      path.join(SHOT_DIR, 'cockpit-inline-confirm-phone-countdown.png'),
    );
    console.log(`${TAG} phone countdown waitedMs=${sent.waitedMs} total=${sent.total}`);
    expect(sent.total, 'exactly one fixture executor record was added').toBe(recordsSent + 1);
    recordsSent = sent.total;

    await expect(need.getByTestId('cockpit-card-confirm-outcome')).toHaveText('Sent ✓');
    await page.screenshot({ path: path.join(SHOT_DIR, 'cockpit-inline-confirm-phone-sent.png') });

    recordsSent = await expectCancelSendsNothing(
      page,
      'fixture:need',
      recordsSent,
      path.join(SHOT_DIR, 'cockpit-inline-confirm-phone-cancelled.png'),
    );

    expect(startupEvidence.pageErrors, JSON.stringify(startupEvidence)).toEqual([]);
  } finally {
    await context.close();
  }
});

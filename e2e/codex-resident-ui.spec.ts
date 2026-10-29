import fs from 'node:fs';
import path from 'node:path';

import { test as base, expect } from '@playwright/test';
import type { APIRequestContext, BrowserContext, Page } from '@playwright/test';

/**
 * A Codex session kept in resident mode, read the way a user meets it.
 *
 * The criterion is about the THREE faces of "Codex can be a resident session" that
 * were missing while the mode was declared: the new-session switch actually creating
 * one, the transcript pill and the server listing agreeing on what is running, a busy
 * send being a withdrawable row the process itself reports, and the Shell tab of a
 * Codex resident session staying an ordinary terminal instead of being closed the way
 * Claude's resident mode closes it.
 *
 * Nothing here stubs the product. The server runs the shipped `CodexHostDriver` and
 * `CodexResidentQueue`; the app-server process it talks to is the deterministic
 * stand-in in `e2e/support/codex-fake-app-server.mjs`, chosen by the
 * `CODEX_APP_SERVER_LAUNCHER` environment variable the connection already reads. The
 * readings below are that process's own JSON-RPC log, the server's `GET
 * /api/session-hosts` projection, and the DOM. The Shell leg reads what the terminal
 * actually launched from a `codex` shim that records its argv — the one place a
 * `resume` argument would appear.
 *
 * Every environment path this file uses is published by `playwright.config.ts` and is
 * selectable only for this spec: no other selection gets the stand-in, the readings
 * file or the shim.
 */

type ChatLocale = {
  input: { send: string };
  resident: { toggle: string };
  providerSelection: { clickToChange: string };
};

/** The shipped copy, read off the disk rather than restated here (same reading as `resident-enable-consent`). */
const enChat = JSON.parse(
  fs.readFileSync(path.resolve(process.cwd(), 'src/modules/i18n/locales/en/chat.json'), 'utf8'),
) as ChatLocale;

const AUTH_TOKEN_KEY = 'auth-token';
const PREFERENCES_MIRROR_KEY = 'user-preferences';
const USERNAME = 'e2euser';
const PASSWORD = 'e2epassword';
/** The provider this whole file works under: the one whose resident face is the subject. */
const PROVIDER = 'codex';

const COMPOSER = '[data-slot="prompt-input-textarea"]';
const SEND_BUTTON = `button[aria-label="${enChat.input.send}"]`;
const SWITCH = '[data-resident-enable="true"]';
const WITHDRAW = '[data-resident-withdraw="true"]';
const BADGE = '[data-resident-badge]';
const SHELL_TAB = '[role="tab"][data-workspace-tab="shell"]';
const SHELL_VIEW = '[data-workspace-view="shell"]';
const SHELL_NOTICE = '[data-resident-shell-notice]';

/** The run's own paths, published by the config; a missing one is a broken selection, not a reading. */
const requiredEnv = (key: string): string => {
  const value = process.env[key];
  if (!value) {
    throw new Error(`${key} is unset — playwright.config.ts must publish it for the codex-resident selection`);
  }
  return value;
};

const READINGS_PATH = requiredEnv('QUAY_E2E_CODEX_READINGS');
const SHELL_LOG_PATH = requiredEnv('QUAY_E2E_CODEX_SHELL_LOG');
const WORKSPACE = requiredEnv('QUAY_E2E_CODEX_WORKSPACE');
const SEEDED_SESSION_ID = requiredEnv('QUAY_E2E_CODEX_SEEDED_SESSION_ID');
const HOLD_MARKER = requiredEnv('QUAY_E2E_CODEX_HOLD_MARKER');

/**
 * One reading of the stand-in's own log.
 *
 * `null` while the file is not there yet (the process has not been spawned, or has not
 * written its first frame) — a caller polls rather than treating the absence as an
 * empty queue.
 */
type FakeReadings = {
  pid: number;
  handshake: { initializeParams: unknown; initialized: boolean; experimentalDeclared: boolean };
  methods: Record<string, number>;
  calls: { method: string; params: Record<string, unknown> }[];
  queueDepth: number;
  queue: { id: string; clientUserMessageId: string | null; text: string }[];
  currentTurn: { id: string; threadId: string; queueId: string | null } | null;
  turnsStarted: number;
};

const readReadings = (): FakeReadings | null => {
  try {
    return JSON.parse(fs.readFileSync(READINGS_PATH, 'utf8')) as FakeReadings;
  } catch {
    return null;
  }
};

const sleep = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));

/** Reads a value off the stand-in's log until `predicate` accepts it, or the budget runs out. */
const waitForReadings = async (
  predicate: (readings: FakeReadings) => boolean,
  budgetMs = 15_000,
): Promise<FakeReadings | null> => {
  const deadline = Date.now() + budgetMs;
  let last = readReadings();
  while (Date.now() < deadline) {
    if (last && predicate(last)) return last;
    await sleep(100);
    last = readReadings();
  }
  return last;
};

/** Every session's stored lifecycle mode, provider and liveness, as the server publishes them. */
type HostStateRow = { appSessionId: string; provider: string; lifecycleMode: string; running: boolean };

const sessionHostRows = async (request: APIRequestContext): Promise<HostStateRow[]> => {
  const response = await request.get('/api/session-hosts', { headers: auth(authToken) });
  expect(response.ok(), `GET /api/session-hosts answered ${response.status()}`).toBe(true);
  const body = (await response.json()) as { data?: { sessions?: HostStateRow[] } };
  return body.data?.sessions ?? [];
};

const hostStateOf = async (request: APIRequestContext, sessionId: string): Promise<HostStateRow | undefined> =>
  (await sessionHostRows(request)).find((row) => row.appSessionId === sessionId);

let authToken = '';

/** The client's own base URL, as this run published it (a context built by hand does not inherit `use.baseURL`). */
const clientBaseURL = (): string => `http://127.0.0.1:${requiredEnv('QUAY_E2E_CLIENT_PORT')}`;

const auth = (token: string) => ({ authorization: `Bearer ${token}` });

/** Signs in once for the whole file; same onboarding walk as `resident-enable-consent`. */
const ensureSignedIn = async (page: Page) => {
  const createAccount = page.getByRole('button', { name: 'Create Account' });
  const settings = page.getByRole('button', { name: 'Settings' }).first();
  const arrived = createAccount.or(settings).or(page.locator('#username')).first();

  let lastError: unknown = null;
  for (let attempt = 0; attempt < 3; attempt += 1) {
    await page.goto('/').catch(() => undefined);
    try {
      await expect(arrived).toBeVisible({ timeout: 15_000 });
      lastError = null;
      break;
    } catch (error) {
      lastError = error;
      await page.waitForTimeout(1_000);
    }
  }
  if (lastError !== null) {
    const body = await page.locator('body').innerText().catch(() => '<unreadable>');
    throw new Error(
      `the app never reached a sign-in, onboarding or signed-in screen at ${page.url()}: `
        + `${body.replace(/\s+/g, ' ').trim().slice(0, 400) || '<empty body>'}`,
    );
  }

  if (await createAccount.count()) {
    await page.locator('#username').fill(USERNAME);
    await page.locator('input[type=password]').nth(0).fill(PASSWORD);
    await page.locator('input[type=password]').nth(1).fill(PASSWORD);
    await createAccount.click();
    await page.getByPlaceholder('John Doe').fill('E2E User');
    await page.getByPlaceholder('john@example.com').fill('e2e@example.com');
    await page.getByRole('button', { name: 'Next' }).click();
    await page.getByRole('button', { name: 'Complete Setup' }).click();
    await expect(settings).toBeVisible({ timeout: 15_000 });
  } else if (await page.locator('#username').count()) {
    await page.locator('#username').fill(USERNAME);
    await page.locator('input[type=password]').first().fill(PASSWORD);
    await page.locator('form button[type=submit]').click();
    await expect(settings).toBeVisible({ timeout: 15_000 });
  }
};

const bootstrapAuth = async (page: Page) => {
  await ensureSignedIn(page);
  authToken = (await page.evaluate((key) => window.localStorage.getItem(key), AUTH_TOKEN_KEY)) ?? '';
  if (!authToken) {
    throw new Error('onboarding completed but no auth token was stored — the legs cannot authenticate');
  }
};

/** One context and one page for all four cases: the client's cold load is paid exactly once. */
let sharedContext: BrowserContext | undefined;
let sharedPage: Page | undefined;

const test = base.extend<{ page: Page }>({
  page: async ({}, use) => {
    if (!sharedPage) {
      throw new Error('the file-shared page was never created — test.beforeAll must run before any case draws');
    }
    await use(sharedPage);
  },
});

/** Puts the captured session (and the stored-provider mirror) into this context before its first navigation. */
const restoreSession = async (page: Page) => {
  await page.addInitScript(([key, token, mirrorKey, provider]) => {
    try {
      window.localStorage.setItem(key, token);
      window.localStorage.setItem(mirrorKey!, JSON.stringify({ selectedProvider: provider }));
    } catch {
      // about:blank has an opaque origin; the real navigation below is what matters.
    }
  }, [AUTH_TOKEN_KEY, authToken, PREFERENCES_MIRROR_KEY, PROVIDER] as const);
};

/** Writes the account's selected provider through the app's own preference API, and reads it back. */
const setSelectedProvider = async (request: APIRequestContext) => {
  const written = await request.patch('/api/user/preferences', {
    headers: auth(authToken),
    data: { selectedProvider: PROVIDER },
  });
  expect(written.ok(), `PATCH /api/user/preferences answered ${written.status()}`).toBe(true);

  const readBack = await request.get('/api/user/preferences', { headers: auth(authToken) });
  const body = (await readBack.json()) as { preferences?: { selectedProvider?: string } };
  expect(body.preferences?.selectedProvider, 'the stored provider must be codex before the send').toBe(PROVIDER);
};

/** The capability matrix as the backend answers it, parsed exactly the way the app's own hook parses it. */
const providerCapabilities = async (
  request: APIRequestContext,
): Promise<{ provider: string; lifecycleModes?: string[] }[]> => {
  const response = await request.get('/api/providers/capabilities', { headers: auth(authToken) });
  expect(response.ok(), `GET /api/providers/capabilities answered ${response.status()}`).toBe(true);
  const body = (await response.json()) as {
    data?: { providers?: { provider: string; lifecycleModes?: string[] }[] };
  };
  return body.data?.providers ?? [];
};

const waitForMode = async (
  request: APIRequestContext,
  sessionId: string,
  expected: string,
  budgetMs = 15_000,
): Promise<string> => {
  const deadline = Date.now() + budgetMs;
  let last = (await hostStateOf(request, sessionId))?.lifecycleMode;
  while (last !== expected && Date.now() < deadline) {
    await sleep(200);
    last = (await hostStateOf(request, sessionId))?.lifecycleMode;
  }
  return last ?? 'undefined';
};

const composer = (page: Page) => page.locator(COMPOSER);

const projectRow = (page: Page) =>
  page.getByRole('heading', { name: path.basename(WORKSPACE) })
    .or(page.getByRole('button', { name: new RegExp(`^${path.basename(WORKSPACE).replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}`) }))
    .first();

/** Puts a composer bound to this criterion's own seeded project on screen; same loop as the consent spec. */
const openComposer = async (page: Page) => {
  const textarea = composer(page);
  const row = projectRow(page);
  const newSession = page.getByRole('button', { name: 'New Session' }).first();

  await expect(row).toBeVisible({ timeout: 20_000 }).catch(() => undefined);

  for (let attempt = 0; attempt < 5; attempt += 1) {
    if (await textarea.isVisible().catch(() => false)) return;
    if (!(await newSession.isVisible().catch(() => false))) {
      await row.click().catch(() => undefined);
      await newSession.waitFor({ state: 'visible', timeout: 2_000 }).catch(() => undefined);
    }
    if (await newSession.isVisible().catch(() => false)) {
      await newSession.click().catch(() => undefined);
      await textarea.waitFor({ state: 'visible', timeout: 2_000 }).catch(() => undefined);
    }
  }
  await expect(textarea).toBeVisible({ timeout: 15_000 });
};

/** The new-session screen: the model card the resident switch sits under. */
const openNewSession = async (page: Page) => {
  const card = page.getByText(enChat.providerSelection.clickToChange);
  await openComposer(page);
  if (!(await card.isVisible().catch(() => false))) {
    await page.getByRole('button', { name: 'New Session' }).first().click().catch(() => undefined);
  }
  await expect(card, 'the new-session model card is what the switch is drawn under').toBeVisible({ timeout: 15_000 });
};

/**
 * Re-confirms the resident switch is on before the send, pressing it again only if a
 * remount cleared the intent (the same mid-run HMR window the consent spec documents).
 */
const armResidentSwitch = async (page: Page) => {
  const toggle = page.locator(SWITCH).first();
  await expect(toggle, 'the new-session screen must still carry the switch when the send is taken').toBeVisible({
    timeout: 20_000,
  });
  await expect
    .poll(async () => {
      if ((await toggle.getAttribute('aria-checked')) === 'true') return 'true';
      await toggle.click({ timeout: 10_000 }).catch(() => undefined);
      return toggle.getAttribute('aria-checked');
    }, { timeout: 20_000, message: 'a remount must not leave the switch off between the press and the send' })
    .toBe('true');
};

/** The session created by the first leg, which the badge and withdraw legs read. */
let createdSessionId = '';

test.describe.configure({ mode: 'serial' });
test.describe.configure({ timeout: 45_000 });

test.beforeAll(async ({ browser }) => {
  test.setTimeout(90_000);
  sharedContext = await browser.newContext({ baseURL: clientBaseURL() });
  sharedPage = await sharedContext.newPage();
  await bootstrapAuth(sharedPage);
});

test.afterAll(async () => {
  await sharedContext?.close();
});

test('codex declares resident, and the switch-on send creates a resident session', async ({ page, request }) => {
  await setSelectedProvider(request);
  await restoreSession(page);
  await page.goto('/');

  // ── AC2, first half: the capability matrix is the server's own answer ─────────────────────────────
  const providers = await providerCapabilities(request);
  const codexRow = providers.find((row) => row.provider === PROVIDER);
  expect(codexRow, 'GET /api/providers/capabilities must list the codex provider').toBeTruthy();
  const modes = [...(codexRow?.lifecycleModes ?? [])].sort();
  console.log(`capabilities.codex.lifecycleModes=${modes.join(',')}`);
  expect(modes, 'codex must declare resident, or the switch below would have no business on screen').toContain('resident');

  await openNewSession(page);
  const toggle = page.locator(SWITCH).first();
  await expect(toggle, 'a provider that declares resident must draw the switch on the empty state').toBeVisible({
    timeout: 15_000,
  });

  // ── AC2, second half: the switch's own two readings ───────────────────────────────────────────────
  const before = await toggle.getAttribute('aria-checked');
  console.log(`resident.toggle.aria-checked.before=${before}`);
  expect(before, 'the switch starts off').toBe('false');
  await toggle.click();
  const after = await toggle.getAttribute('aria-checked');
  console.log(`resident.toggle.aria-checked.after=${after}`);
  expect(after, 'pressing the switch must turn it on').toBe('true');

  // The first command of the file carries the stand-in's hold marker: it is the turn
  // the withdraw leg finds still in flight, so "send while busy" is a real busy
  // session rather than a race against a turn that settles in 40ms.
  await composer(page).fill(`${HOLD_MARKER} codex resident first turn`);
  await armResidentSwitch(page);
  await page.locator(SEND_BUTTON).click();
  await expect.poll(() => new URL(page.url()).pathname).toMatch(/^\/session\/[^/]+$/);
  createdSessionId = new URL(page.url()).pathname.split('/').pop() as string;
  console.log(`created.sessionId=${createdSessionId}`);

  const mode = await waitForMode(request, createdSessionId, 'resident');
  console.log(`session.lifecycle_mode=${mode}`);
  expect(mode, 'the session a switch-on send is addressed to must read back resident from the server').toBe('resident');

  const row = await hostStateOf(request, createdSessionId);
  console.log(`session-hosts.row=${JSON.stringify(row)}`);
  expect(row?.provider, 'the row must be the codex session the send created').toBe(PROVIDER);
  expect(row?.lifecycleMode, 'GET /api/session-hosts must project the stored resident mode').toBe('resident');
});

test('the transcript pill and the listing agree that the codex process is running', async ({ page, request }) => {
  // ── AC3: the pill, on the session the send created ────────────────────────────────────────────────
  await expect(page.locator(BADGE).first(), 'a resident codex session must draw the pill').toBeVisible({
    timeout: 20_000,
  });
  const badgeBefore = await page.locator(BADGE).first().getAttribute('data-resident-badge');
  await expect
    .poll(async () => page.locator(BADGE).first().getAttribute('data-resident-badge'), {
      timeout: 15_000,
      message: 'the pill must resolve the process state rather than stay unknown',
    })
    .not.toBe('unknown');
  const badgeState = await page.locator(BADGE).first().getAttribute('data-resident-badge');
  const pageSessionId = new URL(page.url()).pathname.split('/').pop() as string;
  console.log(`resident.badge=${badgeState} (first reading ${badgeBefore})`);
  console.log(`resident.badge.sessionId=${pageSessionId} created=${createdSessionId}`);
  expect(pageSessionId, 'the pill must be drawn for the session the send created').toBe(createdSessionId);

  const row = await hostStateOf(request, createdSessionId);
  console.log(`listing.appSessionId=${row?.appSessionId} lifecycleMode=${row?.lifecycleMode} running=${String(row?.running)}`);
  expect(row?.appSessionId, 'the listing row must name the same app session the pill is drawn for').toBe(createdSessionId);
  expect(row?.lifecycleMode, 'and it must still read resident').toBe('resident');
  expect(row?.running, 'the resident process the first turn opened must still be running').toBe(true);
});

test('a busy send is a withdrawable row, and withdrawing empties the process queue', async ({ page, request }) => {
  const composerInput = composer(page);
  const deleteCallsBefore = readReadings()?.methods['thread/queue/delete'] ?? 0;
  const depthBeforeInput = readReadings()?.queueDepth ?? 0;
  console.log(`queue.depth.before_input=${depthBeforeInput}`);

  // ── the first command is HELD by the stand-in, so the session is busy when the second arrives ─────
  // The held turn is the first leg's own send: it carries the marker, and the stand-in
  // keeps it in flight for CODEX_FAKE_HOLD_MS. This leg's job is to read that state
  // before sending, so a session that quietly stopped being busy fails here rather
  // than passing on a turn that had already settled.
  const held = await waitForReadings(
    (readings) => Boolean(readings.currentTurn)
      && readings.calls.some(
        (call) => call.method === 'turn/start'
          && JSON.stringify(call.params.input ?? '').includes(HOLD_MARKER),
      ),
    10_000,
  );
  expect(held, 'the stand-in must still be holding the first command before a second send can be queued').toBeTruthy();
  console.log(`turn.start.held=${JSON.stringify(held?.currentTurn)}`);

  // ── AC4: send while busy; the process queues it and the row offers a withdrawal ───────────────────
  await composerInput.fill('withdraw this queued command');
  await page.locator(SEND_BUTTON).click();

  const queued = await waitForReadings((readings) => readings.queueDepth === 1, 15_000);
  const queuedBefore = queued?.queueDepth ?? -1;
  const queuedRow = queued?.queue[0];
  const hostWhileBusy = await hostStateOf(request, createdSessionId);
  console.log(`queue.queuedBefore=${queuedBefore} row=${JSON.stringify(queuedRow)}`);
  console.log(`queue.hostWhileBusy=${JSON.stringify(hostWhileBusy)}`);
  console.log(`queue.pendingRows=${await page.locator('.resident-pending').count()}`
    + ` queue.withdrawVisible=${await page.locator(WITHDRAW).count()}`);
  expect(queuedBefore, 'the second send must land in the app-server\'s own queue').toBe(1);
  expect(queuedRow?.text ?? '', 'the queued row must be the command just sent').toContain('withdraw this queued command');

  const withdraw = page.locator(WITHDRAW).first();
  await expect(withdraw, 'a queued command must offer [withdraw]').toBeVisible({ timeout: 15_000 });
  // The row adopts the uuid from the process's own `queued` frame; the withdrawal names it,
  // so the reading is taken before the click rather than assumed from the DOM's timing.
  const queuedRowLocator = page.locator('.resident-pending[data-command-uuid]').last();
  await expect
    .poll(async () => queuedRowLocator.getAttribute('data-command-uuid'), {
      timeout: 15_000,
      message: 'the pending row must adopt the uuid the process queued the command under',
    })
    .toBe(queuedRow?.clientUserMessageId ?? '');
  console.log(`row.commandUuid=${await queuedRowLocator.getAttribute('data-command-uuid')}`);

  const withdrawVisibleBefore = await withdraw.isVisible();
  await withdraw.click();
  await expect(page.locator('[data-resident-withdrawn="true"]').first(), 'the row must read withdrawn').toBeVisible({
    timeout: 15_000,
  });
  const withdrawnAfter = await page.locator('[data-resident-withdrawn="true"]').first().getAttribute('data-resident-withdrawn');

  const withdrawn = await waitForReadings(
    (readings) => readings.queueDepth === 0 && (readings.methods['thread/queue/delete'] ?? 0) > deleteCallsBefore,
    15_000,
  );
  const queueDeleteCalls = (withdrawn?.methods['thread/queue/delete'] ?? 0) - deleteCallsBefore;
  const queueDepthAfter = withdrawn?.queueDepth ?? -1;
  console.log(`queue.withdrawVisible=${withdrawVisibleBefore} queue.withdrawnAfter=${String(withdrawnAfter)}`);
  console.log(
    `queue.queueDeleteCalls=${queueDeleteCalls} (thread/queue/delete shared=${withdrawn?.methods['thread/queue/delete'] ?? 0})`
    + ` queue.depthBefore=${depthBeforeInput} queue.depthAfter=${queueDepthAfter}`,
  );
  expect(queueDeleteCalls, 'the withdrawal must be exactly one thread/queue/delete on the process').toBe(1);
  expect(queueDepthAfter, 'and the process queue must be back to the depth it had before the input').toBe(depthBeforeInput);
});

test('a codex resident session keeps an ordinary Shell tab that launches the bare CLI', async ({ page, request }) => {
  // ── AC5: the seeded session is stored resident, and its provider id really exists ─────────────────
  const stored = await request.put(`/api/providers/${PROVIDER}/sessions/${SEEDED_SESSION_ID}/lifecycle-mode`, {
    headers: auth(authToken),
    data: { mode: 'resident' },
  });
  expect(stored.ok(), `PUT lifecycle-mode answered ${stored.status()}`).toBe(true);
  const seededMode = await waitForMode(request, SEEDED_SESSION_ID, 'resident');
  console.log(`seeded.sessionId=${SEEDED_SESSION_ID} lifecycle_mode=${seededMode}`);
  expect(seededMode, 'the seeded codex session must be stored resident before the Shell tab is read').toBe('resident');

  const shellTab = page.locator(SHELL_TAB).first();
  const startedAt = Date.now();
  const navFailure = await page
    .goto(`/session/${SEEDED_SESSION_ID}`, { timeout: 20_000 })
    .then(() => null, (error: unknown) => String(error));
  console.log(`shell.nav=${Date.now() - startedAt}ms failure=${navFailure} url=${page.url()}`);
  if (!(await shellTab.isVisible().catch(() => false))) {
    // The direct address did not resolve this session in the client; open its row the way the sidebar
    // does. The row lives under its project and the project row is a toggle, so a click landing
    // mid-render leaves it collapsed — retried, and every wait bounded, so a miss reads as a miss
    // rather than as a case that runs to its own timeout.
    const sessionLink = page.locator(`a[href="/session/${SEEDED_SESSION_ID}"]`).first();
    for (let attempt = 0; attempt < 6; attempt += 1) {
      if (await sessionLink.isVisible().catch(() => false)) break;
      await projectRow(page).click({ timeout: 5_000 }).catch(() => undefined);
      await page.waitForTimeout(400);
    }
    console.log(`shell.nav.sidebarLink=${await sessionLink.isVisible().catch(() => false)} url=${page.url()}`);
    await sessionLink.click({ timeout: 5_000 });
  }
  await expect(shellTab, 'the workspace header must draw the Shell tab').toBeVisible({ timeout: 20_000 });

  const disabled = await shellTab.getAttribute('aria-disabled');
  const reason = await shellTab.getAttribute('data-disabled-reason');
  const describedBy = await shellTab.getAttribute('aria-describedby');
  const noticeCount = await page.locator(SHELL_NOTICE).count();
  console.log(`shell.tab.aria-disabled=${String(disabled)} data-disabled-reason=${String(reason)}`
    + ` aria-describedby=${String(describedBy)} notice.count=${noticeCount}`);
  expect(disabled, 'a codex resident session must not close the Shell tab').not.toBe('true');
  expect(reason, 'the disabled-tab reason marker must be absent').toBeNull();
  expect(noticeCount, 'a codex resident session draws no resident shell notice').toBe(0);

  await shellTab.click();
  await expect(page.locator(SHELL_VIEW), 'clicking the tab must mount the shell view').toBeVisible({ timeout: 15_000 });
  await expect(page.locator(`${SHELL_VIEW} .xterm`).first(), 'the terminal itself must mount').toBeVisible({
    timeout: 15_000,
  });

  // ── what the terminal actually launched: the shim's own argv ──────────────────────────────────────
  // The Facet is asked for a version first (`codex --version`), so the launch line is the first call
  // that is not that probe. Every line the shim wrote is kept: a `resume` anywhere in the log is the
  // product putting a second process on the resident thread, whichever invocation carries it.
  const deadline = Date.now() + 20_000;
  let launchLine = '';
  let shimLog: string[] = [];
  while (!launchLine && Date.now() < deadline) {
    try {
      shimLog = fs.readFileSync(SHELL_LOG_PATH, 'utf8').split('\n').filter((line) => line.trim() !== '');
      launchLine = shimLog.find((line) => !line.includes('args=[--version]')) ?? '';
    } catch {
      // The shell has not connected yet.
    }
    if (!launchLine) await sleep(200);
  }
  console.log(`shell.launch=${launchLine}`);
  console.log(`shell.shim.calls=${JSON.stringify(shimLog)}`);
  expect(launchLine, 'the terminal must have launched the codex shim').not.toBe('');
  expect(launchLine, 'the launched command must be the bare codex executable').toMatch(/argv0=\S*\/codex args=\[\]/);
  expect(shimLog.join('\n'), 'the terminal must NOT resume the conversation the resident process is holding').not.toContain('resume');

  fs.mkdirSync(path.resolve(process.cwd(), 'tmp'), { recursive: true });
  await page.screenshot({ path: path.resolve(process.cwd(), 'tmp', 'codex-resident-shell.png'), fullPage: true });
});

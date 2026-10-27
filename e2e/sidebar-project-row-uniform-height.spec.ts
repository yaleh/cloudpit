import fs from 'node:fs';
import path from 'node:path';

import { expect, test } from '@playwright/test';
import type { APIRequestContext, Browser, Locator, Page } from '@playwright/test';

/**
 * The sidebar's project row is one fixed two-line card, at every width and in both layouts.
 *
 * WHY A BROWSER. Every criterion here is geometry: the height a card actually takes, whether a
 * name is ellipsized rather than wrapped, whether the second line is still one line, and whether
 * the desktop row's controls are painted or merely present in the DOM with `opacity: 0`. Tailwind
 * classes only become those numbers once an engine applies the stylesheet, so each reading below
 * runs through `page.evaluate` and returns DATA — never an assertion.
 *
 * THE SHAPES. The row's height used to depend on how many controls a project happened to show and
 * on how many digits its task counts had, so the fixture seeds six shapes inside this run's own
 * data directory: a quay project the fleet registers (badge + cockpit actions), a quay project it
 * does not (badge, no cockpit actions), a plain project (no badge), a long name that cannot fit
 * the row, a quay project whose counts are all zero (no badge at all), and a quay project whose
 * fleet driver reads `running` (quay indicator painted). Equal heights across six shapes is the
 * claim; one shape alone would only say a card is self-consistent.
 *
 * WHY THE FLEET AND FEATURE READS ARE STUBBED. This host has no `quay-fleet` registry and the
 * cockpit ships off, so a real reading could not produce the badge+cockpit shape or a `running`
 * driver at all. Both are stubbed at the HTTP boundary (`/api/quay/fleet-summary`,
 * `/api/settings/features`); the page, the row, the badge, the menu and the pin hook all run for
 * real. Every stubbed entry is keyed by the REAL project id the server assigned, resolved through
 * `/api/projects` before navigation, so the row matches its reading the same way it does in
 * production.
 */

const AUTH_TOKEN_KEY = 'auth-token';
const USERNAME = 'e2euser';
const PASSWORD = 'e2epassword';

const SHOT_DIR = path.join(process.cwd(), 'tmp');
const MOBILE = [
  { width: 390, height: 844 },
  { width: 320, height: 640 },
] as const;
const DESKTOP = { width: 1280, height: 900 } as const;

/** The fleet's per-project driver reading, as `/api/quay/fleet-summary` reports it. */
type DriverState = 'idle' | 'running' | 'stale' | 'unavailable';

type TaskCounts = { total: number; todo: number; ready: number; needsHuman: number; done: number };

/** One seeded shape, each in its own workspace under the run's throwaway data directory. */
type Shape = {
  dir: string;
  /** Whether the workspace carries `.quay/config.yml` (the project-row badge's precondition). */
  quay: boolean;
  /** The fleet entry's counts, or `null` when the fleet does not list this project. */
  counts: TaskCounts | null;
  /** The fleet registry id — the only handle a cockpit board link has; `null` for unregistered. */
  fleetId: string | null;
  /** The fleet entry's driver state; only the three attention states paint the indicator. */
  driver: DriverState;
  /** Whether the row is expected to draw `[data-project-task-counts]` at all. */
  badge: boolean;
  /** The `data-quay-indicator` reading the row must draw, or `null` for no icon. */
  indicator: DriverState | null;
  /** What this shape proves, printed in every failure message. */
  label: string;
};

const SHAPES: readonly Shape[] = [
  {
    dir: 'uniform-badge-cockpit',
    quay: true,
    counts: { total: 9, todo: 2, ready: 4, needsHuman: 3, done: 0 },
    fleetId: 'uniform-badge-cockpit',
    driver: 'idle',
    badge: true,
    indicator: null,
    label: 'badge + cockpit',
  },
  {
    dir: 'uniform-badge-plain',
    quay: true,
    counts: { total: 4, todo: 1, ready: 1, needsHuman: 2, done: 0 },
    fleetId: null,
    driver: 'idle',
    badge: true,
    indicator: null,
    label: 'badge, no cockpit',
  },
  {
    dir: 'u3',
    quay: false,
    counts: null,
    fleetId: null,
    driver: 'idle',
    badge: false,
    indicator: null,
    label: 'no badge, short name',
  },
  {
    dir: 'uniform-long-project-name-that-will-not-fit-inside-the-narrow-row',
    quay: false,
    counts: null,
    fleetId: null,
    driver: 'idle',
    badge: false,
    indicator: null,
    label: 'long name',
  },
  {
    dir: 'uniform-zero-counts',
    quay: true,
    counts: { total: 0, todo: 0, ready: 0, needsHuman: 0, done: 0 },
    fleetId: null,
    driver: 'idle',
    badge: false,
    indicator: null,
    label: 'all-zero counts',
  },
  {
    dir: 'uniform-driver-running',
    quay: true,
    counts: { total: 1, todo: 1, ready: 0, needsHuman: 0, done: 0 },
    fleetId: 'uniform-driver-running',
    driver: 'running',
    badge: true,
    indicator: 'running',
    label: 'driver running',
  },
] as const;

/** The long name must be longer than the row at 320, so the ellipsis claim is about clipping. */
const LONG_NAME = SHAPES[3].dir;
const SHORT_NAME = SHAPES[2].dir;

let authToken = '';

/** The server's own project ids, keyed by workspace directory name. */
const projectIdByDir = new Map<string, string>();

const dataDir = (): string => {
  const dir = process.env.QUAY_E2E_DATA_DIR;
  if (!dir) throw new Error('playwright.config.ts must publish QUAY_E2E_DATA_DIR');
  return dir;
};

/**
 * Both legs share one auth database, so the account is created at most once and every later
 * navigation logs in instead. Same flow as e2e/sidebar-resize.spec.ts; the signed-in check is the
 * stored token rather than a Settings button, because this app's desktop landing (the fleet
 * overview) draws no sidebar.
 */
const ensureSignedIn = async (page: Page) => {
  await page.goto('/');
  const createAccount = page.getByRole('button', { name: 'Create Account' });
  const username = page.locator('#username');
  await expect(createAccount.or(username).first()).toBeVisible({ timeout: 20_000 });
  if (await createAccount.count()) {
    await username.fill(USERNAME);
    await page.locator('input[type=password]').nth(0).fill(PASSWORD);
    await page.locator('input[type=password]').nth(1).fill(PASSWORD);
    await createAccount.click();
    await page.getByPlaceholder('John Doe').fill('E2E User');
    await page.getByPlaceholder('john@example.com').fill('e2e@example.com');
    await page.getByRole('button', { name: 'Next' }).click();
    await page.getByRole('button', { name: 'Complete Setup' }).click();
  } else {
    await username.fill(USERNAME);
    await page.locator('input[type=password]').first().fill(PASSWORD);
    await page.locator('form button[type=submit]').click();
  }
  await page.waitForFunction(
    (key) => Boolean(window.localStorage.getItem(key)),
    AUTH_TOKEN_KEY,
    { timeout: 20_000 },
  );
};

/**
 * The row's own workspace, `.quay/config.yml` and one transcript each.
 *
 * Written before the first navigation: the page's `/api/projects` call synchronizes the
 * directory, and the file watcher picks the new transcripts up either way. One session per
 * workspace keeps the second line's session-count label short, so any height difference below
 * is caused by the controls (or a wrap) and not by a longer fixture.
 */
const seedWorkspaces = () => {
  const root = dataDir();
  for (const shape of SHAPES) {
    const workspace = path.join(root, shape.dir);
    fs.mkdirSync(workspace, { recursive: true });
    if (shape.quay) {
      fs.mkdirSync(path.join(workspace, '.quay'), { recursive: true });
      fs.writeFileSync(
        path.join(workspace, '.quay', 'config.yml'),
        'name: uniform-height-fixture\n',
        'utf8',
      );
    }
    const sessionId = `e2e-uniform-${shape.dir}`;
    const transcriptDir = path.join(root, '.claude', 'projects', shape.dir);
    fs.mkdirSync(transcriptDir, { recursive: true });
    const timestamp = new Date().toISOString();
    const records = [
      {
        type: 'user',
        sessionId,
        cwd: workspace,
        timestamp,
        message: { role: 'user', content: [{ type: 'text', text: `prompt for ${shape.dir}` }] },
      },
      { type: 'custom-title', sessionId, cwd: workspace, timestamp, customTitle: shape.dir },
    ];
    fs.writeFileSync(
      path.join(transcriptDir, `${sessionId}.jsonl`),
      `${records.map((record) => JSON.stringify(record)).join('\n')}\n`,
      'utf8',
    );
  }
};

/** Signs in once for the whole file and captures the token each leg replays. */
const bootstrapAuth = async (browser: Browser) => {
  const context = await browser.newContext();
  const page = await context.newPage();
  await ensureSignedIn(page);
  authToken = (await page.evaluate((key) => window.localStorage.getItem(key), AUTH_TOKEN_KEY)) ?? '';
  await context.close();
  if (!authToken) {
    throw new Error('onboarding completed but no auth token was stored — the legs cannot authenticate');
  }
};

/**
 * Resolves each seeded workspace's DB-assigned project id.
 *
 * The fleet reading is keyed by project id and the rows carry it as `data-project-id`, so this
 * mapping is what ties the stub to the row. `/api/projects` (without `skipSynchronization`)
 * synchronizes the freshly written transcripts; the poll covers the watcher/sync being cold.
 */
const resolveProjectIds = async (request: APIRequestContext) => {
  const deadline = Date.now() + 40_000;
  let lastReading = 'no response';
  while (Date.now() < deadline) {
    const response = await request.get('/api/projects', {
      headers: { Authorization: `Bearer ${authToken}` },
      timeout: 20_000,
    });
    if (response.ok()) {
      const projects = (await response.json()) as Array<{ projectId?: string; path?: string }>;
      const next = new Map<string, string>();
      for (const project of projects) {
        const dir = path.basename(project.path ?? '');
        if (typeof project.projectId === 'string' && SHAPES.some((shape) => shape.dir === dir)) {
          next.set(dir, project.projectId);
        }
      }
      lastReading = `${next.size}/${SHAPES.length} seeded workspaces listed (${[...next.keys()].join(', ')})`;
      if (next.size === SHAPES.length) {
        projectIdByDir.clear();
        for (const [dir, projectId] of next) projectIdByDir.set(dir, projectId);
        return;
      }
    } else {
      lastReading = `GET /api/projects answered ${response.status()}`;
    }
    await new Promise((resolve) => setTimeout(resolve, 500));
  }
  throw new Error(
    `the seeded workspaces never reached the project list: read ${lastReading}; `
    + `expected ${SHAPES.map((shape) => shape.dir).join(', ')}`,
  );
};

/** Replays the captured session into a context the per-describe `test.use` options already built. */
const authenticate = async (page: Page) => {
  await page.addInitScript(([key, token]) => {
    try {
      window.localStorage.setItem(key, token);
    } catch {
      // about:blank has an opaque origin; the real navigation below is what matters.
    }
  }, [AUTH_TOKEN_KEY, authToken] as const);
};

/** The two quay reads the row consults, deterministic and independent of this host. */
const stubQuayReads = async (page: Page) => {
  const fleet = {
    projects: SHAPES.filter((shape) => shape.counts !== null).map((shape) => ({
      projectId: projectIdByDir.get(shape.dir) ?? `unresolved-${shape.dir}`,
      fleetProjectId: shape.fleetId,
      projectPath: path.join(dataDir(), shape.dir),
      driver: { state: shape.driver },
      tasks: shape.counts,
      cached: false,
      error: null,
    })),
    fleet: { available: true, reason: null, state: 'ok' },
    generatedAt: new Date().toISOString(),
    ttlPerProjectMs: 120_000,
    cached: false,
  };
  await page.route('**/api/settings/features', (route) =>
    route.fulfill({
      status: 200,
      contentType: 'application/json',
      body: JSON.stringify({ cockpit: { enabled: true } }),
    }),
  );
  await page.route('**/api/quay/fleet-summary', (route) =>
    route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify(fleet) }),
  );
};

/** Below 768 the sidebar is a drawer: open it with the header's own menu button. */
const openSidebar = async (page: Page) => {
  const card = page.locator('[data-testid="sidebar-project-card"]').first();
  await expect(card).toBeAttached({ timeout: 20_000 });
  // A closed drawer keeps the cards in the DOM but `invisible`; opening it is the app's own
  // header button, pressed the way a person presses it.
  if (!(await card.isVisible())) {
    await page.locator('.pwa-menu-button:visible').first().click();
  }
  await expect(card).toBeVisible({ timeout: 10_000 });
};

/** Two frames, so a height is the one the browser settled on rather than a mid-layout value. */
const settle = async (page: Page) => {
  await page.evaluate(() => new Promise<void>((resolve) => {
    window.requestAnimationFrame(() => window.requestAnimationFrame(() => resolve()));
  }));
};

const heightLedger = (readings: readonly { name: string; height: number }[]): string =>
  readings.map((reading) => `${reading.name}:${reading.height.toFixed(2)}`).join('\n');

const expectEqualHeights = (
  readings: readonly { name: string; height: number }[],
  where: string,
) => {
  const heights = readings.map((reading) => reading.height);
  const spread = Math.max(...heights) - Math.min(...heights);
  expect(
    spread,
    `rows must share one height (±1px) at ${where}; spread read ${spread.toFixed(2)}px\n`
    + heightLedger(readings),
  ).toBeLessThanOrEqual(1);
};

/* ── mobile (compact) cards ──────────────────────────────────────────────────────────────── */

/** One card's readings; returns data so the same numbers can be attached to a failure message. */
type CardReading = {
  projectId: string;
  name: string;
  height: number;
  nameClientWidth: number;
  nameScrollWidth: number;
  metaHeight: number;
  badge: string | null;
  quayStatus: string | null;
  quayIndicatorDisplay: string | null;
  quayIndicatorWidth: number;
  star: boolean;
  menuTrigger: boolean;
  expandIndicator: boolean;
  buttons: number;
};

const readMobileCards = (): CardReading[] => {
  const cards = Array.from(
    document.querySelectorAll<HTMLElement>('[data-testid="sidebar-project-card"]'),
  );
  return cards.map((card) => {
    const heading = card.querySelector<HTMLElement>('h3');
    const meta = card.querySelector<HTMLElement>('[data-testid="project-row-meta"]');
    const badge = card.querySelector<HTMLElement>('[data-project-task-counts]');
    const quayIndicator = card.querySelector<HTMLElement>('[data-quay-indicator]');
    return {
      projectId: card.getAttribute('data-project-id') ?? '',
      name: (heading?.textContent ?? '').trim(),
      height: card.getBoundingClientRect().height,
      nameClientWidth: heading?.clientWidth ?? -1,
      nameScrollWidth: heading?.scrollWidth ?? -1,
      metaHeight: meta ? meta.getBoundingClientRect().height : -1,
      badge: badge
        ? `todo=${badge.getAttribute('data-task-todo')},`
          + `ready=${badge.getAttribute('data-task-ready')},`
          + `needsHuman=${badge.getAttribute('data-task-needs-human')}`
        : null,
      quayStatus: quayIndicator ? quayIndicator.getAttribute('data-quay-indicator') : null,
      quayIndicatorDisplay: quayIndicator ? getComputedStyle(quayIndicator).display : null,
      quayIndicatorWidth: quayIndicator ? quayIndicator.getBoundingClientRect().width : 0,
      star: Boolean(card.querySelector('[data-testid="project-star-toggle"]')),
      menuTrigger: Boolean(
        card.querySelector('[data-testid="project-actions-menu"] button[aria-haspopup="menu"]'),
      ),
      expandIndicator: Boolean(card.querySelector('[data-testid="project-expand-indicator"]')),
      buttons: card.querySelectorAll('button').length,
    };
  });
};

/** One mobile leg: read the drawer and judge every card it drew. */
const readMobileLeg = async (page: Page, width: number) => {
  await authenticate(page);
  await stubQuayReads(page);
  await page.goto('/');
  await openSidebar(page);

  const innerWidth = await page.evaluate(() => window.innerWidth);
  expect(
    innerWidth,
    `this leg declares a ${width}px viewport but window.innerWidth read ${innerWidth}`,
  ).toBe(width);

  await settle(page);

  const readings = await page.evaluate(readMobileCards) as CardReading[];
  const byDir = (dir: string): CardReading => {
    const projectId = projectIdByDir.get(dir);
    const reading = readings.find((candidate) => candidate.projectId === projectId);
    expect(
      reading,
      `the ${width}px sidebar drew no card for ${dir} (project ${projectId ?? 'unresolved'}); `
      + `cards: ${heightLedger(readings)}`,
    ).not.toBeUndefined();
    return reading!;
  };

  expect(
    readings.length,
    `the drawer must draw at least the ${SHAPES.length} seeded shapes; read ${heightLedger(readings)}`,
  ).toBeGreaterThanOrEqual(SHAPES.length);

  // AC: all cards equal within 1px, printed as `name:height` when they are not.
  expectEqualHeights(readings, `${width}px`);

  for (const reading of readings) {
    // Three control slots and nothing else: star, ⋯ trigger, status-only expand slot.
    expect(reading.star, `${reading.name} lost its favorite star at ${width}px`).toBe(true);
    expect(reading.menuTrigger, `${reading.name} lost its ⋯ trigger at ${width}px`).toBe(true);
    expect(reading.expandIndicator, `${reading.name} lost its expand indicator at ${width}px`).toBe(true);
    expect(
      reading.buttons,
      `${reading.name} draws ${reading.buttons} buttons; only the star and the ⋯ trigger may be buttons\n`
      + heightLedger(readings),
    ).toBe(2);
    // The second line is one line: a wrapped meta row is what used to make heights differ.
    expect(
      reading.metaHeight,
      `${reading.name} wrapped its second line at ${width}px (meta height ${reading.metaHeight}px)\n`
      + heightLedger(readings),
    ).toBeLessThanOrEqual(20);
  }

  // Shape 1: badge + cockpit — the fleet lists it, so the three-color badge is drawn.
  const cockpitShape = byDir(SHAPES[0].dir);
  expect(
    cockpitShape.badge,
    `the badge+cockpit card must draw the fleet counts; read ${cockpitShape.badge}`,
  ).toBe('todo=2,ready=4,needsHuman=3');

  // Shape 2: badge, no cockpit — quay-configured, counts present, no fleet registry id.
  const plainShape = byDir(SHAPES[1].dir);
  expect(plainShape.badge, 'the badge/no-cockpit card must draw the fleet counts').toBe(
    'todo=1,ready=1,needsHuman=2',
  );

  // Shape 3: no badge — no `.quay/config.yml`, so the badge is absent entirely.
  const bareShape = byDir(SHAPES[2].dir);
  expect(
    bareShape.badge,
    `a project without .quay/config.yml must draw no task badge; read ${bareShape.badge}`,
  ).toBeNull();
  expect(
    bareShape.nameScrollWidth,
    `the short name must fit its row without ellipsis at ${width}px; `
    + `scrollWidth=${bareShape.nameScrollWidth} clientWidth=${bareShape.nameClientWidth}`,
  ).toBeLessThanOrEqual(bareShape.nameClientWidth);

  // Shape 5: all-zero counts — the row must not draw a 0 0 0 badge, and an idle driver must not
  // paint the quay indicator.
  const zeroShape = byDir(SHAPES[4].dir);
  expect(
    zeroShape.badge,
    `a 0/0/0 fleet reading must draw no task badge at all; read ${zeroShape.badge}`,
  ).toBeNull();
  expect(
    zeroShape.quayStatus,
    `an idle driver must not paint a quay indicator; read ${zeroShape.quayStatus}`,
  ).toBeNull();

  // Shape 6: driver running — the indicator is painted from the fleet reading, and it must not
  // add a line: the 320 leg's `min-[360px]` rule drops it entirely.
  const runningShape = byDir(SHAPES[5].dir);
  expect(runningShape.badge, 'the running-driver card still draws its non-zero counts').toBe(
    'todo=1,ready=0,needsHuman=0',
  );
  expect(
    runningShape.quayStatus,
    `a running driver must paint data-quay-indicator="running"; read ${runningShape.quayStatus}`,
  ).toBe('running');
  if (width < 360) {
    expect(
      runningShape.quayIndicatorDisplay,
      `the quay indicator must be dropped at ${width}px; read display ${runningShape.quayIndicatorDisplay} `
      + `(width ${runningShape.quayIndicatorWidth}px)`,
    ).toBe('none');
    expect(
      runningShape.quayIndicatorWidth,
      'a dropped quay indicator must occupy no box',
    ).toBe(0);
  } else {
    expect(
      runningShape.quayIndicatorDisplay,
      `the quay indicator must be painted at ${width}px; read display ${runningShape.quayIndicatorDisplay} `
      + `(width ${runningShape.quayIndicatorWidth}px)`,
    ).not.toBe('none');
    expect(
      runningShape.quayIndicatorWidth,
      'the painted quay indicator must have a box at this width',
    ).toBeGreaterThan(0);
  }

  // Shape 4: a long name is ellipsized rather than wrapped, and still costs one line.
  const longShape = byDir(LONG_NAME);
  expect(
    longShape.nameScrollWidth,
    `the long name must overflow its one-line box at ${width}px, or the ellipsis claim is vacuous; `
    + `scrollWidth=${longShape.nameScrollWidth} clientWidth=${longShape.nameClientWidth}`,
  ).toBeGreaterThan(longShape.nameClientWidth);

  fs.mkdirSync(SHOT_DIR, { recursive: true });
  await page.screenshot({
    path: path.join(SHOT_DIR, `sidebar-project-row-uniform-${width}.png`),
    fullPage: false,
  });

  return readings;
};

/** Opens one card's ⋯ menu and returns the menu labels (the menu is portalled to body). */
const mobileMenuLabels = async (page: Page, dir: string): Promise<string[]> => {
  const projectId = projectIdByDir.get(dir)!;
  const card = page.locator(`[data-testid="sidebar-project-card"][data-project-id="${projectId}"]`);
  const trigger = card.locator('button[aria-haspopup="menu"]');
  await trigger.click();
  await expect(page.locator('[role="menu"]')).toBeVisible();
  const labels = await page.locator('[role="menuitem"]').allTextContents();
  // Toggle closed with the same trigger rather than Escape: the trigger is the menu's own control
  // and Escape is a document-level key other surfaces on this page also listen for.
  await trigger.click();
  await expect(page.locator('[role="menu"]')).toHaveCount(0);
  return labels.map((label) => label.trim());
};

test.describe('the mobile project card is uniform at 390px', () => {
  test.use({ viewport: { width: MOBILE[0].width, height: MOBILE[0].height } });

  test('every seeded shape draws one fixed-height two-line card', async ({ page }) => {
    await readMobileLeg(page, MOBILE[0].width);

    // The cockpit shape's menu carries the fleet actions; the unregistered quay shape carries
    // neither — the menu is where the row's extracted actions actually live, so the shapes are
    // only real if the menu differs between them.
    const cockpitItems = await mobileMenuLabels(page, SHAPES[0].dir);
    expect(
      cockpitItems,
      `a registered project's ⋯ menu must offer rename/filter/cockpit/watch/delete; read ${JSON.stringify(cockpitItems)}`,
    ).toEqual([
      'Rename project (F2)',
      'Session filter…',
      'View in cockpit',
      'Pin to wall',
      'Remove project (Delete)',
    ]);
    const plainItems = await mobileMenuLabels(page, SHAPES[1].dir);
    expect(
      plainItems,
      `an unregistered project's ⋯ menu must omit both cockpit items; read ${JSON.stringify(plainItems)}`,
    ).toEqual(['Rename project (F2)', 'Session filter…', 'Remove project (Delete)']);
  });
});

test.describe('the mobile project card is uniform at 320px', () => {
  test.use({ viewport: { width: MOBILE[1].width, height: MOBILE[1].height } });

  test('every seeded shape keeps its height with the quay indicator dropped', async ({ page }) => {
    await readMobileLeg(page, MOBILE[1].width);
  });
});

/* ── desktop (full) rows ─────────────────────────────────────────────────────────────────── */

type DesktopReading = {
  projectId: string;
  name: string;
  height: number;
  text: string;
  badge: string | null;
  quayStatus: string | null;
  triggerOpacity: number;
  triggerExpanded: string | null;
  expandPainted: boolean;
  buttons: number;
};

/** Reads every desktop row: geometry, painted state of the two right-hand controls, readings. */
const readDesktopRows = (): DesktopReading[] => {
  const rows = Array.from(
    document.querySelectorAll<HTMLElement>('[data-testid="sidebar-project-row"]'),
  );
  return rows.map((row) => {
    const name = row.querySelector<HTMLElement>('[data-testid="project-row-name"]');
    const badge = row.querySelector<HTMLElement>('[data-project-task-counts]');
    const quayIndicator = row.querySelector<HTMLElement>('[data-quay-indicator]');
    const trigger = row.querySelector<HTMLElement>(
      '[data-testid="project-actions-menu"] button[aria-haspopup="menu"]',
    );
    const expand = row.querySelector<HTMLElement>('[data-testid="project-expand-indicator"]');
    const painted = (element: HTMLElement | null) => {
      if (!element) return false;
      const rect = element.getBoundingClientRect();
      const style = getComputedStyle(element);
      return rect.width > 0 && rect.height > 0
        && style.display !== 'none' && style.visibility !== 'hidden'
        && Number(style.opacity) > 0.5;
    };
    return {
      projectId: row.getAttribute('data-project-id') ?? '',
      name: (name?.textContent ?? '').trim(),
      height: row.getBoundingClientRect().height,
      text: (row.textContent ?? '').replace(/\s+/g, ' ').trim(),
      badge: badge
        ? `todo=${badge.getAttribute('data-task-todo')},`
          + `ready=${badge.getAttribute('data-task-ready')},`
          + `needsHuman=${badge.getAttribute('data-task-needs-human')}`
        : null,
      quayStatus: quayIndicator ? quayIndicator.getAttribute('data-quay-indicator') : null,
      triggerOpacity: trigger ? Number(getComputedStyle(trigger).opacity) : -1,
      triggerExpanded: trigger ? trigger.getAttribute('aria-expanded') : null,
      expandPainted: painted(expand),
      buttons: row.querySelectorAll('button').length,
    };
  });
};

/** The desktop row for one seeded shape. */
const desktopRow = (page: Page, dir: string): Locator =>
  page.locator(
    `[data-testid="sidebar-project-row"][data-project-id="${projectIdByDir.get(dir)}"]`,
  );

const readDesktopLeg = async (page: Page) => {
  await authenticate(page);
  await stubQuayReads(page);
  await page.goto('/');

  const firstRow = page.locator('[data-testid="sidebar-project-row"]').first();
  await expect(firstRow).toBeVisible({ timeout: 20_000 });

  const innerWidth = await page.evaluate(() => window.innerWidth);
  expect(
    innerWidth,
    `this leg declares a ${DESKTOP.width}px viewport but window.innerWidth read ${innerWidth}`,
  ).toBe(DESKTOP.width);

  await settle(page);

  const readings = await page.evaluate(readDesktopRows) as DesktopReading[];
  const byDir = (dir: string): DesktopReading => {
    const projectId = projectIdByDir.get(dir);
    const reading = readings.find((candidate) => candidate.projectId === projectId);
    expect(
      reading,
      `the ${DESKTOP.width}px sidebar drew no row for ${dir} (project ${projectId ?? 'unresolved'}); `
      + `rows: ${heightLedger(readings)}`,
    ).not.toBeUndefined();
    return reading!;
  };

  expect(
    readings.length,
    `the desktop sidebar must draw at least the ${SHAPES.length} seeded shapes; read ${heightLedger(readings)}`,
  ).toBeGreaterThanOrEqual(SHAPES.length);
  expectEqualHeights(readings, `${DESKTOP.width}px`);

  for (const reading of readings) {
    // The row's text is the name line plus the readings line. A path fragment (or the old
    // `- …tail` form) would put a slash in it.
    expect(
      reading.text.includes('/'),
      `${reading.name} prints a path fragment in its row text at ${DESKTOP.width}px: "${reading.text}"`,
    ).toBe(false);
    expect(
      reading.text.includes('...'),
      `${reading.name} prints a truncated-path tail at ${DESKTOP.width}px: "${reading.text}"`,
    ).toBe(false);
    // The row's own click surface is the outer button; the ⋯ trigger is the only other one
    // (the star and the expand arrow are status divs on the desktop row).
    expect(
      reading.buttons,
      `${reading.name} draws ${reading.buttons} descendant buttons; only the ⋯ trigger may be one`,
    ).toBe(1);
  }

  // Shape readings on the desktop row, same rules as the compact card.
  expect(byDir(SHAPES[0].dir).badge, 'the badge+cockpit row must draw the fleet counts').toBe(
    'todo=2,ready=4,needsHuman=3',
  );
  expect(byDir(SHAPES[4].dir).badge, 'a 0/0/0 reading must draw no badge').toBeNull();
  expect(
    byDir(SHAPES[5].dir).quayStatus,
    `a running driver must paint data-quay-indicator="running"; read ${byDir(SHAPES[5].dir).quayStatus}`,
  ).toBe('running');
  expect(
    byDir(SHAPES[0].dir).quayStatus,
    `an idle driver must paint no quay indicator; read ${byDir(SHAPES[0].dir).quayStatus}`,
  ).toBeNull();

  // Idle: the ⋯ is in the DOM but unpainted, and the expand arrow is the one painted control.
  for (const reading of readings) {
    expect(
      reading.triggerOpacity,
      `${reading.name}'s ⋯ trigger must be unpainted at idle; read opacity ${reading.triggerOpacity}`,
    ).toBe(0);
    expect(
      reading.expandPainted,
      `${reading.name}'s status-only expand arrow must stay painted at idle`,
    ).toBe(true);
  }

  // Hover reveals the ⋯ for the hovered row only.
  const hoveredDir = SHAPES[0].dir;
  const hoveredRow = desktopRow(page, hoveredDir);
  await hoveredRow.hover();
  await expect
    .poll(async () => {
      const rows = await page.evaluate(readDesktopRows) as DesktopReading[];
      return rows.find((row) => row.projectId === projectIdByDir.get(hoveredDir))?.triggerOpacity;
    }, { message: 'hovering the desktop row never revealed its ⋯ trigger', timeout: 5_000 })
    .toBe(1);
  const afterHover = await page.evaluate(readDesktopRows) as DesktopReading[];
  const untouched = afterHover.find((row) => row.projectId === projectIdByDir.get(SHORT_NAME));
  expect(
    untouched?.triggerOpacity,
    'a row that is not hovered must keep its ⋯ unpainted',
  ).toBe(0);

  fs.mkdirSync(SHOT_DIR, { recursive: true });
  await page.screenshot({
    path: path.join(SHOT_DIR, `sidebar-project-row-uniform-${DESKTOP.width}-hover.png`),
    fullPage: false,
  });

  return readings;
};

/**
 * Tabs into one row from the focusable element immediately before it in document order. This is
 * the gesture the criterion names — no scripted `focus()` on the trigger — and the neighbour is
 * what a keyboard reader would reach it from.
 */
const tabIntoRow = async (page: Page, dir: string) => {
  const projectId = projectIdByDir.get(dir)!;
  const positioned = await page.evaluate((id) => {
    const row = document.querySelector<HTMLElement>(
      `[data-testid="sidebar-project-row"][data-project-id="${id}"]`,
    );
    if (!row) return 'no row';
    const focusables = [...document.querySelectorAll<HTMLElement>(
      'a[href], button:not([disabled]), input:not([disabled]), select:not([disabled]), '
        + 'textarea:not([disabled]), [tabindex]:not([tabindex="-1"])',
    )].filter((element) => {
      const rect = element.getBoundingClientRect();
      const style = window.getComputedStyle(element);
      return rect.width > 0 && rect.height > 0
        && style.display !== 'none' && style.visibility !== 'hidden';
    });
    const index = focusables.indexOf(row);
    if (index <= 0) return `row has no previous focus target (index=${index})`;
    focusables[index - 1].focus();
    return focusables[index - 1].tagName;
  }, projectId);
  if (positioned === 'no row') throw new Error(`the desktop sidebar drew no row for ${dir}`);

  await page.keyboard.press('Tab');
  const reached = await page.evaluate((id) => {
    const row = document.querySelector<HTMLElement>(
      `[data-testid="sidebar-project-row"][data-project-id="${id}"]`,
    );
    return Boolean(row && document.activeElement && row.contains(document.activeElement));
  }, projectId);
  if (!reached) {
    const active = await page.evaluate(() => {
      const element = document.activeElement;
      return {
        tag: element?.tagName ?? null,
        attrs: element === null
          ? null
          : [...element.attributes].map((attribute) => `${attribute.name}=${attribute.value}`),
      };
    });
    throw new Error(`Tab did not reach the ${dir} row from ${positioned}: ${JSON.stringify(active)}`);
  }
};

/** One desktop leg: geometry + painted state, then the two menu entry points and the keyboard arm. */
const readDesktopInteractionLeg = async (page: Page) => {
  await readDesktopLeg(page);

  // Keyboard: with the pointer parked away from every row, Tab into the row must paint its ⋯.
  await page.mouse.move(0, 0);
  await tabIntoRow(page, SHAPES[0].dir);
  await expect
    .poll(async () => {
      const rows = await page.evaluate(readDesktopRows) as DesktopReading[];
      return rows.find((row) => row.projectId === projectIdByDir.get(SHAPES[0].dir))?.triggerOpacity;
    }, { message: 'Tab focus inside the row never painted its ⋯ trigger', timeout: 5_000 })
    .toBe(1);
  fs.mkdirSync(SHOT_DIR, { recursive: true });
  await page.screenshot({
    path: path.join(SHOT_DIR, `sidebar-project-row-uniform-${DESKTOP.width}-tab.png`),
    fullPage: false,
  });

  // Click entry: the trigger opens the same menu the compact card owns.
  const row = desktopRow(page, SHAPES[0].dir);
  const trigger = row.locator('[data-testid="project-actions-menu"] button[aria-haspopup="menu"]');
  await trigger.click();
  const menu = page.locator('[role="menu"]');
  await expect(menu).toBeVisible();
  const labels = (await menu.locator('[role="menuitem"]').allTextContents()).map((label) => label.trim());
  expect(
    labels,
    `the desktop ⋯ menu must carry the compact menu's items; read ${JSON.stringify(labels)}`,
  ).toEqual([
    'Rename project (F2)',
    'Session filter…',
    'View in cockpit',
    'Pin to wall',
    'Remove project (Delete)',
  ]);
  await expect(trigger).toHaveAttribute('aria-expanded', 'true');
  fs.mkdirSync(SHOT_DIR, { recursive: true });
  await page.screenshot({
    path: path.join(SHOT_DIR, `sidebar-project-row-uniform-${DESKTOP.width}-menu.png`),
    fullPage: false,
  });
  await trigger.click();
  await expect(menu).toHaveCount(0);

  // Right-click entry: the same menu, opened from the row, and the browser menu suppressed.
  // `preventDefault` is observed by patching the prototype rather than by a document listener:
  // the row's handler also stops propagation, so a listener above the React root never runs.
  await page.evaluate(() => {
    const store = window as unknown as { __rowContextMenuPrevented?: boolean };
    store.__rowContextMenuPrevented = false;
    const proto = Event.prototype as Event & { __patched?: boolean };
    if (!proto.__patched) {
      const original = proto.preventDefault;
      proto.preventDefault = function patchedPreventDefault(this: Event) {
        if (this.type === 'contextmenu') {
          (window as unknown as { __rowContextMenuPrevented?: boolean }).__rowContextMenuPrevented = true;
        }
        return original.call(this);
      };
      proto.__patched = true;
    }
  });
  await row.click({ button: 'right' });
  await expect(menu).toBeVisible();
  const prevented = await page.evaluate(
    () => (window as unknown as { __rowContextMenuPrevented?: boolean }).__rowContextMenuPrevented,
  );
  expect(prevented, 'the row must preventDefault on contextmenu').toBe(true);
  const rightClickLabels = (await menu.locator('[role="menuitem"]').allTextContents()).map(
    (label) => label.trim(),
  );
  expect(
    rightClickLabels,
    'the right-click menu must be the same project action menu',
  ).toEqual(labels);
  fs.mkdirSync(SHOT_DIR, { recursive: true });
  await page.screenshot({
    path: path.join(SHOT_DIR, `sidebar-project-row-uniform-${DESKTOP.width}-right-click.png`),
    fullPage: false,
  });
  await page.keyboard.press('Escape');
  await expect(menu).toHaveCount(0);

  // A project the fleet does not register keeps only rename/filter/delete in the same menu.
  const plainRow = desktopRow(page, SHAPES[1].dir);
  await plainRow.hover();
  await plainRow.locator('[data-testid="project-actions-menu"] button[aria-haspopup="menu"]').click();
  await expect(menu).toBeVisible();
  const plainLabels = (await menu.locator('[role="menuitem"]').allTextContents()).map((label) => label.trim());
  expect(
    plainLabels,
    `an unregistered project's desktop menu must omit both cockpit items; read ${JSON.stringify(plainLabels)}`,
  ).toEqual(['Rename project (F2)', 'Session filter…', 'Remove project (Delete)']);
  await page.keyboard.press('Escape');
  await expect(menu).toHaveCount(0);

  await page.mouse.move(0, 0);
  fs.mkdirSync(SHOT_DIR, { recursive: true });
  await page.screenshot({
    path: path.join(SHOT_DIR, `sidebar-project-row-uniform-${DESKTOP.width}.png`),
    fullPage: false,
  });
};

test.describe('the desktop project row is uniform at 1280px', () => {
  test.use({ viewport: { width: DESKTOP.width, height: DESKTOP.height } });

  test('two lines, no path, a quiet ⋯ revealed by hover/Tab and opened by click/right-click', async ({ page }) => {
    await readDesktopInteractionLeg(page);
  });
});

test.beforeAll(async ({ browser, request }) => {
  await bootstrapAuth(browser);
  seedWorkspaces();
  await resolveProjectIds(request);
});

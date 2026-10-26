import fs from 'node:fs';
import path from 'node:path';

import { expect, test } from '@playwright/test';
import type { APIRequestContext, Browser, Page } from '@playwright/test';

/**
 * The sidebar's mobile project row is one fixed two-line card, at every narrow width.
 *
 * WHY A BROWSER. Every criterion here is geometry: the height a card actually takes, whether a
 * name is ellipsized rather than wrapped, whether the second line is still one line, and whether
 * the desktop row's actions are painted or merely present in the DOM with `opacity: 0`. Tailwind
 * classes only become those numbers once an engine applies the stylesheet, so each reading below
 * runs through `page.evaluate` and returns DATA — never an assertion.
 *
 * THE SHAPES. The old row's height depended on how many controls a project happened to show, so
 * the fixture seeds four different shapes inside this run's own data directory — a quay project
 * the fleet registers (badge + cockpit actions), a quay project it does not (badge, no cockpit
 * actions), a plain project (no badge) and a long name that cannot fit the row — and then reads
 * every card, including the ones the shared `playwright.config.ts` seeds. Equal heights across
 * four shapes is the claim; one shape alone would only say a card is self-consistent.
 *
 * WHY THE FLEET AND FEATURE READS ARE STUBBED. This host has no `quay-fleet` registry and the
 * cockpit ships off, so a real reading could not produce the badge+cockpit shape at all. Both are
 * stubbed at the HTTP boundary (`/api/quay/fleet-summary`, `/api/settings/features`); the page,
 * the row, the badge, the menu and the pin hook all run for real. Every stubbed entry is keyed by
 * the REAL project id the server assigned, resolved through `/api/projects` before navigation, so
 * the row matches its reading the same way it does in production.
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

/** The four shapes, each in its own workspace under the run's throwaway data directory. */
type Shape = {
  dir: string;
  /** Whether the workspace carries `.quay/config.yml` (the project-row badge's precondition). */
  quay: boolean;
  /** The fleet entry's counts, or `null` when the fleet does not list this project. */
  counts: { total: number; todo: number; ready: number; needsHuman: number; done: number } | null;
  /** The fleet registry id — the only handle a cockpit board link has; `null` for unregistered. */
  fleetId: string | null;
  /** What this shape proves, printed in every failure message. */
  label: string;
};

const SHAPES: readonly Shape[] = [
  {
    dir: 'uniform-badge-cockpit',
    quay: true,
    counts: { total: 9, todo: 2, ready: 4, needsHuman: 3, done: 0 },
    fleetId: 'uniform-badge-cockpit',
    label: 'badge + cockpit',
  },
  {
    dir: 'uniform-badge-plain',
    quay: true,
    counts: { total: 4, todo: 1, ready: 1, needsHuman: 2, done: 0 },
    fleetId: null,
    label: 'badge, no cockpit',
  },
  {
    dir: 'u3',
    quay: false,
    counts: null,
    fleetId: null,
    label: 'no badge, short name',
  },
  {
    dir: 'uniform-long-project-name-that-will-not-fit-inside-the-narrow-row',
    quay: false,
    counts: null,
    fleetId: null,
    label: 'long name',
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
 * The fleet reading is keyed by project id and the cards carry it as `data-project-id`, so this
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
      driver: { state: 'idle' },
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

/** One card's readings; returns data so the same numbers can be attached to a failure message. */
type CardReading = {
  projectId: string;
  name: string;
  height: number;
  nameClientWidth: number;
  nameScrollWidth: number;
  metaHeight: number;
  badge: string | null;
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

const heightLedger = (readings: readonly CardReading[]): string =>
  readings.map((reading) => `${reading.name}:${reading.height.toFixed(2)}`).join('\n');

/** One mobile leg: seed shapes were already resolved, so read the drawer and judge its cards. */
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

  // Two frames so a card's height is the one the browser settled on, not a mid-layout value.
  await page.evaluate(() => new Promise<void>((resolve) => {
    window.requestAnimationFrame(() => window.requestAnimationFrame(() => resolve()));
  }));

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

  // Every card the row can show — the four seeded shapes and the shared config's workspaces.
  expect(
    readings.length,
    `the drawer must draw at least the four seeded shapes; read ${heightLedger(readings)}`,
  ).toBeGreaterThanOrEqual(SHAPES.length);

  // AC: all cards equal within 1px, printed as `name:height` when they are not.
  const heights = readings.map((reading) => reading.height);
  const spread = Math.max(...heights) - Math.min(...heights);
  expect(
    spread,
    `cards must share one height (±1px) at ${width}px; spread read ${spread.toFixed(2)}px\n`
    + heightLedger(readings),
  ).toBeLessThanOrEqual(1);

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

  // The activity icon is the first thing dropped when the row narrows; at 320 it must be gone,
  // at 390 it must be back, and neither may cost a wrapped line. `display` is read as a resolved
  // value: inside the flex meta row an `inline-flex` child is blockified to `flex`, so the claim
  // is "painted (any non-none display, non-zero box)" versus "dropped (display:none)".
  if (width < 360) {
    expect(
      cockpitShape.quayIndicatorDisplay,
      `the activity icon must be dropped at ${width}px; read display ${cockpitShape.quayIndicatorDisplay} `
      + `(width ${cockpitShape.quayIndicatorWidth}px)`,
    ).toBe('none');
    expect(
      cockpitShape.quayIndicatorWidth,
      'a dropped activity icon must occupy no box',
    ).toBe(0);
  } else {
    expect(
      cockpitShape.quayIndicatorDisplay,
      `the activity icon must be painted at ${width}px; read display ${cockpitShape.quayIndicatorDisplay} `
      + `(width ${cockpitShape.quayIndicatorWidth}px)`,
    ).not.toBe('none');
    expect(
      cockpitShape.quayIndicatorWidth,
      'the activity icon must have a box at this width',
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

/** Opens one card's ⋯ menu and returns the menuitem count (the menu is portalled to body). */
const menuItemCount = async (page: Page, dir: string): Promise<number> => {
  const projectId = projectIdByDir.get(dir)!;
  const card = page.locator(`[data-testid="sidebar-project-card"][data-project-id="${projectId}"]`);
  const trigger = card.locator('button[aria-haspopup="menu"]');
  await trigger.click();
  await expect(page.locator('[role="menu"]')).toBeVisible();
  const count = await page.locator('[role="menuitem"]').count();
  // Toggle closed with the same trigger rather than Escape: the trigger is the menu's own control
  // and Escape is a document-level key other surfaces on this page also listen for.
  await trigger.click();
  await expect(page.locator('[role="menu"]')).toHaveCount(0);
  return count;
};

test.describe('the mobile project card is uniform at 390px', () => {
  test.use({ viewport: { width: MOBILE[0].width, height: MOBILE[0].height } });

  test('every seeded shape draws one fixed-height two-line card', async ({ page }) => {
    await readMobileLeg(page, MOBILE[0].width);

    // The cockpit shape's menu carries the fleet actions; the unregistered quay shape carries
    // neither — the menu is where the row's extracted actions actually live, so the shapes are
    // only real if the menu differs between them.
    const cockpitItems = await menuItemCount(page, SHAPES[0].dir);
    expect(
      cockpitItems,
      `a registered project's ⋯ menu must offer rename/filter/cockpit/watch/delete; read ${cockpitItems} items`,
    ).toBe(5);
    const plainItems = await menuItemCount(page, SHAPES[1].dir);
    expect(
      plainItems,
      `an unregistered project's ⋯ menu must omit both cockpit items; read ${plainItems} items`,
    ).toBe(3);
  });
});

test.describe('the mobile project card is uniform at 320px', () => {
  test.use({ viewport: { width: MOBILE[1].width, height: MOBILE[1].height } });

  test('every seeded shape keeps its height with the activity icon dropped', async ({ page }) => {
    await readMobileLeg(page, MOBILE[1].width);
  });
});

test.describe('the desktop project row is unchanged at 1280px', () => {
  test.use({ viewport: { width: DESKTOP.width, height: DESKTOP.height } });

  test('the row actions are hidden at idle and revealed on hover', async ({ page }) => {
    await authenticate(page);
    await stubQuayReads(page);
    await page.goto('/');

    const row = page.locator('button', { hasText: SHAPES[0].dir }).first();
    await expect(row).toBeVisible({ timeout: 20_000 });

    const innerWidth = await page.evaluate(() => window.innerWidth);
    expect(
      innerWidth,
      `this leg declares a ${DESKTOP.width}px viewport but window.innerWidth read ${innerWidth}`,
    ).toBe(DESKTOP.width);

    const readActions = (name: string) => page.evaluate((projectName: string) => {
      const candidates = Array.from(document.querySelectorAll('button'));
      const target = candidates.find((button) => (button.textContent ?? '').includes(projectName));
      if (!target) return null;
      const read = (selector: string) => {
        const icon = target.querySelector<SVGElement>(selector);
        if (!icon) return { found: false, opacity: null as number | null };
        const wrapper = icon.parentElement as HTMLElement;
        return { found: true, opacity: Number(getComputedStyle(wrapper).opacity) };
      };
      return {
        name: projectName,
        filter: read('.lucide-list-filter'),
        rename: read('.lucide-pen-line'),
        remove: read('.lucide-trash-2'),
      };
    }, name);

    const idle = await readActions(SHAPES[0].dir);
    expect(idle, `no desktop row was found for ${SHAPES[0].dir}`).not.toBeNull();
    for (const [key, reading] of Object.entries({ filter: idle!.filter, rename: idle!.rename, remove: idle!.remove })) {
      expect(
        reading.found,
        `the desktop row must still draw its ${key} action; it was not found in the row`,
      ).toBe(true);
      expect(
        reading.opacity,
        `the desktop row's ${key} action must be unpainted at idle; read opacity ${String(reading.opacity)}`,
      ).toBe(0);
    }

    // The compact card (and its menu) must not be what the desktop row renders.
    await expect(page.locator('[data-testid="sidebar-project-card"]')).toHaveCount(0);

    // Hover reveals them; the transition is 200ms, so poll rather than read once.
    await row.hover();
    await expect
      .poll(async () => (await readActions(SHAPES[0].dir))?.filter.opacity, {
        message: 'hovering the desktop row never revealed its filter action',
        timeout: 5_000,
      })
      .toBe(1);
    const hovered = await readActions(SHAPES[0].dir);
    for (const [key, reading] of Object.entries({ filter: hovered!.filter, rename: hovered!.rename, remove: hovered!.remove })) {
      expect(
        reading.opacity,
        `the hovered row must paint its ${key} action; read opacity ${String(reading.opacity)}`,
      ).toBe(1);
    }

    // Hover is scoped to the row under the pointer, not fanned out to every row.
    const untouched = await readActions(SHORT_NAME);
    expect(untouched, `no desktop row was found for ${SHORT_NAME}`).not.toBeNull();
    expect(
      untouched!.remove.opacity,
      'a row that is not hovered must keep its actions unpainted',
    ).toBe(0);

    fs.mkdirSync(SHOT_DIR, { recursive: true });
    await page.screenshot({
      path: path.join(SHOT_DIR, `sidebar-project-row-uniform-${DESKTOP.width}.png`),
      fullPage: false,
    });
  });
});

test.beforeAll(async ({ browser, request }) => {
  await bootstrapAuth(browser);
  seedWorkspaces();
  await resolveProjectIds(request);
});

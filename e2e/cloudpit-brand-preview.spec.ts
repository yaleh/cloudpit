import { mkdirSync } from 'node:fs';
import path from 'node:path';

import { expect, test } from '@playwright/test';
import type { Page } from '@playwright/test';

import { findBrandViolations } from '../scripts/brand-allowlist-check.mjs';

/**
 * AC-456 — the goal preview UI DoD for GOAL-054: the Cloudpit visible identity on a real page.
 *
 * AC-451/452/453 read the rename from static surfaces (source scans, server units, Electron
 * tests). None of them renders a page, so none of them can say what a user sees on the
 * `quay goal preview GOAL-054` page. This criterion is that missing arm: it drives the real
 * Vite-served client against the real backend (playwright.config.ts's shared webServer pair and
 * throwaway data directory — the same tree `goal preview` serves), reads what the browser
 * actually rendered, and writes full-page screenshots to `tmp/cloudpit-brand-preview/`.
 *
 * Two properties this file is built around:
 *
 * 1. Every reading goes through ONE assertion function, `brandPreviewViolations`. The positive
 *    arm feeds it the real page readings; the false-form arm feeds it synthetic readings whose
 *    title / manifest name / About product name are the legacy `CloudCLI`. Because both arms call
 *    the same function, a function that had quietly stopped judging one face would also stop
 *    rejecting its injected control — the negative control cannot pass through a different path.
 *
 * 2. The sidebar/auth brand scan reuses the production allowlist rules table
 *    (`scripts/brand-allowlist-check.mjs`), not a second copy. `CloudCLI Hosted` / `CloudCLI Pro`
 *    are allowlisted external-service copy, so a blanket "CloudCLI must not appear" would be a
 *    false red; the scan asks the same table AC-451's criterion asks.
 *
 * A human ruling on 2026-10-31 (the task's `## Resolution`) corrected two facts this file must
 * not get wrong: About has no "Based on CloudCLI UI" sentence (the real About tab never had one),
 * and About's legal/licence and upstream-link faces are the ones that prove the allowlist surface
 * is intact. The About assertions below follow that ruling.
 */

const EXPECTED_BRAND = 'Cloudpit';
const UPSTREAM_REPO_URL = 'https://github.com/siteboon/claudecodeui';
const LICENSE_MARKER = 'AGPL-3.0';

/** Full-page screenshots land here; `tmp/` is gitignored, the task body pastes the paths. */
const SHOTS_DIR = path.resolve(process.cwd(), 'tmp', 'cloudpit-brand-preview');

const USERNAME = 'e2euser';
const PASSWORD = 'e2epassword';

/** One user-visible surface whose text is scanned with the production brand allowlist. */
export type BrandVisibleSurface = {
  /** Names the face in a failure message (`sidebar`, `auth`). */
  surface: string;
  /** The text the browser really rendered there, one line per entry in `text`. */
  text: string;
};

/** Everything AC-456 reads from the preview page, in the shape the assertion function judges. */
export type BrandPreviewReadings = {
  title: string;
  appleTitle: string;
  manifest: { name?: string; short_name?: string };
  about: { productName: string; links: string[]; licenseLine: string };
  visibleSurfaces: BrandVisibleSurface[];
};

/**
 * The one assertion path: every brand face AC-456 covers, judged from readings alone.
 *
 * Pure on purpose — the real page and the three injected false-forms feed it the same shape, so
 * the control arm exercises the production predicate rather than a re-implementation.
 *
 * Returns one message per violation; an empty array means the preview shows the Cloudpit
 * identity everywhere this criterion can observe.
 */
export function brandPreviewViolations(readings: BrandPreviewReadings): string[] {
  const violations: string[] = [];

  const expectBrand = (face: string, actual: string | undefined) => {
    if (actual !== EXPECTED_BRAND) {
      violations.push(`${face} is ${JSON.stringify(actual)}, expected ${JSON.stringify(EXPECTED_BRAND)}`);
    }
  };

  expectBrand('document.title', readings.title);
  expectBrand('apple-mobile-web-app-title', readings.appleTitle);
  expectBrand('manifest.name', readings.manifest.name);
  expectBrand('manifest.short_name', readings.manifest.short_name);
  expectBrand('About product name', readings.about.productName);

  if (!readings.about.links.includes(UPSTREAM_REPO_URL)) {
    violations.push(
      `About no longer links to the upstream repository ${UPSTREAM_REPO_URL} `
        + `(links: ${JSON.stringify(readings.about.links)})`,
    );
  }
  if (!readings.about.licenseLine.includes(LICENSE_MARKER)) {
    violations.push(
      `About license line is ${JSON.stringify(readings.about.licenseLine)}, `
        + `expected it to name ${LICENSE_MARKER}`,
    );
  }

  for (const surface of readings.visibleSurfaces) {
    const sources = surface.text.split('\n').map((text, index) => ({
      file: surface.surface,
      label: String(index + 1),
      text,
    }));
    for (const violation of findBrandViolations(sources)) {
      violations.push(
        `${surface.surface} carries "${violation.token}" outside the brand allowlist: ${violation.text.trim()}`,
      );
    }
  }

  return violations;
}

/**
 * Signs in — creating the account when this run's throwaway database has none yet.
 *
 * Mirrors the bounded onboarding walk the sibling specs use (`e2e/landing-overview.spec.ts`):
 * the fresh-data-directory arm creates the account and completes the two-step wizard, the
 * reused-directory arm logs in. The caller has already waited for one of the two forms.
 */
async function signIn(page: Page): Promise<void> {
  const createAccount = page.getByRole('button', { name: 'Create Account' });
  const settings = page.getByRole('button', { name: 'Settings', exact: true }).first();

  if (await createAccount.count()) {
    await page.locator('#username').fill(USERNAME);
    await page.locator('input[type=password]').nth(0).fill(PASSWORD);
    await page.locator('input[type=password]').nth(1).fill(PASSWORD);
    await createAccount.click();
    await page.getByPlaceholder('John Doe').fill('E2E User');
    await page.getByPlaceholder('john@example.com').fill('e2e@example.com');
    await page.getByRole('button', { name: 'Next' }).click();
    await page.getByRole('button', { name: 'Complete Setup' }).click();
  } else {
    await page.locator('#username').fill(USERNAME);
    await page.locator('input[type=password]').first().fill(PASSWORD);
    await page.locator('form button[type=submit]').click();
  }

  await expect(settings).toBeVisible({ timeout: 30_000 });
}

/**
 * The sidebar's rendered text.
 *
 * The sidebar module has no dedicated test id, so the container is derived structurally: the
 * header's `[data-sidebar-go-home]` link is inside the sidebar, and the region is the ancestor
 * that is a direct child of `[data-app-shell]`. The positive arm asserts the returned text
 * contains the footer brand line (`Cloudpit v…`), so an empty or wrong-container reading cannot
 * pass the brand scan vacuously.
 */
async function readSidebarText(page: Page): Promise<string> {
  return page.evaluate(() => {
    const shell = document.querySelector('[data-app-shell]');
    if (!shell) return '';
    const goHome = shell.querySelector('[data-sidebar-go-home]');
    let region = goHome;
    while (region && region.parentElement !== shell) {
      region = region.parentElement;
    }
    const rendered = (region || shell.firstElementChild);
    return rendered ? (rendered.innerText || '') : '';
  });
}

/** Everything AC-456 asserts, read from the live Settings → About panel. */
async function readAboutPanel(page: Page): Promise<BrandPreviewReadings['about']> {
  return page.evaluate(() => {
    const main = document.querySelector('.modal-backdrop main');
    if (!main) {
      return { productName: '', links: [], licenseLine: '' };
    }
    const styledName = main.querySelector('span[style*="font-family"]');
    // The version pill sits in the same row as the product-name span; the span before it is
    // the name when the inline wordmark style is absent.
    const releasesLink = main.querySelector('a[href*="/releases"]');
    const fallbackName = releasesLink && releasesLink.parentElement
      ? releasesLink.parentElement.querySelector('span')
      : null;
    const productName = ((styledName || fallbackName)?.textContent || '').trim();
    const links = Array.from(main.querySelectorAll('a'))
      .map((anchor) => anchor.getAttribute('href') || '');
    const licenseLine = ((main.innerText || ''))
      .split('\n')
      .map((line) => line.trim())
      .find((line) => line.includes('AGPL')) || '';
    return { productName, links, licenseLine };
  });
}

/** Reads every AC-456 face from the page the user is looking at. */
async function readPreview(
  page: Page,
  visibleSurfaces: BrandVisibleSurface[],
): Promise<BrandPreviewReadings> {
  const title = await page.title();
  const appleTitle = await page.evaluate(
    () => document.querySelector('meta[name="apple-mobile-web-app-title"]')?.getAttribute('content') ?? '',
  );
  const manifest = await page.evaluate(async () => {
    const response = await fetch('/manifest.json');
    return await response.json();
  });
  const about = await readAboutPanel(page);
  return { title, appleTitle, manifest, about, visibleSurfaces };
}

test.describe.configure({ mode: 'serial' });

test('AC-456 goal preview shows the Cloudpit identity on every visible preview surface', async ({ page }) => {
  mkdirSync(SHOTS_DIR, { recursive: true });

  await page.goto('/');

  const createAccount = page.getByRole('button', { name: 'Create Account' });
  const settings = page.getByRole('button', { name: 'Settings', exact: true }).first();
  await expect(createAccount.or(settings).or(page.locator('#username')).first()).toBeVisible({
    timeout: 30_000,
  });

  // The auth surface is read before signing in: it is the unauthenticated face a preview user
  // sees first, and no other leg can observe it once the session token is restored.
  const authText = await page.locator('body').innerText();
  expect(
    authText,
    'the auth surface must render real copy (Create Account or Sign In), not a blank page',
  ).toMatch(/Create Account|Sign In|Welcome Back/);
  await page.screenshot({ path: path.join(SHOTS_DIR, 'AC-456-auth.png'), fullPage: true });

  await signIn(page);
  await expect(page.locator('[data-app-shell]')).toBeVisible({ timeout: 30_000 });
  await expect(page).toHaveTitle(EXPECTED_BRAND, { timeout: 15_000 });

  const sidebarText = await readSidebarText(page);
  expect(
    sidebarText,
    'the sidebar reading must be the real sidebar — its footer prints "Cloudpit v<version>"',
  ).toContain(`${EXPECTED_BRAND} v`);
  await page.screenshot({ path: path.join(SHOTS_DIR, 'AC-456-landing.png'), fullPage: true });

  await settings.click();
  // The settings sidebar renders both the desktop rail and the phone pill bar; only one is
  // visible at this viewport, and the desktop rail is the first in DOM order.
  const aboutTab = page.locator('[data-settings-tab="about"]').first();
  await expect(aboutTab).toBeVisible({ timeout: 15_000 });
  await aboutTab.click();
  await expect(page.locator('.modal-backdrop main')).toContainText(LICENSE_MARKER, {
    timeout: 15_000,
  });
  await page.screenshot({ path: path.join(SHOTS_DIR, 'AC-456-about.png'), fullPage: true });

  const readings = await readPreview(page, [
    { surface: 'auth', text: authText },
    { surface: 'sidebar', text: sidebarText },
  ]);

  console.log('[AC-456] readings', JSON.stringify({
    title: readings.title,
    appleTitle: readings.appleTitle,
    manifest: readings.manifest,
    about: readings.about,
  }));

  const violations = brandPreviewViolations(readings);
  expect(
    violations,
    `AC-456 Cloudpit visible-identity violations:\n${violations.join('\n')}`,
  ).toEqual([]);
});

test('AC-456 false-form rejects injected CloudCLI readings through the same assertion function', () => {
  const clean: BrandPreviewReadings = {
    title: EXPECTED_BRAND,
    appleTitle: EXPECTED_BRAND,
    manifest: { name: EXPECTED_BRAND, short_name: EXPECTED_BRAND },
    about: {
      productName: EXPECTED_BRAND,
      links: [UPSTREAM_REPO_URL],
      licenseLine: `Licensed under ${LICENSE_MARKER}`,
    },
    visibleSurfaces: [],
  };

  // A clean read must pass the function before the injections are judged: otherwise a function
  // that reds everything would satisfy all three false-forms without discriminating.
  expect(brandPreviewViolations(clean), 'the un-injected baseline must be green').toEqual([]);

  const cases = [
    {
      face: 'document.title',
      injected: { field: 'title', value: 'CloudCLI' },
      message: /document\.title is "CloudCLI"/,
      readings: { ...clean, title: 'CloudCLI' },
    },
    {
      face: 'manifest.name',
      injected: { field: 'manifest.name', value: 'CloudCLI' },
      message: /manifest\.name is "CloudCLI"/,
      readings: { ...clean, manifest: { ...clean.manifest, name: 'CloudCLI' } },
    },
    {
      face: 'About product name',
      injected: { field: 'about.productName', value: 'CloudCLI' },
      message: /About product name is "CloudCLI"/,
      readings: { ...clean, about: { ...clean.about, productName: 'CloudCLI' } },
    },
  ];

  // The allowlist scan is a second, live judging path inside the same function: a legacy token in
  // visible copy must red, while the allowlisted external-service phrase must not. Without both
  // legs the sidebar/auth check could be a blanket grep or a no-op and still look green.
  expect(
    brandPreviewViolations({
      ...clean,
      visibleSurfaces: [{ surface: 'sidebar', text: 'Powered by CloudCLI' }],
    }).some((violation) => /^sidebar carries "CloudCLI"/.test(violation)),
    'an un-allowlisted CloudCLI in sidebar copy must red through the allowlist scan',
  ).toBe(true);
  expect(
    brandPreviewViolations({
      ...clean,
      visibleSurfaces: [{ surface: 'about', text: 'Try CloudCLI Hosted' }],
    }),
    'the allowlisted external-service phrase "CloudCLI Hosted" must not red',
  ).toEqual([]);

  for (const testCase of cases) {
    const violations = brandPreviewViolations(testCase.readings);
    console.log(
      `[AC-456] false-form ${testCase.face}: injected ${testCase.injected.field}=`
        + `${JSON.stringify(testCase.injected.value)} -> ${JSON.stringify(violations)}`,
    );
    expect(
      violations.some((violation) => testCase.message.test(violation)),
      `${testCase.face}: injecting CloudCLI must red through the shared assertion function; `
        + `got ${JSON.stringify(violations)}`,
    ).toBe(true);
  }
});

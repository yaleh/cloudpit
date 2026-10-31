#!/usr/bin/env node
/**
 * AC-451 criterion: the Cloudpit brand allowlist checker actually discriminates.
 *
 * This file is the executable reading of the AC. It does not restate the checker's logic in a
 * second implementation: every arm runs the production `runBrandAllowlistCheck` /
 * `findBrandViolations` / `checkDistributionIdentity` / `checkPackedManifest` functions, so a
 * checker that silently passed would fail the false-form arm here.
 *
 * Arms:
 *   AC1 — the checker and this criterion exist, and the real tree passes with zero violations.
 *   AC2 — the visible surfaces carry the VALUE `Cloudpit` (positive assertions, not just
 *          "no CloudCLI").
 *   AC3 — the npm/desktop distribution identity is `@yalehwang/cloudpit` / bin `cloudpit`.
 *   AC4 — a real `npm pack` tarball has only the `cloudpit` bin; a synthetic `cloudcli` bin is
 *          rejected by the same validator.
 *   AC5 — allowlisted attribution is accepted, product copy is not, and the scan surface list
 *          covers every file/glob the task names.
 *   AC6 — injecting `CloudCLI` into a manifest, a locale value, the CLI banner and the Electron
 *          APP_NAME turns the same scan red and names the file; the checker CLI exits 1.
 */

import assert from 'node:assert/strict';
import { execFileSync, spawnSync } from 'node:child_process';
import { existsSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import test from 'node:test';
import { fileURLToPath } from 'node:url';

import {
  SCANNED_SURFACES,
  checkDistributionIdentity,
  checkPackedManifest,
  findBrandViolations,
  runBrandAllowlistCheck,
} from './brand-allowlist-check.mjs';

const HERE = path.dirname(fileURLToPath(import.meta.url));
// `scripts/` -> repository root is one level up.
const ROOT = path.resolve(HERE, '..');

/** @param {string} rel @returns {string} */
function read(rel) {
  return readFileSync(path.join(ROOT, rel), 'utf8');
}

const LOCALES = ['de', 'en', 'es', 'fr', 'id', 'it', 'ja', 'ko', 'ru', 'tr', 'zh-CN', 'zh-TW'];

/**
 * The surface list the task's Proposal names. Every entry must be in SCANNED_SURFACES.
 * @type {string[]}
 */
const REQUIRED_SURFACES = [
  'index.html',
  'public/manifest.json',
  'README.md',
  'src/modules/i18n/locales/**/*.json',
  'src/shared/utils.ts',
  'src/modules/chat-session/utils/session/pageTitleNotification.ts',
  'src/modules/auth/AuthLoadingScreen.tsx',
  'src/modules/auth/AuthScreenLayout.tsx',
  'src/modules/oauth-consent/OAuthConsentRoute.tsx',
  'src/modules/sidebar/SidebarFooter.tsx',
  'src/modules/settings/tabs/AboutTab.tsx',
  'src/modules/mcp/McpServers.tsx',
  'server/modules/cli/cli.service.ts',
  'server/modules/cli/sandbox.service.ts',
  'server/modules/system/system.service.ts',
  'server/index.ts',
  'electron/main.js',
  'electron/desktopWindow.js',
  'electron/launcher/launcher.js',
  'electron/localServer.js',
  'electron/viewHost.js',
];

test('AC1: checker and criterion exist and the real tree has zero violations', () => {
  assert.ok(existsSync(path.join(ROOT, 'scripts', 'brand-allowlist-check.mjs')), 'the checker must exist');
  assert.ok(existsSync(path.join(ROOT, 'scripts', 'brand-allowlist-check.test.mjs')), 'the criterion must exist');

  const result = runBrandAllowlistCheck({ root: ROOT });
  assert.deepEqual(result.violations, [], `the real tree must have no brand violations:\n${JSON.stringify(result.violations, null, 2)}`);
  assert.equal(result.exitCode, 0);
  assert.ok(result.readings.scannedFiles > 25, `expected the scan to cover the locale bundles too, got ${result.readings.scannedFiles} files`);
  assert.ok(result.readings.localeValues > 1000, `expected locale string values to be scanned, got ${result.readings.localeValues}`);
});

test('AC2: the visible product surfaces carry the Cloudpit value', () => {
  const indexHtml = read('index.html');
  const titleMatch = indexHtml.match(/<title>([^<]*)<\/title>/);
  assert.equal(titleMatch?.[1], 'Cloudpit', 'index.html <title> must read Cloudpit');
  const appleTitleMatch = indexHtml.match(/name="apple-mobile-web-app-title"\s+content="([^"]*)"/);
  assert.equal(appleTitleMatch?.[1], 'Cloudpit', 'the iOS PWA title must read Cloudpit');

  /** @type {{ name: string, short_name: string, description: string }} */
  const manifest = JSON.parse(read('public/manifest.json'));
  assert.equal(manifest.name, 'Cloudpit', 'manifest name must read Cloudpit');
  assert.equal(manifest.short_name, 'Cloudpit', 'manifest short_name must read Cloudpit');
  assert.match(manifest.description, /^Cloudpit\b/, 'manifest description must name Cloudpit');

  assert.match(
    read('src/shared/utils.ts'),
    /const DEFAULT_PAGE_TITLE = 'Cloudpit';/,
    'DEFAULT_PAGE_TITLE must be the Cloudpit value',
  );

  const constants = read('src/shared/constants.ts');
  assert.match(constants, /name: 'Cloudpit'/, 'BRAND.name must be the Cloudpit value');
  assert.match(constants, /packageName: '@yalehwang\/cloudpit'/, 'BRAND.packageName must be the new package');
  assert.doesNotMatch(constants, /Nothing consumes it yet/, 'the stale "unwired" comment must be updated');

  assert.match(
    read('src/modules/settings/tabs/AboutTab.tsx'),
    /BRAND\.name/,
    'the About product name must come from BRAND.name',
  );

  const cli = read('server/modules/cli/cli.service.ts');
  assert.match(cli, /Cloudpit - Command Line Tool/, 'the CLI banner must read Cloudpit');
  assert.match(cli, /Cloudpit - Status/, 'CLI status must read Cloudpit');

  const electron = read('electron/main.js');
  assert.match(electron, /const APP_NAME = 'Cloudpit';/, 'Electron APP_NAME must be the Cloudpit value');
  assert.match(electron, /Cloudpit account connected/, 'a derived notification title must carry Cloudpit');
});

test('AC3: distribution identity points at @yalehwang/cloudpit with bin cloudpit', () => {
  /** @type {Record<string, any>} */
  const pkg = JSON.parse(read('package.json'));
  assert.equal(pkg.name, '@yalehwang/cloudpit');
  assert.deepEqual(Object.keys(pkg.bin), ['cloudpit']);
  assert.equal(pkg.productName, 'Cloudpit');
  assert.equal(pkg.build.productName, 'Cloudpit');
  assert.match(String(pkg.build.artifactName), /^cloudpit-desktop-/);
  assert.deepEqual(checkDistributionIdentity(pkg), [], 'the production identity check must accept the real package.json');

  /** @type {Record<string, any>} */
  const lock = JSON.parse(read('package-lock.json'));
  assert.equal(lock.name, '@yalehwang/cloudpit', 'package-lock root name must match');
  assert.equal(lock.packages[''].name, '@yalehwang/cloudpit', 'package-lock packages[""] name must match');

  for (const locale of LOCALES) {
    /** @type {Record<string, any>} */
    const common = JSON.parse(read(`src/modules/i18n/locales/${locale}/common.json`));
    assert.equal(
      common.versionUpdate?.npmUpgradeCommand,
      'npm install -g @yalehwang/cloudpit@latest',
      `${locale}/common.json npmUpgradeCommand must point at the new package`,
    );
  }

  assert.match(read('server/modules/system/system.service.ts'), /@yalehwang\/cloudpit@latest/);
  const cliModule = read('server/modules/cli/cli.module.ts');
  assert.match(cliModule, /npm show @yalehwang\/cloudpit version/, 'the version check must query the new package');
  assert.match(cliModule, /npm update -g @yalehwang\/cloudpit/, 'the self-update must install the new package');
});

test('AC4: a real tarball exposes only the cloudpit bin, and a synthetic cloudcli bin is rejected', () => {
  const packDirectory = mkdtempSync(path.join(os.tmpdir(), 'cloudpit-pack-'));
  try {
    const packOutput = execFileSync(
      'npm',
      ['pack', '--ignore-scripts', '--json', '--pack-destination', packDirectory],
      { cwd: ROOT, encoding: 'utf8' },
    );
    /** @type {{ filename: string }[]} */
    const packed = JSON.parse(packOutput);
    assert.equal(packed.length, 1, `npm pack must produce one tarball, got ${packed.length}`);
    const tarballName = packed[0].filename;
    assert.match(tarballName, /^yalehwang-cloudpit-/, `the tarball must be named for the new package, got ${tarballName}`);

    const packedManifestText = execFileSync(
      'tar',
      ['-xOf', path.join(packDirectory, tarballName), 'package/package.json'],
      { encoding: 'utf8' },
    );
    /** @type {Record<string, any>} */
    const packedManifest = JSON.parse(packedManifestText);
    assert.deepEqual(Object.keys(packedManifest.bin), ['cloudpit'], 'the packed manifest must expose only cloudpit');
    assert.deepEqual(checkPackedManifest(packedManifest), [], 'the packed-manifest validator must accept the real tarball');

    const synthetic = checkPackedManifest({ bin: { cloudcli: 'dist-server/server/modules/cli/cli.js' } });
    assert.equal(synthetic.length, 1, 'a synthetic cloudcli bin must be rejected');
    assert.match(synthetic[0].message, /cloudcli/, 'the rejection must name the offending bin');
  } finally {
    rmSync(packDirectory, { recursive: true, force: true });
  }
});

test('AC5: the allowlist accepts attribution and rejects product copy, over every declared surface', () => {
  const result = runBrandAllowlistCheck({ root: ROOT });
  assert.equal(result.exitCode, 0, JSON.stringify(result.violations, null, 2));
  assert.ok(result.readings.allowlistHits > 0, 'the real tree must exercise the allowlist (attribution, third-party names)');

  /**
   * @param {string} text
   * @returns {ReturnType<typeof findBrandViolations>}
   */
  const violationsFor = (text) => findBrandViolations([{ file: 'synthetic.txt', label: 'synthetic:1', text }]);

  assert.deepEqual(violationsFor('CloudCLI Cloud'), [], '"CloudCLI Cloud" is an external service name');
  assert.deepEqual(violationsFor('Based on CloudCLI UI'), [], 'the About attribution sentence is allowed');
  assert.deepEqual(violationsFor('PRISM CloudCLI'), [], 'a third-party plugin name is allowed');
  assert.equal(violationsFor('Managed by CloudCLI').length, 1, 'product copy must not be allowlisted');
  assert.equal(violationsFor('CloudCLI Cloud and CloudCLI').length, 1, 'the allowlist is span-based, not line-based');

  const scannedGlobs = new Set(SCANNED_SURFACES.map((surface) => surface.glob));
  for (const required of REQUIRED_SURFACES) {
    assert.ok(scannedGlobs.has(required), `the scan surface list must include ${required}`);
  }
});

test('AC6: injected legacy tokens turn the same scan red and name the file', () => {
  /** @type {Record<string, any>} */
  const manifest = JSON.parse(read('public/manifest.json'));
  manifest.name = 'CloudCLI';
  const manifestOverrides = { 'public/manifest.json': `${JSON.stringify(manifest, null, 2)}\n` };

  const manifestResult = runBrandAllowlistCheck({ root: ROOT, overrides: manifestOverrides });
  assert.equal(manifestResult.exitCode, 1, 'an injected manifest name must fail the check');
  assert.ok(
    manifestResult.violations.some((violation) => violation.file === 'public/manifest.json'),
    `the manifest violation must name its file, got ${JSON.stringify(manifestResult.violations)}`,
  );

  const localeFile = 'src/modules/i18n/locales/en/auth.json';
  const localeResult = runBrandAllowlistCheck({
    root: ROOT,
    overrides: { [localeFile]: JSON.stringify({ footerText: 'CloudCLI' }) },
  });
  assert.equal(localeResult.exitCode, 1, 'an injected locale value must fail the check');
  assert.ok(localeResult.violations.some((violation) => violation.file === localeFile));

  const cliFile = 'server/modules/cli/cli.service.ts';
  const cliResult = runBrandAllowlistCheck({
    root: ROOT,
    overrides: { [cliFile]: "export const banner = 'CloudCLI';\n" },
  });
  assert.equal(cliResult.exitCode, 1, 'an injected CLI banner must fail the check');
  assert.ok(cliResult.violations.some((violation) => violation.file === cliFile));

  const electronFile = 'electron/main.js';
  const electronResult = runBrandAllowlistCheck({
    root: ROOT,
    overrides: { [electronFile]: "const APP_NAME = 'CloudCLI';\n" },
  });
  assert.equal(electronResult.exitCode, 1, 'an injected Electron APP_NAME must fail the check');
  assert.ok(electronResult.violations.some((violation) => violation.file === electronFile));

  // The checker's own CLI must exit 1 on the same injection, not just the imported function.
  const overridesDirectory = mkdtempSync(path.join(os.tmpdir(), 'cloudpit-overrides-'));
  try {
    const overridesPath = path.join(overridesDirectory, 'overrides.json');
    writeFileSync(overridesPath, JSON.stringify(manifestOverrides));
    const cliRun = spawnSync(
      process.execPath,
      [path.join(ROOT, 'scripts', 'brand-allowlist-check.mjs'), '--root', ROOT, '--overrides', overridesPath],
      { encoding: 'utf8' },
    );
    assert.equal(cliRun.status, 1, `the checker CLI must exit 1; stderr was:\n${cliRun.stderr}`);
    assert.match(cliRun.stderr, /public\/manifest\.json/, 'the CLI must name the offending file');
  } finally {
    rmSync(overridesDirectory, { recursive: true, force: true });
  }
});

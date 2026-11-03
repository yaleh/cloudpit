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
 *   AC7 — the deprecated package name `@yalehwang/cloudcli` is scanned (the CLI composition root
 *          is a declared surface) and is a violation on any npm update path; the migration-notice
 *          / release-comment / changelog shapes are allowed only through explicit spans.
 */

import assert from 'node:assert/strict';
import { execFileSync, spawnSync } from 'node:child_process';
import { existsSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import test from 'node:test';
import { fileURLToPath } from 'node:url';

import {
  CURRENT_DOC_SURFACES,
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
  'CONTRIBUTING.md',
  'docs/README.de.md',
  'docs/README.ja.md',
  'docs/README.ko.md',
  'docs/README.ru.md',
  'docs/README.tr.md',
  'docs/README.zh-CN.md',
  'docs/README.zh-TW.md',
  'docs/architecture/cockpit-attention/01-planes.puml',
  'docs/architecture/cockpit-attention/CARD-PROVIDERS.md',
  'docs/architecture/cockpit-attention/INTERACTION-PRINCIPLES.md',
  'docs/architecture/cockpit-attention/README.md',
  'docs/architecture/knowledge-application/FACT-CONTRACT.md',
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
  'server/modules/cli/cli.module.ts',
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

test('AC7: the deprecated package name is a violation on update paths', () => {
  // The CLI composition root holds the self-update commands, so it must be a code surface.
  const cliModuleSurface = SCANNED_SURFACES.find(
    (surface) => surface.glob === 'server/modules/cli/cli.module.ts',
  );
  assert.deepEqual(
    cliModuleSurface,
    { glob: 'server/modules/cli/cli.module.ts', kind: 'code' },
    'cli.module.ts must be scanned as code so comment lines stay documentation',
  );

  const realResult = runBrandAllowlistCheck({ root: ROOT });
  assert.equal(
    realResult.exitCode,
    0,
    `widening the token must not red the real tree:\n${JSON.stringify(realResult.violations, null, 2)}`,
  );

  const cliModuleFile = 'server/modules/cli/cli.module.ts';
  const moduleResult = runBrandAllowlistCheck({
    root: ROOT,
    overrides: {
      [cliModuleFile]: "execSync('npm update -g @yalehwang/cloudcli', { stdio: 'inherit' });\n",
    },
  });
  assert.equal(moduleResult.exitCode, 1, 'an update path pointing at the deprecated package must fail');
  assert.ok(
    moduleResult.violations.some(
      (violation) => violation.file === cliModuleFile && violation.message.includes('@yalehwang/cloudcli'),
    ),
    `the violation must name the deprecated package and its file, got ${JSON.stringify(moduleResult.violations)}`,
  );

  const cliServiceFile = 'server/modules/cli/cli.service.ts';
  const serviceResult = runBrandAllowlistCheck({
    root: ROOT,
    overrides: {
      [cliServiceFile]: "export const UPGRADE = 'npm install -g @yalehwang/cloudcli';\n",
    },
  });
  assert.equal(serviceResult.exitCode, 1, 'an install hint pointing at the deprecated package must fail');
  assert.ok(serviceResult.violations.some((violation) => violation.file === cliServiceFile));

  // Historical references are allowed only through explicit spans; an npm update path that
  // happens to look similar stays a violation.
  /** @param {string} text @returns {ReturnType<typeof findBrandViolations>} */
  const violationsFor = (text) => findBrandViolations([{ file: 'synthetic.txt', label: 'synthetic:1', text }]);
  assert.deepEqual(violationsFor('Install @yalehwang/cloudpit and uninstall @yalehwang/cloudcli.'), []);
  assert.deepEqual(violationsFor('publishes the package to npm as `@yalehwang/cloudcli`, authenticated with'), []);
  assert.deepEqual(violationsFor('publish the fork as @yalehwang/cloudcli on npm'), []);
  assert.equal(violationsFor('npm show @yalehwang/cloudcli version').length, 1);
  assert.equal(violationsFor('npm update -g @yalehwang/cloudcli').length, 1);
});

/**
 * The current-documentation sweep: the docs a reader lands on today. Historical surfaces
 * (`docs/proposals/`, `docs/experiments/`, `adr/`, `CHANGELOG.md`, `NOTICE`, `LICENSE`) are
 * deliberately absent and must stay untouched.
 */
const REQUIRED_DOC_SURFACES = [
  'README.md',
  'CONTRIBUTING.md',
  'docs/README.de.md',
  'docs/README.ja.md',
  'docs/README.ko.md',
  'docs/README.ru.md',
  'docs/README.tr.md',
  'docs/README.zh-CN.md',
  'docs/README.zh-TW.md',
  'docs/architecture/cockpit-attention/01-planes.puml',
  'docs/architecture/cockpit-attention/CARD-PROVIDERS.md',
  'docs/architecture/cockpit-attention/INTERACTION-PRINCIPLES.md',
  'docs/architecture/cockpit-attention/README.md',
  'docs/architecture/knowledge-application/FACT-CONTRACT.md',
];

test('current docs: the declared doc surfaces cover every named file and the real tree is green', () => {
  const declaredDocGlobs = CURRENT_DOC_SURFACES.map((surface) => surface.glob).sort();
  assert.deepEqual(
    declaredDocGlobs,
    [...REQUIRED_DOC_SURFACES].sort(),
    'CURRENT_DOC_SURFACES must list exactly the current-doc surfaces the task names',
  );

  const scannedGlobs = new Set(SCANNED_SURFACES.map((surface) => surface.glob));
  for (const required of REQUIRED_DOC_SURFACES) {
    assert.ok(scannedGlobs.has(required), `the scan surface list must include ${required}`);
  }

  const result = runBrandAllowlistCheck({ root: ROOT });
  assert.deepEqual(result.violations, [], JSON.stringify(result.violations, null, 2));
  assert.equal(result.exitCode, 0);
  assert.equal(
    result.readings.docSurfaces,
    REQUIRED_DOC_SURFACES.length,
    `the docSurfaces reading must cover every named path, got ${result.readings.docSurfaces}`,
  );
  assert.deepEqual(
    [...result.readings.docSurfaceFiles].sort(),
    [...REQUIRED_DOC_SURFACES].sort(),
    'the checked doc-surface files must be exactly the named paths',
  );
});

test('current docs: injecting CloudCLI into a README H1, a translated H1 and an architecture doc reds the scan', () => {
  const cases = [
    {
      file: 'README.md',
      text: read('README.md').replace('<h1>Cloudpit</h1>', '<h1>CloudCLI</h1>'),
    },
    {
      file: 'docs/README.ja.md',
      text: read('docs/README.ja.md').replace('<h1>Cloudpit', '<h1>CloudCLI'),
    },
    {
      file: 'docs/architecture/cockpit-attention/README.md',
      text: `${read('docs/architecture/cockpit-attention/README.md')}\nCloudCLI 只做只读投影。\n`,
    },
  ];

  for (const { file, text } of cases) {
    assert.notEqual(text, read(file), `${file}: the false-form override must change the file`);
    const result = runBrandAllowlistCheck({ root: ROOT, overrides: { [file]: text } });
    assert.equal(result.exitCode, 1, `${file}: injecting CloudCLI must fail the check`);
    assert.ok(
      result.violations.some(
        (violation) => violation.file === file && violation.message.includes('CloudCLI'),
      ),
      `${file}: the violation must name the file, got ${JSON.stringify(result.violations)}`,
    );
  }

  // The head scan must not widen the allowlist: upstream attribution prose in a translated
  // README body is expected to keep `CloudCLI UI` and stays outside the scanned lines.
  const jaBodyOverride = `${read('docs/README.ja.md')}\nCloudCLI UI は上流の製品名です。\n`;
  const bodyResult = runBrandAllowlistCheck({
    root: ROOT,
    overrides: { 'docs/README.ja.md': jaBodyOverride },
  });
  assert.equal(
    bodyResult.exitCode,
    0,
    `translated-README body attribution must stay outside the head scan:\n${JSON.stringify(bodyResult.violations, null, 2)}`,
  );
});

test('AC8: the code-wide CloudCLI sweep scans every text line and its allowlist is file-scoped', () => {
  const brandLineGlobs = SCANNED_SURFACES
    .filter((surface) => surface.kind === 'brand-lines')
    .map((surface) => surface.glob);
  for (const required of ['server/**', 'src/**', 'electron/**', 'scripts/**', 'public/**']) {
    assert.ok(brandLineGlobs.includes(required), `the code-wide sweep must cover ${required}`);
  }

  const result = runBrandAllowlistCheck({ root: ROOT });
  assert.equal(result.exitCode, 0, JSON.stringify(result.violations, null, 2));
  assert.ok(
    result.readings.brandLineFiles > 1500,
    `the code-wide sweep must expand over the source tree, got ${result.readings.brandLineFiles} files`,
  );

  const brandLineFiles = new Set(
    result.sources.filter((source) => source.brandLines).map((source) => source.file),
  );
  for (const unscannable of [
    'server/shared/tests/architecture-ratchet.baseline.json',
    'server/modules/quay/tests/contracts/README.md',
    'scripts/brand-allowlist-check.mjs',
    'scripts/brand-allowlist-check.test.mjs',
  ]) {
    assert.ok(!brandLineFiles.has(unscannable), `${unscannable} must stay outside the sweep`);
  }
  for (const file of brandLineFiles) {
    assert.match(file, /\.(?:ts|tsx|js|mjs|cjs|sh|html)$/, `${file} is not a text source extension`);
  }

  // Negative control 1: a user-visible notification title.
  const notificationFile = 'server/modules/notifications/services/notification-orchestrator.service.js';
  const notificationResult = runBrandAllowlistCheck({
    root: ROOT,
    overrides: {
      [notificationFile]: read(notificationFile)
        .replace("title: sessionName || 'Cloudpit'", "title: sessionName || 'CloudCLI'"),
    },
  });
  assert.equal(notificationResult.exitCode, 1, 'a CloudCLI notification title must red the sweep');
  assert.ok(notificationResult.violations.some((violation) => violation.file === notificationFile));

  // Negative control 2: a comment line in shipped backend source (the `code` kind skips these,
  // the code-wide sweep must not).
  const schemaFile = 'server/modules/database/schema.ts';
  const commentResult = runBrandAllowlistCheck({
    root: ROOT,
    overrides: { [schemaFile]: ' * the CloudCLI project id.\n' },
  });
  assert.equal(commentResult.exitCode, 1, 'a CloudCLI comment must red the sweep');
  assert.ok(
    commentResult.violations.some(
      (violation) => violation.file === schemaFile && violation.message.includes('CloudCLI'),
    ),
  );

  // Positive control: the third-party plugin name stays green in the same sweep.
  const prismResult = runBrandAllowlistCheck({
    root: ROOT,
    overrides: { [notificationFile]: `${read(notificationFile)}\n// PRISM CloudCLI\n` },
  });
  assert.equal(
    prismResult.exitCode,
    0,
    `PRISM CloudCLI must stay allowlisted:\n${JSON.stringify(prismResult.violations, null, 2)}`,
  );

  // File scoping: the legacy literal is allowed inside the migration module and its tests, but
  // the same token in product code is a violation.
  const legacyFile = 'electron/userDataMigration.js';
  const legacyResult = runBrandAllowlistCheck({
    root: ROOT,
    overrides: { [legacyFile]: `${read(legacyFile)}\nconst legacyTitle = 'CloudCLI';\n` },
  });
  assert.equal(legacyResult.exitCode, 0, 'the legacy install literal must stay allowed in its own file');

  const productResult = runBrandAllowlistCheck({
    root: ROOT,
    overrides: { 'electron/cloud.js': "throw new Error('CloudCLI');\n" },
  });
  assert.equal(productResult.exitCode, 1, 'the legacy allowlist must not leak into another file');
});

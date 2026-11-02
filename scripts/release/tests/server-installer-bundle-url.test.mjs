#!/usr/bin/env node
/**
 * Criterion for gap-desktop-local-server-bundle-url-points-at-fork.
 *
 * CloudCLI Desktop downloads its Local runtime bundle from a GitHub Release URL built by
 * `electron/serverInstaller.js`. The default base URL named the UPSTREAM repository
 * (`github.com/siteboon/claudecodeui`) while this fork publishes both the desktop installer and the
 * `cloudpit-local-server-v<tag>` prerelease under `yaleh/cloudpit` — so a user who picked
 * "Local CloudCLI" asked a repository that never had the tag and got a 404.
 *
 * This criterion pins the two decisions that fix it, so neither can silently revert:
 *
 *   1. the DEFAULT base URL names the fork, and no upstream org reference survives in the source;
 *   2. `CLOUDPIT_SERVER_BUNDLE_URL` still overrides it (the escape hatch admins already use);
 *      v3.0 retired the legacy `CLOUDCLI_SERVER_BUNDLE_URL` spelling, which is now ignored.
 *
 * It also pins the URL *shape* the release pipeline now produces: the release-tag path segment and
 * the `cloudpit-local-server-v<version>-<platform>-<arch>.tar.gz` filename both carry the `v`
 * prefix the distribution criterion's `cloudpit-local-server-v2.0.0-` asset prefix expects.
 *
 * WHAT IT PRINTS. The readings are printed unconditionally, before any assertion, so a red run
 * still shows which reading was wrong:
 *
 *   bundle.default.host=github.com/yaleh/cloudpit
 *   bundle.default.upstream_refs=0
 *   bundle.env_override=honored
 */

import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import test from 'node:test';
import { fileURLToPath } from 'node:url';

// `electron/` belongs to no tsc project (root tsconfig covers src/shared/vite, and
// server/tsconfig.json sets checkJs:false and does not include it). A STATIC import would drag the
// file into THIS program's `checkJs:true` (scripts/tsconfig.json) and surface ~20 pre-existing
// strict errors in code this task must not touch. Resolving the URL at runtime keeps the module
// out of the program, so the production delta stays the one literal the task calls for.
const { ServerInstaller } = await import(
  new URL('../../../electron/serverInstaller.js', import.meta.url).href
);

// `scripts/release/tests/` -> repo root is three levels up.
const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..', '..', '..');

/** The upstream org whose name must not appear in the installer source or the default URL. */
const UPSTREAM_ORG = 'siteboon';
/** The fork's repository path, i.e. the two path segments that must follow the host. */
const FORK_REPO_PATH = 'yaleh/cloudpit';
/** A deliberately non-fork base used to prove the environment override still wins. */
const OVERRIDE_BASE = 'https://override.invalid/bundles';

const VERSION = '2.0.0';
const RELEASE_TAG = 'cloudpit-local-server-v2.0.0';
const SOURCE_REL = 'electron/serverInstaller.js';

/** The full URL the fix must produce, with the `v` prefix on both the tag and the filename. */
const EXPECTED_DEFAULT_URL =
  `https://github.com/${FORK_REPO_PATH}/releases/download/${RELEASE_TAG}`
  + `/cloudpit-local-server-v${VERSION}-win-x64.tar.gz`;

/**
 * Read a repo-relative file as UTF-8.
 * @param {string} rel @returns {string}
 */
function read(rel) {
  return readFileSync(join(ROOT, rel), 'utf8');
}

/**
 * Count the occurrences of `needle` in `haystack`.
 * @param {string} haystack @param {string} needle @returns {number}
 */
function countOf(haystack, needle) {
  return haystack.split(needle).length - 1;
}

/** A Windows/x64 installer for the pinned version, with no explicit base override. */
function installer() {
  return new ServerInstaller({
    version: VERSION,
    platform: 'win32',
    arch: 'x64',
    bundleReleaseTag: RELEASE_TAG,
  });
}

const sourceText = read(SOURCE_REL);

// R12 (2.1): the retired runtime tag / asset prefixes must not reappear on the release surface.
const LEGACY_TAG_PREFIXES = ['cloudcli-local-server-', 'cloudcli-desktop-'];
const RELEASE_SURFACE = [
  SOURCE_REL,
  'scripts/release/build-server-bundle.js',
  '.github/workflows/desktop-release.yml',
];
const legacyTagHits = RELEASE_SURFACE.flatMap((rel) =>
  LEGACY_TAG_PREFIXES.flatMap((prefix) => (read(rel).includes(prefix) ? [`${rel}:${prefix}`] : [])),
);

// The default reading must be taken with the override env UNSET: a stray
// CLOUDPIT_SERVER_BUNDLE_URL in the caller's environment would otherwise masquerade as the default.
const savedBundleUrlEnv = process.env.CLOUDPIT_SERVER_BUNDLE_URL;
const savedLegacyBundleUrlEnv = process.env.CLOUDCLI_SERVER_BUNDLE_URL;
delete process.env.CLOUDPIT_SERVER_BUNDLE_URL;
delete process.env.CLOUDCLI_SERVER_BUNDLE_URL;
const defaultUrl = installer().getBundleUrl();
const defaultBaseUrl = installer().bundleBaseUrl;

process.env.CLOUDPIT_SERVER_BUNDLE_URL = OVERRIDE_BASE;
const overrideUrl = installer().getBundleUrl();

// v3.0 negative control: the retired legacy spelling must not override anything.
delete process.env.CLOUDPIT_SERVER_BUNDLE_URL;
process.env.CLOUDCLI_SERVER_BUNDLE_URL = 'https://legacy.invalid/bundles';
const legacyOnlyUrl = installer().getBundleUrl();

if (savedBundleUrlEnv === undefined) delete process.env.CLOUDPIT_SERVER_BUNDLE_URL;
else process.env.CLOUDPIT_SERVER_BUNDLE_URL = savedBundleUrlEnv;
if (savedLegacyBundleUrlEnv === undefined) delete process.env.CLOUDCLI_SERVER_BUNDLE_URL;
else process.env.CLOUDCLI_SERVER_BUNDLE_URL = savedLegacyBundleUrlEnv;

const defaultParsed = new URL(defaultUrl);
const defaultRepoPath = defaultParsed.pathname.split('/').filter(Boolean).slice(0, 2).join('/');
const defaultHost = `${defaultParsed.host}/${defaultRepoPath}`;

// The upstream org must appear neither in the source constant nor in the address it resolves to.
const upstreamRefs = countOf(sourceText, UPSTREAM_ORG) + countOf(defaultUrl, UPSTREAM_ORG);

const envOverride = overrideUrl.startsWith(`${OVERRIDE_BASE}/`) ? 'honored' : 'ignored';

console.log(`bundle.default.host=${defaultHost}`);
console.log(`bundle.default.upstream_refs=${upstreamRefs}`);
console.log(`bundle.env_override=${envOverride}`);
console.log(`legacy.tag_prefixes=${legacyTagHits.length}`);

// ── the assertions ───────────────────────────────────────────────────────────

test('the default bundle address points at the fork, not upstream', () => {
  // The `upstream_refs` assertion is listed FIRST on purpose: reverting the constant to upstream
  // must red HERE, by reading name, rather than on the host/base readings that follow.
  assert.equal(
    upstreamRefs,
    0,
    `the upstream org ${UPSTREAM_ORG} still survives in ${SOURCE_REL} or the default URL `
      + `(${upstreamRefs} reference(s))`,
  );
  assert.equal(
    defaultBaseUrl,
    `https://github.com/${FORK_REPO_PATH}/releases/download`,
    'the default base URL must name the fork repository',
  );
  assert.equal(
    defaultHost,
    `github.com/${FORK_REPO_PATH}`,
    'the default bundle download must come from the fork repository',
  );
  assert.doesNotMatch(
    sourceText,
    new RegExp(UPSTREAM_ORG),
    `${SOURCE_REL} must not mention the upstream org`,
  );
});

test('CLOUDPIT_SERVER_BUNDLE_URL still overrides the default', () => {
  assert.equal(envOverride, 'honored', 'the environment override must win over the default base URL');
  assert.equal(
    overrideUrl,
    `${OVERRIDE_BASE}/${RELEASE_TAG}/cloudpit-local-server-v${VERSION}-win-x64.tar.gz`,
    'the override base must be used verbatim, keeping the tag/filename shape',
  );
});

test('v3.0: CLOUDCLI_SERVER_BUNDLE_URL is ignored', () => {
  assert.equal(
    legacyOnlyUrl.startsWith(`${OVERRIDE_BASE}/`),
    false,
    'the retired legacy spelling must not override the base URL',
  );
  assert.equal(
    legacyOnlyUrl,
    defaultUrl,
    'a legacy-only environment must resolve the same URL as no environment',
  );
});

test('R12: no legacy runtime tag or asset prefix survives on the release surface', () => {
  assert.deepEqual(
    legacyTagHits,
    [],
    `the installer/workflow/build script still mints a retired prefix: ${legacyTagHits.join(', ')}`,
  );
  // Positive control: the replacement prefix is what the same surface produces.
  assert.ok(
    defaultUrl.includes('cloudpit-local-server-'),
    'the live release surface must produce the cloudpit-local-server- shape',
  );
});

test('the bundle URL shape matches the distribution asset prefix', () => {
  assert.equal(
    defaultUrl,
    EXPECTED_DEFAULT_URL,
    'the tag path and filename must both carry the v prefix expected by cloudpit-distribution-check',
  );
});

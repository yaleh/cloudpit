#!/usr/bin/env node
/**
 * Brand allowlist checker for the Cloudpit rename (AC-451).
 *
 * The rename is only real if the legacy tokens `CloudCLI`, `claudecodeui` and the deprecated npm
 * package name `@yalehwang/cloudcli` disappear from the user-visible surfaces. `CLAUDE.md`-style
 * documentation cannot enforce that, and a grep cannot tell an allowed upstream attribution
 * (`Based on CloudCLI UI`) from a product title that was missed. This checker encodes the
 * allowlist from `docs/proposals/cloudpit-rename-SPEC.md` §2 and scans the surfaces §2.3 names.
 *
 * What it is NOT: a blanket grep. Every hit is evaluated against an explicit allowlist span
 * (third-party services, upstream scope/image/repository, the About attribution sentence, the
 * upstream version-check identifier, and the unrenamed local cache directory). A hit outside
 * every span is a violation and names the file plus the line (or JSON path) it came from.
 *
 * Code surfaces are scanned line by line with comment lines skipped: a comment that says
 * "CloudCLI project id" is documentation, not copy a user sees. Locale bundles are scanned
 * value-by-value so changing a display string can never touch a translation KEY (the locale
 * key-set digest pins every key).
 *
 * The deprecated package name is matched in its lowercase spelling only (`@yalehwang/cloudcli`):
 * the product-visible token is `CloudCLI`, while the update path is the package name the CLI and
 * `system.service.ts` feed to npm. History-only files (CHANGELOG / `release.yml` comments /
 * `package-lock.json` / design docs) are not user-visible surfaces and are therefore not scanned;
 * when one of their historical reference shapes appears in a scanned surface — the migration
 * notice a user sees is the realistic case — it is allowed only through the explicit
 * legacy-package spans below, never by a blanket rule. An `npm show|update|install -g` line
 * matches none of those spans and stays a violation.
 *
 * The criterion file (`brand-allowlist-check.test.mjs`) feeds synthetic violations back through
 * this same module, so a checker that silently passed would fail its own negative control.
 */

import { readFileSync, readdirSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

/**
 * How a surface's text is extracted before token matching.
 *
 * `text`          — every line, verbatim.
 * `json-values`   — parsed JSON string values only (keys are not user-visible copy).
 * `locale-values` — same as `json-values`, but counted as locale copy in the readings.
 * `readme-install`— only install/upgrade command lines, so upstream attribution prose is skipped.
 * `code`          — every line except comment lines.
 *
 * @typedef {'text' | 'json-values' | 'locale-values' | 'readme-install' | 'code'} SurfaceKind
 */

/**
 * One scanned surface. `glob` is repo-relative. The only wildcard shape supported is a
 * `<dir>/**\/*.json` locale bundle; every other entry is an exact file path.
 *
 * @typedef {{ glob: string, kind: SurfaceKind }} ScannedSurface
 */

/**
 * One piece of brand-bearing text extracted from a surface. `label` is the line number for
 * line-oriented surfaces and the JSON path for value-oriented ones.
 *
 * @typedef {{ file: string, label: string, text: string }} BrandSource
 */

/**
 * One unmatched legacy token.
 *
 * @typedef {{
 *   file: string,
 *   label: string,
 *   token: string,
 *   text: string,
 *   message: string,
 * }} BrandViolation
 */

/** @typedef {{ file: string, label?: string, message: string }} Violation */

/**
 * @typedef {{ violations: BrandViolation[], allowlistHits: number }} ScanResult
 * @typedef {{
 *   scannedFiles: number,
 *   scannedSources: number,
 *   localeValues: number,
 *   allowlistHits: number,
 * }} CheckReadings
 * @typedef {{
 *   exitCode: number,
 *   violations: Violation[],
 *   readings: CheckReadings,
 *   sources: BrandSource[],
 * }} CheckResult
 */

/**
 * Every user-visible surface AC-451 owns. Keep this list aligned with the Proposal's
 * scan-surface section: the criterion asserts the list covers each named file/glob.
 *
 * `electron/userDataMigration.js` is deliberately absent: `'CloudCLI'` there is the OLD userData
 * directory name that the desktop migration reads (AC-453), not product copy.
 *
 * @type {ScannedSurface[]}
 */
export const SCANNED_SURFACES = [
  { glob: 'index.html', kind: 'text' },
  { glob: 'public/manifest.json', kind: 'json-values' },
  { glob: 'README.md', kind: 'readme-install' },
  { glob: 'src/modules/i18n/locales/**/*.json', kind: 'locale-values' },
  { glob: 'src/shared/utils.ts', kind: 'code' },
  { glob: 'src/modules/chat-session/utils/session/pageTitleNotification.ts', kind: 'code' },
  { glob: 'src/modules/auth/AuthLoadingScreen.tsx', kind: 'code' },
  { glob: 'src/modules/auth/AuthScreenLayout.tsx', kind: 'code' },
  { glob: 'src/modules/oauth-consent/OAuthConsentRoute.tsx', kind: 'code' },
  { glob: 'src/modules/sidebar/SidebarFooter.tsx', kind: 'code' },
  { glob: 'src/modules/settings/tabs/AboutTab.tsx', kind: 'code' },
  { glob: 'src/modules/mcp/McpServers.tsx', kind: 'code' },
  { glob: 'server/modules/cli/cli.service.ts', kind: 'code' },
  // The CLI composition root is where the self-update commands live; a missed `npm update -g`
  // target is exactly the regression this scan must catch.
  { glob: 'server/modules/cli/cli.module.ts', kind: 'code' },
  { glob: 'server/modules/cli/sandbox.service.ts', kind: 'code' },
  { glob: 'server/modules/system/system.service.ts', kind: 'code' },
  { glob: 'server/index.ts', kind: 'code' },
  { glob: 'electron/main.js', kind: 'code' },
  { glob: 'electron/desktopWindow.js', kind: 'code' },
  { glob: 'electron/launcher/launcher.js', kind: 'code' },
  { glob: 'electron/localServer.js', kind: 'code' },
  { glob: 'electron/viewHost.js', kind: 'code' },
];

/**
 * Explicit allowlist spans. A token occurrence is allowed only when it lies wholly inside one of
 * these matches. Spans (not whole lines) keep a line that mixes allowed and disallowed copy from
 * passing: `CloudCLI Cloud and CloudCLI` still reports the second token.
 *
 * @type {{ name: string, pattern: RegExp }[]}
 */
export const BRAND_ALLOWLIST = [
  // Third-party / external services that keep their own name.
  { name: 'external-service', pattern: /CloudCLI (?:Cloud|Pro|Hosted|API)\b/g },
  // Third-party plugin name shown in the settings marketplace.
  { name: 'third-party-plugin', pattern: /\bPRISM CloudCLI\b/g },
  // About-page attribution to the upstream project.
  { name: 'about-attribution', pattern: /\bBased on CloudCLI UI\b/g },
  // Upstream package scope, image namespace, and repository URLs.
  { name: 'upstream-scope', pattern: /@cloudcli-ai\//g },
  { name: 'upstream-image', pattern: /docker\.io\/cloudcliai\//g },
  { name: 'upstream-repository', pattern: /siteboon\/claudecodeui/g },
  { name: 'fork-repository-url', pattern: /yaleh\/claudecodeui/g },
  { name: 'upstream-github-url', pattern: /github\.com\/cloudcli-ai\//g },
  // The About tab still checks upgrades against the upstream repository until the fork repo is
  // renamed; the identifier names a repository, not the product.
  {
    name: 'about-version-check-upstream',
    pattern: /useVersionCheck\(\s*['"]siteboon['"]\s*,\s*['"]claudecodeui['"]\s*\)/g,
  },
  // The unrenamed local cache directory (`~/.cache/claudecodeui`), a filesystem name, not copy.
  { name: 'local-cache-directory', pattern: /['"]\.cache['"]\s*,\s*['"]claudecodeui['"]/g },
  // The deprecated package name is history, not an update path. These spans cover the three
  // historical reference shapes (migration notice, release-workflow comment, changelog entry);
  // `npm show|update|install -g @yalehwang/cloudcli` matches none of them and stays a violation.
  { name: 'legacy-package-migration-notice', pattern: /uninstall @yalehwang\/cloudcli\b/g },
  {
    name: 'legacy-package-release-comment',
    pattern: /(?:publishes the package to npm as|the) `@yalehwang\/cloudcli`/g,
  },
  { name: 'legacy-package-changelog-entry', pattern: /publish the fork as @yalehwang\/cloudcli on npm/g },
];

const BRAND_TOKEN = /CloudCLI|claudecodeui|@yalehwang\/cloudcli/g;

/** A code line is documentation when its trimmed form opens a line/block/HTML comment. */
const COMMENT_LINE = /^(?:\/\/|\/\*|\*|<!--)/;

/** A README line that tells a user how to install or upgrade the package. */
const README_INSTALL_LINE = /\bnpx\s+@yalehwang\/|\bnpm\s+(?:install|update)\s+-g\b/;

/**
 * @param {string} dir
 * @returns {string[]} absolute file paths under `dir`
 */
function listFilesRecursive(dir) {
  /** @type {string[]} */
  const files = [];
  for (const entry of readdirSync(dir, { withFileTypes: true })) {
    const full = path.join(dir, entry.name);
    if (entry.isDirectory()) {
      files.push(...listFilesRecursive(full));
    } else if (entry.isFile()) {
      files.push(full);
    }
  }
  return files;
}

/**
 * @param {string} root
 * @param {ScannedSurface} surface
 * @returns {string[]} repo-relative paths, `/`-separated and sorted for stable readings
 */
function expandSurface(root, surface) {
  const wildcardIndex = surface.glob.indexOf('/**');
  if (wildcardIndex === -1) {
    return [surface.glob];
  }
  const dir = path.join(root, surface.glob.slice(0, wildcardIndex));
  return listFilesRecursive(dir)
    .filter((file) => file.endsWith('.json'))
    .map((file) => path.relative(root, file).split(path.sep).join('/'))
    .sort();
}

/**
 * @param {unknown} value
 * @param {string} prefix
 * @param {BrandSource[]} out
 * @param {string} file
 */
function collectJsonValues(value, prefix, out, file) {
  if (typeof value === 'string') {
    out.push({ file, label: prefix || '(root)', text: value });
    return;
  }
  if (Array.isArray(value)) {
    value.forEach((item, index) => collectJsonValues(item, `${prefix}[${index}]`, out, file));
    return;
  }
  if (value !== null && typeof value === 'object') {
    for (const [key, item] of Object.entries(/** @type {Record<string, unknown>} */ (value))) {
      collectJsonValues(item, prefix ? `${prefix}.${key}` : key, out, file);
    }
  }
}

/**
 * @param {string} file
 * @param {SurfaceKind} kind
 * @param {string} content
 * @returns {BrandSource[]}
 */
function extractSources(file, kind, content) {
  /** @type {BrandSource[]} */
  const sources = [];

  if (kind === 'json-values' || kind === 'locale-values') {
    collectJsonValues(JSON.parse(content), '', sources, file);
    return sources;
  }

  const lines = content.split('\n');
  for (let index = 0; index < lines.length; index += 1) {
    const line = lines[index];
    if (kind === 'readme-install' && !README_INSTALL_LINE.test(line)) {
      continue;
    }
    if (kind === 'code' && COMMENT_LINE.test(line.trim())) {
      continue;
    }
    sources.push({ file, label: `${file}:${index + 1}`, text: line });
  }
  return sources;
}

/**
 * Scan one surface's text and return the token occurrences that no allowlist span covers.
 *
 * @param {BrandSource[]} sources
 * @returns {ScanResult}
 */
export function scanSources(sources) {
  /** @type {BrandViolation[]} */
  const violations = [];
  let allowlistHits = 0;

  for (const source of sources) {
    const tokenPattern = new RegExp(BRAND_TOKEN.source, BRAND_TOKEN.flags);
    let match;
    while ((match = tokenPattern.exec(source.text)) !== null) {
      const token = match[0];
      const start = match.index;
      const end = start + token.length;
      const allowlistEntry = findAllowlistSpan(source.text, start, end);
      if (allowlistEntry !== null) {
        allowlistHits += 1;
        continue;
      }
      const location = source.label.startsWith(source.file)
        ? source.label
        : `${source.file}:${source.label}`;
      violations.push({
        file: source.file,
        label: source.label,
        token,
        text: source.text,
        message: `${location} carries "${token}" outside the brand allowlist: ${source.text.trim()}`,
      });
    }
  }

  return { violations, allowlistHits };
}

/**
 * @param {BrandSource[]} sources
 * @returns {BrandViolation[]}
 */
export function findBrandViolations(sources) {
  return scanSources(sources).violations;
}

/**
 * The allowlist entry whose span contains `[start, end)`, or null.
 *
 * @param {string} text
 * @param {number} start
 * @param {number} end
 * @returns {string | null}
 */
function findAllowlistSpan(text, start, end) {
  for (const entry of BRAND_ALLOWLIST) {
    const pattern = new RegExp(entry.pattern.source, entry.pattern.flags);
    let match;
    while ((match = pattern.exec(text)) !== null) {
      if (match.index > start) {
        break;
      }
      if (match.index <= start && end <= match.index + match[0].length) {
        return entry.name;
      }
    }
  }
  return null;
}

/**
 * Resolve every scanned surface into the text the token matcher reads.
 *
 * `overrides` maps a repo-relative file path to replacement content. It exists for the criterion's
 * false-forms: the same scan path must go red when a violating string is injected, without
 * rewriting the checkout.
 *
 * @param {{ root: string, overrides?: Record<string, string> }} options
 * @returns {BrandSource[]}
 */
export function collectBrandSources({ root, overrides = {} }) {
  /** @type {BrandSource[]} */
  const sources = [];

  for (const surface of SCANNED_SURFACES) {
    for (const file of expandSurface(root, surface)) {
      const content = Object.hasOwn(overrides, file)
        ? overrides[file]
        : readFileSync(path.join(root, file), 'utf8');
      sources.push(...extractSources(file, surface.kind, content));
    }
  }

  return sources;
}

/**
 * Assert the npm/desktop distribution identity fields. Separate from the text scan because these
 * are structured values, not copy: `package.json` is not a brand-text surface.
 *
 * @param {Record<string, any>} packageJson
 * @returns {Violation[]}
 */
export function checkDistributionIdentity(packageJson) {
  /** @type {Violation[]} */
  const violations = [];
  const pkg = packageJson && typeof packageJson === 'object' ? packageJson : {};

  if (pkg.name !== '@yalehwang/cloudpit') {
    violations.push({
      file: 'package.json',
      label: 'name',
      message: `package.json name must be "@yalehwang/cloudpit", found ${JSON.stringify(pkg.name)}`,
    });
  }

  const bin = pkg.bin !== null && typeof pkg.bin === 'object' ? pkg.bin : {};
  const binKeys = Object.keys(bin);
  if (binKeys.length !== 1 || binKeys[0] !== 'cloudpit') {
    violations.push({
      file: 'package.json',
      label: 'bin',
      message: `package.json bin must be exactly {"cloudpit": ...}, found ${JSON.stringify(binKeys)}`,
    });
  }

  if (pkg.productName !== 'Cloudpit') {
    violations.push({
      file: 'package.json',
      label: 'productName',
      message: `package.json productName must be "Cloudpit", found ${JSON.stringify(pkg.productName)}`,
    });
  }

  const build = pkg.build !== null && typeof pkg.build === 'object' ? pkg.build : {};
  if (build.productName !== 'Cloudpit') {
    violations.push({
      file: 'package.json',
      label: 'build.productName',
      message: `package.json build.productName must be "Cloudpit", found ${JSON.stringify(build.productName)}`,
    });
  }
  if (!/^cloudpit-desktop-/.test(String(build.artifactName ?? ''))) {
    violations.push({
      file: 'package.json',
      label: 'build.artifactName',
      message: `package.json build.artifactName must start with "cloudpit-desktop-", found ${JSON.stringify(build.artifactName)}`,
    });
  }

  return violations;
}

/**
 * Assert the bin map of a tarball's `package/package.json` (or a synthetic equivalent).
 * The new package must not ship a `cloudcli` alias.
 *
 * @param {Record<string, any>} packedManifest
 * @returns {Violation[]}
 */
export function checkPackedManifest(packedManifest) {
  /** @type {Violation[]} */
  const violations = [];
  const bin = packedManifest?.bin !== null && typeof packedManifest?.bin === 'object'
    ? packedManifest.bin
    : {};
  const binKeys = Object.keys(bin);
  if (binKeys.length !== 1 || binKeys[0] !== 'cloudpit') {
    violations.push({
      file: 'tarball:package/package.json',
      label: 'bin',
      message: `the packed manifest must expose exactly the "cloudpit" bin, found ${JSON.stringify(binKeys)}`,
    });
  }
  return violations;
}

/**
 * Run the whole check against a repository root.
 *
 * @param {{ root?: string, overrides?: Record<string, string> }} [options]
 * @returns {CheckResult}
 */
export function runBrandAllowlistCheck({ root, overrides = {} } = {}) {
  const resolvedRoot = path.resolve(root ?? process.cwd());
  const sources = collectBrandSources({ root: resolvedRoot, overrides });
  const scan = scanSources(sources);
  /** @type {Record<string, any>} */
  const packageJson = JSON.parse(readFileSync(path.join(resolvedRoot, 'package.json'), 'utf8'));
  const identityViolations = checkDistributionIdentity(packageJson);

  /** @type {Violation[]} */
  const violations = [
    ...scan.violations.map((violation) => ({
      file: violation.file,
      label: violation.label,
      message: violation.message,
    })),
    ...identityViolations,
  ];

  return {
    exitCode: violations.length === 0 ? 0 : 1,
    violations,
    readings: {
      scannedFiles: new Set(sources.map((source) => source.file)).size,
      scannedSources: sources.length,
      localeValues: sources.filter((source) => source.file.startsWith('src/modules/i18n/locales/')).length,
      allowlistHits: scan.allowlistHits,
    },
    sources,
  };
}

/**
 * CLI entry point. `--root <dir>` selects the checkout, `--overrides <file.json>` applies the
 * false-form replacements, and `--json` prints machine-readable readings.
 *
 * @param {string[]} [argv]
 * @returns {number} process exit code
 */
export function main(argv = process.argv.slice(2)) {
  const rootFlag = argv.indexOf('--root');
  const overridesFlag = argv.indexOf('--overrides');
  const root = rootFlag !== -1 && argv[rootFlag + 1] ? path.resolve(argv[rootFlag + 1]) : process.cwd();

  /** @type {Record<string, string>} */
  let overrides = {};
  if (overridesFlag !== -1 && argv[overridesFlag + 1]) {
    overrides = JSON.parse(readFileSync(path.resolve(argv[overridesFlag + 1]), 'utf8'));
  }

  const result = runBrandAllowlistCheck({ root, overrides });

  if (argv.includes('--json')) {
    console.log(JSON.stringify({
      exitCode: result.exitCode,
      violations: result.violations,
      readings: result.readings,
    }, null, 2));
  } else {
    console.log(
      `brand-allowlist: files=${result.readings.scannedFiles} `
      + `values=${result.readings.scannedSources} localeValues=${result.readings.localeValues} `
      + `allowlistHits=${result.readings.allowlistHits} violations=${result.violations.length}`,
    );
    for (const violation of result.violations) {
      console.error(`[brand] ${violation.message}`);
    }
  }

  return result.exitCode;
}

const invokedPath = process.argv[1] ? path.resolve(process.argv[1]) : '';
if (invokedPath === path.resolve(fileURLToPath(import.meta.url))) {
  process.exitCode = main();
}

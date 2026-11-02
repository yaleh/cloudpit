/**
 * Brand-owned environment variables for the Electron runtime.
 *
 * Electron runs plain JavaScript straight from source and cannot import the
 * server's TypeScript module, so this is a second implementation of
 * `server/shared/brand.ts`'s `createBrandEnvReader`. The semantics must stay
 * identical: only `CLOUDPIT_<NAME>` is read, an empty string means "not set",
 * and the legacy `CLOUDCLI_<NAME>` spelling is ignored (no fallback, no warning).
 *
 * `electron/tests/cloudpit-brand-env-wiring.test.mjs` drives both
 * implementations over one environment table so the two cannot drift.
 */

/** Canonical (Cloudpit) spelling prefix. */
export const BRAND_ENV_PREFIX = 'CLOUDPIT_';

/**
 * Build a reader bound to one environment.
 *
 * @param {{
 *   env: Readonly<Record<string, string | undefined>>,
 * }} deps
 * @returns {{
 *   read: (name: string) => {
 *     value: string | undefined,
 *     source: 'new' | 'absent',
 *     key: string,
 *   },
 * }}
 */
export function createBrandEnvReader({ env }) {
  return {
    read(name) {
      const canonicalKey = `${BRAND_ENV_PREFIX}${name}`;
      const canonical = env[canonicalKey];
      if (canonical !== undefined && canonical !== '') {
        return { value: canonical, source: 'new', key: canonicalKey };
      }
      return { value: undefined, source: 'absent', key: canonicalKey };
    },
  };
}

/**
 * Read `name`, returning `fallback` when the canonical spelling is not set.
 *
 * Matches the `process.env.X || fallback` shape the wiring points used before
 * the rename: an empty value is absent (`read()` never returns one).
 *
 * @template T
 * @param {{ read: (name: string) => { value: string | undefined } }} reader
 * @param {string} name
 * @param {T} fallback
 * @returns {string | T}
 */
export function readBrandEnvValue(reader, name, fallback) {
  const { value } = reader.read(name);
  return value === undefined ? fallback : value;
}

/** A reader over `process.env`. */
export function createProcessBrandEnvReader() {
  return createBrandEnvReader({ env: process.env });
}

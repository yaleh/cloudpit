/**
 * Brand-owned environment variables for the Electron runtime.
 *
 * Electron runs plain JavaScript straight from source and cannot import the
 * server's TypeScript module, so this is a second implementation of
 * `server/shared/brand.ts`'s `createBrandEnvReader`. The semantics must stay
 * identical: `CLOUDPIT_<NAME>` wins, `CLOUDCLI_<NAME>` is the legacy fallback,
 * an empty string means "not set", and each legacy key warns at most once per
 * reader instance.
 *
 * `electron/tests/cloudpit-brand-env-wiring.test.mjs` drives both
 * implementations over one environment table so the two cannot drift.
 */

/** Canonical (Cloudpit) spelling prefix. */
export const BRAND_ENV_PREFIX = 'CLOUDPIT_';
/** Legacy (CloudCLI) spelling prefix, readable for one transition window. */
export const LEGACY_BRAND_ENV_PREFIX = 'CLOUDCLI_';

/**
 * Build a reader bound to one environment and one warning sink.
 *
 * @param {{
 *   env: Readonly<Record<string, string | undefined>>,
 *   warn: (message: string) => void,
 * }} deps
 * @returns {{
 *   read: (name: string) => {
 *     value: string | undefined,
 *     source: 'new' | 'legacy' | 'absent',
 *     key: string,
 *   },
 * }}
 */
export function createBrandEnvReader({ env, warn }) {
  const warnedLegacyKeys = new Set();

  return {
    read(name) {
      const canonicalKey = `${BRAND_ENV_PREFIX}${name}`;
      const canonical = env[canonicalKey];
      if (canonical !== undefined && canonical !== '') {
        return { value: canonical, source: 'new', key: canonicalKey };
      }

      const legacyKey = `${LEGACY_BRAND_ENV_PREFIX}${name}`;
      const legacy = env[legacyKey];
      if (legacy === undefined || legacy === '') {
        return { value: undefined, source: 'absent', key: canonicalKey };
      }

      if (!warnedLegacyKeys.has(legacyKey)) {
        warnedLegacyKeys.add(legacyKey);
        warn(`${legacyKey} is deprecated; set ${canonicalKey} instead.`);
      }
      return { value: legacy, source: 'legacy', key: legacyKey };
    },
  };
}

/**
 * Read `name`, returning `fallback` when neither spelling is set.
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

/** A reader over `process.env` whose legacy warnings go to `console.warn`. */
export function createProcessBrandEnvReader(warn = (message) => console.warn(message)) {
  return createBrandEnvReader({ env: process.env, warn });
}

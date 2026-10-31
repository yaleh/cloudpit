/**
 * Brand-owned environment variables, read under the new Cloudpit names with a
 * fallback to the legacy CloudCLI names.
 *
 * This module is deliberately unwired: GOAL-053 builds the reader so a later
 * task can point the CLI, database, settings and Electron paths at it without
 * changing any default in this change. Because no production module imports it
 * yet, the only consumer is `tests/cloudpit-brand-env.test.ts`.
 */

/** Which spelling an environment read resolved through. */
export type BrandEnvSource = 'new' | 'legacy' | 'absent';

/**
 * One resolved environment read.
 *
 * `value` is `undefined` only for `source: 'absent'`; an empty string is never
 * returned as a value, because `.env` files routinely carry `NAME=` and that
 * must not read as an enabled setting. `key` is the spelling that supplied the
 * value (`CLOUDPIT_…` or `CLOUDCLI_…`), or the canonical `CLOUDPIT_…` key when
 * nothing was set.
 */
export type BrandEnvReading = {
  value: string | undefined;
  source: BrandEnvSource;
  key: string;
};

/** Dependencies of {@link createBrandEnvReader}; both are injected so the reader is testable. */
export type BrandEnvReaderDeps = {
  /** The environment to read (typically `process.env`). */
  env: Readonly<Record<string, string | undefined>>;
  /** Called once per legacy key that is actually used. */
  warn: (message: string) => void;
};

/** A reader bound to one environment and one warning sink. */
export type BrandEnvReader = {
  /**
   * Read `<NAME>`: `CLOUDPIT_<NAME>` wins, then `CLOUDCLI_<NAME>`, then absent.
   *
   * Using the legacy spelling emits one warning for that key on this reader;
   * a second read of the same key stays silent. Separate readers keep separate
   * warning state, so draining one does not silence a sibling.
   */
  read: (name: string) => BrandEnvReading;
};

/**
 * Build a brand environment reader.
 *
 * The warned-key set lives in this factory's closure, not at module scope: the
 * state belongs to the reader instance, and two readers never share it.
 */
export function createBrandEnvReader({ env, warn }: BrandEnvReaderDeps): BrandEnvReader {
  const warnedLegacyKeys = new Set<string>();

  return {
    read(name) {
      const canonicalKey = `CLOUDPIT_${name}`;
      const canonical = env[canonicalKey];
      if (canonical !== undefined && canonical !== '') {
        return { value: canonical, source: 'new', key: canonicalKey };
      }

      const legacyKey = `CLOUDCLI_${name}`;
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

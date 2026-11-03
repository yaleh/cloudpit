/**
 * Brand-owned environment variables, read under the Cloudpit spelling only.
 *
 * v3.0 RETIREMENT. Up to 2.x this reader also accepted the legacy `CLOUDCLI_<NAME>`
 * spelling and emitted one deprecation warning per legacy key. The runtime fallback is
 * gone: a process that exports only `CLOUDCLI_<NAME>` reads as absent, so the caller's
 * shipped default applies. Setting the legacy name is not an error and produces no
 * warning — it is simply not consulted.
 *
 * There is no `warn` dependency any more: every reading is either the canonical key's
 * value or absent, so the reader has nothing to report. Callers that still pass a
 * warning sink would be compiling against the retired API, hence the narrower shape.
 *
 * The production wiring points (Electron main/localServer/serverInstaller, the
 * browser-use service and its MCP entry) all read through this module, and
 * `electron/brandEnv.js` carries the same semantics for the Electron runtime.
 */

/** Which spelling an environment read resolved through. */
export type BrandEnvSource = 'new' | 'absent';

/**
 * One resolved environment read.
 *
 * `value` is `undefined` only for `source: 'absent'`; an empty string is never
 * returned as a value, because `.env` files routinely carry `NAME=` and that
 * must not read as an enabled setting. `key` is always the canonical
 * `CLOUDPIT_…` spelling the operator should set.
 */
export type BrandEnvReading = {
  value: string | undefined;
  source: BrandEnvSource;
  key: string;
};

/** Dependencies of {@link createBrandEnvReader}; injectable so the reader is testable. */
export type BrandEnvReaderDeps = {
  /** The environment to read (typically `process.env`). */
  env: Readonly<Record<string, string | undefined>>;
};

/** A reader bound to one environment. */
export type BrandEnvReader = {
  /** Read `CLOUDPIT_<NAME>`; anything else (including `CLOUDCLI_<NAME>`) reads absent. */
  read: (name: string) => BrandEnvReading;
};

/**
 * Build a brand environment reader.
 *
 * The reader holds no state: the canonical spelling either supplies a non-empty value
 * or the reading is absent. A legacy `CLOUDCLI_<NAME>` is never consulted.
 */
export function createBrandEnvReader({ env }: BrandEnvReaderDeps): BrandEnvReader {
  return {
    read(name) {
      const canonicalKey = `CLOUDPIT_${name}`;
      const canonical = env[canonicalKey];
      if (canonical !== undefined && canonical !== '') {
        return { value: canonical, source: 'new', key: canonicalKey };
      }
      return { value: undefined, source: 'absent', key: canonicalKey };
    },
  };
}

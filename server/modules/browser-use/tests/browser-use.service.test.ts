import assert from 'node:assert/strict';
import test from 'node:test';

import {
  browserUseService,
  readBrowserUseEnvDefaults,
} from '@/modules/browser-use/browser-use.service.js';

test('browser monitor list starts empty without agent sessions', async () => {
  const sessions = await browserUseService.listSessions();

  assert.deepEqual(sessions, []);
});

/** Resolve the service's brand-controlled limits over one in-memory environment. */
function resolveBrowserUseEnv(env: Record<string, string | undefined>) {
  const warnings: string[] = [];
  const defaults = readBrowserUseEnvDefaults(env, (message) => warnings.push(message));
  return { defaults, warnings };
}

const DEFAULTS = {
  maxSessionsPerOwner: 3,
  sessionTtlMs: 30 * 60 * 1000,
  installTimeoutMs: 10 * 60 * 1000,
};

test('browser-use AC4: no brand env set keeps the shipped defaults', () => {
  const { defaults, warnings } = resolveBrowserUseEnv({});

  assert.deepEqual(defaults, DEFAULTS);
  assert.deepEqual(warnings, [], 'the default path must not emit a deprecation warning');
});

test('browser-use AC3: CLOUDPIT_* supplies every value and never warns', () => {
  const { defaults, warnings } = resolveBrowserUseEnv({
    CLOUDPIT_BROWSER_USE_MAX_SESSIONS_PER_OWNER: '7',
    CLOUDPIT_BROWSER_USE_SESSION_TTL_MS: '60000',
    CLOUDPIT_BROWSER_USE_INSTALL_TIMEOUT_MS: '120000',
  });

  assert.deepEqual(defaults, {
    maxSessionsPerOwner: 7,
    sessionTtlMs: 60_000,
    installTimeoutMs: 120_000,
  });
  assert.deepEqual(warnings, []);
});

test('browser-use AC5: the legacy spelling still supplies values and warns once per key', () => {
  const { defaults, warnings } = resolveBrowserUseEnv({
    CLOUDCLI_BROWSER_USE_MAX_SESSIONS_PER_OWNER: '7',
    CLOUDCLI_BROWSER_USE_SESSION_TTL_MS: '60000',
    CLOUDCLI_BROWSER_USE_INSTALL_TIMEOUT_MS: '120000',
  });

  assert.deepEqual(defaults, {
    maxSessionsPerOwner: 7,
    sessionTtlMs: 60_000,
    installTimeoutMs: 120_000,
  });
  assert.equal(warnings.length, 3, 'each of the three legacy keys warns exactly once');
  assert.deepEqual(
    warnings.map((warning) => warning.slice(0, warning.indexOf(' is deprecated'))).sort(),
    [
      'CLOUDCLI_BROWSER_USE_INSTALL_TIMEOUT_MS',
      'CLOUDCLI_BROWSER_USE_MAX_SESSIONS_PER_OWNER',
      'CLOUDCLI_BROWSER_USE_SESSION_TTL_MS',
    ],
  );
});

test('browser-use AC3: both spellings set means the new value wins silently', () => {
  const { defaults, warnings } = resolveBrowserUseEnv({
    CLOUDPIT_BROWSER_USE_MAX_SESSIONS_PER_OWNER: '7',
    CLOUDCLI_BROWSER_USE_MAX_SESSIONS_PER_OWNER: '9',
  });

  assert.equal(defaults.maxSessionsPerOwner, 7);
  assert.equal(defaults.sessionTtlMs, DEFAULTS.sessionTtlMs);
  assert.equal(defaults.installTimeoutMs, DEFAULTS.installTimeoutMs);
  assert.deepEqual(warnings, [], 'a shadowed legacy value is not deprecated');
});

test('browser-use AC2: an empty new value falls back to the legacy spelling', () => {
  const { defaults, warnings } = resolveBrowserUseEnv({
    CLOUDPIT_BROWSER_USE_MAX_SESSIONS_PER_OWNER: '',
    CLOUDCLI_BROWSER_USE_MAX_SESSIONS_PER_OWNER: '9',
  });

  assert.equal(defaults.maxSessionsPerOwner, 9);
  assert.equal(warnings.length, 1);
});

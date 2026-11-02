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
  return readBrowserUseEnvDefaults(env);
}

const DEFAULTS = {
  maxSessionsPerOwner: 3,
  sessionTtlMs: 30 * 60 * 1000,
  installTimeoutMs: 10 * 60 * 1000,
};

test('browser-use AC4: no brand env set keeps the shipped defaults', () => {
  assert.deepEqual(resolveBrowserUseEnv({}), DEFAULTS);
});

test('browser-use AC3: CLOUDPIT_* supplies every value', () => {
  const defaults = resolveBrowserUseEnv({
    CLOUDPIT_BROWSER_USE_MAX_SESSIONS_PER_OWNER: '7',
    CLOUDPIT_BROWSER_USE_SESSION_TTL_MS: '60000',
    CLOUDPIT_BROWSER_USE_INSTALL_TIMEOUT_MS: '120000',
  });

  assert.deepEqual(defaults, {
    maxSessionsPerOwner: 7,
    sessionTtlMs: 60_000,
    installTimeoutMs: 120_000,
  });
});

test('browser-use AC5 (v3.0): the legacy spelling is ignored and the shipped defaults apply', () => {
  const defaults = resolveBrowserUseEnv({
    CLOUDCLI_BROWSER_USE_MAX_SESSIONS_PER_OWNER: '7',
    CLOUDCLI_BROWSER_USE_SESSION_TTL_MS: '60000',
    CLOUDCLI_BROWSER_USE_INSTALL_TIMEOUT_MS: '120000',
  });

  assert.deepEqual(defaults, DEFAULTS);
});

test('browser-use AC3: both spellings set means the new value wins', () => {
  const defaults = resolveBrowserUseEnv({
    CLOUDPIT_BROWSER_USE_MAX_SESSIONS_PER_OWNER: '7',
    CLOUDCLI_BROWSER_USE_MAX_SESSIONS_PER_OWNER: '9',
  });

  assert.equal(defaults.maxSessionsPerOwner, 7);
  assert.equal(defaults.sessionTtlMs, DEFAULTS.sessionTtlMs);
  assert.equal(defaults.installTimeoutMs, DEFAULTS.installTimeoutMs);
});

test('browser-use AC2 (v3.0): an empty new value reads absent, not the legacy spelling', () => {
  const defaults = resolveBrowserUseEnv({
    CLOUDPIT_BROWSER_USE_MAX_SESSIONS_PER_OWNER: '',
    CLOUDCLI_BROWSER_USE_MAX_SESSIONS_PER_OWNER: '9',
  });

  assert.equal(defaults.maxSessionsPerOwner, DEFAULTS.maxSessionsPerOwner);
});

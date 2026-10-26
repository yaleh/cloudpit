/**
 * The provider shell facet: every provider's launch contract, pinned to the
 * literal command lines the websocket service used to build from a
 * `provider === '…'` chain.
 *
 * WHY THIS IS A CRITERION. Moving the launch syntax out of
 * `shell-websocket.service.ts` turns a branch a reader can see into a class the
 * reader has to trust. These assertions are the literals from that branch,
 * restated per provider and per platform, so the migration is a refactor
 * (same strings in, same strings out) rather than a rewrite. The registry
 * assertion at the bottom is what makes the facet reachable: a class nobody
 * mounts launches nothing.
 *
 * The display names are pinned here too, because they replaced the second
 * branch chain (the welcome notice) and are read from the same object.
 */
import assert from 'node:assert/strict';
import test from 'node:test';

import { ClaudeShellProvider } from '@/modules/providers/list/claude/claude-shell.provider.js';
import { CodexShellProvider } from '@/modules/providers/list/codex/codex-shell.provider.js';
import { CursorShellProvider } from '@/modules/providers/list/cursor/cursor-shell.provider.js';
import { OpenCodeShellProvider } from '@/modules/providers/list/opencode/opencode-shell.provider.js';
import { providerRegistry } from '@/modules/providers/provider.registry.js';

/** The compiled model argv the Claude branch appended to every launch attempt. */
const MODEL_ARGV = ['--model', 'opus 4'];
const BYPASS_CLAUDE_FLAGS = " --dangerously-skip-permissions '--model' 'opus 4'";

test('claude: the pre-migration launch literals, on both platforms', () => {
  const shell = new ClaudeShellProvider();
  assert.equal(shell.displayName, 'Claude');

  // New session, no model spec: the CLI name alone.
  assert.equal(shell.launchCommand({ platform: 'linux' }), 'claude');
  assert.equal(shell.launchCommand({ platform: 'win32' }), 'claude');

  // A caller-supplied command wins on a fresh launch.
  assert.equal(shell.launchCommand({ initialCommand: 'claude --foo', platform: 'linux' }), 'claude --foo');

  // Resume attempt, with the fresh-session fallback the old branch emitted.
  assert.equal(
    shell.launchCommand({ resumeSessionId: 'abc-123', platform: 'linux' }),
    'claude --resume "abc-123" || claude',
  );
  assert.equal(
    shell.launchCommand({ resumeSessionId: 'abc-123', platform: 'win32' }),
    'claude --resume "abc-123"; if ($LASTEXITCODE -ne 0) { claude }',
  );

  // Bypass permissions and the compiled model argv ride every attempt, so a
  // resumed terminal matches the original launch.
  assert.equal(
    shell.launchCommand({
      resumeSessionId: 'abc-123',
      platform: 'linux',
      bypassPermissions: true,
      modelArgv: MODEL_ARGV,
    }),
    `claude --resume "abc-123"${BYPASS_CLAUDE_FLAGS} || claude${BYPASS_CLAUDE_FLAGS}`,
  );
  assert.equal(
    shell.launchCommand({
      resumeSessionId: 'abc-123',
      platform: 'win32',
      bypassPermissions: true,
      modelArgv: MODEL_ARGV,
    }),
    `claude --resume "abc-123"${BYPASS_CLAUDE_FLAGS}; if ($LASTEXITCODE -ne 0) { claude${BYPASS_CLAUDE_FLAGS} }`,
  );

  // Windows quotes a single quote by doubling it; POSIX closes and reopens.
  const quote = new ClaudeShellProvider().launchCommand({
    platform: 'win32',
    bypassPermissions: true,
    modelArgv: ["it's"],
  });
  assert.ok(quote.endsWith("'it''s'"), quote);
  const posixQuote = new ClaudeShellProvider().launchCommand({
    platform: 'linux',
    bypassPermissions: true,
    modelArgv: ["it's"],
  });
  assert.ok(posixQuote.endsWith("'it'\\''s'"), posixQuote);
});

test('codex: the pre-migration launch literals, on both platforms', () => {
  const shell = new CodexShellProvider();
  assert.equal(shell.displayName, 'Codex');

  assert.equal(shell.launchCommand({ platform: 'linux' }), 'codex');
  assert.equal(shell.launchCommand({ platform: 'win32' }), 'codex');
  // The old branch ignored a caller-supplied command for Codex.
  assert.equal(shell.launchCommand({ initialCommand: 'ignored', platform: 'linux' }), 'codex');

  assert.equal(
    shell.launchCommand({ resumeSessionId: 'thread-9', platform: 'linux' }),
    'codex resume "thread-9" || codex',
  );
  assert.equal(
    shell.launchCommand({ resumeSessionId: 'thread-9', platform: 'win32' }),
    'codex resume "thread-9"; if ($LASTEXITCODE -ne 0) { codex }',
  );
});

test('cursor: the pre-migration launch literals', () => {
  const shell = new CursorShellProvider();
  assert.equal(shell.displayName, 'Cursor');

  assert.equal(shell.launchCommand({}), 'cursor-agent');
  assert.equal(shell.launchCommand({ initialCommand: 'ignored' }), 'cursor-agent');
  assert.equal(
    shell.launchCommand({ resumeSessionId: 'cursor-session' }),
    'cursor-agent --resume="cursor-session"',
  );
});

test('opencode: the pre-migration launch literals', () => {
  const shell = new OpenCodeShellProvider();
  assert.equal(shell.displayName, 'OpenCode');

  assert.equal(shell.launchCommand({}), 'opencode');
  // OpenCode's fresh launch is the one provider whose command the caller can replace.
  assert.equal(shell.launchCommand({ initialCommand: 'opencode run "hi"' }), 'opencode run "hi"');
  assert.equal(
    shell.launchCommand({ resumeSessionId: 'oc-1', initialCommand: 'ignored' }),
    'opencode --session "oc-1"',
  );
});

test('the registry mounts a shell facet for every selectable provider', () => {
  for (const provider of ['claude', 'codex', 'cursor', 'opencode'] as const) {
    const shell = providerRegistry.resolveProvider(provider).shell;
    assert.ok(shell, `${provider} mounts no shell facet`);
    assert.ok(shell.displayName.length > 0, `${provider} has no display name`);
    assert.equal(typeof shell.launchCommand({}), 'string');
  }
});

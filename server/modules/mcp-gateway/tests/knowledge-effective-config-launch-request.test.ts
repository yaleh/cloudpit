/**
 * knowledge-effective-config-launch-request — the request layer the knowledge
 * contract names (`/proc/<pid>/cmdline`'s `--model` / `--settings` /
 * `--permission-mode`) is reported as its OWN reading, and it is refused by
 * name when there is no live process to read it from.
 *
 * Why this is separate from the transcript verdict: the transcript answers
 * "what did THIS turn ask for", while the argv answers "what was the process
 * launched with". A reconfigure delivered to a running process changes the
 * first and leaves the second untouched, so the two must not stand in for each
 * other. The negative legs prove the reading never turns a missing source into
 * an empty evidence value.
 *
 * Run directly:
 *   npx tsx --tsconfig server/tsconfig.json --test \
 *     server/modules/mcp-gateway/tests/knowledge-effective-config-launch-request.test.ts
 */
import assert from 'node:assert/strict';
import test from 'node:test';

process.env.JWT_SECRET = 'knowledge-effective-config-launch-request-secret';

const { parseLaunchRequest } = await import('@/shared/knowledge-facts.js');
// eslint-disable-next-line boundaries/no-unknown
const { createKnowledgeFactSource } = await import('../../../knowledge-facts-wiring.js');

type AnyRecord = Record<string, any>;

const SESSION = 'launch-request-session';
const NOW_MS = Date.parse('2026-11-01T12:00:00.000Z');
/** Above the kernel's default pid_max; /proc has no such entry. */
const DEAD_PID = 9_999_999;

/** The argv the running production launcher actually passed (measured 2026-11-01). */
const CLAUDE_ARGV = [
  '/data/home/yale/.nvm/versions/node/v24.21.0/bin/claude',
  '--output-format',
  'stream-json',
  '--verbose',
  '--input-format',
  'stream-json',
  '--model',
  'v4.1flash',
  '--permission-prompt-tool',
  'stdio',
  '--tools',
  'default',
  '--setting-sources=project,user,local',
  '--permission-mode',
  'bypassPermissions',
  '--allow-dangerously-skip-permissions',
  '--include-partial-messages',
  '--settings',
  '{"remoteControlAtStartup":false,"isolatePeerMachines":true}',
];

function sessionRow(): AnyRecord {
  return {
    session_id: SESSION,
    provider: 'claude',
    provider_session_id: SESSION,
    project_path: '/tmp/launch-request-project',
    model: 'v4.1flash',
    effort: 'high',
    permission_mode: 'bypassPermissions',
    jsonl_path: null,
    created_at: new Date(NOW_MS - 60_000).toISOString(),
    updated_at: new Date(NOW_MS - 60_000).toISOString(),
    isArchived: 0,
  };
}

function makeSource(hosts?: AnyRecord) {
  return createKnowledgeFactSource({
    sessions: {
      getSessionById: (sessionId: string) => (sessionId === SESSION ? sessionRow() : null),
      getAllSessions: () => [],
      fetchHistory: async () => ({ messages: [] }),
    },
    ...(hosts === undefined ? {} : { hosts }),
    buildId: 'launch-request-build',
    bootId: 'launch-request-boot',
    now: () => NOW_MS,
  } as any);
}

async function readLaunchRequest(hosts?: AnyRecord): Promise<AnyRecord> {
  const reading = (await (makeSource(hosts).read as any)({
    kind: 'effective_config',
    session: SESSION,
    expected: { model: 'v4.1flash', effort: 'high' },
  })) as AnyRecord;
  assert.ok(reading, 'the session exists, so a reading is returned');
  return reading;
}

test('the launcher flags are read from a real claude argv, in both spellings', () => {
  assert.deepEqual(parseLaunchRequest(CLAUDE_ARGV), {
    model: 'v4.1flash',
    settings: '{"remoteControlAtStartup":false,"isolatePeerMachines":true}',
    permissionMode: 'bypassPermissions',
  });
  assert.deepEqual(parseLaunchRequest(['claude', '--model=opus', '--permission-mode=plan']), {
    model: 'opus',
    settings: null,
    permissionMode: 'plan',
  });
});

test('an absent flag is a real null — the argv is evidence of its absence, not a failed read', () => {
  assert.deepEqual(parseLaunchRequest(['claude', '--verbose']), {
    model: null,
    settings: null,
    permissionMode: null,
  });
  // A bare flag followed by another flag must not consume the next token.
  assert.deepEqual(parseLaunchRequest(['claude', '--model', '--verbose']), {
    model: null,
    settings: null,
    permissionMode: null,
  });
});

test('a live process yields evidence read from its own /proc/<pid>/cmdline', async () => {
  const reading = await readLaunchRequest({
    liveHostForSession: (sessionId: string) =>
      sessionId === SESSION ? { pid: process.pid, startedAt: NOW_MS - 60_000 } : null,
  });
  const launchRequest = reading.launchRequest as AnyRecord;
  assert.equal(launchRequest.state, 'evidence');
  assert.equal(launchRequest.source, 'proc-cmdline');
  assert.equal(launchRequest.sourceRef, `/proc/${process.pid}/cmdline`);
  assert.equal(launchRequest.observedAt, new Date(NOW_MS).toISOString());
  const value = launchRequest.value as AnyRecord;
  assert.equal(value.pid, process.pid);
  assert.ok(Array.isArray(value.argv) && value.argv.length > 0, 'the real argv is kept');
  // The test runner is not a claude launcher, so the three flags are genuinely absent.
  assert.equal(value.model, null);
  assert.equal(value.settings, null);
  assert.equal(value.permissionMode, null);
});

test('a dead pid is an explicit unknown with a named read error, never empty evidence', async () => {
  const reading = await readLaunchRequest({
    liveHostForSession: (sessionId: string) =>
      sessionId === SESSION ? { pid: DEAD_PID, startedAt: NOW_MS - 60_000 } : null,
  });
  const launchRequest = reading.launchRequest as AnyRecord;
  assert.equal(launchRequest.state, 'unknown');
  assert.match(String(launchRequest.reason), /\/proc\//);
  const readErrors = reading.readErrors as AnyRecord[];
  assert.ok(
    readErrors.some((error) => error.source === 'proc.cmdline'),
    'the failed /proc read is reported, not silently dropped',
  );
});

test('no live host means the launch request is unknown by name', async () => {
  const reading = await readLaunchRequest(undefined);
  const launchRequest = reading.launchRequest as AnyRecord;
  assert.equal(launchRequest.state, 'unknown');
  assert.match(String(launchRequest.reason), /no live process/i);
});

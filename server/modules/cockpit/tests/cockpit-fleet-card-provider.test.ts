/**
 * AC-432's criterion: the quay-fleet card provider and its session-ask content completion.
 *
 * The cases drive the provider with a STUBBED `runCards`, so no fleet installation is needed:
 *
 *   · every fleet field is passed through, and the registry still hides `resolved` cards and
 *     orders the rest by the provider's own group/rank;
 *   · repeated reads inside the TTL run the CLI once (the false form — no cache — reds it);
 *   · a missing CLI and a non-zero exit each answer an empty list plus a readable reason;
 *   · one malformed JSONL line is skipped and counted without hiding its neighbours (the false
 *     form — failing the whole batch on a bad line — reds it);
 *   · a session-ask card is filled from the T1 digest: a recommendation, no recommendation, a
 *     missing digest and an incomplete digest;
 *   · the settings switch off means no child process at all.
 *
 * Run directly:
 *   npx tsx --tsconfig server/tsconfig.json --test \
 *     server/modules/cockpit/tests/cockpit-fleet-card-provider.test.ts
 */
import assert from 'node:assert/strict';
import test from 'node:test';

import type { CockpitCard, SessionAskDecisionReading } from '@/shared/types.js';

import { createCockpitCardRegistry } from '../cockpit-card-registry.js';
import { COCKPIT_FLEET_ASK_OPTION_EXECUTOR } from '../cockpit-fleet-card-projection.js';
import {
  COCKPIT_FLEET_PROVIDER_ID,
  createCockpitFleetCardProvider,
  type CockpitFleetCardProvider,
  type CockpitFleetCommandResult,
} from '../cockpit-fleet-card-provider.js';

const WAITING = '2026-10-27T00:01:00.000Z';
const SURFACED = '2026-10-27T00:01:05.000Z';

/** One rescue card, one ruling card, one resolved card and one session-ask card. */
const FLEET_CARDS = [
  {
    id: 'att-rescue-1',
    provider: 'quay-fleet',
    revision: 4,
    kind: 'stuck',
    group: 'rescue',
    rank: 1,
    state: 'open',
    waitingSince: WAITING,
    surfacedAt: SURFACED,
    subject: {
      project: 'proj-1',
      taskId: 'task-a',
      sessionId: 'sess-rescue',
      uri: 'quay://proj-1/task/task-a',
    },
    contentRef: null,
    facts: [
      { text: 'no progress for 12 minutes', mechanical: true, ref: 'worker-stall', observedAt: WAITING },
    ],
    options: [
      {
        id: 'resume',
        label: 'Resume',
        does: 'Re-dispatch the task on the merged baseline.',
        suggested: true,
        source: 'assistant',
        tags: [{ kind: 'undo', text: '可撤' }],
        action: { executor: 'fleet.rescue.resume', params: { taskId: 'task-a' } },
      },
    ],
    notify: { system: true, reason: 'escalate:worker-stall' },
    ownerSession: null,
  },
  {
    id: 'att-ruling-1',
    provider: 'quay-fleet',
    revision: 2,
    kind: 'need',
    group: 'ruling',
    rank: 2,
    state: 'open',
    waitingSince: WAITING,
    surfacedAt: SURFACED,
    subject: { project: 'proj-1', uri: 'quay://proj-1/task/task-b' },
    facts: [],
    options: [
      {
        id: 'ack',
        label: 'Acknowledge',
        does: 'Mark the notice as read.',
        suggested: false,
        source: 'provider',
        action: { executor: 'fleet.ack', params: { attentionId: 'att-ruling-1' } },
      },
    ],
    ownerSession: null,
  },
  {
    id: 'att-resolved-1',
    provider: 'quay-fleet',
    revision: 7,
    kind: 'ask',
    group: 'ruling',
    rank: 3,
    state: 'resolved',
    waitingSince: WAITING,
    surfacedAt: SURFACED,
    subject: { uri: 'cloudcli://session/sess-old' },
    facts: [],
    options: [],
    ownerSession: null,
  },
  {
    id: 'att-ask-1',
    provider: 'quay-fleet',
    revision: 3,
    kind: 'ask',
    group: 'ruling',
    rank: 1,
    state: 'open',
    waitingSince: WAITING,
    surfacedAt: SURFACED,
    subject: { project: 'proj-1', sessionId: 'sess-ask', uri: 'cloudcli://session/sess-ask' },
    contentRef: {
      resolver: 'cloudcli.session-ask',
      sessionId: 'sess-ask',
      messageId: 'm-7',
    },
    facts: [],
    options: [],
    notify: { system: false, reason: 'notify:session-ask' },
    ownerSession: null,
  },
];

const FIXTURE = `${FLEET_CARDS.map((card) => JSON.stringify(card)).join('\n')}\n`;

function runnerReturning(
  stdout: string,
  calls: string[][] = [],
): (args: readonly string[]) => Promise<CockpitFleetCommandResult> {
  return async (args) => {
    calls.push([...args]);
    return { exitCode: 0, stdout, stderr: '' };
  };
}

function created(
  overrides: Partial<Parameters<typeof createCockpitFleetCardProvider>[0]> = {},
): CockpitFleetCardProvider {
  return createCockpitFleetCardProvider({
    runCards: runnerReturning(FIXTURE),
    readSessionAsk: () => null,
    ...overrides,
  });
}

function byId(cards: readonly CockpitCard[], id: string): CockpitCard {
  const card = cards.find((candidate) => candidate.id === id);
  assert.ok(card !== undefined, `expected card ${id} in ${cards.map((card) => card.id).join(', ')}`);
  return card;
}

function optionById(card: CockpitCard, id: string): CockpitCard['options'][number] {
  const option = card.options.find((candidate) => candidate.id === id);
  assert.ok(option !== undefined, `expected option ${id} on ${card.id}`);
  return option;
}

test('AC-432: fleet fields pass through, and the registry hides ended cards and orders the rest', async () => {
  const calls: string[][] = [];
  const fleet = created({ runCards: runnerReturning(FIXTURE, calls) });

  const cards = await fleet.provider.listCards();
  assert.deepEqual(calls, [['cockpit', 'cards', '--json']], 'the base read port is the no-filter argv');
  assert.equal(cards.length, 4, 'every readable line, resolved cards included');
  assert.equal(fleet.provider.id, COCKPIT_FLEET_PROVIDER_ID);

  const rescue = byId(cards, 'att-rescue-1');
  assert.equal(rescue.provider, 'quay-fleet', 'the adapter id is authoritative');
  assert.equal(rescue.revision, 4);
  assert.equal(rescue.kind, 'stuck');
  assert.equal(rescue.group, 'rescue');
  assert.equal(rescue.rank, 1);
  assert.equal(rescue.state, 'open');
  assert.equal(rescue.waitingSince, WAITING);
  assert.equal(rescue.surfacedAt, SURFACED);
  assert.deepEqual(rescue.subject, FLEET_CARDS[0]?.subject);
  assert.deepEqual(rescue.facts, FLEET_CARDS[0]?.facts);
  assert.deepEqual(rescue.notify, { system: true, reason: 'escalate:worker-stall' });
  assert.equal('ownerSession' in rescue, false, 'ownerSession is reserved and never projected');
  const resume = rescue.options[0];
  assert.ok(resume !== undefined);
  assert.equal(resume.suggested, true);
  assert.equal(resume.source, 'assistant');
  assert.deepEqual(resume.tags, [{ kind: 'undo', text: '可撤' }]);
  assert.deepEqual(resume.action, {
    executor: 'fleet.rescue.resume',
    params: { taskId: 'task-a' },
  });

  assert.equal(byId(cards, 'att-resolved-1').state, 'resolved', 'the provider still reports ended cards');

  const registry = createCockpitCardRegistry([fleet.provider]);
  const open = await registry.listCards();
  assert.deepEqual(
    open.map((card) => card.id),
    ['att-rescue-1', 'att-ask-1', 'att-ruling-1'],
    'group then rank decide the order; the resolved card is filtered by the registry',
  );
  assert.deepEqual(fleet.provider.declaredExecutors(), [], 'no fleet disposal executor is landed yet');

  // The diagnostic must ride on the REGISTERED object: the route reads the registry's account,
  // so a capability left only on the wrapper would make an empty list unexplainable in situ.
  const providedDiagnostics = registry.diagnostics();
  assert.equal(providedDiagnostics.length, 1);
  assert.equal(providedDiagnostics[0]?.provider, COCKPIT_FLEET_PROVIDER_ID);
  assert.equal(providedDiagnostics[0]?.ok, true);
  assert.equal(providedDiagnostics[0]?.cards, 4);
});

test('AC-432: reads inside the TTL run the CLI once, and the diagnostic says it was cached', async () => {
  let now = 1_000;
  const calls: string[][] = [];
  const fleet = created({
    ttlMs: 5_000,
    now: () => now,
    runCards: runnerReturning(FIXTURE, calls),
  });

  await fleet.provider.listCards();
  await fleet.provider.listCards();
  assert.equal(calls.length, 1, 'a second read inside 5 s must not spawn the CLI again');
  assert.equal(fleet.diagnostics()[0]?.cached, true);

  now += 5_000;
  await fleet.provider.listCards();
  assert.equal(calls.length, 2, 'the read after the window asks the CLI again');
  assert.equal(fleet.diagnostics()[0]?.cached, false);
});

test('AC-432: a missing CLI and a non-zero exit each answer an empty list and a readable reason', async () => {
  const missing = created({
    runCards: async () => ({
      exitCode: null,
      stdout: '',
      stderr: '',
      error: 'quay-fleet was not found (checked QUAY_FLEET_BIN, PATH and ~/.quay-fleet/bin/quay-fleet)',
    }),
  });
  assert.deepEqual(await missing.provider.listCards(), []);
  const missingDiagnostic = missing.diagnostics()[0];
  assert.equal(missingDiagnostic?.ok, false);
  assert.match(missingDiagnostic?.reason ?? '', /quay-fleet was not found/);

  // The installed CLI answers with its whole usage text; the diagnostic must keep the one line
  // that names the error rather than the tens of kB that follow it.
  const failed = created({
    runCards: async () => ({
      exitCode: 2,
      stdout: '',
      stderr: "quay-fleet: unknown command 'cockpit'\nusage: quay-fleet <command> [options]\n\ncommands:\n  registry add …\n",
      // What the real runner adds for a non-zero exit; the child's own line must win over it.
      error: 'quay-fleet failed: Command failed: quay-fleet cockpit cards --json',
    }),
  });
  assert.deepEqual(await failed.provider.listCards(), []);
  const failedDiagnostic = failed.diagnostics()[0];
  assert.equal(failedDiagnostic?.ok, false);
  assert.equal(failedDiagnostic?.reason, "quay-fleet: unknown command 'cockpit'");
});

test('AC-432: one bad line is skipped and counted without hiding the other cards', async () => {
  const stdout = `${JSON.stringify(FLEET_CARDS[0])}\nthis is not json\n${JSON.stringify(FLEET_CARDS[1])}\n`;
  const fleet = created({ runCards: runnerReturning(stdout) });

  const cards = await fleet.provider.listCards();
  assert.deepEqual(
    cards.map((card) => card.id),
    ['att-rescue-1', 'att-ruling-1'],
    'the bad line must not fail the batch',
  );
  const diagnostic = fleet.diagnostics()[0];
  assert.equal(diagnostic?.ok, true);
  assert.equal(diagnostic?.skippedLines, 1);
  assert.equal(diagnostic?.cards, 2);
  assert.match(diagnostic?.reason ?? '', /1 malformed card line/);
});

/** One evaluated digest in the shape the observation layer stores. */
function evaluated(options: {
  suggested: boolean;
  source: 'assistant' | 'judge' | 'provider';
  incomplete?: boolean;
}): SessionAskDecisionReading {
  return {
    state: 'evaluated',
    inputTokens: 120,
    outputTokens: 40,
    askId: 'sess-ask:m-7',
    revision: 1,
    ask: 'Should the staging directory be deleted?',
    situation: 'The run left 1.2 GB in staging and the archive is already verified.',
    options: [
      {
        id: 'delete',
        label: 'Delete staging',
        does: 'Remove the staging directory after the archive is verified.',
        tags: [{ kind: 'undo', text: '可撤' }],
        suggested: options.suggested,
        source: options.source,
      },
      {
        id: 'keep',
        label: 'Keep staging',
        does: 'Leave the directory for a later inspection.',
        tags: [],
        suggested: false,
        source: 'provider',
      },
    ],
    incomplete: options.incomplete ?? false,
  };
}

test('AC-432: a session-ask card is filled from the digest, and its options are not executable yet', async () => {
  const seen: Array<[string, string]> = [];
  const fleet = created({
    runCards: runnerReturning(FIXTURE),
    readSessionAsk: (sessionId, messageId) => {
      seen.push([sessionId, messageId]);
      return evaluated({ suggested: true, source: 'assistant' });
    },
  });

  const ask = byId(await fleet.provider.listCards(), 'att-ask-1');
  assert.deepEqual(seen, [['sess-ask', 'm-7']], 'the contentRef address reaches the digest reader');
  assert.equal(ask.ask, 'Should the staging directory be deleted?');
  assert.match(ask.situation ?? '', /1\.2 GB/);
  assert.equal(ask.contentUnavailable, undefined, 'a ready digest leaves no not-ready marker');
  assert.deepEqual(ask.contentRef, { resolver: 'cloudcli.session-ask', ref: 'sess-ask#m-7' });

  const suggested = ask.options.filter((option) => option.suggested);
  assert.deepEqual(suggested.map((option) => option.id), ['delete'], 'exactly the assistant recommendation');
  assert.equal(suggested[0]?.source, 'assistant');
  assert.equal(optionById(ask, 'keep').suggested, false);
  assert.deepEqual(suggested[0]?.tags, [{ kind: 'undo', text: '可撤' }]);
  assert.equal(suggested[0]?.action.executor, COCKPIT_FLEET_ASK_OPTION_EXECUTOR);
  assert.equal(fleet.provider.declaredExecutors().includes(COCKPIT_FLEET_ASK_OPTION_EXECUTOR), false);
});

test('AC-432: with no assistant recommendation the session-ask card sets no default option', async () => {
  // The digest's judge MAY name a preferred option; only the assistant's own words make a
  // default, so this reading must still reach the card with nothing suggested.
  const fleet = created({
    readSessionAsk: () =>
      evaluated({ suggested: true, source: 'judge' }),
  });
  const ask = byId(await fleet.provider.listCards(), 'att-ask-1');
  assert.deepEqual(
    ask.options.filter((option) => option.suggested),
    [],
    'a judge recommendation is not the assistant recommendation',
  );
  assert.equal(ask.contentUnavailable, undefined);
});

test('AC-432: a missing or incomplete digest keeps the card visible, marked not ready, with no default', async () => {
  const missing = created({ readSessionAsk: () => null });
  const missingCard = byId(await missing.provider.listCards(), 'att-ask-1');
  assert.match(missingCard.contentUnavailable ?? '', /尚未生成/);
  assert.deepEqual(missingCard.options.filter((option) => option.suggested), []);

  const incomplete = created({
    readSessionAsk: () => evaluated({ suggested: true, source: 'assistant', incomplete: true }),
  });
  const incompleteCard = byId(await incomplete.provider.listCards(), 'att-ask-1');
  assert.match(incompleteCard.contentUnavailable ?? '', /不完整/);
  assert.deepEqual(
    incompleteCard.options.filter((option) => option.suggested),
    [],
    'an incomplete digest never claims a recommendation',
  );
});

test('AC-432: with the switch off the provider runs no CLI and reports why', async () => {
  const calls: string[][] = [];
  const fleet = created({
    enabled: false,
    runCards: runnerReturning(FIXTURE, calls),
  });

  assert.deepEqual(await fleet.provider.listCards(), []);
  assert.equal(calls.length, 0, 'the switch off must not spawn quay-fleet');
  const diagnostic = fleet.diagnostics()[0];
  assert.equal(diagnostic?.ok, false);
  assert.match(diagnostic?.reason ?? '', /cockpit\.fleetCards\.enabled is off/);
});

test('AC-432: the read port passes the resolved-history filters through', async () => {
  const calls: string[][] = [];
  const fleet = created({ runCards: runnerReturning(FIXTURE, calls) });
  const since = '2026-10-26T00:00:00.000Z';
  await fleet.listCards({ includeResolved: true, since });
  assert.deepEqual(calls, [
    ['cockpit', 'cards', '--json', '--include-resolved', '--since', since],
  ]);
});

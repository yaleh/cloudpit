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
import { mkdir, mkdtemp, rm, writeFile } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import test from 'node:test';

import type { CockpitCard, SessionAskDecisionReading } from '@/shared/types.js';
import { readRetractedSessionAskMessageIds } from '@/modules/context-events/index.js';
import {
  createSessionAskDecisionDigest,
  createSessionAskDecisionReader,
  formatSessionUri,
  type ObservedObject,
  type ObservationStore,
} from '@/modules/observation/index.js';

import { createCockpitCardRegistry } from '../cockpit-card-registry.js';
import {
  COCKPIT_FLEET_PROVIDER_ID,
  createCockpitFleetCardProvider,
  type CockpitFleetCardProvider,
  type CockpitFleetCommandResult,
} from '../cockpit-fleet-card-provider.js';
import { COCKPIT_MOLTEN_DECIDE_EXECUTOR_ID } from '../cockpit-fleet-executor.js';
import { COCKPIT_SESSION_SEND_EXECUTOR_ID } from '../cockpit-session-send.executor.js';

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

/**
 * One cross-project digest card exactly as the fleet emits it (`att_2d86bc040462` on 2026-10-30):
 * the entry is `kind: 'digest'`, carries NO options, and its evidence holds the triggering
 * `+2 error` and the later `+2 ok`. Every row's `text` shares the rule+window prefix; only the
 * status tail differs, which is why the raw card rendered indistinguishably.
 */
const DIGEST_CARD = {
  id: 'att-digest-1',
  provider: 'quay-fleet',
  revision: 2,
  kind: 'digest',
  group: 'rescue',
  rank: 9,
  state: 'open',
  waitingSince: '2026-10-30T11:26:10.116Z',
  surfacedAt: '2026-10-30T11:29:19.903Z',
  subject: { project: 'claudecodeui', uri: 'quay://claudecodeui/board' },
  facts: [
    {
      text: '读数：plan.digest.v0 2026-10-30T11: claudecodeui: +2 error',
      mechanical: true,
      ref: 'events.jsonl@err',
      observedAt: '2026-10-30T11:26:10.116Z',
      detail: 'plan.digest.v0 2026-10-30T11: claudecodeui: +2 error',
    },
    {
      text: '读数：plan.digest.v0 2026-10-30T11: claudecodeui: +2 ok',
      mechanical: true,
      ref: 'events.jsonl@ok',
      observedAt: '2026-10-30T11:29:19.903Z',
      detail: 'plan.digest.v0 2026-10-30T11: claudecodeui: +2 ok',
    },
  ],
  options: [],
  notify: { system: true, reason: 'escalate:plan.digest.v0' },
  ownerSession: null,
};

/**
 * The fleet's declaration document for the digest criteria. The park id is deliberately NOT one
 * the fleet ships (`fleet.settle`): the criterion proves the disposal option's executor comes
 * from the declaration, so a hard-coded `fleet.park` in the projection reds it.
 */
const DIGEST_DECLARATIONS = {
  ok: true,
  executors: [
    { id: 'fleet.keep', action: 'hold', does: 'ack and keep open', params: [] },
    { id: 'fleet.settle', action: 'park', does: 'expire the entry', params: [] },
  ],
};

function digestRunner(card: unknown = DIGEST_CARD): (args: readonly string[]) => Promise<CockpitFleetCommandResult> {
  return runnerReturning(`${JSON.stringify(card)}\n`);
}

function declarationsRunner(): (args: readonly string[]) => Promise<CockpitFleetCommandResult> {
  return async () => ({ exitCode: 0, stdout: JSON.stringify(DIGEST_DECLARATIONS), stderr: '' });
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

test('AC-432: the fleet revision is passed through as-is, including 0', async () => {
  const withZeroRevision = { ...FLEET_CARDS[0], id: 'att-revision-0', revision: 0 };
  const withoutRevision: Record<string, unknown> = { ...FLEET_CARDS[1] };
  delete withoutRevision.revision;
  const fleet = created({
    runCards: runnerReturning(
      `${JSON.stringify(withZeroRevision)}\n${JSON.stringify(withoutRevision)}\n`,
    ),
  });

  const cards = await fleet.provider.listCards();
  assert.equal(
    byId(cards, 'att-revision-0').revision,
    0,
    'the fleet\'s initial revision 0 must survive projection; clamping it to 1 makes every dismissal stale',
  );
  assert.equal(
    byId(cards, 'att-ruling-1').revision,
    1,
    'a card row without a revision still defaults to 1',
  );
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

test('AC-432: our own fleet write drops the cached batch, so the re-read after a dismiss is not pre-dismiss', async () => {
  let now = 1_000;
  let open = true;
  const cardCalls: string[][] = [];
  const fleet = created({
    ttlMs: 5_000,
    now: () => now,
    runCards: async (args) => {
      cardCalls.push([...args]);
      return {
        exitCode: 0,
        stdout: open ? `${JSON.stringify(FLEET_CARDS[0])}\n` : '',
        stderr: '',
      };
    },
    runExecutors: async (args) => {
      if (args[0] === 'rescue' && args[1] === 'executors') {
        return {
          exitCode: 0,
          stdout: JSON.stringify({
            ok: true,
            executors: [{ id: 'fleet.feedback', action: 'feedback', does: 'close', params: [] }],
          }),
          stderr: '',
        };
      }
      const params = JSON.parse(args[args.indexOf('--params') + 1] ?? '{}') as {
        dismiss?: boolean;
        feedbackId?: string;
      };
      if (params.dismiss === true) open = false;
      return {
        exitCode: 0,
        stdout: JSON.stringify({
          ok: true,
          result: { receipt: { feedbackId: params.feedbackId, disposition: 'dismissed' } },
        }),
        stderr: '',
      };
    },
  });
  await fleet.executorReading();

  assert.equal((await fleet.provider.listCards()).length, 1);
  await fleet.provider.listCards();
  assert.equal(cardCalls.length, 1, 'the second read inside the window is the cached one');

  // Reach the executor exactly as `cockpit.module.ts` does: through the provider's own resolver,
  // so the runner this test fakes is the one the provider wrapped.
  const feedback = await fleet.provider.resolveExecutor('fleet.feedback');
  assert.ok(feedback !== null, 'the declared feedback executor resolves');
  await feedback.execute({
    attentionId: 'att-rescue-1',
    revision: 4,
    feedbackId: 'fb-1',
    dismiss: true,
  });

  const after = await fleet.provider.listCards();
  assert.equal(
    cardCalls.length,
    2,
    'a fleet write must drop the pre-write batch; the caller re-reads immediately and must not be answered from it',
  );
  assert.equal(fleet.diagnostics()[0]?.cached, false);
  assert.deepEqual(after.map((card) => card.id), [], 'the discarded card is gone on the immediate re-read');
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

test('AC: a digest escalate card always offers a clickable dismissal', async () => {
  // THE DEFECT: the fleet states `options: []` for a digest, so the card drew a dropdown over an
  // empty list and a confirm bar promising 「Choose an option」 — nothing the person could press.
  // The projection completes it with ONE disposal option built from the fleet's declaration.
  const fleet = created({
    runCards: digestRunner(),
    runExecutors: declarationsRunner(),
  });

  const card = byId(await createCockpitCardRegistry([fleet.provider]).listCards(), 'att-digest-1');
  assert.ok(card.options.length > 0, 'a digest card must never render an empty option list');
  const disposal = card.options.find((option) => option.id === 'dismiss' || option.id === 'ack');
  assert.ok(disposal !== undefined, 'the option is a dismiss/ack the person can choose');
  assert.equal(
    disposal.action.executor,
    'fleet.settle',
    'the executor is the declaration with action=park, not an id hard-coded in the projection',
  );
  assert.deepEqual(disposal.action.params, { attentionId: 'att-digest-1' });
  assert.equal(disposal.suggested, false, 'no recommendation is invented for a summary');
  assert.equal(
    disposal.confirmable,
    undefined,
    'the fleet declared the executor, so the option stays confirmable',
  );
});

test('AC: a healed digest headline states the newest reading, not the triggering error', async () => {
  // The entry keeps accumulating evidence, but the card's headline used to be `facts[0]` — the
  // OLDEST row — so `+2 error` stayed the title after `+2 ok` had already arrived.
  const fleet = created({ runCards: digestRunner(), runExecutors: declarationsRunner() });

  const card = byId(await fleet.provider.listCards(), 'att-digest-1');
  assert.match(card.ask ?? '', /已恢复/, 'the headline names the recovery');
  assert.ok(
    (card.ask ?? '').includes('+2 ok'),
    'the headline carries the newest recovered reading',
  );
  assert.equal(
    (card.ask ?? '').includes('+2 error'),
    false,
    'the stale triggering error is not the headline',
  );
  assert.equal(card.facts[0]?.text.includes('+2 ok'), true, 'readings are newest first');
  assert.equal(card.facts.at(-1)?.text.includes('+2 error'), true, 'the oldest reading stays last');
});

test('AC: digest reading rows carry their own status, so they stay distinguishable when shortened', async () => {
  // Every evidence row shares the rule+window prefix (`读数：plan.digest.v0 2026-10-30T11:`) while
  // the difference lives in the tail, which the pill truncates away. Each row now leads with its
  // status, inside the display's own 48-character cap.
  const fleet = created({ runCards: digestRunner(), runExecutors: declarationsRunner() });

  const card = byId(await fleet.provider.listCards(), 'att-digest-1');
  assert.deepEqual(
    card.facts.map((fact) => fact.text),
    [
      '读数：claudecodeui: +2 ok（2026-10-30T11）',
      '读数：claudecodeui: +2 error（2026-10-30T11）',
    ],
    'each row states its own reading and the window',
  );
  // `COCKPIT_FACT_PILL_MAX_CHARS` is 48 on the client; a row that differs only after that cap
  // renders identically. The status must be inside the prefix.
  const prefixes = card.facts.map((fact) => fact.text.slice(0, 48));
  assert.equal(new Set(prefixes).size, card.facts.length, 'no two rows shorten to the same prefix');
  assert.ok(prefixes[0]?.includes('+2 ok'), 'the ok row names ok inside the prefix');
  assert.ok(prefixes[1]?.includes('+2 error'), 'the error row names error inside the prefix');
});

/** One evaluated digest in the shape the observation layer stores. */
function evaluated(options: {
  suggested: boolean;
  source: 'assistant' | 'judge' | 'provider';
  incomplete?: boolean;
  why?: string;
  /** The digest's own revision (the stored summary's, not the fleet item's). */
  revision?: number;
}): SessionAskDecisionReading {
  return {
    state: 'evaluated',
    inputTokens: 120,
    outputTokens: 40,
    askId: 'sess-ask:m-7',
    revision: options.revision ?? 1,
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
        ...(options.why === undefined ? {} : { why: options.why }),
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

test('AC-432: a session-ask card is filled from the digest, and its options answer in that session', async () => {
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
  assert.equal(suggested[0]?.action.executor, COCKPIT_SESSION_SEND_EXECUTOR_ID);
  assert.equal(
    fleet.provider.declaredExecutors().includes(COCKPIT_SESSION_SEND_EXECUTOR_ID),
    false,
    'session.send is Cloudpit’s own content default, not a provider declaration',
  );
});

test('AC: a completed session-ask option answers its own session with 「label — does」', async () => {
  // Selecting an option on a session-ask card IS answering the assistant in that session: the
  // action is the ordinary `session.send`, addressed to the card's own session, and its text is
  // the option name plus what choosing it does. `session.send` is Cloudpit's own declared
  // content default, so the registry must NOT mark these options unconfirmable.
  const reading: SessionAskDecisionReading = {
    state: 'evaluated',
    inputTokens: 120,
    outputTokens: 40,
    askId: 'sess-ask:m-7',
    revision: 1,
    ask: 'Should the staging directory be deleted?',
    situation: 'The archive is already verified.',
    options: [
      {
        id: 'delete',
        label: 'Delete staging',
        does: 'Remove the staging directory after the archive is verified.',
        tags: [],
        suggested: true,
        source: 'assistant',
      },
      {
        id: 'keep',
        label: 'Keep staging',
        does: '',
        tags: [],
        suggested: false,
        source: 'provider',
      },
    ],
    incomplete: false,
  };
  const fleet = created({ readSessionAsk: () => reading });
  const ask = byId(await createCockpitCardRegistry([fleet.provider]).listCards(), 'att-ask-1');

  assert.equal(ask.subject.sessionId, 'sess-ask');
  assert.deepEqual(
    ask.options.map((option) => option.id),
    ['delete', 'keep'],
    'both digest options reach the card',
  );
  for (const option of ask.options) {
    assert.equal(option.action.executor, COCKPIT_SESSION_SEND_EXECUTOR_ID, `${option.id} answers the session`);
    assert.equal(
      option.action.params.sessionId,
      ask.subject.sessionId,
      `${option.id} targets the card’s own session`,
    );
    assert.equal(option.confirmable, undefined, `${option.id} must stay confirmable`);
    assert.equal('confirmableReason' in option, false, `${option.id} carries no refusal reason`);
  }
  assert.equal(
    optionById(ask, 'delete').action.params.text,
    'Delete staging — Remove the staging directory after the archive is verified.',
    'the option name and what it does are the reply',
  );
  assert.equal(
    optionById(ask, 'keep').action.params.text,
    'Keep staging',
    'an option with nothing to add sends its name alone',
  );
});

test('AC: a content option carries the exact text it sends as `sendText`, and fleet options carry none', async () => {
  // The Details drawer's 「✎ 编辑」 shortcut copies `sendText` into the person's own reply, so the
  // field must be the SAME string the action sends — not a second derivation that could drift.
  // Only content options have one: a fleet disposal option records a choice in place and sends
  // no words, so there is nothing to copy into a reply.
  const base = evaluated({ suggested: true, source: 'assistant' });
  if (base.state !== 'evaluated') throw new Error('the fixture digest must be evaluated');
  const reading: SessionAskDecisionReading = {
    ...base,
    options: [
      { ...base.options[0]!, does: 'Remove the staging directory after the archive is verified.' },
      // The empty-`does` arm: such an option sends its label alone.
      { ...base.options[1]!, does: '' },
    ],
  };
  const fleet = created({ readSessionAsk: () => reading });
  const cards = await fleet.provider.listCards();
  const ask = byId(cards, 'att-ask-1');

  const deleting = optionById(ask, 'delete');
  assert.equal(
    deleting.sendText,
    'Delete staging — Remove the staging directory after the archive is verified.',
    'a labeled option sends 「label — does」',
  );
  assert.equal(
    deleting.action.params.text,
    deleting.sendText,
    'the action param and the copied text are one string',
  );

  const keeping = optionById(ask, 'keep');
  assert.equal(keeping.sendText, 'Keep staging', 'an option with nothing to add sends its label alone');
  assert.equal(keeping.action.params.text, keeping.sendText);

  // Fleet's own options (and the registry's `session.start` default, where a card names only a
  // project) never carry the field: their text, if any, is not a reply to copy.
  const otherOptions = cards
    .flatMap((card) => card.options)
    .filter(
      (option) =>
        option.action.executor.startsWith('fleet.') || option.action.executor === 'session.start',
    );
  assert.ok(otherOptions.length > 0, 'the fixture must give this assertion fleet options to read');
  for (const option of otherOptions) {
    assert.equal('sendText' in option, false, `${option.id} is a fleet action and carries no sendText`);
  }

  // The content options are the ones that DO carry it, so the reading above is not vacuous.
  assert.equal('sendText' in deleting, true);
  assert.equal('sendText' in keeping, true);
});

test('AC-432 / AC-434: a judge recommendation is the session-ask card’s default too, with its reason', async () => {
  // The assistant's own recommendation is not present, so the observation layer marked the
  // judge's pick. The projection passes that decision through — any source's suggested option is
  // the default — and carries the judge's one-line reason so the card can show it.
  const judgeReason = 'The archive is verified, so deletion is the low-risk next step.';
  const fleet = created({
    readSessionAsk: () =>
      evaluated({ suggested: true, source: 'judge', why: judgeReason }),
  });
  const ask = byId(await fleet.provider.listCards(), 'att-ask-1');
  const suggested = ask.options.filter((option) => option.suggested);
  assert.deepEqual(suggested.map((option) => option.id), ['delete'], 'the judge pick is the default');
  assert.equal(suggested[0]?.source, 'judge');
  assert.equal(suggested[0]?.why, judgeReason);
  assert.equal(ask.contentUnavailable, undefined);
  assert.equal(optionById(ask, 'keep').suggested, false);
});

test('AC: the card’s contentRevision follows the digest, while the provider’s revision stands still', async () => {
  // The fleet item and its summary are two different clocks. Recomputing the SAME ask's summary
  // leaves the provider's entry (and its `revision`) untouched, so `revision` alone cannot tell
  // the display that the content was replaced; `contentRevision` carries the digest's revision
  // and is what the client keys its per-content state on.
  const firstRevision = 1;
  const secondRevision = 2;
  let reading = evaluated({ suggested: true, source: 'assistant', revision: firstRevision });
  const fleet = created({
    ttlMs: 0,
    runCards: runnerReturning(FIXTURE),
    readSessionAsk: () => reading,
  });

  const before = byId(await fleet.provider.listCards(), 'att-ask-1');
  assert.equal(before.revision, 3, 'the provider item keeps its own revision');
  assert.equal(before.contentRevision, firstRevision, 'the card carries the digest storage’s revision');

  // A recompute of the same fleet entry: the item is unchanged, the summary is not.
  reading = evaluated({ suggested: true, source: 'assistant', revision: secondRevision });
  const after = byId(await fleet.provider.listCards(), 'att-ask-1');

  assert.equal(after.revision, before.revision, 'the provider did not bump its item revision');
  assert.equal(after.contentRevision, secondRevision, 'the summary’s new revision reaches the card');
  assert.equal(
    (after.contentRevision ?? 0) > (before.contentRevision ?? 0),
    true,
    'contentRevision increased across the recompute',
  );
  assert.deepEqual(
    after.options.map((option) => option.id),
    before.options.map((option) => option.id),
    'the options are the same ones; only the content revision moved',
  );
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

test('AC: a stored disabled-tier reading is repaired on read, so the card carries its question and 是/否', async () => {
  const objects = new Map<string, ObservedObject>();
  const store = {
    writeRevision(input: Parameters<ObservationStore['writeRevision']>[0]): ObservedObject {
      const object: ObservedObject = {
        uri: input.uri,
        kind: input.kind,
        title: input.title,
        status: input.status,
        digest: input.digest ?? {},
        blindSpots: [],
        revision: (objects.get(input.uri)?.revision ?? 0) + 1,
        updatedAt: 1_800_000_000_000,
        provenance: {
          producer: input.provenance.producer,
          tier: input.provenance.tier,
          evaluatedAt: input.provenance.evaluatedAt ?? 1_800_000_000_000,
        },
      };
      objects.set(input.uri, object);
      return object;
    },
    getObject: (uri: string) => objects.get(uri) ?? null,
  } as unknown as ObservationStore;

  store.writeRevision({
    uri: formatSessionUri('sess-ask'),
    kind: 'session',
    title: '会话：浏览器 profile',
    status: { state: 'attention' },
    digest: {
      activity: 'waiting',
      askDecision: { state: 'skipped', reason: '未启用 observation.sessionDigest（提问决策摘要）' },
    },
    provenance: { producer: 'session-digest', tier: 'deterministic', evaluatedAt: 1_800_000_000_000 },
  });

  const transcript =
    [
      { type: 'user', uuid: 'u1', message: { role: 'user', content: [{ type: 'text', text: '释放 profile' }] } },
      {
        type: 'assistant',
        uuid: 'm-7',
        message: { role: 'assistant', content: [{ type: 'text', text: '是否要发送 browser_close 释放 MCP 浏览器 profile？' }] },
      },
    ]
      .map((row) => JSON.stringify(row))
      .join('\n') + '\n';

  const settings = {
    enabled: true,
    configuredEnabled: true,
    model: 'stub-model',
    maxPerHour: 6,
    minTurnChars: 0,
    apiKeyFile: '',
    protocol: 'anthropic' as const,
    baseUrl: 'http://stub.invalid',
    authScheme: 'bearer' as const,
    disableThinking: true,
    timeoutMs: 1_000,
    maxOutputTokens: 800,
    temperature: 0.2,
    apiKey: 'stub-key',
    source: 'file' as const,
    path: null,
    problems: [],
  };
  let calls = 0;
  const reader = createSessionAskDecisionReader({
    store,
    readSettings: () => settings,
    summarize: createSessionAskDecisionDigest({
      readSettings: () => settings,
      complete: async () => {
        calls += 1;
        return {
          text: JSON.stringify({
            ask: '是否要发送 browser_close 释放 profile？',
            situation: 'MCP 浏览器 profile 仍被占用。',
            incomplete: false,
            recommendedOptionId: null,
            options: [
              { id: 'yes', label: '是', does: '发送 browser_close。', tags: [{ kind: 'consequence', text: '释放资源' }], source: 'assistant' },
              { id: 'no', label: '否', does: '保持占用。', tags: [{ kind: 'consequence', text: '保持现状' }], source: 'assistant' },
            ],
          }),
          inputTokens: 10,
          outputTokens: 5,
        };
      },
    }),
    resolveSession: () => ({ title: '会话：浏览器 profile', jsonlPath: '/tmp/sess-ask.jsonl' }),
    readTranscript: async () => transcript,
    now: () => 1_800_000_000_000,
  });

  // The first read starts the background repair; the next card read sees the repaired digest.
  reader.read('sess-ask');
  await reader.settled();

  const fleet = created({ readSessionAsk: () => reader.read('sess-ask') });
  const ask = byId(await fleet.provider.listCards(), 'att-ask-1');

  assert.equal(calls, 1, 'the read repaired the digest with one model call');
  assert.equal(ask.contentUnavailable, undefined, 'the card is no longer marked not-ready');
  assert.equal(ask.ask, '是否要发送 browser_close 释放 profile？');
  assert.match(ask.situation ?? '', /MCP 浏览器 profile/);
  assert.deepEqual(ask.options.map((option) => option.label), ['是', '否']);
  assert.deepEqual(ask.options.map((option) => option.suggested), [false, false]);
});

// ---------------------------------------------------------------------------------------------
// A card's content is ITS OWN ask's: two cards on one session never share a reading
// ---------------------------------------------------------------------------------------------

/** One session-ask card about one asking message. `options: []` — the content layer fills them. */
function askCardAbout(id: string, messageId: string): Record<string, unknown> {
  return {
    id,
    provider: 'quay-fleet',
    revision: 1,
    kind: 'ask',
    group: 'ruling',
    rank: 1,
    state: 'open',
    waitingSince: WAITING,
    surfacedAt: SURFACED,
    subject: {
      project: 'proj-1',
      sessionId: 'sess-two',
      uri: `cloudcli://session/sess-two#${messageId}`,
    },
    contentRef: { resolver: 'cloudcli.session-ask', sessionId: 'sess-two', messageId },
    facts: [],
    options: [],
    ownerSession: null,
  };
}

/** One evaluated digest for one ask, with labels the criterion can tell apart. */
function readingFor(messageId: string, labels: [string, string]): SessionAskDecisionReading {
  return {
    state: 'evaluated',
    inputTokens: 10,
    outputTokens: 5,
    askId: `sess-two:${messageId}`,
    revision: 1,
    ask: `${messageId} 的问题？`,
    situation: `${messageId} 的情境。`,
    options: labels.map((label, index) => ({
      id: `${messageId}-${index}`,
      label,
      does: `${label} 的做法。`,
      tags: [],
      suggested: index === 0,
      source: 'assistant' as const,
    })),
    incomplete: false,
  };
}

test('AC: each ask card reads its own message’s digest, and a missing summary falls back to the original words', async () => {
  // The assistant's own words for the unsummarized ask: far longer than the card cap, with the
  // actual question at the END — the tail is the part a person has to answer.
  const originalAsk = `HEAD-MARKER ${'背景信息 '.repeat(200)}TAIL-MARKER 真正的问题：要先补测试吗？`;
  const readings: Record<string, SessionAskDecisionReading> = {
    'm-a': readingFor('m-a', ['先补测试 A', '先改实现 A']),
    'm-b': readingFor('m-b', ['合并 B', '等待 B']),
    'm-none': {
      state: 'unevaluated',
      reason: '这条提问的摘要尚未生成',
      originalAsk,
    },
  };
  const stdout = `${[
    askCardAbout('att-two-a', 'm-a'),
    askCardAbout('att-two-b', 'm-b'),
    askCardAbout('att-none', 'm-none'),
  ]
    .map((card) => JSON.stringify(card))
    .join('\n')}\n`;
  const seen: Array<[string, string]> = [];
  const fleet = created({
    runCards: runnerReturning(stdout),
    readSessionAsk: (sessionId, messageId) => {
      seen.push([sessionId, messageId]);
      return readings[messageId] ?? null;
    },
  });

  const cards = await fleet.provider.listCards();
  const cardA = byId(cards, 'att-two-a');
  const cardB = byId(cards, 'att-two-b');

  // Each card's own message id reached the reader — no card asked about the session.
  assert.deepEqual(seen, [
    ['sess-two', 'm-a'],
    ['sess-two', 'm-b'],
    ['sess-two', 'm-none'],
  ]);
  const labelsOf = (card: CockpitCard): string[] => card.options.map((option) => option.label);
  assert.deepEqual(labelsOf(cardA), ['先补测试 A', '先改实现 A'], 'A shows A’s options');
  assert.deepEqual(labelsOf(cardB), ['合并 B', '等待 B'], 'B shows B’s options');
  assert.notDeepEqual(labelsOf(cardA), labelsOf(cardB), 'the two cards cannot share one reading');
  assert.equal(cardA.ask, 'm-a 的问题？');
  assert.equal(cardB.ask, 'm-b 的问题？');
  assert.equal(cardA.contentUnavailable, undefined);
  assert.equal(cardB.contentUnavailable, undefined);

  // A card whose message has no summary is NOT filled from the session's other reading: it says
  // why it is empty, carries no options, and shows the asking message's own (capped) words.
  const cardNone = byId(cards, 'att-none');
  assert.deepEqual(cardNone.options, [], 'no options without a decision of its own');
  assert.match(cardNone.contentUnavailable ?? '', /尚未生成/);
  assert.equal(
    cardNone.ask,
    `…${originalAsk.slice(originalAsk.length - 600)}`,
    'the original-text fallback keeps the tail where the question is',
  );
  assert.equal(cardNone.ask?.length, 601, '600 characters plus the leading ellipsis');
  assert.equal(cardNone.ask?.includes('HEAD-MARKER'), false, 'the head is what the cap drops');
  assert.match(cardNone.ask ?? '', /TAIL-MARKER 真正的问题：要先补测试吗？$/);
});

// ---------------------------------------------------------------------------------------------
// Local suppression of withdrawn asks (gap-cockpit-ask-retraction-and-ledger-backfill)
// ---------------------------------------------------------------------------------------------

test('AC: a card whose contentRef.messageId was retracted is dropped from the visible list', async () => {
  // The control: with no withdrawal reading the same card IS on the wall. This is the false
  // form — delete the local suppression and this criterion reds.
  const without = await created({ runCards: runnerReturning(FIXTURE) }).provider.listCards();
  assert.ok(without.some((card) => card.id === 'att-ask-1'), 'the ask card is visible without suppression');

  let readSessionAskCalls = 0;
  const withSuppression = created({
    runCards: runnerReturning(FIXTURE),
    // The session-ask card's session holds NO observation object here.
    readSessionAsk: () => {
      readSessionAskCalls += 1;
      return null;
    },
    readRetractedMessageIds: () => new Set(['m-7']),
  });
  const visible = await withSuppression.provider.listCards();

  assert.equal(
    visible.some((card) => card.id === 'att-ask-1'),
    false,
    'the withdrawn card is not on the wall, even with no observation object',
  );
  assert.ok(readSessionAskCalls > 0, 'the card was projected (and read) before the withdrawal dropped it');
  // The other cards are untouched: the suppression names one message, not a group.
  assert.ok(visible.some((card) => card.id === 'att-rescue-1'));
  assert.ok(visible.some((card) => card.id === 'att-ruling-1'));
});

test('AC: a card whose messageId is NOT in the retracted set stays visible', async () => {
  const cards = await created({
    runCards: runnerReturning(FIXTURE),
    readRetractedMessageIds: () => new Set(['some-other-message']),
  }).provider.listCards();

  assert.ok(cards.some((card) => card.id === 'att-ask-1'), 'an unrelated withdrawal never hides this card');
});

test('AC7: the live 62d card is not suppressed while no retraction row names its message', async () => {
  const MESSAGE = '3818a9e5-1fb5-4c9f-9d99-eb8b7ee0647a';
  const SESSION = '62d959c0-5487-4649-a5f2-ab38462c438b';
  const AT = '2026-10-30T00:00:00.000Z';
  const home = await mkdtemp(path.join(os.tmpdir(), 'retracted-reader-'));
  try {
    // A real stream day file with a retraction for a DIFFERENT message: the reader must answer
    // the withdrawn message ids, and 62d's message must not be among them.
    const eventsDir = path.join(home, 'context', 'events');
    await mkdir(eventsDir, { recursive: true });
    const row = {
      v: 1,
      id: '01M646JCWF04EY3X9Y2NC90RQ7',
      at: AT,
      source: 'cloudcli',
      kind: 'session.asking.retracted',
      session: 'another-session',
      data: { askId: 'another-session:m-other', messageId: 'm-other' },
    };
    await writeFile(path.join(eventsDir, `${AT.slice(0, 10)}.jsonl`), `${JSON.stringify(row)}\n`, 'utf8');
    const retracted = await readRetractedSessionAskMessageIds({
      eventsDir,
      nowMs: Date.parse(AT),
      lookbackDays: 7,
    });
    assert.equal(retracted.has('m-other'), true, 'the reader reads the stream it was given');
    assert.equal(retracted.has(MESSAGE), false, 'the 62d ask was never retracted');

    const stdout = `${JSON.stringify(askCardAbout('att-260e4c9bbcc0', MESSAGE))}\n`;
    const cards = await created({
      runCards: runnerReturning(stdout),
      readSessionAsk: () => null,
      readRetractedMessageIds: () => retracted,
    }).provider.listCards();

    assert.ok(
      cards.some((card) => card.id === 'att-260e4c9bbcc0'),
      'the live 62d card stays visible until answered or its source disappears',
    );
  } finally {
    await rm(home, { recursive: true, force: true });
  }
});

/**
 * One molten short-loop decision exactly as the fleet states it: the category lives in the open
 * `kind` string (`molten-decision`), the four readings live in the `molten` block, and the entry
 * emits no options of its own — the cockpit builds them from the loop's actions.
 */
const MOLTEN_DECISION_CARD = {
  id: 'att-molten-1',
  provider: 'quay-fleet',
  revision: 1,
  kind: 'molten-decision',
  group: 'ruling',
  rank: 1,
  state: 'open',
  waitingSince: WAITING,
  surfacedAt: SURFACED,
  subject: { project: 'claudecodeui', uri: 'quay://claudecodeui/molten/1' },
  facts: [],
  options: [],
  molten: {
    judgement: '本轮判断：先补判据再派发',
    conclusion: '只差一条落地的判据',
    actions: [{ id: 'adopt-task', label: '立 quay 任务', does: '把动作立成任务' }],
    dispatch: '补一条判据后派发',
  },
};

test('AC: a molten-decision category projects to the molten kind with its four readings', async () => {
  const fleet = created({
    runCards: runnerReturning(`${JSON.stringify(MOLTEN_DECISION_CARD)}\n`),
    // A successful declaration read is what makes the molten executor's cockpit-side declaration
    // enter the provider's DECLARED set.
    runExecutors: declarationsRunner(),
  });

  const card = byId(await fleet.provider.listCards(), 'att-molten-1');
  assert.equal(card.kind, 'molten', 'the fleet category maps to the cockpit kind');
  assert.deepEqual(card.molten, MOLTEN_DECISION_CARD.molten, 'the block passes through verbatim');

  // 判断 → ask (the card's own headline); no separate 判断 fact is invented when it becomes the ask.
  assert.equal(card.ask, '本轮判断：先补判据再派发');
  // 结论 → one non-mechanical fact (the loop's reading, not a machine observation).
  const conclusion = card.facts.find((fact) => fact.text === '结论：只差一条落地的判据');
  assert.ok(conclusion !== undefined, 'the conclusion is carried as a fact');
  assert.equal(conclusion.mechanical, false);

  // 动作 + dispatch 提议 → confirm options, both routed to fleet.molten-decide.
  assert.deepEqual(optionById(card, 'adopt-task').action, {
    executor: COCKPIT_MOLTEN_DECIDE_EXECUTOR_ID,
    params: { cardId: 'att-molten-1', decision: 'adopt-task' },
  });
  assert.deepEqual(optionById(card, 'dispatch').action, {
    executor: COCKPIT_MOLTEN_DECIDE_EXECUTOR_ID,
    params: {
      cardId: 'att-molten-1',
      decision: 'dispatch',
      dispatch: '补一条判据后派发',
    },
  });
  // ⛔ The knowledge path is not reused: no knowledge block, no fleet.apply anywhere.
  assert.equal(card.knowledge, undefined);
  assert.equal(
    card.options.some((option) => option.action.executor === 'fleet.apply'),
    false,
  );

  // The declared set names the molten executor, so the registry leaves every option confirmable
  // instead of marking it 「尚未接入」.
  const registry = createCockpitCardRegistry([fleet.provider]);
  const projected = byId(await registry.listCards(), 'att-molten-1');
  assert.equal(registry.declaredExecutors().has(COCKPIT_MOLTEN_DECIDE_EXECUTOR_ID), true);
  assert.equal(
    projected.options.every((option) => option.confirmable !== false),
    true,
  );

  // And the late binding resolves it to a real fleet executor over the cockpit's declaration.
  const executor = await fleet.provider.resolveExecutor(COCKPIT_MOLTEN_DECIDE_EXECUTOR_ID);
  assert.ok(executor !== null, 'the molten executor resolves');
  assert.equal(executor.id, COCKPIT_MOLTEN_DECIDE_EXECUTOR_ID);
});

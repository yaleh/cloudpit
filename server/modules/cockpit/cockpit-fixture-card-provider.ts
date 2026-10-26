/**
 * The fixture card provider: six example cards, one per known kind, and an
 * executor that only records what it was asked to confirm.
 *
 * WHY IT EXISTS. The cockpit's card contract, registry, action channel and route
 * can be built and verified before the real provider (the quay-fleet adapter) is
 * aligned. This provider is enabled by the server settings file's
 * `cockpit.fixtureCards` switch (shipped off) and is never part of a release's
 * normal reading: with the switch off the registry is empty and
 * `GET /api/cockpit/cards` answers an empty list.
 *
 * WHAT IT DELIBERATELY DOES NOT DO. It does not judge, hide or re-rank anything:
 * it states `group`/`rank`/`state` and the cockpit's registry obeys them. It also
 * mutates nothing outside its own closure — the cards and the confirmation log
 * live in this instance, so a criterion (or an isolated instance) can read them
 * without a module-level singleton.
 *
 * THE REVISION RULE. Recording a confirmation is a content change, so the
 * executor advances the confirmed card's revision. That is what makes an old
 * revision's re-send a real `REVISION_CONFLICT` instead of a second execution.
 */
import type { ICockpitActionExecutor, ICockpitCardProvider } from '@/shared/interfaces.js';
import type { CockpitCard, CockpitCardOption, CockpitCardSubject, CockpitFixtureSubject } from '@/shared/types.js';

/** The one executor this provider declares. */
const FIXTURE_EXECUTOR_ID = 'fixture.record';

/** One confirmation the fixture executor accepted. */
export type CockpitFixtureConfirmation = {
  cardId: string;
  optionId: string | null;
  reply: string | null;
  params: Record<string, unknown>;
};

/** The fixture's three readings: the provider, its executor, and its in-memory log. */
export type CockpitFixtureCardProvider = {
  provider: ICockpitCardProvider;
  executor: ICockpitActionExecutor;
  /** A copy of every confirmation the executor accepted, oldest first. */
  confirmations(): readonly CockpitFixtureConfirmation[];
};

/**
 * One option whose action names the fixture executor. `cardId`/`optionId` are
 * part of the DECLARED params on purpose: the action channel passes params
 * verbatim, so the executor learns which card was confirmed without the channel
 * inventing extra fields.
 */
function fixtureOption(
  cardId: string,
  id: string,
  label: string,
  does: string,
  suggested: boolean,
  source: CockpitCardOption['source'],
  extra: Partial<CockpitCardOption> = {},
): CockpitCardOption {
  return {
    id,
    label,
    does,
    suggested,
    source,
    action: {
      executor: FIXTURE_EXECUTOR_ID,
      params: { cardId, optionId: id },
    },
    ...extra,
  };
}

/** One open card per known kind, plus two ended cards the projection must drop. */
function fixtureCards(): CockpitCard[] {
  return [
    {
      id: 'fixture:need',
      provider: 'fixture',
      revision: 1,
      kind: 'need',
      group: 'rescue',
      rank: 1,
      state: 'open',
      waitingSince: '2026-10-27T00:03:00.000Z',
      surfacedAt: '2026-10-27T00:03:05.000Z',
      subject: { uri: 'cloudcli://fixture/need', project: 'fixture-project' },
      ask: 'The deploy step needs a credential only you can provide.',
      situation: 'The build is waiting on a secret that is not in the environment.',
      facts: [
        { text: 'last attempt failed with 401', mechanical: true, observedAt: '2026-10-27T00:02:50.000Z' },
        { text: 'no secret file in the project', mechanical: false },
      ],
      options: [
        fixtureOption('fixture:need', 'provide', 'Provide the credential', 'Open the secret form and continue the deploy.', true, 'assistant'),
        fixtureOption('fixture:need', 'later', 'Later', 'Leave the deploy parked.', false, 'provider'),
      ],
    },
    {
      id: 'fixture:stuck',
      provider: 'fixture',
      revision: 1,
      kind: 'stuck',
      group: 'rescue',
      rank: 2,
      state: 'open',
      waitingSince: '2026-10-27T00:02:00.000Z',
      surfacedAt: '2026-10-27T00:02:04.000Z',
      subject: { uri: 'cloudcli://fixture/stuck', project: 'fixture-project', sessionId: 'fixture-session' },
      ask: 'This session has made no progress for 12 minutes.',
      situation: 'The last two turns ended without a tool call or a file change.',
      facts: [{ text: 'no activity since 00:01:58', mechanical: true }],
      options: [
        fixtureOption('fixture:stuck', 'resume', 'Resume with a nudge', 'Send one message asking for the next concrete step.', true, 'judge', {
          tags: [{ kind: 'undo', text: '可撤' }],
        }),
        fixtureOption('fixture:stuck', 'park', 'Park it', 'Stop the session and keep the transcript.', false, 'provider', {
          tags: [{ kind: 'warn', text: '不可逆' }],
        }),
      ],
      notify: { system: true, reason: 'fleet.stuck' },
    },
    {
      id: 'fixture:fix',
      provider: 'fixture',
      revision: 1,
      kind: 'fix',
      group: 'rescue',
      rank: 3,
      state: 'open',
      waitingSince: '2026-10-27T00:01:00.000Z',
      surfacedAt: '2026-10-27T00:01:06.000Z',
      subject: { uri: 'cloudcli://fixture/fix', project: 'fixture-project', taskId: 'fixture-task' },
      ask: 'The blocked task has a proposed unblock.',
      situation: 'Re-dispatch is suggested after the blocking task landed.',
      facts: [{ text: 'blocker merged 4 minutes ago', mechanical: true }],
      options: [
        fixtureOption('fixture:fix', 'apply', 'Apply the fix', 'Re-dispatch the task on the merged baseline.', true, 'assistant'),
        fixtureOption('fixture:fix', 'decline', 'Decline', 'Keep the task parked.', false, 'provider'),
      ],
    },
    {
      id: 'fixture:ask',
      provider: 'fixture',
      revision: 1,
      kind: 'ask',
      group: 'ruling',
      rank: 1,
      state: 'open',
      waitingSince: '2026-10-27T00:06:00.000Z',
      surfacedAt: '2026-10-27T00:06:03.000Z',
      subject: { uri: 'cloudcli://fixture/ask', project: 'fixture-project', sessionId: 'fixture-session' },
      contentRef: { resolver: 'cloudcli.session-ask', ref: 'fixture-session' },
      ask: 'Should the cleanup delete the staging directory?',
      situation: 'The run left 1.2 GB in staging and the transcript is already archived.',
      facts: [
        { text: 'staging holds 1.2 GB', mechanical: true, observedAt: '2026-10-27T00:05:58.000Z' },
        { text: 'transcript archived', mechanical: true },
      ],
      options: [
        fixtureOption('fixture:ask', 'delete', 'Delete staging', 'Remove the staging directory after the archive is verified.', true, 'assistant', {
          why: 'The data is already archived.',
          tags: [{ kind: 'undo', text: '可撤' }],
        }),
        fixtureOption('fixture:ask', 'keep', 'Keep staging', 'Leave the directory for a later inspection.', false, 'provider'),
      ],
      ownReply: { executor: FIXTURE_EXECUTOR_ID, params: { cardId: 'fixture:ask', ownReply: true } },
      conversation: { sessionId: 'fixture-session' },
    },
    {
      id: 'fixture:multi',
      provider: 'fixture',
      revision: 1,
      kind: 'multi',
      group: 'ruling',
      rank: 2,
      state: 'open',
      waitingSince: '2026-10-27T00:05:00.000Z',
      surfacedAt: '2026-10-27T00:05:02.000Z',
      subject: { uri: 'cloudcli://fixture/multi', project: 'fixture-project' },
      ask: 'Two independent decisions are waiting in this report.',
      situation: 'One choice is about scope, the other about the notification channel.',
      facts: [{ text: '2 sub-decisions extracted', mechanical: true }],
      options: [
        fixtureOption('fixture:multi', 'scope-small', 'Keep the scope small', 'Ship the contract without the UI.', true, 'assistant'),
        fixtureOption('fixture:multi', 'scope-full', 'Ship the full flow', 'Include the UI in the same task.', false, 'judge'),
      ],
    },
    {
      id: 'fixture:decision',
      provider: 'fixture',
      revision: 1,
      kind: 'decision',
      group: 'ruling',
      rank: 3,
      state: 'open',
      waitingSince: '2026-10-27T00:04:00.000Z',
      surfacedAt: '2026-10-27T00:04:05.000Z',
      subject: { uri: 'cloudcli://fixture/decision', project: 'fixture-project' },
      ask: 'Which release channel should this build use?',
      situation: 'No assistant recommendation was extracted for this ruling.',
      facts: [{ text: 'no recommended option', mechanical: true }],
      options: [
        fixtureOption('fixture:decision', 'stable', 'Stable', 'Release on the stable channel.', false, 'judge'),
        fixtureOption('fixture:decision', 'canary', 'Canary', 'Release to the canary channel first.', false, 'provider'),
      ],
    },
    {
      id: 'fixture:resolved',
      provider: 'fixture',
      revision: 3,
      kind: 'ask',
      group: 'ruling',
      rank: 0,
      state: 'resolved',
      waitingSince: '2026-10-26T23:00:00.000Z',
      surfacedAt: '2026-10-26T23:00:01.000Z',
      subject: { uri: 'cloudcli://fixture/resolved' },
      ask: 'This question was already answered.',
      facts: [],
      options: [],
    },
    {
      id: 'fixture:expired',
      provider: 'fixture',
      revision: 2,
      kind: 'decision',
      group: 'rescue',
      rank: 0,
      state: 'expired',
      waitingSince: '2026-10-26T22:00:00.000Z',
      surfacedAt: '2026-10-26T22:00:01.000Z',
      subject: { uri: 'cloudcli://fixture/expired' },
      ask: 'This decision is no longer relevant.',
      facts: [],
      options: [],
    },
  ];
}

/**
 * Applies the settings-file subject override to every fixture card.
 *
 * The override REPLACES the addressing fields rather than merging: the DoD flips
 * `{ sessionId }` to `{ project }` to prove the two own-reply defaults, and a merge
 * would leave a card's built-in `sessionId` in place and silently keep the wrong
 * executor. `uri` stays because it is the card's stable identity, not an address.
 */
function withSubjectOverride(
  cards: readonly CockpitCard[],
  override: CockpitFixtureSubject | undefined,
): CockpitCard[] {
  if (override === undefined) return cards.map((card) => structuredClone(card));
  const addressing: Omit<CockpitCardSubject, 'uri'> = {
    ...(override.sessionId === undefined ? {} : { sessionId: override.sessionId }),
    ...(override.project === undefined ? {} : { project: override.project }),
  };
  if (Object.keys(addressing).length === 0) return cards.map((card) => structuredClone(card));
  return cards.map((card) => ({
    ...structuredClone(card),
    subject: { uri: card.subject.uri, ...addressing },
  }));
}

/**
 * Builds one fixture provider over its own private card list and log.
 *
 * Two readers are exposed for criteria and for an isolated instance's DoD: the
 * provider/executor pair the composition registers, and a copy of the
 * confirmation log. Nothing is module-level, so two instances in one process are
 * independent.
 *
 * `subject` is the server settings file's `cockpit.fixtureSubject`. It REPLACES
 * every fixture card's subject (except the stable `uri`) so an isolated instance
 * can point the fixture at a copied-but-idle conversation — the only way the DoD's
 * `session.send` leg is real without sending to a live conversation. An empty
 * object, or none, leaves the fixture's own subjects untouched.
 */
export function createCockpitFixtureCardProvider(options: {
  subject?: CockpitFixtureSubject;
} = {}): CockpitFixtureCardProvider {
  const cards = withSubjectOverride(fixtureCards(), options.subject);
  const records: CockpitFixtureConfirmation[] = [];
  const listeners = new Set<() => void>();

  const changed = (): void => {
    for (const listener of listeners) listener();
  };

  const provider: ICockpitCardProvider = {
    id: 'fixture',
    listCards: () => cards.map((card) => structuredClone(card)),
    declaredExecutors: () => [FIXTURE_EXECUTOR_ID],
    subscribe: (listener) => {
      listeners.add(listener);
      return () => {
        listeners.delete(listener);
      };
    },
  };

  const executor: ICockpitActionExecutor = {
    id: FIXTURE_EXECUTOR_ID,
    execute: (params) => {
      const record: CockpitFixtureConfirmation = {
        cardId: typeof params.cardId === 'string' ? params.cardId : '',
        optionId: typeof params.optionId === 'string' ? params.optionId : null,
        reply: typeof params.reply === 'string' ? params.reply : null,
        params: structuredClone(params),
      };
      records.push(record);

      // A recorded confirmation is a content change: advance the card's revision
      // so a re-send of the OLD revision becomes a real conflict.
      const card = cards.find((candidate) => candidate.id === record.cardId);
      if (card !== undefined) card.revision += 1;
      changed();

      return { recorded: structuredClone(record), total: records.length };
    },
  };

  return {
    provider,
    executor,
    confirmations: () => records.map((record) => structuredClone(record)),
  };
}

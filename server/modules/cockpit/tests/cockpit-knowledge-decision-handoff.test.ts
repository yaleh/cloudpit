/**
 * The knowledge decision handoff's server-side criterion.
 *
 * WHAT THIS FILE PROVES, case by case (the task's AC1):
 *
 *   · a fleet knowledge card's case block, revisions, progress, verification reading and each
 *     option's decision survive the projection verbatim; an informational card's group is NOT
 *     rewritten into `ruling`, and a malformed case block leaves the card visible but unconfirmable;
 *   · the server issues a signed `confirmationRef` on read, and a confirmation must present it;
 *   · a caller-stated identity (`by: "human"`) is refused and never reaches an executor;
 *   · a stale revision re-fetches the provider and answers the CURRENT revision;
 *   · a valid reference over changed evidence (same card revision) is refused as stale;
 *   · a planned decision without a complete plan is refused; a knowledge card without readable
 *     case evidence is refused; an undeclared executor is refused;
 *   · one accepted decision runs its executor exactly once, delivers the complete plan under a
 *     DERIVED idempotency key, and a resend reuses that same key;
 *   · the trusted chain (reference + decision + case) is readable back from the feedback overlay;
 *   · progress and verification come ONLY from the provider's later reading — a receipt proves
 *     handoff, never execution.
 *
 * Run directly:
 *   npx tsx --tsconfig server/tsconfig.json --test \
 *     server/modules/cockpit/tests/cockpit-knowledge-decision-handoff.test.ts
 */
import assert from 'node:assert/strict';
import test from 'node:test';

import { createCockpitCardActions } from '@/modules/cockpit/cockpit-card-actions.js';
import { createCockpitCardFeedbackStore } from '@/modules/cockpit/cockpit-card-feedback-store.js';
import { createCockpitCardRegistry } from '@/modules/cockpit/cockpit-card-registry.js';
import { createCockpitFleetProjection } from '@/modules/cockpit/cockpit-fleet-card-projection.js';
import { createCockpitKnowledgeAuthority } from '@/modules/cockpit/cockpit-knowledge-decision.js';
import { readKnowledgeCase } from '@/modules/cockpit/cockpit-knowledge-reading.js';
import type { ICockpitActionExecutor, ICockpitCardProvider } from '@/shared/interfaces.js';
import type {
  CockpitCard,
  CockpitCardReceipt,
  CockpitKnowledgeCase,
  CockpitKnowledgePlan,
} from '@/shared/types.js';
import { AppError } from '@/shared/utils.js';

const AT = '2026-10-27T00:10:00.000Z';
const SECRET = 'criterion-secret';

const PLAN: CockpitKnowledgePlan = {
  scope: ['server/modules/cockpit', 'docs/architecture'],
  steps: ['record the decision', 'apply the suggestion', 'run the criterion'],
  verification: 'the card shows the reported verification with its summary',
};

function knowledgeCase(overrides: Partial<CockpitKnowledgeCase> = {}): CockpitKnowledgeCase {
  return {
    caseId: 'case-1',
    knowledgeId: 'knowledge-1',
    knowledgeRevision: 4,
    proposalRevision: 2,
    state: 'pending',
    plan: PLAN,
    originSessionId: 'session-1',
    factsFingerprint: 'fingerprint-a',
    ...overrides,
  };
}

/** One knowledge card with four decisions, each a declared executor action. */
function knowledgeCard(overrides: Partial<CockpitCard> = {}): CockpitCard {
  const option = (id: string, decision: string, executor = `test.${id}`) => ({
    id,
    label: id,
    does: `${id} the suggestion`,
    suggested: decision === 'apply',
    source: 'provider' as const,
    action: { executor, params: { caseId: 'case-1', decision } },
    decision: decision as never,
    ...(decision === 'apply' || decision === 'modify' ? { plan: PLAN } : {}),
  });
  return {
    provider: 'test',
    id: 'card-knowledge',
    revision: 3,
    kind: 'knowledge',
    group: 'ruling',
    rank: 1,
    state: 'open',
    waitingSince: '2026-10-27T00:00:00.000Z',
    surfacedAt: '2026-10-27T00:00:01.000Z',
    subject: { uri: 'quay://knowledge/knowledge-1', sessionId: 'session-1', taskId: 'task-1' },
    facts: [{ text: 'a measured fact', mechanical: true }],
    options: [
      option('apply', 'apply'),
      option('modify', 'modify'),
      option('defer', 'defer'),
      option('not-applicable', 'not-applicable'),
    ],
    knowledge: knowledgeCase(),
    ...overrides,
  };
}

/** The same card with its apply option routed to another declared executor. */
function withApplyExecutor(card: CockpitCard, executor: string): CockpitCard {
  return {
    ...card,
    options: card.options.map((option) =>
      option.id === 'apply'
        ? { ...option, action: { executor, params: { caseId: 'case-1' } } }
        : option,
    ),
  };
}

/** A provider over a mutable card list, with a refresh counter. */
class MutableProvider implements ICockpitCardProvider {
  readonly id = 'test';
  cards: CockpitCard[];
  refreshes = 0;

  constructor(cards: readonly CockpitCard[]) {
    this.cards = cards.map((card) => structuredClone(card));
  }

  listCards(): CockpitCard[] {
    return this.cards.map((card) => structuredClone(card));
  }

  declaredExecutors(): readonly string[] {
    return [
      'test.apply',
      'test.modify',
      'test.defer',
      'test.not-applicable',
      'test.feedback',
      'fleet.apply',
      'session.send',
    ];
  }

  feedbackExecutor(): string | null {
    return 'test.feedback';
  }

  refreshCards(): void {
    this.refreshes += 1;
  }
}

function countingExecutor(id: string): ICockpitActionExecutor & {
  calls: Record<string, unknown>[];
} {
  const calls: Record<string, unknown>[] = [];
  return {
    id,
    calls,
    execute: (params) => {
      calls.push(structuredClone(params));
      return { ok: true };
    },
  };
}

function setup(cards: readonly CockpitCard[]) {
  const provider = new MutableProvider(cards);
  const registry = createCockpitCardRegistry([provider]);
  const knowledge = createCockpitKnowledgeAuthority({ secret: SECRET });
  const actionExecutors = ['apply', 'modify', 'defer', 'not-applicable'].map((id) =>
    countingExecutor(`test.${id}`),
  );
  const fleetApply = countingExecutor('fleet.apply');
  const sessionSend = countingExecutor('session.send');
  const feedback = countingExecutor('test.feedback');
  feedback.execute = (params) => {
    feedback.calls.push(structuredClone(params));
    const receipt: CockpitCardReceipt = {
      feedbackId: String(params.feedbackId),
      at: AT,
      disposition: 'closed',
    };
    return { acknowledged: true, receipt };
  };
  const store = createCockpitCardFeedbackStore();
  const actions = createCockpitCardActions({
    registry,
    executors: [...actionExecutors, fleetApply, sessionSend, feedback],
    feedbackStore: store,
    knowledge,
    refreshCards: () => provider.refreshCards(),
    now: () => new Date(AT),
  });
  return {
    provider,
    registry,
    knowledge,
    actions,
    store,
    feedback,
    fleetApply,
    sessionSend,
    actionExecutors,
  };
}

/** The reference the card list route would mint for this card. */
function issuedRef(card: CockpitCard): string {
  const ref = createCockpitKnowledgeAuthority({ secret: SECRET }).issue(card).knowledge
    ?.confirmationRef;
  assert.ok(ref, 'a readable knowledge card is issued a confirmation reference');
  return ref;
}

function isError(code: string): (failure: unknown) => boolean {
  return (failure: unknown) =>
    failure instanceof AppError && failure.code === code && failure.statusCode >= 400;
}

/* ─── Projection: provider statements pass through ───────────────────────── */

test('the projection carries a knowledge card’s case, plan and per-option decisions', () => {
  const projection = createCockpitFleetProjection({ readSessionAsk: () => null });
  const line = JSON.stringify({
    id: 'fleet-k1',
    revision: 7,
    kind: 'knowledge',
    group: 'ruling',
    rank: 2,
    state: 'open',
    waitingSince: '2026-10-27T00:00:00.000Z',
    surfacedAt: '2026-10-27T00:00:01.000Z',
    subject: { uri: 'quay://knowledge/k1', sessionId: 's-1' },
    facts: [{ text: 'measured', mechanical: true }],
    knowledge: {
      caseId: 'case-k1',
      knowledgeRevision: 5,
      proposalRevision: 3,
      state: 'verifying',
      factsFingerprint: 'fp-k1',
      progress: { step: 'running the criterion', at: AT },
      verification: { state: 'pending', summary: 'criterion is running' },
      plan: PLAN,
    },
    options: [
      {
        id: 'apply',
        label: '应用',
        does: 'apply it',
        suggested: true,
        source: 'provider',
        decision: 'apply',
        plan: PLAN,
        action: { executor: 'fleet.apply', params: { caseId: 'case-k1' } },
      },
      {
        id: 'defer',
        label: '推迟',
        does: 'defer it',
        source: 'provider',
        decision: 'defer',
        action: { executor: 'fleet.defer', params: { caseId: 'case-k1' } },
      },
    ],
  });

  const { cards, skippedLines } = projection.project(line);
  assert.equal(skippedLines, 0);
  assert.equal(cards.length, 1);
  const card = cards[0] as CockpitCard;
  assert.equal(card.kind, 'knowledge');
  assert.equal(card.group, 'ruling');
  assert.deepEqual(card.knowledge, {
    caseId: 'case-k1',
    knowledgeRevision: 5,
    proposalRevision: 3,
    state: 'verifying',
    plan: PLAN,
    progress: { step: 'running the criterion', at: AT },
    verification: { state: 'pending', summary: 'criterion is running' },
    factsFingerprint: 'fp-k1',
  });
  assert.equal(card.options[0]?.decision, 'apply');
  assert.deepEqual(card.options[0]?.plan, PLAN);
  assert.equal(card.options[1]?.decision, 'defer');
  assert.equal(card.options[1]?.plan, undefined, 'a deferred decision carries no plan');
});

test('a knowledge block’s title and statement are read verbatim, and omitted when unstated', () => {
  // The type accepts the two display fields (compile-time part of this criterion).
  const typed: CockpitKnowledgeCase = {
    caseId: 'case-text',
    knowledgeRevision: 1,
    proposalRevision: 1,
    state: 'pending',
    title: '卡面显示知识标题',
    statement: '正文第一段。\n\n- 要点',
  };

  const stated = readKnowledgeCase({ ...typed });
  assert.equal(stated?.title, '卡面显示知识标题');
  assert.equal(stated?.statement, '正文第一段。\n\n- 要点');

  const bare = readKnowledgeCase({ caseId: 'case-bare', knowledgeRevision: 1, proposalRevision: 1 });
  assert.ok(bare !== null);
  assert.equal('title' in bare, false, 'an unstated title leaves NO key on the block');
  assert.equal('statement' in bare, false, 'an unstated statement leaves NO key on the block');

  const blank = readKnowledgeCase({
    caseId: 'case-blank',
    knowledgeRevision: 1,
    proposalRevision: 1,
    title: '   ',
    statement: '\n\t ',
  });
  assert.ok(blank !== null);
  assert.equal('title' in blank, false, 'a whitespace-only title is unstated');
  assert.equal('statement' in blank, false, 'a whitespace-only statement is unstated');
});

test('the projection passes a knowledge entry’s title and statement through verbatim', () => {
  const projection = createCockpitFleetProjection({ readSessionAsk: () => null });
  const card = (knowledge: Record<string, unknown>) =>
    JSON.stringify({
      id: 'fleet-text',
      revision: 2,
      kind: 'knowledge',
      group: 'ruling',
      rank: 0,
      state: 'open',
      waitingSince: '2026-10-27T00:00:00.000Z',
      surfacedAt: '2026-10-27T00:00:01.000Z',
      subject: { uri: 'quay://knowledge/k-text' },
      facts: [],
      options: [],
      knowledge: {
        caseId: 'case-text',
        knowledgeRevision: 6,
        proposalRevision: 2,
        state: 'pending',
        ...knowledge,
      },
    });

  const stated = projection.project(
    card({ title: '卡面显示知识标题', statement: '正文第一段。\n\n- 要点' }),
  );
  assert.equal(stated.skippedLines, 0);
  assert.equal(stated.cards[0]?.knowledge?.title, '卡面显示知识标题');
  assert.equal(stated.cards[0]?.knowledge?.statement, '正文第一段。\n\n- 要点');

  const bare = projection.project(card({}));
  const knowledge = bare.cards[0]?.knowledge;
  assert.ok(knowledge !== undefined);
  assert.equal('title' in knowledge, false);
  assert.equal('statement' in knowledge, false);
});

test('an informational card keeps its own group and is never shown as a rescue card', () => {
  const projection = createCockpitFleetProjection({ readSessionAsk: () => null });
  const line = JSON.stringify({
    id: 'fleet-notify',
    revision: 1,
    kind: 'notify',
    group: 'notify',
    rank: 0,
    state: 'open',
    waitingSince: '2026-10-27T00:00:00.000Z',
    surfacedAt: '2026-10-27T00:00:01.000Z',
    subject: { uri: 'quay://notify/1' },
    facts: [],
    options: [],
  });
  const { cards } = projection.project(line);
  assert.equal(cards[0]?.group, 'notify');
  assert.equal(cards[0]?.knowledge, undefined);
});

test('a malformed knowledge block is dropped, not invented', () => {
  const projection = createCockpitFleetProjection({ readSessionAsk: () => null });
  const line = JSON.stringify({
    id: 'fleet-broken',
    revision: 1,
    kind: 'knowledge',
    group: 'ruling',
    rank: 0,
    state: 'open',
    waitingSince: '2026-10-27T00:00:00.000Z',
    surfacedAt: '2026-10-27T00:00:01.000Z',
    subject: { uri: 'quay://knowledge/broken' },
    facts: [],
    // No caseId, no revisions: the card is visible, its evidence is not.
    knowledge: { state: 'pending', plan: PLAN },
    options: [],
  });
  const { cards } = projection.project(line);
  assert.equal(cards.length, 1);
  assert.equal(cards[0]?.knowledge, undefined);
});

/* ─── Trusted confirmation ──────────────────────────────────────────────── */

test('the issued reference is stamped on read and only a knowledge card gets one', () => {
  const authority = createCockpitKnowledgeAuthority({ secret: SECRET });
  const issued = authority.issue(knowledgeCard());
  assert.match(issued.knowledge?.confirmationRef ?? '', /^kc1\.[\w-]+\.[\w-]+$/);
  const plain = knowledgeCard({ kind: 'ask', knowledge: undefined });
  assert.equal(authority.issue(plain).knowledge, undefined);
  const evidenceLess = knowledgeCard({ knowledge: undefined });
  assert.equal(
    authority.issue(evidenceLess).knowledge,
    undefined,
    'a knowledge card without readable evidence gets no reference',
  );
  assert.match(authority.evidenceProblem(evidenceLess) ?? '', /缺少可读的 case 证据/);
});

test('a complete apply decision delivers the plan under a derived feedback id', async () => {
  const card = knowledgeCard();
  const ref = issuedRef(card);
  const { actions, feedback, actionExecutors, store } = setup([card]);

  const answer = await actions.confirm({
    cardId: card.id,
    revision: card.revision,
    optionId: 'apply',
    confirmationRef: ref,
  });

  assert.equal(answer.executor, 'test.apply');
  const action = actionExecutors[0];
  assert.equal(action?.calls.length, 1, 'the action runs exactly once');
  assert.equal(
    'confirmation' in ((action?.calls[0] ?? {}) as Record<string, unknown>),
    false,
    'a non-fleet.apply executor gains no confirmation field',
  );
  assert.equal(feedback.calls.length, 1, 'the feedback call is made exactly once');

  const params = feedback.calls[0] as Record<string, unknown>;
  assert.match(String(params.feedbackId), /^kf-[0-9a-f]{32}$/);
  assert.equal(params.caseId, 'case-1');
  assert.equal(params.decision, 'apply');
  assert.equal(params.knowledgeRevision, 4);
  assert.equal(params.proposalRevision, 2);
  assert.equal(params.confirmationRef, ref);
  assert.deepEqual(params.plan, PLAN, 'the COMPLETE plan is what was decided');
  assert.equal(params.optionId, 'apply');

  const stored = store.overlay(card.id);
  assert.ok(stored);
  assert.equal(stored.confirmationRef, ref);
  assert.equal(stored.decision, 'apply');
  assert.equal(stored.knowledgeCaseId, 'case-1');
  assert.equal(stored.feedbackId, params.feedbackId);
});

test('a knowledge apply decision injects the trusted confirmation into fleet.apply params', async () => {
  const card = withApplyExecutor(knowledgeCard(), 'fleet.apply');
  const ref = issuedRef(card);
  const { actions, fleetApply, feedback } = setup([card]);

  const answer = await actions.confirm({
    cardId: card.id,
    revision: card.revision,
    optionId: 'apply',
    confirmationRef: ref,
  });

  assert.equal(answer.executor, 'fleet.apply');
  assert.equal(fleetApply.calls.length, 1);
  const params = fleetApply.calls[0] as Record<string, unknown>;
  assert.equal(params.caseId, 'case-1', 'the option’s declared params are kept');

  const confirmation = params.confirmation as Record<string, unknown>;
  assert.ok(confirmation, 'fleet.apply receives a confirmation');
  assert.equal(confirmation.actorKind, 'human');
  assert.equal(typeof confirmation.decisionRef, 'string');
  assert.equal(confirmation.decisionRef, ref);
  assert.notEqual(confirmation.decisionRef, '');

  const at = confirmation.at as string;
  assert.equal(Number.isNaN(Date.parse(at)), false, '`at` parses as a date');
  assert.equal(new Date(at).toISOString(), at, '`at` is an ISO-8601 UTC instant');

  // `binding` is the case evidence the confirmation authority verified, minus its token, and
  // every field fleet's `confirmationShapeRefusals` requires is present.
  assert.deepEqual(confirmation.binding, {
    caseId: 'case-1',
    knowledgeRevision: 4,
    proposalRevision: 2,
    decision: 'apply',
    factsFingerprint: 'fingerprint-a',
    plan: PLAN,
  });
  assert.deepEqual(answer.params.confirmation, confirmation, 'the answer states what ran');

  // The feedback receipt is still the SECOND call, and its params did not gain a confirmation.
  assert.equal(feedback.calls.length, 1);
  assert.equal(feedback.calls[0]?.confirmation, undefined);
});

test('a knowledge decision routed to another executor gains no confirmation', async () => {
  const card = withApplyExecutor(knowledgeCard(), 'session.send');
  const ref = issuedRef(card);
  const { actions, sessionSend } = setup([card]);

  await actions.confirm({
    cardId: card.id,
    revision: card.revision,
    optionId: 'apply',
    confirmationRef: ref,
  });

  assert.deepEqual(sessionSend.calls[0], { caseId: 'case-1' });
  assert.equal(
    'confirmation' in (sessionSend.calls[0] as Record<string, unknown>),
    false,
  );
});

test('a non-knowledge confirmation passes its declared params unchanged', async () => {
  const card: CockpitCard = {
    ...knowledgeCard({ kind: 'ask', knowledge: undefined }),
    options: [
      {
        id: 'send',
        label: 'send',
        does: 'send the reply',
        suggested: false,
        source: 'provider',
        action: { executor: 'session.send', params: { sessionId: 'session-1', text: 'go' } },
      },
    ],
  };
  const { actions, sessionSend } = setup([card]);

  const answer = await actions.confirm({
    cardId: card.id,
    revision: card.revision,
    optionId: 'send',
  });

  assert.equal(answer.executor, 'session.send');
  assert.deepEqual(sessionSend.calls[0], { sessionId: 'session-1', text: 'go' });
  assert.equal(
    'confirmation' in (sessionSend.calls[0] as Record<string, unknown>),
    false,
  );
});

test('the trusted chain is readable back on the next card read', async () => {
  const card = knowledgeCard();
  const ref = issuedRef(card);
  const { actions, store } = setup([card]);
  await actions.confirm({
    cardId: card.id,
    revision: card.revision,
    optionId: 'apply',
    confirmationRef: ref,
  });

  const [readBack] = store.applyCards([card]);
  assert.equal(readBack?.feedback?.confirmationRef, ref);
  assert.equal(readBack?.feedback?.decision, 'apply');
  assert.equal(readBack?.feedback?.knowledgeCaseId, 'case-1');
});

test('a caller-stated human identity is refused and never runs the executor', async () => {
  const card = knowledgeCard();
  const ref = issuedRef(card);
  const { actions, feedback, actionExecutors } = setup([card]);

  await assert.rejects(
    () =>
      actions.confirm({
        cardId: card.id,
        revision: card.revision,
        optionId: 'apply',
        confirmationRef: ref,
        by: 'human',
      } as never),
    isError('CALLER_ATTESTATION_REJECTED'),
  );
  assert.equal(actionExecutors[0]?.calls.length, 0);
  assert.equal(feedback.calls.length, 0);
});

test('a knowledge confirmation without the issued reference is refused', async () => {
  const card = knowledgeCard();
  const { actions, actionExecutors } = setup([card]);

  await assert.rejects(
    () => actions.confirm({ cardId: card.id, revision: card.revision, optionId: 'apply' }),
    isError('MISSING_CONFIRMATION'),
  );
  assert.equal(actionExecutors[0]?.calls.length, 0);
});

test('a forged reference is refused before any executor runs', async () => {
  const card = knowledgeCard();
  const { actions, actionExecutors } = setup([card]);

  await assert.rejects(
    () =>
      actions.confirm({
        cardId: card.id,
        revision: card.revision,
        optionId: 'apply',
        confirmationRef: 'kc1.eyJub3BlIjoxfQ.forged',
      }),
    isError('INVALID_CONFIRMATION'),
  );
  assert.equal(actionExecutors[0]?.calls.length, 0);
});

test('a stale revision re-fetches the provider and answers the current revision', async () => {
  const card = knowledgeCard({ revision: 5 });
  const ref = issuedRef(card);
  const { actions, provider, actionExecutors } = setup([card]);

  await assert.rejects(
    () =>
      actions.confirm({
        cardId: card.id,
        revision: 3,
        optionId: 'apply',
        confirmationRef: ref,
      }),
    (failure: unknown) =>
      failure instanceof AppError &&
      failure.code === 'REVISION_CONFLICT' &&
      (failure.details as { currentRevision?: number }).currentRevision === 5,
  );
  assert.equal(provider.refreshes, 1, 'the provider cache is dropped before answering');
  assert.equal(actionExecutors[0]?.calls.length, 0);
});

test('a reference over changed evidence at the same revision is refused as stale', async () => {
  const card = knowledgeCard();
  const ref = issuedRef(card);
  const { actions, provider, actionExecutors } = setup([card]);
  // The provider re-derived the proposal without moving the card revision: the evidence digest
  // is exactly the field the reference binds so this is detectable.
  provider.cards[0] = {
    ...(provider.cards[0] as CockpitCard),
    knowledge: { ...(provider.cards[0]?.knowledge as CockpitKnowledgeCase), factsFingerprint: 'fp-b' },
  };

  await assert.rejects(
    () =>
      actions.confirm({
        cardId: card.id,
        revision: card.revision,
        optionId: 'apply',
        confirmationRef: ref,
      }),
    isError('STALE_CONFIRMATION'),
  );
  assert.equal(actionExecutors[0]?.calls.length, 0);
});

test('a planned decision without a complete plan is refused', async () => {
  const card = knowledgeCard();
  const broken: CockpitCard = {
    ...card,
    knowledge: { ...(card.knowledge as CockpitKnowledgeCase), plan: undefined },
    options: (card.options as CockpitCard['options']).map((option) =>
      option.id === 'apply' ? { ...option, plan: undefined } : option,
    ),
  };
  const ref = issuedRef(broken);
  const { actions, actionExecutors } = setup([broken]);

  await assert.rejects(
    () =>
      actions.confirm({
        cardId: broken.id,
        revision: broken.revision,
        optionId: 'apply',
        confirmationRef: ref,
      }),
    isError('KNOWLEDGE_PLAN_MISSING'),
  );
  assert.equal(actionExecutors[0]?.calls.length, 0);
});

test('a knowledge card without readable evidence is refused by name', async () => {
  const card = knowledgeCard({ knowledge: undefined });
  const { actions, actionExecutors } = setup([card]);

  await assert.rejects(
    () => actions.confirm({ cardId: card.id, revision: card.revision, optionId: 'apply' }),
    isError('KNOWLEDGE_EVIDENCE_MISSING'),
  );
  assert.equal(actionExecutors[0]?.calls.length, 0);
});

test('an undeclared executor is refused even on a knowledge card', async () => {
  const card = knowledgeCard({
    options: [
      {
        id: 'apply',
        label: 'apply',
        does: 'apply it',
        suggested: true,
        source: 'provider',
        decision: 'apply',
        plan: PLAN,
        action: { executor: 'fleet.unannounced', params: {} },
      },
    ],
  });
  const ref = issuedRef(card);
  const { actions, feedback } = setup([card]);

  await assert.rejects(
    () =>
      actions.confirm({
        cardId: card.id,
        revision: card.revision,
        optionId: 'apply',
        confirmationRef: ref,
      }),
    isError('EXECUTOR_NOT_DECLARED'),
  );
  assert.equal(feedback.calls.length, 0);
});

test('the same revision cannot be decided twice, and a resend reuses the feedback id', async () => {
  const card = knowledgeCard();
  const ref = issuedRef(card);
  const { actions, feedback, actionExecutors } = setup([card]);

  await actions.confirm({
    cardId: card.id,
    revision: card.revision,
    optionId: 'defer',
    confirmationRef: ref,
  });
  await assert.rejects(
    () =>
      actions.confirm({
        cardId: card.id,
        revision: card.revision,
        optionId: 'defer',
        confirmationRef: ref,
      }),
    isError('ALREADY_CONFIRMED'),
  );
  assert.equal(actionExecutors[2]?.calls.length, 1, 'the deferred action ran exactly once');

  const firstId = feedback.calls[0]?.feedbackId;
  await actions.resendFeedback({ cardId: card.id });
  assert.equal(feedback.calls.length, 2);
  assert.equal(feedback.calls[1]?.feedbackId, firstId, 'the resend keeps the same idempotency key');
  assert.equal(actionExecutors[2]?.calls.length, 1, 'a resend never reruns the action');
});

test('progress and verified outcome come only from the provider’s later reading', async () => {
  const card = knowledgeCard();
  const ref = issuedRef(card);
  const { actions, store } = setup([card]);
  await actions.confirm({
    cardId: card.id,
    revision: card.revision,
    optionId: 'apply',
    confirmationRef: ref,
  });

  const projection = createCockpitFleetProjection({ readSessionAsk: () => null });
  const later = projection.project(
    JSON.stringify({
      id: card.id,
      revision: 3,
      kind: 'knowledge',
      group: 'ruling',
      rank: 1,
      state: 'open',
      waitingSince: card.waitingSince,
      surfacedAt: card.surfacedAt,
      subject: { uri: 'quay://knowledge/knowledge-1', sessionId: 'session-1' },
      facts: [],
      knowledge: {
        caseId: 'case-1',
        knowledgeRevision: 4,
        proposalRevision: 2,
        state: 'reported',
        factsFingerprint: 'fingerprint-a',
        verification: { state: 'passed', summary: 'criterion exited 0', at: AT },
      },
      options: [],
    }),
  ).cards[0] as CockpitCard;

  const [merged] = store.applyCards([later]);
  assert.equal(merged?.knowledge?.state, 'reported');
  assert.equal(merged?.knowledge?.verification?.state, 'passed');
  assert.equal(merged?.feedback?.decision, 'apply', 'the handoff stays readable beside it');
  // The overlay's outcome names the executor, never a verification verdict: a receipt is handoff.
  assert.equal('verification' in (merged?.feedback as object), false);
});

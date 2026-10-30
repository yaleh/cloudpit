/**
 * The feedback receipt lifecycle's server-side criterion.
 *
 * The cases map one-to-one onto the task's AC:
 *
 *   · a successful action calls the provider's feedback executor EXACTLY once, with the
 *     protocol's params (`attentionId`, integer `revision`, `feedbackId`, `optionId` or
 *     `ownReply: true` + `text`, `suggested`, `source`, `outcome.sessionId`);
 *   · a failed action calls no feedback executor and leaves no overlay;
 *   · the overlay is durable: a second store over the same file still reads it;
 *   · the overlay clears on the provider's matching receipt (in the feedback answer or echoed on
 *     the card's reading) and on the card leaving the reading — but a `closed` receipt while the
 *     item is still listed keeps 「已发出」, and a revision change alone never clears it;
 *   · `rejected` clears the overlay and keeps the reason;
 *   · a dismiss runs NO action executor, sends `dismiss: true` to the feedback executor, and its
 *     `dismissed` receipt settles the card without a notice;
 *   · a resend reuses the same `feedbackId` and never runs the action again;
 *   · a provider with no feedback executor answers an explicit unavailable reason on resend.
 *
 * Run directly:
 *   npx tsx --tsconfig server/tsconfig.json --test \
 *     server/modules/cockpit/tests/cockpit-card-feedback.test.ts
 */
import assert from 'node:assert/strict';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import test from 'node:test';

import {
  NO_FEEDBACK_EXECUTOR_REASON,
  createCockpitCardActions,
} from '@/modules/cockpit/cockpit-card-actions.js';
import { createCockpitCardFeedbackStore } from '@/modules/cockpit/cockpit-card-feedback-store.js';
import { createCockpitCardRegistry } from '@/modules/cockpit/cockpit-card-registry.js';
import type { ICockpitActionExecutor, ICockpitCardProvider } from '@/shared/interfaces.js';
import type { CockpitCard, CockpitCardReceipt } from '@/shared/types.js';
import { AppError } from '@/shared/utils.js';

/** One card with every field a case does not care about filled in. */
function makeCard(overrides: Partial<CockpitCard> & Pick<CockpitCard, 'id'>): CockpitCard {
  return {
    provider: 'test',
    revision: 1,
    kind: 'ask',
    group: 'ruling',
    rank: 1,
    state: 'open',
    waitingSince: '2026-10-27T00:00:00.000Z',
    surfacedAt: '2026-10-27T00:00:01.000Z',
    subject: { uri: `cloudcli://test/${overrides.id}`, sessionId: 'session-1' },
    facts: [],
    options: [
      {
        id: 'go',
        label: 'Go ahead',
        does: 'Do the thing.',
        suggested: true,
        source: 'assistant',
        action: { executor: 'test.action', params: { cardId: overrides.id, optionId: 'go' } },
      },
    ],
    ...overrides,
  };
}

/**
 * A provider whose cards are a mutable array, so a case can echo a receipt, bump a revision or
 * drop a card between reads. `feedbackExecutorId === null` means "declares no feedback executor".
 */
class MutableCardProvider implements ICockpitCardProvider {
  readonly id = 'test';
  cards: CockpitCard[];
  private readonly feedbackExecutorId: string | null;

  constructor(cards: readonly CockpitCard[], feedbackExecutorId: string | null = 'test.feedback') {
    this.cards = cards.map((card) => structuredClone(card));
    this.feedbackExecutorId = feedbackExecutorId;
  }

  listCards(): CockpitCard[] {
    return this.cards.map((card) => structuredClone(card));
  }

  declaredExecutors(): readonly string[] {
    return this.feedbackExecutorId === null
      ? ['test.action']
      : ['test.action', this.feedbackExecutorId];
  }

  feedbackExecutor(): string | null {
    return this.feedbackExecutorId;
  }
}

/** A counting action executor; `fail: true` makes the action itself fail. */
function actionExecutor(options: { fail?: boolean; result?: unknown } = {}): ICockpitActionExecutor & {
  calls: Record<string, unknown>[];
} {
  const calls: Record<string, unknown>[] = [];
  return {
    id: 'test.action',
    calls,
    execute: (params) => {
      calls.push(structuredClone(params));
      if (options.fail === true) throw new Error('the action refused');
      return options.result ?? { sessionId: 'session-1' };
    },
  };
}

/** A feedback executor that records its calls and answers `receipt`, `answer`, or nothing. */
function feedbackExecutor(options: {
  receipt?: (params: Record<string, unknown>) => unknown;
  /** A whole answer document (the real fleet CLI nests its receipt under `result`). */
  answer?: (params: Record<string, unknown>) => unknown;
} = {}): ICockpitActionExecutor & {
  calls: Record<string, unknown>[];
} {
  const calls: Record<string, unknown>[] = [];
  return {
    id: 'test.feedback',
    calls,
    execute: (params) => {
      calls.push(structuredClone(params));
      if (options.answer !== undefined) return options.answer(params);
      const receipt = options.receipt?.(params);
      return receipt === undefined ? { acknowledged: true } : { acknowledged: true, receipt };
    },
  };
}

const AT = '2026-10-27T00:10:00.000Z';

function receiptOf(
  params: Record<string, unknown>,
  disposition: CockpitCardReceipt['disposition'],
  reason?: string,
): CockpitCardReceipt {
  return {
    feedbackId: String(params.feedbackId),
    at: AT,
    disposition,
    ...(reason === undefined ? {} : { reason }),
  };
}

/** A fresh store file per case; the caller removes the directory. */
function storeFile(): { directory: string; filePath: string } {
  const directory = mkdtempSync(path.join(tmpdir(), 'cockpit-card-feedback-'));
  return { directory, filePath: path.join(directory, 'feedback.json') };
}

test('a successful confirmation calls the feedback executor once with the protocol params', async () => {
  const provider = new MutableCardProvider([makeCard({ id: 'card-1' })]);
  const registry = createCockpitCardRegistry([provider]);
  const action = actionExecutor({ result: { sessionId: 'session-1', deliveryId: 'delivery-1' } });
  const feedback = feedbackExecutor({ receipt: (params) => receiptOf(params, 'closed') });
  const store = createCockpitCardFeedbackStore();
  let minted = 0;
  const actions = createCockpitCardActions({
    registry,
    executors: [action, feedback],
    feedbackStore: store,
    now: () => new Date(AT),
    newFeedbackId: () => `feedback-${(minted += 1)}`,
  });

  const answer = await actions.confirm({ cardId: 'card-1', revision: 1, optionId: 'go' });

  assert.equal(answer.executor, 'test.action');
  assert.equal(action.calls.length, 1, 'the action runs exactly once');
  assert.equal(feedback.calls.length, 1, 'the feedback executor is called exactly once');

  const params = feedback.calls[0];
  assert.equal(params.attentionId, 'card-1');
  assert.equal(params.revision, 1);
  assert.ok(Number.isInteger(params.revision), 'revision is an integer');
  assert.equal(params.feedbackId, 'feedback-1');
  assert.equal(params.optionId, 'go');
  assert.equal(params.suggested, true);
  assert.equal(params.source, 'assistant');
  assert.deepEqual(params.outcome, {
    executor: 'test.action',
    ok: true,
    sessionId: 'session-1',
    deliveryId: 'delivery-1',
  });

  const stored = store.overlay('card-1');
  assert.ok(stored, 'the overlay is recorded');
  assert.equal(stored.feedbackId, 'feedback-1');
  assert.equal(stored.revision, 1);
  assert.equal(stored.feedbackExecutor, 'test.feedback');
});

test('an own reply sends `ownReply: true` and the text, not an optionId', async () => {
  const provider = new MutableCardProvider([
    makeCard({
      id: 'card-1',
      ownReply: { executor: 'test.action', params: { cardId: 'card-1', ownReply: true } },
    }),
  ]);
  const registry = createCockpitCardRegistry([provider]);
  const action = actionExecutor();
  const feedback = feedbackExecutor({ receipt: (params) => receiptOf(params, 'closed') });
  const store = createCockpitCardFeedbackStore();
  const actions = createCockpitCardActions({
    registry,
    executors: [action, feedback],
    feedbackStore: store,
    now: () => new Date(AT),
    newFeedbackId: () => 'feedback-own',
  });

  await actions.confirm({ cardId: 'card-1', revision: 1, replyText: '我自己来写' });

  const params = feedback.calls[0];
  assert.equal(params.optionId, undefined);
  assert.equal(params.ownReply, true);
  assert.equal(params.text, '我自己来写');
  assert.equal(store.overlay('card-1')?.label, '我自己来写');
});

test('a failed action calls no feedback executor and records no overlay', async () => {
  const provider = new MutableCardProvider([makeCard({ id: 'card-1' })]);
  const registry = createCockpitCardRegistry([provider]);
  const action = actionExecutor({ fail: true });
  const feedback = feedbackExecutor();
  const store = createCockpitCardFeedbackStore();
  const actions = createCockpitCardActions({
    registry,
    executors: [action, feedback],
    feedbackStore: store,
  });

  await assert.rejects(
    () => actions.confirm({ cardId: 'card-1', revision: 1, optionId: 'go' }),
    (failure: unknown) => failure instanceof AppError && failure.code === 'EXECUTOR_FAILED',
  );

  assert.equal(feedback.calls.length, 0, 'a failed action owes no feedback call');
  assert.equal(store.overlay('card-1'), null, 'a failed action leaves no overlay');
});

test('the overlay survives a store rebuild over the same file', async () => {
  const { directory, filePath } = storeFile();
  try {
    const provider = new MutableCardProvider([makeCard({ id: 'card-1' })]);
    const registry = createCockpitCardRegistry([provider]);
    const first = createCockpitCardFeedbackStore({ filePath });
    const actions = createCockpitCardActions({
      registry,
      executors: [actionExecutor(), feedbackExecutor()],
      feedbackStore: first,
      now: () => new Date(AT),
      newFeedbackId: () => 'feedback-durable',
    });

    await actions.confirm({ cardId: 'card-1', revision: 1, optionId: 'go' });
    first.dispose();

    const second = createCockpitCardFeedbackStore({ filePath });
    const rebuilt = second.overlay('card-1');
    assert.ok(rebuilt, 'a new store over the same file reads the overlay');
    assert.equal(rebuilt.feedbackId, 'feedback-durable');
    assert.equal(rebuilt.label, 'Go ahead');
    assert.deepEqual(rebuilt.params, {
      attentionId: 'card-1',
      revision: 1,
      feedbackId: 'feedback-durable',
      optionId: 'go',
      suggested: true,
      source: 'assistant',
      outcome: { executor: 'test.action', ok: true, sessionId: 'session-1' },
    });
  } finally {
    rmSync(directory, { recursive: true, force: true });
  }
});

test('a `closed` receipt keeps 「已发出」 while the card is still listed', async () => {
  const provider = new MutableCardProvider([
    makeCard({ id: 'card-0', rank: 0 }),
    makeCard({ id: 'card-1', rank: 1 }),
    makeCard({ id: 'card-2', rank: 2 }),
  ]);
  const registry = createCockpitCardRegistry([provider]);
  const store = createCockpitCardFeedbackStore();
  const actions = createCockpitCardActions({
    registry,
    executors: [
      actionExecutor(),
      feedbackExecutor({ receipt: (params) => receiptOf(params, 'closed') }),
    ],
    feedbackStore: store,
  });

  await actions.confirm({ cardId: 'card-1', revision: 1, optionId: 'go' });

  const listed = store.applyCards(await registry.listCards());
  // 原位不动: the overlay is a field on the card, so the provider's order is untouched — an
  // acknowledged card never moves to the end of the list.
  assert.deepEqual(
    listed.map((card) => card.id),
    ['card-0', 'card-1', 'card-2'],
  );
  const middle = listed[1];
  assert.ok(middle.feedback, 'the reading still says 已发出 while the card is listed');
  assert.equal(middle.feedback.feedbackId, store.overlay('card-1')?.feedbackId);

  provider.cards = [];
  const gone = store.applyCards(await registry.listCards());
  assert.deepEqual(gone, []);
  assert.equal(store.overlay('card-1'), null, 'the card leaving the reading clears the overlay');
});

test('a sent card keeps its place in the reading (原位不动) instead of moving to the end', async () => {
  const provider = new MutableCardProvider([
    makeCard({ id: 'card-0', rank: 0 }),
    makeCard({ id: 'card-1', rank: 1 }),
    makeCard({ id: 'card-2', rank: 2 }),
  ]);
  const registry = createCockpitCardRegistry([provider]);
  const store = createCockpitCardFeedbackStore();
  const actions = createCockpitCardActions({
    registry,
    executors: [actionExecutor(), feedbackExecutor()],
    feedbackStore: store,
  });
  const before = (await registry.listCards()).map((card) => card.id);

  await actions.confirm({ cardId: 'card-1', revision: 1, optionId: 'go' });
  const after = store.applyCards(await registry.listCards());

  assert.deepEqual(after.map((card) => card.id), before);
  assert.equal(after[1].id, 'card-1');
  assert.ok(after[1].feedback, 'the overlay is attached where the card already was');
});

test('a revision change alone never clears the overlay', async () => {
  const provider = new MutableCardProvider([makeCard({ id: 'card-1' })]);
  const registry = createCockpitCardRegistry([provider]);
  const store = createCockpitCardFeedbackStore();
  const actions = createCockpitCardActions({
    registry,
    executors: [actionExecutor(), feedbackExecutor()],
    feedbackStore: store,
  });

  await actions.confirm({ cardId: 'card-1', revision: 1, optionId: 'go' });

  provider.cards = [makeCard({ id: 'card-1', revision: 2 })];
  const listed = store.applyCards(await registry.listCards());
  assert.ok(listed[0].feedback, 'a newer revision does not acknowledge anything');
  assert.equal(store.overlay('card-1')?.revision, 1, 'the overlay keeps the revision it sent');
});

test('a matching receipt echoed on the card clears the overlay and records the notice', async () => {
  const provider = new MutableCardProvider([makeCard({ id: 'card-1' })]);
  const registry = createCockpitCardRegistry([provider]);
  const store = createCockpitCardFeedbackStore();
  const actions = createCockpitCardActions({
    registry,
    executors: [actionExecutor(), feedbackExecutor()],
    feedbackStore: store,
    newFeedbackId: () => 'feedback-echo',
  });

  await actions.confirm({ cardId: 'card-1', revision: 1, optionId: 'go' });

  // The provider's card reading echoes the receipt: this is the second way an overlay clears.
  provider.cards = [
    {
      ...makeCard({ id: 'card-1' }),
      receipt: { feedbackId: 'feedback-echo', at: AT, disposition: 'kept' },
    },
  ];
  const listed = store.applyCards(await registry.listCards());

  assert.equal(store.overlay('card-1'), null, 'a kept receipt clears the overlay');
  assert.ok(listed[0].feedbackNotice, 'the reading carries the kept notice');
  assert.equal(listed[0].feedbackNotice.kind, 'kept');
  assert.equal(listed[0].feedback, undefined);
});

test('a receipt for another feedbackId changes nothing', async () => {
  const provider = new MutableCardProvider([makeCard({ id: 'card-1' })]);
  const registry = createCockpitCardRegistry([provider]);
  const store = createCockpitCardFeedbackStore();
  const actions = createCockpitCardActions({
    registry,
    executors: [actionExecutor(), feedbackExecutor()],
    feedbackStore: store,
    newFeedbackId: () => 'feedback-mine',
  });

  await actions.confirm({ cardId: 'card-1', revision: 1, optionId: 'go' });

  provider.cards = [
    {
      ...makeCard({ id: 'card-1' }),
      receipt: { feedbackId: 'someone-elses', at: AT, disposition: 'rejected', reason: 'stale-revision' },
    },
  ];
  const listed = store.applyCards(await registry.listCards());

  assert.ok(listed[0].feedback, 'another idempotency key acknowledges nothing');
  assert.equal(listed[0].feedback.feedbackId, 'feedback-mine');
});

test('a rejected receipt clears the overlay and keeps the reason', async () => {
  const provider = new MutableCardProvider([makeCard({ id: 'card-1' })]);
  const registry = createCockpitCardRegistry([provider]);
  const store = createCockpitCardFeedbackStore();
  const actions = createCockpitCardActions({
    registry,
    executors: [
      actionExecutor(),
      feedbackExecutor({ receipt: (params) => receiptOf(params, 'rejected', 'stale-revision') }),
    ],
    feedbackStore: store,
    newFeedbackId: () => 'feedback-rejected',
  });

  await actions.confirm({ cardId: 'card-1', revision: 1, optionId: 'go' });

  assert.equal(store.overlay('card-1'), null, 'a rejected receipt returns the card to the queue');
  const notice = store.notice('card-1');
  assert.equal(notice?.kind, 'rejected');
  assert.equal(notice?.reason, 'stale-revision');

  const listed = store.applyCards(await registry.listCards());
  assert.equal(listed[0].feedbackNotice?.reason, 'stale-revision');
  assert.equal(listed[0].feedback, undefined);
});

test('a dismiss sends `dismiss: true`, runs no action executor and settles on the receipt', async () => {
  const provider = new MutableCardProvider([makeCard({ id: 'card-1' })]);
  const registry = createCockpitCardRegistry([provider]);
  const action = actionExecutor();
  const feedback = feedbackExecutor({
    receipt: (params) => receiptOf(params, 'dismissed'),
  });
  const store = createCockpitCardFeedbackStore();
  const actions = createCockpitCardActions({
    registry,
    executors: [action, feedback],
    feedbackStore: store,
    now: () => new Date(AT),
    newFeedbackId: () => 'feedback-dismiss',
  });

  const answer = await actions.dismiss({ cardId: 'card-1', revision: 1 });

  assert.equal(answer.executor, 'test.feedback');
  assert.equal(action.calls.length, 0, 'a dismiss never runs an action executor');
  assert.equal(feedback.calls.length, 1, 'the feedback executor takes the dismiss signal');
  const params = feedback.calls[0];
  assert.equal(params.attentionId, 'card-1');
  assert.equal(params.revision, 1);
  assert.equal(params.feedbackId, 'feedback-dismiss');
  assert.equal(params.dismiss, true, 'the dismiss flag is top-level feedback params');
  assert.equal(params.optionId, undefined, 'a dismiss names no option');
  assert.equal(params.outcome, undefined, 'no action ran, so there is no action outcome');

  // Settle, not a return to the queue: nothing is left for the display to draw on this card.
  assert.equal(store.overlay('card-1'), null, 'no action means no feedback overlay');
  assert.equal(store.notice('card-1'), null, 'a dismissed receipt records no kept/rejected notice');
  provider.cards = [];
  assert.deepEqual(store.applyCards(await registry.listCards()), []);
});

test('a dismissed receipt settles a sent feedback without recording a notice', async () => {
  const provider = new MutableCardProvider([makeCard({ id: 'card-1' })]);
  const registry = createCockpitCardRegistry([provider]);
  const store = createCockpitCardFeedbackStore();
  const actions = createCockpitCardActions({
    registry,
    executors: [
      actionExecutor(),
      feedbackExecutor({ receipt: (params) => receiptOf(params, 'dismissed') }),
    ],
    feedbackStore: store,
    newFeedbackId: () => 'feedback-dismissed-after-action',
  });

  await actions.confirm({ cardId: 'card-1', revision: 1, optionId: 'go' });

  assert.equal(store.overlay('card-1'), null, 'a dismissed receipt clears the overlay');
  assert.equal(store.notice('card-1'), null, 'it does not return as a kept/rejected notice');
});

test('a receipt nested under `result` is read exactly like a top-level receipt', async () => {
  const provider = new MutableCardProvider([makeCard({ id: 'card-1' })]);
  const registry = createCockpitCardRegistry([provider]);
  const store = createCockpitCardFeedbackStore();
  // The real `CockpitFleetExecutor` returns the WHOLE fleet CLI document, so its receipt lives at
  // `result.receipt`; the fixture provider answers a top-level `receipt`. Both must be read.
  const feedback = feedbackExecutor({
    answer: (params) => ({
      ok: true,
      state: 'feedback',
      result: {
        receipt: {
          feedbackId: params.feedbackId,
          at: AT,
          disposition: feedback.calls.length === 1 ? 'closed' : 'dismissed',
        },
      },
    }),
  });
  const actions = createCockpitCardActions({
    registry,
    executors: [actionExecutor(), feedback],
    feedbackStore: store,
    newFeedbackId: () => 'feedback-nested',
  });

  await actions.confirm({ cardId: 'card-1', revision: 1, optionId: 'go' });
  assert.ok(store.overlay('card-1'), 'a nested `closed` receipt keeps the pending overlay');

  await actions.resendFeedback({ cardId: 'card-1' });
  assert.equal(store.overlay('card-1'), null, 'a nested `dismissed` receipt on the resend clears it');
  assert.equal(store.notice('card-1'), null, 'a dismissal records no kept/rejected notice');
});

test('a rejected dismiss is an observable failure, keeps the reason and stays retryable', async () => {
  const provider = new MutableCardProvider([makeCard({ id: 'card-1', revision: 0 })]);
  const registry = createCockpitCardRegistry([provider]);
  // The real fleet rejects a stale revision with `{ ok: true, result: { receipt: { disposition:
  // 'rejected', reason: 'stale-revision' } } }` — a zero exit that wrote nothing.
  const feedback = feedbackExecutor({
    answer: () => ({
      ok: true,
      state: 'feedback',
      result: {
        receipt: { disposition: 'rejected', reason: 'stale-revision' },
        appended: 0,
        skipped: 0,
      },
    }),
  });
  const store = createCockpitCardFeedbackStore();
  const actions = createCockpitCardActions({
    registry,
    executors: [actionExecutor(), feedback],
    feedbackStore: store,
    newFeedbackId: () => 'feedback-dismiss-rejected',
  });

  await assert.rejects(
    () => actions.dismiss({ cardId: 'card-1', revision: 0 }),
    (failure: unknown) =>
      failure instanceof AppError &&
      failure.statusCode === 409 &&
      /stale-revision/.test(failure.message),
    'a rejected dismiss answers 4xx and names the fleet reason',
  );
  const notice = store.notice('card-1');
  assert.equal(notice?.kind, 'rejected', 'the refused dismissal leaves a rejected notice');
  assert.equal(notice?.reason, 'stale-revision');

  // The refusal wrote nothing, so the revision the person was looking at must still be
  // dismissable: the retry reaches the provider again instead of being answered ALREADY_CONFIRMED.
  await assert.rejects(() => actions.dismiss({ cardId: 'card-1', revision: 0 }));
  assert.equal(
    feedback.calls.length,
    2,
    'a rejected dismissal releases the accepted-ledger key so a retry reaches the fleet',
  );
});

test('a dismiss for a stale revision is refused before reaching the provider', async () => {
  const provider = new MutableCardProvider([makeCard({ id: 'card-1', revision: 3 })]);
  const registry = createCockpitCardRegistry([provider]);
  const feedback = feedbackExecutor({ receipt: (params) => receiptOf(params, 'dismissed') });
  const actions = createCockpitCardActions({
    registry,
    executors: [actionExecutor(), feedback],
    feedbackStore: createCockpitCardFeedbackStore(),
  });

  await assert.rejects(
    () => actions.dismiss({ cardId: 'card-1', revision: 2 }),
    (failure: unknown) =>
      failure instanceof AppError && failure.code === 'REVISION_CONFLICT',
  );
  assert.equal(feedback.calls.length, 0, 'a stale dismiss never reaches the provider');
});

test('a resend reuses the same feedbackId and never runs the action again', async () => {
  const provider = new MutableCardProvider([makeCard({ id: 'card-1' })]);
  const registry = createCockpitCardRegistry([provider]);
  const action = actionExecutor();
  const feedback = feedbackExecutor();
  const store = createCockpitCardFeedbackStore();
  const actions = createCockpitCardActions({
    registry,
    executors: [action, feedback],
    feedbackStore: store,
    now: () => new Date(AT),
    newFeedbackId: () => 'feedback-idempotent',
  });

  await actions.confirm({ cardId: 'card-1', revision: 1, optionId: 'go' });
  assert.equal(action.calls.length, 1);
  assert.equal(feedback.calls.length, 1);

  const resent = await actions.resendFeedback({ cardId: 'card-1' });

  assert.equal(resent.feedbackId, 'feedback-idempotent');
  assert.equal(feedback.calls.length, 2, 'the resend asks the feedback executor again');
  assert.deepEqual(feedback.calls[1], feedback.calls[0], 'the resend repeats the original params');
  assert.equal(action.calls.length, 1, 'a resend never redoes the action');
});

test('a provider without a feedback executor answers an explicit unavailable reason', async () => {
  const provider = new MutableCardProvider([makeCard({ id: 'card-1' })], null);
  const registry = createCockpitCardRegistry([provider]);
  const action = actionExecutor();
  const store = createCockpitCardFeedbackStore();
  const actions = createCockpitCardActions({
    registry,
    executors: [action],
    feedbackStore: store,
  });

  await actions.confirm({ cardId: 'card-1', revision: 1, optionId: 'go' });

  const stored = store.overlay('card-1');
  assert.ok(stored, 'the action happened, so the card is locked even without a feedback executor');
  const listed = store.applyCards(await registry.listCards());
  assert.equal(listed[0].feedback?.canResend, false);
  assert.equal(listed[0].feedback?.resendUnavailableReason, NO_FEEDBACK_EXECUTOR_REASON);

  await assert.rejects(
    () => actions.resendFeedback({ cardId: 'card-1' }),
    (failure: unknown) =>
      failure instanceof AppError &&
      failure.code === 'FEEDBACK_UNAVAILABLE' &&
      failure.message === NO_FEEDBACK_EXECUTOR_REASON,
  );
});

test('a thrown feedback call records lastError on the overlay, and a store rebuild still reads it', async () => {
  const { directory, filePath } = storeFile();
  try {
    const provider = new MutableCardProvider([makeCard({ id: 'card-1' })]);
    const registry = createCockpitCardRegistry([provider]);
    const first = createCockpitCardFeedbackStore({ filePath });
    const actions = createCockpitCardActions({
      registry,
      executors: [
        actionExecutor(),
        {
          id: 'test.feedback',
          execute: () => {
            throw new Error('fleet unreachable');
          },
        },
      ],
      feedbackStore: first,
      now: () => new Date(AT),
      newFeedbackId: () => 'feedback-failed',
    });

    // The ACTION succeeded (the card's content is no longer confirmable), but the feedback call
    // threw. The overlay must exist AND carry the reason — not pretend the fleet is merely slow.
    await actions.confirm({ cardId: 'card-1', revision: 1, optionId: 'go' });
    const stored = first.overlay('card-1');
    assert.ok(stored, 'a failed feedback call still leaves the overlay');
    assert.equal(stored.lastError, 'fleet unreachable');
    first.dispose();

    const rebuilt = createCockpitCardFeedbackStore({ filePath });
    assert.equal(
      rebuilt.overlay('card-1')?.lastError,
      'fleet unreachable',
      'the reason is durable, so a restart does not erase why the card is amber',
    );
    const listed = rebuilt.applyCards(await registry.listCards());
    assert.equal(listed[0].feedback?.lastError, 'fleet unreachable');
  } finally {
    rmSync(directory, { recursive: true, force: true });
  }
});

test('a successful resend that receives a receipt clears the recorded lastError', async () => {
  const provider = new MutableCardProvider([makeCard({ id: 'card-1' })]);
  const registry = createCockpitCardRegistry([provider]);
  const store = createCockpitCardFeedbackStore();
  let calls = 0;
  const flaky: ICockpitActionExecutor = {
    id: 'test.feedback',
    execute: (params) => {
      calls += 1;
      if (calls === 1) throw new Error('fleet unreachable');
      // A `closed` receipt keeps the overlay (the item is still listed), so the cleared field is
      // readable on the same stored record rather than vanishing with the overlay.
      return {
        acknowledged: true,
        receipt: {
          feedbackId: String(params.feedbackId),
          at: AT,
          disposition: 'closed',
        },
      };
    },
  };
  const actions = createCockpitCardActions({
    registry,
    executors: [actionExecutor(), flaky],
    feedbackStore: store,
    now: () => new Date(AT),
    newFeedbackId: () => 'feedback-flaky',
  });

  await actions.confirm({ cardId: 'card-1', revision: 1, optionId: 'go' });
  assert.equal(store.overlay('card-1')?.lastError, 'fleet unreachable');

  const resent = await actions.resendFeedback({ cardId: 'card-1' });
  assert.equal(resent.feedbackId, 'feedback-flaky');
  assert.equal(
    store.overlay('card-1')?.lastError,
    undefined,
    'a resend that reached the provider proves the earlier failure is over',
  );
  const listed = store.applyCards(await registry.listCards());
  assert.equal(listed[0].feedback?.lastError, undefined);
});

/**
 * The cockpit's confirmation channel: one accepted confirmation → at most one
 * executor call.
 *
 * THE GUARDS, in the order they run:
 *
 *   1. the request names exactly one of `optionId` / `replyText`, and a revision;
 *   2. the card is currently OPEN in the registry (a resolved/expired card is
 *      not confirmable);
 *   3. the request's revision equals the card's CURRENT revision — a stale
 *      confirmation is a conflict, and the executor is never called for it;
 *   4. the executor id came from the option or `ownReply`, and the provider
 *      DECLARED it — an undeclared id is refused, even though a card names it;
 *   5. this `(card, revision)` has not been accepted before. The ledger is what
 *      makes "one confirmation, one execution" true even when two devices send
 *      the same confirm at once; a duplicate is a conflict, not a second call.
 *
 * An option's declared `params` are passed to the executor VERBATIM (the
 * criterion compares them with `deepEqual`). A free-text reply has no declared
 * params of its own for the text, so the text joins `ownReply.params` under
 * `reply` — that is the one field the channel adds.
 *
 * Errors are `AppError`s, so the thin route just forwards them to the server's
 * existing error middleware and a caller reads a status + a stable code.
 */
import { randomUUID } from 'node:crypto';

import { AppError, isRecord } from '@/shared/utils.js';
import type { ICockpitActionExecutor } from '@/shared/interfaces.js';
import type {
  CockpitCard,
  CockpitCardAction,
  CockpitCardFeedbackOutcome,
  CockpitCardReceipt,
} from '@/shared/types.js';

import type { CockpitCardRegistry } from './cockpit-card-registry.js';
import {
  readCockpitCardReceipt,
  type CockpitCardFeedbackStore,
  type StoredCockpitCardFeedback,
} from './cockpit-card-feedback-store.js';
import {
  callerAttestationFields,
  type CockpitKnowledgeAuthority,
  type CockpitKnowledgeConfirmation,
} from './cockpit-knowledge-decision.js';
import { isKnowledgeCard } from './cockpit-knowledge-reading.js';

/** One confirmation's transport fields, before validation narrows them. */
export type CockpitCardConfirmRequest = {
  cardId: unknown;
  revision: unknown;
  optionId?: unknown;
  replyText?: unknown;
};

/** The accepted confirmation's answer: what ran, with what params, and what it said. */
export type CockpitCardConfirmResult = {
  ok: true;
  cardId: string;
  executor: string;
  params: Record<string, unknown>;
  result: unknown;
};

/**
 * A late-bound executor lookup.
 *
 * Some declared executors cannot exist at composition time: the quay-fleet declaration set is an
 * async child read, so its implementations are instantiated on the first confirmation that names
 * one. The resolver is asked ONLY for an id the registry has just reported as declared, so it can
 * never widen what a card may reach.
 */
export type CockpitExecutorResolver = (
  id: string,
) => Promise<ICockpitActionExecutor | null> | ICockpitActionExecutor | null;

/** What a resend answered: the same idempotency key, and the executor's own result. */
export type CockpitCardResendResult = {
  ok: true;
  cardId: string;
  /** The original feedback id; a resend NEVER mints a new one. */
  feedbackId: string;
  executor: string;
  result: unknown;
};

/** What a dismiss answered: the feedback executor that took the signal and its own result. */
export type CockpitCardDismissResult = {
  ok: true;
  cardId: string;
  executor: string;
  params: Record<string, unknown>;
  result: unknown;
};

/** The action channel's public surface. */
export type CockpitCardActions = {
  confirm(request: unknown): Promise<CockpitCardConfirmResult>;
  /**
   * Discards a card WITHOUT running its action: no option is resolved and no action executor is
   * called. The provider's feedback executor receives the feedback params with a top-level
   * `dismiss: true`, and its `dismissed` receipt settles the item instead of returning it.
   */
  dismiss(request: unknown): Promise<CockpitCardDismissResult>;
  /**
   * Re-sends ONLY the feedback call for a card whose action already ran. No option is resolved
   * and no action executor is called; the stored params — same `feedbackId` included — go to
   * the feedback executor verbatim.
   */
  resendFeedback(request: unknown): Promise<CockpitCardResendResult>;
};

/** Why a provider with no feedback executor cannot resend. */
export const NO_FEEDBACK_EXECUTOR_REASON =
  '该提供方没有声明反馈执行器，无法确认收到';

/** Why a resend cannot run after the provider stopped declaring the original executor. */
export const FEEDBACK_EXECUTOR_GONE_REASON =
  '该提供方已不再声明原来的反馈执行器，无法重发';

type ParsedConfirmRequest = {
  cardId: string;
  revision: number;
  optionId?: string;
  replyText?: string;
  /**
   * The server-issued knowledge confirmation reference. Present when the card is a versioned
   * knowledge suggestion; the confirmation authority verifies it, this reader only carries it.
   */
  confirmationRef?: string;
};

function invalid(message: string): AppError {
  return new AppError(message, { code: 'INVALID_REQUEST', statusCode: 400 });
}

/**
 * Narrows the transport body. `optionId` and `replyText` are mutually exclusive
 * and exactly one is required: the card's displayed option and "my own reply"
 * are two different paths, and guessing which one a caller meant would execute
 * an action the person did not choose.
 */
function parseConfirmRequest(raw: unknown): ParsedConfirmRequest {
  if (typeof raw !== 'object' || raw === null || Array.isArray(raw)) {
    throw invalid('the confirmation body must be a JSON object');
  }
  const record = raw as Record<string, unknown>;

  // A CALLER CANNOT ATTEST TO ITSELF. A knowledge decision's proof is the server-issued
  // reference, never a body that claims `by: "human"`; such a field is refused by name so no
  // client learns to "just add it" and pass.
  const attestation = callerAttestationFields(record);
  if (attestation.length > 0) {
    throw new AppError(
      `caller-supplied ${attestation.join(', ')} is not accepted as confirmation identity`,
      { code: 'CALLER_ATTESTATION_REJECTED', statusCode: 400 },
    );
  }

  if (typeof record.cardId !== 'string' || record.cardId.trim() === '') {
    throw invalid('`cardId` must be a non-empty string');
  }
  if (
    typeof record.revision !== 'number' ||
    !Number.isInteger(record.revision) ||
    record.revision < 0
  ) {
    throw invalid('`revision` must be a non-negative integer');
  }
  if (record.optionId !== undefined && (typeof record.optionId !== 'string' || record.optionId === '')) {
    throw invalid('`optionId` must be a non-empty string when present');
  }
  if (
    record.replyText !== undefined &&
    (typeof record.replyText !== 'string' || record.replyText.trim() === '')
  ) {
    throw invalid('`replyText` must be a non-empty string when present');
  }

  const optionId = record.optionId as string | undefined;
  const replyText = record.replyText as string | undefined;
  if ((optionId === undefined) === (replyText === undefined)) {
    throw invalid('exactly one of `optionId` or `replyText` is required');
  }
  if (
    record.confirmationRef !== undefined &&
    (typeof record.confirmationRef !== 'string' || record.confirmationRef.trim() === '')
  ) {
    throw invalid('`confirmationRef` must be a non-empty string when present');
  }

  return {
    cardId: record.cardId,
    revision: record.revision,
    ...(optionId === undefined ? {} : { optionId }),
    ...(replyText === undefined ? {} : { replyText }),
    ...(record.confirmationRef === undefined
      ? {}
      : { confirmationRef: record.confirmationRef }),
  };
}

/** Resolves the executor call a confirmation names, or states why it cannot. */
function resolveAction(card: CockpitCard, request: ParsedConfirmRequest): CockpitCardAction {
  if (request.optionId !== undefined) {
    const option = card.options.find((candidate) => candidate.id === request.optionId);
    if (option === undefined) {
      throw invalid(`card ${card.id} has no option ${request.optionId}`);
    }
    return option.action;
  }

  if (card.ownReply === undefined) {
    throw invalid(`card ${card.id} declares no own-reply executor`);
  }
  return {
    executor: card.ownReply.executor,
    params: { ...card.ownReply.params, reply: request.replyText },
  };
}

/**
 * The card a dismiss body names, and the revision the person was looking at.
 *
 * The same revision guard every confirmation runs: a dismiss for a stale revision is a conflict,
 * never a silent discard of content the person has not seen.
 */
function parseDismissRequest(raw: unknown): { cardId: string; revision: number } {
  if (typeof raw !== 'object' || raw === null || Array.isArray(raw)) {
    throw invalid('the dismiss body must be a JSON object');
  }
  const record = raw as Record<string, unknown>;
  if (typeof record.cardId !== 'string' || record.cardId.trim() === '') {
    throw invalid('`cardId` must be a non-empty string');
  }
  if (
    typeof record.revision !== 'number' ||
    !Number.isInteger(record.revision) ||
    record.revision < 0
  ) {
    throw invalid('`revision` must be a non-negative integer');
  }
  return { cardId: record.cardId, revision: record.revision };
}

/** The `cardId` a resend body names, or an `INVALID_REQUEST`. */
function parseResendRequest(raw: unknown): string {
  if (typeof raw !== 'object' || raw === null || Array.isArray(raw)) {
    throw invalid('the resend body must be a JSON object');
  }
  const cardId = (raw as Record<string, unknown>).cardId;
  if (typeof cardId !== 'string' || cardId.trim() === '') {
    throw invalid('`cardId` must be a non-empty string');
  }
  return cardId;
}

/** One string field of an executor's answer, or undefined. */
function resultText(result: unknown, field: string): string | undefined {
  if (typeof result !== 'object' || result === null) return undefined;
  const value = (result as Record<string, unknown>)[field];
  return typeof value === 'string' && value.trim() !== '' ? value : undefined;
}

/** The action's outcome, as the feedback protocol echoes it. */
function feedbackOutcome(executor: string, result: unknown): CockpitCardFeedbackOutcome {
  const sessionId = resultText(result, 'sessionId');
  const deliveryId = resultText(result, 'deliveryId');
  return {
    executor,
    ok: true,
    ...(sessionId === undefined ? {} : { sessionId }),
    ...(deliveryId === undefined ? {} : { deliveryId }),
  };
}

/** The readable reason a failed feedback call carries to the card. */
function feedbackFailureMessage(failure: unknown): string {
  return failure instanceof Error ? failure.message : String(failure);
}

/**
 * The raw receipt an executor's answer carries, in EITHER shape a provider uses.
 *
 * The fixture provider answers `{ receipt }` at the top level, while the real `CockpitFleetExecutor`
 * returns the whole fleet CLI document and puts it at `result.receipt`. Reading only the top level
 * made every real fleet decision (including a refusal) look like no answer at all.
 */
function receiptFromAnswer(answer: unknown): unknown {
  if (!isRecord(answer)) return undefined;
  if (isRecord(answer.receipt)) return answer.receipt;
  return isRecord(answer.result) ? answer.result.receipt : undefined;
}

/**
 * Reads a receipt from an answer, attributed to the `feedbackId` this call sent.
 *
 * The provider echoes that id, but a refusal arm may omit it (the fleet's rejected receipt does
 * only promise the id it was called with). Falling back to the id we sent keeps the receipt
 * readable instead of discarding the one field that carries the decision.
 */
function readReceiptFromAnswer(answer: unknown, feedbackId: string): CockpitCardReceipt | null {
  const raw = receiptFromAnswer(answer);
  if (!isRecord(raw)) return null;
  const echoed = typeof raw.feedbackId === 'string' && raw.feedbackId !== '' ? raw.feedbackId : feedbackId;
  return readCockpitCardReceipt({ ...raw, feedbackId: echoed });
}

/**
 * Builds the action channel over a registry and the executors the composition
 * root made available. The declared set is read from the REGISTRY (the
 * providers' declarations), so an implementation existing for an undeclared id
 * is still unreachable.
 */
export function createCockpitCardActions(deps: {
  registry: CockpitCardRegistry;
  executors: readonly ICockpitActionExecutor[];
  /** Optional late binding for executors whose declarations arrive after construction. */
  resolveExecutor?: CockpitExecutorResolver;
  /**
   * The feedback lifecycle. Absent means this channel does not deliver feedback at all (a bare
   * criterion over the disposal channel); the module always supplies one.
   */
  feedbackStore?: CockpitCardFeedbackStore;
  /** Clock seam for `sentAt`; defaults to the wall clock. */
  now?: () => Date;
  /** Idempotency-key seam; defaults to `randomUUID`. */
  newFeedbackId?: () => string;
  /**
   * The knowledge suggestion's trusted-confirmation authority. The module always supplies one;
   * a card that IS a knowledge suggestion is refused when this is absent rather than confirmed
   * without its reference check.
   */
  knowledge?: CockpitKnowledgeAuthority;
  /**
   * Drops every provider's read cache so the next `getCard` re-runs the source. Used when a
   * presented revision no longer matches: the caller is answered with the CURRENT revision
   * instead of the stale batch the server still had in hand.
   */
  refreshCards?: () => Promise<void> | void;
}): CockpitCardActions {
  const executors = new Map(deps.executors.map((executor) => [executor.id, executor]));
  const now = deps.now ?? (() => new Date());
  const newFeedbackId = deps.newFeedbackId ?? (() => randomUUID());

  const executorById = async (id: string): Promise<ICockpitActionExecutor | undefined> => {
    const known = executors.get(id);
    if (known !== undefined) return known;
    return (await deps.resolveExecutor?.(id)) ?? undefined;
  };

  /**
   * Delivers one feedback call after an action succeeded, and records the overlay.
   *
   * The call is made with the SAME params a resend would use, under a freshly minted
   * `feedbackId`. A provider that declares no feedback executor still gets an overlay: the
   * action happened, so the display must lock the card and say the feedback cannot be
   * confirmed rather than forget the whole thing.
   */
  const deliverFeedback = async (params: {
    card: CockpitCard;
    optionId: string | null;
    label: string;
    suggested: boolean;
    source: string;
    outcome: CockpitCardFeedbackOutcome;
    text: string | null;
    /**
     * A knowledge decision's verified identity. Its deterministic `feedbackId` replaces the
     * freshly minted one so a retry of the SAME decision carries the same idempotency key, and
     * its `feedback` fields (case, revisions, decision, plan, reference) join the call verbatim.
     */
    knowledge?: CockpitKnowledgeConfirmation;
  }): Promise<CockpitCardReceipt | null> => {
    const store = deps.feedbackStore;
    const feedbackId = params.knowledge?.feedbackId ?? newFeedbackId();
    const feedbackExecutor = deps.registry.feedbackExecutor(params.card.provider);
    const feedbackParams: Record<string, unknown> = {
      attentionId: params.card.id,
      revision: params.card.revision,
      feedbackId,
      ...(params.optionId === null
        ? { ownReply: true, text: params.text ?? '' }
        : { optionId: params.optionId }),
      suggested: params.suggested,
      source: params.source,
      outcome: params.outcome,
      ...(params.knowledge === undefined ? {} : params.knowledge.feedback),
    };
    const stored: StoredCockpitCardFeedback = {
      cardId: params.card.id,
      provider: params.card.provider,
      revision: params.card.revision,
      ...(params.card.contentRevision === undefined
        ? {}
        : { contentRevision: params.card.contentRevision }),
      ...(params.knowledge === undefined
        ? {}
        : {
            confirmationRef: params.knowledge.ref,
            decision: params.knowledge.decision,
            knowledgeCaseId: params.knowledge.caseId,
          }),
      feedbackId,
      optionId: params.optionId,
      label: params.label,
      sentAt: now().toISOString(),
      outcome: params.outcome,
      feedbackExecutor,
      ...(feedbackExecutor === null ? { resendUnavailableReason: NO_FEEDBACK_EXECUTOR_REASON } : {}),
      params: feedbackParams,
    };
    store?.saveOverlay(stored);
    if (feedbackExecutor === null) return null;

    const implementation = await executorById(feedbackExecutor);
    if (implementation === undefined) {
      // A provider that declares a feedback executor but has no implementation is a failure the
      // person can act on (a wiring bug) — record it rather than showing an endless wait.
      store?.markFeedbackError(
        params.card.id,
        `feedback executor ${feedbackExecutor} has no implementation`,
      );
      return null;
    }
    try {
      const answer = await implementation.execute(feedbackParams);
      const receipt = readReceiptFromAnswer(answer, feedbackId);
      if (receipt !== null && store !== undefined) {
        // A `closed` receipt keeps the overlay while the item is still listed; kept/rejected
        // return the card to the person, so the overlay leaves and the notice stays. A
        // `dismissed` receipt settles the card without a notice.
        if (receipt.disposition !== 'closed') store.removeOverlay(params.card.id);
        if (receipt.disposition === 'kept' || receipt.disposition === 'rejected') {
          store.recordNotice({
            cardId: params.card.id,
            feedbackId: receipt.feedbackId,
            kind: receipt.disposition,
            ...(receipt.reason === undefined ? {} : { reason: receipt.reason }),
          });
        }
        // Reaching the provider with a receipt proves the earlier failure is over.
        store.clearFeedbackError(params.card.id);
      }
      return receipt;
    } catch (failure) {
      // The action succeeded; a feedback failure is not an action failure. The overlay stays, so
      // the display reads 「已发出 · 等 fleet 确认」 and its resend is available after the timeout.
      // The reason is recorded so the card can distinguish 「fleet unreachable」 from 「fleet slow」.
      store?.markFeedbackError(params.card.id, feedbackFailureMessage(failure));
      return null;
    }
  };
  // `(provider, card id, revision)`: one accepted confirmation per revision.
  // A provider bumps the revision when a confirmation changes the card, which is
  // what lets the same person confirm a LATER revision (re-saving their reply).
  const accepted = new Set<string>();

  const confirm = async (raw: unknown): Promise<CockpitCardConfirmResult> => {
    const request = parseConfirmRequest(raw);

    const card = await deps.registry.getCard(request.cardId);
    if (card === null) {
      throw new AppError(`no open card ${request.cardId}`, {
        code: 'CARD_NOT_FOUND',
        statusCode: 404,
      });
    }
    if (request.revision !== card.revision) {
      // A stale presentation is answered with the provider's CURRENT revision: re-fetch first,
      // then report the revision the person must look at before confirming.
      await deps.refreshCards?.();
      const current = await deps.registry.getCard(request.cardId);
      const currentRevision = current?.revision ?? card.revision;
      throw new AppError(
        `card ${card.id} is at revision ${currentRevision}, not ${request.revision}`,
        {
          code: 'REVISION_CONFLICT',
          statusCode: 409,
          details: { currentRevision },
        },
      );
    }

    const action = resolveAction(card, request);

    // A knowledge decision is confirmed through the server-issued reference, never through a
    // caller-stated identity. The authority verifies the signature and that the binding still
    // describes THIS card; a valid-but-old reference re-fetches once and then reports the move.
    let knowledge: CockpitKnowledgeConfirmation | undefined;
    if (isKnowledgeCard(card)) {
      if (deps.knowledge === undefined) {
        throw new AppError('knowledge confirmations are not wired on this server', {
          code: 'KNOWLEDGE_UNAVAILABLE',
          statusCode: 500,
        });
      }
      const option =
        request.optionId === undefined
          ? null
          : card.options.find((candidate) => candidate.id === request.optionId) ?? null;
      try {
        knowledge = deps.knowledge.confirm({
          card,
          option,
          ...(request.confirmationRef === undefined
            ? {}
            : { confirmationRef: request.confirmationRef }),
        });
      } catch (failure) {
        if (failure instanceof AppError && failure.code === 'STALE_CONFIRMATION') {
          await deps.refreshCards?.();
          const current = await deps.registry.getCard(card.id);
          if (current !== null && current.revision !== card.revision) {
            throw new AppError(
              `card ${card.id} is at revision ${current.revision}, not ${request.revision}`,
              {
                code: 'REVISION_CONFLICT',
                statusCode: 409,
                details: { currentRevision: current.revision, reason: 'stale-confirmation' },
              },
            );
          }
        }
        throw failure;
      }
    }

    if (!deps.registry.declaredExecutors().has(action.executor)) {
      throw new AppError(
        `executor ${action.executor} is not declared by any card provider`,
        { code: 'EXECUTOR_NOT_DECLARED', statusCode: 400 },
      );
    }
    let executor = executors.get(action.executor);
    if (executor === undefined && deps.resolveExecutor !== undefined) {
      // The declared check above already passed, so a late binding may only name THIS id; one
      // that still has no implementation is the same unavailable failure as before.
      executor = (await deps.resolveExecutor(action.executor)) ?? undefined;
    }
    if (executor === undefined) {
      throw new AppError(`declared executor ${action.executor} has no implementation`, {
        code: 'EXECUTOR_UNAVAILABLE',
        statusCode: 500,
      });
    }

    const key = `${card.provider}\u0000${card.id}\u0000${card.revision}`;
    if (accepted.has(key)) {
      throw new AppError(`card ${card.id} revision ${card.revision} was already confirmed`, {
        code: 'ALREADY_CONFIRMED',
        statusCode: 409,
      });
    }

    accepted.add(key);
    let result: unknown;
    try {
      result = await executor.execute(action.params);
    } catch (failure) {
      // The action did not happen, so the revision stays confirmable.
      accepted.delete(key);
      // An executor's OWN refusal is the most specific answer available: `session.send` throws
      // an AppError carrying the control service's code (SESSION_NOT_FOUND, RUN_IN_PROGRESS,
      // FORBIDDEN…), and re-wrapping it would hide the reason from the person. Any other throw
      // is an implementation failure, which this channel names as such.
      if (failure instanceof AppError) throw failure;
      throw new AppError(
        `executor ${action.executor} failed: ${failure instanceof Error ? failure.message : String(failure)}`,
        { code: 'EXECUTOR_FAILED', statusCode: 500 },
      );
    }

    // The action happened. Deliver the feedback that asks the provider to acknowledge it; this
    // is a SECOND call, never a repeat of the action, and its failure does not undo the action.
    if (deps.feedbackStore !== undefined) {
      const option =
        request.optionId === undefined
          ? undefined
          : card.options.find((candidate) => candidate.id === request.optionId);
      await deliverFeedback({
        card,
        optionId: request.optionId ?? null,
        label: option?.label ?? request.replyText ?? '',
        suggested: option?.suggested === true,
        source: option?.source ?? 'own-reply',
        outcome: feedbackOutcome(action.executor, result),
        text: request.replyText ?? null,
        ...(knowledge === undefined ? {} : { knowledge }),
      });
    }

    return {
      ok: true,
      cardId: card.id,
      executor: action.executor,
      params: action.params,
      result,
    };
  };

  /**
   * Discards one card WITHOUT running its action.
   *
   * The provider's feedback executor is the only call: its params carry a top-level
   * `dismiss: true`, which tells the fleet to close the item as discarded rather than to accept
   * a choice. Nothing is stored as an overlay — there is no action to acknowledge — and a
   * `dismissed` receipt settles the card without recording a kept/rejected notice.
   *
   * The same `(provider, card, revision)` ledger the confirmation path uses is consulted, so a
   * dismiss and a confirmation of the same revision can never both be accepted.
   */
  const dismiss = async (raw: unknown): Promise<CockpitCardDismissResult> => {
    const request = parseDismissRequest(raw);
    const card = await deps.registry.getCard(request.cardId);
    if (card === null) {
      throw new AppError(`no open card ${request.cardId}`, {
        code: 'CARD_NOT_FOUND',
        statusCode: 404,
      });
    }
    if (request.revision !== card.revision) {
      await deps.refreshCards?.();
      const current = await deps.registry.getCard(request.cardId);
      const currentRevision = current?.revision ?? card.revision;
      throw new AppError(
        `card ${card.id} is at revision ${currentRevision}, not ${request.revision}`,
        { code: 'REVISION_CONFLICT', statusCode: 409, details: { currentRevision } },
      );
    }
    const feedbackExecutor = deps.registry.feedbackExecutor(card.provider);
    if (feedbackExecutor === null) {
      throw new AppError(NO_FEEDBACK_EXECUTOR_REASON, {
        code: 'FEEDBACK_UNAVAILABLE',
        statusCode: 400,
      });
    }
    const implementation = await executorById(feedbackExecutor);
    if (implementation === undefined) {
      throw new AppError(`feedback executor ${feedbackExecutor} has no implementation`, {
        code: 'EXECUTOR_UNAVAILABLE',
        statusCode: 500,
      });
    }
    const key = `${card.provider}\u0000${card.id}\u0000${card.revision}`;
    if (accepted.has(key)) {
      throw new AppError(`card ${card.id} revision ${card.revision} was already confirmed`, {
        code: 'ALREADY_CONFIRMED',
        statusCode: 409,
      });
    }

    const feedbackId = newFeedbackId();
    const params: Record<string, unknown> = {
      attentionId: card.id,
      revision: card.revision,
      feedbackId,
      dismiss: true,
    };
    accepted.add(key);
    let result: unknown;
    try {
      result = await implementation.execute(params);
    } catch (failure) {
      // The dismiss did not happen, so the revision stays dismissable.
      accepted.delete(key);
      if (failure instanceof AppError) throw failure;
      throw new AppError(
        `feedback executor ${feedbackExecutor} failed: ${feedbackFailureMessage(failure)}`,
        { code: 'EXECUTOR_FAILED', statusCode: 500 },
      );
    }

    const receipt = readReceiptFromAnswer(result, feedbackId);
    const store = deps.feedbackStore;
    if (receipt !== null && receipt.disposition === 'rejected') {
      // The provider refused the dismissal (the fleet says `stale-revision` when its item moved on):
      // nothing was written, so this is a FAILED dismiss, never the `ok: true` the exit code alone
      // suggests. Release the accepted key BEFORE throwing — the dismissal did not happen, and a
      // retry must reach the provider again rather than be turned away as ALREADY_CONFIRMED.
      accepted.delete(key);
      store?.recordNotice({
        cardId: card.id,
        feedbackId: receipt.feedbackId,
        kind: 'rejected',
        ...(receipt.reason === undefined ? {} : { reason: receipt.reason }),
      });
      const reason = receipt.reason ?? 'rejected';
      throw new AppError(`fleet refused the dismissal: ${reason}`, {
        code: 'DISMISS_REJECTED',
        statusCode: 409,
      });
    }
    if (receipt !== null && receipt.disposition !== 'closed') {
      // A dismissed card settles without a notice; a kept answer still returns the card with its
      // reason, exactly as it does for a confirmation's feedback.
      store?.removeOverlay(card.id);
      if (receipt.disposition === 'kept') {
        store?.recordNotice({
          cardId: card.id,
          feedbackId: receipt.feedbackId,
          kind: receipt.disposition,
          ...(receipt.reason === undefined ? {} : { reason: receipt.reason }),
        });
      }
    }

    return { ok: true, cardId: card.id, executor: feedbackExecutor, params, result };
  };

  /**
   * Resends only the feedback: the stored `params` (same `feedbackId`) go to the feedback
   * executor again. The action executor and the accepted-confirmation ledger are never touched,
   * so a resend can never run the action twice.
   */
  const resendFeedback = async (raw: unknown): Promise<CockpitCardResendResult> => {
    const cardId = parseResendRequest(raw);
    const store = deps.feedbackStore;
    const stored = store?.overlay(cardId) ?? null;
    if (stored === null) {
      throw new AppError(`no feedback is waiting for card ${cardId}`, {
        code: 'NO_FEEDBACK_TO_RESEND',
        statusCode: 404,
      });
    }
    const unavailable = (reason: string): AppError =>
      new AppError(reason, { code: 'FEEDBACK_UNAVAILABLE', statusCode: 400 });
    if (stored.feedbackExecutor === null) {
      throw unavailable(stored.resendUnavailableReason ?? NO_FEEDBACK_EXECUTOR_REASON);
    }
    if (!deps.registry.declaredExecutors().has(stored.feedbackExecutor)) {
      throw unavailable(FEEDBACK_EXECUTOR_GONE_REASON);
    }
    const implementation = await executorById(stored.feedbackExecutor);
    if (implementation === undefined) {
      throw unavailable(`feedback executor ${stored.feedbackExecutor} has no implementation`);
    }

    let result: unknown;
    try {
      result = await implementation.execute(stored.params);
    } catch (failure) {
      // The resend is still waiting for a receipt; record why THIS attempt failed so the card
      // does not fall back to claiming the fleet is merely slow.
      store?.markFeedbackError(cardId, feedbackFailureMessage(failure));
      if (failure instanceof AppError) throw failure;
      throw new AppError(
        `feedback executor ${stored.feedbackExecutor} failed: ${feedbackFailureMessage(failure)}`,
        { code: 'EXECUTOR_FAILED', statusCode: 500 },
      );
    }
    // The resend is a new attempt for the same feedback: the 2-minute window restarts, the id
    // does not change.
    store?.markResent(cardId, now().toISOString());
    const receipt = readReceiptFromAnswer(result, stored.feedbackId);
    if (receipt !== null && receipt.disposition !== 'closed') {
      store?.removeOverlay(cardId);
      if (receipt.disposition === 'kept' || receipt.disposition === 'rejected') {
        store?.recordNotice({
          cardId,
          feedbackId: receipt.feedbackId,
          kind: receipt.disposition,
          ...(receipt.reason === undefined ? {} : { reason: receipt.reason }),
        });
      }
    }

    return {
      ok: true,
      cardId,
      feedbackId: stored.feedbackId,
      executor: stored.feedbackExecutor,
      result,
    };
  };

  return { confirm, dismiss, resendFeedback };
}

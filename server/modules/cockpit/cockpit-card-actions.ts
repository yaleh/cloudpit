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
import { AppError } from '@/shared/utils.js';
import type { ICockpitActionExecutor } from '@/shared/interfaces.js';
import type { CockpitCard, CockpitCardAction } from '@/shared/types.js';

import type { CockpitCardRegistry } from './cockpit-card-registry.js';

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

/** The action channel's public surface. */
export type CockpitCardActions = {
  confirm(request: unknown): Promise<CockpitCardConfirmResult>;
};

type ParsedConfirmRequest = {
  cardId: string;
  revision: number;
  optionId?: string;
  replyText?: string;
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

  if (typeof record.cardId !== 'string' || record.cardId.trim() === '') {
    throw invalid('`cardId` must be a non-empty string');
  }
  if (
    typeof record.revision !== 'number' ||
    !Number.isInteger(record.revision) ||
    record.revision < 1
  ) {
    throw invalid('`revision` must be a positive integer');
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

  return {
    cardId: record.cardId,
    revision: record.revision,
    ...(optionId === undefined ? {} : { optionId }),
    ...(replyText === undefined ? {} : { replyText }),
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
 * Builds the action channel over a registry and the executors the composition
 * root made available. The declared set is read from the REGISTRY (the
 * providers' declarations), so an implementation existing for an undeclared id
 * is still unreachable.
 */
export function createCockpitCardActions(deps: {
  registry: CockpitCardRegistry;
  executors: readonly ICockpitActionExecutor[];
}): CockpitCardActions {
  const executors = new Map(deps.executors.map((executor) => [executor.id, executor]));
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
      throw new AppError(
        `card ${card.id} is at revision ${card.revision}, not ${request.revision}`,
        { code: 'REVISION_CONFLICT', statusCode: 409 },
      );
    }

    const action = resolveAction(card, request);
    if (!deps.registry.declaredExecutors().has(action.executor)) {
      throw new AppError(
        `executor ${action.executor} is not declared by any card provider`,
        { code: 'EXECUTOR_NOT_DECLARED', statusCode: 400 },
      );
    }
    const executor = executors.get(action.executor);
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

    return {
      ok: true,
      cardId: card.id,
      executor: action.executor,
      params: action.params,
      result,
    };
  };

  return { confirm };
}

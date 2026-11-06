/**
 * The cockpit's card registry: the ONE place cards from every provider are merged
 * into the list the cockpit shows.
 *
 * WHY IT IS THIS SMALL. The cockpit does not judge cards. Which cards exist, what
 * they say, when they end and in what order they belong are all the provider's
 * statements; the registry's only jobs are:
 *
 *   1. ask every registered provider for its cards;
 *   2. keep the cards whose provider-set `state` is `open` — no cockpit-local
 *      hiding rule (by kind, by project, by anything) may live here;
 *   3. order what is left by the provider's own `group`, then `rank`, keeping the
 *      provider's relative order for ties — no clock, no per-kind table, no
 *      "rescue first" special case;
 *   4. pass every provider-declared field through verbatim, `revision` included;
 *   5. where a provider declared no `ownReply`, fill the CONTENT DEFAULT from the
 *      card's own subject: a session gets `session.send` writing back into it, a
 *      project gets `session.start` opening a new conversation in it, and a card
 *      with neither carries `ownReplyUnavailable` with the readable reason. This
 *      is a default for a field the provider left empty, not a judgement about
 *      the card: a provider that states `ownReply` always wins;
 *   6. where a provider declared no `conversation` while its subject names a
 *      session, fill `conversation = { sessionId }` (the same content-default
 *      principle); a provider that states `conversation` always wins;
 *   7. mark each option whose executor no provider declared as `confirmable: false`
 *      with a readable reason. The option stays readable and selectable; only its
 *      confirmation is refused, matching the action channel's own guard.
 *
 * The action channel reads the same projection (`getCard`), so a confirmation can
 * only act on a card the registry currently shows, and the provider's declared
 * executor set is the union of its providers' declarations plus the two built-in
 * content-default executors (they are Cloudpit's own, not any provider's).
 *
 * A new provider is one implementation plus one `register` (or one element in the
 * constructor array); no call site in the cockpit changes.
 */
import type { ICockpitCardProvider } from '@/shared/interfaces.js';
import type { CockpitCard } from '@/shared/types.js';

import {
  COCKPIT_SESSION_SEND_EXECUTOR_ID,
} from './cockpit-session-send.executor.js';
import {
  COCKPIT_SESSION_START_EXECUTOR_ID,
} from './cockpit-session-start.executor.js';

/**
 * One provider's own account of its last card read.
 *
 * A provider that needs no outside world (a fixture) has nothing to explain and implements no
 * diagnostics; an adapter over a child process does. The route reports these beside the cards
 * so an empty list is distinguishable from a failed or switched-off read. This type lives here
 * rather than in `shared/types.ts` because it is server-side operator information, not part of
 * the card wire contract the browser renders.
 */
export type CockpitCardProviderDiagnostic = {
  readonly provider: string;
  /** Whether the provider's last read produced cards without an error. */
  readonly ok: boolean;
  /** Why the read could not produce cards (or why the provider is off), when that is known. */
  readonly reason: string | null;
  /** How many cards the last read produced. */
  readonly cards: number;
  /** How many malformed lines the last read skipped. */
  readonly skippedLines: number;
  /** Whether this reading was served from the provider's cache. */
  readonly cached: boolean;
  /**
   * Whether the provider salvaged the batch from a stdout that was CUT at the read bound.
   *
   * Present only on a salvaged reading. The cards are real, but the list is known-incomplete:
   * the last line was an unfinished fragment and every byte after it never arrived.
   */
  readonly truncated?: boolean;
  /** How many COMPLETE lines the salvaged prefix held (the fragment is not one of them). */
  readonly completeLines?: number;
  /** Bytes of the cut-off final fragment that could not be parsed; never counted as skipped. */
  readonly truncatedTailBytes?: number;
};

/**
 * A provider that can explain its last read. The capability is optional so a provider with no
 * outside world (the fixture) can ignore it, and the registry discovers it structurally.
 */
export type ICockpitCardProviderWithDiagnostics = ICockpitCardProvider & {
  diagnostics(): readonly CockpitCardProviderDiagnostic[];
};

/**
 * A provider that also answers the feedback protocol. Structural like `diagnostics`: a provider
 * that has no feedback executor (the fixture before this protocol, a static test provider) does
 * not grow a method it cannot honour.
 */
export type ICockpitCardProviderWithFeedback = ICockpitCardProvider & {
  feedbackExecutor(): string | null;
};

/** The registry's public surface. */
export type CockpitCardRegistry = {
  /** Adds a provider; registering the same object twice is a no-op. */
  register(provider: ICockpitCardProvider): void;
  /** Every open card, ordered by provider group then rank. */
  listCards(): Promise<CockpitCard[]>;
  /** The union of every registered provider's declared executor ids. */
  declaredExecutors(): ReadonlySet<string>;
  /**
   * The feedback executor a card's provider declares, or `null` when it declares none.
   *
   * This is a provider capability, not a card field: which id answers the feedback protocol is
   * the same declaration set the disposal executors come from, and the registry is where a
   * provider's statements are read. The action channel uses it only for the card's OWN provider,
   * so one provider's feedback executor can never be called for another's card.
   */
  feedbackExecutor(providerId: string): string | null;
  /** One currently open card, or null. Used by the action channel. */
  getCard(cardId: string): Promise<CockpitCard | null>;
  /** Reports changes any provider pushes. The returned function stops the subscription. */
  subscribe(listener: () => void): () => void;
  /** Every registered provider's own last-read account, in registration order. */
  diagnostics(): readonly CockpitCardProviderDiagnostic[];
};

/** Whether a provider opted into explaining its reads. */
function hasDiagnostics(
  provider: ICockpitCardProvider,
): provider is ICockpitCardProviderWithDiagnostics {
  return typeof (provider as Partial<ICockpitCardProviderWithDiagnostics>).diagnostics === 'function';
}

/** Whether a provider opted into answering the feedback protocol. */
function hasFeedbackExecutor(
  provider: ICockpitCardProvider,
): provider is ICockpitCardProviderWithFeedback {
  return (
    typeof (provider as Partial<ICockpitCardProviderWithFeedback>).feedbackExecutor === 'function'
  );
}

/**
 * The provider order is the fallback for two cards with the same group AND rank:
 * `Array.prototype.sort` is stable, and `Promise.all` preserves the provider
 * order, so ties keep registration order rather than an invented tiebreaker.
 */
function compareByProviderOrder(a: CockpitCard, b: CockpitCard): number {
  if (a.group !== b.group) return a.group < b.group ? -1 : 1;
  return a.rank - b.rank;
}

/** The reason a card with no session and no project gets no own-reply path. */
export const OWN_REPLY_UNAVAILABLE_REASON =
  'card subject names neither a session nor a project, so there is no conversation to reply into';

/**
 * The content default for a card whose provider declared no `ownReply`.
 *
 * The subject decides, because the subject is what the card is about: a card that
 * names a session is answered IN that session; a card that names only a project is
 * answered by opening a NEW conversation in that project (the person's reply is its
 * first message); a card that names neither cannot be answered from here and says so.
 *
 * The returned params carry only the addressing field. The reply text is joined by
 * the action channel under `reply` at confirmation time — the channel, not this
 * projection, is the one place that knows the typed text.
 */
function applyOwnReplyDefault(card: CockpitCard): CockpitCard {
  if (card.ownReply !== undefined) return card;

  const sessionId = card.subject.sessionId?.trim() ?? '';
  if (sessionId !== '') {
    return {
      ...card,
      ownReply: {
        executor: COCKPIT_SESSION_SEND_EXECUTOR_ID,
        params: { sessionId },
      },
    };
  }

  const project = card.subject.project?.trim() ?? '';
  if (project !== '') {
    return {
      ...card,
      ownReply: {
        executor: COCKPIT_SESSION_START_EXECUTOR_ID,
        params: { project },
      },
    };
  }

  return { ...card, ownReplyUnavailable: OWN_REPLY_UNAVAILABLE_REASON };
}

/**
 * The content default for a card whose provider declared no `conversation`.
 *
 * The subject names the conversation; the card's own `conversation` field is what the Details
 * drawer links to. A card whose subject names a session therefore gets `{ sessionId }`, and a
 * provider that states `conversation` itself always wins — this is a default for an empty field,
 * not a reinterpretation of the provider's answer.
 */
function applyConversationDefault(card: CockpitCard): CockpitCard {
  if (card.conversation !== undefined) return card;
  const sessionId = card.subject.sessionId?.trim() ?? '';
  if (sessionId === '') return card;
  return { ...card, conversation: { sessionId } };
}

/** The reason an option is not confirmable: its executor is not declared by any provider. */
export function undeclaredExecutorReason(executor: string): string {
  return `执行器 ${executor} 尚未接入`;
}

/**
 * Marks every option whose executor no provider declared as unconfirmable.
 *
 * The action channel refuses such an option (`EXECUTOR_NOT_DECLARED`); stating that up front is
 * what lets the UI disable the confirm bar and explain why, instead of letting the person press a
 * button that is guaranteed to fail. The option itself stays readable and selectable.
 */
function applyOptionConfirmability(
  card: CockpitCard,
  declared: ReadonlySet<string>,
): CockpitCard {
  if (card.options.every((option) => declared.has(option.action.executor))) return card;
  return {
    ...card,
    options: card.options.map((option) =>
      declared.has(option.action.executor)
        ? option
        : {
            ...option,
            confirmable: false,
            confirmableReason: undeclaredExecutorReason(option.action.executor),
          },
    ),
  };
}

/** Builds a registry over the providers already known (more may be registered later). */
export function createCockpitCardRegistry(
  providers: readonly ICockpitCardProvider[] = [],
): CockpitCardRegistry {
  const registered: ICockpitCardProvider[] = [];
  const listeners = new Set<() => void>();

  const changed = (): void => {
    for (const listener of listeners) listener();
  };

  const register = (provider: ICockpitCardProvider): void => {
    if (registered.includes(provider)) return;
    registered.push(provider);
    provider.subscribe?.(changed);
    changed();
  };

  for (const provider of providers) register(provider);

  const declaredExecutors = (): ReadonlySet<string> => {
    // The two built-in executors are Cloudpit's own content defaults; no provider
    // declares them, yet every card whose subject names a session/project reaches
    // them, so the declared set must include them or the action channel would
    // refuse the very defaults this projection fills in.
    const ids = new Set<string>([
      COCKPIT_SESSION_SEND_EXECUTOR_ID,
      COCKPIT_SESSION_START_EXECUTOR_ID,
    ]);
    for (const provider of registered) {
      for (const id of provider.declaredExecutors()) ids.add(id);
    }
    return ids;
  };

  const feedbackExecutor = (providerId: string): string | null => {
    for (const provider of registered) {
      if (provider.id !== providerId || !hasFeedbackExecutor(provider)) continue;
      const id = provider.feedbackExecutor();
      return id === null || id.trim() === '' ? null : id;
    }
    return null;
  };

  const listCards = async (): Promise<CockpitCard[]> => {
    const perProvider = await Promise.all(
      registered.map(async (provider) => {
        const cards = await provider.listCards();
        // The ONE visibility rule: the provider's own state. Nothing about a
        // card's kind, project, age or content hides it here.
        return cards.filter((card) => card.state === 'open');
      }),
    );
    const declared = declaredExecutors();
    return perProvider
      .flat()
      .sort(compareByProviderOrder)
      .map(applyOwnReplyDefault)
      .map(applyConversationDefault)
      .map((card) => applyOptionConfirmability(card, declared));
  };

  const getCard = async (cardId: string): Promise<CockpitCard | null> =>
    (await listCards()).find((card) => card.id === cardId) ?? null;

  const subscribe = (listener: () => void): (() => void) => {
    listeners.add(listener);
    return () => {
      listeners.delete(listener);
    };
  };

  const diagnostics = (): readonly CockpitCardProviderDiagnostic[] => {
    const rows: CockpitCardProviderDiagnostic[] = [];
    for (const provider of registered) {
      if (!hasDiagnostics(provider)) continue;
      rows.push(...provider.diagnostics());
    }
    return rows;
  };

  return {
    register,
    listCards,
    declaredExecutors,
    feedbackExecutor,
    getCard,
    subscribe,
    diagnostics,
  };
}

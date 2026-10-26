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
 *   4. pass every field through verbatim, `revision` included.
 *
 * The action channel reads the same projection (`getCard`), so a confirmation can
 * only act on a card the registry currently shows, and the provider's declared
 * executor set is the union of its providers' declarations.
 *
 * A new provider is one implementation plus one `register` (or one element in the
 * constructor array); no call site in the cockpit changes.
 */
import type { ICockpitCardProvider } from '@/shared/interfaces.js';
import type { CockpitCard } from '@/shared/types.js';

/** The registry's public surface. */
export type CockpitCardRegistry = {
  /** Adds a provider; registering the same object twice is a no-op. */
  register(provider: ICockpitCardProvider): void;
  /** Every open card, ordered by provider group then rank. */
  listCards(): Promise<CockpitCard[]>;
  /** The union of every registered provider's declared executor ids. */
  declaredExecutors(): ReadonlySet<string>;
  /** One currently open card, or null. Used by the action channel. */
  getCard(cardId: string): Promise<CockpitCard | null>;
  /** Reports changes any provider pushes. The returned function stops the subscription. */
  subscribe(listener: () => void): () => void;
};

/**
 * The provider order is the fallback for two cards with the same group AND rank:
 * `Array.prototype.sort` is stable, and `Promise.all` preserves the provider
 * order, so ties keep registration order rather than an invented tiebreaker.
 */
function compareByProviderOrder(a: CockpitCard, b: CockpitCard): number {
  if (a.group !== b.group) return a.group < b.group ? -1 : 1;
  return a.rank - b.rank;
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

  const listCards = async (): Promise<CockpitCard[]> => {
    const perProvider = await Promise.all(
      registered.map(async (provider) => {
        const cards = await provider.listCards();
        // The ONE visibility rule: the provider's own state. Nothing about a
        // card's kind, project, age or content hides it here.
        return cards.filter((card) => card.state === 'open');
      }),
    );
    return perProvider.flat().sort(compareByProviderOrder);
  };

  const getCard = async (cardId: string): Promise<CockpitCard | null> =>
    (await listCards()).find((card) => card.id === cardId) ?? null;

  const declaredExecutors = (): ReadonlySet<string> => {
    const ids = new Set<string>();
    for (const provider of registered) {
      for (const id of provider.declaredExecutors()) ids.add(id);
    }
    return ids;
  };

  const subscribe = (listener: () => void): (() => void) => {
    listeners.add(listener);
    return () => {
      listeners.delete(listener);
    };
  };

  return { register, listCards, declaredExecutors, getCard, subscribe };
}

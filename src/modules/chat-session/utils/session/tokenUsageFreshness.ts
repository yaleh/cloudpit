/**
 * Ordering for token-usage readings that arrive from more than one producer.
 *
 * A session's usage reaches the client through three paths: the history page,
 * the `/token-usage` endpoint, and a live `token_budget` frame. They are
 * requested at different times and can be applied out of order, so a history
 * page fetched before the latest turn can land *after* the realtime frame that
 * already carries that turn. Applying it blindly would rewind the counter.
 *
 * Providers that can place their reading in time stamp it with `observedAt`
 * (the rollout snapshot's own timestamp), which is what makes ordering
 * possible. Readings without one — older providers, older servers — keep the
 * existing last-writer-wins behaviour because nothing can order them.
 *
 * Used by `useSessionStore` and `useChatSessionState` to merge history pages,
 * the `/token-usage` response and realtime frames into one reading.
 */

type TokenUsageReadingLike = Record<string, unknown>;

/**
 * The reading's own timestamp in epoch milliseconds, or `null` when the value
 * is not a reading or carries no parseable `observedAt`.
 */
export function readTokenUsageObservedAt(value: unknown): number | null {
  if (!value || typeof value !== 'object') {
    return null;
  }
  const observedAt = (value as TokenUsageReadingLike).observedAt;
  if (typeof observedAt !== 'string' || observedAt.trim() === '') {
    return null;
  }
  const parsed = Date.parse(observedAt);
  return Number.isFinite(parsed) ? parsed : null;
}

/**
 * True when `incoming` is provably older than `current` and must be dropped.
 *
 * A timestamped incoming reading always beats an untimestamped current one, and
 * an untimestamped incoming reading never displaces a timestamped current one:
 * without a reading of its own it cannot prove it is newer, and keeping the
 * stamped value avoids rewinding on a stale page. Equal timestamps describe the
 * same snapshot, so the newest arrival wins.
 */
export function isStaleTokenUsage(current: unknown, incoming: unknown): boolean {
  const incomingAt = readTokenUsageObservedAt(incoming);
  if (incomingAt === null) {
    return readTokenUsageObservedAt(current) !== null;
  }
  const currentAt = readTokenUsageObservedAt(current);
  return currentAt !== null && incomingAt < currentAt;
}

/**
 * Returns whichever reading should be shown: `current` when `incoming` is
 * absent or provably older, otherwise `incoming`.
 */
export function pickFresherTokenUsage<T>(current: T, incoming: T): T {
  if (incoming === undefined || incoming === null) {
    return current;
  }
  return isStaleTokenUsage(current, incoming) ? current : incoming;
}

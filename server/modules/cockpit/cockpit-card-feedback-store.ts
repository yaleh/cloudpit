/**
 * The cockpit's feedback lifecycle store: the action's pending feedback overlay and the
 * kept/rejected reading that follows a receipt.
 *
 * WHY IT IS SEPARATE FROM THE ACTION CHANNEL. After an action succeeds the server owes the
 * provider a SECOND call (the feedback protocol) and must remember that it is waiting for a
 * receipt. That "sent, not acknowledged" state is neither the provider's card (the provider only
 * answers a receipt) nor the action channel's transport guard. It is a small lifecycle of its
 * own, so it lives in this factory with every piece of mutable state inside its closure: two
 * stores in one process are independent, and a criterion rebuilds one over the same file to
 * prove the overlay survived.
 *
 * WHAT CLEARS AN OVERLAY. Receipts and the card's disappearance, never a revision change:
 *
 *   · the card is absent from the provider's current reading  → the item is settled, clear;
 *   · `card.receipt.feedbackId` matches the overlay's id:
 *       `closed`   → the item is still listed, so the reading stays 「已发出」 (keep);
 *       `kept`     → clear, and record the kept notice;
 *       `rejected` → clear, and record the rejected notice with its reason;
 *   · a receipt for another `feedbackId` changes nothing.
 *
 * The file is CloudCLI's own state, not the provider's: the default path is
 * `~/.cloudcli/cockpit-card-feedback.json`; a criterion passes its own path, and `null` keeps
 * the store in memory (the composition root decides which one a boot gets).
 */
import { mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import path from 'node:path';

import type {
  CockpitCard,
  CockpitCardFeedback,
  CockpitCardFeedbackNotice,
  CockpitCardFeedbackOutcome,
  CockpitCardReceipt,
} from '@/shared/types.js';

/** One overlay as the store persists it: the wire reading plus what a resend needs. */
export type StoredCockpitCardFeedback = {
  cardId: string;
  /** The provider whose feedback executor answered (or was missing) for this card. */
  provider: string;
  revision: number;
  feedbackId: string;
  optionId: string | null;
  label: string;
  sentAt: string;
  outcome: CockpitCardFeedbackOutcome;
  /** The executor id to call again on a resend; `null` means the provider declared none. */
  feedbackExecutor: string | null;
  resendUnavailableReason?: string;
  /** The params of the ORIGINAL feedback call, resent verbatim with the same feedbackId. */
  params: Record<string, unknown>;
};

/** The store's public surface. */
export type CockpitCardFeedbackStore = {
  /**
   * Records one sent feedback call (or, for a provider with no executor, the fact that none can
   * be sent). Replaces any kept/rejected notice for the same card: a new confirmation owns the
   * card again.
   */
  saveOverlay(record: StoredCockpitCardFeedback): void;
  overlay(cardId: string): StoredCockpitCardFeedback | null;
  removeOverlay(cardId: string): void;
  /** Refreshes the attempt's `sentAt` after a resend, keeping the same feedbackId. */
  markResent(cardId: string, sentAt: string): void;
  notice(cardId: string): CockpitCardFeedbackNotice | null;
  recordNotice(notice: CockpitCardFeedbackNotice): void;
  /**
   * Applies this reading: clears overlays whose card vanished or whose matching receipt is
   * kept/rejected, then attaches `feedback`/`feedbackNotice` to what remains. Order is never
   * changed — the returned array is the input array, possibly with fields filled in.
   */
  applyCards(cards: readonly CockpitCard[]): CockpitCard[];
  /** The wire reading of one stored overlay. */
  feedbackOf(record: StoredCockpitCardFeedback): CockpitCardFeedback;
  dispose(): void;
};

/** What the file holds; every field is tolerated as missing on read. */
type PersistedState = {
  overlays?: unknown;
  notices?: unknown;
};

/** Whether a provider's answer names a disposition this lifecycle knows. */
function isDisposition(value: string): value is CockpitCardReceipt['disposition'] {
  return value === 'closed' || value === 'kept' || value === 'rejected';
}

function record(value: unknown): Record<string, unknown> | null {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : null;
}

function text(value: unknown): string {
  return typeof value === 'string' ? value : '';
}

/** One persisted overlay, or `null` when a required field is unreadable. */
function readOverlay(raw: unknown): StoredCockpitCardFeedback | null {
  const entry = record(raw);
  if (entry === null) return null;
  const cardId = text(entry.cardId);
  const provider = text(entry.provider);
  const feedbackId = text(entry.feedbackId);
  const revision = entry.revision;
  const outcome = record(entry.outcome);
  const params = record(entry.params);
  if (
    cardId === '' ||
    provider === '' ||
    feedbackId === '' ||
    typeof revision !== 'number' ||
    outcome === null ||
    params === null
  ) {
    return null;
  }
  const feedbackExecutor = text(entry.feedbackExecutor);
  const resendUnavailableReason = text(entry.resendUnavailableReason);
  return {
    cardId,
    provider,
    revision,
    feedbackId,
    optionId: typeof entry.optionId === 'string' ? entry.optionId : null,
    label: text(entry.label),
    sentAt: text(entry.sentAt),
    outcome: {
      executor: text(outcome.executor),
      ok: outcome.ok === true,
      ...(text(outcome.sessionId) === '' ? {} : { sessionId: text(outcome.sessionId) }),
      ...(text(outcome.deliveryId) === '' ? {} : { deliveryId: text(outcome.deliveryId) }),
    },
    feedbackExecutor: feedbackExecutor === '' ? null : feedbackExecutor,
    ...(resendUnavailableReason === '' ? {} : { resendUnavailableReason }),
    params: { ...params },
  };
}

/** One persisted notice, or `null` when its kind/id is not readable. */
function readNotice(raw: unknown): CockpitCardFeedbackNotice | null {
  const entry = record(raw);
  if (entry === null) return null;
  const cardId = text(entry.cardId);
  const feedbackId = text(entry.feedbackId);
  const kind = text(entry.kind);
  if (cardId === '' || feedbackId === '' || (kind !== 'kept' && kind !== 'rejected')) return null;
  const reason = text(entry.reason);
  return { cardId, feedbackId, kind, ...(reason === '' ? {} : { reason }) };
}

/** Reads a receipt from a feedback executor's answer, tolerating anything else. */
export function readCockpitCardReceipt(value: unknown): CockpitCardReceipt | null {
  const entry = record(value);
  if (entry === null) return null;
  const feedbackId = text(entry.feedbackId);
  const disposition = text(entry.disposition);
  if (feedbackId === '' || !isDisposition(disposition)) return null;
  const reason = text(entry.reason);
  return {
    feedbackId,
    at: text(entry.at),
    disposition,
    ...(reason === '' ? {} : { reason }),
  };
}

/**
 * Builds one store. `filePath === null` keeps it in memory; otherwise a corrupt or missing file
 * is an empty store (never a boot failure), and every mutation rewrites it atomically enough for
 * this single-writer feature.
 */
export function createCockpitCardFeedbackStore(options: {
  filePath?: string | null;
} = {}): CockpitCardFeedbackStore {
  const filePath = options.filePath ?? null;
  const overlays = new Map<string, StoredCockpitCardFeedback>();
  const notices = new Map<string, CockpitCardFeedbackNotice>();

  if (filePath !== null) {
    try {
      const parsed = JSON.parse(readFileSync(filePath, 'utf8')) as PersistedState;
      for (const raw of Array.isArray(parsed.overlays) ? parsed.overlays : []) {
        const overlay = readOverlay(raw);
        if (overlay !== null) overlays.set(overlay.cardId, overlay);
      }
      for (const raw of Array.isArray(parsed.notices) ? parsed.notices : []) {
        const notice = readNotice(raw);
        if (notice !== null) notices.set(notice.cardId, notice);
      }
    } catch {
      // A first boot, a pruned file or a corrupt file all start empty. The next mutation writes.
    }
  }

  const persist = (): void => {
    if (filePath === null) return;
    try {
      mkdirSync(path.dirname(filePath), { recursive: true });
      writeFileSync(
        filePath,
        `${JSON.stringify(
          { overlays: [...overlays.values()], notices: [...notices.values()] },
          null,
          2,
        )}\n`,
        'utf8',
      );
    } catch {
      // Durable memory is a safety net, not a precondition: a read-only home keeps the session
      // working with the in-memory overlay and says nothing to the person about a file.
    }
  };

  const feedbackOf = (stored: StoredCockpitCardFeedback): CockpitCardFeedback => ({
    cardId: stored.cardId,
    revision: stored.revision,
    feedbackId: stored.feedbackId,
    optionId: stored.optionId,
    label: stored.label,
    sentAt: stored.sentAt,
    outcome: { ...stored.outcome },
    canResend: stored.feedbackExecutor !== null,
    ...(stored.resendUnavailableReason === undefined
      ? {}
      : { resendUnavailableReason: stored.resendUnavailableReason }),
  });

  const applyReceipt = (stored: StoredCockpitCardFeedback, receipt: CockpitCardReceipt): void => {
    if (receipt.feedbackId !== stored.feedbackId) return;
    // A `closed` receipt while the item is STILL in the reading means the provider has accepted
    // it but not yet removed it: the display keeps saying 「已发出」 until the card disappears.
    if (receipt.disposition === 'closed') return;
    overlays.delete(stored.cardId);
    notices.set(stored.cardId, {
      cardId: stored.cardId,
      feedbackId: stored.feedbackId,
      kind: receipt.disposition,
      ...(receipt.reason === undefined ? {} : { reason: receipt.reason }),
    });
    persist();
  };

  return {
    saveOverlay: (recordToSave) => {
      overlays.set(recordToSave.cardId, { ...recordToSave, params: { ...recordToSave.params } });
      notices.delete(recordToSave.cardId);
      persist();
    },
    overlay: (cardId) => {
      const found = overlays.get(cardId);
      return found === undefined ? null : { ...found, params: { ...found.params } };
    },
    removeOverlay: (cardId) => {
      if (!overlays.delete(cardId)) return;
      persist();
    },
    markResent: (cardId, sentAt) => {
      const found = overlays.get(cardId);
      if (found === undefined) return;
      found.sentAt = sentAt;
      persist();
    },
    notice: (cardId) => notices.get(cardId) ?? null,
    recordNotice: (notice) => {
      notices.set(notice.cardId, notice);
      persist();
    },
    applyCards: (cards) => {
      const present = new Set(cards.map((card) => card.id));
      let changed = false;
      for (const [cardId, stored] of [...overlays]) {
        const card = cards.find((candidate) => candidate.id === cardId);
        if (card === undefined) {
          overlays.delete(cardId);
          notices.delete(cardId);
          changed = true;
          continue;
        }
        if (card.receipt !== undefined) applyReceipt(stored, card.receipt);
      }
      for (const cardId of [...notices.keys()]) {
        if (!present.has(cardId)) {
          notices.delete(cardId);
          changed = true;
        }
      }
      if (changed) persist();
      return cards.map((card) => {
        const stored = overlays.get(card.id);
        const notice = notices.get(card.id);
        if (stored === undefined && notice === undefined) return card;
        return {
          ...card,
          ...(stored === undefined ? {} : { feedback: feedbackOf(stored) }),
          ...(notice === undefined ? {} : { feedbackNotice: notice }),
        };
      });
    },
    feedbackOf,
    dispose: () => persist(),
  };
}

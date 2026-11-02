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
 *       `closed`    → the item is still listed, so the reading stays 「已发出」 (keep);
 *       `kept`      → clear, and record the kept notice;
 *       `rejected`  → clear, and record the rejected notice with its reason;
 *       `dismissed` → clear and record NO notice: the item was discarded, so it settles like a
 *                     closed item rather than returning to the person's queue;
 *   · a receipt for another `feedbackId` changes nothing.
 *
 * The file is Cloudpit's own state, not the provider's: the default path is
 * `~/.cloudcli/cockpit-card-feedback.json` through 2.x; a criterion passes its own path, and
 * `null` keeps the store in memory (the composition root decides which one a boot gets).
 *
 * 2.1 URI-KEY NORMALIZATION. Every persisted string that still starts with `cloudcli://` — the
 * overlay `params`/`outcome`/card record fields as well as any nested `subject.uri` — is
 * rewritten to `cloudpit://` when the store reads the file, and the rewritten document is
 * written back after copying the pre-normalization file to `<file>.cloudcli-backup`. The rewrite
 * is idempotent (a second store finds nothing to change), it never drops an overlay or notice,
 * and a failed write restores/keeps the original file and reports the reason through
 * {@link CockpitCardFeedbackStore.normalization}. Reads are normalized either way.
 */
import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import path from 'node:path';

import type {
  CockpitCard,
  CockpitCardFeedback,
  CockpitCardFeedbackNotice,
  CockpitCardFeedbackOutcome,
  CockpitCardReceipt,
  CockpitKnowledgeDecision,
} from '@/shared/types.js';

import { readKnowledgeDecision } from './cockpit-knowledge-reading.js';

/** One overlay as the store persists it: the wire reading plus what a resend needs. */
export type StoredCockpitCardFeedback = {
  cardId: string;
  /** The provider whose feedback executor answered (or was missing) for this card. */
  provider: string;
  revision: number;
  /**
   * The content revision the card carried when the action was confirmed. Persisted so a later
   * read can say the summary the choice was made against was replaced, even though the provider's
   * own revision did not move. Absent when the card carried no locally resolved content.
   */
  contentRevision?: number;
  feedbackId: string;
  optionId: string | null;
  label: string;
  sentAt: string;
  outcome: CockpitCardFeedbackOutcome;
  /** The executor id to call again on a resend; `null` means the provider declared none. */
  feedbackExecutor: string | null;
  resendUnavailableReason?: string;
  /**
   * The last feedback call's readable failure reason. Persisted so the card can still say WHY it
   * is waiting after a server restart; a receipt or a successful resend clears it.
   */
  lastError?: string;
  /**
   * The server-issued confirmation reference this action ran under, and the knowledge decision
   * it carried. Persisted with the overlay so the trusted chain is readable back after a reload
   * and a restart; absent for an ordinary (non-knowledge) card.
   */
  confirmationRef?: string;
  decision?: CockpitKnowledgeDecision;
  knowledgeCaseId?: string;
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
  /**
   * Records why the last feedback call failed. The overlay stays (the action already ran); the
   * card reads the reason instead of pretending the fleet is merely slow.
   */
  markFeedbackError(cardId: string, message: string): void;
  /** Clears a recorded failure after a receipt or a successful resend. */
  clearFeedbackError(cardId: string): void;
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
  /** The 2.1 URI-key normalization reading for this store's file (see the module header). */
  normalization(): CockpitCardFeedbackNormalization;
  dispose(): void;
};

/** What the file holds; every field is tolerated as missing on read. */
type PersistedState = {
  overlays?: unknown;
  notices?: unknown;
};

/**
 * What the 2.1 URI-key normalization did when this store read its file. `changed` is true only
 * in the store whose construction rewrote at least one `cloudcli://` string; `backupPath` names
 * the pre-normalization copy; `error` is set when the rewrite could not be persisted, in which
 * case the original file is kept on disk (and reads are still normalized in memory).
 */
export type CockpitCardFeedbackNormalization = {
  changed: boolean;
  backupPath: string | null;
  error: string | null;
};

/** Whether a provider's answer names a disposition this lifecycle knows. */
function isDisposition(value: string): value is CockpitCardReceipt['disposition'] {
  return (
    value === 'closed' || value === 'kept' || value === 'rejected' || value === 'dismissed'
  );
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
  const lastError = text(entry.lastError);
  const confirmationRef = text(entry.confirmationRef);
  const knowledgeCaseId = text(entry.knowledgeCaseId);
  const decision = readKnowledgeDecision(entry.decision);
  return {
    cardId,
    provider,
    revision,
    ...(typeof entry.contentRevision === 'number' && Number.isFinite(entry.contentRevision)
      ? { contentRevision: entry.contentRevision }
      : {}),
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
    ...(lastError === '' ? {} : { lastError }),
    ...(confirmationRef === '' ? {} : { confirmationRef }),
    ...(decision === null ? {} : { decision }),
    ...(knowledgeCaseId === '' ? {} : { knowledgeCaseId }),
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
 * Rewrites every persisted string VALUE that starts with `cloudcli://` to `cloudpit://`, walking
 * arrays and nested records (an overlay's `params`, a card record's `subject.uri`, …). Object
 * keys are left alone: an address is data here, never a lookup key. Returns the input unchanged
 * when there was nothing to rewrite, so a second read is a no-op.
 */
function normalizeUriStrings(value: unknown): { value: unknown; changed: boolean } {
  if (typeof value === 'string') {
    return value.startsWith('cloudcli://')
      ? { value: `cloudpit://${value.slice('cloudcli://'.length)}`, changed: true }
      : { value, changed: false };
  }
  if (Array.isArray(value)) {
    let changed = false;
    const items = value.map((item) => {
      const result = normalizeUriStrings(item);
      changed = changed || result.changed;
      return result.value;
    });
    return { value: changed ? items : value, changed };
  }
  const entry = record(value);
  if (entry === null) return { value, changed: false };
  let changed = false;
  const next: Record<string, unknown> = {};
  for (const [key, item] of Object.entries(entry)) {
    const result = normalizeUriStrings(item);
    changed = changed || result.changed;
    next[key] = result.value;
  }
  return { value: changed ? next : value, changed };
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
  let normalization: CockpitCardFeedbackNormalization = {
    changed: false,
    backupPath: null,
    error: null,
  };

  if (filePath !== null) {
    try {
      const raw = readFileSync(filePath, 'utf8');
      const parsed = JSON.parse(raw) as unknown;
      const normalized = normalizeUriStrings(parsed);
      // Reads are normalized even when the rewrite cannot be persisted: the legacy spelling is
      // an accepted input, not the object's current address.
      const state: PersistedState = record(normalized.value) ?? {};
      const existingBackup = `${filePath}.cloudcli-backup`;
      if (normalized.changed) {
        try {
          mkdirSync(path.dirname(filePath), { recursive: true });
          // Keep the FIRST pre-normalization copy: a later run must not overwrite the pristine
          // ledger with an already-normalized file.
          if (!existsSync(existingBackup)) writeFileSync(existingBackup, raw, 'utf8');
          writeFileSync(filePath, `${JSON.stringify(state, null, 2)}\n`, 'utf8');
          normalization = { changed: true, backupPath: existingBackup, error: null };
        } catch (error) {
          // The original file wins: a failed rewrite leaves it byte-identical and reports why.
          try {
            writeFileSync(filePath, raw, 'utf8');
          } catch {
            // A read-only home keeps the in-memory (normalized) reading; the report says so.
          }
          normalization = {
            changed: false,
            backupPath: existsSync(existingBackup) ? existingBackup : null,
            error: error instanceof Error ? error.message : 'the URI-key normalization write failed',
          };
        }
      } else {
        normalization = {
          changed: false,
          backupPath: existsSync(existingBackup) ? existingBackup : null,
          error: null,
        };
      }
      for (const rawOverlay of Array.isArray(state.overlays) ? state.overlays : []) {
        const overlay = readOverlay(rawOverlay);
        if (overlay !== null) overlays.set(overlay.cardId, overlay);
      }
      for (const rawNotice of Array.isArray(state.notices) ? state.notices : []) {
        const notice = readNotice(rawNotice);
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
    ...(stored.contentRevision === undefined ? {} : { contentRevision: stored.contentRevision }),
    feedbackId: stored.feedbackId,
    optionId: stored.optionId,
    label: stored.label,
    sentAt: stored.sentAt,
    outcome: { ...stored.outcome },
    canResend: stored.feedbackExecutor !== null,
    ...(stored.resendUnavailableReason === undefined
      ? {}
      : { resendUnavailableReason: stored.resendUnavailableReason }),
    ...(stored.lastError === undefined ? {} : { lastError: stored.lastError }),
    ...(stored.confirmationRef === undefined
      ? {}
      : { confirmationRef: stored.confirmationRef }),
    ...(stored.decision === undefined ? {} : { decision: stored.decision }),
    ...(stored.knowledgeCaseId === undefined
      ? {}
      : { knowledgeCaseId: stored.knowledgeCaseId }),
  });

  const applyReceipt = (stored: StoredCockpitCardFeedback, receipt: CockpitCardReceipt): void => {
    if (receipt.feedbackId !== stored.feedbackId) return;
    // A receipt — even the `closed` one that keeps the overlay — proves the call got through, so
    // any earlier failure reason is stale.
    if (stored.lastError !== undefined) {
      delete stored.lastError;
      persist();
    }
    // A `closed` receipt while the item is STILL in the reading means the provider has accepted
    // it but not yet removed it: the display keeps saying 「已发出」 until the card disappears.
    if (receipt.disposition === 'closed') return;
    overlays.delete(stored.cardId);
    // `dismissed` settles the card like a closed item: no kept/rejected notice returns it to the
    // queue. Any earlier notice for the same card is stale once the provider discards it.
    if (receipt.disposition === 'dismissed') {
      notices.delete(stored.cardId);
      persist();
      return;
    }
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
      // A resend that reached the executor is the same proof a receipt is: an earlier failure is
      // no longer the card's current reading.
      if (found.lastError !== undefined) delete found.lastError;
      persist();
    },
    markFeedbackError: (cardId, message) => {
      const found = overlays.get(cardId);
      if (found === undefined) return;
      found.lastError = message;
      persist();
    },
    clearFeedbackError: (cardId) => {
      const found = overlays.get(cardId);
      if (found === undefined || found.lastError === undefined) return;
      delete found.lastError;
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
    normalization: () => normalization,
    dispose: () => persist(),
  };
}

/**
 * The knowledge suggestion's trusted-confirmation authority: who may confirm, what they
 * confirmed, and under which version.
 *
 * WHY THE SERVER SIGNS. A knowledge decision changes a project, and the contract forbids the
 * caller from attesting to itself (`by: "human"` on the request proves nothing — any client can
 * send it). The cockpit therefore mints a reference on READ, over a canonical binding of the
 * card revision, the case's knowledge/proposal revisions, its evidence digest and every
 * option's stated decision. The reference is an HMAC under a per-process secret, so a client can
 * neither invent one nor edit the card's fields behind it. Confirmation recomputes the binding
 * from the CURRENT card and compares; a mismatch is a stale card, never an accepted decision.
 *
 * WHY THE FEEDBACK ID IS DERIVED. Retrying one decision (a lost response, a double tap) must
 * carry the SAME idempotency key so the provider can recognise the repeat instead of applying
 * the suggestion twice. The id is a hash of the binding plus the chosen option/decision, which
 * makes it stable for one decision and different for another — the `(card, revision)` accepted
 * ledger then refuses a second execution while a resend reuses the original key.
 *
 * WHAT THIS FILE DOES NOT DO. It runs no executor and stores nothing: the action channel owns
 * the call and the feedback store owns the overlay. The authority answers three questions —
 * what reference a card carries, whether evidence is sufficient, and what a confirmation means.
 *
 * Consumers: `cockpit-card-actions.ts` (confirm path) and `cockpit.module.ts` (minting the
 * reference while building the card list).
 */
import { createHash, createHmac, timingSafeEqual } from 'node:crypto';

import type {
  CockpitCard,
  CockpitCardOption,
  CockpitKnowledgeCase,
  CockpitKnowledgeDecision,
  CockpitKnowledgePlan,
} from '@/shared/types.js';
import { AppError } from '@/shared/utils.js';

import {
  decisionRequiresPlan,
  isKnowledgeCard,
  knowledgeEvidenceProblem,
  readKnowledgeCase,
  readKnowledgeDecision,
} from './cockpit-knowledge-reading.js';

/** The reference's version tag; a future binding shape bumps it rather than guessing. */
const REFERENCE_PREFIX = 'kc1';

/** The canonical binding's own version, inside the signed payload. */
const BINDING_VERSION = 'knowledge-confirmation/v1';

/** What one confirmation resolved to: the decision, its plan and the identity to deliver it under. */
export type CockpitKnowledgeConfirmation = {
  /** The verified reference, echoed to the provider as the audit trail of the decision. */
  ref: string;
  decision: CockpitKnowledgeDecision;
  /** The complete plan a planned decision carries; `null` for defer/not-applicable. */
  plan: CockpitKnowledgePlan | null;
  caseId: string;
  /** The derived idempotency key for this decision. */
  feedbackId: string;
  /** The knowledge fields merged into the feedback call's params. */
  feedback: Record<string, unknown>;
};

/** The confirmation authority's public surface. */
export type CockpitKnowledgeAuthority = {
  /**
   * Stamps a card's readable case with the reference its confirmation must present. A card that
   * is not a knowledge card, or whose case evidence is unreadable, is returned unchanged — the
   * confirm path then refuses it as missing evidence.
   */
  issue(card: CockpitCard): CockpitCard;
  /** Why a knowledge card may not be confirmed, or `null` when its evidence is sufficient. */
  evidenceProblem(card: CockpitCard): string | null;
  /**
   * Verifies one confirmation's reference and answers what the person decided. Throws an
   * `AppError` with a stable code; the caller performs the re-fetch on `STALE_CONFIRMATION`.
   */
  confirm(input: {
    card: CockpitCard;
    option: CockpitCardOption | null;
    confirmationRef?: unknown;
  }): CockpitKnowledgeConfirmation;
};

/** One confirmation the display may send; the reference is the only proof accepted. */
function invalid(message: string, code: string, statusCode = 400): AppError {
  return new AppError(message, { code, statusCode });
}

/** The option ids the card currently states a decision for, sorted so two readings agree. */
function decisionPairs(card: CockpitCard): string[][] {
  return card.options
    .map((option) => ({ id: option.id, decision: readKnowledgeDecision(option.decision) }))
    .filter((entry): entry is { id: string; decision: CockpitKnowledgeDecision } =>
      entry.decision !== null,
    )
    .map((entry) => [entry.id, entry.decision])
    .sort((left, right) => (left[0] as string).localeCompare(right[0] as string));
}

/**
 * The exact statement a reference signs.
 *
 * It names EVERY field a knowledge decision depends on, so a moved revision, a regenerated
 * proposal, new evidence or a re-labelled option all change the payload and invalidate an old
 * reference. The entry list is sorted by option id; the payload never relies on object key order.
 */
function bindingPayload(card: CockpitCard, knowledge: CockpitKnowledgeCase): unknown[] {
  return [
    BINDING_VERSION,
    card.provider,
    card.id,
    card.revision,
    knowledge.caseId,
    knowledge.knowledgeRevision,
    knowledge.proposalRevision,
    knowledge.factsFingerprint ?? '',
    decisionPairs(card),
  ];
}

/** URL-safe base64 of a UTF-8 string, without padding (the reference is one opaque token). */
function encode(value: string): string {
  return Buffer.from(value, 'utf8').toString('base64url');
}

function decode(value: string): string {
  return Buffer.from(value, 'base64url').toString('utf8');
}

/** The signature over one encoded payload. */
function sign(secret: string, payload: string): string {
  return createHmac('sha256', secret).update(payload).digest('base64url');
}

/** Constant-time signature comparison; different lengths are simply unequal. */
function sameSignature(expected: string, actual: string): boolean {
  const left = Buffer.from(expected, 'utf8');
  const right = Buffer.from(actual, 'utf8');
  return left.length === right.length && timingSafeEqual(left, right);
}

/** One signed reference for a card's current binding. */
function referenceFor(secret: string, card: CockpitCard, knowledge: CockpitKnowledgeCase): string {
  const payload = encode(JSON.stringify(bindingPayload(card, knowledge)));
  return `${REFERENCE_PREFIX}.${payload}.${sign(secret, payload)}`;
}

/**
 * The binding a chosen option adds to the card's own statement: which option, which decision.
 *
 * The feedback id is derived from THIS string, so two options never share an id even when the
 * card revision is the same.
 */
function choiceBinding(
  card: CockpitCard,
  knowledge: CockpitKnowledgeCase,
  optionId: string,
  decision: CockpitKnowledgeDecision,
): string {
  return JSON.stringify([...bindingPayload(card, knowledge), optionId, decision]);
}

/** The deterministic idempotency key for one decision. */
function feedbackIdFor(choice: string): string {
  return `kf-${createHash('sha256').update(choice).digest('hex').slice(0, 32)}`;
}

/**
 * Builds the authority over one per-process secret.
 *
 * `secret` is the only configuration: two processes (or two module instances) sign differently,
 * which is correct — a reference minted by one boot is not accepted by another, and the card's
 * next read simply mints a fresh one.
 */
export function createCockpitKnowledgeAuthority(options: {
  secret: string;
}): CockpitKnowledgeAuthority {
  const secret = options.secret;

  const issue = (card: CockpitCard): CockpitCard => {
    if (!isKnowledgeCard(card)) return card;
    const knowledge = readKnowledgeCase(card.knowledge);
    if (knowledge === null) return card;
    return {
      ...card,
      knowledge: { ...knowledge, confirmationRef: referenceFor(secret, card, knowledge) },
    };
  };

  const confirm = (input: {
    card: CockpitCard;
    option: CockpitCardOption | null;
    confirmationRef?: unknown;
  }): CockpitKnowledgeConfirmation => {
    const card = input.card;
    const evidenceProblem = knowledgeEvidenceProblem(card);
    if (evidenceProblem !== null) {
      throw invalid(evidenceProblem, 'KNOWLEDGE_EVIDENCE_MISSING');
    }
    const knowledge = readKnowledgeCase(card.knowledge) as CockpitKnowledgeCase;

    const option = input.option;
    if (option === null) {
      throw invalid(
        `knowledge card ${card.id} is decided by one of its declared options, not by free text`,
        'KNOWLEDGE_DECISION_REQUIRED',
      );
    }
    const decision = readKnowledgeDecision(option.decision);
    if (decision === null) {
      throw invalid(
        `option ${option.id} on knowledge card ${card.id} states no decision`,
        'KNOWLEDGE_DECISION_REQUIRED',
      );
    }

    if (typeof input.confirmationRef !== 'string' || input.confirmationRef.trim() === '') {
      throw invalid(
        'a knowledge confirmation must present the confirmationRef issued with the card',
        'MISSING_CONFIRMATION',
      );
    }
    const ref = input.confirmationRef.trim();
    const parts = ref.split('.');
    if (parts.length !== 3 || parts[0] !== REFERENCE_PREFIX) {
      throw invalid('the confirmation reference is not a cockpit-issued token', 'INVALID_CONFIRMATION');
    }
    const [, payload, signature] = parts as [string, string, string];
    if (!sameSignature(sign(secret, payload), signature)) {
      throw invalid('the confirmation reference signature is not valid', 'INVALID_CONFIRMATION');
    }
    let presented: unknown;
    try {
      presented = JSON.parse(decode(payload));
    } catch {
      throw invalid('the confirmation reference payload is unreadable', 'INVALID_CONFIRMATION');
    }
    // A VALID SIGNATURE PROVES THE COCKPIT MINTED IT; equality with the current card proves it
    // still describes what the person is looking at. A mismatch is a stale card, not a forgery.
    if (JSON.stringify(presented) !== JSON.stringify(bindingPayload(card, knowledge))) {
      throw invalid(
        `card ${card.id} changed since the confirmation reference was issued`,
        'STALE_CONFIRMATION',
        409,
      );
    }

    const plan = decisionRequiresPlan(decision) ? (option.plan ?? knowledge.plan ?? null) : null;
    if (decisionRequiresPlan(decision) && plan === null) {
      throw invalid(
        `decision ${decision} on card ${card.id} must carry a complete plan (scope, steps, verification)`,
        'KNOWLEDGE_PLAN_MISSING',
      );
    }

    const choice = choiceBinding(card, knowledge, option.id, decision);
    return {
      ref,
      decision,
      plan,
      caseId: knowledge.caseId,
      feedbackId: feedbackIdFor(choice),
      feedback: {
        caseId: knowledge.caseId,
        knowledgeRevision: knowledge.knowledgeRevision,
        proposalRevision: knowledge.proposalRevision,
        decision,
        confirmationRef: ref,
        ...(knowledge.factsFingerprint === undefined
          ? {}
          : { factsFingerprint: knowledge.factsFingerprint }),
        ...(plan === null ? {} : { plan }),
      },
    };
  };

  return {
    issue,
    evidenceProblem: knowledgeEvidenceProblem,
    confirm,
  };
}

/**
 * Whether a confirmation body tries to attest to itself.
 *
 * The knowledge contract forbids a caller-supplied identity as proof. Such a field is refused by
 * name even when a valid reference is also present, so a client cannot learn to "just add
 * by:human" and pass.
 */
export function callerAttestationFields(body: Record<string, unknown>): string[] {
  const forbidden = ['by', 'confirmedBy', 'confirmedByUser', 'actor'];
  return forbidden.filter((field) => body[field] !== undefined);
}

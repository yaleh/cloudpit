/**
 * Tolerant readers for a knowledge suggestion's case block and its options' decisions.
 *
 * WHY THEY ARE SEPARATE FROM THE PROJECTION. The fleet document is untrusted input on every
 * read: one malformed case block must leave its card visible and merely unconfirmable, never
 * abort the batch. These readers state exactly what is readable and return `null` otherwise, so
 * the projection passes a provider's statement through without inventing a case, and the
 * confirmation authority can refuse a card whose evidence is missing with one stable reason.
 *
 * Consumers: `cockpit-fleet-card-projection.ts` (mapping one JSONL card) and
 * `cockpit-knowledge-decision.ts` (the trusted-confirmation authority).
 */
import type {
  CockpitCard,
  CockpitKnowledgeCase,
  CockpitKnowledgeCaseState,
  CockpitKnowledgeDecision,
  CockpitKnowledgePlan,
  CockpitKnowledgeVerification,
} from '@/shared/types.js';
import { isRecord } from '@/shared/utils.js';

/** The open card kind a versioned knowledge suggestion uses. */
export const KNOWLEDGE_CARD_KIND = 'knowledge';

/** The four decisions a knowledge option may state. */
export const KNOWLEDGE_DECISIONS: readonly CockpitKnowledgeDecision[] = [
  'apply',
  'modify',
  'defer',
  'not-applicable',
];

/** The decisions that change the project and therefore require a complete plan. */
const PLANNED_DECISIONS: readonly CockpitKnowledgeDecision[] = ['apply', 'modify'];

const CASE_STATES: readonly CockpitKnowledgeCaseState[] = [
  'pending',
  'executing',
  'verifying',
  'reported',
  'blocked',
  'unknown',
];

const VERIFICATION_STATES: readonly CockpitKnowledgeVerification['state'][] = [
  'pending',
  'passed',
  'failed',
  'unknown',
];

function text(value: unknown): string {
  return typeof value === 'string' ? value : '';
}

function nonNegativeInteger(value: unknown): number | null {
  return typeof value === 'number' && Number.isInteger(value) && value >= 0 ? value : null;
}

/** One decision, or `null` when the provider's word is not in the contract's vocabulary. */
export function readKnowledgeDecision(value: unknown): CockpitKnowledgeDecision | null {
  return typeof value === 'string' &&
    (KNOWLEDGE_DECISIONS as readonly string[]).includes(value)
    ? (value as CockpitKnowledgeDecision)
    : null;
}

function readStringList(value: unknown): string[] {
  const entries = Array.isArray(value) ? value : typeof value === 'string' ? [value] : [];
  return entries
    .map((entry) => text(entry).trim())
    .filter((entry) => entry !== '');
}

/**
 * One complete plan, or `null` when a field a receiver needs is missing.
 *
 * A PARTIAL PLAN IS NOT A PLAN. Only a non-empty scope, at least one step and a stated
 * verification method make a decision deliverable; anything less is refused by the confirmation
 * authority instead of being handed off as "what the person decided".
 */
export function readKnowledgePlan(value: unknown): CockpitKnowledgePlan | null {
  if (!isRecord(value)) return null;
  const scope = readStringList(value.scope);
  const steps = readStringList(value.steps);
  const verification = text(value.verification).trim();
  if (scope.length === 0 || steps.length === 0 || verification === '') return null;
  return { scope, steps, verification };
}

function readProgress(value: unknown): CockpitKnowledgeCase['progress'] | undefined {
  if (!isRecord(value)) return undefined;
  const step = text(value.step).trim();
  if (step === '') return undefined;
  const at = text(value.at);
  return at === '' ? { step } : { step, at };
}

function readVerification(value: unknown): CockpitKnowledgeVerification | undefined {
  if (!isRecord(value)) return undefined;
  const state = text(value.state);
  const summary = text(value.summary).trim();
  if (!(VERIFICATION_STATES as readonly string[]).includes(state) && summary === '') {
    return undefined;
  }
  const at = text(value.at);
  return {
    state: (VERIFICATION_STATES as readonly string[]).includes(state)
      ? (state as CockpitKnowledgeVerification['state'])
      : 'unknown',
    summary,
    ...(at === '' ? {} : { at }),
  };
}

/**
 * One knowledge case block, or `null` when its identity or version is unreadable.
 *
 * `caseId`, `knowledgeRevision` and `proposalRevision` are the evidence a trusted confirmation
 * binds to; without all three the card can be shown but never confirmed.
 */
export function readKnowledgeCase(value: unknown): CockpitKnowledgeCase | null {
  if (!isRecord(value)) return null;
  const caseId = text(value.caseId).trim();
  const knowledgeRevision = nonNegativeInteger(value.knowledgeRevision);
  const proposalRevision = nonNegativeInteger(value.proposalRevision);
  if (caseId === '' || knowledgeRevision === null || proposalRevision === null) return null;

  const state = text(value.state);
  const plan = readKnowledgePlan(value.plan);
  const progress = readProgress(value.progress);
  const verification = readVerification(value.verification);
  const knowledgeId = text(value.knowledgeId).trim();
  const executionId = text(value.executionId).trim();
  const nextCheckAt = text(value.nextCheckAt).trim();
  const originSessionId = text(value.originSessionId).trim();
  const originUri = text(value.originUri).trim();
  const factsFingerprint = text(value.factsFingerprint).trim();

  return {
    caseId,
    knowledgeRevision,
    proposalRevision,
    state: (CASE_STATES as readonly string[]).includes(state)
      ? (state as CockpitKnowledgeCaseState)
      : 'unknown',
    ...(knowledgeId === '' ? {} : { knowledgeId }),
    ...(plan === null ? {} : { plan }),
    ...(progress === undefined ? {} : { progress }),
    ...(executionId === '' ? {} : { executionId }),
    ...(verification === undefined ? {} : { verification }),
    ...(nextCheckAt === '' ? {} : { nextCheckAt }),
    ...(originSessionId === '' ? {} : { originSessionId }),
    ...(originUri === '' ? {} : { originUri }),
    ...(factsFingerprint === '' ? {} : { factsFingerprint }),
  };
}

/** Whether a card asks a knowledge decision (its open kind, or a readable case block). */
export function isKnowledgeCard(card: CockpitCard): boolean {
  return card.kind === KNOWLEDGE_CARD_KIND || card.knowledge !== undefined;
}

/**
 * Why a knowledge card cannot be confirmed, or `null` when its evidence is sufficient.
 *
 * A card with the knowledge kind but no readable case block is exactly the "missing evidence"
 * case: the display may still draw it, the confirmation channel refuses it by name.
 */
export function knowledgeEvidenceProblem(card: CockpitCard): string | null {
  const knowledge = readKnowledgeCase(card.knowledge);
  if (knowledge === null) {
    return `知识建议卡 ${card.id} 缺少可读的 case 证据（caseId/知识版本/建议版本）`;
  }
  return null;
}

/** Whether one decision must carry a complete plan. */
export function decisionRequiresPlan(decision: CockpitKnowledgeDecision): boolean {
  return PLANNED_DECISIONS.includes(decision);
}

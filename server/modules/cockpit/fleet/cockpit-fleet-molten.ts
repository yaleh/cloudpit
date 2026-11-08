/**
 * The fleet's molten short-loop decision (ADR-016, GOAL-012): the block reader and the card's
 * three confirm options.
 *
 * WHY IT IS A SIBLING FILE. The fleet card projection already owns the tolerant reading of the
 * fleet document, and the molten decision is a distinct concern with its own vocabulary (the
 * crystallisation actions and the task spec). Keeping it here follows the module standards'
 * split-by-concern rule and keeps the projection file inside the repository's oversize ratchet
 * rather than growing it past 800 lines.
 *
 * READING, NOT JUDGEMENT. The block is read verbatim: no value is trimmed, paraphrased or filled
 * in. The only thing this module builds is the fixed three-way confirm surface the contract names
 * (`crystallize-task` / `decline` / `modify`), each routed to `fleet.molten-decide`. This is
 * deliberately NOT the knowledge path: no `knowledge` block is read or created, so the action
 * channel's knowledge branch cannot fire on a molten card.
 *
 * Consumers: `cockpit-fleet-card-projection.ts` (the only caller).
 */
import type {
  CockpitCard,
  CockpitCardOption,
  CockpitMoltenAction,
  CockpitMoltenDecision,
  CockpitMoltenTaskSpec,
} from '@/shared/types.js';
import { isRecord } from '@/shared/utils.js';

import { COCKPIT_MOLTEN_DECIDE_EXECUTOR_ID } from './cockpit-fleet-executor.js';

/**
 * The kind a molten decision renders as. It is an OPEN kind: the wire's closed `CockpitCardKind`
 * union does not name it (the same way it does not name `knowledge` or `digest`), and the
 * descriptor table gives it its own badge and tone.
 */
export const MOLTEN_DECISION_KIND = 'molten-decision';

/** The three decisions the GOAL-012 contract fixes, in contract order. */
export const MOLTEN_DECISIONS = ['crystallize-task', 'decline', 'modify'] as const;

export type CockpitMoltenDecisionId = (typeof MOLTEN_DECISIONS)[number];

/** The words the cockpit gives each fixed option; the fleet states ids, not display copy. */
const OPTION_COPY: Record<CockpitMoltenDecisionId, { label: string; does: string }> = {
  'crystallize-task': { label: '立任务', does: '按 taskSpec 在项目里立一条任务' },
  decline: { label: '不立任务', does: '关卡，不创建任务' },
  modify: { label: '改 spec', does: '保持卡片打开，交回修改 taskSpec' },
};

/** A string field, or `null` when the fleet stated none (the wire uses null, never `''`). */
function textOrNull(value: unknown): string | null {
  return typeof value === 'string' ? value : null;
}

/** A string list; non-string entries are dropped rather than coerced. */
function stringList(value: unknown): string[] {
  return Array.isArray(value)
    ? value.filter((entry): entry is string => typeof entry === 'string')
    : [];
}

/** The block's `action`; a missing or malformed sub-object states three nulls. */
function readAction(raw: unknown): CockpitMoltenAction {
  const action = isRecord(raw) ? raw : {};
  return {
    kind: textOrNull(action.kind),
    summary: textOrNull(action.summary),
    scope: textOrNull(action.scope),
  };
}

/** The block's `taskSpec`; the four bodies and the file list pass through untrimmed. */
function readTaskSpec(raw: unknown): CockpitMoltenTaskSpec {
  const spec = isRecord(raw) ? raw : {};
  return {
    title: textOrNull(spec.title),
    proposal: textOrNull(spec.proposal),
    ac: textOrNull(spec.ac),
    dod: textOrNull(spec.dod),
    touches: stringList(spec.touches),
  };
}

/**
 * The fleet's molten decision block, read verbatim.
 *
 * `proposalId` is the block's identity (it is also what `subject.uri` addresses), so a block
 * without a readable one is ABSENT, not partially invented: no card can be signed off without
 * knowing which proposal it is. Every other field is carried as stated, including `null` for an
 * action/taskSpec field the loop left unstated.
 */
export function readMoltenDecision(raw: unknown): CockpitMoltenDecision | null {
  if (!isRecord(raw)) return null;
  const proposalId = textOrNull(raw.proposalId);
  if (proposalId === null || proposalId.trim() === '') return null;
  return {
    proposalId,
    project: textOrNull(raw.project),
    belief: stringList(raw.belief),
    action: readAction(raw.action),
    taskSpec: readTaskSpec(raw.taskSpec),
    evidenceRefs: stringList(raw.evidenceRefs),
  };
}

/**
 * The attentionId/revision the confirm executor must echo back.
 *
 * The fleet expands its wire's three ids into label-less options carrying these two params, and
 * that expansion is the authority: when it is readable it is used verbatim. A wire that states
 * only the ids (or no options at all) falls back to the card's own id/revision, which is where
 * the fleet derives them from. The cockpit never invents a different address.
 */
function optionAddress(
  card: CockpitCard,
  rawOptions: unknown,
): { attentionId: string; revision: number } {
  for (const entry of Array.isArray(rawOptions) ? rawOptions : []) {
    if (!isRecord(entry)) continue;
    const action = isRecord(entry.action) ? entry.action : null;
    const params = action !== null && isRecord(action.params) ? action.params : null;
    if (params === null) continue;
    const attentionId = textOrNull(params.attentionId);
    const revision = typeof params.revision === 'number' ? params.revision : null;
    if (attentionId !== null && attentionId !== '' && revision !== null) {
      return { attentionId, revision };
    }
  }
  return { attentionId: card.id, revision: card.revision };
}

/**
 * The card's confirm options: exactly the contract's three decisions, in its order.
 *
 * Every option names `fleet.molten-decide` and carries `{ attentionId, revision, decision }`, so
 * the fleet can find the open card, refuse a stale revision, and know which state the person
 * chose. The options REPLACE whatever the generic reader mapped: the fleet's expansion has no
 * label, so it would otherwise be dropped as unreadable and leave the card unconfirmable.
 */
function moltenOptions(card: CockpitCard, rawOptions: unknown): CockpitCardOption[] {
  const { attentionId, revision } = optionAddress(card, rawOptions);
  return MOLTEN_DECISIONS.map((decision) => ({
    id: decision,
    label: OPTION_COPY[decision].label,
    does: OPTION_COPY[decision].does,
    suggested: false,
    source: 'provider',
    action: {
      executor: COCKPIT_MOLTEN_DECIDE_EXECUTOR_ID,
      params: { attentionId, revision, decision },
    },
  }));
}

/**
 * Gives a molten card its kind and its fixed three-way confirm surface.
 *
 * The block itself is already on the card (`molten`), read verbatim by `readMoltenDecision`; this
 * completion adds no derived text and never touches `knowledge`/`ask`/`facts`. A non-molten card
 * passes through unchanged.
 */
export function withMoltenDecision(
  card: CockpitCard,
  molten: CockpitMoltenDecision | null,
  rawOptions: unknown,
): CockpitCard {
  if (molten === null) return card;
  return { ...card, kind: MOLTEN_DECISION_KIND, options: moltenOptions(card, rawOptions) };
}

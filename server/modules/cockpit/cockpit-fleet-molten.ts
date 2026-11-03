/**
 * The fleet's molten short-loop decision (ADR-016): the block reader and the card completion.
 *
 * WHY IT IS A SIBLING FILE. The fleet card projection already owns the tolerant reading of the
 * fleet document, and the molten decision is a distinct concern with its own vocabulary (the
 * short loop's judgement/conclusion/actions/dispatch). Keeping it here follows the module
 * standards' split-by-concern rule and keeps the projection file inside the repository's
 * oversize ratchet rather than growing it past 800 lines.
 *
 * READING AND COMPLETION, NOT JUDGEMENT. The block is read verbatim: no value is trimmed,
 * paraphrased or filled in. The completion only places the loop's own readings where the card
 * already draws things, and every confirm option routes to the molten decision executor. This is
 * deliberately NOT the knowledge path: no `knowledge` block is created and no `decision`/`plan`
 * field is attached, so the action channel's knowledge branch cannot fire on a molten card.
 *
 * Consumers: `cockpit-fleet-card-projection.ts` (the only caller).
 */
import type {
  CockpitCard,
  CockpitCardOption,
  CockpitMoltenDecision,
  CockpitMoltenDecisionAction,
} from '@/shared/types.js';
import { isRecord } from '@/shared/utils.js';

import { COCKPIT_MOLTEN_DECIDE_EXECUTOR_ID } from './cockpit-fleet-executor.js';

/**
 * The fleet's category for a molten short-loop decision. Like `digest`, the category is not in
 * the fleet's kind table, so the open `kind` string carries it verbatim; the projection maps it
 * to the cockpit's own `molten` kind (which has a descriptor row of its own).
 */
export const MOLTEN_CATEGORY = 'molten-decision';

/** The cockpit kind a molten short-loop decision renders as. Not part of `CockpitCardKind`. */
export const MOLTEN_KIND = 'molten';

/** The generated dispatch option's id, so a fleet-stated action of the same id is not doubled. */
const MOLTEN_DISPATCH_OPTION_ID = 'dispatch';

/** A string field, or `''` when the value is not a string. Tolerant like every fleet reading. */
function text(value: unknown): string {
  return typeof value === 'string' ? value : '';
}

/** An array field, or `[]` when the value is not an array. */
function list(value: unknown): unknown[] {
  return Array.isArray(value) ? value : [];
}

/**
 * The fleet's molten decision block, read verbatim.
 *
 * A block with no readable reading at all is absent, not partially invented: no judgement, no
 * conclusion, no readable action and no dispatch proposal states nothing the person could sign
 * off. A malformed action entry (no id or no label) is dropped, never guessed.
 */
export function readMoltenDecision(raw: unknown): CockpitMoltenDecision | null {
  if (!isRecord(raw)) return null;
  const judgement = text(raw.judgement);
  const conclusion = text(raw.conclusion);
  const actions: CockpitMoltenDecisionAction[] = [];
  for (const entry of list(raw.actions)) {
    if (!isRecord(entry)) continue;
    const id = text(entry.id);
    const label = text(entry.label);
    if (id === '' || label === '') continue;
    actions.push({ id, label, does: text(entry.does) });
  }
  const dispatch = text(raw.dispatch);
  if (judgement === '' && conclusion === '' && actions.length === 0 && dispatch === '') return null;
  return { judgement, conclusion, actions, ...(dispatch === '' ? {} : { dispatch }) };
}

/**
 * The options a molten decision offers: one per crystallisation action, plus the dispatch
 * proposal when the loop stated one.
 *
 * EVERY OPTION ROUTES TO THE SAME EXECUTOR. `decision` is the action id the fleet crystallises;
 * a dispatch proposal carries its sentence as `dispatch`. This is deliberately NOT the
 * knowledge path: no `decision`/`plan`/`confirmation` field is attached, so the action channel
 * never treats the confirmation as a knowledge apply.
 */
function moltenOptions(cardId: string, molten: CockpitMoltenDecision): CockpitCardOption[] {
  const options: CockpitCardOption[] = molten.actions.map((action) => ({
    id: action.id,
    label: action.label,
    does: action.does,
    suggested: false,
    source: 'provider',
    action: {
      executor: COCKPIT_MOLTEN_DECIDE_EXECUTOR_ID,
      params: { cardId, decision: action.id },
    },
  }));
  if (
    molten.dispatch !== undefined &&
    !options.some((option) => option.id === MOLTEN_DISPATCH_OPTION_ID)
  ) {
    options.push({
      id: MOLTEN_DISPATCH_OPTION_ID,
      label: '采纳 dispatch 提议',
      does: molten.dispatch,
      suggested: false,
      source: 'provider',
      action: {
        executor: COCKPIT_MOLTEN_DECIDE_EXECUTOR_ID,
        params: { cardId, decision: MOLTEN_DISPATCH_OPTION_ID, dispatch: molten.dispatch },
      },
    });
  }
  return options;
}

/**
 * Folds the molten block into the card's own zones, reading for reading.
 *
 * The short loop's four readings are placed where the cockpit already draws things, never
 * paraphrased: the JUDGEMENT is the card's headline (`ask`; when the fleet stated its own ask,
 * the judgement stays as a `判断：` fact instead so it is not lost), the ONE-LINE CONCLUSION is a
 * fact, and the ACTIONS plus the DISPATCH PROPOSAL become confirm options. The fact is marked
 * `mechanical: false`: a judgement is the loop's reading, not a machine observation, and the
 * card contract keeps the two apart.
 *
 * ⛔ NO KNOWLEDGE BLOCK IS CREATED. This completion touches only `kind`/`ask`/`facts`/`options`;
 * a molten card carries no `knowledge` field, so the action channel's knowledge branch cannot
 * fire on it.
 */
export function withMoltenDecision(
  card: CockpitCard,
  molten: CockpitMoltenDecision | null,
): CockpitCard {
  if (molten === null) return card;

  const facts = [...card.facts];
  let ask = card.ask?.trim() ?? '';
  if (ask === '') {
    ask = molten.judgement;
  } else if (molten.judgement !== '') {
    facts.push({ text: `判断：${molten.judgement}`, mechanical: false });
  }
  if (molten.conclusion !== '') {
    facts.push({ text: `结论：${molten.conclusion}`, mechanical: false });
  }

  return {
    ...card,
    kind: MOLTEN_KIND,
    ...(ask === '' ? {} : { ask }),
    facts,
    options: [...card.options, ...moltenOptions(card.id, molten)],
  };
}

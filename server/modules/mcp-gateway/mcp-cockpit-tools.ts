/**
 * The cockpit card tools (gap-mcp-cockpit-card-tools): the MCP face of the card
 * system `server/modules/cockpit/` already implements.
 *
 * The four tools are thin ADAPTERS, not a second reading path. Every one of them
 * is handed the SAME three members `server/index.ts` builds once for the HTTP
 * face:
 *
 *  - `cockpit_cards` → `registry.listCards()` + `registry.diagnostics()`, the
 *    body `GET /api/cockpit/cards` answers (an empty list stays distinguishable
 *    from a provider whose read failed, because the diagnostics ride along).
 *  - `cockpit_card` → `registry.getCard(cardId)`, the same projection the card
 *    list and the action channel read.
 *  - `cockpit_card_brief` → `briefForCard(cardId)`, the module's ONE brief
 *    generation path — fixture briefs, the unsupported-content fallback, the
 *    service's cache and ledger all included, exactly as the `/brief` route.
 *  - `cockpit_card_confirm` → `actions.confirm(...)`, whose guards (parse, card
 *    open, revision equality, declared executor, accepted ledger, execute) run
 *    here too because the MCP tool never re-implements one of them.
 *
 * ## Scopes
 *
 * The three READ tools declare `cloudcli:read`. That is deliberate, not an
 * oversight: `session_read` already returns raw transcripts under that scope,
 * and a card is a bounded summary derived from them — minting a cockpit read
 * scope would be stricter than the ceiling it summarizes.
 *
 * `cockpit_card_confirm` declares `cloudcli:cockpit:act`. A confirmation runs the
 * option's declared executor, which is a generic dispatcher over `session.send` /
 * `session.start` / the fleet disposal verbs, so no single existing scope covers
 * it. The scope is appended LAST to `ACCESS_TOKEN_SCOPES` and the consent screen
 * names its worst case honestly (see `oauth-consent.service.ts`).
 *
 * ## Error codes
 *
 * The action channel throws `AppError`s (`CARD_NOT_FOUND`, `REVISION_CONFLICT`,
 * `EXECUTOR_NOT_DECLARED`, `EXECUTOR_UNAVAILABLE`, `ALREADY_CONFIRMED`,
 * `INVALID_REQUEST`, plus a provider's own forwarded code). An `AppError` is not
 * JSON-bodied, so `toMcpErrorResult` would flatten all of them to
 * `INTERNAL_ERROR`; {@link buildCockpitCardConfirm} therefore re-throws the same
 * code and sentence as an `McpToolError`, which the envelope renders verbatim.
 * That is a TRANSLATION of a refusal the channel already decided — no guard is
 * duplicated here.
 *
 * Consumers: `mcp-gateway.transport.ts` (the `cockpitTools` branch of
 * `createMcpServer`) and this module's criterion, which mounts the real gateway
 * over the real `createCockpitCardsModule`.
 */

import { z } from 'zod';

import type { CockpitCardProviderDiagnostic, CockpitCardsModule } from '@/modules/cockpit/index.js';
import type { CockpitCard, CockpitBriefResponse } from '@/shared/types.js';
import { AppError } from '@/shared/utils.js';

import { MCP_ERROR_CODES, McpToolError } from './mcp-error-envelope.js';

/** The four `tools/list` names this module owns. */
export const MCP_COCKPIT_TOOL_NAMES = [
  'cockpit_cards',
  'cockpit_card',
  'cockpit_card_brief',
  'cockpit_card_confirm',
] as const;

/** One name in {@link MCP_COCKPIT_TOOL_NAMES}; the key union the gateway's tables extend. */
export type McpCockpitToolName = (typeof MCP_COCKPIT_TOOL_NAMES)[number];

/** The scope the three read tools declare — the same ceiling `session_read` uses. */
export const MCP_COCKPIT_READ_SCOPE = 'cloudcli:read';

/** The scope `cockpit_card_confirm` declares; appended LAST to `ACCESS_TOKEN_SCOPES`. */
export const MCP_COCKPIT_ACT_SCOPE = 'cloudcli:cockpit:act';

/**
 * The cockpit module members the four tools read, taken WHOLE from
 * {@link CockpitCardsModule} so the composition root cannot hand the gateway a
 * second registry, a bypassing confirm path or a re-implemented brief.
 */
export type McpCockpitToolDeps = Pick<CockpitCardsModule, 'registry' | 'actions' | 'briefForCard'>;

// --------------------------- input shapes ---------------------------

/** `cockpit_cards` takes no arguments; `{}` advertises an argument-less object. */
export const COCKPIT_CARDS_INPUT_SCHEMA = {} satisfies z.ZodRawShape;

/** The one `cardId` argument `cockpit_card` / `cockpit_card_brief` take. */
export const COCKPIT_CARD_ID_INPUT_SCHEMA = {
  cardId: z.string().min(1),
} satisfies z.ZodRawShape;

/**
 * `cockpit_card_confirm`'s arguments: the action channel's own three fields.
 * `optionId` / `replyText` are deliberately NOT made exclusive here — the
 * channel owns that rule and answers `INVALID_REQUEST`, which is the reading
 * AC6 pins.
 */
export const COCKPIT_CARD_CONFIRM_INPUT_SCHEMA = {
  cardId: z.string().min(1),
  revision: z.number().int(),
  optionId: z.string().min(1).optional(),
  replyText: z.string().optional(),
} satisfies z.ZodRawShape;

/** One confirmation's typed input, after the declared schema accepted it. */
export type McpCockpitCardConfirmInput = {
  cardId: string;
  revision: number;
  optionId?: string;
  replyText?: string;
};

/** Reads `cockpit_card` / `cockpit_card_brief`'s `cardId`. */
function readCardId(args: Record<string, unknown>): string {
  const cardId = args.cardId;
  if (typeof cardId !== 'string' || cardId.trim().length === 0) {
    throw new McpToolError(MCP_ERROR_CODES.INVALID_ARGUMENT, '"cardId" is required and must be a non-empty string.');
  }
  return cardId;
}

/** Reads `cockpit_card_confirm`'s arguments. */
export function readCockpitCardConfirmInput(args: Record<string, unknown>): McpCockpitCardConfirmInput {
  const cardId = readCardId(args);
  const revision = args.revision;
  if (typeof revision !== 'number' || !Number.isInteger(revision)) {
    throw new McpToolError(MCP_ERROR_CODES.INVALID_ARGUMENT, '"revision" is required and must be an integer.');
  }
  const optionId = args.optionId;
  const replyText = args.replyText;
  if (optionId !== undefined && typeof optionId !== 'string') {
    throw new McpToolError(MCP_ERROR_CODES.INVALID_ARGUMENT, '"optionId" must be a string when given.');
  }
  if (replyText !== undefined && typeof replyText !== 'string') {
    throw new McpToolError(MCP_ERROR_CODES.INVALID_ARGUMENT, '"replyText" must be a string when given.');
  }
  return {
    cardId,
    revision,
    ...(optionId === undefined ? {} : { optionId }),
    ...(replyText === undefined ? {} : { replyText }),
  };
}

// --------------------------- payloads ---------------------------

/**
 * `cockpit_cards`' answer. `diagnostics` is OMITTED when no provider has
 * anything to explain, mirroring `GET /api/cockpit/cards` byte for byte — so a
 * bare deployment's callers keep reading `{ cards }`.
 */
export type CockpitCardsPayload = {
  cards: CockpitCard[];
  diagnostics?: readonly CockpitCardProviderDiagnostic[];
};

/** The `CARD_NOT_FOUND` sentence, shared by the three by-id tools. */
function cardNotFound(cardId: string): McpToolError {
  return new McpToolError('CARD_NOT_FOUND', `No open cockpit card has the id "${cardId}".`, false, { cardId });
}

// --------------------------- builders ---------------------------

/** Every open card plus any provider's account of its last read. */
export async function buildCockpitCards(deps: McpCockpitToolDeps): Promise<CockpitCardsPayload> {
  const cards = await deps.registry.listCards();
  const diagnostics = deps.registry.diagnostics();
  return diagnostics.length === 0 ? { cards } : { cards, diagnostics };
}

/** One open card by id, or the `CARD_NOT_FOUND` envelope. */
export async function buildCockpitCard(cardId: string, deps: McpCockpitToolDeps): Promise<CockpitCard> {
  const card = await deps.registry.getCard(cardId);
  if (card === null) throw cardNotFound(cardId);
  return card;
}

/** One card's BriefSpec (or deterministic fallback), or the `CARD_NOT_FOUND` envelope. */
export async function buildCockpitCardBrief(
  cardId: string,
  deps: McpCockpitToolDeps,
): Promise<CockpitBriefResponse> {
  const response = await deps.briefForCard(cardId);
  if (response === null) throw cardNotFound(cardId);
  return response;
}

/**
 * Confirms one card through the action channel.
 *
 * The channel's `AppError` is re-thrown as an `McpToolError` carrying the SAME
 * code and sentence: the envelope is the channel's decision, not a gateway
 * re-reading of it. Anything that is not an `AppError` keeps propagating, so a
 * real defect still surfaces as `INTERNAL_ERROR`.
 */
export async function buildCockpitCardConfirm(
  input: McpCockpitCardConfirmInput,
  deps: McpCockpitToolDeps,
): Promise<Awaited<ReturnType<CockpitCardsModule['actions']['confirm']>>> {
  try {
    return await deps.actions.confirm({
      cardId: input.cardId,
      revision: input.revision,
      ...(input.optionId === undefined ? {} : { optionId: input.optionId }),
      ...(input.replyText === undefined ? {} : { replyText: input.replyText }),
    });
  } catch (error) {
    if (error instanceof AppError) {
      throw new McpToolError(error.code, error.message);
    }
    throw error;
  }
}

// --------------------------- registration ---------------------------

/**
 * One cockpit tool as it is handed to the registration seam — the same shape as
 * the resident-tool registrations, so the transport's one audited seam installs
 * it without a special case.
 */
export type McpCockpitToolRegistration = {
  name: McpCockpitToolName;
  description: string;
  requiredScope: string;
  inputSchema: z.ZodRawShape;
  handler: (args: Record<string, unknown>) => unknown | Promise<unknown>;
};

/** The seam `registerMcpCockpitTools` installs through (the transport's `audited` helper). */
export type McpCockpitToolSeam = (registration: McpCockpitToolRegistration) => void;

/**
 * Installs the four cockpit tools through the audited seam.
 *
 * Consumers: `mcp-gateway.transport.ts` (when the mount carries a `cockpitTools`
 * deps bag) and this module's criterion, which reads each name and scope back
 * off a real `tools/list`.
 */
export function registerMcpCockpitTools(seam: McpCockpitToolSeam, deps: McpCockpitToolDeps): void {
  seam({
    name: 'cockpit_cards',
    description:
      'List the cockpit\'s open cards (each with its options, executors and revision) plus any provider\'s account of its last read. Read scope; a card summary is never more sensitive than the transcript session_read already returns.',
    requiredScope: MCP_COCKPIT_READ_SCOPE,
    inputSchema: COCKPIT_CARDS_INPUT_SCHEMA,
    handler: () => buildCockpitCards(deps),
  });
  seam({
    name: 'cockpit_card',
    description: 'Read one open cockpit card by its id. Read scope, same ceiling as cockpit_cards.',
    requiredScope: MCP_COCKPIT_READ_SCOPE,
    inputSchema: COCKPIT_CARD_ID_INPUT_SCHEMA,
    handler: (args) => buildCockpitCard(readCardId(args), deps),
  });
  seam({
    name: 'cockpit_card_brief',
    description:
      'Generate one card\'s brief (headline, options, recommendation, evidence, blocks) through the same path GET /api/cockpit/cards/:id/brief uses; a card whose content cannot be briefed answers the deterministic fallback with its reason.',
    requiredScope: MCP_COCKPIT_READ_SCOPE,
    inputSchema: COCKPIT_CARD_ID_INPUT_SCHEMA,
    handler: (args) => buildCockpitCardBrief(readCardId(args), deps),
  });
  seam({
    name: 'cockpit_card_confirm',
    description:
      'Confirm one cockpit card option (or a free-text reply) at its current revision, running the option\'s declared executor. A stale revision is REVISION_CONFLICT (re-list and retry); the same (card, revision) confirms once, so a repeat is ALREADY_CONFIRMED.',
    requiredScope: MCP_COCKPIT_ACT_SCOPE,
    inputSchema: COCKPIT_CARD_CONFIRM_INPUT_SCHEMA,
    handler: (args) => buildCockpitCardConfirm(readCockpitCardConfirmInput(args), deps),
  });
}

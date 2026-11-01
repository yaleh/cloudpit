/**
 * The MCP gateway's `knowledge_facts` tool — the wire face of
 * `cloudcli.knowledge-application.fact` v1.
 *
 * ONE TOOL, THREE KINDS. The contract's three questions are answered by one
 * read tool whose `kind` selects the reading, rather than three names: they
 * share the same scope, the same evidence union and the same identity envelope,
 * and a caller that can read one kind can read all three. The kind-specific
 * arguments are validated in the handler rather than by three separate schemas,
 * because the wire schema is one statement and the refusal sentence can then
 * name the exact missing argument.
 *
 * THE TOOL REFUSES TO GUESS. A query naming a session the store does not hold is
 * `SESSION_NOT_FOUND` — an address that did not resolve is not a fact with every
 * field unknown. Everything the reader could not establish arrives as an
 * explicit `unknown` field (with a reason) inside the reading, never as a
 * plausible default.
 *
 * REGISTERED ALONGSIDE THE STAGE-3 TABLE, like `draft_get`. The stage-3 table is
 * the frozen AC-245 read set and its size is pinned by its own criterion; this
 * tool is installed by the registrar when the composition root supplies a fact
 * source, and is simply absent from a mount that has no source to read. It is
 * named in `MCP_TOOL_ANNOTATIONS` / `MCP_TOOL_ERROR_CODES` because the audited
 * seams read a row for every registered name.
 *
 * Consumers: `mcp-read-tools-registry.ts` (registration) and
 * `tests/mcp-knowledge-facts.test.ts` (the positive and negative readings).
 */
import { z } from 'zod';

import { MCP_ERROR_CODES, McpToolError } from './mcp-error-envelope.js';
import type { McpToolInputSchema } from '@/shared/mcp-contract/index.js';
import {
  KNOWLEDGE_FACT_KINDS,
  type IKnowledgeFactSource,
  type KnowledgeConfigLayer,
  type KnowledgeFactIdentity,
  type KnowledgeFactQuery,
  type KnowledgeFactReading,
} from '@/shared/knowledge-facts.js';
import type { McpReadToolSeam } from './mcp-read-contract.js';

/** The tool name on the wire. */
export const KNOWLEDGE_FACTS_TOOL_NAME = 'knowledge_facts';

/** The scope the tool requires; it mutates nothing. */
export const KNOWLEDGE_FACTS_REQUIRED_SCOPE = 'cloudcli:read';

/** The description a caller reads before choosing a kind. */
export const KNOWLEDGE_FACTS_DESCRIPTION =
  'Read one versioned knowledge-application fact about this host: `peer_result` (the ask a session stated, the settling reply re-read from the transcript, and the same operation id on both readings), `effective_config` (expected, stored and actually-running model / effort / permission mode, the operation the reading is about, the ACTUAL request and response the provider recorded for that operation, and a per-field verdict — `verified` is false when the operation, any layer or any expected field is unknown, and a field the provider cannot read back is declared unavailable in `capabilities` rather than echoed from the stored row), or `inventory` (a bounded session page that keeps its filters, total and truncation, so an empty page is never reported as an empty host). Every field is either an evidence reading with its source and observation time, or an explicit `unknown` with a reason; the payload also carries the contract name and version, the build id and the running process boot id.';

/** The facts bag the registrar routes this tool to when it is wired. */
export type McpKnowledgeFactsDeps = {
  facts: IKnowledgeFactSource;
};

/** The presentation pieces the registrar reads from its one table. */
export type McpKnowledgeFactsRegistration = {
  name: string;
  description: string;
  requiredScope: string;
  inputSchema: McpToolInputSchema;
  outputSchema: z.ZodRawShape;
};

const knowledgeConfigLayerSchema = z.object({
  model: z.string().nullable().optional(),
  effort: z.string().nullable().optional(),
  permissionMode: z.string().nullable().optional(),
});

/**
 * The advertised input shape.
 *
 * `kind` is required and enumerated. `session` addresses the two session-scoped
 * kinds; `peerSession` is the caller's own statement of which peer the ask
 * targeted (the stream does not record it); the rest are the inventory fence and
 * the expected configuration layer. A `kind`/argument mismatch is refused by
 * the handler with `INVALID_ARGUMENT`.
 */
export const MCP_KNOWLEDGE_FACTS_INPUT_SCHEMA: McpToolInputSchema = {
  kind: z.enum(KNOWLEDGE_FACT_KINDS),
  session: z.string().min(1).optional(),
  peerSession: z.string().min(1).optional(),
  operationId: z.string().min(1).optional(),
  projectId: z.string().min(1).optional(),
  provider: z.string().min(1).optional(),
  limit: z.number().int().min(1).max(200).optional(),
  offset: z.number().int().min(0).optional(),
  expected: knowledgeConfigLayerSchema.optional(),
};

const knowledgeFactIdentitySchema = z.object({
  contract: z.string(),
  version: z.number(),
  project: z.string(),
  buildId: z.string(),
  bootId: z.string(),
  serverVersion: z.string().nullable(),
  gitSha: z.string().nullable(),
  builtAt: z.string().nullable(),
  observedAt: z.string(),
});

/**
 * The advertised output shape.
 *
 * `reading` is a record rather than a kind-specific object: the three readings
 * have different fields, and `z.record(z.string(), z.unknown())` keeps every one
 * of them (a closed object would strip the kind-specific keys on validation).
 * The identity envelope is stated field for field, because that is the part a
 * consumer uses to decide which build answered.
 */
export const MCP_KNOWLEDGE_FACTS_OUTPUT_SCHEMA: z.ZodRawShape = {
  identity: knowledgeFactIdentitySchema,
  reading: z.record(z.string(), z.unknown()),
};

/** The payload the tool returns. */
export type McpKnowledgeFactsPayload = {
  identity: KnowledgeFactIdentity;
  reading: KnowledgeFactReading;
};

/** A non-empty string argument, or undefined. */
function readString(value: unknown): string | undefined {
  return typeof value === 'string' && value !== '' ? value : undefined;
}

/** A non-negative integer argument, or undefined. */
function readOffset(value: unknown): number | undefined {
  return typeof value === 'number' && Number.isInteger(value) && value >= 0 ? value : undefined;
}

/** The expected layer, when the caller stated one. */
function readExpected(value: unknown): Partial<KnowledgeConfigLayer> | undefined {
  if (value === null || typeof value !== 'object' || Array.isArray(value)) return undefined;
  const record = value as Record<string, unknown>;
  const layer: Partial<KnowledgeConfigLayer> = {};
  if ('model' in record) layer.model = typeof record.model === 'string' ? record.model : null;
  if ('effort' in record) layer.effort = typeof record.effort === 'string' ? record.effort : null;
  if ('permissionMode' in record) {
    layer.permissionMode = typeof record.permissionMode === 'string' ? record.permissionMode : null;
  }
  return layer;
}

/** Throws `INVALID_ARGUMENT` naming the argument the query omitted. */
function requireSession(kind: string, value: unknown): string {
  const session = readString(value);
  if (session === undefined) {
    throw new McpToolError(
      MCP_ERROR_CODES.INVALID_ARGUMENT,
      `The \`${kind}\` kind requires a non-empty \`session\` argument.`,
      false,
      { fields: [{ path: 'session', problem: 'required' }] },
    );
  }
  return session;
}

/** Turns declared arguments into the port's query, refusing a kind/argument mismatch. */
export function readKnowledgeFactQuery(args: Record<string, unknown>): KnowledgeFactQuery {
  const kind = args.kind;
  const operationId = readString(args.operationId);
  switch (kind) {
    case 'peer_result': {
      const peerSession = readString(args.peerSession);
      return {
        kind,
        session: requireSession(kind, args.session),
        ...(peerSession === undefined ? {} : { peerSession }),
        ...(operationId === undefined ? {} : { operationId }),
      };
    }
    case 'effective_config': {
      const expected = readExpected(args.expected);
      return {
        kind,
        session: requireSession(kind, args.session),
        ...(operationId === undefined ? {} : { operationId }),
        ...(expected === undefined ? {} : { expected }),
      };
    }
    case 'inventory': {
      const projectId = readString(args.projectId);
      const provider = readString(args.provider);
      const offset = readOffset(args.offset);
      return {
        kind,
        ...(projectId === undefined ? {} : { projectId }),
        ...(provider === undefined ? {} : { provider }),
        ...(typeof args.limit === 'number' ? { limit: args.limit } : {}),
        ...(offset === undefined ? {} : { offset }),
      };
    }
    default:
      // Unreachable through the declared schema; kept so a direct caller cannot
      // reach `undefined` as a query kind.
      throw new McpToolError(
        MCP_ERROR_CODES.INVALID_ARGUMENT,
        'The `kind` argument must be one of "peer_result", "effective_config" or "inventory".',
        false,
        { fields: [{ path: 'kind', problem: 'required' }] },
      );
  }
}

/**
 * Builds one reading. A null from the port means the addressed session does not
 * exist; that is the not-found refusal, not an all-unknown fact.
 */
export async function readKnowledgeFacts(
  args: Record<string, unknown>,
  deps: McpKnowledgeFactsDeps,
): Promise<McpKnowledgeFactsPayload> {
  const query = readKnowledgeFactQuery(args);
  const reading = await deps.facts.read(query);
  if (reading === null) {
    const session = 'session' in query ? query.session : '';
    throw new McpToolError(
      MCP_ERROR_CODES.SESSION_NOT_FOUND,
      `No session matches "${session}".`,
      false,
      { fields: [{ path: 'session', problem: 'not found' }] },
    );
  }
  return { identity: deps.facts.identify(), reading };
}

/** Narrows a full deps bag to a wired `knowledgeFacts` bag. */
export function isKnowledgeFactsWired<D extends object>(
  deps: D,
): deps is D & { knowledgeFacts: McpKnowledgeFactsDeps } {
  return (deps as { knowledgeFacts?: unknown }).knowledgeFacts !== undefined;
}

/**
 * Registers `knowledge_facts` with its real handler through the audited
 * registration seam. Consumers: `registerMcpReadTools` and the criterion.
 */
export function registerMcpKnowledgeFactsTool(
  seam: McpReadToolSeam,
  deps: McpKnowledgeFactsDeps,
  registration: McpKnowledgeFactsRegistration,
): void {
  seam({
    name: registration.name,
    description: registration.description,
    requiredScope: registration.requiredScope,
    inputSchema: registration.inputSchema,
    outputSchema: registration.outputSchema,
    handler: (args) => readKnowledgeFacts(args, deps),
  });
}

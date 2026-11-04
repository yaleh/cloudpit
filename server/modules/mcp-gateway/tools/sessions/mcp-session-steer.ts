/**
 * The MCP gateway's `session_steer` handler (gap-mcp-session-steer-tool).
 *
 * A steer REWRITES the turn a session already has in flight: the new input
 * replaces / redirects what the provider's resident process is doing, the
 * thread and the process stay exactly as they were, and no second turn is
 * opened and nothing is queued behind the current one. That is the semantics
 * GOAL-051 AC-444 landed in `CodexHostDriver.steer`
 * (`server/modules/providers/list/codex/codex-host-driver.provider.ts`, whose
 * protocol face lives in `codex-resident-steer.ts`); this module is the MCP
 * face over the SAME driver verb, not a second protocol implementation.
 *
 * ## Provider neutrality
 *
 * The tool is not codex-specific. `steer` is a capability of the host driver a
 * provider exposes, so this module reads it structurally — the same way
 * `provider-runtime.service.ts` reads the resident `run`/`cancelQueuedInput`
 * entries — and refuses with a readable message when the driver serving the
 * session carries no such verb. No provider id is branched on here.
 *
 * ## Why it is not one of `MCP_STAGE4_WRITE_TOOLS`
 *
 * AC-249's criterion pins that table to exactly the five SPEC tools
 * (`session_send` / `session_create` / `session_interrupt` / `session_start` /
 * `session_close`). `session_steer` therefore registers ALONGSIDE them through
 * the same write-tool seam, under the same `cloudcli:session:control` scope
 * `session_interrupt` requires — the `ui_open_session` / `draft_*` /
 * `session_reconfigure` precedent — and only when its deps bag is supplied, so
 * every mount that predates this task keeps registering exactly its old set.
 *
 * ## Refusals
 *
 * A steer with nothing in flight is a REFUSAL, never a silent success: the
 * driver is the authority on "is a turn in flight" and throws its own
 * provider-scoped refusal, which reaches the caller through the gateway's one
 * error envelope. Two refusals are decided here, before any driver call: a
 * session that does not exist (`SESSION_NOT_FOUND`) and a provider whose driver
 * exposes no steer verb (`MCP_TOOL_NOT_IMPLEMENTED`), plus the state refusal
 * "no live resident host serves this session" (`RUN_NOT_FOUND`).
 *
 * Consumers: `registerMcpWriteTools` (the write-tool assembly) and
 * `tests/mcp-session-lifecycle.test.ts`, which drives it through the real
 * `/mcp` mount over a codex host driver backed by an in-memory transport.
 */

import { z } from 'zod';

import type { IProviderHostDriver } from '@/shared/interfaces.js';
import type { HostTurnInput, LLMProvider, ProcessHost } from '@/shared/types.js';

import { MCP_ERROR_CODES, McpToolError } from '../shared/mcp-error-envelope.js';
import type { McpPrincipal } from '../shared/mcp-gateway.auth.js';
import type { McpWriteToolRegistration, McpWriteToolSeam } from '../shared/mcp-write-contract.js';

// --------------------------- the tool identity ---------------------------

/** The tool's `tools/list` name. Registered alongside the five SPEC write tools. */
export const SESSION_STEER_TOOL_NAME = 'session_steer';

/**
 * What `session_steer` says it does on `tools/list`.
 *
 * Deliberately provider-neutral: a provider whose resident host driver exposes
 * a steer verb is supported, every other provider answers with a readable
 * refusal. The sentence also states the two facts AC-444 pins — the CURRENT
 * turn is rewritten, nothing is queued and no new turn is opened.
 */
export const SESSION_STEER_DESCRIPTION =
  'Rewrite the turn a session currently has in flight with new input, leaving the process and the thread alone: nothing is queued and no second turn is opened. ' +
  'A session with no turn in flight is refused. Available for providers whose resident host driver exposes a steer capability.';

// --------------------------- injected services ---------------------------

/**
 * The resident-turn reading a driver may carry beyond `IProviderHostDriver`.
 *
 * Held as a structural type, not added to the shared driver interface, for the
 * same reason `provider-runtime.service.ts` holds `run`/`cancelQueuedInput`
 * that way: `IProviderHostDriver` is the seam every provider shares and this is
 * a capability one (currently codex) implements. The `steer` signature is the
 * driver's own — `(host, appSessionId, turn)` — so the call lands on the SAME
 * verb AC-444 shipped.
 */
type ResidentSteerEntry = {
  steer(host: ProcessHost, appSessionId: string, turn: HostTurnInput): Promise<{ turnId: string }>;
};

/**
 * The services `session_steer` answers from, all injected.
 *
 * `sessions.getSessionById` resolves the session and names its provider (a miss
 * is the structured `SESSION_NOT_FOUND` with no side effects). `resolveHostDriver`
 * is the provider registry's driver lookup the session-hosts router and
 * `createSessionHostControl` already use. `liveHostForSession` is the
 * session-hosts manager's own binding read — the authority on "which process is
 * serving this conversation right now" — so the tool never guesses a host.
 */
export type McpSessionSteerDeps = {
  sessions: {
    getSessionById(sessionId: string): { provider: string } | null | undefined;
  };
  resolveHostDriver(provider: LLMProvider): IProviderHostDriver | null | undefined;
  liveHostForSession(sessionId: string): ProcessHost | null | undefined;
};

// --------------------------- input and payload ---------------------------

/** The `session_steer` tool's typed input. */
export type McpSessionSteerInput = {
  /** The session whose in-flight turn is rewritten. */
  sessionId: string;
  /** The text that becomes the steering input of the current turn. */
  input: string;
};

/** The `session_steer` tool's Zod input shape, used for registration and validation. */
export const SESSION_STEER_INPUT_SCHEMA = {
  sessionId: z.string(),
  input: z.string(),
} satisfies z.ZodRawShape;

/**
 * The `session_steer` result.
 *
 * `turnId` is the turn the driver reports it rewrote — the turn that was
 * already in flight, read back from the provider's own reply rather than
 * assumed. A caller can compare it with the `runId` a previous `session_send`
 * answered with.
 */
export type SessionSteerPayload = {
  sessionId: string;
  turnId: string;
};

/** Reads and validates `session_steer`'s arguments. */
export function readSessionSteerInput(args: Record<string, unknown>): McpSessionSteerInput {
  const sessionId = args.sessionId;
  if (typeof sessionId !== 'string' || sessionId.trim().length === 0) {
    throw new McpToolError(
      MCP_ERROR_CODES.INVALID_ARGUMENT,
      '"sessionId" is required and must be a non-empty string.',
    );
  }
  const input = args.input;
  if (typeof input !== 'string' || input.trim().length === 0) {
    throw new McpToolError(
      MCP_ERROR_CODES.INVALID_ARGUMENT,
      '"input" is required and must be a non-empty string.',
    );
  }
  return { sessionId, input };
}

/** Whether the driver realises the resident steer capability. */
function isSteerCapable(driver: IProviderHostDriver | null | undefined): driver is IProviderHostDriver & ResidentSteerEntry {
  return (
    driver !== null &&
    driver !== undefined &&
    typeof (driver as Partial<ResidentSteerEntry>).steer === 'function'
  );
}

// --------------------------- buildSessionSteer ---------------------------

/**
 * Rewrites the turn `input.sessionId` currently has in flight.
 *
 * Order is load-bearing, and every refusal happens BEFORE the driver is
 * reached: the session is resolved first (a miss is `SESSION_NOT_FOUND`), then
 * the provider's driver is asked whether it carries a steer verb (a driver
 * without one is refused with the provider named), then the session-hosts
 * manager must report a LIVE host for the session (a session with no resident
 * process has no turn to steer). Only then is the driver's own `steer` called,
 * and its answer — including its refusal when no turn is in flight — is handed
 * back unchanged. The adapter never queues and never opens a turn: the only
 * verb it calls is `steer`.
 *
 * Consumers: `registerMcpWriteTools` (the registered handler) and this
 * module's criterion.
 */
export async function buildSessionSteer(
  input: McpSessionSteerInput,
  _ctx: { principal: McpPrincipal },
  deps: McpSessionSteerDeps,
): Promise<SessionSteerPayload> {
  const sessionId = input.sessionId;
  const session = deps.sessions.getSessionById(sessionId);
  if (!session || typeof session.provider !== 'string' || session.provider.length === 0) {
    throw new McpToolError(MCP_ERROR_CODES.SESSION_NOT_FOUND, `No session has id "${sessionId}".`, false, {
      session: sessionId,
    });
  }
  const provider = session.provider;

  const driver = deps.resolveHostDriver(provider as LLMProvider);
  if (!isSteerCapable(driver)) {
    throw new McpToolError(
      MCP_ERROR_CODES.MCP_TOOL_NOT_IMPLEMENTED,
      `Provider "${provider}" does not expose a resident steer capability, so its sessions cannot be steered.`,
      false,
      { session: sessionId, provider },
    );
  }

  const host = deps.liveHostForSession(sessionId);
  if (!host) {
    throw new McpToolError(
      MCP_ERROR_CODES.RUN_NOT_FOUND,
      `This session has no live resident host, so there is no turn in flight to steer.`,
      false,
      { session: sessionId },
    );
  }

  // The driver's own verb: the same `turn/steer` face AC-444 shipped, and the
  // only call this adapter makes. Its "no turn in flight" refusal propagates
  // through the gateway's error envelope unchanged.
  const turn: HostTurnInput = { command: input.input, options: {} };
  const result = await driver.steer(host, sessionId, turn);
  return { sessionId, turnId: result.turnId };
}

// --------------------------- registration ---------------------------

/**
 * Installs `session_steer` through the write-tool seam.
 *
 * The registration's scope is passed in by the assembler (the write table's
 * `cloudcli:session:control`), so this module never restates the vocabulary.
 * Consumers: `registerMcpWriteTools` and this module's criterion.
 */
export function registerMcpSessionSteerTool(
  seam: McpWriteToolSeam,
  deps: McpSessionSteerDeps,
  requiredScope: string,
): void {
  const registration: McpWriteToolRegistration = {
    name: SESSION_STEER_TOOL_NAME,
    description: SESSION_STEER_DESCRIPTION,
    requiredScope,
    inputSchema: SESSION_STEER_INPUT_SCHEMA,
    outputSchema: {
      sessionId: z.string(),
      turnId: z.string(),
    },
    handler: (args, ctx) => buildSessionSteer(readSessionSteerInput(args), ctx, deps),
  };
  seam(registration);
}

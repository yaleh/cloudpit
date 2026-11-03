import { api } from '@/shared/api';
import type { LLMProvider, SessionLifecycleMode } from '@/shared/types';

/**
 * Allocates a session through the session gateway — the single place this
 * frontend performs that call.
 *
 * Two entries in this module can stand for "the first thing said in a brand-new
 * conversation": the composer's first send (`useChatComposerState`) and Live
 * Voice's entry (`ChatInterface`). Both need a stable, server-allocated session
 * id before anything can be addressed to the session — an ordinary `chat.send`,
 * or a voice connection whose server-side send-whitelist is keyed by that id —
 * so both must read the same response body and agree on what counts as a
 * failure. Kept as one function rather than duplicated so the two cannot drift.
 *
 * Throws on a non-2xx response and on a 2xx whose body carries no session id:
 * either way nothing was allocated, so there is no id to bind the conversation
 * to. The message is composed into the caller's own user-visible text.
 */
export type CreatedChatSession = {
  /** The server-allocated id the conversation is addressed by from now on. */
  sessionId: string;
  /**
   * The server's own name for the session, trimmed, or `''` when it returned
   * none — the caller decides what a blank name falls back to.
   */
  sessionName: string;
  /**
   * The lifecycle mode the server actually stored, when it reported one. The
   * server decides the mode when the creation states none, so this is the
   * authoritative reading of the row the caller is about to address.
   */
  lifecycleMode?: SessionLifecycleMode;
};

export async function createChatSession(payload: {
  provider: LLMProvider;
  projectPath: string;
  initialMessage?: unknown;
  /**
   * The composer-level selection the session is created with. Both callers hold
   * it (`currentProviderModel` / `currentProviderEffort` / `permissionMode`) and
   * must pass it: the row is minted here, and a session whose first turn is not a
   * composer send — Live Voice's relayed utterance — never gets a second chance
   * to record one, so its runs would launch as the provider CLI's own default.
   */
  model?: string;
  /**
   * The upstream provider id the model runs under, when the picker stated one.
   * Carried verbatim on the creation so the row records it before the first
   * turn (the id cannot be re-derived from a built-in model's bare value).
   */
  modelProviderId?: string | null;
  effort?: string;
  permissionMode?: string;
  /**
   * The lifecycle mode to create the session with, or absent to let the server
   * apply the provider's declared default. It travels on the creation itself so
   * the row is stored with the mode before any turn exists — the first turn can
   * therefore never run under a mode the caller did not choose.
   */
  lifecycleMode?: SessionLifecycleMode;
}): Promise<CreatedChatSession> {
  const response = await api.providers.createSession(payload);
  if (!response.ok) {
    throw new Error(`Failed to create session (${response.status})`);
  }
  const body = await response.json();
  const sessionId = typeof body?.data?.sessionId === 'string' ? body.data.sessionId : '';
  if (!sessionId) {
    throw new Error('no session id returned.');
  }
  const sessionName =
    typeof body?.data?.sessionName === 'string' ? body.data.sessionName.trim() : '';
  const reportedMode = body?.data?.lifecycleMode;
  const lifecycleMode: SessionLifecycleMode | undefined =
    reportedMode === 'per-run' || reportedMode === 'resident' ? reportedMode : undefined;
  return {
    sessionId,
    sessionName,
    ...(lifecycleMode === undefined ? {} : { lifecycleMode }),
  };
}

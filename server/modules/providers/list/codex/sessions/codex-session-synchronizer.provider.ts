import os from 'node:os';
import path from 'node:path';
import { readFile } from 'node:fs/promises';

import { appConfigDb, sessionsDb } from '@/modules/database/index.js';
import {
  buildLookupMap,
  extractFirstValidJsonlData,
  findFilesRecursivelyCreatedAfter,
  normalizeSessionName,
  readFileTimestamps,
} from '@/shared/utils.js';
import { readCodexTranscriptLastActivity } from '@/modules/providers/list/codex/sessions/codex-transcript-activity.js';
import type { IProviderSessionSynchronizer } from '@/shared/interfaces.js';

type ParsedSession = {
  sessionId: string;
  projectPath: string;
  sessionName?: string;
};

/**
 * The `app_config` marker that makes the content-derived activity pass once per
 * database. Bumping the suffix re-derives every Codex row again.
 */
const LAST_ACTIVITY_BACKFILL_KEY_SUFFIX = 'last_activity_backfill_v1';

/**
 * Session indexer for Codex transcript artifacts.
 */
export class CodexSessionSynchronizer implements IProviderSessionSynchronizer {
  private readonly provider = 'codex' as const;
  private readonly codexHome = path.join(os.homedir(), '.codex');

  /**
   * Scans ~/.codex/sessions and upserts discovered sessions into DB.
   */
  async synchronize(since?: Date): Promise<number> {
    await this.backfillLastActivity();

    const nameMap = await buildLookupMap(path.join(this.codexHome, 'session_index.jsonl'), 'id', 'thread_name');
    const files = await findFilesRecursivelyCreatedAfter(
      path.join(this.codexHome, 'sessions'),
      '.jsonl',
      since ?? null
    );

    let processed = 0;
    for (const filePath of files) {
      const parsed = await this.processSessionFile(filePath, nameMap);
      if (!parsed) {
        continue;
      }

      const existingSession = sessionsDb.getSessionByProviderSessionId(parsed.sessionId)
        ?? sessionsDb.getSessionById(parsed.sessionId);
      if (existingSession) {
        // If session name is untitled and we now have a name, update it
        if (existingSession.custom_name === 'Untitled Codex Session' && parsed.sessionName && parsed.sessionName !== 'Untitled Codex Session') {
          sessionsDb.updateSessionCustomName(existingSession.session_id, parsed.sessionName);
        }
      }

      const timestamps = await readFileTimestamps(filePath);
      sessionsDb.createSession(
        parsed.sessionId,
        this.provider,
        parsed.projectPath,
        parsed.sessionName,
        timestamps.createdAt,
        await this.resolveLastActivity(filePath, timestamps.updatedAt),
        filePath
      );
      processed += 1;
    }

    return processed;
  }

  /**
   * Parses and upserts one Codex session JSONL file.
   */
  async synchronizeFile(filePath: string): Promise<string | null> {
    if (!filePath.endsWith('.jsonl')) {
      return null;
    }

    const nameMap = await buildLookupMap(path.join(this.codexHome, 'session_index.jsonl'), 'id', 'thread_name');
    const parsed = await this.processSessionFile(filePath, nameMap);
    if (!parsed) {
      return null;
    }

    const timestamps = await readFileTimestamps(filePath);
    return sessionsDb.createSession(
      parsed.sessionId,
      this.provider,
      parsed.projectPath,
      parsed.sessionName,
      timestamps.createdAt,
      await this.resolveLastActivity(filePath, timestamps.updatedAt),
      filePath
    );
  }

  /**
   * Resolves the activity time one rollout should be recorded with.
   *
   * The rollout's own newest conversation/turn row wins. A file's mtime moves
   * for reasons that are not activity — a touch, a copy, a backup restore — and
   * it is also what the startup scan uses to NOTICE a changed file, so taking it
   * as the activity time would defeat the very scan being widened here.
   *
   * The mtime is the fallback for the two cases content cannot answer: a
   * rollout with no activity rows yet (a thread the user just created) and one
   * that cannot be read. Neither may end up without a time, or the session
   * disappears from a sidebar that sorts by activity.
   */
  private async resolveLastActivity(
    filePath: string,
    fileUpdatedAt: string | undefined
  ): Promise<string | undefined> {
    return (await readCodexTranscriptLastActivity(filePath)) ?? fileUpdatedAt;
  }

  /**
   * Re-derives `updated_at` for Codex rows indexed before content was read.
   *
   * The startup scan now re-reads a rollout whose mtime moved, but a row whose
   * file has not been touched since the previous build would keep its
   * mtime-derived reading forever. This pass reads the rows from the database
   * (not by walking `~/.codex/sessions` — that walk runs on every list request)
   * and rewrites each one from its content. The `app_config` marker keeps the
   * pass to once per database; bumping the marker suffix re-runs it.
   *
   * A row whose rollout has since been deleted, or records no activity, is left
   * exactly as it is: `pruneOrphanedSessions` owns deletion and a rollout with
   * no activity rows has no better reading to offer.
   */
  private async backfillLastActivity(): Promise<void> {
    const markerKey = `${this.provider}_${LAST_ACTIVITY_BACKFILL_KEY_SUFFIX}`;
    if (appConfigDb.get(markerKey)) {
      return;
    }

    let repaired = 0;
    for (const row of sessionsDb.getSessionsWithTranscriptPath(this.provider)) {
      // A row whose thread the ledger records as retired is the damaged shape
      // the scan reports and deliberately leaves untouched. A timestamp rewrite
      // here would be the scanner writing to a conflicted row behind that
      // report, so it is skipped: recovery is explicit.
      const providerSessionId = sessionsDb.getSessionById(row.session_id)?.provider_session_id;
      if (providerSessionId && sessionsDb.isProviderSessionSuperseded(providerSessionId, this.provider)) {
        continue;
      }

      const lastActivity = await readCodexTranscriptLastActivity(row.jsonl_path);
      if (lastActivity && sessionsDb.updateSessionUpdatedAt(row.session_id, lastActivity)) {
        repaired += 1;
      }
    }

    appConfigDb.set(markerKey, new Date().toISOString());

    if (repaired > 0) {
      console.log(
        `[Sessions] Re-derived last activity from transcript content for ${repaired} Codex session row(s).`
      );
    }
  }

  /**
   * Extracts session metadata from one Codex JSONL session file.
   */
  private async processSessionFile(
    filePath: string,
    nameMap: Map<string, string>
  ): Promise<ParsedSession | null> {
    const parsed = await extractFirstValidJsonlData(filePath, (rawData) => {
      const data = rawData as Record<string, unknown>;
      const payload = data.payload as Record<string, unknown> | undefined;
      const sessionId = typeof payload?.id === 'string' ? payload.id : undefined;
      const projectPath = typeof payload?.cwd === 'string' ? payload.cwd : undefined;

      if (!sessionId || !projectPath) {
        return null;
      }

      return {
        sessionId,
        projectPath,
        isSubagent: payload ? this.isSubagentSessionMeta(payload) : false,
      };
    });

    if (!parsed || parsed.isSubagent) {
      return null;
    }

    // A thread a session was edited off is left on disk on purpose, but it is
    // nobody's conversation any more. Re-indexing it would add a sidebar entry
    // for the version the user edited away from — and for a session that was
    // itself discovered from disk, whose app id is its original thread id, it
    // would hand the row back to that thread.
    if (sessionsDb.isProviderSessionSuperseded(parsed.sessionId, this.provider)) {
      // The other half of the invariant is a damaged row from a previous
      // build: it still claims this thread while the ledger says it is
      // retired. Do NOT clear the mark or write the path here — an indexer
      // guessing a recovery is how that row was made. Report it and leave both
      // records untouched; recovery is explicit (docs/operations/session-binding-recovery.md).
      const claimedBy = sessionsDb.getSessionByProviderSessionId(parsed.sessionId);
      if (claimedBy) {
        console.warn(
          '[CodexSessionSynchronizer] A session still claims a thread the ledger records as retired; '
          + 'leaving the row and the retirement record untouched — explicit recovery is required',
          {
            sessionId: claimedBy.session_id,
            providerSessionId: parsed.sessionId,
            filePath,
          },
        );
      }
      return null;
    }

    // App-created sessions are keyed by an app id, so disk-discovered provider
    // ids must be resolved through the provider-id mapping first.
    const existingSession = sessionsDb.getSessionByProviderSessionId(parsed.sessionId)
      ?? sessionsDb.getSessionById(parsed.sessionId);
    const existingSessionName = existingSession?.custom_name;
    if (existingSessionName && existingSessionName !== 'Untitled Codex Session') {
      return {
        ...parsed,
        sessionName: normalizeSessionName(existingSessionName, 'Untitled Codex Session'),
      };
    }

    let sessionName = nameMap.get(parsed.sessionId);
    if (!sessionName) {
      sessionName = await this.extractLastAgentMessageFromEnd(filePath);
    }

    return {
      ...parsed,
      sessionName: normalizeSessionName(sessionName, 'Untitled Codex Session'),
    };
  }

  /**
   * Returns true when a session_meta payload belongs to a Codex sub-agent
   * thread (Codex >=0.144 collaboration spawn_agent, review, compact, etc.).
   * Sub-agent rollouts live in the same sessions tree as user sessions, so
   * they must be skipped here to stay out of the sidebar — the Codex
   * equivalent of the Claude synchronizer's subagent transcript skip.
   * Top-level sessions carry thread_source "user" and a string source
   * ("exec"/"cli"); sub-agents carry thread_source "subagent" and an object
   * source keyed by "subagent".
   */
  private isSubagentSessionMeta(payload: Record<string, unknown>): boolean {
    if (payload.thread_source === 'subagent') {
      return true;
    }

    const source = payload.source;
    return typeof source === 'object' && source !== null && 'subagent' in source;
  }

  private async extractLastAgentMessageFromEnd(filePath: string): Promise<string | undefined> {
    try {
      const content = await readFile(filePath, 'utf8');
      const lines = content.split(/\r?\n/);

      for (let index = lines.length - 1; index >= 0; index -= 1) {
        const line = lines[index]?.trim();
        if (!line) {
          continue;
        }

        let parsed: unknown;
        try {
          parsed = JSON.parse(line);
        } catch {
          continue;
        }

        const data = parsed as Record<string, unknown>;
        const eventType = typeof data.type === 'string' ? data.type : undefined;
        const payload = data.payload as Record<string, unknown> | undefined;
        const payloadType = typeof payload?.type === 'string' ? payload.type : undefined;
        const lastAgentMessage = typeof payload?.last_agent_message === 'string'
          ? payload.last_agent_message
          : undefined;

        if (eventType === 'event_msg' && payloadType === 'task_complete' && lastAgentMessage?.trim()) {
          return lastAgentMessage;
        }
      }
    } catch {
      // Ignore missing/unreadable files so sync can continue.
    }

    return undefined;
  }
}

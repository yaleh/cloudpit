/**
 * The local UI view-event log — persistence half of the view instrumentation.
 *
 * The browser reports the viewing episodes it leaves (`{ at, kind, target, fromTarget,
 * dwellMs, deviceId }`) and this service appends them, one JSON object per line, to a file that
 * never leaves this machine. It is deliberately NOT a database table: the log is per-host
 * observation data for the weekly report, not user state that should synchronise across devices.
 *
 * DUAL WRITE. The same episode is also published into the host-level context stream as one
 * `ui.view` row, which is what lets quay-fleet's behaviour experiments read whether the person
 * was in the cockpit or in a session. The local carrier's path, switch, 204 and batch-ceiling
 * semantics are unchanged, and a stream failure is swallowed. The switch gates BOTH carriers.
 *
 * The path and the switch come from the server settings file's `observation.viewEvents` block.
 * The switch is enforced HERE, not only in the browser: with it off the route still answers
 * 204 (the caller did nothing wrong) and nothing is written.
 *
 * Consumers: `server/modules/observation/view-events.routes.ts` (the HTTP face) and
 * `server/modules/observation/observation.module.ts` (composition). The shipped defaults are
 * re-exported through the module barrel for `server/modules/settings/server-settings.ts`.
 */
import { appendFile, mkdir } from 'node:fs/promises';
import { homedir } from 'node:os';
import path from 'node:path';

import {
  createContextEventWriter,
  type AppendContextEventResult,
  type ContextEventDraft,
} from '@/modules/context-events/index.js';
import { expandHome } from '@/shared/settings-file.js';
import { AppError, isRecord } from '@/shared/utils.js';

/** The kind of reading the reader left. Mirrors the frontend's `ViewEventKind`. */
export type ViewEventKind = 'session' | 'tab' | 'cockpit-tile' | 'cockpit-preview';

/**
 * The `data` payload of one `ui.view` row: the local episode with its `kind` renamed `view`.
 * quay-fleet's experiments read these five fields, so a rename or a dropped member is a
 * contract break, not a refactor.
 */
export type UiViewEventData = {
  view: ViewEventKind;
  target: string;
  fromTarget: string | null;
  dwellMs: number;
  deviceId: string;
};

/**
 * One validated viewing episode, with exactly the fields the log keeps.
 *
 * `at` is the leave timestamp in ms since epoch, `dwellMs` the visible time of the episode,
 * `fromTarget` the target the reader came from (null for the first episode of a page), and
 * `deviceId` the browser's stable identity from the MCP client registry.
 */
export type ViewEventRecord = {
  at: number;
  kind: ViewEventKind;
  target: string;
  fromTarget: string | null;
  dwellMs: number;
  deviceId: string;
};

/** The `observation.viewEvents` server setting, as the module consumes it. */
export type ViewEventsSettings = {
  enabled: boolean;
  path: string;
};

/** The shipped switch: recording starts on, an operator turns it off in the settings file. */
export const DEFAULT_VIEW_EVENTS_ENABLED = true;

/**
 * The shipped log path, resolved at call time so a HOME set by the process (or by a criterion)
 * is the HOME consulted. `~/.cloudcli/` is the same local state directory the server already
 * uses; the file stays outside the repository and outside the synced database.
 */
export function defaultViewEventsPath(): string {
  return path.join(homedir(), '.cloudcli', 'ui-view-events.jsonl');
}

/** Fills a partial reading with the shipped defaults (used by the module's own composition). */
export function resolveViewEventsSettings(partial: Partial<ViewEventsSettings> = {}): ViewEventsSettings {
  return {
    enabled: partial.enabled ?? DEFAULT_VIEW_EVENTS_ENABLED,
    // The shared expander takes the home directory explicitly so a criterion can pin it.
    path: expandHome(partial.path ?? defaultViewEventsPath(), homedir()),
  };
}

/** One batch's size ceiling. An oversized body is refused whole rather than truncated. */
export const MAX_VIEW_EVENTS_PER_BATCH = 200;

/** Longest accepted free-text field, so one bad caller cannot write an unbounded line. */
const MAX_TEXT_LENGTH = 512;

/** Longest accepted device id; the registry's ids are UUIDs. */
const MAX_DEVICE_ID_LENGTH = 200;

const VIEW_EVENT_KINDS: ReadonlySet<string> = new Set<ViewEventKind>([
  'session',
  'tab',
  'cockpit-tile',
  'cockpit-preview',
]);

/** The service the routes call: validate one batch, append it, or explain why not. */
export type ViewEventService = {
  /** Appends a validated batch and resolves the number of lines written (0 when disabled). */
  appendBatch: (body: unknown) => Promise<number>;
};

/**
 * The context-stream seam: one `ui.view` draft in, the context writer's result out.
 *
 * Production leaves it unset and appends through a writer it owns; a criterion injects its own,
 * so no fleet installation and no host file are needed. A rejected result is never inspected —
 * a stream the local carrier must survive, not an error for the caller.
 */
export type ViewContextEventPublisher = (
  draft: ContextEventDraft,
) => Promise<AppendContextEventResult | null> | AppendContextEventResult | null;

/** Construction seams; production supplies none. */
export type ViewEventServiceOptions = {
  publishContextEvent?: ViewContextEventPublisher;
};

/**
 * The production publisher: one writer owned by this service instance. Building it performs no
 * I/O — the fleet schema is read on the first append, so a missing fleet is a reading then.
 */
function createDefaultContextPublisher(): ViewContextEventPublisher {
  const writer = createContextEventWriter();
  return (draft) => writer.append(draft);
}

function invalid(message: string, statusCode = 400, code = 'INVALID_REQUEST'): AppError {
  return new AppError(message, { code, statusCode });
}

/** A bounded, non-empty string, or null when the value is not one. */
function readText(value: unknown, maxLength: number): string | null {
  if (typeof value !== 'string') return null;
  const trimmed = value.trim();
  if (trimmed === '' || trimmed.length > maxLength) return null;
  return trimmed;
}

/** One raw event reduced to the fields the log keeps, or an AppError naming the field. */
function parseViewEvent(raw: unknown, index: number): ViewEventRecord {
  if (!isRecord(raw)) throw invalid(`\`events[${index}]\` must be a JSON object`);

  const at = raw.at;
  if (typeof at !== 'number' || !Number.isFinite(at) || at < 0) {
    throw invalid(`\`events[${index}].at\` must be a non-negative number`);
  }

  const kind = typeof raw.kind === 'string' && VIEW_EVENT_KINDS.has(raw.kind) ? (raw.kind as ViewEventKind) : null;
  if (kind === null) {
    throw invalid(`\`events[${index}].kind\` must be one of session, tab, cockpit-tile, cockpit-preview`);
  }

  const target = readText(raw.target, MAX_TEXT_LENGTH);
  if (target === null) throw invalid(`\`events[${index}].target\` must be a non-empty string of at most ${MAX_TEXT_LENGTH} characters`);

  const fromTarget = raw.fromTarget === null || raw.fromTarget === undefined ? null : readText(raw.fromTarget, MAX_TEXT_LENGTH);
  if (raw.fromTarget !== null && raw.fromTarget !== undefined && fromTarget === null) {
    throw invalid(`\`events[${index}].fromTarget\` must be null or a non-empty string of at most ${MAX_TEXT_LENGTH} characters`);
  }

  const dwellMs = raw.dwellMs;
  if (typeof dwellMs !== 'number' || !Number.isFinite(dwellMs) || dwellMs < 0) {
    throw invalid(`\`events[${index}].dwellMs\` must be a non-negative number`);
  }

  const deviceId = readText(raw.deviceId, MAX_DEVICE_ID_LENGTH);
  if (deviceId === null) throw invalid(`\`events[${index}].deviceId\` must be a non-empty string of at most ${MAX_DEVICE_ID_LENGTH} characters`);

  // Only the known fields are written; extras are ignored rather than persisted.
  return { at, kind, target, fromTarget, dwellMs, deviceId };
}

/**
 * Validates one request body into the records to append.
 *
 * The batch shape is `{ events: [...] }`. An empty array is accepted as a no-op; an oversized
 * one is refused whole (413) so a client that ignores the ceiling learns about it instead of
 * having its history silently truncated.
 */
export function parseViewEventBatch(body: unknown): ViewEventRecord[] {
  if (!isRecord(body)) throw invalid('body must be a JSON object with an `events` array');
  const events = body.events;
  if (!Array.isArray(events)) throw invalid('`events` must be an array');
  if (events.length > MAX_VIEW_EVENTS_PER_BATCH) {
    throw invalid(
      `\`events\` carries ${events.length} records, over the batch limit of ${MAX_VIEW_EVENTS_PER_BATCH}`,
      413,
      'BATCH_TOO_LARGE',
    );
  }
  return events.map(parseViewEvent);
}

/**
 * Builds the service over one reading of `observation.viewEvents`.
 *
 * Consumers: `server/modules/observation/observation.module.ts`; the criterion
 * `tests/view-events.test.ts` injects `publishContextEvent` to read the stream without a fleet.
 */
export function createViewEventService(
  settings: ViewEventsSettings,
  options: ViewEventServiceOptions = {},
): ViewEventService {
  const filePath = settings.path;
  const publishContextEvent = options.publishContextEvent ?? createDefaultContextPublisher();

  return {
    appendBatch: async (body: unknown): Promise<number> => {
      if (!settings.enabled) return 0;
      const records = parseViewEventBatch(body);
      if (records.length === 0) return 0;
      const line = records.map((record) => `${JSON.stringify(record)}\n`).join('');
      try {
        await mkdir(path.dirname(filePath), { recursive: true });
        await appendFile(filePath, line, 'utf8');
      } catch (failure) {
        const reason = failure instanceof Error ? failure.message : String(failure);
        throw new AppError(`could not append to ${filePath}: ${reason}`, {
          code: 'VIEW_EVENT_WRITE_FAILED',
          statusCode: 500,
        });
      }
      // The local carrier has landed; now publish the same episodes to the host stream. One
      // row per episode, carrying the episode's own `at` (not the flush time) and exactly the
      // five data members the fleet experiments read. A stream failure is contained HERE so it
      // can never turn a recorded episode into a failed request.
      for (const record of records) {
        const data: UiViewEventData = {
          view: record.kind,
          target: record.target,
          fromTarget: record.fromTarget,
          dwellMs: record.dwellMs,
          deviceId: record.deviceId,
        };
        try {
          await publishContextEvent({ kind: 'ui.view', at: new Date(record.at).toISOString(), data });
        } catch {
          // A secondary carrier's failure does not undo the local log.
        }
      }
      return records.length;
    },
  };
}

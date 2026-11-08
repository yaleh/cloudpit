import type { IncomingMessage } from 'node:http';

//----------------- HTTP RESPONSE SHAPES ------------
/**
 * Canonical success envelope used by backend APIs that return a structured payload.
 *
 * Use this for route handlers that need a stable `success/data` shape so frontend
 * consumers can parse responses consistently across endpoints.
 */
export type ApiSuccessShape<TData = unknown> = {
  success: true;
  data: TData;
};

/**
 * Generic plain-object record used when parsing loosely typed JSON payloads.
 *
 * Use this only after runtime shape checks, not as a replacement for validated
 * domain models.
 */
export type AnyRecord = Record<string, any>;

// ---------------------------
//----------------- WEBSOCKET TRANSPORT TYPES ------------
/**
 * Minimal websocket client contract used by backend broadcaster services.
 *
 * Any transport object added to `connectedClients` must implement these two
 * members so shared services can safely send JSON strings and check whether the
 * socket is still open before broadcasting.
 */
export type RealtimeClientConnection = {
  readyState: number;
  send(data: string): void;
};

/**
 * Authenticated user payload attached to websocket upgrade requests.
 *
 * Platform and OSS auth flows currently use either `id` or `userId`; both are
 * represented here so websocket handlers can resolve a stable writer user id.
 */
export type AuthenticatedWebSocketUser = {
  id?: string | number;
  userId?: string | number;
  username?: string;
  [key: string]: unknown;
};

/**
 * HTTP upgrade request shape after websocket authentication succeeds.
 *
 * `verifyClient` populates `request.user` with the authenticated payload, and
 * downstream websocket handlers rely on this extended request type.
 */
export type AuthenticatedWebSocketRequest = IncomingMessage & {
  user?: AuthenticatedWebSocketUser;
};

// ---------------------------

//----------------- UI CLIENT IDENTITY ------------
/**
 * One browser tab currently connected and identified, as published by the UI
 * client registry's read port (`listUiClients`).
 *
 * A tab is the unit the registry stores; a device is the grouping it derives.
 * `connectedAt` is the server's clock at the moment this tab's `ui.hello`
 * arrived, so a caller can tell a long-lived tab from one that just opened.
 */
export type UiClientTab = {
  /** This tab's own id (sessionStorage-scoped in the browser). */
  tabId: string;
  /** The name this tab announced; devices group tabs that may carry different names. */
  deviceName: string;
  /** Epoch milliseconds when this tab's identity reached the server. */
  connectedAt: number;
};

/**
 * One device (one browser) currently connected, with every identified tab of it.
 *
 * `deviceId` is the browser's stable id and is what a caller addresses a device
 * by. `deviceName` is the name of this device's most recently connected tab, so
 * a rename announced by the newest tab is what a listing shows.
 *
 * The connection a tab arrived on is deliberately absent: identity is addressed
 * by device and tab, never by a socket, whose id changes on every reconnect.
 */
export type UiClientDevice = {
  /** The browser's stable id; survives reloads, changes only when site data is cleared. */
  deviceId: string;
  /** The device's display name, taken from its most recently connected tab. */
  deviceName: string;
  /** Every identified tab of this device, oldest connection first. */
  tabs: UiClientTab[];
};

// ---------------------------
//----------------- UI VISIBLE CONTEXT ------------
/**
 * One connection the UI-state round trip can address.
 *
 * The registry holds the live socket behind an announced identity, which is
 * exactly the pair the round trip needs: it must WRITE to that socket and
 * REPORT the answering tab by the identity a caller can name. Only the round
 * trip's own service reads this port, so the socket reached here is never
 * published to a caller — the registry's own `listUiClients` projection stays
 * the one read surface the MCP tools are handed.
 */
export type UiStateRequestTarget = {
  /** The live connection this identity arrived on. */
  connection: RealtimeClientConnection;
  deviceId: string;
  tabId: string;
  deviceName: string;
  /** Epoch ms when this identity reached the server. */
  connectedAt: number;
};

/** The Git diffs a tab has expanded; a collection, because the panel expands many at once. */
export type UiCurrentDiff = {
  /** The active Git sub-view: 'changes' | 'history' | 'branches' | 'worktrees'. */
  view: string;
  /** Workspace file paths expanded in the changes view. */
  files: string[];
  /** Commit hashes expanded in the history view. */
  commits: string[];
};

/** The task a tab has focused; `source` disambiguates the TaskMaster / quay id namespaces. */
export type UiCurrentTask = {
  /** Which task system this id belongs to. Only TaskMaster has a selection surface. */
  source: 'taskmaster';
  /** The task's id in its own namespace. */
  id: string;
  /** The task's title, or null when the surface carries none. */
  title: string | null;
};

/** The user's transcript selection as it crosses this boundary: reduced, but still content. */
export type UiSelectedTextReading = {
  text: string;
  truncated: boolean;
  region: 'transcript';
};

/**
 * What one tab reports about what it is showing, as the server reads it off a
 * `ui.state_response` frame.
 *
 * Identifiers and ranges ONLY — message ids, counts, and the names of things.
 * A message body and a panel's content are deliberately not representable here:
 * the server projects a frame down to exactly these fields, so a browser that
 * sends more (or a fixture that injects one) cannot widen what a caller reads.
 * The one content-bearing field, `selectedText`, is projected but then delivered
 * only through the separately-scoped `ui_selected_text` tool; `ui_visible_context`
 * strips it, so a cloudcli:read caller can never read the text.
 */
export type UiVisibleContextReport = {
  /** This device's own navigation policy at the moment it answered. */
  navigationPolicy: string;
  /** The Git diffs this tab has expanded; null when the Git panel is not active. */
  currentDiff: UiCurrentDiff | null;
  /** The TaskMaster task this tab has focused, or null. */
  currentTask: UiCurrentTask | null;
  /** The transcript selection this tab holds, or null. Content is scoped separately. */
  selectedText: UiSelectedTextReading | null;
  /** Whether the page was in the foreground. */
  visibility: 'visible' | 'hidden';
  /** Whether this tab held keyboard focus. */
  hasFocus: boolean;
  /** Epoch ms of the last moment this tab was focused; null when it never was. */
  lastFocusedAt: number | null;
  /** The workspace panel this tab is showing, or null when none is known. */
  panel: string | null;
  /** The project this tab has open, or null. */
  selectedProject: string | null;
  /** The session this tab has open, or null. */
  selectedSession: string | null;
  /** The first and last message ids currently visible in the transcript. */
  visibleMessages: { first: string | null; last: string | null };
  /** How many tool approvals are waiting for the user in this tab. */
  pendingApprovals: number;
  /** How many of this tab's messages are still waiting in the send queue. */
  queuedMessages: number;
};

/** The frame the server broadcasts to ask every connected tab what it is showing. */
export type UiStateRequestFrame = {
  type: 'ui.state_request';
  requestId: string;
};

/**
 * The frame a tab answers a `ui.state_request` with.
 *
 * `requestId` is echoed verbatim so the server can match the answer to the
 * request it belongs to and drop anything else. The identity fields are the
 * tab's own; the remaining fields are {@link UiVisibleContextReport}, which is
 * the whole of what may cross this boundary.
 */
export type UiStateResponseFrame = {
  type: 'ui.state_response';
  requestId: string;
  deviceId: string;
  tabId: string;
  deviceName: string;
} & UiVisibleContextReport;

/**
 * One tab as a UI-visible-context reading reports it: the identity the server
 * addressed it by, plus the report it answered with.
 *
 * An unanswered tab is the same shape with `unresponsive: true` and every report
 * field null — "this tab did not answer" is a fact about the reading, not a
 * failure of it, so it is carried in the result rather than thrown.
 */
export type UiVisibleContextTab = {
  tabId: string;
  deviceName: string;
  /** True when the tab was asked and did not answer inside the window. */
  unresponsive: boolean;
  navigationPolicy: string | null;
  visibility: 'visible' | 'hidden' | null;
  hasFocus: boolean | null;
  lastFocusedAt: number | null;
  panel: string | null;
  selectedProject: string | null;
  selectedSession: string | null;
  visibleMessages: { first: string | null; last: string | null } | null;
  pendingApprovals: number | null;
  queuedMessages: number | null;
  currentDiff: UiCurrentDiff | null;
  currentTask: UiCurrentTask | null;
  /** The transcript selection this tab held; null for a tab that did not answer. */
  selectedText: UiSelectedTextReading | null;
};

/**
 * One device's tabs, as a UI-visible-context reading reports them.
 *
 * `lastFocusedAt` is the newest focus moment across this device's tabs and is
 * what the listing is ordered by, so "which device is the user actually looking
 * at" is the first row rather than a fact to be derived by the caller.
 */
export type UiVisibleContextDevice = {
  deviceId: string;
  deviceName: string;
  /** The newest tab focus moment of this device; null when none of its tabs answered. */
  lastFocusedAt: number | null;
  /** This device's tabs, most recently focused first. */
  tabs: UiVisibleContextTab[];
};

// ---------------------------
//----------------- UI NAVIGATION ------------
/**
 * What a `ui.navigate` instruction asks the browser to reveal.
 *
 * Three of these land inside the named session and so make it the active one:
 * `{ latest: true }` (the transcript's tail), `{ messageId }` (one message) and
 * `{ turnId }` (a turn, addressed by its `messageAnchorId` per
 * turn-message-addressing). The other two change WHAT the workspace shows without
 * changing the active session: `{ diffFile }` (a file's diff, the path relative to
 * the session's project) and `{ taskId }` (a task's detail). The distinction
 * matters downstream: only a session-opening position fires the
 * applied-notification that feeds `ui_last_opened_session`, because revealing a
 * diff or a task is not opening a session.
 *
 * Every id comes from a `ui_visible_context` / `session_read` reading rather than
 * being guessed.
 */
export type UiNavigationPosition =
  | { latest: true }
  | { messageId: string }
  | { turnId: string }
  | { diffFile: string }
  | { taskId: string };

/** Whether a position makes its session the active one (as opposed to revealing a diff or a task). */
export function isSessionOpeningPosition(at: UiNavigationPosition): boolean {
  return 'latest' in at || 'messageId' in at || 'turnId' in at;
}

/**
 * The frame the server writes to one device's tabs to ask them to open a session
 * and land at a position.
 *
 * It is the OPPOSITE direction from `ui.state_request`: the server is not asking
 * a question, it is delivering an instruction, and `navigationId` is what the
 * browser echoes back so the answer can be matched to the instruction that
 * minted it. The frame carries no identity of its own — the server knows which
 * socket it wrote to, and the browser answers with its own `deviceId` /
 * `tabId`.
 */
export type UiNavigateFrame = {
  type: 'ui.navigate';
  navigationId: string;
  sessionId: string;
  at: UiNavigationPosition;
};

/**
 * How a browser received a `ui.navigate` — the DELIVERY ack.
 *
 *  - `shown`: the tab is showing the user a confirmation bar (the device's
 *    policy is "ask"); the tool reports `pending_user`.
 *  - `applied`: the tab navigated immediately (policy "accept", or a policy that
 *    requires no confirmation); the tool reports `applied`.
 *  - `declined`: the tab refused the instruction (policy "reject").
 *
 * The ack says nothing about a LATER decision: an `ask` tab answers `shown` now
 * and reports what the user chose through `ui.navigate_result`.
 */
export type UiNavigationAck = 'shown' | 'applied' | 'declined';

/**
 * The frame a tab answers a `ui.navigate` with, immediately on delivery.
 *
 * `navigationId` and the two identity fields are echoed so the server can match
 * the ack to the instruction it wrote and record which tab received it.
 */
export type UiNavigateAckFrame = {
  type: 'ui.navigate_ack';
  navigationId: string;
  deviceId: string;
  tabId: string;
  status: UiNavigationAck;
};

/**
 * The final outcome of a navigation, as a tab reports it after the user decided.
 *
 * Only an `ask` device reaches this frame later than the ack: it answered
 * `shown`, and this is the user's verdict (or the reason none was reached). An
 * `accept` / `reject` device's ack IS its final outcome and no result frame
 * follows.
 *
 *  - `applied`  — the browser opened the session (this is what writes the
 *    "last opened" pointer);
 *  - `declined` — the user said no;
 *  - `ignored`  — the user dismissed the prompt without answering;
 *  - `superseded` — a newer navigation to the same tab arrived first;
 *  - `expired`  — the prompt timed out unanswered.
 */
export type UiNavigationFinalStatus = 'applied' | 'declined' | 'ignored' | 'superseded' | 'expired';

/** The frame a tab reports a navigation's final outcome with. */
export type UiNavigateResultFrame = {
  type: 'ui.navigate_result';
  navigationId: string;
  deviceId: string;
  tabId: string;
  status: UiNavigationFinalStatus;
};

/**
 * A navigation's status as a caller reads it.
 *
 * `pending_user` is the one non-terminal value: the bar is up and the user has
 * not decided yet. Everything else is final and is what `ui_visible_context`'s
 * `navigations[]` reports.
 */
export type UiNavigationStatus =
  | 'applied'
  | 'declined'
  | 'pending_user'
  // The delivery window closed with no ack: nobody was listening, or the tab that
  // was is gone. Distinct from every browser-reported verdict because it says
  // nothing about what the user wanted — only that the instruction did not land.
  | 'unresponsive'
  | UiNavigationFinalStatus;

/**
 * One navigation as the server remembers it in memory.
 *
 * This is the record `ui_open_session` returns (the delivery reading) and the
 * one `ui_visible_context`'s `navigations[]` lists (the as-of-now reading): the
 * same row, mutated in place when the browser reports a final outcome. It is
 * never persisted — a navigation is about a live socket, and a restart makes
 * every unanswered record meaningless.
 */
export type UiNavigationRecord = {
  navigationId: string;
  /** The device the instruction was addressed to. */
  deviceId: string;
  deviceName: string;
  /** The tab that acknowledged it; null while nothing has answered. */
  tabId: string | null;
  sessionId: string;
  at: UiNavigationPosition;
  /** The MCP client that asked (`clientId`), or null for a personal access token. */
  requestedBy: string | null;
  /** Epoch ms the instruction was written. */
  requestedAt: number;
  /** Epoch ms of the last status change. */
  updatedAt: number;
  status: UiNavigationStatus;
};

// ---------------------------

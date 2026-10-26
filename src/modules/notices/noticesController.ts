import { api } from '@/shared/api';

/**
 * The notices controller: every rule of the notice reading, kept in one object that does not
 * depend on React.
 *
 * The hook that used to own this logic rendered each rule through React state and a ref. Here
 * there is one mutable reading plus one cached snapshot: commands change the reading and notify
 * subscribers, and `getSnapshot` hands React a value whose identity only changes when the
 * reading actually changed.
 *
 * The rules, unchanged from the hook this replaced:
 *
 * - The reading is polled every {@link NOTICES_POLL_INTERVAL_MS}, starting with one immediate
 *   read when the controller is created.
 * - A failed reading is only reported before any reading ever landed (`unavailable`). A later
 *   failure keeps the last good reading: the notice it carries may still be actionable, and
 *   erasing it would make a live condition vanish from the slot.
 * - A dismissal that answers 409 is not an error: the notice moved to a new revision between our
 *   read and the write, so the server is right and our copy is stale. Re-read silently.
 * - `dispose` ends the poll and the subscription; a reading that lands afterwards is dropped.
 *
 * Consumers: `useNotices` (the React binding), which subscribes and forwards the two writes, and
 * the controller criterion.
 */

/**
 * The client half of the notice model: the same wire shape `server/modules/notices` publishes
 * through `GET /api/notices`. It is duplicated rather than imported because the server tree and
 * the browser bundle do not share types, and the shape is the contract the route documents.
 */
export type NoticeLifecycle = 'event' | 'condition' | 'decision';

/** How loudly a notice may interrupt; `blocking` outranks `attention`, which outranks `info`. */
export type NoticeSeverity = 'info' | 'attention' | 'blocking';

/** The one action the slot may offer. `id` picks the confirm panel; `labelKey` is an i18n key. */
export type NoticePrimaryAction = {
  id: string;
  labelKey: string;
};

/** One 「need to know」 entry as `GET /api/notices` returns it. `title` is an i18n key. */
export type Notice = {
  id: string;
  source: string;
  lifecycle: NoticeLifecycle;
  severity: NoticeSeverity;
  revision: string;
  scope: 'global';
  title: string;
  params: Record<string, string | number>;
  primaryAction?: NoticePrimaryAction;
  raisedAt: string;
};

/** A user's answer to `GET /api/notices`: the entries the slot may show and the ones this user
 * dismissed at their current revision (the inbox's 「已忽略」 section). */
export type NoticeList = {
  active: Notice[];
  dismissed: Notice[];
};

/** Reads the user's notices. Injected in tests; the default talks to `/api/notices`. */
export type NoticeListPort = () => Promise<NoticeList>;

/** Sends the revision-bound dismissal. The response is read only for its status: a 409 means
 * the notice changed under the caller and the reading must be refreshed, not reported. */
export type NoticeDismissPort = (id: string, revision: string) => Promise<Response>;

/** What the notices surfaces read. `unavailable` is only reachable before any reading arrived;
 * a failed later poll keeps the last good reading rather than erasing a notice still on screen. */
export type NoticesView =
  | { status: 'loading' }
  | { status: 'ready'; active: Notice[]; dismissed: Notice[] }
  | { status: 'unavailable'; reason: string };

/** Starts and cancels the poll timer; injectable so tests need no wall clock. */
export type NoticesClock = {
  setInterval: (callback: () => void, milliseconds: number) => unknown;
  clearInterval: (handle: unknown) => void;
};

/** What the controller needs from the outside: the two ports and the scheduler. */
export type NoticesControllerOptions = {
  /** Reads the list; defaults to `GET /api/notices`. */
  list?: NoticeListPort;
  /** Sends a revision-bound dismissal; defaults to `DELETE /api/notices/:id`. */
  dismiss?: NoticeDismissPort;
  /** Poll period; defaults to {@link NOTICES_POLL_INTERVAL_MS}. */
  pollMs?: number;
  /** The timer seam; defaults to the page's own interval functions. */
  clock?: NoticesClock;
};

/** The commands and subscription surface the hook drives. */
export type NoticesController = {
  /** Registers a listener; the returned function unsubscribes it. */
  subscribe: (listener: () => void) => () => void;
  /** The stable reading; its identity changes only when the reading changed. */
  getSnapshot: () => NoticesView;
  /** Re-reads the list now, e.g. after a dismissal or after a confirmed deploy. */
  refresh: () => Promise<void>;
  /** Dismisses one notice at the revision it was read at. A 409 re-reads silently. */
  dismiss: (notice: Notice) => Promise<void>;
  /** Stops the poll and the subscribers; a controller is not reusable afterwards. */
  dispose: () => void;
};

/** The poll the compact deploy strip used; the notice registry inherits it unchanged. */
export const NOTICES_POLL_INTERVAL_MS = 15_000;

const defaultList: NoticeListPort = async () => {
  const response = await api.notices.list();
  if (!response.ok) {
    throw new Error(`GET /api/notices answered ${response.status}`);
  }
  return (await response.json()) as NoticeList;
};

const defaultDismiss: NoticeDismissPort = (id, revision) => api.notices.dismiss(id, revision);

const defaultClock: NoticesClock = {
  setInterval: (callback, milliseconds) => globalThis.setInterval(callback, milliseconds),
  clearInterval: (handle) => globalThis.clearInterval(handle as ReturnType<typeof setInterval>),
};

/** Two readings are the same reading when nothing a surface shows has changed. */
function sameView(left: NoticesView, right: NoticesView): boolean {
  if (left.status !== right.status) return false;
  if (left.status === 'ready' && right.status === 'ready') {
    return left.active === right.active && left.dismissed === right.dismissed;
  }
  if (left.status === 'unavailable' && right.status === 'unavailable') {
    return left.reason === right.reason;
  }
  return true;
}

/**
 * Build one controller.
 *
 * `list` and `dismiss` are the only transports it knows and `clock` is the only scheduler — all
 * injected so the rules can be exercised without React, the network or a wall clock. The first
 * read and the poll start here: the hook creates one controller per mount.
 */
export function createNoticesController({
  list = defaultList,
  dismiss = defaultDismiss,
  pollMs = NOTICES_POLL_INTERVAL_MS,
  clock = defaultClock,
}: NoticesControllerOptions = {}): NoticesController {
  const listeners = new Set<() => void>();
  let view: NoticesView = { status: 'loading' };
  // Whether a reading has ever landed. A later failed poll must not replace a good reading: the
  // notice it carries may still be actionable.
  let hasReading = false;
  let disposed = false;
  let timer: unknown = null;

  /** Publishes a new reading, and notifies only when something a surface shows changed. */
  const publish = (next: NoticesView): void => {
    if (disposed || sameView(view, next)) return;
    view = next;
    for (const listener of [...listeners]) {
      listener();
    }
  };

  const refresh = async (): Promise<void> => {
    try {
      const next = await list();
      if (disposed) return;
      hasReading = true;
      publish({ status: 'ready', active: next.active, dismissed: next.dismissed });
    } catch (cause) {
      if (disposed) return;
      if (!hasReading) {
        publish({
          status: 'unavailable',
          reason: cause instanceof Error ? cause.message : String(cause),
        });
      } else {
        console.error('Error refreshing notices:', cause);
      }
    }
  };

  const dismissNotice = async (notice: Notice): Promise<void> => {
    try {
      const response = await dismiss(notice.id, notice.revision);
      if (disposed) return;
      // 409 is not a failure to report: the condition moved to a new revision between our read
      // and this write, so the server is right and our copy is stale. Re-read silently.
      if (response.ok || response.status === 409) {
        await refresh();
        return;
      }
      console.error(`Dismissing notice ${notice.id} answered ${response.status}`);
    } catch (cause) {
      // The reading is left in place; a dismissal that did not reach the server cannot make the
      // notice disappear locally, and the next poll corrects any disagreement.
      console.error('Error dismissing notice:', cause);
    }
  };

  void refresh();
  timer = clock.setInterval(() => {
    void refresh();
  }, pollMs);

  return {
    subscribe: (listener) => {
      listeners.add(listener);
      return () => {
        listeners.delete(listener);
      };
    },
    getSnapshot: () => view,
    refresh,
    dismiss: dismissNotice,
    dispose: () => {
      disposed = true;
      if (timer !== null) {
        clock.clearInterval(timer);
        timer = null;
      }
      listeners.clear();
    },
  };
}

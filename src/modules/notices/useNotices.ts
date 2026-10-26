import { useEffect, useMemo, useRef, useSyncExternalStore } from 'react';

import { api } from '@/shared/api';
import {
  NOTICES_POLL_INTERVAL_MS,
  createNoticesController,
} from '@/modules/notices/noticesController';
import type {
  Notice,
  NoticeDismissPort,
  NoticeList,
  NoticeListPort,
  NoticesView,
} from '@/modules/notices/noticesController';

// The notice model and its rules live in the React-free controller; these re-exports keep this
// module's existing surface (`index.ts`, `NoticeSlot`, `NoticeInbox` and their tests) intact.
export { NOTICES_POLL_INTERVAL_MS } from '@/modules/notices/noticesController';
export type {
  Notice, NoticeDismissPort, NoticeLifecycle, NoticeList, NoticeListPort,
  NoticePrimaryAction, NoticesController, NoticeSeverity, NoticesView,
} from '@/modules/notices/noticesController';

const defaultList: NoticeListPort = async () => {
  const response = await api.notices.list();
  if (!response.ok) throw new Error(`GET /api/notices answered ${response.status}`);
  return (await response.json()) as NoticeList;
};
const defaultDismiss: NoticeDismissPort = (id, revision) => api.notices.dismiss(id, revision);

type UseNoticesDeps = { list?: NoticeListPort; dismiss?: NoticeDismissPort; pollMs?: number };

/** What `useNotices` hands its consumers. */
export type UseNoticesResult = {
  view: NoticesView;
  /** Re-reads the list now, e.g. after a dismissal or after a confirmed deploy. */
  refresh: () => Promise<void>;
  /** Dismisses one notice at the revision it was read at. A 409 re-reads silently. */
  dismiss: (notice: Notice) => Promise<void>;
};

/**
 * The notices React binding: the poll period, the failure fallback and the 409 rule all live in
 * {@link createNoticesController}. This hook creates one controller per mount, subscribes to its
 * snapshot with `useSyncExternalStore`, and disposes it on unmount.
 *
 * The ports are held in refs so a caller passing a fresh closure each render cannot restart the
 * poll; only the interval duration itself recreates the controller.
 */
export function useNotices({
  list = defaultList,
  dismiss = defaultDismiss,
  pollMs = NOTICES_POLL_INTERVAL_MS,
}: UseNoticesDeps = {}): UseNoticesResult {
  const listRef = useRef(list);
  const dismissRef = useRef(dismiss);
  useEffect(() => {
    listRef.current = list;
    dismissRef.current = dismiss;
  }, [list, dismiss]);

  const controller = useMemo(
    () => createNoticesController({
      list: () => listRef.current(),
      dismiss: (id, revision) => dismissRef.current(id, revision),
      pollMs,
    }),
    [pollMs],
  );
  const view = useSyncExternalStore(
    controller.subscribe,
    controller.getSnapshot,
    controller.getSnapshot,
  );
  // A controller owns a timer and subscribers; the slot leaving the page ends them.
  useEffect(() => () => controller.dispose(), [controller]);

  return { view, refresh: controller.refresh, dismiss: controller.dismiss };
}

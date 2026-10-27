import { useEffect, useMemo, useState, type ReactNode } from 'react';
import { useTranslation } from 'react-i18next';
import { Gauge, PanelRightClose } from 'lucide-react';

import { useServerFeatures } from '@/shared/hooks/useServerFeatures';
import { cn } from '@/shared/utils';
import CockpitCardList from '@/modules/cockpit/CockpitCardList';
import CockpitInput from '@/modules/cockpit/CockpitInput';
import type { CockpitColumnController } from '@/modules/cockpit/cockpitColumnController';
import { CockpitColumnVisibilityContext } from '@/modules/cockpit/contract';
import { useCockpitHub } from '@/modules/cockpit/hooks/useCockpitHub';
import { useCockpitPushToTalk } from '@/modules/cockpit/hooks/useCockpitPushToTalk';
import {
  CockpitColumnContext,
  useCockpitColumn,
  useCockpitColumnContext,
} from '@/modules/cockpit/hooks/useCockpitColumn';
import type { CockpitColumnBinding } from '@/modules/cockpit/hooks/useCockpitColumn';

/**
 * The PC cockpit column: the same cards the phone model shows, parked on the session page's
 * right edge.
 *
 * MOUNTING IS THE SHELL'S DECISION, NOT EACH PAGE'S. `CockpitColumnProvider` wraps the workspace
 * shell; the header button, the column and the sidebar's mode switch read one binding from its
 * context, so they cannot disagree about whether the column is open. The provider is mounted on
 * every session page and is inert when the server has the cockpit switched off.
 *
 * THE COLUMN DOES NOT RE-DERIVE ANYTHING. Layout, width, count and key ownership belong to
 * `createCockpitColumnController`; the card readings belong to the card controller the list
 * already uses on `/cockpit?view=cards`. This file draws the frame and mounts the two existing
 * pieces — `CockpitCardList` and `CockpitInput`.
 *
 * THE INPUT IS MOUNTED, NOT EXTENDED. 「在 X 项目开个会话做 Y」's confirmation flow is a later
 * task; here the input sends the same `utterance` event the cockpit page sends, so the text
 * reaches the same server hub rather than a second, local interpretation.
 */

/** True while the column exists at this viewport (the phone model owns below 900 px). */
export function CockpitColumnProvider({ children }: { children: ReactNode }) {
  const { cockpitEnabled } = useServerFeatures();
  // Loading counts as off, exactly like the sidebar switch: rendering and then removing the
  // column would flash the panel a release with the cockpit off promises not to show.
  if (!cockpitEnabled) return <>{children}</>;
  return <CockpitColumnBoundary>{children}</CockpitColumnBoundary>;
}

function CockpitColumnBoundary({ children }: { children: ReactNode }) {
  const binding = useCockpitColumn();
  useCockpitColumnKeys(binding.controller);
  // The sidebar's mode switch reads only "is the column on screen"; it cannot import this
  // binding without closing the sidebar ↔ cockpit package cycle. The narrow context is fed
  // from the SAME snapshot the rest of the column reads, so the two surfaces cannot disagree.
  const visibility = useMemo(
    () => ({ layout: binding.snapshot.layout, expanded: binding.snapshot.expanded }),
    [binding.snapshot.layout, binding.snapshot.expanded],
  );
  return (
    <CockpitColumnContext.Provider value={binding}>
      <CockpitColumnVisibilityContext.Provider value={visibility}>
        {children}
      </CockpitColumnVisibilityContext.Provider>
    </CockpitColumnContext.Provider>
  );
}

/**
 * One window listener for the whole workspace. The controller decides every key: it checks the
 * layout, the focus owner (either input box ends the handler) and Escape before touching a card.
 * Nothing is prevented unless the column consumed the press.
 */
function useCockpitColumnKeys(controller: CockpitColumnController): void {
  useEffect(() => {
    const onKeyDown = (event: KeyboardEvent): void => {
      if (event.defaultPrevented || event.metaKey || event.ctrlKey || event.altKey) return;
      if (controller.handleKey(event.key)) event.preventDefault();
    };
    window.addEventListener('keydown', onKeyDown);
    return () => window.removeEventListener('keydown', onKeyDown);
  }, [controller]);
}

const INPUT_ROLES = ['input'] as const;

export default function CockpitColumn() {
  const binding = useCockpitColumnContext();
  if (binding === null) return null;
  const { snapshot } = binding;
  if (snapshot.layout === 'hidden' || !snapshot.expanded) return null;
  return <CockpitColumnFrame binding={binding} />;
}

function CockpitColumnFrame({ binding }: { binding: CockpitColumnBinding }) {
  const { t } = useTranslation();
  const { snapshot, controller, cards } = binding;
  const [text, setText] = useState('');
  const hub = useCockpitHub({ roles: INPUT_ROLES });
  const pushToTalk = useCockpitPushToTalk({
    onTranscript: (transcript: string) => {
      setText((previous) => (previous.trim() === '' ? transcript : `${previous.trim()} ${transcript}`));
    },
    // Space belongs to the session page under the column; the mic button still works.
    enabled: false,
  });
  const overlay = snapshot.layout === 'overlay';

  // The drag owns the pointer once it starts, including outside the handle: the listeners live
  // on the window for exactly the span the controller reports `resizing`.
  useEffect(() => {
    if (!snapshot.resizing) return undefined;
    const onPointerMove = (event: PointerEvent): void => controller.resizeTo(event.clientX);
    const onPointerUp = (): void => controller.endResize();
    window.addEventListener('pointermove', onPointerMove);
    window.addEventListener('pointerup', onPointerUp);
    window.addEventListener('pointercancel', onPointerUp);
    return () => {
      window.removeEventListener('pointermove', onPointerMove);
      window.removeEventListener('pointerup', onPointerUp);
      window.removeEventListener('pointercancel', onPointerUp);
    };
  }, [controller, snapshot.resizing]);

  const submit = (value: string): void => {
    const trimmed = value.trim();
    if (trimmed === '') return;
    setText('');
    hub.dispatch({ type: 'utterance', text: trimmed });
  };

  return (
    <aside
      data-testid="cockpit-column"
      data-cockpit-column-layout={snapshot.layout}
      data-cockpit-column-expanded="true"
      data-cockpit-column-width={snapshot.width}
      style={{ width: snapshot.width }}
      className={cn(
        'flex min-h-0 flex-col border-l border-border/60 bg-background',
        overlay
          ? 'fixed inset-y-0 right-0 z-40 shadow-2xl'
          : 'relative h-full flex-shrink-0',
      )}
    >
      {!overlay && (
        <div
          role="separator"
          aria-orientation="vertical"
          aria-label={t('cockpit.columnResize')}
          data-testid="cockpit-column-resize"
          onPointerDown={(event) => {
            event.preventDefault();
            controller.beginResize(event.clientX);
          }}
          className={cn(
            'absolute left-0 top-0 z-10 h-full w-1.5 -translate-x-1/2 cursor-col-resize',
            snapshot.resizing ? 'bg-primary/60' : 'hover:bg-primary/30',
          )}
        />
      )}

      <div className="flex flex-shrink-0 items-center gap-2 border-b border-border/60 px-3 py-1.5">
        <Gauge className="h-4 w-4 flex-shrink-0 text-muted-foreground" aria-hidden />
        <span className="min-w-0 truncate text-sm font-medium text-foreground">
          {t('cockpit.columnTitle')}
        </span>
        <span
          data-testid="cockpit-column-count"
          className="flex-shrink-0 rounded-full bg-muted px-1.5 py-0.5 text-[11px] tabular-nums text-muted-foreground"
        >
          {t('cockpit.columnOpenCount', { n: snapshot.openCount })}
        </span>
        <button
          type="button"
          data-testid="cockpit-column-collapse"
          aria-label={t('cockpit.columnCollapse')}
          title={t('cockpit.columnCollapse')}
          onClick={() => controller.toggle()}
          className="ml-auto flex h-7 w-7 flex-shrink-0 items-center justify-center rounded-md border border-border/50 text-muted-foreground transition-colors hover:bg-accent hover:text-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary/60"
        >
          <PanelRightClose className="h-4 w-4" aria-hidden />
        </button>
      </div>

      <CockpitCardList
        binding={cards}
        variant="column"
        openedCardId={snapshot.openedCardId}
        onOpenConversation={(card, sessionId) => controller.openConversation(card.id, sessionId)}
        onBack={() => cards.controller.closeDetails()}
      />

      <div
        data-testid="cockpit-column-composer"
        className="flex-shrink-0 border-t border-border/60 p-2"
      >
        <CockpitInput
          value={text}
          onValueChange={setText}
          onSubmit={submit}
          voiceState={pushToTalk.state}
          onVoiceToggle={pushToTalk.toggle}
          voiceInFlight={pushToTalk.inFlight}
        />
      </div>
    </aside>
  );
}

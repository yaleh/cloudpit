import { useCallback, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { ListOrdered } from 'lucide-react';

import InputOutlineHandle from '@/modules/chat/outline/InputOutlineHandle';
import { useOutlineHandleDrag } from '@/modules/chat/outline/useOutlineHandleDrag';
import type { InputOutlineEntry } from '@/modules/chat/outline/useInputOutline';

type InputOutlineDrawerProps = {
  entries: InputOutlineEntry[];
  /** Mobile anchors the handle from the bottom edge and keeps the panel inside a narrow screen. */
  isMobile: boolean;
  /** The shared jump from `useChatSessionState`, addressed by transcript anchor id. */
  onJump: (anchorId: string) => void;
};

/**
 * Rendered by ChatInterface (desktop and mobile) as a right-edge drawer listing the
 * session's user inputs; picking one jumps the transcript to it. The handle,
 * panel and backdrop follow the retired quick-settings drawer.
 *
 * ANCHORED TO THE SESSION AREA, NOT THE WINDOW. `ChatInterface` is the session area and is
 * `relative`, so the panel, the backdrop and the handle are `absolute`: they end at the session
 * area's right edge, which is where the PC cockpit column begins. A window-fixed drawer would
 * slide under the column (and the column's cards would sit on top of it), which is exactly the
 * overlap the PC model rules out.
 */
export default function InputOutlineDrawer({ entries, isMobile, onJump }: InputOutlineDrawerProps) {
  const { t } = useTranslation('chat');
  const [isOpen, setIsOpen] = useState(false);
  const { isDragging, handleStyle, startDrag, consumeSuppressedClick } = useOutlineHandleDrag({ isMobile });

  const handleToggleFromHandle = useCallback(() => {
    // A drag that ends over the handle still fires a click; it must not toggle.
    if (consumeSuppressedClick()) return;
    setIsOpen((previous) => !previous);
  }, [consumeSuppressedClick]);

  const handleJump = useCallback((anchorId: string) => {
    setIsOpen(false);
    onJump(anchorId);
  }, [onJump]);

  return (
    <>
      <InputOutlineHandle
        isOpen={isOpen}
        isMobile={isMobile}
        isDragging={isDragging}
        // Inline `position` overrides the handle's own `fixed` class: every other placement
        // rule (the open/closed offset, the drag transform) is still the handle's.
        style={{ ...handleStyle, position: 'absolute' }}
        onClick={handleToggleFromHandle}
        onMouseDown={startDrag}
        onTouchStart={startDrag}
      />

      {/* THE CLIP LAYER. Closed, the panel is `right-0` + `translate-x-full`, so its 256px hang
          sits past the session area's right edge — and `overflow: hidden` on the session column
          clips that visually WITHOUT removing it from the column's scrollable overflow. Measured
          at 375px before this wrapper existed: the column reported `scrollWidth=631 clientWidth=375`,
          the Live Voice gesture's scroll-into-view set its `scrollLeft=147`, and the whole session
          (bar included) moved to x=-139 — the AC-323 375px red. The wrapper is what stops the
          overhang: the panel's containing block is now this layer, whose own box is exactly the
          session area (`inset-0`), so the part translated out beyond it is clipped here instead of
          enlarging any ancestor's scroll area.
          It must stay `absolute` inside the session area (never `fixed`): the drawer has to end at
          the session area's right edge so it cannot slide under the PC cockpit column (06300c8f2).
          It must also stay stacking-neutral (`pointer-events-none`, no z-index/transform of its
          own): the panel's `z-[9999]` has to keep painting above the composer, and an ancestor
          stacking context would trap it below. Only the panel and the open backdrop take pointer
          events back, so the layer never blocks the page while it is closed. */}
      <div className="pointer-events-none absolute inset-0 overflow-hidden" data-input-outline-clip>
        <div
          className={`pointer-events-auto absolute right-0 top-0 z-[9999] h-full w-64 max-w-[85vw] transform border-l border-border bg-background shadow-xl transition-transform duration-150 ease-out ${isOpen ? 'translate-x-0' : 'translate-x-full'}`}
          aria-hidden={!isOpen}
          data-input-outline-panel
        >
          <div className="flex h-full flex-col">
            <div className="border-b border-border bg-muted/40 p-4">
              <h3 className="flex items-center gap-2 text-lg font-semibold text-foreground">
                <ListOrdered className="h-5 w-5 text-muted-foreground" />
                {t('inputOutline.title')}
              </h3>
            </div>
            <div className="flex-1 overflow-y-auto">
              {entries.length === 0 ? (
                <p className="p-4 text-sm text-muted-foreground">{t('inputOutline.empty')}</p>
              ) : (
                <ol className="py-1">
                  {entries.map((entry, index) => (
                    <li key={entry.id}>
                      <button
                        type="button"
                        tabIndex={isOpen ? 0 : -1}
                        onClick={() => handleJump(entry.id)}
                        className="flex w-full items-baseline gap-2 px-4 py-2 text-left text-sm text-foreground hover:bg-muted focus-visible:bg-muted focus-visible:outline-none"
                        title={entry.preview}
                        data-input-outline-entry={entry.id}
                      >
                        <span className="w-6 flex-shrink-0 text-right text-xs tabular-nums text-muted-foreground">{index + 1}</span>
                        <span className="line-clamp-2 min-w-0 break-words">{entry.preview || t('inputOutline.untitled')}</span>
                      </button>
                    </li>
                  ))}
                </ol>
              )}
            </div>
          </div>
        </div>

        {isOpen && (
          <div
            className="pointer-events-auto absolute inset-0 z-[9998] bg-background/80 backdrop-blur-sm transition-opacity duration-150 ease-out"
            onClick={() => setIsOpen(false)}
          />
        )}
      </div>
    </>
  );
}

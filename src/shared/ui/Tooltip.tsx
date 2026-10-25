import { type ReactNode, useCallback, useEffect, useRef, useState } from 'react';
import { createPortal } from 'react-dom';

import { cn } from '@/shared/utils';

type TooltipPosition = 'top' | 'bottom' | 'left' | 'right';

type TooltipProps = {
  children: ReactNode;
  content?: ReactNode;
  position?: TooltipPosition;
  className?: string;
  delay?: number;
  /**
   * Keep the wrapper element but install no bubble and no listeners.
   *
   * A caller whose trigger changes identity as the content becomes available
   * (the workspace tab that shows its own label once active) uses this so the
   * trigger's DOM node survives the switch — swapping a wrapped node for an
   * unwrapped one remounts the button and drops keyboard focus.
   */
  disabled?: boolean;
};

function getArrowClasses(position: TooltipPosition): string {
  switch (position) {
    case 'top':
      return 'top-full left-1/2 transform -translate-x-1/2 border-t-gray-900 dark:border-t-gray-100';
    case 'bottom':
      return 'bottom-full left-1/2 transform -translate-x-1/2 border-b-gray-900 dark:border-b-gray-100';
    case 'left':
      return 'left-full top-1/2 transform -translate-y-1/2 border-l-gray-900 dark:border-l-gray-100';
    case 'right':
      return 'right-full top-1/2 transform -translate-y-1/2 border-r-gray-900 dark:border-r-gray-100';
    default:
      return 'top-full left-1/2 transform -translate-x-1/2 border-t-gray-900 dark:border-t-gray-100';
  }
}

/** Used by the project-workspace, sidebar and task-master modules and by the shared PromptInput primitive. */
export function Tooltip({
  children,
  content,
  position = 'top',
  className = '',
  delay = 350,
  disabled = false,
}: TooltipProps) {
  const [isVisible, setIsVisible] = useState(false);
  // Store the timer id without forcing re-renders while hovering.
  const timeoutRef = useRef<number | null>(null);
  const longPressTriggeredRef = useRef(false);
  // A press on the trigger (the element the tooltip describes) closes the
  // bubble and keeps it closed for the rest of this pointer visit. Without it a
  // click left the bubble floating over the control it had just described (and
  // over the neighbour beside it) until the pointer happened to leave, because
  // the pointer is over the trigger and therefore never produces a mouseleave.
  // A ref, not state: the suppression is read by event handlers only.
  const suppressedUntilLeaveRef = useRef(false);
  const containerRef = useRef<HTMLDivElement | null>(null);
  const tooltipRef = useRef<HTMLDivElement | null>(null);
  const [tooltipStyle, setTooltipStyle] = useState<React.CSSProperties | null>(null);

  const updateTooltipPosition = useCallback(() => {
    const container = containerRef.current;
    if (!container) return;

    const rect = container.getBoundingClientRect();
    const spacing = 8;
    const style: React.CSSProperties = {
      position: 'fixed',
      zIndex: 9999,
    };

    // Calculate tooltip position based on the specified position prop.
    switch (position) {
      case 'bottom':
        style.left = rect.left + rect.width / 2;
        style.top = rect.bottom + spacing;
        style.transform = 'translateX(-50%)';
        break;
      case 'left':
        style.left = rect.left - spacing;
        style.top = rect.top + rect.height / 2;
        style.transform = 'translate(-100%, -50%)';
        break;
      case 'right':
        style.left = rect.right + spacing;
        style.top = rect.top + rect.height / 2;
        style.transform = 'translateY(-50%)';
        break;
      case 'top':
      default:
        style.left = rect.left + rect.width / 2;
        style.top = rect.top - spacing;
        style.transform = 'translate(-50%, -100%)';
        break;
    }

    setTooltipStyle(style);
  }, [position]);

  const clearTooltipTimer = () => {
    if (timeoutRef.current !== null) {
      window.clearTimeout(timeoutRef.current);
      timeoutRef.current = null;
    }
  };

  const handleMouseEnter = () => {
    clearTooltipTimer();
    // The pointer never left after the press that dismissed the bubble, so
    // re-entering the same visit must not bring it back.
    if (suppressedUntilLeaveRef.current) return;
    timeoutRef.current = window.setTimeout(() => {
      setIsVisible(true);
    }, delay);
  };

  const handleMouseLeave = () => {
    clearTooltipTimer();
    suppressedUntilLeaveRef.current = false;
    setIsVisible(false);
  };

  /**
   * The trigger was pressed: hide the bubble now and keep it hidden until the
   * pointer leaves and comes back. Touch long-press keeps working because the
   * press that follows a long press must not undo the bubble it produced.
   */
  const handlePress = () => {
    if (longPressTriggeredRef.current) return;
    clearTooltipTimer();
    suppressedUntilLeaveRef.current = true;
    setIsVisible(false);
  };

  const handleTouchStart = () => {
    clearTooltipTimer();
    longPressTriggeredRef.current = false;
    timeoutRef.current = window.setTimeout(() => {
      longPressTriggeredRef.current = true;
      setIsVisible(true);
    }, delay);
  };

  const handleTouchEnd = () => {
    clearTooltipTimer();
    if (longPressTriggeredRef.current) {
      return;
    }
    setIsVisible(false);
  };

  useEffect(() => {
    // Avoid delayed updates after unmount.
    return () => {
      clearTooltipTimer();
    };
  }, []);

  useEffect(() => {
    if (!isVisible || typeof document === 'undefined') {
      return;
    }

    const handlePointerDown = (event: PointerEvent) => {
      const target = event.target;
      if (target instanceof Node && containerRef.current?.contains(target)) {
        return;
      }
      setIsVisible(false);
      longPressTriggeredRef.current = false;
    };

    document.addEventListener('pointerdown', handlePointerDown, true);
    return () => document.removeEventListener('pointerdown', handlePointerDown, true);
  }, [isVisible]);

  useEffect(() => {
    if (!isVisible) {
      setTooltipStyle(null);
      return;
    }

    const rafId = window.requestAnimationFrame(updateTooltipPosition);
    const handleViewportChange = () => updateTooltipPosition();

    window.addEventListener('resize', handleViewportChange);
    window.addEventListener('scroll', handleViewportChange, true);

    return () => {
      window.cancelAnimationFrame(rafId);
      window.removeEventListener('resize', handleViewportChange);
      window.removeEventListener('scroll', handleViewportChange, true);
    };
  }, [isVisible, updateTooltipPosition]);

  // A disabled tooltip keeps the wrapper's place in the tree (so the trigger
  // element is not remounted) but never arms a bubble. It deliberately carries
  // no `data-tooltip-container` marker: nothing here can produce a tooltip.
  if (disabled) {
    return <div className="relative inline-block">{children}</div>;
  }

  if (!content) {
    return <>{children}</>;
  }

  return (
    <div
      ref={containerRef}
      data-tooltip-container="true"
      className="relative inline-block"
      onMouseEnter={handleMouseEnter}
      onMouseLeave={handleMouseLeave}
      onTouchStart={handleTouchStart}
      onTouchEnd={handleTouchEnd}
      onTouchCancel={handleTouchEnd}
      // Both events: a real press fires pointerdown first (a mouse click also
      // fires click), and a test or a keyboard activation may deliver only one.
      onPointerDown={handlePress}
      onClick={handlePress}
    >
      {children}
      {isVisible && typeof document !== 'undefined' && createPortal(
        <div
          ref={tooltipRef}
          // Stable marker for the bubble itself (a test or a DOM reading can tell
          // the bubble apart from the label it repeats, which stays in the DOM
          // even while CSS hides it).
          data-tooltip-bubble="true"
          style={tooltipStyle || { position: 'fixed', top: '-9999px', left: '-9999px', opacity: 0 }}
          className={cn(
            'px-2 py-1 text-xs font-medium text-white bg-gray-900 dark:bg-gray-100 dark:text-gray-900 rounded shadow-lg whitespace-nowrap pointer-events-none',
            'animate-in fade-in-0 zoom-in-95 duration-200',
            className
          )}
        >
          {content}
          {/* Arrow */}
          <div className={cn('absolute w-0 h-0 border-4 border-transparent', getArrowClasses(position))} />
        </div>,
        document.body
      )}
    </div>
  );
}

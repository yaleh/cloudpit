/**
 * The shared hover bubble's dismissal contract.
 *
 * The bug this pins: the bubble only closed on `mouseleave` or on a pointerdown
 * OUTSIDE the container. Pressing the trigger itself — the pointerdown the
 * element exists to describe — was treated as "inside", and because the pointer
 * never left afterwards there was no `mouseleave` either. The bubble therefore
 * stayed up over the control (and its neighbour) after the click that used it.
 *
 * Run directly:
 *   npx vitest run src/shared/ui/tests/Tooltip.test.tsx
 */
import assert from 'node:assert/strict';

import { act, fireEvent, render, screen } from '@testing-library/react';
import { afterEach, beforeEach, test, vi } from 'vitest';

import { Tooltip } from '@/shared/ui';

const BUBBLE = 'Architecture tab';

/** The bubble's text: it is portalled to `document.body`, outside the trigger. */
const bubble = () => screen.queryByText(BUBBLE);

function renderTooltip(): HTMLElement {
  render(
    <Tooltip content={BUBBLE} delay={350}>
      <button type="button">Tab</button>
    </Tooltip>,
  );
  const container = document.querySelector('[data-tooltip-container]');
  assert.ok(container instanceof HTMLElement, 'the tooltip must wrap its trigger');
  return container;
}

/** The component's hover delay plus a margin, on fake timers. */
const waitOutDelay = (): void => {
  act(() => {
    vi.advanceTimersByTime(400);
  });
};

beforeEach(() => {
  // The bubble is scheduled, so the case controls when it appears.
  vi.useFakeTimers();
});

afterEach(() => {
  vi.useRealTimers();
});

test('tooltip closes on press and stays closed until re-enter', () => {
  const container = renderTooltip();
  const trigger = screen.getByRole('button', { name: 'Tab' });

  fireEvent.mouseEnter(container);
  waitOutDelay();
  assert.ok(bubble(), 'hovering long enough shows the bubble');

  // The press that uses the trigger takes the bubble down immediately.
  fireEvent.pointerDown(trigger);
  assert.equal(bubble(), null, 'a press on the trigger closes its bubble at once');

  // The same gesture continues into a click, and the pointer is still inside:
  // neither may bring the bubble back for the rest of this visit.
  fireEvent.click(trigger);
  waitOutDelay();
  assert.equal(bubble(), null, 'the click that follows must not resurrect the bubble');
  fireEvent.mouseEnter(container);
  waitOutDelay();
  assert.equal(bubble(), null, 'a re-enter without leaving stays suppressed');

  // Leaving resets the suppression, so the next hover works as before.
  fireEvent.mouseLeave(container);
  assert.equal(bubble(), null, 'leaving hides the bubble');
  fireEvent.mouseEnter(container);
  waitOutDelay();
  assert.ok(bubble(), 'leaving and coming back restores the hover behaviour');
});

test('a touch long-press still opens the bubble and the release keeps it', () => {
  const container = renderTooltip();

  fireEvent.touchStart(container);
  waitOutDelay();
  assert.ok(bubble(), 'a long press shows the bubble without hover');

  // The release that follows a long press must not undo the bubble it produced.
  fireEvent.touchEnd(container);
  assert.ok(bubble(), 'the end of a long press keeps the bubble it produced');
});

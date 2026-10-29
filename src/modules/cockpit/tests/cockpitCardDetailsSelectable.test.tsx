import { useSyncExternalStore } from 'react';
import { I18nextProvider } from 'react-i18next';
import { act, fireEvent, render, screen } from '@testing-library/react';
import { beforeAll, describe, expect, it } from 'vitest';

import type { Clock, CockpitCard as CockpitCardData, CockpitCardOption } from '@/shared/types';
import { i18n } from '@/modules/i18n';
import CockpitCardDetails from '@/modules/cockpit/CockpitCardDetails';
import { createCockpitCardController } from '@/modules/cockpit/cockpitCardController';
import type { CockpitCardController } from '@/modules/cockpit/cockpitCardController';

/**
 * THE DETAILS DRAWER IS SELECTABLE, AND ITS SELECTION IS THE CARD'S.
 *
 * The drawer used to draw every option as inert text: a person who opened a card could read the
 * options but not choose one, and no own-reply row existed there at all. These cases drive the
 * REAL controller through the drawer's own buttons — the drawer receives the same `shown`,
 * `ownReply` and command callbacks `CockpitCardList` gives it — so "clicking a row" and "the
 * confirm target moved" are one state assertion rather than a prop the test placed.
 *
 * The selection reading is the frame, never a radio/checkbox: `aria-pressed` carries it for
 * assistive technology and `border-primary` + `ring-1` is the visual signal the design names.
 */

const NOW = Date.parse('2026-10-27T00:10:00.000Z');

const FAKE_CLOCK: Clock = {
  setTimeout: () => 1,
  clearTimeout: () => undefined,
  setInterval: () => 2,
  clearInterval: () => undefined,
  now: () => NOW,
};

function option(id: string, label: string, suggested = false): CockpitCardOption {
  return {
    id,
    label,
    does: `${label} does something`,
    suggested,
    source: 'provider',
    action: { executor: 'test.exec', params: { optionId: id } },
  };
}

function card(overrides: Partial<CockpitCardData> = {}): CockpitCardData {
  return {
    id: 'c1',
    provider: 'test',
    revision: 1,
    kind: 'ask',
    group: 'test',
    rank: 1,
    state: 'open',
    waitingSince: '2026-10-27T00:00:00.000Z',
    surfacedAt: '2026-10-27T00:00:01.000Z',
    subject: { uri: 'cloudcli://test/c1', project: 'p1' },
    ask: 'Which way?',
    facts: [],
    options: [option('one', 'One', true), option('two', 'Two')],
    ownReply: { executor: 'test.exec', params: { cardId: 'c1' } },
    ...overrides,
  };
}

/** The real controller plus a way to answer the next read, for the re-read case. */
function harness(initial: readonly CockpitCardData[]): {
  controller: CockpitCardController;
  setCards: (next: readonly CockpitCardData[]) => void;
} {
  let cards = initial;
  const controller = createCockpitCardController({
    fetchCards: async () => cards,
    confirm: async () => ({ executor: 'test.exec', result: { ok: true } }),
    clock: FAKE_CLOCK,
    // No background polling: a criterion re-reads by calling `load()` explicitly.
    refreshIntervalMs: 0,
  });
  return {
    controller,
    setCards: (next) => {
      cards = next;
    },
  };
}

/**
 * The drawer wired the way `CockpitCardList` wires it: every reading comes from the controller's
 * snapshot and every command goes back to it. The subscribe is what makes a click visible in the
 * rendered frame without the test re-rendering by hand.
 */
function Drawer({ controller, cardId }: { controller: CockpitCardController; cardId: string }) {
  const snapshot = useSyncExternalStore(controller.subscribe, controller.getSnapshot);
  const detailsCard = snapshot.cards.find((candidate) => candidate.id === cardId);
  if (detailsCard === undefined) return null;
  return (
    <I18nextProvider i18n={i18n}>
      <CockpitCardDetails
        card={detailsCard}
        now={snapshot.now}
        onClose={() => undefined}
        shown={snapshot.shown[cardId]}
        ownReply={snapshot.ownReplies[cardId] ?? ''}
        onShowOption={(optionId) => controller.showOption(cardId, optionId)}
        onShowOwnReply={() => controller.showOwnReply(cardId)}
        onOwnReplyChange={(text) => controller.setOwnReply(cardId, text)}
        target={snapshot.targets[cardId] ?? null}
        onRequestConfirm={() => controller.requestConfirm(cardId)}
      />
    </I18nextProvider>
  );
}

async function renderDrawer(initial: readonly CockpitCardData[] = [card()]) {
  const { controller, setCards } = harness(initial);
  const view = render(<Drawer controller={controller} cardId="c1" />);
  await act(async () => {
    await controller.load();
  });
  return { ...view, controller, setCards };
}

beforeAll(async () => {
  await i18n.changeLanguage('en');
});

describe('the drawer’s start-conversation intent', () => {
  it('shows the recorded intent inside Details', () => {
    render(
      <I18nextProvider i18n={i18n}>
        <CockpitCardDetails
          card={card()}
          now={NOW}
          onClose={() => undefined}
          startConversationIntent="p1"
        />
      </I18nextProvider>,
    );

    expect(screen.getByTestId('cockpit-card-start-intent').textContent).toContain('p1');
  });
});

describe('the drawer’s option rows', () => {
  it('draws the suggested option as the shown row and switches it on a click', async () => {
    const { controller } = await renderDrawer();
    const first = screen.getByTestId('cockpit-card-details-option-one');
    const second = screen.getByTestId('cockpit-card-details-option-two');

    // The controller's first read stores the suggestion; the drawer highlights exactly that row.
    expect(controller.getSnapshot().shown.c1).toEqual({ kind: 'option', optionId: 'one' });
    expect(first.getAttribute('aria-pressed')).toBe('true');
    expect(second.getAttribute('aria-pressed')).toBe('false');

    fireEvent.click(second);

    expect(controller.getSnapshot().shown.c1).toEqual({ kind: 'option', optionId: 'two' });
    expect(controller.getSnapshot().targets.c1?.optionId).toBe('two');
    expect(controller.getSnapshot().targets.c1?.label).toBe('Two');
    expect(second.getAttribute('aria-pressed')).toBe('true');
    expect(first.getAttribute('aria-pressed')).toBe('false');
  });

  it('marks the shown row with the border frame and leaves the others plain', async () => {
    const { controller } = await renderDrawer();
    const first = screen.getByTestId('cockpit-card-details-option-one');
    const second = screen.getByTestId('cockpit-card-details-option-two');

    fireEvent.click(second);

    // The frame is the selection signal: a primary border plus a ring, with a faint fill only
    // supporting it. No radio/checkbox is drawn.
    expect(second.className).toContain('border-primary');
    expect(second.className).toContain('ring-1');
    expect(first.className).not.toContain('border-primary');
    expect(first.className).not.toContain('ring-1');
    // Every row is one full-width press target with hover feedback.
    expect(second.className).toContain('w-full');
    expect(second.className).toContain('hover:bg-accent/50');
    expect(screen.queryByRole('radio')).toBeNull();
    expect(screen.queryByRole('checkbox')).toBeNull();
    // Pressing the row is the same command the card's dropdown issues.
    expect(controller.getSnapshot().shown.c1).toEqual({ kind: 'option', optionId: 'two' });
  });

  it('falls back to the suggested option when a re-read drops the shown one', async () => {
    const { controller, setCards } = await renderDrawer();

    fireEvent.click(screen.getByTestId('cockpit-card-details-option-two'));
    expect(controller.getSnapshot().shown.c1).toEqual({ kind: 'option', optionId: 'two' });

    // The provider re-read no longer offers `two`; the controller's one fallback rule applies.
    setCards([card({ revision: 2, options: [option('one', 'One', true)] })]);
    await act(async () => {
      await controller.load();
    });

    expect(controller.getSnapshot().shown.c1).toEqual({ kind: 'option', optionId: 'one' });
    expect(controller.getSnapshot().targets.c1?.optionId).toBe('one');
    expect(screen.getByTestId('cockpit-card-details-option-one').getAttribute('aria-pressed')).toBe(
      'true',
    );
    expect(screen.queryByTestId('cockpit-card-details-option-two')).toBeNull();
  });
});

describe('the drawer’s own-reply row', () => {
  it('is the last option row and expands the shared draft when chosen', async () => {
    const { controller } = await renderDrawer();
    const list = screen.getByTestId('cockpit-card-details-options');
    const ownReply = screen.getByTestId('cockpit-card-details-own-reply');
    expect(list.lastElementChild?.contains(ownReply)).toBe(true);
    expect(ownReply.getAttribute('aria-pressed')).toBe('false');
    expect(screen.queryByTestId('cockpit-card-details-own-reply-input')).toBeNull();

    fireEvent.click(ownReply);

    expect(controller.getSnapshot().shown.c1).toEqual({ kind: 'ownReply' });
    expect(controller.getSnapshot().targets.c1?.optionId).toBeNull();
    expect(ownReply.getAttribute('aria-pressed')).toBe('true');
    expect(ownReply.className).toContain('border-primary');
    expect(ownReply.className).toContain('ring-1');

    const editor = screen.getByTestId('cockpit-card-details-own-reply-input');
    fireEvent.change(editor, { target: { value: 'answer it my way' } });

    // The draft is the controller's one ownReplies entry, not a second local copy.
    expect(controller.getSnapshot().ownReplies.c1).toBe('answer it my way');
    expect(controller.getSnapshot().targets.c1?.replyText).toBe('answer it my way');
    expect((editor as HTMLTextAreaElement).value).toBe('answer it my way');
  });
});

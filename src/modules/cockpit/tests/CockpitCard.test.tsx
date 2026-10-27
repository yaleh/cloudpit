import { cleanup, fireEvent, render, screen, within } from '@testing-library/react';
import { useState } from 'react';
import { I18nextProvider } from 'react-i18next';
import { afterEach, beforeAll, describe, expect, it, vi } from 'vitest';

import type {
  CockpitCard as CockpitCardData,
  CockpitCardKind,
  CockpitCardViz,
} from '@/shared/types';
import { i18n } from '@/modules/i18n';
import CockpitCard from '@/modules/cockpit/CockpitCard';
import { cockpitCardDescriptor } from '@/modules/cockpit/cockpitCardDescriptors';
import type { CockpitCardShown } from '@/modules/cockpit/cockpitCardController';
import {
  confirmTargetOf,
  defaultShownOption,
} from '@/modules/cockpit/cockpitCardController';

/**
 * One card's three touch zones, rendered against the real i18n bundle and real controller
 * derivations.
 *
 * The fixture is deliberately stateful: selecting an option or typing a reply goes through the
 * SAME `confirmTargetOf` the controller uses, so the confirm bar's label switching is a property
 * of the card contract rather than a string the test placed there.
 */

const NOW = Date.parse('2026-10-27T00:10:00.000Z');

const CARD: CockpitCardData = {
  id: 'fixture:ask',
  provider: 'fixture',
  revision: 1,
  kind: 'ask',
  group: 'ruling',
  rank: 1,
  state: 'open',
  waitingSince: '2026-10-27T00:06:00.000Z',
  surfacedAt: '2026-10-27T00:06:03.000Z',
  subject: { uri: 'cloudcli://fixture/ask', project: 'fixture-project', sessionId: 'fixture-session' },
  ask: 'Should the cleanup delete the staging directory?',
  situation: 'The run left 1.2 GB in staging.',
  facts: [
    { text: 'staging holds 1.2 GB', mechanical: true },
    { text: 'transcript archived', mechanical: true },
  ],
  options: [
    {
      id: 'delete',
      label: 'Delete staging',
      does: 'Remove the staging directory after the archive is verified.',
      suggested: true,
      source: 'assistant',
      action: { executor: 'fixture.record', params: { optionId: 'delete' } },
      why: 'The data is already archived.',
      tags: [{ kind: 'undo', text: '可撤' }],
    },
    {
      id: 'park',
      label: 'Park it',
      does: 'Stop the run and keep the transcript.',
      suggested: false,
      source: 'provider',
      action: { executor: 'fixture.record', params: { optionId: 'park' } },
      tags: [{ kind: 'warn', text: '不可逆' }],
    },
  ],
  ownReply: { executor: 'fixture.record', params: { cardId: 'fixture:ask' } },
  conversation: { sessionId: 'fixture-session' },
};

type FixtureProps = {
  card: CockpitCardData;
  onOpenDetails: () => void;
  onRequestConfirm: () => void;
};

/** The card with just enough local state to exercise its own controls. */
function Fixture({ card, onOpenDetails, onRequestConfirm }: FixtureProps) {
  const [shown, setShown] = useState<CockpitCardShown | undefined>(
    defaultShownOption(card) ?? undefined,
  );
  const [ownReply, setOwnReply] = useState('');
  const [dropdownOpen, setDropdownOpen] = useState(false);
  const target = confirmTargetOf(card, shown, ownReply);

  return (
    <CockpitCard
      card={card}
      now={NOW}
      shown={shown}
      target={target}
      ownReply={ownReply}
      dropdownOpen={dropdownOpen}
      selected
      density="cards"
      onSelect={() => undefined}
      onOpenDetails={onOpenDetails}
      onToggleDropdown={() => setDropdownOpen((open) => !open)}
      onShowOption={(optionId) => {
        setShown({ kind: 'option', optionId });
        setDropdownOpen(false);
      }}
      onShowOwnReply={() => setShown({ kind: 'ownReply' })}
      onOwnReplyChange={(text) => {
        setOwnReply(text);
        setShown({ kind: 'ownReply' });
      }}
      onRequestConfirm={onRequestConfirm}
    />
  );
}

function renderCard({
  card = CARD,
  onOpenDetails = vi.fn(),
  onRequestConfirm = vi.fn(),
}: {
  card?: CockpitCardData;
  onOpenDetails?: () => void;
  onRequestConfirm?: () => void;
} = {}) {
  return render(
    <I18nextProvider i18n={i18n}>
      <Fixture card={card} onOpenDetails={onOpenDetails} onRequestConfirm={onRequestConfirm} />
    </I18nextProvider>,
  );
}

beforeAll(async () => {
  await i18n.changeLanguage('en');
});

afterEach(() => {
  cleanup();
});

describe('A zone: the upper body opens Details, and nothing else does', () => {
  it('a tap on the header/question/facts requests Details', () => {
    const onOpenDetails = vi.fn();
    renderCard({ onOpenDetails });

    fireEvent.click(screen.getByTestId('cockpit-card-zone-a'));
    expect(onOpenDetails).toHaveBeenCalledTimes(1);

    fireEvent.keyDown(screen.getByTestId('cockpit-card-zone-a'), { key: 'Enter' });
    expect(onOpenDetails).toHaveBeenCalledTimes(2);
  });

  it('each of the four sub-zones requests Details exactly once', () => {
    const onOpenDetails = vi.fn();
    renderCard({ onOpenDetails });

    const subZones = [
      'cockpit-card-zone-a-header',
      'cockpit-card-zone-a-question',
      'cockpit-card-zone-a-situation',
      'cockpit-card-zone-a-facts',
    ];
    subZones.forEach((testId, index) => {
      fireEvent.click(screen.getByTestId(testId));
      expect(onOpenDetails, `${testId} must request Details`).toHaveBeenCalledTimes(index + 1);
    });
  });

  it('draws no independent Alternatives or Details button', () => {
    renderCard();

    const buttons = screen.getAllByRole('button');
    expect(buttons.length).toBeGreaterThan(0);
    for (const button of buttons) {
      const name = `${button.textContent ?? ''} ${button.getAttribute('aria-label') ?? ''}`;
      expect(name, `button named ${name}`).not.toMatch(/alternatives|details/i);
    }
  });
});

describe('B zone: one dropdown, rich-text options, own reply last', () => {
  it('explains every option in rich text and ends with the reply editor', () => {
    renderCard();

    fireEvent.click(screen.getByTestId('cockpit-card-option-trigger'));
    const list = screen.getByTestId('cockpit-card-option-list');

    const deleteItem = within(list).getByTestId('cockpit-card-option-delete');
    expect(deleteItem.textContent).toContain('Delete staging');
    expect(deleteItem.textContent).toContain('Remove the staging directory after the archive is verified.');
    expect(deleteItem.textContent).toContain('The data is already archived.');
    expect(deleteItem.textContent).toContain('可撤');

    const parkItem = within(list).getByTestId('cockpit-card-option-park');
    expect(parkItem.textContent).toContain('Stop the run and keep the transcript.');
    expect(parkItem.textContent).toContain('不可逆');

    const ownReplyItem = within(list).getByTestId('cockpit-card-own-reply-item');
    expect(list.lastElementChild).toBe(ownReplyItem);
    const editor = within(ownReplyItem).getByTestId('cockpit-card-own-reply-input');
    expect(editor.tagName).toBe('TEXTAREA');
  });

  it('the card, before the dropdown opens, shows the selected option’s complete explanation', () => {
    renderCard();

    // The dropdown starts closed from the Fixture's own state.
    expect(screen.queryByTestId('cockpit-card-option-list')).toBeNull();
    const shown = screen.getByTestId('cockpit-card-shown-option');
    expect(shown.textContent).toContain(
      'Remove the staging directory after the archive is verified.',
    );
    expect(shown.textContent).toContain('The data is already archived.');
    expect(shown.textContent).toContain('可撤');
  });

  it('the trigger names the shown option, its source and its position', () => {
    renderCard();

    const trigger = screen.getByTestId('cockpit-card-option-trigger');
    expect(trigger.textContent).toContain('Delete staging');
    expect(trigger.textContent).toContain('suggested');
    expect(trigger.textContent).toContain('Assistant');
    expect(trigger.textContent).toContain('1 of 2');
  });
});

describe('C zone: one confirm bar bound to the shown option', () => {
  it('carries the current option’s name and follows a switch', () => {
    const onRequestConfirm = vi.fn();
    renderCard({ onRequestConfirm });

    const confirm = screen.getByTestId('cockpit-card-confirm');
    expect(confirm.textContent).toContain('Delete staging');

    fireEvent.click(screen.getByTestId('cockpit-card-option-trigger'));
    fireEvent.click(screen.getByTestId('cockpit-card-option-park'));

    expect(confirm.textContent).toContain('Park it');
    expect(confirm.getAttribute('data-irreversible')).toBe('true');
    expect(confirm.className).toContain('border-amber-500');
    expect(screen.getByText('Irreversible')).toBeTruthy();

    fireEvent.click(confirm);
    expect(onRequestConfirm).toHaveBeenCalledTimes(1);
  });

  it('a reversible option carries no irreversible styling', () => {
    renderCard();

    const confirm = screen.getByTestId('cockpit-card-confirm');
    expect(confirm.getAttribute('data-irreversible')).toBe('false');
    expect(confirm.className).not.toContain('border-amber-500');
    expect(screen.queryByText('Irreversible')).toBeNull();
  });

  it('the person’s own reply goes through the same bar', () => {
    renderCard();

    fireEvent.click(screen.getByTestId('cockpit-card-option-trigger'));
    const editor = screen.getByTestId('cockpit-card-own-reply-input');
    fireEvent.change(editor, { target: { value: 'Keep it for one more day.' } });

    const confirm = screen.getByTestId('cockpit-card-confirm');
    expect(confirm.textContent).toContain('your reply');
    expect(confirm.hasAttribute('disabled')).toBe(false);
  });

  it('with no suggested option the bar has nothing to confirm and is disabled', () => {
    const card: CockpitCardData = {
      ...CARD,
      options: CARD.options.map((option) => ({ ...option, suggested: false })),
    };
    renderCard({ card });

    const confirm = screen.getByTestId('cockpit-card-confirm');
    expect(confirm.textContent).toContain('Nothing to confirm');
    expect(confirm.hasAttribute('disabled')).toBe(true);
  });
});

describe('unknown kinds', () => {
  it('renders the default descriptor without throwing and keeps the options usable', () => {
    const card: CockpitCardData = { ...CARD, kind: 'kind-this-build-does-not-know' };

    expect(() => renderCard({ card })).not.toThrow();
    expect(screen.getByText('Card')).toBeTruthy();
    // The default descriptor names no viz, so even a card that carries one draws nothing.
    expect(cockpitCardDescriptor(card.kind).viz).toBeNull();
    expect(screen.queryByTestId('cockpit-card-viz')).toBeNull();
    expect(screen.getByTestId('cockpit-card-confirm').textContent).toContain('Delete staging');
    expect(screen.getByTestId('cockpit-card-zone-a').textContent).toContain(
      'Should the cleanup delete the staging directory?',
    );
  });
});

describe('descriptor-driven small visualization', () => {
  /** The reading each known kind's fixture carries, mirroring the fixture provider's cards. */
  const VIZ_BY_KIND: Record<CockpitCardKind, CockpitCardViz> = {
    ask: { kind: 'history', history: { yes: 4, no: 1, other: 1 } },
    multi: { kind: 'parts', count: 2 },
    need: { kind: 'size', size: { current: 3, total: 5 } },
    stuck: { kind: 'attempts', count: 3 },
    fix: { kind: 'steps', count: 2 },
    decision: { kind: 'history', history: { yes: 1, no: 2, other: 3 } },
  };
  const KNOWN_KINDS: CockpitCardKind[] = ['ask', 'multi', 'need', 'stuck', 'fix', 'decision'];

  it('renders the descriptor badge and a data-viz-kind equal to the descriptor for every known kind', () => {
    for (const kind of KNOWN_KINDS) {
      cleanup();
      const descriptor = cockpitCardDescriptor(kind);
      expect(descriptor.viz, `${kind} must have a descriptor viz`).not.toBeNull();

      renderCard({ card: { ...CARD, kind, viz: VIZ_BY_KIND[kind] } });

      expect(screen.getByTestId('cockpit-card-zone-a').textContent).toContain(
        i18n.t(descriptor.labelKey),
      );
      const viz = screen.getByTestId('cockpit-card-viz');
      expect(viz.getAttribute('data-viz-kind')).toBe(descriptor.viz);
    }
  });

  it('draws each shape’s mechanical reading', () => {
    const vizFor = (kind: CockpitCardKind): HTMLElement => {
      cleanup();
      renderCard({ card: { ...CARD, kind, viz: VIZ_BY_KIND[kind] } });
      return screen.getByTestId('cockpit-card-viz');
    };

    const attempts = vizFor('stuck');
    expect(attempts.querySelector('[data-viz-count]')?.getAttribute('data-viz-count')).toBe('3');
    expect(attempts.querySelectorAll('[data-viz-dot]').length).toBe(3);

    const steps = vizFor('fix');
    expect(steps.querySelectorAll('[data-viz-step]').length).toBe(3);
    expect(steps.querySelectorAll('[data-viz-current="true"]').length).toBe(1);
    expect(steps.querySelector('[data-viz-current="true"]')?.getAttribute('data-viz-step')).toBe('2');

    const history = vizFor('ask');
    expect(history.querySelectorAll('[data-viz-segment]').length).toBe(3);
    for (const key of ['yes', 'no', 'other']) {
      expect(history.querySelector(`[data-viz-segment="${key}"]`)).toBeTruthy();
    }

    const size = vizFor('need');
    expect(Number(size.querySelector('[data-viz-ratio]')?.getAttribute('data-viz-ratio'))).toBeCloseTo(
      3 / 5,
    );
    expect(size.querySelector('[data-viz-fill="size"]')).toBeTruthy();

    const parts = vizFor('multi');
    expect(parts.querySelectorAll('[data-viz-part]').length).toBe(2);
    expect(parts.textContent).toContain('①');
    expect(parts.textContent).toContain('②');
  });

  it('draws nothing when the card’s viz kind disagrees with the descriptor', () => {
    renderCard({ card: { ...CARD, kind: 'ask', viz: { kind: 'steps', count: 2 } } });
    expect(screen.queryByTestId('cockpit-card-viz')).toBeNull();
  });

  it('draws nothing when the known kind carries no viz', () => {
    renderCard({ card: { ...CARD, kind: 'stuck' } });
    expect(screen.queryByTestId('cockpit-card-viz')).toBeNull();
  });
});

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
import CockpitCardDetails from '@/modules/cockpit/CockpitCardDetails';
import {
  cockpitCardDescriptor,
  cockpitTagIcon,
} from '@/modules/cockpit/cockpitCardDescriptors';
import type {
  CockpitCardDensity,
  CockpitCardShown,
} from '@/modules/cockpit/cockpitCardController';
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
  subject: {
    uri: 'cloudcli://fixture/ask',
    project: 'fixture-project',
    sessionId: 'fixture-session',
    title: 'Cleanup the staging directory',
  },
  load: 2,
  ask: 'Should the cleanup delete the staging directory?',
  situation: 'The run left 1.2 GB in staging.',
  facts: [
    { text: 'staging holds 1.2 GB', mechanical: true },
    { text: 'transcript archived', mechanical: false },
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
      tags: [
        { kind: 'undo', text: '可撤' },
        { kind: 'cost', text: '约 1 分钟' },
      ],
    },
    {
      id: 'park',
      label: 'Park it',
      does: 'Stop the run and keep the transcript.',
      suggested: false,
      source: 'provider',
      action: { executor: 'fixture.record', params: { optionId: 'park' } },
      tags: [{ kind: 'irreversible', text: '不可逆' }],
    },
  ],
  ownReply: { executor: 'fixture.record', params: { cardId: 'fixture:ask' } },
  conversation: { sessionId: 'fixture-session' },
};

type FixtureProps = {
  card: CockpitCardData;
  density?: CockpitCardDensity;
  onOpenDetails: () => void;
  onRequestConfirm: () => void;
};

/** The card with just enough local state to exercise its own controls. */
function Fixture({ card, density = 'cards', onOpenDetails, onRequestConfirm }: FixtureProps) {
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
      density={density}
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
  density = 'cards',
  onOpenDetails = vi.fn(),
  onRequestConfirm = vi.fn(),
}: {
  card?: CockpitCardData;
  density?: CockpitCardDensity;
  onOpenDetails?: () => void;
  onRequestConfirm?: () => void;
} = {}) {
  return render(
    <I18nextProvider i18n={i18n}>
      <Fixture
        card={card}
        density={density}
        onOpenDetails={onOpenDetails}
        onRequestConfirm={onRequestConfirm}
      />
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

describe('the header row: kind mark, project, subject name, age and load', () => {
  it('names the project, the subject and the compact age', () => {
    renderCard();

    expect(screen.getByTestId('cockpit-card-kind-badge').textContent).toBe('ASK');
    expect(screen.getByTestId('cockpit-card-project').textContent).toBe('fixture-project');
    expect(screen.getByTestId('cockpit-card-subject').textContent).toContain(
      'Cleanup the staging directory',
    );
    expect(screen.getByTestId('cockpit-card-age').textContent).toBe('4m');
  });

  it('draws the three-cell load reading only when the card states one', () => {
    renderCard();

    const load = screen.getByTestId('cockpit-card-load');
    expect(load.getAttribute('data-load')).toBe('2');
    const cells = [...load.querySelectorAll('[data-load-cell]')];
    expect(cells.length).toBe(3);
    expect(cells.filter((cell) => cell.getAttribute('data-filled') === 'true').length).toBe(2);

    cleanup();
    renderCard({ card: { ...CARD, load: undefined } });
    expect(screen.queryByTestId('cockpit-card-load')).toBeNull();
  });

  it('falls back from the subject title to the task id and then the shortened session id', () => {
    const subjectNameOf = (subject: CockpitCardData['subject']): string | null => {
      cleanup();
      renderCard({ card: { ...CARD, subject } });
      const node = screen.queryByTestId('cockpit-card-subject');
      return node === null ? null : node.textContent;
    };

    expect(subjectNameOf({ uri: 'u', project: 'p', taskId: 'gap-routine-x' })).toContain(
      'gap-routine-x',
    );
    expect(subjectNameOf({ uri: 'u', project: 'p', sessionId: 'dbbf1404-aaaa-bbbb' })).toContain(
      'dbbf1404',
    );
    expect(subjectNameOf({ uri: 'u', project: 'p' })).toBeNull();
  });
});

describe('facts and the small visualization', () => {
  it('marks a mechanical fact with ● and a judgement fact with ○', () => {
    renderCard();

    const facts = screen.getAllByTestId('cockpit-card-fact');
    expect(facts.length).toBe(2);
    expect(facts[0].getAttribute('data-mechanical')).toBe('true');
    expect(facts[0].textContent).toContain('●');
    expect(facts[0].textContent).toContain('staging holds 1.2 GB');
    expect(facts[1].getAttribute('data-mechanical')).toBe('false');
    expect(facts[1].textContent).toContain('○');
  });

  it('draws no pill for a fact the situation already states, and keeps the full text in Details', () => {
    const repeated: CockpitCardData = {
      ...CARD,
      // One fact is the situation with different case, the other is a phrase the situation
      // contains; both are the same reading printed twice, so neither becomes a pill.
      facts: [
        { text: 'the run left 1.2 gb in staging.', mechanical: true },
        { text: 'in staging', mechanical: false },
        { text: 'transcript archived', mechanical: false },
      ],
    };
    renderCard({ card: repeated });

    const facts = screen.getAllByTestId('cockpit-card-fact');
    expect(facts.length).toBe(1);
    expect(facts[0].textContent).toContain('transcript archived');

    cleanup();
    render(
      <I18nextProvider i18n={i18n}>
        <CockpitCardDetails card={repeated} now={NOW} onClose={() => undefined} />
      </I18nextProvider>,
    );
    const detailsFacts = screen.getByTestId('cockpit-card-details-facts');
    expect(detailsFacts.textContent).toContain('transcript archived');
    expect(detailsFacts.textContent).not.toContain('the run left 1.2 gb in staging.');
  });

  it('shrinks a long fact to a pill but keeps its whole sentence in the title and in Details', () => {
    const longFact =
      'a measured reading that is far too long to fit inside one pill because it keeps going and going';
    const longCard: CockpitCardData = {
      ...CARD,
      facts: [{ text: longFact, mechanical: true }],
    };
    renderCard({ card: longCard });

    const pill = screen.getByTestId('cockpit-card-fact');
    expect(pill.textContent).not.toContain(longFact);
    expect(pill.textContent?.trim().endsWith('…')).toBe(true);
    expect(pill.getAttribute('title')).toBe(longFact);

    cleanup();
    render(
      <I18nextProvider i18n={i18n}>
        <CockpitCardDetails card={longCard} now={NOW} onClose={() => undefined} />
      </I18nextProvider>,
    );
    expect(screen.getByTestId('cockpit-card-details-facts').textContent).toContain(longFact);
  });

  it('draws the attempts reading with one dot per attempt, old → new and capped', () => {
    const stuck: CockpitCardData = {
      ...CARD,
      kind: 'stuck',
      viz: {
        kind: 'attempts',
        cap: 3,
        // Newest first on the wire; the row draws the three newest, reversed.
        items: [
          { at: '2026-10-27T00:04:00.000Z', outcome: 'running' },
          { at: '2026-10-27T00:03:00.000Z', outcome: 'failed' },
          { at: '2026-10-27T00:02:00.000Z', outcome: 'landed' },
          { at: '2026-10-27T00:01:00.000Z', outcome: 'pending' },
        ],
      },
    };
    renderCard({ card: stuck });

    const viz = screen.getByTestId('cockpit-card-viz');
    expect(viz.getAttribute('data-viz-kind')).toBe('attempts');
    const outcomes = [...viz.querySelectorAll('[data-viz-dot]')].map((dot) =>
      dot.getAttribute('data-viz-outcome'),
    );
    expect(outcomes).toEqual(['landed', 'failed', 'running']);
  });

  it('keeps the scalar attempts reading readable', () => {
    renderCard({ card: { ...CARD, kind: 'stuck', viz: { kind: 'attempts', count: 2 } } });

    const viz = screen.getByTestId('cockpit-card-viz');
    expect(viz.querySelector('[data-viz-count]')?.getAttribute('data-viz-count')).toBe('2');
    expect(viz.querySelectorAll('[data-viz-dot]').length).toBe(2);
  });

  it('draws nothing when the card carries no viz', () => {
    renderCard();
    expect(screen.queryByTestId('cockpit-card-viz')).toBeNull();
  });

  it('draws nothing when the card’s viz kind disagrees with the descriptor', () => {
    renderCard({ card: { ...CARD, kind: 'stuck', viz: { kind: 'steps', count: 2 } } });
    expect(screen.queryByTestId('cockpit-card-viz')).toBeNull();
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

  it('draws the options as a radio group and keeps the current selection marked', () => {
    renderCard();
    fireEvent.click(screen.getByTestId('cockpit-card-option-trigger'));

    const list = screen.getByTestId('cockpit-card-option-list');
    expect(list.getAttribute('role')).toBe('radiogroup');
    // Two options and the person's own reply: exactly one row is the shown reading.
    expect(within(list).getAllByRole('radio').length).toBe(3);
    expect(within(list).getAllByTestId('cockpit-card-option-radio').length).toBe(3);

    const deleteItem = within(list).getByTestId('cockpit-card-option-delete');
    const parkItem = within(list).getByTestId('cockpit-card-option-park');
    expect(deleteItem.getAttribute('role')).toBe('radio');
    expect(deleteItem.getAttribute('aria-checked')).toBe('true');
    expect(deleteItem.getAttribute('data-selected')).toBe('true');
    expect(parkItem.getAttribute('aria-checked')).toBe('false');
    expect(parkItem.getAttribute('data-selected')).toBe('false');

    // Switching the shown option moves the selection marker with it.
    fireEvent.click(parkItem);
    fireEvent.click(screen.getByTestId('cockpit-card-option-trigger'));
    const reopened = screen.getByTestId('cockpit-card-option-list');
    expect(within(reopened).getByTestId('cockpit-card-option-park').getAttribute('aria-checked')).toBe(
      'true',
    );
    expect(
      within(reopened).getByTestId('cockpit-card-option-delete').getAttribute('data-selected'),
    ).toBe('false');
  });

  it('heads the own-reply editor exactly once inside the dropdown', () => {
    renderCard();
    fireEvent.click(screen.getByTestId('cockpit-card-option-trigger'));

    const list = screen.getByTestId('cockpit-card-option-list');
    const headings = (list.textContent ?? '').split('Write your own').length - 1;
    expect(headings).toBe(1);
    expect(within(list).getAllByTestId('cockpit-card-own-reply-input').length).toBe(1);
    expect(within(list).getByTestId('cockpit-card-own-reply-trigger').textContent).toContain(
      'Write your own',
    );
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
    expect(trigger.textContent).toContain('● from assistant');
    expect(trigger.textContent).toContain('1 of 2');
  });

  it('shows a judge-sourced default with its ○ marker and the judge’s reason', () => {
    const judgeWhy = 'The archive is verified, so deletion is the low-risk next step.';
    const judgeCard: CockpitCardData = {
      ...CARD,
      options: [
        {
          ...CARD.options[0],
          suggested: true,
          source: 'judge',
          why: judgeWhy,
        },
        { ...CARD.options[1], suggested: false },
      ],
    };
    renderCard({ card: judgeCard });

    const trigger = screen.getByTestId('cockpit-card-option-trigger');
    expect(trigger.textContent).toContain('Delete staging');
    expect(trigger.textContent).toContain('suggested');
    expect(trigger.textContent).toContain('○ judge');
    expect(trigger.getAttribute('data-source')).toBe('judge');
    expect(trigger.getAttribute('data-suggested')).toBe('true');

    const shown = screen.getByTestId('cockpit-card-shown-option');
    expect(shown.getAttribute('data-source')).toBe('judge');
    expect(shown.textContent).toContain('Remove the staging directory after the archive is verified.');
    expect(screen.getByTestId('cockpit-card-shown-option-why').textContent).toBe(judgeWhy);

    // The judge suggestion is a preselection: the confirm bar is bound to it.
    expect(screen.getByTestId('cockpit-card-confirm').textContent).toContain('Delete staging');
  });

  it('shows no default when no option of any source is suggested', () => {
    renderCard({
      card: {
        ...CARD,
        options: [
          { ...CARD.options[0], suggested: false, source: 'provider' },
          { ...CARD.options[1], suggested: false },
        ],
      },
    });

    const trigger = screen.getByTestId('cockpit-card-option-trigger');
    expect(trigger.textContent).toContain('Choose an option');
    expect(trigger.textContent).not.toContain('suggested');
    expect(screen.queryByTestId('cockpit-card-shown-option')).toBeNull();
    expect(screen.getByTestId('cockpit-card-confirm-empty').textContent).toContain(
      'Choose an option, then confirm',
    );
  });

  it('draws the consequence tags with their descriptor glyphs', () => {
    renderCard();
    fireEvent.click(screen.getByTestId('cockpit-card-option-trigger'));

    const list = screen.getByTestId('cockpit-card-option-list');
    const undo = within(list).getByText('可撤');
    expect(undo.closest('[data-tag-kind]')?.getAttribute('data-tag-kind')).toBe('undo');
    expect(undo.textContent).toBe('↺ 可撤');

    const cost = within(list).getByText('约 1 分钟');
    expect(cost.textContent).toBe('◷ 约 1 分钟');

    const irreversible = within(list).getByText('不可逆');
    expect(irreversible.textContent).toBe('⚠ 不可逆');
  });

  it('an unknown tag kind keeps the provider’s words and draws no glyph', () => {
    renderCard({
      card: {
        ...CARD,
        options: [
          {
            ...CARD.options[0],
            tags: [{ kind: 'mystery-kind', text: '未定义的后果' }],
          },
        ],
      },
    });
    fireEvent.click(screen.getByTestId('cockpit-card-option-trigger'));

    expect(screen.getByText('未定义的后果').textContent).toBe('未定义的后果');
    expect(cockpitTagIcon('mystery-kind')).toBeNull();
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

  it('a reversible option carries the solid bar and the one-line hint', () => {
    renderCard();

    const confirm = screen.getByTestId('cockpit-card-confirm');
    expect(confirm.getAttribute('data-irreversible')).toBe('false');
    expect(confirm.className).not.toContain('border-amber-500');
    expect(confirm.className).toContain('bg-neutral-950');
    expect(screen.getByTestId('cockpit-card-confirm-hint').textContent).toBe(
      'opens the confirm card — nothing is sent yet',
    );
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

  it('with no recommendation draws one quiet line instead of a full-width button', () => {
    const card: CockpitCardData = {
      ...CARD,
      options: CARD.options.map((option) => ({ ...option, suggested: false })),
    };
    renderCard({ card });

    expect(screen.queryByTestId('cockpit-card-confirm')).toBeNull();
    expect(screen.getByTestId('cockpit-card-confirm-empty').textContent).toBe(
      'Choose an option, then confirm',
    );
  });

  it('the quiet line gives way to the bar once an option is chosen', () => {
    const card: CockpitCardData = {
      ...CARD,
      options: CARD.options.map((option) => ({ ...option, suggested: false })),
    };
    renderCard({ card });

    fireEvent.click(screen.getByTestId('cockpit-card-option-trigger'));
    fireEvent.click(screen.getByTestId('cockpit-card-option-park'));

    expect(screen.queryByTestId('cockpit-card-confirm-empty')).toBeNull();
    expect(screen.getByTestId('cockpit-card-confirm').textContent).toContain('Park it');
  });
});

describe('compact density: three lines per card', () => {
  it('omits the shown-option explanation but still offers the dropdown and Confirm', () => {
    renderCard({ density: 'compact' });

    expect(screen.queryByTestId('cockpit-card-shown-option')).toBeNull();
    // The compact card draws no fact pills either: the question and one situation line only.
    expect(screen.queryByTestId('cockpit-card-zone-a-facts')).toBeNull();

    const trigger = screen.getByTestId('cockpit-card-option-trigger');
    const confirm = screen.getByTestId('cockpit-card-confirm');
    expect(confirm.textContent).toBe('Confirm');

    const row = trigger.closest('[data-testid="cockpit-card-controls"]');
    expect(row).not.toBeNull();
    expect(confirm.closest('[data-testid="cockpit-card-controls"]')).toBe(row);
    expect(row?.className).toContain('flex');
    expect(confirm.className).toContain('w-auto');
    expect(screen.queryByTestId('cockpit-card-confirm-hint')).toBeNull();
  });

  it('keeps the own-reply editor out of the compact body but keeps it in the open list', () => {
    renderCard({ density: 'compact' });

    fireEvent.click(screen.getByTestId('cockpit-card-option-trigger'));
    expect(screen.getByTestId('cockpit-card-own-reply-input')).toBeTruthy();
  });
});

describe('confirmability, missing content and the title fallback', () => {
  it('disables the bar and states why when the shown option’s executor is not declared', () => {
    const onRequestConfirm = vi.fn();
    const card: CockpitCardData = {
      ...CARD,
      options: [
        {
          ...CARD.options[0],
          action: { executor: 'fleet.redispatch', params: {} },
          confirmable: false,
          confirmableReason: '执行器 fleet.redispatch 尚未接入',
        },
      ],
    };
    renderCard({ card, onRequestConfirm });

    const confirm = screen.getByTestId('cockpit-card-confirm');
    expect(confirm.hasAttribute('disabled')).toBe(true);
    expect(screen.getByTestId('cockpit-card-confirm-disabled-reason').textContent).toContain(
      'fleet.redispatch',
    );
    fireEvent.click(confirm);
    expect(onRequestConfirm).not.toHaveBeenCalled();
  });

  it('draws the content-unavailable reason instead of leaving the situation blank', () => {
    const reason = '提问决策摘要未启用：未启用 observation.sessionDigest（提问决策摘要）';
    renderCard({
      card: { ...CARD, ask: undefined, situation: undefined, contentUnavailable: reason },
    });

    expect(screen.getByTestId('cockpit-card-content-unavailable').textContent).toBe(reason);
  });

  it('falls back from an empty ask to the task name, the first fact and finally the uri', () => {
    const base: CockpitCardData = {
      ...CARD,
      ask: undefined,
      situation: undefined,
      facts: [],
      subject: { uri: 'quay://quay/task/example' },
    };
    const titleOf = (card: CockpitCardData): string | null => {
      const view = renderCard({ card });
      const title = screen.getByTestId('cockpit-card-zone-a-question').textContent;
      view.unmount();
      return title;
    };

    expect(titleOf({ ...base, subject: { uri: 'quay://quay/task/x', taskId: 'gap-routine-x' } })).toBe(
      'gap-routine-x',
    );
    expect(
      titleOf({ ...base, facts: [{ text: 'the first measured fact', mechanical: true }] }),
    ).toBe('the first measured fact');
    expect(titleOf(base)).toBe('quay://quay/task/example');
  });

  it('names the waiting session when a session-ask card’s content is not ready', () => {
    const view = renderCard({
      card: {
        ...CARD,
        ask: undefined,
        situation: undefined,
        facts: [],
        subject: { uri: 'quay://quay/board', sessionId: 'dbbf1404-aaaa-bbbb' },
        contentUnavailable: '提问决策摘要尚未生成',
      },
    });

    expect(screen.getByTestId('cockpit-card-zone-a-question').textContent).toBe(
      'Session dbbf1404 is waiting for your answer',
    );
    view.unmount();
  });

  it('Details renders the original conversation link from a subject-only session card', () => {
    render(
      <I18nextProvider i18n={i18n}>
        <CockpitCardDetails
          card={{
            ...CARD,
            conversation: undefined,
            subject: { uri: 'quay://quay/task/x', sessionId: 'sess-42' },
          }}
          now={NOW}
          onClose={() => undefined}
        />
      </I18nextProvider>,
    );

    const link = screen.getByTestId('cockpit-card-conversation-link');
    expect(link.getAttribute('href')).toBe('/session/sess-42');
    expect(screen.queryByText(i18n.t('cockpit.cardDetailsNoConversation'))).toBeNull();
  });

  it('Details draws the content-unavailable reason', () => {
    render(
      <I18nextProvider i18n={i18n}>
        <CockpitCardDetails
          card={{ ...CARD, contentUnavailable: '提问决策摘要不完整，未设默认选项' }}
          now={NOW}
          onClose={() => undefined}
        />
      </I18nextProvider>,
    );

    expect(screen.getByTestId('cockpit-card-details-content-unavailable').textContent).toContain(
      '提问决策摘要不完整',
    );
  });
});

describe('unknown kinds', () => {
  it('renders the default descriptor without throwing and keeps the options usable', () => {
    const card: CockpitCardData = {
      ...CARD,
      kind: 'kind-this-build-does-not-know',
      viz: { kind: 'attempts', count: 2 },
    };

    expect(() => renderCard({ card })).not.toThrow();
    expect(screen.getByTestId('cockpit-card-kind-badge').textContent).toBe('CARD');
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
  /** The reading the kinds that draw a viz carry, mirroring the fixture provider's cards. */
  const ATTEMPTS: CockpitCardViz = {
    kind: 'attempts',
    cap: 5,
    items: [
      { at: '2026-10-27T00:02:40.000Z', outcome: 'running' },
      { at: '2026-10-27T00:01:30.000Z', outcome: 'failed' },
    ],
  };
  const KNOWN_KINDS: CockpitCardKind[] = ['ask', 'multi', 'need', 'stuck', 'fix', 'decision'];
  const VIZ_KINDS: CockpitCardKind[] = ['stuck', 'fix'];

  it('draws the descriptor badge for every known kind, and a viz only where the descriptor names one', () => {
    for (const kind of KNOWN_KINDS) {
      cleanup();
      const descriptor = cockpitCardDescriptor(kind);

      renderCard({ card: { ...CARD, kind, viz: ATTEMPTS } });

      expect(screen.getByTestId('cockpit-card-kind-badge').textContent).toBe(
        i18n.t(descriptor.badgeKey),
      );
      if (VIZ_KINDS.includes(kind)) {
        const viz = screen.getByTestId('cockpit-card-viz');
        expect(viz.getAttribute('data-viz-kind')).toBe(descriptor.viz);
      } else {
        expect(descriptor.viz).toBeNull();
        expect(screen.queryByTestId('cockpit-card-viz')).toBeNull();
      }
    }
  });
});

describe('Details: the persistent confirm bar and the Quay task link', () => {
  function renderDetails(
    card: CockpitCardData,
    target: ReturnType<typeof confirmTargetOf>,
    onRequestConfirm = vi.fn(),
  ) {
    return render(
      <I18nextProvider i18n={i18n}>
        <CockpitCardDetails
          card={card}
          now={NOW}
          onClose={() => undefined}
          target={target}
          onRequestConfirm={onRequestConfirm}
        />
      </I18nextProvider>,
    );
  }

  it('draws the bottom bar bound to the card’s current option and requests that confirmation', () => {
    // The target is the controller’s own derivation from the shown option — the same function
    // the card bar and the confirm path use, never a label the test placed on the drawer.
    const target = confirmTargetOf(CARD, defaultShownOption(CARD) ?? undefined, '');
    const onRequestConfirm = vi.fn();
    renderDetails(CARD, target, onRequestConfirm);

    expect(screen.getByTestId('cockpit-card-details-confirm-bar')).toBeTruthy();
    const bar = screen.getByTestId('cockpit-card-details-confirm');
    expect(bar.textContent).toContain('Delete staging');
    fireEvent.click(bar);
    expect(onRequestConfirm).toHaveBeenCalledTimes(1);
  });

  it('follows the shown option: switching it switches the bar’s label and warning', () => {
    const shown: CockpitCardShown = { kind: 'option', optionId: 'park' };
    renderDetails(CARD, confirmTargetOf(CARD, shown, ''));

    const bar = screen.getByTestId('cockpit-card-details-confirm');
    expect(bar.textContent).toContain('Park it');
    expect(bar.getAttribute('data-irreversible')).toBe('true');
  });

  it('draws no bar when the card has nothing to confirm', () => {
    renderDetails(CARD, confirmTargetOf(CARD, undefined, ''));
    expect(screen.queryByTestId('cockpit-card-details-confirm-bar')).toBeNull();
  });

  it('links a task card to its project’s Quay board, and only a task card has the link', () => {
    const taskCard: CockpitCardData = {
      ...CARD,
      subject: {
        uri: 'quay://quay/task/gap-routine-x',
        project: 'proj-7',
        taskId: 'gap-routine-x',
      },
    };
    renderDetails(taskCard, null);

    const link = screen.getByTestId('cockpit-card-open-in-quay');
    expect(link.textContent).toBe('Open in Quay');
    expect(link.getAttribute('href')).toBe('/cockpit?view=board&project=proj-7');
    expect(link.getAttribute('data-task-id')).toBe('gap-routine-x');

    cleanup();
    renderDetails(CARD, null);
    expect(screen.queryByTestId('cockpit-card-open-in-quay')).toBeNull();
  });
});

describe('provider-agnostic rendering', () => {
  it('renders the same card the same way whatever the provider field says', () => {
    const first = renderCard({ card: { ...CARD, provider: 'fixture' } });
    const fixtureHtml = first.container.innerHTML;
    first.unmount();

    const second = renderCard({ card: { ...CARD, provider: 'quay-fleet' } });
    expect(second.container.innerHTML).toBe(fixtureHtml);
  });
});

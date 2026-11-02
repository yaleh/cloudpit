import { cleanup, fireEvent, render, screen, within } from '@testing-library/react';
import { useState } from 'react';
import { I18nextProvider } from 'react-i18next';
import { afterEach, beforeAll, describe, expect, it, vi } from 'vitest';

import type {
  CockpitCard as CockpitCardData,
  CockpitCardFeedback,
  CockpitCardKind,
  CockpitCardViz,
} from '@/shared/types';
import { i18n } from '@/modules/i18n';
import CockpitCard from '@/modules/cockpit/cards/CockpitCard';
import CockpitCardDetails from '@/modules/cockpit/cards/CockpitCardDetails';
import CockpitCardFacts from '@/modules/cockpit/cards/CockpitCardFacts';
import CockpitCardHeader from '@/modules/cockpit/cards/CockpitCardHeader';
import CockpitCardOptions from '@/modules/cockpit/cards/CockpitCardOptions';
import {
  cockpitCardDescriptor,
  cockpitTagIcon,
} from '@/modules/cockpit/cockpitCardDescriptors';
import type {
  CockpitCardConfirmOutcome,
  CockpitCardDensity,
  CockpitCardSendCountdown,
  CockpitCardShown,
} from '@/modules/cockpit/cards/cockpitCardController';
import {
  confirmTargetOf,
  defaultShownOption,
  dismissTargetOf,
} from '@/modules/cockpit/cards/cockpitCardController';

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
  /** Stands in for the transport: the answer is drawn in the bar, exactly as the controller's is. */
  send?: () => CockpitCardConfirmOutcome;
  /** The controller's clock reading; the countdown's seconds are derived from it. */
  now?: number;
  /** Seeds a running countdown, for the states a click alone cannot reach at a chosen instant. */
  initialCountdown?: CockpitCardSendCountdown | null;
  /** Forces the in-flight reading, which is otherwise too short for a render to observe. */
  forceConfirming?: boolean;
  /** The feedback resend's transport, and the two readings the controller publishes around it. */
  onResendFeedback?: () => void;
  resendingFeedback?: boolean;
  feedbackResendError?: string | null;
  /** The third action's transports: the first press opens it, the second discards. */
  onRequestDismiss?: () => void;
  onConfirmDismiss?: () => void;
};

/** The card with just enough local state to exercise its own controls. */
function Fixture({
  card,
  density = 'cards',
  onOpenDetails,
  onRequestConfirm,
  send,
  now = NOW,
  initialCountdown = null,
  forceConfirming = false,
  onResendFeedback,
  resendingFeedback = false,
  feedbackResendError = null,
  onRequestDismiss,
  onConfirmDismiss,
}: FixtureProps) {
  const [shown, setShown] = useState<CockpitCardShown | undefined>(
    defaultShownOption(card) ?? undefined,
  );
  const [ownReply, setOwnReply] = useState('');
  const [dropdownOpen, setDropdownOpen] = useState(false);
  // The controller owns the situation's expansion (by card id and revision); the fixture keeps
  // the one boolean so the card's own control is exercised through real state.
  const [situationExpanded, setSituationExpanded] = useState(false);
  // The readings the controller publishes around one confirmation. A reversible option gets a
  // COUNTDOWN (no pending second press); an irreversible one gets `pending`. The fixture mirrors
  // the controller's branch so the component's in-place behaviour is exercised through real state.
  const [pending, setPending] = useState(false);
  const [countdown, setCountdown] = useState<CockpitCardSendCountdown | null>(initialCountdown);
  const [sending, setSending] = useState(false);
  const [outcome, setOutcome] = useState<CockpitCardConfirmOutcome | null>(null);
  // The third action mirrors the controller: it is derived from the card, opened by one press
  // and sent by the next, and it never touches the shown option or the confirm bar.
  const [dismissPending, setDismissPending] = useState(false);
  const [dismissing, setDismissing] = useState(false);
  const target = confirmTargetOf(card, shown, ownReply);
  const dismissTarget = dismissTargetOf(card);
  const confirming = forceConfirming || sending;

  return (
    <CockpitCard
      card={card}
      now={now}
      shown={shown}
      target={target}
      ownReply={ownReply}
      dropdownOpen={dropdownOpen}
      selected
      density={density}
      situationExpanded={situationExpanded}
      onToggleSituationExpanded={() => setSituationExpanded((expanded) => !expanded)}
      onSelect={() => undefined}
      onOpenDetails={onOpenDetails}
      onToggleDropdown={() => setDropdownOpen((open) => !open)}
      onShowOption={(optionId) => {
        setShown({ kind: 'option', optionId });
        setDropdownOpen(false);
        // The controller retreats on an option switch; the fixture mirrors that rule so the
        // in-place state is never drawn for an option that is no longer shown.
        setPending(false);
        setCountdown(null);
      }}
      onShowOwnReply={() => setShown({ kind: 'ownReply' })}
      onOwnReplyChange={(text) => {
        setOwnReply(text);
        setShown({ kind: 'ownReply' });
        setCountdown(null);
      }}
      confirmPending={pending}
      sendCountdown={countdown}
      confirming={confirming}
      outcome={outcome}
      onRequestConfirm={() => {
        onRequestConfirm();
        setOutcome(null);
        if (target === null) return;
        if (target.irreversible) {
          setPending(true);
          return;
        }
        setCountdown({
          cardId: card.id,
          revision: card.revision,
          startedAt: now,
          firesAt: now + 5_000,
        });
      }}
      onCancelConfirm={() => {
        setPending(false);
        setCountdown(null);
      }}
      onConfirm={() => {
        if (send === undefined) return;
        setSending(true);
        const answer = send();
        setSending(false);
        setPending(false);
        setOutcome(answer);
      }}
      onResendFeedback={onResendFeedback}
      resendingFeedback={resendingFeedback}
      feedbackResendError={feedbackResendError}
      dismissTarget={dismissTarget}
      dismissPending={dismissPending}
      dismissing={dismissing}
      onRequestDismiss={() => {
        onRequestDismiss?.();
        setDismissPending(true);
      }}
      onConfirmDismiss={() => {
        onConfirmDismiss?.();
        setDismissing(true);
        setDismissPending(false);
        setDismissing(false);
      }}
      onCancelDismiss={() => setDismissPending(false)}
    />
  );
}

function renderCard({
  card = CARD,
  density = 'cards',
  onOpenDetails = vi.fn(),
  onRequestConfirm = vi.fn(),
  send,
  now = NOW,
  initialCountdown = null,
  forceConfirming = false,
  onResendFeedback,
  resendingFeedback = false,
  feedbackResendError = null,
}: {
  card?: CockpitCardData;
  density?: CockpitCardDensity;
  onOpenDetails?: () => void;
  onRequestConfirm?: () => void;
  send?: () => CockpitCardConfirmOutcome;
  now?: number;
  initialCountdown?: CockpitCardSendCountdown | null;
  forceConfirming?: boolean;
  onResendFeedback?: () => void;
  resendingFeedback?: boolean;
  feedbackResendError?: string | null;
} = {}) {
  return render(
    <I18nextProvider i18n={i18n}>
      <Fixture
        card={card}
        density={density}
        onOpenDetails={onOpenDetails}
        onRequestConfirm={onRequestConfirm}
        send={send}
        now={now}
        initialCountdown={initialCountdown}
        forceConfirming={forceConfirming}
        onResendFeedback={onResendFeedback}
        resendingFeedback={resendingFeedback}
        feedbackResendError={feedbackResendError}
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

describe('the age reading is one format in both places', () => {
  it('renders the list chip’s exact age string in the Details header', () => {
    // 11.2h before NOW: the list rounds to one decimal (`11.2h`), while the Details header used
    // the observation wall's coarse `11 h ago`. Same card and same `waitingSince`, so the two
    // readings of one wait must be the same string.
    const aged: CockpitCardData = { ...CARD, waitingSince: '2026-10-26T12:58:00.000Z' };
    renderCard({ card: aged });
    const listAge = screen.getByTestId('cockpit-card-age').textContent;
    expect(listAge).toBe('11.2h');

    cleanup();
    render(
      <I18nextProvider i18n={i18n}>
        <CockpitCardDetails card={aged} now={NOW} onClose={() => undefined} />
      </I18nextProvider>,
    );
    expect(screen.getByTestId('cockpit-card-details-age').textContent).toBe(`waiting ${listAge}`);
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

  it('draws the trigger and the shown explanation as ONE framed box', () => {
    renderCard();

    const frame = screen.getByTestId('cockpit-card-option-frame');
    const trigger = screen.getByTestId('cockpit-card-option-trigger');
    const explanation = screen.getByTestId('cockpit-card-shown-option');

    // The frame is the only element of this block that carries the border and the rounding, and
    // both the trigger and the explanation live inside it — one selected option, not two boxes.
    expect(frame.contains(trigger)).toBe(true);
    expect(frame.contains(explanation)).toBe(true);
    expect(frame.className).toContain('border');
    expect(frame.className).toContain('rounded-md');
    expect(trigger.className).not.toContain('rounded-md');
    expect(trigger.className).not.toContain('border-border');
    expect(explanation.className).not.toContain('rounded-md');
    expect(explanation.className).not.toContain('mt-1.5');
    expect(explanation.className).toContain('border-t');
  });

  it('keeps the open list out of the frame and draws no explanation then', () => {
    renderCard();

    fireEvent.click(screen.getByTestId('cockpit-card-option-trigger'));
    const frame = screen.getByTestId('cockpit-card-option-frame');
    expect(screen.getByTestId('cockpit-card-option-list')).toBeTruthy();
    expect(frame.contains(screen.getByTestId('cockpit-card-option-list'))).toBe(false);
    expect(screen.queryByTestId('cockpit-card-shown-option')).toBeNull();
  });

  it('draws no explanation in Compact density', () => {
    renderCard({ density: 'compact' });

    expect(screen.queryByTestId('cockpit-card-shown-option')).toBeNull();
    const frame = screen.getByTestId('cockpit-card-option-frame');
    expect(frame.contains(screen.getByTestId('cockpit-card-option-trigger'))).toBe(true);
  });

  it('frames only the trigger when the person’s own reply is shown', () => {
    renderCard();

    fireEvent.click(screen.getByTestId('cockpit-card-option-trigger'));
    fireEvent.click(screen.getByTestId('cockpit-card-own-reply-trigger'));
    // Close the dropdown: the reply editor is the body's own control, outside the frame.
    fireEvent.click(screen.getByTestId('cockpit-card-option-trigger'));

    const frame = screen.getByTestId('cockpit-card-option-frame');
    expect(screen.queryByTestId('cockpit-card-shown-option')).toBeNull();
    expect(frame.children.length).toBe(1);
    expect(frame.firstElementChild).toBe(screen.getByTestId('cockpit-card-option-trigger'));
    expect(screen.getByTestId('cockpit-card-own-reply-input')).toBeTruthy();
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

    // The judge suggestion is a preselection: the confirm bar is bound to it. The button no longer
    // repeats the option text — the trigger above already names the choice.
    expect(screen.getByTestId('cockpit-card-confirm').textContent?.trim()).toBe('Confirm');
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
  it('keeps one short label and follows a switch', () => {
    const onRequestConfirm = vi.fn();
    renderCard({ onRequestConfirm });

    const confirm = screen.getByTestId('cockpit-card-confirm');
    expect(confirm.textContent?.trim()).toBe('Confirm');

    fireEvent.click(screen.getByTestId('cockpit-card-option-trigger'));
    fireEvent.click(screen.getByTestId('cockpit-card-option-park'));

    // The bar follows the target (the solid/amber styling flips) but its text does not name it.
    expect(confirm.textContent).toContain('Confirm');
    expect(confirm.textContent).not.toContain('Park it');
    expect(confirm.getAttribute('data-irreversible')).toBe('true');
    expect(confirm.className).toContain('border-amber-500');
    expect(screen.getByText('Irreversible')).toBeTruthy();

    fireEvent.click(confirm);
    expect(onRequestConfirm).toHaveBeenCalledTimes(1);
  });

  it('a reversible option carries the solid bar and draws no hint row', () => {
    renderCard();

    const confirm = screen.getByTestId('cockpit-card-confirm');
    expect(confirm.getAttribute('data-irreversible')).toBe('false');
    expect(confirm.className).not.toContain('border-amber-500');
    expect(confirm.className).toContain('bg-neutral-950');
    // The idle bar is the button alone: the old one-line hint was redundant with it.
    expect(screen.queryByTestId('cockpit-card-confirm-hint')).toBeNull();
    expect(screen.queryByTestId('cockpit-card-confirm-message')).toBeNull();
    expect(screen.queryByText('Irreversible')).toBeNull();
  });

  it('the person’s own reply goes through the same bar', () => {
    renderCard();

    fireEvent.click(screen.getByTestId('cockpit-card-option-trigger'));
    const editor = screen.getByTestId('cockpit-card-own-reply-input');
    fireEvent.change(editor, { target: { value: 'Keep it for one more day.' } });

    const confirm = screen.getByTestId('cockpit-card-confirm');
    expect(confirm.textContent?.trim()).toBe('Confirm');
    expect(confirm.hasAttribute('disabled')).toBe(false);
  });

  it('keeps the idle confirm button to the short label, whatever the option text', () => {
    // 60+ characters is the live failure case: the old 「Confirm · {{label}}」 button was cut off
    // at 440px and did not fit a phone, while the trigger above it already names the choice.
    const longLabel = 'Remove the staging directory only after the archive has been verified twice';
    expect(longLabel.length).toBeGreaterThanOrEqual(60);
    const card: CockpitCardData = {
      ...CARD,
      options: [{ ...CARD.options[0], label: longLabel, suggested: true }, CARD.options[1]],
    };
    renderCard({ card });

    const confirm = screen.getByTestId('cockpit-card-confirm');
    expect(confirm.textContent?.trim()).toBe('Confirm');
    for (const fragment of ['Remove the staging', 'archive', 'verified twice']) {
      expect(confirm.textContent, `the idle button leaks “${fragment}”`).not.toContain(fragment);
    }
    // The option's own words are not lost: the trigger still draws the whole label.
    expect(screen.getByTestId('cockpit-card-option-trigger').textContent).toContain(longLabel);

    // The person's own reply is expressed the same way: one short label, no reply echo.
    fireEvent.click(screen.getByTestId('cockpit-card-option-trigger'));
    fireEvent.change(screen.getByTestId('cockpit-card-own-reply-input'), {
      target: { value: 'Keep it for one more day.' },
    });
    expect(screen.getByTestId('cockpit-card-confirm').textContent?.trim()).toBe('Confirm');
  });

  it('keeps an irreversible option’s text in the floating caption once the button is short', () => {
    const irreversibleLabel = 'Stop the run and keep the transcript for another week';
    const card: CockpitCardData = {
      ...CARD,
      options: [CARD.options[0], { ...CARD.options[1], label: irreversibleLabel }],
    };
    renderCard({ card });

    fireEvent.click(screen.getByTestId('cockpit-card-option-trigger'));
    fireEvent.click(screen.getByTestId('cockpit-card-option-park'));
    fireEvent.click(screen.getByTestId('cockpit-card-confirm'));

    // The button is in its send state, and the caption above it still says WHAT will be sent.
    const pending = screen.getByTestId('cockpit-card-confirm');
    expect(pending.getAttribute('data-confirm-mode')).toBe('send');
    expect(pending.textContent).not.toContain(irreversibleLabel);
    expect(screen.getByTestId('cockpit-card-confirm-message').textContent).toContain(
      irreversibleLabel,
    );
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
    // Park is irreversible, so the button carries its ⚠ mark; the option's own text is not in it.
    expect(screen.getByTestId('cockpit-card-confirm').textContent).toContain('Confirm');
    expect(screen.getByTestId('cockpit-card-confirm').textContent).not.toContain('Park it');
  });
});

describe('the confirm state is drawn in place, inside the card’s own bar', () => {
  it('a reversible option’s one press becomes a countdown on the same button, and cancels there', () => {
    const onRequestConfirm = vi.fn();
    const send = vi.fn(() => ({
      ok: true as const,
      cardId: 'fixture:ask',
      executor: 'fixture.record',
      result: {},
    }));
    renderCard({ onRequestConfirm, send });

    const before = screen.getByTestId('cockpit-card-confirm');
    expect(before.getAttribute('data-confirm-mode')).toBe('open');
    fireEvent.click(before);

    // The SAME element, in the same place: mode `cancel`, the seconds on the label, the fill
    // underneath. No explanation row exists in this state either.
    const counting = screen.getByTestId('cockpit-card-confirm');
    expect(counting).toBe(before);
    expect(counting.getAttribute('data-confirm-mode')).toBe('cancel');
    expect(counting.getAttribute('data-confirm-seconds')).toBe('5');
    expect(counting.textContent).toContain('Sending in 5s · tap to cancel');
    expect(screen.getByTestId('cockpit-card-confirm-bar').getAttribute('data-confirm-pending')).toBe('true');
    expect(screen.getByTestId('cockpit-card-confirm-progress').getAttribute('data-progress')).toBe('0.000');
    expect(screen.queryByTestId('cockpit-card-confirm-message')).toBeNull();
    expect(screen.queryByTestId('cockpit-card-confirm-hint')).toBeNull();
    expect(onRequestConfirm).toHaveBeenCalledTimes(1);
    expect(send).toHaveBeenCalledTimes(0);
    // Nothing is mounted at the window's bottom: the bar that draws the state is the card's own.
    expect(document.querySelector('[data-testid="cockpit-card-confirm-panel"]')).toBeNull();
    expect(document.querySelector('[role="dialog"]')).toBeNull();

    // Pressing the SAME button cancels: back to idle, and nothing was sent.
    fireEvent.click(screen.getByTestId('cockpit-card-confirm'));
    expect(screen.getByTestId('cockpit-card-confirm').getAttribute('data-confirm-mode')).toBe('open');
    expect(screen.getByTestId('cockpit-card-confirm-bar').getAttribute('data-confirm-pending')).toBe('false');
    expect(send).toHaveBeenCalledTimes(0);
    expect(onRequestConfirm).toHaveBeenCalledTimes(1);
  });

  it('the countdown’s seconds and fill follow the injected clock', () => {
    const countdown: CockpitCardSendCountdown = {
      cardId: 'fixture:ask',
      revision: 1,
      startedAt: NOW,
      firesAt: NOW + 5_000,
    };
    // Two seconds in: three whole seconds remain and the fill is two fifths of the way.
    renderCard({ now: NOW + 2_000, initialCountdown: countdown });

    const button = screen.getByTestId('cockpit-card-confirm');
    expect(button.getAttribute('data-confirm-mode')).toBe('cancel');
    expect(button.getAttribute('data-confirm-seconds')).toBe('3');
    expect(button.textContent).toContain('Sending in 3s · tap to cancel');
    expect(
      Number(screen.getByTestId('cockpit-card-confirm-progress').getAttribute('data-progress')),
    ).toBeCloseTo(0.4, 3);

    cleanup();
    // At the deadline the same reading is 「0 s」 and a full fill — it never wraps to 5 again.
    renderCard({ now: NOW + 5_000, initialCountdown: countdown });
    expect(screen.getByTestId('cockpit-card-confirm').getAttribute('data-confirm-seconds')).toBe('0');
    expect(screen.getByTestId('cockpit-card-confirm-progress').getAttribute('data-progress')).toBe('1.000');
  });

  it('a reversible option’s countdown draws no warning row for zero seconds of its life', () => {
    renderCard();
    fireEvent.click(screen.getByTestId('cockpit-card-confirm'));
    expect(screen.queryByTestId('cockpit-card-confirm-message')).toBeNull();
    expect(screen.queryByTestId('cockpit-card-confirm-warning')).toBeNull();
    expect(screen.queryByTestId('cockpit-card-confirm-cancel')).toBeNull();
  });

  it('an irreversible option keeps the two presses, and sends on the second', () => {
    const onRequestConfirm = vi.fn();
    const send = vi.fn(() => ({
      ok: true as const,
      cardId: 'fixture:ask',
      executor: 'fixture.record',
      result: {},
    }));
    renderCard({ onRequestConfirm, send });

    fireEvent.click(screen.getByTestId('cockpit-card-option-trigger'));
    fireEvent.click(screen.getByTestId('cockpit-card-option-park'));

    const before = screen.getByTestId('cockpit-card-confirm');
    expect(before.getAttribute('data-confirm-mode')).toBe('open');
    fireEvent.click(before);

    const pending = screen.getByTestId('cockpit-card-confirm');
    expect(pending).toBe(before);
    expect(pending.getAttribute('data-confirm-mode')).toBe('send');
    expect(pending.textContent).toContain('Confirm and send');
    // Still no countdown: the warning option is confirmed by a person, not by a timer.
    expect(pending.hasAttribute('data-confirm-seconds')).toBe(false);
    expect(screen.getByTestId('cockpit-card-confirm-bar').getAttribute('data-confirm-pending')).toBe('true');
    expect(screen.getByTestId('cockpit-card-confirm-message').textContent).toContain(
      'This sends “Park it” once.',
    );
    expect(document.querySelector('[role="dialog"]')).toBeNull();
    expect(send).toHaveBeenCalledTimes(0);

    fireEvent.click(screen.getByTestId('cockpit-card-confirm'));
    expect(send).toHaveBeenCalledTimes(1);
    expect(onRequestConfirm).toHaveBeenCalledTimes(1);
    expect(screen.getByTestId('cockpit-card-confirm-bar').getAttribute('data-confirm-pending')).toBe('false');
    expect(screen.getByTestId('cockpit-card-confirm').textContent).toContain('Confirm');
    const outcome = screen.getByTestId('cockpit-card-confirm-outcome');
    expect(outcome.getAttribute('role')).toBe('status');
    expect(outcome.getAttribute('data-ok')).toBe('true');
    expect(outcome.textContent).toBe('Sent ✓');
  });

  it('draws ⚠ and the consequence inside the bar for an irreversible option', () => {
    renderCard();

    fireEvent.click(screen.getByTestId('cockpit-card-option-trigger'));
    fireEvent.click(screen.getByTestId('cockpit-card-option-park'));
    fireEvent.click(screen.getByTestId('cockpit-card-confirm'));

    const warning = screen.getByTestId('cockpit-card-confirm-warning');
    expect(warning.textContent).toContain('⚠');
    expect(warning.textContent).toContain('This action cannot be undone.');
    expect(
      screen.getByTestId('cockpit-card-confirm-warning').closest('[data-testid="cockpit-card-confirm-bar"]'),
    ).not.toBeNull();
  });

  it('draws a failed confirmation’s reason inside the bar, not elsewhere on the page', () => {
    renderCard({
      send: () => ({ ok: false, cardId: 'fixture:ask', message: 'gateway answered 502' }),
    });

    fireEvent.click(screen.getByTestId('cockpit-card-option-trigger'));
    fireEvent.click(screen.getByTestId('cockpit-card-option-park'));
    fireEvent.click(screen.getByTestId('cockpit-card-confirm'));
    fireEvent.click(screen.getByTestId('cockpit-card-confirm'));

    const outcome = screen.getByTestId('cockpit-card-confirm-outcome');
    expect(outcome.getAttribute('role')).toBe('alert');
    expect(outcome.getAttribute('data-ok')).toBe('false');
    expect(outcome.textContent).toContain('gateway answered 502');
    expect(outcome.closest('[data-testid="cockpit-card-confirm-bar"]')).not.toBeNull();
    expect(screen.getByTestId('cockpit-card-confirm').getAttribute('data-confirm-mode')).toBe('open');
  });

  it('cancel leaves the state without sending and the bar stays in the same element', () => {
    const send = vi.fn(() => ({ ok: true as const, cardId: 'fixture:ask', executor: 'x', result: {} }));
    renderCard({ send });

    const confirm = screen.getByTestId('cockpit-card-confirm');
    fireEvent.click(confirm);
    fireEvent.click(screen.getByTestId('cockpit-card-confirm'));

    expect(screen.getByTestId('cockpit-card-confirm')).toBe(confirm);
    expect(screen.getByTestId('cockpit-card-confirm').getAttribute('data-confirm-mode')).toBe('open');
    expect(send).toHaveBeenCalledTimes(0);
  });

  it('the irreversible bar floats its caption instead of pushing the button down', () => {
    // The warning row is drawn ABOVE the button, absolutely, so the second press lands on the
    // same pixel as the first — and the idle bar never reserves that row.
    renderCard();
    expect(screen.queryByTestId('cockpit-card-confirm-message')).toBeNull();

    fireEvent.click(screen.getByTestId('cockpit-card-option-trigger'));
    fireEvent.click(screen.getByTestId('cockpit-card-option-park'));
    fireEvent.click(screen.getByTestId('cockpit-card-confirm'));

    const caption = screen.getByTestId('cockpit-card-confirm-message').parentElement;
    expect(caption?.className).toContain('absolute');
    expect(caption?.className).toContain('bottom-full');
  });

  it('the compact bar keeps its one line in both flows', () => {
    renderCard({ density: 'compact' });
    expect(screen.queryByTestId('cockpit-card-confirm-hint')).toBeNull();
    expect(screen.getByTestId('cockpit-card-confirm').className).toContain('w-auto');

    // A compact irreversible option still floats the warning caption above its button.
    fireEvent.click(screen.getByTestId('cockpit-card-option-trigger'));
    fireEvent.click(screen.getByTestId('cockpit-card-option-park'));
    fireEvent.click(screen.getByTestId('cockpit-card-confirm'));
    const caption = screen.getByTestId('cockpit-card-confirm-message').parentElement;
    expect(caption?.className).toContain('bottom-full');
    expect(screen.getByTestId('cockpit-card-confirm').className).toContain('w-auto');
  });

  it('disables the button while the request is in flight', () => {
    // The in-flight reading is too short for a render to catch from a click alone, so it is
    // forced here; the bar is the unit under test.
    renderCard({ initialCountdown: null, forceConfirming: true, density: 'compact' });

    const button = screen.getByTestId('cockpit-card-confirm');
    expect(button.getAttribute('data-confirm-mode')).toBe('send');
    expect(button.hasAttribute('disabled')).toBe(true);
    expect(button.textContent).toBe('Sending…');
    // The send is not reversible, so the bar offers no cancel control while it runs.
    expect(screen.queryByTestId('cockpit-card-confirm-cancel')).toBeNull();
  });
});

describe('the feedback lifecycle: sent, unconfirmed, resent, and returned', () => {
  const SENT_FEEDBACK: CockpitCardFeedback = {
    cardId: 'fixture:ask',
    revision: 1,
    feedbackId: 'feedback-1',
    optionId: 'delete',
    label: 'Delete staging',
    sentAt: new Date(NOW).toISOString(),
    outcome: { executor: 'fixture.record', ok: true },
    canResend: true,
  };

  it('draws a sent card in place with its options locked and no confirm bar', () => {
    renderCard({ card: { ...CARD, feedback: SENT_FEEDBACK } });

    const article = screen.getByTestId('cockpit-card-fixture:ask');
    expect(article.getAttribute('data-feedback-phase')).toBe('sent');
    // A sent card stays fully readable; only its controls are locked.
    expect(article.className).not.toContain('opacity-70');

    const status = screen.getByTestId('cockpit-card-feedback-status');
    expect(status.getAttribute('data-phase')).toBe('sent');
    expect(screen.getByTestId('cockpit-card-feedback-sent').textContent).toContain(
      'Sent: Delete staging',
    );
    expect(screen.getByTestId('cockpit-card-feedback-outcome').textContent).toBe(
      'Handed to the provider',
    );

    // Locked: no option switching, NO confirm bar at all, and a resend only after the window.
    expect(screen.getByTestId('cockpit-card-option-trigger').hasAttribute('disabled')).toBe(true);
    expect(screen.queryByTestId('cockpit-card-confirm')).toBeNull();
    expect(screen.queryByTestId('cockpit-card-feedback-resend')).toBeNull();
    expect(screen.queryByTestId('cockpit-card-feedback-resend-hint')).toBeNull();
  });

  it('shows 未确认收到 · 重发 only once the 120-second window has passed', () => {
    const onResendFeedback = vi.fn();
    renderCard({
      card: { ...CARD, feedback: SENT_FEEDBACK },
      now: NOW + 119_999,
      onResendFeedback,
    });
    expect(screen.getByTestId('cockpit-card-feedback-status').getAttribute('data-phase')).toBe(
      'sent',
    );
    expect(screen.queryByTestId('cockpit-card-feedback-resend')).toBeNull();

    cleanup();
    renderCard({
      card: { ...CARD, feedback: SENT_FEEDBACK },
      now: NOW + 120_000,
      onResendFeedback,
    });
    expect(screen.getByTestId('cockpit-card-feedback-status').getAttribute('data-phase')).toBe(
      'unconfirmed',
    );
    // The SAME one phase sentence swaps to the 2-minute reading; the waiting sentence is gone.
    const phaseLine = screen.getByTestId('cockpit-card-feedback-sent');
    expect(phaseLine.textContent).toContain('no receipt after 2 minutes');
    expect(phaseLine.textContent).not.toContain('waiting for the fleet');
    expect(screen.getByText('Resend only resends the feedback; it does not redo the action')).toBeTruthy();

    const resend = screen.getByTestId('cockpit-card-feedback-resend');
    expect(resend.getAttribute('data-resendable')).toBe('true');
    expect(resend.hasAttribute('disabled')).toBe(false);
    expect(resend.textContent).toBe('Resend');
    fireEvent.click(resend);
    expect(onResendFeedback).toHaveBeenCalledTimes(1);
  });

  it('words the in-flight resend and keeps the button disabled', () => {
    renderCard({
      card: { ...CARD, feedback: SENT_FEEDBACK },
      now: NOW + 120_000,
      resendingFeedback: true,
    });

    const resend = screen.getByTestId('cockpit-card-feedback-resend');
    expect(resend.textContent).toBe('Resending…');
    expect(resend.hasAttribute('disabled')).toBe(true);
  });

  it('states why a provider with no feedback executor cannot resend', () => {
    renderCard({
      card: {
        ...CARD,
        feedback: {
          ...SENT_FEEDBACK,
          canResend: false,
          resendUnavailableReason: '该提供方没有声明反馈执行器，无法确认收到',
        },
      },
      now: NOW + 120_000,
    });

    const resend = screen.getByTestId('cockpit-card-feedback-resend');
    expect(resend.getAttribute('data-resendable')).toBe('false');
    expect(resend.hasAttribute('disabled')).toBe(true);
    expect(screen.getByTestId('cockpit-card-feedback-resend-unavailable').textContent).toContain(
      '该提供方没有声明反馈执行器，无法确认收到',
    );
  });

  it('draws the action’s own outcome line for a background conversation or a delivery', () => {
    renderCard({
      card: {
        ...CARD,
        feedback: { ...SENT_FEEDBACK, outcome: { executor: 'session.start', ok: true, sessionId: 's-1' } },
      },
    });
    // The one-line row names the destination compactly; the full outcome sentence stays for a
    // delivery (a session card has a live 「打开会话 ›」 target in the prototype).
    expect(screen.getByTestId('cockpit-card-feedback-outcome').textContent).toBe(
      'Open conversation ›',
    );

    cleanup();
    renderCard({
      card: {
        ...CARD,
        feedback: { ...SENT_FEEDBACK, outcome: { executor: 'session.send', ok: true, deliveryId: 'd-1' } },
      },
    });
    expect(screen.getByTestId('cockpit-card-feedback-outcome').textContent).toBe(
      'Delivered to the conversation',
    );
  });

  it('draws a kept notice and live controls again once the receipt returns the card', () => {
    renderCard({
      card: {
        ...CARD,
        feedbackNotice: { cardId: 'fixture:ask', feedbackId: 'feedback-1', kind: 'kept' },
      },
    });

    const notice = screen.getByTestId('cockpit-card-feedback-notice');
    expect(notice.getAttribute('data-kind')).toBe('kept');
    expect(notice.textContent).toBe('The fleet received it and kept the item open');
    expect(screen.queryByTestId('cockpit-card-feedback-status')).toBeNull();
    expect(screen.getByTestId('cockpit-card-confirm').hasAttribute('disabled')).toBe(false);
  });

  it('draws a rejected notice with its reason', () => {
    renderCard({
      card: {
        ...CARD,
        feedbackNotice: {
          cardId: 'fixture:ask',
          feedbackId: 'feedback-1',
          kind: 'rejected',
          reason: 'stale-revision',
        },
      },
    });

    const notice = screen.getByTestId('cockpit-card-feedback-notice');
    expect(notice.getAttribute('data-kind')).toBe('rejected');
    expect(notice.textContent).toBe('The fleet rejected this feedback: stale-revision');
    expect(screen.getByTestId('cockpit-card-confirm').hasAttribute('disabled')).toBe(false);
  });

  it('draws a failed resend’s reason as an alert inside the status block', () => {
    renderCard({
      card: { ...CARD, feedback: SENT_FEEDBACK },
      now: NOW + 120_000,
      feedbackResendError: 'gateway answered 502',
    });

    const alert = screen.getByTestId('cockpit-card-feedback-resend-error');
    expect(alert.getAttribute('role')).toBe('alert');
    expect(alert.textContent).toContain('gateway answered 502');
  });
});

describe('Cards mode: the situation is decision evidence, not a two-line teaser', () => {
  /** Twelve real lines: the shape a provider's long situation reaches once the preview matters. */
  const LONG_SITUATION = Array.from(
    { length: 12 },
    (_, index) => `Line ${index + 1}: the measured detail this decision rests on.`,
  ).join('\n');

  it('draws a short situation in full, with no line clamp and no expand control', () => {
    renderCard();

    const situation = screen.getByTestId('cockpit-card-zone-a-situation');
    expect(situation.textContent).toBe(CARD.situation);
    expect(situation.className).not.toContain('line-clamp');
    expect(situation.getAttribute('data-clamped')).toBe('false');
    expect(screen.queryByTestId('cockpit-card-situation-toggle')).toBeNull();
  });

  it('draws the content-unavailable reason in full in Cards mode', () => {
    const reason =
      '提问决策摘要未启用：未启用 observation.sessionDigest（提问决策摘要），因此这张卡片没有可读的情境。';
    renderCard({ card: { ...CARD, situation: undefined, contentUnavailable: reason } });

    const unavailable = screen.getByTestId('cockpit-card-content-unavailable');
    expect(unavailable.textContent).toBe(reason);
    expect(unavailable.className).not.toContain('line-clamp');
  });

  it('previews twelve lines at six, then expands in place without opening Details', () => {
    const onOpenDetails = vi.fn();
    renderCard({ card: { ...CARD, situation: LONG_SITUATION }, onOpenDetails });

    const situation = screen.getByTestId('cockpit-card-zone-a-situation');
    expect(situation.className).toContain('line-clamp-6');
    expect(situation.getAttribute('data-clamped')).toBe('true');
    expect(situation.textContent).toBe(LONG_SITUATION);

    const toggle = screen.getByTestId('cockpit-card-situation-toggle');
    expect(toggle.textContent).toBe('Show more');
    expect(toggle.getAttribute('data-expanded')).toBe('false');
    expect(toggle.getAttribute('aria-expanded')).toBe('false');

    // The in-place control must not reach zone A's Details handler.
    fireEvent.click(toggle);
    expect(onOpenDetails).not.toHaveBeenCalled();

    const expanded = screen.getByTestId('cockpit-card-zone-a-situation');
    expect(expanded.className).not.toContain('line-clamp');
    expect(expanded.getAttribute('data-clamped')).toBe('false');
    expect(expanded.textContent).toBe(LONG_SITUATION);
    const collapse = screen.getByTestId('cockpit-card-situation-toggle');
    expect(collapse.textContent).toBe('Show less');
    expect(collapse.getAttribute('data-expanded')).toBe('true');
    expect(collapse.getAttribute('aria-expanded')).toBe('true');

    fireEvent.click(collapse);
    expect(screen.getByTestId('cockpit-card-zone-a-situation').className).toContain('line-clamp-6');
    expect(screen.getByTestId('cockpit-card-situation-toggle').textContent).toBe('Show more');
    expect(onOpenDetails).not.toHaveBeenCalled();
  });

  it('keeps one clamped line in Compact and offers no in-place expansion', () => {
    renderCard({ card: { ...CARD, situation: LONG_SITUATION }, density: 'compact' });

    const situation = screen.getByTestId('cockpit-card-zone-a-situation');
    expect(situation.className).toContain('line-clamp-1');
    expect(situation.className).not.toContain('line-clamp-6');
    expect(screen.queryByTestId('cockpit-card-situation-toggle')).toBeNull();
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

describe('Details: the knowledge entry is readable in full', () => {
  const KNOWLEDGE_TITLE = '归档后在 staging 复用冷备机';
  // Newlines on purpose: the revision's statement is Markdown-shaped prose, and the drawer must
  // keep its paragraphs rather than collapsing them into one line.
  const KNOWLEDGE_STATEMENT =
    '第一段：把 1.2 GB 的 staging 目录归档到冷备机。\n第二段：归档通过核验后删除源目录，并复用该机器承接下一轮。';

  function renderDetailsCard(card: CockpitCardData) {
    return render(
      <I18nextProvider i18n={i18n}>
        <CockpitCardDetails card={card} now={NOW} onClose={() => undefined} />
      </I18nextProvider>,
    );
  }

  it('draws the provider’s title and full statement, unclamped, after Situation and before Facts', () => {
    const card: CockpitCardData = {
      ...CARD,
      kind: 'knowledge',
      knowledge: {
        caseId: 'case-1',
        knowledgeRevision: 2,
        proposalRevision: 1,
        state: 'verifying',
        title: KNOWLEDGE_TITLE,
        statement: KNOWLEDGE_STATEMENT,
      },
    };
    renderDetailsCard(card);

    const title = screen.getByTestId('cockpit-card-details-knowledge-title');
    const statement = screen.getByTestId('cockpit-card-details-knowledge-statement');
    // Verbatim, not a restatement and not shortened: the whole statement is in the DOM text.
    expect(title.textContent).toBe(KNOWLEDGE_TITLE);
    expect(statement.textContent).toBe(KNOWLEDGE_STATEMENT);
    // No clamp of either kind: `line-clamp-2` is what hides the body on the list card, and
    // `truncate` would hide the title. `whitespace-pre-line` keeps the statement's paragraphs.
    expect(statement.className).not.toMatch(/line-clamp|truncate/);
    expect(title.className).not.toMatch(/line-clamp|truncate/);
    expect(statement.className).toContain('whitespace-pre-line');

    // Where it sits: after the Situation section, before the Facts section.
    const section = screen.getByTestId('cockpit-card-details-knowledge');
    const situation = screen.getByText(i18n.t('cockpit.cardDetailsSituation')).closest('section');
    const facts = screen.getByTestId('cockpit-card-details-facts').closest('section');
    expect(situation).not.toBeNull();
    expect(facts).not.toBeNull();
    expect(
      situation!.compareDocumentPosition(section) & Node.DOCUMENT_POSITION_FOLLOWING,
    ).toBeTruthy();
    expect(
      section.compareDocumentPosition(facts!) & Node.DOCUMENT_POSITION_FOLLOWING,
    ).toBeTruthy();
  });

  it('draws no knowledge section on a card that is not a knowledge card', () => {
    renderDetailsCard(CARD);

    expect(screen.queryByTestId('cockpit-card-details-knowledge')).toBeNull();
    expect(screen.queryByTestId('cockpit-card-details-knowledge-title')).toBeNull();
    expect(screen.queryByTestId('cockpit-card-details-knowledge-statement')).toBeNull();
  });

  it('draws no knowledge section when the case states neither title nor statement', () => {
    renderDetailsCard({
      ...CARD,
      kind: 'knowledge',
      knowledge: {
        caseId: 'case-2',
        knowledgeRevision: 1,
        proposalRevision: 1,
        state: 'pending',
      },
    });

    expect(screen.queryByTestId('cockpit-card-details-knowledge')).toBeNull();
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
    expect(screen.getByTestId('cockpit-card-confirm').textContent?.trim()).toBe('Confirm');
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
    confirmState: {
      pending?: boolean;
      countdown?: CockpitCardSendCountdown | null;
      confirming?: boolean;
      outcome?: CockpitCardConfirmOutcome | null;
      onConfirm?: () => void;
      onCancelConfirm?: () => void;
    } = {},
  ) {
    return render(
      <I18nextProvider i18n={i18n}>
        <CockpitCardDetails
          card={card}
          now={NOW}
          onClose={() => undefined}
          target={target}
          onRequestConfirm={onRequestConfirm}
          confirmPending={confirmState.pending ?? false}
          sendCountdown={confirmState.countdown ?? null}
          confirming={confirmState.confirming ?? false}
          confirmOutcome={confirmState.outcome ?? null}
          onConfirm={confirmState.onConfirm}
          onCancelConfirm={confirmState.onCancelConfirm}
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
    expect(bar.textContent?.trim()).toBe('Confirm');
    fireEvent.click(bar);
    expect(onRequestConfirm).toHaveBeenCalledTimes(1);
  });

  it('follows the shown option: switching it switches the bar’s target and warning', () => {
    const shown: CockpitCardShown = { kind: 'option', optionId: 'park' };
    renderDetails(CARD, confirmTargetOf(CARD, shown, ''));

    const bar = screen.getByTestId('cockpit-card-details-confirm');
    expect(bar.textContent).toContain('Confirm');
    expect(bar.textContent).not.toContain('Park it');
    expect(bar.getAttribute('data-irreversible')).toBe('true');
  });

  it('draws no bar when the card has nothing to confirm', () => {
    renderDetails(CARD, confirmTargetOf(CARD, undefined, ''));
    expect(screen.queryByTestId('cockpit-card-details-confirm-bar')).toBeNull();
  });

  it('turns its own bar into the confirm state in place, sending from the same button', () => {
    // The two-press state belongs to the irreversible option, exactly as it does on the card.
    const parkShown: CockpitCardShown = { kind: 'option', optionId: 'park' };
    const target = confirmTargetOf(CARD, parkShown, '');
    const onConfirm = vi.fn();
    const onCancelConfirm = vi.fn();
    renderDetails(CARD, target, vi.fn(), {
      pending: true,
      confirming: false,
      outcome: { ok: false, cardId: CARD.id, message: 'gateway answered 502' },
      onConfirm,
      onCancelConfirm,
    });

    // The drawer is a longer reading of the SAME card, so it draws the same state on its own
    // bar — never a second dialog over the page.
    const bar = screen.getByTestId('cockpit-card-details-confirm');
    expect(bar.getAttribute('data-confirm-mode')).toBe('send');
    expect(screen.getByTestId('cockpit-card-details-confirm-bar').getAttribute('data-confirm-pending')).toBe('true');
    expect(screen.getByTestId('cockpit-card-details-confirm-outcome').textContent).toContain(
      'gateway answered 502',
    );
    expect(document.querySelector('[data-testid="cockpit-card-confirm-panel"]')).toBeNull();
    expect(document.querySelector('[role="dialog"]')).toBeNull();

    fireEvent.click(bar);
    expect(onConfirm).toHaveBeenCalledTimes(1);
    fireEvent.click(screen.getByTestId('cockpit-card-details-confirm-cancel'));
    expect(onCancelConfirm).toHaveBeenCalledTimes(1);
  });

  it('draws the same countdown state the card’s own bar draws, and cancels from it', () => {
    const target = confirmTargetOf(CARD, defaultShownOption(CARD) ?? undefined, '');
    const onCancelConfirm = vi.fn();
    renderDetails(CARD, target, vi.fn(), {
      countdown: { cardId: CARD.id, revision: 1, startedAt: NOW - 2_000, firesAt: NOW + 3_000 },
      onCancelConfirm,
    });

    const bar = screen.getByTestId('cockpit-card-details-confirm');
    expect(bar.getAttribute('data-confirm-mode')).toBe('cancel');
    expect(bar.getAttribute('data-confirm-seconds')).toBe('3');
    expect(bar.textContent).toContain('Sending in 3s · tap to cancel');
    // The countdown needs no explanation row either: the label and fill are the whole reading.
    expect(screen.queryByTestId('cockpit-card-details-confirm-message')).toBeNull();
    expect(screen.getByTestId('cockpit-card-details-confirm-bar').getAttribute('data-confirm-pending')).toBe('true');

    fireEvent.click(bar);
    expect(onCancelConfirm).toHaveBeenCalledTimes(1);
  });

  it('words the send state with the same copy the card’s own bar uses', () => {
    const target = confirmTargetOf(CARD, defaultShownOption(CARD) ?? undefined, '');
    renderDetails(CARD, target, vi.fn(), { pending: true, confirming: true });

    const bar = screen.getByTestId('cockpit-card-details-confirm');
    expect(bar.textContent).toBe('Sending…');
    expect(bar.hasAttribute('disabled')).toBe(true);
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

describe('a card whose own ask has no summary yet', () => {
  /** The live 2026-10-29 empty card: an original-text fallback question and no options at all. */
  const EMPTY: CockpitCardData = {
    ...CARD,
    ask: 'The run left 1.2 GB in staging. Should the staging directory be deleted first?',
    situation: undefined,
    contentUnavailable: '提问决策摘要不可用：这条提问的摘要尚未生成',
    options: [],
  };

  it('draws no option dropdown and no empty confirm line, and offers the two answers it has', () => {
    renderCard({ card: EMPTY });

    // No dropdown over an empty list, and no 「Choose an option, then confirm」 promise the card
    // cannot keep.
    expect(screen.queryByTestId('cockpit-card-option-frame')).toBeNull();
    expect(screen.queryByTestId('cockpit-card-option-trigger')).toBeNull();
    expect(screen.queryByTestId('cockpit-card-confirm-empty')).toBeNull();
    expect(screen.queryByTestId('cockpit-card-confirm')).toBeNull();

    // What remains: the fallback question, the one-line reason, the conversation, and the reply.
    expect(screen.getByTestId('cockpit-card-zone-a-question').textContent).toContain(
      'Should the staging directory be deleted first?',
    );
    expect(screen.getByTestId('cockpit-card-content-unavailable').textContent).toContain(
      '这条提问的摘要尚未生成',
    );
    expect(screen.getByTestId('cockpit-card-open-conversation').getAttribute('href')).toBe(
      '/session/fixture-session',
    );
    expect(screen.getByTestId('cockpit-card-own-reply-trigger').textContent).toContain(
      'Write your own',
    );
  });

  it('the own-reply entry opens its editor, and a typed reply brings back one confirm bar', () => {
    renderCard({ card: EMPTY });

    fireEvent.click(screen.getByTestId('cockpit-card-own-reply-trigger'));
    const editor = screen.getByTestId('cockpit-card-own-reply-input');
    fireEvent.change(editor, { target: { value: 'Delete it first, then re-run.' } });

    expect(screen.queryByTestId('cockpit-card-confirm-empty')).toBeNull();
    expect(screen.queryByTestId('cockpit-card-option-trigger')).toBeNull();
    expect(screen.getByTestId('cockpit-card-confirm').textContent).toContain('Confirm');
  });
});

describe('folded duplicates are stated on the kept card', () => {
  const EARLIER: CockpitCardData = {
    ...CARD,
    id: 'fixture:ask-earlier',
    surfacedAt: '2026-10-27T00:01:00.000Z',
  };

  /**
   * The kept card plus, once expanded, the earlier card below it — the LIST's re-insertion,
   * mirrored here so the strip's control is exercised through real state. The position rule
   * itself (provider order, not append) is proven in `cockpitCardController.test.ts`.
   */
  function DuplicatesFixture({
    hiddenIds,
    questionless = false,
  }: {
    hiddenIds: string[];
    questionless?: boolean;
  }) {
    const [expanded, setExpanded] = useState(false);
    const shown = defaultShownOption(CARD) ?? undefined;
    return (
      <I18nextProvider i18n={i18n}>
        <CockpitCard
          card={CARD}
          now={NOW}
          shown={shown}
          target={confirmTargetOf(CARD, shown, '')}
          ownReply=""
          dropdownOpen={false}
          selected
          density="cards"
          duplicates={{ hiddenIds, expanded }}
          duplicatesQuestionless={questionless}
          onToggleDuplicates={() => setExpanded((value) => !value)}
          onSelect={() => undefined}
          onOpenDetails={() => undefined}
          onToggleDropdown={() => undefined}
          onShowOption={() => undefined}
          onShowOwnReply={() => undefined}
          onOwnReplyChange={() => undefined}
          onRequestConfirm={() => undefined}
        />
        {expanded &&
          hiddenIds.map((id) => (
            <CockpitCard
              key={id}
              card={{ ...EARLIER, id }}
              now={NOW}
              shown={defaultShownOption(EARLIER) ?? undefined}
              target={confirmTargetOf(EARLIER, defaultShownOption(EARLIER) ?? undefined, '')}
              ownReply=""
              dropdownOpen={false}
              selected={false}
              density="cards"
              onSelect={() => undefined}
              onOpenDetails={() => undefined}
              onToggleDropdown={() => undefined}
              onShowOption={() => undefined}
              onShowOwnReply={() => undefined}
              onOwnReplyChange={() => undefined}
              onRequestConfirm={() => undefined}
            />
          ))}
      </I18nextProvider>
    );
  }

  it('draws the strip with the count and hides the earlier card until expanded', () => {
    render(<DuplicatesFixture hiddenIds={['fixture:ask-earlier']} />);

    const strip = screen.getByTestId('cockpit-card-duplicates');
    expect(strip.getAttribute('data-count')).toBe('2');
    expect(strip.getAttribute('data-expanded')).toBe('false');
    expect(strip.textContent).toContain('Asked the same question 2 times');
    expect(strip.textContent).toContain('1 earlier cards folded');
    expect(screen.queryByTestId('cockpit-card-fixture:ask-earlier')).toBeNull();

    fireEvent.click(screen.getByTestId('cockpit-card-duplicates-toggle'));

    // The earlier card is drawn (by the list) and the strip states the expanded reading.
    expect(screen.getByTestId('cockpit-card-fixture:ask-earlier')).toBeTruthy();
    expect(screen.getByTestId('cockpit-card-duplicates').getAttribute('data-expanded')).toBe(
      'true',
    );
    expect(screen.getByTestId('cockpit-card-duplicates').textContent).toContain('Collapse');
  });

  it('states a session’s unanswered count for cards that carry no wording', () => {
    render(<DuplicatesFixture hiddenIds={['fixture:ask-earlier', 'fixture:ask-second']} questionless />);

    expect(screen.getByTestId('cockpit-card-duplicates').textContent).toContain(
      'This session has 3 unanswered questions',
    );
  });

  it('draws no strip when nothing was folded', () => {
    renderCard();

    expect(screen.queryByTestId('cockpit-card-duplicates')).toBeNull();
  });
});

describe('the third action: 「忽略/丢弃」 on a session-ask card', () => {
  it('renders the dismiss action, opens its confirmation, and leaves the 是/否 choices intact', () => {
    const onRequestDismiss = vi.fn();
    const onConfirmDismiss = vi.fn();
    render(
      <I18nextProvider i18n={i18n}>
        <Fixture
          card={CARD}
          onOpenDetails={vi.fn()}
          onRequestConfirm={vi.fn()}
          onRequestDismiss={onRequestDismiss}
          onConfirmDismiss={onConfirmDismiss}
        />
      </I18nextProvider>,
    );

    const dismiss = screen.getByTestId('cockpit-card-dismiss');
    expect(dismiss.textContent?.trim()).toBe('Ignore / discard');
    // The action is offered BESIDE the option's confirm bar, which is still bound to the shown
    // option.
    expect(screen.getByTestId('cockpit-card-confirm').textContent?.trim()).toBe('Confirm');
    expect(screen.queryByTestId('cockpit-card-dismiss-confirm')).toBeNull();

    fireEvent.click(dismiss);
    expect(onRequestDismiss).toHaveBeenCalledTimes(1);
    expect(onConfirmDismiss).not.toHaveBeenCalled();
    expect(screen.getByTestId('cockpit-card-dismiss-confirm').textContent?.trim()).toBe(
      'Confirm discard',
    );

    // Opening the dismiss confirmation does not disturb the existing choices: the confirm bar is
    // unchanged and switching the shown option still works.
    expect(screen.getByTestId('cockpit-card-confirm').textContent?.trim()).toBe('Confirm');
    fireEvent.click(screen.getByTestId('cockpit-card-option-trigger'));
    expect(within(screen.getByTestId('cockpit-card-option-list')).getAllByRole('radio')).toHaveLength(3);
    fireEvent.click(screen.getByTestId('cockpit-card-option-park'));
    expect(screen.getByTestId('cockpit-card-option-trigger').textContent).toContain('Park it');
    expect(screen.getByTestId('cockpit-card-confirm').getAttribute('data-irreversible')).toBe(
      'true',
    );

    fireEvent.click(screen.getByTestId('cockpit-card-dismiss-confirm'));
    expect(onConfirmDismiss).toHaveBeenCalledTimes(1);
  });
});

/**
 * The three blocks `CockpitCard` composes are PURE presentational: each draws only the props it
 * is handed and forwards its callbacks. These tests call them directly (no controller, no card
 * state), so a block that started deriving a reading would need a card or a controller here.
 */
describe('presentational blocks draw precomputed props and own no state', () => {
  const OPTIONS = {
    card: CARD,
    compact: false,
    dropdownOpen: false,
    feedbackLocked: false,
    emptyAskContent: false,
    conversationSessionId: 'fixture-session',
    ownReply: '',
    ownReplyAvailable: true,
    shownOption: CARD.options[0],
    showingOwnReply: false,
    shownLabel: 'Delete staging',
    shownSource: '● from assistant',
    shownPosition: '1 of 2',
    onToggleDropdown: () => undefined,
    onShowOption: () => undefined,
    onShowOwnReply: () => undefined,
    onOwnReplyChange: () => undefined,
  };

  it('the header draws the props it is handed, including the load reading’s accessible name', () => {
    render(
      <I18nextProvider i18n={i18n}>
        <CockpitCardHeader
          kind="stuck"
          descriptor={cockpitCardDescriptor('stuck')}
          project="proj-x"
          subjectName="subject-y"
          age="7m"
          load={1}
          loadLabel="weight 1 of 3"
        />
      </I18nextProvider>,
    );

    expect(screen.getByTestId('cockpit-card-kind-badge').textContent).toBe(
      i18n.t(cockpitCardDescriptor('stuck').badgeKey),
    );
    expect(screen.getByTestId('cockpit-card-project').textContent).toBe('proj-x');
    expect(screen.getByTestId('cockpit-card-subject').textContent).toContain('subject-y');
    // The age is the prop, not a recomputation from a clock.
    expect(screen.getByTestId('cockpit-card-age').textContent).toBe('7m');
    const load = screen.getByTestId('cockpit-card-load');
    expect(load.getAttribute('data-load')).toBe('1');
    expect(load.getAttribute('aria-label')).toBe('weight 1 of 3');
  });

  it('the header draws no project, subject or load when the props say there is none', () => {
    render(
      <I18nextProvider i18n={i18n}>
        <CockpitCardHeader
          kind="ask"
          descriptor={cockpitCardDescriptor('ask')}
          project=""
          subjectName={null}
          age="4m"
          load={undefined}
          loadLabel=""
        />
      </I18nextProvider>,
    );

    expect(screen.queryByTestId('cockpit-card-project')).toBeNull();
    expect(screen.queryByTestId('cockpit-card-subject')).toBeNull();
    expect(screen.queryByTestId('cockpit-card-load')).toBeNull();
  });

  it('the facts row draws the facts it is handed, and its viz comes from the card prop', () => {
    const facts = [
      { text: 'staging holds 1.2 GB', mechanical: true },
      { text: 'transcript archived', mechanical: false },
    ];
    render(
      <I18nextProvider i18n={i18n}>
        <CockpitCardFacts
          card={{ ...CARD, kind: 'stuck', viz: { kind: 'attempts', count: 2 } }}
          facts={facts}
        />
      </I18nextProvider>,
    );

    const pills = screen.getAllByTestId('cockpit-card-fact');
    expect(pills.map((pill) => pill.getAttribute('data-mechanical'))).toEqual(['true', 'false']);
    expect(pills[0].textContent).toContain('●');
    expect(pills[1].textContent).toContain('○');
    expect(screen.getByTestId('cockpit-card-viz')).toBeTruthy();
  });

  it('the options block draws the shown reading from props and only forwards its callbacks', () => {
    const onToggleDropdown = vi.fn();
    render(
      <I18nextProvider i18n={i18n}>
        <CockpitCardOptions {...OPTIONS} onToggleDropdown={onToggleDropdown} />
      </I18nextProvider>,
    );

    const trigger = screen.getByTestId('cockpit-card-option-trigger');
    expect(trigger.textContent).toContain('Delete staging');
    expect(trigger.textContent).toContain('● from assistant');
    expect(trigger.textContent).toContain('1 of 2');
    // The open/closed reading is the prop, not local state.
    expect(trigger.getAttribute('aria-expanded')).toBe('false');
    expect(trigger.hasAttribute('disabled')).toBe(false);

    fireEvent.click(trigger);
    expect(onToggleDropdown).toHaveBeenCalledTimes(1);
    // Clicking did not open the list: only the controller's prop can.
    expect(trigger.getAttribute('aria-expanded')).toBe('false');
    expect(screen.queryByTestId('cockpit-card-option-list')).toBeNull();
  });

  it('the options list is a radio group whose checked row comes from the props', () => {
    render(
      <I18nextProvider i18n={i18n}>
        <CockpitCardOptions {...OPTIONS} dropdownOpen />
      </I18nextProvider>,
    );

    const list = screen.getByTestId('cockpit-card-option-list');
    expect(list.getAttribute('role')).toBe('radiogroup');
    expect(within(list).getAllByRole('radio')).toHaveLength(3);
    expect(
      within(list).getByTestId('cockpit-card-option-delete').getAttribute('aria-checked'),
    ).toBe('true');
    expect(
      within(list).getByTestId('cockpit-card-option-park').getAttribute('aria-checked'),
    ).toBe('false');
  });

  it('a locked or empty card draws no live option surface, exactly as the props say', () => {
    const locked = render(
      <I18nextProvider i18n={i18n}>
        <CockpitCardOptions {...OPTIONS} feedbackLocked />
      </I18nextProvider>,
    );
    const lockedTrigger = screen.getByTestId('cockpit-card-option-trigger');
    expect(lockedTrigger.hasAttribute('disabled')).toBe(true);
    expect(lockedTrigger.getAttribute('aria-expanded')).toBe('false');
    locked.unmount();

    render(
      <I18nextProvider i18n={i18n}>
        <CockpitCardOptions
          {...OPTIONS}
          card={{ ...CARD, options: [] }}
          emptyAskContent
          shownOption={null}
          shownLabel="Choose an option"
          shownSource={null}
          shownPosition={null}
        />
      </I18nextProvider>,
    );
    expect(screen.queryByTestId('cockpit-card-option-trigger')).toBeNull();
    expect(screen.getByTestId('cockpit-card-open-conversation').getAttribute('href')).toBe(
      '/session/fixture-session',
    );
  });
});

/**
 * The drawer is a LONGER reading of the same card, so it must carry the same third action the
 * row does. These tests hold the details block to that contract without a controller: the target
 * comes from the same `dismissTargetOf` derivation the controller uses, and the two presses are
 * separate callbacks, so a drawer that folded them into one would show up here as a missing
 * intermediate state.
 */
describe('Details: the third action is offered beside the shown option', () => {
  function renderDetailsDismiss({
    card = CARD,
    target = confirmTargetOf(CARD, defaultShownOption(CARD) ?? undefined, ''),
    dismissTarget = dismissTargetOf(CARD),
    pending = false,
    dismissing = false,
    notice = null,
    onRequestDismiss = vi.fn(),
    onConfirmDismiss = vi.fn(),
    onCancelDismiss = vi.fn(),
  }: {
    card?: CockpitCardData;
    target?: ReturnType<typeof confirmTargetOf>;
    dismissTarget?: ReturnType<typeof dismissTargetOf>;
    pending?: boolean;
    dismissing?: boolean;
    notice?: { cardId: string; ok: boolean; message: string } | null;
    onRequestDismiss?: () => void;
    onConfirmDismiss?: () => void;
    onCancelDismiss?: () => void;
  } = {}) {
    render(
      <I18nextProvider i18n={i18n}>
        <CockpitCardDetails
          card={card}
          now={NOW}
          onClose={() => undefined}
          target={target}
          onRequestConfirm={vi.fn()}
          confirmPending={false}
          sendCountdown={null}
          confirming={false}
          confirmOutcome={null}
          dismissTarget={dismissTarget}
          dismissPending={pending}
          dismissing={dismissing}
          dismissNotice={notice}
          onRequestDismiss={onRequestDismiss}
          onConfirmDismiss={onConfirmDismiss}
          onCancelDismiss={onCancelDismiss}
        />
      </I18nextProvider>,
    );
    return { onRequestDismiss, onConfirmDismiss, onCancelDismiss };
  }

  it('offers the discard action and its first press opens an in-place confirmation that sends nothing', () => {
    const spies = renderDetailsDismiss();

    const dismiss = screen.getByTestId('cockpit-card-details-dismiss');
    expect(dismiss.textContent?.trim()).toBe('Ignore / discard');
    expect(screen.queryByTestId('cockpit-card-details-dismiss-confirm')).toBeNull();

    fireEvent.click(dismiss);
    expect(spies.onRequestDismiss).toHaveBeenCalledTimes(1);
    expect(spies.onConfirmDismiss).not.toHaveBeenCalled();

    // The option's own bar is untouched by the first press: the drawer keeps both choices.
    expect(screen.getByTestId('cockpit-card-details-confirm').textContent?.trim()).toBe('Confirm');

    cleanup();
    renderDetailsDismiss({ pending: true });
    expect(screen.getByTestId('cockpit-card-details-dismiss-confirm').textContent?.trim()).toBe(
      'Confirm discard',
    );
    expect(screen.getByTestId('cockpit-card-details-dismiss-cancel').textContent?.trim()).toBe(
      'Cancel',
    );
  });

  it('cancels from the drawer without disturbing the shown option or the draft', () => {
    const onCancelDismiss = vi.fn();
    renderDetailsDismiss({ pending: true, onCancelDismiss });

    const confirmBarBefore = screen.getByTestId('cockpit-card-details-confirm-bar').outerHTML;
    fireEvent.click(screen.getByTestId('cockpit-card-details-dismiss-cancel'));
    expect(onCancelDismiss).toHaveBeenCalledTimes(1);
    // Cancel is the controller's to answer; the block only forwards it. The card's own choices
    // are still drawn exactly as before, and the displayed ask is unchanged.
    expect(screen.getByTestId('cockpit-card-details-confirm-bar').outerHTML).toBe(confirmBarBefore);
    expect(screen.getByTestId('cockpit-card-details').textContent).toContain(
      'Should the cleanup delete the staging directory?',
    );
  });

  it('draws the discard entry when there is no option to confirm', () => {
    renderDetailsDismiss({ target: null });

    expect(screen.queryByTestId('cockpit-card-details-confirm-bar')).toBeNull();
    expect(screen.getByTestId('cockpit-card-details-dismiss-bar')).toBeTruthy();
    expect(screen.getByTestId('cockpit-card-details-dismiss').textContent?.trim()).toBe(
      'Ignore / discard',
    );
  });

  it('offers no discard entry for a card that has none, or one already awaiting its receipt', () => {
    renderDetailsDismiss({ card: { ...CARD, kind: 'stuck' }, dismissTarget: dismissTargetOf({ ...CARD, kind: 'stuck' }) });
    expect(screen.queryByTestId('cockpit-card-details-dismiss-bar')).toBeNull();
    // The option's own bar is still there: only the third choice is absent.
    expect(screen.getByTestId('cockpit-card-details-confirm-bar')).toBeTruthy();

    cleanup();
    const sent: CockpitCardData = {
      ...CARD,
      feedback: {
        cardId: CARD.id,
        revision: CARD.revision,
        feedbackId: 'feedback-1',
        optionId: 'delete',
        label: 'Delete staging',
        sentAt: new Date(NOW).toISOString(),
        outcome: { executor: 'fixture.record', ok: true },
        canResend: false,
      },
    };
    renderDetailsDismiss({ card: sent, dismissTarget: dismissTargetOf(sent) });
    expect(screen.queryByTestId('cockpit-card-details-dismiss-bar')).toBeNull();
  });

  it('locks both presses while the discard is in flight', () => {
    renderDetailsDismiss({ pending: true, dismissing: true });

    expect(
      screen.getByTestId('cockpit-card-details-dismiss-confirm').hasAttribute('disabled'),
    ).toBe(true);
    expect(screen.getByTestId('cockpit-card-details-dismiss-cancel').hasAttribute('disabled')).toBe(
      true,
    );
    expect(screen.getByTestId('cockpit-card-details-dismiss-bar').getAttribute('data-dismiss-pending')).toBe('true');
  });

  it('states a failed discard inside the drawer, with the card and its draft still shown', () => {
    renderDetailsDismiss({
      notice: { cardId: CARD.id, ok: false, message: 'dismiss was refused (409)' },
    });

    const notice = screen.getByTestId('cockpit-card-details-dismiss-notice');
    expect(notice.getAttribute('role')).toBe('alert');
    expect(notice.getAttribute('data-ok')).toBe('false');
    expect(notice.textContent).toContain('dismiss was refused (409)');
    // A failed discard is not a closed drawer: the card's own controls remain.
    expect(screen.getByTestId('cockpit-card-details-confirm')).toBeTruthy();
    expect(screen.getByTestId('cockpit-card-details-dismiss')).toBeTruthy();
  });

  it('draws the same shared control in the row and the drawer, keyed to the same card', () => {
    renderDetailsDismiss();
    const drawerBar = screen.getByTestId('cockpit-card-details-dismiss-bar');
    expect(drawerBar.getAttribute('data-card-id')).toBe(CARD.id);
    expect(drawerBar.getAttribute('data-dismiss-pending')).toBe('false');

    cleanup();
    renderCard();
    const rowBar = screen.getByTestId('cockpit-card-dismiss-bar');
    expect(rowBar.getAttribute('data-card-id')).toBe(CARD.id);
    expect(rowBar.getAttribute('data-dismiss-pending')).toBe('false');
  });
});

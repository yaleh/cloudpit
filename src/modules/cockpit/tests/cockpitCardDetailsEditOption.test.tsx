import { useSyncExternalStore } from 'react';
import { I18nextProvider } from 'react-i18next';
import { act, fireEvent, render, screen } from '@testing-library/react';
import { beforeAll, describe, expect, it } from 'vitest';

import type {
  Clock,
  CockpitCard as CockpitCardData,
  CockpitCardFeedback,
  CockpitCardOption,
} from '@/shared/types';
import { i18n } from '@/modules/i18n';
import CockpitCardDetails from '@/modules/cockpit/cards/CockpitCardDetails';
import { createCockpitCardController } from '@/modules/cockpit/cards/cockpitCardController';
import type { CockpitCardController } from '@/modules/cockpit/cards/cockpitCardController';

/**
 * 「✎ 编辑」 COPIES AN OPTION INTO THE OWN-REPLY DRAFT AND FOCUSES ITS END.
 *
 * The Details drawer offers a shortcut from a read option to a written reply: one press copies
 * the exact text that option would send, switches the card to its own-reply reading, and puts
 * the caret at the end so a few words can be appended. It is a DRAFT shortcut, never a send —
 * the confirmation bar still owns sending.
 *
 * The three rules these cases pin:
 *
 *   · only an option carrying `sendText` gets a shortcut (`undefined` = nothing to copy);
 *   · the shortcut is a SIBLING of the row button, because HTML forbids nested buttons;
 *   · ONLY the shortcut focuses the editor — pressing the ordinary own-reply row must not
 *     steal focus, which is why an unconditional autofocus would red this file.
 *
 * The drawer is driven through the REAL controller, the way `CockpitCardList` wires it, so the
 * copied draft and the shown reading are one state assertion rather than a prop the test placed.
 */

const NOW = Date.parse('2026-10-27T00:10:00.000Z');

const FAKE_CLOCK: Clock = {
  setTimeout: () => 1,
  clearTimeout: () => undefined,
  setInterval: () => 2,
  clearInterval: () => undefined,
  now: () => NOW,
};

const SEND_TEXT = 'Resume with a nudge — Send one message asking for the next concrete step.';

function option(id: string, label: string, sendText?: string): CockpitCardOption {
  return {
    id,
    label,
    does: `${label} does something`,
    suggested: false,
    source: 'provider',
    action: { executor: 'test.exec', params: { optionId: id } },
    ...(sendText === undefined ? {} : { sendText }),
  };
}

const SENT_FEEDBACK: CockpitCardFeedback = {
  cardId: 'c1',
  revision: 1,
  feedbackId: 'feedback-1',
  optionId: 'editable',
  label: 'Editable',
  sentAt: new Date(NOW).toISOString(),
  outcome: { executor: 'test.exec', ok: true },
  canResend: true,
};

function card(overrides: Partial<CockpitCardData> = {}): CockpitCardData {
  return {
    id: 'c1',
    provider: 'test',
    revision: 1,
    kind: 'stuck',
    group: 'test',
    rank: 1,
    state: 'open',
    waitingSince: '2026-10-27T00:00:00.000Z',
    surfacedAt: '2026-10-27T00:00:01.000Z',
    subject: { uri: 'cloudcli://test/c1', sessionId: 'test-session' },
    ask: 'Which way?',
    facts: [],
    options: [option('editable', 'Editable', SEND_TEXT), option('plain', 'Plain')],
    ownReply: { executor: 'test.exec', params: { cardId: 'c1' } },
    ...overrides,
  };
}

/** The real controller over a fixed card list; every command the drawer issues goes to it. */
function harness(initial: readonly CockpitCardData[]): CockpitCardController {
  const cards = initial;
  return createCockpitCardController({
    fetchCards: async () => ({ cards }),
    confirm: async () => ({ executor: 'test.exec', result: { ok: true } }),
    clock: FAKE_CLOCK,
    refreshIntervalMs: 0,
  });
}

/** The drawer wired exactly the way `CockpitCardList` wires it. */
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
  const controller = harness(initial);
  const view = render(<Drawer controller={controller} cardId="c1" />);
  await act(async () => {
    await controller.load();
  });
  return { ...view, controller };
}

function editor(): HTMLTextAreaElement {
  return screen.getByTestId('cockpit-card-details-own-reply-input') as HTMLTextAreaElement;
}

beforeAll(async () => {
  await i18n.changeLanguage('en');
});

describe('the option edit shortcut', () => {
  it('appears only on options that carry a sendText, and never nests inside the row button', async () => {
    await renderDrawer();

    expect(screen.getByTestId('cockpit-card-details-option-edit-editable')).toBeTruthy();
    expect(screen.queryByTestId('cockpit-card-details-option-edit-plain')).toBeNull();
    // HTML forbids a button inside a button; the shortcut must be the row's sibling.
    expect(document.querySelector('button button')).toBeNull();
  });

  it('copies the option’s exact send text into the own-reply draft and shows that reading', async () => {
    const { controller } = await renderDrawer();

    fireEvent.click(screen.getByTestId('cockpit-card-details-option-edit-editable'));

    expect(controller.getSnapshot().shown.c1).toEqual({ kind: 'ownReply' });
    expect(controller.getSnapshot().ownReplies.c1).toBe(SEND_TEXT);
    expect(controller.getSnapshot().targets.c1?.replyText).toBe(SEND_TEXT);
    expect(editor().value).toBe(SEND_TEXT);
    expect(screen.getByTestId('cockpit-card-details-own-reply').getAttribute('aria-pressed')).toBe(
      'true',
    );
  });

  it('focuses the editor at the END of the copied text', async () => {
    await renderDrawer();

    fireEvent.click(screen.getByTestId('cockpit-card-details-option-edit-editable'));

    const field = editor();
    expect(document.activeElement).toBe(field);
    expect(field.selectionStart).toBe(SEND_TEXT.length);
    expect(field.selectionEnd).toBe(SEND_TEXT.length);
  });

  it('does NOT focus the editor when the ordinary own-reply row is pressed', async () => {
    await renderDrawer();

    fireEvent.click(screen.getByTestId('cockpit-card-details-own-reply'));

    // The ordinary path opens the same editor but leaves focus where the press put it.
    const field = editor();
    expect(document.activeElement).not.toBe(field);
    expect(field.value).toBe('');
  });

  it('offers no shortcut once the card is locked behind a sent feedback', async () => {
    await renderDrawer([card({ feedback: SENT_FEEDBACK })]);

    expect(screen.queryByTestId('cockpit-card-details-option-edit-editable')).toBeNull();
    expect(document.querySelector('button button')).toBeNull();
  });
});

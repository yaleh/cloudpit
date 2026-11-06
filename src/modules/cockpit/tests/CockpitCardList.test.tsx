import { useSyncExternalStore } from 'react';
import { I18nextProvider } from 'react-i18next';
import { MemoryRouter } from 'react-router-dom';
import { act, fireEvent, render, screen } from '@testing-library/react';
import { beforeAll, describe, expect, it, vi } from 'vitest';

import { api } from '@/shared/api';
import type {
  Clock,
  CockpitCard as CockpitCardData,
  CockpitCardProviderDiagnostic,
} from '@/shared/types';
import { i18n } from '@/modules/i18n';
import CockpitCardList from '@/modules/cockpit/cards/CockpitCardList';
import type { CockpitCardListProps } from '@/modules/cockpit/cards/CockpitCardList';
import { createCockpitCardController } from '@/modules/cockpit/cards/cockpitCardController';
import type { CockpitCardController } from '@/modules/cockpit/cards/cockpitCardController';

/**
 * THE CARD WALL'S THREE EMPTY/FULL READINGS.
 *
 * A provider that failed to read must never look like a healthy empty wall. The list therefore
 * has exactly three branches, and this criterion pins one DOM reading for each:
 *
 *   1. no cards and no failure → the normal empty state (`cockpit-card-empty`);
 *   2. no cards and a provider failure → the failure with its reason and the retry
 *      (`cockpit-card-provider-error`), and NOT the empty state;
 *   3. cards AND a provider failure → the healthy cards stay, with the persistent notice.
 *
 * The controller is the real one, so `status`, `providerFailures` and `degraded` are the same
 * readings the page consumes; the list is the shipped component, so the assertions are about the
 * rendered wall rather than a prop the test placed.
 */

const NOW = Date.parse('2026-11-06T00:10:00.000Z');

const FAKE_CLOCK: Clock = {
  setTimeout: () => 1,
  clearTimeout: () => undefined,
  setInterval: () => 2,
  clearInterval: () => undefined,
  now: () => NOW,
};

function card(overrides: Partial<CockpitCardData> = {}): CockpitCardData {
  return {
    id: 'c1',
    provider: 'fixture',
    revision: 1,
    kind: 'ask',
    group: 'test',
    rank: 1,
    state: 'open',
    waitingSince: '2026-11-06T00:00:00.000Z',
    surfacedAt: '2026-11-06T00:00:01.000Z',
    subject: { uri: 'cloudcli://test/c1', project: 'p1' },
    ask: 'Which way?',
    facts: [],
    options: [],
    ...overrides,
  };
}

function failedDiagnostic(
  provider: string,
  reason = 'quay-fleet binary is missing',
): CockpitCardProviderDiagnostic {
  return {
    provider,
    ok: false,
    reason,
    cards: 0,
    skippedLines: 0,
    cached: false,
  };
}

function healthyDiagnostic(provider: string, cards: number): CockpitCardProviderDiagnostic {
  return { provider, ok: true, reason: null, cards, skippedLines: 0, cached: false };
}

/** A read the criterion can change between polls, exactly like the route answering again. */
function harness(initial: readonly CockpitCardData[]) {
  let cards = [...initial];
  let diagnostics: CockpitCardProviderDiagnostic[] = [];
  let reads = 0;
  const controller = createCockpitCardController({
    fetchCards: async () => {
      reads += 1;
      return { cards, diagnostics };
    },
    confirm: async () => ({ executor: 'test.exec', result: { ok: true } }),
    clock: FAKE_CLOCK,
    // No background polling: a criterion re-reads through the retry (or `load`) explicitly.
    refreshIntervalMs: 0,
  });
  return {
    controller,
    get reads() {
      return reads;
    },
    setCards: (next: readonly CockpitCardData[]) => {
      cards = [...next];
    },
    setDiagnostics: (next: readonly CockpitCardProviderDiagnostic[]) => {
      diagnostics = [...next];
    },
  };
}

/** The list re-rendering from the controller it was handed (the page/column binding shape). */
function BoundCards({
  controller,
  ...props
}: Omit<CockpitCardListProps, 'binding'> & { controller: CockpitCardController }) {
  const snapshot = useSyncExternalStore(
    controller.subscribe,
    controller.getSnapshot,
    controller.getSnapshot,
  );
  return <CockpitCardList binding={{ snapshot, controller }} {...props} />;
}

async function renderList(
  initial: readonly CockpitCardData[],
  diagnostics: readonly CockpitCardProviderDiagnostic[] = [],
) {
  const h = harness(initial);
  h.setDiagnostics(diagnostics);
  render(
    <MemoryRouter initialEntries={['/cockpit?view=cards']}>
      <I18nextProvider i18n={i18n}>
        <BoundCards controller={h.controller} />
      </I18nextProvider>
    </MemoryRouter>,
  );
  await act(async () => {
    await h.controller.load();
  });
  return h;
}

beforeAll(async () => {
  await i18n.changeLanguage('en');
});

describe('the card wall distinguishes an empty read from a failed provider', () => {
  it('no cards and no failure draws the normal empty state, never the provider failure', async () => {
    await renderList([], []);

    expect(screen.getByTestId('cockpit-card-empty')).toBeTruthy();
    expect(screen.queryByTestId('cockpit-card-provider-error')).toBeNull();
  });

  it('a healthy diagnostic that produced no cards is still an empty read, not a failure', async () => {
    await renderList([], [healthyDiagnostic('quay-fleet', 0)]);

    expect(screen.getByTestId('cockpit-card-empty')).toBeTruthy();
    expect(screen.queryByTestId('cockpit-card-provider-error')).toBeNull();
  });

  it('no cards but a failed provider draws its reason and retry INSTEAD of the empty state', async () => {
    await renderList([], [failedDiagnostic('quay-fleet')]);

    const failure = screen.getByTestId('cockpit-card-provider-error');
    expect(failure.getAttribute('data-providers')).toBe('quay-fleet');
    expect(failure.textContent).toContain('quay-fleet');
    expect(failure.textContent).toContain('quay-fleet binary is missing');
    expect(screen.getByTestId('cockpit-card-provider-retry')).toBeTruthy();
    // The whole point: a failed provider is NOT reported as a healthy empty wall.
    expect(screen.queryByTestId('cockpit-card-empty')).toBeNull();
  });

  it('cards plus a failed provider keeps the healthy cards AND draws the persistent notice', async () => {
    await renderList([card({ id: 'fixture-1' })], [failedDiagnostic('quay-fleet')]);

    // The healthy card is still on the wall.
    expect(screen.getByTestId('cockpit-card-list').textContent).toContain('Which way?');
    // …and the failure is stated beside it, with the retry.
    const failure = screen.getByTestId('cockpit-card-provider-error');
    expect(failure.getAttribute('data-providers')).toBe('quay-fleet');
    expect(screen.getByTestId('cockpit-card-provider-retry')).toBeTruthy();
    // A wall with cards never draws the empty state.
    expect(screen.queryByTestId('cockpit-card-empty')).toBeNull();
  });

  it('the retry re-reads, and a recovered provider clears the notice and lands its cards', async () => {
    const h = await renderList([], [failedDiagnostic('quay-fleet')]);
    expect(screen.getByTestId('cockpit-card-provider-error')).toBeTruthy();

    // The provider recovers: the next read answers a card and a healthy diagnostic.
    h.setCards([card({ id: 'fixture-1' })]);
    h.setDiagnostics([healthyDiagnostic('quay-fleet', 1)]);
    await act(async () => {
      fireEvent.click(screen.getByTestId('cockpit-card-provider-retry'));
    });

    expect(h.reads).toBe(2);
    expect(screen.queryByTestId('cockpit-card-provider-error')).toBeNull();
    expect(screen.getByTestId('cockpit-card-list').textContent).toContain('Which way?');
  });
});

describe('the page binding forwards the route’s diagnostics', () => {
  it('a provider failure in the HTTP answer reaches the wall (the hook drops nothing)', async () => {
    // The controller-level cases above bind their own transport. This leg drives the SHIPPED
    // transport instead — `useCockpitCards`'s default `fetchCards` — so a binding that forwards
    // only `answer.cards` (the original defect) reds here rather than passing on a fixture that
    // already speaks the new shape.
    const spy = vi.spyOn(api, 'cockpitCards').mockResolvedValue({
      ok: true,
      status: 200,
      json: async () => ({
        cards: [],
        diagnostics: [failedDiagnostic('quay-fleet')],
      }),
    } as unknown as Response);
    try {
      render(
        <MemoryRouter initialEntries={['/cockpit?view=cards']}>
          <I18nextProvider i18n={i18n}>
            <CockpitCardList />
          </I18nextProvider>
        </MemoryRouter>,
      );

      expect(await screen.findByTestId('cockpit-card-provider-error')).toBeTruthy();
      expect(screen.queryByTestId('cockpit-card-empty')).toBeNull();
    } finally {
      spy.mockRestore();
    }
  });
});

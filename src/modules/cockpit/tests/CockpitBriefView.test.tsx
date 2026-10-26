import { cleanup, fireEvent, render, screen, within } from '@testing-library/react';
import { I18nextProvider } from 'react-i18next';
import { afterEach, beforeAll, describe, expect, it, vi } from 'vitest';

import type {
  Clock,
  CockpitBriefBlock,
  CockpitBriefResponse,
  CockpitCard as CockpitCardData,
} from '@/shared/types';
import { i18n } from '@/modules/i18n';
import CockpitCardDetails from '@/modules/cockpit/CockpitCardDetails';
import CockpitBriefView from '@/modules/cockpit/CockpitBriefView';
import type { CockpitBriefState } from '@/modules/cockpit/cockpitCardController';
import { createCockpitCardController } from '@/modules/cockpit/cockpitCardController';

/**
 * The Details drawer's brief rendering (AC-431), against the real i18n bundle.
 *
 * WHAT THIS PROVES WITHOUT A BROWSER:
 *
 * - the request is issued by opening Details, once per (card, revision) — a close/reopen is a
 *   cache read and a re-read that bumps the revision asks again;
 * - the seven preset block types each draw a structure the test can identify;
 * - the radar keeps the mandatory `rev`/`evid` axes readable and states what a high score means;
 * - a block type this build does not know degrades to its title and raw content, without a throw;
 * - a fallback names the reason and draws no chart, and the loading/error states are distinct
 *   (the error carries a retry).
 *
 * The isolated instance's DoD still covers the visual/pixel leg; this file covers the rules.
 */

const NOW = Date.parse('2026-10-27T00:10:00.000Z');

const FAKE_CLOCK: Clock = {
  setTimeout: () => 1,
  clearTimeout: () => undefined,
  setInterval: () => 2,
  clearInterval: () => undefined,
  now: () => NOW,
};

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
  facts: [{ text: 'staging holds 1.2 GB', mechanical: true }],
  options: [
    {
      id: 'small',
      label: 'Keep the scope small',
      does: 'Ship the contract without the UI.',
      suggested: true,
      source: 'assistant',
      action: { executor: 'fixture.record', params: { optionId: 'small' } },
    },
    {
      id: 'full',
      label: 'Ship the full flow',
      does: 'Include the UI in the same task.',
      suggested: false,
      source: 'provider',
      action: { executor: 'fixture.record', params: { optionId: 'full' } },
    },
  ],
  conversation: { sessionId: 'fixture-session' },
};

/** The seven-preset document the fixture provider answers with, in test form. */
function briefResponse(overrides: Partial<CockpitBriefResponse> = {}): CockpitBriefResponse {
  return {
    cardId: CARD.id,
    sessionId: 'fixture-session',
    askId: 'fixture-ask',
    revision: 1,
    messageId: null,
    status: 'generated',
    reason: null,
    cached: false,
    question: CARD.ask ?? null,
    rounds: 1,
    durationMs: 0,
    failures: [],
    tokens: { input: 0, output: 0, cacheRead: 0, cacheCreation: 0, total: 0 },
    v: 0,
    itemRef: 'cloudcli://card/fixture:ask',
    headline: 'Two ways to land the cleanup',
    options: [
      {
        id: 'small',
        label: 'Keep the scope small',
        does: 'Ship the contract without the UI.',
        consequence: [{ kind: 'undo', text: '可撤' }],
      },
      {
        id: 'full',
        label: 'Ship the full flow',
        does: 'Include the UI in the same task.',
        consequence: [{ kind: 'warn', text: '不可逆' }],
      },
    ],
    recommendation: { optionId: 'small', why: ['It is reversible.'] },
    evidence: [
      { id: 'e1', label: 'staging holds 1.2 GB', mechanical: true },
      { id: 'e2', label: 'the next step is a judgement call', mechanical: false },
    ],
    blocks: [
      {
        id: 'radar',
        type: 'radar',
        title: 'Options compared',
        axes: [
          {
            id: 'rev',
            label: 'Reversibility',
            definition: 'how easily the choice can be undone',
            basis: 'mechanical',
            evidenceRefs: ['e1'],
          },
          {
            id: 'evid',
            label: 'Evidence',
            definition: 'how much of the choice rests on measured facts',
            basis: 'mechanical',
            evidenceRefs: ['e1'],
          },
          {
            id: 'scope',
            label: 'Scope',
            definition: 'how much of the work the choice commits to',
            basis: 'llm',
          },
        ],
        series: [
          { optionId: 'small', values: { rev: 80, evid: 70, scope: 40 } },
          { optionId: 'full', values: { rev: 30, evid: 50, scope: 80 } },
        ],
      },
      {
        id: 'table',
        type: 'compare-table',
        title: 'Compared',
        columns: ['small', 'full'],
        rows: [
          { label: 'Reversible', cells: { small: 'yes', full: 'no' }, basis: 'mechanical' },
          { label: 'Evidence held', cells: { small: 'archive verified', full: 'none' }, basis: 'mechanical' },
        ],
      },
      {
        id: 'diffstat',
        type: 'diffstat',
        title: 'Change size',
        files: [
          { path: 'server/modules/cockpit/cockpit.module.ts', add: 34, del: 6 },
          { path: 'src/modules/cockpit/CockpitBriefView.tsx', add: 120, del: 0 },
        ],
      },
      {
        id: 'checklist',
        type: 'checklist',
        title: 'Before choosing',
        // The middle item deliberately has NO `done`: the optional field defaults to not done.
        items: [
          { text: 'Confirm the archive is readable', done: true },
          { text: 'Decide who owns the next staging cleanup' },
          { text: 'Tell the team the deploy is unparked', done: false },
        ],
      },
      {
        id: 'timeline',
        type: 'timeline',
        title: 'Attempts',
        events: [
          { at: '2026-10-27T00:01:00.000Z', label: 'attempt 1 · suite red', state: 'bad' },
          { at: '2026-10-27T00:02:00.000Z', label: 'baseline re-checked', state: 'neutral' },
          { at: '2026-10-27T00:03:00.000Z', label: 'attempt 2 · suite green', state: 'ok' },
        ],
      },
      {
        id: 'graph',
        type: 'graph',
        title: 'Where it lands',
        nodes: [
          { id: 'cockpit', label: 'cockpit', state: 'changed' },
          { id: 'hub', label: 'hub', state: 'same' },
          { id: 'ui', label: 'cockpit ui', state: 'new' },
          { id: 'gateway', label: 'gateway', state: 'bad' },
        ],
        edges: [
          { from: 'cockpit', to: 'hub', kind: 'reads' },
          { from: 'cockpit', to: 'ui', kind: 'mounts' },
          { from: 'cockpit', to: 'gateway', kind: 'calls' },
        ],
      },
      {
        id: 'callout',
        type: 'callout',
        tone: 'warn',
        text: 'This fixture brief never calls the model gateway.',
      },
    ],
    ...overrides,
  };
}

const flush = (): Promise<void> => new Promise((resolve) => setTimeout(resolve, 0));

/** Renders the Details drawer with one brief reading. */
function renderDetails(brief: CockpitBriefState | undefined, onRetryBrief?: () => void) {
  return render(
    <I18nextProvider i18n={i18n}>
      <CockpitCardDetails
        card={CARD}
        now={NOW}
        brief={brief}
        onRetryBrief={onRetryBrief}
        onClose={() => undefined}
      />
    </I18nextProvider>,
  );
}

/** Builds the real controller over a fake card read and a fake brief read. */
function makeController(args: {
  fetchBrief: (cardId: string) => Promise<CockpitBriefResponse>;
  fetchCards: () => Promise<readonly CockpitCardData[]>;
}) {
  return createCockpitCardController({
    fetchCards: args.fetchCards,
    confirm: async () => ({ executor: 'test.exec', result: null }),
    fetchBrief: args.fetchBrief,
    clock: FAKE_CLOCK,
    refreshIntervalMs: 0,
  });
}

beforeAll(async () => {
  await i18n.changeLanguage('en');
});

afterEach(() => {
  cleanup();
});

describe('the read is issued by opening Details, once per (card, revision)', () => {
  it('requests on the first open, not again on a close/reopen at the same revision', async () => {
    const fetchBrief = vi.fn(async () => briefResponse());
    const controller = makeController({ fetchBrief, fetchCards: async () => [CARD] });
    await controller.load();

    controller.openDetails(CARD.id);
    expect(fetchBrief).toHaveBeenCalledTimes(1);
    expect(controller.getSnapshot().briefs[CARD.id]?.status).toBe('loading');
    await flush();
    expect(controller.getSnapshot().briefs[CARD.id]?.status).toBe('ready');

    controller.closeDetails();
    controller.openDetails(CARD.id);
    await flush();
    expect(fetchBrief).toHaveBeenCalledTimes(1);
    expect(controller.getSnapshot().briefs[CARD.id]?.status).toBe('ready');
  });

  it('requests again after the card re-read at a new revision', async () => {
    const fetchBrief = vi.fn(async () => briefResponse());
    let revision = 1;
    const controller = makeController({
      fetchBrief,
      fetchCards: async () => [{ ...CARD, revision }],
    });
    await controller.load();
    controller.openDetails(CARD.id);
    await flush();
    expect(fetchBrief).toHaveBeenCalledTimes(1);

    revision = 2;
    await controller.load();
    // The stale reading is dropped, not drawn over the new revision.
    expect(controller.getSnapshot().briefs[CARD.id]).toBeUndefined();

    controller.closeDetails();
    controller.openDetails(CARD.id);
    await flush();
    expect(fetchBrief).toHaveBeenCalledTimes(2);
  });
});

describe('the seven preset structures', () => {
  it('draws one identifiable structure per block type', () => {
    renderDetails({ status: 'ready', cardRevision: 1, response: briefResponse() });

    for (const type of [
      'radar',
      'compare-table',
      'diffstat',
      'checklist',
      'timeline',
      'graph',
      'callout',
    ]) {
      expect(screen.getByTestId(`cockpit-brief-${type}`), type).toBeTruthy();
    }

    const radar = screen.getByTestId('cockpit-brief-radar');
    expect(within(radar).getAllByTestId('cockpit-brief-radar-series')).toHaveLength(2);
    expect(
      within(screen.getByTestId('cockpit-brief-compare-table')).getAllByTestId(
        'cockpit-brief-compare-row',
      ),
    ).toHaveLength(2);
    expect(
      within(screen.getByTestId('cockpit-brief-diffstat-files')).getAllByRole('listitem'),
    ).toHaveLength(2);
    expect(
      within(screen.getByTestId('cockpit-brief-timeline-events')).getAllByTestId(
        'cockpit-brief-timeline-event',
      ),
    ).toHaveLength(3);
    expect(
      within(screen.getByTestId('cockpit-brief-graph')).getAllByTestId(
        'cockpit-brief-graph-node',
      ),
    ).toHaveLength(4);
    expect(screen.getByTestId('cockpit-brief-callout-body').getAttribute('data-tone')).toBe('warn');
    expect(screen.getByTestId('cockpit-brief-recommended').textContent).toContain(
      'Keep the scope small',
    );
  });

  it('treats an absent checklist `done` as not done', () => {
    renderDetails({ status: 'ready', cardRevision: 1, response: briefResponse() });

    const items = within(screen.getByTestId('cockpit-brief-checklist-items')).getAllByTestId(
      'cockpit-brief-checklist-item',
    );
    expect(items.map((item) => item.getAttribute('data-done'))).toEqual(['true', 'false', 'false']);
    expect(screen.getByText('Decide who owns the next staging cleanup')).toBeTruthy();
  });
});

describe('the radar keeps rev and evid readable', () => {
  it('always names both mandatory axes and states what a high score means', () => {
    renderDetails({ status: 'ready', cardRevision: 1, response: briefResponse() });

    const rev = document.querySelector('[data-brief-axis-id="rev"]');
    const evid = document.querySelector('[data-brief-axis-id="evid"]');
    expect(rev, 'rev axis').not.toBeNull();
    expect(evid, 'evid axis').not.toBeNull();
    expect(rev?.textContent).toContain('Reversibility');
    expect(evid?.textContent).toContain('Evidence');
    expect(rev?.textContent).toContain('high means: how easily the choice can be undone');
    expect(evid?.textContent).toContain(
      'high means: how much of the choice rests on measured facts',
    );
    // The measured/judged marker is part of the axis reading, not only the chart.
    expect(rev?.textContent).toContain('●');
    expect(document.querySelector('[data-brief-axis-id="scope"]')?.textContent).toContain('○');
  });
});

describe('an unknown block type degrades instead of throwing', () => {
  it('draws the block title and its raw content', () => {
    const unknown = {
      id: 'heat',
      type: 'heatmap',
      title: 'Heat map',
      cells: [{ x: 1, y: 2, value: 3 }],
    } as unknown as CockpitBriefBlock;

    renderDetails({
      status: 'ready',
      cardRevision: 1,
      response: briefResponse({ blocks: [unknown] }),
    });

    expect(screen.getByTestId('cockpit-brief-heatmap')).toBeTruthy();
    const fallback = screen.getByTestId('cockpit-brief-unknown-block');
    expect(fallback.textContent).toContain('heatmap');
    expect(screen.getByText('Heat map')).toBeTruthy();
    expect(fallback.parentElement?.textContent).toContain('"cells"');
  });
});

describe('a fallback names its reason and draws no chart', () => {
  it('shows the mapped sentence and zero block structures', () => {
    const response = briefResponse({
      status: 'fallback',
      reason: 'daily-token-cap-reached',
      blocks: [
        {
          id: 'radar',
          type: 'radar',
          title: 'Options compared',
          axes: [
            { id: 'rev', label: 'Reversibility', definition: 'undo', basis: 'mechanical' },
            { id: 'evid', label: 'Evidence', definition: 'facts', basis: 'mechanical' },
          ],
          series: [],
        },
      ],
    });

    renderDetails({ status: 'ready', cardRevision: 1, response });

    expect(screen.getByTestId('cockpit-brief-fallback')).toBeTruthy();
    expect(screen.getByTestId('cockpit-brief-fallback-reason').textContent).toBe(
      "today's brief budget is used up",
    );
    expect(screen.queryByTestId('cockpit-brief-radar')).toBeNull();
    expect(screen.queryByTestId('cockpit-brief-radar-chart')).toBeNull();
    expect(screen.queryByTestId('cockpit-brief')).toBeNull();
  });

  it('names an unmapped reason instead of dropping it', () => {
    renderDetails({
      status: 'ready',
      cardRevision: 1,
      response: briefResponse({ status: 'fallback', reason: 'a-new-reason', blocks: [] }),
    });

    expect(screen.getByTestId('cockpit-brief-fallback-reason').textContent).toContain('a-new-reason');
  });
});

describe('loading and error are distinct states', () => {
  it('draws the loading sentence and no error/retry', () => {
    renderDetails({ status: 'loading', cardRevision: 1 });

    expect(screen.getByTestId('cockpit-brief-loading').textContent).toBe('Reading the brief…');
    expect(screen.queryByTestId('cockpit-brief-error')).toBeNull();
    expect(screen.queryByTestId('cockpit-brief-retry')).toBeNull();
  });

  it('draws the failure and a working retry', () => {
    const onRetry = vi.fn();
    renderDetails({ status: 'error', cardRevision: 1, message: 'HTTP 502' }, onRetry);

    expect(screen.getByTestId('cockpit-brief-error').textContent).toContain('HTTP 502');
    fireEvent.click(screen.getByTestId('cockpit-brief-retry'));
    expect(onRetry).toHaveBeenCalledTimes(1);
  });

  it('draws nothing when the drawer has not asked', () => {
    render(
      <I18nextProvider i18n={i18n}>
        <CockpitBriefView state={undefined} />
      </I18nextProvider>,
    );

    expect(screen.queryByTestId('cockpit-brief-loading')).toBeNull();
    expect(screen.queryByTestId('cockpit-brief')).toBeNull();
  });
});

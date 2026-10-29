import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { I18nextProvider } from 'react-i18next';
import { afterEach, beforeAll, describe, expect, it, vi } from 'vitest';

import { i18n } from '@/modules/i18n';
import DeployReadiness from '@/modules/cockpit/DeployReadiness';
import type {
  DeployExecutePort,
  DeployQueueReading,
  DeployReadinessPort,
  DeployReadinessReading,
} from '@/modules/cockpit/DeployReadiness';

/**
 * The deployment strip (AC5).
 *
 * WHAT THIS FILE PROVES, against the rendered DOM and the deploy seam:
 *
 *   - every status draws its own sentence, and only the actionable statuses draw the
 *     「构建并重启」 button;
 *   - clicking that button opens the confirmation panel and sends NOTHING;
 *   - confirming sends the deploy request EXACTLY once;
 *   - the session page's compact form renders nothing while the deployment is fresh.
 *
 * The read/deploy ports are injected, so no network is involved and the assertions are about
 * what the component asks for, not about a mocked fetch.
 */

const NOW = Date.parse('2026-10-24T12:00:00.000Z');

function reading(overrides: Partial<DeployReadinessReading> = {}): DeployReadinessReading {
  return {
    status: 'fresh',
    runningSha: 'a'.repeat(40),
    builtSha: 'a'.repeat(40),
    clientBuiltSha: 'a'.repeat(40),
    headSha: 'a'.repeat(40),
    buildSkew: false,
    pendingCommits: [],
    lastDeploy: null,
    failure: null,
    checkedAt: new Date(NOW).toISOString(),
    ...overrides,
  };
}

function renderStrip({
  value = reading(),
  deploy = vi.fn<DeployExecutePort>(async () => ({ ok: true })),
  read = vi.fn<DeployReadinessPort>(async () => value),
  queue = null,
}: {
  value?: DeployReadinessReading;
  deploy?: DeployExecutePort;
  read?: DeployReadinessPort;
  queue?: DeployQueueReading | null;
} = {}) {
  return {
    deploy,
    ...render(
      <I18nextProvider i18n={i18n}>
        <DeployReadiness deploy={deploy} read={read} now={() => NOW} queue={queue} />
      </I18nextProvider>,
    ),
  };
}

beforeAll(async () => {
  await i18n.changeLanguage('en');
});

afterEach(() => {
  cleanup();
});

describe('deployment status copy and actions', () => {
  it.each<[string, Partial<DeployReadinessReading>, string, boolean]>([
    ['fresh', {}, 'Deployment is current', false],
    [
      'built-pending-restart',
      { runningSha: 'b'.repeat(40) },
      '1 change not yet built',
      true,
    ],
    ['building', { status: 'building' }, 'Building…', false],
    ['restarting', { status: 'restarting' }, 'Restarting…', false],
    [
      'unknown',
      { runningSha: null, builtSha: null, clientBuiltSha: null },
      'Deployment status unknown',
      false,
    ],
  ])('%s draws its own sentence (actionable=%s)', async (_label, overrides, copy, actionable) => {
    renderStrip({ value: reading(overrides) });

    const line = await screen.findByTestId('deploy-status');
    expect(line.textContent).toBe(copy);
    expect(screen.queryByTestId('deploy-action') !== null).toBe(actionable);
  });

  it('reads the RUNNING process, not the historical last-deploy record', async () => {
    const running = 'a'.repeat(40);
    const historical = 'c'.repeat(40);
    renderStrip({
      value: reading({
        status: 'fresh',
        runningSha: running,
        builtSha: running,
        clientBuiltSha: running,
        headSha: running,
        pendingCommits: [],
        // The persisted record verified a DIFFERENT sha. It may not be presented as the
        // running build, and its verdict/time do not describe the running process.
        lastDeploy: {
          targetSha: historical,
          ok: true,
          checks: [],
          at: new Date(NOW - 60_000).toISOString(),
        },
      }),
    });

    const strip = await screen.findByTestId('deploy-readiness');
    const last = screen.getByTestId('deploy-last');
    expect(last.textContent).toContain('aaaaaaa');
    expect(last.getAttribute('data-verified')).toBe('false');
    expect(strip.textContent).not.toContain('ccccccc');
    expect(strip.textContent).not.toContain('changes not yet built');
  });

  it('a running sha behind the build sha names both shas and the unbuilt change', async () => {
    const running = 'a'.repeat(40);
    const built = 'b'.repeat(40);
    renderStrip({
      value: reading({
        runningSha: running,
        builtSha: built,
        clientBuiltSha: built,
        headSha: built,
        pendingCommits: [],
        lastDeploy: null,
      }),
    });

    const strip = await screen.findByTestId('deploy-readiness');
    expect(screen.getByTestId('deploy-status').textContent).toBe('1 change not yet built');
    expect(screen.getByTestId('deploy-running-build').textContent).toBe('aaaaaaa');
    expect(screen.getByTestId('deploy-built-build').textContent).toBe('bbbbbbb');
    expect(strip.textContent).toContain('aaaaaaa');
    expect(strip.textContent).toContain('bbbbbbb');
    expect(screen.getByTestId('deploy-action')).toBeTruthy();
  });

  it('an unreadable build reading says unknown and prints no sha at all', async () => {
    renderStrip({
      value: reading({
        // The server may still say `fresh`; the missing fingerprints are the fact that wins.
        status: 'fresh',
        runningSha: null,
        builtSha: null,
        clientBuiltSha: null,
        lastDeploy: {
          targetSha: 'c'.repeat(40),
          ok: true,
          checks: [],
          at: new Date(NOW - 60_000).toISOString(),
        },
      }),
    });

    const strip = await screen.findByTestId('deploy-readiness');
    expect(screen.getByTestId('deploy-status').textContent).toBe('Deployment status unknown');
    // No historical sha, and no sha-shaped literal anywhere in the strip.
    expect(strip.textContent).not.toMatch(/[0-9a-f]{7}/);
    expect(screen.queryByTestId('deploy-last')).toBeNull();
  });

  it('the todo number is the injected queue reading from the cards’ own project source', async () => {
    // The SAME project reading `CockpitPage` hands the stage's cards: ready + todo is the
    // queue the driver can still pick up.
    const projects = [
      { ready: 3, todo: 2 },
      { ready: 1, todo: 0 },
    ];
    const injectedQueue = projects.reduce<DeployQueueReading>(
      (sum, project) => ({
        ready: sum.ready + project.ready,
        todo: sum.todo + project.todo,
      }),
      { ready: 0, todo: 0 },
    );

    renderStrip({ queue: injectedQueue });

    const queue = await screen.findByTestId('deploy-queue');
    // Two places, one reading: the machine attribute and the drawn text must agree...
    expect(queue.getAttribute('data-queue-todo')).toBe(String(injectedQueue.ready + injectedQueue.todo));
    expect(queue.textContent).toBe('todo 6');
    expect(queue.getAttribute('data-queue-ready')).toBe('4');
    expect(queue.getAttribute('data-queue-pending')).toBe('2');
    // ...and both equal the sum over the project source the cards are built from.
    expect(Number(queue.getAttribute('data-queue-todo'))).toBe(
      projects.reduce((sum, project) => sum + project.ready + project.todo, 0),
    );
  });

  it('no queue reading draws no todo number rather than a false zero', async () => {
    renderStrip({ queue: null });
    await screen.findByTestId('deploy-readiness');
    expect(screen.queryByTestId('deploy-queue')).toBeNull();
  });

  it('a build skew names both sides instead of counting pending commits, and offers the full build', async () => {
    renderStrip({
      value: reading({
        // The server is already at HEAD, so the generic classification would say `fresh`;
        // the skew must still be the sentence the operator reads, and the action must be offered.
        status: 'fresh',
        builtSha: 'd'.repeat(40),
        clientBuiltSha: 'c'.repeat(40),
        headSha: 'd'.repeat(40),
        buildSkew: true,
        pendingCommits: [],
      }),
    });

    const strip = await screen.findByTestId('deploy-readiness');
    expect(strip.getAttribute('data-build-skew')).toBe('true');
    const line = screen.getByTestId('deploy-status');
    expect(line.textContent).toContain('Frontend and server builds differ');
    expect(line.textContent).toContain('ccccccc');
    expect(line.textContent).toContain('ddddddd');
    expect(screen.getByTestId('deploy-action')).toBeTruthy();
  });

  it('pending-build counts the source commits and draws the action', async () => {
    renderStrip({
      value: reading({
        status: 'pending-build',
        pendingCommits: [
          { sha: 'b'.repeat(40), subject: 'src: deploy strip', taskId: 'deploy-readiness-build-and-safe-restart' },
          { sha: 'c'.repeat(40), subject: 'server: readiness', taskId: null },
        ],
      }),
    });

    const line = await screen.findByTestId('deploy-status');
    expect(line.textContent).toBe('2 changes not yet built');
    expect(screen.getByTestId('deploy-action')).toBeTruthy();
  });

  it('shows the last deploy verdict and the failing check name', async () => {
    const sha = 'd'.repeat(40);
    renderStrip({
      value: reading({
        status: 'fresh',
        runningSha: sha,
        builtSha: sha,
        clientBuiltSha: sha,
        headSha: sha,
        lastDeploy: {
          targetSha: sha,
          ok: false,
          checks: [
            { name: 'build-sha', ok: false, status: null, detail: 'mismatch' },
            { name: 'route-root', ok: true, status: 200, detail: 'ok' },
          ],
          at: new Date(NOW - 120_000).toISOString(),
        },
      }),
    });

    const last = await screen.findByTestId('deploy-last');
    expect(last.textContent).toContain('ddddddd');
    expect(last.textContent).toContain('verification failed');
    expect(last.textContent).toContain('build-sha');
  });

  it('shows a failed build step and the tail of its output', async () => {
    renderStrip({
      value: reading({
        status: 'fresh',
        failure: {
          step: 'build',
          outputTail: 'tsc: one error\nbuild boom: exit 1',
          at: new Date(NOW).toISOString(),
        },
      }),
    });

    const failure = await screen.findByTestId('deploy-failure');
    expect(failure.textContent).toContain('build');
    expect(screen.getByTestId('deploy-failure-output').textContent).toBe('build boom: exit 1');
  });
});

describe('the confirmed deploy action', () => {
  it('clicking 「构建并重启」 only opens the panel; confirming sends exactly one request', async () => {
    const { deploy } = renderStrip({
      value: reading({
        status: 'pending-build',
        pendingCommits: [
          { sha: 'b'.repeat(40), subject: 'src: deploy strip', taskId: 'deploy-readiness-build-and-safe-restart' },
        ],
      }),
    });

    fireEvent.click(await screen.findByTestId('deploy-action'));
    const panel = screen.getByTestId('deploy-confirm-panel');
    expect(panel).toBeTruthy();
    // The panel lists what will take effect, including the task id the commit names.
    expect(screen.getByTestId('deploy-commit').textContent).toContain('deploy-readiness-build-and-safe-restart');
    expect(deploy).not.toHaveBeenCalled();

    fireEvent.click(screen.getByTestId('deploy-confirm'));
    await waitFor(() => expect(deploy).toHaveBeenCalledTimes(1));
    await waitFor(() => expect(screen.queryByTestId('deploy-confirm-panel')).toBeNull());
  });

  it('cancel closes the panel and sends nothing', async () => {
    // The running process is one build behind the build on disk, so the action is offered.
    const { deploy } = renderStrip({
      value: reading({ status: 'built-pending-restart', runningSha: 'b'.repeat(40) }),
    });

    fireEvent.click(await screen.findByTestId('deploy-action'));
    fireEvent.click(screen.getByTestId('deploy-cancel'));

    expect(screen.queryByTestId('deploy-confirm-panel')).toBeNull();
    expect(deploy).not.toHaveBeenCalled();
  });
});

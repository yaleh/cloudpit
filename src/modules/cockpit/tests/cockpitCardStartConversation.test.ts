import assert from 'node:assert/strict';
import { readFileSync, readdirSync, statSync } from 'node:fs';
import path from 'node:path';

import { describe, it } from 'vitest';

import {
  createCockpitStartConversationController,
  type CockpitStartConversationController,
} from '@/modules/cockpit/cards/cockpitCardStartConversation';
import type { CockpitCard } from '@/shared/types';

/**
 * The cockpit card's "start a conversation" button, and the ONE setting it must share with the
 * card `session.start` executor: the server settings file's `cockpit.sessionStart`.
 *
 * THREE READINGS, each taken off what the flow actually did rather than off its markup:
 *
 *  1. A card start creates an EMPTY session (no initial message) whose LAUNCH SELECTION is the
 *     server's EFFECTIVE reading — the same field an action/`ownReply` start is handed. The
 *     payload is read from the injected create call, and the navigation order is read from the
 *     callbacks, because "register before navigate" is the property that keeps the destination
 *     from flashing an empty workspace.
 *  2. No local default. A reading that names no model/effort produces a payload with NO
 *     model/effort keys — the provider keeps its own launch default rather than this page
 *     inventing one. A failed reading fails the start visibly and creates nothing.
 *  3. The EXISTING send paths are untouched. `session.send`, scheduled messages and queued
 *     delivery still read the session's own composer model (`currentProviderModel`), and no
 *     module under `src/modules/chat` references the cockpit setting at all. This is a source
 *     reading on purpose: the property is an absence (the new setting did not leak into the
 *     old paths), and an absence is exactly what a runtime fixture cannot show.
 */

const repoRoot = process.cwd();
const srcRoot = path.join(repoRoot, 'src');

const PROJECT = { projectId: 'project-1', fleetProjectId: 'fleet-a', projectPath: '/repo/a' };

const CARD = {
  id: 'card-1',
  subject: { project: 'fleet-a' },
  conversation: { startInProject: 'fleet-a' },
} as unknown as CockpitCard;

type CreatePayload = {
  provider: string;
  projectPath: string;
  model?: string;
  effort?: string;
  initialMessage?: unknown;
};

/** Runs the controller's fire-and-forget start until its snapshot leaves `starting`. */
async function settle(controller: CockpitStartConversationController): Promise<void> {
  for (let attempt = 0; attempt < 200; attempt += 1) {
    if (controller.getSnapshot().status !== 'starting') return;
    await new Promise((resolve) => setTimeout(resolve, 1));
  }
  throw new Error('the card start never settled');
}

/** A controller wired to the project registry and to recorders for the two effects. */
function harness(options: {
  selection: { model?: string; effort?: string } | (() => Promise<{ model?: string; effort?: string }>);
  created?: string[];
}) {
  const payloads: CreatePayload[] = [];
  const order: string[] = [];
  const controller = createCockpitStartConversationController({
    createSession: async (payload) => {
      payloads.push(payload as CreatePayload);
      return { sessionId: 'session-1', sessionName: 'Conversation' };
    },
    readEffectiveSelection: typeof options.selection === 'function'
      ? options.selection
      : async () => options.selection as { model?: string; effort?: string },
    provider: 'claude',
  });
  controller.setContext({
    registeredProjects: [PROJECT],
    loadRegisteredProjects: null,
    onCreated: (created) => {
      options.created?.push(created.sessionId);
      order.push(`created:${created.sessionId}`);
    },
    onNavigate: (sessionId) => order.push(`navigate:${sessionId}`),
  });
  return { controller, payloads, order };
}

describe('the card start opens an empty session with the server effective selection', () => {
  it('passes the effective model/effort, sends no initial message, and navigates after registering', async () => {
    const created: string[] = [];
    const { controller, payloads, order } = harness({
      selection: { model: 'opus-alpha', effort: 'high' },
      created,
    });

    controller.start(CARD);
    await settle(controller);

    assert.deepEqual(payloads, [
      { provider: 'claude', projectPath: '/repo/a', model: 'opus-alpha', effort: 'high' },
    ]);
    assert.equal('initialMessage' in payloads[0], false, 'the session must be EMPTY');
    assert.deepEqual(order, ['created:session-1', 'navigate:session-1']);
    assert.deepEqual(created, ['session-1']);
    const snapshot = controller.getSnapshot();
    assert.equal(snapshot.status, 'started');
    assert.equal(snapshot.sessionId, 'session-1');
    assert.equal(snapshot.projectId, 'project-1');
    console.log(`(1) payload=${JSON.stringify(payloads[0])} order=${order.join(' -> ')}`);
  });

  it('invents no local default: an empty reading sends neither model nor effort', async () => {
    const { controller, payloads } = harness({ selection: {} });
    controller.start(CARD);
    await settle(controller);

    assert.deepEqual(payloads, [{ provider: 'claude', projectPath: '/repo/a' }]);
    assert.equal(Object.prototype.hasOwnProperty.call(payloads[0], 'model'), false);
    assert.equal(Object.prototype.hasOwnProperty.call(payloads[0], 'effort'), false);
    console.log(`(2) payload=${JSON.stringify(payloads[0])}`);
  });

  it('omits blank selection values rather than sending empty strings', async () => {
    const { controller, payloads } = harness({ selection: { model: '  ', effort: '' } });
    controller.start(CARD);
    await settle(controller);

    assert.deepEqual(payloads, [{ provider: 'claude', projectPath: '/repo/a' }]);
  });

  it('fails visibly and creates nothing when the reading cannot be read', async () => {
    const { controller, payloads, order } = harness({
      selection: async () => {
        throw new Error('Failed to read the cockpit session-start settings (500)');
      },
    });
    controller.start(CARD);
    await settle(controller);

    assert.deepEqual(payloads, [], 'no session may be created on a failed read');
    assert.deepEqual(order, [], 'nothing may be registered or navigated to');
    const snapshot = controller.getSnapshot();
    assert.equal(snapshot.status, 'failed');
    assert.equal(snapshot.error?.kind, 'failed');
    assert.match(
      snapshot.error?.kind === 'failed' ? snapshot.error.reason : '',
      /settings/,
    );
    console.log(`(4) error=${JSON.stringify(snapshot.error)}`);
  });
});

/** Every non-test `.ts`/`.tsx` file under `src/`, relative to the repo root. */
function sourceFiles(directory = srcRoot): string[] {
  const found: string[] = [];
  for (const entry of readdirSync(directory)) {
    const full = path.join(directory, entry);
    if (statSync(full).isDirectory()) {
      if (entry !== 'tests') found.push(...sourceFiles(full));
    } else if (/\.(ts|tsx)$/.test(entry) && !/\.test\.(ts|tsx)$/.test(entry)) {
      found.push(full);
    }
  }
  return found;
}

describe('the new-session setting did not leak into the existing send paths', () => {
  it('only the new-session surfaces reference cockpitSessionStart', () => {
    const referencing = sourceFiles()
      .filter((file) => readFileSync(file, 'utf8').includes('cockpitSessionStart'))
      .map((file) => path.relative(repoRoot, file).split(path.sep).join('/'))
      .sort();

    assert.deepEqual(referencing, [
      'src/modules/cockpit/hooks/useCockpitStartConversation.ts',
      'src/modules/settings/hooks/useCockpitSessionStartSettings.ts',
      'src/modules/settings/tabs/CockpitSessionStartSettingsTab.tsx',
      'src/shared/api.ts',
    ]);
    console.log(`(5) cockpitSessionStart referenced by: ${referencing.join(', ')}`);
  });

  it('session.send / scheduled / queued still carry the session\'s own composer model', () => {
    const composerPath = path.join(srcRoot, 'modules', 'chat-composer', 'hooks', 'useChatComposerState.ts');
    const composer = readFileSync(composerPath, 'utf8');
    // The existing send frame's model is the COMPOSER's per-session model, not the cockpit
    // setting. Both halves are asserted: the old source stays, the new setting is absent.
    assert.match(composer, /model:\s*currentProviderModel/, "chat.send must keep the composer's model");
    assert.equal(composer.includes('cockpitSessionStart'), false);

    const scheduled = readFileSync(
      path.join(srcRoot, 'modules', 'chat-composer', 'composer', 'useScheduledMessages.ts'),
      'utf8',
    );
    assert.equal(scheduled.includes('cockpitSessionStart'), false);

    const creation = readFileSync(
      path.join(srcRoot, 'modules', 'chat-session', 'utils', 'session', 'sessionCreation.ts'),
      'utf8',
    );
    assert.equal(
      creation.includes('cockpitSessionStart'),
      false,
      'the session gateway must not consult the cockpit setting',
    );
    console.log('(6) composer/scheduled/session-creation carry no cockpitSessionStart reference');
  });
});

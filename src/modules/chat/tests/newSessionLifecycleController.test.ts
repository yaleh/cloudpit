import assert from 'node:assert/strict';

import { describe, it } from 'vitest';

import { createNewSessionLifecycleController } from '@/modules/chat/utils/newSessionLifecycleController';

/**
 * The new-session lifecycle selection's rules, without React.
 *
 * `ChatInterface` renders the switch from this snapshot and both creation
 * paths (text and Live Voice) read `lifecycleModeForCreate`. These cases pin
 * the four statements that keep the switch's position and the created row's
 * mode the same: follow the provider default when nobody overrode it, state the
 * override on the creation, spend it after a successful creation, and never
 * carry it across a provider change.
 */

describe('new-session lifecycle controller', () => {
  it('stays hidden until the capability row arrives, then shows the provider default', () => {
    const controller = createNewSessionLifecycleController('claude');

    assert.deepEqual(controller.getSnapshot(), { provider: 'claude', mode: null, canToggle: false });
    assert.equal(
      controller.lifecycleModeForCreate(),
      undefined,
      'an unknown default must omit the mode so the server decides, never guess a mode',
    );

    controller.syncProvider('claude', { supportsResident: true, defaultLifecycleMode: 'resident' });

    assert.deepEqual(controller.getSnapshot(), { provider: 'claude', mode: 'resident', canToggle: true });
    assert.equal(controller.lifecycleModeForCreate(), undefined, 'no override means "follow the provider default"');
  });

  it('states the override on the creation and spends it after success', () => {
    const controller = createNewSessionLifecycleController('claude');
    controller.syncProvider('claude', { supportsResident: true, defaultLifecycleMode: 'resident' });

    controller.toggle();
    assert.equal(controller.getSnapshot().mode, 'per-run');
    assert.equal(controller.lifecycleModeForCreate(), 'per-run', 'a manually switched-off session is created per-run');

    controller.spend();
    assert.equal(controller.getSnapshot().mode, 'resident', 'the next new session follows the provider default again');
    assert.equal(controller.lifecycleModeForCreate(), undefined);
  });

  it('follows a per-run default and can still be overridden to resident', () => {
    const controller = createNewSessionLifecycleController('cursor');
    controller.syncProvider('cursor', { supportsResident: true, defaultLifecycleMode: 'per-run' });

    assert.equal(controller.getSnapshot().mode, 'per-run');
    controller.toggle();
    assert.equal(controller.getSnapshot().mode, 'resident');
    assert.equal(controller.lifecycleModeForCreate(), 'resident');
  });

  it('drops the override when the provider changes, rather than sending one provider choice for another', () => {
    const controller = createNewSessionLifecycleController('claude');
    controller.syncProvider('claude', { supportsResident: true, defaultLifecycleMode: 'resident' });
    controller.toggle();
    assert.equal(controller.lifecycleModeForCreate(), 'per-run');

    controller.syncProvider('codex', { supportsResident: true, defaultLifecycleMode: 'resident' });

    assert.deepEqual(controller.getSnapshot(), { provider: 'codex', mode: 'resident', canToggle: true });
    assert.equal(
      controller.lifecycleModeForCreate(),
      undefined,
      'the off position chosen for Claude must not create a per-run Codex session',
    );
  });

  it('drops a resident override the same provider no longer implements', () => {
    const controller = createNewSessionLifecycleController('claude');
    controller.syncProvider('claude', { supportsResident: true, defaultLifecycleMode: 'per-run' });
    controller.toggle();
    assert.equal(controller.lifecycleModeForCreate(), 'resident');

    controller.syncProvider('claude', { supportsResident: false, defaultLifecycleMode: 'per-run' });

    assert.deepEqual(controller.getSnapshot(), { provider: 'claude', mode: 'per-run', canToggle: false });
    assert.equal(controller.lifecycleModeForCreate(), undefined);
  });

  it('hides the switch for a provider that only implements per-run', () => {
    const controller = createNewSessionLifecycleController('opencode');
    controller.syncProvider('opencode', { supportsResident: false, defaultLifecycleMode: 'per-run' });

    assert.deepEqual(controller.getSnapshot(), { provider: 'opencode', mode: 'per-run', canToggle: false });
    controller.toggle();
    assert.equal(controller.getSnapshot().mode, 'per-run', 'a hidden switch cannot change the mode');
  });
});

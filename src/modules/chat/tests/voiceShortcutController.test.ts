import assert from 'node:assert/strict';

import { afterEach, test } from 'vitest';

import { createVoiceShortcutController } from '@/modules/chat/utils/voiceShortcutController';
import type { VoiceShortcutChord, VoiceShortcuts } from '@/shared/voiceShortcuts';

/**
 * The controller's rules, read through the one keydown path a real page uses.
 *
 * The listener is injected, so these cases press the controller directly — no
 * React, no microphone, no timing. What is under test is exactly the set of
 * guards that decide whether a bound key acts: the code/modifier match, repeats,
 * already-consumed events, the master switch, floating layers, per-surface
 * availability, and which command a match is routed to.
 */

const chord = (overrides: Partial<VoiceShortcutChord> = {}): VoiceShortcutChord => ({
  code: 'KeyD',
  ctrl: false,
  alt: false,
  shift: false,
  meta: false,
  ...overrides,
});

const shortcuts = (overrides: Partial<VoiceShortcuts> = {}): VoiceShortcuts => ({
  enabled: true,
  dictationChord: null,
  liveVoiceChord: null,
  ...overrides,
});

function harness(initial: VoiceShortcuts = shortcuts()) {
  let listener: ((event: KeyboardEvent) => void) | null = null;
  let attached = 0;
  let detached = 0;
  let stored = initial;
  const calls = { dictation: 0, live: 0 };
  const available = { dictation: true, live: true };

  const controller = createVoiceShortcutController({
    addKeydown: (handler) => {
      attached += 1;
      listener = handler;
      return () => {
        detached += 1;
        listener = null;
      };
    },
    readShortcuts: () => stored,
  });

  controller.setCommands({
    toggleDictation: () => {
      calls.dictation += 1;
    },
    toggleLiveVoice: () => {
      calls.live += 1;
    },
    isDictationAvailable: () => available.dictation,
    isLiveVoiceAvailable: () => available.live,
  });
  controller.start();

  const press = (overrides: Record<string, unknown> = {}) => {
    assert.ok(listener, 'premise: the controller is listening');
    const event = {
      code: 'KeyD',
      ctrlKey: false,
      altKey: false,
      shiftKey: false,
      metaKey: false,
      repeat: false,
      defaultPrevented: false,
      prevented: false,
      preventDefault() {
        this.defaultPrevented = true;
        this.prevented = true;
      },
      ...overrides,
    };
    listener(event as unknown as KeyboardEvent);
    return event;
  };

  return {
    controller,
    calls,
    available,
    press,
    setShortcuts: (next: VoiceShortcuts) => {
      stored = next;
    },
    counts: () => ({ attached, detached }),
    detachCount: () => detached,
  };
}

/** The Settings dialog's real root: a `.modal-backdrop` with no dialog role. */
let layer: HTMLElement | null = null;
afterEach(() => {
  layer?.remove();
  layer = null;
});

test('each binding routes to its own command and prevents the key', () => {
  const h = harness(shortcuts({
    dictationChord: chord({ code: 'KeyD', ctrl: true, alt: true }),
    liveVoiceChord: chord({ code: 'KeyL', ctrl: true, alt: true }),
  }));

  const dictation = h.press({ code: 'KeyD', ctrlKey: true, altKey: true });
  assert.equal(h.calls.dictation, 1);
  assert.equal(h.calls.live, 0);
  assert.equal(dictation.prevented, true, 'the matched key is claimed, not typed');

  const live = h.press({ code: 'KeyL', ctrlKey: true, altKey: true });
  assert.equal(h.calls.dictation, 1);
  assert.equal(h.calls.live, 1);
  assert.equal(live.prevented, true);

  const unrelated = h.press({ code: 'KeyZ', ctrlKey: true, altKey: true });
  assert.equal(h.calls.dictation + h.calls.live, 2, 'an unbound key does nothing');
  assert.equal(unrelated.prevented, false);
});

test('modifier state must match exactly', () => {
  const h = harness(shortcuts({ dictationChord: chord({ code: 'KeyD', ctrl: true, alt: true }) }));

  h.press({ code: 'KeyD', ctrlKey: true });
  h.press({ code: 'KeyD', ctrlKey: true, altKey: true, shiftKey: true });
  h.press({ code: 'KeyD', ctrlKey: true, altKey: true, metaKey: true });
  assert.equal(h.calls.dictation, 0, 'a missing or extra modifier is a different key');

  h.press({ code: 'KeyD', ctrlKey: true, altKey: true });
  assert.equal(h.calls.dictation, 1);
});

test('auto-repeat and an already-consumed event are ignored', () => {
  const h = harness(shortcuts({ dictationChord: chord({ code: 'KeyD', ctrl: true }) }));

  const repeat = h.press({ code: 'KeyD', ctrlKey: true, repeat: true });
  assert.equal(h.calls.dictation, 0);
  assert.equal(repeat.prevented, false);

  const consumed = h.press({ code: 'KeyD', ctrlKey: true, defaultPrevented: true });
  assert.equal(h.calls.dictation, 0);
  assert.equal(consumed.prevented, false, 'an event another handler claimed is left alone');

  h.press({ code: 'KeyD', ctrlKey: true });
  assert.equal(h.calls.dictation, 1);
});

test('the master switch turns every binding off', () => {
  const h = harness(shortcuts({
    enabled: false,
    dictationChord: chord({ code: 'KeyD', ctrl: true }),
    liveVoiceChord: chord({ code: 'KeyL', ctrl: true }),
  }));

  h.press({ code: 'KeyD', ctrlKey: true });
  h.press({ code: 'KeyL', ctrlKey: true });
  assert.deepEqual(h.calls, { dictation: 0, live: 0 });
});

test('no dispatch while a floating layer is open', () => {
  const h = harness(shortcuts({ dictationChord: chord({ code: 'KeyD', ctrl: true }) }));

  layer = document.createElement('div');
  layer.className = 'modal-backdrop';
  document.body.appendChild(layer);

  const event = h.press({ code: 'KeyD', ctrlKey: true });
  assert.equal(h.calls.dictation, 0, 'the Settings modal is the layer the capture form lives in');
  assert.equal(event.prevented, false);

  layer.remove();
  layer = null;
  h.press({ code: 'KeyD', ctrlKey: true });
  assert.equal(h.calls.dictation, 1);
});

test('a role="dialog" layer is guarded the same way', () => {
  const h = harness(shortcuts({ liveVoiceChord: chord({ code: 'KeyL', ctrl: true }) }));

  layer = document.createElement('div');
  layer.setAttribute('role', 'dialog');
  document.body.appendChild(layer);

  h.press({ code: 'KeyL', ctrlKey: true });
  assert.equal(h.calls.live, 0);
});

test('an unavailable surface does not consume its key', () => {
  const h = harness(shortcuts({
    dictationChord: chord({ code: 'KeyD', ctrl: true }),
    liveVoiceChord: chord({ code: 'KeyL', ctrl: true }),
  }));
  h.available.dictation = false;
  h.available.live = false;

  const dictation = h.press({ code: 'KeyD', ctrlKey: true });
  const live = h.press({ code: 'KeyL', ctrlKey: true });
  assert.deepEqual(h.calls, { dictation: 0, live: 0 });
  assert.equal(dictation.prevented, false);
  assert.equal(live.prevented, false);
});

test('dictation wins when both surfaces are bound to the same keys', () => {
  const h = harness(shortcuts({
    dictationChord: chord({ code: 'KeyD', ctrl: true }),
    liveVoiceChord: chord({ code: 'KeyD', ctrl: true }),
  }));

  h.press({ code: 'KeyD', ctrlKey: true });
  assert.deepEqual(h.calls, { dictation: 1, live: 0 });
});

test('start is idempotent and stop detaches exactly once', () => {
  const h = harness();
  h.controller.start();
  assert.equal(h.counts().attached, 1, 'a second start must not add a second listener');

  h.controller.stop();
  h.controller.stop();
  assert.equal(h.detachCount(), 1);
});

test('the snapshot reports whether the feature is armed, and follows a stored change', () => {
  const h = harness(shortcuts({ enabled: true, dictationChord: chord({ code: 'KeyD', ctrl: true }) }));
  assert.equal(h.controller.getSnapshot().active, true);

  h.setShortcuts(shortcuts({ enabled: false }));
  h.controller.refresh();
  assert.equal(h.controller.getSnapshot().active, false);

  h.setShortcuts(shortcuts({ enabled: true, dictationChord: null, liveVoiceChord: null }));
  h.controller.refresh();
  assert.equal(h.controller.getSnapshot().active, false, 'on but nothing bound is not armed');
});

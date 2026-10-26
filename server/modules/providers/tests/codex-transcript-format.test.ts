import assert from 'node:assert/strict';
import test from 'node:test';

import {
  extractCodexText,
  isInternalCodexContent,
  isVisibleCodexUserMessage,
} from '@/modules/providers/list/codex/codex-transcript-format.js';

/**
 * The shared Codex transcript reader is consumed by BOTH read surfaces: the
 * history projection (`codex-sessions.provider.ts`) and transcript search
 * (`session-conversations-search.service.ts`). These cases pin the readings
 * that decide what each surface sees, so a drift in either surface shows up as
 * a changed literal rather than a re-interpreted assertion.
 *
 * The two separators are deliberately asserted separately: the history
 * projection joins blocks with a newline while search joins with a space, and
 * that difference is part of each reader's contract rather than a default.
 */

test('isVisibleCodexUserMessage: a plain prompt is visible', () => {
  assert.equal(
    isVisibleCodexUserMessage({ type: 'user_message', message: 'hello there' }),
    true,
  );
});

test('isVisibleCodexUserMessage: non-prompt rows are hidden', () => {
  const hidden = [
    { type: 'user_message', kind: 'compaction', message: 'internal' },
    { type: 'user_message', message: '   ' },
    { type: 'user_message', message: 42 },
    { type: 'agent_message', message: 'assistant text' },
    null,
    undefined,
  ];

  for (const payload of hidden) {
    assert.equal(
      isVisibleCodexUserMessage(payload),
      false,
      `expected ${JSON.stringify(payload) ?? 'undefined'} to be hidden`,
    );
  }
});

test('extractCodexText: a plain string is returned unchanged', () => {
  assert.equal(extractCodexText('already text', '\n'), 'already text');
  assert.equal(extractCodexText('already text', ' '), 'already text');
});

test('extractCodexText: the three text block types are extracted and joined with the given separator', () => {
  const content = [
    { type: 'input_text', text: 'first' },
    { type: 'output_text', text: 'second' },
    { type: 'text', text: 'third' },
  ];

  assert.equal(extractCodexText(content, '\n'), 'first\nsecond\nthird');
  assert.equal(extractCodexText(content, ' '), 'first second third');
});

test('extractCodexText: non-text blocks, non-object entries and empty content contribute nothing', () => {
  const content = [
    { type: 'input_text', text: 'kept' },
    { type: 'local_image', path: '/tmp/a.png' },
    { type: 'input_text' },
    { type: 'input_text', text: 7 },
    null,
    'not an object',
    42,
  ];

  assert.equal(extractCodexText(content, '\n'), 'kept');
  assert.equal(extractCodexText([], '\n'), '');
  assert.equal(extractCodexText(null, '\n'), '');
  assert.equal(extractCodexText(undefined, '\n'), '');
  assert.equal(extractCodexText({ type: 'input_text', text: 'x' }, '\n'), '');
  assert.equal(extractCodexText(12, '\n'), '');
});

test('isInternalCodexContent: injected context is internal, conversation is not', () => {
  assert.equal(isInternalCodexContent('<environment_context>cwd=/x'), true);
  assert.equal(isInternalCodexContent('   \n<cwd>/x</cwd>'), true);
  assert.equal(isInternalCodexContent('please fix the bug'), false);
  assert.equal(isInternalCodexContent(''), false);
});

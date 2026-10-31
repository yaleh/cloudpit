import assert from 'node:assert/strict';
import test from 'node:test';

import {
  extractCodexText,
  isInternalCodexContent,
  isVisibleCodexUserMessage,
  readCodexTranscriptMessage,
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

/*
 * The prose reader. Every row below is a shape a REAL rollout writes (captured from
 * ~/.codex/sessions/**): the modern user carrier is `event_msg/item_completed/UserMessage`, the
 * legacy one is `event_msg/user_message`, the assistant carrier is
 * `response_item/message/role=assistant`, and the SAME prompt/answer are also written as
 * `response_item/message/role=user` and `event_msg/item_completed/AgentMessage`. The reader must
 * choose one carrier per role, not concatenate them.
 */

test('readCodexTranscriptMessage: both user carriers and the assistant carrier read as prose', () => {
  assert.deepEqual(
    readCodexTranscriptMessage({
      type: 'event_msg',
      timestamp: '2026-10-25T09:00:00.000Z',
      payload: { type: 'user_message', message: 'legacy prompt' },
    }),
    { role: 'user', text: 'legacy prompt', timestamp: '2026-10-25T09:00:00.000Z' },
  );

  assert.deepEqual(
    readCodexTranscriptMessage({
      type: 'event_msg',
      timestamp: '2026-10-25T09:01:00.000Z',
      payload: { type: 'item_completed', item: { type: 'UserMessage', content: [{ type: 'text', text: 'modern prompt' }] } },
    }),
    { role: 'user', text: 'modern prompt', timestamp: '2026-10-25T09:01:00.000Z' },
  );

  assert.deepEqual(
    readCodexTranscriptMessage({
      type: 'response_item',
      timestamp: '2026-10-25T09:02:00.000Z',
      payload: { type: 'message', role: 'assistant', content: [{ type: 'output_text', text: 'answer' }] },
    }),
    { role: 'assistant', text: 'answer', timestamp: '2026-10-25T09:02:00.000Z' },
  );
});

test('readCodexTranscriptMessage: duplicate carriers and non-prose rows read as null', () => {
  const nullRows: Array<[string, unknown]> = [
    [
      'the wire user row (the same prompt is carried by event_msg)',
      { type: 'response_item', payload: { type: 'message', role: 'user', content: [{ type: 'input_text', text: 'same prompt' }] } },
    ],
    [
      'the AgentMessage item (the same answer is carried by response_item)',
      { type: 'event_msg', payload: { type: 'item_completed', item: { type: 'AgentMessage', content: [{ type: 'Text', text: 'same answer' }] } } },
    ],
    ['reasoning', { type: 'response_item', payload: { type: 'reasoning', summary: [{ text: 'thinking' }] } }],
    ['a tool call', { type: 'response_item', payload: { type: 'function_call', name: 'shell', arguments: '{}' } }],
    ['a tool result', { type: 'response_item', payload: { type: 'function_call_output', output: 'tool output' } }],
    ['a lifecycle event', { type: 'event_msg', payload: { type: 'task_complete', turn_id: 't1' } }],
    ['a non-plain user message', { type: 'event_msg', payload: { type: 'user_message', kind: 'compaction', message: 'internal' } }],
    ['injected context', { type: 'event_msg', payload: { type: 'user_message', message: '<environment_context>cwd=/x' } }],
    ['an empty prompt', { type: 'event_msg', payload: { type: 'user_message', message: '   ' } }],
    ['a row with no payload', { type: 'response_item' }],
  ];

  for (const [label, row] of nullRows) {
    assert.equal(readCodexTranscriptMessage(row), null, `${label} must not read as prose`);
  }
});

